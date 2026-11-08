import { personaPrompt } from '../../packages/runtime/src/context.mjs';
/** Real Qwen tool calls with an isolated Gateway, policy, database and fixture folder. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  root,
  runtime,
  initialize,
  startGateway,
  stopManaged,
  runCli,
} from '../../packages/runtime/src/index.mjs';
import { FilePermissions, protectedLocations } from '../../integrations/filesystem/permissions.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';

const index = process.argv.indexOf('--test-root');
if (index < 0 || !process.argv[index + 1])
  throw new Error(
    'Pass --test-root with a personal scratch directory outside the Capri installation. Only generated test fixtures will be used.',
  );
const parent = path.resolve(process.argv[index + 1]);
if (!existsSync(parent)) throw new Error('The scratch directory must already exist');
const fixture = mkdtempSync(path.join(parent, 'capri-files-test-'));
const runParent = path.join(root, '.runtime/filesystem-model-verification');
mkdirSync(runParent, { recursive: true });
const folder = mkdtempSync(path.join(runParent, 'run-'));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: 18794,
  logPrefix: 'filesystem-verification',
});
initialize(rt);
const isolated = path.join(folder, 'files-state');
mkdirSync(isolated);
const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
config.plugins.entries['capri-filesystem'].config = {
  stateDirectory: path.relative(root, isolated),
};
config.tools.allow = ['filesystem_control', 'session_status'];
writeFileSync(rt.configPath, JSON.stringify(config, null, 2));
const permissions = new FilePermissions(path.join(isolated, 'file-permissions.json'), {
  protectedRoots: protectedLocations(root),
});
const [scope] = permissions.grant(fixture);
permissions.update(scope.id, true);
writeFileSync(path.join(fixture, 'input.txt'), 'The verification phrase is: copper moon.\n');
const key = 'agent:capri:files-test-' + randomUUID(),
  messages = new Map(),
  report = {
    timestamp: new Date().toISOString(),
    passed: false,
    fixture,
    folder,
    turns: [],
    toolCalls: [],
  };
const rpc = async (method, params) =>
  JSON.parse(
    (
      await runCli(
        [
          'gateway',
          'call',
          method,
          '--params',
          JSON.stringify(params),
          '--json',
          '--timeout',
          '60000',
        ],
        rt,
      )
    ).stdout,
  );
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const chat = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: key,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () =>
    personaPrompt(rt) +
    '\nTemporary isolated file integration test. Only use filesystem_control and only its approved fixture scope. Do not write memories. Complete actual file actions before confirming.',
  avatarSprites: catalog.publicSprites(),
  defaultAvatarId: catalog.defaultId,
  store: {
    snapshot: () => [...messages.values()],
    put: (value) => messages.set(value.id, structuredClone(value)),
  },
});
async function ask(text) {
  let answer;
  const started = performance.now();
  await chat.send({ id: randomUUID(), text }, (event) => {
    if (event.type === 'turn.completed') answer = event.assistant.text;
  });
  assert.ok(answer, 'The real model must complete its reply');
  report.turns.push({ text, answer, elapsedMs: Math.round(performance.now() - started) });
  console.log(JSON.stringify(report.turns.at(-1)));
}
try {
  await startGateway(rt);
  await ask('Which folders are you allowed to use? Check your actual file access.');
  await ask('Read input.txt in that approved test folder and tell me the verification phrase.');
  assert.match(report.turns.at(-1).answer, /copper moon/i);
  await ask(
    'Create a new text file named greeting.txt in that test folder. Write exactly the following quoted text, including the final period but excluding the quotation marks: "Hello from Capri."',
  );
  assert.equal(
    readFileSync(path.join(fixture, 'greeting.txt'), 'utf8').trim(),
    'Hello from Capri.',
  );
  await ask('Rename greeting.txt to welcome.txt in the same folder.');
  assert.equal(existsSync(path.join(fixture, 'greeting.txt')), false);
  assert.equal(readFileSync(path.join(fixture, 'welcome.txt'), 'utf8').trim(), 'Hello from Capri.');
  await ask('Undo that last rename, please.');
  assert.equal(existsSync(path.join(fixture, 'greeting.txt')), true);
  assert.equal(existsSync(path.join(fixture, 'welcome.txt')), false);
  const transcript = await rpc('chat.history', { sessionKey: key, limit: 200 });
  for (const message of transcript.messages ?? [])
    for (const part of Array.isArray(message.content) ? message.content : [])
      if (['toolCall', 'tool_use'].includes(part.type)) {
        let args = part.arguments ?? part.input;
        if (typeof args === 'string') args = JSON.parse(args);
        report.toolCalls.push({ name: part.name, action: args?.action });
      }
  for (const action of ['status', 'read_text', 'write_text', 'move', 'undo'])
    assert.ok(
      report.toolCalls.some((c) => c.name === 'filesystem_control' && c.action === action),
      `Expected real ${action} tool call`,
    );
  assert.ok(report.toolCalls.every((c) => c.name === 'filesystem_control'));
  assert.equal(
    readFileSync(path.join(fixture, 'input.txt'), 'utf8'),
    'The verification phrase is: copper moon.\n',
  );
  report.passed = true;
} finally {
  await stopManaged(rt.logPrefix);
  writeFileSync(
    path.join(root, 'logs/filesystem-model-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify({ passed: report.passed, toolCalls: report.toolCalls, fixture }));
