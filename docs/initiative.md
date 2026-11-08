# Initiative preview

Settings → Initiative can enable Occasional or Conversational comments. The default is Off. The Windows metadata observer runs only while Capri is visible and initiative is enabled; hiding/quitting stops it. The Initiative page reports awareness and scheduling status; the tray tooltip also identifies active awareness. This is separate from screen/camera access, which this observer does not provide.

The native helper observes foreground process names, fullscreen bounds, five-minute idle/return, session lock/unlock and suspend/resume. It reads no window titles, accessible document content, screenshots, camera or audio. Foreground and window-location events update state; a cheap one-second metadata check covers missed changes. Raw event streams stay in memory.

Scheduling is local and deterministic, before invoking a language model:

- Occasional: at least six minutes between spoken comments, at most ten in a rolling hour.
- Conversational: at least two minutes, at most thirty per rolling hour.
- A custom limit of 1–30 comments per hour overrides the preset. The minimum spacing is one hour divided by that limit. Clearing the number restores the preset; selecting another preset also clears the override. This is a maximum, not a promise to speak that often. The full rolling-hour budget survives restart.
- Failed/declined attempts have a one-minute cooldown. Budgets and recent comment text survive restart.
- Quiet hours default to 23:00–09:00 in local Windows time; the Quiet hours switch explicitly disables them. Older equal start/end configurations migrate as disabled.
- Typing, active user speech, replies/playback, settings/history, lock, sleep, hidden windows, fullscreen apps and process exclusions suppress comments.
- Discord, Teams, Zoom, PowerPoint and OBS are excluded initially. Add process names for other calls, windowed games or presentations; browser calls and all windowed games cannot be detected reliably.
- Candidates settle briefly, expire after 15–20 seconds and are dropped after a foreground change. There is no catch-up queue.

Spontaneous comments can be enabled independently of return/media reactions. A cheap 15-second scheduler makes the first attempt after approximately 45–70 seconds when no recent voluntary comment is recorded. Later attempts occur roughly every 2–2.4 minutes in Conversational mode or 6–7.2 minutes in Occasional mode, plus scheduler resolution. Custom limits use the same 0–20% timing variation. The same gates, cooldowns and hourly caps apply; there is no periodic Qwen polling. The page explains the current blocking reason, preparation and next attempt. Try initiative requests a candidate without waiting for that interval, but does not bypass quiet hours, lock or active speech.

Typing and microphone activity temporarily block delivery without moving the scheduled attempt indefinitely into the future. A completed ordinary reply adds a 45-second quiet period. Conversational mode allows at most two earlier retries, 60–90 seconds apart, after the model chooses silence; it then returns to the normal interval. Spontaneous thoughts use shared conversation and avoid return greetings and internal system-event wording. Silence remains a valid choice when there is no useful topic.

Other supported triggers are returning after idle and, if separately selected, bringing VLC, mpv, Spotify or Windows Media Player forward. A media app being foreground does not prove playback or establish video content. No comment may claim screen perception. Session-ending notifications cancel optional work; they never start Qwen or delay shutdown. Prepared farewell playback and richer media events remain future work.

The selected local Qwen generates a short structured response or chooses silence. This path provides no action tools and has no program/file/music dispatch mechanism. It reads bounded history from the existing OpenClaw session and current persona/shared owner memory. A delivered line is appended as an assistant message to that session with an event label, and appears in the normal desktop journal/subtitles/voice pipeline. It does not create a second conversation or pretend that the owner sent an event prompt.

The source label is private transcript metadata, not spoken text. A narrowly pinned compatibility change makes genuine Capri comments available to subsequent model turns; ordinary Gateway injections remain display-only. A first ordinary conversation turn must already have created the shared session; optional comments are skipped until then.

New user input cancels pending generation; gates are checked again before commit and delivery. A transcript commit already dispatched to the Gateway is not retractable; a cancellation racing its acknowledgement can leave a labelled comment in shared history without playback. It is not retried automatically. This bounded race and cross-channel priority need further release qualification before advertising complete simultaneous-channel support.

“Less of that kind of comment” suppresses the last delivered category, preserving conversation history. “Restore dismissed comment types” restores those categories. Independent return/media switches also remain available. Disabling initiative stops observation and generation without changing chat, voice or microphone settings.

Preview is deliberately opt-in. Direct optional generation shares the local model; cache/resource effects require broader performance measurement. One isolated run produced a 3.96-second comment, with subsequent ordinary first text at 2.65 seconds versus 3.43 seconds before it. These are single-run measurements, not median/p95 or a speed guarantee. The model sometimes correctly chooses silence; a skipped comment is not a broken connection.

Developer checks:

```powershell
node --test tests/initiative.test.mjs
node scripts/verify-awareness.mjs
node scripts/verify-file-access.mjs
node scripts/verify-initiative-model.mjs
```

Native verification filters to a generated test window, including its fullscreen transition and immediate startup cancellation. It captures no physical desktop images or titles. Electron UI verification leaves native observation disabled. The model test uses an isolated Gateway/session and real Qwen; its commit fixture may force delivery of a model-generated line when the model chose silence, explicitly reported as test-only behavior. Production honors silence. Reports remain private under `logs/`.

References: [SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook), [GetLastInputInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo), [Windows session ending](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession).
