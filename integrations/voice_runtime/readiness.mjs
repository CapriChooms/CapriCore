import { setTimeout as delay } from 'node:timers/promises';

/** Cold model loading can exceed three minutes on an ordinary Windows disk. */
export async function waitForVoiceReady({
  health,
  isRunning,
  signal,
  timeout = 600000,
  interval = 1000,
  now = Date.now,
  sleep = (ms) => delay(ms, undefined, { signal }),
}) {
  const deadline = now() + timeout;
  let nextProcessCheck = 0;
  while (true) {
    signal?.throwIfAborted();
    let status;
    try {
      status = await health();
    } catch {
      // The loopback port opens after the model and its warmup are ready.
    }
    signal?.throwIfAborted();
    if (status?.ready === true) return status;
    if (now() >= nextProcessCheck) {
      if (!(await isRunning()))
        throw new Error(
          'The local voice process stopped during startup. See logs/companion-voice.stderr.log.',
        );
      nextProcessCheck = now() + 5000;
    }
    if (now() >= deadline)
      throw new Error('Voice model loading timed out. See logs/companion-voice.stderr.log.');
    await sleep(Math.min(interval, deadline - now()));
  }
}
