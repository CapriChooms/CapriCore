// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { computerPlanner } from '../apps/desktop/computer-planner.mjs';

const target = (targetId, untrustedLabel, ancestors, extra = {}) => ({
  targetId,
  untrustedLabel,
  role: 'ControlType.Button',
  untrustedAncestors: ancestors,
  ...extra,
});
const privateMessage = 'PRIVATE_UNRELATED_DISCORD_CONVERSATION';
const privateDraft = 'PRIVATE_UNSENT_DISCORD_DRAFT';
const privateIdentity = 'PRIVATE_DISCORD_ACCOUNT_NAME';
const privateHash = 'ab'.repeat(32);
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const discordView = () => ({
  observationId: 'native-observation',
  window: {
    windowId: 'native-discord-window',
    applicationKind: 'discord',
    untrustedTitle: '#general | Friends - Discord',
    privateDetails: privateMessage,
  },
  application: { kind: 'discord', summary: privateMessage, untrustedExtra: privateDraft },
  scene: privateMessage,
  image: privateDraft,
  screenAvailable: true,
  visionStatus: 'ready',
  privateExtra: privateMessage,
  targets: [
    target('server', 'Friends', ['Servers sidebar']),
    target('channel', 'general (text channel)', ['Channels'], { role: 'ControlType.Hyperlink' }),
    target('voice', 'Lounge (voice channel)', ['Channels'], { role: 'ControlType.Hyperlink' }),
    target('message', privateMessage, ['Chat messages'], {
      role: 'ControlType.Text',
      untrustedTextSha256: privateHash,
    }),
    target('message-button', privateMessage, ['Chat messages'], { role: 'ControlType.Button' }),
    target('identity', privateIdentity, ['User status and settings'], { role: 'ControlType.Text' }),
    target('draft', 'Message #general', ['Channel content'], {
      role: 'ControlType.Edit',
      editable: true,
      untrustedValue: privateDraft,
      untrustedValueSha256: privateHash,
    }),
    target('connected', 'Voice Connected', ['Voice controls'], { role: 'ControlType.Text' }),
    target('actual-connected', `Voice Connected ${privateIdentity}`, ['User status and settings']),
    target('disconnect', 'Disconnect', ['Voice controls']),
    target('settings', 'User Settings', ['User status and settings']),
    target('quick', 'Where would you like to go?', ['Quick Switcher'], {
      role: 'ControlType.Edit',
      editable: true,
      untrustedValue: privateDraft,
      untrustedValueSha256: privateHash,
    }),
    target('quick-result', 'general, text channel, Friends', ['Quick Switcher'], {
      role: 'ControlType.ListItem',
    }),
    target('visual', privateMessage, [], { source: 'vision' }),
  ],
});

async function inspect(state, { review = false } = {}) {
  let packet;
  const plan = computerPlanner({
    url: 'http://127.0.0.1:1234',
    model: 'fixture',
    fetchImpl: async (_url, options) => {
      packet = JSON.parse(options.body);
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify(
            review
              ? { complete: false, evidence: '', summary: '', missing: 'Not complete.' }
              : { action: 'ask_user', summary: 'Choose the channel.' },
          ),
        },
      });
    },
  });
  await plan(state, { review });
  if (review) {
    const content = packet.messages[1].content;
    const view = JSON.parse(
      content
        .split('\n\nLIVE OBSERVATION AFTER THE ACTIONS (the latest evidence):\n')[1]
        .split('\n\nPRIOR ACTIONS AND PLAN:\n')[0],
    );
    return {
      packet,
      context: {
        currentObservation: {
          ...view,
          targets: view.controls.map(({ label, value, ...target }) => ({
            ...target,
            untrustedLabel: label,
            untrustedValue: value,
          })),
        },
      },
    };
  }
  return {
    packet,
    context: JSON.parse(packet.messages[1].content.split('\n\nORIGINAL OWNER GOAL')[0]),
  };
}

test('native Discord planning and review withhold unrelated messages, account names, drafts, hashes and images', async () => {
  for (const review of [false, true]) {
    const source = discordView();
    const original = structuredClone(source);
    const { packet, context } = await inspect(
      {
        originalOwnerGoal: 'Join the Lounge voice channel in Discord.',
        discordTaskAllowed: true,
        currentObservation: source,
      },
      { review },
    );
    const encoded = JSON.stringify(packet);
    for (const secret of [privateMessage, privateDraft, privateIdentity, privateHash])
      assert.equal(encoded.includes(secret), false, secret);
    const view = context.currentObservation;
    assert.equal(view.scene, null);
    assert.equal(view.screenAvailable, review ? undefined : false);
    assert.equal(view.visionStatus, review ? undefined : 'withheld_for_discord');
    assert.equal(view.application, undefined);
    assert.equal(view.privateExtra, undefined);
    assert.equal(view.window.privateDetails, undefined);
    assert(view.targets.some((entry) => entry.untrustedLabel === 'Friends'));
    assert(view.targets.some((entry) => entry.untrustedLabel === 'general (text channel)'));
    assert(view.targets.some((entry) => entry.untrustedLabel === 'Lounge (voice channel)'));
    assert(view.targets.some((entry) => entry.untrustedLabel === 'Voice Connected'));
    assert(view.targets.some((entry) => entry.untrustedLabel === 'Disconnect'));
    assert(view.targets.some((entry) => entry.untrustedLabel === 'User Settings'));
    assert(view.targets.some((entry) => entry.untrustedLabel === 'general, text channel, Friends'));
    const quick = view.targets.find(
      (entry) => entry.untrustedLabel === 'Where would you like to go?',
    );
    assert.equal(quick.draftPresent, true);
    assert.equal(quick.untrustedValue, undefined);
    assert.equal(quick.untrustedValueSha256, undefined);
    assert.deepEqual(
      source,
      original,
      'The native runner still owns the untouched full observation.',
    );
  }
});

test('explicit host-verified visible context remains source-labelled in task history', async () => {
  const approved = 'OWNER_REQUESTED_VISIBLE_CHANNEL_CONTEXT';
  const { packet, context } = await inspect({
    originalOwnerGoal: 'Read the current Discord channel.',
    discordTaskAllowed: true,
    currentObservation: discordView(),
    actualSteps: [
      {
        action: 'discord_task',
        ok: true,
        verified: true,
        discordRequest: {
          action: 'read_context',
          server: 'Friends',
          channel: 'general',
          channelType: 'text',
        },
        untrustedVisibleContext: approved,
        contextScope: 'visible_only',
      },
    ],
  });
  assert.equal(context.actualSteps[0].untrustedVisibleContext, approved);
  assert.equal(context.actualSteps[0].contextScope, 'visible_only');
  assert.equal(JSON.stringify(packet).includes(privateMessage), false);
});

test('Discord-shaped text in another app cannot trigger native Discord filtering', async () => {
  const value = 'owner-requested browser draft';
  const { context } = await inspect({
    originalOwnerGoal: 'Inspect the browser draft.',
    currentObservation: {
      window: { windowId: 'browser', untrustedTitle: 'Discord help - Browser' },
      application: { kind: 'discord' },
      targets: [
        {
          targetId: 'address',
          role: 'ControlType.Edit',
          untrustedLabel: 'Address and search bar',
          editable: true,
          focused: true,
          browserAddress: true,
          untrustedValue: value,
        },
      ],
    },
  });
  assert.equal(context.currentObservation.targets[0].untrustedValue, value);
  assert.equal(context.currentObservation.targets[0].browserAddress, true);
  assert.equal(context.currentObservation.visionStatus, undefined);
});

test('a known empty quick-switcher field does not expose its fingerprint', async () => {
  const observation = discordView();
  const quick = observation.targets.find((entry) => entry.targetId === 'quick');
  quick.untrustedValue = '';
  quick.untrustedValueSha256 = emptyHash;
  const { packet, context } = await inspect({
    originalOwnerGoal: 'Open general in Discord.',
    discordTaskAllowed: true,
    currentObservation: observation,
  });
  assert.equal(JSON.stringify(packet).includes(emptyHash), false);
  assert.equal(
    context.currentObservation.targets.some((entry) => entry.untrustedValueSha256),
    false,
  );
});

test('an unrelated direct-message window title is not disclosed to the planner', async () => {
  const observation = discordView();
  observation.window.untrustedTitle = `@${privateIdentity} - Discord`;
  const { packet, context } = await inspect({
    originalOwnerGoal: 'Join the Lounge voice channel on server Friends in Discord.',
    discordTaskAllowed: true,
    currentObservation: observation,
  });
  assert.equal(JSON.stringify(packet).includes(privateIdentity), false);
  assert.equal(context.currentObservation.window.untrustedTitle, 'Discord');
});
