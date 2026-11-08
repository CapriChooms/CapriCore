// Compatibility command. New implementation: tools/configuration/configure-applications.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../tools/configuration/configure-applications.mjs', import.meta.url),
  );
await import('../tools/configuration/configure-applications.mjs');
