// SPDX-License-Identifier: GPL-3.0-only
// A read-only surface. The host supplies an opaque attachment ID, never a URL or file path.
import { applyInterfaceTheme } from './interface-theme.mjs';

const viewer = document.getElementById('attachment-preview');
const title = document.querySelector('#attachment-preview-title bdi');
const image = document.getElementById('attachment-preview-image');
const viewport = document.getElementById('attachment-preview-viewport');
const unavailable = document.getElementById('attachment-preview-unavailable');
const dimensions = document.getElementById('attachment-preview-dimensions');
const close = document.getElementById('attachment-preview-close');
const closeHint = document.getElementById('attachment-preview-close-hint');
const fit = document.getElementById('attachment-preview-fit');
const actual = document.getElementById('attachment-preview-actual');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const defaults = Object.freeze({
  close: 'Close',
  fit: 'Fit to screen',
  actual: 'Actual size',
  unavailable: 'Image preview unavailable',
  preview: 'Preview',
});
let revision = 0;
let mode = 'fit';

function text(value, fallback, limit = 160) {
  if (typeof value !== 'string') return fallback;
  return (
    value
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .trim()
      .slice(0, limit) || fallback
  );
}

function setMode(value) {
  mode = value === 'actual' ? 'actual' : 'fit';
  viewport.dataset.mode = mode;
  fit.setAttribute('aria-pressed', String(mode === 'fit'));
  actual.setAttribute('aria-pressed', String(mode === 'actual'));
  viewport.scrollTo(0, 0);
}

function failed() {
  viewer.dataset.phase = 'unavailable';
  viewer.setAttribute('aria-busy', 'false');
  unavailable.hidden = false;
  image.hidden = true;
  dimensions.textContent = '';
  fit.disabled = actual.disabled = true;
}

function show(value) {
  const current = ++revision;
  document.documentElement.lang = /^[a-z]{2}$/.test(value?.labels?.language ?? '')
    ? value.labels.language
    : 'en';
  document.documentElement.dir = value?.labels?.direction === 'rtl' ? 'rtl' : 'ltr';
  image.onload = image.onerror = null;
  image.removeAttribute('src');
  image.hidden = true;
  dimensions.textContent = '';
  setMode('fit');
  for (const [key, fallback] of Object.entries(defaults)) {
    const label = text(value?.labels?.[key], fallback, 200);
    if (key === 'close') {
      close.title = label;
      close.setAttribute('aria-label', label);
      closeHint.textContent = label;
    } else if (key === 'fit') fit.textContent = label;
    else if (key === 'actual') actual.textContent = label;
    else if (key === 'unavailable') unavailable.textContent = label;
    else document.title = `Capri · ${label}`;
  }
  title.textContent = text(value?.name, '');
  image.alt = title.textContent;
  try {
    applyInterfaceTheme(value?.theme);
  } catch {
    applyInterfaceTheme();
  }
  fit.disabled = actual.disabled = true;
  if (typeof value?.id !== 'string' || !uuid.test(value.id)) {
    failed();
    close.focus({ preventScroll: true });
    return false;
  }
  const source = `capri://desktop/attachments/${value.id}/preview.png`;
  viewer.dataset.phase = 'loading';
  viewer.setAttribute('aria-busy', 'true');
  unavailable.hidden = true;
  image.onload = () => {
    if (current !== revision || image.getAttribute('src') !== source) return;
    if (!image.naturalWidth || !image.naturalHeight) return failed();
    viewer.dataset.phase = 'ready';
    viewer.setAttribute('aria-busy', 'false');
    image.hidden = false;
    fit.disabled = actual.disabled = false;
    dimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
  };
  image.onerror = () => {
    if (current === revision) failed();
  };
  image.src = source;
  close.focus({ preventScroll: true });
  return true;
}

close.addEventListener('click', () => window.close());
fit.addEventListener('click', () => setMode('fit'));
actual.addEventListener('click', () => setMode('actual'));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  window.close();
});
document.addEventListener('contextmenu', (event) => event.preventDefault());
image.addEventListener('dragstart', (event) => event.preventDefault());
Object.defineProperty(window, 'capriAttachmentViewer', {
  value: Object.freeze({ show }),
  writable: false,
  configurable: false,
});
