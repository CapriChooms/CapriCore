# Repository cleanup

The maintained application is the Electron companion with OpenClaw/Ollama, Chatterbox Turbo, CPU streaming ASR, the request classifier and scoped integrations. The former Open-LLM-VTuber/Live2D/Qwen3-TTS application has been retired.

## Removed together

- The old launcher, server adapters, speech services, configuration and dependency locks.
- Benchmarks and integration tests that exercised those retired services, plus superseded design/research documents. Their source snapshot is retained locally.
- Unused vendor checkouts, old Python environments, retired downloaded Qwen-TTS/Whisper/T-one/Piper models and experimental router model copies.
- Installer archives, npm/uv caches, Python bytecode and generated verification profiles, screenshots and audio.

Current entry points, status/shutdown code, setup instructions and capability descriptions no longer depend on the retired services. The router regression corpus moved from `config/experiments/` to `tests/fixtures/request-routing.json`. The maintained router training/evaluation workflow remains available.

## Preserved

- `data/openclaw/`, private memory, conversation history, desktop settings and permission grants.
- All `data/voices/`: original recordings, labels, dataset, training runs, audition material and exported adapters.
- Selected `capri-en-v1`, current Chatterbox weights, Qwen/Ollama models, ASR models and the CPU classifier.
- Active Python environments, Node, Ollama, uv, installed npm dependencies and native integration binaries.
- Optional multilingual candidates with maintained provisioning/evaluation tools.
- The complete authored sprite pack, original references, fonts, the source expression catalogue and catalogue validation support. A historical filename such as `sprites/v1/` does not make an asset obsolete.
- The pinned `vendor/chatterbox-voice` source reference used by voice provenance manifests. Those signed/hash-checked manifests are not rewritten merely to rename a directory.
- Reusable English/Russian ASR test recordings, design reference imagery, historical service reports and old private VTuber history (`data/vtuber/`).

Files outside this project were not deleted. In particular, the optional tokenizer cache previously noted in the Windows user profile is outside the scope of workspace cleanup.

## Repeatable cache cleanup

Run from the project directory with the bundled Node on PATH:

```powershell
npm run clean:cache
npm run clean:cache -- --apply
npm run clean:cache -- --package-caches
npm run clean:cache -- --apply --package-caches
```

Without `--apply`, this is a preview. `--package-caches` additionally selects `.downloads/`, `.runtime/uv-cache/` and `.runtime/npm-cache/`; reinstalling dependencies afterward may require downloading them again. Stop verification and package installation jobs before applying cleanup. The live companion and installed environments can remain running.

The command accepts no arbitrary deletion paths. It selects a fixed list of generated directories and bytecode under maintained source. It rejects linked cache roots/ancestors; links inside an otherwise valid cache are unlinked without traversing their targets. It preserves root ASR fixture recordings and never traverses `data/`, installed environments, `node_modules/` or authoring assets.

Reported bytes are logical file sizes. uv can hard-link cached wheels to installed environments, so deleting a cache does not necessarily free the same number of physical bytes. The one-time retirement report records the observed change in free space separately.

## Measured result, 26 October 2026

| Measure                                 | Result    |
| --------------------------------------- | --------- |
| Removed source/runtime/cache targets    | 93        |
| Logical file sizes removed              | 28.83 GiB |
| Observed increase in available E: space | 18.09 GiB |

The free-space delta was sampled around the operation on a running computer; unrelated background writes can affect it. Source backup: approximately 782 KiB. Active weights, trained voice and owner data were preserved. Validation passed all 152 Node tests (no skips), 15 native Electron checks, the real CPU classifier checks and local ASR model checksum checks. A short synthesis using the selected trained voice returned valid 24 kHz PCM without physical playback. The Electron verification now distinguishes a failed response from an unavailable Gateway, matching the existing production recovery policy. The owner's companion was restarted and its core and selected voice reported ready. No fresh-PC installation, physical microphone capture or subjective voice-quality comparison was performed.

## Recovery on this installation

The private folder `data/maintenance/cleanup-20261026T110216Z/` contains:

- `source-before-cleanup.zip`: verified snapshot of maintained/retired source, configuration and documentation before this operation; it also includes the previous capability/personality files.
- `backup-manifest.json`: file hashes and vendor remotes/revisions/status.
- `retirement-plan.json`, `cache-plan.json`, `removal-plan.json`, `removed.json`: planned and actually removed paths, with logical sizes. Overlapping targets are removed from the combined plan.
- `disk-before.json` and `result.json`: free-space readings and removal totals.
- `validation.json`, `voice-smoke.json`, `node-tests.txt` and `source-changes.json`: validation evidence and changed/removed source inventory.

Restore an individual source file by extracting only that file from the archive after reviewing the destination. The archive is not a full backup of models or user data. Retired downloaded dependencies can be recreated from the archived locks and recorded upstream revisions if needed; they are no longer supported launch paths.

This cleanup does not establish that a fresh Windows installation is ready for public release. A complete installer/bootstrap, redistribution review and release qualification remain roadmap work.
