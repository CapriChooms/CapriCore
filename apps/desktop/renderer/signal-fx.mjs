import { SIGNAL_STATES, shardPoints, signalRandom, interfaceFloat } from './presence-model.mjs';
import { PanelFrames, panelPath } from './panel-frames.mjs';
import { CRTScreen } from './crt-screen.mjs';
import { GlitchSchedule } from './glitch-settings.mjs';
import { validateMotionSettings, floatLimits } from './motion-settings.mjs';
import { interfaceThemeColors } from './interface-theme.mjs';

/** Small transparent Canvas layer. No videos, animation textures or network. */
export class SignalFX {
  constructor({
    canvas,
    model,
    sprite,
    getSpriteImage = () => sprite,
    orb,
    frame,
    audioLevel,
    onLayout,
    onMovement,
    onFrame,
    text = (value) => value,
  }) {
    Object.assign(this, {
      canvas,
      model,
      sprite,
      getSpriteImage,
      orb,
      frame,
      audioLevel,
      onLayout,
      onMovement,
      onFrame,
      text,
    });
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.frameCanvas = document.getElementById('frame-fx');
    this.frameCtx = this.frameCanvas.getContext('2d', { alpha: true });
    this.panels = new PanelFrames();
    this.crt = new CRTScreen(
      document.getElementById('crt-screen'),
      sprite,
      () => this.onMovement?.(),
      getSpriteImage,
    );
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.running = false;
    this.lastDraw = 0;
    this.lastKey = '';
    this.imageCache = null;
    this.stateAt = -Infinity;
    this.glitches = new GlitchSchedule();
    this.floatY = 0;
    this.floatSettings = validateMotionSettings();
    this.motionLimits = { min: 0, max: 0 };
    this.lastRegion = 0;
    this.tick = this.tick.bind(this);
    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    this.onMotion = () => {
      if (this.motion.matches) this.resetFloat();
      this.lastDraw = 0;
      this.lastKey = '';
      this.start();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motion.addEventListener('change', this.onMotion);
    this.start();
  }
  start() {
    if (!this.running && !document.hidden) {
      this.running = true;
      this.raf = requestAnimationFrame(this.tick);
    }
  }
  invalidate() {
    this.dirty = true;
  }
  configure(value) {
    clearTimeout(this.previewTimer);
    const theme = value.interfaceTheme;
    this.theme = theme?.preset && theme.preset !== 'capri' ? interfaceThemeColors(theme) : null;
    this.savedGlitches = value;
    this.glitches.configure(value);
    this.floatSettings = validateMotionSettings(value);
    if (!this.floatSettings.floatEnabled || !this.floatSettings.floatAmplitude) this.resetFloat();
    this.motionMeasuredAt = -Infinity;
    this.lastDraw = 0;
    this.lastKey = '';
  }
  signalColor(state) {
    const { color } = SIGNAL_STATES[state];
    return color === SIGNAL_STATES.online.color ? (this.theme?.cyan ?? color) : color;
  }
  resetFloat() {
    this.floatY = 0;
    this.motionMeasuredAt = -Infinity;
    document.body.style.setProperty('--float-y', '0px');
    this.onMovement?.();
  }
  preview(value) {
    clearTimeout(this.previewTimer);
    if (value) this.glitches.configure(value);
    this.previewTimer = setTimeout(() => {
      if (this.savedGlitches) this.glitches.configure(this.savedGlitches);
      this.lastKey = '';
    }, 900);
    this.stateAt = performance.now();
    this.glitches.eventAt = this.stateAt;
    this.glitches.seenAt = -Infinity;
    this.lastDraw = 0;
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  destroy() {
    clearTimeout(this.previewTimer);
    this.stop();
    this.crt.destroy();
    this.panels.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motion.removeEventListener('change', this.onMotion);
  }
  images() {
    const image = this.getSpriteImage();
    if (
      this.imageCache?.src === this.sprite.src &&
      this.imageCache.image === image &&
      this.imageCache.revision === image.avatarTextureRevision
    )
      return this.imageCache;
    const make = (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 384;
      // Favor CPU rasterization for these tiny tinted thumbnails; avoid growing
      // the GPU image cache with dozens of full-resolution animation sources.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 384, 384);
      if (color) {
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 384, 384);
      }
      return canvas;
    };
    this.imageCache = {
      src: this.sprite.src,
      image,
      revision: image.avatarTextureRevision,
      normal: make(),
      cyan: make('#00ffdd'),
      red: make('#ff1769'),
      violet: make('#a668ff'),
      yellow: make('#edff43'),
    };
    return this.imageCache;
  }
  tick(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const snapshot = this.model.snapshot();
    const detached = document.body.dataset.avatarDetach !== 'attached';
    const arriving = document.body.dataset.avatarArriving === 'true';
    const intro = this.model.sleeping ? null : document.body.dataset.startupIntro;
    const introActive = intro === 'playing' || intro === 'pending';
    const key = `${snapshot.state}:${snapshot.expanded}:${snapshot.pinned}:${snapshot.burstAt}:${detached}:${arriving}:${intro}:${this.text(SIGNAL_STATES[snapshot.state].label)}`;
    const changed = key !== this.lastKey;
    if (changed) {
      if (this.expanded !== snapshot.expanded) {
        this.expanded = snapshot.expanded;
        if (snapshot.expanded) this.revealAt = arriving ? -Infinity : now;
      }
      if (this.state !== snapshot.state) {
        this.state = snapshot.state;
        if (['thinking', 'speaking', 'offline'].includes(snapshot.state)) this.stateAt = now;
      }
      this.lastKey = key;
      document.body.dataset.presence = snapshot.expanded ? 'portrait' : 'core';
      document.body.dataset.signal = snapshot.state;
      document.body.style.setProperty('--signal', this.signalColor(snapshot.state));
      for (const node of document.querySelectorAll('[data-signal-label]'))
        node.textContent = this.text(SIGNAL_STATES[snapshot.state].label);
      const button = document.getElementById('presence-toggle');
      button.setAttribute('aria-pressed', String(snapshot.expanded));
      button.title = this.text(snapshot.expanded ? 'Return Capri to signal core' : 'Show Capri');
      button.setAttribute('aria-label', button.title);
      this.onLayout();
    }
    const reduced = this.motion.matches;
    const revealAge = now - (this.revealAt ?? -Infinity);
    const reveal = this.motion.matches ? 1 : Math.min(1, Math.max(0, revealAge / 360));
    if (reveal !== this.reveal) {
      this.reveal = reveal;
      document.body.style.setProperty('--reveal', String(reveal));
    }
    // State changes still render in reduced-motion mode; idle requires no redraw.
    if (
      !changed &&
      !this.dirty &&
      ((reduced && snapshot.state !== 'speaking') ||
        now - this.lastDraw <
          1000 /
            (reduced
              ? 12
              : intro === 'playing' || document.body.dataset.musicListening === 'true'
                ? 60
                : snapshot.expanded
                  ? 30
                  : 24))
    )
      return;
    this.dirty = false;
    this.lastDraw = intro === 'playing' ? now - ((now - this.lastDraw) % (1000 / 60)) : now;
    this.onFrame?.(now, snapshot, reduced);
    // Float only within the transparent native window. Freeze during interaction
    // so dragging, selection and wheel anchors never chase a moving target.
    const previous = this.floatY;
    if (changed || !this.motionMeasuredAt || now - this.motionMeasuredAt > 500) {
      const rectangles = [
        ...document.querySelectorAll(
          '#handle,#quick-actions,#input-dock,#subtitle-stage,#portrait-panel,#presence-core,.preferences-panel,#history-panel,#startup-progress,#wake-feedback,#action-approval,#time-alert,#stopwatch-controls',
        ),
      ]
        .filter((node) => getComputedStyle(node).visibility !== 'hidden')
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ top: rect.top - this.floatY, bottom: rect.bottom - this.floatY }));
      this.motionLimits = floatLimits(rectangles, innerHeight);
      this.motionMeasuredAt = now;
    }
    if (reduced || !this.floatSettings.floatEnabled || !this.floatSettings.floatAmplitude)
      this.floatY = 0;
    else if (
      !this.model.interacting &&
      !(
        ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName) &&
        document.activeElement.value
      )
    ) {
      const target = interfaceFloat(now, {
        amplitude: this.floatSettings.floatAmplitude,
        periodSeconds: this.floatSettings.floatPeriodSeconds,
      });
      const bounded = Math.max(this.motionLimits.min, Math.min(this.motionLimits.max, target));
      this.floatY += (bounded - this.floatY) * 0.065;
      this.floatY = Math.max(this.motionLimits.min, Math.min(this.motionLimits.max, this.floatY));
    }
    if (Math.abs(previous - this.floatY) > 0.001 || reduced)
      document.body.style.setProperty('--float-y', `${this.floatY.toFixed(3)}px`);
    if (now - this.lastRegion > 90 && Math.abs(this.floatY - (this.publishedFloat ?? 0)) > 0.08) {
      this.publishedFloat = this.floatY;
      this.lastRegion = now;
      this.onMovement?.();
    }
    const scheduledInterference = this.glitches.frame(
      now,
      Math.max(snapshot.burstAt, this.stateAt),
      reduced,
    );
    const interference = introActive
      ? { ...scheduledInterference, strength: 0, x: 0, y: 0 }
      : scheduledInterference;
    document.body.dataset.glitch = interference.strength > 0.04 ? 'active' : 'quiet';
    document.body.style.setProperty('--glitch-strength', interference.strength.toFixed(3));
    document.body.style.setProperty('--glitch-x', `${interference.x.toFixed(2)}px`);
    document.body.style.setProperty('--glitch-y', `${interference.y.toFixed(2)}px`);
    if (this.onGlitch && interference.strength > 0.04 && !this.sentGlitch)
      this.onGlitch({
        start: now,
        timestamp: Date.now(),
        eventAt: Number.isFinite(this.glitches.eventAt) ? this.glitches.eventAt : -1e12,
        settings: this.glitches.settings,
      });
    this.sentGlitch = interference.strength > 0.04;
    const ratio = Math.min(devicePixelRatio || 1, 1.25),
      origin = this.canvas.getBoundingClientRect();
    for (const [canvas, ctx] of [
      [this.canvas, this.ctx],
      [this.frameCanvas, this.frameCtx],
    ]) {
      if (
        canvas.width !== Math.round(innerWidth * ratio) ||
        canvas.height !== Math.round(innerHeight * ratio)
      ) {
        canvas.width = Math.round(innerWidth * ratio);
        canvas.height = Math.round(innerHeight * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.translate(-origin.x, -origin.y);
    }
    const frame = this.frame.getBoundingClientRect();
    this.crt.draw({
      now,
      frame,
      avatar: this.sprite.getBoundingClientRect(),
      origin,
      ratio,
      glitch: interference.strength,
      reduced,
      visible: snapshot.expanded && !detached && intro !== 'pending',
    });
    if (!detached && !arriving && !introActive) {
      if (snapshot.expanded) this.drawPortrait(now, snapshot, interference);
      else this.drawCore(reduced ? 0 : now / 1000, snapshot);
    }
    if (interference.strength > 0.04) this.drawFrameDamage(interference, detached || arriving);
    this.canvas.dataset.effect = document.body.dataset.glitch;
    // The portrait scales during reveal. Recompute its image anchor until the
    // transition settles; otherwise the first drag would resize the sprite.
    if (changed || revealAge < 500) this.onLayout();
  }
  drawCore(time, snapshot) {
    const ctx = this.ctx,
      rect = this.orb.querySelector('.core-symbol').getBoundingClientRect();
    const cx = rect.x + rect.width / 2,
      cy = rect.y + rect.height / 2;
    const active = ['thinking', 'replying', 'listening'].includes(snapshot.state)
      ? 1
      : snapshot.state === 'input'
        ? 0.4
        : 0;
    const color = this.signalColor(snapshot.state);
    ctx.save();
    ctx.translate(cx, cy);
    // Keep the entire procedural symbol (including activity dots) in its layout box.
    const scale = Math.min(rect.width, rect.height) / 144;
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 49, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([2, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, 40, time * 0.2, time * 0.2 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      const angle = time * 0.25 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, 51, angle, angle + 0.34);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const points = shardPoints(i, time, active);
      ctx.fillStyle = i % 3 === 0 ? '#ff315c' : i % 3 === 1 ? '#eeef77' : '#79f9cd';
      ctx.beginPath();
      points.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#071019';
    ctx.fillRect(-12, -12, 24, 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(-12, -12, 24, 24);
    ctx.rotate(-Math.PI / 4);
    ctx.shadowColor = '#74eaff';
    ctx.shadowBlur = 9;
    ctx.strokeStyle = '#88f6ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#3861e8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e4feff';
    ctx.beginPath();
    ctx.arc(Math.sin(time * 0.6) * 1.1, Math.cos(time * 0.8) * 0.7, 3.1, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 5 - i));
        ctx.fillRect(-15 + i * 7, 66, 3, 3);
      }
    }
    ctx.restore();
  }
  drawPortrait(now, snapshot, interference) {
    const ctx = this.ctx,
      frame = this.frame.getBoundingClientRect();
    const color = this.signalColor(snapshot.state);
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x + 8, frame.y + 10, frame.width - 16, frame.height - 20);
    ctx.clip();
    // Phosphor structure, slow retrace and edge falloff remain visible online.
    ctx.fillStyle = '#01040a';
    ctx.globalAlpha = 0.16;
    for (let y = frame.y + 12; y < frame.bottom - 12; y += 3)
      ctx.fillRect(frame.x + 9, y, frame.width - 18, 1);
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(
      frame.x + frame.width / 2,
      frame.y + frame.height * 0.48,
      frame.width * 0.17,
      frame.x + frame.width / 2,
      frame.y + frame.height * 0.48,
      frame.width * 0.66,
    );
    vignette.addColorStop(0, '#0000');
    vignette.addColorStop(1, '#01041188');
    ctx.fillStyle = vignette;
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
    if (!this.motion.matches) {
      const y = frame.y + ((now * 0.026) % (frame.height + 36)) - 18;
      const gradient = ctx.createLinearGradient(0, y - 24, 0, y + 5);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.85, this.theme?.cyan ?? '#79ffdd');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.11;
      ctx.fillRect(frame.x + 9, y - 24, frame.width - 18, 29);
      ctx.globalAlpha = 1;
    }
    const burst = interference.strength;
    if (burst > 0.04 && this.sprite.complete && this.sprite.naturalWidth) {
      const accent = this.theme?.cyan ?? '#00ffdf',
        secondary = this.theme?.pink ?? '#ff1769';
      const image = this.images(),
        rect = this.sprite.getBoundingClientRect();
      const random = signalRandom(interference.seed);
      for (let i = 0; i < 22; i++) {
        const sy = random() * 375,
          sh = 2 + random() * 14;
        const shift = (random() - 0.5) * 88 * burst;
        ctx.globalAlpha = 0.2 + burst * 0.6;
        const source = [image.cyan, image.red, image.normal, image.violet, image.yellow][i % 5];
        ctx.drawImage(
          source,
          0,
          sy,
          384,
          sh,
          rect.x + shift,
          rect.y + (sy / 384) * rect.height,
          rect.width,
          (sh / 384) * rect.height,
        );
        if (i % 2 === 0) {
          ctx.globalAlpha = 0.38 * burst;
          ctx.fillStyle = i % 4 === 0 ? secondary : '#a668ff';
          ctx.fillRect(
            frame.x + random() * 60,
            frame.y + random() * frame.height,
            frame.width * (0.2 + random() * 0.7),
            1 + random() * 4,
          );
        }
      }
      // Small corruption cells, not a whole-frame flash.
      for (let i = 0; i < 34; i++) {
        ctx.globalAlpha = burst * random() * 0.7;
        ctx.fillStyle = i % 3 ? accent : secondary;
        ctx.fillRect(
          frame.x + random() * frame.width,
          frame.y + random() * frame.height,
          2 + random() * 10,
          1 + random() * 3,
        );
      }
    }
    ctx.restore();
    const level = Math.min(1, this.audioLevel() * 5);
    const x = frame.right - 94,
      y = frame.bottom - 20;
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < 14; i++) {
      const height =
        snapshot.state === 'speaking'
          ? 2 + level * (4 + 10 * Math.abs(Math.sin(now * 0.007 + i * 0.8)))
          : 2;
      ctx.globalAlpha = snapshot.state === 'speaking' ? 0.9 : 0.28;
      ctx.fillRect(x + i * 4, y - height, 2, height);
    }
    ctx.restore();
  }

  drawFrameDamage(fx, detached) {
    const ctx = this.frameCtx,
      random = signalRandom(fx.seed + 51);
    const palette = [
      this.theme?.cyan ?? '#00ffe0',
      this.theme?.pink ?? '#ff1769',
      '#b477ff',
      '#eeff50',
    ];
    const popup = [...document.querySelectorAll('#dimming-panel, #history-panel')].find(
      (node) => !node.hidden,
    );
    const cover = popup?.getBoundingClientRect();
    for (const host of document.querySelectorAll('[data-panel-cut]')) {
      if (detached && this.frame.contains(host)) continue;
      if (!host.getClientRects().length || getComputedStyle(host).visibility === 'hidden') continue;
      const rect = host.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (
        cover &&
        host !== popup &&
        !popup.contains(host) &&
        rect.x < cover.right &&
        rect.right > cover.x &&
        rect.y < cover.bottom &&
        rect.bottom > cover.y
      )
        continue;
      ctx.save();
      const notifications =
        document.body.dataset.presence === 'core' ? host.closest('.dock-notifications') : null;
      if (notifications) {
        const clip = notifications.getBoundingClientRect();
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.width, clip.height);
        ctx.clip();
      }
      for (let i = 0; i < 3; i++) {
        ctx.save();
        const top = rect.y + random() * rect.height,
          height = 3 + random() * 14;
        ctx.beginPath();
        ctx.rect(rect.x - 13, top, rect.width + 26, height);
        ctx.clip();
        ctx.translate(rect.x + fx.x * (i % 2 ? -1 : 1), rect.y + fx.y);
        ctx.lineWidth = 3;
        ctx.strokeStyle = palette[i];
        ctx.globalAlpha = fx.strength * 0.95;
        ctx.stroke(new Path2D(panelPath(rect.width, rect.height, Number(host.dataset.panelCut))));
        ctx.restore();
      }
      // A short interference packet crossing an edge, never the whole text area.
      ctx.fillStyle = palette[Math.floor(random() * palette.length)];
      ctx.globalAlpha = fx.strength * 0.7;
      const y = random() > 0.5 ? rect.y + 2 : rect.bottom - 4;
      ctx.fillRect(rect.x + rect.width * random() * 0.7, y, 12 + random() * 64, 2 + random() * 2);
      ctx.restore();
    }
  }
}
