// Compatibility command. New implementation: tools/verify/verify-awareness.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(new URL('../tools/verify/verify-awareness.mjs', import.meta.url));
await import('../tools/verify/verify-awareness.mjs');
