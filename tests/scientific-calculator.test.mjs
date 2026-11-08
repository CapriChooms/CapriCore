// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateCalculation } from '../integrations/desktop-actions/calculator.mjs';
const command = (expression, options = {}) => ({
  action: 'calculate',
  app: 'calculator',
  showWindow: false,
  expression,
  ...options,
});
test('precise scientific, percent, programmer, unit and calendar calculations run outside the UI thread', async () => {
  for (const [expression, expected, options] of [
    ['0.1+0.2', '0.3'],
    ['sqrt(1036)', '32.18695387886216'],
    ['nthRoot(125,3)', '5'],
    ['log(8,2)', '3'],
    ['2^10 + 3²', '1033'],
    ['3**4 + factorial(6) - sqrt(949)', '770.1941563985013'],
    ['2**3**2', '512'],
    ['-2**2', '-4'],
    ['2**-3', '0.125'],
    ['sin(30)', '0.5'],
    ['sin(pi/2)', '1', { angleUnit: 'rad' }],
    ['100+10%', '110'],
    ['factorial(6)', '720'],
  ])
    assert.equal(
      (await calculate(command(expression, options))).displayResult,
      expected,
      expression,
    );
  const bits = await calculate(command('0xff & 0x0f', { mode: 'programmer', bits: 8 }));
  assert.equal(bits.result, '15');
  assert.equal(bits.hex, 'F');
  assert.equal(bits.binary, '00001111');
  const convert = await calculate({
    action: 'calculate',
    app: 'calculator',
    mode: 'convert',
    value: '100',
    fromUnit: 'degC',
    toUnit: 'degF',
  });
  assert.equal(convert.result, '212');
  const date = await calculate({
    action: 'calculate',
    app: 'calculator',
    mode: 'date',
    fromDate: '2024-02-28',
    amount: 2,
    dateUnit: 'days',
  });
  assert.equal(date.result, '2024-03-01');
});
test('expressions cannot execute code, access objects, assign variables or perform unbounded work', async () => {
  for (const expression of [
    'import(1)',
    'evaluate(1)',
    'parse(1)',
    'a=1',
    '[1,2]',
    'sqrt.constructor(1)',
    'factorial(10001)',
    '2^1000001',
    '2**1000001',
    '3***4',
    'import(1)**2',
  ]) {
    await assert.rejects(async () => calculate(command(expression)), undefined, expression);
  }
  assert.throws(() => validateCalculation(command('1;2')));
  await assert.rejects(calculate(command('1+1'), { timeoutMs: 1 }), /time limit/);
  const controller = new AbortController();
  const pending = calculate(command('1+1'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
