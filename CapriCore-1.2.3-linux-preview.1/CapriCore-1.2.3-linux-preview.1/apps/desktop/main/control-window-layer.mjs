// SPDX-License-Identifier: GPL-3.0-only
import { setWindowAlwaysOnTop } from './window-topmost.mjs';
/** Temporarily keep Capri behind ordinary task windows without changing the
 * user's saved/draft pin preference or hiding/cancelling the companion. */
export class ControlWindowLayer {
  constructor({ getWindow, desired }) {
    Object.assign(this, { getWindow, desired });
    this.active = false;
  }
  sync() {
    const view = this.getWindow();
    if (!view || view.isDestroyed()) return;
    const value = !this.active && Boolean(this.desired());
    if (view.isAlwaysOnTop() !== value) setWindowAlwaysOnTop(view, value);
  }
  begin() {
    if (this.active) return;
    this.active = true;
    try {
      this.sync();
      const view = this.getWindow();
      // Demotion alone can leave a normal window above the focused app.
      // Move the owner group behind it without changing focus or visibility.
      if (view && !view.isDestroyed()) view.moveBottom?.();
    } catch (error) {
      this.active = false;
      try {
        this.sync();
      } catch {
        /* Preserve the initial window failure. */
      }
      throw error;
    }
  }
  end() {
    this.active = false;
    this.sync();
  }
}
