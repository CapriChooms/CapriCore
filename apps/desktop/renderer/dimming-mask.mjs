// SPDX-License-Identifier: GPL-3.0-only
import { dimmingFeatherWidth } from './dimming-settings.mjs';

const surfaces = [
  '.companion-toolbar, #portrait-panel, #subtitle-frame, .composer',
  'body:not([data-horizontal-portrait]) .dock-telemetry:has(:is(#process-graphs-hud, #memory-hud, #monitor-display, #microphone-preview):not([hidden]))',
  'body[data-horizontal-portrait] :is(#resource-monitor, #microphone-preview)',
  '#reconnect, #computer-control-stop',
  '#history-panel, #inference-picker, #voice-volume-menu, #stopwatch-controls',
  '#startup-progress, #attachment-drafts, #call-audio-dock',
  '#wild-tab-notice, #thinking-progress, #update-notification, .resource-warning',
  '.preferences-panel, #dimming-panel, #notice, #clip-result, #time-alert, #action-approval',
].join(', ');
const scrollSurfaces = '.dock-notifications, #reply-slot[data-resizing]';
const snap = (value) => Math.round(value * 64) / 64;

function surfaceBox(host, style) {
  if (style.display !== 'contents') return host.getBoundingClientRect();
  // The stacked layouts flatten the toolbar wrapper into its two rows.
  const rows = [...host.children]
    .map((row) => row.getBoundingClientRect())
    .filter(({ width, height }) => width > 0 && height > 0);
  if (!rows.length) return host.getBoundingClientRect();
  const x = Math.min(...rows.map((row) => row.left));
  const y = Math.min(...rows.map((row) => row.top));
  return new DOMRect(
    x,
    y,
    Math.max(...rows.map((row) => row.right)) - x,
    Math.max(...rows.map((row) => row.bottom)) - y,
  );
}

export function featherForSurface(softness, { width, height }) {
  // Short panels keep a fully shaded center even at the maximum global setting.
  return Math.min(dimmingFeatherWidth(softness), Math.min(width, height) / 4);
}

export class DimmingMask {
  constructor(layer) {
    this.layer = layer;
    this.root = layer.parentElement;
    this.planes = new Map();
  }

  configure({ enabled, level, softness }) {
    this.active = enabled && level > 0;
    this.softness = softness;
    this.layer.style.setProperty('--shade-strength', String(this.active ? level / 100 : 0));
  }

  draw(bounds, origin) {
    if (!this.active) return;
    const visible = new Map();
    const scrollBounds = new Map();
    for (const host of this.root.querySelectorAll(surfaces)) {
      const style = getComputedStyle(host);
      if (style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
      const rect = surfaceBox(host, style);
      if (rect.width <= 0 || rect.height <= 0) continue;

      let inset = 'none';
      const scroller = host.closest(scrollSurfaces);
      if (scroller && scroller !== host) {
        if (!scrollBounds.has(scroller)) {
          const overflow = getComputedStyle(scroller).overflow;
          scrollBounds.set(
            scroller,
            overflow === 'visible' ? null : scroller.getBoundingClientRect(),
          );
        }
        const clip = scrollBounds.get(scroller);
        if (clip) {
          if (
            rect.right <= clip.left ||
            rect.left >= clip.right ||
            rect.bottom <= clip.top ||
            rect.top >= clip.bottom
          )
            continue;
          const edges = [
            clip.top - rect.top,
            rect.right - clip.right,
            rect.bottom - clip.bottom,
            clip.left - rect.left,
          ];
          if (edges.some((edge) => edge > 0))
            inset = 'inset(' + edges.map((edge) => Math.max(0, snap(edge)) + 'px').join(' ') + ')';
        }
      }

      const box = [
        rect.x - origin.x - bounds.x,
        rect.y - origin.y - bounds.y,
        rect.width,
        rect.height,
      ].map(snap);
      visible.set(host, {
        box,
        inset,
        clipPath: style.clipPath,
        borderRadius: style.borderRadius,
        opacity: style.opacity,
        feather: featherForSurface(this.softness, rect),
      });
    }

    // Collect layouts first so updating the planes cannot force a layout between reads.
    for (const [host, { box, inset, clipPath, borderRadius, opacity, feather }] of visible) {
      let plane = this.planes.get(host);
      if (!plane) {
        const element = this.layer.ownerDocument.createElement('div');
        const surface = this.layer.ownerDocument.createElement('div');
        const fill = this.layer.ownerDocument.createElement('div');
        element.className = 'dimming-plane';
        surface.className = 'dimming-surface';
        fill.className = 'dimming-fill';
        surface.append(fill);
        element.append(surface);
        this.layer.append(element);
        plane = { element, surface };
        this.planes.set(host, plane);
      }
      const signature = [...box, inset, clipPath, borderRadius, opacity, feather].join('|');
      if (signature === plane.signature) continue;
      plane.signature = signature;
      const [left, top, width, height] = box.map((value) => value + 'px');
      Object.assign(plane.element.style, { left, top, width, height, clipPath: inset, opacity });
      Object.assign(plane.surface.style, { clipPath, borderRadius });
      plane.surface.style.setProperty('--shade-shape', clipPath);
      plane.surface.style.setProperty('--shade-inset', snap(feather * 0.65) + 'px');
      plane.surface.style.setProperty('--shade-blur', snap(feather * 0.32) + 'px');
      plane.surface.toggleAttribute('data-feathered', feather > 0);
    }
    for (const [host, plane] of this.planes) {
      if (visible.has(host)) continue;
      plane.element.remove();
      this.planes.delete(host);
    }
  }
}
