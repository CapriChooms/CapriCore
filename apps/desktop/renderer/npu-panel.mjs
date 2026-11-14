// SPDX-License-Identifier: GPL-3.0-only
export class NpuPanel {
  constructor({ api, ui, host, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.className = 'settings-card';
    this.panel.innerHTML = `<h3>Native NPU · Experimental</h3>
      <p class="settings-help">Run a converted language model directly on an NPU. No API server or cloud is used. Voice stays on its selected CPU/GPU. A compatible NPU, driver and vendor runtime are required.</p>
      <label>Native runtime<select data-npu="backend"><option value="openvino">Intel NPU · OpenVINO GenAI</option><option value="vitis">AMD NPU · Ryzen AI / ONNX GenAI</option><option value="qnn">Qualcomm NPU · QNN / ONNX GenAI</option></select></label>
      <label>Converted model folder<input data-npu="modelPath" type="text" readonly></label>
      <div class="settings-actions"><button data-npu="folder">Choose model folder</button><button data-npu="python">Choose vendor Python</button></div>
      <p data-npu="pythonLabel" class="settings-help"></p>
      <label>Model context limit<select data-npu="contextTokens"><option>2048</option><option>4096</option><option selected>8192</option><option>16384</option><option>32768</option></select></label>
      <p class="settings-help">Use OpenVINO IR or ONNX GenAI data prepared for your NPU. GGUF models cannot run here. AMD hybrid models also use GPU resources. Model repositories containing scripts or libraries are rejected.</p>
      <div class="settings-actions"><button data-npu="install">Prepare Intel runtime</button><button data-npu="test">Test native model</button><button data-npu="use" disabled>Use NPU and restart</button></div>
      <p data-npu="status" class="settings-help" role="status" aria-live="polite"></p>`;
    host.append(this.panel);
    this.get = (key) => this.panel.querySelector(`[data-npu="${key}"]`);
    this.get('backend').onchange = this.get('contextTokens').onchange = () => {
      this.tested = false;
      this.update();
    };
    for (const op of ['folder', 'python', 'install', 'test', 'use'])
      this.get(op).onclick = () => this.run(op);
  }
  value() {
    return {
      backend: this.get('backend').value,
      modelPath: this.get('modelPath').value,
      python: this.python ?? '',
      contextTokens: Number(this.get('contextTokens').value),
    };
  }
  update() {
    for (const button of this.panel.querySelectorAll('button'))
      button.disabled = Boolean(this.busy);
    this.get('use').disabled = this.busy || !this.tested;
    this.get('install').hidden = this.get('backend').value !== 'openvino';
    this.get('pythonLabel').textContent =
      this.python ||
      this.ui.text(
        this.get('backend').value === 'openvino'
          ? 'Uses Capri’s private OpenVINO runtime unless a vendor Python is selected.'
          : 'Choose the Python environment installed by your NPU vendor.',
      );
  }
  async refresh() {
    if (!this.api.nativeNpu) return;
    try {
      const value = await this.api.nativeNpu({ op: 'status' });
      for (const key of ['backend', 'modelPath', 'contextTokens'])
        this.get(key).value = value.config[key];
      this.python = value.config.python;
      this.update();
    } catch (error) {
      this.onError(error.message);
    }
  }
  async run(op) {
    this.busy = true;
    this.update();
    this.get('status').textContent = this.ui.text(
      op === 'install'
        ? 'Preparing native NPU runtime. This can take several minutes…'
        : op === 'test'
          ? 'Compiling and checking the native NPU model…'
          : 'Working…',
    );
    try {
      const result = await this.api.nativeNpu({ op, config: this.value() });
      if (op === 'folder' && result) {
        this.get('modelPath').value = result;
        this.tested = false;
      }
      if (op === 'python' && result) {
        this.python = result;
        this.tested = false;
      }
      if (op === 'test') this.tested = result?.ready === true;
      this.get('status').textContent = this.ui.text(
        op === 'test'
          ? 'Native NPU model is ready. You can use it and restart Capri.'
          : op === 'install'
            ? 'Runtime prepared. Choose a converted model and test it.'
            : '',
      );
    } catch (error) {
      this.tested = false;
      this.get('status').textContent = error.message;
    } finally {
      this.busy = false;
      this.update();
    }
  }
}
