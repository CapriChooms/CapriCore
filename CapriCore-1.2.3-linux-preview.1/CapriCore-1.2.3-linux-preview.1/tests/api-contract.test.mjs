import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, initialize, settings, chat } from '../packages/runtime/src/index.mjs';

const tempRoot = path.join(root, '.runtime/test-data');
mkdirSync(tempRoot, { recursive: true });

async function fakeGateway(t, respond) {
  const folder = mkdtempSync(path.join(tempRoot, 'api-'));
  const rt = runtime({ stateDir: folder, workspace: path.join(folder, 'workspace') });
  writeFileSync(rt.tokenPath, 'test-token-only\n');
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    respond(req, text ? JSON.parse(text) : null, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  rt.gatewayUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return rt;
}

test('desktop and Telegram ingress target the same explicit agent/session without replaying history', async (t) => {
  const seen = [];
  const rt = await fakeGateway(t, (req, body, res) => {
    seen.push({ headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  mkdirSync(rt.workspace, { recursive: true });
  const persona = path.join(rt.workspace, 'PERSONALITY.md');
  writeFileSync(persona, 'Capri test persona: curious and playful.\n');
  await chat('First turn', { rt, channel: 'webchat' });
  writeFileSync(persona, 'Capri updated persona: curious, playful and observant.\n');
  await chat('Second turn', { rt, channel: 'telegram' });
  assert.equal(seen.length, 2);
  for (const item of seen) {
    assert.equal(item.headers.authorization, 'Bearer test-token-only');
    assert.equal(item.headers['x-openclaw-session-key'], settings.sessionKey);
    assert.equal(item.body.model, 'openclaw/capri');
    assert.equal(item.body.messages.length, 2);
    assert.equal(item.body.messages[0].role, 'system');
    assert.equal(item.body.messages[1].role, 'user');
  }
  assert.ok(
    seen[0].body.messages[0].content.startsWith(
      'CAPRI PERSONALITY (PERSONALITY.md):\nCapri test persona: curious and playful.',
    ),
  );
  assert.ok(
    seen[1].body.messages[0].content.startsWith(
      'CAPRI PERSONALITY (PERSONALITY.md):\nCapri updated persona: curious, playful and observant.',
    ),
  );
  for (const item of seen)
    assert.match(item.body.messages[0].content, /COMMUNICATION STYLE: neutral/);
  assert.equal(seen[0].headers['x-openclaw-message-channel'], 'webchat');
  assert.equal(seen[1].headers['x-openclaw-message-channel'], 'telegram');
  assert.equal(seen[1].body.messages[1].content, 'Second turn');
});

test('image bytes survive the HTTP adapter and JPEG is labeled correctly', async (t) => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
  let observed;
  const rt = await fakeGateway(t, (_req, body, res) => {
    observed = body.messages.at(-1).content;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  await chat('What is in the photo?', { rt, image });
  assert.equal(observed[0].text, 'What is in the photo?');
  assert.equal(observed[1].image_url.url, `data:image/jpeg;base64,${image.toString('base64')}`);
});

test('Gateway rejection is reported instead of being presented as an assistant reply', async (t) => {
  const rt = await fakeGateway(t, (_req, _body, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  });
  await assert.rejects(chat('hello', { rt }), /HTTP 401/);
});

test('reinitialization preserves user memory, runtime configuration and authentication', () => {
  const folder = mkdtempSync(path.join(tempRoot, 'state-'));
  const rt = runtime({
    stateDir: path.join(folder, 'state'),
    workspace: path.join(folder, 'workspace'),
  });
  initialize(rt);
  const token = readFileSync(rt.tokenPath, 'utf8');
  const memoryPath = path.join(rt.workspace, 'MEMORY.md');
  writeFileSync(memoryPath, 'A user-owned durable fact.\n');
  const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  config.gateway.port = 19001;
  writeFileSync(rt.configPath, JSON.stringify(config));
  initialize(rt);
  assert.equal(readFileSync(memoryPath, 'utf8'), 'A user-owned durable fact.\n');
  assert.equal(readFileSync(rt.tokenPath, 'utf8'), token);
  assert.equal(JSON.parse(readFileSync(rt.configPath, 'utf8')).gateway.port, 19001);
});

test('initialization upgrades legacy context with a backup while preserving saved history', () => {
  const folder = mkdtempSync(path.join(tempRoot, 'legacy-context-'));
  const rt = runtime({
    stateDir: path.join(folder, 'state'),
    workspace: path.join(folder, 'workspace'),
  });
  initialize(rt);
  const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  const model = config.models.providers.ollama.models.find((item) => item.id === settings.model);
  model.contextTokens = model.params.num_ctx = 8192;
  model.contextWindow = 262144;
  config.gateway.port = 19002;
  writeFileSync(rt.configPath, JSON.stringify(config));
  const memory = path.join(rt.workspace, 'MEMORY.md');
  writeFileSync(memory, 'Preserve this fixture memory.');
  const token = readFileSync(rt.tokenPath, 'utf8');
  initialize(rt);
  const after = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  assert.ok(after.models.providers.ollama.models[0].params.num_ctx >= 16384);
  assert.equal(after.gateway.port, 19002);
  assert.equal(readFileSync(memory, 'utf8'), 'Preserve this fixture memory.');
  assert.equal(readFileSync(rt.tokenPath, 'utf8'), token);
});
