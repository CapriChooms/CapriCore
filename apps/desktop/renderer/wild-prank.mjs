// SPDX-License-Identifier: GPL-3.0-only
export function playWildPrankEffect(prank, { anchorX, anchorY, dx, dy, variant, duration }) {
  for (const [name, value] of Object.entries({ x: anchorX, y: anchorY, dx, dy }))
    prank.style.setProperty('--' + name, value + 'px');
  prank.style.setProperty('--flip', dx > 0 ? -1 : 1);
  prank.style.setProperty('--duration', duration + 'ms');
  prank.dataset.variant = variant;
  return true;
}

const desktopPrank = globalThis.document?.getElementById('prank');
if (desktopPrank)
  globalThis.playWildPrank = (options) => playWildPrankEffect(desktopPrank, options);
