# Contributing

CapriCore is public. You can read the source, download releases and fork
[CapriChooms/CapriCore](https://github.com/CapriChooms/CapriCore) without an
early-access invitation. A GitHub account is needed to submit an issue or pull
request, but not to install Capri or check for updates.

## Propose a change

1. Search existing issues and pull requests for the problem. Report security
   vulnerabilities through the [private security channel](SECURITY.md).
2. Fork this repository to your account, clone your fork and create a branch for
   the change. Keep unrelated fixes in separate pull requests.
3. Make the change and run the relevant checks below. Use synthetic fixtures
   rather than personal conversations, credentials or recordings.
4. Push your branch to your fork and open a pull request targeting
   **CapriChooms/CapriCore → main**. Explain the original problem, resulting
   behavior, reproduction steps and validation results.

`main` is protected: changes go through pull requests, the required `windows`
check must pass against an up-to-date branch, and review conversations must be
resolved. Force pushes and deletion of `main` are blocked. Do not request an
administrative bypass to merge a failing change. Maintainers review and merge
contributions; opening a pull request does not grant direct write access.

## Development and validation

Use Windows x64 for desktop and native checks, the Node version in
[.node-version](.node-version), and Python 3.11 for Python checks. Install the
locked dependencies from the repository root:

```powershell
npm ci
npm run check -- --require-python
npm test
npm run format:check
npm run release:check
```

The [CI workflow](.github/workflows/ci.yml) lists the additional Python, installer,
speech and interface checks. Run checks appropriate to the affected component
and report anything you could not run. GPU, physical audio and live-model
qualification are separate from fixture tests: state the exact Windows version,
hardware, model, backend and installed speech packs when claiming such coverage.

Keep host APIs in `packages/runtime`, presentation in `apps/desktop/renderer`,
and platform/model work behind adapters. Preserve cancellation, bounded queues,
explicit permissions and CPU/text fallback. Add meaningful regressions at failure
boundaries. Dependency updates require pinned compatibility review; do not replace
an upstream bundle without checking its integration. Locale changes belong in
editable catalogs and the glossary; rebuild the generated bundle with
`npm run build:locales`.

Do not commit runtime state, diagnostic archives, personal paths, tokens, chat
history, memory, recordings or private model weights. Never use a contributor's
real chats or accounts as an automated fixture. Keep discussion respectful and
describe any data/configuration migration or remaining limitation in the pull
request.

## Licensing

Project-owned contributions are **GPL-3.0-only**. Include only code and assets you
have authority to contribute, with appropriate provenance and notices. Optional
voice, character and model packs retain their separate terms; see
[licensing](docs/licensing.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
