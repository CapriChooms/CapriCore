// SPDX-License-Identifier: GPL-3.0-only
import { applyInterfaceTheme, validateInterfaceTheme } from './interface-theme.mjs';
import { SavedMemoryPanel } from './saved-memory-panel.mjs';
const themeAxes = [
  { prefix: 'theme', label: 'Accent color', hue: 'hue', saturation: 'saturation', min: 35 },
  {
    prefix: 'theme-background',
    label: 'Background color',
    hue: 'backgroundHue',
    saturation: 'backgroundSaturation',
    min: 0,
  },
];
const teleportSliders = [
  { id: 'teleport-intensity', key: 'teleportIntensity', label: 'Teleport intensity', initial: 75 },
  {
    id: 'teleport-jaggedness',
    key: 'teleportJaggedness',
    label: 'Lightning jaggedness',
    initial: 78,
  },
  { id: 'teleport-branches', key: 'teleportBranches', label: 'Lightning branches', initial: 75 },
];
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
  constructor({ api, ui, onOpen, onError, onChange, confirm, deferDrafts = false }) {
    Object.assign(this, { api, ui, onOpen, onError, onChange, confirm, deferDrafts });
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
        <section data-companion-tab="support" class="support-content">
          <div class="support-art" aria-hidden="true"><div class="support-orbit"></div><div class="support-heart">♥</div><i></i><i></i><i></i><i></i><span>CAPRI / COMMUNITY LINK</span></div>
          <h3>Help Capri grow</h3><p class="support-developer"><span>Developed by</span> <strong data-untranslated>Overyx</strong></p><p>Capri is free. If she makes your day a little brighter, you can support her development. Every contribution means a lot. Thank you for being here.</p>
          <div class="settings-actions support-links">
            <div class="support-donations" dir="ltr">
              <button type="button" data-community="boosty" class="brand-boosty" data-untranslated><span class="brand-icon" aria-hidden="true"></span><span>Boosty</span></button>
              <button type="button" data-community="lava" class="brand-lava" data-untranslated><span class="brand-icon" aria-hidden="true"></span><span>Lava.top</span></button>
            </div>
            <div class="support-social">
              <button type="button" data-community="discord" class="brand-discord" data-untranslated><span class="brand-icon" aria-hidden="true"></span><span>Discord</span></button>
              <button type="button" data-community="tiktok" class="brand-tiktok" data-untranslated><span class="brand-icon brand-video" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="3" width="12" height="18" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg></span><span>TikTok</span></button>
              <button type="button" data-community="youtube" class="brand-youtube" data-untranslated><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 8.5 16 12l-6 3.5z" fill="currentColor"/></svg></span><span>YouTube</span></button>
              <button type="button" data-community="github" class="brand-github" data-untranslated><span class="brand-icon" aria-hidden="true"></span><span>GitHub</span></button>
            </div>
            <div class="support-resources">
              <button type="button" data-community="website" class="brand-website" data-untranslated><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg></span><span>capri-core.com</span></button>
              <button type="button" data-community="faq" data-untranslated><span>FAQ</span></button>
              <button type="button" data-community="releases"><span>Download</span></button>
            </div>
          </div>
          <p class="settings-help">Payment methods and availability depend on Lava.top and your country.</p>
        </section>
        <section data-companion-tab="bug" hidden>
          <p>Send your description and selected diagnostics privately to the Capri maintainer. You can also save and review a ZIP on this PC.</p>
          <label for="bug-category">Problem area</label><select id="bug-category"><option value="voice">Voice</option><option value="recognition">Speech recognition</option><option value="model">Language model</option><option value="startup">Startup</option><option value="interface">Interface</option><option value="installer">Installation</option><option value="other">Other</option></select>
          <label for="bug-title">Short title</label><input id="bug-title" type="text" maxlength="160" dir="auto">
          <label for="bug-description">What went wrong?</label>
          <textarea id="bug-description" rows="6" maxlength="4000" placeholder="What went wrong?" dir="auto"></textarea>
          <label for="bug-steps">Steps to reproduce</label><textarea id="bug-steps" rows="3" maxlength="3000" dir="auto"></textarea>
          <label for="bug-expected">Expected result</label><textarea id="bug-expected" rows="2" maxlength="1500" dir="auto"></textarea>
          <label for="bug-actual">Actual result</label><textarea id="bug-actual" rows="2" maxlength="1500" dir="auto"></textarea>
          <label><input type="checkbox" id="bug-logs" checked> <span>Include recent diagnostic logs</span></label>
          <p class="settings-help">Chat-history files, memory, recordings and screenshots are excluded. Known secrets and common personal paths are redacted. Review logs before sharing.</p>
          <div class="settings-actions"><button type="button" id="bug-send">Send report</button><button type="button" id="bug-save">Save report</button><button type="button" data-community="issues">Open GitHub issues</button></div>
        </section>
        <section data-companion-tab="settings" hidden>
          <h3>Qwen model</h3><div class="settings-actions"><button type="button" id="companion-models">Choose Qwen model</button></div>
          <h3>Updates</h3><div class="settings-actions"><button type="button" id="companion-updates">Check for updates</button></div>
          <h3>Interface theme</h3>
          <label class="theme-palette-label" for="theme-preset">Color palette <span class="theme-palette-swatches" aria-hidden="true"><i></i><i></i></span></label>
          <select id="theme-preset"><option value="capri" data-untranslated>Capri</option><option value="blackwall" data-untranslated>Blackwall</option><option value="amethyst">Amethyst</option><option value="overdrive">Overdrive</option><option value="custom">Custom</option></select>
          <div id="theme-custom" class="theme-custom" hidden>
            ${themeAxes
              .map(
                ({ prefix, label, min }) => `
              <fieldset class="theme-color" data-theme-axis="${prefix}">
                <legend>${label}</legend>
                <div class="theme-color-controls">
                  <div id="${prefix}-wheel" class="theme-wheel" aria-hidden="true"><i></i></div>
                  <div class="theme-sliders">
                    <label for="${prefix}-hue">Hue <output id="${prefix}-hue-output"></output></label>
                    <input id="${prefix}-hue" type="range" min="0" max="359" value="174">
                    <label for="${prefix}-saturation">Saturation <output id="${prefix}-saturation-output"></output></label>
                    <input id="${prefix}-saturation" type="range" min="${min}" max="100" value="${min ? 84 : 40}">
                  </div>
                </div>
              </fieldset>`,
              )
              .join('')}
          </div>
          <p class="settings-help">Choose a palette or set the accent and background colors separately.</p>
          <h3>Button press feedback</h3><label><input type="checkbox" id="companion-button-feedback">Briefly highlight a pressed button</label>
          <p class="settings-help">Shows that a click was received, not that an operation succeeded. This does not change visual glitches, sounds or response speed.</p>
          <div class="settings-actions"><button type="button" id="feedback-preview" data-feedback-setting="companion-button-feedback">Try button feedback</button></div>
          <h3>System resource usage</h3>
          <label><input type="checkbox" id="memory-monitor">Show RAM and VRAM usage</label>
          <p class="settings-help">System-wide RAM and VRAM usage. The busiest GPU is shown. Missing driver data is unavailable.</p>
          <label for="memory-style">Chart style</label><select id="memory-style"><option value="rings">Circles</option><option value="bars">Bars</option></select>
          <label><input type="checkbox" id="process-graphs">Show system resource graphs</label>
          <p class="settings-help" data-untranslated>CPU · GPU · RAM · VRAM</p>
          <label for="memory-interval">Refresh interval</label><select id="memory-interval"><option value="3">3 s</option><option value="5">5 s</option><option value="10">10 s</option></select>
          <h3>Portrait</h3><label for="settings-portrait-zoom">Portrait zoom <output id="settings-portrait-zoom-value"></output></label><input id="settings-portrait-zoom" type="range" min="60" max="300" step="1" value="115">
          <label><input id="companion-expand-reply" type="checkbox">Expand Capri when replying</label>
          <p class="settings-help">When off, voice activation and replies keep the compact view. Click the signal to expand; open history to read replies.</p>
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
          <h3 id="companion-motion-heading">Window motion</h3>
          <div class="motion-preview" id="motion-preview" aria-hidden="true" data-untranslated><i></i><span>CAPRI<span>◇</span></span><i></i></div>
          <label><input id="companion-float-enabled" type="checkbox">Enable floating motion</label>
          <label for="companion-float-amplitude">Motion amplitude <output id="companion-float-amplitude-value" data-untranslated></output></label><input id="companion-float-amplitude" type="range" min="0" max="24" step="1">
          <label for="companion-float-period">Motion cycle <output id="companion-float-period-value" data-untranslated></output></label><input id="companion-float-period" type="range" min="4" max="30" step="1">
          <p class="settings-help">Longer cycles move more slowly. Motion pauses during interaction and stays inside the window. Reduced motion turns it off.</p>
          <h3>Visual glitch</h3>
          <label><input type="checkbox" id="companion-glitch-enabled">Enable visual glitches</label>
          <label for="companion-glitch-strength">Glitch intensity <output id="companion-glitch-strength-value"></output></label>
          <input id="companion-glitch-strength" type="range" min="0" max="100" step="1" value="65">
          <label for="companion-glitch-interval">Ambient glitch interval <output id="companion-glitch-interval-value"></output></label>
          <input id="companion-glitch-interval" type="range" min="10" max="120" step="1" value="35">
          <label><input type="checkbox" id="companion-glitch-events">Glitch on speech and pose changes</label>
          <p class="settings-help">Visual glitches briefly split the colours of Capri and her interface borders together. Ambient bursts happen while she is visible; speech and pose changes can trigger stronger bursts. Events are spaced at least six seconds apart. Ordinary clicks do not trigger them. Zero intensity is visually off.</p>
          <p class="settings-help" id="glitch-motion-help">Reduced motion disables moving glitches. CRT scanlines and button press feedback are separate effects.</p>
          <div class="settings-actions"><button type="button" id="glitch-preview">Preview glitch</button></div>
          <h3>Desktop roaming</h3>
          <label><input id="avatar-roaming" type="checkbox">Let Capri move around on her own</label>
          <label class="drag-lightning-control" for="avatar-roam-interval">Time between moves <output id="avatar-roam-interval-value" data-untranslated></output></label>
          <input id="avatar-roam-interval" type="range" min="30" max="1800" step="30" value="120">
          <p class="settings-help">Random movement needs no screen access. Pauses while you talk, type or interact with Capri.</p>
          <h3>Teleport effects</h3>
          ${teleportSliders
            .map(
              ({ id, label, initial }) => `
          <label for="${id}">${label} <output id="${id}-value"></output></label>
          <input id="${id}" type="range" min="0" max="100" step="1" value="${initial}">`,
            )
            .join('')}
          <label><input id="teleport-reduced-flash" type="checkbox">Reduce teleport flashes</label>
          <label for="teleport-sound">Teleport sound</label><select id="teleport-sound"><option value="off">Off</option><option value="spark">Spark</option><option value="thunder">Thunder</option><option value="pulse">Pulse</option></select>
          <h3>Drag lightning</h3>
          <label><input id="avatar-drag-tether" type="checkbox">Show drag lightning on the desktop</label>
          ${dragLightningSliders
            .map(
              ({ id, label, initial, max }) => `
            <label class="drag-lightning-control" for="${id}">${label} <output id="${id}-value" data-untranslated></output></label><input id="${id}" type="range" min="0" max="${max}" value="${initial}">`,
            )
            .join('')}
          <p class="settings-help">Intensity adds sparks and branches. Chaos spreads them out. The dead zone is measured in Windows logical pixels.</p>
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
          <h3>Avatar click reactions</h3>
          <label for="avatar-tap-gap">Maximum time between taps (seconds)</label><input id="avatar-tap-gap" type="number" min="1" max="15" value="10" required>
          <p class="settings-help">Ten taps on the same part can trigger a spoken reaction.</p>
          <h3>Wake acknowledgement</h3>
          <label><input type="checkbox" id="wake-restore-from-tray">Restore Capri from the tray on voice activation</label>
          <label for="wake-sound">Sound after Capri hears her name</label>
          <select id="wake-sound"><option value="tone">Signal tone</option><option value="file">My audio file</option><option value="voice">Capri's voice</option><option value="off">Silent</option></select>
          <label id="wake-phrase-label" for="wake-phrase" hidden>Voice response</label><select id="wake-phrase" hidden disabled><option value="Listening.">Listening.</option><option value="Yes, choom.">Yes, choom.</option><option value="Mhm?">Mhm?</option></select>
          <label for="wake-volume">Acknowledgement volume</label><input id="wake-volume" type="range" min="0" max="1" step="0.05" value="0.7">
          <div class="settings-actions"><button type="button" id="wake-import">Choose audio file</button><button type="button" id="wake-prepare" hidden disabled>Prepare voice response</button></div>
          <p class="settings-help">Use a short sound, up to 10 seconds. Voice responses are prepared once and played instantly. The signal tone is used while audio is unavailable.</p>
          <h3>Conversation</h3>
          <label for="communication-style">Communication style</label>
          <select id="communication-style"><option value="neutral">Neutral</option><option value="romantic">Romantic</option><option value="business">Business</option><option value="wild">Wild</option></select>
          <p class="settings-help">This style shapes Capri's next reply. Your Personality file remains editable.</p>
          <label><input type="checkbox" id="companion-follow-up">Let Capri keep listening when she asks a question</label>
          <label for="companion-follow-up-seconds">Follow-up listening time (seconds)</label><input id="companion-follow-up-seconds" type="number" min="5" max="30" value="12">
          <p class="settings-help">After a voice request, a question from Capri opens Listening after she finishes speaking. Text requests never open Listening. The microphone must already be enabled.</p>
          <div class="settings-actions"><button type="button" id="companion-save">Apply settings</button></div>
          <h3 id="personality-heading">Personality</h3>
          <p class="settings-help">Customize Capri's character and fictional role-play preferences. Application permissions still apply. Leave empty to restore the original character. Changes apply to the next reply; existing conversation context remains.</p>
          <textarea id="personality-text" rows="9" maxlength="24000" dir="auto" spellcheck="false" aria-labelledby="personality-heading" data-untranslated></textarea>
          <div class="settings-actions"><button type="button" id="personality-save">Save personality</button><button type="button" id="personality-open">Show Personality file</button><button type="button" id="personality-reset">Restore original character</button></div>
          <p class="settings-help">Edit PERSONALITY.md in your preferred editor. Saved file changes apply to the next reply.</p>
          <h3>Reminders</h3><label><input id="companion-reminder-wake" type="checkbox">Wake Capri and prepare her voice for reminders</label><p class="settings-help">Works while Capri is running. Does not wake Windows or turn on the microphone. Muted or text-only voices stay silent.</p>
          <h3>Memory controls</h3><p class="settings-help">Conversation context and long-term memory are separate. Capri will ask you to confirm before clearing either.</p>
          <div class="settings-actions"><button type="button" id="memory-view">View saved memories</button></div>
          <div id="saved-memory-view" class="saved-memory-view" hidden></div>
          <div class="settings-actions"><button type="button" id="context-clear">Clear conversation</button><button type="button" id="memory-clear" class="danger-action">Clear long-term memory</button></div>
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
      for (const { prefix, hue, saturation } of themeAxes) {
        this.get(`${prefix}-wheel`).style.setProperty('--selected-hue', `${theme[hue]}deg`);
        this.get(`${prefix}-hue-output`).textContent = `${theme[hue]}°`;
        this.get(`${prefix}-saturation-output`).textContent = `${theme[saturation]}%`;
      }
      applyInterfaceTheme(theme);
    };
    this.previewTheme = previewTheme;
    this.get('theme-preset').addEventListener('input', previewTheme);
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
        if (event.button !== 0) return;
        wheel.setPointerCapture(event.pointerId);
        turnWheel(event);
      });
      wheel.addEventListener('pointermove', (event) => {
        if (wheel.hasPointerCapture(event.pointerId)) turnWheel(event);
      });
    }
    this.avatarEffectControls = () => {
      for (const { id, unit } of dragLightningSliders) {
        const control = this.get(id);
        control.disabled = !this.get('avatar-drag-tether').checked;
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
      const voice = this.get('wake-sound').value === 'voice';
      this.get('wake-phrase-label').hidden = !voice;
      this.get('wake-phrase').hidden = !voice;
      this.get('wake-phrase').disabled = !voice;
      this.get('wake-prepare').hidden = !voice;
      this.get('wake-prepare').disabled = !voice;
    };
    this.get('wake-sound').addEventListener('change', this.wakeResponseControls);
    this.roamingControls = () => {
      const control = this.get('avatar-roam-interval');
      control.disabled = !this.get('avatar-roaming').checked;
      const seconds = control.valueAsNumber;
      this.get('avatar-roam-interval-value').textContent =
        seconds < 60
          ? `${seconds} s`
          : `${Math.floor(seconds / 60)} min${seconds % 60 ? ' 30 s' : ''}`;
    };
    for (const id of ['avatar-roaming', 'avatar-roam-interval'])
      this.get(id).addEventListener('input', this.roamingControls);
    this.memoryControls = () => {
      this.get('memory-style').disabled = !this.get('memory-monitor').checked;
      this.get('memory-interval').disabled =
        !this.get('memory-monitor').checked && !this.get('process-graphs').checked;
    };
    this.get('memory-monitor').addEventListener('change', this.memoryControls);
    this.get('process-graphs').addEventListener('change', this.memoryControls);
    this.replyVisibilityControls = () => {
      this.get('reply-auto-hide-seconds').disabled = !this.get('reply-auto-hide').checked;
    };
    this.get('reply-auto-hide').addEventListener('change', this.replyVisibilityControls);
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
    for (const { id } of teleportSliders) this.get(id).oninput = () => this.showTeleportLevel(id);
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
    this.readSettings = () => ({
      restoreFromTrayOnWake: this.get('wake-restore-from-tray').checked,
      wakeSound: this.get('wake-sound').value,
      wakePhrase: this.get('wake-phrase').value,
      wakeVolume: Number(this.get('wake-volume').value),
      followUp: this.get('companion-follow-up').checked,
      followUpSeconds: Number(this.get('companion-follow-up-seconds').value),
      buttonFeedback: this.get('companion-button-feedback').checked,
      wakeOnReminder: this.get('companion-reminder-wake').checked,
      expandOnReply: this.get('companion-expand-reply').checked,
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
      glitchEnabled: this.get('companion-glitch-enabled').checked,
      glitchStrength: Number(this.get('companion-glitch-strength').value),
      glitchIntervalSeconds: Number(this.get('companion-glitch-interval').value),
      glitchEvents: this.get('companion-glitch-events').checked,
      ...Object.fromEntries(
        teleportSliders.map(({ id, key }) => [key, this.get(id).valueAsNumber]),
      ),
      teleportReducedFlash: this.get('teleport-reduced-flash').checked,
      teleportSound: this.get('teleport-sound').value,
      avatarDragTether: this.get('avatar-drag-tether').checked,
      avatarRoaming: this.get('avatar-roaming').checked,
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
      if (await api.importWakeAudio())
        this.result('Audio imported. Select My audio file and apply settings.');
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
    this.get(id + '-value').textContent = this.get(id).value + '%';
  }
  show(value) {
    queueMicrotask(() => this.glitchControls());
    this.value = value;
    this.get('wake-restore-from-tray').checked = value.restoreFromTrayOnWake !== false;
    this.get('wake-sound').value = value.wakeSound;
    this.get('wake-phrase').value = value.wakePhrase;
    this.wakeResponseControls();
    this.get('wake-volume').value = value.wakeVolume;
    this.get('companion-follow-up').checked = value.followUp;
    this.get('companion-follow-up-seconds').value = value.followUpSeconds;
    this.get('companion-button-feedback').checked = value.buttonFeedback !== false;
    this.get('companion-reminder-wake').checked = value.wakeOnReminder !== false;
    this.get('companion-expand-reply').checked = value.expandOnReply !== false;
    this.get('reply-auto-hide').checked = value.replyAutoHide !== false;
    this.replyVisibilityControls();
    this.get('minimized-chip').checked = value.minimizedChip !== false;
    this.get('detached-style').value = value.detachedStyle ?? 'character';
    this.get('reply-auto-hide-seconds').value = value.replyAutoHideSeconds ?? 8;
    this.get('companion-float-enabled').checked = value.floatEnabled === true;
    this.get('companion-float-amplitude').value = value.floatAmplitude ?? 6;
    this.get('companion-float-period').value = value.floatPeriodSeconds ?? 10;
    this.motionControls();
    this.get('memory-monitor').checked = value.memoryMonitor !== false;
    this.get('process-graphs').checked = value.processGraphs !== false;
    this.get('memory-style').value = value.memoryStyle ?? 'rings';
    this.get('memory-interval').value = value.memoryIntervalSeconds ?? 3;
    this.memoryControls();
    this.get('companion-glitch-enabled').checked = value.glitchEnabled !== false;
    this.get('companion-glitch-strength').value = value.glitchStrength ?? 65;
    this.get('companion-glitch-interval').value = value.glitchIntervalSeconds ?? 35;
    this.get('companion-glitch-events').checked = value.glitchEvents !== false;
    this.glitchLabels();
    for (const { id, key, initial } of teleportSliders) {
      this.get(id).value = value[key] ?? initial;
      this.showTeleportLevel(id);
    }
    this.get('teleport-reduced-flash').checked = value.teleportReducedFlash === true;
    this.get('teleport-sound').value = value.teleportSound ?? 'spark';
    this.get('avatar-drag-tether').checked = value.avatarDragTether !== false;
    this.get('avatar-roaming').checked = value.avatarRoaming === true;
    this.get('avatar-roam-interval').value = value.avatarRoamIntervalSeconds ?? 120;
    this.roamingControls();
    for (const { id, key, initial } of dragLightningSliders)
      this.get(id).value = value[key] ?? initial;
    this.get('avatar-snap-radius').value = value.avatarSnapRadius ?? 36;
    this.get('avatar-tap-gap').value = value.avatarTapGapSeconds ?? 10;
    this.avatarEffectControls();
    const theme = validateInterfaceTheme(value.interfaceTheme);
    this.get('theme-preset').value = theme.preset;
    for (const { prefix, hue, saturation } of themeAxes) {
      this.get(`${prefix}-hue`).value = theme[hue];
      this.get(`${prefix}-saturation`).value = theme[saturation];
    }
    this.previewTheme();
    this.savedSettings = this.settingsDraft();
  }
  themeDraft() {
    const theme = { preset: this.get('theme-preset').value };
    for (const { prefix, hue, saturation } of themeAxes) {
      theme[hue] = this.get(`${prefix}-hue`).valueAsNumber;
      theme[saturation] = this.get(`${prefix}-saturation`).valueAsNumber;
    }
    return validateInterfaceTheme(theme);
  }
  settingsDraft() {
    return JSON.stringify(
      [
        'wake-restore-from-tray',
        'wake-sound',
        'wake-phrase',
        'wake-volume',
        'companion-follow-up',
        'companion-follow-up-seconds',
        'companion-button-feedback',
        'companion-reminder-wake',
        'companion-expand-reply',
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
        ...teleportSliders.map(({ id }) => id),
        'teleport-reduced-flash',
        'teleport-sound',
        'avatar-drag-tether',
        'avatar-roaming',
        'avatar-roam-interval',
        ...dragLightningSliders.map(({ id }) => id),
        'avatar-snap-radius',
        'avatar-tap-gap',
        'theme-preset',
        ...themeAxes.flatMap(({ prefix }) => [`${prefix}-hue`, `${prefix}-saturation`]),
      ].map((id) => {
        const el = this.get(id);
        return el.type === 'checkbox' ? el.checked : el.value;
      }),
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
  async open(open, tab = 'settings') {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (!open || tab !== 'settings') this.savedMemory.close();
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
