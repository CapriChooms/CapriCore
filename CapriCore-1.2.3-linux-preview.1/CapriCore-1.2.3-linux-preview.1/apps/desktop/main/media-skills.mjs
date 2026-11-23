// SPDX-License-Identifier: GPL-3.0-only
import { microphoneSkill, musicSkill, screenSkill } from '../../../packages/skills/src/media.mjs';

/** Keep exact-frame capture grants and media packets in the host. */
export function createMediaSkills(core, { microphone, music, screen }) {
  core.register(microphoneSkill, microphone);
  core.register(musicSkill, music);
  core.register(screenSkill, screen);
  const caller =
    ({ manifest: { id: skillId } }) =>
    (command, input, source, signal) =>
      core.call({ skillId, command, input }, { source, signal });
  const micCall = caller(microphoneSkill);
  const musicCall = caller(musicSkill);
  const screenCall = caller(screenSkill);
  return {
    microphone: {
      start: () => micCall('start', undefined, 'companion'),
      confirm: (id) => micCall('confirm', id, 'companion'),
      stop: (input, source = 'companion') => micCall('stop', input, source),
      listen: () => micCall('listen', undefined, 'companion'),
      snapshot: () => micCall('snapshot', undefined, 'host'),
      devices: (source) => micCall('devices', undefined, source),
      selectDevice: (id, source) => micCall('selectDevice', id, source),
    },
    music: {
      start: () => musicCall('start', undefined, 'companion'),
      ready: (id) => musicCall('ready', id, 'companion'),
      stop: (id, source = 'companion') => musicCall('stop', id, source),
      snapshot: () => musicCall('snapshot', undefined, 'host'),
      configure: (value, { role }) => musicCall('configure', value, role),
    },
    screen: {
      context: () => screenCall('context', undefined, 'chat'),
      prepare: ({ text }, { signal } = {}) => screenCall('prepare', { text }, 'chat', signal),
      snapshot: () => screenCall('snapshot', undefined, 'host'),
      stop: () => screenCall('stop', undefined, 'host'),
      configure: (value, source) => screenCall('configure', value, source),
      preferences: () => screenCall('preferences', undefined, 'host'),
    },
  };
}
