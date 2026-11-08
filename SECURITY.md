# Security

Permission bypass, malformed IPC, path traversal, unwanted capture, credential leakage and unsafe process termination are security issues.

The default installation scope intentionally gives Capri read/write access to its own source, configuration and data. It can be revoked in File access. This permits self-modification and is not a security boundary against altered application code or configuration. Additional folder grants and screen/microphone permissions remain separate capabilities in the shipped implementation.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/CapriChooms/CapriCore/security/advisories/new). Do not post exploit details or credentials in public issues. Provide a minimal fixture-based reproduction; never attach private data, recordings, models or unredacted logs.

The source exporter is a defense layer, not a guarantee that arbitrary future code contains no personal data. Review the artifact before publishing. Rotate any exposed credential. CI has read-only repository permissions; untrusted pull requests must not publish releases or run privileged desktop actions.

The [reviewed dependency backports](docs/security-backports.md) document two upstream denial-of-service fixes applied to actual runtime files. Original versions and version-based audit warnings remain visible; the checksums and regression fixtures establish the narrow mitigation claim.

## Personal data at rest

Full encryption of conversation history, attachments and ordinary memory is deferred. This beta uses the existing local file storage and does not require EFS, WinFsp or Dokany. It must not be described as fully encrypted. Existing API credential protection and the separately password-protected private memory feature are retained.

A read-only compatibility decoder can recover dialogue and image previews from the withdrawn local encryption experiment using the original Windows account and saved key. It never creates a key or encrypts new files. Unreadable history is preserved instead of being overwritten by new messages.

## Logs and diagnostic exports

Managed services do not write arbitrary child stdout/stderr to disk. Capri keeps allowlisted service lifecycle, stage, error-class and error-code records. OpenClaw raw logging, prompt-cache traces and telemetry exports are disabled, including during existing-configuration migration. The owned legacy runtime log cleanup keeps bounded technical summaries and discards free-form text. Personal documents, conversation history and memory are not log sources.

Diagnostic exports omit legacy free-form log lines and unknown textual session fields. Error classes and stages, resource counters and benign hardware/service information remain available. The problem description and reproduction steps are the user's explicit report text; review these before sharing. Exporting a report never uploads it automatically. No guarantee is made for logs generated independently by third-party software, external tools or an older process that has not yet restarted into the updated privacy policy.
