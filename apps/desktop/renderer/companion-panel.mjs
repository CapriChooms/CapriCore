// SPDX-License-Identifier: GPL-3.0-only
import {
  arrivalStart,
  boltOnlyFrames,
  draw as drawTeleport,
  fps as teleportFps,
  prepareTeleportMotion,
  transitStart,
} from './avatar-teleport-motion.mjs';
import { ChessFrameEffect } from './chess-frame-effect.mjs';
import {
  applyInterfaceTheme,
  BACKGROUND_BRIGHTNESS_RANGE,
  matchingPanelSaturation,
  THEME_DEFAULTS,
  validateInterfaceTheme,
} from './interface-theme.mjs';
import {
  DEFAULT_RESOURCE_GRAPHS,
  DEFAULT_RESOURCE_METERS,
  MAX_RESOURCE_METRICS,
  RESOURCE_REFRESH_INTERVALS,
  RESOURCE_METRICS,
} from './resource-metrics.mjs';
import { SavedMemoryPanel } from './saved-memory-panel.mjs';
import { bindAudioOutput, createAudioOutputContext } from './local-audio-output.mjs';
import {
  DRAG_LIGHTNING_COLOR,
  SANDEVISTAN_RANGES,
  TELEPORT_LIGHTNING_DEFAULTS,
  TELEPORT_LIGHTNING_RANGES,
} from './teleport-effects.mjs';
import {
  drawSandevistan,
  prepareSandevistan,
  SANDEVISTAN_TRAVEL_MS,
  sandevistanStamps,
} from './sandevistan-motion.mjs';
import { playWakeChime, playWakeSample } from './wake-feedback.mjs';
const resourceDisplays = [
  {
    id: 'process-graphs',
    field: 'graphMetrics',
    label: 'Show system resource graphs',
    defaults: DEFAULT_RESOURCE_GRAPHS,
  },
  {
    id: 'memory-monitor',
    field: 'meterMetrics',
    label: 'Show resource meters',
    defaults: DEFAULT_RESOURCE_METERS,
  },
];
const themeAxes = [
  { prefix: 'theme', label: 'Accent color', hue: 'hue', saturation: 'saturation', min: 35 },
  {
    prefix: 'theme-panel',
    label: 'Panel color',
    hue: 'panelHue',
    saturation: 'panelSaturation',
    min: 0,
  },
  {
    prefix: 'theme-background',
    label: 'Background color',
    hue: 'backgroundHue',
    saturation: 'backgroundSaturation',
    min: 0,
  },
];
const teleportSliders = [
  ['teleport-intensity', 'teleportIntensity', 'Teleport intensity'],
  ['teleport-jaggedness', 'teleportJaggedness', 'Lightning jaggedness'],
  ['teleport-branches', 'teleportBranches', 'Lightning branches'],
  ['teleport-thickness', 'teleportThickness', 'Thickness'],
  ['teleport-glow', 'teleportGlow', 'Glow radius'],
  ['teleport-spark-amount', 'teleportSparkAmount', 'Spark amount'],
  ['teleport-spark-travel', 'teleportSparkTravel', 'Spark travel'],
].map(([id, key, label]) => ({ id, key, label, ...TELEPORT_LIGHTNING_RANGES[key] }));
const sandevistanSliders = [
  ['sandevistan-hold', 'sandevistanHoldMs', 'Trail lifetime'],
  ['sandevistan-copies', 'sandevistanCopies', 'Trail copies'],
  ['sandevistan-hue', 'sandevistanHue', 'Starting hue'],
  ['sandevistan-hue-step', 'sandevistanHueStep', 'Hue step per copy'],
  ['sandevistan-tint', 'sandevistanTint', 'Trail tint strength'],
].map(([id, key, label]) => ({ id, key, label, ...SANDEVISTAN_RANGES[key] }));
const allTeleportSliders = [...teleportSliders, ...sandevistanSliders];
const teleportRanges = (sliders) =>
  sliders
    .map(
      ({ id, label, defaultValue, min, max, step = 1 }) => `
      <div class="teleport-slider">
        <label class="drag-lightning-control" for="${id}"><span>${label}</span><output id="${id}-value" data-untranslated></output></label>
        <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${defaultValue}">
      </div>`,
    )
    .join('');
const dragLightningSliders = [
  {
    id: 'avatar-drag-tether-intensity',
    key: 'avatarDragTetherIntensity',
    label: 'Intensity',
    initial: 45,
    max: 100,
    unit: '%',
  },
  {
    id: 'avatar-drag-tether-chaos',
    key: 'avatarDragTetherChaos',
    label: 'Chaos',
    initial: 55,
    max: 100,
    unit: '%',
  },
  {
    id: 'avatar-drag-tether-dead-zone',
    key: 'avatarDragTetherDeadZone',
    label: 'Dead zone',
    initial: 30,
    max: 120,
    unit: ' px',
  },
];

/** Private settings, community links and maintenance controls. Text is never HTML. */
export class CompanionPanel {
  constructor({
    api,
    ui,
    onOpen,
    onError,
    onChange,
    confirm,
    wakeOutputDevice,
    deferDrafts = false,
  }) {
    Object.assign(this, {
      api,
      ui,
      onOpen,
      onError,
      onChange,
      confirm,
      wakeOutputDevice,
      deferDrafts,
    });
    this.panel = document.createElement('section');
    this.panel.id = 'companion-settings';
    this.panel.dataset.panelCut = '12';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.hitRegion = '';
    this.panel.setAttribute('aria-label', 'Companion settings');
    this.panel.innerHTML = `
      <div class="settings-heading"><h2 id="companion-panel-title">Companion settings</h2><button type="button" id="companion-close" aria-label="Close settings">×</button></div>
      <div class="preferences-content">
        <section data-companion-tab="support" class="support-content settings-stack">
          <section class="settings-card support-donation-card" aria-labelledby="support-donation-title">
          <div id="support-frame" aria-hidden="true" hidden></div>
          <div class="support-art" aria-hidden="true"><div class="support-orbit"></div><div class="support-heart">♥</div><i></i><i></i><i></i><i></i><span>CAPRI / COMMUNITY LINK</span></div>
          <h3 id="support-donation-title">Help Capri grow</h3><p class="support-developer"><span>Developed by</span> <strong data-untranslated>Overyx</strong></p><p>Capri is free. If she makes your day a little brighter, you can support her development. Every contribution means a lot. Thank you for being here.</p>
          <div class="settings-actions support-links">
            <div class="support-donations" dir="ltr">
              <button type="button" data-community="boosty-donate" class="brand-boosty"><span class="brand-icon" aria-hidden="true"></span><span dir="auto">Donate via Boosty</span></button>
              <button type="button" id="support-donation-open" class="brand-lava"><span class="brand-icon" aria-hidden="true"></span><span dir="auto">Donate via Lava.top</span></button>
            </div>
          </div>
          <button type="button" class="support-donation-browser" data-community="lava-donate">Open donation in browser</button>
          <p class="settings-help">Payment methods and availability depend on Lava.top and your country.</p>
          </section>
          <section class="settings-card" aria-labelledby="support-community-title">
          <h3 id="support-community-title">Community</h3>
          <div class="settings-actions support-links">
            <div class="support-social">
              <button type="button" data-community="discord" class="brand-discord" data-untranslated><span class="brand-icon" aria-hidden="true"></span><span>Discord</span></button>
              <button type="button" data-community="tiktok" class="brand-tiktok" data-untranslated><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="18" r="4"/><path d="M12 18V2l7 4"/></svg></span><span>TikTok</span></button>
              <button type="button" data-community="youtube" class="brand-youtube" data-untranslated><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.1a3 3 0 0 0-2.1-2.1C19 4.5 12 4.5 12 4.5s-7 0-8.9.5A3 3 0 0 0 1 7.1a31.5 31.5 0 0 0 0 9.8A3 3 0 0 0 3.1 19c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31.5 31.5 0 0 0 0-9.8ZM9.8 15.3V8.7l5.8 3.3-5.8 3.3Z"/></svg></span><span>YouTube</span></button>
              <button type="button" data-community="github" class="brand-github" data-untranslated><span class="brand-icon" aria-hidden="true"></span><span>GitHub</span></button>
            </div>
            <div class="support-resources">
              <button type="button" data-community="website" class="brand-website" aria-label="capri-core.com" dir="ltr" data-untranslated>
                <span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 44 52"><path d="M27 1 3 26h15L12 47 38 17H23z" transform="translate(4 3)" fill="var(--site-brand-red)"/><path d="M27 1 3 26h15L12 47 38 17H23z" fill="var(--site-brand-green)"/></svg></span>
                <span class="site-brand-wordmark" aria-hidden="true"><span>CAPRI</span> <span>CORE</span></span>
              </button>
            </div>
          </div>
          </section>
        </section>
        <section data-companion-tab="bug" class="settings-stack" hidden>
          <section class="settings-card" aria-labelledby="bug-details-title">
          <h3 id="bug-details-title">Report a problem</h3>
          <p>Send your description and selected diagnostics privately to the Capri maintainer. You can also save and review a ZIP on this PC.</p>
          <label for="bug-category">Problem area</label><select id="bug-category"><option value="voice">Voice</option><option value="recognition">Speech recognition</option><option value="model">Language model</option><option value="startup">Startup</option><option value="interface">Interface</option><option value="installer">Installation</option><option value="other">Other</option></select>
          <label for="bug-title">Short title</label><input id="bug-title" type="text" maxlength="160" dir="auto">
          <label for="bug-description">What went wrong?</label>
          <textarea id="bug-description" rows="6" maxlength="4000" placeholder="What went wrong?" dir="auto"></textarea>
          <label for="bug-steps">Steps to reproduce</label><textarea id="bug-steps" rows="3" maxlength="3000" dir="auto"></textarea>
          <label for="bug-expected">Expected result</label><textarea id="bug-expected" rows="2" maxlength="1500" dir="auto"></textarea>
          <label for="bug-actual">Actual result</label><textarea id="bug-actual" rows="2" maxlength="1500" dir="auto"></textarea>
          </section>
          <section class="settings-card" aria-labelledby="bug-logs-title">
          <h3 id="bug-logs-title">Logs</h3>
          <label><input type="checkbox" id="bug-logs" checked> <span>Include recent diagnostic logs</span></label>
          <p class="settings-help">Chat-history files, memory, recordings and screenshots are excluded. Known secrets and common personal paths are redacted. Review logs before sharing.</p>
          <div class="settings-actions"><button type="button" id="bug-send">Send report</button><button type="button" id="bug-save">Save report</button><button type="button" data-community="issues">Open GitHub issues</button></div>
          </section>
        </section>
        <section data-companion-tab="settings" class="settings-stack" hidden>
          <section class="settings-card" data-companion-group="Qwen model">
          <h3>Qwen model</h3><div class="settings-actions"><button type="button" id="companion-models">Choose Qwen model</button></div>
          </section>
          <section class="settings-card" data-companion-group="Updates">
          <h3>Updates</h3><div class="settings-actions"><button type="button" id="companion-updates">Check for updates</button></div>
          </section>
          <section class="settings-card" data-companion-group="Interface theme">
          <h3>Interface theme</h3>
          <div class="theme-palette-label">
            <label for="theme-preset">Color palette</label>
            <div class="theme-palette-swatches" role="group" aria-label="Color palette">
              <span data-theme-swatch="accent" role="img" aria-label="Accent color" title="Accent color"></span>
              <span data-theme-swatch="background" role="img" aria-label="Background color" title="Background color"></span>
              <span data-theme-swatch="panel" role="img" aria-label="Panel color" title="Panel color"></span>
            </div>
          </div>
          <select id="theme-preset"><option value="capri" data-untranslated>Original</option><option value="cyberpunk-2077" data-untranslated>Cyberpunk 2077</option><option value="blackwall" data-untranslated>Blackwall</option><option value="amethyst">Amethyst</option><option value="overdrive">Overdrive</option><option value="custom">Custom</option></select>
          <div id="theme-custom" class="theme-custom" hidden>
            ${themeAxes
              .map(({ prefix, label, min, hue, saturation }) => {
                const panel = prefix === 'theme-panel';
                const brightness = prefix === 'theme-background';
                return `
              <fieldset class="theme-color" data-theme-axis="${prefix}">
                <legend>${label}</legend>
                ${panel ? '<label class="theme-link-panel"><input id="theme-panel-linked" type="checkbox" checked> Match background</label>' : ''}
                <div class="theme-color-controls">
                  <div id="${prefix}-wheel" class="theme-wheel" aria-hidden="true"><i></i></div>
                  <div class="theme-sliders">
                    <label for="${prefix}-hue">Hue <output id="${prefix}-hue-output"></output></label>
                    <input id="${prefix}-hue" type="range" min="0" max="359" value="${THEME_DEFAULTS[hue] ?? THEME_DEFAULTS.backgroundHue}">
                    <label for="${prefix}-saturation">Saturation <output id="${prefix}-saturation-output"></output></label>
                    <input id="${prefix}-saturation" type="range" min="${min}" max="100" value="${THEME_DEFAULTS[saturation] ?? matchingPanelSaturation(THEME_DEFAULTS.backgroundSaturation)}">
                    ${
                      brightness
                        ? `<label for="theme-background-brightness">Brightness <output id="theme-background-brightness-output"></output></label>
                    <input id="theme-background-brightness" type="range" min="${BACKGROUND_BRIGHTNESS_RANGE.min}" max="${BACKGROUND_BRIGHTNESS_RANGE.max}" value="${THEME_DEFAULTS.backgroundBrightness}">`
                        : ''
                    }
                  </div>
                </div>
              </fieldset>`;
              })
              .join('')}
          </div>
          </section>
          <section class="settings-card" data-companion-group="System resource usage">
          <h3>System resource usage</h3>
          <p class="settings-help" id="resource-metric-limit">Select up to four metrics for each display mode.</p>
          ${resourceDisplays
            .map(
              ({ id, field, label }) => `
            <div class="resource-display-settings">
              <label class="general-toggle resource-display-toggle">
                <input type="checkbox" role="switch" id="${id}">
                <span id="${id}-label">${label}</span>
                ${id === 'process-graphs' ? '<span id="resource-graph-count" class="resource-graph-count" aria-live="polite" data-untranslated></span>' : ''}
                <span class="general-switch-track" aria-hidden="true"></span>
              </label>
              <div class="resource-metric-options" role="group" aria-labelledby="${id}-label" aria-describedby="resource-metric-limit">
                ${RESOURCE_METRICS.map(
                  (metric) => `<label class="general-toggle">
                    <input type="checkbox" role="switch" data-resource-display="${field}" value="${metric.id}">
                    <span>${metric.label}</span>
                    <span class="general-switch-track" aria-hidden="true"></span>
                  </label>`,
                ).join('')}
              </div>
            </div>`,
            )
            .join('')}
          <label for="memory-style">Chart style</label><select id="memory-style"><option value="rings">Circles</option><option value="bars">Bars</option></select>
          <span id="resource-graph-limit-status" class="sr-only" role="status" data-untranslated></span>
          <label for="memory-interval">Refresh interval</label><select id="memory-interval">${RESOURCE_REFRESH_INTERVALS.map((seconds) => `<option value="${seconds}">${seconds} s</option>`).join('')}</select>
          </section>
          <section class="settings-card" data-companion-group="Portrait">
          <h3>Portrait</h3><label for="settings-portrait-zoom">Portrait zoom <output id="settings-portrait-zoom-value"></output></label><input id="settings-portrait-zoom" type="range" min="60" max="300" step="1" value="115">
          <label><input id="companion-expand-reply" type="checkbox">Expand Capri when replying</label>
          </section>
          <section class="settings-card" data-companion-group="Desktop presentation">
          <h3>Desktop presentation</h3>
          <label><input type="checkbox" id="minimized-chip">Show a restore chip when minimized</label>
          <label for="detached-style">Out-of-frame appearance</label><select id="detached-style"><option value="character">Character</option><option value="dialogue">Dialogue only</option></select>
          <div id="reply-visibility-settings" class="general-setting general-switch-row">
            <label class="general-toggle"><input id="reply-auto-hide" type="checkbox" role="switch" aria-describedby="reply-auto-hide-help"><span>Auto-hide completed replies</span><span class="general-switch-track" aria-hidden="true"></span></label>
            <p id="reply-auto-hide-help">Hides the reply after playback, or after a delay when voice is off.</p>
            <div class="general-reply-delay">
              <label for="reply-auto-hide-seconds">Text-only reply delay (seconds)</label><input id="reply-auto-hide-seconds" type="number" min="2" max="60" step="1" value="8" required>
            </div>
          </div>
          </section>
          <section class="settings-card" data-companion-group="Window layout">
          <label for="companion-window-layout">Window layout</label>
          <select id="companion-window-layout"><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select>
          <label for="horizontal-monitor-position">Resource monitor position</label>
          <select id="horizontal-monitor-position" disabled><option value="between">Between portrait and chat</option><option value="right">Right of chat</option></select>
          </section>
          <section class="settings-card" data-companion-group="Window motion">
          <h3 id="companion-motion-heading">Window motion</h3>
          <label><input id="reply-animation" type="checkbox">Animate the reply bubble</label>
          <div class="motion-preview" id="motion-preview" aria-hidden="true" data-untranslated><i></i><span>CAPRI<span>◇</span></span><i></i></div>
          <label><input id="companion-float-enabled" type="checkbox">Enable floating motion</label>
          <label for="companion-float-amplitude">Motion amplitude <output id="companion-float-amplitude-value" data-untranslated></output></label><input id="companion-float-amplitude" type="range" min="0" max="24" step="1">
          <label for="companion-float-period">Motion cycle <output id="companion-float-period-value" data-untranslated></output></label><input id="companion-float-period" type="range" min="4" max="30" step="1">
          <p class="settings-help">Longer cycles move more slowly. Motion pauses during interaction and stays inside the window. Reduced motion turns it off.</p>
          </section>
          <section class="settings-card" data-companion-group="Visual glitch">
          <h3>Visual glitch</h3>
          <label><input type="checkbox" id="companion-glitch-enabled">Enable visual glitches</label>
          <label for="companion-glitch-strength">Glitch intensity <output id="companion-glitch-strength-value"></output></label>
          <input id="companion-glitch-strength" type="range" min="0" max="100" step="1" value="65">
          <label for="companion-glitch-interval">Ambient glitch interval <output id="companion-glitch-interval-value"></output></label>
          <input id="companion-glitch-interval" type="range" min="10" max="120" step="1" value="35">
          <label><input type="checkbox" id="companion-glitch-events">Glitch on speech and pose changes</label>
          <p class="settings-help">Visual glitches briefly split the colours of Capri and her interface borders together. Ambient bursts happen while she is visible; speech and pose changes can trigger stronger bursts. Events are spaced at least six seconds apart. Ordinary clicks do not trigger them. Zero intensity is visually off.</p>
          <p class="settings-help" id="glitch-motion-help">Reduced motion disables moving glitches.</p>
          <div class="settings-actions"><button type="button" id="glitch-preview">Preview glitch</button></div>
          </section>
          <section class="settings-card" data-companion-group="Desktop roaming">
          <h3>Desktop roaming</h3>
          <label><input id="avatar-roaming" type="checkbox">Let Capri move around on her own</label>
          <label><input id="avatar-roam-cursor-pranks" type="checkbox">Let Capri move the mouse pointer while you are away</label>
          <p class="settings-help">Cursor pranks require Full computer access. Press Esc to stop.</p>
          <label for="avatar-roam-monitors">Roaming monitors</label><select id="avatar-roam-monitors"><option value="current">Current or observed monitor</option><option value="any">Any monitor</option><option value="pointer">Monitor with the pointer</option></select>
          <label class="drag-lightning-control" for="avatar-roam-interval">Time between moves <output id="avatar-roam-interval-value" data-untranslated></output></label>
          <input id="avatar-roam-interval" type="range" min="30" max="1800" step="30" value="120">
          <p class="settings-help">Random movement needs no screen access. Pauses while you talk, type or interact with Capri.</p>
          </section>
          <section class="settings-card teleport-effects" data-companion-group="Teleport effects">
            <div class="teleport-preview-strip">
              <div class="teleport-preview-heading">
                <h3>Teleport effects</h3>
                <button type="button" id="teleport-preview-play">Preview</button>
              </div>
              <canvas id="teleport-preview" class="teleport-preview" aria-hidden="true"></canvas>
            </div>
            <div class="teleport-style-control">
              <label for="teleport-style">Teleport animation</label>
              <select id="teleport-style"><option value="lightning">Lightning</option><option value="sandevistan">Sandevistan</option></select>
            </div>
            <div id="teleport-lightning-controls" class="teleport-effects-controls">
              <div class="teleport-color-control">
                <label class="drag-lightning-control" for="teleport-color"><span>Lightning color</span><input id="teleport-color" type="color" value="${TELEPORT_LIGHTNING_DEFAULTS.teleportColor}"></label>
              </div>
              ${teleportRanges(teleportSliders)}
            </div>
            <div id="teleport-sandevistan-controls" class="teleport-effects-controls" hidden>
              ${teleportRanges(sandevistanSliders)}
            </div>
            <div class="teleport-effects-footer">
              <label class="teleport-flashes"><input id="teleport-reduced-flash" type="checkbox"><span>Reduce teleport flashes</span></label>
              <div class="teleport-sound-control">
                <label for="teleport-sound">Teleport sound</label><select id="teleport-sound"><option value="off">Off</option><option value="spark">Spark</option><option value="thunder">Thunder</option><option value="pulse">Pulse</option></select>
              </div>
            </div>
          </section>
          <section class="settings-card" data-companion-group="Drag lightning">
          <h3>Drag lightning</h3>
          <label><input id="avatar-drag-tether" type="checkbox">Show drag lightning on the desktop</label>
          <label class="drag-lightning-control" for="avatar-drag-tether-color"><span>Drag lightning color</span><input id="avatar-drag-tether-color" type="color"></label>
          ${dragLightningSliders
            .map(
              ({ id, label, initial, max }) => `
            <label class="drag-lightning-control" for="${id}">${label} <output id="${id}-value" data-untranslated></output></label><input id="${id}" type="range" min="0" max="${max}" value="${initial}">`,
            )
            .join('')}
          <p class="settings-help">Intensity adds sparks and branches. Chaos spreads them out. The dead zone is measured in Windows logical pixels.</p>
          </section>
          <section class="settings-card" data-companion-group="Avatar attachment zones">
          <h3>Avatar attachment zones</h3>
          <label for="avatar-snap-radius">Attachment distance <output id="avatar-snap-radius-value"></output></label><input id="avatar-snap-radius" type="range" min="12" max="100" value="36">
          <svg class="avatar-zone-preview" viewBox="0 0 320 156" aria-label="Illustration of active desktop and window edges" role="img" data-ui-text>
            <rect x="10" y="10" width="300" height="136" rx="7" class="zone-outline"></rect>
            <path d="M12 12 H308 V144 H12 Z" class="zone-band"></path>
            <rect x="95" y="55" width="130" height="73" rx="4" class="zone-outline"></rect>
            <rect x="95" y="55" width="130" height="73" rx="4" class="zone-band"></rect>
            <text x="19" y="29">Display</text><text x="160" y="98" text-anchor="middle">Application</text>
          </svg>
          <p class="settings-help">Drop Capri near a highlighted edge to attach. Distance is in Windows logical pixels.</p>
          </section>
          <section class="settings-card" data-companion-group="Avatar click reactions">
          <h3>Avatar click reactions</h3>
          <label for="avatar-tap-gap">Maximum time between taps (seconds)</label><input id="avatar-tap-gap" type="number" min="1" max="15" value="10" required>
          <p class="settings-help">Ten taps on the same part can trigger a spoken reaction.</p>
          </section>
          <section class="settings-card" data-companion-group="Wake acknowledgement">
          <h3>Wake acknowledgement</h3>
          <label><input type="checkbox" id="wake-restore-from-tray">Restore Capri from the tray on voice activation</label>
          <label for="wake-sound">Sound after Capri hears her name</label>
          <select id="wake-sound"><option value="tone">Signal tone</option><option value="file">My audio file</option><option value="voice">Capri's voice</option><option value="off">Silent</option></select>
          <label id="wake-phrase-label" for="wake-phrase" hidden>Voice response</label><select id="wake-phrase" hidden disabled><option value="Listening.">Listening.</option><option value="Yes, choom.">Yes, choom.</option><option value="Mhm?">Mhm?</option></select>
          <label for="wake-volume">Acknowledgement volume</label><input id="wake-volume" type="range" min="0" max="1" step="0.05" value="0.7">
          <div class="settings-actions"><button type="button" id="wake-play">Play</button><button type="button" id="wake-import">Choose audio file</button><button type="button" id="wake-prepare" hidden disabled>Prepare voice response</button></div>
          <p class="settings-help">Use a short sound, up to 10 seconds. Voice responses are prepared once and played instantly. The signal tone is used while audio is unavailable.</p>
          </section>
          <section class="settings-card" data-companion-group="Conversation">
          <h3>Conversation</h3>
          <label for="communication-style">Communication style</label>
          <select id="communication-style"><option value="neutral">Neutral</option><option value="romantic">Romantic</option><option value="business">Business</option><option value="wild">Wild</option></select>
          <p class="settings-help">This style shapes Capri's next reply. Your Personality file remains editable.</p>
          <label id="wild-close-ai-tabs-label"><input type="checkbox" id="wild-close-ai-tabs">Close other AI tabs</label>
          <label id="wild-desktop-pranks-label"><input type="checkbox" id="wild-desktop-pranks">Wild desktop pranks</label>
          <p class="settings-help" data-help-for="wild-desktop-pranks-label">In Wild mode, Capri occasionally steals a decoy cursor. Your mouse and keyboard work as usual.</p>
          <button type="button" id="wild-pranks-preview">Preview a prank</button>
          </section>
          <section class="settings-card" data-companion-group="Hands-free conversation">
          <label id="companion-conversation-mode-label"><input type="checkbox" id="companion-conversation-mode">Hands-free conversation</label>
          <p class="settings-help" data-help-for="companion-conversation-mode-label">While the microphone is on, speech goes to the selected model, which can stay silent. Start voice commands with “Capri” to use skills.</p>
          <label for="companion-follow-up">Follow-up listening</label>
          <select id="companion-follow-up"><option value="off">Off</option><option value="questions">After a question</option><option value="replies">After any spoken reply</option></select>
          <label for="companion-follow-up-seconds">Follow-up listening time (seconds)</label><input id="companion-follow-up-seconds" type="number" min="5" max="30" value="12">
          </section>
          <div class="settings-actions"><button type="button" id="companion-save">Apply settings</button></div>
          <section class="settings-card" data-companion-group="Personality">
          <h3 id="personality-heading">Personality</h3>
          <textarea id="personality-text" rows="9" maxlength="24000" dir="auto" spellcheck="false" aria-labelledby="personality-heading" data-untranslated></textarea>
          <div class="settings-actions"><button type="button" id="personality-save">Save personality</button><button type="button" id="personality-open">Show Personality file</button><button type="button" id="personality-reset">Restore original character</button></div>
          </section>
          <section class="settings-card" data-companion-group="Reminders">
          <h3>Reminders</h3><label><input id="companion-reminder-wake" type="checkbox">Wake Capri and prepare her voice for reminders</label><p class="settings-help">Works while Capri is running. Does not wake Windows or turn on the microphone. Muted or text-only voices stay silent.</p>
          </section>
          <section class="settings-card" data-companion-group="Saved memories">
          <h3>Saved memories</h3>
          <div class="settings-actions"><button type="button" id="memory-view">View saved memories</button></div>
          <div id="saved-memory-view" class="saved-memory-view" hidden></div>
          </section>
          <section class="settings-card" data-companion-group="Memory controls">
          <h3>Memory controls</h3><p class="settings-help">Conversation context and long-term memory are separate. Capri will ask you to confirm before clearing either.</p>
          <div class="settings-actions"><button type="button" id="context-clear">Clear conversation</button><button type="button" id="memory-clear" class="danger-action">Clear long-term memory</button></div>
          </section>
        </section>
        <p id="companion-result" role="status"></p>
      </div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (id) =>
      this.panel.querySelector('#' + id) ??
      this.reminderSettings?.querySelector('#' + id) ??
      this.replySettings?.querySelector('#' + id);
    this.get('companion-close').onclick = () => this.open(false);
    this.savedMemory = new SavedMemoryPanel({
      element: this.get('saved-memory-view'),
      toggle: this.get('memory-view'),
      api,
      ui,
    });
    const previewTheme = () => {
      const theme = this.themeDraft();
      this.get('theme-custom').hidden = theme.preset !== 'custom';
      const linked = this.get('theme-panel-linked').checked;
      for (const { prefix } of themeAxes) {
        const hue = this.get(`${prefix}-hue`);
        const saturation = this.get(`${prefix}-saturation`);
        const wheel = this.get(`${prefix}-wheel`);
        if (prefix === 'theme-panel') {
          hue.disabled = saturation.disabled = linked;
          wheel.toggleAttribute('data-linked', linked);
          if (linked) {
            hue.value = theme.backgroundHue;
            saturation.value = matchingPanelSaturation(theme.backgroundSaturation);
          }
        }
        wheel.style.setProperty('--selected-hue', `${hue.value}deg`);
        this.get(`${prefix}-hue-output`).textContent = `${hue.value}°`;
        this.get(`${prefix}-saturation-output`).textContent = `${saturation.value}%`;
      }
      this.get('theme-background-brightness-output').textContent = `${theme.backgroundBrightness}%`;
      applyInterfaceTheme(theme);
    };
    this.previewTheme = previewTheme;
    this.get('theme-preset').addEventListener('input', previewTheme);
    this.get('theme-panel-linked').addEventListener('input', previewTheme);
    this.get('theme-background-brightness').addEventListener('input', previewTheme);
    for (const { prefix } of themeAxes) {
      const input = this.get(`${prefix}-hue`);
      input.addEventListener('input', previewTheme);
      this.get(`${prefix}-saturation`).addEventListener('input', previewTheme);
      const wheel = this.get(`${prefix}-wheel`);
      const turnWheel = ({ clientX, clientY }) => {
        const box = wheel.getBoundingClientRect();
        const x = clientX - box.left - box.width / 2;
        const y = clientY - box.top - box.height / 2;
        if (Math.hypot(x, y) < 4) return;
        input.value = (Math.round((Math.atan2(x, -y) * 180) / Math.PI) + 360) % 360;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      wheel.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || input.disabled) return;
        wheel.setPointerCapture(event.pointerId);
        turnWheel(event);
      });
      wheel.addEventListener('pointermove', (event) => {
        if (wheel.hasPointerCapture(event.pointerId)) turnWheel(event);
      });
    }
    this.avatarEffectControls = () => {
      const tetherEnabled = this.get('avatar-drag-tether').checked;
      this.get('avatar-drag-tether-color').disabled = !tetherEnabled;
      for (const { id, unit } of dragLightningSliders) {
        const control = this.get(id);
        control.disabled = !tetherEnabled;
        this.get(`${id}-value`).textContent = `${control.value}${unit}`;
      }
      const radius = Number(this.get('avatar-snap-radius').value);
      this.get('avatar-snap-radius-value').textContent = `${radius} px`;
      this.panel
        .querySelector('.avatar-zone-preview')
        .style.setProperty('--zone-distance', radius * 0.2);
    };
    for (const id of [
      'avatar-drag-tether',
      'avatar-snap-radius',
      ...dragLightningSliders.map(({ id }) => id),
    ])
      this.get(id).addEventListener('input', this.avatarEffectControls);
    this.wakeResponseControls = () => {
      const sound = this.get('wake-sound').value;
      const voice = sound === 'voice';
      const play = this.get('wake-play');
      play.disabled = sound === 'off' || (sound === 'file' && !this.value?.customAudio);
      play.textContent = ui.text(this.wakePreviewContext ? 'Stop' : 'Play');
      this.get('wake-phrase-label').hidden = !voice;
      this.get('wake-phrase').hidden = !voice;
      this.get('wake-phrase').disabled = !voice;
      this.get('wake-prepare').hidden = !voice;
      this.get('wake-prepare').disabled = !voice;
    };
    for (const id of ['wake-sound', 'wake-phrase'])
      this.get(id).addEventListener('change', () => {
        this.stopWakePreview();
        this.wakeResponseControls();
      });
    this.get('wake-play').onclick = () => void this.playWakePreview();
    this.roamingControls = () => {
      const control = this.get('avatar-roam-interval');
      const roaming = this.get('avatar-roaming').checked;
      control.disabled = !roaming && !this.get('avatar-roam-cursor-pranks').checked;
      this.get('avatar-roam-monitors').disabled = !roaming;
      const seconds = control.valueAsNumber;
      this.get('avatar-roam-interval-value').textContent =
        seconds < 60
          ? `${seconds} s`
          : `${Math.floor(seconds / 60)} min${seconds % 60 ? ' 30 s' : ''}`;
    };
    for (const id of ['avatar-roaming', 'avatar-roam-cursor-pranks', 'avatar-roam-interval'])
      this.get(id).addEventListener('input', this.roamingControls);
    this.resourceMetricInputs = Object.fromEntries(
      resourceDisplays.map(({ field }) => [
        field,
        [...this.panel.querySelectorAll(`[data-resource-display="${field}"]`)],
      ]),
    );
    const graphCount = this.get('resource-graph-count');
    const graphLimitStatus = this.get('resource-graph-limit-status');
    let limitAnimation;
    let limitTimer;
    for (const input of this.resourceMetricInputs.graphMetrics) {
      input.addEventListener('click', (event) => {
        if (
          this.resourceMetricInputs.graphMetrics.filter(({ checked }) => checked).length <=
          MAX_RESOURCE_METRICS
        )
          return;
        event.preventDefault();
        graphCount.dataset.limitHit = '';
        graphLimitStatus.textContent = this.get('resource-metric-limit').textContent;
        limitAnimation?.cancel();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
          limitAnimation = graphCount.animate(
            [
              { transform: 'translateX(0)' },
              { transform: 'translateX(-4px)' },
              { transform: 'translateX(4px)' },
              { transform: 'translateX(-2px)' },
              { transform: 'translateX(0)' },
            ],
            { duration: 300, easing: 'ease-out' },
          );
        clearTimeout(limitTimer);
        limitTimer = setTimeout(() => {
          delete graphCount.dataset.limitHit;
          graphLimitStatus.textContent = '';
        }, 900);
      });
    }
    this.memoryControls = () => {
      this.get('memory-style').disabled = !this.get('memory-monitor').checked;
      this.get('memory-interval').disabled =
        !this.get('memory-monitor').checked && !this.get('process-graphs').checked;
      for (const { id, field } of resourceDisplays) {
        const inputs = this.resourceMetricInputs[field];
        const enabled = this.get(id).checked;
        const selected = inputs.filter((input) => input.checked).length;
        const atLimit = selected >= MAX_RESOURCE_METRICS;
        const isGraph = field === 'graphMetrics';
        if (isGraph) {
          const count = `${selected}/${MAX_RESOURCE_METRICS}`;
          if (graphCount.textContent !== count) graphCount.textContent = count;
        }
        for (const input of inputs) {
          input.disabled = !enabled || (!isGraph && atLimit && !input.checked);
          if (isGraph) {
            if (enabled && atLimit && !input.checked) input.setAttribute('aria-disabled', 'true');
            else input.removeAttribute('aria-disabled');
          }
        }
      }
    };
    for (const { id, field } of resourceDisplays) {
      for (const input of [this.get(id), ...this.resourceMetricInputs[field]])
        input.addEventListener('input', this.memoryControls);
    }
    this.replyVisibilityControls = () => {
      this.get('reply-auto-hide-seconds').disabled = !this.get('reply-auto-hide').checked;
    };
    this.get('reply-auto-hide').addEventListener('change', this.replyVisibilityControls);
    this.windowLayoutControls = () => {
      this.get('horizontal-monitor-position').disabled =
        this.get('companion-window-layout').value !== 'horizontal';
    };
    this.get('companion-window-layout').addEventListener('change', this.windowLayoutControls);
    this.motionControls = () => {
      const enabled = this.get('companion-float-enabled').checked;
      this.get('companion-float-amplitude').disabled = !enabled;
      this.get('companion-float-period').disabled = !enabled;
      this.get('companion-float-amplitude-value').textContent =
        this.get('companion-float-amplitude').value + ' px';
      this.get('companion-float-period-value').textContent =
        this.get('companion-float-period').value + ' s';
      const preview = this.get('motion-preview');
      preview.dataset.enabled = String(enabled);
      preview.style.setProperty(
        '--preview-travel',
        Number(this.get('companion-float-amplitude').value) / 2 + 'px',
      );
      preview.style.setProperty('--preview-cycle', this.get('companion-float-period').value + 's');
    };
    for (const id of [
      'companion-float-enabled',
      'companion-float-amplitude',
      'companion-float-period',
    ])
      this.get(id).addEventListener('input', this.motionControls);
    this.get('glitch-preview').onclick = () =>
      api
        .glitchPreview({
          glitchEnabled: this.get('companion-glitch-enabled').checked,
          glitchStrength: Number(this.get('companion-glitch-strength').value),
          glitchIntervalSeconds: Number(this.get('companion-glitch-interval').value),
          glitchEvents: this.get('companion-glitch-events').checked,
        })
        .catch((error) => onError(error.message));
    const glitchControls = () => {
      const enabled = this.get('companion-glitch-enabled').checked;
      for (const id of [
        'companion-glitch-strength',
        'companion-glitch-interval',
        'companion-glitch-events',
        'glitch-preview',
      ])
        this.get(id).disabled = !enabled;
    };
    this.get('companion-glitch-enabled').addEventListener('change', glitchControls);
    this.glitchControls = glitchControls;
    this.get('companion-models').onclick = () =>
      window.dispatchEvent(new CustomEvent('capri-open-models'));
    this.get('companion-updates').onclick = () =>
      window.dispatchEvent(new CustomEvent('capri-open-updates'));
    this.glitchLabels = () => {
      this.get('companion-glitch-strength-value').textContent =
        this.get('companion-glitch-strength').value + '%';
      this.get('companion-glitch-interval-value').textContent = this.ui.text('{seconds} s', {
        seconds: this.get('companion-glitch-interval').value,
      });
    };
    for (const id of ['companion-glitch-strength', 'companion-glitch-interval'])
      this.get(id).oninput = this.glitchLabels;
    const teleportCanvas = this.get('teleport-preview');
    let teleportPreviewFrame = 0;
    let previewSprite;
    let previewStamps, previewPalette;
    this.previewTeleport = (animate = false) => {
      cancelAnimationFrame(teleportPreviewFrame);
      const { clientWidth: width, clientHeight: height } = teleportCanvas;
      if (!width || !height || document.hidden) return;
      const context = teleportCanvas.getContext('2d');
      if (!context) return;
      const ratio = Math.min(devicePixelRatio, 2);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (teleportCanvas.width !== pixelWidth) teleportCanvas.width = pixelWidth;
      if (teleportCanvas.height !== pixelHeight) teleportCanvas.height = pixelHeight;
      context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);

      const start = { x: width * 0.14, y: height * 0.62 };
      const end = { x: width * 0.86, y: height * 0.38 };
      const from = { ...start, focus: start };
      const to = { ...end, focus: end };
      const scale = Math.min(width * 0.19, height * 0.48, 72);
      const effects = this.teleportDraft();
      const reducedFlash = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (effects.teleportStyle === 'sandevistan') {
        if (!previewSprite) {
          previewSprite = new Image();
          previewSprite.onload = () => this.previewTeleport(animate);
          previewSprite.src = '/sprite.png';
        }
        context.clearRect(0, 0, width, height);
        if (!previewSprite.naturalWidth) return;
        const motion = prepareSandevistan({
          from: start,
          to: end,
          scale: Math.min(width * 0.25, height * 0.62, 90),
          anchor: { x: 0.5, y: 0.5 },
          effects: {
            ...effects,
            teleportReducedFlash: reducedFlash || effects.teleportReducedFlash,
          },
        });
        const palette = [motion.tint, ...motion.ghosts.map(({ hue }) => hue)].join(',');
        if (palette !== previewPalette) {
          previewStamps = sandevistanStamps(previewSprite, motion);
          previewPalette = palette;
        }
        const paint = (elapsed) => {
          context.clearRect(0, 0, width, height);
          drawSandevistan(context, motion, elapsed, previewStamps, previewSprite);
        };
        paint(animate && !reducedFlash ? 0 : SANDEVISTAN_TRAVEL_MS * 0.96);
        if (animate && !reducedFlash) {
          const started = performance.now();
          const step = (now) => {
            if (document.hidden || !teleportCanvas.clientWidth) return;
            const elapsed = now - started;
            paint(elapsed);
            if (elapsed < motion.endMs) teleportPreviewFrame = requestAnimationFrame(step);
          };
          teleportPreviewFrame = requestAnimationFrame(step);
        }
        return;
      }
      const options = {
        from,
        to,
        scale,
        seed: 14761,
        bounds: { width, height },
        effects,
        reducedFlash,
      };
      const motion = prepareTeleportMotion(options);
      const poster = arrivalStart - 0.25;
      const paint = (frame) => {
        context.clearRect(0, 0, width, height);
        drawTeleport(context, { ...options, frame, motion, materialize: false, drawCapri() {} });
      };
      if (!animate || reducedFlash) {
        paint(poster);
        return;
      }
      const startedAt = performance.now();
      const step = (now) => {
        if (document.hidden || !teleportCanvas.clientWidth) return;
        const frame = transitStart + ((now - startedAt) / 1000) * teleportFps;
        if (frame >= boltOnlyFrames) {
          paint(poster);
          return;
        }
        paint(frame);
        teleportPreviewFrame = requestAnimationFrame(step);
      };
      teleportPreviewFrame = requestAnimationFrame(step);
    };
    new ResizeObserver(() => this.previewTeleport()).observe(teleportCanvas);
    this.get('teleport-preview-play').onclick = () => this.previewTeleport(true);
    this.get('teleport-style').onchange = () => {
      this.showTeleportStyle();
      this.previewTeleport(true);
    };
    for (const { id } of allTeleportSliders)
      this.get(id).oninput = () => {
        this.showTeleportLevel(id);
        this.previewTeleport();
      };
    for (const id of ['teleport-color', 'teleport-reduced-flash'])
      this.get(id).oninput = () => this.previewTeleport();
    const action = (id, work) => {
      this.get(id).onclick = async (event) => {
        event.currentTarget.disabled = true;
        this.get('companion-result').textContent = '';
        try {
          await work();
        } catch (error) {
          onError(error.message);
        } finally {
          event.target.disabled = false;
        }
      };
    };
    this.panel.querySelectorAll('[data-community]').forEach((button) => {
      button.onclick = () =>
        api.communityLink(button.dataset.community).catch((error) => onError(error.message));
    });
    this.get('support-donation-open').onclick = async ({ currentTarget: button }) => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        if ((await api.openDonation()) === false) onError('Could not open the donation window.');
      } catch {
        onError('Could not open the donation window.');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    };
    this.readSettings = () => ({
      windowLayout: this.get('companion-window-layout').value,
      horizontalMonitorPosition: this.get('horizontal-monitor-position').value,
      restoreFromTrayOnWake: this.get('wake-restore-from-tray').checked,
      wakeSound: this.get('wake-sound').value,
      wakePhrase: this.get('wake-phrase').value,
      wakeVolume: Number(this.get('wake-volume').value),
      followUp: this.get('companion-follow-up').value !== 'off',
      followUpAfterAnyReply: this.get('companion-follow-up').value === 'replies',
      conversationMode: this.get('companion-conversation-mode').checked,
      followUpSeconds: Number(this.get('companion-follow-up-seconds').value),
      wildCloseAiTabs: this.get('wild-close-ai-tabs').checked,
      wildDesktopPranks: this.get('wild-desktop-pranks').checked,
      wakeOnReminder: this.get('companion-reminder-wake').checked,
      expandOnReply: this.get('companion-expand-reply').checked,
      replyAnimation: this.get('reply-animation').checked,
      replyAutoHide: this.get('reply-auto-hide').checked,
      minimizedChip: this.get('minimized-chip').checked,
      detachedStyle: this.get('detached-style').value,
      replyAutoHideSeconds: Number(this.get('reply-auto-hide-seconds').value),
      floatEnabled: this.get('companion-float-enabled').checked,
      floatAmplitude: Number(this.get('companion-float-amplitude').value),
      floatPeriodSeconds: Number(this.get('companion-float-period').value),
      memoryMonitor: this.get('memory-monitor').checked,
      processGraphs: this.get('process-graphs').checked,
      memoryStyle: this.get('memory-style').value,
      memoryIntervalSeconds: Number(this.get('memory-interval').value),
      ...this.resourceSelections(),
      glitchEnabled: this.get('companion-glitch-enabled').checked,
      glitchStrength: Number(this.get('companion-glitch-strength').value),
      glitchIntervalSeconds: Number(this.get('companion-glitch-interval').value),
      glitchEvents: this.get('companion-glitch-events').checked,
      ...this.teleportDraft(),
      teleportSound: this.get('teleport-sound').value,
      avatarDragTether: this.get('avatar-drag-tether').checked,
      avatarDragTetherColor: this.get('avatar-drag-tether-color').value,
      avatarRoaming: this.get('avatar-roaming').checked,
      avatarRoamCursorPranks: this.get('avatar-roam-cursor-pranks').checked,
      avatarRoamMonitors: this.get('avatar-roam-monitors').value,
      avatarRoamIntervalSeconds: this.get('avatar-roam-interval').valueAsNumber,
      ...Object.fromEntries(
        dragLightningSliders.map(({ id, key }) => [key, this.get(id).valueAsNumber]),
      ),
      avatarSnapRadius: this.get('avatar-snap-radius').valueAsNumber,
      avatarTapGapSeconds: this.get('avatar-tap-gap').valueAsNumber,
      interfaceTheme: this.themeDraft(),
    });
    this.save = async (prepareWake = true) => {
      const settings = await api.setCompanionSettings(this.readSettings());
      this.show(settings);
      onChange(settings);
      if (prepareWake && settings.wakeSound === 'voice') {
        this.result('Preparing wake voice...');
        await api.prepareWakeVoice();
        this.result('Voice response is ready.');
        return;
      }
      this.result('Settings saved.');
    };
    action('companion-save', this.save);
    action('wake-import', async () => {
      const imported = await api.importWakeAudio();
      if (imported) {
        this.value = { ...this.value, customAudio: imported.customAudio };
        this.wakeResponseControls();
        this.result('Audio imported. Select My audio file and apply settings.');
      }
    });
    action('wake-prepare', async () => {
      if (deferDrafts) await this.beforePreview?.();
      else await this.save(false);
      await api.prepareWakeVoice();
      if (!deferDrafts) onChange(this.value);
      this.result('Voice response is ready.');
    });
    action('personality-save', async () => {
      await this.savePersonality();
      this.result('Personality saved.');
    });
    action('wild-pranks-preview', async () => {
      if (!(await api.previewWildPrank())) this.result('Prank preview is unavailable right now.');
    });
    this.saveCommunicationStyle = async () => {
      const control = this.get('communication-style');
      control.disabled = true;
      try {
        this.communicationStyle = await api.setCommunicationStyle(control.value);
        this.result('Communication style saved.');
        return true;
      } catch (error) {
        if (!deferDrafts) control.value = this.communicationStyle ?? 'neutral';
        onError(error.message);
        return false;
      } finally {
        control.disabled = false;
      }
    };
    if (!deferDrafts) this.get('communication-style').onchange = this.saveCommunicationStyle;
    action('personality-open', async () => {
      await api.openPersonalityFile();
      if (!this.personalityDirty()) await this.loadPersonality();
    });
    action('personality-reset', async () => {
      if (
        (await confirm.ask({
          title: 'Restore original character?',
          detail: 'Your custom personality will be replaced by the original character.',
          confirmLabel: 'Restore original character',
          danger: true,
        })) !== 'confirm'
      )
        return;
      await api.savePersonality('');
      await this.loadPersonality();
      this.result('Original character restored.');
    });
    action('context-clear', () => api.resetContext());
    action('memory-clear', async () => {
      if (await api.resetMemory()) {
        this.result('Long-term memory cleared.');
        await this.savedMemory.load();
      }
    });
    const reportFields = () => ({
      category: this.get('bug-category').value,
      title: this.get('bug-title').value,
      description: this.get('bug-description').value,
      steps: this.get('bug-steps').value,
      expected: this.get('bug-expected').value,
      actual: this.get('bug-actual').value,
      includeLogs: this.get('bug-logs').checked,
    });
    action('bug-send', async () => {
      this.result('Sending report…');
      try {
        const value = await api.sendBugReport(reportFields());
        this.result('Report sent.');
        this.get('companion-result').append(' · ' + value.reportId);
      } catch (error) {
        this.result('');
        throw error;
      }
    });
    action('bug-save', async () => {
      this.result('Collecting diagnostics…');
      if (await api.bugReport(reportFields()))
        this.result('Report saved. Review it before sharing.');
      else this.result('');
    });
    window.addEventListener('focus', () => {
      if (
        !this.panel.hidden &&
        this.tab === 'settings' &&
        !this.personalityDirty() &&
        this.get('communication-style').value === this.communicationStyle
      )
        this.loadPersonality().catch((error) => onError(error.message));
    });
  }
  result(text) {
    this.get('companion-result').textContent = this.ui.text(text);
  }
  showTeleportLevel(id) {
    const unit = allTeleportSliders.find((item) => item.id === id)?.unit ?? '%';
    this.get(id + '-value').textContent = this.get(id).value + unit;
  }
  showTeleportStyle() {
    const sandevistan = this.get('teleport-style').value === 'sandevistan';
    this.get('teleport-lightning-controls').hidden = sandevistan;
    this.get('teleport-sandevistan-controls').hidden = !sandevistan;
  }
  stopWakePreview() {
    const context = this.wakePreviewContext;
    if (!context) return;
    this.wakePreviewContext = null;
    this.wakeResponseControls();
    if (context.state !== 'closed') void context.close().catch(() => {});
  }
  async playWakePreview() {
    if (this.wakePreviewContext) {
      this.stopWakePreview();
      return;
    }
    if (this.get('wake-play').disabled) return;
    const wakeSound = this.get('wake-sound').value;
    const wakePhrase = this.get('wake-phrase').value;
    const volume = this.get('wake-volume').valueAsNumber;
    const device = this.wakeOutputDevice?.() ?? '';
    let context;
    try {
      context = createAudioOutputContext(device, { latencyHint: 'interactive' });
      this.wakePreviewContext = context;
      this.wakeResponseControls();
      await bindAudioOutput(context, device);
      if (context.state === 'suspended') await context.resume();
      if (this.wakePreviewContext !== context) return;
      const onEnd = () => {
        if (this.wakePreviewContext === context) this.stopWakePreview();
      };
      if (wakeSound === 'tone') {
        if (!playWakeChime(context, volume, onEnd)) throw new Error('Invalid wake audio');
        return;
      }
      const sample = await this.api.previewWakeAudio({ wakeSound, wakePhrase });
      if (this.wakePreviewContext !== context) return;
      if (!sample) throw new Error('Invalid wake audio');
      await playWakeSample(context, sample, volume, { onEnd });
    } catch (error) {
      if (context && this.wakePreviewContext !== context) return;
      this.stopWakePreview();
      this.onError(error.message);
    }
  }
  teleportDraft() {
    return {
      ...Object.fromEntries(
        allTeleportSliders.map(({ id, key }) => [key, this.get(id).valueAsNumber]),
      ),
      teleportStyle: this.get('teleport-style').value,
      teleportColor: this.get('teleport-color').value,
      teleportReducedFlash: this.get('teleport-reduced-flash').checked,
    };
  }
  showMonitorDisplay({ memoryMonitor, processGraphs, memoryStyle }) {
    if (memoryMonitor !== undefined) this.get('memory-monitor').checked = memoryMonitor;
    if (processGraphs !== undefined) this.get('process-graphs').checked = processGraphs;
    if (memoryStyle !== undefined) this.get('memory-style').value = memoryStyle;
    this.memoryControls();
  }
  show(value) {
    queueMicrotask(() => this.glitchControls());
    this.value = value;
    this.get('companion-window-layout').value = value.windowLayout ?? 'vertical';
    this.get('horizontal-monitor-position').value = value.horizontalMonitorPosition ?? 'between';
    this.windowLayoutControls();
    this.get('wake-restore-from-tray').checked = value.restoreFromTrayOnWake !== false;
    this.get('wake-sound').value = value.wakeSound;
    this.get('wake-phrase').value = value.wakePhrase;
    this.wakeResponseControls();
    this.get('wake-volume').value = value.wakeVolume;
    this.get('companion-follow-up').value = !value.followUp
      ? 'off'
      : value.followUpAfterAnyReply
        ? 'replies'
        : 'questions';
    this.get('companion-conversation-mode').checked = value.conversationMode === true;
    this.get('companion-follow-up-seconds').value = value.followUpSeconds;
    this.get('wild-close-ai-tabs').checked = value.wildCloseAiTabs === true;
    this.get('wild-desktop-pranks').checked = value.wildDesktopPranks === true;
    this.get('companion-reminder-wake').checked = value.wakeOnReminder !== false;
    this.get('companion-expand-reply').checked = value.expandOnReply !== false;
    this.get('reply-auto-hide').checked = value.replyAutoHide !== false;
    this.get('reply-animation').checked = value.replyAnimation === true;
    this.replyVisibilityControls();
    this.get('minimized-chip').checked = value.minimizedChip !== false;
    this.get('detached-style').value = value.detachedStyle ?? 'character';
    this.get('reply-auto-hide-seconds').value = value.replyAutoHideSeconds ?? 8;
    this.get('companion-float-enabled').checked = value.floatEnabled === true;
    this.get('companion-float-amplitude').value = value.floatAmplitude ?? 6;
    this.get('companion-float-period').value = value.floatPeriodSeconds ?? 10;
    this.motionControls();
    this.get('memory-interval').value = value.memoryIntervalSeconds ?? 3;
    for (const { field, defaults } of resourceDisplays) {
      const selection = value[field] ?? defaults;
      for (const input of this.resourceMetricInputs[field])
        input.checked = selection.includes(input.value);
    }
    this.showMonitorDisplay({
      memoryMonitor: value.memoryMonitor !== false,
      processGraphs: value.processGraphs !== false,
      memoryStyle: value.memoryStyle ?? 'rings',
    });
    this.get('companion-glitch-enabled').checked = value.glitchEnabled !== false;
    this.get('companion-glitch-strength').value = value.glitchStrength ?? 65;
    this.get('companion-glitch-interval').value = value.glitchIntervalSeconds ?? 35;
    this.get('companion-glitch-events').checked = value.glitchEvents !== false;
    this.glitchLabels();
    for (const { id, key, defaultValue } of allTeleportSliders) {
      this.get(id).value = value[key] ?? defaultValue;
      this.showTeleportLevel(id);
    }
    this.get('teleport-color').value =
      value.teleportColor ?? TELEPORT_LIGHTNING_DEFAULTS.teleportColor;
    this.get('teleport-style').value = value.teleportStyle ?? 'lightning';
    this.showTeleportStyle();
    this.get('teleport-reduced-flash').checked = value.teleportReducedFlash === true;
    this.get('teleport-sound').value = value.teleportSound ?? 'spark';
    this.previewTeleport();
    this.get('avatar-drag-tether').checked = value.avatarDragTether !== false;
    this.get('avatar-drag-tether-color').value =
      value.avatarDragTetherColor ?? DRAG_LIGHTNING_COLOR;
    this.get('avatar-roaming').checked = value.avatarRoaming === true;
    this.get('avatar-roam-cursor-pranks').checked = value.avatarRoamCursorPranks === true;
    this.get('avatar-roam-monitors').value = value.avatarRoamMonitors ?? 'current';
    this.get('avatar-roam-interval').value = value.avatarRoamIntervalSeconds ?? 120;
    this.roamingControls();
    for (const { id, key, initial } of dragLightningSliders)
      this.get(id).value = value[key] ?? initial;
    this.get('avatar-snap-radius').value = value.avatarSnapRadius ?? 36;
    this.get('avatar-tap-gap').value = value.avatarTapGapSeconds ?? 10;
    this.avatarEffectControls();
    const theme = validateInterfaceTheme(value.interfaceTheme);
    this.get('theme-preset').value = theme.preset;
    this.get('theme-background-brightness').value = theme.backgroundBrightness;
    this.get('theme-panel-linked').checked =
      theme.panelHue === null && theme.panelSaturation === null;
    const axisValues = {
      ...theme,
      panelHue: theme.panelHue ?? theme.backgroundHue,
      panelSaturation: theme.panelSaturation ?? matchingPanelSaturation(theme.backgroundSaturation),
    };
    for (const { prefix, hue, saturation } of themeAxes) {
      this.get(`${prefix}-hue`).value = axisValues[hue];
      this.get(`${prefix}-saturation`).value = axisValues[saturation];
    }
    this.previewTheme();
    this.savedSettings = this.settingsDraft();
  }
  themeDraft() {
    const theme = {
      preset: this.get('theme-preset').value,
      backgroundBrightness: this.get('theme-background-brightness').valueAsNumber,
    };
    for (const { prefix, hue, saturation } of themeAxes) {
      theme[hue] = this.get(`${prefix}-hue`).valueAsNumber;
      theme[saturation] = this.get(`${prefix}-saturation`).valueAsNumber;
    }
    if (this.get('theme-panel-linked').checked) theme.panelHue = theme.panelSaturation = null;
    return validateInterfaceTheme(theme);
  }
  resourceSelections() {
    return Object.fromEntries(
      Object.entries(this.resourceMetricInputs).map(([field, inputs]) => [
        field,
        inputs.filter(({ checked }) => checked).map(({ value }) => value),
      ]),
    );
  }
  settingsDraft() {
    return JSON.stringify(
      [
        'companion-window-layout',
        'wake-restore-from-tray',
        'wake-sound',
        'wake-phrase',
        'wake-volume',
        'companion-follow-up',
        'companion-conversation-mode',
        'companion-follow-up-seconds',
        'wild-close-ai-tabs',
        'wild-desktop-pranks',
        'companion-reminder-wake',
        'companion-expand-reply',
        'reply-animation',
        'reply-auto-hide',
        'minimized-chip',
        'detached-style',
        'reply-auto-hide-seconds',
        'companion-float-enabled',
        'companion-float-amplitude',
        'companion-float-period',
        'memory-monitor',
        'process-graphs',
        'memory-style',
        'memory-interval',
        'companion-glitch-enabled',
        'companion-glitch-strength',
        'companion-glitch-interval',
        'companion-glitch-events',
        'teleport-style',
        ...allTeleportSliders.map(({ id }) => id),
        'teleport-color',
        'teleport-reduced-flash',
        'teleport-sound',
        'avatar-drag-tether',
        'avatar-drag-tether-color',
        'avatar-roaming',
        'avatar-roam-cursor-pranks',
        'avatar-roam-monitors',
        'avatar-roam-interval',
        ...dragLightningSliders.map(({ id }) => id),
        'avatar-snap-radius',
        'avatar-tap-gap',
        'theme-preset',
        'theme-background-brightness',
        'theme-panel-linked',
        ...themeAxes.flatMap(({ prefix }) => [`${prefix}-hue`, `${prefix}-saturation`]),
      ]
        .map((id) => {
          const el = this.get(id);
          return el.type === 'checkbox' ? el.checked : el.value;
        })
        .concat(this.resourceSelections()),
    );
  }
  personalityDirty() {
    return (
      this.savedPersonality !== undefined &&
      this.get('personality-text').value !== this.savedPersonality
    );
  }
  async beforeClose() {
    if (
      this.tab !== 'settings' ||
      (!this.personalityDirty() && this.settingsDraft() === this.savedSettings)
    )
      return true;
    const choice = await this.confirm.ask({
      title: 'Unsaved changes',
      detail: 'Save your changes before leaving?',
      choices: [
        { id: 'cancel', label: 'Stay here' },
        { id: 'discard', label: 'Discard changes', danger: true },
        { id: 'save', label: 'Save and leave' },
      ],
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      try {
        await this.save();
        if (this.personalityDirty()) {
          await this.savePersonality();
        }
      } catch (error) {
        this.onError(error.message);
        return false;
      }
    } else {
      this.show(this.value);
      this.get('personality-text').value = this.savedPersonality ?? '';
    }
    return true;
  }
  async loadPersonality() {
    const value = await this.api.getPersonality();
    this.communicationStyle = value.communicationStyle ?? 'neutral';
    this.get('communication-style').value = this.communicationStyle;
    this.get('personality-text').value = value.text;
    this.savedPersonality = this.get('personality-text').value;
    this.get('personality-text').placeholder = '';
  }
  async savePersonality() {
    const text = await this.api.savePersonality(this.get('personality-text').value);
    this.get('personality-text').value = text;
    this.savedPersonality = text;
  }
  showSupportFrame(visible) {
    if (visible && !this.supportFrame) {
      const frame = this.get('support-frame');
      const color = getComputedStyle(frame).getPropertyValue('--support-heart-color').trim();
      const section = frame.closest('.support-content');
      this.supportFrame = new ChessFrameEffect(frame, {
        color,
        inset: -4,
        speed: 0.4,
        scrollport: frame.closest('#companion'),
        // The section gutter and part of the panel padding are available for the effect.
        getOutsetLimit: () =>
          Math.floor(Number.parseFloat(getComputedStyle(section).paddingInlineStart)) + 8,
      });
    }
    this.supportFrame?.setVisible(visible);
  }
  async open(open, tab = 'settings') {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    this.showSupportFrame(open && tab === 'support');
    if (!open || tab !== 'settings') {
      this.stopWakePreview();
      this.savedMemory.close();
    }
    this.get('companion-result').textContent = '';
    this.get('companion-result').hidden = tab === 'support';
    if (!open) return;
    this.tab = tab;
    this.panel.dataset.tab = tab;
    this.panel.querySelectorAll('[data-companion-tab]').forEach((section) => {
      section.hidden = section.dataset.companionTab !== tab;
    });
    this.get('companion-panel-title').textContent = this.ui.text(
      tab === 'support'
        ? 'Support the author'
        : tab === 'bug'
          ? 'Report a bug'
          : 'Companion settings',
    );
    this.ui.apply(this.ui.language);
    if (tab === 'settings' && !this.deferDrafts) {
      try {
        await this.loadPersonality();
      } catch (error) {
        this.onError(error.message);
      }
    }
  }
}
