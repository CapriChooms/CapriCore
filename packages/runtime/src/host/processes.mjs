import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  appendFileSync,
  lstatSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { root, paths } from './paths.mjs';
import { runtime } from '../context.mjs';
import { environment } from './environment.mjs';
import { writeJsonAtomic } from '../atomic-json.mjs';
import { waitFor } from '../http.mjs';
import { ollamaNetworkEnvironment } from './registry-network.mjs';
import { assertPrivatePath } from '../safe-file.mjs';
import { privateLogRecord } from '../privacy-log.mjs';
const execFileAsync = promisify(execFile);

export function markerPath(name) {
  if (!/^[a-z0-9-]{1,64}$/i.test(name)) throw new Error('Invalid managed process name');
  return path.join(paths.data, 'run', name + '.json');
}
export function processStartedAt(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'win32')
      return execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$capriProcess=Get-Process -Id ${pid} -ErrorAction Stop; $capriProcess.StartTime.ToUniversalTime().Ticks`,
        ],
        { windowsHide: true, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return null;
  }
}
function readMarker(name) {
  const file = markerPath(name);
  if (!existsSync(file)) return null;
  try {
    const bytes = readFileSync(file);
    if (bytes.length > 65536) return null;
    const marker = JSON.parse(bytes.toString('utf8'));
    if (!markerBelongsHere(marker)) return null;
    return Number.isInteger(marker.pid) && marker.pid > 0 && /^\d+$/.test(marker.startedAt)
      ? marker
      : null;
  } catch {
    return null;
  }
}
export function managedProcess(name) {
  const marker = readMarker(name);
  return marker && processStartedAt(marker.pid) === marker.startedAt ? marker : null;
}

export const PRIVATE_SERVICE_LOG_SCHEMA = 1;
export function requiresPrivacyRestart(marker) {
  return Boolean(marker && marker.privateLogSchema !== PRIVATE_SERVICE_LOG_SCHEMA);
}

export function markerBelongsHere(marker) {
  if (!marker || typeof marker !== 'object') return false;
  const normalize = (value) =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (typeof marker.projectRoot === 'string')
    return path.isAbsolute(marker.projectRoot) && normalize(marker.projectRoot) === normalize(root);
  // Adopt pre-migration markers only when their executable/script is inside this checkout.
  return [marker.executable, marker.args?.[0]].some(
    (value) =>
      typeof value === 'string' &&
      path.isAbsolute(value) &&
      normalize(value).startsWith(normalize(root) + path.sep),
  );
}
export function launch(name, executable, args, rt = runtime(), { onExit, env = {} } = {}) {
  const existing = managedProcess(name);
  if (existing) {
    onExit?.();
    return Promise.resolve(existing);
  }
  if (!executable || !existsSync(executable))
    return Promise.reject(new Error(`Executable for ${name} is missing. Run npm run doctor.`));
  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(path.dirname(markerPath(name)), { recursive: true });
  // Only the launcher may discard a previous instance's stop request. A slow
  // child must never erase a fresh request after its PID has been published.
  try {
    unlinkSync(path.join(paths.data, 'run', name + '.stop'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const logFiles = {
    stdout: path.join(paths.logs, name + '.stdout.log'),
    stderr: path.join(paths.logs, name + '.stderr.log'),
  };
  // Detached launchers cannot own filtering pipes after they exit. Do not send
  // raw child output straight to disk: it can include prompts and tool output.
  // Preserve lifecycle/error classes without personal text instead.
  for (const file of Object.values(logFiles)) {
    assertPrivatePath(file);
    if (existsSync(file)) {
      const info = lstatSync(file);
      if (!info.isFile() || info.nlink !== 1)
        throw new Error('Service log storage is unavailable.');
    }
    writeFileSync(file, '', { mode: 0o600 });
  }
  const record = (stream, value) => {
    try {
      const file = logFiles[stream];
      assertPrivatePath(file);
      const info = lstatSync(file);
      if (!info.isFile() || info.nlink !== 1) return;
      if (info.size > 1024 * 1024) writeFileSync(file, '');
      appendFileSync(
        file,
        JSON.stringify({
          ...privateLogRecord(JSON.stringify(value), { service: name, stream }),
          time: new Date().toISOString(),
        }) + '\n',
      );
    } catch {
      /* Logging must not interrupt service shutdown. */
    }
  };
  let child;
  child = spawn(executable, args, {
    cwd: root,
    env: {
      ...(name === 'ollama'
        ? ollamaNetworkEnvironment(environment(rt), paths.data)
        : environment(rt)),
      ...env,
    },
    windowsHide: true,
    // The GUI must survive a short-lived launcher. Console services inherit
    // the windowless GUI instead of requesting a new console process group.
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  child.once('error', (error) => record('stderr', { event: 'spawn-failed', code: error.code }));
  child.once('exit', (code) =>
    record(code ? 'stderr' : 'stdout', {
      event: 'exited',
      ...(Number.isInteger(code) ? { exitCode: code } : {}),
    }),
  );
  return new Promise((resolve, reject) => {
    if (onExit) child.once('exit', onExit);
    child.once('error', reject);
    child.once('spawn', () => {
      record('stdout', { event: 'started' });
      const startedAt = processStartedAt(child.pid);
      if (!startedAt) {
        child.unref();
        reject(new Error(`${name} exited during startup; see logs.`));
        return;
      }
      const marker = {
        pid: child.pid,
        startedAt,
        executable,
        args,
        projectRoot: root,
        privateLogSchema: PRIVATE_SERVICE_LOG_SCHEMA,
      };
      try {
        writeJsonAtomic(markerPath(name), marker);
        if (!onExit) child.unref();
        resolve(marker);
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
  });
}
export async function stopProcess(name) {
  const marker = readMarker(name);
  if (!marker) return;
  if (marker) {
    const supervised = marker.args?.[0]?.endsWith('gateway-host.mjs');
    const graceful = supervised || ['desktop', 'companion-voice'].includes(name);
    const timeout = supervised ? 350000 : graceful ? 60000 : 20000;
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'packages/runtime/src/host/stop-windows-process.ps1'),
          '-ProcessId',
          String(marker.pid),
          '-StartedAt',
          marker.startedAt,
          '-StopFile',
          path.join(paths.data, 'run', name + '.stop'),
          '-WaitMilliseconds',
          String(timeout),
          ...(graceful ? ['-Graceful'] : []),
        ],
        { windowsHide: true, timeout: timeout + 10000, maxBuffer: 65536 },
      );
    } else if (processStartedAt(marker.pid) === marker.startedAt) {
      if (graceful) writeFileSync(path.join(paths.data, 'run', name + '.stop'), 'stop\n');
      else process.kill(marker.pid, 'SIGTERM');
      await waitFor(() => !managedProcess(name), {
        timeout,
        interval: 100,
        label: 'Stopping ' + name,
      });
    }
  }
  // A concurrent relaunch must not lose its new marker.
  const latest = readMarker(name);
  if (latest?.pid !== marker.pid || latest?.startedAt !== marker.startedAt) return;
  try {
    unlinkSync(markerPath(name));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
