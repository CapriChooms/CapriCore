# Installation

For the graphical path, run CapriSetup.exe or double-click Install Capri.cmd from an extracted source package. The wizard automatically provisions its own runtimes; the manual prerequisites below apply to command-line installation. See [the wizard guide](installation-wizard.md).

For a ready-to-install download, use the versioned CapriSetup executable under
GitHub Releases. An extracted source archive must include the reviewed runtime
catalog at assets/capri/sprites/v1/runtime-sprite-set.json and all 68 referenced PNG
frames, regardless of the voice/model choices. If setup reports incomplete source
artwork, obtain a complete archive or the release setup before retrying. The
standard Git archive is regression-tested to retain this artwork while excluding
private data, logs, model caches and other root distribution exclusions.

## Manual source installation

The first desktop target is Windows x64. ARM64 and Linux/macOS desktop integrations
are not qualified. Install Node.js 24.22.1 or a newer compatible 24.x release,
including npm, and Ollama 0.40.10 or newer. Reopen PowerShell after installation,
then open the writable project folder containing `package.json`.

Check `node --version` and `npm --version`, then follow the commands in the
[root README](../README.md#start-from-source). The `npm ci` step installs the
required JavaScript libraries from `package-lock.json`; complete it before
starting Capri. Missing `node`/`npm` commands require Node.js with npm, while
`Cannot find module`/`ERR_MODULE_NOT_FOUND` requires a successful `npm ci` in
the project folder. Capri Setup can repair its own installation and dependencies
by selecting the same folder, without a global Node installation.

Executable discovery uses standard Node/PATH and installed Ollama; existing bundled runtimes are optional fallbacks. CAPRI_NODE_PATH and CAPRI_OLLAMA_PATH can select existing absolute executable paths. Public defaults are in config/core.json, private per-installation overrides in config/core.local.json. Setup recommends a profile without silently replacing an existing selection. Noninteractive setup accepts --profile=balanced --yes; deliberate replacement also needs --replace.

The project manages its own Ollama, default port 11435 and model store data/models; OpenClaw defaults to 18789. An occupied unmanaged port is an error: choose a free local port or stop that service yourself. Process creation time must match the saved PID before Capri stops a service. The application does not stop unrelated system Ollama processes.

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

setup-voice-training.cmd selects NVIDIA CUDA or the experimental supported AMD ROCm runtime. See [AMD voice](amd-voice.md). Both a compatible environment and a valid exported voice profile are required. A release setup can include the trained Capri voice: select the included voice in the wizard and it installs the pack and pinned base weights without user training. Source-only builds do not include weights; import the separate release voice ZIP after extracting it, or build a setup with --voice-pack. AMD hardware synthesis remains unqualified on the NVIDIA development PC; unsupported graphics can still use text mode. See [voice distribution](voice-distribution.md).

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

Portable data/, .runtime/ and logs/ remain ignored. data/workspace owns memory, data/openclaw owns conversation/credentials, and data/desktop stores UI settings. Back up private data separately from source. The private pre-refactor archive has a verified checksum manifest; extract rollback source into a separate folder with services stopped, without overwriting live data.

Use npm run doctor for hardware/software/profile diagnostics. Missing models need models:pull; missing optional speech does not require reinstalling the desktop. Redact logs and personal paths before reporting a problem.

Dependency lifecycle policy allows the reviewed OpenClaw compatibility hook, Electron and esbuild installers. Unused transitive Koffi, Google SDK no-op and protobuf postinstall hooks are explicitly disabled. Changes to this policy require dependency review.

Stop managed Capri services before deliberately changing a hardware profile. Setup preserves unrelated local overrides and reconciles only managed model/context fields in an existing Gateway configuration; memory, plugins and tool permissions are retained.

# Repair after an interrupted installation

Run Capri Setup again and select the same installation folder. Close the old
setup window first. Conversation, memory, downloaded model layers and package
caches are retained.

Setup checks npm's actual dependency graph, not just `node.exe`, and checks the
required Windows Ollama backend files, not just `ollama.exe`. An incomplete runtime
is repaired from a checksum-verified archive; unchanged files are not rewritten.
If required files remain unavailable after extraction, setup reports the repair
failure instead of marking that runtime ready. An incomplete Ollama runtime at
app startup also reports a specific repair instruction.

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

Model pulls retry transient connection failures with a bounded limit. Installer
pulls can recreate an exited owned Ollama service, but never kill a living service
or a foreign process. **Save report (ZIP)** now includes bounded, redacted Ollama
log tails as well as installer/npm/UI logs. Persistent network, file-permission or
quarantine failures still need attention; retries do not override these protections.
