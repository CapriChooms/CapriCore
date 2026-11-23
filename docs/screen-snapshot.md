# One-shot screen snapshot

For the separately enabled periodic mode, see [screen-observation.md](screen-observation.md).

Open Menu → Screen snapshot…, choose one window or monitor, press Capture once, inspect the preview and enter a question. Ask Capri sends that one image to the already selected local Qwen vision model. The reply uses the normal subtitles, avatar and selected English voice. Start an ordinary conversation first if this is a new installation; the text-only commit requires an existing shared session.

Nothing is captured on startup. Source enumeration requests zero-sized thumbnails and no window icons; it lists names without collecting preview images from other sources. The actual display-media request is bound to the selected source, current trusted main frame and a user gesture. A missing/expired source fails rather than falling back to the whole monitor. The REC indicator appears while the selected-source stream is active. Frames are resized to at most 1280×720.

The stream stops after the single frame. Closing the panel revokes a one-shot capture and discards pending previews. Hiding Capri, locking Windows or suspending the PC revokes all screen access. Explicitly started bounded observation has its own OBS/Stop controls and continues when the panel closes. Stop/Escape cancels an in-flight answer. Preview images and PNG bytes stay temporary; Capri creates no image file or OpenClaw media attachment. Your question, the text answer and capture provenance remain in the shared conversation. Descriptions from old snapshots are not live screen access.

The image goes directly to local multimodal inference with no action tools. Screen text and window names are untrusted data; they cannot grant file/app/music permissions. The backend then commits only a bounded text pair through the OpenClaw Plugin SDK, atomically and with durable operation identity. The ordinary agent can recall that answer in subsequent text/voice turns. The metadata RPC rejects image fields and encoded image payloads. Other interfaces share the text conversation, not a saved screenshot.

Camera and system audio remain unavailable to this feature. Arming display capture does not authorize `getUserMedia` video. Webcam access, crop controls, automatic screen reactions and screen-based clicking are unavailable. The separate bounded observation mode is documented above. Window titles are shown in the picker and selected-source metadata can stay in private history. Captures may be blank for protected/minimized windows; select another source or describe the issue in text.

During a visual response, normal chat waits for completion or Stop. Cancelled/failed turns remain marked incomplete in the desktop display journal; a turn cancelled before its text commit does not enter the shared model history. A commit already dispatched cannot be retracted and is not retried automatically after an uncertain result. No screenshot data is included in that commit.

Verification:

```powershell
node --test tests/screen-capture-policy.test.mjs tests/visual-context.test.mjs tests/visual-service.test.mjs
node scripts/verify-screen-capture.mjs
node scripts/verify-screen-capture.mjs --real
node scripts/verify-screen-capture.mjs --real --voice
node scripts/verify-visual-context.mjs
node scripts/verify-vision-model.mjs
```

Native/Electron tests capture only a generated owned window with a red square and blue circle, verify real pixels, source binding, stream release, camera denial and preview cleanup. The real dialogue test uses an isolated Gateway/profile, actual local Qwen, shared-history commit and ordinary-agent recall. The optional voice check also verifies the selected trained voice packets and Web Audio playback with physical output muted. Tests never capture the user's desktop content. Synthetic-image inference produced first text in about 4.58 seconds on this PC; that is one visual test, not a universal first-audio guarantee. Private reports are under `logs/`.

For an existing developer installation, run `node scripts/configure-perception.mjs` and restart Gateway/desktop. The normal initializer includes the plugin for new installations. This changes context plumbing only; it grants no screen/camera access.
