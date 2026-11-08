/** Compatibility command; the new runtime owns process startup. */
import { startDesktop } from '../packages/runtime/src/desktop-launcher.mjs';
try {
  const marker = await startDesktop();
  console.log(
    marker.alreadyRunning
      ? 'Capri is already running. Showing the companion.'
      : `Capri companion started (process ${marker.pid}). The local core starts in the background.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
