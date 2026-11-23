# Spotify activation and confirmation fixes (local, unreleased)

Reviewed the latest open GitHub reports after v0.4.1: #31 and #32 describe Spotify activation hanging without a restart; #33 reproduces it on v0.4.1 and describes the confirmation appearing after roughly two minutes. Changes in this batch are local only. No release, issue reply or issue closure was made.

## Confirmed cause

The Settings renderer classified every method starting with `set`, `save` or `import` as a pending settings save. That included `setSpotifyAccess`. Before showing a backend confirmation, it waited for all pending saves. Spotify activation itself was waiting for that confirmation. Neither side could proceed until the backend cancelled the request after three minutes.

Once the action timed out, the pending save resolved and the renderer could finally display the expired confirmation. Clicking it could no longer enable Spotify or restart Capri. This explains the late dialog and apparent lack of effect without requiring administrator rights or a Spotify account change.

## Changes

- Only actual draft-saving methods participate in the Settings save barrier. Spotify activation, restart and other independently confirmed actions do not wait on themselves. Draft saves still preserve revision checks, error handling and unsaved-change prompts.
- Backend confirmation completion now closes its matching UI request. A request that expires while another dialog or draft save is pending cannot appear later. Late replies remain rejected in the backend.
- Hidden Settings no longer receives a duplicate confirmation intended for the companion window. Closing one confirmation cannot cancel a newer, unrelated request.
- If speech installation blocks a configuration change, the error now names speech installation and tells the user where to cancel it, instead of only reporting a generic busy operation.
- Diagnostic reports now include the bounded Spotify settings snapshot and whether a confirmation is pending. They do not include Spotify account credentials or track metadata.

The Spotify transaction still compiles the bridge before stopping the core, preserves unrelated settings, and restores the previous configuration if relaunch fails. Activation remains opt-in and requires confirmation.

## Verification

The native Electron regression reproduced the missing confirmation before the fix. With the fix, it verifies prompt display within 2.5 seconds, cancellation, expired-dialog removal, enable/disable, the configuration/restart sequence, rollback after a simulated restart failure, and usable settings navigation afterwards. It also checks that a hidden Settings window receives no duplicate quit confirmation. The native check uses the production renderer, confirmation broker and Spotify settings transaction; bridge compilation and desktop relaunch use isolated fixtures, so it does not control the user's Spotify or stop their models.

Unit regressions cover the save/confirmation dependency, failed draft persistence, the actual three-minute expiry, late replies, duplicate events and cancellation during draft saving. The wider native Settings check covers draft save/discard/conflicts, tray behavior and existing permission flows. The Spotify native check is now included in Windows CI for future pushes.

## Remaining reports

#32 also includes incomplete speech installation and a plugin import failure already addressed in v0.4.1. This batch fixes the independently reproduced Spotify confirmation deadlock; it does not establish that every error in that older archive has the same cause.

#18, #19, #21, #25 and #26 have no new follow-up evidence since the previous review. Their existing recovery fixes, pending retests and AMD TTS limitation remain as documented in their issue threads. No speculative network or GPU changes were made for those reports.
