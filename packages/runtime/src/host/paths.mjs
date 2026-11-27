import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledLlamaPath } from './llama-bundle.mjs';

export const resourceRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

/** A packaged Mac app keeps its mutable installation outside the signed bundle.
 * Source checkouts and other platforms keep their installation-relative paths. */
export function runtimeRoot(source, { platform = process.platform, env = process.env } = {}) {
  const directory = platform === 'darwin' && env.CAPRI_MACOS_RUNTIME_ROOT;
  if (!directory) return source;
  if (!path.isAbsolute(directory)) throw new Error('CAPRI_MACOS_RUNTIME_ROOT must be absolute.');
  return path.resolve(directory);
}

export const root = runtimeRoot(resourceRoot);
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
  const bundledNode =
    platform === 'win32'
      ? path.join(paths.cache, `node-v${settings.nodeVersion}-win-x64/node.exe`)
      : null;
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
      extra:
        platform === 'win32' || platform === 'darwin'
          ? [bundledLlamaPath(root, settings.llamaVersion, platform)]
          : [],
    }),
  );
  return Object.freeze({
    node,
    llama,
    openclaw: path.join(resourceRoot, 'node_modules/openclaw/openclaw.mjs'),
  });
}

export function requireExecutable(value, name) {
  if (!value || !existsSync(value))
    throw new Error(`${name} is not installed. See docs/installation.md or run npm run doctor.`);
  return value;
}
