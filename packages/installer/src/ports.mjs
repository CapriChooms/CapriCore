// SPDX-License-Identifier: GPL-3.0-only
import net from 'node:net';
export async function findFreePort(first, reserved = new Set()) {
  for (let port = first; port < Math.min(first + 100, 65536); port++) {
    if (reserved.has(port)) continue;
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
        server.close(() => resolve(true)),
      );
    });
    if (free) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error('No free local service port was found');
}
