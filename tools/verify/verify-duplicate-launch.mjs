// SPDX-License-Identifier: GPL-3.0-only
// Two actual Electron processes, isolated owner files and a synthetic encrypted
// API profile. No real provider, device capture or installed Capri data is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root = process.cwd();
const parent = path.join(root, '.runtime/duplicate-launch-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const report = { passed: false, checks: [], realApiRequests: 0, deviceCapture: false };
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const executablePath = createRequire(import.meta.url)('electron');
const args = [path.join(root, 'apps/desktop/main.mjs'), '--verification'];
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application, independent;
try {
  application = await _electron.launch({ executablePath, args, env, timeout: 60000 });
  const owner = await application.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const ownerPid = await application.evaluate(() => process.pid);
  await application.evaluate(({ safeStorage }, folder) => {
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    const { randomUUID } = process.getBuiltinModule('crypto');
    const configPath = path.join(folder, 'openclaw/openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.agents.defaults.model = { primary: 'capri-api/fixture/provider-model', fallbacks: [] };
    config.agents.defaults.imageModel = 'capri-api/fixture/provider-model';
    config.models.providers['capri-api'] = {
      baseUrl: 'http://127.0.0.1:19765/v1',
      api: 'openai-completions',
      apiKey: '${CAPRI_REMOTE_PROXY_TOKEN}',
      models: [
        { id: 'fixture/provider-model', input: ['text'], contextWindow: 32768, maxTokens: 2048 },
      ],
    };
    fs.writeFileSync(configPath, JSON.stringify(config));
    const profileId = randomUUID();
    const settings = {
      enabled: true,
      setupRequired: false,
      baseUrl: 'https://example.invalid/v1',
      model: 'fixture/provider-model',
      contextTokens: 32768,
      vision: false,
      tools: false,
    };
    const ciphertext = safeStorage
      .encryptString('fixture-value-not-a-provider-key')
      .toString('base64');
    fs.mkdirSync(path.join(folder, 'data/desktop'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'data/secrets'), { recursive: true });
    fs.writeFileSync(
      path.join(folder, 'data/desktop/inference-api.json'),
      JSON.stringify({ ...settings, profileId }),
    );
    fs.writeFileSync(
      path.join(folder, 'data/secrets/inference-api-profiles.json'),
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            id: profileId,
            name: 'Synthetic profile',
            settings,
            credential: { origin: 'https://example.invalid', ciphertext },
          },
        ],
      }),
    );
  }, folder);
  const names = [
    'openclaw/openclaw.json',
    'openclaw/gateway-token',
    'workspace/USER.md',
    'workspace/MEMORY.md',
    'data/desktop/inference-api.json',
    'data/secrets/inference-api-profiles.json',
  ];
  const snapshot = () =>
    Object.fromEntries(
      names.map((name) => {
        const file = path.join(folder, name),
          bytes = readFileSync(file);
        return [
          name,
          { hash: createHash('sha256').update(bytes).digest('hex'), mtime: statSync(file).mtimeMs },
        ];
      }),
    );
  const before = snapshot();
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(executablePath, args, {
        cwd: root,
        env,
        windowsHide: true,
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('Duplicate did not exit promptly.'));
      }, 15000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.equal(outcome.code, 0, 'A duplicate exits normally without starting another owner.');
    const after = snapshot();
    const changed = names.filter(
      (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
    );
    assert.deepEqual(changed, [], 'Duplicate launch changed owner files: ' + changed.join(', '));
    assert.equal(await application.evaluate(() => process.pid), ownerPid);
    assert.equal(
      application.windows().filter((page) => page.url() === 'capri://desktop/index.html').length,
      1,
    );
    report.checks.push(
      `Duplicate ${attempt + 1}: exit 0; API route, encrypted profile, token and memory bytes/mtimes untouched; original window retained`,
    );
  }
  const gateway = JSON.parse(readFileSync(path.join(folder, names[0]), 'utf8'));
  assert.equal(gateway.agents.defaults.model.primary, 'capri-api/fixture/provider-model');
  assert.equal(gateway.models.providers['capri-api'].apiKey, '${CAPRI_REMOTE_PROXY_TOKEN}');
  const blob = readFileSync(path.join(folder, names.at(-1)), 'utf8');
  assert(!blob.includes('fixture-value-not-a-provider-key'));
  report.checks.push(
    'Synthetic API credential remains encrypted and gateway contains only a local proxy-token placeholder',
  );
  const independentFolder = path.join(folder, 'independent-owner');
  independent = await _electron.launch({
    executablePath,
    args,
    env: { ...env, CAPRI_DESKTOP_VERIFICATION_DIR: independentFolder },
    timeout: 60000,
  });
  const independentWindow = await independent.firstWindow();
  await independentWindow.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  assert.notEqual(await independent.evaluate(() => process.pid), ownerPid);
  assert.deepEqual(snapshot(), before);
  report.checks.push('A different installation/profile obtains its own independent singleton lock');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await independent?.close();
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(folder, 'report.json'));
}
console.log(JSON.stringify(report));
