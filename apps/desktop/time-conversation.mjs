// SPDX-License-Identifier: GPL-3.0-only
import { uiText } from './renderer/interface-translations.mjs';
export class TimeConversation {
  constructor({ service, language, now = Date.now }) {
    Object.assign(this, { service, language, now });
  }
  observe(args, result) {
    const object = result?.object ?? (result?.kind ? result : null);
    if (object && ['stopwatch', 'timer'].includes(object.kind))
      this.focus = { id: object.id, kind: object.kind, at: this.now() };
  }
  read(text) {
    const phrase = text
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[?!.]+$/u, '')
      .trim();
    const explicit =
      /^(?:(?:capri|капри)[, ]+)?(?:how (?:much time has passed|long has it been)|(?:what is |what's )?the (?:elapsed|stopwatch|timer) time|сколько (?:времени )?прошло|сколько на секундомере|какое время на секундомере)$/u.test(
        phrase,
      );
    const follow =
      /^(?:and now|what about now|now|а сейчас|и сейчас|а теперь|сейчас|теперь)$/u.test(phrase);
    if (!explicit && !(follow && this.focus && this.now() - this.focus.at < 120000)) {
      if (!follow) this.focus = null;
      return null;
    }
    const clocks = this.service()
      .snapshot()
      .filter(
        (o) => ['stopwatch', 'timer'].includes(o.kind) && ['running', 'paused'].includes(o.state),
      );
    const object =
      clocks.find((o) => o.id === this.focus?.id) ?? (clocks.length === 1 ? clocks[0] : null);
    if (!object) return null;
    this.focus = { id: object.id, kind: object.kind, at: this.now() };
    return uiText('Elapsed time: {time}.', this.language(), { time: object.displayElapsed });
  }
  context() {
    const object =
      this.focus &&
      this.service()
        .snapshot()
        .find((o) => o.id === this.focus.id);
    return object
      ? 'Live clock reading for THIS turn only (older receipts are stale): ' +
          JSON.stringify(object)
      : '';
  }
}
