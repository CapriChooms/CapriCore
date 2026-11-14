/** Owned local connection for bounded history reads and assistant transcript commits. */
export class CompanionRpc {
  constructor({ url, token }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
      throw new Error('Gateway must use local loopback');
    Object.assign(this, { url: url.replace(/^http:/, 'ws:'), token });
  }
  async connect() {
    if (this.connected) return;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const { GatewayClient } = await import('openclaw/plugin-sdk/gateway-runtime');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.stop();
          reject(new Error('Gateway metadata connection timed out'));
        }, 7000);
        this.client = new GatewayClient({
          url: this.url,
          token: this.token(),
          clientName: 'gateway-client',
          clientDisplayName: 'Capri companion metadata',
          mode: 'backend',
          role: 'operator',
          scopes: ['operator.read', 'operator.write', 'operator.admin'],
          deviceIdentity: null,
          onHelloOk: () => {
            clearTimeout(timer);
            this.connected = true;
            resolve();
          },
          onConnectError: (error) => {
            clearTimeout(timer);
            this.stop();
            reject(error);
          },
          onClose: () => {
            this.connected = false;
          },
        });
        this.client.start();
      });
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async call(method, params, { signal } = {}) {
    if (
      ![
        'chat.history',
        'chat.inject',
        'health',
        'capri.visual.commit',
        'sessions.reset',
        'sessions.describe',
      ].includes(method)
    )
      throw new Error('Unsupported companion metadata method');
    signal?.throwIfAborted();
    await this.connect();
    signal?.throwIfAborted();
    // Reset is a lifecycle mutation. It can drain work and archive the previous
    // transcript before replying, unlike a metadata read.
    const request = this.client.request(method, params, {
      timeoutMs: method === 'sessions.reset' ? 30000 : 5000,
    });
    if (!signal) return request;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error('Metadata request cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  }
  stop() {
    this.connected = false;
    this.client?.stop();
    this.client = null;
  }
}
