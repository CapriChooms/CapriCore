#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../src/engine.mjs';
import { readJson } from '../src/policy.mjs';
const sourceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2),
  value = (key) => {
    const at = args.indexOf(key);
    return at < 0 ? null : args[at + 1];
  };
const requestFile = value('--request'),
  cancelFile = value('--cancel'),
  pauseFile = value('--pause'),
  eventsFile = value('--events');
if (!requestFile || !path.isAbsolute(requestFile))
  throw new Error('An absolute installation request file is required');
const controller = new AbortController();
const emit = (event) => {
  const record = { ...event, timestamp: new Date().toISOString() };
  const line = JSON.stringify(record) + '\n';
  if (eventsFile) appendFileSync(eventsFile, line, 'utf8');
  else process.stdout.write(line);
};
const timer = setInterval(() => {
  if (cancelFile && existsSync(cancelFile)) controller.abort(new Error('Installation cancelled'));
}, 200);
try {
  await install(readJson(requestFile), {
    sourceRoot,
    nodeExecutable: process.execPath,
    signal: controller.signal,
    pauseFile,
    emit,
  });
} catch (error) {
  process.exitCode = controller.signal.aborted ? 2 : 1;
  emit({ type: 'error', code: error.code, message: error.message.slice(0, 2500) });
} finally {
  clearInterval(timer);
}
