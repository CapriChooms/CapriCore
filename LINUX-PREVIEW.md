# Capri for Linux x86-64

The Linux build uses the shared Capri release source and the [1.1.2 community port by Frkn97](https://github.com/CapriChooms/CapriCore/issues/64). It uses Electron's X11 backend with an X11 or XWayland desktop session.

Extract the archive to a writable directory. Install Node.js 24.22.3 or a newer 24.x release, npm, and the Linux libraries required by Electron. Run these commands from the directory containing `package.json`.

```sh
npm ci
./start-capri.sh
```

The launcher accepts the Node executable from PATH or the absolute path in `CAPRI_NODE_PATH`. Re-running the launcher shows a running Capri instance. Install a compatible Linux build of `llama-server` and put it on PATH or set `CAPRI_LLAMA_PATH` to its absolute path. Run `npm run models:pull` to prepare the local model and memory model. If you use a remote chat API, prepare the local memory model with `npm run models:pull -- --embedding-only`, then configure the provider in **Settings → API connections**.

On Ubuntu 24.04, Chromium's sandbox may require an [AppArmor profile](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890) with `userns` for the exact path to this installation's Electron binary. Keep the Chromium sandbox enabled.

Capri checks for Linux x86-64 releases on startup and every 30 minutes. In **Settings → Updates**, choose **Open on GitHub** to download the archive. Public Linux archives are available without a GitHub account. Enable experimental updates in Settings to see previews as well as stable releases.

Release assets use `Capri-<version>-linux-x86_64.tar.gz`. Each release has its own version tag. Keep the package name and include a SHA-256 digest so Capri can recognize the Linux asset. Windows native desktop actions and Windows speech setup tools require the Windows build.
