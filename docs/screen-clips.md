# Capri, clip that

With the microphone enabled, say **Capri, clip that** (or **Hey, Capri, clip that**). The usual wake gate and accurate final speech recognition still apply. You can also type the command. Variants include “clip this”, “clip it”, “take a screenshot” and “save a screen shot”. Questions, quotations, negations and extra unrelated instructions do not silently trigger a capture.

The command runs locally without asking Qwen to plan an action or analyse the image. It saves one PNG, then Capri confirms **Clipped it.** through the normal subtitles and voice, if voice replies are enabled. **Open** and **Folder** buttons appear above the input. The native menu also offers **Open screenshots folder**. Open buttons only access generated PNG IDs or this fixed folder, not arbitrary paths.

## Source and files

- With active screen observation, capture uses exactly that selected window/monitor stream. Its existing maximum 1280×720 resolution and frame cadence apply. If the selected source expires, disappears or cannot supply a frame, the command fails instead of switching to the whole display.
- Without observation, a one-shot Windows capture saves the monitor containing the foreground application, at native resolution. It does not capture all monitors. A typed command normally makes Capri the foreground application; a voice command leaves the user's application in front. Overlays are included in this native capture. Protected content and some exclusive fullscreen renderers can produce blank captures.
- Files go to `data/screenshots/Capri-<command UUID>.png` inside this project. Names are exclusive; existing files are never overwritten. Replayed command IDs do not create another screenshot or duplicate confirmation within the running companion.
- Files persist until the owner removes them. Screenshot data stays outside the public source repository and the cache-cleanup command never deletes this directory. This is an explicit save command, unlike ephemeral passive observation.

The temporary **CLIP** indicator shows capture in progress; the screen stop button or Escape can cancel a pending capture. Locking or suspending Windows cancels it. A capture already written successfully is not deleted by a later stop. Saving does not enable passive observation or camera/audio access.

The image is not attached to OpenClaw or sent to a language model. A verified filename/time receipt remains available to ordinary conversation. A short text-only shared-context update is attempted independently of playback; an unavailable Gateway cannot turn a successful local file save into a failed capture. The next normal message also includes the verified receipt so it can enter shared history. No automatic retry follows an uncertain context commit.

The helper uses Windows PowerShell and built-in .NET drawing, with a thread DPI-awareness context for physical pixels. It does not change machine/user execution policy. Implementation references: [Graphics.CopyFromScreen](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.graphics.copyfromscreen), [SetThreadDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext).

## Verification

```powershell
node --test tests/screen-clips.test.mjs tests/wake-phrase.test.mjs
node scripts/verify-screen-clips.mjs
```

The integration test captures only a generated owned window containing a red square and blue circle. A geometry-only probe checks the native foreground-monitor path without reading display pixels. The actual native bitmap copy is restricted to the fixture's client rectangle in the verification process. A separate test captures that same fixture through an explicitly selected observation stream. Typed commands, final-ASR submission, PNG pixels, opaque output, replay prevention and zero language-model requests are checked. No physical microphone, user desktop capture, image viewer launch or physical playback is used.

The first run measured approximately 2.05 seconds for the native fixture capture including process startup, and 112 ms for the active selected stream. These exclude speech-recognition endpointing and audible confirmation latency. Report: `logs/screen-clips-verification.json`.
A short screenshot sound plays after successful saving, independently of muted voice replies and voice effects. Failed or cancelled captures do not play it.
A local data/sounds/screenshot.mp3 replaces the procedural cue when present; restart Capri after changing it. This installation uses the MP3 supplied by the owner. The audio stays in ignored private data and is not bundled into the public source repository.

PNG writes, disk flushes and cleanup run asynchronously so saving cannot block microphone IPC acknowledgements. The audio FIFO also tolerates short renderer stalls. The clip regression keeps a real CPU ASR worker on a silent fake microphone, injects a 1.2-second renderer stall during capture, and checks that the same microphone session survives. Capture pixels still come only from an owned generated fixture.
