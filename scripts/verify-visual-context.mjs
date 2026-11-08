// Compatibility command. New implementation: tools/verify/verify-visual-context.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../tools/verify/verify-visual-context.mjs', import.meta.url),
  );
await import('../tools/verify/verify-visual-context.mjs');
