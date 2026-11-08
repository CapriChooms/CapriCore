# Independent update window (local, unreleased)

The managed v0.4.0 installation failed to open the source-update window for v0.4.1. Three jobs contained a request and cancellation marker, but no UI readiness marker or worker events. The message that Capri was still running described a failed updater launch, not a request to close Capri manually.

## Cause and fix

Launching Windows PowerShell with Node's detached-process flag reproduced an immediate exit with code 0 before the script ran. Removing that flag opened the UI, but a real parent-exit test showed that its console lifetime could still end with Capri. Neither behavior provides a reliable handoff.

A small Windows GUI host now owns the PowerShell UI and its output streams. The host is compiled locally with the same Windows .NET compiler used by Capri's installer and cached by its source hash. It launches without a console and stays independent of the desktop process.

The order remains explicit:

1. Verify the downloaded payload and launch the independent update window.
2. Wait for its readiness marker while Capri remains open.
3. Shut down Capri's services and authorize the prepared update.
4. Let the update worker wait for the desktop process to exit before replacing files.
5. Keep the progress window alive and restart Capri when the update succeeds.

An early UI exit does not stop Capri or discard the verified download. The action can be retried. Launch stages, exit status and PowerShell output now go to `logs/update-ui.stdout.log` and `logs/update-ui.stderr.log`, which the existing diagnostic ZIP collector includes with its normal size limits and redaction. Internal UI errors are also written to stderr, and the desktop diagnostic snapshot includes updater state.

## Verification

The native Windows regression uses a disposable managed installation with spaces and Cyrillic characters in its path. It launches the production updater host/UI, exits its owner process, verifies that the fixture worker applies only after owner exit, and verifies the automatic restart marker. The fixture worker and launcher never alter a real installation or start models. This passed with both the local UI script and the original downloaded v0.4.1 script.

The focused updater/diagnostics suite passed 21 tests, including new coverage for handoff ordering, single-action admission, early UI exit, retained download and failure logs. The native check is included in Windows CI for future releases.

## Existing installations

The reported installation received a backed-up local updater repair. It needs one normal restart to load the repaired desktop module; subsequent update handoff closes Capri automatically. Its downloaded v0.4.1 payload and checksums were not modified.

This fix has not been published. Installing the existing v0.4.1 payload replaces the patched desktop module with the old implementation again. The next release should recommend running its full installer once for installations with the old broken updater. Source checkouts and repaired installations retain the fix only until overwritten by an older published payload.
