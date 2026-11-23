# Installation

Download the Windows setup executable from the [latest public CapriCore release](https://github.com/CapriChooms/CapriCore/releases/latest). No GitHub account, invitation or token is required. The unsigned Windows installer provisions its own runtimes. The manual prerequisites below apply to command-line installation. You can also double-click **Install Capri.cmd** from a complete extracted source package. See [the wizard guide](installation-wizard.md).

Choose a bundled local LLM, local Hugging Face GGUF selection, or **Use an API without installing local LLMs (BETA)**. API mode skips local conversation-model downloads and startup loading; its local memory helper and CPU request classifier remain installed. Optional recognition and voice have separate downloads and memory requirements. See [system requirements](../README.md#system-requirements).

To upgrade from private early access, run the public installer and select the existing Capri folder without uninstalling. This preserves data and models and switches future update checks to CapriCore. Older private-channel updaters cannot discover the new repository themselves.

For a ready-to-install download, use the versioned CapriSetup executable under
GitHub Releases. An extracted source archive must include the reviewed runtime
catalog at assets/capri/sprites/v1/runtime-sprite-set.json and all referenced PNG
frames, regardless of the voice/model choices. If setup reports incomplete source
artwork, obtain a complete archive or the release setup before retrying. The
standard Git archive is regression-tested to retain this artwork while excluding
private data, logs, model caches and other root distribution exclusions.

## Manual source installation

The first desktop target is Windows x64. ARM64 and Linux/macOS desktop integrations
are not qualified. Install Node.js 24.22.1 or a newer compatible 24.x release,
including npm, and extract the [llama.cpp b12317 Windows x64 Vulkan runtime](https://github.com/ggml-org/llama.cpp/releases/tag/b12317).
Reopen PowerShell after installation,
then open the writable project folder containing `package.json`.

Check `node --version` and `npm --version`, then follow the commands in the
[root README](../README.md#start-from-source). The `npm ci` step installs the
required JavaScript libraries from `package-lock.json`; complete it before
starting Capri. Missing `node`/`npm` commands require Node.js with npm, while
`Cannot find module`/`ERR_MODULE_NOT_FOUND` requires a successful `npm ci` in
the project folder. Capri Setup can repair its own installation and dependencies
by selecting the same folder, without a global Node installation.

Executable discovery checks the bundled llama.cpp directory and PATH.
`CAPRI_NODE_PATH` and `CAPRI_LLAMA_PATH` can point to absolute executable paths.
Keep the Windows runtime DLLs next to `llama-server.exe`. Public defaults are in
`config/core.json` and private overrides in `config/core.local.json`.
Noninteractive profile setup accepts `--profile=balanced --yes`. Deliberate
replacement also needs `--replace`.

The managed llama.cpp service uses loopback port 11435 by default. The existing
`ollamaPort` override still applies. Existing Qwen and BGE-M3 weights in
`data/models` can be reused directly, as can installed Hugging Face GGUF packages.
Ministral needs the llama.cpp-compatible weights and projector fetched by model
preparation. OpenClaw defaults to port 18789. Capri checks process ownership before
stopping a service and leaves unrelated services alone.

The first Gateway start after a clean installation can take several minutes while
its runtime modules are loaded. Capri waits up to ten minutes for its own live
Gateway, rather than treating a two-minute cold start as an offline failure.
Process identity is rechecked every five seconds; an exited or replaced process
fails promptly. Quitting during this readiness wait cancels it. Language-model
preparation follows Gateway readiness. Startup messages and progress remain
visible during preparation; missing model downloads are a separate setup issue.

Model downloads happen only with models:pull. A small model still needs substantial memory. First loading is slower than a warmed reply. Text mode requires no training recording or CUDA installation.

## Optional packs

The Python setup commands use Capri's private `uv` runtime or an existing `uv`
on PATH. If it is missing, the bootstrap uses bundled Node or Node 24 on PATH
to restore the pinned, checksum-verified runtime automatically. If Node is also
missing, run Capri Setup to repair this folder or install Node 24 with npm and
retry. No global Python or `uv` installation is required for the graphical path.

The common bootstrap locates or obtains pinned Python 3.11.17 and creates separate
environments. `setup-streaming-asr.cmd` installs CPU recognition;
`setup-multilingual.cmd` adds multilingual recognition and voice components.
`setup-request-router.cmd` installs the CPU classifier, which the wizard already
includes automatically. These commands download locked files.

`setup-voice-training.cmd` selects NVIDIA CUDA or the experimental supported AMD ROCm runtime for Chatterbox. Both a compatible environment and a valid exported voice profile are required; support is not universal across AMD cards. A release setup includes Capri's reference profile: select **Chatterbox / Capri / Conversation language** to install its matching backend and pinned base weights without user training. For compatible languages, **Hugging Face · Qwen3-TTS (CPU, BETA)** is a separate option that does not require a dedicated GPU and may synthesize slower than real time. Source-only exports do not include the optional voice pack; use the release setup, import a compatible release pack or build with `--voice-pack`. See [AMD voice](amd-voice.md), [voice installation](voice-installation.md) and [voice distribution](voice-distribution.md).

Capri starts with microphone capture and voice replies off. Their models remain unloaded until you enable the corresponding microphone or speaker button. Installing a pack does not grant microphone permission or automatically enable it at each launch.

The source and setup include the reviewed assets/capri/sprites/v1/runtime-sprite-set.json pack; the original assets/default symbol remains a fallback. Distribute optional packs only with suitable rights. Spotify, screen and OS tools retain separate permissions; setup grants none.

## Data and rollback

If speech settings offer Automatic but Capri stays silent, check Languages for
the installation status. Automatic selects a voice; it does not install one.
English requires the exported Capri adapter/reference, the voice Python runtime,
and the pinned Chatterbox Turbo base models. Recognition has its own environment
and does not install speech synthesis. Use **Download voice installer**, run
`CapriSetup`, select the existing Capri folder and choose the included English
voice. Close Capri before repair, complete setup and restart it. Existing models,
history and settings are retained. `setup-voice-training.cmd` alone downloads the
base runtime/model but does not supply the Capri adapter/reference pack.

Portable data/, .runtime/ and logs/ remain ignored. data/workspace owns memory, data/openclaw owns conversation/credentials, and data/desktop stores UI settings. Back up private data separately from source. For rollback, stop Capri and use a separate folder with a verified release source archive; do not overwrite live data or assume an older application can read newer settings. See [updates and recovery](updates.md).

Use npm run doctor for hardware/software/profile diagnostics. Missing models need models:pull; missing optional speech does not require reinstalling the desktop. Redact logs and personal paths before reporting a problem.

Dependency lifecycle policy allows the reviewed OpenClaw compatibility hook, Electron and esbuild installers. Unused transitive Koffi, Google SDK no-op and protobuf postinstall hooks are explicitly disabled. Changes to this policy require dependency review.

Stop managed Capri services before deliberately changing a hardware profile. Setup preserves unrelated local overrides and reconciles only managed model/context fields in an existing Gateway configuration; memory, plugins and tool permissions are retained.

# Repair after an interrupted installation

Run Capri Setup again and select the same installation folder. Close the old
setup window first. Conversation, memory, downloaded model layers and package
caches are retained.

Setup checks npm's dependency graph and the required llama.cpp executables and
DLLs. Repairs use the checksum-verified archive and keep the previous runtime
if the staged copy cannot be promoted.

Interrupted ASR/router/voice Python environments are retained under
`.runtime/venv-recovery/` before recreating the owned environment. Healthy Python
3.11 environments are reused. No `--clear`, global Python change or model/history
reset is used. Recognized transient uv network failures, including exit code 2,
retry the same locked dependency command with its existing cache.

If voice setup reports `os error 10054` or `tls handshake eof` while fetching a
`.whl` from `download-r2.pytorch.org`, the HTTPS connection was interrupted. A successful ping to
PyTorch does not test the file server, TLS connection or a sustained download.
After a transient failure on this host, setup retries the same pinned Torch and
TorchAudio wheels through the official `download.pytorch.org` delivery path.
Both CUDA 12.4 and CUDA 12.8 profiles keep their existing versions; the fallback
uses pinned SHA-256 hashes. Other packages remain on their original sources.
Authentication, certificate and checksum errors are not bypassed.
TLS EOF failures also activate this recovery: setup retries at most three times,
preserving downloaded packages and reducing concurrent transfers on retry.

If the alternate source is also unreachable, try another network or a VPN/proxy
that covers the installer process, then retry in the same folder. A browser-only
VPN extension does not cover Capri Setup. Keep the package cache; a failed voice
download does not require deleting Capri, its models or personal data. Export the
setup diagnostic ZIP if retry still fails, since a reset alone cannot identify
whether the server, provider or an intermediate filter interrupted it.

Model pulls retry transient connection failures and retain partial downloads for
retry. **Save report (ZIP)** includes bounded, redacted local runtime logs
alongside installer, npm and UI logs.
