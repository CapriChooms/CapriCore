# Voice GPU runtime selection

Capri's currently supported trained-voice runtime needs a compatible NVIDIA GPU,
driver and PyTorch build. This is the current implementation's supported backend,
not an inherent NVIDIA-only restriction of the voice model. AMD/CPU backends and
NPU acceleration are future qualification work; see [CAP-06A in the roadmap](../ROADMAP.md#cap-06a--amd-gpu-cpu-and-npu-voice-backends--p2-for-amdcpu-exploratory-for-npus).
A true `torch.cuda.is_available()` only proves that CUDA can discover the device; it does
not prove that the installed wheel contains working kernels for that architecture.

The reported RTX 5060 Ti failure was confirmed as `sm_120` with PyTorch 2.6.0/cu124,
followed by `no kernel image is available for execution on the device`. The voice
profile and adapter checksum matched. This was a wheel-architecture failure.

Setup now chooses a pinned family using NVIDIA compute capability (with an RTX 50
name fallback for older inventory tools). CUDA_VISIBLE_DEVICES limits the selected
devices when specified. Legacy GPUs retain torch/torchaudio 2.6.0+cu124. Blackwell
uses torch/torchaudio 2.7.1+cu128 and sympy 1.14.0. The remaining dependency pins,
Chatterbox/Perth source commits, model revision, trained adapter, reference audio
and FP32 inference policy are unchanged. Profile metadata is in config/voice-runtime.json.

## Windows NVIDIA coverage

| GPU family                                       | Compute capability    | Selected voice runtime |
| ------------------------------------------------ | --------------------- | ---------------------- |
| GTX 10xx / Pascal (including GTX 1050–1080 Ti)   | 6.1                   | PyTorch 2.6.0 / cu124  |
| GTX 16xx and RTX 20xx / Turing                   | 7.5                   | PyTorch 2.6.0 / cu124  |
| RTX 30xx / Ampere                                | 8.6                   | PyTorch 2.6.0 / cu124  |
| RTX 40xx / Ada                                   | 8.9                   | PyTorch 2.6.0 / cu124  |
| RTX 50xx / Blackwell (including laptop variants) | 12.0                  | PyTorch 2.7.1 / cu128  |
| Quadro P / Quadro RTX / RTX A / RTX Ada          | 6.1 / 7.5 / 8.6 / 8.9 | PyTorch 2.6.0 / cu124  |
| RTX PRO Blackwell                                | 12.0                  | PyTorch 2.7.1 / cu128  |

This is CUDA architecture coverage, not a promise that every card can fit the
voice and language models at once. Older low-VRAM cards require a smaller Qwen
model and may lack enough memory for the current voice backend. A compatible
driver is still required. CUDA Graph is optional and falls back to ordinary
inference if capture fails; decoder placement accounts for available VRAM.
There is no mandatory Tensor Core, BF16 or Flash Attention requirement for the
trained English voice, which retains FP32 inference.

The checked Windows wheels contain sm_61 (Pascal), sm_75 (Turing), sm_86
(Ampere), and sm_90 kernels; the modern wheel additionally contains sm_100 and
sm_120. Ada sm_89 can run sm_86 cubins through NVIDIA's documented same-major
forward compatibility, so absence of an exact sm_89 string is not an error.
Tests cover selection for 28 representative desktop, laptop and professional
GPUs, and CUDA preflight behavior for each architecture family. These are
device-free regression tests; they do not replace physical testing on each GPU.

The modern profile applies reviewed dependency overrides for Chatterbox's upstream
torch/torchaudio 2.6 requirements and its moving Perth reference. It uses uv's exact
install with the complete lock and overrides; legacy setup retains pip sync.
Both use the explicit PyTorch backend, PyPI for other packages and first-index
resolution. Ambient index/override constraints are cleared for this operation.
There is no installation of GPU drivers or a global CUDA Toolkit.

Doctor and voice startup validate actual CUDA arithmetic and matrix operations.
An unsupported Blackwell/cu124 pair is rejected before loading large models.
Installation cannot report voice readiness solely from CUDA device discovery.
Out-of-memory, driver/DLL and kernel failures retain their technical diagnostics.

For an existing installation, use Capri's update function. A changed voice lock,
runtime profile or setup selector synchronizes the existing voice environment via
setup-voice-training.ps1 -DependenciesOnly. It preserves the trained voice, base
weights, settings and history; this dependency repair does not retrain or provision
model weights. The new PyTorch wheel is about 3 GiB, so a first repair needs a
substantial download. Running the new installer or setup-voice-training.cmd also
selects the hardware profile automatically. Close Capri before manual environment
maintenance. Advanced checks can explicitly use -VoiceRuntime legacy or blackwell.

CI checks both real dependency resolutions without a GPU or speech-model weights,
alongside device-free selection/CUDA failure tests and updater dependency-repair
coverage. CUDA inference on a compatible developer GPU tests the modern stack;
the reporter's physical RTX 5060 Ti still needs post-update confirmation.

Sources: [PyTorch 2.7 Blackwell support](https://pytorch.org/blog/pytorch-2-7/),
[official Windows/Linux wheel commands](https://pytorch.org/get-started/previous-versions/),
[NVIDIA current capabilities](https://developer.nvidia.com/cuda/gpus),
[NVIDIA legacy capabilities](https://developer.nvidia.com/cuda/gpus/legacy),
[NVIDIA Ada binary compatibility](https://docs.nvidia.com/cuda/ada-compatibility-guide/index.html).
