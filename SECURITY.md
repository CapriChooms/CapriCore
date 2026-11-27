# Security

This policy applies to CapriCore and the Windows installer. When reporting a
problem, include the installed version, release channel, operating system and
whether the problem also occurs on the latest public release for that platform.
See the [release notes](https://github.com/CapriChooms/CapriCore/releases) for the
changes in each public build.

Permission bypass, malformed IPC, path traversal, unwanted capture, credential leakage and unsafe process termination are security issues.

The installation scope in File access is read-only and can be revoked. Older writable grants migrate to read-only. The file tool protects the installation even when its parent folder or a whole drive is granted. Runtime credentials, private configuration backups and other private data use dedicated controls. Screen permissions, desktop input and coding tasks have separate trust boundaries.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/CapriChooms/CapriCore/security/advisories/new). Do not post exploit details or credentials in public issues. Provide a minimal fixture-based reproduction; never attach private data, recordings, models or unredacted logs.

The source exporter is a defense layer, not a guarantee that arbitrary future code contains no personal data. Review the artifact before publishing. Rotate any exposed credential. CI has read-only repository permissions; untrusted pull requests must not publish releases or run privileged desktop actions.

## Runtime dependencies

The [upstream lock](config/upstream-lock.json) records the source and versions of
the pinned runtimes. The [installer manifest](config/installer.json) pins the
Windows Node.js and Electron archives by SHA-256. The
[npm lockfile](package-lock.json) records the installed JavaScript dependencies.
When checking advisories, compare the affected range with the version installed
by the specific Capri release. Electron embeds its own Node.js and Chromium.

The [reviewed dependency backports](docs/security-backports.md) document two
upstream denial-of-service fixes applied to the installed npm dependencies. The
packages retain their published version numbers, so version-based scanners may
still report those two advisories and their dependency chains.

The [dependency audit workflow](.github/workflows/dependency-audit.yml) runs npm
audit and OSV separately from installation. It scans each optional Python
environment and the voice build backends. It retains both reports and CycloneDX
inventories of the npm and Python locks on release runs. Review the affected profiles in the
Python report. An advisory in an optional package can require a particular
input format, device backend or service to be reachable.

The Windows ASR, request router and OpenVINO setups require SHA-256 hashes for
their complete runtime locks. Chatterbox uses hashed distributions and two
full Git commit IDs. Its isolated build backends have a separate hashed lock.
The Windows installer ignores inherited package indexes and hash-check overrides.

Capri calls Chatterbox through its Python inference API. Its environment omits
the upstream Gradio demo server and uses separately tested Transformers,
Diffusers and Safetensors pins. A metadata consistency checker will report
these differences from Chatterbox's declared requirements. Qwen has a separate
environment and dependency graph.

The CUDA 12.4, Blackwell and experimental ROCm profiles still use PyTorch versions with
published advisories. Capri verifies the distributed speech checkpoint bytes
against the pinned manifest before loading them. A change to the PyTorch family
also needs a matching TorchAudio wheel and synthesis tests on the target GPU.
See the [PyTorch checkpoint advisory](https://github.com/pytorch/pytorch/security/advisories/GHSA-63cw-57p8-fm3p).

The Qwen speech package pins Transformers and Accelerate independently of
Chatterbox. Its Gradio dependency also constrains Pillow. Check the Qwen lock
when reviewing alerts for those packages, even on systems using CPU speech.

## Personal data at rest

Conversation history, attachments and ordinary memory use local file storage. Stored API credentials use Electron safeStorage backed by Windows DPAPI on Windows. That protection is scoped to the current Windows account and assumes the account and Capri process are trusted. The separately password-protected private memory feature protects entries in its own vault. Ordinary history and other copies of that information remain outside the vault.

A read-only compatibility decoder can recover dialogue and image previews from the withdrawn local encryption experiment using the original Windows account and saved key. It never creates a key or encrypts new files. Unreadable history is preserved instead of being overwritten by new messages.

## External providers and enabled tools

Local inference and an external API have different data boundaries. When an
external API is selected, the configured provider receives the conversation
context, personality, relevant memory and tool results needed for a request.
Enabled vision can also send selected screen images. A server running on this
PC may keep that inference local, but its configuration and logs are controlled
by that server. Provider retention, pricing and privacy policies apply; see
[external AI providers](docs/external-api.md).

The optional ChatGPT plan connection has its own browser authorization, PKCE,
signed identity validation and account-bound encrypted token store. It does not
reuse ChatGPT, Codex, Claude or Gemini credentials from installed applications.
Access tokens are sent only to OpenAI's official public API. The renderer
receives account presentation and model IDs, never tokens. Account switching,
refresh, revocation, cancellation and plan-use consent are documented in
[AI app connections](docs/desktop-ai-providers.md). Screen observation is paused
before opening sign-in. App discovery runs on demand and never executes detected
AI command-line programs or imports their private settings.

**Voice API** is a separate, disabled-by-default choice. When enabled, only the
text selected for speech (including explicitly requested previews and wake replies)
is sent to the configured voice provider, with the selected voice and model IDs.
It does not send microphone audio, reference recordings, screen images or the
conversation history. The spoken reply can itself contain personal information;
the provider's retention policy applies. Its key has separate account-bound
DPAPI storage. Provider error bodies and audio are excluded from diagnostics.
There is no automatic local fallback that silently reloads a voice model.
See [external voice](docs/external-tts.md).

Screen, microphone, file access and computer actions require their applicable
permissions. Review grants before enabling full computer control or a third-party
user tool. A local tool can have its own network and file behavior; declaring a
permission does not establish that its script is trustworthy. Stop an active
computer-control session with **Escape**.

Speech recognition can request an action. Pending desktop approvals require a
typed response or a confirmation button, depending on the action. The managed
voice worker and its GPU probe receive an allowlisted environment.

During startup, Capri restores its managed gateway plugin and tool policy,
loopback binding, and token authentication. The managed llama.cpp bridge
requires a separate credential for model import, download, deletion and
explicit unload. Its inference and discovery endpoints remain available on
loopback for provider compatibility.

Public downloads and update checks use
[CapriChooms/CapriCore](https://github.com/CapriChooms/CapriCore/releases) without
a GitHub account or token. Optional saved GitHub access stays protected by the
existing account-bound credential storage and is configured in Updates.
Download hashes and manifests detect
integrity problems; they do not replace publisher code signing. The current
Windows installer is unsigned.

## Logs and diagnostic exports

Managed services do not write arbitrary child stdout/stderr to disk. Capri keeps allowlisted service lifecycle, stage, error-class and error-code records. OpenClaw raw logging, prompt-cache traces and telemetry exports are disabled, including during existing-configuration migration. The owned legacy runtime log cleanup keeps bounded technical summaries and discards free-form text. Personal documents, conversation history and memory are not log sources.

Diagnostic exports omit legacy free-form log lines and unknown textual session fields. Error classes and stages, resource counters and benign hardware/service information remain available. The problem description and reproduction steps are the user's explicit report text; review these before sharing. Exporting a report never uploads it automatically. No guarantee is made for logs generated independently by third-party software, external tools or an older process that has not yet restarted into the updated privacy policy.
