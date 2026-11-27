# SPDX-License-Identifier: GPL-3.0-only
"""Reproducible loopback benchmark for Chatterbox Multilingual V3 (/synthesize vs /synthesize-stream).

Measures time-to-first-audio (median and P95), real-time factor (RTF), simulated continuous
playback stalls on multi-sentence replies, and GPU memory reported by /health.
All prompts are synthetic; no audio or owner data is written to disk.
"""
import argparse
import json
import statistics
import struct
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SYNTHETIC_CASES = {
    'pt-BR': {
        'one_word': ['Oi.', 'Claro!', 'Entendi.', 'Beleza.', 'Pronto.'],
        'short': [
            'Oi, tudo bem por aí?',
            'Já estou pronta pra gente conversar.',
            'Deixa comigo, já resolvo isso agora.',
            'Pode mandar, estou te ouvindo direitinho.',
            'Boa ideia, vamos testar isso juntos!',
        ],
        'medium': [
            'A otimização de sistemas de voz exige medir cada etapa com cuidado.',
            'Quando a gente descobre onde o tempo realmente vai, fica muito mais fácil resolver o gargalo sem perder naturalidade.',
        ],
        'long': [
            'Olha, eu analisei tudo com bastante calma pra te dar uma resposta completa.',
            'Primeiro, quando o modelo de linguagem responde rápido, o gargalo quase sempre fica concentrado na geração dos tokens de fala e na decodificação acústica.',
            'Se cada frase demora mais pra ser sintetizada do que o tempo que ela leva pra tocar nos alto-falantes, o áudio acaba parando no meio e criando aqueles silêncios incômodos.',
            'Por outro lado, se a gente consegue reduzir a latência inicial pra menos de um segundo e manter o fator de tempo real bem abaixo de um, a conversa flui naturalmente.',
        ],
    },
    'en': {
        'one_word': ['Hi.', 'Sure!', 'Got it.', 'Ready.', 'Done.'],
        'short': [
            'Hey, how is it going today?',
            'I am ready whenever you want to chat.',
            'Leave it to me, I can check that right now.',
        ],
        'medium': [
            'Optimizing voice synthesis requires measuring every stage carefully.',
            'Once we find where time is actually spent, it becomes much easier to remove stalls without losing naturalness.',
        ],
        'long': [
            'Let me walk through the results carefully so everything is clear.',
            'When the language model replies quickly, most waiting time comes from autoregressive speech token generation and acoustic decoding.',
            'If each sentence takes longer to synthesize than to play back, long replies stall mid-speech.',
            'Keeping the real-time factor well below one and streaming progressive audio frames keeps playback smooth.',
        ],
    },
}


def percentile(values, p):
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    if lo == hi:
        return float(ordered[lo])
    return float(ordered[lo] * (hi - k) + ordered[hi] * (k - lo))


def summarize(values):
    return {
        'n': len(values),
        'median': round(statistics.median(values), 2) if values else 0.0,
        'p95': round(percentile(values, 95), 2) if values else 0.0,
        'mean': round(statistics.mean(values), 2) if values else 0.0,
    }


def synthesize(base_url, headers, text, language, stream=False):
    path = '/synthesize-stream' if stream else '/synthesize'
    payload = json.dumps(
        {'text': text, 'language': language, 'requestId': f'bench-{time.time_ns()}'},
    ).encode('utf-8')
    req = urllib.request.Request(base_url + path, data=payload, headers=headers, method='POST')
    started = time.perf_counter()
    first_ms = None
    chunks = []
    timeline = []
    with urllib.request.urlopen(req, timeout=120) as resp:
        sr = int(resp.headers.get('X-Sample-Rate', '24000'))
        framing = resp.headers.get('X-Stream-Framing', '')
        if stream and framing == 'length-prefixed-f32le':
            while True:
                hdr = b''
                while len(hdr) < 4:
                    part = resp.read(4 - len(hdr))
                    if not part:
                        break
                    hdr += part
                if len(hdr) < 4:
                    break
                frame_len = struct.unpack('<I', hdr)[0]
                if frame_len == 0:
                    break
                buf = bytearray()
                while len(buf) < frame_len:
                    part = resp.read(frame_len - len(buf))
                    if not part:
                        break
                    buf.extend(part)
                now_ms = (time.perf_counter() - started) * 1000
                if first_ms is None:
                    first_ms = now_ms
                timeline.append((now_ms, len(buf)))
                chunks.append(bytes(buf))
            pcm_bytes = sum(len(c) for c in chunks)
        else:
            raw = resp.read()
            first_ms = (time.perf_counter() - started) * 1000
            pcm_bytes = len(raw)
            timeline.append((first_ms, pcm_bytes))
    total_ms = (time.perf_counter() - started) * 1000
    audio_sec = (pcm_bytes / 4.0) / sr
    return {
        'firstAudioMs': round(first_ms or total_ms, 2),
        'totalMs': round(total_ms, 2),
        'audioSec': round(audio_sec, 3),
        'rtf': round((total_ms / 1000.0) / max(1e-6, audio_sec), 3),
        'chunks': len(timeline),
        'timeline': timeline,
    }


def simulate_turn(base_url, headers, sentences, language, stream=False):
    turn_start = time.perf_counter()
    first_audio_ms = None
    clock_end_ms = None
    stalls = []
    results = []
    for idx, sentence in enumerate(sentences):
        rel_start = (time.perf_counter() - turn_start) * 1000
        res = synthesize(base_url, headers, sentence, language, stream=stream)
        results.append(res)
        for rel_ms, nbytes in res['timeline']:
            arrival = rel_start + rel_ms
            dur_ms = (nbytes / 4.0 / 24000.0) * 1000.0
            if first_audio_ms is None:
                first_audio_ms = arrival
                clock_end_ms = arrival + dur_ms
            elif arrival > clock_end_ms + 5.0:
                stalls.append({'segment': idx, 'gapMs': round(arrival - clock_end_ms, 2)})
                clock_end_ms = arrival + dur_ms
            else:
                clock_end_ms += dur_ms
    total_synth = sum(r['totalMs'] for r in results)
    total_audio = sum(r['audioSec'] for r in results)
    return {
        'firstAudioMs': round(first_audio_ms or 0.0, 2),
        'totalAudioSec': round(total_audio, 3),
        'rtf': round((total_synth / 1000.0) / max(1e-6, total_audio), 3),
        'stallCount': len(stalls),
        'maxStallMs': round(max((s['gapMs'] for s in stalls), default=0.0), 2),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', default='pt-BR')
    parser.add_argument('--mode', choices=['stream', 'full', 'both'], default='both')
    parser.add_argument('--rounds', type=int, default=2)
    args = parser.parse_args()

    config = json.loads((ROOT / 'config/companion-voice.json').read_text(encoding='utf-8'))
    token = (ROOT / 'data/speech/companion-voice-token').read_text(encoding='utf-8').strip()
    base_url = f"http://127.0.0.1:{config['port']}"
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}

    with urllib.request.urlopen(urllib.request.Request(base_url + '/health', headers=headers), timeout=5) as resp:
        health = json.load(resp)

    cases = SYNTHETIC_CASES.get(args.language, SYNTHETIC_CASES['en'])
    modes = ['full', 'stream'] if args.mode == 'both' else [args.mode]
    report = {
        'language': args.language,
        'health': {
            k: health.get(k)
            for k in (
                'activeEngine',
                'decoderDevice',
                'precision',
                'cudaGraph',
                'cfmCudaGraph',
                'tokenStreaming',
                'gpuAllocatedMiB',
                'gpuReservedMiB',
            )
        },
        'results': {},
    }

    for mode in modes:
        use_stream = mode == 'stream' and bool(health.get('tokenStreaming'))
        one_word = [
            synthesize(base_url, headers, text, args.language, stream=use_stream)
            for _ in range(args.rounds)
            for text in cases['one_word']
        ]
        short = [
            synthesize(base_url, headers, text, args.language, stream=use_stream)
            for _ in range(args.rounds)
            for text in cases['short']
        ]
        report['results'][mode] = {
            'oneWordFirstAudioMs': summarize([r['firstAudioMs'] for r in one_word]),
            'oneWordRtf': summarize([r['rtf'] for r in one_word]),
            'shortFirstAudioMs': summarize([r['firstAudioMs'] for r in short]),
            'shortRtf': summarize([r['rtf'] for r in short]),
            'mediumParagraph': simulate_turn(base_url, headers, cases['medium'], args.language, stream=use_stream),
            'longResponse': simulate_turn(base_url, headers, cases['long'], args.language, stream=use_stream),
        }

    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
