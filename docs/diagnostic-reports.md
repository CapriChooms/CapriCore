# Local diagnostic reports

In Capri Setup, **Open logs** opens one `setup.log` with the latest events and
relevant log tails. **Save diagnostics** creates a ZIP containing `setup.log`,
`setup.json` for system and installation details, and `REPORT.md` for an overview.
Setup uses separate internal recovery files to reconnect to an active installation.

Open the bug-report button in Capri, select the affected component and describe
what happened. Reproduction steps, expected and actual results are optional but
helpful. Save report creates a ZIP at a location chosen in a native file dialog
and shows it in Explorer. Nothing is submitted to GitHub automatically.

Unzip and review REPORT.md first. It contains the exact release tag, a report ID,
UTC capture time, reproduction details, hardware summary and automatic findings.
The accompanying JSON files contain system/runtime versions, CPU/RAM/GPU/driver
information, available disk space, selected model/languages, startup stages, voice
readiness, recent technical errors and installer state.

The active **model ID** is included as technical metadata in `session.json` and
the readable `REPORT.md` overview. The desktop's structured `model-selected`
runtime event retains the same ID in `logs/desktop-model.jsonl`, a bounded file
containing only the latest selection. General child output is not captured. IDs can distinguish local aliases from an
API model without exposing the API key, request body or conversation. Credentials,
URLs with authentication, absolute file paths and arbitrary prose are not accepted
as model metadata. Ordinary textual session fields remain excluded.

Session diagnostics distinguish cold model preparation from answer generation and
record the preparation duration, selected context size/keep-alive and muted-voice
release state. These contain no prompt text. A prepared model is not a promise of
measured latency, and a captured memory snapshot cannot establish the sole cause
of an earlier timeout.

Voice diagnostics check the profile, adapter checksum, required base-weight files
and receipt, installed Python packages, PyTorch/CUDA availability and GPU compute
capability. The Python probe runs separately with a 15-second limit; it does not
load model weights, synthesize speech, record audio or change settings. Readiness
and preparation errors retain their technical cause alongside the friendly UI
message. Recent renderer warnings/errors help diagnose audio-output failures.
Hardware/probe failures become report entries instead of preventing export.

For an English voice failure after installation, reproduce it, leave Capri open
and save a report with recent logs enabled. Send the reviewed ZIP to the maintainer.
Installing the pack alone does not establish that its backend can run on the
hardware. Chatterbox uses compatible NVIDIA/CUDA or the experimental, separately
pinned AMD ROCm runtime on qualified Windows 11 Radeon configurations. An AMD GPU
working for language-model inference does not establish Chatterbox compatibility;
NPUs are not Chatterbox backends. The separate Qwen3-TTS CPU option has its own
requirements and can be slower than real time. See [AMD voice requirements](amd-voice.md),
[voice GPU compatibility](voice-gpu-compatibility.md) and [voice installation](voice-installation.md).
Reports distinguish missing Python/profile/weights, checksum mismatch, backend
unavailability, logged architecture/DLL/OOM errors, service readiness and playback
failures. A finding is evidence, not an automatic repair or a guaranteed diagnosis.

Conversation language and installed speech models are separate choices. An English
voice installation cannot speak Portuguese or other non-English languages by itself.
Languages shows missing packs and offers multilingual setup. Applying an unavailable
voice asks whether to install it or save the conversation language with text replies
only; installation does not silently change the selection or start a download.
The microphone section also identifies when recognition for that language is missing.

Recent logs are included by default and can be excluded. Collection includes up to
24 runtime logs, four installer UI logs and three logs from each of the two most
recent installer sessions matching this installation. Each log contributes at most
its last 256 KiB. manifest.json records captured/source sizes, truncation and
collection warnings. The total uncompressed archive is capped at 16 MiB.

Chat-history files, long-term memory, personality, recordings, screenshots, weights
and credential files are excluded. Known secrets, authorization/cookie headers,
URL credentials/query strings and common personal paths are redacted. This is
best-effort redaction, not a guarantee that arbitrary log text is anonymous. Review
before sharing. Linked diagnostic directories/files are rejected; no environment
dump, desktop capture or unsolicited upload is performed.

The ZIP uses UTF-8 and contains REPORT.md, problem.json, system.json, voice.json,
session.json, installation.json, manifest.json and any captured logs. Saving is
atomic and concurrent exports are rejected. Canceling the file dialog performs no
collection. Validation uses isolated fixtures; verification-mode exports cannot
read the owner's runtime or installer logs.
