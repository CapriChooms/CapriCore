import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadMusicArtwork } from './music-artwork.mjs';

export const ACTIVE_AVATAR_CATALOG = 'assets/capri/sprites/v1/runtime-sprite-set.json';
export const ACTIVE_AVATAR_POSES = 'assets/capri/sprites/poses-v2/runtime-poses.json';
export const FALLBACK_AVATAR_CATALOG = 'assets/default/sprite-set.json';
export const AVATAR_REPAIR_MESSAGE =
  'Capri artwork is missing or damaged. Run Capri Setup again and select this installation folder to restore the avatar. Your history and settings will be preserved.';
export const AVATAR_SOURCE_REPAIR_MESSAGE =
  'The setup source is incomplete or damaged: Capri artwork is missing or damaged. Download CapriSetup from the GitHub Releases page, or extract a complete source archive with the Capri artwork manifests and PNG files. Your existing installation data is preserved.';

/** The release artwork is a required component, independent of voice/model options. */
export function requireCapriAvatar(root, { source = false } = {}) {
  try {
    const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG), {
      poseManifest: path.join(root, ACTIVE_AVATAR_POSES),
      musicRoot: root,
    });
    if (!catalog.animated) throw new Error('The Capri animation catalog is required');
    return catalog;
  } catch (cause) {
    const error = new Error(source ? AVATAR_SOURCE_REPAIR_MESSAGE : AVATAR_REPAIR_MESSAGE, {
      cause,
    });
    error.code = source ? 'CAPRI_ARTWORK_SOURCE_INVALID' : 'CAPRI_ARTWORK_INVALID';
    throw error;
  }
}

/** Keep text chat available, but never silently substitute the procedural symbol. */
export function loadInstalledAvatar(root) {
  let catalog, failure;
  try {
    catalog = requireCapriAvatar(root);
  } catch (error) {
    failure = {
      code: error.cause?.code ?? 'INVALID_AVATAR_PACK',
      message: error.cause?.message ?? error.message,
    };
    catalog = loadAvatarCatalog(path.join(root, FALLBACK_AVATAR_CATALOG));
  }
  return {
    catalog,
    diagnostics: {
      mode: failure ? 'fallback' : 'capri',
      manifest: failure ? FALLBACK_AVATAR_CATALOG : ACTIVE_AVATAR_CATALOG,
      expectedManifest: ACTIVE_AVATAR_CATALOG,
      animated: catalog.animated,
      frames: catalog.frames.length,
      ...(failure ? { failure } : {}),
    },
    warning: failure ? AVATAR_REPAIR_MESSAGE : null,
  };
}

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const PORTRAIT_KINDS = new Set(['expression', 'micro_frame', 'gaze_frame', 'reaction_expression']);
const WINK_FRAMES = new Set(['idle-wink_half', 'idle-wink_closed']);
const EXPRESSIONS = {
  neutral_small_smile: ['Neutral', 'Relaxed everyday conversation, a small natural smile.'],
  attentive: ['Attentive', 'Listening with interest, gentle engagement and curiosity.'],
  thinking: [
    'Thoughtful',
    'Reflecting, considering possibilities, uncertainty or an open question.',
  ],
  smirk: ['Playful', 'An amused, mischievous smirk for affectionate teasing or a clever remark.'],
  happy: ['Happy', 'Sincere pleasure, celebration, delight or welcoming warmth.'],
  focused: [
    'Focused',
    'Concentration, determination, a careful explanation or a firm serious position.',
  ],
  concerned: [
    'Concerned',
    'Empathy, worry, disappointment or support when something is difficult.',
  ],
  surprised: [
    'Surprised',
    'A genuinely unexpected discovery or astonishment, without exaggerated alarm.',
  ],
};

/** Asset metadata is configuration, never a filename or URL supplied by the LLM. */
export function loadAvatarCatalog(manifestFile, { poseManifest, musicRoot } = {}) {
  if (statSync(manifestFile).size > 512 * 1024) throw new Error('Sprite manifest exceeds limit');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  const animated = manifest.schemaVersion === 2;
  if (
    ![1, 2].includes(manifest.schemaVersion) ||
    !Array.isArray(manifest.sprites) ||
    !manifest.sprites.length ||
    manifest.sprites.length > (animated ? 128 : 64) ||
    ![manifest.canvas?.width, manifest.canvas?.height].every(
      (value) => Number.isInteger(value) && value > 0 && value <= 4096,
    )
  ) {
    throw new Error('Invalid sprite manifest');
  }
  const folder = realpathSync(path.dirname(manifestFile));
  const ids = new Set(),
    pairs = new Set();
  const frames = manifest.sprites.map((item) => {
    if (
      !item ||
      ![item.id, item.pose, item.expression].every(
        (value) => typeof value === 'string' && NAME.test(value),
      ) ||
      ids.has(item.id) ||
      (item.canPersist !== false && pairs.has(`${item.pose}/${item.expression}`)) ||
      typeof item.file !== 'string' ||
      !/^[a-zA-Z0-9_-]+\.png$/.test(item.file)
    )
      throw new Error('Invalid or duplicate sprite entry');
    const file = realpathSync(path.join(folder, item.file));
    if (!file.startsWith(folder + path.sep) || statSync(file).size > 20 * 1024 * 1024)
      throw new Error('Sprite asset outside catalogue or too large');
    const bytes = readFileSync(file);
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(16) !== manifest.canvas.width ||
      bytes.readUInt32BE(20) !== manifest.canvas.height
    ) {
      throw new Error(`Sprite ${item.id} must use the shared PNG canvas`);
    }
    if (
      animated &&
      (item.kind === 'walk_frame' ||
        item.pose.startsWith('walk') ||
        typeInvalid(item, manifest.canvas))
    )
      throw new Error('Invalid or excluded animation frame');
    if (
      item.sha256 !== undefined &&
      (!/^[0-9a-f]{64}$/.test(item.sha256) ||
        createHash('sha256').update(bytes).digest('hex') !== item.sha256)
    )
      throw new Error('Sprite checksum mismatch');
    ids.add(item.id);
    if (item.canPersist !== false) pairs.add(`${item.pose}/${item.expression}`);
    const [label, description] = EXPRESSIONS[item.expression] ?? [
      item.expression.replaceAll('_', ' '),
      `Expression: ${item.expression}.`,
    ];
    return Object.freeze({
      id: item.id,
      frameId: item.id,
      pose: item.pose,
      expression: item.expression,
      label: animated ? item.label : label,
      description:
        typeof item.description === 'string' ? item.description.slice(0, 240) : description,
      ...(animated
        ? {
            kind: item.kind,
            canPersist: item.canPersist,
            anchor: item.anchor,
            visibleBounds: item.visibleBounds,
          }
        : {}),
      url: `capri://desktop/sprites/${item.id}.png`,
      file,
    });
  });
  const musicArtwork = musicRoot ? loadMusicArtwork(musicRoot) : { frames: [], notes: [] };
  const desktopPoseFrames = [
    ...(poseManifest ? loadPoseFrames(poseManifest, manifest.canvas) : []),
    ...musicArtwork.frames,
  ];
  if (desktopPoseFrames.some((frame) => ids.has(frame.id))) throw new Error('Duplicate pose ID');
  frames.push(...desktopPoseFrames);
  const sprites = frames.filter((frame) => frame.canPersist !== false);
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const clips = animated ? validateClips(manifest.clips, byId) : [];
  const clipIds = new Set(clips.map((clip) => clip.id));
  if (animated) {
    if (!Array.isArray(manifest.actions) || manifest.actions.length > 32)
      throw new Error('Invalid animation actions');
    for (const action of manifest.actions) {
      const frame = byId.get(action.frame),
        rest = byId.get(action.returnTo);
      if (
        typeof action.id !== 'string' ||
        !NAME.test(action.id) ||
        ids.has(action.id) ||
        !clipIds.has(action.animation) ||
        !frame?.canPersist ||
        !rest?.canPersist ||
        typeof action.label !== 'string' ||
        action.label.length > 100 ||
        typeof action.description !== 'string' ||
        action.description.length > 240
      )
        throw new Error('Invalid animation action');
      ids.add(action.id);
      sprites.push(
        Object.freeze({
          ...frame,
          id: action.id,
          frameId: frame.id,
          animation: action.animation,
          returnTo: action.returnTo,
          canPersist: false,
          label: action.label,
          description: action.description,
        }),
      );
    }
  }
  const defaultId = manifest.defaultSprite ?? 'neutral';
  if (!sprites.some((frame) => frame.id === defaultId && frame.canPersist !== false))
    throw new Error('Default sprite is missing');
  const publicFrame = ({ file: _file, ...entry }) => ({ ...entry });
  if (
    animated &&
    (!manifest.autonomy ||
      typeof manifest.autonomy.enabled !== 'boolean' ||
      typeof manifest.autonomy.startExpanded !== 'boolean' ||
      ![manifest.autonomy.firstActivityMs, manifest.autonomy.activityGapMs].every(
        (ms) => Number.isInteger(ms) && ms >= 5000 && ms <= 120000,
      ))
  )
    throw new Error('Invalid autonomous animation timing');
  // Keep validating the complete artwork pack for installation and future rework.
  // The framed portrait uses standing animation. Window seats have their own pose set.
  const portraitFrames = animated
    ? frames.filter(
        (frame) =>
          (frame.pose === 'idle' &&
            (PORTRAIT_KINDS.has(frame.kind) || WINK_FRAMES.has(frame.id))) ||
          (frame.kind === 'reviewed_pose' && frame.anchor.name === 'ground'),
      )
    : frames;
  const portraitIds = new Set(portraitFrames.map((frame) => frame.id));
  const portraitClips = clips.filter(
    (clip) =>
      clip.frames.every(({ id }) => portraitIds.has(id)) &&
      (!clip.effect || portraitIds.has(clip.effect.id)),
  );
  const portraitClipIds = new Set(portraitClips.map((clip) => clip.id));
  const portraitSprites = sprites.filter(
    (sprite) =>
      portraitIds.has(sprite.frameId) &&
      (!sprite.animation ||
        (portraitClipIds.has(sprite.animation) && portraitIds.has(sprite.returnTo))),
  );
  if (!portraitSprites.some((sprite) => sprite.id === defaultId))
    throw new Error('Default portrait is inactive');
  return {
    canvas: { width: manifest.canvas.width, height: manifest.canvas.height },
    defaultId,
    sprites: portraitSprites,
    frames,
    portraitFrames,
    desktopPoseFrames,
    musicFrames: musicArtwork.frames,
    musicNotes: musicArtwork.notes,
    publicMusic: () => ({
      frames: musicArtwork.frames.map(publicFrame),
      notes: musicArtwork.notes.map(publicFrame),
    }),
    animated,
    publicSprites: () => portraitSprites.map(publicFrame),
    publicAnimation: () =>
      animated
        ? {
            frames: portraitFrames.map(publicFrame),
            clips: portraitClips,
            autonomy: manifest.autonomy,
            canonicalAnchor: manifest.canonicalAnchor,
          }
        : null,
  };
}

const poseAnchors = new Map([
  ['pose-ceiling', 'ceiling'],
  ['pose-ceiling-upside-down', 'ceiling-upside-down'],
  ['pose-dock-left', 'dock-left'],
  ['pose-dock-right', 'dock-right'],
  ['pose-sit-edge', 'seat'],
  ['pose-sit-floor', 'ground'],
  ['pose-crouch', 'ground'],
]);

function loadPoseFrames(file, canvas) {
  if (statSync(file).size > 16384) throw new Error('Pose manifest exceeds limit');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.sprites) ||
    manifest.sprites.length !== poseAnchors.size
  )
    throw new Error('Invalid reviewed pose catalogue');
  const parent = realpathSync(path.dirname(file));
  const folder = realpathSync(path.join(parent, 'PNG'));
  if (folder !== path.join(parent, 'PNG')) throw new Error('Invalid reviewed pose directory');
  const seen = new Set();
  return manifest.sprites.map((item) => {
    const name = poseAnchors.get(item?.id);
    if (
      !name ||
      seen.has(item.id) ||
      item.anchor?.name !== name ||
      item.file !== `capri-${item.id.slice(5)}.png` ||
      typeof item.pose !== 'string' ||
      !NAME.test(item.pose) ||
      typeof item.description !== 'string' ||
      item.description.length > 240 ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      typeInvalid(
        {
          ...item,
          kind: 'pose_master',
          canPersist: true,
          anchor: { ...item.anchor, name: 'ground' },
        },
        canvas,
      )
    )
      throw new Error('Invalid reviewed pose');
    seen.add(item.id);
    const asset = realpathSync(path.join(folder, item.file));
    if (asset !== path.join(folder, item.file) || statSync(asset).size > 20 * 1024 * 1024)
      throw new Error('Reviewed pose asset outside catalogue or too large');
    const bytes = readFileSync(asset);
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(16) !== canvas.width ||
      bytes.readUInt32BE(20) !== canvas.height ||
      bytes[25] !== 6 ||
      createHash('sha256').update(bytes).digest('hex') !== item.sha256
    )
      throw new Error('Reviewed pose PNG or checksum mismatch');
    return Object.freeze({
      id: item.id,
      frameId: item.id,
      kind: 'reviewed_pose',
      pose: item.pose,
      canPersist: name === 'ground',
      expression: 'neutral_small_smile',
      label: item.label,
      description: item.description,
      anchor: item.anchor,
      visibleBounds: item.visibleBounds,
      url: `capri://desktop/sprites/${item.id}.png`,
      file: asset,
    });
  });
}

function typeInvalid(item, canvas) {
  const kinds = [
    'expression',
    'pose_master',
    'pose_expression',
    'effect',
    'reaction_frame',
    'gesture_frame',
    'micro_frame',
    'gaze_frame',
    'reaction_expression',
    'transition_frame',
  ];
  const anchor = item.anchor,
    bounds = item.visibleBounds;
  return (
    !kinds.includes(item.kind) ||
    typeof item.canPersist !== 'boolean' ||
    (item.canPersist && !['expression', 'pose_master', 'pose_expression'].includes(item.kind)) ||
    typeof item.label !== 'string' ||
    item.label.length > 100 ||
    !anchor ||
    !['ground', 'seat', 'center'].includes(anchor.name) ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y) ||
    anchor.x < 0 ||
    anchor.y < 0 ||
    anchor.x > canvas.width ||
    anchor.y > canvas.height ||
    !bounds ||
    !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key])) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > canvas.width ||
    bounds.y + bounds.height > canvas.height
  );
}

function validateClips(value, frames) {
  if (!Array.isArray(value) || value.length > 48) throw new Error('Invalid animation clips');
  const ids = new Set();
  return value.map((clip) => {
    if (
      typeof clip.id !== 'string' ||
      !NAME.test(clip.id) ||
      ids.has(clip.id) ||
      clip.id.startsWith('walk') ||
      !Array.isArray(clip.frames) ||
      !clip.frames.length ||
      clip.frames.length > 64
    )
      throw new Error('Invalid animation clip');
    ids.add(clip.id);
    const sequence = clip.frames.map((frame) => {
      if (
        !frames.has(frame.id) ||
        frames.get(frame.id).kind === 'effect' ||
        !Number.isInteger(frame.ms) ||
        frame.ms < 50 ||
        frame.ms > 30000
      )
        throw new Error('Invalid animation keyframe');
      return { id: frame.id, ms: frame.ms };
    });
    if (sequence.reduce((sum, f) => sum + f.ms, 0) > 120000)
      throw new Error('Animation clip too long');
    const result = { id: clip.id, frames: sequence };
    if (clip.effect) {
      if (
        frames.get(clip.effect.id)?.kind !== 'effect' ||
        !sequence.some((f) => f.id === clip.effect.onFrame) ||
        clip.effect.width !== 64
      )
        throw new Error('Invalid animation effect');
      result.effect = { id: clip.effect.id, onFrame: clip.effect.onFrame, width: 64 };
    }
    return result;
  });
}
