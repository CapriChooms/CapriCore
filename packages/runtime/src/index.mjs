/** Public runtime boundary. Importing it never starts a service or loads a model. */
export { root, paths, findExecutable, requireExecutable } from './host/paths.mjs';
export { nodePath, ollamaPath, openclawPath } from './host/executables.mjs';
export { settings, loadCoreSettings, validateCoreSettings } from './config/settings.mjs';
export {
  runtime,
  initialize,
  headers,
  personaPrompt,
  createGatewayConfiguration,
} from './context.mjs';
export { environment } from './host/environment.mjs';
export { request, waitFor } from './http.mjs';
export { managedProcess, launch } from './host/processes.mjs';
export { startOllama, startGateway, stopManaged } from './providers/services.mjs';
export { chat, runCli } from './client.mjs';
export { writeJsonAtomic } from './atomic-json.mjs';
export { generationParams, reasoningBudget } from './config/inference.mjs';
