// SPDX-License-Identifier: GPL-3.0-only
/** Match the managed gateway's native Ollama runner. Changing shift reloads the
 * runner even when the model is already resident; auxiliary calls must agree.
 */
export const LOCAL_RUNNER_POLICY = Object.freeze({
  shift: false,
  truncate: false,
  keep_alive: -1,
});
