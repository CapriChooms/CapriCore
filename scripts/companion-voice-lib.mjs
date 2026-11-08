// Compatibility command. New implementation: integrations/voice_runtime/host.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../integrations/voice_runtime/host.mjs', import.meta.url),
  );
await import('../integrations/voice_runtime/host.mjs');
