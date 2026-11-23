# Capri — Product and Release Roadmap

Updated 2026-11-08 against the public **1.0.0** release in
[CapriChooms/CapriCore](https://github.com/CapriChooms/CapriCore).
The delivery order below takes precedence over older planning notes. Dated
implementation notes describe the evidence available at that checkpoint; an
unchecked item can include a shipped subset whose full acceptance criteria
remain open. The [v0.3.7 polish review](docs/plans/next-version-polish.md) is historical.

Capri is a responsive Windows companion with expressive speech and animation,
shared conversation and memory across supported interfaces, and user-controlled
access to desktop actions.

## Current baseline

- **Desktop and speech.** Electron companion with framed and desktop modes, teleport effects, independent mouth animation, music/BPM reactions, compact controls, tray operation, reminders and resource monitoring. The interface has 50 offline languages. Recognition and voice start off; Chatterbox and the Qwen3-TTS CPU beta have separate language/device limits. [Languages](docs/languages.md) · [Music listening](docs/music-listening.md)
- **Inference and memory.** Bundled local models, Hugging Face GGUF imports and saved OpenAI-compatible API profiles; configurable context, OpenClaw compaction, local hybrid recall, a saved-memory viewer, a document knowledge folder and a separate password-protected memory box. Budgeted free-form tagged recall and shorter maintenance stalls remain future work. Ordinary history and memory are not fully encrypted. [Context management](docs/context-management.md) · [External API](docs/external-api.md) · [Security](SECURITY.md)
- **Perception and actions.** Opt-in screen observation, scoped files/apps, Discord and Spotify actions, computer control, recorded workflows and isolated user tools. Computer control remains beta: real-application reliability and long combined tasks need continuing qualification. [Screen observation](docs/screen-observation.md) · [Computer control](docs/computer-control.md) · [User tools](docs/user-tools.md)
- **Distribution.** Public Windows x64 installer, SHA-256 build/source manifests, anonymous update checks, optional experimental releases and selective uninstall. The former private updater needs a one-time full-installer migration. Main is protected and contributions use pull requests. Signing and broader clean-machine/hardware coverage remain open. [1.0.0 release notes](docs/releases/1.0.0.md) · [Updates](docs/updates.md) · [Installation wizard](docs/installation-wizard.md)

## Priorities and delivery order

- **P0 — Foundation or release gate:** required for a reliable supported release.
- **P1 — Core product improvement:** the next set of user-facing capabilities.
- **P2 — Expansion:** introduce after the dependencies and quality checks are ready.

| Order         | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                            | Exit condition                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next · P0     | Measure long-chat stalls and move routine compaction out of the reply path. [CAP-07](#cap-07--measured-performance-improvements--ongoing-p0) · [CAP-12A](#cap-12a--responsive-context-compaction--p0)                                                                                                                                                                                                                  | Local and API chat survive context pressure. Timings separate compaction from provider wait. History and unfinished requests survive cancellation. |
| Then · P1     | Pilot budgeted recall, add free-form tags, and expose memory controls. [CAP-12B](#cap-12b--tagged-long-term-memory--p1)                                                                                                                                                                                                                                                                                                | Capri retrieves the correct fact from a crowded category within a fixed prompt budget, with local indexing and per-provider sharing controls.      |
| Parallel · P0 | Qualify installation, updates, recovery, accessibility and hardware profiles for a supported release. [CAP-06](#cap-06--hardware-profiles-lower-vram-and-game-mode--p0-for-baseline-profiles-p2-for-broad-hardware-coverage) · [CAP-10](#cap-10--reliability-accessibility-and-polish--p0) · [CAP-15](#cap-15--guided-installer-and-first-run-wizard--p0) · [CAP-16](#cap-16--updates-recovery-and-uninstallation--p0) | Install, first conversation, upgrade, repair and uninstall pass on supported clean Windows configurations.                                         |
| Later · P1/P2 | Qualify more desktop workflows and speech backends, then expand perception, animation and remote channels. [CAP-03](#cap-03--scoped-file-and-application-actions--p1-after-permission-foundations) · [CAP-05](#cap-05--optional-screen-and-webcam-perception--p1-screen--p2-webcam) · [CAP-13](#cap-13--telegram-parity--p2)                                                                                           | Each advertised device, workflow and channel passes its own capability, privacy and quality checks.                                                |

Major capability changes retain their own acceptance checks. The public desktop
release does not imply webcam support, Telegram parity, universal GPU support or
equal voice quality in every language.

The Hugging Face foundation in [CAP-17](#cap-17--hugging-face-model-and-voice-library--p1-foundation-p2-expansion)
has shipped. Next work expands measured model/language/device coverage and
runtime adapters; arbitrary Hub architectures and one-click training for every
voice model are not supported. The [implementation plan](docs/plans/hugging-face-integration.md)
records the original architecture and remaining expansion work.

## CAP-01 — Optional voice effects · P1

Add configurable post-processing to the existing voice playback pipeline.

- [x] Offer a clean voice preset and optional subtle cybernetic, radio and holographic presets.
- [x] Provide independent controls for effect intensity, dry/wet mix, room/reverb amount, short delay, filtering and glitch frequency.
- [x] Make glitches short and sparse, with strong interference reserved for selected transitions or reactions. Preserve understandable words.
- [x] Process streamed audio continuously across chunk boundaries. Prevent clicks, cut-off reverb tails, clipping, sudden loudness jumps and overlapping old replies.
- [x] Apply effects to playback, keeping source voice samples, training data and exported voice models unchanged.
- [x] Provide preview, bypass and reset controls. Turning effects off must immediately restore clean playback.
- [x] Keep effect processing separate from character animation effects and from any future microphone effects.

Implementation status (2026-10-26): shipped code and automated Electron/DSP checks; [details and measurements](docs/voice-effects.md). Subjective headphone/speaker audition remains a release quality check, not an automatic pass.

**Done when:** clean playback matches the current voice; presets pass listening checks on headphones and speakers; cancellation is immediate; added playback latency and CPU cost are measured. Effects are off by default until a user chooses a preset.

## CAP-02 — Independent language settings and validated speech packs · P2

Model discovery, per-language voice selection and the Qwen3-TTS CPU beta are
available through [CAP-17](#cap-17--hugging-face-model-and-voice-library--p1-foundation-p2-expansion).
Broader adapter coverage and language qualification remain open. The quality
criteria below also apply to imported packs.

- [x] Separate **interface language**, **conversation/text language**, **speech recognition language** and **voice/speech language**. Offer an easy “use conversation language” setting where appropriate.
- [ ] Establish English as the quality reference. Select the next language deliberately and validate it before expanding further.
- [x] Support installed language/voice packs with explicit compatibility metadata. Show which voices support which languages and hardware profiles.
- [ ] Evaluate intelligibility, naturalness, pronunciation, character similarity, emotion and latency for each language. Use blind listening comparisons and held-out transcripts/audio.
- [ ] Test accents, pauses, noisy rooms, proper names, song titles, dates, numbers and mixed-language phrases in recognition and speech output.
- [x] Preserve microphone selection, accurate final recognition and shared context when changing recognition models.
- [ ] Make automatic language detection optional; let users lock a language and explain fallback behavior. Never silently substitute a lower-quality voice or language.
- [ ] Localize character instructions, output-cleaning rules, tools and the request classifier where necessary. Unsupported classifier languages must retain the ordinary Qwen path.
- [x] Remember independent per-language voice selections and permit switching compatible installed voices without reinstalling the app or resetting memory.

**Done when:** each advertised language/voice combination passes its documented quality criteria. “Same quality” is a release objective to demonstrate per language, not an assumption that multilingual support guarantees parity.

Implementation status (2026-10-27): separate interface, conversation, recognition and matching voice settings are implemented. The interface has 50 offline locale catalogs, including RTL layouts; language switches preserve dialogue and input drafts. European recognition uses local Parakeet and the wider language set uses CPU Whisper. Matching multilingual speech models and automatic input-language detection are available through the pinned setup. English conversation and the trained English voice remain the quality baseline; language coverage is not a claim of equal naturalness or recognition accuracy. Interface catalogs have automated checks and local machine review, with native-speaker proofreading still welcome before public release. [Details and measurements](docs/languages.md); [interface localization](docs/localization.md).

## CAP-03 — Scoped file and application actions · P1, after permission foundations

The 1.0.0 baseline includes a configurable app catalog, scoped file actions and
Recycle Bin recovery. The separate computer-control beta supports bounded
observe–act sequences with keyboard and mouse input, a visible indicator and
Escape cancellation. Its full-computer grant is explicit. [File actions](docs/file-actions.md) · [Computer control](docs/computer-control.md)

Give Capri useful tools for explicitly approved locations and applications throughout the PC.

- [x] Add typed tools for listing, finding, reading, creating, copying, moving and renaming regular files in supported scopes.
- [ ] Define and qualify directory and cross-drive operations, including rollback and partial failures.
- [x] Expand scope through explicit user choices. Resolve real paths and handle junctions, links, network paths, locked files, name collisions and changed destinations correctly.
- [ ] Prefer filesystem/application APIs for operations they expose. Use Windows UI Automation for supported UI controls, with screenshot/coordinate automation as a limited fallback. [Microsoft UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32).
- [ ] Start application control with a small supported set: launch/focus an app, find a control, enter text and perform a bounded action. Distinguish supported and experimental integrations.
- [ ] Show a concise action preview when useful. Require explicit confirmation for destructive, bulk, sensitive or otherwise consequential actions; permit reusable grants for routine low-impact operations.
- [x] Use the Recycle Bin for supported file deletion, maintain a bounded operation journal and offer recovery for supported operations.
- [x] Verify actual results before confirming success. Use operation IDs to prevent retries, reconnects and repeated tool calls from duplicating mutations.
- [ ] Qualify the visible stop control and Escape across long action chains, including focus loss, a late tool result and partially completed work.
- [ ] Treat file contents, window text, websites and screenshots as untrusted data. They cannot grant new permissions or authorize unrelated actions.

**Done when:** supported workflows pass tests with real applications and failure cases. Capri reports partial completion honestly, requests no extra authority for routine read-only tasks, and never claims an action succeeded without evidence.

Qualification still covers different browser layouts and application frameworks,
multi-monitor focus/coordinates, interruption during combined actions and real
Resolve editing workflows. [Application access](docs/application-actions.md)

## CAP-04 — Contextual awareness and proactive conversation · P1

Make Capri feel present while keeping control over when she speaks.

- [ ] Introduce an event pipeline for supported app/window changes, media activity, idle/return, lock/unlock, sleep/resume and app/session shutdown.
- [x] Prefer application and Windows events over continuously sending screenshots to a model. Add vision only when an event needs visual interpretation and permission exists.
- [x] Separate observation, interpretation, deciding whether to speak and generating a line. Give events timestamps, source identity and confidence.
- [x] Add opt-in initiative levels: off, occasional and conversational, plus quiet hours, cooldowns, per-app exclusions and a conversation frequency limit.
- [ ] Suppress initiative during games, fullscreen media, calls, presentations, quiet mode and active user speech unless explicitly allowed.
- [ ] Give user messages priority over generated observations. Drop stale comments instead of delivering them after the moment has passed.
- [ ] Use the current character, selected language and shared memory; avoid repeated catchphrases, generic interruptions and claims of seeing content without perception access.
- [x] Let the user dismiss a comment and reduce that kind of initiative without deleting the whole conversation.
- [ ] Support a brief optional departure line on an appropriate event. Actual Windows shutdown must never wait for Qwen or voice synthesis; use an already prepared line only if the system still permits playback, otherwise skip it. [Windows session-ending guidance](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession).

**Example:** a verified media-open event may lead to “We watching this?” when the user has enabled that behavior. A filename alone does not establish what the video contains.

**Done when:** recorded test events produce timely, varied and contextually appropriate reactions; quiet modes and priority rules are respected; no proactive task changes files, music or settings without separate authorization.

Implementation status (2026-10-26): opt-in event initiative preview is implemented, with native process/fullscreen, idle/return, lock and power metadata; no window titles/images/audio. Tool-free Qwen generation shares current history/persona/memory, commits genuine assistant context and uses normal subtitles/voice. Native fixture, settings UI, cancellation, scheduling and real-agent recall checks pass. Observation pauses when hidden. Broader media events, reliable browser-call/windowed-game detection, prepared farewells, cross-channel priority and wider character/repetition qualification remain pending. [Details](docs/initiative.md), [narrow upstream context fix](docs/upstream-compatibility.md).

## CAP-05 — Optional screen and webcam perception · P1 screen / P2 webcam

- [ ] Provide separate screen and webcam permissions, both off by default, with visible active indicators and immediate pause/stop controls.
- [x] Offer explicit choices: one-shot screenshot, selected window/monitor, event-triggered observation or a bounded continuous mode.
- [ ] Let users select a camera and preview its feed. Avoid recording audio or images merely to enable a preview.
- [ ] Add screenshot resizing/cropping, change detection, request rate limits and a visual model profile appropriate to available resources.
- [ ] Support exclusion lists and stop capture on lock or when the chosen source becomes unavailable. A disabled source must never be described as active.
- [x] Attach capture time and source to observations. Explain when an image is stale or details are unreadable rather than inventing them.
- [x] Keep screenshots and webcam frames ephemeral by default. Saving or sharing captures requires a separate explicit choice.
- [x] Route vision observations into the existing conversation with their provenance. Keep observed scene content separate from instructions and authorization.

**Done when:** the chosen source, indicator, actual capture and model claims agree; stop releases access; capture respects exclusions; disabled perception does not impair text or voice chat.

Implementation status (2026-10-26): one-shot window/monitor capture is wired through an explicit picker, preview and question UI. Metadata enumeration collects no thumbnails; a selected-source stream closes after one frame. Hide/lock/suspend/close revoke capture. PNG bytes go only to local tool-free vision; the OpenClaw SDK atomically commits question, text answer and provenance without image bytes. Actual generated-window capture, camera denial, real Qwen, trained-voice playback and ordinary-agent recall pass isolated end-to-end checks. Bounded selected-source observation now adds 5/10/20-minute leases, change detection, 15/30/60-second minimum analysis intervals, visible stop controls, foreground cancellation, transient descriptions and timestamped context in ordinary text/voice turns. Hide/lock/suspend/source-loss revoke access without auto-resume. Webcam, crop/exclusion controls, event-driven visual initiative and broader quality/resource qualification remain pending. [Snapshot](docs/screen-snapshot.md), [observation](docs/screen-observation.md).

## CAP-06 — Hardware profiles, lower VRAM and game mode · P0 for baseline profiles, P2 for broad hardware coverage

- [ ] Detect GPU, VRAM, RAM, available disk space and supported compute backends. Keep a manual profile override.
- [ ] Offer tested **Quality**, **Balanced** and **Lightweight** profiles with clear descriptions of response quality, supported features and expected resource use.
- [ ] Measure the combined peak requirements of LLM, voice, vision, context/cache and other services. Reserve a safety margin rather than checking only model weight size.
- [ ] Evaluate smaller/quantized text models against character consistency, tool use, memory, plain-text output, avatar protocol and latency before including them.
- [ ] Keep ASR/classification on CPU where beneficial; provide a documented CPU fallback and explicitly state its tested limitations.
- [ ] Load optional vision/voice components on demand and unload them after configurable inactivity where startup costs make that sensible.
- [ ] Build a one-click game mode: stop optional observation and initiative, unload owned GPU models, show completion and restore services on request.
- [ ] Recover from out-of-memory errors with an explained fallback or profile suggestion. Do not silently change voice quality or kill unrelated processes.

**Done when:** every offered profile has a tested minimum configuration and measured peak memory; switching preserves history and settings; game mode demonstrably releases the resources it claims to release.

### CAP-06A — AMD GPU, CPU and NPU voice backends · P2 for AMD/CPU, exploratory for NPUs

Share the speech adapter contract with [CAP-17](#cap-17--hugging-face-model-and-voice-library--p1-foundation-p2-expansion).
CAP-06A owns device execution and preservation/export of the trained Capri voice.
CAP-17 supplies Hub packages, alternative model families and per-language selection.

**Current 1.0.0 implementation.** Chatterbox uses NVIDIA CUDA or the separately
pinned experimental ROCm path on selected supported AMD configurations.
Qwen3-TTS 0.6B Base provides a separate reference-conditioned CPU voice beta;
it is not an export of the trained Chatterbox adapter and can be slower than
real time. Text acceleration, ASR and TTS have separate hardware requirements.
[AMD voice requirements](docs/amd-voice.md)

The portability research below began on 2026-10-31. Whole-pipeline Chatterbox CPU
export, DirectML/Windows ML and NPU synthesis remain research/qualification work.
Radeon support still needs physical qualification for each advertised
GPU/driver combination; no universal GPU or NPU guarantee is made.

**Preserve the voice first.** The English release uses the pinned Chatterbox Turbo
base plus Capri's trained adapter and reference. Resemble AI also publishes an
official [Chatterbox Turbo ONNX model](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX),
with separate speech-encoder, embedding, language-model and conditional-decoder
graphs. It is evidence that an ONNX route exists, not a drop-in export of Capri's
adapter. Validate base-revision/tokenizer/preprocessing compatibility, merge our
adapter into the matching base and export that exact voice. Keep the same reference,
normalization, generation limits and applicable upstream processing. Do not replace
the trained voice with stock reference-only cloning and advertise equivalent results.
The English ONNX export does not establish multilingual-model compatibility.

| Route                                 | Intended role                                                                                                      | Constraints and decision                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PyTorch CPU                           | Reference implementation and optional compatibility fallback on PCs without supported GPU speech                   | Generalize the entire voice path, not only the decoder. Benchmark latency/CPU/RAM first; expose slower operation honestly. Same weights do not guarantee real-time synthesis on every CPU.                      |
| Native Windows PyTorch + AMD ROCm/HIP | First targeted AMD GPU prototype, preserving the current model and adapter                                         | Use an explicitly supported GPU/OS/driver/framework combination from AMD's matrix and a separate pinned environment. Do not promise all Radeon generations or infer Windows support from Linux/WSL.             |
| ONNX Runtime + DirectML               | Broad Windows GPU compatibility candidate, including older AMD/Intel hardware outside a qualified ROCm combination | Check exact exported opset, operators, cache tensors and dynamic shapes. DirectML is sustained engineering/maintenance; keep it an isolated compatibility provider rather than the sole long-term architecture. |
| ONNX Runtime + Windows ML             | Longer-term provider management on supported newer Windows systems                                                 | Dynamic EP delivery requires Windows 11 24H2+ and compatible drivers. Keep a separate Windows 10 path. Probe the actual model, not merely provider availability.                                                |
| OpenVINO / VitisAI / QNN              | Separate Intel, AMD Ryzen AI and Qualcomm NPU prototypes                                                           | No universal NPU backend or guaranteed whole-model placement. Qualify per provider/device/driver/precision. Qualcomm Snapdragon targets also require a separate ARM64 application/runtime qualification.        |

**Implementation sequence**

- [ ] Introduce a provider-independent speech contract: probe, load, warmup,
      synthesize/cancel, health, memory reporting and unload. Keep the current
      NVIDIA pipeline as the qualified baseline. Token generation and audio decoding
      must be independently placeable, with capabilities reported per stage.
- [ ] Replace hard-coded `cuda:0`, unconditional CUDA synchronization/graphs,
      NVIDIA-only memory queries and install-time vendor gates with explicit backend
      adapters. Keep NVIDIA architecture checks scoped to NVIDIA. PyTorch HIP can
      expose the `torch.cuda` namespace; distinguish the runtime using its actual
      backend metadata rather than treating that namespace as NVIDIA detection.
- [ ] Build a complete CPU reference path and compare the trained voice with the
      current FP32 baseline. Cap threads so speech does not monopolize ASR/routing/LLM
      CPU resources. Keep CUDA Graph optimizations disabled for other backends until
      separately qualified. Decoder-on-CPU alone is not a full CPU voice implementation.
- [ ] Prototype native ROCm/HIP synthesis on one officially supported Windows AMD
      configuration, then a second device class. Resolve compatible Python, PyTorch,
      torchaudio and Chatterbox dependencies in an isolated environment; do not replace
      the existing NVIDIA environment or relax dependency/TLS checks globally.
- [ ] Reproduce the official ONNX pipeline on CPU, then export the exact merged
      Capri voice. Validate tensor layouts, special tokens, reference conditioning,
      cache lifecycle, long/short text, cancellation and phrase boundaries. Publish
      converted weights as separately versioned model assets with hashes; keep binary
      weights out of the source repository.
- [ ] Profile DirectML execution on real AMD hardware before selecting it as a
      compatibility backend. Check export opset against provider support, use supported
      session options and prevent repeated CPU/GPU copies of the autoregressive cache.
      Do not label synthesis GPU-accelerated when almost all work falls back to CPU.
      A direct `torch-directml` port can be a small isolated feasibility experiment;
      its maintenance status, available wheel versions and operator coverage must be
      checked before considering it. Do not downgrade the shared NVIDIA environment
      or assume that changing the device string ports our CUDA-specific optimizations.
- [ ] Evaluate Windows ML provider management separately. Current Microsoft docs
      explicitly exclude GenAI scenarios for its MIGraphX EP; do not assume that this
      EP can execute the autoregressive T3 model. Consider only proven supported
      subgraphs until upstream capability changes and is revalidated.
- [ ] Run NPU feasibility work per stage. Test fixed/bucketed shapes, persistent
      cache inputs and operator coverage before quantization. Quantize only after an
      FP32/FP16 reference is established, using representative calibration material
      where required. Measure compilation and transfer costs; partial NPU execution
      may be slower than CPU/GPU. A hybrid backend is acceptable if its benefit and
      real placement are reported accurately.
- [ ] Prioritize x64 Intel/AMD NPU experiments first. Treat Qualcomm QNN/Snapdragon
      as a separate Windows ARM64 milestone covering Node/Electron, Python/native
      packages, installers and other services, not just a TTS provider switch.
- [ ] Extend the installer and settings with independent text/ASR/TTS capability
      detection and qualified backend selection. Distinguish missing driver, missing
      runtime, unsupported model/device and insufficient memory. Download only the
      selected environment/model format; CPU/different-voice fallback is explicit,
      never a silent loss of voice identity or quality.
- [ ] Qualify multilingual speech separately after the English trained voice.
      Exporting Turbo graphs does not convert the distinct multilingual model or make
      all supported speech languages available on every new backend.

**Qualification and release gates**

- [ ] Measure cold/warm first playable audio, synthesis real-time factor
      (generation seconds / generated audio seconds), p50/p95, peak host RAM and actual
      device memory, provider partitioning/transfers and concurrent Qwen/ASR contention.
      NPU TOPS and a successful tensor addition are not end-to-end TTS benchmarks.
- [ ] Compare the same held-out English sentences, short acknowledgements, long
      sentences, names and punctuation against NVIDIA FP32. Use blind listening for
      identity, naturalness, expression and artifacts, plus transcription checks.
      Numerical subgraph parity is useful; bit-identical sampled waveforms are not
      required. Do not assume INT8/INT4 preserves the trained voice.
- [ ] Test native install/repair/update, missing and incompatible drivers,
      cancellation, OOM/device loss, repeated load/unload and game-mode resource release
      on each advertised hardware family. Keep current CUDA behavior covered.
- [ ] Record exact GPU/NPU model, OS/build, driver, runtime/provider versions,
      model revision, merged adapter/reference hashes and export/precision settings.
      Track experimental, physically verified and unsupported combinations separately.
- [ ] Review redistribution licenses and deployment requirements for provider
      binaries, runtime packages and converted model assets before shipping them.

CPU/export correctness can be investigated on the existing development PC; real
AMD/NPU compatibility must be checked on those devices. WSL2 and CUDA-translation
layers such as ZLUDA remain optional research, not the normal Windows installer
dependency or a promised shortcut to unchanged CUDA performance. Do not publish a
date or blanket AMD/NPU support claim before the relevant release gates pass.

References checked for planning: [AMD Windows PyTorch matrix](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/windows/windows_compatibility.html),
[AMD unified compatibility matrix](https://rocm-handbook.amd.com/projects/amd-rocm-programming-guide/en/latest/compatibility/compatibility-matrix.html),
[ONNX Runtime DirectML support and limits](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html),
[PyTorch HIP runtime semantics](https://docs.pytorch.org/docs/stable/notes/hip.html),
[Microsoft DirectML maintenance status](https://github.com/microsoft/DirectML),
[PyTorch DirectML setup](https://learn.microsoft.com/en-us/windows/ai/directml/pytorch-windows),
[ZLUDA project](https://github.com/vosen/ZLUDA),
[Windows ML providers and requirements](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers).
Recheck matrices when selecting actual pins; rolling documentation is not a
released Capri compatibility promise.

## CAP-07 — Measured performance improvements · ongoing P0

- [ ] Deliver the long-session compaction benchmarks and separate the context
      preparation and API-stream phases described in [CAP-12A](#cap-12a--responsive-context-compaction--p0).
- [ ] Instrument end of user speech, end-of-turn decision, final transcription, classification, model admission/prefill, first visible text, first speech request, first playable audio and playback start.
- [ ] Report text-to-response and voice-to-response separately. Separate cold startup, warm operation, long history and tool-based requests.
- [ ] Track median and p95 on a repeatable benchmark set with stated hardware, context size, quality settings and sample count.
- [ ] Maintain CPU routing with a bounded timeout and ordinary-path fallback; expand fast-path coverage only with separate calibration and regression checks.
- [ ] Profile context growth, repeated instructions, cache invalidation, memory retrieval, serialization, queueing, GPU contention, speech buffering and first-chunk synthesis.
- [ ] Tune silence detection and speech chunking while preserving natural pauses, accurate transcripts and understandable speech.
- [ ] Use bounded queues, cancellation, stale-result rejection and deliberate startup prewarming across every optional service.
- [ ] Establish measured latency budgets per hardware profile after the baseline. Treat a four-second warm first-audio result as an initial reference to investigate, not a universal promise.

**Done when:** changes include comparable before/after measurements and quality checks. Faster first text alone does not establish faster audible responses.

## CAP-08 — Legacy removal and repository hygiene · P0

- [x] Inventory entry points, runtime dependencies, configuration, scripts, models, training assets, experiments and documentation. Map each to an active feature or supported developer workflow.
- [x] Identify abandoned VTuber/ASR/TTS paths and historical experiments. Decide what to retain as a separate developer workflow and what to retire.
- [x] Verify dynamic imports, runtime paths, setup scripts and voice-training/export dependencies before removing anything.
- [x] Archive recoverable development artifacts before deleting obsolete local material. Never classify user history, trained voices or source datasets as disposable cache.
- [x] Remove retired launchers, dependencies, stale documentation and dead configuration together. Test the supported paths afterward.
- [x] Keep models, environments, private data and generated reports out of the source repository; use one documented data/cache layout with size information and a cleanup command.

Implementation evidence and recovery details: [cleanup.md](docs/cleanup.md). The local cleanup is complete; fresh-PC bootstrap and release qualification remain CAP-15/CAP-16 work.

**Done when:** a clean checkout includes only maintained source and essential assets, installation recreates runtime dependencies, and existing user data survives migration. Cleanup is a planned task, not authorization to delete files while editing this roadmap.

## CAP-09 — Incremental architecture and code refactoring · P0

- [ ] Define boundaries for desktop UI, conversation orchestration, OpenClaw transport, models, voice/DSP, ASR, vision, actions, initiative and persistence.
- [ ] Introduce typed/versioned contracts for tools, events, settings and worker messages. Validate messages at process boundaries.
- [ ] Make settings schema-driven, separate shipped defaults from user overrides, and implement versioned migrations with recovery.
- [ ] Give optional services a consistent lifecycle: start, readiness, cancel, health, failure and shutdown. Keep failures isolated from basic chat.
- [ ] Centralize capability reporting so Capri describes only features actually enabled and available in the current interface.
- [ ] Reduce responsibilities of large orchestration files in small behavior-preserving changes. Keep the same conversation/session semantics throughout.
- [ ] Document pinned upstream patches, compatibility checks and the plan to update or retire them. Avoid undocumented edits inside dependencies.
- [ ] Establish formatting, linting, type checking, naming conventions and contributor documentation; avoid unnecessary framework replacement.

**Done when:** supported features behave as before, module contracts and dependency direction are documented, and each refactoring step passes relevant checks. “Refactor everything” is replaced by reviewable changes.

## CAP-10 — Reliability, accessibility and polish · P0

- [ ] Maintain a bug backlog with severity, reproduction steps, affected versions, expected behavior and regression coverage for material failures.
- [ ] Test cancellation, reconnects, missing models, unavailable devices, permission denial, interrupted downloads, sleep/resume and GPU/voice failures.
- [ ] Cover long conversations, repeated messages, simultaneous channel input and partial tool completion. Prevent duplicate actions and stale audio/visual results.
- [ ] Verify multiple monitors, DPI/scaling changes, off-screen recovery, taskbars, fullscreen apps, click-through regions, sprite dragging and resize/zoom behavior.
- [ ] Keep subtitles readable, history usable, keyboard navigation consistent and controls accessible to screen readers where supported.
- [ ] Offer reduced motion, independent glitch intensity, high-contrast/readable text and independent speech/effect volume.
- [ ] Produce understandable recovery messages and optional redacted diagnostic exports. Avoid exposing secrets, private prompts or screenshots in routine logs.
- [ ] Require no unresolved release-blocking bugs in the supported release scope. Track lower-severity known issues explicitly instead of promising “all bugs fixed.”

**Done when:** normal use and recovery paths pass a documented release checklist, and visual/audio polish does not compromise usability or performance.

## CAP-11 — Unified settings and capability controls · P0

The desktop settings panel, temporary approval cards for supported capabilities
and model-independent reminders, timers and stopwatch are implemented. Recurring
schedules and delivery while Capri is closed remain future work. [Timers and settings actions](docs/timers-and-actions.md)

- [ ] Provide one settings interface for languages, model profiles, microphone/output devices, voice, effects, subtitles, appearance and resource use.
- [ ] Provide separate controls for initiative, screen access, webcam, application integration, file scopes and external channels.
- [ ] Explain each setting in ordinary language, including its effect on quality, latency, resources and privacy. Provide preview and restore-default actions where useful.
- [ ] Make autostart and background operation opt-in. Show whether the app is hidden, listening, observing or using GPU resources.
- [ ] Offer a single quiet/privacy control that stops new microphone/screen/webcam capture and proactive speech; keep it distinct from muting playback.
- [ ] State when settings apply immediately and when a service restart/download is required. Preserve independent user preferences across updates.

**Done when:** ordinary users can configure supported features without editing JSON or using a terminal, and UI state reflects actual service state.

## CAP-12 — Memory management and user data · P0

**Baseline.** OpenClaw owns the shared session, preserves the original history,
and already summarizes active replay for normal local and API chat. At 32K, the
24 KiB active-transcript guard can trigger before the token ceiling. The local
CPU embedding index already supports hybrid keyword and semantic search through
`memory_search` and `memory_get`. Direct Lemonade/NPU dialogue assembles a
separate short prompt. Existing controls clear context and saved memory
separately. Settings can display saved facts, the Brain folder supplies local
document retrieval, and the separately password-protected memory box has an
explicit unlock lifecycle. These are distinct from the tagged recall design
below and do not encrypt ordinary history. [Architecture](docs/architecture.md) · [Context management](docs/context-management.md) · [Security](SECURITY.md)

### CAP-12A — Responsive context compaction · P0

- [ ] Establish comparable local and API baselines for short turns, warm long
      sessions, cold starts and vision/tool turns. Record prompt tokens, time
      spent in compaction, provider wait, first visible text, first playable audio
      and fallback count. Keep text, file paths and secrets out of diagnostics.
- [ ] Give context preparation and first-text wait independent bounded budgets.
      Apply context-pressure accounting to API turns too, without treating a
      stream header or an internal event as visible text. Reproduce the observed
      case where the shared watchdog expired after slow compaction and a silent
      provider stream. Keep an absolute turn deadline.
- [ ] Schedule native compaction between turns as the full prompt approaches
      its working budget. Reserve space for instructions, tools, images and the
      reply. Tune the early byte guard against measured token pressure rather than
      compacting at a fixed number of messages. Foreground input takes priority;
      use the session lease and reject stale commits after a new turn or reset.
- [ ] Keep a bounded extractive fallback when a turn cannot fit. Reuse audited
      OpenClaw-compatible excerpts where possible and qualify them for the managed
      API path. Preserve recent replies, unresolved asks, decisions and exact
      identifiers. Keep original history accessible and never replay tool actions
      from a summary. Avoid extra paid summary calls in the default foreground path.
- [ ] Keep configured model capacity separate from the amount sent per turn.
      Larger provider windows require verified support and separate latency/cost
      checks. Keep the local hardware limits and 32K baseline while qualifying
      compaction and recall.

**Acceptance.** A synthetic long conversation crosses the 32K budget with its
latest ask, decisions and original history intact. A stalled summary or provider
stream yields a bounded recovery, with no repeated actions. Compare p50/p95
first text and first audio against the existing build on the same fixtures.

### CAP-12B — Tagged long-term memory · P1

- [ ] Pilot automatic, local retrieval using the existing OpenClaw index and a
      single bounded pre-reply step. Evaluate the pinned Active Memory hook for
      direct retrieval; reuse its search and injection contracts where suitable.
      Keep ordinary recall free of extra generation calls. A slow or unavailable
      index must leave normal dialogue usable, with an explicit fallback for
      memory questions. Skip obvious greetings and routine commands.
- [ ] Store one fact, preference, event or decision per Markdown record in
      `data/workspace/memory/` with a stable ID, source reference, date and tags.
      Let Capri invent tags when saving records. Use an open vocabulary with no
      global tag count limit, a small per-record cap and normalization for case,
      Unicode and obvious aliases. Preserve distinct meanings and allow users
      to edit tags or merge aliases. Import legacy notes without rewriting them.
- [ ] Rank individual records using semantic similarity, exact names and terms,
      and weighted tag matches. A common tag such as `editing` only boosts
      candidates; it cannot load every record in the group. Deduplicate by fact
      and source, downrank superseded records and apply a minimum relevance score.
      Start with up to four records and 600–1,000 total prompt tokens. An explicit
      request to remember details can make one deeper, separately bounded search.
- [ ] Insert selected excerpts as temporary turn data after the stable prompt
      prefix. Reuse the same ranking and limits for local chat, external API
      chat and direct Lemonade/NPU dialogue. Replace broad Markdown injection
      with a compact, user-controlled profile and selected records once parity
      is verified. Avoid duplicating excerpts in saved conversation or feeding
      them back on every later turn. Offer separate sharing permission for
      recalled memories per remote API profile and enforce it at final request
      assembly, including on-demand tool results. Keep indexes and embeddings local.
- [ ] Save explicit user requests to remember something and confirmed durable
      facts with provenance. Treat user corrections as superseding older records.
      Keep unverified guesses, credentials, role-play and screen/tool output out
      of automatic memory. Separate owner-approved notes from raw chat archives.
- [ ] In Settings, let users inspect, search, edit, export and delete memory.
      Keep display history, active context, long-term records, attachments and
      diagnostics distinct. Version backups and migrations. Clearing memory
      invalidates pending writers and removes derived indexes/caches. Archived
      conversations stay separate and cannot silently recreate cleared records.
      Reuse the same owner store for future authorized channels in CAP-13.

**Acceptance.** An exact subtitle export fact can be found among hundreds of
records tagged `editing`. Test newly invented tags, English/Russian recall,
corrections, duplicates, index failure, model switching, cache reset, interrupted
migration and provider sharing disabled. Compare recall accuracy, input tokens
and first-reply latency with compaction alone. Require zero additional model
calls for simple turns.

## CAP-13 — Telegram parity · P2

- [ ] Audit the current adapter and complete end-to-end pairing with an explicitly authorized Telegram account/chat.
- [ ] Support text, photos and voice messages with the selected language/voice settings and the same durable memory as desktop.
- [ ] Give remote requests explicit device and capability scope. Desktop authorization must not automatically grant every remote action.
- [ ] Handle retries, reconnects, duplicate delivery, attachment limits and offline desktop availability without repeating actions.
- [ ] Make desktop/Telegram playback and notifications configurable; avoid speaking the same reply unexpectedly on multiple devices.
- [ ] Document setup, credential storage, account revocation and the feature differences between channels.

**Done when:** a verified desktop-to-Telegram-to-desktop scenario retains context and permissions correctly, including voice/photo input and interrupted connectivity.

## CAP-14 — Public repository and distribution · P0

Public 1.0.0 is released. The public repository has a clean publication history,
protected main, pull-request checks, GPL-3.0-only project code, published
installer/source checksums and private vulnerability reporting. Distribution
terms for character/model/voice assets remain separate. The installer is
unsigned; broader clean-machine and device qualification remain acceptance work.

- [ ] Define supported Windows versions and architectures, hardware minimums and the feature/profile compatibility matrix. Advertise only tested configurations.
- [ ] Remove developer-specific paths and machine assumptions; support user-selected install/model paths, spaces, Unicode and standard user accounts.
- [ ] Separate the reusable assistant platform from character, sprite and voice packs. Provide an installable public default pack with documented distribution permissions.
- [ ] Inventory licenses, attribution, redistribution status and training-data provenance for code, models, fonts, sprites, voice samples and adapters. Keep private/reference assets out of public releases unless cleared for distribution.
- [x] Select the project license and publish LICENSE, third-party notices, README, quick start, architecture, troubleshooting, contribution and security-reporting guidance.
- [x] Audit the initial public source/history and 1.0.0 release artifacts for credentials, private conversation data, absolute personal paths and accidental media/dataset inclusion. Repeat before each publication.
- [x] Add CI for checks that can run without GPU, secrets or the owner's PC; keep GPU/quality integration tests reproducible and separately runnable.
- [x] Publish versioned build artifacts, checksums, dependency/model manifests and release notes. Verify update/install artifact integrity.
- [ ] Sign the Windows installer and application binaries and qualify publisher trust on clean systems.
- [ ] Test installation from the actual published artifact on a clean supported Windows system without preinstalled development tools.

**Done when:** a new user can obtain a tagged release, understand its requirements, install it and use the documented default configuration. The public package must not depend on the developer's private Capri voice or local runtime files.

## CAP-15 — Guided installer and first-run wizard · P0

The per-user Windows wizard provisions private runtimes and selected models,
supports local inference, deferred Hugging Face selection or an API profile, bundles the Capri voice reference,
and registers shortcuts and uninstall. Installer session recovery, retries and
resumable downloads are available for supported components. Broader hardware
qualification, device audition, storage choices and signing remain open.
[Wizard design and limits](docs/installation-wizard.md)

The following is the target guided setup flow; device audition and a guided
first conversation are not separate steps in the current eight-page installer.
Current pages are Welcome, License, Location, Hardware, Components, Review,
Installing and Finish. See the wizard guide for the shipped controls.

| Step                         | What the user selects                                    | What the wizard explains/checks                                                    |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Welcome and requirements  | Interface language                                       | Supported systems, local processing, network downloads and what will be installed  |
| 2. Hardware and profile      | Recommended profile or manual override                   | Detected hardware, measured requirements and feature/quality tradeoffs             |
| 3. Storage                   | App, model and data locations                            | Download size, installed size, required free space and shared cache behavior       |
| 4. Languages                 | Conversation, recognition and speech languages           | Available combinations, quality status, required packs and optional auto-detection |
| 5. Character and voice       | A supported character/voice pack                         | Preview, language support, attribution and whether the pack is optional            |
| 6. Devices and voice effects | Microphone, output device and clean/effect preset        | Live device test, input level, headphones guidance and a voice preview             |
| 7. Optional capabilities     | Screen, webcam, initiative, integrations and file scopes | Separate choices, actual access granted and how to revoke it; disabled defaults    |
| 8. Install and verify        | Confirm the selected configuration                       | Progress by component, real download progress, retries, pause/resume and errors    |
| 9. First conversation        | A short guided test                                      | Model readiness, recognition, first response, subtitles and where settings live    |

- [x] Provision the owned application runtimes and selected model dependencies without a terminal or global Python/Node setup.
- [ ] Verify progress, ETA, retry and resumption across the full set of components, including network loss and reboot.
- [ ] Verify downloaded artifacts against pinned manifests before use and prevent partially installed models from being selected as ready.
- [ ] Support modifying an installation later: add a language, move model storage, change a voice/profile, repair a component or remove unused packs.
- [ ] Request elevated privileges only for a step that needs them. Keep user data separate from application binaries and verify a standard-user install path.
- [ ] Use concise explanations, an accessible expandable detail view and explicit choices for consequential permissions. Avoid mandatory reading countdowns; they add waiting without establishing understanding.
- [ ] Provide an offline-capable bundle as a later option, subject to component distribution permissions.

**Done when:** a nontechnical tester completes installation and the first conversation from a clean supported machine, understands enabled access, and can repair or change the configuration without reinstalling everything.

## CAP-16 — Updates, recovery and uninstallation · P0

In-app updates use the public CapriCore channel without requiring an account or
token. Saved optional credentials remain protected; failed optional access does
not block anonymous public downloads. Stable/experimental selection, update
notifications with defer-until-next-launch, verified staging/rollback and
selective Windows uninstall are implemented. Continuing qualification covers
interrupted installs, legacy migrations, retained data and wider Windows setups.
[Updates and recovery](docs/updates.md) · [Installation wizard](docs/installation-wizard.md)

- [ ] Version the app, configuration schemas, model profiles, character packs and voice packs independently with a compatibility matrix.
- [ ] Offer stable and optional preview channels; allow users to defer updates and choose whether model downloads happen automatically.
- [ ] Verify updates, prepare migrations, preserve data and support rollback when an upgrade fails.
- [ ] Update owned runtimes without breaking shared model caches, trained voices or an installation used by another profile.
- [ ] Provide a repair/diagnostic flow and a supported way to recover from an incomplete update without a terminal.
- [ ] Let uninstallation keep user data/models by default, with separate explicit choices to remove them. Remove owned autostart entries and services, and leave unrelated software alone.

**Done when:** upgrade, interrupted upgrade, rollback, repair and uninstall have been tested with existing conversations and custom settings.

## CAP-17 — Hugging Face model and voice library · P1 foundation, P2 expansion

The foundation ships in public 1.0.0: Hub model discovery, compatible GGUF
imports, encrypted optional Hub credentials and reviewed voice adapters.
The [detailed implementation plan](docs/plans/hugging-face-integration.md)
records current code boundaries, compatibility gaps, security requirements,
candidate TTS engines and acceptance scenarios.

The implementation includes Hub search/inspection, encrypted
tokens, pinned verified downloads, complete GGUF shard imports, model-aware
capabilities/context, disk estimates, cancellation and removal. An isolated real
Ollama import produced a short text reply. Wizard can defer model selection to
the new library. HF cloud LLM is available as an API preset.

Voice settings now select a reviewed adapter per language. Chatterbox Turbo has
local English LoRA training with a separate candidate, audition and rollback;
multilingual Chatterbox and the Qwen3-TTS CPU BETA use the Capri reference voice.
Arbitrary HF voice architectures do not yet have automatic fine-tuning recipes.
Their absence is shown explicitly. Language quality, exact voice similarity and
unmeasured hardware combinations remain qualification work.

- [x] **CAP-17A — Shared contracts.** Version model/package descriptors and install plans, retain voice selections, validate model-aware text/tools/vision/context capabilities and protect HF credentials.
- [x] **CAP-17B — Hub and downloads.** Search and repository-link import, immutable revision/file resolution, verified resumable downloads, disk accounting, repair and owned cache inventory.
- [x] **CAP-17C — Local language-model foundation.** Import complete GGUF weight sets and optional projectors through the managed Ollama lifecycle; support selection, cancellation, repair and removal. Keep requirements unknown before choosing a specific Hub model.
- [ ] **CAP-17C — Broader model qualification.** Validate templates, context, tools, vision, switching and recovery for each additional advertised architecture and quantization.
- [x] **CAP-17D — Reviewed voice adapters.** Per-language selections for Chatterbox Turbo, multilingual Chatterbox and Qwen3-TTS CPU (BETA); English Turbo training keeps a separate candidate with audition/rollback.
- [ ] **CAP-17D — Broader voice qualification.** Measure language/device quality and latency, evaluate further families such as Kokoro and add training recipes only for compatible architectures.
- [x] **CAP-17E — Hub access and cloud LLM preset.** Encrypted optional gated/private Hub access and a Hugging Face Inference Providers OpenAI-compatible API preset.
- [ ] **CAP-17E — More backends.** Qualify HF cloud TTS and an approved local Transformers adapter, including explicit provider data-sharing choices.
- [ ] **CAP-17F — Qualification.** Validate each advertised model/language/device combination, clean installation, upgrade, repair, cancellation, offline use and selective uninstall. Expand the catalog using measured results.

Future expansion builds on the shipped contracts, public GGUF and voice adapters.
CAP-12A supplies the context and cancellation baseline for release qualification.
CAP-02 defines language quality, CAP-06 hardware budgets, CAP-14 artifact/privacy
checks, and CAP-15/CAP-16 installation and removal. CAP-12B continues as the
separate bounded-memory milestone.

**Done when** users can discover a supported model, understand its hardware and
language limits, install it with accurate progress, use it for dialogue or speech,
switch or recover safely, and remove selected packages. Each supported combination
has reproducible evidence. Imported model metadata is checked against the pinned
runtime and qualified capabilities before features become available.

## Release checklist

The Hugging Face expansion adds a separate acceptance gate for each model,
runtime, language and device combination through CAP-17.

- [ ] Supported configurations and experimental limitations are documented.
- [ ] Every advertised feature passes installation and end-to-end acceptance checks on a clean machine.
- [ ] Shared context, cancellation, action verification and data migration have no release-blocking regressions.
- [ ] Performance reports distinguish cold/warm behavior and report first text separately from first audio.
- [ ] Changes to memory pass long-session, bounded-recall, deletion and remote-sharing checks from CAP-12.
- [ ] Optional capture/actions are disabled until selected; permission indicators match real behavior.
- [ ] Download/update integrity, packaging, attribution and public-asset distribution checks are complete.
- [ ] Diagnostics are redacted; release artifacts contain no private data or credentials.
- [ ] Uninstall, data preservation, backup/restore and recovery are verified.

## Mapping from the original list

| Original item                                   | Expanded work                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Voice effects                                | CAP-01, CAP-11                                                                                              |
| 2. Multilingual TTS/STT                         | CAP-02, CAP-06, CAP-15                                                                                      |
| 3. Files, desktop tasks and contextual comments | CAP-03, CAP-04, CAP-11                                                                                      |
| 4. Screen and webcam                            | CAP-05, CAP-11                                                                                              |
| 4.5. Lightweight models                         | CAP-06                                                                                                      |
| 5. Speed                                        | CAP-07, CAP-12A                                                                                             |
| 6. Remove unused files                          | CAP-08                                                                                                      |
| 7. Professional refactoring                     | CAP-09                                                                                                      |
| 8. Bugs and polish                              | CAP-10                                                                                                      |
| 9. GitHub release                               | CAP-14, CAP-16                                                                                              |
| 10. Installer wizard                            | CAP-11, CAP-15                                                                                              |
| Added foundations                               | CAP-12A context compaction, CAP-12B tagged memory, CAP-13 Telegram parity, CAP-16 update/recovery lifecycle |
| Hugging Face integration                        | CAP-17 model/voice catalog, verified downloads, runtime adapters and multilingual qualification             |

For implementation, split each epic into issues with a concrete workflow, dependencies, acceptance criteria, validation evidence and any user-data migration. Scope work to one reviewable feature or behavior-preserving change at a time.
