"""Stage verified Qwen acceleration packages and qualify the installed GPU runtime."""
# SPDX-License-Identifier: GPL-3.0-only
import argparse
from importlib.metadata import version
import json
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile

from integrations.model_download import _regular_path, download_verified
from .compatibility import qwen_gpu_ready

ROOT = Path(__file__).resolve().parents[2]
CPU_TORCH_VERSION = '2.7.1'
ROCM_BASE = 'https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/'
ROCM = {
    'rocm-sdk-core': ('rocm_sdk_core-7.2.1-py3-none-win_amd64.whl', 644793492,
                      'f68989d48df71cbfc3cb68bf705dc37c0f56e9666feddb59a1a0f5ff7539fe1c'),
    'rocm-sdk-devel': ('rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl', 232840013,
                       '19e6ee67e13432b7c1e8a4077df795dcb1239546ae314700c4b4d97e5b4b8f63'),
    'rocm-sdk-libraries-custom': ('rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl', 489964648,
                                  'c7fe0b0731af8896093ff69e11496830d3cb6a4aed73e895c60b7cbdc200be92'),
    'rocm': ('rocm-7.2.1.tar.gz', 15940,
             '9084902eaa69213a00a90784ad89e6e5fe73c702df0cc6cc3a70d777c7a6142b'),
    'torch': ('torch-2.9.1+rocm7.2.1-cp312-cp312-win_amd64.whl', 821065907,
              'e88bf270163b48f7f27f7ea3db5ffb3be4ba107301933022bcb3c6ddedfeeabb'),
    'torchaudio': ('torchaudio-2.9.1+rocm7.2.1-cp312-cp312-win_amd64.whl', 514708,
                   '62835605995c7812a3224733abf08e222afddb7a487c493521e613ca46e578ab'),
}
CUDA = {
    'torch': ('torch-2.7.1+cu128-cp311-cp311-win_amd64.whl', 3273066072,
              '138c66dcd0ed2f07aafba3ed8b7958e2bed893694990e0b4b55b6b2b4a336aa6'),
    'torchaudio': ('torchaudio-2.7.1+cu128-cp311-cp311-win_amd64.whl', 4660477,
                   '37a42de8c0f601dc0bc7dcccc4049644ef5adcf45920dd5813c339121e5b5a8c'),
}
PACKAGES = {'cuda': CUDA, 'rocm': ROCM}


class GpuDeviceError(RuntimeError):
    pass


def prepare_lock(root, lock, backend, *, download=download_verified):
    runtime = root / '.runtime'
    _regular_path(lock)
    if lock.parent.resolve() != (runtime / f'qwen-tts-{backend}-venv').resolve() or not re.fullmatch(
        rf'requirements-{backend}-[a-f0-9]{{32}}\.lock', lock.name
    ):
        raise ValueError('Invalid acceleration dependency lock path.')
    source = (root / 'config/requirements-qwen-tts.lock').read_text(encoding='utf-8')
    patterns = {}
    for package in ('torch', 'torchaudio'):
        pattern = re.compile(
            rf'^{package}=={re.escape(CPU_TORCH_VERSION)}\+cpu[^\n]*\n'
            r'(?:[ ]+--hash=sha256:[a-f0-9]{64}[^\n]*\n)+', re.MULTILINE
        )
        if len(pattern.findall(source)) != 1:
            raise ValueError('The reviewed Qwen dependency lock changed.')
        patterns[package] = pattern

    packages = PACKAGES[backend]
    total = sum(size for _, size, _ in packages.values())
    completed = 0

    def report(stage, received):
        print(json.dumps({'stage': f'{backend}-{stage}', 'received': completed + received, 'total': total}),
              flush=True)

    for package, (filename, size, checksum) in packages.items():
        url_name = filename.replace('+', '%2B')
        if backend == 'rocm':
            urls = (ROCM_BASE + url_name,)
        else:
            urls = tuple(f'https://{host}/whl/cu128/{url_name}' for host in
                         ('download-r2.pytorch.org', 'download.pytorch.org'))
        wheel = download(
            urls[0],
            runtime / f'qwen-{backend}-wheels' / filename,
            {'bytes': size, 'sha256': checksum},
            fallback_urls=urls[1:],
            attempts=4,
            timeout=30,
            progress=report,
        )
        completed += size
        report('download', 0)
        replacement = f'{package} @ {wheel.as_uri()} --hash=sha256:{checksum}\n'
        if package in patterns:
            source = patterns[package].sub(lambda _: replacement, source, count=1)
        else:
            source += replacement

    with lock.open('x', encoding='utf-8') as file:
        file.write(source)


def verify_runtime(root, backend, *, check_device=True):
    folder = root / f'.runtime/qwen-tts-{backend}-venv'
    if Path(sys.prefix).resolve() != folder.resolve():
        raise ValueError('Acceleration verification requires its own Python environment.')
    import torch
    from qwen_tts import Qwen3TTSModel  # noqa: F401
    from ruaccent import RUAccent  # noqa: F401

    tag = 'rocm7.2.1' if backend == 'rocm' else 'cu128'
    expected = f'2.9.1+{tag}' if backend == 'rocm' else f'2.7.1+{tag}'
    hip = getattr(torch.version, 'hip', None)
    matching = bool(hip and hip.startswith('7.2')) if backend == 'rocm' else torch.version.cuda == '12.8' and not hip
    if not matching or any(version(package) != expected for package in ('torch', 'torchaudio')):
        raise RuntimeError('The pinned GPU packages are incomplete.')
    if not check_device:
        return
    if not any(qwen_gpu_ready(torch, f'cuda:{i}') for i in range(torch.cuda.device_count())):
        raise GpuDeviceError('A compatible GPU, driver and BF16 support are required.')

    receipt = folder / f'{backend}-ready.json'
    _regular_path(receipt)
    with NamedTemporaryFile(mode='w', encoding='utf-8', dir=folder, delete=False) as file:
        temp = Path(file.name)
        json.dump({'schemaVersion': 1, 'backend': tag}, file)
    try:
        temp.replace(receipt)
    finally:
        temp.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=tuple(PACKAGES), required=True)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--prepare', type=Path)
    operation.add_argument('--verify', action='store_true')
    operation.add_argument('--verify-packages', action='store_true')
    args = parser.parse_args()
    if args.verify or args.verify_packages:
        try:
            verify_runtime(ROOT, args.backend, check_device=args.verify)
        except GpuDeviceError as error:
            print(error, file=sys.stderr)
            raise SystemExit(2) from None
    else:
        prepare_lock(ROOT, args.prepare.absolute(), args.backend)
