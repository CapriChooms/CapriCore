# Capri Desktop

Capri 1.0.0 is a Windows x64 desktop companion with shared conversation and
memory, optional local speech, floating character animations and explicitly
enabled tools. Language-model inference can use bundled local models, compatible
Hugging Face GGUF imports or an OpenAI-compatible API. See the
[system requirements](../README.md#system-requirements) before enabling speech or
a larger local model.

## Start and talk

Complete the [installation wizard](installation-wizard.md), then open
**Capri.exe** or its shortcut. A first model load can take longer than subsequent
replies. The microphone and Capri's voice start **off**; installing their packs
does not enable or load them automatically.

Type in **Talk to Capri…** and press **Enter** to send; **Shift+Enter** inserts a
line. Use the attachment button, drag and drop, or paste supported files/images
from the clipboard. Unsupported file types or model capabilities produce an
informational message instead of being sent as unsupported input.

The microphone beside Send starts direct voice input. The toolbar microphone
controls persistent wake-phrase listening; stopping direct capture does not
unload an already enabled recognition model. The speaker button enables or mutes
Capri's replies. Language, input-device, voice and wake-acknowledgement choices
are separate settings. See [microphone](desktop-microphone.md),
[wake phrase](wake-phrase.md) and [voice installation](voice-installation.md).

The status indicator distinguishes connecting, listening, thinking and actual
speech playback. Use **Stop reply** or **Escape** to cancel the active reply.
Cancellation is requested from the backend; an external provider or a busy local
service can take time to finish releasing its work.

## Toolbar and conversation

- The **Local/API** selector identifies the active inference connection and
  offers saved connections and local model settings. Switching during an active
  reply requires waiting for that reply to finish.
- **CTX** shows context use and opens the context settings. RAM/VRAM displays
  and optional graphs are configured under **Appearance and animations**.
- **Thinking mode** and **Internet mode** are beside the main input. The former
  requests a more considered answer with a short spoken introduction; the latter
  enables ordinary web research. Internet mode alone does not grant computer
  control.
- **Music listening** is next to the speaker control. It uses permitted system
  audio, with optional BPM-driven animation; see [music listening](music-listening.md).
- **Conversation history** opens the full conversation, including supported
  attachments and image previews. Its active state is highlighted. Close it with
  its button, cross or Escape; Escape can then stop the current reply.
- Reply arrows browse the available pages or replies. The reply can be collapsed
  without clearing conversation history. Optional automatic dismissal and
  floating-dialogue preferences are in Settings.

Screen observation and application access have independent controls and grants.
Their toolbar state does not grant unrestricted access to other files or desktop
actions. Read [screen observation](screen-observation.md),
[application access](application-actions.md) and [computer control](computer-control.md)
when enabling these features.

## Character, frame and floating controls

Drag the **CAPRI** title to move the home panel. Drag Capri inside the home frame
to reposition the character; use the mouse wheel over her to change zoom.
**Settings → General → Reset Capri position and zoom** restores the character
placement, while **Reset to bottom-right corner** moves the panel.

**Leave frame** places Capri on the desktop. Outside the frame, the compact
panel provides microphone, keyboard and menu controls; the keyboard button opens
a small input and the menu returns to the full controls. Dragging can teleport
Capri or return her to the home frame, with a configurable movement dead zone.
Teleport and attachment-to-window behavior depend on the current layout and
permissions. A report about lost interaction after minimizing/restoring a window
with Capri sitting on it is still awaiting confirmation on affected setups;
1.0.0 does not promise that every desktop/window combination is qualified.

Floating replies appear near the character. A nearby arrow can reveal a hidden
reply; it should not require expanding the home panel. Appearance settings
control effects, dialogue presentation, automatic closing, movement and reactions.
The animation system keeps mouth playback separate from body poses. Not every
pose, model or application has equal coverage.

## Settings

The gear opens a separate Settings window with search and these groups:

| Group                | Sections                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Capri                | General, Appearance and animations, Window                                                                                                      |
| Conversation / Voice | Conversation and personality, Brain and private memory, Initiative, Languages, Microphone settings, Voice effects, Voice calls, Music listening |
| Language model       | Language model, External AI provider, voice-model selection within the model settings                                                           |
| Capabilities         | Computer control, Task training, User tools, Screen snapshot, Application access, File access, Timers and reminders                             |
| Updates / Community  | Updates, Discord presence, Report a bug, Support the author, Credits                                                                            |

The selected section and scroll position are remembered. Search locates matching
settings. Many appearance and audio changes preview immediately; **Save changes**
keeps the pending changes, and discarding restores the saved values. Closing with
unsaved changes brings attention to the save/discard controls. Switching sections
does not require confirming each change. Some operations, such as installing a
model or enabling a capability, are explicit actions rather than previews.

Long explanations are available from their adjacent information buttons. Voice
preview, themes, interface language and conversation language are independent
choices. The **Credits** section contains the Hall of Fame; the support section
links to the project website and community.

## Hide, focus, sleep and quit

**Hide to tray** keeps Capri running without retaining the main window on the
Windows taskbar. Restore her from the system tray. The optional floating chip
provides another way to reopen the panel. When Capri is outside the home frame,
hiding the panel can leave the character visible independently.

**Focus mode** in General or the tray menu hides the companion and Settings
until you bring Capri back. Enabled microphone/voice services can continue;
focus mode is not a privacy or model-unloading control.

The cross offers **Sleep**, **Restart**, and **Quit and unload models**, with a
**Cancel** choice. Sleep releases the managed models and suspends normal
activity without removing installed files. Quit closes Capri and releases its
managed services; restart performs an orderly shutdown and relaunch. Do not
force-terminate a busy installation or model operation.

## Development and limits

Use `npm run desktop` for a configured source checkout; `npm start` runs the
backend rather than the desktop. The renderer has no Node.js access: host
capabilities use the reviewed preload/IPC boundary. Platform/model work belongs
behind adapters. See [architecture](architecture.md),
[contributing](../CONTRIBUTING.md) and the [documentation index](README.md).

Computer control, voice calls and some inference/speech adapters remain beta.
Camera capture is not implemented. Optional speech needs the matching installed
pack and backend; a successful model download is not proof of GPU support or
voice quality. API use sends request context to the selected provider. Ordinary
conversation and memory are local but not fully encrypted; see
[security](../SECURITY.md) and [licensing and asset terms](licensing.md).
