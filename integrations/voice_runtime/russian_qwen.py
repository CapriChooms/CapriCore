"""Russian stress and the fixed Capri decoder adapter for the Qwen test voice."""
import re

import torch

from .qwen_provision import specification, verify_files


def load_assets(root):
    spec = specification(root, russian=True)
    model = verify_files(root, spec)
    accent = verify_files(root, spec['accent'])
    pack = verify_files(root, spec['pack'])
    base_sha = next(item['sha256'] for item in spec['files'] if item['file'] == 'model.safetensors')
    return model, accent, pack, base_sha


def load_accentuator(folder):
    from ruaccent import RUAccent

    accentuator = RUAccent()
    # This preset uses local ONNX assets and does not use the Python rule engine.
    accentuator.koziev_paths = []
    accentuator.load(omograph_model_size='turbo3.1', tiny_mode=True, workdir=str(folder))
    return accentuator


def mark_stress(accentuator, text):
    if '\u0301' in text:
        return text
    tagged = accentuator.process_all(text)
    return re.sub(r'\+([аеёиоуыэюя])', r'\1' + '\u0301', tagged, flags=re.IGNORECASE) or text


@torch.no_grad()
def load_prompt(engine, pack, base_sha):
    from qwen_tts import VoiceClonePromptItem
    from safetensors import safe_open

    decoder = engine.model.speech_tokenizer.model.decoder
    with safe_open(str(pack / 'capri-ru-decoder-lora.safetensors'), framework='pt') as adapter:
        metadata = adapter.metadata()
        if metadata.get('baseSha256') != base_sha or metadata.get('rank') != '8' or metadata.get('alpha') != '8':
            raise ValueError('Capri Russian LoRA does not match the verified Qwen model')
        for index, block in enumerate(decoder.upsample):
            for projection in ('pwconv1', 'pwconv2'):
                key = f'upsample.{index}.1.{projection}'
                weight = getattr(block[1], projection).weight
                a, b = (adapter.get_tensor(f'{key}.{part}') for part in ('a', 'b'))
                weight.add_((b @ a).to(weight))
    with safe_open(str(pack / 'capri-ru-prompt.safetensors'), framework='pt') as reference:
        metadata = reference.metadata()
        if metadata.get('baseSha256') != base_sha:
            raise ValueError('Capri Russian reference does not match the verified Qwen model')
        return [VoiceClonePromptItem(
            ref_code=reference.get_tensor('reference_codec'),
            ref_spk_embedding=reference.get_tensor('speaker_embedding'),
            x_vector_only_mode=False, icl_mode=True, ref_text=metadata['referenceText'],
        )]
