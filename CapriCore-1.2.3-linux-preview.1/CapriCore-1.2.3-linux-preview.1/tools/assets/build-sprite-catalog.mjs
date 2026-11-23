/** Compile reviewed authoring assets into an explicit runtime allowlist. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';

const folder = path.join(root, 'assets/capri/sprites/v1');
const source = JSON.parse(readFileSync(path.join(folder, 'complete-sprite-set.json'), 'utf8'));
const alias = (id) =>
  id.startsWith('idle-') && source.sprites.find((s) => s.id === id)?.canPersist ? id.slice(5) : id;
const expressions = {
  neutral_small_smile: 'Relaxed',
  attentive: 'Attentive',
  thinking: 'Thoughtful',
  smirk: 'Playful',
  happy: 'Happy',
  focused: 'Focused',
  concerned: 'Concerned',
  surprised: 'Surprised',
  annoyed: 'Annoyed',
  skeptical: 'Skeptical',
  sad: 'Sad',
  sleepy: 'Sleepy',
  flirty: 'Flirty',
  embarrassed: 'Embarrassed',
  excited: 'Excited',
  laughing: 'Laughing',
};
const poses = {
  idle: 'Standing',
  sit_floor: 'Sitting on the floor',
  sit_edge: 'Perched on the frame',
  lean_in: 'Leaning closer',
  crouch: 'Crouching',
  arms_crossed: 'Arms crossed',
  hand_on_hip: 'Hand on hip',
  recline: 'Reclining',
  chin_rest: 'Chin resting on hand',
};
const frames = source.sprites
  .filter((s) => s.kind !== 'walk_frame' && !s.pose.startsWith('walk'))
  .map((s) => ({
    id: alias(s.id),
    pose: s.pose,
    expression: s.expression,
    file: s.file,
    kind: s.kind,
    canPersist: s.canPersist,
    label: s.canPersist
      ? `${poses[s.pose]} · ${expressions[s.expression]}`
      : s.state.replaceAll('_', ' '),
    description: `${poses[s.pose] ?? s.pose}; ${(expressions[s.expression] ?? s.state).toLowerCase()}.`,
    anchor: { name: s.anchor.name, x: s.anchor.x, y: s.anchor.y },
    visibleBounds: s.visibleBounds,
    sha256: s.sha256,
  }));
const clips = source.sequences
  .filter((s) => !s.id.startsWith('walk'))
  .map((s) => ({
    id: s.id,
    frames: s.frames.map((f) => ({ id: alias(f.sprite), ms: f.durationMs })),
    ...(s.effect ? { effect: { id: s.effect.sprite, onFrame: s.effect.onFrame, width: 64 } } : {}),
  }));
const add = (id, ids, durations) =>
  clips.push({ id, frames: ids.map((id, i) => ({ id: alias(id), ms: durations[i] })) });
add('shrug', ['neutral', 'idle-shrug', 'neutral'], [160, 1150, 200]);
add('point_left', ['neutral', 'idle-point_left', 'neutral'], [160, 1200, 200]);
add('point_right', ['neutral', 'idle-point_right', 'neutral'], [160, 1200, 200]);
add('laugh', ['smirk', 'idle-laughing', 'happy'], [140, 1300, 300]);
add('excited', ['happy', 'idle-excited', 'happy'], [140, 1400, 300]);
const actions = [
  ['wave', 'wave', 'neutral', 'neutral', 'Friendly greeting or goodbye.'],
  ['wink', 'wink', 'flirty', 'flirty', 'A playful wink when the conversation invites it.'],
  [
    'air_kiss',
    'air_kiss',
    'flirty',
    'flirty',
    'An affectionate air kiss, only in mutually affectionate context.',
  ],
  [
    'heart_hands',
    'heart_hands',
    'flirty',
    'flirty',
    'A warm heart-hands gesture, when affection fits the conversation.',
  ],
  ['shrug', 'shrug', 'neutral', 'neutral', 'A small shrug for uncertainty or an open choice.'],
  [
    'point_left',
    'point_left',
    'neutral',
    'neutral',
    'Point left when relevant to the conversation.',
  ],
  [
    'point_right',
    'point_right',
    'neutral',
    'neutral',
    'Point right when relevant to the conversation.',
  ],
  ['laugh', 'laugh', 'smirk', 'happy', 'A brief laugh for something genuinely funny.'],
  ['excited', 'excited', 'happy', 'happy', 'Brief excitement or celebration of good news.'],
].map(([id, animation, frame, returnTo, description]) => ({
  id,
  animation,
  frame,
  returnTo,
  label: id.replaceAll('_', ' '),
  description,
}));
const runtime = {
  schemaVersion: 2,
  character: 'Capri',
  defaultSprite: 'neutral',
  canvas: { width: 1254, height: 1254 },
  canonicalAnchor: { x: 627, y: 1166 },
  sprites: frames,
  actions,
  clips,
  autonomy: { enabled: true, startExpanded: true, firstActivityMs: 18000, activityGapMs: 12000 },
  excluded: {
    kinds: ['walk_frame'],
    poses: ['walk_left', 'walk_right'],
    reason: 'Walking was rejected by the owner.',
  },
};
writeFileSync(
  path.join(folder, 'runtime-sprite-set.json'),
  JSON.stringify(runtime, null, 2) + '\n',
);
console.log(
  `Runtime: ${frames.length} images, ${frames.filter((f) => f.canPersist).length} poses/expressions, ${actions.length} actions, ${clips.length} clips; walking excluded.`,
);
