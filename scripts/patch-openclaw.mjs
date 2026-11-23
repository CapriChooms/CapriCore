// Compatibility command.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../packages/runtime/bin/patch-openclaw.mjs', import.meta.url),
  );
await import('../packages/runtime/bin/patch-openclaw.mjs');
