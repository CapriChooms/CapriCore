import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import parakeet from '../../config/asr-model-upstream.json' with { type: 'json' };
import detector from '../../config/asr-vad-upstream.json' with { type: 'json' };
import candidates from '../../config/multilingual-candidates.json' with { type: 'json' };
import multilingual from '../../config/multilingual-runtime.json' with { type: 'json' };
import { LANGUAGE_PACKS } from './renderer/language-settings.mjs';
import {
  selectedVoiceModel,
  voicePython,
  qwenVoiceFilesInstalled,
} from './voice-catalog-service.mjs';
import {
  readVoiceSettings,
  readTrainingSettings,
} from '../../packages/runtime/src/voice-settings.mjs';

export const ENGLISH_VOICE_SETUP_MESSAGE =
  'English voice is not installed. Open Languages and choose Install and enable. Capri downloads and installs everything automatically.';

/** Cheap installation preflight; the Python backend still verifies file hashes before use. */
export function speechModelsInstalled(root, language) {
  if (language === 'off' || !LANGUAGE_PACKS.some((p) => p.id === language && p.speechReady))
    return false;
  try {
    const model = selectedVoiceModel(root, language);
    const voice = readVoiceSettings(root);
    const folder = path.resolve(root, voice.profileDir);
    if (
      !folder.startsWith(path.resolve(root) + path.sep) ||
      !existsSync(path.join(folder, 'voice-profile.json')) ||
      !existsSync(voicePython(root, model))
    )
      return false;
    if (model.backend === 'qwen3-tts') return qwenVoiceFilesInstalled(root, root, model);
    if (model.backend === 'chatterbox-turbo') {
      const profile = JSON.parse(readFileSync(path.join(folder, 'voice-profile.json'), 'utf8'));
      const reference = profile.references?.neutral?.file;
      if (
        profile.language !== 'en' ||
        profile.engine !== 'chatterbox-turbo' ||
        !/^references\/[a-z0-9_-]+\.wav$/.test(reference ?? '') ||
        !['adapter.json', 'adapter.safetensors', reference].every((name) => {
          const info = statSync(path.join(folder, name));
          return info.isFile() && info.size > 0;
        })
      )
        return false;
      const training = readTrainingSettings(root);
      const upstream = JSON.parse(
        readFileSync(path.join(root, 'config/voice-upstream.json'), 'utf8'),
      );
      const directory = path.resolve(root, training.modelDir);
      if (!directory.startsWith(path.join(path.resolve(root), 'data/speech') + path.sep))
        return false;
      const receipt = JSON.parse(readFileSync(path.join(directory, 'model-receipt.json'), 'utf8'));
      return (
        isDeepStrictEqual(receipt.upstream, upstream) &&
        Array.isArray(upstream.model?.files) &&
        upstream.model.files.length > 0 &&
        upstream.model.files.every((name) => {
          const file = path.resolve(directory, name);
          if (
            path.dirname(file) !== directory ||
            !/^[a-f0-9]{64}$/.test(receipt.files?.[name] ?? '')
          )
            return false;
          const info = statSync(file);
          return info.isFile() && info.size > 0;
        })
      );
    }
    const specs = JSON.parse(
      readFileSync(path.join(root, 'config/multilingual-runtime.json'), 'utf8'),
    );
    return [specs.tts, ...(language === 'zh' ? [specs.chinese] : [])].every((spec) => {
      const directory = path.resolve(root, spec.directory);
      return (
        directory.startsWith(path.join(path.resolve(root), 'data/speech') + path.sep) &&
        spec.files.every((item) => {
          const file = path.resolve(directory, item.file);
          return (
            path.dirname(file) === directory &&
            statSync(file).isFile() &&
            statSync(file).size === item.bytes
          );
        })
      );
    });
  } catch {
    return false;
  }
}

export function recognitionModelsInstalled(root, language, config) {
  if (language === 'off') return false;
  try {
    const complete = (directory, files) =>
      files.length > 0 &&
      files.every(({ file, bytes }) => {
        const stat = statSync(path.join(root, directory, file));
        return stat.isFile() && stat.size === bytes;
      });
    if (
      !statSync(path.join(root, '.runtime/asr-venv/Scripts/python.exe')).isFile() ||
      !complete(config.vad.modelDir, Object.values(detector.files))
    )
      return false;
    const kind = LANGUAGE_PACKS.find((p) => p.id === language)?.recognizer;
    if (kind === 'parakeet-v3' || language === 'auto-europe') {
      const candidate = candidates.asr;
      return complete(candidate.directory, candidate.files);
    }
    if (language !== 'auto' && !kind) return false;
    if (!complete(config.modelDir, Object.values(parakeet.files))) return false;
    if (kind === 'parakeet-v2') return true;
    const { whisper } = multilingual;
    return (
      existsSync(path.join(root, '.runtime/asr-venv/Lib/site-packages/faster_whisper')) &&
      complete(whisper.directory, whisper.files)
    );
  } catch {
    return false;
  }
}
