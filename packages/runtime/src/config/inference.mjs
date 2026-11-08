// SPDX-License-Identifier: GPL-3.0-only
import {
  settings,
  generationParams as validateGeneration,
  reasoningBudget as validateBudget,
} from './settings.mjs';
import { availableParallelism } from 'node:os';
export const generationParams = (value = settings.generation, config = settings) => ({
  ...validateGeneration(value),
  ...(config.acceleration === 'cpu' ? { num_gpu: 0 } : {}),
  ...(config.cpuThreads ? { num_thread: Math.min(config.cpuThreads, availableParallelism()) } : {}),
});
export const reasoningBudget = (value = settings.reasoningBudget) => validateBudget(value);
