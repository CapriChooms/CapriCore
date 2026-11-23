# PyTorch voice dependency delivery fallback (local, unreleased)

The report shows `uv` failing to connect to Windows CPython 3.11 wheels for
`torchaudio==2.6.0+cu124` and `torch==2.6.0+cu124` on
`download-r2.pytorch.org`, with Windows socket error 10054. The package resolver
completed; the failure was transport, not a missing package or CUDA computation.
The existing three retries reduced concurrency but kept returning to the same
delivery host.

## Evidence and limits

On 2026-11-01 the official cu124 and cu128 package indexes linked these wheels
through `download-r2.pytorch.org`. Direct requests to the equivalent wheel paths
on `download.pytorch.org` returned data without redirecting to R2. Response
headers identified Cloudflare on the former and Amazon S3/CloudFront on the latter.
All four alternate wheel paths returned HTTP 206 to bounded range probes.
The complete 4,163,304-byte cu124 TorchAudio wheel was downloaded separately and
matched the SHA-256 in PyTorch's index. Multi-gigabyte Torch wheels were not
downloaded for this check.

These observations confirm that an alternate official delivery path exists.
They do not establish whether this particular user's provider, local filtering,
the CDN or another network intermediary reset the connection. A successful local
probe does not guarantee reachability from that user's Russian ISP.

## Changes

- Voice setup passes the selected hardware profile to the existing uv retry
  wrapper. ASR/classifier setup behavior is unchanged.
- After a recognized transient R2 wheel failure, the next attempt appends the
  selected profile's reviewed direct-URL constraints. Error text only selects
  the fallback; no download address is constructed from it.
- Constraints pin the same Windows/Python/CUDA wheel versions and SHA-256 values
  obtained from PyTorch's official indexes. Original lockfiles and Blackwell
  overrides remain unchanged. Existing cache contents are retained.
- The alternate host is selected once within the existing three-attempt budget.
  Certificate, authentication, filesystem, resolver and checksum failures remain
  terminal. Hash checking stays enabled on fallback attempts.
- Persistent failure includes guidance about actual HTTPS downloads and a
  network/VPN/proxy that covers the installer, rather than relying on ping.

## Verification

Focused tests cover matching and mismatched hardware profiles, unrelated hosts,
permanent errors, bounded retries and unchanged pins. Native `uv` tests use tiny
local fixture wheels in an isolated environment to verify direct constraints for
both `pip sync` and `pip install --exact --overrides`. They also verify that an
incorrect SHA-256 is rejected. The PowerShell wrapper test covers the additional
profile argument. No runtime dependency/model upgrades, GitHub publication or
changes to user installations were performed.

Official index references:
[cu124 Torch](https://download.pytorch.org/whl/cu124/torch/),
[cu124 TorchAudio](https://download.pytorch.org/whl/cu124/torchaudio/),
[cu128 Torch](https://download.pytorch.org/whl/cu128/torch/),
[cu128 TorchAudio](https://download.pytorch.org/whl/cu128/torchaudio/).
