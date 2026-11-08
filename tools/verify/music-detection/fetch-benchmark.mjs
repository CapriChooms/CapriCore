// SPDX-License-Identifier: GPL-3.0-only
// Public, licensed research audio only. Never records an owner device and never
// places recordings in the distributable source tree.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const destination = path.resolve('.runtime/music-detection-research/benchmark');
mkdirSync(destination, { recursive: true });
const examples = [];
const groups = {
  music: [
    0, 6, 21, 26, 30, 62, 67, 70, 92, 104, 110, 150, 190, 230, 270, 310, 350, 390, 430, 470, 510,
    550, 590, 630, 659,
  ],
  speech: [0, 25, 60, 100, 140, 180, 220, 260, 300, 350, 390, 425],
  noise: [0, 100, 230, 360, 490, 620, 760, 929],
};
for (const [category, rows] of Object.entries(groups))
  for (const row of rows)
    examples.push({
      dataset: 'dys-asr/musan-sr16000',
      config: category,
      split: 'train',
      row,
      category,
      language: 'varied',
    });
// fetch_fleurs.py streams primary Google archives: the dataset viewer rejects
// these large Parquet row groups. Keep its six-language samples in the manifest.
const metadataFile = path.join(destination, 'recordings.json');
const saved = existsSync(metadataFile) ? JSON.parse(readFileSync(metadataFile, 'utf8')) : [];
const byName = new Map(saved.map((entry) => [entry.name, entry]));
let cursor = 0;
let rateLimited = false;
const revision = '6b90f661bfe51e873d9c79bb3df7b9f442f0bdb1';
async function sample(example) {
  const name = `${example.dataset === 'google/fleurs' ? 'fleurs-' + example.config : 'musan-' + example.category}-${example.row}.wav`;
  const file = path.join(destination, name);
  if (byName.has(name) && existsSync(file)) return;
  const query = new URL('https://datasets-server.huggingface.co/rows');
  for (const [key, value] of Object.entries({
    dataset: example.dataset,
    config: example.config,
    split: example.split,
    offset: example.row,
    length: 1,
  }))
    query.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(query, { signal: AbortSignal.timeout(45000) });
      if (response.status === 429) {
        rateLimited = true;
        console.log(JSON.stringify({ deferred: name, reason: 'Dataset rate limit; retry later.' }));
        return;
      }
      if (!response.ok) throw Error(`Dataset metadata HTTP ${response.status}`);
      const data = await response.json(),
        row = data.rows?.[0]?.row;
      const source = row?.audio?.[0]?.src;
      if (!source || !source.startsWith('https://datasets-server.huggingface.co/cached-assets/'))
        throw Error('Audio sample unavailable');
      if (!new URL(source).pathname.includes(`/--/${revision}/--/`))
        throw Error('Benchmark source revision changed');
      const maximum = 960044; // 30 seconds of 16 kHz PCM16; bounded prefix only.
      const audio = await fetch(source, {
        headers: { Range: `bytes=0-${maximum - 1}` },
        signal: AbortSignal.timeout(60000),
      });
      if (!audio.ok) throw Error(`Audio sample HTTP ${audio.status}`);
      const reader = audio.body.getReader(),
        chunks = [];
      let bytes = 0;
      while (bytes < maximum) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = Buffer.from(part.value.subarray(0, maximum - bytes));
        chunks.push(chunk);
        bytes += chunk.length;
      }
      await reader.cancel();
      const body = Buffer.concat(chunks);
      if (body.subarray(0, 4).toString() !== 'RIFF' || body.subarray(8, 12).toString() !== 'WAVE')
        throw Error('Expected WAV sample');
      writeFileSync(file, body);
      byName.set(name, {
        ...example,
        name,
        bytes,
        sha256: createHash('sha256').update(body).digest('hex'),
        audioSource: source.split('?')[0],
        metadataSource: query.href,
        sourceLicense:
          'CC-BY-4.0; retain original MUSAN per-recording license metadata for redistribution',
      });
      writeFileSync(metadataFile, JSON.stringify([...byName.values()], null, 2) + '\n');
      console.log(JSON.stringify({ downloaded: name, bytes }));
      return;
    } catch (error) {
      if (attempt === 2) console.log(JSON.stringify({ unavailable: name, reason: error.message }));
      else await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (cursor < examples.length && !rateLimited) await sample(examples[cursor++]);
  }),
);
console.log(JSON.stringify({ completed: byName.size, requested: examples.length, destination }));
