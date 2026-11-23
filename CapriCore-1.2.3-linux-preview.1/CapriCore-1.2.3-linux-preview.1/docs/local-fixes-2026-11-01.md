# Reliability fixes in v0.4.1

These changes are included in v0.4.1. The previously published v0.4.0 assets remain unchanged. See the release notes for installation and validation details.

## Screen context and action requests

The supplied diagnostic archive contains a reply referring to a day-old observation while observation was off. This is evidence of stale conversational context, not proof of an unauthorized new screenshot. Existing capture leases and explicit source selection remain required.

- Every ordinary model turn states whether observation is enabled. An inactive observation supplies no scene; an expired observation no longer forwards its old description as current evidence.
- Current scene descriptions can be discussed without file/workspace access. The model is explicitly directed to the real settings permission flow rather than invented OpenClaw commands or tokens.
- One-shot image provenance remains in typed transcript metadata. Ordinary conversational text labels it historical without embedding source names or capture timestamps.
- `settings_control` accepts `value: true` with a permission **request**, as well as an omitted value. Both only propose owner approval; neither enables capture. Unsupported values and direct permission-changing `set` calls still fail.
- The same archive shows `capri-applications` failing to import because its build helper eagerly imported the entire runtime configuration from OpenClaw's temporary plugin capture. The helper now imports only path utilities. Registration still supplies the real installation root. A captured-graph regression test verifies import and read-only tool status without a configuration file in the capture and without launching any application.
- A follow-up transcript exposed another approval mismatch: `confirm` and `approve` were not recognized by the local confirmation handler and cancelled a real pending request before reaching the model. These exact words (and Russian equivalents) now confirm only an existing, unexpired, voice-enabled proposal, once. Actions requiring physical buttons still require them. Pending tool results now explicitly say to stop and wait, rather than treating approval as a failure and searching files. A screen request reports that it opens the picker only, not screen capture. Guidance explicitly rejects previously invented command lines and workspace probing for screen setup.

The report also includes an incomplete response and generic/contradictory model prose. The archive does not establish a single cause for every such reply. These corrections address the observed stale context and a reproducible tool-argument failure; they do not guarantee that a small model will never hallucinate. Existing conversation history is preserved, not silently cleared. Real Qwen inference was not retested in this batch because the local model server was stopped.

## Interface and initiative

- The Qwen progress card is hidden when idle. Active preparation/download and actionable errors remain visible.
- Settings cannot become visible before renderer readiness, reappear on tray restoration, or survive shutdown. Aborted in-flight window loading is handled without resurrecting an empty window.
- The GitHub classic-token option and outside-collaborator guidance are visible before an authentication failure. Fine-grained read-only access remains available for eligible organization members. No token is sent anywhere except the existing validated GitHub endpoints.
- Initiative presets allow up to 10 and 30 comments per rolling hour. A custom integer from 1 to 30 is available. Full budgets persist across restarts; quiet hours, user activity and the model's choice to stay silent remain effective. See [Initiative](initiative.md).

## Installation file access

Following the owner's explicit request, Capri now receives a writable scope for its entire installation by default, including code and configuration. The scope appears alongside other folders, can be made read-only or revoked, and is migrated once without re-enabling revoked access. Its file replacements and Recycle Bin actions skip the extra dialog but keep conflict detection, recovery and operation journals. External folders retain their separate grant and confirmation rules. See [File assistance](file-actions.md) for supported operations and limits. Screen sharing continues to use the actual settings tool and source picker.

## Selective uninstall

The Windows uninstaller offers independent selections for:

1. Application files, dependencies and shortcuts (selected by default).
2. Downloaded models and imported voice packs.
3. Personal settings, conversation history, workspace, memory and permissions.

Unchecked groups are retained. Screenshots, original voice recordings and external files are retained by the graphical flow. Removing personal data also removes local credentials. A second confirmation is required for model or personal-data removal. Removal is limited to the owned installation and rejects unexpected filesystem links before deleting any files. Source modifications are backed up when personal data is kept.

Automated callers can use `-Quiet`, `-DeleteModels`, `-DeleteSettings` and `-RemoveApplication:$false`. `-PlanOnly` previews targets without stopping processes or deleting anything. The legacy explicit `-DeleteData` switch retains its previous meaning of deleting the entire managed data directory; the graphical flow never sets it.

## New installation reports

- **Issue #29:** Windows npm reported a verified `ECONNRESET` with signed/unsigned exit values `-4077` / `4294963219`. The outer retry classifier now recognizes both, while still requiring a transient npm error and refusing retries for unrelated failures.
- **Issue #30:** uv reported a download interruption with localized text and Windows socket error 10054. Retry classification now recognizes socket errors 10054, 10053 and 10060 independently of the surrounding language. Hash, authentication and dependency-resolution failures remain non-retryable.
- **Issue #8:** the reporter confirmed v0.4.0 works. No additional defect or repository action was inferred from that confirmation.

The network disconnects originate in the transfer path; these logs cannot identify whether the server, ISP or local network initiated them. Capri's missed retry classifications were reproducible application defects and are corrected locally. Download retries remain bounded and reuse verified caches.

Production speech, voice and classifier dependency installation already uses **uv** through `uv-retry.py`. The words `uv pip sync` name uv's compatibility subcommand, not a separate pip installer. No package indexes, pinned versions or integrity checks were weakened.

## Validation

Regression coverage includes the reported network exit codes, current/stale screen evidence, permission-request boundaries, historical image metadata, settings lifecycle, custom initiative migration/budgets and all eight selective-uninstall combinations. The uninstall fixtures also verify retained screenshots/recordings and refusal to follow an external junction.

Native Electron checks exercise settings navigation, real IPC persistence, hidden idle model progress, token help, tray-style hide/restore and explicit reopening. Separate private-token UI checks use a fixture credential and no real authorization changes. Tests and diagnostic output stay in private runtime directories.
