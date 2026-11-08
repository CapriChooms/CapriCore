"""Validated local model selection shared with the desktop voice library."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def selected_voice(language, root=ROOT):
    catalog = json.loads((root / 'config/tts-catalog.json').read_text(encoding='utf-8'))
    file = root / 'data/speech/voice-selections.json'
    selected = 'chatterbox-turbo' if language == 'en' else 'chatterbox-multilingual-v3'
    if file.exists():
        if file.is_symlink() or file.stat().st_size > 65536:
            raise ValueError('Invalid voice selection file')
        for parent in file.parents:
            if parent.is_symlink():
                raise ValueError('Voice selections cannot follow filesystem links')
        saved = json.loads(file.read_text(encoding='utf-8'))
        if saved.get('schemaVersion') != 1 or not isinstance(saved.get('languages'), dict):
            raise ValueError('Invalid voice selections')
        selected = saved['languages'].get(language, selected)
    model = next((item for item in catalog['models'] if item['id'] == selected), None)
    if not model or language not in model['languages']:
        raise ValueError('Selected voice model does not support this language')
    return model
