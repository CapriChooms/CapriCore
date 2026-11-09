// SPDX-License-Identifier: GPL-3.0-only
import { availableParallelism } from 'node:os';

/** Runner allocation must agree for warmup, auxiliary calls and final replies.
 * Omitting num_thread is not equivalent to using the owner's configured value:
 * Ollama recreates the runner when switching between them.
 */
export const localRunnerOptions = ({ acceleration, cpuThreads } = {}) => ({
  ...(acceleration === 'cpu' ? { num_gpu: 0 } : {}),
  ...(cpuThreads ? { num_thread: Math.min(cpuThreads, availableParallelism()) } : {}),
});

/** Match the managed gateway's native Ollama runner. Changing shift reloads the
 * runner even when the model is already resident; auxiliary calls must agree.
 */
export const LOCAL_RUNNER_POLICY = Object.freeze({
  shift: false,
  truncate: false,
  keep_alive: -1,
});
