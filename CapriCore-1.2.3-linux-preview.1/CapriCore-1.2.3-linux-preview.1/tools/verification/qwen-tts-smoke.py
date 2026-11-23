"""Manual local-only verification of the pinned CPU speech adapter."""
import json
import argparse
import sys
import threading
import time
from pathlib import Path
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from integrations.voice_runtime.model import settings
from integrations.voice_runtime.qwen import QwenVoice
from integrations.voice_runtime.inference import VoiceCancelled


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--all-languages', action='store_true')
    args = parser.parse_args()
    config = settings()
    config['maxSpeechTokens'] = 120
    began = time.monotonic()
    voice = QwenVoice(config)
    output = ROOT / '.runtime/qwen-smoke'
    output.mkdir(parents=True, exist_ok=True)
    result = {'loadSeconds': round(time.monotonic()-began, 2), 'samples': []}
    phrases = [('en', 'Hey choom. I am here with you.'), ('ru', 'Привет. Я рядом с тобой.')]
    if args.all_languages:
        phrases += [('zh', '你好，我在这里。'), ('ja', 'こんにちは。'), ('ko', '안녕하세요.'),
                    ('de', 'Hallo. Ich bin hier.'), ('fr', 'Bonjour. Je suis ici.'),
                    ('pt', 'Olá. Estou aqui.'), ('es', 'Hola. Estoy aquí.'), ('it', 'Ciao. Sono qui.')]
    for language, text in phrases:
        began = time.monotonic()
        pcm, rate = voice.generate(text, None, language)
        wave = np.frombuffer(pcm, dtype='<f4')
        assert rate == 24000 and np.isfinite(wave).all() and np.max(np.abs(wave)) > .001
        assert .2 < len(wave) / rate <= 45
        sf.write(output / (language + '.wav'), wave, rate)
        result['samples'].append(dict(language=language, seconds=round(len(wave)/rate,2),
            synthesisSeconds=round(time.monotonic()-began,2)))
        print(json.dumps(result['samples'][-1]), flush=True)
    event = threading.Event()
    timer = threading.Timer(.2, event.set)
    timer.start()
    began = time.monotonic()
    try:
        voice.generate('This is a cancellation check that should not finish.', event, 'en')
        raise AssertionError('Cancellation did not interrupt synthesis')
    except VoiceCancelled:
        result['cancellationSeconds'] = round(time.monotonic()-began,2)
        assert result['cancellationSeconds'] < 5
    finally:
        timer.cancel()
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
