// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { validateInstallerCatalog } from '../localization/installer-catalog.mjs';
if (process.platform !== 'win32') throw new Error('Native installer verification runs on Windows');
const parent = path.join(root, '.runtime/installer-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-'));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(root, 'config/installer-text.json'), 'utf8'));
const locales = JSON.parse(
  readFileSync(path.join(root, 'config/interface-locales.json'), 'utf8'),
).locales;
const available = validateInstallerCatalog(catalog, locales);
const options = process.argv.slice(2);
if (options.some((arg) => !/^--(?:dpi=\d+|locales=[a-z,]+)$/.test(arg)))
  throw new Error('Supported options: --dpi=96 and --locales=en,ru');
const languages =
  options
    .find((arg) => arg.startsWith('--locales='))
    ?.slice(10)
    .split(',') ?? available;
if (languages.some((id) => !available.includes(id)))
  throw new Error('Unknown installer verification language');
const dpi = Number(options.find((arg) => arg.startsWith('--dpi='))?.slice(6) ?? 96);
if (![96, 120, 144, 192, 240, 288, 384].includes(dpi))
  throw new Error('Unsupported verification DPI');
const result = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'packages/installer/windows/wizard.ps1'),
    '-VerificationDirectory',
    folder,
    '-VerificationLanguages',
    languages.join(','),
    '-VerificationDpi',
    String(dpi),
  ],
  {
    encoding: 'utf8',
    windowsHide: true,
    // Rendering all 400 pages needs more time on shared CI than a small locale
    // sample. Keep a finite per-language allowance without dropping coverage.
    timeout: Math.max(90000, 30000 + languages.length * 6000),
  },
);
if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
const images = readdirSync(folder).filter((name) => name.endsWith('.png'));
if (images.length !== languages.length * 8) throw new Error('Not every installer page rendered');
for (const language of languages) {
  const choice = JSON.parse(readFileSync(path.join(folder, language + '-selection.json'), 'utf8'));
  if (choice.index < 0 || !choice.text.startsWith(language + ' | '))
    throw new Error('Installer language selection is not initialized');
  if (choice.items.length !== available.length)
    throw new Error('Installer language picker is incomplete');
  const models = JSON.parse(readFileSync(path.join(folder, language + '-models.json'), 'utf8'));
  if (
    models.index < 0 ||
    !models.text.includes('RAM') ||
    models.items.length !== 6 ||
    !models.items.some((row) => row.includes('gemma4:e2b (BETA)')) ||
    !models.items.some((row) => row.includes('ministral-3:3b (BETA)')) ||
    models.items.some((row) => !row.includes('RAM') || !row.includes('VRAM'))
  )
    throw new Error('Installer model requirements or selection are incomplete');
  const layout = JSON.parse(readFileSync(path.join(folder, language + '-layout.json'), 'utf8'));
  if (layout.versionLabel !== 'v' + version)
    throw new Error('Installer does not display its exact package version: ' + language);
  if (
    layout.rtl !== (locales.find(({ id }) => id === language).direction === 'rtl') ||
    !layout.scrollable
  )
    throw new Error('Installer direction or scrolling is incorrect: ' + language);
  if (
    layout.voiceError !== catalog[language].voiceProfileMissing ||
    layout.title !== catalog[language].title
  )
    throw new Error('Installer errors or title are not translated: ' + language);
  if (
    layout.dpi !== dpi ||
    layout.fontUnit !== 'Pixel' ||
    !layout.perMonitorV2 ||
    layout.footerBottom > layout.clientHeight
  )
    throw new Error('Installer DPI or footer bounds are incorrect: ' + language);
}
console.log(
  JSON.stringify({
    passed: true,
    nativePages: images.length,
    languages,
    dpi,
    folder,
    installationStarted: false,
    ownerDataAccessed: false,
  }),
);
