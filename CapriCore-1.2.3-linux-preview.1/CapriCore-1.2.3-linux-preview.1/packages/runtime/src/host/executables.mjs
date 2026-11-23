import { settings } from '../config/settings.mjs';
import { resolveExecutables } from './paths.mjs';
export const executables = resolveExecutables(settings);
export const nodePath = executables.node,
  llamaPath = executables.llama,
  openclawPath = executables.openclaw;
