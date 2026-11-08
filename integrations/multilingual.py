"""Shared, offline model integrity and language capabilities."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = {item['id']: item for item in json.loads((ROOT / 'apps/shared/languages.json').read_text(encoding='utf-8'))}


class MissingSpeechModel(ValueError):
    """Safe diagnostic code: no recording, text, credentials or machine paths."""
    def __init__(self, component, filename, reason='missing'):
        self.component, self.filename, self.reason = component, filename, reason
        super().__init__(f'{component} model file {filename} is {reason}; run setup-multilingual.cmd')


def verified_model(component):
    spec = json.loads((ROOT / 'config/multilingual-runtime.json').read_text(encoding='utf-8'))[component]
    folder = (ROOT / spec['directory']).resolve()
    if not folder.is_relative_to(ROOT / 'data/speech'):
        raise ValueError('Model path is outside the speech directory')
    for item in spec['files']:
        path = (folder / item['file']).resolve()
        if path.parent != folder or not path.is_file() or path.stat().st_size != item['bytes']:
            raise MissingSpeechModel(component, item['file'])
        with path.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != item['sha256']:
                raise MissingSpeechModel(component, item['file'], 'corrupt')
    return folder
