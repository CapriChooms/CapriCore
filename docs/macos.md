# Build Capri on Apple Silicon

Build from a Git checkout on an Apple Silicon Mac. Use the official Darwin arm64 distribution of the Node version in `.node-version`, including its npm CLI and license file. The build uses Git and Apple's command-line tools.

```sh
npm ci
node node_modules/electron/install.js
npm run build:macos
```

The build prints the path to **Capri.app** under `release/`. Open it in Finder or move it to Applications. It includes the pinned Electron, Node, OpenClaw and llama.cpp runtimes. The signature is ad hoc for local use. For a public binary release, the publisher needs to qualify signing, notarization and redistribution of the included assets. [Asset terms](character-assets.md) · [Redistribution](licensing.md)

On the first local launch, Capri lists the missing models and asks before downloading them. On a Mac with 8 GiB of memory or less, a fresh installation selects Qwen 0.8B and the existing experimental 16K context preset. This downloads up to 2.18 GB for chat and memory. Larger Macs start with Qwen 2B, up to 3.84 GB. Select **Later** to explore the interface first. Use **Reconnect** to continue setup. An API connection still needs the local embedding model for memory. Chat history, models and settings live in `~/Library/Application Support/CapriCore`. To update, quit Capri and replace the application bundle.

## What to try

Open the companion, send a message, expand the chat history, then open Settings. Click Capri in the Dock to restore the companion after hiding it or entering Focus mode. Local chat uses llama.cpp with Metal on a supported Apple GPU. The app also includes the existing avatar and themes. Settings → Updates checks for Apple Silicon archives and opens the matching GitHub release. Enable experimental updates to see preview releases.

Native speech packs and wake-word setup, multi-display capture, desktop input, Spotify desktop control, system-audio capture and the virtual call devices still depend on Windows helpers. Intel Macs and distribution through Gatekeeper with a Developer ID signature need separate qualification.

## Verify a built app

```sh
npm run verify:macos -- "/path/to/Capri.app"
```

This opens the packaged app in a temporary home, sends a message through its interface to a loopback fixture, verifies window recovery on macOS activation, opens Settings and verifies the bundle signature after shutdown.

Two optional checks use pinned Qwen 0.8B and BGE-M3 layers already present in the checkout's `data/models`. Each starts with a fresh test profile and removes its temporary model copies after shutdown.

- `--local` asks “How are you?” through Capri's direct local conversation route and expects a completed reply from Qwen.
- `--agent` sends an arithmetic question through OpenClaw with the full agent prompt and checks both the answer and the provider trace. It uses a 16K context and sets the test profile's temperature to zero. On an 8 GB M1, Qwen 0.8B answered “Seven plus five is 12.” With default sampling, the same model sometimes tried a disabled calculator skill until the gateway stopped the turn. A 32K run on this Mac timed out.
