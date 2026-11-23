// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { parse } = createRequire(import.meta.url)('acorn');
const functionTypes = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

function nodesOf(source) {
  const result = [];
  const visit = (node, ancestors = []) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    result.push({ node, ancestors });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, [...ancestors, node]);
      } else visit(value, [...ancestors, node]);
    }
  };
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  return result;
}

const functionAncestor = ({ ancestors }) => ancestors.find((node) => functionTypes.has(node.type));
const propertyName = (member) => (member.computed ? member.property.value : member.property.name);
const memberCall = (node, object, property) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === object &&
  propertyName(node.callee) === property;

function assertReadyBoundary(source) {
  const nodes = nodesOf(source);
  assert.equal(
    nodes.filter(
      (entry) =>
        (entry.node.type === 'AwaitExpression' ||
          (entry.node.type === 'ForOfStatement' && entry.node.await)) &&
        !functionAncestor(entry),
    ).length,
    0,
    'Electron entrypoint must finish ESM evaluation without top-level await',
  );
  const ready = nodes.filter(
    (entry) => memberCall(entry.node, 'app', 'whenReady') && !functionAncestor(entry),
  );
  assert.equal(ready.length, 1, 'One module-level readiness bootstrap is required');
  const requireBeforeReady = (predicate, description) => {
    const calls = nodes.filter(({ node }) => predicate(node));
    assert.equal(calls.length, 1, description + ' must be configured once');
    assert.equal(functionAncestor(calls[0]), undefined, description + ' must run before ready');
    assert(calls[0].node.start < ready[0].node.start, description + ' must precede readiness');
  };
  requireBeforeReady(
    (node) => memberCall(node, 'protocol', 'registerSchemesAsPrivileged'),
    'Privileged protocol registration',
  );
  for (const name of ['userData', 'sessionData', 'crashDumps'])
    requireBeforeReady(
      (node) => memberCall(node, 'app', 'setPath') && node.arguments[0]?.value === name,
      name + ' path',
    );
  requireBeforeReady(
    (node) => memberCall(node, 'app', 'requestSingleInstanceLock'),
    'Single-instance lock',
  );
  return { nodes, ready: ready[0].node };
}

const source = readFileSync(new URL('../apps/desktop/main.mjs', import.meta.url), 'utf8');

test('desktop registers its protocol and private paths synchronously before the ready bootstrap', () => {
  assertReadyBoundary(source);
});

test('desktop runtime and private stores initialize inside the asynchronous ready callback', () => {
  const { nodes, ready } = assertReadyBoundary(source);
  const bootstrap = nodes.find(
    ({ node }) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      propertyName(node.callee) === 'then' &&
      node.callee.object === ready,
  )?.node;
  assert(bootstrap, 'Readiness must invoke runtime initialization');
  const callback = bootstrap.arguments[0];
  const initializer =
    callback?.type === 'Identifier'
      ? nodes.find(
          ({ node, ancestors }) =>
            node.type === 'FunctionDeclaration' &&
            node.id.name === callback.name &&
            ancestors.every((ancestor) => !functionTypes.has(ancestor.type)),
        )?.node
      : callback;
  assert(initializer?.async, 'Runtime initialization must be an async ready callback');
  for (const name of ['runtime', 'readLegacyPrivateStorage']) {
    const calls = nodes.filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === name,
    );
    assert(calls.length > 0, name + ' must remain part of initialization');
    for (const { ancestors } of calls)
      assert(ancestors.includes(initializer), name + ' must wait for Electron readiness');
  }
  const stores = nodes.filter(
    ({ node }) =>
      node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'TranscriptStore',
  );
  assert(stores.length > 0);
  for (const { ancestors } of stores)
    assert(ancestors.includes(initializer), 'Transcript stores must wait for readiness');
});

test('startup-order guard catches the prior ESM deadlock and late protocol or session setup', () => {
  const fixture = (inside = '') => `
    app.setPath('userData', 'profile');
    app.setPath('sessionData', 'profile');
    app.setPath('crashDumps', 'crashes');
    protocol.registerSchemesAsPrivileged([]);
    app.requestSingleInstanceLock();
    async function start() { ${inside} }
    app.whenReady().then(start);
  `;
  assert.doesNotThrow(() => assertReadyBoundary(fixture('await protectData();')));
  assert.throws(
    () => assertReadyBoundary('await app.whenReady();\n' + fixture()),
    /top-level await/,
  );
  assert.throws(
    () =>
      assertReadyBoundary(
        fixture('protocol.registerSchemesAsPrivileged([]);').replace(
          'protocol.registerSchemesAsPrivileged([]);',
          '',
        ),
      ),
    /Privileged protocol registration must run before ready/,
  );
  assert.throws(
    () =>
      assertReadyBoundary(
        fixture("app.setPath('sessionData', 'profile');").replace(
          "app.setPath('sessionData', 'profile');",
          '',
        ),
      ),
    /sessionData path must run before ready/,
  );
});
