# Companion controls (pre-alpha)

The title bar separates community actions (support and bug reports) from the menu,
hide and close controls. The cross asks for confirmation, then runs the same
model-unloading shutdown as **Quit and unload models**. Hide keeps Capri running.
The shortcut row groups conversation (microphone, voice, history), capabilities
(screen and applications), appearance/sound, then languages/settings.
Spotify setup is inside **Application
access → Spotify** and stays off on a clean installation until explicitly enabled.
The microphone button beside Send opens voice input immediately, without repeating
the wake phrase. Press it again to stop microphone capture. The toolbar microphone
button controls persistent name listening; both use the selected input device.

## Focus mode

Choose **Focus mode** under **Settings → General** or from Capri’s system tray
menu. The companion and Settings windows stay hidden when you say the wake
phrase or receive a reply. Enabled microphone capture and voice continue to work.
To leave Focus mode, click the tray icon, choose **Show Capri** from its menu, or
press **Ctrl+Shift+Space**. Focus mode ends when Capri exits.

## Wake acknowledgement

In Companion settings, choose Signal tone, My audio file, Capri's voice or Silent,
then Apply settings. Imported audio stays in private desktop data, outside source
exports. Choose a file smaller than 4 MB and no longer than 10 seconds. Invalid
or unavailable custom audio does not silently substitute the signal tone; visual
acknowledgement remains available.

For a voice acknowledgement, select a phrase and Apply settings, or press Prepare
voice response. The selected speech model must be installed. Preparation uses TTS
once in the selected speech language, outside conversation history. Enabling the
microphone also prepares a missing voice response in the background. The cache
depends on language, phrase and voice identity; completed preparation updates the
companion immediately, including when initiated from the separate settings window.
The cached response plays without model inference on wake. An unavailable cache
keeps the visual acknowledgement rather than playing a different sound. The
acknowledgement volume is separate from the reply effects.

## Conversation and personality

The private personality editor replaces the character prompt, leaving application
permissions in place. It can express fictional adult role-play preferences. An
empty field writes the factory PERSONALITY.md into that same active file. The next response uses the change;
clear conversation separately if the previous context conflicts with a new character.
These settings never enter a source release.

The editor shows the complete effective character text. Show Personality file opens
Explorer with private PERSONALITY.md selected; edit it in any UTF-8 text editor.
External saved changes are read on the next request, without restarting models.
An older personality.json is supported until a plain-text file is saved. Clearing
the new file restores the base character and does not revive the old JSON override.
Unsaved language/personality changes have Apply/Save, Discard and Stay choices.
Quit/unload, saved-note deletion and character reset use the same styled dialog.

Button acknowledgement is a short visual pulse, independent of operation success.
Disable it under Companion settings > Interface feedback, then Apply settings.
Support identifies Overyx as the developer. It displays no stale settings result.
Its heart, orbital outlines and particles are procedural CSS animations, paused
when hidden and disabled with the OS reduced-motion preference.
The top Spotify shortcut and subtitle pause/resume button have been removed;
automatic speech paging and previous/next arrows remain available.

## Visual glitches

Open **Companion settings → Visual glitch**, then Apply settings. Effects can be
disabled, adjusted from 0–100% intensity, and assigned a background interval from
10–120 seconds (default 35 seconds, with procedural variation). Speech/pose bursts
can be switched off separately. Adjacent events are coalesced with a six-second
cooldown; ignored events are never queued to play later. Opening history/settings,
ordinary button clicks, dragging and zooming do not request interference.
CRT scanlines and the normal button acknowledgement remain independent. OS reduced
motion disables glitch interference without changing the saved preferences.

## Shutdown

Windows services are identified by their project root, PID and creation time. Each
service uses one asynchronous process-handle wait instead of launching PowerShell
for every poll. Voice and OpenClaw drain concurrently, then Ollama unloads its
resident models in parallel and stops. OpenClaw retains its supported stdin lifeline
so persistence can finish safely. Startup/warmup requests are cancellable; shutdown
does not wait for a full model prewarm deadline. Stage durations are logged.
Busy persistence or an unresponsive backend can still delay exit; errors preserve
process markers and are shown instead of silently abandoning model processes.

## Windows process identity

Installed shortcuts keep a launcher/CLI parent chain alive until the desktop exits.
The private Electron runtime has a Capri.exe copy with Capri metadata/icon;
Chromium helpers use that executable name. The original
electron.exe, its notices and model/Python executables remain unchanged. A receipt
avoids rebuilding on every start. Installer registration prepares the runtime, and
source launches prepare it on demand. Windows console services are not detached
into new process groups. An installation-specific AppUserModelID separates two
independent Capri installations.

This preserves one application identity and a parent tree for the normal desktop
launch. Windows controls the Processes tab grouping; the Details tab always lists
individual PIDs. Services started earlier through headless commands cannot be
reparented: fully stop them and restart Capri through its shortcut to create a new
tree. On the tested Windows 11 build 26200, Task Manager still displayed some
helpers as separate Capri rows. Complete single-row grouping is NOT verified or
guaranteed by this preview; an AppUserModelID primarily controls Shell/taskbar
identity. The existing tray-only window behavior is preserved. This does not
combine Python, Ollama and Electron into one process or
hide their resource use.

References: [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution),
[Windows application IDs](https://learn.microsoft.com/en-us/windows/win32/shell/appids).

Automatic follow-up listening is BETA and can be disabled. The model can append a
hidden `;listen` decision to its avatar control when inviting an answer. The control
is removed before subtitles, TTS and displayed history. It opens a 12-second window
only after the reply finishes playing, with at most three consecutive follow-ups.
It never enables a disabled microphone. A normal name activation resets the limit.
No extra classifier/model request is needed for this decision.

Clear conversation starts a new shared owner session through OpenClaw's supported
reset API and clears the desktop display journal. Saved notes are retained.
Clear long-term memory clears USER.md, MEMORY.md and Markdown notes inside memory,
and resets the derived search index using OpenClaw's supported maintenance command.
The Gateway is stopped during this operation. Character, permissions, settings and
conversation archives remain separate. Both actions ask for confirmation; clearing
notes is irreversible. These controls are not a full personal-data erasure tool.

## Startup and installation

Use Capri.exe or the Capri Local desktop shortcut for the main source installation.
`tools/setup/create-local-launcher.ps1 -DesktopShortcut` rebuilds this hidden launcher.
Installed copies receive the same launcher from the wizard. The app prepares its
selected language, embeddings, installed recognition and enabled speech components.
The startup panel displays real stage completion and an approximate ETA learned
from previous starts. First starts and CPU fallback can take longer.

The installer shows its package version and pre-alpha status. Pause downloads
retains partial data; model and dependency downloads resume with HTTP byte ranges
and still require the pinned checksum. Package-manager operations finish their
current step before pausing. The initial Node bootstrap may finish a buffered read
before pausing. Keep the installer open and the PC on; a pause is not a shutdown-safe
transaction for every package manager. Retry preserves verified models after a
network failure. Cancel remains available while paused.

## Reports and links

Reports are saved locally for review. Only app/runtime versions and the description
typed by the user are included automatically. A separate button opens GitHub issues;
it does not submit or upload anything. Private-repository access is required during
the private preview. Community links are maintained in config/community.json.
New panel strings have English and Russian translations; other interface locales
currently use English fallback for these additions.

Ollama language-model pulls also pause by cancelling only their own HTTP request,
then resume using the same model pull API. Its partial-layer retention is documented
in the [official API](https://github.com/ollama/ollama/blob/main/docs/api.md#pull-a-model).
