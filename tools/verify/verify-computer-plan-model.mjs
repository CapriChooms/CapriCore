// SPDX-License-Identifier: GPL-3.0-only
// Opt-in selected-provider smoke test. All screen data and actions are synthetic;
// owner settings/credentials are read only, and plaintext keys stay in InferenceApi.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { InferenceApi } from '../../apps/desktop/inference-api.mjs';
import { credentialStorage } from '../../apps/desktop/github-access.mjs';
import { computerPlanner } from '../../apps/desktop/computer-planner.mjs';
import { ComputerTaskPlan } from '../../apps/desktop/computer-task-plan.mjs';

const evidenceExists = (view, evidence) =>
  typeof evidence === 'string' &&
  evidence.trim().length > 1 &&
  [
    view.window?.untrustedTitle,
    ...(view.targets ?? []).flatMap((target) => [target.untrustedLabel, target.untrustedValue]),
  ].some((value) => typeof value === 'string' && value.includes(evidence));

if (!process.versions.electron) {
  assert(
    process.env.CAPRI_VERIFY_INSTALL,
    'Set CAPRI_VERIFY_INSTALL to the selected installation.',
  );
  const parent = path.join(root, '.runtime/computer-plan-model-verification');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'run-'));
  const reportFile = path.join(folder, 'report.json');
  const profile = path.join(folder, 'electron-profile');
  const ownerLocalState = path.join(
    path.resolve(process.env.CAPRI_VERIFY_INSTALL),
    'data/desktop/profile/Local State',
  );
  if (existsSync(ownerLocalState)) {
    // Windows safeStorage needs its existing encrypted Chromium master key.
    // Copy only encrypted os_crypt metadata, never the owner's browser profile.
    const { os_crypt } = JSON.parse(readFileSync(ownerLocalState, 'utf8'));
    if (os_crypt) {
      mkdirSync(profile, { recursive: true });
      writeFileSync(path.join(profile, 'Local State'), JSON.stringify({ os_crypt }));
    }
  }
  const env = {
    ...process.env,
    TEMP: folder,
    TMP: folder,
    CAPRI_VERIFY_PLAN_FOLDER: folder,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    createRequire(import.meta.url)('electron'),
    [fileURLToPath(import.meta.url)],
    {
      env,
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  const timeout = setTimeout(() => child.kill(), 160000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearTimeout(timeout);
    const resolvedProfile = path.resolve(profile);
    assert.equal(path.dirname(resolvedProfile), path.resolve(folder));
    assert(path.resolve(folder).startsWith(path.resolve(parent) + path.sep));
    rmSync(resolvedProfile, { recursive: true, force: true });
  }
  assert(existsSync(reportFile), 'Electron verification stopped before writing its report.');
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  console.log(
    JSON.stringify({
      passed: report.passed,
      status: report.status,
      folder,
      model: report.model,
      realProviderUsed: report.realProviderUsed,
      syntheticObservationsOnly: report.syntheticObservationsOnly,
      calls: report.calls,
      actions: report.decisions?.map(({ phase, step }) => ({ phase, action: step?.action })),
      verifiedBehaviors: report.verifiedBehaviors,
      failure: report.failure,
    }),
  );
  process.exitCode = code || (report.passed ? 0 : 1);
} else {
  const { app, safeStorage, session } = await import('electron');
  const folder = process.env.CAPRI_VERIFY_PLAN_FOLDER;
  assert(folder && path.resolve(folder).startsWith(path.join(root, '.runtime') + path.sep));
  app.setName('Capri Plan Model Verification');
  app.setPath('userData', path.join(folder, 'electron-profile'));
  const reportFile = path.join(folder, 'report.json');
  const report = {
    passed: false,
    status: 'running',
    realProviderUsed: false,
    syntheticObservationsOnly: true,
    ownerSettingsModified: false,
    computerInputSent: false,
    calls: 0,
    decisions: [],
    verifiedBehaviors: [],
  };
  const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));
  save();
  let api;
  const run = async () => {
    try {
      api = new InferenceApi({
        root: path.resolve(process.env.CAPRI_VERIFY_INSTALL),
        storage: credentialStorage(safeStorage),
        proxySession: () =>
          session.fromPartition('capri-plan-model-verification', { cache: false }),
      });
      assert.equal(
        api.config.enabled,
        true,
        'The chosen installation needs an active API profile.',
      );
      report.model = api.config.model;
      report.providerOrigin = new URL(api.config.baseUrl).origin;
      // An ephemeral local port avoids the live application's inference listener.
      await api.start(0);
      const planner = computerPlanner({
        url: api.url,
        model: api.config.model,
        modelCapabilities: [
          ...(api.config.tools ? ['tools'] : []),
          ...(api.config.vision ? ['vision'] : []),
        ],
        params: { num_ctx: api.config.contextTokens },
        fetchImpl: api.localFetch,
      });
      const signal = AbortSignal.timeout(145000);
      const taskPlan = new ComputerTaskPlan({ signal });
      const history = [];
      const desktop = {
        observationId: 'synthetic-desktop',
        window: { windowId: '10', untrustedTitle: 'Desktop - File Explorer', modal: false },
        screenAvailable: false,
        targets: [
          {
            targetId: 'chrome',
            untrustedLabel: 'Google Chrome',
            role: 'ControlType.Button',
            surface: 'taskbar',
          },
        ],
      };
      const address = {
        targetId: 'address',
        untrustedLabel: 'Address and search bar',
        untrustedValue: 'https://www.youtube.com/',
        role: 'ControlType.Edit',
        editable: true,
        browserAddress: true,
        pageContent: false,
      };
      const blocked = {
        observationId: 'synthetic-youtube-cookies',
        window: {
          windowId: '20',
          untrustedTitle: 'Before you continue to YouTube - Google Chrome',
          modal: true,
        },
        screenAvailable: false,
        targets: [
          address,
          {
            targetId: 'cookie-title',
            untrustedLabel: 'Before you continue to YouTube',
            role: 'ControlType.Text',
            pageContent: true,
          },
          {
            targetId: 'cookie-message',
            untrustedLabel:
              'We use optional cookies for personalized ads. Choose whether to accept them before continuing.',
            role: 'ControlType.Text',
            pageContent: true,
          },
          {
            targetId: 'reject',
            untrustedLabel: 'Reject all',
            role: 'ControlType.Button',
            pageContent: true,
          },
          {
            targetId: 'accept',
            untrustedLabel: 'Accept all',
            role: 'ControlType.Button',
            pageContent: true,
          },
        ],
      };
      const ready = {
        observationId: 'synthetic-youtube-ready',
        window: { windowId: '20', untrustedTitle: 'YouTube - Google Chrome', modal: false },
        screenAvailable: false,
        targets: [
          address,
          {
            targetId: 'youtube-home',
            untrustedLabel: 'YouTube Home',
            role: 'ControlType.Hyperlink',
            pageContent: true,
          },
          {
            targetId: 'search',
            untrustedLabel: 'Search',
            role: 'ControlType.Edit',
            editable: true,
            browserSearch: true,
            pageContent: true,
          },
          {
            targetId: 'home',
            untrustedLabel: 'Home',
            role: 'ControlType.Button',
            selected: true,
            pageContent: true,
          },
        ],
      };
      const context = (observation, correction = '') => ({
        originalOwnerGoal: 'Открой YouTube.',
        language: 'ru',
        currentObservation: observation,
        actualSteps: history,
        completedSteps: [],
        knownApplications: [{ name: 'Google Chrome' }],
        taskPlan: taskPlan.context(),
        correction,
      });
      const decide = async (phase, state, review = false) => {
        report.calls++;
        report.realProviderUsed = true;
        save();
        const step = await planner(state, { signal, review });
        report.decisions.push({ phase, step });
        save();
        return step;
      };

      const first = await decide('desktop', context(desktop));
      assert.equal(first.action, 'open_url', 'Website opening should navigate directly.');
      const url = new URL(first.url);
      assert.equal(url.protocol, 'https:');
      assert.match(url.hostname, /^(?:www\.)?youtube\.com$/u);
      assert.equal(url.pathname, '/');
      assert(
        first.plan?.length > 0 && first.plan.length <= 4,
        'First action needs a short task plan.',
      );
      assert.equal(taskPlan.update(first, { observation: desktop, evidenceExists }), null);
      report.verifiedBehaviors.push(
        'initial official YouTube navigation includes a bounded task plan',
      );
      history.push({
        action: 'open_url',
        query: first.query,
        navigationUrl: first.url,
        navigationRequested: true,
        submitted: true,
        windowId: '20',
        ok: true,
      });
      taskPlan.recordOutcome({ ok: true, changed: true, blocked: true });

      const recovery = await decide(
        'cookie-recovery',
        context(
          blocked,
          'Do not repeat the delivered navigation blindly. Revise the remaining task plan using the current observation. Resolve the ordinary blocking cookie dialog, preferably rejecting optional cookies, then verify the requested page. The ready YouTube home page is not yet visible.',
        ),
      );
      assert.equal(recovery.action, 'click');
      assert.equal(recovery.targetId, 'reject', 'Optional cookies should be rejected.');
      assert(Array.isArray(recovery.plan), 'A blocking dialog needs an updated remaining plan.');
      assert.equal(taskPlan.update(recovery, { observation: blocked, evidenceExists }), null);
      report.verifiedBehaviors.push('cookie recovery chooses the observed Reject all control');
      history.push({ action: 'click', target: 'Reject all', windowId: '20', ok: true });
      taskPlan.recordOutcome({ ok: true, changed: true });

      let finish;
      let correction = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        finish = await decide(
          attempt ? 'checkpoint-proof-retry' : 'ready',
          context(ready, correction),
        );
        assert.equal(finish.action, 'finish');
        assert(evidenceExists(ready, finish.evidence), 'Completion needs exact current evidence.');
        assert.equal(taskPlan.update(finish, { observation: ready, evidenceExists }), null);
        report.taskPlan = taskPlan.context();
        save();
        if (!report.taskPlan.remainingCheckpoints.length) break;
        // Exercise the same missing-proof gate and correction as ComputerAgent.
        // The first completion proposal is not accepted while checkpoints remain.
        correction =
          'The task plan still has unverified checkpoints. Complete the missing owner steps or mark existing checkpoints with exact current evidence in verifiedCheckpoints before finish. If a checkpoint is obsolete, revise only the remaining plan; do not add new work beyond the owner goal.';
      }
      assert.equal(
        taskPlan.context().remainingCheckpoints.length,
        0,
        'All checkpoints need current proof.',
      );
      assert(
        taskPlan.context().completedCheckpoints.length > 0,
        'An existing checkpoint must be verified.',
      );
      report.verifiedBehaviors.push(
        'completion checkpoints have exact current observation evidence',
      );
      const review = await decide(
        'completion-review',
        {
          ...context(ready),
          completionClaim: finish.summary,
        },
        true,
      );
      assert.equal(review.action, 'finish');
      assert(evidenceExists(ready, review.evidence));
      report.verifiedBehaviors.push(
        'independent completion review confirms the ready YouTube page',
      );
      report.taskPlan = taskPlan.context();
      report.passed = true;
      report.status = 'completed';
    } catch (error) {
      report.status = /Computer planning HTTP 429/u.test(error.message)
        ? 'provider_limited'
        : 'failed';
      report.failure = String(error.message).slice(0, 1800);
    } finally {
      api?.close();
      save();
      app.exit(report.passed ? 0 : 1);
    }
  };
  // Electron holds its ready event until the ESM entry has finished evaluating.
  // Awaiting readiness at top level would prevent that event from being emitted.
  void app.whenReady().then(run);
}
