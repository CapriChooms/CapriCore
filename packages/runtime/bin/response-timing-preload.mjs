// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { root } from '../src/host/paths.mjs';
import { ResponseTimingLog, configureResponseTimings } from '../src/response-timing.mjs';
import { providerTimingSpan, installGatewayTimingProbe } from '../src/response-probe.mjs';
const port = Number(process.env.CAPRI_OLLAMA_PORT);
if (Number.isInteger(port) && port > 0 && port < 65536) {
  configureResponseTimings(new ResponseTimingLog(path.join(root, 'logs/response-provider.jsonl')));
  globalThis[Symbol.for('capri.providerTiming')] = (url, body) =>
    providerTimingSpan(url, body, { ollamaPort: port });
  installGatewayTimingProbe();
}
