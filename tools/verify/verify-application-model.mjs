import { personaPrompt } from '../../packages/runtime/src/context.mjs';
/** Isolated real Qwen and Windows Calculator; no owner conversation or preexisting window. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  root,
  runtime,
  initialize,
  startGateway,
  stopManaged,
  runCli,
} from '../../packages/runtime/src/index.mjs';
import { ChatService } from '../../apps/desktop/chat-service.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
const parent = path.join(root, '.runtime/application-model-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: 18796,
  logPrefix: 'applications-verification',
});
initialize(rt);
const state = path.join(folder, 'app-state');
mkdirSync(state);
writeFileSync(
  path.join(state, 'applications.json'),
  JSON.stringify({ schemaVersion: 1, settings: { notepad: false, calculator: true } }),
);
const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
config.plugins.entries['capri-applications'].config = {
  stateDirectory: path.relative(root, state),
};
config.tools.allow = ['application_control', 'session_status'];
writeFileSync(rt.configPath, JSON.stringify(config, null, 2));
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG)),
  messages = new Map(),
  key = 'agent:capri:apps-test-' + randomUUID();
const chat = new ChatService({
  gatewayUrl: rt.gatewayUrl,
  agentId: 'capri',
  sessionKey: key,
  token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  persona: () =>
    personaPrompt(rt) +
    '\nIsolated application integration verification. Only use application_control. Do not write memories.',
  avatarSprites: catalog.publicSprites(),
  defaultAvatarId: catalog.defaultId,
  store: {
    snapshot: () => [...messages.values()],
    put: (value) => messages.set(value.id, structuredClone(value)),
  },
});
const report = { passed: false, folder, turns: [], toolCalls: [] };
let launched;
function nativeResults() {
  const database = new DatabaseSync(path.join(state, 'operations.sqlite'), { readOnly: true });
  try {
    return database
      .prepare("SELECT result FROM operations WHERE state='complete'")
      .all()
      .map((row) => JSON.parse(row.result));
  } finally {
    database.close();
  }
}
try {
  if ((await callApplicationBridge(root, { action: 'status', app: 'calculator' })).running)
    throw new Error('A user Calculator window is already open; leave it untouched.');
  await startGateway(rt);
  const started = performance.now();
  await chat.send(
    {
      id: randomUUID(),
      text: 'Open Calculator and use it to work out seventeen point five times four. Tell me the result.',
    },
    (e) => {
      if (e.type === 'turn.completed')
        report.turns.push({
          answer: e.assistant.text,
          elapsedMs: Math.round(performance.now() - started),
        });
    },
  );
  const history = JSON.parse(
    (
      await runCli(
        [
          'gateway',
          'call',
          'chat.history',
          '--params',
          JSON.stringify({ sessionKey: key, limit: 200 }),
          '--json',
          '--timeout',
          '60000',
        ],
        rt,
      )
    ).stdout,
  );
  for (const message of history.messages ?? []) {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (['toolCall', 'tool_use'].includes(part.type)) {
        let args = part.arguments ?? part.input;
        if (typeof args === 'string') args = JSON.parse(args);
        report.toolCalls.push({ name: part.name, action: args?.action });
      }
    }
    if (message.role === 'toolResult' && message.details?.processId) {
      launched = message.details;
      if (message.details.untrustedResultLabel)
        report.displayedResult = message.details.untrustedResultLabel;
    }
  }
  const actual = nativeResults().find(
    (result) => result.expression === '17.5 * 4' || result.expression === '17.5*4',
  );
  assert.equal(actual?.ok, true);
  report.displayedResult = actual.untrustedResultLabel;
  launched = actual;
  assert.equal(report.turns.length, 1);
  assert.match(report.turns[0].answer, /(?:^|\D)70(?:\D|$)|\bseventy\b/i);
  assert.match(report.displayedResult ?? '', /(?:^|\D)70(?:\D|$)/);
  assert.ok(
    report.toolCalls.some((c) => c.name === 'application_control' && c.action === 'calculate'),
  );
  assert.ok(report.toolCalls.every((c) => c.name === 'application_control'));
  report.passed = true;
} finally {
  // Obtain identity only for our newly opened Calculator, then close its window.
  if (!launched)
    try {
      launched = nativeResults().find((result) => result.app === 'calculator' && result.processId);
    } catch {}
  if (launched?.processId && /^\d+$/.test(launched.startedAtTicks))
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$capriApp=Get-Process -Id ${Number(launched.processId)} -ErrorAction SilentlyContinue; if($capriApp -and $capriApp.StartTime.ToUniversalTime().Ticks -eq [long]'${launched.startedAtTicks}'){[void]$capriApp.CloseMainWindow(); if(-not $capriApp.WaitForExit(2000) -and $capriApp.ProcessName -eq 'CalculatorApp'){Stop-Process -Id $capriApp.Id}}`,
      ],
      { windowsHide: true },
    );
  await stopManaged(rt.logPrefix);
  writeFileSync(
    path.join(root, 'logs/application-model-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
