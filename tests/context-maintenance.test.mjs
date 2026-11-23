import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

// Execute the actual pinned runner with its external services replaced. The
// preparation deliberately never finishes; no real Gateway or owner data is used.
const source = readFileSync(
  new URL('../node_modules/openclaw/dist/agent-runner-memory-Dz7Z-Pdn.mjs', import.meta.url),
  'utf8',
);
const implementation = source.slice(
  source.indexOf('async function runMemoryFlushIfNeeded(params) {'),
  source.indexOf('async function recordMemoryFlushFailure('),
);

test('silent Capri maintenance aborts preparation on its own deadline without cancelling the owner', async () => {
  const owner = new AbortController(),
    durations = [];
  let observedSignal, recorded;
  const context = vm.createContext({
    AbortSignal: {
      any: (signals) => AbortSignal.any(signals),
      timeout: (ms) => {
        durations.push(ms);
        return AbortSignal.timeout(25);
      },
    },
    Error,
    Math,
    Number,
    Boolean,
    crypto: { randomUUID },
    process: { env: {}, cwd: () => '/fixture' },
    resolveFollowupAbortSignal: ({ abortSignal }) => abortSignal,
    withSandboxRuntimeStatusInWorker: async (_params, _options, callback) =>
      callback({ sandboxed: false }),
    isIncognitoSessionKey: () => false,
    resolveFollowupAgentRuntimeId: () => 'embedded',
    followupUsesCliRuntime: () => false,
    followupOwnsNativeCompaction: () => false,
    resolveFollowupContextTokens: () => 16384,
    resolveMemoryFlushPlanForRun: () => ({
      plan: { reserveTokensFloor: 4096, softThresholdTokens: 4000, forceFlushTranscriptBytes: 0 },
    }),
    isToolsMemoryFlushPlan: () => false,
    estimatePromptTokensForMemoryFlush: () => 1,
    resolveFreshSessionTotalTokens: () => 16000,
    resolveCompactionThreshold: () => 12288,
    TRANSCRIPT_OUTPUT_READ_BUFFER_TOKENS: 8192,
    readSessionLogSnapshot: async () => ({}),
    hasUsableProviderPromptUsage: () => false,
    resolveEffectivePromptTokens: (count) => count,
    asPositiveFiniteNumber: (value) => value,
    logVerbose: () => {},
    shouldRunMemoryFlush: () => true,
    resolveBootstrapWarningSignaturesSeen: () => [],
    memoryFlushPreparationLoader: {
      load: async () => ({
        prepareMemoryFlushAttempt: ({ abortSignal }) => {
          observedSignal = abortSignal;
          return new Promise((_resolve, reject) =>
            abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true }),
          );
        },
      }),
    },
    recordMemoryFlushFailure: async (error, _params, entry) => {
      recorded = error;
      return { outcome: 'failed', sessionEntry: entry };
    },
  });
  const run = new vm.Script(implementation + '\nrunMemoryFlushIfNeeded').runInContext(context);
  // Keep the test alive while Node's unreferenced timeout fires.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const entry = { sessionId: 'fixture', compactionCount: 2 };
    const result = await run({
      abortSignal: owner.signal,
      sessionKey: 'agent:capri:test',
      sessionEntry: entry,
      followupRun: { run: { agentId: 'capri' } },
    });
    assert.deepEqual(durations, [10000]);
    assert.equal(observedSignal.aborted, true);
    assert.equal(owner.signal.aborted, false);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.sessionEntry, entry);
    assert.match(recorded.message, /10 second limit/);
  } finally {
    clearInterval(keepAlive);
  }
});
