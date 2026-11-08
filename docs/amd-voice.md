# AMD voice on Windows (experimental)

Capri 0.4.4 adds an **experimental native ROCm speech runtime**, preserving the
same Capri adapter, reference and English Turbo model. Supported multilingual
speech uses its existing model. This is GPU execution through PyTorch HIP; it is
not CPU synthesis advertised as AMD acceleration and is not a new voice model.

The pinned qualification target is **Windows 11 x64, Python 3.12.12, PyTorch /
TorchAudio 2.9.1 with ROCm 7.2.1**, AMD Adrenalin **26.2.2 or newer**, and sufficient
free GPU/system memory. The official Radeon matrix lists RX 9070 / 9070 XT,
RX 9060 XT, RX 7900 XTX, RX 7700, Radeon AI PRO R9700 and PRO W7900 / Dual Slot.
Other Radeon models, integrated graphics, Windows 10 and NPUs are not qualified
by this runtime. Do not spoof a GPU architecture to bypass the installer check.

Setup automatically selects this profile when a supported Radeon is detected
and NVIDIA is absent. To select explicitly from the installation folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/setup/setup-voice-training.ps1 -VoiceRuntime amd
```

Install the proper AMD driver yourself; Capri never modifies driver or Windows
security settings. This runtime is for inference, not voice training. Install
the included voice through Setup or Languages as usual; GPU dependencies alone
do not install the base weights or the voice adapter.

The AMD profile has its own reviewed requirements and override files, using
official `repo.radeon.com` artifacts. It gets a separate owned Python 3.12 while
ASR/router retain Python 3.11. If the active speech environment uses the wrong
Python series, the previous environment is moved to `venv-recovery` before a new
one is created. Do not run CUDA and AMD voice installers concurrently. Switching
profiles does not erase model downloads, the exported adapter or personal memory.

HIP deliberately uses PyTorch's `torch.cuda` API. Capri checks `torch.version.hip`
before applying NVIDIA architecture gates, querying nvidia-smi or enabling CUDA
Graphs. On AMD, inference uses the native eager FP32 English path; decoder placement
still follows memory headroom. Real arithmetic and matrix kernels are checked
before loading the voice. A successful `is_available()` alone is insufficient.

The dependency set installed successfully in a fresh Python 3.12 environment;
Torch/TorchAudio ROCm and Chatterbox Turbo imports passed. HIP/CUDA branching is
regression-tested. The pinned `custom` SDK bundle also avoids the upstream
offload-arch trampoline's path-with-spaces problem without spoofing a GPU ISA.
**There is no AMD GPU in the development
PC: end-to-end synthesis, audio parity, memory consumption and speed on Radeon
remain unverified.** Please include a diagnostic ZIP for AMD failures. Keep this
feature experimental until those checks pass on each supported architecture.

Primary references:

- [Pinned AMD Windows compatibility matrix](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/compatibility/compatibilityrad/windows/windows_compatibility.html)
- [Official AMD installation and wheel URLs](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/install/installrad/windows/install-pytorch.html)
- [AMD Windows limitations](https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/limitations/limitationsrad.html)
- [PyTorch HIP semantics](https://docs.pytorch.org/docs/stable/notes/hip.html)
