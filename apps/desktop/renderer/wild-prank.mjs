// SPDX-License-Identifier: GPL-3.0-only
const prank = document.getElementById('prank');
globalThis.playWildPrank = ({ anchorX, anchorY, dx, dy, variant, duration }) => {
  for (const [name, value] of Object.entries({ x: anchorX, y: anchorY, dx, dy }))
    prank.style.setProperty('--' + name, value + 'px');
  prank.style.setProperty('--flip', dx > 0 ? -1 : 1);
  prank.style.setProperty('--duration', duration + 'ms');
  prank.dataset.variant = variant;
  return true;
};
