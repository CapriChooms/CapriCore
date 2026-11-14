// SPDX-License-Identifier: GPL-3.0-only
// Real Ollama models, real files, Node tests and the installed Notepad++ CLI.
import { CodingService } from '../../apps/desktop/coding-service.mjs';
import { CodingAgent } from '../../apps/desktop/coding-agent.mjs';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.cwd(),
  reports = path.join(root, '.runtime/overnight-coding-models');
mkdirSync(reports, { recursive: true });
const folder = mkdtempSync(path.join(reports, 'run-'));
const projects = path.join(path.parse(root).root, 'CapriCodingChecks');
mkdirSync(projects, { recursive: true });
const testSource = `const{test}=require('node:test');const assert=require('node:assert/strict');const{clamp}=require('./math.cjs');test('inside',()=>assert.equal(clamp(5,1,10),5));test('low',()=>assert.equal(clamp(-3,0,10),0));test('high',()=>assert.equal(clamp(20,0,10),10));test('invalid',()=>assert.throws(()=>clamp(5,10,1),RangeError));`;
const hash = (value) => createHash('sha256').update(value).digest('hex'),
  report = { cases: [] };
for (const model of ['gemma4:e2b', 'qwen3.5:9b']) {
  const workspace = mkdtempSync(
    path.join(projects, model.startsWith('gemma') ? 'small-' : 'large-'),
  );
  writeFileSync(
    path.join(workspace, 'math.cjs'),
    "module.exports.clamp = function(value, min, max) { throw new Error('TODO'); };\n",
  );
  writeFileSync(path.join(workspace, 'math.test.cjs'), testSource);
  const state = path.join(folder, model.replace(/[^a-z0-9]/g, '_'));
  mkdirSync(state);
  const service = new CodingService({ root: state });
  service.save({
    workspace,
    editor: { kind: 'notepad++', executable: 'C:\\Program Files\\Notepad++\\notepad++.exe' },
    tasks: [{ id: 'Unit tests', executable: process.execPath, args: ['--test', 'math.test.cjs'] }],
  });
  const started = performance.now(),
    row = { model, workspace, passed: false, actions: [] };
  report.cases.push(row);
  const agent = new CodingAgent({
    service,
    url: 'http://127.0.0.1:11435',
    model,
    params: { num_ctx: 8192, num_thread: 8 },
    observe: ({ action, error }) => {
      if (error) {
        row.failures ??= [];
        row.failures.push({
          action: action.action,
          path: action.path,
          keys: Object.keys(action),
          message: error.message,
        });
      }
    },
    emit: (value) => {
      if (value.phase !== 'planning') {
        row.actions.push(value.phase);
        console.log(model + ' · ' + value.step + ' · ' + value.phase);
      }
    },
  });
  try {
    const result = await agent.run(
      'Fix clamp(value,min,max) in math.cjs: keep an in-range number, return min below range, max above range, throw RangeError if min > max. Read math.cjs and math.test.cjs first. Do not change math.test.cjs. Run the approved Unit tests task, fix any failures, then open math.cjs at line 1 in the selected editor. Complete all requested steps. Keep the final summary short.',
      { signal: AbortSignal.timeout(600000) },
    );
    assert.equal(
      hash(readFileSync(path.join(workspace, 'math.test.cjs'))),
      hash(testSource),
      'The model must not change tests to make them pass.',
    );
    const tested = await service.task('Unit tests');
    assert.equal(tested.exitCode, 0);
    assert.equal(result.verified, true);
    assert.ok(row.actions.includes('open'));
    row.passed = true;
    row.steps = result.steps;
  } catch (error) {
    row.error = String(error.code ?? error.name);
    row.detail = error.message.slice(0, 220);
  } finally {
    row.elapsedMs = Math.round(performance.now() - started);
    writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
    await fetch('http://127.0.0.1:11435/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0, stream: false }),
    }).catch(() => {});
  }
  console.log(model + ' · ' + (row.passed ? 'PASSED' : 'FAILED'));
}
console.log('Report: ' + path.join(folder, 'report.json'));
process.exitCode = report.cases.every((row) => row.passed) ? 0 : 1;
