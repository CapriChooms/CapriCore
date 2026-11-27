// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareFreshTurn, turnHistory } from '../apps/desktop/fresh-context.mjs';
import {
  COMPANION_DEFAULTS,
  validateCompanionSettings,
} from '../apps/desktop/companion-settings.mjs';
import { ChatService } from '../apps/desktop/chat-service.mjs';

const source = (file) => readFileSync(new URL('../apps/desktop/' + file, import.meta.url), 'utf8');

test('the setting is off by default and must be a boolean', () => {
  assert.equal(COMPANION_DEFAULTS.freshContext, false);
  assert.equal(validateCompanionSettings({}).freshContext, false);
  assert.equal(validateCompanionSettings({ freshContext: true }).freshContext, true);
  assert.throws(() => validateCompanionSettings({ freshContext: 'yes' }), /Invalid/);
  assert.throws(() => validateCompanionSettings({ freshContext: 1 }), /Invalid/);
});

test('with the mode off nothing is reset', async () => {
  let resets = 0;
  const outcome = await prepareFreshTurn({ enabled: () => false, reset: async () => resets++ });
  assert.equal(outcome, 'off');
  assert.equal(resets, 0);
  // Only a real true switches it on.
  assert.equal(
    await prepareFreshTurn({ enabled: () => 'true', reset: async () => resets++ }),
    'off',
  );
  assert.equal(resets, 0);
});

test('with the mode on the conversation is reset once before the turn', async () => {
  const order = [];
  const outcome = await prepareFreshTurn({
    enabled: () => true,
    reset: async () => {
      await new Promise((done) => setTimeout(done, 5));
      order.push('reset');
    },
  });
  order.push('turn');
  assert.equal(outcome, 'reset');
  assert.deepEqual(order, ['reset', 'turn']);
});

test('a failed reset is reported and does not block the turn', async () => {
  const failures = [];
  const outcome = await prepareFreshTurn({
    enabled: () => true,
    reset: async () => {
      throw new Error('gateway busy');
    },
    onFailure: (error) => failures.push(error.message),
  });
  assert.equal(outcome, 'failed');
  assert.deepEqual(failures, ['gateway busy']);
  assert.equal(
    await prepareFreshTurn({
      enabled: () => true,
      reset: () => {
        throw new Error('sync failure');
      },
    }),
    'failed',
  );
});

test('missing functions are a programming error', async () => {
  await assert.rejects(prepareFreshTurn({ enabled: true, reset: async () => {} }), TypeError);
  await assert.rejects(prepareFreshTurn({ enabled: () => true }), TypeError);
});

test('earlier messages are withheld only in fresh context mode', () => {
  const snapshot = [{ role: 'user', text: 'earlier question' }];
  assert.equal(turnHistory(false, snapshot), snapshot);
  assert.deepEqual(turnHistory(true, snapshot), []);
  assert.equal(turnHistory('true', snapshot), snapshot);
});

function service(freshContext) {
  const messages = [
    { role: 'user', turnId: 'a', text: 'earlier question', status: 'complete' },
    { role: 'assistant', turnId: 'a', text: 'earlier answer', status: 'complete' },
  ];
  return new ChatService({
    gatewayUrl: 'http://127.0.0.1:1',
    agentId: 'capri',
    sessionKey: 'test',
    token: () => 'token',
    persona: () => 'persona',
    store: { snapshot: () => messages, put() {}, warning: null },
    ...(freshContext ? { freshContext } : {}),
  });
}

test('the chat service follows the setting live, without a restart', () => {
  assert.equal(service().turnHistory().length, 2);
  let on = false;
  const chat = service(() => on);
  assert.equal(chat.turnHistory().length, 2);
  on = true;
  assert.deepEqual(chat.turnHistory(), []);
  on = false;
  assert.equal(chat.turnHistory().length, 2);
});

test('the model request and the settings panel are wired to the mode', () => {
  const chat = source('chat-service.mjs');
  assert.match(chat, /desktopTurnContext\(interfaceState, this\.turnHistory\(fresh\)/);
  assert.match(chat, /history: directSmallTalk \? \[\] : this\.turnHistory\(fresh\)/);
  assert.match(
    chat,
    /await this\.resetContext\?\.\(requestSignal\)[\s\S]+?const response = directDialogue/,
  );
  const main = source('main.mjs');
  assert.match(main, /resetContext: resetFreshContext/);
  assert.match(main, /async function submitVisualTurn[\s\S]+?await resetFreshContext\(signal\)/);
  assert.match(
    main,
    /sessions\.reset',\s*\{ key: chatSessionKey, reason: 'new' \},\s*\{ signal \},?\s*\);\s+contextSampler\.invalidate/,
  );
  const panel = source('renderer/companion-panel.mjs');
  assert.match(panel, /<input type="checkbox" id="companion-fresh-context">/);
  assert.match(panel, /freshContext: this\.get\('companion-fresh-context'\)\.checked/);
  assert.match(panel, /get\('companion-fresh-context'\)\.checked = value\.freshContext === true/);
});
