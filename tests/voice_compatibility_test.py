"""GPU-family selection and CUDA execution regression tests without a GPU."""
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, MagicMock, patch

from integrations.voice_runtime.compatibility import cuda_preflight, qwen_compute

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('voice_selection', ROOT / 'tools/setup/select-voice-runtime.py')
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)


class VoiceCompatibilityTests(unittest.TestCase):
    def test_installer_voice_check_survives_unavailable_rocm_memory_telemetry(self):
        from integrations.voice_training import __main__ as training

        torch = NS(__version__='rocm fixture', cuda=NS(
            is_available=lambda: True,
            mem_get_info=Mock(side_effect=RuntimeError('HIP memory query failed')),
        ))
        config = {'engine': 'chatterbox-turbo', 'language': 'en'}
        with (patch.dict(sys.modules, {'torch': torch}),
              patch('importlib.metadata.version', return_value='fixture'),
              patch('integrations.voice_runtime.compatibility.cuda_preflight',
                    return_value={'available': True, 'kernelReady': True, 'backend': 'rocm'}),
              patch('integrations.voice_training.provision.verify_model'),
              patch.object(training, 'write_json')):
            report = training.doctor(config, inference_only=True)
        self.assertTrue(report['modelReady'])
        self.assertTrue(report['cudaCompute']['kernelReady'])
        self.assertNotIn('datasetReady', report)
        self.assertNotIn('freeVramGiB', report)

    def test_qwen_rocm_uses_verified_bf16_device_and_checks_vram(self):
        matrix = MagicMock()
        matrix.__matmul__.return_value.sum.return_value.item.return_value = 4.0
        torch = NS(
            version=NS(hip='7.2', cuda=None), bfloat16=object(),
            eye=Mock(return_value=matrix),
            cuda=NS(is_available=lambda: True, device_count=lambda: 2,
                    mem_get_info=lambda device: (1 if device == 'cuda:0' else 8 * 1024 ** 3, 0)),
        )
        self.assertEqual(qwen_compute(torch, 'cuda:0', True, 6), ('cuda:1', 'AMD ROCm'))
        torch.eye.assert_called_once_with(4, device='cuda:1', dtype=torch.bfloat16)
        with self.assertRaisesRegex(RuntimeError, '6 GiB'):
            qwen_compute(torch, 'cuda:0', False, 6)
        self.assertEqual(qwen_compute(torch, 'cuda:0', True, 12)[0], 'cpu')
        torch.eye.side_effect = RuntimeError('BF16 kernel unavailable')
        self.assertEqual(qwen_compute(torch, 'cuda:0', True, 6)[0], 'cpu')

    def test_generation_matrix_from_pascal_through_blackwell(self):
        # Official NVIDIA capabilities; name fallback is also tested with no CC.
        families = [
            ('GTX 1050', '6.1', 'legacy'),
            ('GTX 1060', '6.1', 'legacy'),
            ('GTX 1070', '6.1', 'legacy'),
            ('GTX 1080 Ti', '6.1', 'legacy'),
            ('GTX 1650', '7.5', 'legacy'),
            ('GTX 1660 Ti', '7.5', 'legacy'),
            ('RTX 2060', '7.5', 'legacy'),
            ('RTX 2080 Ti', '7.5', 'legacy'),
            ('RTX 3050', '8.6', 'legacy'),
            ('RTX 3090', '8.6', 'legacy'),
            ('RTX 4050 Laptop GPU', '8.9', 'legacy'),
            ('RTX 4070', '8.9', 'legacy'),
            ('RTX 4090', '8.9', 'legacy'),
            ('RTX 5050', '12.0', 'blackwell'),
            ('RTX 5060 Ti', '12.0', 'blackwell'),
            ('RTX 5070 Ti', '12.0', 'blackwell'),
            ('RTX 5080', '12.0', 'blackwell'),
            ('RTX 5090', '12.0', 'blackwell'),
            ('RTX 5090 Laptop GPU', '12.0', 'blackwell'),
            ('RTX PRO 6000 Blackwell', '12.0', 'blackwell'),
            ('Quadro P6000', '6.1', 'legacy'),
            ('Quadro RTX 6000', '7.5', 'legacy'),
            ('RTX A6000', '8.6', 'legacy'),
            ('RTX 6000 Ada', '8.9', 'legacy'),
            ('Tesla V100', '7.0', 'legacy'),
            ('A100', '8.0', 'legacy'),
            ('H100', '9.0', 'legacy'),
            ('B200', '10.0', 'blackwell'),
        ]
        for name, capability, expected in families:
            with self.subTest(gpu=name):
                device = {'name': 'NVIDIA ' + name, 'capability': capability}
                self.assertEqual(selection.select_profile([device]), expected)
                if not name.startswith('B200'):
                    self.assertEqual(selection.select_profile([{'name': device['name']}]), expected)

    def test_hardware_selection_preserves_legacy_and_identifies_blackwell(self):
        old = {'index': '0', 'uuid': 'GPU-old', 'name': 'NVIDIA GeForce RTX 4070', 'capability': '8.9'}
        new = {'index': '1', 'uuid': 'GPU-new', 'name': 'NVIDIA GeForce RTX 5060 Ti', 'capability': '12.0'}
        for devices, expected in [([], 'legacy'), ([old], 'legacy'), ([new], 'blackwell'), ([{'name': 'NVIDIA GeForce GTX 1060', 'capability': '6.1'}], 'legacy'), ([{'name': 'NVIDIA GeForce RTX 5090'}], 'blackwell'), ([{'name': 'NVIDIA B200', 'capability': '10.0'}], 'blackwell')]:
            self.assertEqual(selection.select_profile(devices), expected)
        self.assertEqual(selection.select_profile([old, new], '0'), 'legacy')
        self.assertEqual(selection.select_profile([old, new], 'GPU-new'), 'blackwell')
        self.assertEqual(selection.select_profile([old, new], '-1'), 'legacy')
        self.assertEqual(selection.select_profile([old], requested='blackwell'), 'blackwell')

    def fake_torch(self, capability, runtime):
        cuda = NS(is_available=lambda: True, get_device_name=lambda _: 'Fixture GPU', get_device_capability=lambda _: capability, get_arch_list=lambda: ['sm_86', 'sm_120'], synchronize=Mock())
        return NS(__version__='fixture', version=NS(cuda=runtime), cuda=cuda, arange=Mock(), eye=Mock(), float32='float32')

    def test_available_cuda_does_not_make_an_incompatible_gpu_ready(self):
        torch = self.fake_torch((12, 0), '12.4')
        result = cuda_preflight(torch)
        self.assertTrue(result['available'])
        self.assertFalse(result['kernelReady'])
        self.assertIn('Blackwell', result['error'])
        torch.arange.assert_not_called()
        torch = self.fake_torch((12, 0), '12.8')
        torch.arange.side_effect = RuntimeError('CUDA error: no kernel image is available for execution on the device')
        self.assertFalse(cuda_preflight(torch)['kernelReady'])
        torch.arange.assert_called_once()

    def test_compute_check_runs_arithmetic_and_matrix_operations(self):
        # No exact-SM equality gate: sm_86 cubins support Ada sm_89 too.
        for capability, runtime in [((6, 1), '12.4'), ((7, 5), '12.4'), ((8, 6), '12.4'), ((8, 9), '12.4'), ((9, 0), '12.4'), ((10, 0), '12.8'), ((12, 0), '12.8')]:
            with self.subTest(capability=capability):
                torch = self.fake_torch(capability, runtime)
                value, matrix = MagicMock(), MagicMock()
                ((value + 1) * 2).sum().item.return_value = 272.0
                (matrix @ matrix).sum().item.return_value = 4.0
                torch.arange.return_value, torch.eye.return_value = value, matrix
                self.assertTrue(cuda_preflight(torch)['kernelReady'])
                torch.cuda.synchronize.assert_called_once()
                (matrix @ matrix).sum().item.return_value = -1
                self.assertFalse(cuda_preflight(torch)['kernelReady'])

    def test_modern_lock_changes_only_reviewed_torch_audio_and_sympy_pins(self):
        lines = lambda name: {v for v in (ROOT / 'config' / name).read_text(encoding='utf-8').splitlines() if v and not v.startswith('#')}
        legacy, modern = lines('requirements-voice-training.lock'), lines('requirements-voice-blackwell.lock')
        self.assertEqual(legacy - modern, {'torch==2.6.0+cu124', 'torchaudio==2.6.0+cu124', 'sympy==1.13.1'})
        self.assertEqual(modern - legacy, {'torch==2.7.1+cu128', 'torchaudio==2.7.1+cu128', 'sympy==1.14.0'})
        profiles = json.loads((ROOT / 'config/voice-runtime.json').read_text())['profiles']
        self.assertEqual(profiles['blackwell']['backend'], 'cu128')
        self.assertEqual(profiles['legacy']['backend'], 'cu124')

    def test_amd_matrix_is_explicit_and_hip_does_not_enter_nvidia_architecture_gate(self):
        for name in ['AMD Radeon RX 9070 XT', 'AMD Radeon RX 7900 XTX', 'AMD Radeon RX 7700', 'AMD Radeon AI PRO R9700']:
            self.assertTrue(selection.amd_supported([name]))
        for name in ['AMD Radeon RX 6600', 'AMD Radeon 780M', 'AMD Radeon RX 7900 XT', 'Intel Arc A770']:
            self.assertFalse(selection.amd_supported([name]))
        torch = self.fake_torch((12, 0), None)
        torch.version.hip = '7.2.53211'
        value, matrix = MagicMock(), MagicMock()
        ((value + 1) * 2).sum().item.return_value = 272.0
        (matrix @ matrix).sum().item.return_value = 4.0
        torch.arange.return_value, torch.eye.return_value = value, matrix
        report = cuda_preflight(torch)
        self.assertTrue(report['kernelReady'])
        self.assertEqual(report['backend'], 'rocm')
        self.assertEqual(report['runtime'], '7.2.53211')


if __name__ == '__main__':
    unittest.main()
