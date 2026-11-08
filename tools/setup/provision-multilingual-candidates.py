"""Explicit, pinned evaluation models, isolated from the live English engines."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import argparse
import hashlib
import json
import shutil
from pathlib import Path

from integrations.model_download import download_verified

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--component',choices=['tts','asr','all'],default='all')
args=parser.parse_args()
manifest=json.loads((ROOT/'config/multilingual-candidates.json').read_text(encoding='utf-8'))
for component in ('tts','asr'):
    if args.component not in (component,'all'):
        continue
    spec=manifest[component]
    folder=(ROOT/spec['directory']).resolve()
    if not folder.is_relative_to(ROOT/'data/speech/candidates'):
        raise ValueError('Candidate models must stay in their own directory')
    folder.mkdir(parents=True,exist_ok=True)
    for item in spec['files']:
        target=(folder/item['file']).resolve()
        if target.parent!=folder:
            raise ValueError('Invalid candidate filename')
        def valid():
            if not target.is_file() or target.stat().st_size!=item['bytes']:
                return False
            with target.open('rb') as source:
                return hashlib.file_digest(source,'sha256').hexdigest()==item['sha256']
        if valid():
            print('Verified '+component+'/'+item['file'],flush=True)
            continue
        if shutil.disk_usage(folder).free<item['bytes']+1024**3:
            raise ValueError('Not enough free disk space for the candidate model')
        url=f"https://huggingface.co/{spec['model']}/resolve/{spec['revision']}/{item['file']}"
        download_verified(url,target,item)
    (folder/'ATTRIBUTION.txt').write_text(f'{spec["model"]}\nSource: {spec["source"]}\nRevision: {spec["revision"]}\nLicense: {spec["license"]}\nEvaluation only; not the selected Capri voice.\n',encoding='utf-8')
print('Requested evaluation models verified. Live voice and ASR are unchanged.',flush=True)
