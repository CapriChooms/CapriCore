"""Startup phase records never contain native exception text, paths or audio."""
import builtins
import ctypes
import io
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from integrations.asr_runtime import native_runtime, worker


STAGES = ['ASR_START_DEPENDENCIES', 'ASR_START_CONFIG',
          'ASR_START_DETECTOR', 'ASR_START_MODEL']


class WorkerStartupTests(unittest.TestCase):
    def run_worker(self, fail_at=None):
        events, calls = [], []
        model = ModuleType('integrations.asr_runtime.model')
        recognition = ModuleType('integrations.asr_runtime.recognition')

        def phase(code, result=None):
            self.assertEqual(events[-1], {'type': 'startup-stage', 'code': code})
            calls.append(code)
            if fail_at == code:
                raise RuntimeError('private machine path, key and exception contents')
            return result

        model.settings = lambda: phase('ASR_START_CONFIG', {'language': 'en', 'engine': 'fixture'})
        model.SpeechDetector = lambda config: phase('ASR_START_DETECTOR', SimpleNamespace())
        model.Recognizer = lambda config: phase('ASR_START_MODEL', SimpleNamespace())
        model.validate_pause = lambda value: value
        recognition.RecognitionSession = SimpleNamespace
        recognition.RecognitionQueue = lambda recognizer, emit: SimpleNamespace(
            stop=lambda session: None, close=lambda: None)
        original_import = builtins.__import__

        def import_module(name, *args, **kwargs):
            if name == 'numpy':
                phase('ASR_START_DEPENDENCIES')
                return ModuleType('numpy')
            return original_import(name, *args, **kwargs)

        with patch.dict(sys.modules, {model.__name__: model, recognition.__name__: recognition}), \
                patch.object(worker, 'load_sherpa_runtime'), \
                patch.object(worker, 'emit', side_effect=events.append), \
                patch.object(worker.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO())), \
                patch('builtins.__import__', side_effect=import_module):
            result = worker.run()
        return result, events, calls

    def test_each_phase_is_flushed_before_the_operation_and_exception_text_is_not_emitted(self):
        for stage in STAGES:
            with self.subTest(stage=stage):
                result, events, calls = self.run_worker(stage)
                self.assertEqual(result, 1)
                self.assertEqual(events[-1], {'type': 'startup-error', 'code': stage})
                self.assertEqual([event['code'] for event in events[:-1]], STAGES[:STAGES.index(stage) + 1])
                self.assertEqual(calls, STAGES[:STAGES.index(stage) + 1])
                self.assertNotIn('private', str(events))
                self.assertTrue(all(set(event) == {'type', 'code'} for event in events))

    def test_old_ready_protocol_is_preserved_after_the_four_bounded_phase_records(self):
        result, events, calls = self.run_worker()
        self.assertIsNone(result)
        self.assertEqual(calls, STAGES)
        self.assertEqual(events[:-1], [{'type': 'startup-stage', 'code': stage} for stage in STAGES])
        self.assertEqual(events[-1], {'type': 'ready', 'protocol': 1, 'language': 'en',
            'sampleRate': 16000, 'provider': 'cpu', 'engine': 'fixture', 'mode': 'utterance',
            'draft': False})


class WindowsRuntimeTests(unittest.TestCase):
    def test_loads_the_bundled_library_and_rejects_an_already_loaded_conflict(self):
        with tempfile.TemporaryDirectory() as folder:
            package = Path(folder) / 'sherpa_onnx'
            library = package / 'lib' / 'onnxruntime.dll'
            library.parent.mkdir(parents=True)
            library.touch()
            other = Path(folder) / 'onnxruntime.dll'
            other.touch()
            kernel = SimpleNamespace(GetModuleHandleW=Mock(return_value=None),
                                     GetModuleFileNameW=Mock())
            native = object()
            with patch.object(sys, 'platform', 'win32'), \
                    patch.object(native_runtime, 'find_spec', return_value=SimpleNamespace(origin=package / '__init__.py')), \
                    patch.object(ctypes, 'WinDLL', side_effect=[kernel, native, kernel], create=True) as load:
                self.assertIs(native_runtime.load_sherpa_runtime(), native)
                load.assert_called_with(str(library.resolve()), winmode=0x900)

                kernel.GetModuleHandleW.return_value = 1

                def copy_filename(_handle, buffer, _maximum):
                    buffer.value = str(other)
                    return len(buffer.value)

                kernel.GetModuleFileNameW.side_effect = copy_filename
                with self.assertRaisesRegex(ImportError, 'Another ONNX Runtime'):
                    native_runtime.load_sherpa_runtime()
                self.assertEqual(load.call_count, 3)


if __name__ == '__main__':
    unittest.main()
