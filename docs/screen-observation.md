# Bounded screen observation

Open **Settings → Screen snapshot…**, choose a window or monitor and press **Start observation**. The defaults are a minimum 30-second analysis interval and a 10-minute session. Choose your own interval from 15 to 300 seconds and duration from 0.5 to 120 minutes. These preferences are saved separately from access: nothing starts automatically, and observation is off after an app restart.

The **OBS** button in Capri's header shows active access. Click it to stop immediately, use **Stop observation** in the panel, or use **Stop screen observation** in the native menu. Closing the settings panel leaves explicitly enabled observation running. Hiding Capri, locking/suspending Windows, source loss or session expiry stops it and discards its current description. Showing/unlocking Capri does not resume it.

Prefer a selected application window when that is sufficient. Monitor capture includes everything visible on that monitor, including overlays. Camera and system audio remain denied. This mode does not click or operate applications.

## What Capri receives

The selected source produces a local video stream capped at 1280×720 and one frame per second. Every two seconds the client compares a 64×36 luminance sample. Small changes such as a cursor blink usually do not need analysis. A changed view is passed to the model only when the minimum interval permits it and foreground work is idle. Source existence is rechecked using metadata without thumbnails, at most once per four seconds. Source disappearance stops access; it never falls back to the entire monitor.

Analysis uses the selected local Qwen model without tools, owner history or persona role-play. Its output is a short factual English description, not a new message from Capri. That description is kept in memory only. It does not initiate speech or create an automatic user turn.

Wait for the first **Last screen update** before asking an ordinary question about the view, or use **Ask Capri** in the panel for a fresh frame immediately.

When you next type or speak, a fresh description accompanies that ordinary request as read-only, untrusted text. Ordinary context contains scene facts and a freshness flag, not a capture date, filename or source label. Explicit questions about capture metadata can receive it separately. Provenance remains in the local capture state and diagnostics. The local transcript displays your actual words. OpenClaw retains the submitted text context as part of that conversation, without a media attachment. Old descriptions in history are past observations, not ongoing access.

Changed or over-60-second-old descriptions are marked non-current. After 90 seconds without a usable update, no old description is supplied. If no current update exists, Capri should say so rather than invent a scene. You can also enter a question in the screen panel and press **Ask Capri** while observation is active: this captures a fresh frame and uses the existing direct visual-question pipeline, with normal subtitles and the selected voice.

## Resources and priority

Typing a prompt, addressed microphone activity, playback, an active chat or initiative generation suppresses background analysis. Foreground activity cancels an in-flight visual request and adds a ten-second quiet gap. Cancelled/late output cannot restore a stopped session or replace its description. Analysis has a 12-second deadline, an additional error backoff and no parallel inference queue.

This reuses the existing model rather than downloading another vision model. It can still affect GPU use and the next response time through model/cache contention; cancellation does not guarantee instant GPU prefill cancellation. Choose a longer interval, a smaller application window, or stop observation during latency-sensitive work. No end-to-end voice-latency improvement is claimed.

Frames, preview video and change samples remain in memory. The separate explicit “Capri, clip that” command can save one PNG locally; see [screen-clips.md](screen-clips.md). No screenshots or automatic scene descriptions are written as files, attached to OpenClaw media, sent to cloud services or logged in routine diagnostics. Only a description actually used with an owner's message joins shared conversation history. Stopping clears the unused in-memory description and releases the stream.

Crop/redaction controls, application exclusion lists, webcam capture, video/audio understanding and spontaneous screen-based comments remain separate future work. Existing event-based Initiative controls continue to govern their own app/idle reactions.

## Validation

```powershell
node --test tests/screen-observation.test.mjs tests/screen-capture-policy.test.mjs tests/visual-service.test.mjs tests/visual-context.test.mjs
node scripts/verify-screen-observation.mjs
node scripts/verify-screen-observation.mjs --real
node scripts/verify-screen-capture.mjs
```

The Electron tests capture only a generated owned window containing a red square and blue circle. They verify visible access, camera denial, actual selected-source streaming, description transfer into an ordinary chat, no PNG bytes in that chat, stop/release, hide revocation and source loss. The `--real` run uses actual local Qwen for the description and an isolated fake Gateway to inspect text transport; it does not call or modify the owner's shared session. Physical audio is muted and no physical microphone is recorded. Unit tests cover scene changes, rate limits, stale context, input priority, late-result cancellation and tool-free inference.

Reports: `logs/screen-observation-verification.json`, `logs/screen-observation-real.json` and `logs/screen-observation-node-tests.txt`. Generated verification profiles are covered by `scripts/clean-cache.mjs`.

Validated on this installation: all 164 Node tests passed; the generated-window real-Qwen run returned its first description in 3.5 seconds, including stream setup. Camera denial, context transfer, stream release, hide revocation and source-disappearance revocation passed. This single fixture does not establish general vision accuracy or end-to-end voice latency.

## Changing timing

Stop observation before changing interval or duration. Both fields become gray while capture runs, with a Stop button beside the explanation. Stopping restores editing. The settings window delegates capture to the companion window; opening or closing settings does not create or destroy a second capture stream.
