// SPDX-License-Identifier: GPL-3.0-only
import { VOICE_VOLUME_DEFAULT } from './voice-volume.mjs';

export class VoiceVolumeMenu {
  constructor({ button, api, ui, player, onError, onLayout }) {
    Object.assign(this, { button, api, ui, player, onError, onLayout });
    this.menu = document.getElementById('voice-volume-menu');
    this.slider = document.getElementById('voice-volume');
    this.output = document.getElementById('voice-volume-value');
    this.settings = { enabled: false, volume: VOICE_VOLUME_DEFAULT };
    this.write = Promise.resolve();
    const leave = () => {
      clearTimeout(this.hoverTimer);
      if (!this.pinned) this.hoverTimer = setTimeout(() => this.close(), 160);
    };
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => this.open(), 240);
    });
    button.addEventListener('pointerleave', leave);
    this.menu.addEventListener('pointerenter', () => clearTimeout(this.hoverTimer));
    this.menu.addEventListener('pointerleave', leave);
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.open(true);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      this.open(true);
    });
    this.slider.addEventListener('pointerdown', () => {
      this.pinned = true;
      clearTimeout(this.hoverTimer);
    });
    this.slider.addEventListener('input', () => {
      this.pending = Number(this.slider.value);
      if (this.pending > 0 && !this.settings.enabled) void this.player.unlock().catch(() => {});
      this.player.setSpeakerVolume(this.pending);
      this.render();
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flush(), 140);
    });
    this.slider.addEventListener('change', () => this.flush());
    document.addEventListener('pointerdown', (event) => {
      if (!button.contains(event.target) && !this.menu.contains(event.target)) this.close();
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (this.menu.hidden || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.close();
        button.focus();
      },
      true,
    );
    this.menu.addEventListener('focusout', (event) => {
      if (event.relatedTarget && !this.menu.contains(event.relatedTarget)) this.close();
    });
    window.addEventListener('resize', () => this.position());
    window.addEventListener('blur', () => this.close());
  }

  show(settings) {
    this.settings = settings;
    if (this.pending === undefined && this.saving === undefined)
      this.player.setSpeakerVolume(settings.volume ?? VOICE_VOLUME_DEFAULT);
    this.render();
    if (this.button.disabled) this.close();
  }

  render() {
    const volume =
      this.pending ??
      this.saving ??
      (this.settings.enabled ? (this.settings.volume ?? VOICE_VOLUME_DEFAULT) : 0);
    this.slider.value = volume;
    this.output.value = new Intl.NumberFormat(this.ui.language, { style: 'percent' }).format(
      volume / 100,
    );
  }

  flush() {
    clearTimeout(this.saveTimer);
    if (this.pending === undefined || this.saving !== undefined) return this.write;
    const volume = this.pending;
    this.pending = undefined;
    this.saving = volume;
    this.write = this.api
      .setVoiceVolume(volume)
      .then((settings) => this.show(settings))
      .catch((error) => this.onError(error.message || 'Voice settings could not be saved.'))
      .finally(() => {
        this.saving = undefined;
        if (this.pending === undefined) this.show(this.settings);
        else return this.flush();
      });
    return this.write;
  }

  position() {
    if (this.menu.hidden) return;
    const { left, top, bottom, right } = this.button.getBoundingClientRect();
    if (!this.available || right === left) return this.close();
    const { offsetWidth: width, offsetHeight: height } = this.menu;
    this.menu.style.left =
      Math.max(6, Math.min(innerWidth - width - 6, (left + right - width) / 2)) + 'px';
    this.menu.style.top =
      Math.max(0, bottom + height + 8 <= innerHeight ? bottom : top - height) + 'px';
    this.onLayout();
  }

  open(pinned = false) {
    clearTimeout(this.hoverTimer);
    if (!this.available) return;
    this.pinned ||= pinned;
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.render();
    this.position();
    if (pinned) this.slider.focus({ preventScroll: true });
  }

  get available() {
    return (
      !this.button.hidden && !this.button.disabled && this.button.dataset.skillEnabled !== 'false'
    );
  }

  close() {
    clearTimeout(this.hoverTimer);
    if (this.menu.hidden) return;
    this.pinned = false;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.onLayout();
  }
}
