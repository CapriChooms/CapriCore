# Updates

Open **Menu → Updates**, or **Companion settings → Check for updates**.
Check for updates, download the selected release, then choose **Restart and update**.
Downloading does not stop conversation or unload models. Installation requires an idle
conversation and the usual styled confirmation. An offline API or local core does
not count as an active conversation and must not prevent maintenance. The download shows transferred bytes
and speed; cancellation retains partial bytes for the next attempt.

The experimental-updates checkbox is off by default. Stable mode excludes both GitHub
prereleases and prerelease version tags. Experimental mode includes them. Versions use
semantic ordering (v0.3.1 is newer than v0.3.0), not GitHub response order or
publication timestamps. Drafts, older versions and releases without a verified asset
are ignored. Current public releases start at **v1.0.0**. Legacy Preview tags remain
readable for upgrade compatibility. Turning the checkbox off never downgrades an installed version.

The default and fixed update source is [CapriChooms/CapriCore](https://github.com/CapriChooms/CapriCore/releases), including when old local settings or optional GitHub credentials are retained. Downloads use only its GitHub release API and approved GitHub asset
hosts. GitHub's asset size and SHA-256 digest are required. Extracted source files are
checked against SOURCE_MANIFEST.json, and config/release.json must match the release tag.
This is transport and integrity verification, not a publisher code signature. Current
Windows installers are unsigned.

Public releases work without an account, invitation or token, subject to GitHub rate limits. Startup checks and manual checks use the public release channel. A GitHub token is optional; saved tokens remain encrypted for the local OS account, and the renderer receives connection status only. Expired or unreadable optional access does not block anonymous public updates. Rate limits, cancellation and integrity failures remain errors. Capri never distributes the author's credentials or sends GitHub credentials to CDN redirects.

Installations from the former private `CapriChooms/Capri` channel need a one-time full-installer upgrade: download [Capri 1.0.2](https://github.com/CapriChooms/CapriCore/releases/download/v1.0.2/CapriSetup-1.0.2.exe), select the existing installation folder, and keep its data. Updating the new code does not retrospectively redirect an already installed old updater. The [old private-access guide](private-updates.md) is historical documentation.

## What is preserved

Direct updates work on managed installations created by the wizard. They replace
manifested source files and refresh the launcher/uninstall registration. They preserve
data/, logs/, local configuration overrides, memory, history, downloaded models,
PERSONALITY.md and the mutable voice/recognition/router configurations. Dependencies
are synchronized only when their effective locked graph or installation hooks change;
Capri/workspace version labels alone keep installed packages intact. If npm must
reinstall, the updater restores the pinned, checksum-verified Electron desktop
bundle before committing the update or finishing recovery. Models are not downloaded again
by a source-only update. Existing source files are backed up under
.runtime/updates/backups; failed updates restore source files before reporting failure.
Keep a separate backup of personal data as usual.

On initialization, v0.3.6 refreshes only the reviewed, untouched old factory
Personality, with a backup. Customized Personality text is retained. Communication
styles are separate delivery preferences; see [communication styles](communication-styles.md).

If pinned Node/Ollama/uv/Git runtimes change, Capri automatically downloads the full
installer instead. It closes the managed app before opening the installer. Select the
same managed installation folder to keep existing data. New base package versions
can now upgrade the existing installation; deliberate downgrades require a separate
folder. Optional new models/components remain choices in the full wizard.

The updated verifier checks the complete extracted inventory against the release
manifest and stable application-owned paths. It does not use the installed version's
artwork catalogue to discover files in a newer release. Unknown future source layouts
use the separately SHA-256-verified full installer after the source integrity checks;
unsafe paths, changed checksums, duplicate names and malformed manifests remain errors.

### Upgrading older versions with a manifest error

The published v0.4.6 updater rejects v0.5.1 with **Invalid source update manifest entry**:
it does not recognize the eight new `poses-v2` artwork files. The published v0.5.1
archive and its file checksums are valid. This happens during preparation, before
installation, so the failed check does not replace Capri or remove personal data.

Quit Capri, run the [public 1.0.2 installer](https://github.com/CapriChooms/CapriCore/releases/download/v1.0.2/CapriSetup-1.0.2.exe)
and select the **existing managed installation folder**. Keep that folder and its
data; an uninstall is not required. The wizard updates application files while keeping
history, memory, API settings and downloaded models. This recovery was checked against
the published installer source; it was not run against anyone's private installation.

Already installed old updaters cannot receive this validation fix through a package
they reject before copying files. They need one full-installer upgrade to the current public channel. This also applies
to published v0.5.1 if a later release adds an artwork family its old verifier does not
know; adding the fix to the newer source alone cannot unblock that older verifier.

Development/source checkouts download and open the installer for a separate managed
installation. They are never overwritten by the in-app updater. No Git checkout is
reset, committed or pulled by the application.

## Interrupted updates

### Repairing the 1.0.0 to 1.0.1 desktop regression

The published 1.0.1 source update can finish after deleting Electron's desktop
binaries: its version-only package changes unnecessarily trigger `npm ci`, while
Electron 45 no longer downloads its runtime during that command. Capri can then
report that its desktop download is incomplete. A failure during dependency
recovery may instead leave a pending-update warning.

If the old app cannot start, or “Restart and update” incorrectly says to wait for
a reply while its API is unconfigured, run **CapriSetup-1.0.2.exe** and select the
**same installation folder**. Do not uninstall or remove data/backups. The full
installer repairs the runtime and clears a completed repair's pending marker.
Already installed old code cannot apply its own offline-maintenance fix before
loading the newer installer. The 1.0.2 updater preserves unchanged dependencies
and verifies/restores the desktop before reporting completion.

One installer/update can own a folder at a time. Normal failures restore the previous
source files. A later update attempt can recover a pending transaction from its journal.
The launcher blocks startup during a pending update, avoiding half-updated source.
After a power loss, or if automatic recovery cannot finish, run the full installer
against the same folder. A successful repair clears the pending marker and retains
private data. Do not delete backups or the installation while recovery is pending.

## Publishing

Before building a release, update config/release.json to the intended unique tag and
match its base version to package.json. Upload the generated Capri-<version>-source.zip
and CapriSetup-<version>.exe to that tag, and mark experimental builds as prereleases.
Source ZIPs must include SOURCE_MANIFEST.json. Assets without a GitHub SHA-256 digest
are not offered. Publish complete release assets together; never replace an existing
tag with different code. The source/update payload excludes private data and credentials.

Qualification: updater unit tests cover semantic/channel selection, resumed downloads,
credential isolation, payload tampering, preservation, rollback and interrupted recovery.
verify-updates.mjs exercises the real Electron UI and IPC with synthetic GitHub assets
in a disposable profile; it never executes its synthetic installer. Native registration
is run twice with Unicode paths and test-only registry/shortcut destinations. A real
GitHub asset is additionally downloaded and staged during release qualification.
