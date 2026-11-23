# Build Capri on Apple Silicon

Build from a Git checkout on an Apple Silicon Mac. Use the official Darwin arm64 distribution of the Node version in `.node-version`, including its npm CLI and license file. The build uses Git and Apple's command-line tools.

```sh
npm ci
node node_modules/electron/install.js
npm run build:macos
```

The build prints the path to **Capri.app** under `release/`. Open it in Finder or move it to Applications. It includes the pinned Electron, Node, OpenClaw and llama.cpp runtimes. The signature is ad hoc for local use. For a public binary release, the publisher needs to qualify signing, notarization and redistribution of the included assets. [Asset terms](character-assets.md) · [Redistribution](licensing.md)

On the first local launch, Capri lists the missing models and asks before downloading them. The default Qwen 2B configuration uses up to 3.84 GB for chat and memory. Select **Later** to explore the interface first. Use **Reconnect** to continue setup. An API connection still needs the local embedding model for memory. Chat history, models and settings live in `~/Library/Application Support/CapriCore`. To update, quit Capri and replace the application bundle.

## What to try

Open the companion, send a message, expand the chat history, then open Settings. Local chat uses llama.cpp with Metal on a supported Apple GPU. The app also includes the existing avatar, themes and releases panel. A Windows release in that panel links to its notes.

Native speech packs and wake-word setup, multi-display capture, desktop input, Spotify desktop control, system-audio capture and the virtual call devices still depend on Windows helpers. Intel Macs and distribution through Gatekeeper with a Developer ID signature need separate qualification.

## Verify a built app

```sh
npm run verify:macos -- "/path/to/Capri.app"
```

This opens the packaged app in a temporary home, sends a message through its interface to a loopback fixture, opens Settings and verifies the bundle signature after shutdown.

Two optional checks use pinned Qwen 0.8B and BGE-M3 layers already present in the checkout's `data/models`. Each starts with a fresh test profile and removes its temporary model copies after shutdown.

- `--local` asks “How are you?” through Capri's direct local conversation route and expects a completed reply from Qwen.
- `--agent` sends an arithmetic question through the OpenClaw gateway and checks the answer. This route timed out in the initial M1 test.
