# Local interface and interaction fixes

This work follows the settings-panel rework. It is a local candidate, without a
version bump or publication.

1. Character placement updates no longer echo back to the dragging renderer and
   cancel its active pointer gesture. Settings-origin changes still synchronize.
2. Error notifications have a separate Dismiss button beside Report a bug.
3. Buttons, destructive actions, sliders and scrollbars share the Cyberpunk
   palette. Disabled controls remain visibly unavailable.
4. Fresh profiles use a one-second end-of-speech pause. Saved preferences survive.
5. Microphone choices use the device labels, include system default and identify
   disconnected saved devices. Device selection saves independently of the pause.
6. App-owned labels, help paragraphs, errors and native-dialog controls use the
   interface catalogs. Multiline help text resolves after whitespace normalization.
   Personal filenames, model identifiers, logs and dialogue remain data.
7. Wake voice preparation uses the selected speech language and refreshes the
   companion cache after preparation in either window. It never substitutes the
   signal tone for a selected but unavailable voice.
8. Custom application tools recover a missing identifier only from an unambiguous
   current capability. Chrome/Edge navigation has a confirmed web-address action;
   text entry still requires accessible fields and a fresh inspection.
9. The docked settings panel initially matches the companion's height, constrained
   to the monitor work area.
10. Microphone activity no longer resets the initiative deadline indefinitely.
    Initial attempts are earlier, subsequent conversation has a quiet grace period,
    and conversational mode has bounded retries after silence. Existing permission,
    quiet-hour, fullscreen, speech and hourly-limit gates remain effective.
11. Pending desktop mutations form a bounded confirmation queue. Duplicate proposals
    reuse the pending request; each different action needs its own confirmation.
12. Per-folder revoke controls are red, including hover and keyboard focus states.
13. Recovery copies can be removed permanently with a three-second confirmation
    enforced in the main process. The operation leaves any restored original and
    the Windows Recycle Bin untouched; it is not secure disk erasure.
14. Clicking stopwatch digits opens pause/resume, reset, stop and all-timers controls.
    Reset preserves the stopwatch identity and paused/running state.

## Verification

`node --test tests/polish14.test.mjs tests/initiative.test.mjs` checks approval
sequencing, early-confirmation rejection, recovery integrity, browser permissions,
identifier recovery and ambiguity, the selected wake language/cache, stopwatch
reset and initiative scheduling. `node tools/verify/verify-polish14.mjs` exercises
the actual Electron pointer gesture, device selector, height, notification,
recovery confirmation and stopwatch controls in an isolated profile.

`node tools/verify/verify-native-catalog.mjs` uses disposable editor windows and a
separate Chrome test profile. `node tools/verify/verify-settings.mjs` covers section
navigation, concurrent drafts and isolated windows. Locale verification uses
`node tools/verify/verify-interface-locales.mjs`. None of these checks establishes
physical microphone accuracy or physical speaker output.

Build a distributable local candidate with the ready voice pack:

```powershell
node tools/release/build-installer.mjs --voice-pack=data/voices/capri/en/exports/capri-en-v1
```

Check `bundledVoice` in its `BUILD_MANIFEST.json` and the extracted voice profile.
The installer does not contain personal history or download the large public models
until its normal component-installation steps.
