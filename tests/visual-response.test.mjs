// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { visualReplyFailure } from '../apps/desktop/visual-response.mjs';
import { uiText } from '../apps/desktop/renderer/interface-translations.mjs';

test('visual errors explain truncation and timeout without blaming the attached file', () => {
  const limited = visualReplyFailure({ code: 'CAPRI_VISUAL_TRUNCATED' });
  assert.match(limited.message, /reply limit.*shorter answer/);
  assert.match(uiText(limited.message, 'ru'), /исчерпала лимит ответа/);
  assert.equal(limited.code, 'CAPRI_VISUAL_TRUNCATED');
  assert.equal(visualReplyFailure({}, { timedOut: true }).code, 'CAPRI_VISUAL_TIMEOUT');
  assert.equal(
    visualReplyFailure(new DOMException('private', 'TimeoutError')).code,
    'CAPRI_VISUAL_TIMEOUT',
  );
});

test('visual diagnostics never retain unknown codes, provider text, prompts, or credentials', () => {
  const result = visualReplyFailure({
    code: 'PRIVATE_TOKEN',
    message: 'PRIVATE_PROMPT',
    cause: { secret: 'PRIVATE_KEY' },
    providerStatus: 429,
  });
  assert.equal(result.code, 'CAPRI_VISUAL_FAILED');
  assert.equal(result.providerStatus, 429);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  for (const providerStatus of ['429', NaN, 200, 999])
    assert.equal(visualReplyFailure({ providerStatus }).providerStatus, undefined);
});
