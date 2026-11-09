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


def load_decoder_cpu(native, folder):
    """Avoid initializing/copying a second 1 GB decoder. Unknown layouts stay native."""
    state = native.load_file(Path(folder)/'s3gen_meanflow.safetensors')
    decoder = None
    try:
        with torch.device('meta'):
            decoder = native.S3Gen(meanflow=True)
        _restore_decoder_caches(decoder)
        decoder.load_state_dict(state, strict=True, assign=True)
        if any(value.is_meta for value in list(decoder.parameters())+list(decoder.buffers())):
            raise ValueError('Unmaterialized acoustic state')
        for module in decoder.modules():
            if any(torch.is_tensor(value) and value.is_meta for value in vars(module).values()):
                raise ValueError('Unknown acoustic tensor cache')
    except (RuntimeError, ValueError, TypeError, NotImplementedError, AttributeError):
        decoder = native.S3Gen(meanflow=True)
        decoder.load_state_dict(state, strict=True)
    decoder.eval()
    return decoder


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
