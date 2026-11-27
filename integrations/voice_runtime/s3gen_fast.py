# SPDX-License-Identifier: GPL-3.0-only
"""Zero-sync, BF16 + Shared-Pool Bucketed CUDA Graph S3Gen decoder and chunked streamer.

Eliminates redundant GPU->CPU synchronizations inside Chatterbox's S3Gen ConditionalDecoder
and UpsampleConformerEncoder, runs the CFM flow network in native BF16 on Ampere+ GPUs
while keeping the HiFTGenerator vocoder in FP32, and captures shared-pool single-step CFM
CUDA Graphs with GPU padding masks. Automatically falls back to FP32 on GPUs without native
BF16 (e.g. Turing/Pascal), eager mode on ROCm/CPU/OOM/overflow lengths, and migrates
streaming state cleanly if the decoder moves from CUDA to CPU mid-utterance.
"""
import inspect

import numpy as np
import torch
import torch.nn.functional as F

from .inference import check_cancelled

S3GEN_SR = 24000
S3_TOKEN_RATE = 25
SAMPLES_PER_TOKEN = S3GEN_SR // S3_TOKEN_RATE  # 960 samples = 40 ms @ 24 kHz
_PATCHED_UPSAMPLE_MASK = False


def native_bf16_supported(device):
    """Return True only when the CUDA device has hardware BF16 Tensor Cores (SM >= 8.0)."""
    if str(device) == 'cpu' or not torch.cuda.is_available():
        return False
    if getattr(torch.version, 'hip', None):
        return False
    try:
        major, _minor = torch.cuda.get_device_capability(device)
        if major < 8:
            return False
        fn = getattr(torch.cuda, 'is_bf16_supported', None)
        if not callable(fn):
            return False
        params = inspect.signature(fn).parameters
        if 'including_emulation' in params:
            return bool(fn(including_emulation=False))
        return bool(fn())
    except (RuntimeError, ValueError, AssertionError, TypeError):
        return False


def cfm_cuda_graphs_supported(device):
    """Return True when the target device safely supports CFM CUDA Graph capture."""
    if str(device) == 'cpu' or not torch.cuda.is_available():
        return False
    if getattr(torch.version, 'hip', None):
        return False
    try:
        major, _minor = torch.cuda.get_device_capability(device)
        return major >= 7
    except (RuntimeError, ValueError, AssertionError):
        return False


def _ensure_zero_sync_upsample_mask():
    """Patch UpsampleConformerEncoder's add_optional_chunk_mask to skip the
    redundant GPU->CPU .item() sync when static_chunk_size <= 0 and use_dynamic_chunk is False.
    """
    global _PATCHED_UPSAMPLE_MASK
    if _PATCHED_UPSAMPLE_MASK:
        return
    try:
        import chatterbox.models.s3gen.transformer.upsample_encoder as ue_mod
        from chatterbox.models.s3gen.utils.mask import add_optional_chunk_mask as orig_chunk_mask
    except ImportError:
        return

    def fast_chunk_mask(
        xs,
        masks,
        use_dynamic_chunk,
        use_dynamic_left_chunk,
        decoding_chunk_size,
        static_chunk_size,
        num_decoding_left_chunks,
        enable_full_context=True,
    ):
        if not use_dynamic_chunk and static_chunk_size <= 0:
            return masks
        return orig_chunk_mask(
            xs,
            masks,
            use_dynamic_chunk,
            use_dynamic_left_chunk,
            decoding_chunk_size,
            static_chunk_size,
            num_decoding_left_chunks,
            enable_full_context,
        )

    ue_mod.add_optional_chunk_mask = fast_chunk_mask
    _PATCHED_UPSAMPLE_MASK = True


def _estimator_forward_zero_sync(est, x, mask, mu, t, spks, cond, zero_b=None, neg_b=None, masked=False):
    """Exact ConditionalDecoder.forward with zero GPU->CPU syncs.

    When masked=False (unpadded batch=1), passes attention_mask=None to unlock FlashAttention-2.
    When masked=True (padded CUDA Graph bucket), computes additive attention bias on GPU via
    pre-allocated scalar tensors zero_b/neg_b so padded frames have zero effect on valid frames.
    """
    from einops import pack, repeat

    t = est.time_embeddings(t).to(t.dtype)
    t = est.time_mlp(t)
    x = pack([x, mu], 'b * t')[0]
    if spks is not None:
        spks = repeat(spks, 'b c -> b c t', t=x.shape[-1])
        x = pack([x, spks], 'b * t')[0]
    if cond is not None:
        x = pack([x, cond], 'b * t')[0]

    hiddens = []
    masks = [mask]

    for resnet, transformer_blocks, downsample in est.down_blocks:
        mask_down = masks[-1]
        x = resnet(x, mask_down, t)
        x = x.transpose(1, 2).contiguous()
        attn_bias = torch.where(mask_down > 0.5, zero_b, neg_b) if masked else None
        for transformer_block in transformer_blocks:
            x = transformer_block(hidden_states=x, attention_mask=attn_bias, timestep=t)
        x = x.transpose(1, 2).contiguous()
        hiddens.append(x)
        x = downsample(x * mask_down)
        masks.append(mask_down[:, :, ::2])

    masks = masks[:-1]
    mask_mid = masks[-1]
    attn_bias_mid = torch.where(mask_mid > 0.5, zero_b, neg_b) if masked else None
    for resnet, transformer_blocks in est.mid_blocks:
        x = resnet(x, mask_mid, t)
        x = x.transpose(1, 2).contiguous()
        for transformer_block in transformer_blocks:
            x = transformer_block(hidden_states=x, attention_mask=attn_bias_mid, timestep=t)
        x = x.transpose(1, 2).contiguous()

    for resnet, transformer_blocks, upsample in est.up_blocks:
        mask_up = masks.pop()
        skip = hiddens.pop()
        x = pack([x[:, :, : skip.shape[-1]], skip], 'b * t')[0]
        x = resnet(x, mask_up, t)
        x = x.transpose(1, 2).contiguous()
        attn_bias_up = torch.where(mask_up > 0.5, zero_b, neg_b) if masked else None
        for transformer_block in transformer_blocks:
            x = transformer_block(hidden_states=x, attention_mask=attn_bias_up, timestep=t)
        x = x.transpose(1, 2).contiguous()
        x = upsample(x * mask_up)

    x = est.final_block(x, mask_up)
    output = est.final_proj(x * mask_up)
    return output * mask


class FastS3GenDecoder:
    """Accelerated S3Gen acoustic decoder (Flow + CFM + HiFT) with optional CUDA Graph buckets."""

    BUCKET_DELTAS = (80, 176, 272, 464, 656)

    def __init__(self, s3gen, enable_cuda_graph=True):
        _ensure_zero_sync_upsample_mask()
        self.s3gen = s3gen
        self.enable_cuda_graph = bool(enable_cuda_graph)
        self.device = 'cpu'
        self.use_bf16 = False
        self.flow_dtype = torch.float32
        self._spk_cache = None  # (ptr, device, dtype, projected_tensor)
        self._zero_b = None
        self._neg_b = None
        self._t_steps = None
        self._dt_steps = None
        self._empty_cache_source = None
        self._graph_pool = None
        self._buckets = {}  # bucket_len -> dict of graph and static buffers
        self._bucket_keys = ()
        self._graphs_ready = False
        self._captured_prompt_len = None

    @property
    def cfm_cuda_graph(self):
        return self._graphs_ready and bool(self._buckets)

    @property
    def precision_label(self):
        if self.device == 'cpu':
            return 'float32-decoder'
        return 'bfloat16-flow/float32-hift' if self.use_bf16 else 'float32-decoder'

    def release_graphs(self):
        self._buckets.clear()
        self._bucket_keys = ()
        self._graph_pool = None
        self._graphs_ready = False
        self._captured_prompt_len = None

    @torch.inference_mode()
    def configure_device(self, device, ref_dict):
        """Move S3Gen flow/HiFT and reference dict to target device with safe precision."""
        self.release_graphs()
        self._spk_cache = None
        self.device = device
        self.use_bf16 = native_bf16_supported(device)
        self.flow_dtype = torch.bfloat16 if self.use_bf16 else torch.float32

        self.s3gen.flow.to(device=device, dtype=self.flow_dtype)
        self.s3gen.mel2wav.to(device=device, dtype=torch.float32)
        self.s3gen.trim_fade = self.s3gen.trim_fade.to(device=device, dtype=torch.float32)

        updated_ref = {}
        for key, value in ref_dict.items():
            if torch.is_tensor(value):
                if value.is_floating_point():
                    updated_ref[key] = value.to(device=device, dtype=self.flow_dtype)
                else:
                    updated_ref[key] = value.to(device=device, dtype=torch.long)
            else:
                updated_ref[key] = value

        self._zero_b = torch.zeros((), device=device, dtype=self.flow_dtype)
        self._neg_b = torch.tensor(-1.0e9, device=device, dtype=self.flow_dtype)
        self._empty_cache_source = torch.zeros(1, 1, 0, device=device, dtype=torch.float32)

        n_steps = 10
        t_span = torch.linspace(0, 1, n_steps + 1, device=device, dtype=self.flow_dtype)
        t_span = 1 - torch.cos(t_span * 0.5 * torch.pi)
        self._t_steps = [t_span[i : i + 1].expand(2).contiguous() for i in range(n_steps)]
        self._dt_steps = [(t_span[i + 1] - t_span[i]).view(1, 1, 1).contiguous() for i in range(n_steps)]
        return updated_ref

    @torch.inference_mode()
    def prepare_graphs(self, ref_dict, cancelled=None, free_gpu_bytes=None):
        """Capture single-step shared-pool CFM CUDA Graph buckets for low-latency decoding."""
        if not self.enable_cuda_graph or not cfm_cuda_graphs_supported(self.device):
            return False
        prompt_len = int(ref_dict['prompt_feat'].shape[1])
        if self._graphs_ready and self._captured_prompt_len == prompt_len:
            return True
        if free_gpu_bytes is not None and free_gpu_bytes < 512 * 1024**2:
            return False

        self.release_graphs()
        est = self.s3gen.flow.decoder.estimator
        cfg_rate = float(self.s3gen.flow.decoder.inference_cfg_rate)
        one_plus_cfg = 1.0 + cfg_rate
        pool_handle = torch.cuda.graph_pool_handle()
        self._graph_pool = pool_handle
        zero_b, neg_b = self._zero_b, self._neg_b

        bucket_lens = []
        for delta in self.BUCKET_DELTAS:
            b_len = ((prompt_len + delta + 31) // 32) * 32
            if b_len not in bucket_lens:
                bucket_lens.append(b_len)

        try:
            for b_len in bucket_lens:
                check_cancelled(cancelled)
                x_cur = torch.zeros((1, 80, b_len), device=self.device, dtype=self.flow_dtype)
                x_in = torch.zeros((2, 80, b_len), device=self.device, dtype=self.flow_dtype)
                mask_in = torch.ones((2, 1, b_len), device=self.device, dtype=self.flow_dtype)
                mu_in = torch.zeros((2, 80, b_len), device=self.device, dtype=self.flow_dtype)
                t_in = torch.zeros((2,), device=self.device, dtype=self.flow_dtype)
                spks_in = torch.zeros((2, 80), device=self.device, dtype=self.flow_dtype)
                cond_in = torch.zeros((2, 80, b_len), device=self.device, dtype=self.flow_dtype)
                dt_in = torch.ones((1, 1, 1), device=self.device, dtype=self.flow_dtype)

                def _cfm_step():
                    x_in[0:1].copy_(x_cur)
                    x_in[1:2].copy_(x_cur)
                    dxdt = _estimator_forward_zero_sync(
                        est,
                        x_in,
                        mask_in,
                        mu_in,
                        t_in,
                        spks_in,
                        cond_in,
                        zero_b=zero_b,
                        neg_b=neg_b,
                        masked=True,
                    )
                    vel = one_plus_cfg * dxdt[0:1] - cfg_rate * dxdt[1:2]
                    x_cur.add_(vel * dt_in)

                stream = torch.cuda.Stream()
                stream.wait_stream(torch.cuda.current_stream())
                with torch.cuda.stream(stream):
                    for _ in range(2):
                        _cfm_step()
                torch.cuda.current_stream().wait_stream(stream)
                torch.cuda.synchronize()

                graph = torch.cuda.CUDAGraph()
                with torch.cuda.graph(graph, pool=pool_handle):
                    _cfm_step()
                torch.cuda.synchronize()

                self._buckets[b_len] = dict(
                    graph=graph,
                    x_cur=x_cur,
                    x_in=x_in,
                    mask_in=mask_in,
                    mu_in=mu_in,
                    t_in=t_in,
                    spks_in=spks_in,
                    cond_in=cond_in,
                    dt_in=dt_in,
                )

            self._bucket_keys = tuple(sorted(self._buckets.keys()))
            self._captured_prompt_len = prompt_len
            self._graphs_ready = True
            return True
        except (RuntimeError, ValueError, torch.cuda.OutOfMemoryError):
            self.release_graphs()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            return False

    def _projected_speaker(self, embedding):
        key = (embedding.data_ptr(), self.device, self.flow_dtype)
        if self._spk_cache is not None and self._spk_cache[0] == key:
            return self._spk_cache[1]
        emb = torch.atleast_2d(embedding)
        emb = F.normalize(emb, dim=1)
        proj = self.s3gen.flow.spk_embed_affine_layer(emb).detach()
        self._spk_cache = (key, proj)
        return proj

    def _solve_euler(self, z, mu, mask, spks, cond, n_timesteps=10, cancelled=None):
        t_real = int(mu.shape[-1])
        bucket_key = None
        if n_timesteps == 10 and self._graphs_ready:
            for b_len in self._bucket_keys:
                if t_real <= b_len:
                    bucket_key = b_len
                    break

        if bucket_key is not None:
            b = self._buckets[bucket_key]
            x_cur = b['x_cur']
            mask_in = b['mask_in']
            mu_in = b['mu_in']
            spks_in = b['spks_in']
            cond_in = b['cond_in']
            t_in = b['t_in']
            dt_in = b['dt_in']
            graph = b['graph']

            x_cur[:, :, :t_real].copy_(z)
            if t_real < bucket_key:
                x_cur[:, :, t_real:].zero_()
                mask_in[:, :, :t_real].fill_(1.0)
                mask_in[:, :, t_real:].zero_()
                mu_in[0:1, :, :t_real].copy_(mu)
                mu_in[0:1, :, t_real:].zero_()
                mu_in[1:2].zero_()
                cond_in[0:1, :, :t_real].copy_(cond)
                cond_in[0:1, :, t_real:].zero_()
                cond_in[1:2].zero_()
            else:
                mask_in.fill_(1.0)
                mu_in[0:1].copy_(mu)
                mu_in[1:2].zero_()
                cond_in[0:1].copy_(cond)
                cond_in[1:2].zero_()
            spks_in[0:1].copy_(spks)
            spks_in[1:2].zero_()

            for step_idx in range(10):
                check_cancelled(cancelled)
                t_in.copy_(self._t_steps[step_idx])
                dt_in.copy_(self._dt_steps[step_idx])
                graph.replay()
            return x_cur[:, :, :t_real].clone()

        # Zero-sync eager fallback (CPU, ROCm, or lengths > max bucket)
        est = self.s3gen.flow.decoder.estimator
        cfg_rate = float(self.s3gen.flow.decoder.inference_cfg_rate)
        one_plus_cfg = 1.0 + cfg_rate
        x = z
        x_in = torch.zeros((2, 80, t_real), device=self.device, dtype=self.flow_dtype)
        mask_in = torch.ones((2, 1, t_real), device=self.device, dtype=self.flow_dtype)
        mu_in = torch.zeros((2, 80, t_real), device=self.device, dtype=self.flow_dtype)
        t_in = torch.zeros((2,), device=self.device, dtype=self.flow_dtype)
        spks_in = torch.zeros((2, 80), device=self.device, dtype=self.flow_dtype)
        cond_in = torch.zeros((2, 80, t_real), device=self.device, dtype=self.flow_dtype)
        mu_in[0:1].copy_(mu)
        spks_in[0:1].copy_(spks)
        cond_in[0:1].copy_(cond)

        if n_timesteps == 10:
            t_steps, dt_steps = self._t_steps, self._dt_steps
        else:
            t_span = torch.linspace(0, 1, n_timesteps + 1, device=self.device, dtype=self.flow_dtype)
            t_span = 1 - torch.cos(t_span * 0.5 * torch.pi)
            t_steps = [t_span[i : i + 1].expand(2).contiguous() for i in range(n_timesteps)]
            dt_steps = [(t_span[i + 1] - t_span[i]).view(1, 1, 1).contiguous() for i in range(n_timesteps)]

        for step_idx in range(n_timesteps):
            check_cancelled(cancelled)
            x_in[0:1].copy_(x)
            x_in[1:2].copy_(x)
            t_in.copy_(t_steps[step_idx])
            dxdt = _estimator_forward_zero_sync(
                est,
                x_in,
                mask_in,
                mu_in,
                t_in,
                spks_in,
                cond_in,
                masked=False,
            )
            vel = one_plus_cfg * dxdt[0:1] - cfg_rate * dxdt[1:2]
            x = x + vel * dt_steps[step_idx]
        return x

    @torch.inference_mode()
    def _flow_infer(self, speech_tokens_2d, ref_dict, n_timesteps=10, cancelled=None, generator=None):
        """Zero-sync CausalMaskedDiffWithXvec inference returning target mels (1, 80, 2*T_tok)."""
        flow = self.s3gen.flow
        spks = self._projected_speaker(ref_dict['embedding'])
        prompt_token = ref_dict['prompt_token']
        prompt_token_len = ref_dict['prompt_token_len']
        prompt_feat = ref_dict['prompt_feat']

        n_in = int(speech_tokens_2d.shape[-1])
        token = torch.cat([prompt_token, speech_tokens_2d], dim=1)
        token_len = prompt_token_len + n_in
        tok_emb = flow.input_embedding(token)

        check_cancelled(cancelled)
        h, _h_masks = flow.encoder(tok_emb, token_len)
        mel_len1 = int(prompt_feat.shape[1])
        mel_total = int(h.shape[1])
        h = flow.encoder_proj(h)

        conds = torch.zeros((1, mel_total, 80), device=self.device, dtype=self.flow_dtype)
        conds[:, :mel_len1] = prompt_feat
        conds = conds.transpose(1, 2).contiguous()
        mu = h.transpose(1, 2).contiguous()
        mask = torch.ones((1, 1, mel_total), device=self.device, dtype=self.flow_dtype)
        z = torch.randn((1, 80, mel_total), device=self.device, dtype=self.flow_dtype, generator=generator)

        feat = self._solve_euler(z, mu, mask, spks, conds, n_timesteps=n_timesteps, cancelled=cancelled)
        return feat[:, :, mel_len1:]

    @torch.inference_mode()
    def decode_full(self, speech_tokens_1d, ref_dict, watermarker=None, cancelled=None, n_timesteps=10):
        """Decode a complete utterance's valid speech tokens to 24 kHz float32 mono waveform."""
        check_cancelled(cancelled)
        tokens_2d = torch.atleast_2d(speech_tokens_1d).to(device=self.device, dtype=torch.long)
        n_tokens = int(tokens_2d.shape[-1])
        if n_tokens == 0:
            return np.zeros((0,), dtype=np.float32)

        mels = self._flow_infer(tokens_2d, ref_dict, n_timesteps=n_timesteps, cancelled=cancelled)
        check_cancelled(cancelled)
        wav, _ = self.s3gen.mel2wav.inference(
            speech_feat=mels.float(),
            cache_source=self._empty_cache_source,
        )
        trim = self.s3gen.trim_fade
        if wav.shape[-1] >= len(trim):
            wav[:, : len(trim)] *= trim
        wav_np = wav.squeeze(0).detach().cpu().numpy().astype(np.float32, copy=False)
        st_len = max(1, n_tokens - 1)
        wav_np = wav_np[: st_len * SAMPLES_PER_TOKEN]
        if watermarker is not None and len(wav_np) > 0:
            wav_np = np.asarray(watermarker.apply_watermark(wav_np, sample_rate=S3GEN_SR), dtype=np.float32)
        return wav_np

    def create_stream_state(self, ctx_tokens=16, fade_samples=480, seed=417):
        return StreamingDecoderState(self, ctx_tokens=ctx_tokens, fade_samples=fade_samples, seed=seed)


class StreamingDecoderState:
    """Stateful chunked S3Gen acoustic decoder with mel+token conditioning continuity,
    real-time holdback overlap-add crossfading, RNG isolation from T3, and OOM device migration.
    """

    def __init__(self, decoder: FastS3GenDecoder, ctx_tokens=16, fade_samples=480, seed=417):
        self.decoder = decoder
        self.ctx_tokens = ctx_tokens
        self.fade_samples = fade_samples
        self.seed = int(seed)
        self.prev_tokens_tail = None  # (1, n_ctx) int64 on decoder.device
        self.prev_mel_tail = None     # (1, 80, 2*n_ctx) flow_dtype on decoder.device
        self.pending_tail = None      # (fade_samples,) float32 numpy held back for next crossfade
        self.noise_gen = torch.Generator(device=decoder.device).manual_seed(self.seed)
        t_fade = np.linspace(0.0, np.pi, fade_samples, dtype=np.float32)
        self.w_out = 0.5 * (1.0 + np.cos(t_fade))
        self.w_in = 1.0 - self.w_out

    def _sync_device(self):
        """Migrate cached chunk context if decoder moved (e.g. CUDA -> CPU after OOM)."""
        dev = self.decoder.device
        dtype = self.decoder.flow_dtype
        if self.prev_tokens_tail is not None and str(self.prev_tokens_tail.device) != str(dev):
            self.prev_tokens_tail = self.prev_tokens_tail.to(device=dev, dtype=torch.long)
        if self.prev_mel_tail is not None and (
            str(self.prev_mel_tail.device) != str(dev) or self.prev_mel_tail.dtype != dtype
        ):
            self.prev_mel_tail = self.prev_mel_tail.to(device=dev, dtype=dtype)
        if str(self.noise_gen.device) != str(dev):
            self.noise_gen = torch.Generator(device=dev).manual_seed(self.seed)

    @torch.inference_mode()
    def decode_chunk(
        self,
        valid_tokens_list,
        emit_start,
        emit_end,
        is_first,
        is_last,
        ref_dict,
        watermarker=None,
        cancelled=None,
        n_timesteps=10,
    ):
        """Decode one incremental chunk and return ready-to-play float32 PCM samples."""
        if is_first and is_last:
            tok_t = torch.tensor(valid_tokens_list, device=self.decoder.device, dtype=torch.long)
            return self.decoder.decode_full(
                tok_t,
                ref_dict,
                watermarker=watermarker,
                cancelled=cancelled,
                n_timesteps=n_timesteps,
            )

        check_cancelled(cancelled)
        self._sync_device()
        device = self.decoder.device
        use_cuda_rng = str(device) != 'cpu' and torch.cuda.is_available()
        saved_rng = torch.cuda.get_rng_state(device) if use_cuda_rng else torch.get_rng_state()
        try:
            in_list = valid_tokens_list[emit_start:]
            in_toks = torch.tensor(in_list, device=device, dtype=torch.long).unsqueeze(0)

            if self.prev_tokens_tail is not None and self.prev_mel_tail is not None:
                n_ctx = int(self.prev_tokens_tail.shape[-1])
                ref_ext = dict(ref_dict)
                ref_ext['prompt_token'] = torch.cat([ref_dict['prompt_token'], self.prev_tokens_tail], dim=1)
                ref_ext['prompt_token_len'] = ref_dict['prompt_token_len'] + n_ctx
                ref_ext['prompt_feat'] = torch.cat(
                    [ref_dict['prompt_feat'], self.prev_mel_tail.transpose(1, 2)], dim=1
                )
                mel_new = self.decoder._flow_infer(
                    in_toks,
                    ref_ext,
                    n_timesteps=n_timesteps,
                    cancelled=cancelled,
                    generator=self.noise_gen,
                )
                mel_for_hift = torch.cat([self.prev_mel_tail, mel_new], dim=2).float()
                hift_skip = n_ctx * SAMPLES_PER_TOKEN
            else:
                mel_new = self.decoder._flow_infer(
                    in_toks,
                    ref_dict,
                    n_timesteps=n_timesteps,
                    cancelled=cancelled,
                    generator=self.noise_gen,
                )
                mel_for_hift = mel_new.float()
                hift_skip = 0

            check_cancelled(cancelled)
            wav, _ = self.decoder.s3gen.mel2wav.inference(
                speech_feat=mel_for_hift,
                cache_source=self.decoder._empty_cache_source,
            )
            if is_first:
                trim = self.decoder.s3gen.trim_fade
                if wav.shape[-1] >= len(trim):
                    wav[:, : len(trim)] *= trim
            wav_np = wav.squeeze(0).detach().cpu().numpy().astype(np.float32, copy=False)
        finally:
            if use_cuda_rng:
                torch.cuda.set_rng_state(saved_rng, device)
            else:
                torch.set_rng_state(saved_rng)

        # Update rolling token + mel context tail for the next chunk
        if not is_last:
            emitted_count = emit_end - emit_start
            emitted_mels = mel_new[:, :, : emitted_count * 2]
            if self.prev_mel_tail is None:
                combined_mel = emitted_mels
            else:
                combined_mel = torch.cat([self.prev_mel_tail, emitted_mels], dim=2)
            keep_mel = min(combined_mel.shape[-1], self.ctx_tokens * 2)
            self.prev_mel_tail = combined_mel[:, :, -keep_mel:].contiguous()

            keep_toks = min(emit_end, self.ctx_tokens)
            self.prev_tokens_tail = torch.tensor(
                valid_tokens_list[emit_end - keep_toks : emit_end],
                device=device,
                dtype=torch.long,
            ).unsqueeze(0)

        # Compute exact emitted sample range (matching native final-token trim on is_last)
        if is_last:
            total_audio_tokens = max(1, len(valid_tokens_list) - 1)
            emit_tok_count = max(1, total_audio_tokens - emit_start)
        else:
            emit_tok_count = emit_end - emit_start
        emit_samples = emit_tok_count * SAMPLES_PER_TOKEN

        ov_target = self.fade_samples
        if is_first:
            piece = wav_np[0:emit_samples]
            if watermarker is not None and len(piece) > 0:
                piece = np.asarray(watermarker.apply_watermark(piece, sample_rate=S3GEN_SR), dtype=np.float32)[: len(piece)]
            if len(piece) > ov_target:
                self.pending_tail = piece[-ov_target:].copy()
                return piece[:-ov_target].copy()
            self.pending_tail = None
            return piece.copy()

        start_s = max(0, hift_skip - ov_target)
        end_s = min(len(wav_np), hift_skip + emit_samples)
        piece = wav_np[start_s:end_s]
        if watermarker is not None and len(piece) > 0:
            piece = np.asarray(watermarker.apply_watermark(piece, sample_rate=S3GEN_SR), dtype=np.float32)[: len(piece)]

        if self.pending_tail is not None and len(piece) > 0:
            ov = min(len(self.pending_tail), len(piece), ov_target)
            if ov == ov_target:
                blended = self.pending_tail * self.w_out + piece[:ov] * self.w_in
            else:
                t_f = np.linspace(0.0, np.pi, ov, dtype=np.float32)
                wo = 0.5 * (1.0 + np.cos(t_f))
                blended = self.pending_tail[-ov:] * wo + piece[:ov] * (1.0 - wo)
            rest = piece[ov:]
            if not is_last and len(rest) > ov_target:
                self.pending_tail = rest[-ov_target:].copy()
                return np.concatenate([blended, rest[:-ov_target]])
            self.pending_tail = None
            return np.concatenate([blended, rest])

        if not is_last and len(piece) > ov_target:
            self.pending_tail = piece[-ov_target:].copy()
            return piece[:-ov_target].copy()
        self.pending_tail = None
        return piece.copy()
