import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../../packages/runtime/src/atomic-json.mjs';
import { historyAttachments } from './attachment-history.mjs';
import { webSources } from './web-sources.mjs';
import { PRIVATE_STORAGE_OVERHEAD, isLegacySealed } from './legacy-private-storage.mjs';
export { writeJsonAtomic };

const MAX_MESSAGES = 200;
const MAX_TEXT = 65536;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const validAvatar = (value) =>
  value &&
  ['id', 'pose', 'expression'].every(
    (key) => typeof value[key] === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value[key]),
  );

function canonicalMessage(message) {
  const result = { ...message };
  delete result.attachments;
  delete result.webSources;
  const sources = message.role === 'assistant' ? webSources(message.webSources) : [];
  if (sources.length) result.webSources = sources;
  const attachments = message.role === 'user' ? historyAttachments(message.attachments) : [];
  if (attachments.length) result.attachments = attachments;
  return result;
}
const attachmentIds = (messages) =>
  messages
    .flatMap((message) => historyAttachments(message.attachments).map((value) => value.id))
    .join(',');

function validMessage(message) {
  return (
    message &&
    ['user', 'assistant'].includes(message.role) &&
    typeof message.id === 'string' &&
    message.id.length < 100 &&
    typeof message.turnId === 'string' &&
    message.turnId.length < 80 &&
    typeof message.text === 'string' &&
    message.text.length <= MAX_TEXT &&
    typeof message.createdAt === 'string' &&
    ['complete', 'streaming', 'interrupted', 'error'].includes(message.status) &&
    (message.avatar === undefined || (message.role === 'assistant' && validAvatar(message.avatar)))
  );
}

export class TranscriptStore {
  constructor(file, { privacy } = {}) {
    this.file = file;
    this.privacy = privacy;
    this.messages = [];
    this.warning = null;
    this.restoreFailed = false;
    if (!existsSync(file)) return;
    try {
      let bytes = readFileSync(file);
      if (bytes.length > MAX_FILE_BYTES + PRIVATE_STORAGE_OVERHEAD)
        throw new Error('Transcript exceeds limit');
      if (isLegacySealed(bytes)) {
        if (!privacy) throw new Error('Legacy transcript key is unavailable');
        bytes = privacy.open(bytes, 'transcript');
      }
      if (bytes.length > MAX_FILE_BYTES) throw new Error('Transcript exceeds limit');
      const saved = JSON.parse(bytes.toString('utf8'));
      if (
        saved.schemaVersion !== 1 ||
        !Array.isArray(saved.messages) ||
        !saved.messages.every(validMessage)
      )
        throw new Error('Invalid transcript');
      this.messages = saved.messages.slice(-MAX_MESSAGES).map((message) => ({
        ...canonicalMessage(message),
        status: message.status === 'streaming' ? 'interrupted' : message.status,
      }));
    } catch {
      // New messages must not replace recoverable history after an unreadable
      // file, wrong key or authentication failure. Only explicit clearing may.
      this.restoreFailed = true;
      this.warning =
        'The local transcript could not be restored. Capri’s shared memory is still available.';
    }
  }

  snapshot() {
    return structuredClone(this.messages);
  }
  persist(value, { discardUnreadable = false } = {}) {
    if (this.restoreFailed && !discardUnreadable)
      throw new Error('The local transcript could not be restored.');
    writeJsonAtomic(this.file, value);
  }
  clear() {
    this.persist({ schemaVersion: 1, messages: [] }, { discardUnreadable: true });
    this.messages = [];
    this.warning = null;
    this.restoreFailed = false;
    this.onAttachmentsChanged?.();
  }

  put(message) {
    if (!validMessage(message)) throw new Error('Invalid transcript entry');
    const previousAttachments = attachmentIds(this.messages);
    const index = this.messages.findIndex((item) => item.id === message.id);
    if (index >= 0) this.messages[index] = canonicalMessage(message);
    else this.messages.push(canonicalMessage(message));
    this.messages = this.messages.slice(-MAX_MESSAGES);
    // Bound total history as well as each message; this is a display journal,
    // never an additional prompt/history replay into OpenClaw.
    while (
      Buffer.byteLength(JSON.stringify({ schemaVersion: 1, messages: this.messages }, null, 2)) >
        MAX_FILE_BYTES &&
      this.messages.length > 2
    )
      this.messages.shift();
    // Keep the current conversation usable in memory without overwriting the
    // unreadable journal or permitting derivative pruning through its warning.
    if (this.restoreFailed) return;
    try {
      this.persist({ schemaVersion: 1, messages: this.messages });
      this.warning = null;
      if (previousAttachments !== attachmentIds(this.messages)) this.onAttachmentsChanged?.();
    } catch {
      this.warning =
        'The conversation is available now, but its local transcript could not be saved.';
    }
  }
}
