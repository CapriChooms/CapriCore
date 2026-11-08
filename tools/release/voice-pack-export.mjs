// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { root, writeJsonAtomic } from '../../packages/runtime/src/index.mjs';
import { validateVoicePack } from '../../packages/installer/src/voice-pack.mjs';
import { noLinks } from '../../packages/installer/src/policy.mjs';

// A release pack is a separate binary artifact. Never export the surrounding
// dataset, training runs, reviews, history or the author's local configuration.
export function exportVoicePack({ source, destination, upstream } = {}) {
  upstream ??= JSON.parse(readFileSync(path.join(root, 'config/voice-upstream.json'), 'utf8'));
  const { profile, entries } = validateVoicePack(source, upstream.model);
  const original = JSON.parse(readFileSync(path.join(source, 'adapter.json'), 'utf8'));
  if (!isDeepStrictEqual(original.upstream, upstream) || original.language !== 'en')
    throw new Error('Voice adapter metadata does not match the pinned runtime');
  const adapter = Object.fromEntries(
    ['rank', 'alpha', 'dropout'].map((key) => [key, original.adapter?.[key]]),
  );
  if (
    !Number.isInteger(adapter.rank) ||
    adapter.rank < 1 ||
    adapter.rank > 256 ||
    !Number.isFinite(adapter.alpha) ||
    adapter.alpha <= 0 ||
    !Number.isFinite(adapter.dropout) ||
    adapter.dropout < 0 ||
    adapter.dropout >= 1
  )
    throw new Error('Invalid voice adapter settings');
  noLinks(destination);
  mkdirSync(destination); // Refuse overwriting any earlier release.
  const publicProfile = Object.fromEntries(
    [
      'schemaVersion',
      'id',
      'character',
      'language',
      'engine',
      'baseModel',
      'adapter',
      'adapterConfig',
      'adapterSha256',
      'references',
      'capabilities',
      'sampleRate',
    ]
      .filter((key) => profile[key] !== undefined)
      .map((key) => [key, profile[key]]),
  );
  writeJsonAtomic(path.join(destination, 'voice-profile.json'), publicProfile);
  // Only these fields are consumed by load_adapter; omit dataset hashes,
  // training metrics, transcripts and recipe information from the public pack.
  writeJsonAtomic(path.join(destination, 'adapter.json'), {
    schemaVersion: 1,
    engine: profile.engine,
    language: profile.language,
    adapter,
    upstream,
  });
  for (const { file } of entries) {
    if (file === 'voice-profile.json' || file === 'adapter.json') continue;
    mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
    copyFileSync(path.join(source, file), path.join(destination, file));
  }
  const files = entries.map(({ file }) => ({
    path: file,
    bytes: statSync(path.join(destination, file)).size,
    sha256: createHash('sha256')
      .update(readFileSync(path.join(destination, file)))
      .digest('hex'),
  }));
  const manifest = {
    schemaVersion: 1,
    id: profile.id,
    engine: profile.engine,
    language: profile.language,
    baseModel: profile.baseModel,
    files,
    distribution: 'Separate optional voice artifact; see VOICE-PACK-NOTICE.md',
  };
  writeJsonAtomic(path.join(destination, 'VOICE_PACK_MANIFEST.json'), manifest);
  writeFileSync(
    path.join(destination, 'VOICE-PACK-NOTICE.md'),
    '# Capri voice pack\n\n' +
      'This runtime pack contains a trained LoRA adapter, its configuration and the reference audio required for synthesis. It contains no training dataset or conversation history. No user training is required.\n\n' +
      'The pinned Chatterbox Turbo base weights are downloaded separately from ResembleAI/chatterbox-turbo on Hugging Face. The upstream software and base model specify MIT; retain their original notices.\n\n' +
      'This voice was prepared from English anime dialogue supplied by the project author. Capri source code is GPL-3.0-only; that code license does not grant rights to third-party recordings, character identity or performances. No additional rights clearance is asserted by this packaging tool.\n\n' +
      'The current voice runtime requires a supported NVIDIA GPU and driver. See the application hardware guide.\n',
    'utf8',
  );
  copyFileSync(
    path.join(root, 'config/licenses/chatterbox-MIT.txt'),
    path.join(destination, 'UPSTREAM-LICENSE.txt'),
  );
  validateVoicePack(destination, upstream.model);
  return { directory: destination, manifest };
}
