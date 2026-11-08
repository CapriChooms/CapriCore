#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { saveModelProfile } from '../src/hardware/model-profile.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  root,
  nodePath,
  ollamaPath,
  openclawPath,
  settings,
  managedProcess,
  runtime,
} from '../src/index.mjs';
import { probeHardware } from '../src/hardware/probe.mjs';
import { MODEL_CHOICES } from '../src/hardware/model-catalog.mjs';
import { recommendProfile } from '../src/hardware/profiles.mjs';
import { startDesktop } from '../src/desktop-launcher.mjs';

const args = process.argv.slice(2),
  command = args[0] ?? 'help';
try {
  if (command === 'doctor' || command === 'profiles') {
    const hardware = await probeHardware(),
      recommendation = recommendProfile(hardware);
    console.log(
      JSON.stringify(
        {
          hardware,
          recommendation,
          software: {
            node: Boolean(nodePath),
            ollama: Boolean(ollamaPath),
            openclaw: existsSync(openclawPath),
          },
          current: { model: settings.model, contextTokens: settings.contextTokens },
          ...(command === 'profiles' ? { profiles: MODEL_CHOICES } : {}),
        },
        null,
        2,
      ),
    );
  } else if (command === 'setup') {
    if (managedProcess('desktop') || managedProcess('capri') || managedProcess('ollama'))
      throw new Error(
        'Stop Capri with npm stop before changing model profiles. Existing settings were preserved.',
      );
    const hardware = await probeHardware(),
      recommendation = recommendProfile(hardware);
    if (!recommendation.supported) throw new Error(recommendation.reasons.join(' '));
    let selected =
      args.find((value) => value.startsWith('--profile='))?.slice(10) ?? recommendation.profile.id;
    const local = path.join(root, 'config/core.local.json');
    if (stdin.isTTY && !args.includes('--yes')) {
      const terminal = createInterface({ input: stdin, output: stdout });
      try {
        console.log(
          'Model profiles change quality, memory use and latency. Speech packs are optional and are installed separately.',
        );
        for (const profile of MODEL_CHOICES)
          console.log(
            `${profile.id}: ${profile.model}, ${profile.ramGiB}+ GiB RAM, ~${profile.recommendedVramGiB} GiB VRAM for acceleration${profile.experimental ? ' (BETA)' : ''}. ${profile.description}`,
          );
        selected = (await terminal.question(`Profile [${selected}]: `)).trim() || selected;
        if (
          existsSync(local) &&
          (await terminal.question('Replace existing local model settings? Type yes: ')).trim() !==
            'yes'
        )
          throw new Error('Setup cancelled; existing settings were preserved.');
      } finally {
        terminal.close();
      }
    } else if (existsSync(local) && !args.includes('--replace'))
      throw new Error(
        'Local settings already exist. Use --replace only to deliberately change this installation.',
      );
    const { profile } = saveModelProfile({ root, rt: runtime(), id: selected, hardware });

    console.log(
      `Saved ${profile.id} locally. Next: npm run models:pull, then npm run desktop. No models were downloaded by setup.`,
    );
  } else if (command === 'desktop') {
    const marker = await startDesktop({ wait: args.includes('--wait') });
    console.log(
      marker.alreadyRunning
        ? 'Showing the running Capri.'
        : `Capri companion started (process ${marker.pid}).`,
    );
  } else if (command === 'models') {
    process.argv.splice(2, 1);
    await import('./models.mjs');
  } else if (
    ['start', 'stop', 'status', 'init', 'chat', 'image', 'cli', 'restart', 'ollama'].includes(
      command,
    )
  )
    await import('./core.mjs');
  else if (command === 'setup-spotify') {
    process.argv.splice(2, 1);
    await import('../../../integrations/spotify/provision.mjs');
    await import('../../../tools/configuration/configure-spotify.mjs');
  } else if (command === 'spotify') {
    process.argv.splice(2, 1);
    await import('../../../integrations/spotify/cli.mjs');
  } else if (command === 'help' || command === '--help')
    console.log(
      'Capri commands: doctor, profiles, setup [--profile=balanced], models, desktop, start, stop, status, chat. See docs/installation.md.',
    );
  else throw new Error('Unknown command: ' + command);
} catch (error) {
  console.error('Capri: ' + error.message);
  process.exitCode = 1;
}
