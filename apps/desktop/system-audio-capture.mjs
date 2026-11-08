// SPDX-License-Identifier: GPL-3.0-only
const companionUrl = 'capri://desktop/index.html';
const companionOrigins = ['capri://desktop', 'capri://desktop/'];

/** Single-use, short-lived consent scoped to the active local microphone session. */
export class SystemAudioCapture {
  constructor({
    ownerFrame,
    sessionId,
    enableReview,
    available = process.platform === 'win32',
    now = Date.now,
  }) {
    Object.assign(this, { ownerFrame, sessionId, enableReview, available, now });
    this.grant = null;
  }

  prepare(id, frame, wake = false) {
    if (
      !this.available ||
      typeof wake !== 'boolean' ||
      !id ||
      id !== this.sessionId() ||
      frame !== this.ownerFrame() ||
      frame?.url !== companionUrl
    )
      throw new Error('System audio requires an active microphone in Capri.');
    this.grant = { id, frame, wake, expiresAt: this.now() + 5000 };
    return true;
  }

  armed() {
    const grant = this.grant;
    return Boolean(
      grant &&
        grant.expiresAt > this.now() &&
        grant.id === this.sessionId() &&
        grant.frame === this.ownerFrame() &&
        grant.frame.url === companionUrl,
    );
  }

  cancel(id, frame) {
    if (this.grant?.id !== id || this.grant?.frame !== frame) return false;
    this.grant = null;
    return true;
  }

  consume(request, respond) {
    if (request?.audioRequested !== true) return false;
    if (
      !this.armed() ||
      request.frame !== this.grant.frame ||
      !companionOrigins.includes(request.securityOrigin) ||
      request.videoRequested !== true ||
      request.userGesture !== true
    ) {
      respond({});
      return true;
    }
    const { id, wake } = this.grant;
    this.grant = null;
    // Chromium requires a display video track. Grant only Capri's own frame;
    // the renderer drops it immediately and keeps the loopback audio track.
    respond(this.enableReview(id, wake) ? { video: request.frame, audio: 'loopback' } : {});
    return true;
  }
}
