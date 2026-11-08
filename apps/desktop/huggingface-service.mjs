// SPDX-License-Identifier: GPL-3.0-only
/** Main-process owner of Hub operations. Renderer never supplies a download plan. */
export class HuggingFaceService {
  constructor({
    hub,
    credentials,
    emit = () => {},
    ensure = async () => {},
    changed = async () => {},
    active = () => null,
  }) {
    Object.assign(this, { hub, credentials, emit, ensure, changed, active });
    this.controller = null;
    this.planValue = null;
    this.value = {
      phase: 'idle',
      results: [],
      repository: null,
      plan: null,
      installed: [],
      progress: null,
      error: null,
    };
  }
  snapshot() {
    return structuredClone(this.value);
  }
  publish(patch) {
    Object.assign(this.value, patch);
    const value = this.snapshot();
    this.emit({ type: 'huggingface.status', ...value });
    return value;
  }
  busy() {
    return this.controller !== null;
  }
  async refresh() {
    return this.publish({
      installed: await this.hub.list(),
      credentials: await this.credentials.status(),
    });
  }
  async run(phase, work) {
    if (this.busy()) throw new Error('Wait for the Hugging Face operation to finish.');
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ phase, error: null, progress: null });
    try {
      const patch = await work(controller.signal);
      controller.signal.throwIfAborted();
      return this.publish({ phase: 'idle', ...patch });
    } catch (error) {
      // Hub transport supplies safe errors. Scrub secret-like strings defensively.
      const message = String(error.message ?? 'Hugging Face operation failed.')
        .replace(/\bhf_[A-Za-z0-9]{8,}\b/g, '[REDACTED]')
        .replace(/https:\/\/\S+/g, '[remote address]');
      return this.publish({
        phase: controller.signal.aborted ? 'idle' : 'error',
        error: controller.signal.aborted ? null : message,
        progress: null,
      });
    } finally {
      this.controller = null;
    }
  }
  search(value) {
    if (
      !value ||
      typeof value.query !== 'string' ||
      value.query.length > 160 ||
      !['llm', 'tts'].includes(value.task)
    )
      throw new Error('Enter a model name and select a model type.');
    return this.run('searching', async (signal) => ({
      results: await this.hub.search(value, { signal }),
    }));
  }
  inspect(repository) {
    return this.run('checking', async (signal) => {
      this.planValue = null;
      this.publish({ repository: null, plan: null });
      return { repository: await this.hub.inspect(repository, { signal }) };
    });
  }
  plan(selection) {
    return this.run('checking', async (signal) => {
      this.planValue = null;
      this.publish({ plan: null });
      const plan = await this.hub.plan(selection, { signal });
      signal.throwIfAborted();
      this.planValue = plan;
      return { plan };
    });
  }
  install() {
    if (!this.planValue) throw new Error('Check the selected model files first.');
    const plan = this.planValue;
    return this.run('downloading', (signal) => this.prepare(plan, signal));
  }
  repair(id) {
    return this.run('checking', async (signal) => {
      const receipt = (await this.hub.list()).find((item) => item.id === id);
      if (!receipt)
        throw new Error('Open the original Hugging Face repository to restore this package.');
      if (receipt.profile?.alias === this.active())
        throw new Error('Switch to another model before repairing the active model.');
      this.publish({ phase: 'downloading' });
      return this.prepare(receipt, signal);
    });
  }
  async prepare(plan, signal) {
    const receipt = await this.hub.install(plan, {
      signal,
      onProgress: (progress) => this.publish({ progress }),
    });
    signal.throwIfAborted();
    this.publish({ phase: 'preparing', progress: null });
    await this.ensure();
    signal.throwIfAborted();
    await this.hub.importLanguageModel(receipt.id, { signal });
    await this.changed();
    return { installed: await this.hub.list(), phase: 'ready', progress: null };
  }
  remove(id) {
    return this.run('removing', async (signal) => {
      const receipt = (await this.hub.list()).find((item) => item.id === id);
      if (!receipt) throw new Error('Unknown installed model.');
      if (receipt.profile?.alias === this.active())
        throw new Error('Switch to another model before removing the active model.');
      await this.hub.remove(id, { signal, activeModel: this.active() });
      await this.changed();
      return { installed: await this.hub.list() };
    });
  }
  cancel() {
    this.controller?.abort(new Error('Cancelled'));
    return this.snapshot();
  }
  close() {
    this.cancel();
  }
}
