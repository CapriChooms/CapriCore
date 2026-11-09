# Developer diagnostics

Open **Settings → Developer → For developers**. The page reads existing local
technical logs. It does not start a model or make an external request.

- **Response timing** lists the latest 40 correlated requests. Choose a request
  to inspect preparation, routing, intent classification, context, gateway wait,
  streaming, the first interface paint and total duration.
- **Model calls** separates each provider call, including auxiliary calls. Local
  Ollama reports weight-loading time, prompt evaluation, generation time and
  token counts. Tokens per second uses output tokens divided by Ollama's reported
  generation duration. It is not end-to-end response speed.
- **All timing events** lists the individual technical events and their offsets.
- **Logs** lists runtime, updater and recent installer journals. The viewer reads
  at most the last 64 KiB of a selected file and removes private prose/unknown
  fields. **Open logs folder** opens the installation's runtime logs in Explorer.
- **Live refresh** updates every three seconds while this category and Settings
  are visible. Switching categories, hiding Settings or hiding the document
  suspends refresh. Uncheck it to inspect a stable snapshot.

Missing measurements remain dashes. Some stages overlap and should not be added
together. Durations between two events from one process use that process's
monotonic elapsed clock. Cross-process offsets use UTC system timestamps.
Provider calls without an explicit matching trace ID remain separate; the UI
never guesses a link by proximity in time. External APIs may not expose internal
load/prefill/decode counters. A request interrupted before its terminal event is
marked incomplete, rather than assigned an invented duration.

The backend uses an explicit technical record schema, a capped catalog and
bounded tail reads. Renderer requests accept catalog IDs, not filesystem paths.
Linked directories, symlinks and hardlinked files are excluded. Logs are read on
demand with a one-second cache and a shared in-flight read. Nothing is uploaded,
and no new dialogue, memory, credentials, screenshots or raw model contents are
logged by this feature. Existing rotated response logs are read without changing
their retention policy.

Verification: `node --test tests/developer-diagnostics.test.mjs
tests/response-timing.test.mjs`; `node tools/verify/verify-developer-settings.mjs`.
The visual check uses the actual Settings window and IPC with isolated technical
fixtures and no models or owner data.
