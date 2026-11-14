const STARTS = ['[avatar:', '[аватар:', '[/avatar:', '[/аватар:', '[/avatar]', '[/аватар]'];
const MAX_START = Math.max(...STARTS.map((marker) => marker.length));
const MAX_CONTROL = 128;
const LISTEN_SUFFIX = ';listen';
const COMPLETE_LISTEN_SUFFIX = /^;listen\]?\s*$/i;

export function avatarInstructions(sprites, { followUp = false, compact = false } = {}) {
  if (!sprites.length)
    return 'This interface currently has no controllable avatar. Write only your reply, without control markers.';
  const listening =
    'LISTENING CONTROL: For a genuine question that invites a response, use [avatar:ID;listen]. Keep ;listen inside the opening marker. It only continues an already-enabled microphone.';
  if (compact)
    return [
      `AVATAR CONTROL: Start with one hidden marker [avatar:ID] on its own line, followed by your reply. Pick the ID that fits: ${sprites.map((sprite) => sprite.id).join(', ')}. Use no closing tag.`,
      ...(followUp ? [listening] : []),
    ].join('\n');
  const options = sprites.map((sprite) => `${sprite.id}: ${sprite.description}`).join('\n');
  return `AVATAR CONTROL:
Choose your facial expression or reaction from context. Begin your final user-facing answer with exactly one hidden marker [avatar:ID], then a newline and your reply. When a tool is needed, call it first without an avatar marker or spoken preamble; choose the avatar only for your answer after the tool result. Use one listed ID:
${options}
${followUp ? listening : ''}
Example first line (no punctuation after the marker):
[avatar:${sprites[0].id}]
Then write the reply on the next line. Keep one choice per reply. The marker is a single opening control line, not an XML tag: never add a closing marker or repeat it in the reply. Vary your expression naturally and be empathetic to distress. Choose a flirty expression or a wink only when the conversation invites it. Laugh when something is genuinely funny. Facial reactions finish automatically; blinking and speech motion are handled locally. Never explain or quote the marker. These graphics do not grant computer-control tools.`;
}

/** Streaming parser for a reserved, bounded control frame. Never interprets executable content. */
export class AvatarStreamParser {
  constructor(sprites) {
    this.options = new Map();
    for (const sprite of sprites)
      if (!this.options.has(`${sprite.pose}/${sprite.expression}`))
        this.options.set(`${sprite.pose}/${sprite.expression}`, sprite);
    for (const sprite of sprites) this.options.set(sprite.id, sprite);
    this.buffer = '';
    this.discarding = false;
    this.selected = null;
    this.controlsSeen = 0;
    this.textTail = '';
  }

  emitText(value, events, final = false) {
    const text = this.textTail + value;
    this.textTail = '';
    // Small models sometimes move the reserved flag to the end of their prose.
    // Hold only a possible suffix, so no partial flag reaches subtitles or TTS.
    // Ordinary prose (including ";listen carefully") is released on divergence.
    for (let at = text.indexOf(';'); at >= 0; at = text.indexOf(';', at + 1)) {
      const tail = text.slice(at);
      const complete = COMPLETE_LISTEN_SUFFIX.test(tail);
      if (
        tail.length <= MAX_CONTROL &&
        (complete || LISTEN_SUFFIX.startsWith(tail.toLowerCase()))
      ) {
        if (at) events.push({ type: 'text', text: text.slice(0, at) });
        if (!final) this.textTail = tail;
        else if (!complete) events.push({ type: 'text', text: tail });
        return;
      }
    }
    if (text) events.push({ type: 'text', text });
  }

  push(text) {
    this.buffer += text;
    const events = [];
    const emitText = (value) => {
      this.emitText(value, events);
    };
    while (this.buffer) {
      if (this.discarding) {
        const end = this.buffer.search(/[\]\n]/);
        if (end < 0) {
          this.buffer = '';
          break;
        }
        this.buffer = this.buffer.slice(end + 1);
        this.discarding = false;
        continue;
      }
      // Models sometimes invent XML-like closing tags. They are reserved
      // control text too, but cannot select an expression or open the mic.
      const marker = /\[(?:(\/)(?:avatar|аватар)(?::|(?=\]))|(?:avatar|аватар):)/iu.exec(
        this.buffer,
      );
      const start = marker?.index ?? -1;
      if (start < 0) {
        const lower = this.buffer.toLowerCase();
        let held = 0;
        for (let length = 1; length < MAX_START && length <= this.buffer.length; length++) {
          if (STARTS.some((marker) => lower.endsWith(marker.slice(0, length)))) held = length;
        }
        emitText(this.buffer.slice(0, this.buffer.length - held));
        this.buffer = held ? this.buffer.slice(-held) : '';
        break;
      }
      if (start > 0) {
        emitText(this.buffer.slice(0, start));
        this.buffer = this.buffer.slice(start);
      }
      const end = this.buffer.indexOf(']');
      const newline = this.buffer.indexOf('\n');
      if (newline >= 0 && (end < 0 || newline < end)) {
        this.controlsSeen++;
        this.buffer = this.buffer.slice(newline + 1);
        continue;
      }
      if (end < 0) {
        if (this.buffer.length <= MAX_CONTROL) break;
        this.controlsSeen++;
        this.buffer = '';
        this.discarding = true;
        break;
      }
      const frame = this.buffer.slice(marker[0].length, end);
      this.buffer = this.buffer.slice(end + 1);
      this.controlsSeen++;
      const [identity, listening, extra] = frame.split(';');
      const choice =
        !marker[1] &&
        end <= MAX_CONTROL &&
        extra === undefined &&
        (!listening || listening === 'listen') &&
        /^[a-z][a-z0-9_-]{0,39}(?:\/[a-z][a-z0-9_-]{0,39})?$/.test(identity)
          ? this.options.get(identity)
          : null;
      if (choice && !this.selected) {
        this.selected = choice;
        events.push({
          type: 'avatar',
          ...(listening === 'listen' ? { followUp: true } : {}),
          avatar: { id: choice.id, pose: choice.pose, expression: choice.expression },
        });
      }
    }
    return events;
  }

  finish() {
    const unfinished = STARTS.some(
      (marker) =>
        this.buffer.toLowerCase().startsWith(marker) ||
        (this.buffer.length > 1 && marker.startsWith(this.buffer.toLowerCase())),
    );
    const text = !this.discarding && !unfinished ? this.buffer : '';
    this.buffer = '';
    this.discarding = false;
    const events = [];
    this.emitText(text, events, true);
    return events;
  }
}
