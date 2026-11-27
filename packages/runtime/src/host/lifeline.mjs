// SPDX-License-Identifier: GPL-3.0-only
/** Set by the launcher on children that must exit when their launcher dies. */
export const LIFELINE_ENV = 'CAPRI_PARENT_LIFELINE';

/** Windows keeps its existing console-free launch; the pipe is POSIX-only. */
export function lifelineRequested(env = process.env, platform = process.platform) {
  return platform !== 'win32' && env[LIFELINE_ENV] === 'stdin';
}

/** The launcher holds the write end of stdin. When it exits for any reason,
 * including SIGKILL, the kernel closes that end and this child sees EOF.
 */
export function watchParentLifeline(onEnd, options = {}) {
  const { stdin = process.stdin, env = process.env, platform = process.platform } = options;
  if (!lifelineRequested(env, platform)) return false;
  stdin.once('end', onEnd);
  stdin.once('error', onEnd);
  stdin.resume();
  return true;
}
