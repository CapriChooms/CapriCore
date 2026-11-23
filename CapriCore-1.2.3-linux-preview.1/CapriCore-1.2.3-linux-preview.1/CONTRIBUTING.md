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

For cross-module code navigation, Graphify is available as an optional local CLI.
It uses the Windows Python launcher (`py`) and stores its environment and index
under `.runtime/graphify`. It indexes tracked working copies of source files
from the application, packages, integrations, scripts, tools and tests. Stage new
source files before indexing them, and rebuild after changes. Code extraction
runs locally with model backends and query logging disabled. Check inferred
connections against the source before editing.

```powershell
npm run dev:graphify -- install
npm run dev:graphify -- build
npm run dev:graphify -- html
npm run dev:graphify -- query "Native NPU worker initialization and shutdown"
npm run dev:graphify -- path "NpuInference" "NpuWorker"
```

Open the path printed by `html` in a browser. Group names come from their most
represented source file and a connected symbol, without using a model.

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

## CapriCore skills

Keep feature contracts in `packages/skills/src` and shared protocol types in
`packages/skill-sdk`. A built-in skill declares its ID, API version, command
input/output validators, allowed origins and required ports. Register it through
`CapriCore.register(definition, ports)` from a trusted host adapter. Supply only
the ports it declares. Use `core.dispatch` for safe result envelopes and
`core.call` for compatibility adapters that need the original result and error
shape. Use the operation signal for all cancellable work.

Keep device acquisition, exact-frame consent, credentials and raw PCM or frame
streams in their host adapters. Route Settings and toolbar actions through the
same registered command and preserve the existing preload, protocol and locale
boundaries. User tools continue to run through the existing isolated execution
path. See the [refactor plan](docs/plans/capricore-modular-refactor.md) for
migration and release checks.

## Licensing

Project-owned contributions are **GPL-3.0-only**. Include only code and assets you
have authority to contribute, with appropriate provenance and notices. Optional
voice, character and model packs retain their separate terms; see
[licensing](docs/licensing.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
