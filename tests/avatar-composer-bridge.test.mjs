// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  readSelectedComposerFiles,
  sanitizeAvatarComposerState,
  validateAvatarComposerAction,
} from '../apps/desktop/main/avatar-composer-bridge.mjs';

test('composer actions accept only the exact owner intent and bounded draft revisions', () => {
  for (const action of [
    { type: 'edit', draft: '', revision: 0 },
    { type: 'edit', draft: 'x'.repeat(8000), revision: Number.MAX_SAFE_INTEGER },
    { type: 'submit' },
    { type: 'attach' },
    { type: 'remove', id: 'attachment-id' },
    { type: 'microphone' },
    { type: 'keyboard' },
    { type: 'menu' },
  ])
    assert.deepEqual(validateAvatarComposerAction(action), action);
  for (const action of [
    null,
    [],
    'submit',
    {},
    { type: 'invoke', channel: 'capri:send' },
    { type: 'submit', draft: 'extra' },
    { type: 'keyboard', mode: 'text' },
    { type: 'menu', command: 'arbitrary' },
    { type: 'edit', draft: 'x', revision: -1 },
    { type: 'edit', draft: 'x', revision: 1.5 },
    { type: 'edit', draft: 'x', revision: NaN },
    { type: 'edit', draft: 'x', revision: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'edit', draft: 'x' },
    { type: 'edit', draft: 'x'.repeat(8001), revision: 1 },
    { type: 'edit', draft: 7, revision: 1 },
    { type: 'remove', id: '' },
    { type: 'remove', id: 'x'.repeat(129) },
    { type: 'remove', id: 1 },
    { type: 'attach', filePaths: ['C:\\private.txt'] },
    Object.assign(new Date(), { type: 'submit' }),
    { type: 'submit', [Symbol('extra')]: true },
    Object.defineProperty({}, 'type', { get: () => 'submit' }),
  ])
    assert.throws(() => validateAvatarComposerAction(action), /^Error: Invalid composer action\.$/);
});

test('pasted files carry only bounded basenames and copied byte views, including friendly empty-file rejection', () => {
  const source = new Uint8Array([9, 1, 2, 3, 8]);
  const action = {
    type: 'paste-files',
    files: [
      { name: 'Screenshot.png', bytes: source.subarray(1, 4) },
      { name: 'Отчёт.txt', bytes: new Uint8Array() },
      { name: 'unsupported.exe', bytes: new Uint8Array() },
    ],
    overflow: true,
  };
  const value = validateAvatarComposerAction(action);
  assert.deepEqual(value, {
    type: 'paste-files',
    files: [
      { name: 'Screenshot.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'Отчёт.txt', bytes: new Uint8Array() },
      { name: 'unsupported.exe', bytes: new Uint8Array() },
    ],
    overflow: true,
  });
  assert.notEqual(value.files[0].bytes.buffer, source.buffer);
  assert.equal(value.files[0].bytes.byteOffset, 0);
  assert.equal(value.files[0].bytes.buffer.byteLength, 3);
  source.fill(0);
  assert.deepEqual([...value.files[0].bytes], [1, 2, 3]);
  assert.deepEqual(
    validateAvatarComposerAction({ type: 'paste-files', files: [], overflow: false }).files,
    [],
  );
});

test('pasted files reject paths, malformed byte types, getters, extra fields and excessive counts', () => {
  const file = { name: 'example.txt', bytes: new Uint8Array([1]) };
  const paste = (files) => ({ type: 'paste-files', files, overflow: false });
  let getterCalls = 0;
  const getter = () => {
    getterCalls++;
    return 'unexpected';
  };
  const arrayGetter = Object.defineProperty([file], '0', { get: getter });
  const detached = new Uint8Array([1]);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const action of [
    { type: 'paste-files', files: [file] },
    { ...paste([file]), overflow: 1 },
    { ...paste([file]), filePaths: ['private-path'] },
    paste('not-an-array'),
    paste(new Array(1)),
    paste(Array(5).fill(file)),
    paste(Object.assign([file], { extra: true })),
    paste(arrayGetter),
    paste([null]),
    paste([Object.defineProperty({}, 'name', { get: getter })]),
    paste([Object.defineProperty({ bytes: file.bytes }, 'name', { get: getter })]),
    paste([Object.defineProperty({ name: file.name }, 'bytes', { get: getter })]),
    paste([{ ...file, path: 'private-path' }]),
    paste([{ ...file, [Symbol('extra')]: true }]),
    ...[
      '',
      ' ',
      '.',
      '..',
      '../file.txt',
      '/file.txt',
      'C:\\file.txt',
      'C:file.txt',
      'file.txt:stream',
      'file\0.txt',
      'file\n.txt',
      'x'.repeat(161),
    ].map((name) => paste([{ ...file, name }])),
    ...[
      [],
      detached,
      new ArrayBuffer(2),
      new Uint16Array(2),
      new Uint8ClampedArray(2),
      new DataView(new ArrayBuffer(2)),
      Object.create(Uint8Array.prototype),
    ].map((bytes) => paste([{ ...file, bytes }])),
  ])
    assert.throws(() => validateAvatarComposerAction(action), /^Error: Invalid composer action\.$/);
  assert.equal(getterCalls, 0);
});

test('pasted ordinary files use 8 MiB and videos use 32 MiB before forwarding', () => {
  const ordinary = new Uint8Array(8 * 1024 * 1024);
  const video = new Uint8Array(32 * 1024 * 1024);
  const paste = (name, bytes) => ({
    type: 'paste-files',
    files: [{ name, bytes }],
    overflow: false,
  });
  assert.equal(
    validateAvatarComposerAction(paste('image.png', ordinary)).files[0].bytes.length,
    ordinary.length,
  );
  assert.equal(
    validateAvatarComposerAction(paste('clip.WEBM', video)).files[0].bytes.length,
    video.length,
  );
  for (const [name, bytes] of [
    ['document.txt', new Uint8Array(ordinary.length + 1)],
    ['clip.mp4', new Uint8Array(video.length + 1)],
    ['unknown.exe', video],
  ])
    assert.throws(
      () => validateAvatarComposerAction(paste(name, bytes)),
      /^Error: Invalid composer action\.$/,
    );
});

test('published state includes only bounded presentation data and basename attachment labels', () => {
  const state = sanitizeAvatarComposerState({
    draft: 'x'.repeat(9000),
    draftRevision: 12,
    canSend: true,
    canAttach: true,
    busy: false,
    apiKey: 'never-publish',
    config: { token: 'never-publish' },
    filePaths: ['C:\\private.txt'],
    attachments: [
      { id: '1', name: 'C:\\private\\report.txt', path: 'C:\\private\\report.txt', bytes: [1, 2] },
      { id: '2', name: '/private/photos/image.png', status: 'loading' },
      { id: '3', name: 'c\0.txt' },
      { id: '4', name: 'notes.md' },
      { id: '5', name: 'extra.txt' },
    ],
    microphone: {
      loading: true,
      listening: false,
      disabled: false,
      label: 'M'.repeat(200),
      devices: ['private'],
    },
    labels: { send: 'Отправить', actionFailed: 'F'.repeat(300), unknown: 'never-publish' },
    locale: 'ru-RU',
    error: 'E'.repeat(500),
    status: 'S'.repeat(500),
    theme: {
      cyan: '#8ef5ed',
      pink: 'hsl(320 70% 60%)',
      'theme-panel': 'rgba(0, 0, 0, .4)',
      'theme-text': 'url(https://example.com)',
      unknown: 'red',
    },
  });
  assert.equal(state.draft.length, 8000);
  assert.equal(state.draftRevision, 12);
  assert.deepEqual(state.attachments, [
    { id: '1', name: 'report.txt' },
    { id: '2', name: 'image.png' },
    { id: '3', name: 'c.txt' },
    { id: '4', name: 'notes.md' },
  ]);
  assert.deepEqual(Object.keys(state.microphone), ['loading', 'listening', 'disabled', 'label']);
  assert.equal(state.microphone.label.length, 160);
  assert.equal(state.labels.send, 'Отправить');
  assert.equal(state.labels.actionFailed.length, 200);
  assert.equal(state.locale, 'ru-RU');
  assert.equal(state.error.length, 400);
  assert.equal(state.status.length, 400);
  assert.deepEqual(state.theme, {
    cyan: '#8ef5ed',
    pink: 'hsl(320 70% 60%)',
    'theme-panel': 'rgba(0, 0, 0, .4)',
  });
  for (const key of ['apiKey', 'config', 'filePaths'])
    assert.equal(Object.hasOwn(state, key), false);
  assert.equal(JSON.stringify(state).includes('private'), false);
});

test('malformed state cannot enable controls, execute getters or publish extra CSS', () => {
  const state = sanitizeAvatarComposerState({
    draftRevision: -1,
    canSend: 'true',
    canAttach: 1,
    busy: {},
    locale: 'en;url(x)',
    microphone: { loading: 1, listening: 'true', disabled: 'false' },
    attachments: [
      { id: '1', name: '../' },
      { id: '1', name: 'a.txt' },
      { id: '1', name: 'b.txt' },
      { id: '', name: 'x' },
    ],
    theme: { cyan: '#fff; background: url(x)', pink: 'var(--secret)', 'theme-text': 'white' },
    labels: Object.defineProperty({}, 'send', {
      get: () => assert.fail('Getter must not execute'),
    }),
  });
  assert.equal(state.canSend, false);
  assert.equal(state.canAttach, false);
  assert.equal(state.busy, false);
  assert.equal(state.draftRevision, 0);
  assert.equal(state.locale, '');
  assert.deepEqual(state.microphone, {
    loading: false,
    listening: false,
    disabled: true,
    label: '',
  });
  assert.deepEqual(state.attachments, [{ id: '1', name: 'a.txt' }]);
  assert.deepEqual(state.theme, { 'theme-text': 'white' });
  assert.deepEqual(state.labels, {});
  assert.equal(sanitizeAvatarComposerState(undefined).draft, '');
});

test('native-selected files return only basenames and bytes, with at most four inputs read', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'capri-composer-files-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const paths = [];
  for (let index = 0; index < 4; index++) {
    const path = join(directory, `${index}.txt`);
    await writeFile(path, `file-${index}`);
    paths.push(path);
  }
  const files = await readSelectedComposerFiles([...paths, join(directory, 'missing.txt')]);
  assert.equal(files.length, 4);
  for (let index = 0; index < 4; index++) {
    assert.deepEqual(Object.keys(files[index]), ['name', 'bytes']);
    assert.equal(files[index].name, `${index}.txt`);
    assert.ok(files[index].bytes instanceof Uint8Array);
    assert.equal(Buffer.from(files[index].bytes).toString(), `file-${index}`);
  }
  assert.equal((await readSelectedComposerFiles(paths, 2)).length, 2);
  assert.deepEqual(await readSelectedComposerFiles(paths, 0), []);
  const unknown = join(directory, 'unknown.exe');
  await writeFile(unknown, 'ignored');
  assert.deepEqual(await readSelectedComposerFiles([unknown]), [
    { name: 'unknown.exe', bytes: new Uint8Array() },
  ]);
});

test('regular files use 8 MiB limits and videos 32 MiB, and all errors omit selected paths', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'capri-composer-limits-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  async function sparse(name, size) {
    const path = join(directory, name);
    const handle = await open(path, 'w');
    try {
      await handle.truncate(size);
    } finally {
      await handle.close();
    }
    return path;
  }
  const ordinary = await sparse('large.txt', 8 * 1024 * 1024 + 1);
  const video = await sparse('large.mp4', 32 * 1024 * 1024 + 1);
  for (const selected of [
    ordinary,
    video,
    directory,
    join(directory, 'missing.txt'),
    'relative.txt',
    null,
  ]) {
    await assert.rejects(readSelectedComposerFiles([selected]), (error) => {
      assert.equal(error.message, 'Could not read the selected file.');
      assert.equal(error.message.includes(directory), false);
      return true;
    });
  }
  const allowedVideo = await sparse('allowed.webm', 8 * 1024 * 1024 + 1);
  assert.equal(
    (await readSelectedComposerFiles([allowedVideo]))[0].bytes.length,
    8 * 1024 * 1024 + 1,
  );
  for (const maximum of [-1, 5, NaN, 1.5])
    await assert.rejects(
      readSelectedComposerFiles([], maximum),
      /Could not read the selected files/,
    );
  await assert.rejects(readSelectedComposerFiles('path'), /Could not read the selected files/);
});
