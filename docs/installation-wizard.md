# Windows installation wizard

The Capri 1.0.1 wizard is a per-user source bootstrapper for Windows 10 22H2/11 x64. Download [CapriSetup-1.0.1.exe](https://github.com/CapriChooms/CapriCore/releases/download/v1.0.1/CapriSetup-1.0.1.exe), or start **Install Capri.cmd** from a complete extracted source distribution. Public downloads require no GitHub account or token. The cyberpunk-styled wizard runs with built-in Windows PowerShell and Windows Forms, before Node, npm or Python are installed. The application owns its runtimes; global PATH, drivers and system Python are not modified by the normal installation.

## User journey

On the model selection page, choose **Use local LLMs** to select a model for
this PC, or **Use an API without installing local LLMs** to skip local language
model downloads. The third choice, **Choose a local model from Hugging Face after installation**, defers GGUF selection to Settings. API mode keeps the small CPU model for the local memory index and the mandatory CPU request classifier, but skips startup loading of a local conversation LLM.
In API mode, Capri opens **Settings → External AI provider** on first launch, where you
enter the provider URL, model ID and key. Speech options are separate.

The fixed memory estimate panel appears on Hardware, Components and
Review. It separates system RAM from dedicated VRAM and stays visible while the
component list scrolls. Changing the text model, voice, recognition or conversation
language updates the approximate usage and remaining memory. The CPU classifier is always included. A not-yet-selected Hugging Face model shows **?** instead of a misleading API-sized estimate or memory bar.
Refresh takes another snapshot of current free memory without loading models.
Unknown GPU memory is labeled unknown; over-budget choices show a warning. The
GPU-path RAM requirement and conservative CPU fallback target are distinct.
See [the calculation and limits](hardware.md#installer-memory-budget-next-build).

| Page                     | Contents and defaults                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome                  | Installer language (all 50 Capri interface languages), supported platform, local inference and network requirement.                                                                                                                                                                                                                                                                                                       |
| License                  | GPL-3.0 text, third-party notices and explicit acceptance. No forced reading timers.                                                                                                                                                                                                                                                                                                                                      |
| Location                 | Browse selects a parent and proposes its Capri subfolder, created automatically when installation starts. The full path is visible and editable. Existing managed folders are reused; unrelated files are preserved.                                                                                                                                                                                                      |
| Hardware and model       | RAM/CPU/GPU evidence, recommended model, manual override, approximate storage budget and quality/speed tradeoff. Unknown VRAM is not guessed.                                                                                                                                                                                                                                                                             |
| Languages and components | Independent UI and conversation language. The CPU request classifier is always included. Recognition, local model downloads and shortcuts are optional; API/Hugging Face mode disables bundled conversation-model downloads. Voice choices include supported GPU Chatterbox, CPU Qwen3-TTS for compatible languages, text-only mode and compatible-pack import. Microphone and screen access remain separate permissions. |
| Review                   | Exact folder, model, components, approximate download/disk budget, data location and download consent. Back remains available.                                                                                                                                                                                                                                                                                            |
| Install                  | One overall progress bar, the current stage and activity, per-file transfer details when available, approximate ETA, pause/cancel, bounded diagnostics and retry. Verified downloads and successfully verified stages can be reused.                                                                                                                                                                                      |
| Finish                   | Installed/ready/deferred components, shortcuts, data/log locations, optional launch and next steps. Bundled-local mode also offers first-launch model preloading, checked by default; API/Hugging Face mode does not offer this checkbox. Failure never becomes a success screen.                                                                                                                                         |

## Engineering contract

Location discovery reads Capri's per-user uninstall registrations and standard installation folder, validates the managed identity and rejects linked/stale/unrelated candidates. A single valid installation is proposed automatically; with several matches the owner chooses the update destination. Explicit recovery of an active setup session keeps that session's original target.

Finish opens the installed `Capri.exe` with a fresh launch nonce. A new or existing desktop publishes a matching window-ready receipt; a failed/missing acknowledgement leaves Finish open for retry and records the launch error. Model readiness remains separate from window readiness, including when models were intentionally deferred.

Recognition and shortcut checkboxes start checked, including on lower-memory hardware; bundled-local mode initially selects model downloads. The CPU classifier cannot be deselected. The
hardware profile still controls the recommended language model, and compatible voices depend on the selected language and hardware. License acceptance
and download consent require explicit user action. Repair retains the hardware
profile and languages without silently deselecting components. Back/Next keeps the
user's current component choices; reconnecting to an active installation restores
that session's exact request instead of changing its components.

- Pinned HTTPS artifacts with reviewed SHA-256 before execution/extraction. ZIP extraction rejects escapes, links and duplicate names. npm uses the existing package lock and lifecycle allowlist.
- Installation identity and journal are local, durable and bounded. A single worker owns a target. Repair and supported upgrades retain data and local settings; changed source files are backed up before replacement. Setup can repair the same version or upgrade an older one. Use a separate folder for deliberate downgrades.
- A cancelled/failed component remains incomplete. A repeat install revalidates outputs; a journal entry alone is not readiness evidence. Partial models are never marked ready.
- Per-user Start menu and Installed Apps registration; no administrator prompt, startup entry, analytics, firewall changes or driver installation by default.
- Open `uninstall.exe` from the installed folder or use Windows Installed apps. The three checkboxes select Capri and its dependencies, downloaded models, and personal data. The window measures disk allocation and updates the total for the current selection. Selecting all three also removes Capri-owned setup files and media stored inside the managed installation. Shared setup caches are retained while another installation uses them.
- Headless installation uses the same validated request and engine. The GUI and optional components do not have separate installation semantics.

Hardware estimates are planning budgets, not measured performance guarantees. In-app public update checks are implemented; installing an update remains an explicit user action. Chatterbox supports compatible NVIDIA hardware and selected experimental AMD ROCm configurations; CPU Qwen3-TTS is a separate adapter. Broader GPU qualification, publisher signing, independent model/data locations and device audition remain follow-up work. Sources: [Microsoft application installation guidance](https://learn.microsoft.com/en-us/windows/apps/get-started/best-practices), [Ollama standalone distribution](https://docs.ollama.com/windows), [uv standalone distribution](https://docs.astral.sh/uv/getting-started/installation/).

## Build and verify

`npm run release:installer` builds a self-contained, unsigned Windows setup executable under ignored release/installer-\*/. Its embedded source ZIP and launcher have SHA-256 values in BUILD_MANIFEST.json. The launcher accepts `--extract-only <empty-folder>` for source/integrity inspection without launching setup. The older source ZIP is not overwritten.

The executable and native wizard use the same reviewed `assets/default/app.ico`
as Capri. The build preserves its multiple icon sizes for Explorer and the taskbar.

`npm run verify:installer` renders all eight pages in all 50 interface languages (400 page renders) without starting an installation. The default Node suite includes installer policy, cancellation, corruption, port allocation, voice import, transaction and Windows extraction/uninstall checks. `tools/verify/verify-installer-registration.ps1` checks actual shortcuts/registration in a temporary test namespace.

For a headless install, invoke `packages/installer/windows/worker.ps1` with absolute RequestFile, EventsFile and CancelFile paths. The request has schemaVersion=1, an empty/managed absolute target, profile, interfaceLanguage, conversationLanguage, recognition/router/downloadModels/desktopShortcut/startMenuShortcut booleans, optional voicePack folder, and explicit acceptLicense/acceptDownloads=true. The engine emits NDJSON stages and outcomes. Omitted models produce an installed-but-deferred state, never a ready-to-chat claim. Partial files are discarded; complete verified archives are cached. Retry resumes at component boundaries, not arbitrary byte offsets.

The installed folder exposes `Capri.exe`, `uninstall.exe`, and the `Support` folder with manual setup commands and project documents. Model and personal data stay inside the selected installation. Uninstall keeps them by default and preserves changed source files when personal data is retained. Installer logs and cache are private. A voice-enabled release embeds the ready-made pack; source-only builds need a separately extracted release pack or a custom export. See [voice distribution](voice-distribution.md). GPU drivers and system Visual C++ prerequisites are not silently installed.

A small per-user recovery uninstaller cache remains available until removal completes, allowing retry after application files or in-app metadata were already removed.

## Voice-source preflight fix

The spoken-voice selector offers an included trained Chatterbox voice and explicit compatible-pack import on supported GPU hardware, a CPU Qwen3-TTS option for compatible languages, and text mode. The custom file picker selects an existing voice-profile.json from a prepared English export; an empty download/driver folder cannot be selected as a voice package. Basic manifest and required-file checks run in the GUI and worker before any bootstrap download. Detailed compatibility and SHA-256 checks still run before installing voice dependencies or copying a pack. Text mode clears any stale source path. Missing source errors carry stable codes and localized guidance.

The Node bootstrap retries transient transport/EOF/timeout failures up to three times. It does not retry integrity failures or an explicit cancellation. A previously verified Node installation remains reusable when correcting a voice selection.

## First-install ordering and automatic folders

Windows shortcuts are created and read with the explicit Unicode `IShellLinkW`
interface and `IPersistFile`, rather than the Windows Script Host automation setter.
The latter rejected target paths outside the system ANSI code page: a Cyrillic
installation failed on the English GitHub Windows runner, and a mixed
Cyrillic/Japanese path reproduced the failure on a Russian PC. This affected first
installation as well as repair and update registration. No language-model failure
was involved. See [Microsoft's Unicode shell-link interface](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw).

The recovery uninstaller carries the same Unicode reader and loads it before
removing installed sources. It checks stored targets without resolving or launching
them and retains shortcuts that point elsewhere. Native tests register twice in a
mixed-language path, check target/working-directory/icon properties, and exercise
cached uninstallation with an unrelated shortcut that must survive. Test failures
include the actual PowerShell stack and registration pass.

The OpenClaw postinstall hook imports only filesystem paths and its reviewed patcher. It does not load runtime configuration or require Ollama during npm ci. Installation clears inherited Ollama overrides, installs and verifies its owned Ollama binary after dependencies, then publishes its explicit path before configuring Capri. Runtime executable validation remains strict. A regression starts with no Ollama or receipt, runs the real compatibility hook, checks inherited override isolation and verifies configuration happens after the binary receipt is written.

Browse selects a parent folder and shows its proposed Capri child in the full-path field. The child is created automatically when installation begins, after consent. Selecting an existing managed installation or a folder already named Capri does not add another Capri layer. A manually entered full destination can also be created automatically. Existing unrelated files are preserved; a conflicting Capri child is rejected. Browsing itself does not modify the filesystem.

Fresh-install verification exercised npm ci and CLI setup/doctor in a fresh Unicode path without a preinstalled Ollama. The available real Ollama executable was reused after npm ci rather than redownloading the full runtime archive. Model downloads, optional speech environments and clean-VM qualification were outside this particular check.

## Download performance

The native Node bootstrap waits for an asynchronous read to complete rather than sleeping for a fixed polling interval. It wakes immediately when bytes arrive, while checking cancellation at least every 100 ms during a stalled read. Read timeouts, byte limits, SHA-256 verification, retry policy and cache validation are preserved. No mirror or unverified alternate host is introduced.

A same-PC comparison against the same official Node URL measured about 0.062 MB/s in a cancelled 12-second sample of the previous implementation and 11.76 MB/s during the corrected transfer. The corrected run downloaded and verified the complete 37,748,064-byte ZIP, extracted Node and ran its version check in 16.1 seconds including startup and extraction. These are individual network observations, not guaranteed rates. A native regression check covers prompt task completion, stalled-read timeouts, cancellation and propagation of read failures.

## Isolated Python bootstrap

Recognition, router and voice setup share the same Python bootstrap. It prefers the bundled uv, pins the exact Windows x64 CPython 3.11.17 key in the installation's .runtime/python folder, and checks the interpreter's version before using it. It installs with --no-bin and --no-registry, overrides inherited Python installation locations, disables registry discovery and ignores external uv configuration. It does not replace an existing global python3.11.exe or require a global PATH change.

The bootstrap resolves the owned interpreter path directly instead of decoding a path from uv python find through Windows PowerShell's legacy native-output encoding. Its logs use UTF-8. A downloaded interpreter is reused on retry. Native regression coverage includes fresh installation in a Unicode path, a conflicting unmanaged global executable, reuse, incorrect versions and installation failures. See [uv's executable and registry options](https://docs.astral.sh/uv/reference/cli/#uv-python-install) and [environment controls](https://docs.astral.sh/uv/configuration/environment/).

## Model download progress and continuation

The explicit Parakeet, Silero, multilingual speech and request-classifier provisioners share a verified downloader. During transfer it reports each file's percentage, transferred/total MB, recent throughput and estimated seconds remaining about once per second. Connection and final verification messages distinguish network setup, transfer and cached files. The wizard maps this detail into one overall, nondecreasing installation bar: bootstrap occupies the first 10%, and the selected remaining stages divide the rest into rounded boundaries. Only successful completion reaches 100%. Its overall ETA is approximate and is withheld when progress is too early or stale, or while paused; it is not a frozen countdown or a claim that every stage takes equal time.

The installation warning occupies its own wrapped label between progress text and
the journal, with gaps that remain after text reflow and DPI scaling. Native UI
verification checks those gaps as well as the default component selections.

The CPU classifier's `model_quint8_avx2.onnx` is a 23 MB pinned Hugging Face download.
The shared downloader does not cap bandwidth or insert delays between normal
256 KiB reads. A complete, SHA-256-verified transfer through the production
downloader took 8.875 seconds (2.60 MB/s overall) in an isolated developer probe;
individual progress samples reached 5.08 MB/s. This is an observation, not a promised
rate or a fix for an unproven transport bottleneck. A previously reported
0.14–0.18 MB/s cannot identify its historical cause on its own; connection/CDN
conditions and local overhead can vary.

Interrupted `.partial` files are retained. Retrying requests the remaining HTTP byte range and checks the response range against pinned size metadata. If the server ignores ranges, the download restarts without appending duplicate bytes. Short reads and transient transport/server failures use up to six total attempts with exponential pauses capped at 30 seconds; `Retry-After` is honored up to the same cap. A stalled read has a 45-second timeout. Where a pinned alternate official URL is provided, attempts rotate between sources while keeping the same partial file and SHA-256 requirement. Only a complete SHA-256-verified model becomes the final file. Invalid checksums never replace an existing model. An exhausted network retry names the failed file and saved byte count, rather than leaving only a raw connection-reset traceback.

Twelve standard-library download tests cover integrity, progress, resumption, ignored/invalid ranges, connection resets, alternate-source rotation, extended retries, HTTP throttling, permanent authentication errors and useful failure messages. Three provisioning tests and an installer transaction check ensure the selected voice language is passed through setup. A real 34.6 MB Chinese archive was downloaded through the official GitHub API fallback after an injected primary connection reset; SHA-256 matched the original pin.

The Chinese-only segmentation archive is installed when Chinese is selected. Other selected voice languages do not depend on that unrelated download. Manual full multilingual setup still installs it, and `tools/setup/provision-multilingual.py --component chinese` can add it separately. Switching to Chinese checks these resources before reporting the voice ready. The archive's original GitHub release URL has a pinned official GitHub API asset URL as fallback; both must match the same byte count and checksum. Other providers retain their pinned sources and benefit from the longer resumable retry policy.

## Voice dependency sources and release checks

The locked voice environment uses PyPI as its default package source and an explicit PyTorch backend for the CUDA package family: cu124 for legacy GPUs, cu128 for Blackwell/RTX 50. Hardware selection and reviewed version overrides are described in [GPU voice compatibility](voice-gpu-compatibility.md). First-index resolution and isolation from inherited index/override settings are preserved. A general PyTorch index must not shadow unrelated packages such as certifi. Model, adapter and source pins remain unchanged. See [uv's PyTorch integration](https://docs.astral.sh/uv/guides/integration/pytorch/) and [index behavior](https://docs.astral.sh/uv/concepts/indexes/).

The setup script's -PlanOnly switch creates a private Python/empty voice environment and resolves the real lock without installing voice packages or downloading model weights; it can run on a CI machine without NVIDIA. GitHub Actions runs this check on a fresh checkout using the pinned uv version. -DependenciesOnly installs packages and returns before model provisioning. Normal Chatterbox setup checks the selected supported CUDA/ROCm backend and model before success; the separate CPU Qwen3-TTS option has its own setup path.

Voice dependency setup streams uv output and retries explicit transient package/Git
transfer failures up to three total attempts, with 2- and 4-second backoff. A Git
transfer failure such as `curl 18`/unexpected disconnect enables a process-scoped
HTTP/1.1 fallback on subsequent attempts. The command, exact source revisions,
CUDA family, index policy and package cache remain the same. No global Git settings
are written and no cache is cleared. Version resolution, authentication, access,
certificate, integrity and build failures are not automatically replayed. An
unclassified failure also stops immediately. Retry boundaries honor the installer's
pause file; Cancel retains the existing owned-process-tree termination behavior.

Native recognition tests provision the pinned 2.3 MB Silero detector explicitly with
`tools/setup/provision-streaming-asr.py --vad-only`. They do not depend on a developer's
existing speech-model cache and do not download Parakeet or Whisper weights. Normal
recognition setup without this flag still provisions both Parakeet and Silero.

## Installer localization

The Welcome language selector offers the same 50 locale IDs and native names as Capri.
Windows regional cultures resolve to their supported base language (including fil-PH
to Filipino and nb-NO/nn-NO to Norwegian), with English fallback. The chosen setup
language initially becomes the application-interface default; conversation and spoken
voice remain independent. Existing settings are retained during repair.

All eight pages, stage labels, pause/cancel/retry messages, voice-pack validation,
review/finish labels and known target/system errors use config/installer-text.json.
Setup.exe embeds the same catalog separately for failures before payload extraction.
An explicit --language=de option can select the initial setup language. No translator,
model or network call is needed to display translations.

Arabic, Hebrew, Persian and Urdu use mirrored right-to-left layout. Wrapped labels
and checkboxes grow instead of clipping; long pages scroll vertically. Footer buttons
are sized from their localized captions, with a separate pause row when necessary.
Paths, model IDs, GPL license text and third-party diagnostic output retain their
original values; system-owned file dialogs/buttons follow Windows localization.

The original English/Russian catalog is retained. Additional installer translations
were prepared with Google Translate from public UI text during development, reusing
existing Capri terminology where possible. No owner prompts, recordings, settings,
credentials or private files were sent. config/installer-glossary.json contains curated
contextual corrections. Native-speaker proofreading is welcome; structural validation
and machine translation do not constitute native linguistic qualification.

Developer-only regeneration: node tools/localization/translate-installer.mjs --public-ui-only
(optionally --locales=de,fr). It caches development requests under ignored .runtime,
protects filenames, product names, numbers and placeholders, and never runs in the
shipped wizard. Edit config/installer-text.json directly for reviewed corrections.
Build refuses missing languages, broken keys or altered protected fields.

Verification: tests/installer-localization.test.mjs validates all catalogs/culture
aliases and executes a compiled native C# localization harness with all 50 languages.
npm run verify:installer renders 400 Windows Forms pages, checks selected language,
RTL, progress wrapping and voice-validation errors, without starting installation.
The compiled setup is additionally extracted and checked against source/voice hashes.

## Sharp display at high DPI

Setup's bootstrap manifest uses Per-Monitor V2. The actual PowerShell UI thread
explicitly enables the same awareness before creating any control: a separate process
does not get its UI configuration from Setup's manifest. Native outline fonts and
layout are rendered at the current DPI, with a single conversion from logical units
to physical pixels. Windows bitmap stretching and repeated font-based auto-scaling
are avoided. Monitor-DPI changes rebuild the page while preserving field values,
progress and log text. Smaller work areas retain scrolling and visible footer controls.
See [Microsoft's DPI contexts](https://learn.microsoft.com/en-us/windows/win32/hidpi/dpi-awareness-context)
and [Windows Forms DPI guidance](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/high-dpi-support-in-windows-forms).

## Recovering a lost setup window

Reopen the setup executable. For an installation started with Preview 19 or later,
the window reconnects to the current worker instead of starting a second installation.
After loss of the UI, progress remains paused until explicit Resume. Pause and Cancel
controls are restored together with the current stage and recorded transfer progress.
If a healthy window already exists, setup attempts to bring that window forward.

The per-user controller stores requests, process identity, event history and UI leases
in %LOCALAPPDATA%/Capri/Installer/sessions/<session-id>/. The active-session registry
is outside temporary folders. The worker checks process ID AND creation time, UI
visibility and a heartbeat sent by the UI thread. A dead/hidden UI causes a pause;
a UI that stops responding first becomes stale after 15 seconds. A sustained stale
heartbeat is confirmed for another 5 seconds before automatic pause; a brief delay
after load or system resume can recover without a spurious pause. Confirmed process
exit or explicit window hiding still pauses immediately. Reconnecting does not clear
that pause. Expired UI instances cannot send commands after a replacement takes over.

Liveness uses monotonic uptime when available; changing/synchronizing the Windows
clock does not expire a fresh heartbeat. Guard decisions and Resume share the UI
control gate, and Resume publishes a fresh heartbeat before clearing pause. A busy
control gate is retried rather than treated as loss of the window. Foreground focus
is not required: using other applications does not pause the installer. UI event
reading is limited to 128 lines per tick, and console text is appended in batches
so a large package-manager/model log cannot monopolize the UI message pump.

Closing an active wizard offers to pause and close it. Reopen setup to continue.

Dependency setup recognizes npm's explicit transient network errors, including
`ECONNRESET`, and retries the same `npm ci` operation up to three times with bounded
backoff. Verified cached packages are reused; later attempts reduce simultaneous
connections. npm also receives bounded fetch retry settings. Cleanup warnings such
as `npm warn cleanup EPERM` do not override a primary network error. Permission,
integrity, engine/version, authentication and dependency-resolution failures are
not automatically replayed. Cancellation still stops retries. Persistent network
failure reports its actual npm code and keeps the cache for a later Retry.
The same dependency recovery is used for in-app updates. No alternate registry,
disabled certificate checks, cache purge or automatic dependency upgrade is used.

Repairing an existing installation stages changed source files in the installer
cache and replaces each destination with a same-volume rename, after backing up
its previous content. A read-only flag on an individual managed destination is
cleared for replacement; a failed replacement restores that flag. Temporary
Windows file locks receive three short retries. Persistent access failures stop
setup with the relative file path and an explanation, preserving its old contents.
Setup does not change directory permissions, ownership or security settings. User
data and mutable settings remain outside this source-replacement operation.

Cooperative model/dependency transfers retain partial files. Package managers cannot
always be paused safely halfway through an operation: their current operation may
finish, then the next step/command waits. Cancel remains explicit and stops the owned
command tree. No process suspension or automatic replay of uncertain actions is used.

Each setup launch writes local launcher/UI diagnostics under
%LOCALAPPDATA%/Capri/Installer/logs/. They record build/payload identity, stdout/stderr,
UI process exit code, managed exceptions, visibility/closing events and known exit
reasons. Active sessions also contain ui-events.jsonl, worker-guard.jsonl and worker
output. Open setup logs is available during installation and on the result page.
Hard termination has no managed stack trace; the worker records the observed loss of
the UI without labeling it an unexplained crash. Logs remain private and are not
uploaded automatically.

**Save report (ZIP)** is available on Installing and Finish/failure pages. One
click collects bounded session, npm and UI log tails plus version/system metadata,
saves the ZIP to Downloads and selects it in Explorer. A blocked Downloads folder
falls back to the installer registry's reports directory. Export uses Windows/.NET
and works before Node/Python/npm dependencies are available. Missing/corrupt records
produce a partial report with collection warnings. Credentials/paths receive
best-effort redaction; conversation, models and raw application configuration are
excluded. Review before sharing. Nothing is sent automatically. Startup script
failures offer export; **Save setup report.cmd** provides a standalone fallback from
an extracted source package when the main setup UI cannot be used.

For repeated npm tarball resets, setup can recover the exact locked package through
an HTTP Range download, verify its SHA-512 integrity, then seed npm's content cache
and rerun the original locked installation. The allowlist remains the original
HTTPS npm registry. Partial files and normal cache entries are retained. Unknown
download size uses an indeterminate progress bar instead of dividing by zero.
The optional anonymous HF Hub token hint is explained as informational; actual
rate limits, authentication and transfer errors remain visible.

Opening the same setup again verifies cached payload files and reuses matching files
without rewriting sources used by the running worker. Extraction is serialized.
Partial UTF-8 event records are buffered until complete; invalid records are logged
and pause progress instead of terminating the control window.

After a power interruption, malformed UI ownership/heartbeat JSON is retained as
`ui-owner.json.<id>.corrupt` or `ui-heartbeat.json.<id>.corrupt` inside its session.
Setup regenerates only those temporary control records and logs the recovery.
The recovered installation stays paused until explicit Resume; healthy live UI
owners still block a second controller. Requests, target identity, journals and
partial downloads are not reset. Filesystem links remain rejected. JSON writers
flush temporary files to disk before atomically replacing the previous record;
this reduces incomplete writes but cannot guarantee hardware power-loss durability.

This does not retroactively add recovery to a worker launched by an older installer
that has no controller/heartbeat. Its previous disappearance cannot be diagnosed
from logs that were never collected. The new checks protect newly started sessions.

Verification uses disposable fixtures: killing an owner process, an alive but frozen
UI, a hidden UI, reused PID/lease rejection, native reconnection, explicit resume/cancel,
initialization/attached-UI exceptions and split UTF-8 events. DPI tests use 100%,
150% and 200% layout scales and confirm the actual window is Per-Monitor V2. Physical
mixed-DPI monitor transfers and clean-machine qualification remain manual checks.
