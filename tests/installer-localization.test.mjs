// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root } from '../packages/runtime/src/host/paths.mjs';
import {
  installerStrings,
  validateInstallerCatalog,
  validateInstallerLocale,
  installerCulture,
} from '../tools/localization/installer-catalog.mjs';
import { validateLocaleTranslation } from '../tools/localization/interface-locale-validation.mjs';
const catalogFile = path.join(root, 'config/installer-text.json');
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
const progressCatalog = JSON.parse(
  readFileSync(path.join(root, 'config/installer-progress-text.json'), 'utf8'),
);
const uninstallCatalogFile = path.join(root, 'config/uninstaller-text.json');
const uninstallCatalog = JSON.parse(readFileSync(uninstallCatalogFile, 'utf8'));
const shellCatalogFile = path.join(root, 'config/installer-shell-text.json');
const shellCatalog = JSON.parse(readFileSync(shellCatalogFile, 'utf8'));
const locales = JSON.parse(
  readFileSync(path.join(root, 'config/interface-locales.json'), 'utf8'),
).locales;
const languages = locales.map(({ id }) => id);
test('installer progress, native update and uninstall messages cover all languages', () => {
  const placeholders = (text) => (text.match(/\{\d+\}/g) ?? []).sort();
  for (const [name, supplemental] of [
    ['progress', progressCatalog],
    ['uninstall', uninstallCatalog],
    ['shell', shellCatalog],
  ]) {
    assert.deepEqual(Object.keys(supplemental).sort(), [...languages].sort(), name);
    const expected = Object.fromEntries(installerStrings(supplemental.en));
    for (const id of languages) {
      const translated = Object.fromEntries(installerStrings(supplemental[id]));
      assert.deepEqual(
        Object.keys(translated).sort(),
        Object.keys(expected).sort(),
        name + '/' + id,
      );
      for (const [key, source] of Object.entries(expected)) {
        const context = [name, id, key].join('/');
        const actual = translated[key];
        assert.doesNotThrow(() => validateLocaleTranslation(source, actual, id), context);
        assert.deepEqual(placeholders(actual), placeholders(source), context);
        if (id !== 'en' && key !== 'bytes' && !key.startsWith('progressComponent.'))
          assert.notEqual(actual, source, context);
      }
    }
  }
});
test('all Capri languages have a complete offline installer catalog, ordered pages and protected technical values', () => {
  assert.deepEqual(validateInstallerCatalog(catalog, locales), languages);
  assert.equal(languages.length, 50);
  assert.ok(installerStrings(catalog.en).length >= 132);
  const languageNeutral = new Set([
    'budgetUse',
    'voiceHuggingFace',
    'dataLabel',
    'pages.3',
    'pages.4',
    'logsLabel',
    'preAlpha',
  ]);
  const english = Object.fromEntries(installerStrings(catalog.en));
  for (const id of languages) {
    assert.equal(catalog[id].pages.length, 8);
    assert.equal(Object.keys(catalog[id].stages).length, 13);
    assert.ok(catalog[id].accept.includes('GPL-3.0'));
    assert.ok(catalog[id].voiceProfileMissing.includes('voice-profile.json'));
    assert.ok(catalog[id].ramLabel.includes('RAM'));
    assert.ok(catalog[id].vramLabel.includes('VRAM'));
    assert.ok(catalog[id].memoryHelp.includes('RAM') && catalog[id].memoryHelp.includes('VRAM'));
    assert.ok(catalog[id].programFilesPermission.includes('Program Files\\Capri'));
    assert.ok(catalog[id].info.target.includes('Program Files\\Capri'));
    assert.ok(catalog[id].info.voiceMode.includes('Qwen3-TTS'));
    assert.doesNotMatch(JSON.stringify(catalog[id]), /ZXQ[RP]\d+QXZ|[⟦⟬]\d+[⟧⟭]/u);
    if (id !== 'en')
      for (const [key, value] of installerStrings(catalog[id]))
        if (!languageNeutral.has(key)) assert.notEqual(value, english[key], id + '/' + key);
  }
  const incomplete = structuredClone(catalog);
  delete incomplete.ja;
  assert.throws(() => validateInstallerCatalog(incomplete, locales), /languages must match/);
  const altered = structuredClone(catalog.de);
  altered.voiceProfileMissing = altered.voiceProfileMissing.replaceAll(
    'voice-profile.json',
    'other.json',
  );
  assert.throws(() => validateInstallerLocale(catalog.en, altered), /filename/);
  altered.voiceProfileMissing = catalog.de.voiceProfileMissing;
  altered.pages.pop();
  assert.throws(() => validateInstallerLocale(catalog.en, altered), /keys|page/);
  const contaminated = structuredClone(catalog.hi);
  contaminated.back = 'Назад';
  assert.throws(
    () => validateInstallerLocale(catalog.en, contaminated, 'hi'),
    /Unexpected Cyrillic/,
  );
});
test('installer culture aliases match Windows regional variants and fall back to English', () => {
  for (const [culture, expected] of [
    ['de-DE', 'de'],
    ['pt-BR', 'pt'],
    ['zh-TW', 'zh'],
    ['fil-PH', 'tl'],
    ['nb-NO', 'no'],
    ['nn-NO', 'no'],
    ['iw-IL', 'he'],
    ['xx-ZZ', 'en'],
  ])
    assert.equal(installerCulture(culture, languages), expected);
});
test(
  'native setup, Capri and uninstall launchers read all embedded languages before launching scripts',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.join(root, '.runtime/installer-locale-unit');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'fixture-'));
    const harness = path.join(folder, 'harness.cs'),
      executable = path.join(folder, 'harness.exe');
    const settings = path.join(folder, 'data/desktop');
    mkdirSync(settings, { recursive: true });
    writeFileSync(path.join(settings, 'languages.json'), '{"settings":{"interface":"ar"}}');
    writeFileSync(
      harness,
      `using System;using System.Text;using System.Web.Script.Serialization;
internal static class Harness {static int Main(string[] args){Console.OutputEncoding=new UTF8Encoding(false);
foreach(string id in new string[]{${languages.map((id) => '"' + id + '"').join(',')}}){
if(!CapriSetupLocale.Select(id))throw new Exception(id);
Console.WriteLine(new JavaScriptSerializer().Serialize(new {id=id,title=CapriSetupLocale.Text("title"),error=CapriSetupLocale.Text(args[0])}));}
if(CapriSetupLocale.Resolve("fil-PH")!="tl"||CapriSetupLocale.Resolve("nb-NO")!="no"||CapriSetupLocale.Resolve("zz-ZZ")!="en"||CapriSetupLocale.Select("not-a-locale"))return 2;
CapriSetupLocale.SelectInstalled(args[1]);
if(CapriSetupLocale.Language!="ar"||!CapriSetupLocale.RightToLeft)return 3;
return 0;}}`,
    );
    const compiler = path.join(
      process.env.SystemRoot,
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    );
    for (const [file, messages, errorKey] of [
      [catalogFile, catalog, 'bootstrapChecksum'],
      [uninstallCatalogFile, uninstallCatalog, 'repairNeeded'],
      [shellCatalogFile, shellCatalog, 'launcherFailed'],
    ]) {
      const build = spawnSync(
        compiler,
        [
          '/nologo',
          '/target:exe',
          '/out:' + executable,
          '/reference:System.Web.Extensions.dll',
          '/resource:' + file + ',CapriSetupTranslations',
          path.join(root, 'packages/installer/windows/setup-localization.cs'),
          harness,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      );
      assert.equal(build.status, 0, build.stdout + build.stderr);
      const result = spawnSync(executable, [errorKey, folder], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      const rows = result.stdout
        .trim()
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(rows.length, languages.length);
      for (const row of rows) {
        assert.equal(row.title, messages[row.id].title ?? 'Capri Setup');
        assert.equal(row.error, messages[row.id][errorKey]);
      }
    }
  },
);
