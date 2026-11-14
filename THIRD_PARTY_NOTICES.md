# Third-party notices

GPL-3.0-only applies to project-owned code. LICENSE contains the full license text and remains unmodified. The [GNU GPLv3](https://www.gnu.org/licenses/gpl.en.html) defines the redistribution terms; the [release license checklist](docs/licensing.md) covers matching source and notices. Dependencies retain their own terms.

| Component                              | Distribution boundary                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenClaw                               | Pinned npm package and compatibility manifest; upstream notices                                                                                 |
| llama.cpp                              | Official Windows Vulkan runtime, MIT; retains upstream dependency notices                                                                       |
| Electron                               | npm distribution and its bundled notices                                                                                                        |
| mathjs                                 | Pinned Apache-2.0 npm package for numerical calculation; retain its LICENSE and NOTICE                                                          |
| PDF.js (`pdfjs-dist`)                  | Apache-2.0 npm package for local PDF text extraction; retain its upstream LICENSE                                                               |
| Ministral 3 and Gemma 4                | Optional model weights and their upstream license/model-card terms                                                                              |
| AMD ROCm                               | Optional SDK/PyTorch voice packages; individual AMD/upstream licenses                                                                           |
| Discord                                | Optional local RPC integration; no Discord client or account credential is redistributed                                                        |
| VB-CABLE                               | Optional unmodified VB-Audio driver, downloaded from its official host only after the user requests installation; separate donationware license |
| Qwen models                            | Optional weights and their model-card/license terms                                                                                             |
| Qwen3-TTS                              | Optional Apache-2.0 `qwen-tts` runtime and pinned Qwen3-TTS-12Hz-0.6B-Base weights; retain upstream notices                                     |
| Chatterbox                             | Pinned optional vendor source; retain vendor LICENSE                                                                                            |
| Sherpa-ONNX, Parakeet, Whisper, Silero | Optional ASR/VAD manifests and upstream terms                                                                                                   |
| PyTorch and Python packages            | Locked optional environments and individual licenses                                                                                            |
| Exo 2                                  | SIL Open Font License, assets/fonts/exo2/OFL.txt                                                                                                |

The default procedural avatar is project-owned. The reviewed Capri character sprites and the supplied application icon are included under the separate [character asset notice](docs/character-assets.md). Original generation references, recordings and trained voice weights are excluded from source export. The code license grants no rights to those materials. Verify provenance, permission and model terms before distributing an optional pack. A machine-generated [npm dependency inventory](docs/audit/npm-sbom.cdx.json) records the pinned JavaScript dependency graph. An inventory is not a complete transitive-license compatibility review; that remains a release qualification task. Optional Python/vendor environments are outside that npm inventory.

Community buttons use the [Discord symbol](https://discord.com/branding) and the [GitHub Octicons mark](https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg). Their marks belong to their respective owners. The Octicons license is bundled in `assets/default/brand/github-license.txt`.

The optional installer downloads pinned Node.js, llama.cpp and uv distributions from their official release hosts, and portable Git for the optional voice environment. Their licenses/notices remain in their runtime distributions. Windows PowerShell, .NET Framework and Windows Forms are OS prerequisites, not redistributed dependencies. Artifact URLs, versions, sizes and SHA-256 values are in config/installer.json. The setup executable embeds Capri source and its GPL license; a publisher signature is not yet supplied.

The Electron runtime may also be downloaded from npmmirror, a third-party mirror
listed in Electron's installation documentation, when the primary host is
unavailable. The exact upstream version, byte size and pinned SHA-256 remain
mandatory; the mirror does not supply replacement checksums or change Electron's
license terms. See the [download fallback notes](docs/bugs/1.0.0-electron-download-mirror.md).

The [llama.cpp MIT license](https://github.com/ggml-org/llama.cpp/blob/b12317/LICENSE)
applies to its inference runtime. Model weights are separate downloads listed in
`config/llama-models.json`. The bundled
[Ministral chat template](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512/blob/b35d4dfe56c142746f54dbd64f579faab2744308/chat_template.jinja)
is from Mistral AI's Apache-2.0 model repository.

Reviewed security backports modify minimatch and glob code shipped with OpenClaw/npm while retaining their upstream license and copyright notices. The exact changes and checksums are included in [the security backport manifest](config/dependency-security-patches.json), with [scope and verification notes](docs/security-backports.md). Original version numbers remain truthful; version-based audit warnings are not suppressed.

The optional Qwen speech adapter installs its own CPU runtime from the hash-locked `config/requirements-qwen-tts.lock`. The [upstream code license](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE) and the [pinned model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base/blob/5d83992436eae1d760afd27aff78a71d676296fc/README.md) specify Apache-2.0. `config/qwen-tts-upstream.json` records the exact model revision and artifact hashes. No Qwen weights, user reference recordings or trained candidates are embedded in the Capri source release. Hugging Face discovery also shows other repositories; their individual model-card and license terms apply, and availability on the Hub does not grant rights to recordings or voice identity.

A publisher can explicitly build a setup executable with a separate trained voice artifact using --voice-pack. That artifact contains only the runtime adapter, configuration and reference audio, with a VOICE_PACK_MANIFEST.json and VOICE-PACK-NOTICE.md. It remains outside the source export and outside the code license. Base Chatterbox weights are obtained separately from the pinned upstream repository. Packaging records provenance; it does not assert permission for third-party source recordings or performances.

## Optional music detector

Music listening downloads the pinned official Qualcomm YAMNet ONNX float export
only when requested. `config/music-detector.json` records its immutable artifact
checksums. The model is derived from Google's YAMNet and the Torch AudioSet
implementation; it retains these upstream terms:

- Google TensorFlow Models / YAMNet: Apache-2.0, copyright Google LLC;
  [source](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet)
  and [bundled license](docs/licenses/music-detector/tensorflow-Apache-2.0.txt).
- Torch AudioSet YAMNet implementation: MIT, copyright (c) 2021 Haochen;
  [pinned source](https://github.com/w-hc/torch_audioset/tree/e8852c5)
  and [bundled license](docs/licenses/music-detector/torch-audioset-MIT.txt).
- Qualcomm AI Hub Models export: BSD-3-Clause, copyright 2025 Qualcomm
  Technologies, Inc. and/or its subsidiaries;
  [v0.61.0 source](https://github.com/qualcomm/ai-hub-models/tree/v0.61.0/src/qai_hub_models/models/yamnet)
  and [bundled license](docs/licenses/music-detector/qualcomm-BSD-3-Clause.txt).

The optional benchmark uses public MUSAN, Google FLEURS and explicitly licensed
Wikimedia Commons recordings. Their license and attribution metadata is retained
beside the downloaded samples under `.runtime/music-detection-research/` only.
MUSAN recordings retain their individual source terms; Commons vocal examples
use CC-BY-SA-3.0 and CC-BY-SA-4.0. Benchmark audio is never included in Capri
source exports or release packages. See [music-listening verification](docs/music-listening.md).

The default screenshot cue (`assets/default/screenshot-capture.mp3`) in 1.0.0 is original procedurally synthesized audio supplied under GPL-3.0-only. It contains no third-party recording samples. Its source is `tools/assets/build-screenshot-cue.py`; ffmpeg is used only for optional regeneration. Older releases used a different supplied cue.
