# Desktop roaming

Open **Settings → Avatar interaction → Desktop roaming**.

- **Let Capri move around on her own** enables automatic lightning teleports. It is off by default, including when upgrading existing settings.
- **Time between moves** selects a minimum interval from 30 seconds to 30 minutes. The default is two minutes. Actual pauses vary by up to 20% so movement feels less mechanical.
- **Roaming monitors** controls where Capri can go. **Current or observed monitor** keeps the existing behavior. **Any monitor** picks another connected monitor when one is available. **Monitor with the pointer** uses the monitor where your pointer is when the next move is due.

Roaming uses desktop geometry without capturing the screen or calling a model.
With screen observation enabled, Capri can also perch on windows covered by the
existing screen access grant.

Roaming pauses while Settings is open, while you type, speak, drag or interact
with Capri, during replies and voice playback, during computer control, while
Capri sleeps, in Focus mode, and when her host window is minimized. A short quiet
period follows interaction; missed moves do not accumulate. Manual teleports and
returning home restart the waiting period. Turning roaming off preserves manual
dragging and teleport controls, including following a window she is perched on.

Scheduling shares the existing desktop supervision tick and adds no timer or
background model loading. Verification covers upgrade defaults, saved settings,
interval changes, pauses, manual cooldowns and repeated automatic teleports:

```text
node --test tests/avatar-roaming.test.mjs tests/desktop-avatar-commands.test.mjs
node tools/verify/verify-avatar-roaming.mjs --virtual-monitors
```
