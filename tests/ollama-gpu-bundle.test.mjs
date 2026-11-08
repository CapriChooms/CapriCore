// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
  renameSync,
  linkSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import manifest from '../config/installer.json' with { type: 'json' };
import gpuSupport from '../packages/runtime/src/hardware/llm-gpu-support.json' with { type: 'json' };
import { needsOllamaRocm } from '../packages/runtime/src/hardware/llm-gpu.mjs';
import { estimateInstallStorage } from '../packages/installer/src/storage-estimate.mjs';
import {
  inspectOllamaBundle,
  inspectOllamaRocmBundle,
  OLLAMA_BACKEND_FILES,
  OLLAMA_ROCM_FILES,
  OLLAMA_ROCM_DIRECTORY,
} from '../packages/runtime/src/host/ollama-bundle.mjs';
const parent = path.join(root, '.runtime/ollama-gpu-unit');
mkdirSync(parent, { recursive: true });
const fixture = () => mkdtempSync(path.join(parent, 'case-'));

test(
  'base Vulkan validation rejects linked parent directories and hard-linked runtime DLLs',
  { skip: process.platform !== 'win32' },
  () => {
    const makeBundle = () => {
      const base = fixture();
      for (const name of OLLAMA_BACKEND_FILES) {
        const file = path.join(base, 'lib/ollama', name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, 'public backend fixture');
      }
      return base;
    };
    const linked = makeBundle(),
      external = path.join(fixture(), 'vulkan');
    const original = path.join(linked, 'lib/ollama/vulkan');
    assert.ok(original.startsWith(parent + path.sep) && external.startsWith(parent + path.sep));
    renameSync(original, external);
    symlinkSync(external, original, 'junction');
    assert.equal(
      inspectOllamaBundle(path.join(linked, 'ollama.exe'), { bundled: true }).ready,
      false,
    );
    const hardlinked = makeBundle(),
      dll = path.join(hardlinked, 'lib/ollama/vulkan/ggml-vulkan.dll');
    const shared = path.join(fixture(), 'shared.dll');
    writeFileSync(shared, 'shared external public fixture');
    unlinkSync(dll);
    linkSync(shared, dll);
    assert.deepEqual(
      inspectOllamaBundle(path.join(hardlinked, 'ollama.exe'), { bundled: true }).missing,
      ['vulkan/ggml-vulkan.dll'],
    );
  },
);

test('LLM ROCm delivery uses its own Windows matrix and keeps Vulkan-only cards on the default route', () => {
  for (const model of gpuSupport.windowsRocmModels)
    assert.equal(needsOllamaRocm({ gpus: [{ name: 'AMD Radeon(TM) ' + model }] }), true, model);
  for (const name of [
    'AMD Radeon RX 6400',
    'AMD Radeon RX 6800 XT',
    'AMD Radeon RX 9070 XT',
    'AMD Radeon Graphics',
    'NVIDIA GeForce fixture',
    'Intel Arc A770',
  ])
    assert.equal(needsOllamaRocm({ gpus: [{ name }] }), false, name);
  assert.equal(
    needsOllamaRocm({ inferenceMode: 'api', gpus: [{ name: 'AMD Radeon RX 7900 XTX' }] }),
    false,
  );
  assert.equal(
    needsOllamaRocm({ gpus: [{ name: 'NVIDIA fixture' }, { name: 'AMD Radeon RX 7600 XT' }] }),
    true,
  );
});

test('AMD disk estimates include the exact reviewed add-on archive plus its expanded bytes only when needed', () => {
  const selection = {
    profile: 'balanced',
    inferenceMode: 'local',
    conversationLanguage: 'en',
    downloadModels: false,
  };
  const baseline = estimateInstallStorage(selection);
  const amd = estimateInstallStorage(selection, {
    hardware: { gpus: [{ name: 'AMD Radeon RX 7900 XT' }] },
  });
  assert.equal(amd.downloadBytes - baseline.downloadBytes, 256578673);
  assert.equal(amd.requiredBytes - baseline.requiredBytes, 256578673 + 1025349792);
  for (const [inferenceMode, name] of [
    ['api', 'AMD Radeon RX 7900 XT'],
    ['local', 'AMD Radeon RX 6400'],
  ]) {
    assert.deepEqual(
      estimateInstallStorage({ ...selection, inferenceMode }, { hardware: { gpus: [{ name }] } }),
      estimateInstallStorage({ ...selection, inferenceMode }),
    );
  }
  assert.equal(manifest.artifacts.ollamaRocm.version, manifest.artifacts.ollama.version);
});

test(
  'a missing Vulkan loader dependency invalidates the base bundle rather than silently falling back',
  { skip: process.platform !== 'win32' },
  () => {
    const base = fixture(),
      exe = path.join(base, 'ollama.exe');
    for (const name of OLLAMA_BACKEND_FILES) {
      const file = path.join(base, 'lib/ollama', name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'public fixture');
    }
    assert.equal(inspectOllamaBundle(exe, { bundled: true }).ready, true);
    unlinkSync(path.join(base, 'lib/ollama/vulkan/vcruntime140_1.dll'));
    assert.deepEqual(inspectOllamaBundle(exe, { bundled: true }).missing, [
      'vulkan/vcruntime140_1.dll',
    ]);
  },
);

test(
  'ROCm enumeration includes additional kernel files and refuses linked backend content',
  { skip: process.platform !== 'win32' },
  () => {
    const base = fixture(),
      exe = path.join(base, 'ollama.exe');
    const folder = path.join(base, 'lib/ollama', OLLAMA_ROCM_DIRECTORY);
    assert.equal(inspectOllamaRocmBundle(exe).ready, false);
    for (const name of OLLAMA_ROCM_FILES) {
      const file = path.join(folder, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'public fixture');
    }
    const extra = 'rocblas/library/extra-kernel.hsaco';
    writeFileSync(path.join(folder, extra), 'public fixture');
    assert.ok(inspectOllamaRocmBundle(exe).files.includes(extra));
    for (const name of ['ggml-hip.dll', extra]) {
      writeFileSync(path.join(folder, name), '');
      assert.equal(inspectOllamaRocmBundle(exe).ready, false);
      assert.equal(inspectOllamaRocmBundle(exe, { requireFiles: false }).ready, true);
      writeFileSync(path.join(folder, name), 'public fixture');
    }
    const outside = path.join(fixture(), 'outside-kernel.hsaco');
    writeFileSync(outside, 'outside canary');
    unlinkSync(path.join(folder, extra));
    linkSync(outside, path.join(folder, extra));
    assert.equal(inspectOllamaRocmBundle(exe).ready, false);
    assert.equal(inspectOllamaRocmBundle(exe, { requireFiles: false }).ready, false);
    assert.equal(readFileSync(outside, 'utf8'), 'outside canary');
    unlinkSync(path.join(folder, extra));
    writeFileSync(path.join(folder, extra), 'public fixture');
    symlinkSync(fixture(), path.join(folder, 'foreign'), 'junction');
    assert.equal(inspectOllamaRocmBundle(exe).ready, false);
    assert.equal(inspectOllamaRocmBundle(exe, { requireFiles: false }).ready, false);
  },
);
