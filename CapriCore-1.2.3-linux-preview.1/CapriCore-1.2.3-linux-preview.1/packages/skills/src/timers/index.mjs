// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput } from '../../../skill-sdk/src/index.mjs';
import { TimeConversation } from './conversation.mjs';

export const timerSkill = {
  manifest: {
    id: 'capri.timers',
    version: '1.0.0',
    apiVersion: 1,
    requires: ['createTimeService', 'formatElapsed'],
    commands: {
      start: { input: noInput, output: noInput, sources: ['host'] },
      suspend: { input: noInput, output: noInput, sources: ['host'] },
      snapshot: { input: noInput, output: Array.isArray, sources: ['host', 'settings'] },
      execute: { input: isRecord, output: isRecord, sources: ['host', 'settings', 'tool'] },
      read: {
        input: (value) => typeof value === 'string',
        output: (value) => value === null || typeof value === 'string',
        sources: ['host'],
      },
      observe: { input: isRecord, output: noInput, sources: ['host'] },
      context: { input: noInput, output: (value) => typeof value === 'string', sources: ['host'] },
      clear: { input: noInput, output: noInput, sources: ['host'] },
    },
    events: { changed: Array.isArray },
    ui: { sectionId: 'time', labelKey: 'Timers and reminders' },
  },
  create({ ports, emit }) {
    const service = ports.createTimeService((objects) => emit('changed', objects));
    const conversation = new TimeConversation({
      service: () => service,
      formatElapsed: ports.formatElapsed,
    });
    return {
      invoke(command, input, { requestId }) {
        switch (command) {
          case 'start':
            return service.start();
          case 'suspend':
            return service.suspend();
          case 'snapshot':
            return service.snapshot();
          case 'execute':
            return service.execute(requestId, input);
          case 'read':
            return conversation.read(input);
          case 'observe':
            return conversation.observe(undefined, input);
          case 'context':
            return conversation.context();
          case 'clear':
            conversation.focus = null;
            return;
        }
      },
      dispose: () => service.close(),
    };
  },
};

export function timerClient(core) {
  const skillId = timerSkill.manifest.id;
  const host = (command, input) => core.call({ skillId, command, input }, { source: 'host' });
  return {
    start: () => host('start'),
    suspend: () => host('suspend'),
    snapshot: () => host('snapshot'),
    conversation: {
      read: (text) => host('read', text),
      observe: (_args, result) => host('observe', result),
      context: () => host('context'),
      clear: () => host('clear'),
    },
    execute: (requestId, input, { source = 'host', signal } = {}) =>
      core.call({ skillId, command: 'execute', requestId, input }, { source, signal }),
  };
}
