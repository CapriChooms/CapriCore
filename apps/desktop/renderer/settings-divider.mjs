// SPDX-License-Identifier: GPL-3.0-only
const storageKey = 'capri.settings.sidebarWidth.v1';
const minWidth = 120;
const widthLimit = 340;
const minContentWidth = 260;

export function setupSettingsDivider(layout) {
  const sidebar = layout.querySelector('#settings-sidebar');
  const divider = layout.querySelector('#settings-divider');
  let preferredWidth, currentWidth, maxWidth, drag;

  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isInteger(saved) && saved >= minWidth && saved <= widthLimit) preferredWidth = saved;
  } catch {
    // Settings also works with browser storage unavailable.
  }

  const clamp = (width) => Math.max(minWidth, Math.min(Math.round(width), maxWidth));
  function render(width) {
    currentWidth = width;
    divider.setAttribute('aria-valuenow', width);
    document.body.style.setProperty('--settings-sidebar-width', `${width}px`);
  }
  function persist() {
    preferredWidth = currentWidth;
    try {
      localStorage.setItem(storageKey, String(preferredWidth));
    } catch {}
  }
  function fit() {
    maxWidth = Math.max(minWidth, Math.min(widthLimit, layout.clientWidth - minContentWidth));
    divider.setAttribute('aria-valuemin', minWidth);
    divider.setAttribute('aria-valuemax', maxWidth);
    if (drag) render(clamp(currentWidth));
    else if (preferredWidth !== undefined) render(clamp(preferredWidth));
    else {
      currentWidth = sidebar.offsetWidth;
      divider.setAttribute('aria-valuenow', currentWidth);
    }
  }
  const direction = () => (document.documentElement.dir === 'rtl' ? -1 : 1);

  divider.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, width: currentWidth, direction: direction() };
    layout.setAttribute('data-sidebar-resizing', '');
  });
  divider.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    const width = clamp(drag.width + (event.clientX - drag.x) * drag.direction);
    if (width !== currentWidth) render(width);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    divider.addEventListener(type, (event) => {
      if (event.pointerId !== drag?.id) return;
      if (currentWidth !== drag.width) persist();
      else if (preferredWidth === undefined)
        document.body.style.removeProperty('--settings-sidebar-width');
      drag = null;
      layout.removeAttribute('data-sidebar-resizing');
    });

  divider.addEventListener('keydown', (event) => {
    const width = {
      ArrowLeft: currentWidth - 12 * direction(),
      ArrowRight: currentWidth + 12 * direction(),
      Home: minWidth,
      End: maxWidth,
    }[event.key];
    if (!Number.isFinite(width) || drag) return;
    event.preventDefault();
    const next = clamp(width);
    if (next === currentWidth) return;
    render(next);
    persist();
  });

  fit();
  window.addEventListener('resize', fit);
}
