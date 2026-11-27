# Capri roadmap

[Capri 1.3.0](https://github.com/CapriChooms/CapriCore/releases/tag/v1.3.0)
is the current stable release. Download packages are available for Windows
x64, Linux x86-64, and macOS on Apple Silicon. See the
[documentation index](docs/README.md) for platform setup and the
[open issues](https://github.com/CapriChooms/CapriCore/issues) for active work.

## Shipped in 1.3.0

- **Avatar.** Layered facial animation, an Avatar Gallery for poses,
  expressions and animations, music reactions in the current pose, and
  adjustable teleport timing. [Character assets](docs/character-assets.md)
- **Voice and models.** Spoken replies have gain and pitch controls. Models
  can be loaded from the main window, and idle unloading is configurable.
  [Voice effects](docs/voice-effects.md) · [Model selection](docs/models.md)
- **Setup and updates.** Setup can add components, repair an installation,
  and optionally reset desktop preferences. Patch notes open after an
  update and are available again from Help.
  [Installation wizard](docs/installation-wizard.md) · [Updates](docs/updates.md)
- **Desktop tools.** The release includes focus recovery for Steam and a
  browser fallback for YouTube requests. The chess overlay follows detected
  digital boards. [Release notes](https://github.com/CapriChooms/CapriCore/releases/tag/v1.3.0)

## Ongoing work

| Area                         | What to verify                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Performance                  | Measure cold and warm response times, time to first audio, and RAM and VRAM usage under different model and context settings. |
| Install, update and recovery | Exercise clean installs, upgrades, interrupted downloads, repair, and data preservation on the platforms that ship.           |
| Models and speech            | Qualify specific model, language, and hardware combinations using measured compatibility and latency.                         |
| Desktop tools                | Verify multi-step tasks and recovery in real applications, including cancellation and visible confirmation of results.        |
| Animation                    | Review layer alignment, contact points, reduced motion, and transitions in the portrait, gallery and detached avatar.         |

Share setup details, reproduction steps, and measured results when opening an
issue or proposing a change. [Contributing](CONTRIBUTING.md) ·
[Diagnostic reports](docs/diagnostic-reports.md)

For the earlier milestone IDs and acceptance criteria, see the
[historical 1.0.0 roadmap](https://github.com/CapriChooms/CapriCore/blob/c50c6463637f31ee9109669be2dbee27e972e45d/ROADMAP.md).
