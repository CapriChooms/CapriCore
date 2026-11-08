import { settings } from '../config/settings.mjs';
import { resolveExecutables } from './paths.mjs';
export const executables = resolveExecutables(settings);
export const nodePath = executables.node,
  ollamaPath = executables.ollama,
  openclawPath = executables.openclaw;
