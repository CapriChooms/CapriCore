// SPDX-License-Identifier: GPL-3.0-only
import gpuSupport from './llm-gpu-support.json' with { type: 'json' };

// This is Ollama's Windows LLM matrix, independently of the PyTorch/TTS matrix.
// Other Radeon cards retain the bundled Vulkan backend; no gfx target is spoofed.
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const windowsRocmModel = new RegExp(
  `\\bRADEON\\s+(?:${gpuSupport.windowsRocmModels.map(escaped).join('|')})(?:\\s|$)`,
  'i',
);
export function needsOllamaRocm({ inferenceMode = 'local', gpus = [] } = {}) {
  return (
    inferenceMode !== 'api' &&
    gpus.some((gpu) =>
      windowsRocmModel.test(
        String(gpu.name ?? '')
          .replace(/\((?:TM|R)\)/gi, '')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    )
  );
}
