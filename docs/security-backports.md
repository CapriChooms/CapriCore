# Reviewed dependency security backports

Capri applies hash-pinned upstream fixes to the installed JavaScript files during
postinstall and checks them again before starting OpenClaw. The manifest is
[dependency-security-patches.json](../config/dependency-security-patches.json),
and the implementation is
[dependency-security.mjs](../packages/runtime/src/providers/dependency-security.mjs).
Unknown package versions or source hashes stop the patch operation before any
file is overwritten. Reapplying a completed patch is a no-op.

The reviewed fixes are:

- **minimatch 10.2.6 and npm's bundled 10.2.5**: backport
  [upstream commit 77a0f5c](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
  for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
  Bound optimization expansion by the configured brace limit and skip optional
  quadratic deduplication for large sets. Preserve the v10 matcher API used by
  OpenClaw.
- **npm's bundled glob 13.0.6**: backport the missing cancellation returns
  described in [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).
  Include both raw walker modules and the actual public CommonJS/ESM bundles.
  Those bundles contain independent inlined minimatch copies, so both fixes
  apply there as well.

Eight executed files are covered. Upstream package versions, copyright notices
and license files remain unchanged. The source manifest contains the exact
edits and before/after checksums; these are modified dependencies, not newly
released upstream versions. npm bundles these dependencies and ignores normal
root overrides for them. A blanket minimatch-major override also changes APIs
used by OpenClaw, so it is not a substitute for this reviewed integration.

`npm audit` is primarily version based and can still report these original
versions and their dependency cascades. Capri does not relabel versions or hide
those results. The mitigation claim is specific to these two advisories and
the verified file hashes, not a claim that the dependency graph has no possible
vulnerabilities.

Regression fixtures cover amplification limits, ordinary matches, retained v10
APIs, inlined bundle copies, cancellation after the first filesystem read,
idempotence and rejection of unknown source. Independent bounded before/after
checks reduced the amplification fixture from 256 to 64 patterns at a limit of
64, and aborted traversal from 40 directory reads to one, with no new reads
after rejection. These fixtures contain no user files or model requests.
