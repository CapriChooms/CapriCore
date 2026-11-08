"""Pinned Turbo CPU loading without an initialized duplicate of its 1.9 GB T3.

Architecture/configuration follows Resemble AI Chatterbox tts_turbo.py (MIT),
revision recorded in voice-upstream.json. Weights, precision and inference stay native.
No global monkey patches, quantization, downloads or precision fallback.
"""
from pathlib import Path
import torch


def load_turbo_cpu(folder):
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
    # Decoder construction remains native: its persistent/nonpersistent buffers
    # must retain their normal initialization. Drop checkpoint references early.
    s3gen = native.S3Gen(meanflow=True)
    s3gen.load_state_dict(native.load_file(folder / 's3gen_meanflow.safetensors'), strict=True)
    s3gen.eval()
    tokenizer = native.AutoTokenizer.from_pretrained(folder, local_files_only=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    if len(tokenizer) != 50276:
        raise ValueError('The native Turbo tokenizer must not be replaced.')
    conds = native.Conditionals.load(folder / 'conds.pt', map_location='cpu').to('cpu') if (folder / 'conds.pt').exists() else None
    return native.ChatterboxTurboTTS(t3, s3gen, ve, tokenizer, 'cpu', conds=conds, model_label='Turbo')
