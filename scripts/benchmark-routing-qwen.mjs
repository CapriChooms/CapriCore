// Compatibility command. New implementation: tools/benchmarks/benchmark-routing-qwen.mjs
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.argv[1] = fileURLToPath(
    new URL('../tools/benchmarks/benchmark-routing-qwen.mjs', import.meta.url),
  );
await import('../tools/benchmarks/benchmark-routing-qwen.mjs');
