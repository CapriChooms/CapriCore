/** Two-phase selection: an LLM request becomes current only after the image is ready. */
export class AvatarState {
  constructor(sprites, defaultId, { restoredId, persist = () => {} } = {}) {
    this.sprites = new Map(sprites.map((sprite) => [sprite.id, sprite]));
    if (!this.sprites.has(defaultId)) throw new Error('Missing default avatar');
    this.defaultId = defaultId;
    this.currentId =
      this.sprites.has(restoredId) && this.sprites.get(restoredId).canPersist !== false
        ? restoredId
        : defaultId;
    this.revision = 0;
    this.pendingId = this.currentId;
    this.persist = persist;
  }

  snapshot() {
    const { id, pose, expression, label, url, frameId, animation, returnTo } = this.sprites.get(
      this.pendingId,
    );
    return {
      id,
      pose,
      expression,
      label,
      url,
      frameId,
      animation,
      returnTo,
      revision: this.revision,
    };
  }

  request(id) {
    if (!this.sprites.has(id)) return null;
    if (this.pendingId === id) return null;
    this.pendingId = id;
    this.revision++;
    return this.snapshot();
  }

  invalidatePending() {
    this.pendingId = this.currentId;
    this.revision++;
    return this.snapshot();
  }

  acknowledge(value) {
    if (
      !value ||
      !Number.isSafeInteger(value.revision) ||
      value.revision !== this.revision ||
      value.id !== this.pendingId
    )
      return false;
    const choice = this.sprites.get(this.pendingId);
    const nextId =
      choice.canPersist === false ? (choice.returnTo ?? this.currentId) : this.pendingId;
    const changed = this.currentId !== nextId;
    this.currentId = nextId;
    if (changed) this.persist({ schemaVersion: 1, id: this.currentId });
    return true;
  }
}
