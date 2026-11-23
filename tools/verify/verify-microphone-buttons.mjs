// SPDX-License-Identifier: GPL-3.0-only
// Real CPU recognizer and renderer buttons; silent synthetic input, no physical microphone.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/microphone-buttons-verification');
mkdirSync(parent, { recursive: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const errors = [],
  checks = [];
let app;
try {
  for (const wakeEnabled of [true, false]) {
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const rt = runtime({
      stateDir: path.join(folder, 'openclaw'),
      workspace: path.join(folder, 'workspace'),
      gatewayPort: port,
    });
    initialize(rt);
    mkdirSync(path.join(folder, 'desktop'), { recursive: true });
    writeFileSync(
      path.join(folder, 'desktop/languages.json'),
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          interface: 'en',
          conversation: 'en',
          recognition: 'en',
          speech: 'off',
          autoDetect: false,
        },
      }),
    );
    const silence = Buffer.alloc(44 + 16000 * 2 * 30);
    silence.write('RIFF');
    silence.writeUInt32LE(silence.length - 8, 4);
    silence.write('WAVEfmt ', 8);
    silence.writeUInt32LE(16, 16);
    silence.writeUInt16LE(1, 20);
    silence.writeUInt16LE(1, 22);
    silence.writeUInt32LE(16000, 24);
    silence.writeUInt32LE(32000, 28);
    silence.writeUInt16LE(2, 32);
    silence.writeUInt16LE(16, 34);
    silence.write('data', 36);
    silence.writeUInt32LE(silence.length - 44, 40);
    const audio = path.join(folder, 'silence.wav');
    writeFileSync(audio, silence);
    const env = {
      ...environment(rt),
      CAPRI_DESKTOP_VERIFICATION_DIR: folder,
      CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
      CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
      CAPRI_DESKTOP_VERIFICATION_ASR: '1',
      CAPRI_DESKTOP_VERIFICATION_WAKE: wakeEnabled ? '1' : '0',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      env,
      args: [
        path.join(root, 'apps/desktop/main.mjs'),
        '--verification',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${audio}`,
      ],
    });
    const pid = await app.evaluate(() => process.pid);
    const workers = () =>
      JSON.parse(
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} -and $_.CommandLine -match 'integrations[.]asr_runtime[.]worker' } | Select-Object -ExpandProperty ProcessId)`,
          ],
          { windowsHide: true, encoding: 'utf8' },
        ),
      );
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => document.body.dataset.phase === 'ready');
    assert.deepEqual(workers(), []);
    const lower = page.locator('#input-microphone'),
      upper = page.locator('#microphone-toggle');
    await lower.click({ force: true });
    await page.waitForFunction(() => document.body.dataset.commandListening === 'true', null, {
      timeout: 60000,
    });
    const loaded = workers();
    assert.equal(loaded.length, 1);
    const first = (await page.evaluate(() => window.capri.bootstrap())).microphone;
    await lower.click({ force: true });
    await page.waitForFunction(() => document.body.dataset.commandListening !== 'true');
    assert.deepEqual(workers(), loaded, 'Composer stop must retain the same recognizer process');
    assert.equal(await upper.getAttribute('aria-pressed'), 'true');
    const paused = (await page.evaluate(() => window.capri.bootstrap())).microphone;
    assert.equal(paused.modelLoaded, true);
    assert.equal(paused.enabled, wakeEnabled);
    if (wakeEnabled) assert.equal(paused.sessionId, first.sessionId);
    await lower.click({ force: true });
    await page.waitForFunction(() => document.body.dataset.commandListening === 'true');
    assert.deepEqual(workers(), loaded, 'Composer restart must reuse ASR');
    // In continuous mode also test unloading after the lower button stopped capture.
    if (!wakeEnabled) {
      await lower.click({ force: true });
      await page.waitForFunction(() => document.body.dataset.commandListening !== 'true');
    }
    await upper.click({ force: true });
    await page.waitForFunction(
      () => document.querySelector('#microphone-toggle').getAttribute('aria-pressed') === 'false',
    );
    for (let i = 0; i < 20 && workers().length; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(workers(), [], 'Header stop must unload the recognizer');
    assert.equal(
      (await page.evaluate(() => window.capri.bootstrap())).microphone.modelLoaded,
      false,
    );
    checks.push(
      wakeEnabled
        ? 'wake-gated composer keeps ASR; header unloads'
        : 'continuous composer keeps ASR; header unloads idle ASR',
    );
    await app.close();
    app = null;
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, physicalMicrophone: false }));
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
