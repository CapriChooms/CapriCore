# Settings window lifecycle (local, unreleased)

Users reported an empty gray Settings rectangle after restoring Capri from the tray, sometimes remaining after Capri was hidden again.

## Findings

Settings was a native child of the companion. Its lifecycle therefore had two controllers: Capri's `requested`/`ready` flags and Windows' owned-window restoration. The existing guard covered owner `hide`/`show` but not minimization. A native Windows probe reproduced the settings window automatically becoming visible after owner minimize/restore without an explicit settings-open request. The exact persistent gray appearance from the report was not reproduced on this machine; it should not be described as a confirmed GPU or driver defect.

The old loading path also allowed the renderer initialization acknowledgement to show Settings before its first painted frame. Hidden Settings windows were repositioned whenever Capri moved, and a native close did not clear all lifecycle flags. These made relying on a cached visibility flag alone insufficient.

## Repair

- Settings is an independent native window with no Windows owner, omitted from the taskbar. Capri still handles docking, topmost preference, hide, minimize and shutdown explicitly. This removes implicit Windows child-window restoration.
- Presentation requires both initialized settings and the first painted frame, with an outstanding explicit open request. Hiding during initialization cancels presentation.
- Hide/minimize retain the renderer and unsaved form values. Reopening remains fast and closing still offers to save or discard changes.
- Hidden settings no longer receive bounds updates. Native close and destruction reset lifecycle state before any delayed callbacks can affect another window.
- Renderer failure destroys its window. Unresponsive-window diagnostics and a settings lifecycle snapshot are included in future bug reports.

## Verification

Five focused unit regressions cover paint/initialization ordering, tray/minimize behavior, drafts' renderer lifetime, stale callbacks and shutdown/crash cleanup. Existing settings confirmation coverage is retained.

`tools/verify/verify-settings-lifecycle.mjs` runs the actual companion and settings renderer with a private test profile and no models. A small Windows helper queries `IsWindowVisible`, `IsWindow` and `GetWindow(GW_OWNER)` rather than relying solely on Electron's visibility state. It checks repeated tray restore, native minimize, draft preservation, unsaved-change confirmation, rendered reopening and absence of the Settings HWND after exit. The check is included in Windows CI.

Changes are local only. The installed test copy receives only the repaired settings-window module, with its original preserved before replacement. A normal restart is necessary to load it. No settings, history, models or downloaded release payloads are modified.
