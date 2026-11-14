// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeJsonAtomic } from './storage.mjs';
import { prepareNativeHelper } from './native-helper.mjs';
const actions = new Set(['click', 'drag', 'keys', 'scroll', 'text']);
const keys =
  /^(CTRL|SHIFT|ALT|WIN|ENTER|TAB|SPACE|BACKSPACE|DELETE|INSERT|HOME|END|PAGEUP|PAGEDOWN|LEFT|RIGHT|UP|DOWN|F(?:[1-9]|1\d|2[0-4])|[A-Z0-9])$/;
const selectorValid = (value) =>
  value &&
  typeof value.label === 'string' &&
  value.label.length <= 100 &&
  typeof value.role === 'string' &&
  value.role.length <= 80 &&
  typeof value.automationId === 'string' &&
  value.automationId.length <= 100;
export function validateWorkflow(value) {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80 ||
    !Array.isArray(value.steps) ||
    !value.steps.length ||
    value.steps.length > 120
  )
    throw new Error('Use a workflow name and 1–120 steps.');
  const steps = value.steps.map((step) => {
    if (
      !step ||
      !actions.has(step.action) ||
      typeof step.executable !== 'string' ||
      !path.isAbsolute(step.executable) ||
      !step.executable.toLowerCase().endsWith('.exe') ||
      step.executable.startsWith('\\\\') ||
      !Number.isInteger(step.delayMs) ||
      step.delayMs < 0 ||
      step.delayMs > 3000
    )
      throw new Error('Invalid workflow step.');
    const result = { action: step.action, executable: step.executable, delayMs: step.delayMs };
    if (['click', 'drag', 'text'].includes(step.action)) {
      if (!selectorValid(step.selector))
        throw new Error('Choose an accessible target for this step.');
      result.selector = {
        label: step.selector.label,
        role: step.selector.role,
        automationId: step.selector.automationId,
      };
    }
    if (step.action === 'drag') {
      if (!selectorValid(step.to)) throw new Error('Choose an accessible drag destination.');
      result.to = { label: step.to.label, role: step.to.role, automationId: step.to.automationId };
      if (step.trajectory != null) {
        if (
          !Array.isArray(step.trajectory) ||
          step.trajectory.length > 24 ||
          step.trajectory.some(
            (point) =>
              !point ||
              ![point.x, point.y].every(
                (value) => Number.isFinite(value) && value >= 0 && value < 1,
              ),
          )
        )
          throw new Error('Invalid recorded drag path.');
        result.trajectory = step.trajectory.map(({ x, y }) => ({ x, y }));
      }
    }
    if (step.action === 'click') {
      if (!['left', 'right'].includes(step.button ?? 'left'))
        throw new Error('Invalid click button.');
      result.button = step.button ?? 'left';
    }
    if (step.action === 'keys') {
      if (
        !Array.isArray(step.keys) ||
        !step.keys.length ||
        step.keys.length > 4 ||
        step.keys.some((key) => !keys.test(key))
      )
        throw new Error('Invalid workflow shortcut.');
      result.keys = [...step.keys];
    }
    if (step.action === 'scroll') {
      if (!Number.isInteger(step.amount) || !step.amount || Math.abs(step.amount) > 10)
        throw new Error('Invalid scroll step.');
      result.amount = step.amount;
    }
    if (step.action === 'text') {
      if (typeof step.text !== 'string' || step.text.length > 2000 || !step.text.trim())
        throw new Error('Enter text or a {{variable}} for the text step.');
      result.text = step.text;
    }
    return result;
  });
  return {
    id: typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) ? value.id : randomUUID(),
    name: value.name.trim(),
    steps,
  };
}
/** Records only after an owner click and replays using the same guarded input path as computer control. */
export class TaskWorkflows {
  constructor({
    root,
    data,
    control,
    catalog,
    allowed,
    turn,
    changed = () => {},
    spawnImpl = spawn,
  }) {
    Object.assign(this, { root, control, catalog, allowed, turn, changed, spawnImpl });
    this.folder = path.join(data, 'workflows');
    mkdirSync(this.folder, { recursive: true });
    this.file = path.join(this.folder, 'workflows.json');
    this.draft = [];
  }
  list() {
    if (!existsSync(this.file)) return [];
    const info = lstatSync(this.file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 512 * 1024)
      throw new Error('Invalid workflow file.');
    const rows = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!Array.isArray(rows) || rows.length > 30) throw new Error('Invalid workflow list.');
    return rows.map(validateWorkflow);
  }
  snapshot() {
    return {
      recording: Boolean(this.recorder),
      playing: Boolean(this.playing),
      count: this.draft.length,
    };
  }
  publish() {
    this.changed(this.snapshot());
  }
  save(value) {
    if (this.playing || this.recorder) throw new Error('Stop recording or playback first.');
    const workflow = validateWorkflow(value),
      rows = this.list().filter((row) => row.id !== workflow.id);
    if (rows.length >= 30) throw new Error('Remove a workflow first.');
    rows.push(workflow);
    if (Buffer.byteLength(JSON.stringify(rows)) > 512 * 1024)
      throw new Error('Workflow storage is full.');
    writeJsonAtomic(this.file, rows);
    return this.list();
  }
  remove(id) {
    if (this.playing) throw new Error('Stop playback first.');
    writeJsonAtomic(
      this.file,
      this.list().filter((row) => row.id !== id),
    );
    return this.list();
  }
  async start() {
    if (this.recorder || this.playing)
      throw new Error('Stop the current workflow operation first.');
    const executable = await prepareNativeHelper(this.root, 'task-recorder', [
      'System.Windows.Forms.dll',
      'WPF/UIAutomationClient.dll',
      'WPF/UIAutomationTypes.dll',
      'WPF/WindowsBase.dll',
    ]);
    if (this.closed) throw new Error('Workflows are closed.');
    this.draft = [];
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    const child = (this.recorder = this.spawnImpl(executable, [String(process.pid)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        SystemRoot: windows,
        WINDIR: windows,
        PATH: path.join(windows, 'System32'),
        TEMP: this.folder,
        TMP: this.folder,
      },
    }));
    let output = '',
      bytes = 0;
    this.stopped = new Promise((resolve) =>
      child.once('close', () => {
        if (this.recorder === child) this.recorder = null;
        this.publish();
        resolve(this.draft.map((step) => structuredClone(step)));
      }),
    );
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('The recorder did not start.'));
      }, 5000);
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('The recorder could not start.'));
      });
      child.once('close', () => {
        clearTimeout(timer);
        reject(new Error('The recorder stopped before starting.'));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 512 * 1024) {
          child.kill();
          return;
        }
        output += chunk;
        for (let newline; (newline = output.indexOf('\n')) >= 0; ) {
          const line = output.slice(0, newline);
          output = output.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'armed') {
              clearTimeout(timer);
              resolve(this.snapshot());
              this.publish();
            } else if (event.type === 'step' && this.draft.length < 120) {
              this.draft.push(
                validateWorkflow({ name: 'Recorded draft', steps: [event.step] }).steps[0],
              );
              this.publish();
            }
          } catch {
            child.kill();
          }
        }
      });
    });
    child.stdin.on('error', () => {});
    this.recorderTimer = setTimeout(() => child.kill(), 123000);
    this.recorderTimer.unref?.();
    void this.stopped.finally(() => clearTimeout(this.recorderTimer));
    return started;
  }
  async stopRecording() {
    if (!this.recorder) return structuredClone(this.draft);
    this.recorder.stdin.end('stop\n');
    const child = this.recorder;
    const timer = setTimeout(() => child.kill(), 2000);
    try {
      return await this.stopped;
    } finally {
      clearTimeout(timer);
    }
  }
  match(view, selector) {
    const candidates = view.targets.filter(
      (target) =>
        target.role === selector.role &&
        (!selector.automationId || target.automationId === selector.automationId) &&
        (!selector.label || target.untrustedLabel === selector.label),
    );
    if (candidates.length !== 1)
      throw new Error(
        'A workflow target is missing or ambiguous. No input was sent. Re-record or edit the step.',
      );
    return candidates[0].targetId;
  }
  async run(id, variables = {}, signal) {
    if (this.playing || this.recorder || this.control.session)
      throw new Error('Stop the current computer task first.');
    if (!this.allowed()) throw new Error('Enable full computer access before running a workflow.');
    const workflow = this.list().find((row) => row.id === id);
    if (!workflow) throw new Error('Choose an existing workflow.');
    if (
      !variables ||
      Object.getPrototypeOf(variables) !== Object.prototype ||
      Object.entries(variables).some(
        ([key, value]) =>
          !/^\w{1,40}$/.test(key) || typeof value !== 'string' || value.length > 2000,
      )
    )
      throw new Error('Invalid workflow variables.');
    const controller = (this.playing = new AbortController()),
      combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const turnId = randomUUID();
    this.turn(turnId);
    this.publish();
    try {
      await this.control.begin('Replay owner-reviewed workflow: ' + workflow.name, {
        maxSteps: Math.min(400, workflow.steps.length * 3 + 5),
        signal: combined,
      });
      let previous;
      for (const step of workflow.steps) {
        this.publish();
        combined.throwIfAborted();
        if (!this.allowed()) throw new Error('Application access was revoked.');
        this.control.requireSession();
        if (step.executable !== previous) {
          const app = this.catalog.rememberApplication(step.executable);
          await this.catalog.execute(
            randomUUID(),
            { action: 'launch', appId: app.id },
            null,
            combined,
          );
          previous = step.executable;
        }
        if (step.delayMs) await delay(step.delayMs, undefined, { signal: combined });
        const view = await this.control.execute({ action: 'observe', vision: false }, combined);
        if (this.control.session.target.executable?.toLowerCase() !== step.executable.toLowerCase())
          throw new Error('The workflow foreground application changed.');
        const args = { observationId: view.observationId };
        if (step.action === 'keys')
          Object.assign(args, { action: 'press_keys', keys: step.keys, holdMs: 60 });
        if (step.action === 'scroll')
          Object.assign(args, { action: 'scroll', amount: step.amount });
        if (['click', 'drag', 'text'].includes(step.action))
          args.targetId = this.match(view, step.selector);
        if (step.action === 'click') Object.assign(args, { action: 'click', button: step.button });
        if (step.action === 'drag')
          Object.assign(args, { action: 'drag', toTargetId: this.match(view, step.to) });
        if (step.action === 'text')
          Object.assign(args, {
            action: 'enter_text',
            mode: 'replace',
            text: step.text.replace(/\{\{(\w{1,40})\}\}/g, (_, key) => {
              if (!Object.hasOwn(variables, key))
                throw new Error('A workflow variable is missing: ' + key);
              return variables[key];
            }),
          });
        await this.control.execute(args, combined, {
          workflowPath: step.trajectory,
          ...(step.action === 'click' && { recordedClick: true }),
        });
        // Fresh accessibility observation after every mutation; no claimed model verification.
        await this.control.execute({ action: 'observe', vision: false }, combined);
      }
      return {
        ok: true,
        steps: workflow.steps.length,
        confirmation: 'Executed the recorded steps. Check the final application result.',
      };
    } finally {
      await this.control.stop();
      this.turn(null);
      this.playing = null;
      this.publish();
    }
  }
  cancel() {
    this.playing?.abort();
    if (this.recorder) void this.stopRecording();
  }
  close() {
    this.closed = true;
    this.cancel();
    this.recorder?.kill();
    clearTimeout(this.recorderTimer);
  }
}
