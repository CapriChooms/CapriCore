// SPDX-License-Identifier: GPL-3.0-only
const binaryButtons = new Map([
  ['+', 'plus'],
  ['-', 'minus'],
  ['*', 'multiply'],
  ['/', 'divide'],
  ['^', 'power'],
  ['mod', 'mod'],
]);
const functionButtons = new Map([
  ['abs', 'abs'],
  ['sqrt', 'sqrt'],
  ['square', 'square'],
  ['factorial', 'factorial'],
  ['ln', 'ln'],
  ['log', 'ln'],
  ['log10', 'log10'],
]);

/** Translate the validated math tree into Windows Calculator button presses. */
export function calculatorInput(tree) {
  const buttons = [];
  function enter(node, grouped = false) {
    if (buttons.length > 96) return false;
    if (node.isParenthesisNode) return enter(node.content, true);
    if (node.isConstantNode) {
      const value = node.value.toExponential();
      const [digits, exponent] = value.split('e');
      if (Math.abs(Number(exponent)) > 32 || digits.length > 32) return false;
      buttons.push(...node.value.toFixed());
      return true;
    }
    if (node.isSymbolNode && ['pi', 'e'].includes(node.name)) {
      buttons.push(node.name);
      return true;
    }
    const args = node.args;
    const name = node.isOperatorNode ? node.op : node.fn?.name;
    if (args?.length === 2) {
      const button = binaryButtons.get(name === 'pow' ? '^' : name);
      if (!button) return false;
      if (grouped) buttons.push('open');
      if (!enter(args[0], true)) return false;
      buttons.push(button);
      if (!enter(args[1], true)) return false;
      if (grouped) buttons.push('close');
      return true;
    }
    if (args?.length !== 1 || !enter(args[0], true)) return false;
    if (name === '+') return true;
    const button = name === '-' ? 'negate' : name === '!' ? 'factorial' : functionButtons.get(name);
    if (!button) return false;
    buttons.push(button);
    return true;
  }
  return enter(tree) && buttons.length <= 96 ? buttons.join(' ') : null;
}
