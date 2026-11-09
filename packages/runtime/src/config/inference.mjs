// SPDX-License-Identifier: GPL-3.0-only
import {
  settings,
  generationParams as validateGeneration,
  reasoningBudget as validateBudget,
} from './settings.mjs';
import { localRunnerOptions } from '../providers/runner-policy.mjs';
export const generationParams = (value = settings.generation, config = settings) => ({
  ...validateGeneration(value),
  ...localRunnerOptions(config),
});
export const reasoningBudget = (value = settings.reasoningBudget) => validateBudget(value);
