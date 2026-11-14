import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScreenCapturePolicy } from '../apps/desktop/screen-capture-policy.mjs';
function fixture() {
  let now = 1000,
    owner = { url: 'capri://desktop/index.html' };
  const calls = [],
    changes = [],
    native = [
      { id: 'window:123:0', name: 'Owned test window' },
      { id: 'screen:0:0', name: 'Owned test monitor' },
    ];
  const policy = new ScreenCapturePolicy({
    sources: async (options) => {
      calls.push(options);
      return native;
    },
    ownerFrame: () => owner,
    onChange: (s) => changes.push(s),
    now: () => now,
  });
  const request = () => ({
    frame: owner,
    securityOrigin: 'capri://desktop',
    videoRequested: true,
    audioRequested: false,
    userGesture: true,
  });
  return {
    policy,
    calls,
    changes,
    native,
    request,
    advance: (ms) => {
      now += ms;
    },
    replaceFrame: () => {
      owner = { url: 'capri://desktop/index.html' };
    },
  };
}

test('refresh retains the explicitly selected live source and an old stop cannot cancel its replacement', async () => {
  const f = fixture();
  const first = await f.policy.discover();
  const again = await f.policy.discover();
  assert.deepEqual(
    again.map((s) => s.id),
    first.map((s) => s.id),
  );
  f.advance(60000);
  const beforeArming = f.calls.length;
  const old = f.policy.prepare(again[1].id, { mode: 'watch' });
  f.policy.release(old.id);
  const current = f.policy.prepare(again[0].id, { mode: 'watch' });
  assert.equal(f.calls.length, beforeArming, 'Arming must not delay the capture gesture');
  assert.equal(f.policy.release(old.id), false);
  assert.equal(f.policy.capture.id, current.id);
  assert.equal(f.policy.capture.nativeId, 'window:123:0');
  f.native.splice(0, 1);
  const remaining = await f.policy.discover();
  assert.equal(remaining.length, 1);
  assert.throws(() => f.policy.prepare(first[0].id), /available/);
  f.policy.clear();
});

test('observation leases stay selected-source bound and expire without granting audio', async () => {
  const f = fixture(),
    [source] = await f.policy.discover();
  const grant = f.policy.prepare(source.id, {
    mode: 'watch',
    durationMs: 300000,
    intervalMs: 15000,
  });
  assert.equal(f.policy.snapshot().active, false);
  assert.equal(f.policy.snapshot().mode, 'watch');
  let selected;
  await f.policy.consume(f.request(), (value) => {
    selected = value.video.id;
  });
  assert.equal(selected, 'window:123:0');
  assert.equal(f.policy.snapshot().active, true);
  f.advance(300001);
  assert.equal(f.policy.snapshot().active, false);
  f.policy.release(grant.id);
  assert.equal(f.policy.snapshot().mode, 'one-shot');
  assert.throws(() => f.policy.prepare(source.id, { mode: 'watch', durationMs: 1 }));
});

test('watching stops when a selected window disappears, without falling back to a monitor', async () => {
  const f = fixture(),
    [source] = await f.policy.discover(),
    grant = f.policy.prepare(source.id, { mode: 'watch' });
  await f.policy.consume(f.request(), () => {});
  f.advance(4001);
  f.native.splice(0, 1);
  assert.equal(await f.policy.checkActive(grant.id), false);
  assert.equal(f.policy.snapshot().active, false);
  assert.equal(f.changes.at(-1).stopReason, 'source-unavailable');
  assert.equal(f.policy.diagnostics().lastStop.reason, 'source-unavailable');
  assert.doesNotMatch(JSON.stringify(f.policy.diagnostics()), /Owned test|window:123/);
  assert.deepEqual(f.calls.at(-1).thumbnailSize, { width: 0, height: 0 });
});
test('source discovery has no screenshots, no capture permission and no persistent native IDs', async () => {
  const f = fixture(),
    list = await f.policy.discover();
  assert.equal(f.policy.snapshot().active, false);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, 'window:123:0');
  assert.equal(Object.hasOwn(list[0], 'nativeId'), false);
  assert.deepEqual(f.calls[0].thumbnailSize, { width: 0, height: 0 });
  assert.equal(f.calls[0].fetchWindowIcons, false);
  assert.equal(f.policy.permits(f.request()), false);
});
test('only one selected source and the exact owner gesture/frame can acquire video, never audio/camera', async () => {
  const f = fixture(),
    [source] = await f.policy.discover(),
    grant = f.policy.prepare(source.id);
  for (const change of [
    { audioRequested: true },
    { videoRequested: false },
    { userGesture: false },
    { securityOrigin: 'https://example.com' },
    { frame: { url: 'capri://desktop/index.html' } },
  ])
    assert.equal(f.policy.permits({ ...f.request(), ...change }), false);
  let answer;
  await f.policy.consume(f.request(), (value) => {
    answer = value;
  });
  assert.equal(answer.video.id, 'window:123:0');
  assert.equal(Object.hasOwn(answer, 'audio'), false);
  assert.equal(f.policy.snapshot().phase, 'capturing');
  let second;
  await f.policy.consume(f.request(), (value) => {
    second = value;
  });
  assert.deepEqual(second, {});
  assert.equal(f.policy.release('stale'), false);
  assert.equal(f.policy.release(grant.id), true);
  assert.equal(f.policy.snapshot().active, false);
  assert.equal(f.changes.at(-1).stopRequested, grant.id);
});
test('closed sources, expiry, frame replacement and revocation fail closed without monitor fallback', async () => {
  const f = fixture();
  let list = await f.policy.discover();
  f.policy.prepare(list[0].id);
  f.native.shift();
  let result;
  await f.policy.consume(f.request(), (value) => {
    result = value;
  });
  assert.deepEqual(result, {});
  assert.equal(f.policy.snapshot().active, false);
  list = await f.policy.discover();
  f.policy.prepare(list[0].id);
  f.advance(10001);
  assert.equal(f.policy.permits(f.request()), false);
  f.policy.clear();
  assert.throws(() => f.policy.prepare(list[0].id));
  const g = fixture();
  list = await g.policy.discover();
  g.policy.prepare(list[0].id);
  const oldRequest = g.request();
  g.replaceFrame();
  assert.equal(g.policy.permits(oldRequest), false);
});
test('a pending source lookup cannot revive a cleared capture grant', async () => {
  const f = fixture(),
    list = await f.policy.discover();
  f.policy.prepare(list[0].id);
  let resolve;
  f.policy.sources = () =>
    new Promise((r) => {
      resolve = r;
    });
  let calls = 0,
    response;
  const task = f.policy.consume(f.request(), (value) => {
    calls++;
    response = value;
  });
  f.policy.clear();
  resolve(f.native);
  await task;
  assert.equal(calls, 1);
  assert.deepEqual(response, {});
  assert.equal(f.policy.snapshot().active, false);
});

function monitorFixture() {
  const f = fixture();
  const displays = [
    { id: 22, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0 },
    { id: 11, bounds: { x: -1080, y: 0, width: 1080, height: 1920 }, scaleFactor: 1, rotation: 90 },
  ];
  f.native[1].display_id = '22';
  f.native.push({ id: 'screen:1:0', display_id: '11', name: 'Owned portrait monitor' });
  f.policy.displays = () => displays;
  f.policy.sources = async (options) => {
    f.calls.push(options);
    const list = f.native.filter((source) => options.types.includes(source.id.split(':')[0]));
    if (!options.thumbnailSize.width) return list;
    return f.sample(list);
  };
  f.sample = (list) =>
    list.map((source) => ({ ...source, thumbnail: thumbnail(+source.display_id) }));
  f.displays = displays;
  f.selectGroup = async () => (await f.policy.discover()).find(({ type }) => type === 'monitors');
  return f;
}

function thumbnail(marker, { width = 640, height = 360, bytes = 33 } = {}) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 640, height: 360 }),
    toPNG: () => {
      const png = Buffer.alloc(bytes);
      png.set([137, 80, 78, 71, 13, 10, 26, 10]);
      png.write('IHDR', 12);
      png.writeUInt32BE(width, 16);
      png.writeUInt32BE(height, 20);
      png[32] = marker;
      return png;
    },
  };
}

test('all monitors is an opaque extra choice and one gesture authorizes its ordered monitor frames', async () => {
  const f = monitorFixture();
  const first = await f.selectGroup();
  assert.deepEqual(first, { id: first.id, type: 'monitors', label: 'All monitors' });
  assert.doesNotMatch(first.id, /screen:/);
  f.native.reverse();
  assert.deepEqual(await f.selectGroup(), first);
  assert(f.calls.every((options) => options.thumbnailSize.width === 0));
  const grant = f.policy.prepare(first.id);
  assert.equal(grant.allMonitors, true);
  assert.equal(f.policy.snapshot().allMonitors, true);
  await assert.rejects(f.policy.monitorFrames(grant.id, f.request().frame), /unavailable/);
  let allowed;
  await f.policy.consume(f.request(), (value) => {
    allowed = value;
  });
  assert.equal(allowed.video.id, 'screen:1:0');
  assert.equal(allowed.audio, undefined);
  await assert.rejects(f.policy.monitorFrames(grant.id, { ...f.request().frame }), /unavailable/);
  await assert.rejects(f.policy.monitorFrames('stale', f.request().frame), /unavailable/);
  const frames = await f.policy.monitorFrames(grant.id, f.request().frame);
  assert.deepEqual(
    frames.map(({ png }) => png[32]),
    [11, 22],
  );
  for (const frame of frames) {
    assert.deepEqual(Object.keys(frame), ['png']);
    assert.equal(frame.png.constructor, Uint8Array);
    assert.equal(frame.png.buffer.byteLength, frame.png.byteLength);
  }
  assert.deepEqual(f.calls.at(-1), {
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 800 },
    fetchWindowIcons: false,
  });
  await assert.rejects(f.policy.monitorFrames(grant.id, f.request().frame), /unavailable/);
  f.policy.release(grant.id);
});

test('ambiguous monitor identities cannot authorize a group, and a changed layout must be reselected', async () => {
  const f = monitorFixture();
  const selected = await f.selectGroup();
  f.displays[1].scaleFactor = 1.25;
  f.policy.prepare(selected.id);
  await f.policy.consume(f.request(), (reply) => assert.deepEqual(reply, {}));
  assert.throws(() => f.policy.prepare(selected.id), /available/);
  const changed = await f.selectGroup();
  assert.notEqual(changed.id, selected.id);
  const grant = f.policy.prepare(changed.id);
  f.displays[1].bounds.y = 10;
  let reply;
  await f.policy.consume(f.request(), (value) => {
    reply = value;
  });
  assert.deepEqual(reply, {});
  assert.equal(f.policy.release(grant.id), false);
  assert.throws(() => f.policy.prepare(changed.id), /available/);
  f.native[2].display_id = f.native[1].display_id;
  assert.equal(await f.selectGroup(), undefined);
  assert.equal((await f.policy.discover()).filter(({ type }) => type === 'monitor').length, 2);
});

test('a reused monitor source ID cannot grant a different display', async () => {
  const f = monitorFixture();
  const selected = (await f.policy.discover()).find(({ type }) => type === 'monitor');
  f.policy.prepare(selected.id, { mode: 'watch' });
  f.native[1].display_id = '99';
  await f.policy.consume(f.request(), (reply) => assert.deepEqual(reply, {}));
  assert.equal(f.policy.snapshot().active, false);
  assert.equal(f.policy.diagnostics().lastStop.reason, 'source-unavailable');
});

test('an in-flight monitor sample cannot survive revocation, expiry, a new frame or a topology change', async (t) => {
  const scenarios = {
    cancelled: (f, id) => f.policy.release(id),
    expired: (f) => f.advance(30001),
    'frame-changed': (f) => f.replaceFrame(),
    'source-unavailable': (f) => f.policy.displayTopologyChanged(),
  };
  for (const [reason, invalidate] of Object.entries(scenarios)) {
    await t.test(reason, async () => {
      const f = monitorFixture();
      const selected = await f.selectGroup();
      const grant = f.policy.prepare(selected.id, { mode: 'watch', durationMs: 30000 });
      await f.policy.consume(f.request(), () => {});
      const entered = Promise.withResolvers();
      const resume = Promise.withResolvers();
      let encodeCalls = 0;
      f.sample = async (list) => {
        entered.resolve();
        await resume.promise;
        return list.map((source) => ({
          ...source,
          thumbnail: {
            isEmpty: () => false,
            getSize: () => ({ width: 640, height: 360 }),
            toPNG: () => encodeCalls++,
          },
        }));
      };
      const result = f.policy.monitorFrames(grant.id, f.request().frame);
      await entered.promise;
      await assert.rejects(f.policy.monitorFrames(grant.id, f.request().frame), /unavailable/);
      invalidate(f, grant.id);
      resume.resolve();
      await assert.rejects(result, /unavailable/);
      assert.equal(encodeCalls, 0);
      assert.equal(f.policy.snapshot().active, false);
      assert.equal(f.policy.diagnostics().lastStop.reason, reason);
      if (reason === 'source-unavailable')
        assert.throws(() => f.policy.prepare(selected.id), /available/);
    });
  }
});

test('a new monitor found during sampling invalidates the entire sample before encoding', async () => {
  const f = monitorFixture();
  const selected = await f.selectGroup();
  const grant = f.policy.prepare(selected.id, { mode: 'watch' });
  await f.policy.consume(f.request(), () => {});
  f.sample = (list) => {
    f.displays[1].id = 99;
    return [list[0], { id: 'screen:1:0', display_id: '99' }];
  };
  await assert.rejects(f.policy.monitorFrames(grant.id, f.request().frame), /unavailable/);
  assert.equal(f.policy.diagnostics().lastStop.reason, 'source-unavailable');
});

test('invalid PNG dimensions or byte sizes cannot be delivered with other monitors', async () => {
  const f = monitorFixture();
  const selected = await f.selectGroup();
  const grant = f.policy.prepare(selected.id, { mode: 'watch' });
  await f.policy.consume(f.request(), () => {});
  for (const options of [{ width: 1281 }, { bytes: 5 * 1024 * 1024 + 1 }]) {
    f.sample = (list) => [
      { ...list[0], thumbnail: thumbnail(22) },
      { ...list[1], thumbnail: thumbnail(11, options) },
    ];
    await assert.rejects(f.policy.monitorFrames(grant.id, f.request().frame), /unavailable/);
    assert.equal(await f.policy.checkActive(grant.id), true);
  }
  f.policy.release(grant.id);
});
