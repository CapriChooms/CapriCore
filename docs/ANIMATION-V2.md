# Capri animation

This guide describes the artwork and registration used by the desktop
companion. See the catalog and distribution notes for the reviewed files.
[Character assets](character-assets.md)

## Runtime in Capri 1.3.0

The **Avatar gallery** in Settings previews poses, expressions and animations.
Animation previews can play once or loop. Music reactions keep Capri in her
current pose, and the sleeping pose has slow breathing. The standing pose,
desktop poses and gestures use registered face artwork where applicable.
[Release notes](https://github.com/CapriChooms/CapriCore/releases/tag/v1.3.0)

The face rig positions each eye and its contour in source pixels. Blinking
animates eyelids over the eye artwork, and speech uses a separate mouth layer.
The registration accounts for changes in scale and orientation between standing,
seated and inverted poses. Sleeping and the authored music poses have drawn
closed eyes and mouths. [Face rig](https://github.com/CapriChooms/CapriCore/blob/v1.3.0/apps/desktop/renderer/avatar-face-rig.mjs)
· [Layered blink](https://github.com/CapriChooms/CapriCore/blob/v1.3.0/apps/desktop/renderer/avatar-layered-blink.mjs)

Full-size sprite frames use a 1254 × 1254 canvas. The animation director selects
clips from the catalog and keeps a bounded decoded-frame cache through
`SpriteImages`. The window-edge gesture sheets have their own visible bounds
and placement registration. [Animation director](../apps/desktop/renderer/animation-director.mjs)
· [Window-edge geometry](../assets/default/hanging-cels/geometry.json)

## Authoring and registration

- Keep the camera, character scale and optical head center consistent across
  a sequence. Record planted contacts such as feet, hands or a seat in source
  coordinates. Keep the canvas origin fixed when exporting frames.
- Check posture and eye line with glitch effects disabled. Draw silhouettes,
  poses and breakdowns first. Add secondary motion after checking registration.
- Use transparent source artwork with clean alpha edges. Align the base face,
  sockets, eyes, eyelids and mouth to the pose. Check the full blink and the
  mouth shapes over the complete expression.
- Store frame holds in the timing data. Use authored bridge poses for transitions
  between different silhouettes. Keep motion above a planted contact when adding
  breathing, sway or bounce.
- Tie spoken mouth shapes to audio playback. Return the mouth to rest when
  playback pauses, ends or is cancelled. Keep sleeping eyes closed.

## Review checklist

Review the gallery and the home and detached presentations. Compare the body,
eyes and mouth at frame boundaries and verify the anchors for held and inverted
poses. Test entry, exit and interruption during speech, wake and sleep. Check
reduced motion, compact mode and visibility changes. Measure frame time and
decoded memory during longer runs when a change adds images or rendering work.

Early production plans remain available in the repository history.
[Animation storyboard](https://github.com/CapriChooms/CapriCore/blob/c50c6463637f31ee9109669be2dbee27e972e45d/docs/ANIMATION-V2.md)
· [Stage-one prototype](https://github.com/CapriChooms/CapriCore/blob/c50c6463637f31ee9109669be2dbee27e972e45d/docs/plans/capri-animation-stage1.md)
· [Rework proposal](https://github.com/CapriChooms/CapriCore/blob/c50c6463637f31ee9109669be2dbee27e972e45d/docs/plans/capri-animation-rework.md)
· [Sprite generation plan](https://github.com/CapriChooms/CapriCore/blob/c50c6463637f31ee9109669be2dbee27e972e45d/docs/capri-sprite-generation-plan.md)
