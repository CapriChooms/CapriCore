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
