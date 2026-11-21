// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { crashReporter } from '../apps/desktop/main/crash-report.mjs';

test('a renderer crash reveals the logs once and asks before exporting', async () => {
  const actions = [];
  const { promise, resolve } = Promise.withResolvers();
  const shown = Promise.withResolvers();
  let clock = 1000;
  const report = crashReporter({
    now: () => clock,
    openLogs: () => actions.push('Explorer'),
    dialog: {
      showMessageBox: (options) => {
        actions.push(options);
        shown.resolve();
        return promise;
      },
    },
    saveReport: (crash) => actions.push(crash),
  });
  await report({ surface: 'companion', reason: 'clean-exit' });
  assert.deepEqual(actions, []);

  const crash = { surface: 'companion', reason: 'oom', exitCode: 7 };
  const pending = report(crash);
  await shown.promise;
  await report({ surface: 'settings', reason: 'crashed' });
  assert.equal(actions.length, 2);
  assert.equal(actions[0], 'Explorer');
  assert.match(actions[1].detail, /Overyx in a Discord direct message/u);
  assert.deepEqual(actions[1].buttons, ['Save report', 'Dismiss']);
  resolve({ response: 0 });
  await pending;
  assert.deepEqual(actions[2], {
    crashSurface: 'companion',
    crashReason: 'oom',
    exitCode: 7,
    timeMs: 1000,
  });
  await report(crash);
  assert.equal(actions.length, 3);
  clock += 60_000;
  await report({ surface: 'settings', reason: 'crashed' });
  assert.equal(actions[5].crashSurface, 'settings');
});

test('a missing logs folder still allows an export, and dismissal leaves no archive', async () => {
  const prompts = [];
  let saves = 0;
  let response = 1;
  const makeReport = () =>
    crashReporter({
      openLogs: () => Promise.reject(new Error('Folder unavailable')),
      dialog: {
        showMessageBox: async (options) => {
          prompts.push(options);
          return { response };
        },
      },
      saveReport: (crash) => {
        saves++;
        assert.equal(crash.crashReason, 'process-exit');
      },
    });
  await makeReport()({ surface: 'desktop' });
  assert.equal(saves, 0);
  assert.match(prompts[0].detail, /logs folder could not be opened/u);
  response = 0;
  await makeReport()({ surface: 'desktop' });
  assert.equal(saves, 1);
});
