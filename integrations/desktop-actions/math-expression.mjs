// SPDX-License-Identifier: GPL-3.0-only
export const SCIENTIFIC_FUNCTIONS = Object.freeze([
  'abs',
  'sqrt',
  'cbrt',
  'nthRoot',
  'square',
  'cube',
  'pow',
  'exp',
  'expm1',
  'log',
  'ln',
  'log10',
  'log2',
  'log1p',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sec',
  'csc',
  'cot',
  'asec',
  'acsc',
  'acot',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'sech',
  'csch',
  'coth',
  'asech',
  'acsch',
  'acoth',
  'factorial',
  'combinations',
  'permutations',
  'mod',
  'gcd',
  'lcm',
  'floor',
  'ceil',
  'round',
  'fix',
  'sign',
  'hypot',
]);
export const SCIENTIFIC_CONSTANTS = Object.freeze(['pi', 'e', 'tau', 'phi']);

export function normalizeMathExpression(expression) {
  return expression
    .replace(/\*\*/g, '^')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3');
}

const functions = new Set(SCIENTIFIC_FUNCTIONS);
const constants = new Set(SCIENTIFIC_CONSTANTS);
const binaryOperators = new Set(['+', '-', '*', '/', '^', 'mod']);

/** Recognize an entire numeric request cheaply; evaluation stays in the bounded worker. */
export function isScientificExpression(expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 1200)
    return false;
  const value = normalizeMathExpression(expression);
  const token =
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|([A-Za-z][A-Za-z0-9]*)|([+*/^!%(),-]))/y;
  const tokens = [];
  while (token.lastIndex < value.length) {
    const match = token.exec(value);
    if (!match || tokens.length >= 256) return false;
    tokens.push({ value: match[0].trim(), number: match[1] !== undefined });
    if (!value.slice(token.lastIndex).trim()) break;
  }
  let index = 0;
  const peek = () => tokens[index]?.value;
  const take = (expected) => peek() === expected && (++index, true);
  function operand(depth) {
    if (depth > 48) return false;
    while (peek() === '+' || peek() === '-') index++;
    if (tokens[index]?.number || constants.has(peek())) index++;
    else if (take('(')) {
      if (!expressionAt(depth + 1) || !take(')')) return false;
    } else if (functions.has(peek())) {
      index++;
      if (!take('(') || !expressionAt(depth + 1)) return false;
      let argumentsCount = 1;
      while (take(',')) {
        if (++argumentsCount > 8 || !expressionAt(depth + 1)) return false;
      }
      if (!take(')')) return false;
    } else return false;
    while (peek() === '!' || peek() === '%') index++;
    return true;
  }
  function expressionAt(depth) {
    if (!operand(depth)) return false;
    while (index < tokens.length) {
      if (binaryOperators.has(peek())) index++;
      // mathjs also accepts implicit multiplication such as 2pi and 2(3+4).
      else if (peek() !== '(' && !functions.has(peek()) && !constants.has(peek())) break;
      if (!operand(depth)) return false;
    }
    return true;
  }
  return expressionAt(0) && index === tokens.length;
}
