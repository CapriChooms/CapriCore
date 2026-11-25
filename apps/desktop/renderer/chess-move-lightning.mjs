// SPDX-License-Identifier: GPL-3.0-only
import {
  clearTeleportBolt,
  playTeleportBolt,
  teleportBoltMotion,
  TELEPORT_BOLT_MS,
} from './teleport-lightning.mjs';

export const CHESS_LIGHTNING_MS = TELEPORT_BOLT_MS;
export const clearChessMoveLightning = clearTeleportBolt;

export function chessLightningMotion(uci, orientation, bounds, options = {}) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) || uci.slice(0, 2) === uci.slice(2, 4))
    return null;
  if (orientation !== 'white' && orientation !== 'black') return null;
  const { width, height } = bounds;
  if (!(width > 0 && height > 0)) return null;
  const square = (index) => {
    const file = uci.charCodeAt(index) - 97;
    const rank = Number(uci[index + 1]) - 1;
    return {
      x: (((orientation === 'white' ? file : 7 - file) + 0.5) * width) / 8,
      y: (((orientation === 'white' ? 7 - rank : rank) + 0.5) * height) / 8,
    };
  };
  return teleportBoltMotion(square(0), square(2), bounds, {
    scale: Math.min(width, height) * 0.105,
    ...options,
  });
}

export function showChessMoveLightning(canvas, { uci, orientation, effects }) {
  const { clientWidth: width, clientHeight: height } = canvas.parentElement;
  return playTeleportBolt(
    canvas,
    chessLightningMotion(
      uci,
      orientation,
      { width, height },
      {
        reducedFlash: matchMedia('(prefers-reduced-motion: reduce)').matches,
        effects,
      },
    ),
  );
}
