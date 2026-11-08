// SPDX-License-Identifier: GPL-3.0-only
/** One short-lived star for either avatar surface; no per-frame JavaScript. */
export function showAvatarTapEffect(host, { x, y, count = 1, tone, id } = {}) {
  if (!host?.ownerDocument || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const taps = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const star = host.ownerDocument.createElement('span');
  star.className = 'avatar-tap-spark';
  if (id) star.id = id;
  star.setAttribute('aria-hidden', 'true');
  if (['affectionate', 'curious', 'neutral', 'boundary'].includes(tone)) star.dataset.tone = tone;
  star.style.left = `${x}px`;
  star.style.top = `${y}px`;
  star.style.width = star.style.height = `${Math.min(56, 24 + taps * 4)}px`;
  host.querySelector('.avatar-tap-spark')?.remove();
  star.addEventListener('animationend', () => star.remove(), { once: true });
  star.addEventListener('animationcancel', () => star.remove(), { once: true });
  host.append(star);
  return star;
}
