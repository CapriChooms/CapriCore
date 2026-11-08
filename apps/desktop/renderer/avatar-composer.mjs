// SPDX-License-Identifier: GPL-3.0-only
import { clipboardFiles, clipboardFilePayload } from './clipboard-files.mjs';
// This view only forwards intent. The main renderer owns drafts, files, ASR and requests.
const api = window.capriMini;
const root = document.getElementById('mini-composer');
const message = document.getElementById('message');
const send = document.getElementById('send');
const attach = document.getElementById('attachment-open');
const microphone = document.getElementById('input-microphone');
const thinking = document.getElementById('thinking-toggle');
const internet = document.getElementById('internet-toggle');
const miniActions = document.getElementById('mini-actions');
const keyboard = document.getElementById('mini-keyboard');
const menu = document.getElementById('mini-menu');
const attachmentDrafts = document.getElementById('attachment-drafts');
const attachmentList = document.getElementById('attachment-list');
const status = document.getElementById('composer-status');
const messageLabel = document.getElementById('message-label');
const defaultLabels = Object.freeze({
  message: 'Message Capri',
  placeholder: 'Talk to Capri…',
  attach: 'Attach files',
  attachments: 'Attached files',
  microphone: 'Enable microphone',
  send: 'Send message',
  sendHint: 'Send (Enter)',
  remove: 'Remove attachment',
  working: 'Capri is replying…',
  microphoneLoading: 'Starting microphone…',
  actionFailed: 'Could not complete this action. Please try again.',
  unavailable: 'The input bar is unavailable. Open Capri to reconnect.',
  keyboard: 'Message Capri',
  menu: 'Show Capri',
});
const themeTokens = [
  'cyan',
  'pink',
  'theme-panel',
  'theme-background',
  'theme-border',
  'theme-text',
];
let state = {
  draft: '',
  canSend: false,
  canAttach: false,
  busy: false,
  attachments: [],
  microphone: { disabled: true },
};
let labels = defaultLabels;
let connected = false;
let composing = false;
let submissionPending = false;
let pastePending = false;
let thinkingPending = false;
let internetPending = false;
let localError = '';
let editRevision = 0;
let acknowledgedRevision = 0;
let pendingDraft = null;
let lastHeight = 0;
let resizeFrame = 0;
let unsubscribe;
let focusTextPending = false;

function showStatus() {
  const text =
    localError ||
    state.error ||
    state.status ||
    (state.microphone?.loading ? labels.microphoneLoading : '');
  status.textContent = typeof text === 'string' ? text : '';
  status.hidden = !status.textContent;
  status.dataset.error = String(Boolean(localError || state.error));
  scheduleResize();
}

function action(value) {
  if (!connected || !api?.action) return Promise.resolve(false);
  try {
    return Promise.resolve(api.action(value)).then(
      (result) => {
        if (result !== false) return true;
        localError = labels.actionFailed;
        showStatus();
        return false;
      },
      () => {
        localError = labels.unavailable;
        showStatus();
        return false;
      },
    );
  } catch {
    localError = labels.unavailable;
    showStatus();
    return Promise.resolve(false);
  }
}

function scheduleResize() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    const height = Math.max(44, Math.min(240, Math.ceil(root.getBoundingClientRect().height)));
    if (height === lastHeight) return;
    lastHeight = height;
    try {
      Promise.resolve(api?.resize?.(height)).catch(() => {});
    } catch {}
  });
}

function sizeMessage() {
  message.style.height = '29px';
  if (message.value) message.style.height = `${Math.max(29, Math.min(67, message.scrollHeight))}px`;
  scheduleResize();
}

function updateSend() {
  send.disabled =
    !connected || !state.canSend || Boolean(state.busy) || submissionPending || pastePending;
  send.dataset.busy = String(Boolean(state.busy || submissionPending));
  send.title = state.busy ? labels.working : labels.sendHint;
  send.setAttribute('aria-label', state.busy ? labels.working : labels.send);
  internet.disabled =
    !connected || internetPending || Boolean(state.busy || submissionPending || pastePending);
}

function applyDraft(next) {
  const incoming = typeof next.draft === 'string' ? next.draft.slice(0, 8000) : '';
  if (Number.isSafeInteger(next.draftRevision)) {
    acknowledgedRevision = Math.max(acknowledgedRevision, next.draftRevision);
    if (next.draftRevision < editRevision) return;
    pendingDraft = null;
  } else if (pendingDraft !== null) {
    if (incoming !== pendingDraft) return;
    pendingDraft = null;
  }
  if (composing || message.value === incoming) return;
  const start = message.selectionStart;
  const end = message.selectionEnd;
  const focused = document.activeElement === message;
  message.value = incoming;
  if (focused)
    message.setSelectionRange(Math.min(start, incoming.length), Math.min(end, incoming.length));
  sizeMessage();
}

function renderAttachments() {
  const items = Array.isArray(state.attachments) ? state.attachments : [];
  const focusedChip = document.activeElement?.closest('.attachment-chip');
  const focusedId = focusedChip?.dataset.id;
  const focusedIndex = focusedChip ? [...attachmentList.children].indexOf(focusedChip) : -1;
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const chip = document.createElement('li');
    chip.className = 'attachment-chip';
    chip.dataset.id = item.id;
    chip.dataset.error = String(Boolean(item.error));
    chip.dataset.loading = String(['loading', 'reading', 'processing'].includes(item.status));
    chip.title = item.error ? `${item.name}: ${item.error}` : item.name;
    const name = document.createElement('span');
    name.className = 'attachment-name';
    name.textContent = item.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `${labels.remove}: ${item.name}`;
    remove.setAttribute('aria-label', remove.title);
    remove.disabled = Boolean(state.busy || submissionPending || pastePending);
    remove.addEventListener('click', () => {
      void action({ type: 'remove', id: item.id });
    });
    chip.append(name, remove);
    fragment.append(chip);
  }
  attachmentList.replaceChildren(fragment);
  if (focusedId && document.hasFocus() && state.composerVisible === true) {
    const replacement =
      [...attachmentList.children].find((chip) => chip.dataset.id === focusedId) ??
      attachmentList.children[
        Math.max(0, Math.min(focusedIndex, attachmentList.childElementCount - 1))
      ];
    if (replacement?.firstElementChild?.nextElementSibling?.disabled === false)
      replacement.lastElementChild.focus({ preventScroll: true });
    else message.focus({ preventScroll: true });
  }
  attachmentDrafts.hidden = attachmentList.childElementCount === 0;
  attachmentList.setAttribute('aria-label', labels.attachments);
  scheduleResize();
}

function applyState(value) {
  if (!value || typeof value !== 'object') return;
  state = { ...state, ...value, microphone: { ...state.microphone, ...value.microphone } };
  const previousMode = root.dataset.mode;
  const mode = ['compact', 'text', 'expanded'].includes(state.mode) ? state.mode : 'compact';
  root.dataset.mode = mode;
  if (mode !== previousMode || (!microphone.closest('#mini-actions') && mode !== 'text')) {
    if (mode === 'text') send.before(microphone);
    else miniActions.prepend(microphone);
  }
  root.dataset.visible = String(state.composerVisible === true);
  root.setAttribute('aria-hidden', String(state.composerVisible !== true));
  labels = { ...defaultLabels, ...(state.labels || {}) };
  for (const key of Object.keys(defaultLabels)) {
    if (typeof labels[key] !== 'string' || !labels[key]) labels[key] = defaultLabels[key];
  }
  if (typeof state.locale === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(state.locale))
    document.documentElement.lang = state.locale;
  for (const token of themeTokens) {
    const color = state.theme?.[token];
    if (typeof color === 'string' && CSS.supports('color', color))
      document.documentElement.style.setProperty(`--${token}`, color);
  }
  connected = true;
  localError = '';
  root.setAttribute('aria-busy', String(Boolean(state.busy)));
  root.setAttribute('aria-label', labels.message);
  messageLabel.textContent = labels.message;
  message.placeholder = labels.placeholder;
  keyboard.title = labels.keyboard;
  keyboard.setAttribute('aria-label', labels.keyboard);
  keyboard.setAttribute('aria-pressed', String(mode === 'text'));
  keyboard.disabled = false;
  menu.title = labels.menu;
  menu.setAttribute('aria-label', labels.menu);
  menu.setAttribute('aria-pressed', String(mode === 'expanded'));
  menu.disabled = false;
  message.disabled = false;
  applyDraft(state);
  attach.disabled = !state.canAttach || Boolean(state.busy || submissionPending || pastePending);
  attach.title = labels.attach;
  attach.setAttribute('aria-label', labels.attach);
  const mic = state.microphone;
  const micLabel = typeof mic.label === 'string' && mic.label ? mic.label : labels.microphone;
  microphone.disabled = Boolean(mic.disabled || mic.loading);
  microphone.title = micLabel;
  microphone.setAttribute('aria-label', micLabel);
  microphone.setAttribute('aria-pressed', String(Boolean(mic.listening)));
  microphone.setAttribute('aria-busy', String(Boolean(mic.loading)));
  microphone.dataset.loading = String(Boolean(mic.loading));
  thinking.disabled = !connected || thinkingPending;
  thinking.setAttribute('aria-pressed', String(state.thinking?.enabled === true));
  thinking.setAttribute('aria-label', state.thinking?.label || 'Thinking mode: Off');
  thinking.title =
    (state.thinking?.label || 'Thinking mode: Off') + '\n' + (state.thinking?.hint || '');
  internet.disabled = !connected || internetPending || Boolean(state.busy);
  internet.setAttribute('aria-pressed', String(state.internet?.enabled === true));
  internet.setAttribute('aria-label', state.internet?.label || 'Internet mode: Off');
  internet.setAttribute('aria-busy', String(internetPending));
  internet.title =
    (state.internet?.label || 'Internet mode: Off') + '\n' + (state.internet?.hint || '');
  updateSend();
  renderAttachments();
  showStatus();
  if (mode === 'text' && mode !== previousMode) sizeMessage();
  if (mode === 'text' && focusTextPending) {
    focusTextPending = false;
    requestAnimationFrame(() => message.focus({ preventScroll: true }));
  }
}

function editDraft() {
  localError = '';
  pendingDraft = message.value;
  editRevision = Math.max(editRevision, acknowledgedRevision) + 1;
  void action({ type: 'edit', draft: message.value, revision: editRevision });
  sizeMessage();
  showStatus();
}

async function submit() {
  if (composing || send.disabled || state.busy || submissionPending) return;
  submissionPending = true;
  updateSend();
  renderAttachments();
  attach.disabled = true;
  await action({ type: 'submit' });
  submissionPending = false;
  updateSend();
  renderAttachments();
  attach.disabled = !state.canAttach || Boolean(state.busy);
  if (document.hasFocus() && state.composerVisible === true) message.focus({ preventScroll: true });
}

message.addEventListener('input', editDraft);
message.addEventListener('paste', async (event) => {
  const files = clipboardFiles(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  if (!connected || !state.canAttach || state.busy || submissionPending || pastePending) return;
  pastePending = true;
  attach.disabled = true;
  updateSend();
  renderAttachments();
  try {
    const payload = await clipboardFilePayload(files);
    if (!connected || !state.canAttach || state.busy || submissionPending) return;
    await action({ type: 'paste-files', ...payload });
  } catch {
    localError = labels.actionFailed;
    showStatus();
  } finally {
    pastePending = false;
    attach.disabled = !state.canAttach || Boolean(state.busy || submissionPending);
    updateSend();
    renderAttachments();
  }
});
message.addEventListener('compositionstart', () => {
  composing = true;
});
message.addEventListener('compositionend', () => {
  composing = false;
});
message.addEventListener('keydown', (event) => {
  if (
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.isComposing ||
    composing ||
    event.keyCode === 229
  )
    return;
  event.preventDefault();
  if (!event.repeat) void submit();
});
send.addEventListener('click', () => {
  void submit();
});
attach.addEventListener('click', () => {
  if (!attach.disabled) void action({ type: 'attach' });
});
microphone.addEventListener('click', () => {
  if (!microphone.disabled) void action({ type: 'microphone' });
});
thinking.addEventListener('click', async () => {
  if (thinking.disabled) return;
  thinkingPending = true;
  thinking.disabled = true;
  await action({ type: 'thinking', enabled: state.thinking?.enabled !== true });
  thinkingPending = false;
  thinking.disabled = !connected;
});
internet.addEventListener('click', async () => {
  if (internet.disabled || state.busy || submissionPending || pastePending) return;
  internetPending = true;
  internet.disabled = true;
  internet.setAttribute('aria-busy', 'true');
  await action({ type: 'internet', enabled: state.internet?.enabled !== true });
  internetPending = false;
  internet.disabled = !connected || Boolean(state.busy || submissionPending || pastePending);
  internet.setAttribute('aria-busy', 'false');
});
keyboard.addEventListener('click', () => {
  if (!keyboard.disabled) {
    focusTextPending = root.dataset.mode !== 'text';
    void action({ type: 'keyboard' });
  }
});
menu.addEventListener('click', () => {
  if (!menu.disabled) void action({ type: 'menu' });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.isComposing || composing) return;
  event.preventDefault();
  try {
    Promise.resolve(api?.hide?.()).catch(() => {});
  } catch {}
});
window.addEventListener('focus', () => {
  if (!message.disabled && root.dataset.mode === 'text') message.focus({ preventScroll: true });
});
window.addEventListener('beforeunload', () => {
  if (typeof unsubscribe === 'function') unsubscribe();
});
new ResizeObserver(scheduleResize).observe(root);

try {
  if (!api?.bootstrap || !api?.onState || !api?.action) throw Error('Unavailable bridge');
  let receivedState = false;
  unsubscribe = api.onState((value) => {
    receivedState = true;
    applyState(value);
  });
  const initial = await api.bootstrap();
  if (!receivedState) applyState(initial);
  if (!connected) throw Error('Unavailable owner');
  sizeMessage();
} catch {
  localError = labels.unavailable;
  root.setAttribute('aria-busy', 'false');
  showStatus();
}
