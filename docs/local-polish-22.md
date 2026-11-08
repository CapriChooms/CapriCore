# Local desktop polish — 22 changes

Local candidate based on 0.3.7. Not published. This document records the implementation of the [22-point plan](plans/next-version-polish.md).

| Item  | Result                                                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Screen interval and duration become gray while observation runs. An explanation and a Stop button appear beside them. The backend also rejects a conflicting edit.                                                                                  |
| 2     | A final question opens follow-up Listening after speech playback, only for a voice-origin request in the same active microphone session. Typed requests never open it.                                                                              |
| 3     | Glitch controls explain enable/strength/interval/event bursts, reduced motion and preview. The portrait and borders use the same interference schedule; settings receive burst metadata rather than continuous frame IPC.                           |
| 4     | An optional Synthetic voice preset and adjustable electronic blend/carrier add ring modulation after synthesis. Clean remains the default.                                                                                                          |
| 5     | Hover uses color/glow instead of a rectangular outline. Keyboard focus remains visible.                                                                                                                                                             |
| 6–8   | The ellipsis is removed. The gear opens one reusable, isolated settings window with 17 categories and search. It prefers docking to the left and stays inside the monitor work area. Main toolbar controls remain accessible.                       |
| 9     | Button press feedback is described separately from visual glitches. It can be disabled independently.                                                                                                                                               |
| 10    | Custom applications and Spotify retain styled yellow BETA badges; experimental settings headings retain their badges in the new window.                                                                                                             |
| 11    | Missing app IDs receive a precise recoverable error. Native UI Automation enumerates verified top-level windows, supports selecting a real window ID, and verifies append/replace text entry in an inspected editable field.                        |
| 12    | Successful simple actions get short factual receipts. Stock conversational nudges are filtered from control-tool turns; necessary clarifications and ordinary conversation remain available.                                                        |
| 13–14 | Quiet hours have an explicit enable switch. A lightweight independent scheduler supplies spontaneous candidates, reports blocking reasons/next attempts and offers a test button. Existing limits, user activity and quiet-hours gates still apply. |
| 15    | Each approved folder has its own revoke button, alongside revoke-all. Permission changes invalidate pending approvals.                                                                                                                              |
| 16    | File discovery returns actual names. A missing text file returns useful listing hints. Moving a file to the Windows Recycle Bin uses the desktop process and an on-screen confirmation.                                                             |
| 17    | `replace_text` reads a real SHA-256, confirms the exact existing file, retains a verified backup and uses native replacement. It refuses changed files and supports journal-based undo. `write_text` remains exclusive creation.                    |
| 18    | Reminders retain visual and speech delivery separately, prepare the selected voice, wake the portrait and speak without asking Qwen to invent a reminder. Mute, text-only, lock and active playback are respected. Failed delivery can be retried.  |
| 19    | Stopwatch status is sampled afresh, including short contextual follow-up questions. Old creation receipts are not reused as elapsed time.                                                                                                           |
| 20    | A small digital stopwatch HUD interpolates locally, corrects against the service and preserves pause/selection. Several clocks can be selected in settings.                                                                                         |
| 21    | Portrait zoom now reaches 300%.                                                                                                                                                                                                                     |
| 22    | The duplicate OBS badge beside the brand is removed. The actionable observation button remains.                                                                                                                                                     |

Settings edits retain Save/Discard/Stay confirmation. Four deferred preference groups use revisions so an old draft cannot overwrite a newer change from another window. Screen capture, microphone capture and playback remain owned by the companion window; settings do not create a second media pipeline.

## Verification

Run `npm test`, `npm run check` and `npm run release:check` before packaging. Targeted real-window checks:

```powershell
npm run verify:settings
npm run verify:files
npm run verify:observation
npm run verify:languages
npm run verify:locales
node tools/verify/verify-native-catalog.mjs
node tools/verify/verify-reminder-voice.mjs
```

The reminder voice check requires an already running local voice service. `--service-root <installation>` uses that installation's existing service without starting/stopping it or writing conversation history. It checks actual synthesized PCM, not physical speaker output. Do not run two independent CUDA voice services on the same port. UI checks use generated windows and isolated profiles under `.runtime`; native catalog verification creates disposable editor windows and, when installed, a separate Chrome test profile. It does not type in personal Chrome windows.

Remaining practical limits: Windows must be awake with Capri running for reminders. This work does not add AMD/NPU TTS or general browser automation. UI Automation can only enter text into controls exposed as editable by an application; websites or apps that do not expose those controls return an explicit failure. Multi-monitor/DPI geometry has deterministic coverage; moving between physical monitors remains a useful manual release check. Speech recognition itself and voice training weights are unchanged.
