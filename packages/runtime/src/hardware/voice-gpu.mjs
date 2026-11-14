// SPDX-License-Identifier: GPL-3.0-only
export function voiceRocmSupported(hardware) {
  const windows11 =
    hardware.platform === 'win32' && Number(String(hardware.osRelease).split('.')[2]) >= 22000;
  return (
    windows11 &&
    hardware.gpus?.some((gpu) =>
      /\bRADEON\s+(?:RX (?:9070 XT|9070|9060 XT|7900 XTX|7700)|(?:AI )?PRO (?:R9700|W7900(?: Dual Slot)?))$/i.test(
        String(gpu.name ?? '').trim(),
      ),
    ) === true
  );
}

export function voiceGpuSupported(hardware) {
  return Boolean(
    hardware.gpus?.some((gpu) => /nvidia/i.test(gpu.vendor ?? gpu.name ?? '')) ||
      voiceRocmSupported(hardware),
  );
}
