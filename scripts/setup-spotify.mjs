// Compatibility command. New implementation: integrations/spotify/provision.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../integrations/spotify/provision.mjs', import.meta.url),
  );
await import('../integrations/spotify/provision.mjs');
