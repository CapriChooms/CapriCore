import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreFailureStream, ToolProgressGuard } from '../apps/desktop/tool-loop.mjs';

test('ordinary words and OpenClaw explanations stream immediately, and a new-line diagnostic is held', () => {
  const normal = new CoreFailureStream();
  assert.equal(normal.push('Hello!'), 'Hello!');
  assert.equal(normal.push('\nOpenClaw is the local core.'), '\nOpenClaw is the local core.');
  const partial = new CoreFailureStream();
  assert.equal(partial.push('Open'), '');
  assert.equal(partial.push('', true), 'Open');
  const failure = new CoreFailureStream();
  assert.equal(failure.push('A useful partial reply.\n'), 'A useful partial reply.\n');
  assert.equal(failure.push('OpenClaw stopped this '), '');
  assert.throws(() => failure.push('run'), { code: 'CAPRI_TOOL_LOOP' });
});

test('unchanged discovery is bounded but real progress, changed results and a fresh turn reset the budget', () => {
  const guard = new ToolProgressGuard();
  const read = (apps = []) =>
    guard.record('desktop_control', { action: 'apps' }, { ok: true, apps });
  read();
  read();
  guard.record('desktop_control', { action: 'launch' }, { ok: true });
  read();
  read();
  read([{ name: 'New app' }]);
  assert.throws(() => read(), { code: 'CAPRI_TOOL_LOOP' });
  assert.doesNotThrow(() =>
    new ToolProgressGuard().record('desktop_control', { action: 'apps' }, { ok: true, apps: [] }),
  );
});

test('generated Spotify tool syntax never leaks through text, even in one-character deltas', () => {
  for (const text of [
    '[spotify_control{action:play}]',
    '**[spotify_control{action:play}]**',
    'spotify_control(action=play)',
  ]) {
    const stream = new CoreFailureStream();
    let visible = '';
    assert.throws(
      () => {
        for (const char of text) visible += stream.push(char);
      },
      { code: 'CAPRI_TOOL_ENCODING' },
    );
    assert.equal(visible, '');
  }
  assert.equal(new CoreFailureStream().push('Spotify is ready.'), 'Spotify is ready.');
});
