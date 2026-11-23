// SPDX-License-Identifier: GPL-3.0-only
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { assertPrivatePath } from '../../packages/runtime/src/safe-file.mjs';

/** Only fixed Capri model stores can be opened; renderer-supplied paths are rejected. */
export async function openLocalModelFolder(root, kind = 'ollama', openPath) {
  if (!['ollama', 'huggingface'].includes(kind)) throw new Error('Invalid model storage');
  const folder = path.join(root, 'data', kind === 'huggingface' ? 'huggingface' : 'models');
  try {
    assertPrivatePath(folder);
    await mkdir(folder, { recursive: true });
    if (await openPath(folder)) throw new Error('Open failed');
    return true;
  } catch {
    throw new Error('The models folder could not be opened.');
  }
}
