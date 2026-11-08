# Interface localization

The Windows Setup.exe also includes all 50 interface languages. Its language is
chosen on the Welcome page and is independent of the conversation/voice language.
The initial selection follows the Windows UI culture, with English fallback.
See [installer localization](installation-wizard.md#installer-localization).

The desktop has 50 interface locales. Open Menu → Languages… → Interface language, then apply. Language names appear in their own language, with English kept first for recovery. Interface changes apply immediately and persist on restart. They do not change conversation language, recognition, the voice, microphone permissions, file permissions or owner memory. UI-only changes also work when a speech model is absent.

Coverage includes the common controls, native menus, settings, tooltips, screen-observation controls, voice effects, microphone settings and known status/error messages. Arabic, Hebrew, Persian and Urdu use right-to-left settings and text layout; the companion's screen position and portrait geometry remain stable. Number/date formatting follows the selected interface locale. Dialogue, subtitle content, drafts, device names, file paths and window titles remain data and are not translated by the UI layer. Newly added or unknown UI messages fall back to English.

## Editable sources

- `apps/desktop/locales/en.json`: canonical English keys and source strings.
- `apps/desktop/locales/<locale>.json`: editable translations, one complete file per locale.
- `config/interface-locales.json`: supported locale IDs, native names and text direction. Interface locales are separate from speech capabilities.
- `config/interface-glossary.json`: curated core terminology, including the distinction between conversation language, recognition and spoken voice.
- `apps/shared/interface-locales.json`: generated runtime bundle. It ships with the project so end users need no translator, network connection or localization build step.

English, Russian, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Ukrainian, Czech, Slovak, Bulgarian, Croatian, Serbian, Slovenian, Romanian, Hungarian, Greek, Danish, Norwegian, Swedish, Finnish, Estonian, Latvian, Lithuanian, Icelandic, Catalan, Arabic, Hebrew, Persian, Urdu, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Punjabi, Chinese, Japanese, Korean, Vietnamese, Thai, Indonesian, Malay, Filipino, Turkish, Swahili and Afrikaans are included.

New translations were prepared locally using Qwen3.5-9B from public UI strings only, without a persona, owner history or action tools. Generation and contextual review use explicit English keys to prevent translations becoming associated with neighboring entries. Product names, filenames and substitution slots are preserved. Core labels have a separate glossary; machine review catches meaning/order errors and distinguishes minimizing to the signal icon from sending an OS signal, and releasing models from loading them. These checks do not constitute native-speaker proofreading. Native review is welcome before a public release, especially for permissions, uncommon languages and longer help paragraphs.

## Maintaining translations

To edit ordinary text, change its locale JSON and rebuild. For curated terms or
entries listed in the glossary's `overrides`, edit the glossary instead: applying
it deliberately restores those reviewed values before rebuilding.

```powershell
node tools/localization/apply-interface-glossary.mjs
node tools/localization/build-interface-locales.mjs
```

Core terminology is maintained in the glossary; update the corresponding glossary entry when changing a core label. To add a locale, add its metadata and full translation file, then rebuild. Interface regional variants can be added independently of ASR/TTS language IDs. The builder refuses incomplete catalogs, changed placeholders, product names, filenames and numerical settings. It also rejects accidental text in an unrelated writing system, such as Russian statuses in Hindi or Cyrillic fragments inside Croatian words. Explicit foreign-language examples in the source remain valid. Build output is written atomically. English fallbacks are runtime resilience, not a substitute for shipping a complete locale.

Editorial checks distinguish personal facts from RAM usage, a local document
knowledge base from geographical knowledge, and voice preparation from speaking.
Workflow action captions are localized separately from executable action IDs,
target labels and user variables. The latter remain unchanged in saved JSON.
These checks catch specific regressions; they do not prove that every sentence
has been reviewed by a native speaker.

Optional local preparation tools require the project's already installed Ollama/Qwen model:

```powershell
node tools/localization/translate-interface.mjs
node tools/localization/apply-interface-glossary.mjs
node tools/localization/review-interface-locales.mjs
node tools/localization/apply-interface-glossary.mjs
node tools/localization/build-interface-locales.mjs
```

Generation resumes from saved messages. Contextual review checkpoints each batch and records its source revision; a changed English key or source value invalidates an older review. `--locales=de,fr` limits a preparation/review run. These are developer tools, never part of normal app startup or a language switch. Machine corrections remain reviewable JSON. Reports are local under ignored `logs/`.

## Verification

`node --test tests/interface-locales.test.mjs tests/workflow-localization.test.mjs tests/language-settings.test.mjs` checks locale coverage, agreement between editable catalogs and the runtime bundle, core terminology, substitution slots, writing systems, RTL metadata and separation from dialogue settings. `node tools/verify/verify-interface-locales.mjs` uses an isolated real Electron window and synthetic messages to check every advertised language, persistence, labels/tooltips, native menus, workflow captions, layout bounds and preservation of chat/draft/file data. Verification images contain only the test window; no physical microphone, webcam or user screen is captured.
