// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { noLinks } from '../../runtime/src/huggingface/artifacts.mjs';
import { MODEL_CHOICES, selectModelChoice } from '../../runtime/src/hardware/model-catalog.mjs';
import { HuggingFaceHub } from '../../runtime/src/huggingface/hub.mjs';
import { saveModelProfile } from '../../runtime/src/hardware/model-profile.mjs';
import { loadCoreSettings } from '../../runtime/src/config/settings.mjs';

/** Imported choices come only from Capri's verified local receipts, never request-supplied profiles. */
export function installerModelProfile(id, hardware, target) {
  if (/^hf-[a-f0-9]{24}$/.test(id ?? '')) {
    const hub = new HuggingFaceHub({ root: target, ollamaUrl: 'http://127.0.0.1:11435' });
    const profile = hub.receipt(id).profile;
    if (!profile) throw new Error('The installed Hugging Face model needs repair in Capri.');
    return profile;
  }
  return selectModelChoice(id, hardware);
}

/** Keep an unchanged selection byte-identical; explicit switches retain unrelated private settings. */
export function applyInstallerModelSelection({ root, plan, hardware }) {
  if (plan.inferenceMode !== 'local' || plan.modelSetupRequired) return null;
  const file = path.join(root, 'config/core.local.json');
  for (const name of [file, path.join(root, 'data/openclaw/openclaw.json')]) {
    noLinks(name);
    if (existsSync(name) && lstatSync(name).nlink !== 1)
      throw new Error('Model settings cannot contain filesystem links.');
  }
  if (!existsSync(file)) return null;
  const current = loadCoreSettings(path.join(root, 'config'));
  const profile = installerModelProfile(plan.profile, hardware, root);
  if (current.model === profile.alias || current.model === profile.model) return null;
  const result = saveModelProfile({
    root,
    rt: {
      stateDir: path.join(root, 'data/openclaw'),
      configPath: path.join(root, 'data/openclaw/openclaw.json'),
      workspace: path.join(root, 'data/workspace'),
      gatewayPort: current.gatewayPort,
      ollamaUrl: `http://127.0.0.1:${current.ollamaPort}`,
    },
    id: profile.id,
    hardware,
    importedProfiles: MODEL_CHOICES.some((item) => item.id === profile.id) ? [] : [profile],
  });
  return result.restore;
}
