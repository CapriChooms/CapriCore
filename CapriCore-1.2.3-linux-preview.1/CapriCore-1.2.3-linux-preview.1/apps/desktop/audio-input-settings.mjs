import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './storage.mjs';

const cleanLabel = (value) =>
  value
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .trim()
    .slice(0, 180);
const validId = (value) =>
  typeof value === 'string' && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);

/** Stores a selection, never captured audio or the complete hardware inventory. */
export class AudioInputSettings {
  constructor(file) {
    this.file = file;
    this.deviceId = '';
    this.deviceLabel = 'System default';
    this.devices = [];
    this.defaultLabel = 'System default';
    if (existsSync(file))
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        if (
          saved.schemaVersion === 1 &&
          validId(saved.deviceId) &&
          typeof saved.deviceLabel === 'string'
        ) {
          this.deviceId = saved.deviceId === 'default' ? '' : saved.deviceId;
          this.deviceLabel = this.deviceId
            ? cleanLabel(saved.deviceLabel) || 'Microphone'
            : 'System default';
        }
      } catch {
        /* Keep the original file intact until an explicit selection. */
      }
  }
  update(devices) {
    if (!Array.isArray(devices) || devices.length > 128)
      throw new Error('Invalid audio input list');
    const seen = new Set(),
      inputs = [];
    this.defaultLabel = 'System default';
    for (const device of devices) {
      if (
        device?.kind !== 'audioinput' ||
        !validId(device.deviceId) ||
        !device.deviceId ||
        typeof device.label !== 'string'
      )
        continue;
      const label = cleanLabel(device.label);
      if (device.deviceId === 'default') {
        this.defaultLabel = label
          ? 'System default — ' + label.replace(/^Default\s*[-–—]\s*/i, '')
          : 'System default';
        continue;
      }
      if (device.deviceId === 'communications' || seen.has(device.deviceId)) continue;
      seen.add(device.deviceId);
      inputs.push({
        deviceId: device.deviceId,
        deviceLabel: label || `Microphone ${inputs.length + 1}`,
      });
    }
    this.devices = inputs;
    return this.snapshot();
  }
  snapshot() {
    return {
      deviceId: this.deviceId,
      deviceLabel: this.deviceId ? this.deviceLabel : this.defaultLabel,
    };
  }
  describe(deviceId) {
    if (!validId(deviceId)) throw new Error('Invalid microphone selection');
    if (deviceId === 'default') deviceId = '';
    const input = deviceId
      ? this.devices.find((device) => device.deviceId === deviceId)
      : { deviceId: '', deviceLabel: 'System default' };
    if (!input)
      throw new Error('That microphone is unavailable. Reopen the menu to refresh the list.');
    return input;
  }
  select(deviceId) {
    const input = this.describe(deviceId);
    if (input.deviceId === this.deviceId) return false;
    writeJsonAtomic(this.file, { schemaVersion: 1, ...input });
    this.deviceId = input.deviceId;
    this.deviceLabel = input.deviceLabel;
    return true;
  }
  menu(select) {
    const item = (deviceId, label) => ({
      label,
      type: 'radio',
      checked: this.deviceId === deviceId,
      click: () => select(deviceId),
    });
    const entries = [
      item('', this.defaultLabel),
      ...this.devices.map((device) => item(device.deviceId, device.deviceLabel)),
    ];
    if (this.deviceId && !this.devices.some((device) => device.deviceId === this.deviceId))
      entries.push({
        label: 'Unavailable — ' + this.deviceLabel,
        type: 'radio',
        checked: true,
        enabled: false,
      });
    if (!this.devices.length)
      entries.push({ label: 'No named microphones detected', enabled: false });
    return entries;
  }
}
