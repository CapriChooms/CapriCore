# TTS reference memory — 0.6.3 measurements

These changes follow 0.6.2 and are verified for 0.6.3. Checkpoint sizes and measured process memory are reported separately below.

## Findings

Chatterbox reference conditioning ran outside inference mode. The pinned speaker encoder's `inference()` also calls its forward pass without disabling autograd. A cached speaker embedding could therefore retain the reference computation graph, its activations and encoder parameters after startup.

After conditioning, the runtime always synthesizes from the cached reference. Its waveform/speaker encoders were nevertheless kept resident. The pinned English Turbo safetensors headers contain:

| Reference-only component | Parameter bytes |
| ------------------------ | --------------: |
| S3 speech tokenizer      |     494,962,784 |
| S3 speaker encoder       |      27,723,856 |
| Separate voice encoder   |       5,694,472 |
| Total                    |     528,381,112 |

That is approximately 0.49 GiB of reference-only parameter data, before intermediate activations. Reading these small headers does not load a model. Releasing those tensors does not establish an equal reduction in Windows working set or private memory; allocators and shared/file-backed pages affect those readings.

## Local changes

- Freeze inference parameters before preparing the reference, run preparation in `torch.inference_mode()` and detach cached conditioning tensors.
- For the explicitly recognized decoder layout, replace it with a reference-free inference subclass retaining the same acoustic modules, buffers, precision and native inference methods. Its device follows the acoustic flow rather than the removed tokenizer. Unexpected layouts keep their original decoder; a new reference requires rebuilding the voice backend.
- Keep one canonical Turbo reference dictionary across decoder device transfers, instead of retaining an obsolete CPU dictionary in `engine.conds.gen`.
- Freeze Qwen's inference model and prepare its clone prompt in inference mode. Qwen's CPU weights remain resident; this change does not quantize them.
- Include a bounded reference-encoder release receipt in voice health diagnostics. It reports tensor bytes removed, not claimed RAM savings.

No model weights, adapter, reference recording, output sample rate, generation preset or decoder precision is changed. CPU/GPU placement thresholds remain unchanged. The training backend keeps its encoders and gradient behavior.

## Verification

The reference-memory, runtime and health suites passed 21 tests. The related training, provisioning, catalogue, import, compatibility, profile, startup-failure, shutdown and multilingual-provision suites passed another 30 tests.

A separate offline fixture loaded one native Turbo model on CPU with two threads, the public Capri adapter/reference and unchanged FP32 weights. It generated the same short test phrase before and after the production cleanup helper. The installed native decoder passed the layout guard; its old encoder objects were collected, and its cached reference changed from having an autograd graph to having none. The helper reported 528,381,116 released tensor bytes, including a small buffer. Conditioning tensors, generated speech tokens and all 22,080 PCM samples at 24 kHz were bit-identical. No server, microphone, playback device, GPU workload or owner settings were used.

For process-memory comparison, two additional fresh processes ran sequentially: the original reference path and the optimized path, each followed by the same synthesis and garbage collection. Both produced the same PCM hash.

| Whole isolated process, after synthesis |     Original |    Optimized |  Reduction |
| --------------------------------------- | -----------: | -----------: | ---------: |
| Private bytes                           | 4,981.25 MiB | 4,017.65 MiB | 963.60 MiB |
| Working set                             | 3,563.82 MiB | 2,755.25 MiB | 808.57 MiB |
| Peak working set                        | 3,563.82 MiB | 3,235.14 MiB | 328.68 MiB |

These are one controlled CPU fixture pair, including Python and its libraries, not a guarantee for every language, GPU, memory allocator or sentence length. They do not establish a synthesis-speed improvement. In the initial same-process differential, immediate private/working-set usage did not decrease after cleanup, despite released encoder objects and tensors; retained allocator/backend memory and later allocation reuse make that snapshot unsuitable as a direct savings claim. No working-set trimming was used.

This CPU-only native fixture validates conditioning and decoding equivalence; it does not add production CPU support for Capri's Chatterbox runtime or establish GPU memory savings.

## Limits and further verification

On a GPU with limited free VRAM, the acoustic decoder deliberately runs on CPU. Its live weights, working buffers and the Python/PyTorch runtime still require RAM. Forcing GPU placement can cause Windows GPU paging rather than save system memory. Working-set trimming would only evict pages and is not used as an optimization.

The pool already releases the previous backend before constructing another. Muting voice also releases its owned process when it is no longer needed; neither behavior is replaced with per-sentence unloading.

The passing regression fixtures cover conditioning without autograd, exact reuse of acoustic parameters, known-layout pruning, cached-reference inference and unknown-layout fallback. Further hardware verification should cover the normal GPU token path, decoder CPU fallback and language changes, using equivalent voice/context/placement settings. Keep the distinction between final RAM, peak loading RAM and system-wide usage.
