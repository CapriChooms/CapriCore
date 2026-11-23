// SPDX-License-Identifier: GPL-3.0-only
export const REPLY_SPACE = 148;
export const MIN_COMPACT_HEIGHT = 300;

export function compactReplyHeight(height) {
  return Math.min(height, Math.max(MIN_COMPACT_HEIGHT, height - REPLY_SPACE));
}
