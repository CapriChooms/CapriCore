// SPDX-License-Identifier: GPL-3.0-only
import { parentPort, workerData as input } from 'node:worker_threads';
import mathBundle from 'mathjs/lib/browser/math.js';
import { Temporal } from '@js-temporal/polyfill';
import { SCIENTIFIC_FUNCTIONS, normalizeMathExpression } from './math-expression.mjs';
import { calculatorInput } from './calculator-input.mjs';
// One bundled module avoids loading hundreds of files on every short-lived worker.
const math = mathBundle.create({ number: 'BigNumber', precision: 64, predictable: true });
const names = new Set(SCIENTIFIC_FUNCTIONS);
const constants = new Map([
  ['pi', math.pi],
  ['e', math.e],
  ['tau', math.multiply(math.pi, 2)],
  ['phi', math.phi],
]);
const forwardAngles = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']),
  inverseAngles = new Set(['asin', 'acos', 'atan', 'atan2', 'asec', 'acsc', 'acot']);
function scalar(value) {
  if (!math.isBigNumber(value)) value = math.bignumber(value);
  if (!value.isFinite()) throw Error('The result is undefined or outside the real-number range.');
  return value;
}
let count = 0;
function visit(node, depth = 0) {
  if (++count > 256 || depth > 48) throw Error('The expression is too complex.');
  if (node.isConstantNode) {
    if (typeof node.value === 'string' || typeof node.value === 'boolean')
      throw Error('Only numeric constants are supported.');
    return scalar(node.value);
  }
  if (node.isParenthesisNode) return visit(node.content, depth + 1);
  if (node.isSymbolNode) {
    if (!constants.has(node.name)) throw Error('Unknown numeric constant.');
    return constants.get(node.name);
  }
  if (node.isOperatorNode) {
    const fn = {
      '+': node.args.length === 1 ? 'unaryPlus' : 'add',
      '-': node.args.length === 1 ? 'unaryMinus' : 'subtract',
      '*': 'multiply',
      '/': 'divide',
      '^': 'pow',
      '!': 'factorial',
      mod: 'mod',
    }[node.op];
    if (!fn) throw Error('Unsupported numeric operator.');
    return invoke(
      fn,
      node.args.map((n) => visit(n, depth + 1)),
    );
  }
  if (
    node.isFunctionNode &&
    node.fn.isSymbolNode &&
    names.has(node.fn.name) &&
    node.args.length <= 8
  )
    return invoke(
      node.fn.name,
      node.args.map((n) => visit(n, depth + 1)),
    );
  throw Error(
    'Only numeric operations are allowed: no assignments, objects, strings, arrays or code.',
  );
}
function invoke(name, args) {
  if (name === 'ln') name = 'log';
  if (
    ['factorial', 'combinations', 'permutations'].includes(name) &&
    args.some((v) => !v.isInteger() || v.isNegative() || v.gt(10000))
  )
    throw Error('Factorials and combinations require integers from 0 to 10000.');
  if (name === 'pow' && args[1]?.abs().gt(1000000)) throw Error('The exponent is too large.');
  const unit = input.angleUnit ?? 'deg';
  const ratio =
    unit === 'rad' ? math.bignumber(1) : math.divide(math.pi, unit === 'grad' ? 200 : 180);
  if (forwardAngles.has(name)) args[0] = math.multiply(args[0], ratio);
  let result = math[name](...args);
  if (inverseAngles.has(name)) result = math.divide(result, ratio);
  return scalar(result);
}
function parse(expression) {
  return math.parse(normalizeMathExpression(expression));
}
function numeric(value) {
  value = scalar(value);
  return {
    result: math.format(value, { notation: 'auto', precision: 50 }),
    displayResult: math.format(value, { notation: 'auto', precision: 16 }),
    precisionDigits: 50,
  };
}
function programmer(node, depth = 0) {
  if (++count > 256 || depth > 48) throw Error('The expression is too complex.');
  if (node.isConstantNode) {
    const value = scalar(node.value);
    if (!value.isInteger() || value.abs().gt('18446744073709551615'))
      throw Error('Use integers within 64 bits.');
    return BigInt(value.toFixed());
  }
  if (node.isParenthesisNode) return programmer(node.content, depth + 1);
  let op, args;
  if (node.isOperatorNode) {
    op = node.op;
    args = node.args;
  } else if (node.isFunctionNode && node.fn.isSymbolNode) {
    op = {
      bitAnd: '&',
      bitOr: '|',
      bitXor: 'xor',
      bitNot: '~',
      leftShift: '<<',
      rightArithShift: '>>',
      rightLogShift: '>>>',
    }[node.fn.name];
    args = node.args;
  }
  if (!op || !args || args.length > 2)
    throw Error('Use programmer arithmetic, bitwise operators or shifts.');
  const a = programmer(args[0], depth + 1),
    b = args[1] ? programmer(args[1], depth + 1) : 0n,
    bits = BigInt(input.bits ?? 64),
    mask = (1n << bits) - 1n;
  if (['<<', '>>', '>>>'].includes(op) && (b < 0n || b >= bits))
    throw Error('Shift must fit the selected word size.');
  const value = {
    '+': () => a + b,
    '-': () => (args.length === 1 ? -a : a - b),
    '*': () => a * b,
    '/': () => a / b,
    '%': () => a % b,
    mod: () => a % b,
    '&': () => a & b,
    '|': () => a | b,
    xor: () => a ^ b,
    '~': () => ~a,
    '<<': () => a << b,
    '>>': () => BigInt.asIntN(Number(bits), a) >> b,
    '>>>': () => (a & mask) >> b,
  }[op];
  if (!value) throw Error('Unsupported programmer operation.');
  return value() & mask;
}
try {
  let result;
  if (input.mode === 'programmer') {
    const bits = input.bits ?? 64,
      value = BigInt.asUintN(bits, programmer(parse(input.expression)));
    result = {
      result: value.toString(),
      signed: BigInt.asIntN(bits, value).toString(),
      hex: value.toString(16).toUpperCase(),
      binary: value.toString(2).padStart(bits, '0'),
      octal: value.toString(8),
      bits,
    };
  } else if (input.mode === 'convert') {
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,6})?$/i.test(input.value) ||
      [input.fromUnit, input.toUnit].some((u) => !/^[A-Za-zµμ°0-9/*^ .()-]{1,64}$/.test(u))
    )
      throw Error(
        'Use a numeric value and recognized physical units. Live currency rates are not guessed.',
      );
    result = {
      ...numeric(math.unit(math.bignumber(input.value), input.fromUnit).toNumeric(input.toUnit)),
      unit: input.toUnit,
    };
  } else if (input.mode === 'date') {
    const from = Temporal.PlainDate.from(input.fromDate);
    if (input.toDate) {
      const to = Temporal.PlainDate.from(input.toDate),
        calendar = from.until(to, { largestUnit: 'years' });
      result = {
        result: String(from.until(to, { largestUnit: 'days' }).days),
        days: from.until(to, { largestUnit: 'days' }).days,
        years: calendar.years,
        months: calendar.months,
        remainingDays: calendar.days,
      };
    } else result = { result: from.add({ [input.dateUnit]: input.amount }).toString() };
  } else {
    const tree = parse(input.expression);
    result = numeric(visit(tree));
    if (input.withNativeInput) result.nativeInput = calculatorInput(tree);
  }
  parentPort.postMessage({
    ok: true,
    app: 'calculator',
    engine: 'capri-precise-calculator',
    ...result,
  });
} catch (error) {
  const message = String(error.message).slice(0, 350);
  parentPort.postMessage({ ok: false, error: message });
}
