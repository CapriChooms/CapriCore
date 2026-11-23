"""Small, real CUDA preflight. Importing this module does not import torch."""


def cuda_preflight(torch):
    hip = getattr(torch.version, 'hip', None)
    report = {'available': bool(torch.cuda.is_available()), 'kernelReady': False,
              'backend': 'rocm' if hip else 'cuda',
              'torch': str(torch.__version__), 'runtime': hip or torch.version.cuda}
    if not report['available']:
        report['error'] = 'GPU compute is unavailable. Install the compatible NVIDIA CUDA or experimental AMD ROCm voice runtime and driver.'
        return report
    try:
        report['device'] = torch.cuda.get_device_name(0)
        report['capability'] = list(torch.cuda.get_device_capability(0))
        report['compiledArchitectures'] = torch.cuda.get_arch_list()
        runtime = tuple(int(v) for v in (torch.version.cuda or '0.0').split('.')[:2])
        if not hip and report['capability'][0] >= 10 and runtime < (12, 8):
            raise RuntimeError('This Blackwell/RTX 50 GPU requires the Capri blackwell voice runtime (PyTorch 2.7.1 / CUDA 12.8). Update Capri or rerun setup-voice-training.cmd; automatic hardware selection will repair its voice environment.')
        # is_available() alone passed on RTX 5060 Ti with incompatible cu124 wheels.
        value = torch.arange(16, device='cuda:0', dtype=torch.float32)
        if float(((value + 1) * 2).sum().item()) != 272.0:
            raise RuntimeError('CUDA arithmetic validation failed')
        matrix = torch.eye(4, device='cuda:0', dtype=torch.float32)
        if float((matrix @ matrix).sum().item()) != 4.0:
            raise RuntimeError('CUDA matrix validation failed')
        torch.cuda.synchronize()
        report['kernelReady'] = True
    except Exception as exc:
        report['error'] = f'{type(exc).__name__}: {exc}'
    return report


def require_cuda(torch):
    report = cuda_preflight(torch)
    if not report['kernelReady']:
        raise RuntimeError(report.get('error', 'CUDA voice preflight failed'))
    return report


def qwen_gpu_ready(torch, device):
    try:
        if not torch.cuda.is_available():
            return False
        if not getattr(torch.version, 'hip', None) and torch.cuda.get_device_capability(device)[0] < 8:
            return False
        matrix = torch.eye(4, device=device, dtype=torch.bfloat16)
        return float((matrix @ matrix).sum().item()) == 4.0
    except (RuntimeError, ValueError, AssertionError, OSError):
        return False


def qwen_compute(torch, requested, automatic, minimum_gib):
    if requested == 'cpu':
        return 'cpu', 'configured voice device'
    candidates = (
        (f'cuda:{index}' for index in range(torch.cuda.device_count()))
        if automatic else (requested,)
    )
    for device in candidates:
        try:
            if (torch.cuda.mem_get_info(device)[0] >= minimum_gib * 1024 ** 3
                    and qwen_gpu_ready(torch, device)):
                backend = 'AMD ROCm' if getattr(torch.version, 'hip', None) else 'NVIDIA CUDA'
                return device, backend
        except (RuntimeError, ValueError, AssertionError, OSError):
            continue
    if automatic:
        return 'cpu', f'GPU unavailable or less than {minimum_gib} GiB of free VRAM'
    raise RuntimeError(f'The selected voice GPU is unavailable or has less than {minimum_gib} GiB of free VRAM')
