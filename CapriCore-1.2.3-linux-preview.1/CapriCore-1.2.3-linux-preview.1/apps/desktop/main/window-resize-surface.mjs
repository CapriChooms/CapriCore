// SPDX-License-Identifier: GPL-3.0-only
import { resizeWindowBounds } from '../geometry.mjs';

const sameBounds = (a, b) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export function resizeWorkspace(bounds, { edge, workArea, minimum }) {
  // Reserve space only along the axes that can expand during this gesture.
  return resizeWindowBounds(
    bounds,
    edge,
    {
      x: edge.includes('w')
        ? workArea.x - bounds.x
        : workArea.x + workArea.width - bounds.x - bounds.width,
      y: edge.includes('n')
        ? workArea.y - bounds.y
        : workArea.y + workArea.height - bounds.y - bounds.height,
    },
    workArea,
    minimum,
  );
}

/** Keeps the Windows presentation origin fixed while the live Chromium view reflows. */
export class WindowResizeSurface {
  constructor(window, view) {
    this.window = window;
    this.view = view;
    const fit = () => {
      if (!this.active) {
        const { width, height } = window.getContentBounds();
        view.setBounds({ x: 0, y: 0, width, height });
      }
    };
    fit();
    window.on('resize', fit);
    window.on('closed', () => this.cancel(false));
  }

  get active() {
    return Boolean(this.gesture);
  }

  get bounds() {
    return this.gesture?.painted ?? this.window.getContentBounds();
  }

  resize(start, options, target) {
    if (!this.gesture) {
      const workspace = resizeWorkspace(start, options);
      this.gesture = { painted: target, origin: workspace };
      this.gesture.painted = this.place(workspace, target);
      this.gesture.origin = this.window.getContentBounds();
      return;
    }
    const { origin, painted } = this.gesture;
    if (sameBounds(target, painted)) return;
    this.placeView(origin, target);
    this.gesture.painted = target;
  }

  finish() {
    if (this.window.isDestroyed()) return false;
    this.cancel();
    return true;
  }

  cancel(restore = true) {
    const gesture = this.gesture;
    if (!gesture) return;
    if (restore && !this.window.isDestroyed()) this.place(gesture.painted, gesture.painted);
    this.gesture = undefined;
  }

  place(host, content) {
    // Rebase the native host and the live view in the same main-process turn.
    // Waiting for a renderer frame between the two can expose an empty window.
    if (!sameBounds(this.window.getContentBounds(), host)) this.window.setContentBounds(host);
    const origin = this.window.getContentBounds();
    // DPI rounding can make the committed native rectangle a DIP larger or
    // smaller. Fill that rectangle exactly when leaving the temporary workspace.
    if (sameBounds(host, content)) content = origin;
    this.placeView(origin, content);
    return content;
  }

  placeView(origin, content) {
    this.view.setBounds({
      x: content.x - origin.x,
      y: content.y - origin.y,
      width: content.width,
      height: content.height,
    });
  }
}
