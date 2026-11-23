// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../node_modules/openclaw/dist/embedded-agent-CPls2oXD.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('\tconst continuationPrompt = ');
const end = source.indexOf('\n\tlet activeSessionId = ', start);
assert(start > 0 && end > start);
const continuation = (params) =>
  vm.runInNewContext(source.slice(start, end) + '\ncontinuationPrompt;', {
    params,
    CONTINUATION_PROMPT: 'Continue the current task from the existing transcript.',
  });

test('compaction recovery reanchors Capri to the current request and its retrieved evidence', () => {
  const prompt =
    'When was Exampleland founded?\nCURRENT WEB SEARCH:\n[1] Official history: founded on 2 January 1950. https://example.org/history';
  const recovered = continuation({
    agentId: 'capri',
    provider: 'ollama',
    modelId: 'gemma4:e2b',
    extraSystemPrompt: 'CAPRI PERSONALITY (PERSONALITY.md):\nSynthetic fixture persona.',
    prompt,
  });
  assert(recovered.endsWith(prompt));
  assert.match(recovered, /internal recovery note, not a user question/);
  assert.match(recovered, /empty memory search does not negate web evidence/);
  assert.match(recovered, /do not repeat them/);
  assert.match(recovered, /Do not describe this note/);
  assert.match(source, /activateInternalPrompt\(continuationPrompt\)/);
  assert.match(
    source,
    /options\?\.includeToolFailureInstruction \? `\$\{continuationPrompt\} \$\{TOOL_FAILURE_INSTRUCTION\}` : continuationPrompt/,
  );
  // Internal continuation remains non-persisted; no duplicate user turn or replay grant.
  assert.match(source, /suppressNextUserMessagePersistence = true;/);
});

test('non-Capri and non-desktop continuation behavior stays unchanged', () => {
  for (const params of [
    { agentId: 'other', extraSystemPrompt: 'CAPRI PERSONALITY (PERSONALITY.md):', prompt: 'Hi' },
    { agentId: 'capri', prompt: 'Hi' },
    { agentId: 'capri', extraSystemPrompt: 'Unrelated instructions', prompt: 'Hi' },
    { agentId: 'capri', extraSystemPrompt: 'CAPRI PERSONALITY (PERSONALITY.md):' },
  ])
    assert.equal(continuation(params), 'Continue the current task from the existing transcript.');
});
