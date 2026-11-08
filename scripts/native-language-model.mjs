// Compatibility command. New implementation: packages/runtime/src/providers/native-model.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../packages/runtime/src/providers/native-model.mjs', import.meta.url),
  );
await import('../packages/runtime/src/providers/native-model.mjs');
