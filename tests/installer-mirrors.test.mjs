// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchArtifact } from '../packages/installer/src/download.mjs';
import { downloadUpdate } from '../packages/updater/src/download.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, '.runtime/installer-mirror-tests');
mkdirSync(fixtures, { recursive: true });
const folder = () => mkdtempSync(path.join(fixtures, 'case-'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const data = Buffer.from('the exact reviewed runtime archive');
const primary = 'https://github.com/electron/electron/releases/download/fixture/runtime.zip';
const mirror = 'https://npmmirror.com/mirrors/electron/fixture/runtime.zip';
const secondMirror = 'https://nodejs.org/fixture/runtime.zip';
const spec = (more = {}) => ({
  url: primary,
  mirrors: [mirror],
  bytes: data.length,
  sha256: digest(data),
  ...more,
});
const response = (value = data, headers = {}) =>
  new Response(value, {
    headers: { 'content-length': String(value.length), ...headers },
  });
const partial = (base, source, index) =>
  path.join(base, digest(data) + '.zip') +
  (index === 0 ? '.part' : '.source-' + digest(new URL(source).href).slice(0, 24) + '.part');
const modes = [false, true];

for (const resumable of modes) {
  const options = (base, more = {}) => ({
    ...(resumable ? { pauseFile: path.join(base, 'pause') } : {}),
    ...more,
  });
  const label = resumable ? 'resumable' : 'one-shot';

  test(`${label}: HTTP 504 immediately switches to the pinned mirror and reports only initial hosts`, async () => {
    const base = folder(),
      calls = [],
      sources = [];
    const file = await fetchArtifact(
      spec(),
      base,
      options(base, {
        onSource: (source) => sources.push(source),
        fetchImpl: async (url, init) => {
          calls.push(url.href);
          assert.equal(init.credentials, 'omit');
          assert.equal(init.redirect, 'manual');
          assert.deepEqual(Object.keys(init.headers).sort(), ['accept-encoding']);
          if (url.href === primary) return new Response(null, { status: 504 });
          if (url.href === mirror)
            return new Response(null, {
              status: 302,
              headers: {
                location: 'https://cdn.npmmirror.com/binaries/runtime.zip?opaque=redirect-only',
              },
            });
          return response();
        },
      }),
    );
    assert.deepEqual(readFileSync(file), data);
    assert.deepEqual(calls, [
      primary,
      mirror,
      'https://cdn.npmmirror.com/binaries/runtime.zip?opaque=redirect-only',
    ]);
    assert.deepEqual(sources, [
      { index: 0, host: 'github.com' },
      { index: 1, host: 'npmmirror.com' },
    ]);
    let requests = 0;
    assert.equal(
      await fetchArtifact(
        spec(),
        base,
        options(base, {
          fetchImpl: async () => {
            requests++;
            throw new Error('cached');
          },
        }),
      ),
      file,
    );
    assert.equal(requests, 0, 'a hash-verified cache must not contact any source');
  });

  test(`${label}: checksum failure on a mirror cannot try a third source`, async () => {
    const base = folder(),
      calls = [];
    await assert.rejects(
      fetchArtifact(
        spec({ mirrors: [mirror, secondMirror] }),
        base,
        options(base, {
          fetchImpl: async (url) => {
            calls.push(url.href);
            return url.href === primary
              ? new Response(null, { status: 504 })
              : response(Buffer.alloc(data.length, 1));
          },
        }),
      ),
      /checksum/,
    );
    assert.deepEqual(calls, [primary, mirror]);
    assert.equal(existsSync(path.join(base, digest(data) + '.zip')), false);
  });

  test(`${label}: permanent HTTP, certificate, size, redirect, and filesystem errors fail closed`, async () => {
    for (const [name, reply, expected] of [
      ['HTTP 403', () => new Response(null, { status: 403 }), /HTTP 403/],
      ['HTTP 404', () => new Response(null, { status: 404 }), /HTTP 404/],
      [
        'TLS',
        () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('certificate'), { code: 'CERT_HAS_EXPIRED' }),
          });
        },
        /fetch failed/,
      ],
      [
        'mixed TLS/network',
        () => {
          throw new AggregateError(
            [
              Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
              Object.assign(new Error('certificate'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
            ],
            'mixed certificate fixture',
          );
        },
        /mixed certificate fixture/,
      ],
      [
        'size',
        () => response(data, { 'content-length': String(data.length + 1) }),
        /pinned manifest/,
      ],
      [
        'redirect',
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://unapproved.invalid/runtime.zip' },
          }),
        /Unapproved/,
      ],
      [
        'filesystem',
        () => {
          throw Object.assign(new Error('fixture write failure'), { code: 'EACCES' });
        },
        /write failure/,
      ],
    ]) {
      const base = folder();
      let requests = 0;
      await assert.rejects(
        fetchArtifact(
          spec(),
          base,
          options(base, {
            fetchImpl: async () => {
              requests++;
              return reply();
            },
          }),
        ),
        expected,
        name,
      );
      assert.equal(requests, 1, name + ' must not switch or retry');
    }
  });

  test(`${label}: transient network failures switch sources without weakening integrity`, async () => {
    for (const code of ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
      const base = folder(),
        calls = [];
      const file = await fetchArtifact(
        spec(),
        base,
        options(base, {
          fetchImpl: async (url) => {
            calls.push(url.href);
            if (url.href === primary)
              throw Object.assign(new TypeError('fetch failed'), {
                cause: Object.assign(new Error('transient fixture'), { code }),
              });
            return response();
          },
        }),
      );
      assert.deepEqual(calls, [primary, mirror], code);
      assert.deepEqual(readFileSync(file), data);
    }
  });

  test(`${label}: cancellation cannot rotate to a mirror`, async () => {
    const base = folder(),
      controller = new AbortController(),
      calls = [];
    await assert.rejects(
      fetchArtifact(
        spec(),
        base,
        options(base, {
          signal: controller.signal,
          fetchImpl: async (url) => {
            calls.push(url.href);
            controller.abort(new Error('fixture user cancellation'));
            throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
          },
        }),
      ),
      /fixture user cancellation/,
    );
    assert.deepEqual(calls, [primary]);
  });

  test(`${label}: a short header timeout falls back, but a slow body is not aborted by it`, async () => {
    const base = folder(),
      calls = [];
    // Keep the event loop alive while the unref'ed production connection timer expires.
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const file = await fetchArtifact(
        spec(),
        base,
        options(base, {
          headersTimeoutMs: 15,
          fetchImpl: async (url, init) => {
            calls.push(url.href);
            if (url.href === primary)
              return new Promise((_, reject) => {
                init.signal.addEventListener('abort', () => reject(init.signal.reason), {
                  once: true,
                });
              });
            return new Response(
              new ReadableStream({
                async start(stream) {
                  await delay(50);
                  assert.equal(
                    init.signal.aborted,
                    false,
                    'the header deadline must be cleared before reading the body',
                  );
                  stream.enqueue(data);
                  stream.close();
                },
              }),
              { headers: { 'content-length': String(data.length) } },
            );
          },
        }),
      );
      assert.deepEqual(calls, [primary, mirror]);
      assert.deepEqual(readFileSync(file), data);
    } finally {
      clearTimeout(keepAlive);
    }
  });
}

test('all mirror URLs and pins are validated before any network or cache access', async () => {
  for (const more of [
    { mirrors: ['https://bad.invalid/runtime.zip'] },
    { mirrors: ['https://user:secret@npmmirror.com/runtime.zip'] },
    { mirrors: ['http://npmmirror.com/runtime.zip'] },
    { mirrors: [primary] },
    { mirrors: 'https://npmmirror.com/runtime.zip' },
    { mirrors: [null] },
    { mirrors: Array(4).fill(mirror) },
  ]) {
    let requests = 0;
    await assert.rejects(
      fetchArtifact(spec(more), folder(), {
        fetchImpl: async () => {
          requests++;
          return response();
        },
      }),
    );
    assert.equal(requests, 0);
  }
});

test('resumable sources have independent partial bytes and ranges', async () => {
  const base = folder(),
    calls = [];
  writeFileSync(partial(base, primary, 0), 'DO NOT APPEND TO MIRROR');
  writeFileSync(partial(base, mirror, 1), data.subarray(0, 7));
  const file = await fetchArtifact(spec(), base, {
    pauseFile: path.join(base, 'pause'),
    fetchImpl: async (url, init) => {
      calls.push({ url: url.href, range: init.headers.Range });
      if (url.href === primary) return new Response(null, { status: 504 });
      return new Response(data.subarray(7), {
        status: 206,
        headers: {
          'content-length': String(data.length - 7),
          'content-range': `bytes 7-${data.length - 1}/${data.length}`,
        },
      });
    },
  });
  assert.deepEqual(calls, [
    { url: primary, range: 'bytes=23-' },
    { url: mirror, range: 'bytes=7-' },
  ]);
  assert.deepEqual(readFileSync(file), data);
  assert.equal(readFileSync(partial(base, primary, 0), 'utf8'), 'DO NOT APPEND TO MIRROR');
});

test('resumable byte range mismatch cannot rotate to another source', async () => {
  const base = folder(),
    calls = [];
  writeFileSync(partial(base, primary, 0), data.subarray(0, 7));
  await assert.rejects(
    fetchArtifact(spec(), base, {
      pauseFile: path.join(base, 'pause'),
      fetchImpl: async (url) => {
        calls.push(url.href);
        return new Response(data.subarray(7), {
          status: 206,
          headers: {
            'content-length': String(data.length - 7),
            'content-range': `bytes 6-${data.length - 1}/${data.length}`,
          },
        });
      },
    }),
    /byte range/,
  );
  assert.deepEqual(calls, [primary]);
});

test('a complete hash-verified mirror partial is promoted without contacting a source', async () => {
  const base = folder();
  writeFileSync(partial(base, mirror, 1), data);
  let requests = 0;
  const file = await fetchArtifact(spec(), base, {
    pauseFile: path.join(base, 'pause'),
    fetchImpl: async () => {
      requests++;
      throw new Error('cache');
    },
  });
  assert.equal(requests, 0);
  assert.deepEqual(readFileSync(file), data);
});

test('an existing mirror partial hardlink is rejected before network access or writes', async () => {
  const base = folder(),
    outside = path.join(base, 'outside');
  writeFileSync(outside, 'outside canary');
  linkSync(outside, partial(base, mirror, 1));
  let requests = 0;
  await assert.rejects(
    fetchArtifact(spec(), base, {
      pauseFile: path.join(base, 'pause'),
      fetchImpl: async () => {
        requests++;
        return response();
      },
    }),
    /filesystem links/,
  );
  assert.equal(requests, 0);
  assert.equal(readFileSync(outside, 'utf8'), 'outside canary');
});

test('pausing keeps the same source and resumes its own range', async () => {
  const base = folder(),
    pauseFile = path.join(base, 'pause'),
    bytes = Buffer.alloc(192 * 1024, 37),
    calls = [];
  let paused = false;
  const file = await fetchArtifact(spec({ bytes: bytes.length, sha256: digest(bytes) }), base, {
    pauseFile,
    progress: () => {
      if (!paused) {
        paused = true;
        writeFileSync(pauseFile, 'pause');
        setTimeout(() => unlinkSync(pauseFile), 30);
      }
    },
    fetchImpl: async (url, init) => {
      const offset = Number(init.headers.Range?.match(/bytes=(\d+)-/)[1] ?? 0);
      calls.push({ url: url.href, offset });
      let cursor = offset;
      return new Response(
        new ReadableStream({
          async pull(stream) {
            await delay(8);
            if (cursor === bytes.length) return stream.close();
            const end = Math.min(bytes.length, cursor + 32768);
            stream.enqueue(bytes.subarray(cursor, end));
            cursor = end;
          },
        }),
        {
          status: offset ? 206 : 200,
          headers: {
            'content-length': String(bytes.length - offset),
            ...(offset
              ? { 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` }
              : {}),
          },
        },
      );
    },
  });
  assert.ok(calls.length >= 2 && calls[1].offset > 0);
  assert.ok(calls.every((call) => call.url === primary));
  assert.deepEqual(readFileSync(file), bytes);
});

test('resumable transient failures are bounded by six total attempts across all sources', async () => {
  const base = folder(),
    calls = [];
  await assert.rejects(
    fetchArtifact(spec({ mirrors: [mirror, secondMirror] }), base, {
      pauseFile: path.join(base, 'pause'),
      fetchImpl: async (url) => {
        calls.push(url.href);
        return new Response(null, { status: 504 });
      },
    }),
    /HTTP 504/,
  );
  assert.deepEqual(calls, [primary, mirror, secondMirror, primary, mirror, secondMirror]);
});

test('legacy authenticated updater resumes its own partial and sends credentials only to the API', async () => {
  const base = folder(),
    offset = 8,
    calls = [],
    token = 'synthetic-test-token';
  writeFileSync(partial(base, primary, 0), data.subarray(0, offset));
  const file = await downloadUpdate({ id: 123, bytes: data.length, sha256: digest(data) }, base, {
    token,
    fetchImpl: async (url, init) => {
      calls.push(url.hostname);
      assert.equal(init.headers.Range, `bytes=${offset}-`);
      if (url.hostname === 'api.github.com') {
        assert.equal(init.headers.authorization, 'Bearer ' + token);
        return new Response(null, {
          status: 302,
          headers: {
            location:
              'https://release-assets.githubusercontent.com/fixture/runtime.zip?opaque=cdn-only',
          },
        });
      }
      assert.equal(init.headers.authorization, undefined);
      return new Response(data.subarray(offset), {
        status: 206,
        headers: {
          'content-length': String(data.length - offset),
          'content-range': `bytes ${offset}-${data.length - 1}/${data.length}`,
        },
      });
    },
  });
  assert.deepEqual(calls, ['api.github.com', 'release-assets.githubusercontent.com']);
  assert.deepEqual(readFileSync(file), data);
  await downloadUpdate({ id: 123, bytes: data.length, sha256: digest(data) }, base, {
    fetchImpl: async () => {
      throw new Error('cache must not fetch');
    },
  });
});
