# Capri 1.2.3E2 for Linux x86-64

This preview is based on the Capri 1.2.3E2 source release and the [1.1.2 community port by Frkn97](https://github.com/CapriChooms/CapriCore/issues/64). It uses Electron's X11 backend with an X11 or XWayland desktop session.

Extract the archive to a writable directory. Install Node.js 24.22.1 or a newer 24.x release, npm, and the Linux libraries required by Electron. Run these commands from the directory containing `package.json`.

```sh
npm ci
./start-capri.sh
```

The launcher accepts the Node executable from PATH or the absolute path in `CAPRI_NODE_PATH`. Re-running the launcher shows a running Capri instance. To use an API for conversation, open **Settings → API connections**. For local inference, install a compatible Linux build of `llama-server`, put it on PATH or set `CAPRI_LLAMA_PATH` to its absolute path, then use the model settings or `npm run models:pull`.

On Ubuntu 24.04, Chromium's sandbox may require an [AppArmor profile](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890) with `userns` for the exact path to this installation's Electron binary. Keep the Chromium sandbox enabled.

Linux preview updates use a new archive. The Windows installer, Windows native desktop actions and Windows speech setup tools are outside the supported scope of this preview.
