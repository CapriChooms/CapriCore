# Hardware policy

## RAM, VRAM and storage

| Resource       | What it is                                                | Where to check it                                                                         | What Capri uses it for                                                                 |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| RAM            | Main system memory, typically installed as memory modules | Task Manager → Performance → Memory                                                       | The app, CPU recognition, text/voice runtimes, CPU-offloaded model weights and context |
| Dedicated VRAM | Memory on one graphics card                               | Task Manager → Performance → GPU → Dedicated GPU memory; NVIDIA detection uses nvidia-smi | GPU model weights, inference and voice acceleration                                    |
| Disk space     | Free storage on the selected SSD or drive                 | File Explorer → This PC                                                                   | Downloads, models, package caches, runtimes and personal data                          |

These are independent resources. **16 GB RAM + 8 GB VRAM is not 24 GB RAM**.
Shared GPU memory usually borrows system RAM; it is not an extra memory module or
equivalent to dedicated VRAM. Two graphics cards are not counted as one larger
card. Available memory is lower when the OS, games, browsers or editors use it.

Model weights use dedicated VRAM when Ollama fully offloads inference to a
supported GPU. CPU inference stores them in RAM; partial offload uses both.
In the next build, the GPU-path system RAM targets and the more conservative CPU-fallback targets
are separate: see the model and optional-component tables in [README](../README.md#hardware-profiles).
For example, 16 GiB RAM with a supported 12 GiB GPU is eligible for Qwen 9B.
The CPU fallback target of 32 GiB RAM is not imposed on that GPU configuration.
Voice, recognition, other apps and the selected context may still make the
combined selection too large for currently free memory.

Capri can allow a small bounded hardware-reservation difference between installed
and OS-reported usable RAM. This does not turn dedicated VRAM, shared graphics
memory or a paging file into additional physical RAM. Disk budgets shown by setup
are separate and depend on the selected speech and text components. Leave memory
headroom for voice, context and other applications; use the smaller profile when
the computer is already under load.

## Installer memory budget (next build)

The model selector lists approximate **text-model VRAM consumption** and the
system RAM target for the detected GPU/CPU configuration. The fixed memory panel
stays visible as the component list scrolls. It recalculates on model, voice,
conversation language, recognition and CPU-classifier changes. English and
multilingual speech have separate ranges.

Each RAM/VRAM bar shows memory already occupied in gray, the upper end of the
selected Capri estimate in teal, and unused capacity in the light background.
Orange means the estimate exceeds the free-memory snapshot (or even total capacity
when free memory is unknown). The numerical
remaining range is clamped to zero on screen; a shortage is warned about rather
than presented as extra capacity. Refresh memory takes a new snapshot without
loading any AI model. Estimates are for all selected components **when enabled**;
microphone and voice still start off. Unticking a download excludes it from this
selection estimate, but does not delete or unload components in an existing install.

The common estimate catalog uses the bundled quantized models, one active
conversation and 32768 context tokens. The base allowance covers the app/core,
renderer and transient memory retrieval; text host allocations, voice, recognition
and the classifier are added separately. If GPU demand exceeds free VRAM, the
RAM upper bound also includes a conservative CPU-offload allowance. This is not
a prediction of Ollama's exact placement or a promise that every selected model
will run simultaneously. Model loading, image analysis, long audio, drivers and
different context lengths can exceed these ranges.

No dedicated-memory probe means **unknown**, not zero or a made-up capacity.
The estimate then uses the conservative CPU text path, and shows unknown GPU
headroom. One GPU is selected by largest confirmed dedicated capacity; cards are
not summed. For shared-memory graphics, CPU and GPU compete for system RAM.

## Detection and execution policy

Text inference, speech, recognition and visuals are independent capabilities. An Ollama GPU probe is not proof that PyTorch CUDA or a trained voice works.

The planner uses RAM, available CPU capacity and confirmed dedicated VRAM. It does not use Win32_VideoController.AdapterRAM: values can be truncated or shared. NVIDIA memory is queried through nvidia-smi. Unknown AMD/Intel memory stays unknown until an authoritative provider probe is added. Two 6 GiB cards are never treated as one 12 GiB card. Missing probes select conservative text profiles.

Small CPU models trade quality/tool reliability and latency for lower memory. Context stays at least 8192 because the current compaction contract requires it. ASR/TTS inference threads are capped by the configured budget and CPU capacity. Heavy optional speech consumes additional resources. Background applications can still make a recommended model unsuitable.

Only the current Windows/NVIDIA installation can be physically checked here. CPU-only, AMD/Intel unknown-memory, multi-GPU and low-RAM decisions are fixture-tested, not physical benchmarks. Below 8 GiB RAM is outside the first supported profile. Other desktop OSes and ARM64 remain unqualified.

On machines with up to 17 GiB reported physical RAM, desktop startup and wake
prepare the core, recognition and voice sequentially to avoid simultaneous model
loading/import peaks. Larger machines retain parallel startup. Low-memory,
minimal-profile and explicitly CPU-only setups allow up to 120 seconds for first
model text and 300 seconds for the complete turn; other setups retain the 30/180
second budgets. These are failure bounds, not deliberate delays. Context capture
and CPU routing consume the overall budget, not the first-text budget. Silent
keepalives cannot extend it, and timed-out actions are never replayed automatically.
Cold agent warmup is allowed 180 seconds on those slower setups; a failed warmup
is reported as a failed startup stage. Diagnostic session metadata includes the
failure phase and timing without conversation text.

Actual text offload depends on installed backends and drivers: see [Ollama hardware support](https://docs.ollama.com/gpu), [CPU/GPU placement](https://docs.ollama.com/faq#how-can-i-tell-if-my-model-was-loaded-onto-the-gpu) and [context memory use](https://docs.ollama.com/context-length). Model variants are in the [Qwen3.5 catalog](https://ollama.com/library/qwen3.5/tags). AI-engine versions were not upgraded for this memory-planning change.
