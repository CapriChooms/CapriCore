// Compatibility command.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(new URL('../tools/maintenance/clean-cache.mjs', import.meta.url));
await import('../tools/maintenance/clean-cache.mjs');
