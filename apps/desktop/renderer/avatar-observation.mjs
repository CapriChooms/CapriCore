// SPDX-License-Identifier: GPL-3.0-only
import { avatarPoseLandmarks } from './avatar-mouth.mjs';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const frameSize = 1254;

export function playAvatarObservation(surface, kind, frameId) {
  if (kind !== 'screen' && kind !== 'attention') return;
  const previous = surface.querySelector(':scope > .avatar-observation');
  if (previous?.dataset.kind === 'screen' || previous?.dataset.kind === kind) return;
  previous?.remove();

  const cue = document.createElement('span');
  cue.className = 'avatar-observation';
  cue.dataset.kind = kind;
  cue.setAttribute('aria-hidden', 'true');
  if (frameId) {
    const [x, y] = (avatarPoseLandmarks(frameId) ?? avatarPoseLandmarks('neutral')).face;
    cue.style.left = `${(x / frameSize) * 100}%`;
    cue.style.top = `${(y / frameSize) * 100}%`;
  }
  surface.append(cue);
  const animation = cue.animate(
    reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 1 }]
      : [
          { opacity: 0 },
          { opacity: 1, offset: 0.14 },
          { opacity: 1, offset: 0.76 },
          { opacity: 0 },
        ],
    kind === 'screen' ? 1100 : 750,
  );
  const remove = () => cue.remove();
  void animation.finished.then(remove, remove);
}
