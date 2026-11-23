import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import plugin from '../integrations/companion-tools/index.mjs';
import { UserTools } from '../apps/desktop/user-tools.mjs';
import { CompanionActions } from '../apps/desktop/companion-actions.mjs';
const parent = path.resolve('.runtime/0.6.2/tool-bridge');
mkdirSync(parent, { recursive: true });
test('owner-only model definitions route validated tool calls through the authenticated host bridge and never include secrets', async () => {
  const root = mkdtempSync(path.join(parent, 'case-')),
    data = path.join(root, 'data'),
    state = path.join(data, 'desktop');
  mkdirSync(state, { recursive: true });
  const userTools = new UserTools({
    root: process.cwd(),
    data,
    state,
    node: process.execPath,
    storage: {
      available: async () => true,
      encrypt: async (value) => Buffer.from(value),
      decrypt: async (value) => value.toString(),
    },
    runner: async ({ parameters, settings }) => ({
      echo: parameters.text,
      secret: settings.apiKey,
    }),
  });
  await userTools.ready;
  const folder = path.join(userTools.folder, 'echo');
  mkdirSync(folder);
  writeFileSync(
    path.join(folder, 'manifest.json'),
    JSON.stringify({
      version: 1,
      name: 'echo',
      description: 'Echo a supplied test phrase.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      runtime: 'node',
      entry: 'main.mjs',
      permissions: { network: false, files: 'none' },
    }),
  );
  writeFileSync(path.join(folder, 'main.mjs'), '// owned synthetic code');
  await userTools.refresh();
  await userTools.enable('echo', true);
  await userTools.saveSettings('echo', { apiKey: 'synthetic-settings-secret' });
  const actions = new CompanionActions({
    root,
    emit() {},
    deliver: async () => {},
    settings: () => ({}),
    desktop: { close() {} },
    userTools,
  });
  await actions.start();
  try {
    const definitions = new Map();
    plugin.register({
      source: path.resolve('integrations/companion-tools/index.mjs'),
      pluginConfig: { endpointRoot: path.relative(process.cwd(), root) },
      registerTool: (factory, options) => definitions.set(options.name, factory),
    });
    const {
      tools: [definition],
    } = JSON.parse(readFileSync(userTools.publicFile, 'utf8'));
    const factory = definitions.get(definition.name),
      context = {
        agentId: 'capri',
        senderIsOwner: true,
        messageChannel: 'webchat',
        sessionKey: 'owned-test',
        sessionId: 'one',
        assertInvocationCurrent() {},
      };
    assert.equal(factory.create({ ...context, senderIsOwner: false }), null);
    const tool = factory.create(context);
    assert.equal(tool.parameters.properties.text.type, 'string');
    assert(!JSON.stringify(tool).includes('synthetic-settings'));
    const response = await tool.execute(
      'test-call',
      { text: 'hello' },
      new AbortController().signal,
    );
    assert.equal(response.isError, false);
    assert.deepEqual(response.details.data, { echo: 'hello', secret: '[redacted]' });
    const invalid = await tool.execute('bad-call', { unknown: 'x' }, new AbortController().signal);
    assert.equal(invalid.isError, true);
    await userTools.enable('echo', false);
    assert.equal(factory.create(context), null);
  } finally {
    actions.close();
    userTools.close();
  }
});
