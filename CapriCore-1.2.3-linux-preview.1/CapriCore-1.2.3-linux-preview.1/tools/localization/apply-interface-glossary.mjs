import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';
const glossary = JSON.parse(
  readFileSync(path.join(root, 'config/interface-glossary.json'), 'utf8'),
);
for (const [id, values] of Object.entries(glossary.locales)) {
  if (values.length !== glossary.keys.length) throw new Error('Invalid glossary width: ' + id);
  const file = path.join(root, 'apps/desktop/locales', id + '.json');
  if (!existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const originalMessages = JSON.stringify(data.messages);
  for (let i = 0; i < values.length; i++) data.messages[glossary.keys[i]] = values[i];
  Object.assign(data.messages, glossary.overrides?.[id] ?? {});
  data.messages['Languages…'] = values[0] + '…';
  // Avoid rewriting unchanged catalogs and their unrelated editorial metadata.
  if (JSON.stringify(data.messages) !== originalMessages) writeJsonAtomic(file, data);
}
console.log('Core interface glossary applied.');
