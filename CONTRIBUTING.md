# Contributing

Project-owned contributions are GPL-3.0-only. Include only code/assets you have authority to contribute. Optional voice/character/model packs retain separate terms.

Use .node-version and npm ci. Run npm run check, npm test, npm run format:check and npm run release:check. Python checks require Python. GPU/audio/model qualification is separate and must state the exact hardware and installed packs. Never include owner transcripts, tokens, recordings or private weights in fixtures.

Keep host APIs in packages/runtime, presentation in renderer, and platform/model work behind adapters. Add meaningful regressions for failure boundaries. Preserve cancellation, bounded queues, explicit permissions and CPU/text fallback. Do not replace unknown upstream bundles: dependency updates need pinned compatibility review.

Pull requests should describe resulting behavior, validation, migration impact and actual hardware coverage. Keep discussion respectful and technical. Locale changes belong in editable catalogs and glossary; rebuild the generated bundle.
