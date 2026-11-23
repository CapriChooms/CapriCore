# Timers, reminders and owner-approved actions

## Timers and reminders (BETA)

Ask Capri to remind you in a duration, start a countdown, start a stopwatch or report elapsed time. Examples: “Remind me in two hours to call Alex”, “Start a stopwatch”, “How much time has passed?” The model selects `time_control`; the local clock service computes the actual time. An absolute reminder must specify an unambiguous date/time in the Windows time zone or an explicit UTC offset. Ambiguous daylight-saving times are rejected instead of guessed. Recurring schedules are not supported yet.

**Settings → Timers and reminders** lists active objects. Create, pause/resume timers and stopwatches, dismiss, or snooze a completed reminder for five minutes. A reminder needs text. Several active clocks require a specific object ID; Capri must not guess which one to cancel. An unnamed running stopwatch is not silently reset by a repeated start request.

The service belongs to the desktop main process, independently of OpenClaw, Qwen and TTS. Unloading models does not stop timers. Keep Capri running for notifications; closing it prevents live delivery. Active objects are checkpointed and restored; missed reminders appear at the next launch. Windows notification settings may suppress the system toast, but the reminder remains in the local list. Speech is attempted only when its model is already ready and no conversation is active. No model is loaded for a timer.

State lives in private `data/desktop/time.sqlite` with WAL/FULL durability and a delivery outbox. Relative running clocks use monotonic time; restart recovery uses a wall-clock checkpoint. Commands have durable operation IDs so a retransmitted tool call cannot create a second timer. Delivery is at least once across an unexpected process/power failure: a crash between notification and its receipt can repeat that notification. No honest implementation can promise exactly-once OS notifications across that boundary. Limits: 1 second–366 days, 1,000 active clocks, 10,000 journaled mutations, 2,000 returned entries.

## Conversation settings and temporary approvals

`settings_control` can inspect supported settings and change glitch strength/enabled state. An application or screen request creates a 90-second approval card, never an implicit permission grant. A short addressed “yes” / “да” can approve a pending low-risk request; unrelated speech, expiry, cancellation, hiding or locking clears it. A model cannot approve its own request. Screen observation still requires choosing the exact source and duration. Model/language/Spotify changes open their existing dedicated controls rather than silently downloading models or restarting services.

The tool bridge binds a random loopback port and requires a per-run secret, exact loopback Host, no browser Origin, a bounded JSON body and a fixed tool allowlist. Credentials stay out of renderer and model data. Only owner webchat sessions of the Capri agent receive the tools. This does not grant Telegram or third-party agents desktop access.

## Custom application catalog (BETA)

In **Application access → Custom applications**, choose an actual local `.exe`. No app permissions are granted merely by selecting it. Grant launch, accessible-field inspection, and text entry separately. The model discovers real catalog IDs through `desktop_control apps`; it cannot supply an arbitrary executable, command line or working directory. Launch has no arguments. WindowsApps/UWP aliases and applications which replace themselves with a different process may not provide a verifiable window; Capri reports that distinction.

Text entry requires a fresh inspection (45-second lease), a matching process ID/start time, an editable non-password UI Automation ValuePattern control and the on-screen confirmation buttons. It appends or replaces the reviewed field text and reads the value back. It never presses Enter, sends, saves, clicks arbitrary buttons or uses a clipboard/keystroke fallback. Multiple matching windows require an explicit window selection from the inspection; unsupported accessibility providers are rejected. Some multiline editors support read-only TextPattern rather than writable ValuePattern and cannot be entered through this preview.

For Chrome and Edge, `desktop_control open_url` opens a reviewed HTTP/HTTPS address with separate launch and text-entry grants and explicit on-screen confirmation. The native helper verifies the executable product and uses a fixed process-launch path. It reports that navigation was requested, not that a page loaded successfully. Other browser interaction remains limited to supported accessible fields. A unique configured name or uniquely matching live field inspection can recover an omitted model identifier; ambiguous or expired capabilities require discovery again and never select a personal window by guessing.

Native launch uses `CreateProcessW` with an explicit executable and no inherited handles. The launched app cannot hold or write the helper's trusted JSON channel. Bounded helper calls are cancelled on revoked permissions or disconnected callers; an already-dispatched Windows action may complete. The private journal distinguishes completed and uncertain actions and never automatically repeats an uncertain mutation.

## Recycle Bin and recovery (BETA)

`desktop_control trash` supports one regular local file up to 20 MiB inside an explicitly approved writable folder. Directories, paths outside the scope, links and hardlinks are rejected. The owner reviews the full path with the on-screen confirmation buttons. Capri rechecks the permission, identity and SHA-256, creates and verifies a private recovery copy, rechecks the original and then calls Electron's Windows Recycle Bin operation. It has no permanent-delete fallback. External applications can still race a path-based operation; detected changes stop it, and uncertain outcomes require checking the actual file instead of retrying.

**File access → File recovery** offers restoration from the verified private copy. Current write permission is required, confirmation is explicit and an existing destination is never overwritten. Recovery storage is capped at 1 GiB; copies are kept rather than silently evicted. These previews do not grant unrestricted disk access. Journals and copies stay in private application data and are excluded from source exports.

Each recovery item also offers **Delete permanently**, with a three-second confirmation delay enforced by the desktop process as well as the interface. It removes Capri's private backup only. It does not delete a restored original or empty the Windows Recycle Bin, and it is not a secure disk-erasure operation. Multiple pending file actions are queued with a separate confirmation for each; repeated identical proposals reuse the pending request instead of failing or executing twice.

Primary API references: [Windows UI Automation ValuePattern](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue), [Electron trashItem](https://www.electronjs.org/docs/latest/api/shell#shelltrashitempath).

## Delivery and elapsed time

Reminder notification and spoken delivery have separate persisted states. A due reminder can prepare only the selected voice and reveal Capri while the conversation model stays unloaded. It does not wake Windows or turn on the microphone. Muted/text-only voices remain silent. Busy or locked sessions defer speech; generation/playback failures remain visible and can be retried rather than being counted as spoken. Disable voice preparation in Settings → Timers and reminders when desired.

Elapsed queries always read current service time. The top-right digital HUD uses a local monotonic clock between service corrections, stops while paused and supports selecting one of several stopwatches. A short “And now?” is treated as an elapsed query only while the recent conversation focus is still a clock.

Click the stopwatch digits to pause/resume, reset, stop, or open the complete timer list. Reset requires confirmation, keeps the same stopwatch and preserves whether it was paused or running.
