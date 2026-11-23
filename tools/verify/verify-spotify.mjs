/** Runs through Capri's actual OpenClaw tool; no model or owner chat is required. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { invokeSpotify } from '../../integrations/spotify/cli.mjs';
import { normalizeSpotifyUri, spotifyLinkTitle } from '../../integrations/spotify/service.mjs';

const controls = process.argv.includes('--controls'),
  search = process.argv.includes('--search'),
  playback = process.argv.includes('--playback');
const uriIndex = process.argv.indexOf('--restore-uri');
const restoreUri = uriIndex >= 0 ? normalizeSpotifyUri(process.argv[uriIndex + 1]) : null;
if (playback && !restoreUri)
  throw new Error(
    'Playback verification requires --restore-uri for the current track; it changes the playback context.',
  );
const report = {
  timestamp: new Date().toISOString(),
  checks: [],
  passed: false,
  controls,
  search,
  playback,
};
const record = (name, data) => {
  report.checks.push({ name, ...data });
  console.log('PASS ' + name);
};
const original = await invokeSpotify({ action: 'status' });
assert.equal(original.running, true);
assert.ok(original.title || original.description);
report.original = original;
record('Read actual Spotify media session', { title: original.title });
if (playback)
  assert.equal(
    (await spotifyLinkTitle(restoreUri)).toLowerCase(),
    original.title.toLowerCase(),
    'Restore link must identify the original song',
  );
try {
  if (controls) {
    const level = Math.min(25, original.volumePercent);
    assert.ok(Number.isFinite(level), 'Spotify volume must be readable before testing controls');
    let value = await invokeSpotify({ action: 'volume', value: level });
    assert.equal(value.volumePercent, level);
    value = await invokeSpotify({ action: 'volume', delta: -5 });
    assert.equal(value.volumePercent, Math.max(0, level - 5));
    record('Absolute and relative Spotify-only volume');
    value = await invokeSpotify({ action: 'mute', enabled: true });
    assert.equal(value.muted, true);
    value = await invokeSpotify({ action: 'mute', enabled: false });
    assert.equal(value.muted, false);
    record('Mute and unmute');
    value = await invokeSpotify({ action: 'resume' });
    assert.equal(value.playing, true);
    value = await invokeSpotify({ action: 'pause' });
    assert.equal(value.playing, false);
    record('Resume and pause');
    if (original.canSeek) {
      value = await invokeSpotify({ action: 'seek', seconds: 20 });
      assert.ok(Math.abs(value.positionMs - 20000) < 2000);
      record('Seek to a verified position');
    }
    if (typeof original.shuffle === 'boolean') {
      value = await invokeSpotify({ action: 'shuffle', enabled: !original.shuffle });
      assert.equal(value.shuffle, !original.shuffle);
      record('Shuffle');
    }
    value = await invokeSpotify({ action: 'repeat', mode: 'track' });
    assert.equal(value.repeat, 'track');
    record('Repeat one track');
  }
  if (search || playback) {
    const results = await invokeSpotify({
      action: 'search',
      query: 'I Really Want to Stay at Your House Rosa Walton',
      type: 'track',
    });
    assert.ok(results.results.length > 0);
    assert.ok(results.results.every((item) => item.type === 'track'));
    assert.match(results.results[0].detail, /Rosa Walton/i);
    assert.ok(!results.results.some((item) => /1 HOUR|Season 2 Soundtrack/i.test(item.label)));
    record('Search returns songs with artist/version metadata', {
      results: results.results.length,
      first: results.results[0],
    });
    report.searchResults = results.results;
    if (playback) {
      let state = await invokeSpotify({ action: 'play', resultId: results.results[0].resultId });
      assert.equal(state.title, 'I Really Want to Stay at Your House');
      assert.match(state.artist, /Rosa Walton/);
      assert.equal(state.playing, true);
      record('Play the selected song and verify title, artist and playback');
      await invokeSpotify({ action: 'seek', seconds: 20 });
      state = await invokeSpotify({
        action: 'play',
        query: 'I Really Want to Stay at Your House Rosa Walton',
        type: 'track',
      });
      assert.equal(state.title, 'I Really Want to Stay at Your House');
      assert.match(state.artist, /Rosa Walton/);
      assert.ok(state.positionMs >= 19000);
      record('Repeating the current song request preserves its version and position');
      state = await invokeSpotify({ action: 'play', uri: restoreUri });
      assert.equal(state.title, original.title);
      assert.equal(state.playing, true);
      record('Play an exact Spotify track link');
      const added = await invokeSpotify({
        action: 'queue_add',
        resultId: results.results[0].resultId,
      });
      assert.equal(added.queued, true);
      const queue = await invokeSpotify({ action: 'queue' });
      assert.ok(queue.items.some((item) => /Stay at Your House.*Rosa Walton/i.test(item)));
      record('Add to queue and read the real queue');
      await invokeSpotify({ action: 'seek', seconds: 20 });
      state = await invokeSpotify({ action: 'next' });
      assert.equal(state.title, 'I Really Want to Stay at Your House');
      record('Next plays the queued track');
      state = await invokeSpotify({ action: 'previous' });
      assert.equal(state.title, original.title);
      record('Previous returns to the prior song');
      const library = await invokeSpotify({ action: 'library' });
      assert.ok(library.items.length > 0);
      record('Read the visible library');
    }
  }
  report.passed = true;
} finally {
  if (controls || playback) {
    const restoreErrors = [];
    const restore = async (command) => {
      try {
        await invokeSpotify(command);
      } catch (error) {
        restoreErrors.push(error.message);
      }
    };
    if (playback && (await invokeSpotify({ action: 'status' })).title !== original.title)
      await restore({ action: 'play', uri: restoreUri });
    await restore({ action: 'pause' });
    if (original.canSeek && Number.isFinite(original.positionMs))
      await restore({ action: 'seek', seconds: original.positionMs / 1000 });
    if (typeof original.shuffle === 'boolean')
      await restore({ action: 'shuffle', enabled: original.shuffle });
    const mode = { none: 'off', list: 'context', track: 'track' }[original.repeat];
    if (mode) await restore({ action: 'repeat', mode });
    await restore({ action: 'volume', value: original.volumePercent });
    await restore({ action: 'mute', enabled: original.muted });
    if (original.playing) await restore({ action: 'resume' });
    report.restoreErrors = restoreErrors;
    report.restored = await invokeSpotify({ action: 'status' });
    if (restoreErrors.length) {
      report.passed = false;
      console.error('Restore:', restoreErrors);
      process.exitCode = 1;
    }
  }
  writeFileSync(path.join(root, 'logs/spotify-verification.json'), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks.map((c) => c.name),
    restored: (controls || playback) && !report.restoreErrors.length,
  }),
);
