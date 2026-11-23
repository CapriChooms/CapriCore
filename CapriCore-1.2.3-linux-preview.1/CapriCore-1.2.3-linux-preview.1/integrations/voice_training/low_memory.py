"""Pinned Turbo CPU loading without an initialized duplicate of its 1.9 GB T3.

Architecture/configuration follows Resemble AI Chatterbox tts_turbo.py (MIT),
revision recorded in voice-upstream.json. Weights, precision and inference stay native.
No global monkey patches, quantization, downloads or precision fallback.
"""
from pathlib import Path
import torch


def _restore_decoder_caches(decoder):
    """Rebuild only the pinned, non-checkpoint constants using native FP32 math."""
    from chatterbox.models.s3gen import S3Gen, S3GEN_SR
    from chatterbox.models.s3gen.transformer.embedding import EspnetRelPositionalEncoding
    from s3tokenizer.model_v2 import AudioEncoderV2, precompute_freqs_cis
    if type(decoder) is not S3Gen or S3GEN_SR != 24000:
        raise ValueError('Unknown acoustic decoder layout')
    encoder = decoder.tokenizer.encoder
    if type(encoder) is not AudioEncoderV2 or tuple(encoder.freqs_cis.shape) != (2048, 64):
        raise ValueError('Unknown tokenizer position cache')
    with torch.device('cpu'):
        encoder.freqs_cis = precompute_freqs_cis(64, 2048)
        for embedding in (decoder.flow.encoder.embed, decoder.flow.encoder.up_embed):
            position = embedding.pos_enc
            if (type(position) is not EspnetRelPositionalEncoding
                    or position.d_model != 512 or tuple(position.pe.shape) != (1, 9999, 512)):
                raise ValueError('Unknown acoustic position cache')
            position.pe = EspnetRelPositionalEncoding(512, position.dropout.p, max_len=5000).pe
        n_trim = S3GEN_SR // 50
        if tuple(decoder.trim_fade.shape) != (2*n_trim,):
            raise ValueError('Unknown acoustic fade buffer')
        fade = torch.zeros(2*n_trim)
        fade[n_trim:] = (torch.cos(torch.linspace(torch.pi, 0, n_trim)) + 1)/2
        decoder.trim_fade = fade


def _materialize(module, state):
    module.load_state_dict(state, strict=True, assign=True)
    if any(value.is_meta for value in list(module.parameters()) + list(module.buffers())):
        raise ValueError('Unmaterialized model state')
    for child in module.modules():
        if any(torch.is_tensor(value) and value.is_meta for value in vars(child).values()):
            raise ValueError('Unknown model tensor cache')
    return module.eval()


def _empty_decoder(native, state, *, meanflow):
    with torch.device('meta'):
        decoder = native.S3Gen(meanflow=meanflow)
    _restore_decoder_caches(decoder)
    filter_key, window_key = 'tokenizer._mel_filters', 'tokenizer.window'
    if not meanflow and filter_key not in state and window_key not in state:
        # Some multilingual checkpoints omit the tokenizer's deterministic
        # input buffers. Rebuild them using the pinned tokenizer defaults.
        import librosa
        from chatterbox.models.s3tokenizer.s3tokenizer import S3_SR

        tokenizer = decoder.tokenizer
        mel_count = tokenizer._mel_filters.shape[0]
        state[filter_key] = torch.from_numpy(
            librosa.filters.mel(sr=S3_SR, n_fft=tokenizer.n_fft, n_mels=mel_count))
        state[window_key] = torch.hann_window(tokenizer.n_fft, device='cpu')
    return _materialize(decoder, state)


def load_decoder_cpu(native, folder):
    """Avoid initializing/copying a second 1 GB decoder. Unknown layouts stay native."""
    state = native.load_file(Path(folder)/'s3gen_meanflow.safetensors')
    try:
        return _empty_decoder(native, state, meanflow=True)
    except (RuntimeError, ValueError, TypeError, NotImplementedError, AttributeError):
        decoder = native.S3Gen(meanflow=True)
        decoder.load_state_dict(state, strict=True)
    return decoder.eval()


def _empty_multilingual_t3(native, folder, *, cpu_inference):
    from safetensors import safe_open
    from transformers.models.llama.modeling_llama import LlamaRotaryEmbedding

    with torch.device('meta'):
        t3 = native.T3(native.T3Config.multilingual())
    rotary = t3.tfmr.rotary_emb
    if type(rotary) is not LlamaRotaryEmbedding:
        raise ValueError('Unknown multilingual rotary embedding')
    t3.tfmr.rotary_emb = LlamaRotaryEmbedding(rotary.config, device=torch.device('cpu'))
    with safe_open(folder / 't3_mtl23ls_v3.safetensors', framework='pt', device='cpu') as file:
        state = {}
        for key in file.keys():
            tensor = file.get_tensor(key)
            # CPU inference uses native aligned storage for repeated GEMMs.
            # GPU inference can move the mapped weights directly once.
            state[key] = tensor.clone() if cpu_inference else tensor
    return _materialize(t3, state)


def load_multilingual_cpu(folder, *, cpu_inference):
    """Use the verified V3 weights directly, reserving private storage for inference."""
    from chatterbox import mtl_tts as native

    folder = Path(folder)
    try:
        t3 = _empty_multilingual_t3(native, folder, cpu_inference=cpu_inference)
        decoder = _empty_decoder(native, torch.load(folder / 's3gen.pt', map_location='cpu',
                                                   weights_only=True, mmap=not cpu_inference),
                                 meanflow=False)
    except (RuntimeError, ValueError, TypeError, NotImplementedError, AttributeError):
        # Leave the optimized loader frame before constructing native models.
        t3 = None
    if t3 is None:
        return native.ChatterboxMultilingualTTS.from_local(folder, device='cpu', t3_model='v3')

    voice_encoder = native.VoiceEncoder()
    voice_encoder.load_state_dict(torch.load(folder / 've.pt', map_location='cpu', weights_only=True))
    tokenizer = native.MTLTokenizer(str(folder / 'grapheme_mtl_merged_expanded_v1.json'))
    # Capri always supplies and verifies its own reference before inference.
    return native.ChatterboxMultilingualTTS(t3, decoder, voice_encoder.eval(), tokenizer, 'cpu')


def load_turbo_cpu(folder, *, native=None):
    if native is None:
        from chatterbox import tts_turbo as native
    folder = Path(folder)
    ve = native.VoiceEncoder()
    ve.load_state_dict(native.load_file(folder / 've.safetensors'))
    ve.eval()
    hp = native.T3Config(text_tokens_dict_size=50276)
    hp.llama_config_name = 'GPT2_medium'
    hp.speech_tokens_dict_size = 6563
    hp.input_pos_emb = None
    hp.speech_cond_prompt_len = 375
    hp.use_perceiver_resampler = False
    hp.emotion_adv = False
    # The pinned T3 has no nonpersistent buffers. Strict assignment materializes
    # every parameter from the original safetensors instead of allocating twice.
    with torch.device('meta'):
        t3 = native.T3(hp)
    state = native.load_file(folder / 't3_turbo_v1.safetensors')
    if 'model' in state:
        state = state['model'][0]
    t3.load_state_dict(state, strict=True, assign=True)
    del state
    del t3.tfmr.wte
    if any(t.is_meta for t in list(t3.parameters()) + list(t3.buffers())):
        raise RuntimeError('The pinned Turbo layout changed: unmaterialized tensors remain.')
    t3.eval()
    s3gen = load_decoder_cpu(native, folder)
    tokenizer = native.AutoTokenizer.from_pretrained(folder, local_files_only=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    if len(tokenizer) != 50276:
        raise ValueError('The native Turbo tokenizer must not be replaced.')
    conds = native.Conditionals.load(folder / 'conds.pt', map_location='cpu').to('cpu') if (folder / 'conds.pt').exists() else None
    return native.ChatterboxTurboTTS(t3, s3gen, ve, tokenizer, 'cpu', conds=conds, model_label='Turbo')
