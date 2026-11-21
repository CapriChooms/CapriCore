#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { applyUpdate } from '../src/transaction.mjs';
import { noLinks } from '../../installer/src/policy.mjs';
const file = process.argv[2];
if (!file || !path.isAbsolute(file)) throw new Error('An absolute update request is required');
const request = JSON.parse(readFileSync(file, 'utf8'));
if (request.schemaVersion !== 1 || !Number.isInteger(request.parentPid) || request.parentPid <= 0)
  throw new Error('Invalid update request');
if (typeof request.root !== 'string' || !path.isAbsolute(request.root))
  throw new Error('An absolute installation folder is required');
const allowed = path.join(path.resolve(request.root), '.runtime/updates') + path.sep;
for (const value of [file, request.source, request.events, request.proceed, request.cancel])
  if (typeof value !== 'string' || !path.resolve(value).startsWith(allowed))
    throw new Error('Update job must stay inside the installation cache');
noLinks(request.events);
const emit = (event) => {
  try {
    appendFileSync(
      request.events,
      JSON.stringify({ ...event, at: new Date().toISOString() }) + '\n',
      'utf8',
    );
  } catch {
    // Logging must not interrupt an install or its rollback.
  }
};
let stage = 'waiting';
try {
  emit({ phase: 'waiting' });
  let stopped = false;
  for (let i = 0; i < 900; i++) {
    if (existsSync(request.cancel))
      throw new Error('The update was cancelled before installation.');
    if (existsSync(request.proceed)) {
      try {
        process.kill(request.parentPid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          stopped = true;
          break;
        }
        throw error;
      }
    }
    await delay(200);
  }
  if (!stopped) throw new Error('Capri did not close in time. The installation was not changed.');
  stage = 'update-prepare';
  await applyUpdate(request, { emit });
} catch (error) {
  emit({
    phase: 'failed',
    stage,
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    message: error.message.slice(0, 1200),
  });
  process.exitCode = 1;
}
