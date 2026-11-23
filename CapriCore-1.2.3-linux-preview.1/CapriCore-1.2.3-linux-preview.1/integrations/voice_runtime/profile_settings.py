"""Private voice selections are narrow overrides, never edited release defaults."""
import json
import re
import stat
from pathlib import Path

UUID = r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
DEFINITIONS = {
    'voice-training': ('datasetDir', rf'data/voices/capri/en/imports/{UUID}'),
    'companion-voice': ('profileDir', rf'data/voices/capri/en/(?:imports/{UUID}/)?exports/capri-trained-{UUID}'),
}


def no_links(file):
    for entry in [file, *file.parents]:
        if not entry.exists() and not entry.is_symlink():
            continue
        info=entry.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0) & 0x400:
            raise ValueError('Local voice settings cannot follow filesystem links')


def merge_local_settings(root, kind, value):
    field, allowed=DEFINITIONS[kind]
    file=root / 'config' / (kind+'.local.json')
    no_links(file)
    if not file.exists():
        return value
    if file.stat().st_size>65536:
        raise ValueError('Local voice settings exceed their size limit')
    local=json.loads(file.read_text(encoding='utf-8-sig'))
    if (not isinstance(local,dict) or local.get('schemaVersion')!=1
            or set(local)!={'schemaVersion',field} or not isinstance(local[field],str)
            or not re.fullmatch(allowed,local[field])):
        raise ValueError('Invalid local voice selection')
    no_links(root / local[field])
    merged={**value,field:local[field]}
    if kind=='voice-training':
        merged['allowProvisionalTranscripts']=False
    return merged
