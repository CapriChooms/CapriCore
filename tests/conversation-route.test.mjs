// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationOnly } from '../apps/desktop/conversation-route.mjs';
import {
  createGatewayConfiguration,
  applyModelProfile,
  runtime,
} from '../packages/runtime/src/context.mjs';
import { settings } from '../packages/runtime/src/index.mjs';
test('social route restricts greetings without swallowing commands or ambiguous follow-ups', () => {
  for (const text of [
    'Hello.',
    'Say hello briefly.',
    'Hey Capri, how are you?',
    'Привет, Капри!',
    'Капри, как дела?',
  ])
    assert.equal(conversationOnly(text), true, text);
  for (const text of [
    'Hello, open Firefox',
    'Hey Capri, play music',
    'yes',
    'remember my name',
    'press W',
    'click there',
    'Hello! Delete a file',
  ])
    assert.equal(conversationOnly(text), false, text);
  assert.equal(
    conversationOnly('A quiet evening sounds good.', { mode: 'fast', reason: 'simple-dialogue' }),
    true,
  );
  assert.equal(
    conversationOnly('A little less', { mode: 'fast', reason: 'task-follow-up' }),
    false,
  );
});
test('managed agents gain rolling loop detection without changing explicit owner policies', () => {
  const rt = runtime(),
    config = createGatewayConfiguration(rt, settings);
  assert.equal(config.agents.entries.capri.tools.loopDetection.enabled, true);
  delete config.agents.entries.capri.tools;
  const migrated = applyModelProfile(config, rt, settings);
  assert.equal(migrated.agents.entries.capri.tools.loopDetection.enabled, true);
  config.agents.entries.capri.tools = { loopDetection: { enabled: false } };
  assert.equal(
    applyModelProfile(config, rt, settings).agents.entries.capri.tools.loopDetection.enabled,
    false,
  );
});
