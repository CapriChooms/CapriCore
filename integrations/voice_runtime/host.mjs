import { readFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import {
  root,
  launch,
  request,
  managedProcess,
  stopManaged,
} from '../../packages/runtime/src/index.mjs';
import { LANGUAGE_PACKS } from '../../apps/desktop/renderer/language-settings.mjs';
import { waitForVoiceReady } from './readiness.mjs';
import { voiceStartupError } from './startup-error.mjs';
import { voiceRuntimeEnvironment } from './environment.mjs';
import { selectedVoiceModel, voicePython } from '../../apps/desktop/voice-catalog-service.mjs';
import { speechModelsInstalled } from '../../apps/desktop/language-models.mjs';
import { readVoiceSettings } from '../../packages/runtime/src/voice-settings.mjs';
import { requiresPrivacyRestart } from '../../packages/runtime/src/host/processes.mjs';

export function companionVoiceSettings() {
  const value = readVoiceSettings(root);
  if (
    value.schemaVersion !== 1 ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535 ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('Invalid companion voice settings');
  return value;
}
export const companionVoiceUrl = () => `http://127.0.0.1:${companionVoiceSettings().port}`;
export function companionVoiceInstalled(language) {
  return language
    ? speechModelsInstalled(root, language)
    : LANGUAGE_PACKS.some((pack) => pack.speechReady && speechModelsInstalled(root, pack.id));
}
export const companionVoiceHeaders = () => ({
  authorization: `Bearer ${readFileSync(path.join(root, 'data/speech/companion-voice-token'), 'utf8').trim()}`,
});

export async function startCompanionVoice({ language = 'en', signal, modelId } = {}) {
  if (!LANGUAGE_PACKS.some((pack) => pack.id === language && pack.speechReady))
    throw new Error('Unsupported spoken language');
  signal?.throwIfAborted();
  const config = companionVoiceSettings();
  // The explicit Turbo override is used only to validate a new training
  // candidate; normal speech always follows the saved per-language choice.
  if (modelId !== undefined && (modelId !== 'chatterbox-turbo' || language !== 'en'))
    throw new Error('Unsupported voice validation override.');
  const selected = modelId ? { backend: 'chatterbox-turbo' } : selectedVoiceModel(root, language);
  const expectedEngine =
    selected.backend === 'chatterbox-turbo'
      ? 'turbo'
      : selected.backend === 'qwen3-tts'
        ? 'qwen3-tts'
        : 'multilingual-v3';
  const profile = path.resolve(root, config.profileDir);
  if (!profile.startsWith(root + path.sep))
    throw new Error('Voice profile must stay in this project.');
  const expected = JSON.parse(readFileSync(path.join(profile, 'voice-profile.json'), 'utf8'));
  const python = voicePython(root, selected);
  if (!existsSync(python))
    throw new Error('Install the voice environment with setup-voice-training.cmd.');
  if (requiresPrivacyRestart(managedProcess('companion-voice')))
    await stopManaged('companion-voice');
  const health = async () =>
    request(`${companionVoiceUrl()}/health`, {
      headers: companionVoiceHeaders(),
      timeout: 3000,
      signal,
    });
  let current = await health().catch((error) => {
    // Another Capri installation may already own this port. Do not load a second
    // CUDA model just to discover that binding the HTTP socket will fail.
    if (/^HTTP (?:401|403) from /.test(error.message))
      throw new Error(
        'Voice port belongs to another installation. Close its voice service before starting this one.',
      );
    return null;
  });
  signal?.throwIfAborted();
  if (current && !managedProcess('companion-voice'))
    throw new Error('Voice port belongs to an unmanaged process.');
  if (
    current &&
    (current.protocolVersion !== 2 ||
      current.activeEngine !== expectedEngine ||
      current.profile !== expected.id ||
      current.adapterSha256 !== expected.adapterSha256)
  ) {
    await stopManaged('companion-voice');
    current = null;
  }
  signal?.throwIfAborted();
  const startedAt = Date.now();
  let worker = managedProcess('companion-voice');
  if (!current && !worker)
    worker = await launch(
      'companion-voice',
      python,
      [
        '-m',
        'integrations.voice_runtime.server',
        '--language',
        language,
        ...(modelId ? ['--validate-turbo'] : []),
      ],
      undefined,
      { env: voiceRuntimeEnvironment(root) },
    );
  const result = await waitForVoiceReady({
    health,
    isRunning: () => managedProcess('companion-voice') !== null,
    signal,
  }).catch((error) => {
    if (signal?.aborted) throw error;
    try {
      const file = path.join(root, 'data/run/voice-startup-error.json'),
        info = lstatSync(file);
      if (info.isFile() && !info.isSymbolicLink() && info.size < 4096) {
        const specific = voiceStartupError(JSON.parse(readFileSync(file, 'utf8')), {
          pid: worker?.pid,
          startedAt,
        });
        if (specific) throw specific;
      }
    } catch (specific) {
      if (specific.code === 'CAPRI_VOICE_COMMIT_LIMIT') throw specific;
    }
    throw error;
  });
  if (
    result?.ready !== true ||
    result.protocolVersion !== 2 ||
    result.engine !== 'chatterbox-turbo' ||
    result.profile !== expected.id ||
    result.adapterSha256 !== expected.adapterSha256 ||
    result.activeEngine !== expectedEngine
  )
    throw new Error(
      'Running voice service does not match the selected profile. Restart Capri with stop.cmd.',
    );
  return result;
}
