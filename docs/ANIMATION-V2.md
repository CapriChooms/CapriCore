# Capri animation direction, version 2

The current implementation proposal, storyboard and acceptance criteria are in the
[Capri animation rework plan](plans/capri-animation-rework.md).

## Visual intent

An anime performance built from deliberately drawn poses, with restrained secondary
motion. Listening, thinking and speaking should read through posture and eye line,
even with glitch disabled. Glitch is a short transition accent, not a way to hide
misregistered drawings. Keep the existing sprite pack working until a new pack is
reviewed as a complete set.

## Existing pack and constraints

The current runtime pack is `assets/capri/sprites/v1/runtime-sprite-set.json`:
68 frames on a 1254 × 1254 canvas, anchor (627, 1166). `AnimationDirector` already
selects state clips and `SpriteImages` keeps a bounded 20-frame decoded cache.
There is no evidence that an unlimited image cache caused issue #41. Preserve the
current reference pack and its provenance; the linked design chat is reference
material, not permission to overwrite unrelated assets.

## Drawing contract

Create front/three-quarter model sheets, neutral expression sheet, silhouette
sheet and a contact sheet before final frames. Every frame uses the same canvas,
camera, character scale, floor and optical head center. Record planted contacts
(feet, seat, desk, elbow) explicitly. Do not recenter each PNG by its bounding box.

Export body, eyes/brows and mouth as registered layers when feasible. Mouth shapes:
rest, closed M/B/P, open A, narrow E/I, round O/U, teeth F/V. Preserve the existing
mouth as a fallback for a pack without layers. Alpha should be straight and edges
free of a baked background. Ship authored images; never synthesize missing body
poses by stretching a face or interpolating a whole character with optical flow.

Each clip manifest records: id, state, tags, canvas, anchor, contacts, entryPose,
exitPose, frames with durationMs, loop range, interrupt markers, transition IDs,
mouth/eye attachment anchors, reducedMotionFrame and optional gesture intensity.
Durations are milliseconds, independent of renderer refresh rate. Validate missing
frames, duplicate IDs, registration, finite holds and transition reachability when
building the catalog. A bad optional clip falls back to a validated neutral pose.

## Storyboard and timing

| Clip            | Acting and key poses                                              | Timing                                            | Interrupt/exit                        |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| Neutral idle    | settled shoulders → small inhale → exhale; asymmetric blink       | 4–7 s loop, 12 authored poses/s only where moving | settled/contact key every 0.5 s       |
| Attention entry | eyes lead → chin lift → shoulders follow → small settle           | 250–400 ms, 5–8 drawings                          | enter listening pose                  |
| Listening       | slight forward lean, relaxed mouth; one restrained nod variant    | 3–5 s, varied holds                               | eye-line key, at most 120 ms wait     |
| Thinking        | eyes shift → chin touch/side glance → hold → return               | 450 ms entry, 2–4 s hold variants                 | hand-contact breakdown before leaving |
| Speaking        | held readable silhouette with small head beats, independent mouth | 2–4 s body loop                                   | speech ends → 180–300 ms settle       |
| Gesture         | anticipation → accent → overshoot → recovery                      | 0.7–1.3 s, 8–16 drawings                          | explicit safe return to speaking      |
| Sleep entry     | gaze lowers → eyelids close → shoulders release                   | 650–1000 ms                                       | closed-eye sleep pose                 |
| Sleep loop      | slow breath, tiny secondary hair movement; Zzz in UI layer        | 5–8 s                                             | wake priority, eyes lead              |
| Wake            | eyes open → focus → lift → settle                                 | 350–600 ms                                        | attention or speaking                 |

Use animation on twos (12 drawings/s in a 24 fps timeline), with selected ones
for a fast accent. Holds belong in the timeline, not duplicate files. Show pose,
breakdown and in-between contact sheets for review; fix silhouette and registration
before adding effects. Keep acting small enough for the corner companion.

## Runtime graph

Priority: explicit sleep/shutdown → wake/owner address → live speaking/listening →
thinking → initiative gesture → ambient idle. A new state cancels queued low-priority
clips. Route incompatible body poses through an authored bridge; choose the next
safe interrupt marker within 120 ms, otherwise use the source clip's short recovery.
Keep at most one pending state and one bridge. Never enqueue every ASR partial or
audio packet. Audio completion, cancellation and sleep each have explicit exits.

Do not crossfade unrelated silhouettes for 500 ms: it produces two heads and hands.
Allow a 50–100 ms dissolve only for equivalent registered poses or eye layers.
Optional procedural breathing moves torso attachment points, not planted feet;
hair/cloth lag is bounded and separate. Seed idle variants per session, avoid the
same gesture twice, and keep a 10–25 s gap between incidental gestures.

Mouth timing follows the actual playing audio clock, not network chunk arrival.
Use RMS/phoneme information when available, with attack/release smoothing, hysteresis
and a 60–100 ms minimum shape hold. Freeze at rest on pause, mute, cancellation or
missing audio. Blinks have a separate 3–7 s scheduler and never reopen sleeping eyes.

## Rendering and qualification

Keep the existing bounded decoded cache. Preload only current/next bridge and a
small idle set; budget decoded pixels, not compressed PNG bytes. Stop rendering
hidden/minimized windows, suspend idle timers and release obsolete image handles.
Keep 60 Hz presentation for effects while authored frames use their own holds.
Reduced motion uses held poses and minimal transitions; controls include body
motion, gesture frequency and independent glitch intensity.

Required review: neutral/listening/speaking/sleep storyboards; anchor/contact
overlays; body + mouth + blink combinations; interruption at every marker; delayed
audio, cancellation, rapid wake/sleep, compact mode and hidden/tray resume. Measure
frame time and decoded memory over 30 minutes. New animation assets are not part
of 0.4.4: that release preserves the current art and provides this production plan.
