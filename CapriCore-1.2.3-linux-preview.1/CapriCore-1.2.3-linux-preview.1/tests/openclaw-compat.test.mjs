import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyOpenClawCompatibility } from '../scripts/openclaw-compat.mjs';

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'capri-compat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'node_modules/openclaw/dist'), { recursive: true });
  mkdirSync(path.join(dir, 'integrations/openclaw-compat'), { recursive: true });
  writeFileSync(
    path.join(dir, 'node_modules/openclaw/package.json'),
    JSON.stringify({ version: 'fixture-1' }),
  );
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const patches = ['a', 'b'].map((name) => ({
    file: `dist/${name}.mjs`,
    before: `before ${name}`,
    after: `after ${name}`,
    beforeSha256: digest(`before ${name}`),
    afterSha256: digest(`after ${name}`),
  }));
  const manifest = path.join(dir, 'integrations/openclaw-compat/patches.json');
  writeFileSync(manifest, JSON.stringify({ version: 'fixture-1', patches }));
  for (const patch of patches)
    writeFileSync(path.join(dir, 'node_modules/openclaw', patch.file), patch.before);
  return {
    dir,
    manifest,
    patches,
    file: (name) => path.join(dir, `node_modules/openclaw/dist/${name}.mjs`),
  };
}

test('reviewed OpenClaw fixes apply once and safely resume a partially patched installation', (t) => {
  const f = fixture(t);
  writeFileSync(f.file('a'), f.patches[0].after);
  assert.equal(applyOpenClawCompatibility(f.dir), true);
  assert.equal(readFileSync(f.file('b'), 'utf8'), 'after b');
  assert.equal(applyOpenClawCompatibility(f.dir), false);
});

test('an unknown dependency version or changed file prevents all compatibility writes', (t) => {
  const f = fixture(t);
  writeFileSync(f.file('b'), 'an unknown upstream change');
  assert.throws(() => applyOpenClawCompatibility(f.dir), /differs from the reviewed version/);
  assert.equal(readFileSync(f.file('a'), 'utf8'), 'before a');
  writeFileSync(path.join(f.dir, 'node_modules/openclaw/package.json'), '{"version":"fixture-2"}');
  assert.throws(() => applyOpenClawCompatibility(f.dir), /need review/);
  assert.equal(readFileSync(f.file('a'), 'utf8'), 'before a');
  const malicious = {
    version: 'fixture-2',
    patches: [{ ...f.patches[0], file: '../outside.mjs' }],
  };
  writeFileSync(f.manifest, JSON.stringify(malicious));
  assert.throws(() => applyOpenClawCompatibility(f.dir), /Invalid OpenClaw patch path/);
});

test('an explicitly reviewed previous patch can upgrade without accepting unknown code', (t) => {
  const f = fixture(t),
    previous = 'reviewed old patch a';
  const manifest = JSON.parse(readFileSync(f.manifest, 'utf8'));
  manifest.patches[0].upgrades = [
    {
      beforeSha256: createHash('sha256').update(previous).digest('hex'),
      edits: [{ before: previous, after: 'after a' }],
    },
  ];
  writeFileSync(f.manifest, JSON.stringify(manifest));
  writeFileSync(f.file('a'), previous);
  assert.equal(applyOpenClawCompatibility(f.dir), true);
  assert.equal(readFileSync(f.file('a'), 'utf8'), 'after a');
});

test('real pinned fixes support a fresh dependency and previously reviewed patches', (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'integrations/openclaw-compat/patches.json'), 'utf8'),
  );
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  for (const previous of [false, true]) {
    const f = fixture(t);
    writeFileSync(
      path.join(f.dir, 'node_modules/openclaw/package.json'),
      JSON.stringify({ version: manifest.version }),
    );
    writeFileSync(f.manifest, JSON.stringify(manifest));
    for (const patch of manifest.patches) {
      let source = readFileSync(path.join(root, 'node_modules/openclaw', patch.file), 'utf8');
      assert.equal(hash(source), patch.afterSha256);
      const upgrade = previous ? patch.upgrades?.at(-1) : null;
      const edits = upgrade?.edits ?? patch.edits ?? [{ before: patch.before, after: patch.after }];
      for (const edit of [...edits].reverse()) {
        assert.equal(source.split(edit.after).length, 2, patch.file);
        source = source.replace(edit.after, edit.before);
      }
      assert.equal(hash(source), upgrade?.beforeSha256 ?? patch.beforeSha256, patch.file);
      const target = path.join(f.dir, 'node_modules/openclaw', patch.file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    assert.equal(applyOpenClawCompatibility(f.dir), true);
    assert.equal(applyOpenClawCompatibility(f.dir), false);
  }
});

test('deliberate chat-only profiles tolerate only an empty or memory-only one-turn mask', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../integrations/openclaw-compat/patches.json', import.meta.url), 'utf8'),
  );
  const patch = manifest.patches.find((entry) => entry.file.includes('builtin-openclaw-'));
  const source = patch.edits.findLast((edit) => edit.after.includes('const capriChatOnly =')).after;
  const allowed = new Function('attempt', 'toolsEnabled', source + '\nreturn capriChatOnly;');
  for (const provider of ['capri-api', 'ollama']) {
    const attempt = { provider, model: { compat: { supportsTools: false } } };
    for (const toolsAllow of [undefined, [], ['memory_search'], ['memory_get', 'memory_search']])
      assert.equal(allowed({ ...attempt, toolsAllow }, false), true);
    for (const toolsAllow of [['desktop_control'], ['memory_search', 'write'], ['exec']])
      assert.equal(allowed({ ...attempt, toolsAllow }, false), false);
    assert.equal(allowed(attempt, true), false);
    assert.equal(allowed({ ...attempt, model: { compat: { supportsTools: true } } }, false), false);
    assert.equal(allowed({ ...attempt, model: {} }, false), false);
  }
  assert.equal(
    allowed({ provider: 'unreviewed', model: { compat: { supportsTools: false } } }, false),
    false,
  );
});

test('an intentional Capri dialogue mask is distinct from broken tool allowlists', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../integrations/openclaw-compat/patches.json', import.meta.url), 'utf8'),
  );
  const patch = manifest.patches.find((entry) => entry.file.includes('builtin-openclaw-'));
  const edit = patch.edits.find((edit) => edit.after.includes('const capriDialogueOnly ='));
  const declaration = edit.after.split('const emptyExplicitToolAllowlistError')[0];
  const allowed = new Function('attempt', declaration + '\nreturn capriDialogueOnly;');
  assert.equal(allowed({ agentId: 'capri', toolsAllow: [] }), true);
  for (const attempt of [
    { agentId: 'other', toolsAllow: [] },
    { agentId: 'capri' },
    { agentId: 'capri', toolsAllow: ['spotify_control'] },
    { agentId: 'capri', toolsAllow: ['missing_plugin'] },
  ])
    assert.equal(allowed(attempt), false);
});
