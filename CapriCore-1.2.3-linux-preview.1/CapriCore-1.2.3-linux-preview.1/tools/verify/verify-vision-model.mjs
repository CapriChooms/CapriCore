/** Real local multimodal Qwen, synthetic image, no capture and no image persistence. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, settings, personaPrompt } from '../../packages/runtime/src/index.mjs';
import { VisualService } from '../../apps/desktop/visual-service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import { visionImage } from '../../tests/fixtures/vision-image.mjs';
const rt = runtime(),
  catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG)),
  png = visionImage();
const service = new VisualService({
  url: rt.ollamaUrl,
  model: settings.model,
  params: { num_ctx: settings.contextTokens, ...settings.generation },
  rpc: { call: async () => ({ messages: [] }) },
  sessionKey: 'synthetic-only',
  persona: () => personaPrompt(rt),
  avatars: catalog.publicSprites(),
});
const started = performance.now();
let firstText;
const result = await service.generate({
  text: 'Describe the two colored shapes and their positions. Be brief.',
  png,
  source: { kind: 'window', label: 'Generated shape fixture', capturedAt: Date.now() },
  signal: AbortSignal.timeout(90000),
  emit: (e) => {
    if (e.type === 'text') firstText ??= Math.round(performance.now() - started);
  },
});
assert.match(result.text, /red/i);
assert.match(result.text, /square/i);
assert.match(result.text, /blue/i);
assert.match(result.text, /circle/i);
const report = {
  passed: true,
  physicalCapture: false,
  imageSaved: false,
  firstTextMs: firstText,
  totalMs: Math.round(performance.now() - started),
  answer: result.text,
};
writeFileSync(
  path.join(root, 'logs/vision-model-verification.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
