// SPDX-License-Identifier: GPL-3.0-only
// Optional real-model qualification. Open a disposable Resolve project containing
// a video with at least 120 frames, then explicitly name that project in the env.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { computerPlanner } from '../../apps/desktop/computer-planner.mjs';
import { ControlOverlay } from '../../apps/desktop/main/control-overlay.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { ResolveAdapter } from '../../integrations/resolve/service.mjs';

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    createRequire(import.meta.url)('electron'),
    [fileURLToPath(import.meta.url)],
    { env, windowsHide: true, stdio: 'inherit' },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (c) => resolve(c ?? 1));
  });
} else {
  const { app, BrowserWindow, screen, globalShortcut } = await import('electron');
  void app
    .whenReady()
    .then(async () => {
      const root = process.cwd(),
        projectName = process.env.CAPRI_VERIFY_RESOLVE_PROJECT,
        model = process.env.CAPRI_VERIFY_MODEL;
      assert(
        projectName && model,
        'Set CAPRI_VERIFY_RESOLVE_PROJECT to a disposable project and CAPRI_VERIFY_MODEL.',
      );
      const parent = path.join(root, '.runtime/resolve-assembly-verification');
      mkdirSync(parent, { recursive: true });
      const folder = mkdtempSync(path.join(parent, 'run-')),
        report = { passed: false, realModel: model, existingTimelinesOverwritten: false };
      const owner = new BrowserWindow({ show: false, width: 200, height: 100 });
      let control,
        cancelled = false,
        overlay;
      const raw = (a, o) => callApplicationBridge(root, a, o);
      const native = await raw({ action: 'computer_state' });
      const bridge = async (a, o) => {
        if (a.action === 'computer_release') return raw(a, o);
        const live = await raw({ action: 'computer_state' }, o);
        assert.equal(
          live.processId,
          native.processId,
          'Focus left the explicitly selected test application.',
        );
        return a.action === 'computer_state' ? live : raw(a, o);
      };
      const adapter = new ResolveAdapter({ root, bridge, allowed: () => !cancelled });
      const executeResolve = adapter.execute.bind(adapter);
      adapter.execute = async (...args) => {
        try {
          return await executeResolve(...args);
        } catch (error) {
          report.nativeFailure = error.message;
          throw error;
        }
      };
      try {
        const initial = await adapter.observe(native, new AbortController().signal);
        assert.equal(
          initial?.projectName,
          projectName,
          'This is not the explicitly named disposable project.',
        );
        const source = initial.clips.find((c) => c.frames >= 120);
        assert(source, 'Import a disposable video of at least 120 frames first.');
        control = new ComputerControl({
          applicationAdapter: adapter,
          allowed: () => !cancelled,
          canStart: () => true,
          bridge,
          registerEscape: (stop) =>
            globalShortcut.register('Escape', () => {
              cancelled = true;
              stop();
            }),
          unregisterEscape: () => globalShortcut.unregister('Escape'),
          showBorder: async () => {
            overlay = new ControlOverlay({
              BrowserWindow,
              screen,
              owner,
              url: pathToFileURL(path.join(root, 'apps/desktop/renderer/control-overlay.html'))
                .href,
              onLost: () => {
                cancelled = true;
                void control.stop();
              },
            });
            await overlay.show('CAPRI // RESOLVE VERIFICATION — ESC TO STOP');
          },
          hideBorder: () => overlay?.hide(),
          capture: async () => {
            throw Error('The fixed Resolve API supplies exact media/timeline state.');
          },
        });
        const timelineName = 'Capri verification ' + randomUUID().slice(0, 8);
        const agent = new ComputerAgent({
          control,
          emit: (e) => console.log(JSON.stringify({ phase: e.phase, steps: e.steps })),
          applications: {
            operation: (_id, _args, run) => run(),
            execute: () => assert.fail('Stay in the selected test project.'),
          },
          plan: computerPlanner({
            url: process.env.CAPRI_VERIFY_OLLAMA_URL ?? 'http://127.0.0.1:11434',
            model,
            params: {
              num_ctx: 8192,
              ...(process.env.CAPRI_VERIFY_GPU_LAYERS
                ? { num_gpu: Number(process.env.CAPRI_VERIFY_GPU_LAYERS) }
                : {}),
            },
          }),
        });
        report.result = await agent.run(
          `Assemble a NEW montage named ${JSON.stringify(timelineName)} in this disposable project. Use the existing media-pool clip ${JSON.stringify(source.name)}: frames 0 through 47, then frames 72 through 119. Keep their audio and glue the two ranges directly adjacent. Save and verify two video segments totaling 96 frames. Preserve all other timelines.`,
        );
        assert(report.result.ok, JSON.stringify(report.result));
        const final = await adapter.observe(
          await raw({ action: 'computer_state' }),
          new AbortController().signal,
        );
        assert.equal(final.timeline.name, timelineName);
        assert.equal(final.timeline.duration, 96);
        assert.deepEqual(
          final.timeline.segments.map((s) => [s.clipId, s.sourceStart, s.duration]),
          [
            [source.id, 0, 48],
            [source.id, 72, 48],
          ],
        );
        assert.equal(final.timeline.segments[0].finish, final.timeline.segments[1].start);
        report.verified = {
          segments: 2,
          frames: 96,
          audioSegments: final.timeline.audioSegments.length,
          saved: true,
        };
        report.passed = true;
      } catch (error) {
        report.failure = error.message;
        process.exitCode = 1;
      } finally {
        await control?.stop();
        owner.destroy();
        writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ ...report, folder }));
        app.exit(process.exitCode ?? 0);
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
