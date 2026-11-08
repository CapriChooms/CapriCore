// SPDX-License-Identifier: GPL-3.0-only
// Optional local Resolve Studio API. It never enables external scripting or
// changes application preferences. Existing projects/timelines are not deleted.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';

export function luaData(value) {
  if (typeof value === 'string')
    return (
      '"' +
      value.replace(/[\\"\x00-\x1f\x7f]/g, (c) =>
        c === '\\' || c === '"' ? '\\' + c : '\\' + c.charCodeAt(0).toString().padStart(3, '0'),
      ) +
      '"'
    );
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '{' + value.map(luaData).join(',') + '}';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .map(([k, v]) => '[' + luaData(k) + ']=' + luaData(v))
        .join(',') +
      '}'
    );
  throw Error('Unsupported Resolve request data.');
}

export function validateAssembly(args, observation) {
  if (!observation?.available || !observation.projectId)
    throw Error('Resolve scripting is unavailable.');
  if (
    typeof args.timelineName !== 'string' ||
    !args.timelineName.trim() ||
    args.timelineName.length > 100 ||
    /[\x00-\x1f]/.test(args.timelineName)
  )
    throw Error('Choose a timeline name of at most 100 characters.');
  if (!Array.isArray(args.clips) || args.clips.length < 1 || args.clips.length > 50)
    throw Error('Choose one to fifty observed clip ranges.');
  return {
    operation: 'assemble',
    projectId: observation.projectId,
    timelineName: args.timelineName,
    clips: args.clips.map((c) => {
      const source = observation.clips.find((s) => s.id === c.clipId);
      if (
        !source ||
        Object.keys(c).some((k) => !['clipId', 'startFrame', 'endFrame'].includes(k)) ||
        !Number.isSafeInteger(c.startFrame) ||
        !Number.isSafeInteger(c.endFrame) ||
        c.startFrame < 0 ||
        c.endFrame < c.startFrame ||
        c.endFrame >= source.frames
      )
        throw Error('Use current clip IDs and valid inclusive source-frame ranges.');
      return { clipId: source.id, startFrame: c.startFrame, endFrame: c.endFrame };
    }),
  };
}

export class ResolveAdapter {
  constructor({ root, bridge, allowed, spawnImpl = spawn }) {
    Object.assign(this, { root, bridge, allowed, spawnImpl });
  }
  async request(native, value, signal) {
    signal?.throwIfAborted();
    if (!this.allowed()) throw Error('Computer access was revoked.');
    const executable = native.resolveExecutable;
    if (!executable || path.basename(executable).toLowerCase() !== 'resolve.exe')
      return { available: false };
    const interpreter = path.join(path.dirname(executable), 'fuscript.exe');
    if (!existsSync(interpreter)) return { available: false };
    const live = await this.bridge({ action: 'computer_state' }, { signal });
    if (
      !['windowId', 'processId', 'startedAtTicks', 'resolveExecutable'].every(
        (k) => live[k] === native[k],
      )
    )
      throw Error('The observed Resolve application changed.');
    const parent = path.join(this.root, '.runtime/tmp');
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(path.join(parent, 'resolve-')),
      input = path.join(dir, 'request.lua');
    writeFileSync(input, 'return ' + luaData(value), 'utf8');
    try {
      return await new Promise((resolve, reject) => {
        const child = this.spawnImpl(
          interpreter,
          ['-l', 'lua', path.join(this.root, 'integrations/resolve/bridge.lua'), input],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '',
          settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(grant);
          signal?.removeEventListener('abort', abort);
          if (error) child.kill();
          error ? reject(error) : resolve(result);
        };
        const abort = () => finish(signal.reason ?? Error('Resolve task cancelled.'));
        const timer = setTimeout(
          () =>
            finish(
              Error(
                'Resolve did not confirm the operation. Inspect its current timeline before retrying.',
              ),
            ),
          20000,
        );
        const grant = setInterval(() => {
          if (!this.allowed()) finish(Error('Computer access was revoked.'));
        }, 100);
        child.stdout.on('data', (chunk) => {
          output += chunk.toString('utf8');
          if (output.length > 65536) finish(Error('Resolve response exceeded limits.'));
        });
        child.stderr.on('data', () => {}); // Native diagnostics can contain private media paths.
        child.once('error', (error) => finish(error));
        child.once('close', () => {
          try {
            const line = output.split(/\r?\n/).find((s) => s.startsWith('CAPRI_RESOLVE_RESULT:'));
            const result = JSON.parse(line?.slice(21) ?? 'null');
            if (!result || typeof result.available !== 'boolean') throw Error();
            if (result.error)
              throw Error(
                'Resolve could not complete this operation: ' + String(result.error).slice(0, 250),
              );
            finish(null, result);
          } catch (error) {
            finish(error.message ? error : Error('Resolve returned no verified result.'));
          }
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    } finally {
      try {
        unlinkSync(input);
        rmdirSync(dir);
      } catch {}
    }
  }
  async observe(native, signal) {
    if (!native.resolveExecutable) return null;
    try {
      const result = await this.request(native, { operation: 'inspect' }, signal);
      if (!result.available) return null;
      if (
        typeof result.projectId !== 'string' ||
        typeof result.projectName !== 'string' ||
        !Array.isArray(result.clips) ||
        result.clips.length > 200 ||
        result.clips.some(
          (c) =>
            typeof c.id !== 'string' ||
            typeof c.name !== 'string' ||
            !Number.isSafeInteger(c.frames) ||
            c.frames < 0,
        )
      )
        throw Error('Invalid Resolve state.');
      return { kind: 'resolve', ...result };
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }
  async execute(native, args, observation, signal) {
    const request = validateAssembly(args, observation);
    const result = await this.request(native, request, signal);
    signal?.throwIfAborted();
    const expected = request.clips.reduce((n, c) => n + c.endFrame - c.startFrame + 1, 0);
    if (
      result.available !== true ||
      result.projectId !== request.projectId ||
      result.timeline?.name !== request.timelineName ||
      result.timeline?.segments?.length !== request.clips.length ||
      result.timeline?.duration !== expected
    )
      throw Error(
        'Resolve assembly could not be verified. Inspect the new timeline before retrying.',
      );
    let cursor = result.timeline.start;
    for (let i = 0; i < request.clips.length; i++) {
      const source = request.clips[i],
        segment = result.timeline.segments[i],
        duration = source.endFrame - source.startFrame + 1;
      if (
        segment.clipId !== source.clipId ||
        segment.sourceStart !== source.startFrame ||
        segment.duration !== duration ||
        segment.start !== cursor ||
        segment.finish !== cursor + duration
      )
        throw Error(
          'Resolve clip order, trim or adjacency could not be verified. Inspect the new timeline before retrying.',
        );
      cursor = segment.finish;
    }
    const live = await this.bridge({ action: 'computer_state' }, { signal });
    if (!['windowId', 'processId', 'startedAtTicks'].every((k) => live[k] === native[k]))
      throw Error(
        'Resolve focus changed during assembly. The new timeline must be inspected before continuing.',
      );
    // Keep the private media listing transient; the journal needs only a receipt.
    return {
      ok: true,
      confirmation: `Created and saved a Resolve timeline with ${request.clips.length} video segments and ${expected} frames.`,
      windowId: native.windowId,
    };
  }
}
