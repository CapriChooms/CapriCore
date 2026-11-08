// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** The wizard's choice applies only to the next desktop launch, including via a shortcut. */
export function consumeFirstLaunchPreload(state) {
  const file = path.join(state, 'first-start.json');
  let choice;
  try {
    choice = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return true;
  }
  if (choice?.schemaVersion !== 1 || typeof choice.preloadModels !== 'boolean') return true;
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not clear the first-launch model preference.');
  }
  return choice.preloadModels;
}

/** Avoid simultaneous import/model-loading memory peaks on 8/16 GiB machines. */
export async function startModelServices({
  core,
  recognition,
  voice,
  sequential = false,
  voiceFirst = false,
  shouldContinue = () => true,
}) {
  if (voiceFirst && voice) {
    // Keep return order stable (core, recognition, voice). Voice failure must
    // still allow text; shutdown during voice warmup must not resurrect Qwen.
    const voiced = (await Promise.allSettled([Promise.resolve().then(voice)]))[0];
    if (!shouldContinue())
      return [{ status: 'rejected', reason: new Error('Model startup cancelled') }, voiced];
    const rest = await startModelServices({ core, recognition, sequential, shouldContinue });
    return [...rest, voiced];
  }
  const tasks = [core, recognition, voice].filter(Boolean);
  const run = (task) => Promise.resolve().then(task);
  if (!sequential) return Promise.allSettled(tasks.map(run));
  const results = [];
  for (const task of tasks) {
    if (results.length && (!shouldContinue() || results[0]?.status === 'rejected')) break;
    results.push((await Promise.allSettled([run(task)]))[0]);
  }
  return results;
}
