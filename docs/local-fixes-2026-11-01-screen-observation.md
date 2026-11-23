# Screen observation and self-recognition (local, unreleased)

The November 1 diagnostic archive identifies its installation as **0.4.0**. It confirms repeated identical tool failures and a context-overflow/compaction cycle during a screen conversation. Assistant output confuses supplied scene descriptions with workspace permissions, repeats historical approval instructions, and describes Capri's own interface as a separate application.

The archive does not include the failed tool arguments or capture-stop reason. It was collected during a later startup. It cannot establish which tool failed in that turn or why observation stopped. Earlier application-plugin capture-path failures also occur in its historical logs; the current source already includes their repair and regression test. Do not attribute the report to a particular GPU or claim the old failure was reproduced exactly.

## Changes

- A shared visual reference describes Capri's own window, sprite and compact signal core. It is included in scene analysis, direct snapshot dialogue and the desktop conversation context. The reference requires visible matching features; it does not assert that Capri appears in every image. Identified self-references use the first person in the selected language. Screen text, including Capri's own historical messages, remains untrusted visual evidence.
- Screen questions distinguish reading an existing current scene from changing permissions. The prompt tells the model to answer a description-only question without tools, use the actual current on/off state, and avoid historical permission claims, terminal commands or workspace investigations. This is model guidance, not a guarantee that every small-model response is correct.
- A repeated `settings_control request screenObservation` returns `alreadyEnabled` when observation is active. It creates no approval, opens no picker and does not stop or replace the selected source. With observation off, owner approval and explicit source selection remain required.
- A single renderer frame/IPC error no longer immediately ends observation. Retries use the same grant, revalidate it before sending pixels, wait five seconds after a failure and stop after three consecutive failures. Successful updates reset the counter. Revocation, expired grants, closed sources, ended tracks and owner hide/lock/suspend still stop access. Stale asynchronous results cannot revive it.
- Screen sampling returns an explicit inactive result when its grant is no longer valid. A missing grant is not treated as a transient error.
- New diagnostics include current capture/observation state and the last stop reason, without window titles, images or scene text. Hide, lock and suspend have distinct reasons. Capture stops and failed desktop actions also write bounded metadata to existing logs so evidence survives an app restart. The action snapshot contains up to 24 tool names, known action/setting identifiers, outcomes and timings; no argument bodies, private file contents or credentials.

## Verification

70 focused tests passed across screen capture, observation, renderer retry/cancellation, permission requests, one-shot vision, action diagnostics, existing November reliability regressions, chat streaming and diagnostic export. Tests cover enabled/disabled observation, no stale scene transmission, unchanged image privacy boundaries, and shared self-reference instructions in both vision paths.

The native Windows/Electron observation check passed with an isolated profile, generated fixture window, stubbed inference and muted physical audio. It verified fresh pixels after submission, continued observation after a chat answer, source restart, and revocation on companion hide and selected-window destruction. The first run timed out at restart after a forced click; the suspected cause was selection-state synchronization across IPC, not a confirmed capture failure. The verification now waits for an actionable Start control, and the final run passed. This check does not benchmark actual Qwen visual accuracy or prove identical behavior on the reporter's machine.

Source export validation passes. Changes remain in the local development source; no release, push, installation-data reset or modification of the installed D: copy is performed.
