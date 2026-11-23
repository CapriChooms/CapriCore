// Compatibility command. New implementation: integrations/awareness/provision.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../integrations/awareness/provision.mjs', import.meta.url),
  );
await import('../integrations/awareness/provision.mjs');
