# SPDX-License-Identifier: GPL-3.0-only
"""Unit tests for length-prefixed binary audio streaming and mid-stream cancellation."""
import importlib.util
import json
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class VoiceCancelled(RuntimeError):
    pass


def check_cancelled(event):
    if event is not None and event.is_set():
        raise VoiceCancelled()


def module(**values):
    result = ModuleType('voice_stream_fixture')
    result.__dict__.update(values)
    return result


class VoiceStreamingServerTests(unittest.TestCase):
    def setUp(self):
        base_dir = Path(__file__).resolve().parents[1] / '.runtime'
        base_dir.mkdir(parents=True, exist_ok=True)
        self.folder = tempfile.TemporaryDirectory(prefix='voice-stream-', dir=base_dir)
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / 'data/run').mkdir(parents=True)
        self.stop = self.root / 'data/run/companion-voice.stop'
        self.second_chunk_gate = threading.Event()
        self.first_chunk_sent = threading.Event()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        fixture = self

        class Voice:
            profile = {'id': 'fixture', 'adapterSha256': 'fixture'}
            last_metrics = {'tokenMs': 12.5, 'decoderMs': 45.0, 'totalMs': 57.5}

            def __init__(self, config):
                pass

            def supports_streaming(self):
                return True

            def prepare(self, language, cancelled=None):
                check_cancelled(cancelled)

            def generate(self, text, cancelled=None, language='en'):
                return struct.pack('<4f', 0.1, -0.1, 0.2, -0.2), 24000

            def generate_stream(self, text, cancelled=None, language='en'):
                c0 = struct.pack('<4f', 0.1, -0.1, 0.2, -0.2)
                yield c0, 24000, {'tokenMs': 10.0, 'decoderMs': 20.0, 'totalMs': 30.0}
                if text == 'cancel-mid':
                    fixture.first_chunk_sent.set()
                    while not fixture.second_chunk_gate.wait(0.01):
                        check_cancelled(cancelled)
                check_cancelled(cancelled)
                c1 = struct.pack('<4f', 0.3, -0.3, 0.4, -0.4)
                yield c1, 24000, {'tokenMs': 15.0, 'decoderMs': 25.0, 'totalMs': 70.0}

            def health(self):
                return {'cudaGraph': True, 'cfmCudaGraph': True}

        torch = module(
            version=SimpleNamespace(cuda=None, hip=None),
            cuda=SimpleNamespace(empty_cache=lambda: None, memory_allocated=lambda: 0, memory_reserved=lambda: 0),
        )
        fake_modules = {
            'torch': torch,
            'integrations.voice_training.dataset': module(ROOT=self.root, write_json=lambda *_: None),
            'integrations.voice_runtime.model': module(settings=lambda: {'port': self.port, 'engine': 'fixture'}),
            'integrations.voice_runtime.multilingual': module(VoicePool=Voice),
            'integrations.multilingual': module(
                LANGUAGES={'en': {'speech': True}},
                MissingSpeechModel=type('MissingSpeechModel', (Exception,), {}),
            ),
            'integrations.voice_runtime.inference': module(
                VoiceCancelled=VoiceCancelled,
                check_cancelled=check_cancelled,
            ),
            'integrations.voice_runtime.failure': module(
                inference_failure=lambda _: {'code': 'CAPRI_VOICE_INFERENCE_FAILED', 'errorType': 'RuntimeError'},
            ),
            'integrations.voice_runtime.catalog': module(selected_voice=lambda _: {'backend': 'qwen3-tts'}),
        }
        source = Path(__file__).resolve().parents[1] / 'integrations/voice_runtime/server.py'
        spec = importlib.util.spec_from_file_location('integrations.voice_runtime.stream_fixture', source)
        self.server = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, fake_modules):
            spec.loader.exec_module(self.server)
        self.errors = []
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()
        self.addCleanup(self.cleanup_server)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                status, _, _ = self.request('/health')
                if status == 200:
                    return
            except (OSError, TimeoutError):
                time.sleep(0.02)
        self.fail('Fixture server did not become ready')

    def _serve(self):
        try:
            self.server.serve()
        except Exception as exc:
            self.errors.append(exc)

    def cleanup_server(self):
        self.second_chunk_gate.set()
        self.stop.touch()
        self.thread.join(3)

    def request(self, path, body=None):
        token = (self.root / 'data/speech/companion-voice-token').read_text()
        req = Request(
            f'http://127.0.0.1:{self.port}{path}',
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        )
        try:
            with urlopen(req, timeout=3) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except HTTPError as err:
            return err.code, dict(err.headers), err.read()

    def test_health_and_prepare_advertise_token_streaming(self):
        status, _, body = self.request('/health')
        self.assertEqual(status, 200)
        health = json.loads(body)
        self.assertEqual(health['protocolVersion'], 2)
        self.assertTrue(health['tokenStreaming'])
        self.assertTrue(health['cfmCudaGraph'])

        status, _, body = self.request('/prepare', {'language': 'en', 'requestId': 'prep-1'})
        self.assertEqual(status, 200)
        prep = json.loads(body)
        self.assertTrue(prep['ready'])
        self.assertTrue(prep['tokenStreaming'])

    def test_synthesize_stream_delivers_length_prefixed_frames_and_eof_sentinel(self):
        status, headers, raw = self.request(
            '/synthesize-stream',
            {'text': 'Hello.', 'language': 'en', 'requestId': 's-1'},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get('X-Stream-Framing'), 'length-prefixed-f32le')
        self.assertEqual(headers.get('X-Sample-Rate'), '24000')
        frames = []
        pos = 0
        saw_eof = False
        while pos + 4 <= len(raw):
            length = struct.unpack_from('<I', raw, pos)[0]
            pos += 4
            if length == 0:
                saw_eof = True
                break
            frames.append(raw[pos : pos + length])
            pos += length
        self.assertTrue(saw_eof)
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0], struct.pack('<4f', 0.1, -0.1, 0.2, -0.2))
        self.assertEqual(frames[1], struct.pack('<4f', 0.3, -0.3, 0.4, -0.4))

    def test_cancel_aborts_mid_stream_and_releases_worker(self):
        token = (self.root / 'data/speech/companion-voice-token').read_text()
        req = Request(
            f'http://127.0.0.1:{self.port}/synthesize-stream',
            data=json.dumps({'text': 'cancel-mid', 'language': 'en', 'requestId': 's-cancel'}).encode(),
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        )
        received = []

        def reader():
            with urlopen(req, timeout=3) as resp:
                received.append(resp.read())

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        self.assertTrue(self.first_chunk_sent.wait(2))
        c_status, _, _ = self.request('/cancel', {'requestId': 's-cancel'})
        self.assertEqual(c_status, 200)
        t.join(2)
        self.assertFalse(t.is_alive())
        raw = received[0]
        length0 = struct.unpack_from('<I', raw, 0)[0]
        self.assertEqual(length0, 16)
        self.assertEqual(len(raw), 4 + 16)
        status, _, _ = self.request('/synthesize', {'text': 'Next.', 'language': 'en', 'requestId': 's-next'})
        self.assertEqual(status, 200)


if __name__ == '__main__':
    unittest.main()
