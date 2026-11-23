// SPDX-License-Identifier: GPL-3.0-only
/** Visual/component QA only. Never starts models or changes real device preferences. */
import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  root = path.resolve('.');
const parent = path.join(root, '.runtime/model-device-visual');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'case-'));
const css = pathToFileURL(path.join(root, 'apps/desktop/renderer/settings.css')).href;
const module = pathToFileURL(path.join(root, 'apps/desktop/renderer/model-device-panel.mjs')).href;
const ru = JSON.parse(readFileSync('apps/desktop/locales/ru.json', 'utf8')).messages;
writeFileSync(
  path.join(folder, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>
body{background:#07131c;color:#d7eeed;font:14px 'Segoe UI',sans-serif;margin:0;padding:20px;box-sizing:border-box;--cyan:#8ef5ed;--danger:#ff6687}select{display:block;box-sizing:border-box;background:#0b222b;color:#d7eeed;border:1px solid #448f9c;padding:10px;margin:8px 0 12px}button{background:#0b222b;color:#8ef5ed;border:1px solid #448f9c;padding:10px 14px;cursor:pointer}button:disabled{opacity:.4;cursor:default}.settings-card{border:1px solid #448f9c;padding:16px}.settings-actions{display:flex;gap:8px;flex-wrap:wrap}.settings-help{font-size:12px;line-height:1.5;color:#9cb3b8}h3{color:#8ef5ed;margin-top:0}
</style></head><body><main id="host"></main><script type="module">
import {ModelDevicePanel} from ${JSON.stringify(module)};
const dictionary=${JSON.stringify(ru)};window.locale='en';
const ui={text:key=>window.locale==='ru'?(dictionary[key]??key):key};
window.applied=[];const value={current:{language:'auto',voice:'cpu'},options:{language:[{id:'auto',name:'Automatic',available:true},{id:'cpu',name:'CPU',available:true},{id:'cuda:0:0123456789abcdef',name:'NVIDIA GPU',backend:'cuda',available:true},{id:'vulkan:1:fedcba9876543210',name:'AMD Radeon GPU',backend:'vulkan',available:true}],voice:[{id:'auto',name:'Automatic',available:true},{id:'cpu',name:'CPU',available:true},{id:'cuda:0:0123456789abcdef',name:'NVIDIA GPU',backend:'cuda',available:true},{id:'unavailable:amd',name:'AMD Radeon GPU',available:false,reason:'This GPU is not available in the installed voice runtime.'}]}};
window.panel=new ModelDevicePanel({host:document.querySelector('#host'),ui,onError:error=>{throw Error(error)},api:{modelDevices:async()=>structuredClone(value),applyModelDevices:async input=>{window.applied.push(input);return true}}});
window.value=value;window.ready=window.panel.refresh();
window.translate=()=>{for(const element of document.querySelectorAll('h3,label,button,p.settings-help:not([id])'))element.textContent=ui.text(element.dataset.original??(element.dataset.original=element.textContent));window.panel.show(value);};
</script></body></html>`,
);
writeFileSync(
  path.join(folder, 'main.cjs'),
  `const{app,BrowserWindow}=require('electron');process.on('uncaughtException',error=>{console.error(error);app.exit(1)});app.whenReady().then(()=>{const win=new BrowserWindow({width:700,height:700,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadFile(${JSON.stringify(path.join(folder, 'index.html'))});}).catch(error=>{console.error(error);app.exit(1)});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  executablePath: require('electron'),
  args: [path.join(folder, 'main.cjs')],
  env,
  timeout: 30000,
});
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForFunction(() => window.panel?.value);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  const language = page.locator('#model-device-language'),
    voice = page.locator('#model-device-voice');
  await language.selectOption('vulkan:1:fedcba9876543210');
  await voice.selectOption('cuda:0:0123456789abcdef');
  await page.locator('#model-device-apply').click();
  assert.deepEqual(await page.evaluate(() => window.applied[0]), {
    language: 'vulkan:1:fedcba9876543210',
    voice: 'cuda:0:0123456789abcdef',
  });
  await voice.selectOption('unavailable:amd');
  assert.equal(await page.locator('#model-device-apply').isDisabled(), true);
  assert.match(await page.locator('#model-device-voice-reason').textContent(), /not available/);
  assert(
    await page
      .locator('#model-device-voice-reason')
      .evaluate((el) => el.classList.contains('model-device-error')),
  );
  await page.screenshot({ path: path.join(folder, 'unavailable.png') });
  for (const locale of ['en', 'ru']) {
    await page.evaluate((locale) => {
      window.locale = locale;
      window.translate();
    }, locale);
    if (locale === 'ru') assert.equal(await page.locator('h3').textContent(), 'Устройства моделей');
    for (const width of [420, 680]) {
      await application.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700),
        width,
      );
      await page.screenshot({ path: path.join(folder, `${locale}-${width}.png`) });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  }
  await page.evaluate(() => {
    const language = window.value.options.language;
    language.push({
      id: 'npu-setup-vitis',
      name: 'AMD Ryzen AI NPU',
      backend: 'npu',
      available: true,
      npuSetup: 'vitis',
      model: 'Qwen 2.5 · 1.5B',
      bytes: 2449820164,
    });
    language.push({
      id: 'npu-setup-openvino',
      name: 'Intel NPU',
      backend: 'npu',
      available: false,
      npuSetup: 'openvino',
      reason: 'Install or enable the NPU driver in Windows, then refresh devices.',
      installLink: true,
    });
    window.panel.api.nativeNpu = async (value) => {
      window.npuAction = value;
    };
    window.panel.show(window.value);
  });
  await language.selectOption('npu-setup-vitis');
  assert.equal(
    await page.locator('#model-device-apply').textContent(),
    'Настроить NPU и перезапустить',
  );
  assert.match(await page.locator('#model-device-language-reason').textContent(), /Qwen 2\.5/);
  assert.equal(await page.locator('#model-device-npu-advanced').getAttribute('open'), null);
  await page.screenshot({ path: path.join(folder, 'amd-npu-ru.png') });
  await page.locator('#model-device-apply').click();
  assert.deepEqual(await page.evaluate(() => window.applied.at(-1)), {
    language: 'npu-setup-vitis',
    voice: 'cpu',
  });
  await language.selectOption('npu-setup-openvino');
  assert.equal(await page.locator('#model-device-apply').isDisabled(), true);
  await page.locator('#model-device-npu-guide').click();
  assert.deepEqual(await page.evaluate(() => window.npuAction), {
    op: 'install-guide',
    backend: 'openvino',
  });
  console.log(
    JSON.stringify({
      passed: true,
      folder,
      checked: [
        'independent selection',
        'unavailable device',
        'English/Russian',
        '420/680 width',
        'NPU setup and driver guidance',
      ],
    }),
  );
} finally {
  await application.close();
}
