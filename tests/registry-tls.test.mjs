// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import {
  classicalRegistryTls,
  saveClassicalRegistryTls,
  registryNetworkFile,
  ollamaNetworkEnvironment,
  probeClassicalRegistryTls,
} from '../packages/runtime/src/host/registry-network.mjs';
import { recoverRegistryTls } from '../packages/runtime/src/providers/registry-tls-recovery.mjs';
import { pullModel } from '../packages/runtime/src/providers/pull-model.mjs';

const parent = path.join(root, '.runtime/registry-tls-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'fixture-'));
const rt = { ollamaUrl: 'http://127.0.0.1:11434' };
test('verified compatibility is private to managed Ollama and preserves unrelated Go settings', () => {
  const data = folder(),
    env = { GODEBUG: 'http2client=0,tlsmlkem=1,gctrace=0', PATH: 'fixture' };
  assert.equal(ollamaNetworkEnvironment(env, data), env);
  saveClassicalRegistryTls(data);
  assert.equal(classicalRegistryTls(data), true);
  assert.deepEqual(ollamaNetworkEnvironment(env, data), {
    ...env,
    GODEBUG: 'http2client=0,gctrace=0,tlsmlkem=0',
  });
  assert.equal(env.GODEBUG, 'http2client=0,tlsmlkem=1,gctrace=0');
  writeFileSync(registryNetworkFile(data), 'broken');
  assert.equal(classicalRegistryTls(data), false);
});
test('registry probe retains certificate validation and TLS 1.3; a bad certificate never passes', async () => {
  const requestImpl = (url, options, response) => {
    assert.equal(url, 'https://registry.ollama.ai/v2/');
    assert.equal(options.method, 'HEAD');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.minVersion, 'TLSv1.2');
    assert.equal(options.maxVersion, undefined);
    assert.equal(options.ecdhCurve, 'X25519:P-256:P-384');
    const req = new EventEmitter();
    req.end = () =>
      queueMicrotask(() =>
        response({ statusCode: 200, socket: { getProtocol: () => 'TLSv1.3' }, resume() {} }),
      );
    return req;
  };
  assert.equal(await probeClassicalRegistryTls({ requestImpl }), true);
  assert.equal(
    await probeClassicalRegistryTls({
      requestImpl: () => {
        const req = new EventEmitter();
        req.end = () =>
          queueMicrotask(() =>
            req.emit(
              'error',
              Object.assign(new Error('bad certificate'), { code: 'CERT_HAS_EXPIRED' }),
            ),
          );
        return req;
      },
    }),
    false,
  );
});
function recoveryFixture(overrides = {}) {
  const events = [],
    dataDir = folder();
  const options = {
    dataDir,
    emit: () => {},
    owned: () => true,
    inventory: async () => ({ models: [] }),
    probe: async () => {
      events.push('probe');
      return true;
    },
    stop: async () => events.push('stop'),
    start: async () => {
      assert.equal(classicalRegistryTls(dataDir), true);
      events.push('start');
    },
    ...overrides,
  };
  return { options, events, dataDir };
}
test('compatibility restarts only an idle owned server after a successful verified probe', async () => {
  const f = recoveryFixture();
  assert.equal(await recoverRegistryTls(rt, f.options), true);
  assert.deepEqual(f.events, ['probe', 'stop', 'start']);
  assert.equal(await recoverRegistryTls(rt, f.options), false);
  assert.deepEqual(f.events, ['probe', 'stop', 'start']);
});
test('unowned, active, newly active and unreachable servers are never stopped', async () => {
  for (const overrides of [
    { owned: () => false },
    { inventory: async () => ({ models: [{ name: 'active' }] }) },
    { probe: async () => false },
  ]) {
    const f = recoveryFixture(overrides);
    assert.equal(await recoverRegistryTls(rt, f.options), false);
    assert.equal(f.events.includes('stop'), false);
    assert.equal(existsSync(registryNetworkFile(f.dataDir)), false);
  }
  let inspections = 0;
  const f = recoveryFixture({
    inventory: async () => ({ models: ++inspections === 1 ? [] : [{ name: 'arrived' }] }),
  });
  assert.equal(await recoverRegistryTls(rt, f.options), false);
  assert.deepEqual(f.events, ['probe']);
});
test('cancellation after the compatibility probe saves no flag and stops no service', async () => {
  const controller = new AbortController();
  const f = recoveryFixture({
    signal: controller.signal,
    probe: async () => {
      controller.abort(new Error('user cancel'));
      return true;
    },
  });
  await assert.rejects(recoverRegistryTls(rt, f.options), /user cancel/);
  assert.equal(existsSync(registryNetworkFile(f.dataDir)), false);
  assert.deepEqual(f.events, []);
});
test('TLS pull fallback happens once after closing the old request, then reuses the verified pull API', async () => {
  let requests = 0,
    recoveries = 0,
    cancelled = false;
  await pullModel(rt, 'fixture', {
    emit: () => {},
    sleep: async () => assert.fail('successful compatibility retry needs no backoff'),
    recoverTls: async () => {
      assert.equal(cancelled, true);
      recoveries++;
      return true;
    },
    fetchImpl: async () =>
      ++requests === 1
        ? new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(
                  new TextEncoder().encode('{"error":"net/http: TLS handshake timeout"}\n'),
                );
              },
              cancel() {
                cancelled = true;
              },
            }),
          )
        : new Response('{"status":"success"}'),
  });
  assert.equal(requests, 2);
  assert.equal(recoveries, 1);
});
test('failed TLS recovery is bounded and certificate failures never trigger it', async () => {
  let recoveries = 0,
    requests = 0;
  await assert.rejects(
    pullModel(rt, 'fixture', {
      emit: () => {},
      sleep: async () => {},
      recoverTls: async () => {
        recoveries++;
        return false;
      },
      fetchImpl: async () => {
        requests++;
        return new Response('{"error":"TLS handshake timeout"}');
      },
    }),
    /TLS handshake timeout/,
  );
  assert.equal(requests, 4);
  assert.equal(recoveries, 1);
  recoveries = 0;
  await assert.rejects(
    pullModel(rt, 'fixture', {
      recoverTls: async () => recoveries++,
      fetchImpl: async () => new Response('{"error":"tls: failed to verify certificate"}'),
    }),
    /certificate/,
  );
  assert.equal(recoveries, 0);
});
