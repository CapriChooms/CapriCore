// SPDX-License-Identifier: GPL-3.0-only
import manifest from '../../../config/installer.json' with { type: 'json' };
import modelSizes from '../../../config/qwen-download-sizes.json' with { type: 'json' };
import asr from '../../../config/asr-model-upstream.json' with { type: 'json' };
import vad from '../../../config/asr-vad-upstream.json' with { type: 'json' };
import classifier from '../../../config/request-router-upstream.json' with { type: 'json' };
import candidates from '../../../config/multilingual-candidates.json' with { type: 'json' };
import speech from '../../../config/multilingual-runtime.json' with { type: 'json' };
import qwenVoice from '../../../config/qwen-tts-upstream.json' with { type: 'json' };
import { needsOllamaRocm } from '../../runtime/src/hardware/llm-gpu.mjs';

const MiB = 2 ** 20;
const { artifacts, storage } = manifest;
const modelBytes = ({ files }) =>
  Object.values(files).reduce((bytes, file) => bytes + file.bytes, 0);

export const nodeBootstrapBytes = artifacts.node.bytes + storage.nodeExpandedMiB * MiB;

/** Budget for missing speech components, including their shared package runtime. */
export function estimateSpeechStorage(
  { recognition = 'off', speechLanguage = 'off', router = false, voiceMode },
  { rocmVoice = false } = {},
) {
  const qwen = voiceMode === 'qwen';
  const voice = speechLanguage !== 'off' && !qwen;
  let downloadBytes = 0;
  let extraBytes = storage.reserveMiB * MiB;
  const addPackages = ({ downloadMiB, expandedMiB }) => {
    downloadBytes += downloadMiB * MiB;
    extraBytes += expandedMiB * MiB;
  };
  if (recognition !== 'off' || router || voice || qwen) {
    downloadBytes += artifacts.uv.bytes;
    addPackages(storage.python);
  }
  if (recognition !== 'off') {
    addPackages(storage.recognition);
    downloadBytes += modelBytes(asr) + modelBytes(vad);
    if (recognition !== 'en') downloadBytes += modelBytes(candidates.asr);
    if (recognition !== 'en' && recognition !== 'auto-europe')
      downloadBytes += modelBytes(speech.whisper);
  }
  if (router) {
    addPackages(storage.router);
    downloadBytes += modelBytes(classifier);
  }
  if (qwen) {
    addPackages(storage.qwenVoice);
    downloadBytes += modelBytes(qwenVoice);
  } else if (voice) {
    addPackages(rocmVoice ? storage.rocmVoice : storage.cudaVoice);
    downloadBytes +=
      artifacts.git.bytes +
      (speechLanguage === 'en' ? storage.englishVoiceBytes : modelBytes(speech.tts));
    if (rocmVoice) addPackages(storage.python); // The AMD runtime additionally needs Python 3.12.
    if (speechLanguage === 'zh') {
      downloadBytes += speech.chinese.archiveBytes;
      extraBytes += modelBytes(speech.chinese);
    }
  }
  return { downloadBytes, requiredBytes: downloadBytes + extraBytes };
}

/** Clean-install estimate. Network bytes and unpacked/cache space are separate. */
export function estimateInstallStorage(selection, options = {}) {
  const { recognition, voicePack, voiceMode, inferenceMode, modelSource, conversationLanguage } =
    selection;
  const deferredHub = inferenceMode !== 'api' && modelSource === 'huggingface';
  const downloadModels = inferenceMode !== 'api' && !deferredHub && selection.downloadModels;
  const speechBudget = estimateSpeechStorage(
    {
      recognition: recognition ? conversationLanguage : 'off',
      speechLanguage: voicePack ? conversationLanguage : 'off',
      router: true,
      voiceMode,
    },
    options,
  );
  let downloadBytes =
    artifacts.node.bytes +
    artifacts.electron.bytes +
    artifacts.ollama.bytes +
    storage.npmDownloadMiB * MiB +
    storage.embeddingBytes;
  const rocm = needsOllamaRocm({ ...selection, gpus: options.hardware?.gpus });
  if (rocm) downloadBytes += artifacts.ollamaRocm.bytes;
  if (downloadModels) {
    const profile = manifest.profiles.find(({ id }) => id === selection.profile);
    downloadBytes += modelSizes.models[profile.model];
  }
  return {
    downloadBytes: downloadBytes + speechBudget.downloadBytes,
    requiredBytes:
      downloadBytes +
      (rocm ? artifacts.ollamaRocm.expandedBytes : 0) +
      (storage.coreExpandedMiB + storage.nodeExpandedMiB) * MiB +
      speechBudget.requiredBytes,
  };
}
