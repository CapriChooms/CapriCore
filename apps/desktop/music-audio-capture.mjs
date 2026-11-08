// SPDX-License-Identifier: GPL-3.0-only
const companionUrl = 'capri://desktop/index.html';
const companionOrigins = ['capri://desktop', 'capri://desktop/'];

/** A single owner-click loopback grant, independent of microphone/ASR access. */
export class MusicAudioCapture {
  constructor({
    ownerFrame,
    sessionId,
    enableCapture = () => true,
    available = process.platform === 'win32',
    now = Date.now,
  }) {
    Object.assign(this, { ownerFrame, sessionId, enableCapture, available, now });
    this.grant = null;
  }
  supported() {
    return typeof this.available === 'function'
      ? this.available() === true
      : this.available === true;
  }
  prepare(id, frame) {
    if (
      !this.supported() ||
      typeof id !== 'string' ||
      !id ||
      id !== this.sessionId() ||
      frame !== this.ownerFrame() ||
      frame?.url !== companionUrl
    )
      throw Error('Music listening requires an active Capri audio session.');
    this.grant = { id, frame, expiresAt: this.now() + 5000 };
    return true;
  }
  armed() {
    const grant = this.grant;
    return Boolean(
      grant &&
        this.supported() &&
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
  revoke() {
    this.grant = null;
  }
  consume(request, respond) {
    if (request?.audioRequested !== true || !this.grant) return false;
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
    const { id } = this.grant;
    this.grant = null;
    // Chromium needs a video source even for loopback audio. Only the owner's
    // Capri frame is granted; SystemMusicClient immediately stops that track.
    let allowed = false;
    try {
      allowed = this.enableCapture(id) === true;
    } catch {
      /* Revoked while committing. */
    }
    respond(allowed ? { video: request.frame, audio: 'loopback' } : {});
    return true;
  }
}
