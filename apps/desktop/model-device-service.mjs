// SPDX-License-Identifier: GPL-3.0-only
import {
  readModelDevices,
  saveModelDevices,
} from '../../packages/runtime/src/model-device-settings.mjs';
import {
  probeLanguageDevices,
  migrateLanguageDevice,
  probeVoiceDevices,
  resolveModelDevice,
} from '../../packages/runtime/src/hardware/model-devices.mjs';
import { probeHardware } from '../../packages/runtime/src/hardware/probe.mjs';
import { selectedVoiceModel, voiceRuntimes } from './voice-catalog-service.mjs';
import { createHash } from 'node:crypto';

const basic = () => [
  { id: 'auto', name: 'Automatic', available: true },
  { id: 'cpu', name: 'CPU', available: true },
];
const normalize = (name) =>
  name
    .replace(/^(?:NVIDIA|AMD)\s+/i, '')
    .replace(/\((?:TM|R)\)|[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
export class ModelDeviceService {
  constructor({
    root,
    ollama,
    config = {},
    hardware = probeHardware,
    languageProbe = probeLanguageDevices,
    voiceProbe = probeVoiceDevices,
    npuSetup,
  }) {
    Object.assign(this, { root, ollama, config, hardware, languageProbe, voiceProbe, npuSetup });
  }
  current() {
    return readModelDevices(this.root, {
      language: this.config.acceleration === 'cpu' ? 'cpu' : 'auto',
    });
  }
  async refresh(language = 'en') {
    if (this.pending) {
      if (this.pendingLanguage === language) return this.pending;
      await this.pending;
    }
    this.pendingLanguage = language;
    this.pending = this.inspect(language).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async inspect(language) {
    // Device discovery is independent of voice readiness. Missing/incompatible
    // voice selections must not prevent choosing a language-model device.
    let model,
      runtimes = [];
    try {
      model = selectedVoiceModel(this.root, language);
      runtimes = voiceRuntimes(this.root, model).filter(({ backend }) => backend !== 'cpu');
    } catch {
      /* CPU/Automatic remain selectable; unsupported voice GPUs stay marked. */
    }
    const qwen = model?.backend === 'qwen3-tts';
    const voiceProbes = runtimes.map(({ python, env }) =>
      Promise.resolve().then(() => this.voiceProbe(this.root, python, { env, qwen })),
    );
    const inventories = await Promise.allSettled([
      Promise.resolve().then(() => this.languageProbe(this.ollama)),
      Promise.allSettled(voiceProbes).then((values) =>
        values.flatMap((value) => (value.status === 'fulfilled' ? value.value : [])),
      ),
      Promise.resolve().then(() => this.hardware()),
      Promise.resolve().then(() => this.npuSetup?.options() ?? []),
    ]);
    const [llm, voice, hardware, npu] = inventories.map((result, index) =>
      result.status === 'fulfilled' ? result.value : index === 2 ? { gpus: [] } : [],
    );
    const complete = (devices, role) => [
      ...basic(),
      ...devices,
      ...(hardware.gpus ?? [])
        .filter(
          (gpu, index, list) =>
            !devices.some((device) => normalize(device.name) === normalize(gpu.name)) &&
            list.findIndex((row) => normalize(row.name) === normalize(gpu.name)) === index,
        )
        .map((gpu) => ({
          id: 'unavailable:' + createHash('sha256').update(gpu.name).digest('hex').slice(0, 16),
          name: gpu.name,
          available: false,
          reason:
            role === 'voice'
              ? 'This GPU is not available in the installed voice runtime.'
              : 'This GPU is not available in the installed language model runtime.',
        })),
    ];
    return (this.value = {
      current: this.current(),
      voiceModel: model?.id ?? null,
      options: {
        language: [
          ...complete(migrateLanguageDevice(this.current().language, llm), 'language'),
          ...npu,
        ],
        voice: complete(voice, 'voice'),
      },
    });
  }
  async validate(value, language = 'en') {
    if (!value || Object.keys(value).some((key) => !['language', 'voice'].includes(key)))
      throw Error('Invalid model device selection.');
    // Recheck at the moment of saving: hot-unplugged/stale choices cannot be committed.
    const catalog = await this.refresh(language);
    for (const role of ['language', 'voice']) {
      const options = catalog.options[role];
      const npu = options.find(({ id, npuSetup }) => id === value[role] && npuSetup);
      if (npu && !npu.available) throw new Error(npu.reason);
      resolveModelDevice(value[role], options);
    }
    return { language: value.language, voice: value.voice };
  }
  save(value) {
    return saveModelDevices(this.root, value);
  }
}
