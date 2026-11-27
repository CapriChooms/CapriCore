// SPDX-License-Identifier: GPL-3.0-only
import voiceRuntime from '../../../../config/voice-runtime.json' with { type: 'json' };

const { minimumBuild, models } = voiceRuntime.amdWindows;
const supportedModels = new Set(models.map((model) => model.replace(/\s+/g, '').toUpperCase()));
const amdModel = (name) =>
  String(name ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/^(?:AMD)?(?:RADEON(?:\(TM\)|[®™])?)?/, '');

export function voiceRocmSupported(hardware) {
  const windows11 =
    hardware.platform === 'win32' &&
    Number(String(hardware.osRelease).split('.')[2]) >= minimumBuild;
  return (
    windows11 && hardware.gpus?.some((gpu) => supportedModels.has(amdModel(gpu.name))) === true
  );
}

export function voiceGpuSupported(hardware) {
  return Boolean(
    hardware.gpus?.some((gpu) => /nvidia/i.test(gpu.vendor ?? gpu.name ?? '')) ||
      voiceRocmSupported(hardware),
  );
}
