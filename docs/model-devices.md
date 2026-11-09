# Language and voice devices

Open **Settings → Language model → Model devices**. Language generation and voice
generation have independent selectors: **Automatic**, **CPU**, or a GPU exposed
by the installed backend. Save and restart Capri to activate a new selection.
The current API connection, model files, history and memory are retained. A local
device choice does not move an external API onto the user's hardware or start a
local language model while API mode is active.

The language selector uses the shipped llama backend's own device enumeration.
CUDA, ROCm and Vulkan ordinals are not Windows Task Manager adapter numbers.
Backend names distinguish multiple ways to use a card. Voice discovery checks the
selected voice model's installed PyTorch environment and a tiny arithmetic kernel;
it does not download or load voice weights. A CPU-only Qwen environment therefore
does not advertise a GPU it cannot use. Missing environments or incompatible GPUs
are shown with an explanation rather than a selectable, nonfunctional shortcut.

Manual selections restrict only that service's child process. Ollama visibility
does not restrict the voice worker. CPU selection disables GPU visibility and uses
CPU inference; it does not mean moving only the acoustic decoder to CPU while
leaving the speech transformer on a GPU. Turbo and Multilingual use FP32 for CPU
inference. Existing GPU precision and decoder VRAM protections remain intact.
Automatic Qwen voice retains its existing CPU default. Training retains its own
supported backend; these selectors concern inference.

Discovery runs on demand in Settings and when validating a manual GPU at service
launch, never before each reply or on a continuous monitoring timer. Choices are
stored in `data/desktop/model-devices.json`, with a strict schema and atomic writes.
They contain no credentials. CPU/automatic launches need no device-discovery
subprocess. Restart transactions also update the managed gateway generation
settings so an old `num_gpu: 0` cannot defeat a later GPU selection.

Selections bind a backend ordinal to the reported device name. A missing or
reordered differently named adapter is rejected rather than silently choosing
another GPU. After hardware/driver changes, refresh and reselect the intended
adapter. Identical cards cannot always be distinguished by the native language
backend's name/ordinal inventory. Voice workers additionally use a CUDA UUID when
the installed PyTorch build supplies it, avoiding the wrong physical card's NVML
memory budget after CUDA remaps the selected device to `cuda:0`.

CPU mode saves VRAM but consumes system RAM and can be substantially slower.
Selecting a GPU does not promise complete offload: model size, context size,
driver support and available VRAM still constrain placement. NVIDIA/AMD mixed
systems do not gain unsupported PyTorch kernels from a device selector. Unsupported
AMD voice hardware can use CPU inference with an installed compatible voice
environment, or a supported GPU backend.

## Validation

- Actual isolated Ollama inference, 0.8B model and 32K context: CPU selection
  reported zero resident GPU bytes; selecting CUDA reported GPU residency.
- Actual trained Capri Turbo synthesis: CPU transformer and decoder produced
  non-silent 24 kHz PCM. GPU selection produced non-silent 24 kHz PCM with both
  stages on the selected CUDA worker. Conditioning encoders stay on CPU until
  reference preparation finishes, preventing CPU/GPU tensor mismatches.
- Regression tests cover independent persistence, CPU/GPU switching, stale and
  unavailable choices, mixed CUDA/HIP/Vulkan visibility, parent environment
  isolation, and CPU-only voice inference without CUDA calls.
- `node tools/verify/verify-model-devices.mjs` checks the real component in
  Electron, including independent selections, red unavailable-device explanations,
  Russian/English text and narrow/wide layouts. This component fixture does not
  restart models or write real user preferences.

Physical testing used one NVIDIA card. Multiple and mixed AMD/NVIDIA cards are
covered by deterministic routing/visibility fixtures; physical qualification of
those configurations remains necessary.

The broader desktop verification fixture also hits an existing avatar-centering
assertion, reproduced with the pre-change UI/main files. The device component
checks pass; this work does not alter avatar positioning.

Backend references: [Ollama GPU selection](https://github.com/ollama/ollama/blob/v0.40.10/docs/gpu.mdx),
[Ollama device environment handling](https://github.com/ollama/ollama/blob/v0.40.10/ml/device.go),
[PyTorch CUDA semantics](https://docs.pytorch.org/docs/stable/notes/cuda.html),
[PyTorch HIP semantics](https://github.com/pytorch/pytorch/blob/main/docs/source/notes/hip.rst).
