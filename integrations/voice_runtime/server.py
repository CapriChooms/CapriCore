"""Authenticated loopback-only PCM service. No speech is written to disk.

Turbo finishes one bounded phrase at a time. Authenticated cancellation interrupts
between speech tokens or flow steps; a disconnect alone only discards the result.
Only one inference may run, on the same persistent CUDA worker used for warmup.
"""
import json
import os
import secrets
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

from integrations.voice_training.dataset import ROOT
from .model import settings
from .multilingual import VoicePool
from integrations.multilingual import LANGUAGES, MissingSpeechModel
from .inference import VoiceCancelled, check_cancelled
from .failure import inference_failure
from .catalog import selected_voice


def load_and_warm(config, language, cancelled=None):
    check_cancelled(cancelled)
    if config.get('validateTurbo') or selected_voice(language)['backend'] != 'qwen3-tts':
        from .compatibility import require_cuda
        require_cuda(torch)
    voice = VoicePool(config)
    greetings = {'ru': 'Привет.', 'zh': '你好。', 'ja': 'こんにちは。', 'ko': '안녕하세요.',
                 'de': 'Hallo.', 'fr': 'Bonjour.', 'pt': 'Olá.', 'es': 'Hola.', 'it': 'Ciao.'}
    if cancelled is None:
        voice.generate(greetings.get(language, 'Hello.'), language=language)
    else:
        voice.generate(greetings.get(language, 'Hello.'), cancelled=cancelled, language=language)
    check_cancelled(cancelled)
    torch.cuda.empty_cache()
    return voice


def serve(language='en', validate_turbo=False):
    stop_file = ROOT / "data/run/companion-voice.stop"
    # Imports can outlive an owner-requested restart. This request belongs to
    # this process: stale requests were cleared by the launcher before spawn.
    if stop_file.exists():
        return
    if not LANGUAGES.get(language, {}).get('speech'):
        raise ValueError('Unsupported spoken language')
    config = settings()
    if validate_turbo:
        if language != 'en':
            raise ValueError('Turbo validation requires English')
        config['validateTurbo'] = True
    token_file = ROOT / "data/speech/companion-voice-token"
    token_file.parent.mkdir(parents=True, exist_ok=True)
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    token = token_file.read_text(encoding="utf-8").strip()
    closing = threading.Event()
    stopping = threading.Event()
    def watch_stop_request():
        while not closing.wait(.25):
            if stop_file.exists():
                stopping.set()
                return
    threading.Thread(target=watch_stop_request, daemon=True).start()
    worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="capri-tts")
    # Load the selected backend directly, without first loading English Turbo.
    try:
        voice = worker.submit(load_and_warm, config, language, stopping).result()
        if stop_file.exists():
            stopping.set()
        check_cancelled(stopping)
    except VoiceCancelled:
        closing.set()
        worker.shutdown(wait=True, cancel_futures=True)
        return
    except Exception as error:
        closing.set()
        from .startup_failure import startup_failure
        from integrations.voice_training.dataset import write_json
        try:
            write_json(ROOT / 'data/run/voice-startup-error.json', startup_failure(error))
        except Exception:
            pass  # Preserve the original traceback even if diagnostic storage fails.
        worker.shutdown(wait=True, cancel_futures=True)
        raise
    busy = threading.Lock()
    state_lock = threading.Lock()
    active = {}
    cancelled_ids = {}
    last_failure = {}

    def record_failure(error):
        failure = inference_failure(error)
        with state_lock:
            last_failure.clear()
            last_failure.update(failure)
        return failure

    class Handler(BaseHTTPRequestHandler):
        timeout = 10

        def log_message(self, *_args):
            pass  # Never log dialog or authentication headers.

        def reply(self, status, body=b"", content_type="application/json", rate=None, metrics=None):
            try:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                if rate:
                    self.send_header("X-Sample-Rate", str(rate))
                if metrics:
                    for name, key in [('X-T3-Ms','tokenMs'),('X-Decoder-Ms','decoderMs'),('X-Synthesis-Ms','totalMs')]:
                        self.send_header(name, str(metrics[key]))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def allowed(self):
            if self.headers.get("Host") not in {f"127.0.0.1:{config['port']}", f"localhost:{config['port']}"} or self.headers.get("Origin"):
                self.reply(403)
                return False
            if not secrets.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
                self.reply(401)
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            if self.path != "/health":
                self.reply(404)
                return
            with state_lock:
                failure = dict(last_failure) or None
            self.reply(200, json.dumps(dict(
                ready=True, protocolVersion=2, multilingual=True, engine=config["engine"], profile=voice.profile["id"],
                tokenStreaming=False,
                sampleRate=24000, adapterSha256=voice.profile["adapterSha256"],
                gpuAllocatedMiB=round(torch.cuda.memory_allocated() / 1024**2, 1),
                gpuReservedMiB=round(torch.cuda.memory_reserved() / 1024**2, 1),
                warm=True, cancellation=True,
                **voice.health(),
                lastInferenceFailure=failure,
                languages=[key for key, value in LANGUAGES.items() if value['speech']],
            )).encode())

        def do_POST(self):
            if not self.allowed():
                return
            if self.path not in {"/synthesize", "/cancel", "/prepare"}:
                self.reply(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192 or self.headers.get("Transfer-Encoding"):
                    raise ValueError("Invalid request length")
                body = json.loads(self.rfile.read(length))
                request_id = body.get('requestId', '')
                if not isinstance(request_id, str) or len(request_id) > 100:
                    raise ValueError('Invalid request ID')
                if self.path == '/cancel':
                    if not request_id:
                        raise ValueError('Missing request ID')
                    with state_lock:
                        if request_id in active:
                            active[request_id].set()
                        cancelled_ids[request_id] = time.monotonic()
                        while len(cancelled_ids) > 128:
                            cancelled_ids.pop(next(iter(cancelled_ids)))
                    self.reply(200, b'{"ok":true}')
                    return
                language = body.get('language', 'en')
                if not isinstance(language, str) or not LANGUAGES.get(language, {}).get('speech'):
                    raise ValueError('Unsupported spoken language')
                text = body.get("text", 'Hello.' if self.path == '/prepare' else None)
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1200 or "\0" in text:
                    raise ValueError("Invalid text")
            except (ValueError, TypeError, AttributeError):
                self.reply(400)
                return
            if not busy.acquire(blocking=False):
                self.reply(409)
                return
            try:
                cancelled = threading.Event()
                with state_lock:
                    if request_id and time.monotonic() - cancelled_ids.get(request_id, -1e9) < 120:
                        cancelled.set()
                    if stopping.is_set():
                        cancelled.set()
                    # Even anonymous authenticated requests must be cancelled
                    # when the service stops; only one inference owns busy.
                    active[request_id] = cancelled
                if self.path == '/prepare':
                    worker.submit(voice.prepare, language, cancelled).result()
                    self.reply(200, json.dumps(dict(ready=True, **voice.health())).encode())
                else:
                    audio, rate = worker.submit(voice.generate, text.strip(), cancelled, language).result()
                    self.reply(200, audio, "application/octet-stream", rate, voice.last_metrics)
            except VoiceCancelled:
                self.reply(499)
            except MissingSpeechModel as error:
                failure = record_failure(error)
                print(f'Voice model unavailable: {error}', flush=True)
                self.reply(503, json.dumps(dict(error='model_missing', code=failure['code'], component=error.component,
                                               file=error.filename, reason=error.reason)).encode())
            except Exception as error:
                failure = record_failure(error)
                print(f"Voice inference failed: {failure['code']} ({failure['errorType']})", flush=True)
                for frame in traceback.extract_tb(error.__traceback__)[-6:]:
                    print(f'  {os.path.basename(frame.filename)}:{frame.lineno} {frame.name}', flush=True)
                self.reply(503, json.dumps(dict(error='Voice generation failed', code=failure['code'])).encode())
            finally:
                with state_lock:
                    active.pop(request_id, None)
                busy.release()

    server = ThreadingHTTPServer(("127.0.0.1", config["port"]), Handler)
    server.daemon_threads = True

    def watch():
        while not stopping.wait(.25):
            if closing.is_set():
                return
        with state_lock:
            for event in active.values():
                event.set()
        server.shutdown()

    threading.Thread(target=watch, daemon=True).start()
    print(f"Capri voice ready on loopback port {config['port']}", flush=True)
    try:
        server.serve_forever(poll_interval=.25)
    finally:
        closing.set()
        server.server_close()
        worker.shutdown(wait=True, cancel_futures=True)
        stop_file.unlink(missing_ok=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', choices=[key for key, value in LANGUAGES.items() if value['speech']], default='en')
    parser.add_argument('--validate-turbo', action='store_true')
    args = parser.parse_args()
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    serve(args.language, args.validate_turbo)
