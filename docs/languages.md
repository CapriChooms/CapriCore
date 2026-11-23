# Languages

Open Menu → Languages… and choose the conversation language. Recognition can follow it or use a separate input language. In Spoken voice, Automatic shows and selects the voice matching Conversation language; Text replies only disables speech. Change Conversation language to switch the spoken language. A mismatched voice language is rejected rather than feeding unsupported text to English Turbo. The interface supports 50 independently selectable locales, including RTL languages; see [interface localization](localization.md). The interface setting never translates dialogue or changes the voice by itself. Preferences stay in private `data/desktop/languages.json`. One OpenClaw conversation and owner memory are retained across language changes.

## Coverage

| Layer                           | Implementation                                                   | Coverage                                                                                                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text replies                    | Existing Qwen3.5-9B with explicit per-turn language instructions | 100 named language choices and Other language for a custom language name. Qwen advertises 201 languages/dialects, not every human language. Quality varies.                                                                                                       |
| English recognition             | Parakeet TDT v2, CPU                                             | Existing English recognition and contextual command vocabulary are retained.                                                                                                                                                                                      |
| European recognition            | Parakeet TDT v3, CPU                                             | Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Slovak, Slovenian, Spanish, Swedish, Russian, Ukrainian. English selection uses v2. |
| Other recognition / Auto-detect | faster-whisper 1.2.1, large-v3-turbo, CPU int8                   | 100 language codes exposed by the pinned Whisper implementation, including Japanese, Chinese, Korean, Arabic, Hindi, Hebrew and Turkish. Auto-detection can be less reliable on very short utterances. This path is slower than Parakeet.                         |
| English voice                   | Trained Capri Chatterbox Turbo LoRA                              | The same verified adapter, reference, FP32 token generation and existing optimizations.                                                                                                                                                                           |
| Other spoken languages          | Chatterbox Multilingual v3                                       | 23 languages total including English; English is routed to the trained Turbo instead. Multilingual uses Capri's verified reference recording, not the incompatible Turbo adapter.                                                                                 |

The implemented Chatterbox API supports Arabic, Danish, German, Greek, English, Spanish, Finnish, French, Hebrew, Hindi, Italian, Japanese, Korean, Malay, Dutch, Norwegian, Polish, Portuguese, Russian, Swedish, Swahili, Turkish and Chinese. The actual pinned runtime list is authoritative; advertising material sometimes counts different languages/dialects. `apps/shared/languages.json` is shared by the desktop and Python workers.

Languages without a matching voice automatically receive text replies when voice follows conversation. The menu says this explicitly, and does not silently read foreign text with English Turbo. A custom text language uses automatic recognition from Whisper's finite language set; it does not add that language to the speech models. Unsupported text languages can also disable recognition explicitly. All-language or equal-quality coverage is not claimed.

## Installation and operation

Use **Languages → Install and enable** for a missing voice or recognition model. Capri prepares its own runtimes, the included voice profile and the selected models in the current installation, shows progress and applies the language automatically after success. During Capri Setup, choose your Conversation language and leave Capri voice selected. No separate voice ZIP or destination folder is needed. [Voice installation guide](voice-installation.md).

English uses the trained Turbo voice. Other supported languages use a shared multilingual model. Both voice models contain about 3 GB of weights. Capri checks the space needed for the speech components being installed, including dependencies and temporary files. Existing verified files are reused. `setup-multilingual.cmd` remains a compatibility command for source and development installations.

`config/multilingual-runtime.json` pins model revisions, sizes and SHA-256 checksums. `config/asr-requirements.lock.txt` pins the separate CPU ASR environment. Downloads happen only during setup. Runtime inference and tokenization are offline. Chinese uses a verified local Cangjie mapping and pkuseg segmenter; Japanese uses the installed pykakasi normalizer. Optional Hebrew diacritization/Russian stress annotation are not installed automatically; native text normalization falls back when unavailable.

Changing recognition language stops and releases the microphone; enable it again explicitly. It starts off at every launch. The same selected input device, adjustable trailing pause, wake chime, echo handling and single accurate final transcript remain. Fast wake probes for the Whisper path use English Parakeet on CPU; the complete addressed utterance uses Whisper directly. No low-quality draft is submitted, and microphone samples remain in bounded RAM buffers. A pending Whisper decode has a bounded longer attention window so a slow final transcript is not discarded by the wake timeout.

Conversation, vision answers, voluntary comments and tool confirmations follow the selected reply language. English persona data describes the same Capri character; the selected delivery language overrides old English-only wording. The screenshot shortcut remains the explicit English “Capri, clip that”; ordinary music requests in other languages reach Qwen and its tools. No new local command templates are required.

Only one TTS backend occupies GPU memory at a time. Selecting English loads the trained Turbo; another spoken language loads Multilingual v3. Switching languages within Multilingual reuses the same loaded model. The multilingual Llama backbone uses FP16, its acoustic decoder stays FP32; English stays FP32. The decoder uses CUDA when memory permits and falls back to CPU on an allocation failure. Model preparation starts when settings change. The first transition can take around 12–16 seconds; subsequent sentences do not reload weights. Sentence queues, cancellation, audio effects and timed subtitles work in both paths. Chinese/Japanese, Arabic and Hindi sentence punctuation and right-to-left text are supported. Live speech is returned as in-memory PCM, not temporary audio files.

## Measurements and limits

In a Windows benchmark, synthetic short-phrase checks gave:

| Language | Generated audio | Warm synthesis (token + decoder) | CPU recognition of this synthetic clip |
| -------- | --------------- | -------------------------------- | -------------------------------------- |
| Russian  | 2.72 s          | 4.27 s                           | 0.16 s / Parakeet v3                   |
| Japanese | 3.16 s          | 4.16 s                           | 5.39 s / Whisper                       |
| Chinese  | 3.28 s          | 4.76 s                           | 4.98 s / Whisper                       |
| English  | 2.92 s          | 2.55 s                           | 0.16 s / Parakeet v2                   |

These are synthesis/decode timings, not total request-to-playback latency. Cold transitions were about 15–16 seconds including loading. Multilingual GPU allocation was approximately 2.1 GiB; only one TTS backend was resident alongside Qwen. Longer input, language detection, VRAM pressure, the selected decoder device and concurrent applications affect latency. CPU Whisper auto-detection took 15.7 seconds on a separate longer English fixture. It is a coverage fallback, not a claim of English-speed recognition in every language.

Round trips are diagnostic, not a naturalness certificate. The Russian clip had a first-word recognition error; Japanese had a repeated greeting; Chinese and English remained intelligible in these small samples. Cross-language accent, exact character identity, emotion, numbers and uncommon names still need listening and language-specific evaluation. The multilingual voice is a reference-conditioned clone of the same speaker, not newly trained native-language Capri. The English training files and adapter were not altered.

Verification commands:

- `node scripts/verify-languages.mjs`: real isolated Electron menu, persistence, capability states and capture remaining off.
- `node scripts/verify-language-dialogue.mjs --gateway`: real tool-free Qwen replies in Russian, Japanese and English with synthetic conversation context; the optional Gateway check also verifies the full desktop request in a separate deleted test session.
- `.runtime/asr-venv/Scripts/python.exe scripts/verify-multilingual.py`: real TTS→ASR synthetic phrases and restoration of trained English.
- Targeted Node tests for language validation, dialogue, voice, subtitles and wake behavior; Python ASR session tests.

Reports stay in ignored `logs/`; generated verification PCM stays in `.runtime/multilingual-verification`. No physical microphone, webcam or user screen was captured. Earlier CPU-only v2 evaluation utilities remain separate from the selected production v3 backend.

Sources: [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B), [Chatterbox implementation and language list](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/mtl_tts.py), [Parakeet v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo), [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Upstream model/code licences and attribution do not establish redistribution rights for the character's recordings or artwork. Chatterbox's native watermark is retained.
