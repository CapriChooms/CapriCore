"""Local speech measurements without a microphone, playback or dialog history."""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def asr(args):
    import os
    from faster_whisper.audio import decode_audio
    from integrations.asr_runtime.model import WhisperRecognizer, settings

    os.environ['CAPRI_ASR_LANGUAGE'] = 'auto'
    started = time.perf_counter()
    recognizer = WhisperRecognizer(settings())
    pcm = decode_audio(str(Path(args.audio).resolve()), sampling_rate=16000)
    if not 0 < len(pcm) <= 16000 * 60:
        raise ValueError('Use a recording between 0 and 60 seconds')
    print(json.dumps(dict(loadSeconds=round(time.perf_counter() - started, 3))))
    baseline = None
    for label, recognize in [('native', recognizer._recognize_utterance),
                             ('shared-encoder', recognizer.recognize)]:
        started = time.perf_counter()
        result = recognize(pcm)
        if baseline is None:
            baseline = result
        print(json.dumps(dict(mode=label, seconds=round(time.perf_counter() - started, 3),
                              audioSeconds=len(pcm) / 16000, language=result['language'],
                              sameTranscriptAndTimestamps=result == baseline)))


def voice(args):
    config = json.loads((ROOT / 'config/companion-voice.json').read_text(encoding='utf-8'))
    token = (ROOT / 'data/speech/companion-voice-token').read_text(encoding='utf-8').strip()
    base = f"http://127.0.0.1:{config['port']}"
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    with urllib.request.urlopen(urllib.request.Request(base + '/health', headers=headers), timeout=5) as response:
        health = json.load(response)
    print(json.dumps({key: health.get(key) for key in
                      ['decoderDevice', 'decoderReason', 'cpuThreads', 'cudaGraph', 'gpuAllocatedMiB']}))
    for index in range(args.repeat):
        body = dict(text='How about we brew some coffee, listen to some music, and just chat?',
                    language='en', requestId=f'benchmark-{time.time_ns()}-{index}')
        request = urllib.request.Request(base + '/synthesize', headers=headers, data=json.dumps(body).encode())
        started = time.perf_counter()
        with urllib.request.urlopen(request, timeout=120) as response:
            pcm = response.read()
            print(json.dumps(dict(seconds=round(time.perf_counter() - started, 3),
                                  audioSeconds=len(pcm) / 4 / int(response.headers['X-Sample-Rate']),
                                  tokenMs=float(response.headers['X-T3-Ms']),
                                  decoderMs=float(response.headers['X-Decoder-Ms']))))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('asr', help='Use the ASR Python environment; compare automatic Whisper on one recording.').add_argument('--audio', required=True)
    speech = commands.add_parser('voice', help='Measure the running authenticated voice service; audio is discarded.')
    speech.add_argument('--repeat', type=int, choices=range(1, 6), default=2)
    args = parser.parse_args()
    (asr if args.command == 'asr' else voice)(args)


if __name__ == '__main__':
    main()
