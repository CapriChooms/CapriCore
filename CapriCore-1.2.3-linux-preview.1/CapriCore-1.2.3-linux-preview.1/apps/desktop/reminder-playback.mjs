// SPDX-License-Identifier: GPL-3.0-only
/** Generation is not delivery: wait for the owning renderer's playback acknowledgement. */
export function speakReminder({
  voice,
  emit,
  subscribe,
  playbackBusy,
  shuttingDown,
  text,
  turnId,
  timeoutMs = 180000,
  startTimeoutMs = 5000,
  graceMs = 350,
  pollMs = 100,
}) {
  return new Promise((resolve, reject) => {
    let generated = false,
      played = false,
      settled = false,
      generatedAt = 0;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      unsubscribe();
      error ? reject(error) : resolve();
    };
    const poll = setInterval(() => {
      if (shuttingDown() || !voice.enabled) finish(new Error('Reminder speech cancelled'));
      else if (generated && played && !playbackBusy() && Date.now() - generatedAt >= graceMs)
        finish();
      else if (generated && !played && Date.now() - generatedAt >= startTimeoutMs)
        finish(new Error('Audio playback failed. Try unmuting Capri again.'));
    }, pollMs);
    poll.unref?.();
    const timeout = setTimeout(() => finish(new Error('Reminder speech timed out')), timeoutMs);
    timeout.unref?.();
    const unsubscribe = subscribe((event) => {
      if (event.type === 'playback.state' && event.busy) played = true;
      if (event.type === 'voice.generated' && event.turnId === turnId) {
        generated = true;
        generatedAt = Date.now();
      }
      if (event.type === 'voice.cancelled' && event.turnId === turnId)
        finish(new Error('Reminder speech cancelled'));
      if (event.type === 'voice.error' && (!event.turnId || event.turnId === turnId))
        finish(new Error(event.message || 'Reminder speech cancelled'));
    });
    emit({ type: 'voice.preview-started', turnId });
    try {
      voice.preview(turnId, text);
    } catch (error) {
      finish(error);
    }
  });
}
