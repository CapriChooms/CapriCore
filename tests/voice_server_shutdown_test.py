"""Owned loopback service lifecycle; stdlib fakes never import Torch or models."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError


class VoiceCancelled(RuntimeError):
    pass


def check_cancelled(event):
    if event is not None and event.is_set():
        raise VoiceCancelled()


def module(**values):
    result = ModuleType('voice_lifecycle_fixture')
    result.__dict__.update(values)
    return result


class VoiceShutdownTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='voice-stop-', dir=Path(__file__).resolve().parents[1] / '.runtime')
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / 'data/run').mkdir(parents=True)
        self.stop = self.root / 'data/run/companion-voice.stop'
        self.started = threading.Event()
        self.force_finish = threading.Event()
        self.block_warmup = False
        self.created = 0
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        fixture = self

        class Voice:
            profile = {'id': 'fixture', 'adapterSha256': 'fixture'}
            last_metrics = {'tokenMs': 0, 'decoderMs': 0, 'totalMs': 0}

            def __init__(self, config):
                fixture.created += 1

            def generate(self, text, cancelled=None, language='en'):
                if fixture.block_warmup or text == 'block':
                    fixture.started.set()
                    while not fixture.force_finish.wait(.01):
                        check_cancelled(cancelled)
                    raise VoiceCancelled()
                return b'\0\0', 24000

            def health(self):
                return {}

        torch = module(cuda=SimpleNamespace(empty_cache=lambda: None, memory_allocated=lambda: 0, memory_reserved=lambda: 0))
        fake_modules = {
            'torch': torch,
            'integrations.voice_training.dataset': module(ROOT=self.root, write_json=lambda *_: None),
            'integrations.voice_runtime.model': module(settings=lambda: {'port': self.port, 'engine': 'fixture'}),
            'integrations.voice_runtime.multilingual': module(VoicePool=Voice),
            'integrations.multilingual': module(LANGUAGES={'en': {'speech': True}}, MissingSpeechModel=type('MissingSpeechModel', (Exception,), {})),
            'integrations.voice_runtime.inference': module(VoiceCancelled=VoiceCancelled, check_cancelled=check_cancelled),
            'integrations.voice_runtime.failure': module(inference_failure=lambda _: {}),
            'integrations.voice_runtime.catalog': module(selected_voice=lambda _: {'backend': 'qwen3-tts'}),
        }
        source = Path(os.environ.get('CAPRI_VOICE_SERVER_TEST_SOURCE', Path(__file__).resolve().parents[1] / 'integrations/voice_runtime/server.py'))
        spec = importlib.util.spec_from_file_location('integrations.voice_runtime.lifecycle_fixture', source)
        self.server = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, fake_modules):
            spec.loader.exec_module(self.server)
        self.errors = []
        self.thread = None

    def start(self):
        def run():
            try:
                self.server.serve()
            except Exception as error:
                self.errors.append(error)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        self.addCleanup(self.cleanup_server)

    def cleanup_server(self):
        self.stop.touch()
        self.force_finish.set()
        self.thread.join(3)

    def request(self, path, body=None):
        token = (self.root / 'data/speech/companion-voice-token').read_text()
        req = Request('http://127.0.0.1:' + str(self.port) + path,
                      data=None if body is None else json.dumps(body).encode(),
                      headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urlopen(req, timeout=2) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def test_stop_requested_during_import_is_not_erased_before_loading(self):
        self.stop.touch()
        with patch.object(self.server, 'ThreadingHTTPServer', side_effect=AssertionError('A stopped service must not bind its port')):
            self.server.serve()
        self.assertEqual(self.created, 0)
        self.assertTrue(self.stop.exists(), 'Only a new launcher may clear the pending request')

    def test_stop_during_warmup_cancels_without_publishing_ready(self):
        self.block_warmup = True
        self.start()
        self.assertTrue(self.started.wait(2))
        self.stop.touch()
        self.thread.join(2)
        self.assertFalse(self.thread.is_alive(), 'Warmup must receive cancellation before HTTP readiness')
        self.assertEqual(self.errors, [])
        self.assertFalse((self.root / 'data/run/voice-startup-error.json').exists())

    def test_shutdown_cancels_anonymous_authenticated_generation(self):
        self.start()
        deadline = time.monotonic() + 3
        while True:
            try:
                status, _ = self.request('/health')
                if status == 200:
                    break
            except (OSError, TimeoutError):
                pass
            if time.monotonic() >= deadline:
                self.fail('Owned voice fixture did not become ready')
            time.sleep(.02)
        replies = []
        generation = threading.Thread(target=lambda: replies.append(self.request('/synthesize', {'text': 'block'})), daemon=True)
        generation.start()
        self.assertTrue(self.started.wait(2))
        self.stop.touch()
        self.thread.join(2)
        generation.join(2)
        self.assertFalse(self.thread.is_alive(), 'Anonymous inference must not hold executor shutdown open')
        self.assertFalse(generation.is_alive())
        self.assertEqual(replies[0][0], 499)
        self.assertEqual(self.errors, [])


if __name__ == '__main__':
    unittest.main()
