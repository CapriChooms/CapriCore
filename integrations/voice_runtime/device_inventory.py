# SPDX-License-Identifier: GPL-3.0-only
"""Metadata and tiny kernel checks. No models, audio, prompts or downloads."""
import json
import torch


def inventory():
    backend = 'rocm' if getattr(torch.version, 'hip', None) else 'cuda'
    devices = []
    for ordinal in range(min(torch.cuda.device_count(), 64)):
        item = torch.cuda.get_device_properties(ordinal)
        uuid = getattr(item, 'uuid', None)
        available = True
        try:
            value = torch.eye(4, device='cuda:' + str(ordinal), dtype=torch.float32)
            available = float((value @ value).sum().item()) == 4.0
            del value
        except Exception:
            available = False
        devices.append(dict(ordinal=ordinal, name=item.name,
                            totalBytes=item.total_memory, uuid=str(uuid) if uuid else None,
                            available=available))
    return dict(backend=backend, devices=devices)


if __name__ == '__main__':
    print(json.dumps(inventory()))
