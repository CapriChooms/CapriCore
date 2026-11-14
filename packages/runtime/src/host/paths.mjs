import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export const paths = Object.freeze({
  root,
  data: path.join(root, 'data'),
  logs: path.join(root, 'logs'),
  cache: path.join(root, '.runtime'),
  config: path.join(root, 'config'),
});
const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export function findExecutable(
  name,
  { env = process.env, platform = process.platform, extra = [] } = {},
) {
  const extension = platform === 'win32' ? '.exe' : '';
  const folders = (env.PATH ?? env.Path ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean);
  return (
    [...extra, ...folders.map((folder) => path.join(folder, name + extension))].find(
      (file) => file && isFile(file),
    ) ?? null
  );
}

export function resolveExecutables(
  settings,
  { env = process.env, executable = process.execPath, platform = process.platform } = {},
) {
  const explicit = (variable, fallback) => {
    if (!env[variable]) return fallback;
    if (!path.isAbsolute(env[variable]) || !isFile(env[variable]))
      throw new Error(variable + ' must point to an existing executable.');
    return env[variable];
  };
  const bundledNode = path.join(paths.cache, `node-v${settings.nodeVersion}-win-x64/node.exe`);
  const node = explicit(
    'CAPRI_NODE_PATH',
    findExecutable('node', {
      env,
      platform,
      extra: [/^node(?:\.exe)?$/i.test(path.basename(executable)) ? executable : null, bundledNode],
    }),
  );
  const llama = explicit(
    'CAPRI_LLAMA_PATH',
    findExecutable('llama-server', {
      env,
      platform,
      extra: [path.join(paths.cache, `llama-${settings.llamaVersion}-vulkan/llama-server.exe`)],
    }),
  );
  return Object.freeze({
    node,
    llama,
    openclaw: path.join(root, 'node_modules/openclaw/openclaw.mjs'),
  });
}

export function requireExecutable(value, name) {
  if (!value || !existsSync(value))
    throw new Error(`${name} is not installed. See docs/installation.md or run npm run doctor.`);
  return value;
}
