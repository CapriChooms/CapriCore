# SPDX-License-Identifier: GPL-3.0-only
"""Fixed-address CUDA Graph replay and token-level streaming for Chatterbox Multilingual V3 T3.

Keeps learned weights, CFG math, and sampling distributions faithful to the native
Chatterbox Multilingual V3 Llama_520M backbone while eliminating per-token Python/WDDM
dispatch overhead, DynamicCache concatenations, and redundant speaker conditioning.
"""
import inspect
import time

import torch
from transformers import StaticCache

from .inference import SpeechGenerationLimit, check_cancelled

SPEECH_VOCAB_SIZE = 6561


def cuda_graphs_supported(device):
    """Return True when the target device safely supports CUDA Graph capture."""
    if str(device) == 'cpu' or not torch.cuda.is_available():
        return False
    if getattr(torch.version, 'hip', None):
        return False
    try:
        major, _minor = torch.cuda.get_device_capability(device)
        return major >= 7
    except (RuntimeError, ValueError, AssertionError):
        return False


def _create_static_cache(cfg, capacity, device, dtype):
    """Construct StaticCache compatibly across Transformers 4.x and 5.x."""
    params = inspect.signature(StaticCache.__init__).parameters
    kwargs = {'config': cfg, 'max_cache_len': capacity}
    if 'max_batch_size' in params:
        kwargs['max_batch_size'] = 2
    if 'device' in params:
        kwargs['device'] = device
    if 'dtype' in params:
        kwargs['dtype'] = dtype
    return StaticCache(**kwargs)


def gpu_apply_sampling_processors(
    logits,
    history,
    penalty=1.2,
    temperature=0.8,
    min_p=0.05,
    top_p=1.0,
):
    """Pure-GPU, CUDA-Graph-safe logits processing matching HuggingFace processors:
    RepetitionPenaltyLogitsProcessor -> Temperature -> MinPLogitsWarper -> TopPLogitsWarper.
    """
    if penalty != 1.0:
        score = torch.gather(logits, 1, history)
        score = torch.where(score < 0, score * penalty, score / penalty)
        logits = logits.scatter(1, history, score)
    if temperature != 1.0:
        logits = logits / temperature
    if min_p > 0.0:
        probs = torch.softmax(logits.float(), dim=-1)
        top_probs, _ = probs.max(dim=-1, keepdim=True)
        logits = logits.masked_fill(probs < (min_p * top_probs), float('-inf'))
    if top_p < 1.0:
        sorted_logits, sorted_indices = torch.sort(logits.float(), descending=False)
        cumulative_probs = sorted_logits.softmax(dim=-1).cumsum(dim=-1)
        sorted_indices_to_remove = cumulative_probs <= (1.0 - top_p)
        sorted_indices_to_remove[..., -1:] = False
        indices_to_remove = sorted_indices_to_remove.scatter(1, sorted_indices, sorted_indices_to_remove)
        logits = logits.masked_fill(indices_to_remove, float('-inf'))
    return logits


class MultilingualT3Graph:
    """Fixed-address, single-token CFG=2 CUDA Graph replay for Multilingual V3 T3."""

    @torch.inference_mode()
    def __init__(
        self,
        t3,
        cancelled=lambda: None,
        capacity=1088,
        max_tokens=800,
        cfg_weight=0.5,
        temperature=0.8,
        repetition_penalty=1.2,
        min_p=0.05,
        top_p=1.0,
    ):
        self.t3 = t3
        self.cancelled = cancelled
        self.native = t3.inference
        self.capacity = max(capacity, max_tokens + 288)
        self.max_tokens = max_tokens
        self.cfg_weight = cfg_weight
        self.temperature = temperature
        self.repetition_penalty = repetition_penalty
        self.min_p = min_p
        self.top_p = top_p
        self.device = t3.device
        self.dtype = next(t3.tfmr.parameters()).dtype
        self.bos_id = int(t3.hp.start_speech_token)
        self.eos_id = int(t3.hp.stop_speech_token)
        self.batch_steps = 1

        if not cuda_graphs_supported(self.device):
            raise RuntimeError('CUDA Graphs are not supported on the selected compute device')

        self.cache = _create_static_cache(t3.cfg, self.capacity, self.device, self.dtype)

        self.token = torch.zeros((1, 1), dtype=torch.long, device=self.device)
        self.cache_position = torch.zeros((1,), dtype=torch.long, device=self.device)
        self.speech_step = torch.zeros((1, 1), dtype=torch.long, device=self.device)
        self.history = torch.zeros((1, max_tokens + 2), dtype=torch.long, device=self.device)
        self.history_pos = torch.ones((1,), dtype=torch.long, device=self.device)
        self.one_pos = torch.ones((1,), dtype=torch.long, device=self.device)
        self.slots = torch.arange(self.capacity, device=self.device).view(1, 1, 1, -1)
        self.cfg_tensor = torch.tensor(cfg_weight, device=self.device, dtype=self.dtype)
        self.neg_inf = torch.tensor(torch.finfo(self.dtype).min, device=self.device, dtype=self.dtype)
        self.zero_mask = torch.tensor(0.0, device=self.device, dtype=self.dtype)
        self._cond_cache = {}

        # Precompute constant double-BOS embeddings matching native t3.inference layout.
        bos_tok = torch.full((2, 1), self.bos_id, dtype=torch.long, device=self.device)
        bos_emb0 = t3.speech_emb(bos_tok) + t3.speech_pos_emb(bos_tok)
        bos_emb1 = (t3.speech_emb(bos_tok[:1]) + t3.speech_pos_emb.get_fixed_embedding(0)).expand(2, -1, -1)
        self._bos_pair = torch.cat([bos_emb0, bos_emb1], dim=1).detach().contiguous()

        check_cancelled(self.cancelled())

        # Populate StaticCache and allocator kernels on a side stream before capture.
        stream = torch.cuda.Stream()
        stream.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(stream):
            dummy_prefill = torch.zeros((2, 4, t3.dim), dtype=self.dtype, device=self.device)
            pos = torch.arange(4, device=self.device)
            mask = torch.where(self.slots <= pos.view(1, 1, -1, 1), self.zero_mask, self.neg_inf).expand(2, -1, -1, -1)
            t3.tfmr(
                inputs_embeds=dummy_prefill,
                past_key_values=self.cache,
                cache_position=pos,
                position_ids=pos.unsqueeze(0).expand(2, -1),
                attention_mask=mask,
                use_cache=True,
                output_hidden_states=False,
                output_attentions=False,
                return_dict=True,
            )
            self.cache_position.fill_(4)
            self.speech_step.fill_(1)
            self.history.fill_(self.bos_id)
            self.history_pos.fill_(1)
            for _ in range(3):
                self._step()
        torch.cuda.current_stream().wait_stream(stream)
        torch.cuda.synchronize()

        check_cancelled(self.cancelled())

        self.graph = torch.cuda.CUDAGraph()
        self.cache_position.fill_(4)
        self.speech_step.fill_(1)
        self.history.fill_(self.bos_id)
        self.history_pos.fill_(1)
        with torch.cuda.graph(self.graph):
            self._step()
        torch.cuda.synchronize()

        self.validation_max_error = self.qualify()

    def _step(self):
        mask = torch.where(
            self.slots <= self.cache_position.view(1, 1, 1, 1),
            self.zero_mask,
            self.neg_inf,
        ).expand(2, -1, -1, -1)
        tok_emb = self.t3.speech_emb(self.token) + self.t3.speech_pos_emb.emb(self.speech_step)
        inp_emb = tok_emb.expand(2, -1, -1)
        pos_ids = self.cache_position.view(1, 1).expand(2, 1)
        out = self.t3.tfmr(
            inputs_embeds=inp_emb,
            past_key_values=self.cache,
            cache_position=self.cache_position,
            position_ids=pos_ids,
            attention_mask=mask,
            use_cache=True,
            output_hidden_states=False,
            output_attentions=False,
            return_dict=True,
        )
        logits_step = self.t3.speech_head(out.last_hidden_state)[:, -1, :]
        cond = logits_step[0:1, :]
        uncond = logits_step[1:2, :]
        self.cfg_logits = cond + self.cfg_tensor * (cond - uncond)

        processed = gpu_apply_sampling_processors(
            self.cfg_logits,
            self.history,
            penalty=self.repetition_penalty,
            temperature=self.temperature,
            min_p=self.min_p,
            top_p=self.top_p,
        )
        probs = torch.softmax(processed.float(), dim=-1)
        self.sample = torch.multinomial(probs, num_samples=1)
        self.history.index_copy_(1, self.history_pos, self.sample)
        self.token.copy_(self.sample)
        self.history_pos.add_(1)
        self.cache_position.add_(1)
        self.speech_step.add_(1)

    @torch.inference_mode()
    def qualify(self):
        """Compare CUDA Graph replay CFG logits against native dynamic-cache Llama forward."""
        torch.manual_seed(42)
        prefix = torch.randn((2, 8, self.t3.dim), dtype=self.dtype, device=self.device) * 0.1
        next_tok = torch.tensor([[42]], dtype=torch.long, device=self.device)

        ref_out0 = self.t3.tfmr(inputs_embeds=prefix, use_cache=True, return_dict=True)
        next_emb = (
            self.t3.speech_emb(next_tok) + self.t3.speech_pos_emb.get_fixed_embedding(1)
        ).expand(2, -1, -1)
        ref_out1 = self.t3.tfmr(
            inputs_embeds=next_emb,
            past_key_values=ref_out0.past_key_values,
            use_cache=True,
            return_dict=True,
        )
        ref_logits = self.t3.speech_head(ref_out1.last_hidden_state)[:, -1, :]
        expected = ref_logits[0:1] + self.cfg_tensor * (ref_logits[0:1] - ref_logits[1:2])

        self.cache.reset()
        pos = torch.arange(8, device=self.device)
        mask = torch.where(self.slots <= pos.view(1, 1, -1, 1), self.zero_mask, self.neg_inf).expand(2, -1, -1, -1)
        self.t3.tfmr(
            inputs_embeds=prefix,
            past_key_values=self.cache,
            cache_position=pos,
            position_ids=pos.unsqueeze(0).expand(2, -1),
            attention_mask=mask,
            use_cache=True,
            return_dict=True,
        )
        self.token.copy_(next_tok)
        self.cache_position.fill_(8)
        self.speech_step.fill_(1)
        self.history.fill_(self.bos_id)
        self.history_pos.fill_(1)
        self.graph.replay()
        torch.cuda.synchronize()
        torch.testing.assert_close(self.cfg_logits.float(), expected.float(), atol=5e-2, rtol=5e-2)
        return float((self.cfg_logits.float() - expected.float()).abs().max().item())

    @torch.inference_mode()
    def get_cond_emb(self, t3_cond):
        """Cache Perceiver & speaker conditioning embeddings across requests."""
        prompt_ptr = (
            t3_cond.cond_prompt_speech_tokens.data_ptr()
            if t3_cond.cond_prompt_speech_tokens is not None
            else 0
        )
        emo = (
            float(t3_cond.emotion_adv.view(-1)[0].item())
            if torch.is_tensor(t3_cond.emotion_adv)
            else float(t3_cond.emotion_adv)
        )
        key = (t3_cond.speaker_emb.data_ptr(), prompt_ptr, emo)
        cached = self._cond_cache.get(key)
        if cached is not None:
            return cached
        cond_emb = self.t3.prepare_conditioning(t3_cond).detach()
        if cond_emb.size(0) == 1:
            cond_emb = cond_emb.expand(2, -1, -1).contiguous()
        if len(self._cond_cache) >= 8:
            self._cond_cache.clear()
        self._cond_cache[key] = cond_emb
        return cond_emb

    def _supports_params(self, cfg_weight, temperature, repetition_penalty, min_p, top_p, limit):
        return (
            cfg_weight == self.cfg_weight
            and temperature == self.temperature
            and repetition_penalty == self.repetition_penalty
            and min_p == self.min_p
            and top_p == self.top_p
            and limit <= self.max_tokens
        )

    def _prefill_and_first_token(self, t3_cond, text_tokens, limit):
        t3 = self.t3
        text_tokens = torch.atleast_2d(text_tokens).to(dtype=torch.long, device=self.device)
        if text_tokens.size(0) == 1:
            text_tokens = text_tokens.expand(2, -1)
        cond_emb = self.get_cond_emb(t3_cond)

        text_emb = t3.text_emb(text_tokens)
        text_emb[1].zero_()
        text_emb = text_emb + t3.text_pos_emb(text_tokens)

        inputs_embeds = torch.cat([cond_emb, text_emb, self._bos_pair], dim=1)
        seq_len = int(inputs_embeds.shape[1])
        if seq_len + limit + 1 > self.capacity:
            return None

        self.cache.reset()
        pos = torch.arange(seq_len, device=self.device)
        mask = torch.where(self.slots <= pos.view(1, 1, -1, 1), self.zero_mask, self.neg_inf).expand(2, -1, -1, -1)
        out = t3.tfmr(
            inputs_embeds=inputs_embeds,
            past_key_values=self.cache,
            cache_position=pos,
            position_ids=pos.unsqueeze(0).expand(2, -1),
            attention_mask=mask,
            use_cache=True,
            output_hidden_states=False,
            output_attentions=False,
            return_dict=True,
        )

        logits_step = t3.speech_head(out.last_hidden_state[:, -1:, :])[:, -1, :]
        cfg_logits = logits_step[0:1] + self.cfg_tensor * (logits_step[0:1] - logits_step[1:2])

        self.history.fill_(self.bos_id)
        processed = gpu_apply_sampling_processors(
            cfg_logits,
            self.history[:, :1],
            penalty=self.repetition_penalty,
            temperature=self.temperature,
            min_p=self.min_p,
            top_p=self.top_p,
        )
        first_tok = torch.multinomial(torch.softmax(processed.float(), dim=-1), num_samples=1)

        self.history.index_copy_(1, self.one_pos, first_tok)
        self.history_pos.fill_(2)
        self.token.copy_(first_tok)
        self.cache_position.fill_(seq_len)
        self.speech_step.fill_(1)
        return first_tok

    @torch.inference_mode()
    def generate(
        self,
        *,
        t3_cond,
        text_tokens,
        max_new_tokens=None,
        cfg_weight=0.5,
        temperature=0.8,
        repetition_penalty=1.2,
        min_p=0.05,
        top_p=1.0,
        cancelled=None,
        **_ignored,
    ):
        """Full-sentence speech token generation using StaticCache + CUDA Graph."""
        cancel_event = cancelled if cancelled is not None else self.cancelled()
        limit = self.max_tokens if max_new_tokens is None else int(max_new_tokens)
        if not self._supports_params(cfg_weight, temperature, repetition_penalty, min_p, top_p, limit):
            return self.native(
                t3_cond=t3_cond,
                text_tokens=text_tokens,
                max_new_tokens=limit,
                cfg_weight=cfg_weight,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                min_p=min_p,
                top_p=top_p,
            )

        check_cancelled(cancel_event)
        first_tok = self._prefill_and_first_token(t3_cond, text_tokens, limit)
        if first_tok is None:
            return self.native(
                t3_cond=t3_cond,
                text_tokens=text_tokens,
                max_new_tokens=limit,
                cfg_weight=cfg_weight,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                min_p=min_p,
                top_p=top_p,
            )

        if int(first_tok.item()) == self.eos_id:
            return first_tok

        for step in range(1, limit):
            check_cancelled(cancel_event)
            self.graph.replay()
            if int(self.sample.item()) == self.eos_id:
                return self.history[:, 1 : 1 + step + 1].clone()
        raise SpeechGenerationLimit()

    @torch.inference_mode()
    def generate_stream(
        self,
        *,
        t3_cond,
        text_tokens,
        first_chunk_tokens=28,
        second_chunk_tokens=56,
        stride_tokens=80,
        lookahead_tokens=6,
        max_new_tokens=None,
        cfg_weight=0.5,
        temperature=0.8,
        repetition_penalty=1.2,
        min_p=0.05,
        top_p=1.0,
        cancelled=None,
    ):
        """True token-level streaming generator yielding progressive valid speech token slices.

        Yields tuples: (valid_tokens_list, emit_start, emit_end, is_first, is_last, chunk_t3_ms)
        keeping the exact same StaticCache KV state across chunks so prosody and attention
        remain continuous across the entire sentence.
        """
        cancel_event = cancelled if cancelled is not None else self.cancelled()
        limit = self.max_tokens if max_new_tokens is None else int(max_new_tokens)

        check_cancelled(cancel_event)
        t_chunk0 = time.perf_counter()

        if not self._supports_params(cfg_weight, temperature, repetition_penalty, min_p, top_p, limit):
            tokens = self.native(
                t3_cond=t3_cond,
                text_tokens=text_tokens,
                max_new_tokens=limit,
                cfg_weight=cfg_weight,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                min_p=min_p,
                top_p=top_p,
            )
            if tokens.shape[-1] >= limit:
                raise SpeechGenerationLimit()
            valid = [int(v) for v in tokens[0].tolist() if 0 <= int(v) < SPEECH_VOCAB_SIZE]
            if valid:
                yield valid, 0, len(valid), True, True, (time.perf_counter() - t_chunk0) * 1000
            return

        first_tok = self._prefill_and_first_token(t3_cond, text_tokens, limit)
        if first_tok is None:
            tokens = self.native(
                t3_cond=t3_cond,
                text_tokens=text_tokens,
                max_new_tokens=limit,
                cfg_weight=cfg_weight,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                min_p=min_p,
                top_p=top_p,
            )
            if tokens.shape[-1] >= limit:
                raise SpeechGenerationLimit()
            valid = [int(v) for v in tokens[0].tolist() if 0 <= int(v) < SPEECH_VOCAB_SIZE]
            if valid:
                yield valid, 0, len(valid), True, True, (time.perf_counter() - t_chunk0) * 1000
            return

        valid_tokens = []
        tok_val = int(first_tok.item())
        if tok_val == self.eos_id:
            return
        if 0 <= tok_val < SPEECH_VOCAB_SIZE:
            valid_tokens.append(tok_val)

        emitted = 0
        chunk_idx = 0

        def current_target():
            if chunk_idx == 0:
                return first_chunk_tokens
            if chunk_idx == 1:
                return second_chunk_tokens
            return stride_tokens

        hit_eos = False
        for _ in range(1, limit):
            check_cancelled(cancel_event)
            self.graph.replay()
            tok_val = int(self.sample.item())
            if tok_val == self.eos_id:
                hit_eos = True
                break
            if 0 <= tok_val < SPEECH_VOCAB_SIZE:
                valid_tokens.append(tok_val)
                target = current_target()
                if len(valid_tokens) >= emitted + target + lookahead_tokens:
                    emit_end = emitted + target
                    chunk_ms = (time.perf_counter() - t_chunk0) * 1000
                    yield list(valid_tokens), emitted, emit_end, (chunk_idx == 0), False, chunk_ms
                    emitted = emit_end
                    chunk_idx += 1
                    t_chunk0 = time.perf_counter()

        if not hit_eos and chunk_idx == 0:
            raise SpeechGenerationLimit()

        if valid_tokens and emitted < len(valid_tokens):
            chunk_ms = (time.perf_counter() - t_chunk0) * 1000
            yield list(valid_tokens), emitted, len(valid_tokens), (chunk_idx == 0), True, chunk_ms
