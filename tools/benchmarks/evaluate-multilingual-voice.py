"""CPU-only candidate evaluation; never swaps the active trained English voice."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import os
os.environ['CUDA_VISIBLE_DEVICES']=''
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'

import hashlib
import html
import json
import time
import urllib.request
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import torch

ROOT=Path(__file__).resolve().parents[2]
os.environ['HF_HOME']=str(ROOT/'data/speech/hf-cache')
os.environ['TORCH_HOME']=str(ROOT/'data/speech/torch-cache')
os.environ['PKUSEG_HOME']=str(ROOT/'data/speech/candidates/auxiliary/pkuseg')
torch.set_num_threads(8)
torch.set_num_interop_threads(1)
manifest=json.loads((ROOT/'config/multilingual-candidates.json').read_text(encoding='utf-8'))['tts']
folder=ROOT/manifest['directory']
for item in manifest['files']:
    target=folder/item['file']
    with target.open('rb') as source:
        if target.stat().st_size!=item['bytes'] or hashlib.file_digest(source,'sha256').hexdigest()!=item['sha256']:
            raise ValueError('Candidate integrity check failed')
output=ROOT/'data/voices/capri/multilingual/evaluations'/time.strftime('%Y%m%d-%H%M%S')
output.mkdir(parents=True,exist_ok=False)
cases=json.loads((ROOT/'config/language-quality-cases.json').read_text(encoding='utf-8'))
report=dict(status='pending-quality-review',device='cpu',selectedEnglishVoiceChanged=False,
            candidateModel=manifest['model'],revision=manifest['revision'],candidateAdapter='none; zero-shot reference only',
            humanReview={name:'pending' for name in cases['requiredHumanReview']},samples=[])

def save():
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'logs/multilingual-voice-evaluation.json').write_text(json.dumps(dict(report,output=str(output)),ensure_ascii=False,indent=2),encoding='utf-8')

voice_config=json.loads((ROOT/'config/companion-voice.json').read_text(encoding='utf-8'))
profile_folder=ROOT/voice_config['profileDir']
profile=json.loads((profile_folder/'voice-profile.json').read_text(encoding='utf-8'))
reference=profile_folder/profile['references']['neutral']['file']
with reference.open('rb') as source:
    if hashlib.file_digest(source,'sha256').hexdigest()!=profile['references']['neutral']['sha256']:
        raise ValueError('Voice reference checksum changed')

# Current trained English baseline is rendered through the existing authenticated
# loopback service. No chat or conversation memory is involved.
text=cases['languages']['en'][0]['text']
token=(ROOT/'data/speech/companion-voice-token').read_text(encoding='utf-8').strip()
request=urllib.request.Request(f'http://127.0.0.1:{voice_config["port"]}/synthesize',
    data=json.dumps(dict(requestId=str(uuid.uuid4()),text=text)).encode(),
    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
started=time.perf_counter()
with urllib.request.urlopen(request,timeout=90) as response:
    data=response.read(24000*4*35+1)
    if len(data)%4 or len(data)>24000*4*35:
        raise ValueError('Baseline audio exceeds bounds')
pcm=np.frombuffer(data,dtype='<f4')
sf.write(output/'en-trained-baseline.wav',pcm,24000,subtype='PCM_16')
report['baseline']=dict(text=text,file='en-trained-baseline.wav',seconds=len(pcm)/24000,elapsedSeconds=round(time.perf_counter()-started,3))
save();print('Trained English baseline saved.',flush=True)

from chatterbox.models.tokenizers import tokenizer as native_tokenizer
class UnusedChineseConverter:
    """EN/RU evaluation must not initialize or download an unused Chinese segmenter."""
    def __init__(self,*args,**kwargs):pass
    def __call__(self,text):raise ValueError('This evaluation supports English and Russian only')
native_tokenizer.ChineseCangjieConverter=UnusedChineseConverter
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
started=time.perf_counter()
engine=ChatterboxMultilingualTTS.from_local(folder,device='cpu',t3_model='v2')
report['loadSeconds']=round(time.perf_counter()-started,3)
native=engine.t3.inference
token_counts=[]
def bounded(*args,**kwargs):
    kwargs['max_new_tokens']=min(kwargs.get('max_new_tokens',180),180)
    result=native(*args,**kwargs);token_counts.append(result.shape[-1]);return result
engine.t3.inference=bounded
print('Candidate loaded on CPU; generating English/Russian review samples.',flush=True)
for language in ('en','ru'):
    item=cases['languages'][language][0]
    torch.manual_seed(417);np.random.seed(417)
    started=time.perf_counter()
    audio=engine.generate(item['text'],language_id=language,audio_prompt_path=str(reference),exaggeration=.5,cfg_weight=.5).squeeze().numpy()
    elapsed=time.perf_counter()-started
    if audio.ndim!=1 or not np.isfinite(audio).all() or len(audio)>engine.sr*15:
        raise ValueError('Candidate audio is invalid or unbounded')
    name=f'{language}-multilingual-candidate.wav';sf.write(output/name,audio,engine.sr,subtype='PCM_16')
    asr_name=f'{language}-multilingual-candidate-16k.wav';sf.write(output/asr_name,soxr.resample(audio,engine.sr,16000,quality='HQ'),16000,subtype='PCM_16')
    report['samples'].append(dict(language=language,text=item['text'],file=name,seconds=round(len(audio)/engine.sr,3),
        elapsedSeconds=round(elapsed,3),realTimeFactor=round(elapsed/(len(audio)/engine.sr),3),
        peak=float(np.max(np.abs(audio))),reachedTokenCap=token_counts[-1]>=180,asrFile=asr_name))
    save();print(json.dumps(report['samples'][-1],ensure_ascii=True),flush=True)

cards=[]
for sample in [dict(language='en',**report['baseline']),*report['samples']]:
    cards.append(f'<section><h2>{html.escape(sample["file"])}</h2><p>{html.escape(sample["text"])}</p><audio controls src="{html.escape(sample["file"])}"></audio></section>')
(output/'listen.html').write_text('<!doctype html><meta charset="utf-8"><title>Capri language evaluation</title><style>body{background:#08141b;color:#d3f9f4;font:18px system-ui;max-width:900px;margin:40px auto}section{padding:20px;border:1px solid #5bd9d2;margin:20px 0}audio{width:100%}</style><h1>Language evaluation: not a selected voice</h1><p>English trained baseline versus a different zero-shot multilingual model. Quality review is pending. No production language has been enabled.</p>'+''.join(cards),encoding='utf-8')
save();print('Review ready: '+str(output/'listen.html'),flush=True)
