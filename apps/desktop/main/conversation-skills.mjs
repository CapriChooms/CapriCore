// SPDX-License-Identifier: GPL-3.0-only
import {
  attachmentViewerSkill,
  brainSkill,
  fileAccessSkill,
  initiativeSkill,
  privateMemorySkill,
} from '../../../packages/skills/src/conversation-tools.mjs';
import { ownerMemorySkill } from '../../../packages/skills/src/owner-memory.mjs';

/** Only these local operations reach the ordinary memory store. The vault is separate. */
export function createOwnerMemory(core, ports) {
  core.register(ownerMemorySkill, ports);
  const skillId = ownerMemorySkill.manifest.id;
  return {
    save: (input, { source, requestId, signal }) =>
      core.call({ skillId, command: 'save', input, requestId }, { source, signal }),
    recall: (input, { requestId, signal }) =>
      core.call({ skillId, command: 'recall', input, requestId }, { source: 'chat', signal }),
    read: () => core.call({ skillId, command: 'read' }, { source: 'settings' }),
    clear: () => core.call({ skillId, command: 'clear' }, { source: 'host' }),
  };
}

/** Keep Settings window, session and native-picker checks at the Electron entry points. */
export function createConversationSkills(
  core,
  { initiative, brain, privateMemory, files, attachments },
) {
  const knowledge = brain.service;
  const vault = privateMemory.service;
  const { permissions, snapshot: fileSnapshot } = files;

  core.register(initiativeSkill, initiative);
  core.register(brainSkill, {
    status: () => knowledge.snapshot(),
    open: brain.open,
    refresh: () => knowledge.refresh(),
    search: (query) => knowledge.search(query),
    configure: (value) => knowledge.configure(value),
    context: ({ query, remote }) => knowledge.context(query, { remote }),
  });
  core.register(privateMemorySkill, {
    status: () => vault.snapshot(),
    lock() {
      vault.lock();
      return vault.snapshot();
    },
    create: (password) => vault.unlock(password, { create: true }),
    unlock: (password) => vault.unlock(password),
    list: () => vault.list(),
    add: (text) => vault.add(text),
    remove: (id) => vault.remove(id),
    password: ({ oldPassword, password }) => vault.changePassword(oldPassword, password),
  });
  core.register(fileAccessSkill, {
    snapshot: fileSnapshot,
    grant(root) {
      permissions.grant(root);
      return fileSnapshot();
    },
    write({ id, write }) {
      permissions.update(id, write);
      return fileSnapshot();
    },
    revoke(id) {
      permissions.revoke(id);
      return fileSnapshot();
    },
    clear() {
      permissions.save([]);
      return fileSnapshot();
    },
  });
  core.register(attachmentViewerSkill, { open: attachments.open });

  const caller =
    ({ manifest: { id: skillId } }) =>
    (command, input, source) =>
      core.call({ skillId, command, input }, { source });
  const initiativeCall = caller(initiativeSkill);
  const brainCall = caller(brainSkill);
  const privateMemoryCall = caller(privateMemorySkill);
  const fileCall = caller(fileAccessSkill);
  const attachmentCall = caller(attachmentViewerSkill);

  return {
    initiative: {
      configure: (value, source) => initiativeCall('configure', value, source),
      dismiss: (source) => initiativeCall('dismiss', undefined, source),
      restore: (source) => initiativeCall('restore', undefined, source),
      test: (source) => initiativeCall('test', undefined, source),
      snapshot: () => initiativeCall('snapshot', undefined, 'host'),
    },
    brain: {
      settings(value) {
        switch (value.action) {
          case 'status':
          case 'open':
          case 'refresh':
            return brainCall(value.action, undefined, 'settings');
          case 'search':
            return brainCall('search', value.query, 'settings');
          case 'configure':
            return brainCall(
              'configure',
              { enabled: value.enabled, shareWithApi: value.shareWithApi },
              'settings',
            );
          default:
            throw new Error('Invalid Brain action.');
        }
      },
      context: (query, { remote = false } = {}) => brainCall('context', { query, remote }, 'chat'),
    },
    privateMemory: {
      settings(value) {
        switch (value.action) {
          case 'status':
          case 'lock':
          case 'list':
            return privateMemoryCall(value.action, undefined, 'settings');
          case 'create':
          case 'unlock':
            return privateMemoryCall(value.action, value.password, 'settings');
          case 'add':
            return privateMemoryCall('add', value.text, 'settings');
          case 'remove':
            return privateMemoryCall('remove', value.id, 'settings');
          case 'password':
            return privateMemoryCall(
              'password',
              { oldPassword: value.oldPassword, password: value.password },
              'settings',
            );
          default:
            throw new Error('Invalid private-memory action.');
        }
      },
    },
    files: {
      snapshot: () => fileCall('snapshot', undefined, 'host'),
      grant: (root, source) => fileCall('grant', root, source),
      write: (value, source) => fileCall('write', value, source),
      revoke: (id, source) => fileCall('revoke', id, source),
      clear: (source) => fileCall('clear', undefined, source),
    },
    attachments: {
      open: async (id) =>
        typeof id === 'string' ? attachmentCall('open', id, 'companion') : false,
    },
  };
}
