# Issue #34: PyTorch download resets

Reviewed the new report on November 1, 2026. The installer session and payload are v0.4.1; the old completed installation receipt says v0.3.6 because registration has not yet been reached in the failed upgrade. That difference does not show that the new source was ignored.

The installation journal records successful source, npm dependencies, Ollama, configuration, Python, English recognition and CPU classifier stages. The voice runtime resolves 111 packages, then fails while downloading `torch==2.6.0+cu124` and `torchaudio==2.6.0+cu124` from `download-r2.pytorch.org`. All three attempts end in `connection reset` or Windows socket error 10054. No dependency conflict, missing wheel, certificate error or GPU inference failure is reported at that stage.

This confirms a network transfer failure. The issue explicitly says VPN and zapret were disabled. It does not establish which endpoint or intermediary reset the connection. No local proxy settings are reported, so attribution to a proxy would also be speculative.

The previously prepared official-host fallback is included in v0.4.2. Running the retry classifier and host selection against the actual report confirms that it selects the cu124 alternate constraints without changing locked versions. Bounded range probes of both official hosts returned HTTP 206 and matching file lengths on the development machine; they are not a test of the reporter's network. Existing native uv regression tests check version preservation and rejection of incorrect hashes.

No additional speculative network workaround is introduced. TLS verification, package pins, caches and bounded retries are retained. The release candidate also includes the independently verified Spotify, updater, Settings and screen-observation fixes. GitHub issue comments, issue state, repository files and releases remain unchanged during local preparation.
