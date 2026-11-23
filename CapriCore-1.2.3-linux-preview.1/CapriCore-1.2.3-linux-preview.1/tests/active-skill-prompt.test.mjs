import assert from 'node:assert/strict';
import test from 'node:test';
import { interfaceInstruction } from '../apps/desktop/chat-service.mjs';
import { desktopTurnContext } from '../apps/desktop/turn-context.mjs';

test('disabled skills contribute neither instructions nor stale state', () => {
  const state = {
    activeSkills: new Set(['capri.calculator']),
    applications: { calculator: true, notepad: true },
    spotify: { enabled: true, prepared: true },
    microphone: true,
    screenObservation: { active: true },
  };
  const instructions = interfaceInstruction(state);
  const context = desktopTurnContext(state);
  assert.match(instructions, /use its calculate action/);
  assert.match(context, /"calculator":true/);
  assert.doesNotMatch(instructions, /spotify_control|time_control|filesystem_control|wakePhrase/);
  assert.doesNotMatch(context, /spotify|screenObservation|microphone|notepad/);

  state.activeSkills.add('capri.spotify');
  assert.match(interfaceInstruction(state), /spotify_control/);
  assert.match(desktopTurnContext(state), /"spotify":{"enabled":true,"prepared":true}/);
  assert.doesNotMatch(desktopTurnContext(state, [], { dialogueOnly: true }), /spotify/);
});
