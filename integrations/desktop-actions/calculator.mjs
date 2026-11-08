// SPDX-License-Identifier: GPL-3.0-only
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const CALCULATOR_PROPERTIES = {
  mode: { type: 'string', enum: ['scientific', 'programmer', 'convert', 'date'] },
  angleUnit: {
    type: 'string',
    enum: ['deg', 'rad', 'grad'],
    description: 'Trigonometric angle unit. Default degrees, as in Windows Calculator.',
  },
  bits: { type: 'integer', enum: [8, 16, 32, 64] },
  value: { type: 'string', maxLength: 120 },
  fromUnit: { type: 'string', maxLength: 64 },
  toUnit: { type: 'string', maxLength: 64 },
  fromDate: { type: 'string', maxLength: 10 },
  toDate: { type: 'string', maxLength: 10 },
  amount: { type: 'integer', minimum: -1000000, maximum: 1000000 },
  dateUnit: { type: 'string', enum: ['days', 'months', 'years'] },
  showWindow: {
    type: 'boolean',
    description:
      'Open Windows Calculator only when the owner requests the app. The verified advanced numeric result is returned separately.',
  },
};
export function validateCalculation(command) {
  const mode = command.mode ?? 'scientific';
  if (!['scientific', 'programmer', 'convert', 'date'].includes(mode))
    throw Error('Unknown calculator mode.');
  const allowed = new Set([
    'action',
    'app',
    'mode',
    'showWindow',
    ...{
      scientific: ['expression', 'angleUnit'],
      programmer: ['expression', 'bits'],
      convert: ['value', 'fromUnit', 'toUnit'],
      date: ['fromDate', 'toDate', 'amount', 'dateUnit'],
    }[mode],
  ]);
  if (
    Object.keys(command).some((key) => !allowed.has(key)) ||
    command.app !== 'calculator' ||
    (command.showWindow !== undefined && typeof command.showWindow !== 'boolean')
  )
    throw Error('Invalid calculator arguments for this mode.');
  if (
    ['scientific', 'programmer'].includes(mode) &&
    (typeof command.expression !== 'string' ||
      !command.expression.trim() ||
      command.expression.length > 1200 ||
      /[^\p{L}\p{N} +*/^%!().,\-×÷π²³&|~<>]/u.test(command.expression))
  )
    throw Error('Use a numeric expression of at most 1200 characters.');
  if (command.angleUnit !== undefined && !['deg', 'rad', 'grad'].includes(command.angleUnit))
    throw Error('Choose degrees, radians or gradians.');
  if (command.bits !== undefined && ![8, 16, 32, 64].includes(command.bits))
    throw Error('Choose an 8, 16, 32 or 64 bit word.');
  if (
    mode === 'convert' &&
    ['value', 'fromUnit', 'toUnit'].some(
      (key) =>
        typeof command[key] !== 'string' ||
        !command[key].trim() ||
        command[key].length > (key === 'value' ? 120 : 64),
    )
  )
    throw Error('Supply a value and both units.');
  if (
    mode === 'date' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(command.fromDate ?? '') ||
      (command.toDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(command.toDate)) ||
      (command.toDate === undefined &&
        (!Number.isSafeInteger(command.amount) ||
          Math.abs(command.amount) > 1000000 ||
          !['days', 'months', 'years'].includes(command.dateUnit))) ||
      (command.toDate !== undefined &&
        (command.amount !== undefined || command.dateUnit !== undefined)))
  )
    throw Error('Use ISO dates and either an end date or a bounded date offset.');
  return { ...command, mode };
}
/** No filesystem/network capability is exposed to expressions. Heavy work cannot block Electron. */
export function calculate(command, { signal, timeoutMs = 5000, root } = {}) {
  const value = validateCalculation(command);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const workerFile = root
      ? pathToFileURL(path.join(root, 'integrations/desktop-actions/math-worker.mjs'))
      : new URL('./math-worker.mjs', import.meta.url);
    const worker = new Worker(workerFile, {
      workerData: value,
      execArgv: [],
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(
      () => finish(Error('Calculation exceeded its time limit. Use a smaller expression.')),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (reply) =>
      reply.ok ? finish(null, reply) : finish(Error(reply.error)),
    );
    worker.once('error', () => finish(Error('The calculation worker could not finish.')));
    worker.once('exit', () => {
      if (!settled) finish(Error('The calculation worker stopped before returning a result.'));
    });
  });
}
