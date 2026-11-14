import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceFiles,
  validateSource,
  hasSourceCredential,
  assertPublicVoiceConfiguration,
} from '../tools/release/source-export.mjs';
import {
  ACTIVE_AVATAR_CATALOG,
  ACTIVE_AVATAR_POSES,
  requireCapriAvatar,
} from '../apps/desktop/avatar-catalog.mjs';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, findExecutable } from '../packages/runtime/src/host/paths.mjs';
import { musicArtworkSourceFiles } from '../apps/desktop/music-artwork.mjs';

test('source export rejects bare Hugging Face credentials while allowing format documentation', () => {
  const canary = 'hf_' + 'SyntheticCredentialCanary'.repeat(2);
  for (const content of [
    canary,
    JSON.stringify({ access: canary }),
    'export const access = "' + canary + '";',
  ])
    assert.equal(hasSourceCredential(content), true);
  assert.equal(hasSourceCredential('Hugging Face tokens use the hf_ prefix.'), false);
  assert.equal(hasSourceCredential('https://huggingface.co/owner/model'), false);
});
test('source export rejects full Google keys while allowing short or redacted format examples', () => {
  for (const suffix of ['a', '_', '-']) {
    const canary = 'AIza' + 'SyntheticKeyCanary'.repeat(2).slice(0, 34) + suffix;
    assert.equal(canary.length, 39);
    for (const text of [canary, JSON.stringify({ apiKey: canary }), `const key = '${canary}';`])
      assert.equal(hasSourceCredential(text), true);
  }
  for (const text of [
    'AIza',
    'Google API keys commonly start with AIza.',
    'AIza[REDACTED]',
    'AIza' + 'a'.repeat(34),
  ])
    assert.equal(hasSourceCredential(text), false);
});
test('source export rejects authenticated GitHub notification links copied from email', () => {
  const canary = 'SyntheticNotificationCanary'.repeat(3);
  for (const text of [
    `https://github.com/example/project/issues/7?email_token=${canary}`,
    `<https://github.com/example/project/issues/7?email_source=notifications&email_token=${canary}#issuecomment-1>`,
    `https://github.com/example/project/issues/7?email_source=notifications&amp;email_token=${canary}`,
    ...['unsubscribe-auth', 'mobile/ios', 'mobile/android'].map(
      (kind) => `https://github.com/notifications/${kind}/${canary}`,
    ),
  ]) {
    assert.equal(hasSourceCredential(text), true);
    assert.equal(hasSourceCredential(JSON.stringify({ link: text })), true);
  }
  for (const text of [
    'GitHub notification links may have an email_token query parameter.',
    'https://github.com/example/project/issues/7?email_token=REDACTED',
    'https://github.com/notifications/unsubscribe-auth/REDACTED',
    'https://github.com/notifications/mobile/ios/REDACTED',
    'https://github.com/example/project/issues/7',
    `https://github.com.evil.invalid/example/project/issues/7?email_token=${canary}`,
  ])
    assert.equal(hasSourceCredential(text), false);
});
test('source export refuses local imported datasets and private trained voice selections', () => {
  const training = { datasetDir: 'data/voices/capri/en', modelDir: 'data/speech/chatterbox-turbo' };
  const companion = { profileDir: 'data/voices/capri/en/exports/capri-en-v1' };
  assert.doesNotThrow(() => assertPublicVoiceConfiguration(training, companion));
  assert.throws(
    () =>
      assertPublicVoiceConfiguration(
        { ...training, datasetDir: 'data/voices/capri/en/imports/private-id' },
        companion,
      ),
    /public voice defaults/,
  );
  assert.throws(
    () =>
      assertPublicVoiceConfiguration(training, {
        profileDir: 'data/voices/capri/en/exports/capri-trained-private-id',
      }),
    /public voice defaults/,
  );
});
test('source export includes its own tooling and every Node command, excluding installation data', () => {
  const files = sourceFiles();
  assert.ok(files.includes('tools/release/source-export.mjs'));
  assert.ok(files.includes('packages/runtime/bin/capri.mjs'));
  assert.ok(files.includes('config/core.local.schema.json'));
  assert.ok(files.includes('assets/default/screenshot-capture.mp3'));
  assert.ok(files.includes(ACTIVE_AVATAR_CATALOG));
  assert.ok(files.includes(ACTIVE_AVATAR_POSES));
  assert.equal(files.filter((file) => file.startsWith('assets/capri/sprites/poses-v2/')).length, 9);
  assert.deepEqual(
    files.filter((file) => file.startsWith('docs/audit/')),
    ['docs/audit/npm-sbom.cdx.json'],
  );
  assert.ok(
    !files.some(
      (file) =>
        /^(?:data|archive|release|\.runtime|node_modules)\//.test(file) ||
        file.endsWith('.local.json'),
    ),
  );
  assert.equal(validateSource(files).length, files.length);
  assert.throws(
    () => validateSource(files.filter((file) => !file.startsWith('assets/capri/'))),
    /Missing required Capri artwork/,
  );
  assert.throws(
    () => validateSource(files.filter((file) => file !== 'README.md')),
    /Missing release document/,
  );
  assert.throws(() => validateSource([...files, '../outside']), /outside the source boundary/);
  assert.throws(
    () => validateSource(files.filter((file) => file !== 'tools/release/source-export.mjs')),
    /Missing command implementation/,
  );
});

test('standard Git source archives include the validated avatar and keep private directories excluded', (t) => {
  const git = findExecutable('git', { extra: [path.join(root, '.runtime/git/cmd/git.exe')] });
  if (!git) return t.skip('Git is needed to exercise its real export-ignore behavior');
  const parent = path.join(root, '.runtime/source-archive-unit');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'case-'));
  const repository = path.join(folder, 'repo'),
    extracted = path.join(folder, 'extracted');
  mkdirSync(repository);
  mkdirSync(extracted);
  const run = (exe, args) => {
    // The fixture can inherit an administrator-owned workspace ACL on Windows.
    // Trust only this newly-created repository, without changing global Git settings.
    const commandArgs = exe === git ? ['-c', 'safe.directory=' + repository, ...args] : args;
    const result = spawnSync(exe, commandArgs, {
      cwd: repository,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    return result.stdout.trim();
  };
  copyFileSync(path.join(root, '.gitattributes'), path.join(repository, '.gitattributes'));
  const catalog = requireCapriAvatar(root);
  const required = [
    ACTIVE_AVATAR_CATALOG,
    ACTIVE_AVATAR_POSES,
    ...musicArtworkSourceFiles(root),
    ...catalog.frames.map((frame) => path.relative(root, frame.file).split(path.sep).join('/')),
  ];
  for (const file of required) {
    const target = path.join(repository, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file), target);
  }
  // Track private canaries deliberately: archive policy must exclude them even
  // if someone accidentally stages one. No real personal data enters this fixture.
  for (const directory of [
    'archive',
    'data',
    'logs',
    '.runtime',
    'vendor',
    'release',
    'docs/audit',
  ]) {
    mkdirSync(path.join(repository, directory), { recursive: true });
    writeFileSync(
      path.join(repository, directory, 'private-canary.txt'),
      'fixture-only private data',
    );
  }
  writeFileSync(path.join(repository, 'docs/audit/npm-sbom.cdx.json'), '{}');
  run(git, ['init', '--quiet']);
  run(git, ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', 'add', '--force', '--', '.']);
  const tree = run(git, ['write-tree']);
  const archive = path.join(folder, 'source.tar');
  run(git, ['archive', '--format=tar', '--output=' + archive, tree]);
  const entries = run('tar', ['-tf', archive]).split(/\r?\n/);
  for (const file of required) assert.ok(entries.includes(file), 'Git archive omitted ' + file);
  assert.ok(!entries.some((file) => file.endsWith('/private-canary.txt')));
  assert.ok(entries.includes('docs/audit/npm-sbom.cdx.json'));
  run('tar', ['-xf', archive, '-C', extracted]);
  const restored = requireCapriAvatar(extracted);
  assert.equal(restored.frames.length, 38);
  for (const file of required)
    assert.deepEqual(
      readFileSync(path.join(extracted, file)),
      readFileSync(path.join(root, file)),
      file,
    );
});
