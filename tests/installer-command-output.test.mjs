// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../packages/installer/src/commands.mjs';

const pause = `const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));`;
const run = async (script, options = {}) => {
  const lines = [];
  await runCommand(process.execPath, ['--input-type=module', '-e', pause + script], {
    timeoutMs: 10000,
    output: (line) => lines.push(line),
    ...options,
  });
  return lines;
};

test('installer output preserves UTF-8 characters split across pipe chunks', async () => {
  const lines = await run(`
    const text = Buffer.from('Prêt · Готово · 準備完了');
    for (const byte of text) {
      process.stdout.write(Buffer.from([byte]));
      await pause(8);
    }
    process.stdout.write('\\n');
  `);
  assert.deepEqual(lines, ['Prêt · Готово · 準備完了']);
});

test('installer output keeps unfinished stdout and stderr lines independent', async () => {
  const lines = await run(`
    process.stdout.write('Checking ');
    await pause(30);
    process.stderr.write('A separate warning\\n');
    await pause(30);
    process.stdout.write('complete\\n');
  `);
  assert.deepEqual(lines, ['A separate warning', 'Checking complete']);
});

test('installer output delivers the last status without a trailing newline', async () => {
  assert.deepEqual(await run(`process.stdout.write('Verified component ready');`), [
    'Verified component ready',
  ]);
});

test('installer output reports carriage-return progress as individual updates', async () => {
  assert.deepEqual(await run(`process.stdout.write('10%\\r20%\\r30%\\r\\n');`), [
    '10%',
    '20%',
    '30%',
  ]);
});

test('installer output strips terminal formatting split across chunks', async () => {
  const lines = await run(`
    process.stderr.write('\\x1b[');
    await pause(30);
    process.stderr.write('31mDetailed failure\\x1b[0m\\n');
  `);
  assert.deepEqual(lines, ['Detailed failure']);
});

test('installer failure preserves the exit code and final unformatted diagnostic', async () => {
  const lines = [];
  await assert.rejects(
    run(`process.stderr.write('\\x1b[31mVerification failed\\x1b[0m'); process.exitCode=7;`, {
      output: (line) => lines.push(line),
    }),
    (error) =>
      error.exitCode === 7 &&
      error.outputTail === 'Verification failed' &&
      error.message === 'Component exited 7. Verification failed',
  );
  assert.deepEqual(lines, ['Verification failed']);
});

test('installer output keeps diagnostic lines and failure tails bounded', async () => {
  const lines = [];
  await assert.rejects(
    run(`process.stderr.write('x'.repeat(100000)); process.exitCode=1;`, {
      output: (line) => lines.push(line),
    }),
    (error) => error.exitCode === 1 && error.outputTail.length <= 6000,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 1000);
});

test(
  'native Windows PowerShell UTF-8 output keeps final status and warning pipes readable',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const lines = [];
    await runCommand(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); [Console]::Out.Write('Prêt · Готово · 準備完了'); [Console]::Error.Write('Предупреждение');",
      ],
      { output: (line) => lines.push(line), timeoutMs: 10000 },
    );
    assert.deepEqual(lines.sort(), ['Prêt · Готово · 準備完了', 'Предупреждение'].sort());
  },
);
