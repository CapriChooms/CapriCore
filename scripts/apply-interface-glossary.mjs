// Compatibility command. New implementation: tools/localization/apply-interface-glossary.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../tools/localization/apply-interface-glossary.mjs', import.meta.url),
  );
await import('../tools/localization/apply-interface-glossary.mjs');
