# Speech latency investigation, 27 October 2026

## Optional fast automatic recognition, 31 October 2026

Languages now offers **Fast auto / English, Russian and European languages** separately from all-language Whisper automatic detection. It uses the existing pinned CPU Parakeet v3 ONNX model, with no draft or second-pass correction. English-only Parakeet v2 remains available and defaults are unchanged. The installer for this option downloads only its missing ASR dependencies and Parakeet assets, not Whisper. [NVIDIA's model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) lists the supported 25 languages; this does not mean arbitrary-language recognition.

Four-thread CPU checks of public and synthetic recordings gave 327 ms for 6.625 seconds of English and 295 ms for 6.36 seconds of Russian with Parakeet v3. Whisper automatic detection took 6,408 ms and 5,861 ms respectively. English v2 took 350 ms. These small warm-decoding measurements exclude endpoint pause, startup and microphone conditions.

The mixed recording exposed an important limitation: both automatic models omitted its Russian part when it was followed by English inside the same utterance. Therefore neither is advertised as reliable within-utterance code-switching. Prefer one language per utterance; mixed-language coverage remains future work. The interface warns about possible missing words. No speculative transcript is sent to compensate. Diagnostics now include a bounded numeric sample of final decode duration/audio length and the configured pause, without speech text or audio.

## Muted speech residency and cold inference

On PCs in the existing sequential-startup RAM class (up to 17 GiB), disabling
speech now releases the owned TTS worker instead of retaining its GPU/RAM allocation.
Text-only language choices receive the same treatment. Startup and the next model
request also clean up a leftover muted worker. Re-enabling speech or explicitly
previewing it prepares the voice again; this may require a cold start. Larger-memory
PCs retain the previous warm-mute behavior. Stop/start is serialized so a late stop
cannot terminate the next voice start, and a quick unmute/preview can win before
termination begins. This does not change voice weights, quality or language.

Before sending a conversation request, the desktop checks whether the selected
Qwen context is resident in Ollama. A missing/expired context is primed with one
token through the local provider, without OpenClaw tools or conversation writes.
A resident context is kept intact. This preparation has a separate diagnostic
phase and shares the existing total turn deadline; the first-text timer starts
after preparation, fresh screen context and routing. Fresh screen capture follows
model loading so a long cold start does not label an earlier frame as current.
Cancellation or preparation failure sends no user command to the agent. No failed
command is automatically replayed and no conversation is reset.

Regression coverage uses a real loopback provider, simulated process stop/start
races and isolated desktop verification. It does not establish latency on every
GPU or reproduce a remote user's memory pressure. In particular, a larger first-text
budget alone cannot correct slow prefill caused by severe system/GPU contention.

## Windows first-launch corrections

The latest issue #8 archive establishes Windows error 1455 while mapping the Turbo checkpoint: insufficient system commit/pagefile capacity, despite installed weights and a supported GTX 1650. The pinned Turbo T3 is now constructed on the meta device and populated with strict, assigned original FP32 tensors, avoiding the initialized duplicate of its large language backbone. Decoder, tokenizer, adapter, seed, watermark and inference remain native. This applies to every supported NVIDIA family; it is not a GPU-specific kernel patch.

Fresh-process checks on the developer PC reduced peak process commit from 10,246,725,632 to 8,095,412,224 bytes and peak working set from 6,742,003,712 to 3,006,492,672 bytes. Both loaded the same 427,380,131 T3 parameters in FP32 with the native tokenizer. A real CUDA/adapter synthesis check produced finite, non-silent 24 kHz audio. This does not establish success under every user's commit limit. If Windows still cannot allocate it, Capri presents an explicit paging-file/committed-memory message and records bounded memory figures instead of hiding the cause behind a generic startup failure. It never changes Windows virtual-memory settings itself.

Startup also considers available physical RAM, not just installed RAM, when selecting sequential preparation/muted-voice residency. Less than 6 GiB free activates the existing low-memory path without silently changing the selected model or closing other apps.

A Unicode installation folder exposed a native SentencePiece path limitation:
the process exited while opening its generated BPE vocabulary, before microphone
capture could start. The vocabulary stays inside the selected installation;
Windows workers now pass an ASCII relative filename from their installation cwd.
No short-name support, system locale change or model/data relocation is needed.
The actual desktop worker started Russian Parakeet v3 in 2.85 seconds afterward.

The pinned Parakeet v3 beam decoder also returned an empty transcript on a clear
6.36-second Russian recording, including without hotword bias. Native greedy
decoding returned ten words and word timing in 0.288 seconds on the same file.
Parakeet v3 language profiles now select greedy decoding; the English v2 and
Whisper routes retain their decoding settings. Related decoder failures are
tracked in the [upstream issue](https://github.com/k2-fsa/sherpa-onnx/issues/3267).

Voice startup now loads the selected language directly instead of loading and
warming English Turbo before replacing it with the multilingual backend. The
multilingual backend applies the configured CPU thread budget even when no
English model has been loaded. A local Russian service restart and readiness
check took 24.9 seconds including stopping the previous process; an authenticated
Russian synthesis produced 2.56 seconds of finite PCM in 3.72 seconds afterward.

Cold readiness waits are bounded at ten minutes, with owned-process exit checks
every five seconds and cancellation support. Language preparation uses the same
budget. The desktop marks the voice ready after selected-language preparation,
so queued speech cannot race the initial model switch. A voice set to off does
not start a voice model. Three synthetic-clock tests cover slow live startup,
process death, timeout and cancellation.

The source archive and refactored runtime use the same speech weights and most
of the same inference code. The large difference came from recognition mode and
GPU memory pressure, rather than a missing CUDA acceleration switch.

## Automatic speech recognition

Explicit English uses CPU Parakeet v2; supported European languages use v3.
Automatic recognition uses CPU Whisper large-v3-turbo int8 to preserve broad
language coverage. The wake gate remains Parakeet; no draft transcript was added.

In pinned faster-whisper 1.2.1, automatic recognition encoded the first audio
window once for language detection and again for transcription. The local
`SharedEncoderWhisper` aligns the terminal feature frame with the native
transcription window, then reuses the encoder output only for exactly matching
feature arrays. Later windows, mismatched inputs and explicit-language decoding
retain their native path. The one-utterance cache is cleared on success or error.
Language probabilities can change slightly because language detection now uses
the same terminal frame boundary as transcription.

| Recording        |  Before | Shared encoder | Result                         |
| ---------------- | ------: | -------------: | ------------------------------ |
| English, 6.625 s | 13.89 s |         7.55 s | Same transcript and word times |
| Russian, 6.36 s  | 15.14 s |         8.10 s | Same transcript and word times |

Beam size 5, word alignment, model precision, language selection on each utterance,
and the user's end-of-speech pause remain unchanged. Automatic recognition still
costs more than explicitly selecting a fast Parakeet language; this is a CPU
Whisper limitation. These are two paired examples, not a language-wide accuracy
evaluation or percentile estimate.

## Voice synthesis

The running English voice already had merged adapters, FP32 CUDA inference and
CUDA Graph enabled. Approximately 11.5 of 12 GB of VRAM was occupied by the LLM,
voice and other applications. Windows GPU counters showed shared memory use by
the model processes. Under this pressure, keeping the acoustic decoder on CUDA
made both speech-token generation and acoustic decoding slower.

For the benchmark's fixed English sentence producing 3.96 s of audio, the existing
GPU decoder took 7.67–7.84 s. After selecting the CPU acoustic decoder with the
transformer and CUDA Graph still on the GPU, the running service took 2.96–3.44 s.
Weights, adapter, seed, sampling settings, two acoustic steps and FP32 are retained.
CPU/GPU floating-point outputs are not promised to be bit-identical. Comparisons
of the CPU decoder before/after the memory-policy change produced identical PCM.

`decoderDevice: auto` now requires 2560 MiB of physical headroom before moving
acoustic weights to CUDA and reserves 1024 MiB afterward. Between phrases it
checks memory at most every five seconds, first releases inactive allocations,
and moves only the acoustic decoder to CPU if pressure persists. Promotion and
OOM recovery have a 30-second cooldown. The same policy applies to Turbo and
multilingual speech. Explicit CPU/CUDA preferences and OOM retry remain available.
The policy cannot reserve memory against other Windows applications; a sudden
allocation during a phrase can still cause a temporary slowdown.

The authenticated voice `/health` adds `decoderReason` and `cpuThreads` to make
device selection visible. No other application is stopped and no system GPU
power or driver setting is modified.

## Reproducing the measurements

Use the installed ASR Python environment, an existing short recording, and a ready
voice service. The commands neither send an LLM message nor play or save audio;
ASR output contains only language, timing and equality checks, not the transcript.

```powershell
.runtime/asr-venv/Scripts/python.exe tools/benchmarks/benchmark-speech.py asr --audio C:/path/sample.wav
.runtime/asr-venv/Scripts/python.exe tools/benchmarks/benchmark-speech.py voice --repeat 2
.runtime/asr-venv/Scripts/python.exe -m unittest tests.asr_languages_test tests.asr_recognition_test
.runtime/voice-training-venv/Scripts/python.exe -m unittest tests.voice_runtime_test
```

Samples were recorded on Windows and exclude cold loading, end-of-speech waiting,
LLM generation, playback and device latency.
