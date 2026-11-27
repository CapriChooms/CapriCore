// SPDX-License-Identifier: GPL-3.0-only
/** SIGTERM and SIGINT run the same shutdown as the Quit dialog. The first signal
 * starts it; a second signal, or a shutdown that runs past `timeoutMs`, exits
 * at once. Children exit on their own through their stdin lifeline.
 */
export function createSignalExit({
  shutdown,
  exit,
  onError = () => {},
  timeoutMs = 30_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = null;
  return (signal) => {
    if (active) {
      exit(signal, 'forced');
      return active;
    }
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimer(() => resolve('timeout'), timeoutMs);
    });
    const finished = Promise.resolve()
      .then(() => shutdown(signal))
      .then(
        () => 'done',
        (error) => {
          onError(error);
          return 'failed';
        },
      );
    active = Promise.race([finished, deadline]).then((outcome) => {
      clearTimer(timer);
      exit(signal, outcome);
      return outcome;
    });
    return active;
  };
}
