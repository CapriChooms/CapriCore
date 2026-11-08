import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const KEYS = ['sessionKey', 'id', 'userText', 'assistantText', 'source'];
export function validateVisualTurn(value, sessionKey) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some((k) => !KEYS.includes(k)) ||
    value.sessionKey !== sessionKey ||
    !/^[a-f0-9-]{36}$/i.test(value.id)
  )
    throw new Error('Invalid visual conversation target');
  for (const key of ['userText', 'assistantText'])
    if (
      typeof value[key] !== 'string' ||
      !value[key].trim() ||
      value[key].length > 8000 ||
      value[key].includes('\0') ||
      /data:image\//i.test(value[key]) ||
      /[A-Za-z0-9+/]{512,}={0,2}/.test(value[key])
    )
      throw new Error('Visual context must contain bounded text, never image data');
  const source = value.source;
  if (
    !source ||
    typeof source !== 'object' ||
    Object.keys(source).some((k) => !['kind', 'label', 'capturedAt'].includes(k)) ||
    !['window', 'monitor', 'monitors', 'attachment'].includes(source.kind) ||
    typeof source.label !== 'string' ||
    source.label.length > 160 ||
    /[\x00-\x1f]/.test(source.label) ||
    !Number.isFinite(source.capturedAt) ||
    source.capturedAt <= 0
  )
    throw new Error('Invalid visual observation source');
  return {
    sessionKey,
    id: value.id,
    userText: value.userText.trim(),
    assistantText: value.assistantText.trim(),
    source: { kind: source.kind, label: source.label, capturedAt: source.capturedAt },
  };
}

/** Atomically retain dialogue text/provenance. Raw frames cannot enter this contract. */
export class VisualContextService {
  constructor({ sessionKey, database, resolve, append, publish }) {
    Object.assign(this, { sessionKey, resolve, append, publish });
    this.tail = Promise.resolve();
    this.waiting = 0;
    this.db = new DatabaseSync(database);
    this.db.exec(
      'PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS commits(id TEXT PRIMARY KEY,fingerprint TEXT,state TEXT,result TEXT);',
    );
  }
  commit(value, { signal, assertCurrent = () => {}, target } = {}) {
    const turn = validateVisualTurn(value, this.sessionKey);
    if (this.waiting >= 4) throw new Error('Too many pending visual turns');
    this.waiting++;
    const task = this.tail
      .catch(() => {})
      .then(() => this.run(turn, signal, assertCurrent, target))
      .finally(() => this.waiting--);
    this.tail = task;
    return task;
  }
  async run(turn, signal, assertCurrent, authorizedTarget) {
    signal?.throwIfAborted();
    assertCurrent();
    const fingerprint = createHash('sha256').update(JSON.stringify(turn)).digest('hex'),
      prior = this.db.prepare('SELECT * FROM commits WHERE id=?').get(turn.id);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('Visual turn ID cannot change its contents');
      if (prior.state === 'complete') return JSON.parse(prior.result);
      throw new Error(
        'A visual turn may already have been committed. It will not be appended again automatically.',
      );
    }
    if (Math.abs(Date.now() - turn.source.capturedAt) > 120000)
      throw new Error('The visual observation expired before commit');
    if (this.db.prepare('SELECT count(*) AS count FROM commits').get().count >= 10000)
      throw new Error('Visual context journal is full');
    const target = await this.resolve(turn.sessionKey, authorizedTarget);
    if (!target?.sessionId || target.agentId !== 'capri' || target.sessionKey !== turn.sessionKey)
      throw new Error('Start the shared conversation before attaching a snapshot');
    signal?.throwIfAborted();
    assertCurrent();
    this.db
      .prepare('INSERT INTO commits(id,fingerprint,state) VALUES(?,?,?)')
      .run(turn.id, fingerprint, 'started');
    const timestamp = Date.now(),
      messages = [
        {
          message: {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  turn.userText +
                  (turn.source.kind === 'attachment'
                    ? '\n\n[Historical attachment. Original file content is unavailable.]'
                    : '\n\n[Historical one-shot image. This does not establish current screen contents or ongoing permission.]'),
              },
            ],
            timestamp,
            idempotencyKey: 'capri-vision:' + turn.id + ':user',
            capriObservation: { ...turn.source, imageRetained: false },
          },
        },
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: turn.assistantText }],
            timestamp: timestamp + 1,
            stopReason: 'stop',
            api: 'ollama',
            provider: 'capri-local',
            model: 'capri-vision',
            idempotencyKey: 'capri-vision:' + turn.id + ':assistant',
            capriObservation: { ...turn.source, imageRetained: false },
          },
        },
      ];
    // The SDK batch append is one transaction and fences the exact session generation.
    const committed = await this.append({ ...target, messages });
    if (!Array.isArray(committed) || committed.length !== 2)
      throw new Error('Visual conversation commit was incomplete');
    await this.publish(target).catch(() => {});
    const result = { ok: true, id: turn.id, sessionId: target.sessionId, imageRetained: false };
    this.db
      .prepare('UPDATE commits SET state=?,result=? WHERE id=?')
      .run('complete', JSON.stringify(result), turn.id);
    return result;
  }
  async close() {
    await this.tail.catch(() => {});
    this.db.close();
  }
}
