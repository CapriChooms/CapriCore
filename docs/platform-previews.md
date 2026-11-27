# Linux and macOS builds

Each platform builds from the same Capri release snapshot as Windows. A platform build uses the Node version in `.node-version`, the shared `package-lock.json`, and the versions in `config/release.json` and the package manifests. Keep the Linux and Mac changes in the shared source tree.

## Build both

Push the release snapshot to a branch named `codex/ports-<version>` to run **Capri platform previews**. The workflow builds on Ubuntu x86-64 and Apple Silicon, launches both builds, verifies their SHA-256 checksums, and uploads the paired archives and checksum files as workflow artifacts. You can also select the release snapshot branch with **Run workflow** once the workflow has landed on the default branch.

## Build one locally

Run `npm ci` and `node node_modules/electron/install.js` from the release snapshot. Match the build host and command to the platform.

| Host                | Command                                               | Result                                          |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Linux x86-64        | `node tools/release/build-platform-preview.mjs linux` | Source archive with an executable launcher      |
| macOS Apple Silicon | `node tools/release/build-platform-preview.mjs macos` | ZIP with a signed Capri.app and bundled runtime |

Both commands accept `--output <directory>`. The default folder is `release/platform-previews`. The macOS build uses an ad hoc signature. See the [Linux install guide](../LINUX-PREVIEW.md) and [macOS guide](macos.md) for requirements.

For experimental builds, attach both archives and checksum sidecars to the private Windows preview release and the matching public pre-release. For a stable build, attach them to the public release alongside the Windows files. A draft keeps the assets invisible to the updater until publication. Published clients look for the archive for their own architecture. The Windows updater recognizes the Windows setup and source update names.
