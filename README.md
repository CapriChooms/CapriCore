<img src="assets/default/icon-source.png" alt="CapriCore lightning logo" width="72" align="right">

# CapriCore · Capri 1.0.0

A Windows AI desktop companion powered by OpenClaw: bundled local LLMs, Hugging Face GGUF models or OpenAI-compatible APIs, with shared conversation and memory, 50 interface languages, optional voice and explicitly enabled desktop tools.

[Website](https://capri-core.com/) · [Discord](https://discord.gg/capricore) · [Documentation](docs/README.md) · [Roadmap](ROADMAP.md) · [Contribute](CONTRIBUTING.md)

**[Download Capri 1.0.0 for Windows](https://github.com/CapriChooms/CapriCore/releases/download/v1.0.0/CapriSetup-1.0.0.exe)** · [Release notes](docs/releases/1.0.0.md) · [Report a bug](https://github.com/CapriChooms/CapriCore/issues/new/choose)

The public repository and releases are **CapriChooms/CapriCore**. Downloads and update checks do not require a GitHub account, invitation or token.

## What Capri can do

- **Choose your inference.** Use bundled Qwen3.5 models, BETA Gemma/Ministral alternatives, compatible Hugging Face GGUF imports, or saved OpenAI-compatible API connections. Switch from the Local/API control without clearing the conversation.
- **Talk and remember.** Text chat, optional local speech recognition and voice, independent language settings, communication styles, searchable memory facts and a local document knowledge base.
- **Live on the desktop.** Animated expressions and mouth layers, headpats, lightning teleports, window-edge poses, floating dialogue, compact controls, tray mode, themes and resource monitoring.
- **Use tools with permission.** Scoped app/file actions, Spotify, Discord desktop control, web search, deep-thinking mode, recorded workflows and approved user tools. Computer control is BETA and uses a visible indicator with Escape cancellation.
- **React to music and calls.** Optional local system-audio music detection with BPM animation, and microphone/system-audio call features with a separately configured virtual cable.

Capabilities depend on the selected model, its tool/image support and your permissions. Complex workflows, individual GPU backends and additional voices still need configuration and can require your help; see [current limits](docs/releases/1.0.0.md#limits-to-know).

## Quick installation

On Windows 10 22H2/11 x64, run **CapriSetup-1.0.0.exe** from the release, or extract the source package and double-click **Install Capri.cmd**. The wizard installs per-installation Node/npm/Ollama runtimes, selected models and optional speech components; the CPU request classifier is included. Choose local LLMs, Hugging Face model selection, or API mode (BETA). API mode skips local conversation-model downloads and, by default, startup loading. No global Python/Node installation or terminal is required.

For a first installation, complete this wizard before opening **Capri.exe**. Use
the same wizard and installation folder to repair missing runtimes or dependencies.

**Upgrading from private early access:** run the 1.0.0 installer and select your existing Capri installation folder. Do not uninstall first. This switches future updates to the public repository while preserving local data, downloaded models and personal settings. Old private-channel updaters cannot discover the new repository themselves.

For voice replies on a supported GPU, choose your **Conversation language** and the included **Capri · Chatterbox** voice. Setup installs English or the matching multilingual voice. The CPU Qwen3-TTS option is separate and BETA. No separate voice ZIP, destination folder, recording or training is needed for the included reference. Add or prepare voices later in **Settings → Language model → Voice models**. [Voice installation guide](docs/voice-installation.md), [release packaging](docs/voice-distribution.md).

Capri starts with the microphone and voice replies **off** on every launch. Their models stay unloaded until you enable the microphone or speaker button. Installing a speech pack does not turn it on automatically at startup; your selected languages and downloaded models are kept.

License/download consent, hardware profiles, language choices, progress, cancellation, repair and selective uninstall are explained in the [wizard guide](docs/installation-wizard.md). The installer is unsigned; publisher signing and broader clean-machine qualification remain release work. Capri has read/write access to its own installation folder by default, including code and configuration; revoke it in **Settings → File access**. Other folders, microphone and screen access require separate grants.

## Start from source

For manual local-model development on Windows 10/11 x64, install Node.js 24.22.1
(or a compatible later 24.x), npm and Ollama, then reopen PowerShell. Open the
extracted or cloned folder containing **package.json** and run:

```powershell
node --version
npm --version
npm ci
npm run doctor
npm run setup
npm run models:pull
npm run desktop
```

`node --version` should show `v24.22.1` or a newer 24.x version. `npm ci` installs
the JavaScript libraries from the lockfile; wait for it to finish successfully
before continuing. If startup reports `Cannot find module` or
`ERR_MODULE_NOT_FOUND`, repeat `npm ci` in this folder. If `node` or `npm` is not
recognized, install Node.js with npm and reopen PowerShell, or use the graphical
installation above. [Detailed setup and repair](docs/installation.md).

Setup explains hardware profiles and saves an ignored local override; it downloads no models. The model command downloads only the selected text model and memory embedding model. Allow several GB of disk space. A separately managed Ollama process uses the configured project port and model store. `npm stop` releases managed resources.

The source package includes the reviewed Capri sprites and animations, plus a procedural fallback avatar. Recordings and trained voice weights remain separate optional packs. Missing speech packs leave text chat available. [Installation](docs/installation.md).

## System requirements

**Windows 10 22H2 or Windows 11, x64.** The smallest supported configuration has
**8 GiB system RAM**. Requirements above that depend on where the language model
runs and which speech components you enable.

| Inference mode                     | System RAM                                      | Dedicated GPU / VRAM                                         | Model storage                                    |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| Cloud API (BETA)                   | 8 GiB planning minimum; local speech needs more | No dedicated GPU required for text chat                      | No local conversation-model weights              |
| Bundled local LLM                  | See the hardware profiles below                 | Optional for CPU inference; enough free VRAM for GPU offload | Selected model weights plus runtimes             |
| Hugging Face local GGUF (BETA)     | Depends on model, quantization and context      | Depends on model and offload; CPU execution is possible      | Selected files, download cache and Ollama import |
| Local API, such as Lemonade (BETA) | Capri plus the local server's requirements      | Depends on the server's CPU/GPU/NPU backend                  | Models managed by that server                    |

**RAM, VRAM and free disk space are separate resources.** GPU-offloaded weights
use VRAM; CPU inference uses RAM, and partial offload uses both. Shared GPU memory
borrows system RAM. Leave room for Windows, games and other applications.

### API connections (BETA)

Choose **Use API** during installation, or open **Settings → External AI provider**
to add, test and switch between saved connections.

| Provider preset                     | API base URL                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| OpenRouter                          | `https://openrouter.ai/api/v1`                             |
| ProxyAPI                            | `https://api.proxyapi.ru/v1`                               |
| DeepSeek                            | `https://api.deepseek.com`                                 |
| Google Gemini                       | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Hugging Face Inference Providers    | `https://router.huggingface.co/v1`                         |
| Lemonade (local CPU/GPU/NPU server) | `http://127.0.0.1:13305/api/v1`                            |
| Custom                              | Your OpenAI-compatible Chat Completions endpoint           |

For cloud providers, use a key and model ID issued by the chosen provider.
For Lemonade or another loopback server, leave the key blank unless the server
requires authentication. Tool calls and images must
be supported by that exact model; enable their switches accordingly. Cloud APIs
need an internet connection and an available provider account; usage charges and
provider data policies apply. Messages, relevant memory and tool results are sent
to the provider; selected screen images are sent when vision is enabled and used.

API mode skips downloading the local conversation LLM and skips loading it by
default. Keep **Skip local language model when using an API** enabled to retain
that startup behavior; turning it off can warm an already installed local model.
Capri's interface,
local embedding model and CPU request classifier still run locally. Recognition
and TTS remain local, optional components with their own requirements. A model
served by Lemonade on the same PC still consumes that PC's resources.

### Hugging Face models (BETA)

For **local language models**, choose Hugging Face in the installer, then select
a model in **Settings → Language model**. Capri downloads a selected **GGUF**
quantization, including all parts of split GGUF models, and imports it into the
managed Ollama runtime. The model architecture must be supported by that runtime.
Vision also needs compatible model/projector files; tool and image support are
checked separately. Arbitrary Transformers/Safetensors repositories are not
automatically compatible.

Memory use depends on the chosen weights, quantization, context and GPU offload.
Before a specific model is selected, RAM/VRAM requirements are **unknown**, not
the same as cloud API mode. Check the selected model's estimates and available
memory before downloading. Local models need no cloud API account; gated Hub
repositories may require accepting their license and providing an HF token.

For **voice**, the supported adapters include Chatterbox Turbo (English),
Chatterbox Multilingual and **Qwen3-TTS 0.6B Base (CPU, BETA)**. Qwen3-TTS adds an
estimated **4–8 GiB RAM**, needs no dedicated VRAM for synthesis and may run slower
than real time. Language availability depends on the adapter. Downloading an
arbitrary Hub TTS model does not make it compatible or guarantee Capri's voice.

### Hardware profiles

These planning figures cover one conversation with **32K context** and the
bundled quantizations. VRAM figures describe model consumption, while system RAM
targets describe total PC capacity. They do not include optional speech.

| Text model            | Estimated model VRAM in use | System RAM target with a suitable GPU | Conservative CPU-fallback RAM target |
| --------------------- | --------------------------- | ------------------------------------- | ------------------------------------ |
| Qwen3.5 0.8B          | 1.3–2.2 GiB                 | 8 GiB                                 | 8 GiB                                |
| Qwen3.5 2B            | 2.8–4 GiB                   | 8 GiB                                 | 16 GiB                               |
| Qwen3.5 4B            | 4–6 GiB                     | 12 GiB                                | 24 GiB                               |
| Qwen3.5 9B            | 7–10 GiB                    | 16 GiB                                | 32 GiB                               |
| Ministral 3 3B (BETA) | 3.5–6 GiB                   | 12 GiB                                | 16 GiB                               |
| Gemma 4 E2B (BETA)    | 8–12 GiB                    | 16 GiB                                | 24 GiB                               |

GPU acceleration depends on the installed Ollama backend and drivers. A card
needs additional headroom for the display, other applications and any GPU voice.
CPU execution and partial offload can be slower and consume more system RAM.

**16 GiB RAM plus 16 GiB VRAM does not guarantee comfortable 9B operation.**
The 16 GiB RAM target assumes text-only use and a working GPU backend; it is not
a promise that RAM stays almost unused. Windows, the browser, Capri's core,
CPU speech recognition and optional TTS still need system RAM. Loading peaks,
longer context and driver-managed shared memory can increase it further. On a
16 GiB PC, start with 2B/4B and speech off, or use an external API. Confirm actual
offload rather than inferring it from VRAM capacity. Diagnostic reports include
`resources.json` with the local model's resident CPU/GPU allocation counters and
Capri's process working sets, separately from total system usage.

### Optional speech and local components

| Enabled component                       | Additional RAM estimate | Additional VRAM estimate |
| --------------------------------------- | ----------------------- | ------------------------ |
| English Chatterbox voice                | 2–4 GiB                 | 2.5–4 GiB                |
| Multilingual Chatterbox voice (BETA)    | 3–6 GiB                 | 3–6 GiB                  |
| Hugging Face Qwen3-TTS CPU voice (BETA) | 4–8 GiB                 | 0 GiB                    |
| English recognition on CPU              | 1–3 GiB                 | 0 GiB                    |
| Multilingual recognition on CPU         | 2–5 GiB                 | 0 GiB                    |
| CPU request classifier                  | 0.1–0.5 GiB             | 0 GiB                    |

The app/core and transient memory retrieval have a separate planning allowance of
**2–4 GiB RAM** and approximately **0.2–1.2 GiB graphics memory**. A discrete GPU
is not required for the interface. Larger context, images and model loading can
increase peaks. These ranges are estimates, not measured guarantees or download
sizes. Chatterbox voice uses NVIDIA CUDA or experimental support for selected
AMD ROCm GPUs on Windows 11; Qwen3-TTS provides the separate CPU voice option.
See [AMD voice requirements](docs/amd-voice.md) and [hardware policy](docs/hardware.md).

### Free disk space

For reference, the current **API text-only** clean-install estimate is roughly
**3 GiB of downloads and 8 GiB free disk space**, including runtimes and local
helpers, with recognition and voice deselected. Local LLMs, speech packs and
their dependencies add to this. Hugging Face imports can temporarily need both
the download cache and an Ollama copy of the selected weights.

The installer recalculates downloads and required free space for the selected
components and checks the destination drive before installation. Keep extra room
for updates and personal data. RAM/VRAM estimates update with component choices;
an unknown Hugging Face model remains unknown until selected. Older installers
can have different estimates and component choices.

## Use and development

`Capri.exe` opens the desktop without a console. In a source checkout, create it with `tools/setup/create-local-launcher.ps1 -DesktopShortcut`; `capri.cmd` remains a terminal-compatible launcher. Enter sends; Shift+Enter adds a line. Drag the header to move the window and the sprite to reposition the character. The diamond toggles signal core. The menu contains languages, audio, appearance and permissions. Interface language is independent of conversation, recognition and voice. Camera support is not implemented. [Desktop guide](docs/desktop.md), [languages](docs/languages.md).

```powershell
npm run check
npm test
npm run format:check
npm run verify:dimming
npm run verify:languages
npm run release:check
npm run release:source
```

Default Node tests use fixtures; `npm run test:assets` qualifies the separately supplied full sprite pack. Python 3.11 is needed for Python checks and speech development. Source exports go into ignored `release/capri-source-*` with SHA-256 manifests and exclude private data, models and original archives. No command publishes to GitHub automatically.

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [architecture](docs/architecture.md) and [third-party notices](THIRD_PARTY_NOTICES.md). Existing installations preserve local model choices, memory and trained voice data. Project-owned code is GPL-3.0-only; see [LICENSE](LICENSE). Optional media/model packs have separate terms.

## Companion controls

The reviewed character sprites and animations are included in source and setup exports.
Use Capri.exe for a silent launch. New support, report, personality, wake sound,
follow-up listening and memory controls are described in [Companion controls](docs/companion-controls.md).
See [Character assets](docs/character-assets.md) for the separate artwork notice.

In-app **Updates (BETA)** checks **CapriChooms/CapriCore**, downloads verified releases and restarts a
managed installation while preserving personal data. Experimental builds are optional.
Public updates work without a GitHub account or token; an expired optional token
does not block anonymous access. See [Updates and recovery](docs/updates.md).

Choose Neutral, Romantic, Business or Wild under **Companion settings → Conversation**.
Styles apply to the next reply and retain your editable Personality. Simple replies
are brief by default. [Communication styles](docs/communication-styles.md).

Choose **Language model** in Settings to download and switch between Qwen3.5
0.8B, 2B, 4B and 9B, or the BETA Gemma 4 E2B and Ministral 3 3B choices. The same
choices and separate RAM/VRAM estimates are available during installation. [Model selection](docs/models.md).

Optional inference routes include [external AI providers](docs/external-api.md), local Hugging Face GGUF imports, and the bundled Qwen3.5, Ministral 3 and Gemma 4 models. Speech is a separate choice: GPU Chatterbox or CPU Qwen3-TTS (BETA). [AMD speech requirements](docs/amd-voice.md).

## Privacy and safety

Local inference keeps model requests on the PC. Selecting a cloud API sends the
request context, relevant memory and enabled tool results to that provider;
screen images are shared when vision is enabled and used. Optional downloads still
contact their hosting services. Review permissions before enabling desktop tools.

API credentials are encrypted for the Windows account. Conversation history,
attachments and ordinary memory are stored locally **without full encryption**;
the separately password-protected private memory has its own protection. Diagnostic
exports are saved for review and are not uploaded automatically. See [Security](SECURITY.md)
and [diagnostic reports](docs/diagnostic-reports.md).

## Community and development

Anyone can download the public releases, browse the source and fork this repository.
Send changes through a pull request: `main` requires the `windows` CI check,
resolved review threads and an up-to-date branch, and blocks force pushes/deletion.
See [Contributing](CONTRIBUTING.md) for setup and validation.

[Report a bug](https://github.com/CapriChooms/CapriCore/issues/new/choose) with the
version, selected model/provider, reproduction steps and reviewed diagnostics.
Use [private vulnerability reporting](https://github.com/CapriChooms/CapriCore/security/advisories/new)
for security issues. The [Hall of Fame](docs/hall-of-fame.md) preserves early-access
supporters, donors, helpers and the core team.

Project-owned code is **GPL-3.0-only**. Character artwork, voices, model weights
and third-party packages have separate terms; see [licensing](docs/licensing.md)
and [third-party notices](THIRD_PARTY_NOTICES.md). Earlier release notes and dated
implementation plans are historical records; current setup guidance starts in
the [documentation index](docs/README.md).
