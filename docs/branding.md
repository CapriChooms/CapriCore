# CapriCore application icon

The application mark is the red lightning with a green offset layer, shared with capri-core.com. Its editable source is `assets/default/brand/capricore.svg`. The colors are `#ff003d` and `#00f452`; the green layer is offset by four horizontal and three vertical SVG units. The app version has a transparent background and is centered in a square canvas.

Regenerate the checked-in Windows icon and PNG from the vector:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/assets/build-app-icon.ps1
```

`assets/default/icon-source.png` supplies native window and notification icons. `assets/default/app.ico` contains 16, 24, 32, 48, 64, 128 and 256 pixel frames, and supplies the tray and compiled Windows launchers. Setup, the installed app, uninstall and private Electron identity must be rebuilt from those assets. Existing desktop identity receipts include the ICO hash, so normal startup regenerates an outdated private executable.

The floating restore chip and renderer favicons use the allowlisted SVG. Character portraits, animation frames and headpat artwork are separate assets.

Remote Discord Rich Presence artwork is stored in Discord's Developer Portal, not in the application package. Upload the generated PNG there to change an existing remote image asset; local icon replacement does not modify that account setting.
