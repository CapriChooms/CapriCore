// SPDX-License-Identifier: GPL-3.0-only
// Entry point for `npm run build:desktop-teleport`; the work is in desktop-teleport-build.mjs.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDesktopTeleport } from './desktop-teleport-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(buildDesktopTeleport(root));
