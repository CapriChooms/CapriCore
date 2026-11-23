# Installer memory estimates after the 1.0.5 optimizations

The wizard and runtime share `config/memory-estimates.json`. These are planning
ranges for normal resident operation with the selected components enabled, not
download sizes, Windows commit limits or peak loading allocations. Speech still
starts disabled. Loading, long audio and image processing may peak higher.

## Calibration

Separate local processes used cached pinned models, one conversation at 32K,
flash attention and the production `q8_0` KV cache. The memory embedding model
was explicitly CPU-only. No user conversation or microphone was used.

| Component                             | Observed allocation / working set                         |
| ------------------------------------- | --------------------------------------------------------- |
| Qwen3.5 2B, GPU                       | 2.49 GiB reported model VRAM; 1.09 GiB runner working set |
| Qwen3.5 2B, CPU                       | 2.86 GiB runner working set                               |
| Qwen3.5 9B, GPU                       | 5.74 GiB reported model VRAM; 1.10 GiB runner working set |
| Qwen3.5 9B, CPU                       | 6.87 GiB runner working set                               |
| CPU memory embeddings                 | 1.19 GiB runner working set; zero reported model VRAM     |
| English Turbo, after speech           | 1.74 GiB working set; 2.63 GiB CUDA reserved              |
| English Turbo, CPU acoustic decoder   | 2.26 GiB working set; 2.03 GiB CUDA reserved              |
| Multilingual v3, after speech         | 2.07 GiB working set; 1.68 GiB CUDA reserved              |
| Multilingual v3, CPU acoustic decoder | 2.55 GiB working set; 1.07 GiB CUDA reserved              |

TTS used the reviewed Capri adapter/reference and the current production loading,
reference cleanup, precision and inference paths. Short public test phrases were
synthesized in memory without playback. CUDA reserved includes allocator buffers;
Ollama model VRAM excludes some driver overhead, so the planning ranges retain
headroom. Working set is not private committed memory. These measurements do not
guarantee the same result on another driver or hardware configuration.

The multilingual loader briefly peaked at about 6.84 GiB working set, then settled
after synthesis. That is precisely why loading peaks are not presented as normal
resident consumption. Other unmeasured model/recognition ranges remain conservative.

## Calculation changes

- The base no longer reserves a large GPU allowance for CPU memory embeddings.
- Calibrated Qwen 2B/9B and voice ranges reflect the optimized runtime, including
  FP16 multilingual T3 and released reference-only encoders.
- With low free VRAM, the voice acoustic decoder stays on CPU, following the
  runtime's 2.5 GiB promotion threshold. Its RAM and GPU-backbone allocation are
  accounted for separately. CPU-only voice never contributes fake VRAM.
- A remaining VRAM shortage adds only proportional potential LLM spill to RAM.
  A full spill replaces the existing host allowance instead of adding another
  complete CPU copy on top of it. Real shortages remain visible.
- A CPU/GPU utilization percentage does not reduce weights or KV residency and
  is deliberately not used to scale memory estimates.
- Native labels preserve tenths of a GiB. The previous integer overload rounded
  values such as 6.7–14.8 into 7.0–15.0, including the remaining-memory figures.

For example, Qwen 9B with Russian recognition/voice and the CPU classifier, on a
12 GiB card with 10.5 GiB free, estimates **6.7–14.8 GiB RAM** and
**7.6–9.8 GiB VRAM**. That includes CPU acoustic decoding at the upper bound;
it no longer adds a full 12 GiB CPU model simply because of a small GPU shortage.
Profile hardware recommendations are unchanged and remain distinct from a memory
consumption estimate.

Regression tests cover small/full spill, adaptive voice placement, CPU-only voice,
unknown free capacity, real shortages and parity between the native pre-Node wizard
and JavaScript. The information tooltip explains normal use versus loading peaks
in all 50 installer languages.
