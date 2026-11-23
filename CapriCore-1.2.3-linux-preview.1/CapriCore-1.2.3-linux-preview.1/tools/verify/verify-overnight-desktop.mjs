// SPDX-License-Identifier: GPL-3.0-only
// Product integration test: real model, native Capri executor and installed applications.
// No fixture UI, guessed coordinates, fabricated tool replies or messages to real chats.
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
const root = process.cwd(),
  require = createRequire(import.meta.url);
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [flag, name] of [
    ['--model', 'CAPRI_NIGHT_MODEL'],
    ['--case', 'CAPRI_NIGHT_CASE'],
  ]) {
    const index = process.argv.indexOf(flag);
    if (index >= 0) env[name] = process.argv[index + 1];
  }
  const bootstrapDirectory = path.join(root, '.runtime/overnight-desktop');
  mkdirSync(bootstrapDirectory, { recursive: true });
  const entry = path.join(bootstrapDirectory, 'entry.mjs');
  writeFileSync(
    entry,
    `import{app}from'electron';import{mkdirSync}from'node:fs';const profile=${JSON.stringify(path.join(bootstrapDirectory, 'electron-profile'))};mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.whenReady().then(()=>import(${JSON.stringify(pathToFileURL(process.argv[1]).href)})).catch(error=>{console.error(error);app.exit(1);});`,
  );
  // --model is a Chromium switch: test parameters travel in private env instead.
  const child = spawn(require('electron'), [entry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  process.exitCode = await new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
} else {
  const { app, BrowserWindow, screen, globalShortcut, nativeImage, shell } = await import(
    'electron'
  );
  const { DesktopCatalog } = await import('../../apps/desktop/desktop-catalog.mjs');
  const { ComputerControl } = await import('../../apps/desktop/computer-control.mjs');
  const { ComputerAgent } = await import('../../apps/desktop/computer-agent.mjs');
  const { computerPlanner } = await import('../../apps/desktop/computer-planner.mjs');
  const { computerVision } = await import('../../apps/desktop/computer-vision.mjs');
  const { NativeEscapeStop } = await import('../../apps/desktop/native-escape-stop.mjs');
  const { ControlOverlay } = await import('../../apps/desktop/main/control-overlay.mjs');
  const { captureActiveDisplay } = await import('../../apps/desktop/native-screenshot.mjs');
  const { ResolveAdapter } = await import('../../integrations/resolve/service.mjs');
  const { steamGameLauncher } = await import('../../apps/desktop/steam-game-launch.mjs');
  const { observedBrowserAddress, youtubeWatchRequirement, youtubeWatchVerified } = await import(
    '../../apps/desktop/browser-search-state.mjs'
  );
  const parent = path.join(root, '.runtime/overnight-desktop');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'run-'));
  app.setPath('userData', path.join(folder, 'electron'));
  await app.whenReady();
  const owner = new BrowserWindow({ show: false, width: 120, height: 80 });
  const report = { cases: [], realApplications: true, realModels: true },
    ownerStop = new AbortController();
  let overlay,
    control,
    currentTurn = 'night-verification';
  const escape = new NativeEscapeStop({ root });
  const catalog = new DesktopCatalog({
    root,
    state: path.join(folder, 'catalog'),
    fullAccess: () => true,
    currentTurn: () => currentTurn,
    accessSignal: () => ownerStop.signal,
  });
  const argument = (name) =>
    ({ '--model': process.env.CAPRI_NIGHT_MODEL, '--case': process.env.CAPRI_NIGHT_CASE })[name] ??
    null;
  const models = argument('--model') ? [argument('--model')] : ['gemma4:e2b', 'qwen3.5:9b'];
  const cases = [
    {
      id: 'youtube',
      goal: 'Open Google Chrome, create a new tab, go to YouTube, search for "Cyberpunk Edgerunners official teaser Netflix", and open a matching official Netflix teaser video. Leave it open. Do not sign in, purchase, download, like, comment or change account settings. Complete every requested step and verify the actual video page.',
    },
    {
      id: 'youtube-exact',
      goal: 'Open Google Chrome, create a new tab, go to YouTube, search for "Me at the zoo jawed", then open the video titled "Me at the zoo". Leave it open. Do not sign in, purchase, download, like, comment or change account settings.',
    },
    {
      id: 'switching',
      goal: 'Open Discord without sending any messages or joining a call. Then switch to Google Chrome, create a new tab, go to wikipedia.org, search for Ada Lovelace and leave the Ada Lovelace article open. Do not modify existing tabs or account settings. Verify that both the app switch and article navigation happened.',
    },
    { id: 'discord-open', goal: 'Open Discord' },
    {
      id: 'video-link',
      goal: 'Open Google Chrome, then go to https://www.youtube.com/watch?v=jNQXAC9IVRw. Leave this video open; do not sign in or change any settings.',
    },
    {
      id: 'steam',
      // The existing dedicated route queries Steam's installation state and never installs.
      goal: 'Open Steam and launch Cyberpunk 2077',
    },
    { id: 'resolve-open', goal: 'Open DaVinci Resolve' },
  ].filter((row) =>
    argument('--case') === 'app-basics'
      ? ['discord-open', 'video-link'].includes(row.id)
      : argument('--case')
        ? row.id === argument('--case')
        : ['youtube', 'switching'].includes(row.id),
  );
  if (!cases.length) throw Error('Select a known desktop verification case.');
  let row;
  const observe = () =>
    catalog.bridge(root, { action: 'computer_state', ignoreProcessId: String(process.pid) });
  const liveGame = async () => {
    const powershell = path.join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const { stdout } = await promisify(execFile)(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Process -Name Cyberpunk2077 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count',
      ],
      { windowsHide: true, timeout: 5000 },
    );
    return Number(stdout.trim()) > 0;
  };
  const originalExecute = catalog.execute.bind(catalog);
  catalog.execute = async (...args) => {
    try {
      const result = await originalExecute(...args);
      if (
        row?.scenario === 'switching' &&
        args[1]?.action === 'launch' &&
        /discord/i.test(args[1].query ?? '')
      ) {
        const current = await observe().catch(() => null);
        if (
          /(?:^|[\\/])discord(?:\.exe)?$/iu.test(current?.executable ?? '') ||
          current?.applicationKind === 'discord'
        )
          row.discordForeground = true;
      }
      return result;
    } catch (error) {
      if (row) {
        row.actionErrors ??= [];
        row.actionErrors.push({
          action: args[1]?.action,
          code: error.code,
          message: error.message,
          inputPerformed: error.inputPerformed,
        });
      }
      throw error;
    }
  };
  try {
    for (const model of models) {
      const requiresModel = cases.some(({ id }) => id !== 'steam');
      const metadata = requiresModel
        ? await fetch('http://127.0.0.1:11435/api/show', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model }),
          }).then((response) => response.json())
        : {};
      const params = {
        num_ctx: 8192,
        num_thread: 8,
        temperature: 0,
        presence_penalty: 0,
        repeat_penalty: 1,
      };
      for (const scenario of cases) {
        if (ownerStop.signal.aborted) break;
        currentTurn = model.replace(/[^a-z0-9]/g, '_') + '-' + scenario.id;
        row = { model, scenario: scenario.id, passed: false, phases: [], elapsedMs: 0 };
        report.cases.push(row);
        console.log('START ' + model + ' · ' + scenario.id);
        const started = performance.now();
        const measuredFetch = async (url, options) => {
          const startedCall = performance.now(),
            body = JSON.parse(options.body ?? '{}');
          const response = await fetch(url, options);
          const measure = {
            status: response.status,
            elapsedMs: Math.round(performance.now() - startedCall),
            inputCharacters:
              body.messages?.reduce(
                (sum, message) => sum + String(message.content ?? '').length,
                0,
              ) ?? 0,
          };
          if (!response.ok) {
            const value = await response
              .clone()
              .json()
              .catch(() => ({}));
            measure.category = /context|input.*length|maximum.*length/i.test(value.error ?? '')
              ? 'context_limit'
              : /schema|format|grammar/i.test(value.error ?? '')
                ? 'format'
                : 'other';
          }
          row.inferenceCalls ??= [];
          row.inferenceCalls.push(measure);
          return response;
        };
        control = new ComputerControl({
          allowed: () => !ownerStop.signal.aborted,
          canStart: () => true,
          currentTurn: () => currentTurn,
          bridge: (command, options) =>
            catalog.bridge(
              root,
              command.action === 'computer_state'
                ? { ...command, ignoreProcessId: String(process.pid) }
                : command,
              options,
            ),
          applicationAdapter: new ResolveAdapter({
            root,
            bridge: (command, options) => catalog.bridge(root, command, options),
            allowed: () => !ownerStop.signal.aborted,
          }),
          capture: async ({ signal, displayWindow }) => {
            const result = await captureActiveDisplay(root, {
              signal,
              displayWindow,
              withGeometry: true,
            });
            const source = nativeImage.createFromBuffer(result.png),
              size = source.getSize(),
              factor = Math.min(1, 1280 / size.width, 720 / size.height);
            const image = source.resize({
              width: Math.max(1, Math.round(size.width * factor)),
              height: Math.max(1, Math.round(size.height * factor)),
            });
            return { png: image.toPNG(), ...image.getSize(), bounds: result.bounds };
          },
          describe: computerVision({
            url: 'http://127.0.0.1:11435',
            model,
            modelCapabilities: metadata.capabilities,
            params,
            fetchImpl: measuredFetch,
          }),
          registerEscape: async () => {
            globalShortcut.register('Escape', () => {
              ownerStop.abort();
              void control.stop();
            });
            return escape.start({
              onEscape: () => {
                ownerStop.abort();
                void control.stop();
              },
              onFailure: () => {
                ownerStop.abort();
                void control.stop();
              },
            });
          },
          unregisterEscape: () => {
            globalShortcut.unregister('Escape');
            escape.stop();
          },
          showBorder: async () => {
            overlay = new ControlOverlay({
              BrowserWindow,
              screen,
              owner,
              url: pathToFileURL(path.join(root, 'apps/desktop/renderer/control-overlay.html'))
                .href,
              onLost: () => void control.stop(),
            });
            await overlay.show('CAPRI // REAL APPLICATION TEST · ESC TO STOP');
          },
          hideBorder: () => {
            overlay?.hide();
            overlay = null;
          },
        });
        const controlExecute = control.execute.bind(control);
        control.execute = async (...args) => {
          try {
            return await controlExecute(...args);
          } catch (error) {
            if (args[0]?.action !== 'observe') {
              row.actionErrors ??= [];
              row.actionErrors.push({
                action: args[0]?.action,
                code: error.code,
                message: error.message,
                inputPerformed: error.inputPerformed,
              });
            }
            throw error;
          }
        };
        const nativePlanner = computerPlanner({
          url: 'http://127.0.0.1:11435',
          model,
          modelCapabilities: metadata.capabilities,
          params,
          fetchImpl: measuredFetch,
        });
        const agent = new ComputerAgent({
          control,
          applications: catalog,
          maxDecisions: 30,
          language: () => 'en',
          launchSteamGame: steamGameLauncher({ openExternal: (url) => shell.openExternal(url) }),
          plan: async (...args) => {
            try {
              return await nativePlanner(...args);
            } catch (error) {
              row.plannerErrors ??= [];
              row.plannerErrors.push({ code: error.code, message: error.message });
              throw error;
            }
          },
          onPlan: (value) => {
            overlay?.plan(value);
            if (value.issue) {
              row.planIssues ??= [];
              row.planIssues.push(value.issue);
            }
          },
          emit: (event) => {
            overlay?.phase(event.phase);
            if (row.phases.at(-1) !== event.phase) {
              row.phases.push(event.phase);
              console.log(model + ' · ' + scenario.id + ' · ' + event.phase);
            }
          },
        });
        try {
          if (scenario.id === 'steam') row.gameAlreadyRunning = await liveGame();
          const result = await agent.run(scenario.goal, {
            signal: AbortSignal.any([
              ownerStop.signal,
              AbortSignal.timeout(scenario.id === 'video-link' ? 50000 : 360000),
            ]),
          });
          row.passed = result.ok === true;
          row.status = result.status;
          row.steps = result.steps;
          row.diagnostics = agent.diagnostics();
          if (scenario.id.startsWith('youtube')) {
            const active = await observe();
            row.requestedVideoObserved = youtubeWatchVerified(
              {
                window: active,
                targets: active.untrustedControls?.map((control) => ({
                  ...control,
                  untrustedLabel: control.untrustedName,
                })),
              },
              youtubeWatchRequirement(scenario.goal),
            );
            row.passed &&= row.requestedVideoObserved;
          } else if (scenario.id === 'discord-open') {
            const active = await observe();
            row.discordForeground = active.applicationKind === 'discord';
            row.passed &&= row.discordForeground;
          } else if (scenario.id === 'video-link') {
            const active = await observe();
            const field = observedBrowserAddress({
              window: active,
              targets: active.untrustedControls?.map((item) => ({
                ...item,
                untrustedLabel: item.untrustedName,
              })),
            });
            const address = field?.focused ? '' : (field?.untrustedValue ?? '');
            row.requestedVideoObserved =
              /^(?:https:\/\/)?(?:www\.)?youtube\.com\/watch\?v=jNQXAC9IVRw(?:[&#]|$)/i.test(
                address,
              ) && /^Me at the zoo\s+[-–—]/i.test(active.untrustedTitle ?? '');
            row.passed &&= row.requestedVideoObserved;
          } else if (scenario.id === 'switching') {
            const active = await observe();
            const address =
              active.untrustedControls?.find((item) => item.browserAddress && !item.focused)
                ?.untrustedValue ?? '';
            row.articleObserved =
              /^(?:https:\/\/)?en\.wikipedia\.org\/wiki\/Ada_Lovelace(?:[?#]|$)/i.test(address) &&
              /^Ada Lovelace\s+[-–—]/i.test(active.untrustedTitle ?? '');
            row.passed &&= row.articleObserved && row.discordForeground === true;
          } else if (scenario.id === 'steam' && result.ok) {
            const deadline = Date.now() + 65_000;
            do {
              row.gameWindowObserved = await liveGame();
              if (row.gameWindowObserved || ownerStop.signal.aborted) break;
              await delay(2000);
            } while (Date.now() < deadline);
            row.passed &&= row.gameWindowObserved && !row.gameAlreadyRunning;
          }
        } catch (error) {
          row.passed = false;
          row.error = error.code ?? error.name;
          row.detail = error.message.slice(0, 240);
        } finally {
          await control.stop({ blockTurn: false });
          row.elapsedMs = Math.round(performance.now() - started);
          row.controlStopped = !control.snapshot().active && !escape.active;
          writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
        }
        console.log(
          'RESULT ' + model + ' · ' + scenario.id + ' · ' + (row.passed ? 'PASSED' : 'INCOMPLETE'),
        );
      }
      await fetch('http://127.0.0.1:11435/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0, stream: false }),
      }).catch(() => {});
    }
  } finally {
    await control?.stop({ blockTurn: false });
    escape.stop();
    overlay?.hide();
    globalShortcut.unregisterAll();
    await catalog.close();
    owner.destroy();
    writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
    console.log('Report: ' + path.join(folder, 'report.json'));
    app.exit(report.cases.every((row) => row.passed) ? 0 : 1);
  }
}
