import path from 'node:path';
import { availableParallelism } from 'node:os';
import { root, paths } from './paths.mjs';
import { nodePath } from './executables.mjs';
import { settings } from '../config/settings.mjs';
import { runtime, headers } from '../context.mjs';

export function environment(rt = runtime()) {
  const directories = [nodePath].filter(Boolean).map((file) => path.dirname(file));
  return {
    ...process.env,
    PATH: [...directories, process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter),
    CAPRI_NODE_PATH: nodePath ?? '',
    OPENCLAW_STATE_DIR: rt.stateDir,
    OPENCLAW_CONFIG_PATH: rt.configPath,
    OPENCLAW_WORKSPACE_DIR: rt.workspace,
    OPENCLAW_HOME: path.join(rt.stateDir, 'home'),
    CAPRI_GATEWAY_PORT: String(rt.gatewayPort),
    CAPRI_OLLAMA_PORT: String(settings.ollamaPort),
    OPENCLAW_GATEWAY_TOKEN: headers(rt).authorization.slice(7),
    CAPRI_CPU_THREADS: String(
      Math.max(1, Math.min(settings.cpuThreads ?? 8, availableParallelism())),
    ),
    TEMP: path.join(paths.cache, 'tmp'),
    TMP: path.join(paths.cache, 'tmp'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    GIT_CEILING_DIRECTORIES: path.dirname(rt.workspace),
    GIT_TERMINAL_PROMPT: '0',
    CAPRI_PROJECT_ROOT: root,
    ...(rt.remote?.enabled && rt.remoteProxyToken
      ? { CAPRI_REMOTE_PROXY_TOKEN: rt.remoteProxyToken }
      : {}),
  };
}
