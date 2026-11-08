# Distributing Capri's voice

End users do not need to record or train a voice. A voice-enabled release setup embeds the trained Capri adapter and reference profile. The wizard selects **Capri / Conversation language** on NVIDIA PCs and installs the corresponding speech backend automatically. English uses Turbo; supported non-English voices use the shared multilingual model without first downloading English model weights. Text mode and advanced import remain available. Even text-mode installations retain the small bundled profile for later one-click voice installation. Dependencies and full speech models are downloaded with consent. See the [user-facing voice guide](voice-installation.md).

The pack is deliberately separate from the source repository. It contains adapter.safetensors, adapter.json, voice-profile.json and the referenced WAV files, plus an inventory and provenance notice. It excludes raw recordings, transcripts, training runs, review selections, local paths and conversation history. The adapter configuration is reduced to the fields the runtime consumes; source training files are preserved.

Build on Windows from a prepared English voice export:

```powershell
npm run release:installer -- --voice-pack="C:\VoiceExports\capri-en-v1"
```

The new ignored release/installer-\* directory contains CapriSetup-<version>.exe, source.zip, the standalone <voice-id>.zip, BUILD_MANIFEST.json and the voice-pack staging folder. Existing builds are never overwritten. Both embedded payloads have SHA-256 values compiled into the launcher; source and voice checksums are separate. --extract-only unpacks the source and a .bundled-voice folder without installing anything. Starting Install Capri.cmd in that extraction also detects the included pack. The regular source export continues to exclude binary models and recordings.

Publish source code to the repository and attach the setup, source ZIP, voice ZIP and checksums to its numbered GitHub release. Experimental builds can use GitHub's prerelease flag while retaining a numbered version. GitHub Releases are intended for downloadable binary artifacts. The included English voice pack works without a public repository; setup downloads the pinned upstream base model. Multilingual TTS is a separate optional model installation, available through Languages.

For testing, use a private repository and invite testers. GitHub has no unlisted repository visibility: knowing a private link alone does not grant access, including to its release assets. Do not embed account tokens in installers. A downloaded setup retains its included voice even if the repository is private.

The code's GPL-3.0-only license and upstream MIT license do not grant rights to the anime recordings used for this particular voice. The release pack records that provenance and does not assert additional clearance. This does not change the source-code license.

Verification: voice-pack-release.test.mjs checks runtime-only export, unchanged source data, hashes, compatibility and re-import. Native wizard verification checks automatic selection of an included pack, explicit custom import and clearing stale selections. Compiled launcher extraction is checked against both artifact manifests. A fresh multi-GB voice dependency download remains a separate clean-machine release qualification.

Sources: [GitHub visibility](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories), [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [Chatterbox](https://github.com/resemble-ai/chatterbox), [Turbo base model](https://huggingface.co/ResembleAI/chatterbox-turbo).
