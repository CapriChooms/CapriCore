"""Prepare resumable CUDA wheel downloads for the pinned Chatterbox installer."""
# SPDX-License-Identifier: GPL-3.0-only
import argparse
from importlib.metadata import PackageNotFoundError, version
import json
from pathlib import Path
import re
from integrations.model_download import _regular_path, download_verified, emit_installer_transfer


ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ('torch', 'torchaudio')
SIZES = {
    'legacy': (2532350702, 4163304),
    'blackwell': (3273066072, 4660477),
}


def installed(profile, package_version=version):
    try:
        return all(package_version(package) == profile[package] for package in PACKAGES)
    except PackageNotFoundError:
        return False


def prepare(root, profile_name, requirements, overrides=None, *, download=download_verified, emit=print):
    profile = json.loads((root / 'config/voice-runtime.json').read_text(encoding='utf-8'))['profiles'][profile_name]
    if installed(profile):
        return
    constraints = (root / profile['transportConstraints']).read_text(encoding='utf-8').splitlines()
    packages = [line.split(' @ ', 1) for line in constraints if line and not line.startswith('#')]
    if [fields[0] for fields in packages] != list(PACKAGES):
        raise ValueError('Invalid Chatterbox wheel pins.')

    sources = [(requirements, profile['requirements'])]
    if overrides is not None:
        sources.append((overrides, profile['overrides']))
    locks = {}
    for lock, template in sources:
        _regular_path(lock)
        if lock.parent != root / '.runtime/voice-training-venv' or not re.fullmatch(
            r'chatterbox-(?:requirements|overrides)-[a-f0-9]{32}\.txt', lock.name
        ):
            raise ValueError('Invalid prepared Chatterbox dependency path.')
        locks[lock] = (root / template).read_text(encoding='utf-8').splitlines()

    completed = 0
    sizes = SIZES[profile_name]
    total = sum(sizes)
    for (package, pinned), size in zip(packages, sizes, strict=True):
        filename = f'{package}-{profile[package]}-cp311-cp311-win_amd64.whl'
        location = f'/whl/{profile["backend"]}/{filename.replace("+", "%2B")}'
        alternate = 'https://download.pytorch.org' + location
        url, separator, digest = pinned.partition('#sha256=')
        if url != alternate or not separator or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Invalid Chatterbox wheel source or checksum.')
        pin = f'{package}=={profile[package]}'
        if any(lines.count(pin) != 1 for lines in locks.values()):
            raise ValueError('The reviewed Chatterbox dependency pin changed.')

        def report(stage, received):
            if stage in ('connect', 'download'):
                emit_installer_transfer(filename, received, size, (completed + received) / total, emit=emit)

        emit(f'Downloading {package} ({size / 1e9:.2f} GB pinned wheel)', flush=True)
        target = root / '.runtime/uv-cache/capri-chatterbox-wheels' / filename
        for candidate in (target, target.with_suffix('.whl.partial')):
            _regular_path(candidate)
            if candidate.exists() and candidate.stat().st_nlink != 1:
                raise ValueError('Chatterbox wheel staging cannot use hard-linked files.')
        wheel = download('https://download-r2.pytorch.org' + location, target,
                         {'bytes': size, 'sha256': digest}, fallback_urls=(alternate,),
                         attempts=4, timeout=30, progress=report, emit=emit)
        report('download', size)
        completed += size
        for lines in locks.values():
            lines[lines.index(pin)] = f'{package} @ {wheel.as_uri()}#sha256={digest}'

    for lock, lines in locks.items():
        with lock.open('x', encoding='utf-8') as file:
            file.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', choices=SIZES)
    parser.add_argument('requirements', type=Path)
    parser.add_argument('--overrides', type=Path)
    args = parser.parse_args()
    prepare(ROOT, args.profile, args.requirements, args.overrides)
