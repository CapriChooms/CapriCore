// SPDX-License-Identifier: GPL-3.0-only
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const modelIdlePolicyFile = 'model-idle-policy.json';
export const modelIdleLimits = Object.freeze({ min: 1, max: 60, default: 5 });

export function validModelIdleMinutes(value) {
  return Number.isInteger(value) && value >= modelIdleLimits.min && value <= modelIdleLimits.max;
}

export function readModelIdlePolicy(stateDirectory) {
  const fallback = { unloadIdle: false, idleMinutes: modelIdleLimits.default };
  try {
    const file = path.join(stateDirectory, modelIdlePolicyFile);
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > 128) return fallback;
    const policy = JSON.parse(readFileSync(file, 'utf8'));
    if (policy.schemaVersion !== 1) return fallback;
    return {
      unloadIdle: policy.unloadIdle === true,
      idleMinutes: validModelIdleMinutes(policy.idleMinutes)
        ? policy.idleMinutes
        : modelIdleLimits.default,
    };
  } catch {
    return fallback;
  }
}
