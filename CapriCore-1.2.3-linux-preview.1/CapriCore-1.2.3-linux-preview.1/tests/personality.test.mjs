// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { registerCompanionIpc } from '../apps/desktop/main/companion-ipc.mjs';
import { personaPrompt, initialize, runtime } from '../packages/runtime/src/context.mjs';
import {
  defaultPersonality,
  readPersonality,
  savePersonality,
  initializePersonality,
  PERSONALITY_PROMPT_HEADER,
} from '../packages/runtime/src/personality.mjs';

const folder = () => mkdtempSync(path.join(os.tmpdir(), 'capri-personality-'));
const legacy = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'TOOLS.md', 'personality.json'];
const oldFactoryExample =
  'For casual questions about your day, give a small characterful response rather than a generic speech about processing millions of words, being an AI or always being ready to help. For example: Quiet in the wires today. Your timing is pretty good, choom. This illustrates brevity, not a line to repeat. Never pass fictional activity off as a real observation of the computer.';

test('factory conversation guidance contains no copyable stock answer', () => {
  assert.doesNotMatch(defaultPersonality(), /Quiet in the wires today|This illustrates brevity/);
  assert.match(defaultPersonality(), /in your own words/);
});

test('the prompt drops the old factory language cue without changing the stored profile', () => {
  const workspace = folder();
  const file = path.join(workspace, 'PERSONALITY.md');
  const shippedIntro = defaultPersonality()
    .split(/\r?\n/)
    .find((line) => line.startsWith('You are Capri,'));
  assert.ok(shippedIntro.includes('Speak in the first person.'));
  const legacyIntro = shippedIntro.replace(
    'Speak in the first person.',
    'Speak in the first person and in the conversation language selected by the interface.',
  );
  const original = ['\uFEFF# Edited profile', '', legacyIntro, '', 'Custom wording.'].join('\r\n');
  writeFileSync(file, original);
  const prompt = personaPrompt({ workspace });
  assert.ok(prompt.includes(shippedIntro + '\r\n\r\nCustom wording.'));
  assert.ok(!prompt.includes(legacyIntro));
  assert.equal(readFileSync(file, 'utf8'), original);
  const quoted = '> ' + legacyIntro;
  assert.ok(personaPrompt({ workspace }, { personality: quoted }).includes(quoted));
});

test('upgrade replaces only the exact factory example and preserves custom text, memory and history', () => {
  for (const ending of ['\n', '\r\n']) {
    const parent = folder(),
      workspace = path.join(parent, 'workspace'),
      backupDirectory = path.join(parent, 'backups');
    mkdirSync(workspace);
    const original = [
      '\uFEFF# My chosen character',
      '',
      oldFactoryExample,
      '',
      'My own instructions stay exactly as written.  ',
      '',
      '',
    ].join(ending);
    const replacement = defaultPersonality()
      .split(/\r?\n/)
      .find((line) => line.startsWith('For casual questions about your day,'));
    writeFileSync(path.join(workspace, 'PERSONALITY.md'), original);
    for (const file of ['USER.md', 'MEMORY.md', 'transcript.json'])
      writeFileSync(path.join(workspace, file), 'Private fixture ' + file);
    const migrated = initializePersonality(workspace, { backupDirectory });
    assert.equal(migrated.created, true);
    assert.equal(
      readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'),
      original.replace(oldFactoryExample, replacement),
    );
    assert.equal(readFileSync(path.join(migrated.backup, 'PERSONALITY.md'), 'utf8'), original);
    for (const file of ['USER.md', 'MEMORY.md', 'transcript.json'])
      assert.equal(readFileSync(path.join(workspace, file), 'utf8'), 'Private fixture ' + file);
    assert.equal(initializePersonality(workspace, { backupDirectory }).created, false);
    assert.equal(readdirSync(backupDirectory).length, 1);
  }
});

test('upgrade leaves edited or quoted examples and unrelated custom personality untouched', () => {
  for (const custom of [
    'A completely custom character.',
    '> ' + oldFactoryExample,
    oldFactoryExample + ' My deliberate addition.',
    oldFactoryExample.replace('Your timing is pretty good, choom.', 'My original custom metaphor.'),
  ]) {
    const parent = folder(),
      workspace = path.join(parent, 'workspace');
    mkdirSync(workspace);
    const original = '\uFEFF' + custom + '\r\n';
    writeFileSync(path.join(workspace, 'PERSONALITY.md'), original);
    assert.equal(
      initializePersonality(workspace, { backupDirectory: path.join(parent, 'backups') }).created,
      false,
    );
    assert.equal(readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'), original);
  }
});

test('menu read, save, reveal and reset all address the same Personality file', () => {
  const workspace = folder(),
    handlers = new Map(),
    revealed = [];
  registerCompanionIpc((name, handler) => handlers.set(name, handler), {
    root,
    state: workspace,
    rt: { workspace },
    preferences: {},
    shell: { showItemInFolder: (file) => revealed.push(file) },
    assertIdle: () => {},
  });
  const save = handlers.get('capri:personality-save'),
    get = handlers.get('capri:personality-get');
  assert.equal(save('One chosen character.'), 'One chosen character.');
  assert.equal(get().text, 'One chosen character.');
  handlers.get('capri:personality-open')();
  assert.deepEqual(revealed, [path.join(workspace, 'PERSONALITY.md')]);
  writeFileSync(path.join(workspace, 'PERSONALITY.md'), 'Changed outside the app.');
  assert.equal(get().text, 'Changed outside the app.');
  assert.equal(save(''), get().original);
  assert.equal(get().text, get().original);
  assert.deepEqual(readdirSync(workspace), ['PERSONALITY.md']);
});

test('one editable Personality file reaches the next request without a second character or topic filter', () => {
  const workspace = folder();
  writeFileSync(path.join(workspace, 'SOUL.md'), 'A retired character that must be ignored.');
  const custom =
    'A tender, mischievous partner in a moonlit romance.\nГовори тепло, используй необычные метафоры.';
  assert.equal(savePersonality(workspace, custom), custom);
  assert.equal(readPersonality(workspace), custom);
  assert.ok(personaPrompt({ workspace }).startsWith(PERSONALITY_PROMPT_HEADER + '\n' + custom));
  assert.ok(personaPrompt({ workspace }).includes('COMMUNICATION STYLE: neutral'));
  writeFileSync(path.join(workspace, 'PERSONALITY.md'), '\uFEFFChanged externally.');
  assert.ok(
    personaPrompt({ workspace }).startsWith(PERSONALITY_PROMPT_HEADER + '\nChanged externally.'),
  );
  assert.throws(() => savePersonality(workspace, 'invalid\0text'));
  assert.throws(() => savePersonality(workspace, 'x'.repeat(24001)));
  assert.equal(savePersonality(workspace, ''), defaultPersonality());
  assert.equal(readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'), defaultPersonality());
  assert.ok(!personaPrompt({ workspace }).includes('retired character'));
});

test('migration keeps existing PERSONALITY byte for byte, archives old prompts and preserves memory', () => {
  const parent = folder(),
    workspace = path.join(parent, 'workspace'),
    backupDirectory = path.join(parent, 'backups');
  mkdirSync(workspace);
  const selected = '\uFEFFMy chosen character.\r\nCustom details.\r\n';
  writeFileSync(path.join(workspace, 'PERSONALITY.md'), selected);
  for (const name of legacy)
    writeFileSync(
      path.join(workspace, name),
      name === 'personality.json' ? '{"schemaVersion":1,"text":"Old override"}' : 'Old ' + name,
    );
  for (const name of ['MEMORY.md', 'USER.md', 'DREAMS.md', 'transcript.json'])
    writeFileSync(path.join(workspace, name), 'Private ' + name);
  const result = initializePersonality(workspace, { backupDirectory });
  assert.equal(result.created, false);
  assert.equal(result.source, 'PERSONALITY.md');
  assert.deepEqual(result.archived, legacy);
  assert.equal(readFileSync(path.join(workspace, 'PERSONALITY.md'), 'utf8'), selected);
  for (const name of legacy) {
    assert.equal(existsSync(path.join(workspace, name)), false);
    assert.ok(existsSync(path.join(result.backup, name)));
  }
  assert.equal(readFileSync(path.join(result.backup, 'PERSONALITY.md'), 'utf8'), selected);
  for (const name of ['MEMORY.md', 'USER.md', 'DREAMS.md', 'transcript.json'])
    assert.equal(readFileSync(path.join(workspace, name), 'utf8'), 'Private ' + name);
  assert.deepEqual(initializePersonality(workspace, { backupDirectory }).archived, []);
  assert.equal(readdirSync(backupDirectory).length, 1);
});

test('migration selects an old custom override, then SOUL, then the factory template', () => {
  for (const source of ['json', 'soul', 'fresh', 'empty-reset']) {
    const parent = folder(),
      workspace = path.join(parent, 'workspace');
    mkdirSync(workspace);
    if (source !== 'fresh') writeFileSync(path.join(workspace, 'SOUL.md'), 'Old SOUL character.');
    if (['json', 'empty-reset'].includes(source))
      writeFileSync(
        path.join(workspace, 'personality.json'),
        '{"schemaVersion":1,"text":"Selected legacy override."}',
      );
    if (source === 'empty-reset') writeFileSync(path.join(workspace, 'PERSONALITY.md'), '');
    initializePersonality(workspace, { backupDirectory: path.join(parent, 'backups') });
    assert.equal(
      readPersonality(workspace),
      source === 'json'
        ? 'Selected legacy override.'
        : source === 'soul'
          ? 'Old SOUL character.'
          : defaultPersonality(),
      source,
    );
    for (const name of legacy) assert.equal(existsSync(path.join(workspace, name)), false);
  }
});

test('invalid canonical edits are reported without deleting any legacy source', () => {
  const workspace = folder();
  writeFileSync(path.join(workspace, 'PERSONALITY.md'), 'x'.repeat(24001));
  writeFileSync(path.join(workspace, 'SOUL.md'), 'Preserve this source.');
  assert.throws(() => initializePersonality(workspace));
  assert.equal(readFileSync(path.join(workspace, 'SOUL.md'), 'utf8'), 'Preserve this source.');
});

test('fresh runtime creates just one prompt file and disables automatic legacy bootstrap creation', () => {
  const parent = folder(),
    rt = runtime({
      workspace: path.join(parent, 'workspace'),
      stateDir: path.join(parent, 'openclaw'),
    });
  initialize(rt);
  assert.ok(existsSync(path.join(rt.workspace, 'PERSONALITY.md')));
  for (const name of legacy) assert.equal(existsSync(path.join(rt.workspace, name)), false);
  const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  config.agents.defaults.skipBootstrap = false;
  writeFileSync(rt.configPath, JSON.stringify(config));
  initialize(rt);
  assert.equal(JSON.parse(readFileSync(rt.configPath, 'utf8')).agents.defaults.skipBootstrap, true);
});

test('actual pinned OpenClaw context filter removes duplicate character files while retaining owner memory', () => {
  const source = readFileSync(
    new URL(
      '../node_modules/openclaw/dist/attempt-system-prompt-prepare-BIe9Jay8.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  const flag = source.match(/const capriPersonalityPrompt = ([^\n]+);/)[1];
  const filter = source.match(/contextFiles: (params\.bootstrap\.contextFiles\.filter[^\n]+),/)[1];
  const files = [
    'SOUL.md',
    'AGENTS.md',
    'IDENTITY.md',
    'TOOLS.md',
    'PERSONALITY.md',
    'USER.md',
    'MEMORY.md',
  ].map((name) => ({ path: 'C:\\fixture\\' + name, content: name }));
  for (const [agentId, prompt, expected] of [
    ['capri', PERSONALITY_PROMPT_HEADER + '\nChosen character.', ['USER.md', 'MEMORY.md']],
    ['other', PERSONALITY_PROMPT_HEADER + '\nOther character.', files.map((f) => f.content)],
    ['capri', 'No managed persona supplied.', files.map((f) => f.content)],
  ]) {
    const context = vm.createContext({
      attempt: { agentId, extraSystemPrompt: prompt },
      params: { bootstrap: { contextFiles: files } },
    });
    new vm.Script('const capriPersonalityPrompt = ' + flag).runInContext(context);
    const result = new vm.Script(filter).runInContext(context);
    assert.deepEqual(
      Array.from(result, (f) => f.content),
      expected,
    );
  }
});

test('the reviewed OpenClaw adapter patch supports a clean package and prior patched versions', () => {
  const spec = JSON.parse(
    readFileSync(path.join(root, 'integrations/openclaw-compat/patches.json'), 'utf8'),
  );
  const patch = spec.patches.find(
    (p) => p.file === 'dist/attempt-system-prompt-prepare-BIe9Jay8.mjs',
  );
  const current = readFileSync(path.join(root, 'node_modules/openclaw', patch.file), 'utf8');
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  assert.equal(digest(current), patch.afterSha256);
  for (const version of [
    { beforeSha256: patch.beforeSha256, edits: patch.edits },
    ...patch.upgrades,
  ]) {
    let original = current;
    for (const edit of [...version.edits].reverse()) {
      assert.equal(original.split(edit.after).length, 2, 'Unique reverse patch anchor');
      original = original.replace(edit.after, edit.before);
    }
    assert.equal(digest(original), version.beforeSha256, 'Reviewed input checksum');
  }
});
