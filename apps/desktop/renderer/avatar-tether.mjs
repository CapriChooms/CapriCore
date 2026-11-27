// SPDX-License-Identifier: GPL-3.0-only
import { AvatarDragTether } from './avatar-drag-tether.mjs';

const tether = new AvatarDragTether();
globalThis.capriAvatarTether = (value) => tether.draw(value);
