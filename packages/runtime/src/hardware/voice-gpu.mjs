// SPDX-License-Identifier: GPL-3.0-only
export function voiceGpuSupported(hardware) {
  if (hardware.gpus?.some((gpu) => /nvidia/i.test(gpu.vendor ?? gpu.name ?? ''))) return true;
  const windows11 =
    hardware.platform === 'win32' && Number(String(hardware.osRelease).split('.')[2]) >= 22000;
  return (
    windows11 &&
    hardware.gpus?.some((gpu) =>
      /\b(?:RX (?:9070(?: XT)?|9060 XT|7900 XTX|7700)|(?:AI )?PRO (?:R9700|W7900(?: Dual Slot)?))\b/i.test(
        gpu.name ?? '',
      ),
    ) === true
  );
}
