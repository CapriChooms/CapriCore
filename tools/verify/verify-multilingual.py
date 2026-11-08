"""Real local multilingual smoke test. Uses synthetic phrases, never a microphone."""

import sys as _capri_sys
from pathlib import Path as _CapriPath
_capri_sys.path.insert(0, str(_CapriPath(__file__).resolve().parents[2]))
import json,os,sys,time,urllib.request,uuid
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from integrations.asr_runtime.model import Recognizer,WhisperRecognizer,settings
report=dict(passed=False,physicalMicrophone=False,ownerHistoryChanged=False,samples=[])
token=(ROOT/'data/speech/companion-voice-token').read_text(encoding='utf-8').strip()
folder=ROOT/'.runtime/multilingual-verification';folder.mkdir(parents=True,exist_ok=True)
def call(route,body=None,timeout=180):
 req=urllib.request.Request('http://127.0.0.1:8101/'+route,data=json.dumps(body).encode() if body else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=timeout) as response:return response.read(24000*4*45+1),response.headers
whisper=None
cases=[('ru','Привет. Я здесь и готова поговорить.'),('ja','こんにちは。今日は何を話そうか？'),('zh','你好。我在这里，今天想聊些什么？'),('en','Hey choom, I am right here. How does this sound?')]
try:
 for language,text in cases:
  started=time.perf_counter();data,headers=call('synthesize',dict(language=language,text=text,requestId=str(uuid.uuid4())))
  elapsed=time.perf_counter()-started;pcm=np.frombuffer(data,dtype='<f4');assert len(pcm)>2400 and len(pcm)<=24000*45 and np.isfinite(pcm).all()
  (folder/(language+'.f32')).write_bytes(data)
  audio=np.interp(np.arange(int(len(pcm)*16000/24000))*24000/16000,np.arange(len(pcm)),pcm).astype(np.float32)
  os.environ['CAPRI_ASR_LANGUAGE']=language;config=settings();start=time.perf_counter()
  if config['engine']=='whisper-large-v3-turbo':
   if whisper is None:whisper=WhisperRecognizer(config)
   whisper.language=language;recognizer=whisper
  else:recognizer=Recognizer(config)
  load=time.perf_counter()-start;start=time.perf_counter();result=recognizer.recognize(audio,addressed=True)
  item=dict(language=language,text=text,transcript=result['text'],audioSeconds=round(len(pcm)/24000,3),synthesisSeconds=round(elapsed,3),tokenMs=headers.get('X-T3-Ms'),decoderMs=headers.get('X-Decoder-Ms'),recognitionSeconds=round(time.perf_counter()-start,3),recognizer=config['engine'],asrLoadSeconds=round(load,3),health=json.loads(call('health')[0]))
  assert result['text'].strip();report['samples'].append(item);print(json.dumps(item,ensure_ascii=True),flush=True)
  (ROOT/'logs/multilingual-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 report['passed']=True
finally:
 call('prepare',dict(language='en',requestId=str(uuid.uuid4())))
 report['restoredEnglish']=json.loads(call('health')[0])['language']=='en'
 (ROOT/'logs/multilingual-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('Multilingual smoke test passed.',flush=True)
