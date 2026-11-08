// Compatibility command. New implementation: tools/assets/build-sprite-catalog.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../tools/assets/build-sprite-catalog.mjs', import.meta.url),
  );
await import('../tools/assets/build-sprite-catalog.mjs');
