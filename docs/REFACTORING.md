# Refactoring and first public source release

Status: the new runtime foundation and source-distribution migration are implemented and verified. This is a source preview, not a claim that every feature algorithm was rewritten or qualified on every GPU.

## Findings

The initial pre-refactor directory audit covered 72 directories and 236 project source files (18,203 lines, including tests/tools and excluding vendor code). The two composition hotspots are desktop main (866 lines) and renderer application (765 lines). Runtime resolution, configuration, process ownership and model setup currently live together in scripts/lib.mjs. Seventy files contain portability-related settings or paths. Hardware acceleration for text and for speech are different capabilities: an AMD/Intel GPU supported by Ollama does not imply CUDA voice support.

## Target structure

```text
apps/desktop/             Electron composition, main-process controllers and renderer
  main/                   window lifecycle, protocol/resources, IPC and permissions
  renderer/               views, localizable controls, procedural visuals, audio playback
packages/runtime/src/     fresh host/runtime foundation, no Electron dependency
  config/                 defaults, local overrides, validation
  hardware/               evidence-based probes and conservative model profiles
  host/                   paths, executables, environment and process ownership
  providers/              Ollama and OpenClaw lifecycle adapters
integrations/             explicit provider adapters: ASR, TTS, routing, Spotify, OS tools
config/                   public defaults, upstream locks, schemas, persona seeds
assets/default/           redistributable procedural fallback; optional character packs separate
apps/shared/              generated language/capability catalogs
scripts/                  stable compatibility commands during migration
tools/                   development, provisioning and release automation
tests/                   unit, contract, regression and isolated UI tests
docs/                    user/developer docs, audit, ADRs and measured hardware limitations
.github/                  CI, issue/PR templates and dependency-update policy
archive/                  private verified source snapshots; never part of a release
```

Existing specialized algorithms are migrated as feature adapters with their regression tests. The new runtime foundation is written afresh. A cosmetic directory move is not considered a completed refactor. The archive is never imported by the running application. Data, trained voice weights, model downloads, credentials, voice recordings and histories remain private and are not moved into a source package.

## Ordered implementation

1. [x] Audit every directory, identify coupling and release exclusions.
2. [x] Create a timestamped source archive with per-file and whole-archive SHA-256, verify it before replacing code.
3. [x] Write the runtime foundation: portable executable discovery, validated settings and local overrides, bounded HTTP, owned-process lifecycle, standard CLI. Replace the former script library with a compatibility facade.
4. [x] Add hardware discovery and profiles: CPU-only, low-memory, shared/unknown GPU, small discrete GPU and qualified NVIDIA voice. Unknown memory is never assumed to be abundant; do not add VRAM across GPUs. Thread limits follow available CPU capacity. Keep the existing installation's model and voice choices.
5. [x] Split desktop composition into controllers with a strict local resource allowlist and validated IPC. Retain transparent geometry, subtitles, dimming, microphone permissions and live language switching.
6. [x] Provide source-clone setup, documented optional speech/model packs, a default avatar without training media, environment diagnostics, source export allowlist and release checks. Do not automatically install CUDA on AMD/Intel systems or download every model.
7. [x] Add CI, contributor/security guidance, license decision, dependency/asset notices and reproducible checks. A public source license does not automatically cover optional character/voice packs.
8. [x] Run unit/contracts plus isolated desktop smoke checks, then test the real current installation without sending synthetic messages into owner memory. Record what was actually tested, what is fixture-tested and what still needs physical hardware qualification.

## Hardware contract

Windows x64 is the first desktop target. A CPU-only text mode is the fallback, not a promise of the same latency on every PC. Under 8 GiB RAM is outside the first supported profile. GPU acceleration is delegated to the installed Ollama backend; the planner may recommend a backend but only runtime evidence establishes that it works. NVIDIA/CUDA speech remains optional until other speech backends are qualified. Recognition is optional CPU work with bounded thread use. User-selected models and limits override recommendations explicitly.

Candidate small models are the published Qwen3.5 0.8B, 2B, 4B and 9B variants. Size/context estimates must remain conservative and are not benchmarks. The profile selector reserves RAM for the OS, desktop, context cache and optional speech. Setup must expose quality/latency tradeoffs rather than claiming equal quality.

## Release gates

- No credentials, owner data, voice recordings, private weights, machine paths, runtime binaries or original archive in the public source artifact.
- Clean installation can perform diagnostics and start text UI with documented prerequisites; optional features report missing packs gracefully.
- Existing data and trained voice are preserved; rollback instructions identify the exact archive.
- Default tests do not need CUDA, a microphone, webcam, user screenshots or model downloads.
- Pin upstream engines and preserve compatibility-patch checks. Updating a lock is separate from the refactor.
- Document remaining monoliths and migration tasks honestly; do not call an unfinished migration release-ready.

## Primary references

- [GitHub repository practices](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories)
- [Electron security checklist](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)
- [Ollama hardware support](https://github.com/ollama/ollama/blob/main/docs/gpu.mdx)
- [Qwen3.5 variants](https://ollama.com/library/qwen3.5/tags)

## Directory-by-directory audit

Generated/private locations are inventoried by purpose and immediate contents; their private contents are not copied into this document. Vendor code remains an upstream dependency, not project-owned implementation.

| Directory                                                               | Role / action                                                            | Own files | Source lines |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------: | -----------: |
| `.git`                                                                  | Private/generated: exclude from Git and public source artifacts          |         — |            — |
| `.runtime`                                                              | Private/generated: exclude from Git and public source artifacts          |         — |            — |
| `apps`                                                                  | Application/UI: retain behavior, separate composition and feature logic  |         0 |            0 |
| `apps/desktop`                                                          | Application/UI: retain behavior, separate composition and feature logic  |        34 |         2847 |
| `apps/desktop/locales`                                                  | Application/UI: retain behavior, separate composition and feature logic  |        50 |            0 |
| `apps/desktop/renderer`                                                 | Application/UI: retain behavior, separate composition and feature logic  |        31 |         2839 |
| `apps/shared`                                                           | Application/UI: retain behavior, separate composition and feature logic  |         2 |            0 |
| `assets`                                                                | Separate runtime pack from references, exports and provenance            |         0 |            0 |
| `assets/capri`                                                          | Separate runtime pack from references, exports and provenance            |         0 |            0 |
| `assets/capri/references`                                               | Separate runtime pack from references, exports and provenance            |         5 |            0 |
| `assets/capri/references/batch-a1`                                      | Separate runtime pack from references, exports and provenance            |         6 |            0 |
| `assets/capri/sprites`                                                  | Separate runtime pack from references, exports and provenance            |         0 |            0 |
| `assets/capri/sprites/v1`                                               | Separate runtime pack from references, exports and provenance            |       113 |          121 |
| `assets/fonts`                                                          | Separate runtime pack from references, exports and provenance            |         0 |            0 |
| `assets/fonts/exo2`                                                     | Separate runtime pack from references, exports and provenance            |         3 |            0 |
| `config`                                                                | Public defaults/locks; keep local settings and secrets private           |        24 |            0 |
| `config/workspace`                                                      | Public defaults/locks; keep local settings and secrets private           |         6 |            0 |
| `data`                                                                  | Private/generated: exclude from Git and public source artifacts          |         — |            — |
| `docs`                                                                  | Update architecture and clean-install instructions                       |        24 |            0 |
| `integrations`                                                          | Provider boundary: explicit capabilities, platform/runtime prerequisites |         2 |           52 |
| `integrations/asr_runtime`                                              | Provider boundary: explicit capabilities, platform/runtime prerequisites |         6 |          587 |
| `integrations/awareness`                                                | Provider boundary: explicit capabilities, platform/runtime prerequisites |         0 |            0 |
| `integrations/awareness/native`                                         | Provider boundary: explicit capabilities, platform/runtime prerequisites |         1 |           57 |
| `integrations/desktop-actions`                                          | Provider boundary: explicit capabilities, platform/runtime prerequisites |         5 |          100 |
| `integrations/desktop-actions/native`                                   | Provider boundary: explicit capabilities, platform/runtime prerequisites |         1 |           96 |
| `integrations/filesystem`                                               | Provider boundary: explicit capabilities, platform/runtime prerequisites |         5 |          233 |
| `integrations/openclaw-compat`                                          | Provider boundary: explicit capabilities, platform/runtime prerequisites |         2 |            0 |
| `integrations/perception`                                               | Provider boundary: explicit capabilities, platform/runtime prerequisites |         4 |           71 |
| `integrations/request_router`                                           | Provider boundary: explicit capabilities, platform/runtime prerequisites |         3 |          147 |
| `integrations/spotify`                                                  | Provider boundary: explicit capabilities, platform/runtime prerequisites |         5 |          218 |
| `integrations/spotify/native`                                           | Provider boundary: explicit capabilities, platform/runtime prerequisites |         4 |          713 |
| `integrations/voice_runtime`                                            | Provider boundary: explicit capabilities, platform/runtime prerequisites |         7 |          703 |
| `integrations/voice_training`                                           | Provider boundary: explicit capabilities, platform/runtime prerequisites |         7 |         1402 |
| `logs`                                                                  | Private/generated: exclude from Git and public source artifacts          |         — |            — |
| `node_modules`                                                          | Private/generated: exclude from Git and public source artifacts          |         — |            — |
| `NVIDIA Corporation`                                                    | Private/generated: exclude from Git and public source artifacts          |         — |            — |
| `scripts`                                                               | Separate runtime APIs from developer/provisioning commands               |        81 |         4927 |
| `tests`                                                                 | Retain regression coverage; isolate devices/models from default tests    |        43 |         3081 |
| `tests/fixtures`                                                        | Retain regression coverage; isolate devices/models from default tests    |         2 |            9 |
| `vendor`                                                                | Pinned external source; exclude from source distribution                 |         0 |            0 |
| `vendor/chatterbox-voice`                                               | Pinned external source; exclude from source distribution                 |        15 |          743 |
| `vendor/chatterbox-voice/.github`                                       | Pinned external source; exclude from source distribution                 |         0 |            0 |
| `vendor/chatterbox-voice/.github/workflows`                             | Pinned external source; exclude from source distribution                 |         1 |            0 |
| `vendor/chatterbox-voice/build`                                         | Pinned external source; exclude from source distribution                 |         0 |            0 |
| `vendor/chatterbox-voice/build/bdist.win-amd64`                         | Pinned external source; exclude from source distribution                 |         0 |            0 |
| `vendor/chatterbox-voice/build/lib`                                     | Pinned external source; exclude from source distribution                 |         0 |            0 |
| `vendor/chatterbox-voice/build/lib/chatterbox`                          | Pinned external source; exclude from source distribution                 |         5 |         1062 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models`                   | Pinned external source; exclude from source distribution                 |         2 |            4 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/s3gen`             | Pinned external source; exclude from source distribution                 |        10 |         2110 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/s3gen/matcha`      | Pinned external source; exclude from source distribution                 |         4 |         1301 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/s3gen/transformer` | Pinned external source; exclude from source distribution                 |         9 |         1905 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/s3gen/utils`       | Pinned external source; exclude from source distribution                 |         4 |          386 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/s3tokenizer`       | Pinned external source; exclude from source distribution                 |         2 |          198 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/t3`                | Pinned external source; exclude from source distribution                 |         3 |          578 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/t3/inference`      | Pinned external source; exclude from source distribution                 |         1 |          111 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/t3/modules`        | Pinned external source; exclude from source distribution                 |         4 |          382 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/tokenizers`        | Pinned external source; exclude from source distribution                 |         2 |          314 |
| `vendor/chatterbox-voice/build/lib/chatterbox/models/voice_encoder`     | Pinned external source; exclude from source distribution                 |         4 |          371 |
| `vendor/chatterbox-voice/src`                                           | Pinned external source; exclude from source distribution                 |         0 |            0 |
| `vendor/chatterbox-voice/src/chatterbox`                                | Pinned external source; exclude from source distribution                 |         5 |         1062 |
| `vendor/chatterbox-voice/src/chatterbox/models`                         | Pinned external source; exclude from source distribution                 |         2 |            4 |
| `vendor/chatterbox-voice/src/chatterbox/models/s3gen`                   | Pinned external source; exclude from source distribution                 |        10 |         2110 |
| `vendor/chatterbox-voice/src/chatterbox/models/s3gen/matcha`            | Pinned external source; exclude from source distribution                 |         4 |         1301 |
| `vendor/chatterbox-voice/src/chatterbox/models/s3gen/transformer`       | Pinned external source; exclude from source distribution                 |         9 |         1905 |
| `vendor/chatterbox-voice/src/chatterbox/models/s3gen/utils`             | Pinned external source; exclude from source distribution                 |         4 |          386 |
| `vendor/chatterbox-voice/src/chatterbox/models/s3tokenizer`             | Pinned external source; exclude from source distribution                 |         2 |          198 |
| `vendor/chatterbox-voice/src/chatterbox/models/t3`                      | Pinned external source; exclude from source distribution                 |         3 |          578 |
| `vendor/chatterbox-voice/src/chatterbox/models/t3/inference`            | Pinned external source; exclude from source distribution                 |         1 |          111 |
| `vendor/chatterbox-voice/src/chatterbox/models/t3/modules`              | Pinned external source; exclude from source distribution                 |         4 |          382 |
| `vendor/chatterbox-voice/src/chatterbox/models/tokenizers`              | Pinned external source; exclude from source distribution                 |         2 |          314 |
| `vendor/chatterbox-voice/src/chatterbox/models/voice_encoder`           | Pinned external source; exclude from source distribution                 |         4 |          371 |
| `vendor/chatterbox-voice/src/chatterbox_tts.egg-info`                   | Pinned external source; exclude from source distribution                 |         5 |            0 |

## Current implementation and remaining work

The new runtime is active. 77 implementations moved into runtime/provider/development boundaries; old command paths have thin compatibility entries. JavaScript, Python and PowerShell developer tools now have separate homes, and automated production dependency boundaries pass. Security/resource/window/pointer, screen/access IPC and subtitle controllers are separate. JSON persistence uses one atomic implementation. A fresh source copy installed 357 npm packages and started OpenClaw and the generic desktop without private art, speech packs or owner data.

Follow-up architecture work: further decomposition of application event/orchestration modules can proceed independently of the new runtime. Release qualification still needs a complete transitive-license compatibility review; the npm SBOM is included as an inventory. Hardware policy branches are fixture-tested; AMD/Intel/low-RAM physical qualification remains separate work. The experimental [Windows installer](installation-wizard.md) now provides the first guided setup; signing and clean-machine qualification remain release gates. This migration does not claim a full rewrite of all feature algorithms or all-hardware release qualification.

Source exports are reviewable artifacts. The private source snapshot remains in archive/ and is never imported or distributed.
