# Local audit of open GitHub reports — 2026-10-31

Checked the nine open CapriChooms/Capri issues, including every comment and
attached diagnostic ZIP. Work is local on E:. No push, release, issue comment,
issue closure, subscriber-permission change or change to the D: installation
was made. Diagnostic archives stay outside source exports.

| Issue                                                 | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#8](https://github.com/CapriChooms/Capri/issues/8)   | The original DNS/download failure was reported resolved. The latest voice archive proves Windows commit-limit error 1455 in the old Turbo loader. The existing local 0.3.7 candidate already avoids a duplicate initialized FP32 model, schedules preparation sequentially under RAM pressure and surfaces a specific memory/pagefile diagnostic. This reduces peak demand; it does not guarantee that every 16 GB/pagefile configuration has sufficient commit capacity. Reporter retest remains necessary. |
| [#18](https://github.com/CapriChooms/Capri/issues/18) | An old 0.3.4 archive shows an interrupted model stream followed by connection failure. The later bounded reconnect/restart handling is already present. That archive has no Ollama service log establishing why the original service/connection stopped. No speculative network repair is claimed.                                                                                                                                                                                                           |
| [#19](https://github.com/CapriChooms/Capri/issues/19) | Voice was off and the voice runtime, profile and base weights were absent. The installer at the time required NVIDIA CUDA for the English voice.                                                                                                                                                                                                                                                                                                                                                             |
| [#21](https://github.com/CapriChooms/Capri/issues/21) | The existing local candidate shares one observer startup across startup/show/model callbacks, retains observer failures and allows a bounded 15-second native cold start. Its concurrency regression passes. The old archive does not establish the reporter's actual native observer error; a physical retest is still needed.                                                                                                                                                                              |
| [#23](https://github.com/CapriChooms/Capri/issues/23) | The complete traceback ends at the Turbo CUDA-graph token-generation limit, producing HTTP 503 and cancelling queued speech. Added a typed limit and one intact-sentence retry through native FP32 inference with a different deterministic seed and the same token bound. Graph replay is restored afterwards. Cancellation and unrelated errors are not retried. Exhausted failures now expose bounded codes in voice health and desktop diagnostics without the sentence or arbitrary exception text.     |
| [#24](https://github.com/CapriChooms/Capri/issues/24) | A streamed numba wheel fails extraction because its download reports `network timeout`. The exact chain was not recognized by the retry classifier. Reproduced before the fix and corrected; actual integrity, permission, disk, certificate and build failures remain terminal.                                                                                                                                                                                                                             |
| [#25](https://github.com/CapriChooms/Capri/issues/25) | All three existing wrapper attempts correctly retry connection timeouts to the official PyTorch host. Added child-process defaults of 30 s to connect and 120 s for idle reads, initially eight concurrent downloads, then two/one after package-network failures. Explicit user timeout/concurrency settings, locked packages, official indexes and verified caches are retained. Persistent endpoint/network unavailability can still fail.                                                                |
| [#26](https://github.com/CapriChooms/Capri/issues/26) | Six Hugging Face connection resets before any model bytes arrive. Bounded retries and retained partial downloads already work; there are no bytes to resume in this archive. Added requested-host, transfer-stage and numeric OS-code diagnostics without signed URLs/query parameters. The archive does not distinguish an upstream failure from the reporter's network path; TLS/hash verification is unchanged.                                                                                           |
| [#27](https://github.com/CapriChooms/Capri/issues/27) | GitHub confirms Read access as an **outside collaborator**. Fine-grained tokens do not support that access mode. Added an explicit fixed classic-token settings link, automatic expansion of the existing membership/permission explanation after failure, and safe HTTP status/request-ID diagnostics. Credentials remain encrypted and failed replacement preserves working access. Organization membership with a scoped read-only token remains preferable; permissions are not changed automatically.   |

## Verification

- Exact reported wheel-timeout regression fails before the patch and passes after it.
  Retry tests also cover permanent-error precedence, cancellation, cache reuse,
  explicit environment settings and child-only download defaults.
- Voice tests cover intact-sentence retry, unchanged limits, native/graph restoration,
  cancellation, bounded attempts, decoder OOM handling and content-free error metadata.
- A separate real-weight GPU probe injects one token-limit failure, then synthesizes
  the complete public fixture through native FP32 inference. A second sentence uses
  graph replay again. Both produce finite, non-silent 24 kHz PCM with the existing
  adapter checksum. No voice server, physical playback or reporter conversation is
  involved. This controlled test validates recovery from the injected error.
- GitHub tests cover the two fixed settings URLs, failed-access metadata, encrypted
  storage and omission of token/response bodies. Native Electron verification uses
  fixture credentials and checks that denial exposes the classic-token path.
- Model-download tests retain byte-range resume and checksum validation and ensure
  signed URLs/private exception text do not appear in the new network detail.

Primary references: [uv timeout settings](https://docs.astral.sh/uv/reference/environment/),
[GitHub token limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

Reports with unresolved network or hardware conditions should remain open until
the reporter confirms recovery. A successful local fixture does not establish a
fix on every subscriber machine.
