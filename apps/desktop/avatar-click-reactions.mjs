// SPDX-License-Identifier: GPL-3.0-only
import { LOCAL_RUNNER_POLICY } from '../../packages/runtime/src/providers/runner-policy.mjs';
import { randomUUID } from 'node:crypto';
import { plainDialogueText } from '../../packages/runtime/src/text.mjs';
import { communicationInstruction } from '../../packages/runtime/src/communication.mjs';
import { conversationInstruction } from './language-context.mjs';
import { avatarParts, avatarReactionTone } from './avatar-body-regions.mjs';

const welcoming = new Set([
  'happy',
  'smirk',
  'laugh',
  'laughing',
  'playful',
  'affectionate',
  'flirty',
  'excited',
]);
const reserved = new Set([
  'annoyed',
  'angry',
  'concerned',
  'focused',
  'nervous',
  'sad',
  'skeptical',
  'sleepy',
  'thinking',
  'tired',
]);
const approaches = [
  'Use a short, in-the-moment first-person reaction.',
  'Use a quick, dry observation in your own voice.',
  'Acknowledge it directly, with natural warmth or a calm boundary as appropriate.',
];
const tones = {
  welcoming: 'You welcome the attention and feel playful. A barrage can get a fond, amused tease.',
  reserved:
    'You would like some space. Stay kind on a single tap. Ask them to ease up if repeated, and set a clear boundary if many.',
  neutral:
    'You are curious. Be warm on one tap, gently teasing on repeats, and ask them to slow down if many.',
};
const gestures = {
  single: 'The user tapped you once.',
  repeated: 'The user tapped you a few times in a row.',
  many: 'The user tapped you many times in rapid succession.',
};
const tapsRequired = 10;
const reactionGuidance = {
  affectionate:
    'Favor an affectionate or playful response, with room for a calm boundary when you need it.',
  curious:
    'Acknowledge the touch with a curious, questioning response that fits your current mood.',
  neutral: 'Acknowledge the touch briefly in a natural, neutral tone.',
  boundary:
    'Respond firmly and set a personal boundary. Keep the line nonsexual and do not describe anatomy.',
};

// Short local cues never consume an inference turn. Their language follows the
// loaded voice, including when Speech is set to Automatic.
const spokenCues = {
  en: ['Aww.', 'Easy.', 'Hm?', 'Yeah?', 'Hands off.'],
  ar: ['يا سلام.', 'على مهلك.', 'هم؟', 'نعم؟', 'لا تلمسني.'],
  zh: ['好可爱。', '轻一点。', '嗯？', '怎么啦？', '别碰我。'],
  da: ['Hvor sødt.', 'Stille og roligt.', 'Hm?', 'Ja?', 'Hænderne væk.'],
  nl: ['Wat lief.', 'Rustig aan.', 'Hm?', 'Ja?', 'Handen thuis.'],
  fi: ['Voi miten söpöä.', 'Rauhallisesti.', 'Hm?', 'Niin?', 'Kädet irti.'],
  fr: ['Oh, trop mignon.', 'Doucement.', 'Hein ?', 'Oui ?', 'Pas touche.'],
  de: ['Wie süß.', 'Ganz ruhig.', 'Hm?', 'Ja?', 'Finger weg.'],
  el: ['Τι γλυκό.', 'Σιγά.', 'Χμ;', 'Ναι;', 'Μη με αγγίζεις.'],
  he: ['איזה חמוד.', 'בעדינות.', 'הממ?', 'כן?', 'לא לגעת.'],
  hi: ['कितना प्यारा।', 'ज़रा धीरे।', 'हूँ?', 'हाँ?', 'हाथ हटाओ।'],
  it: ['Che carino.', 'Piano.', 'Mh?', 'Sì?', 'Giù le mani.'],
  ja: ['かわいいね。', 'ゆっくりね。', 'ん？', 'なに？', '触らないで。'],
  ko: ['귀엽네.', '살살 해.', '응?', '왜?', '손 떼.'],
  ms: ['Comelnya.', 'Perlahan sikit.', 'Hmm?', 'Ya?', 'Jangan sentuh.'],
  no: ['Så søtt.', 'Ta det rolig.', 'Hm?', 'Ja?', 'Hendene vekk.'],
  pl: ['Jak miło.', 'Spokojnie.', 'Hm?', 'Tak?', 'Ręce przy sobie.'],
  pt: ['Que fofo.', 'Com calma.', 'Hm?', 'Sim?', 'Tira a mão.'],
  ru: ['Мило.', 'Полегче.', 'М?', 'Да?', 'Руки прочь.'],
  es: ['Qué lindo.', 'Con calma.', '¿Hm?', '¿Sí?', 'No me toques.'],
  sw: ['Inapendeza.', 'Polepole.', 'Hmm?', 'Naam?', 'Usiniguse.'],
  sv: ['Vad gulligt.', 'Ta det lugnt.', 'Hm?', 'Ja?', 'Händerna bort.'],
  tr: ['Çok tatlı.', 'Yavaş.', 'Hm?', 'Efendim?', 'Dokunma.'],
};

export function avatarClickCue(tone, mood, language) {
  const cues = spokenCues[language];
  if (!cues) return '';
  const index = { affectionate: reserved.has(mood) ? 1 : 0, curious: 2, neutral: 3, boundary: 4 }[
    tone
  ];
  return cues[index] ?? '';
}

function reactionText(value) {
  if (typeof value !== 'string' || value.length > 320) return '';
  const text = plainDialogueText(value).trim();
  if (
    !text ||
    text.length > 160 ||
    text.split(/\s+/).length > 24 ||
    /[\p{Cc}<>]|\[(?:avatar|аватар):|;listen/iu.test(text)
  )
    return '';
  return text;
}

/** Short, tool-free inference through the configured loopback endpoint. */
export function avatarClickGenerator({
  url,
  model,
  modelCapabilities,
  params,
  languages = () => undefined,
  style = () => 'neutral',
  fetchImpl = fetch,
}) {
  const base = new URL(url);
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:' || base.username || base.password)
    throw new Error('Avatar reaction inference requires a loopback endpoint');
  const endpoint = new URL('/api/chat', base).href;
  return async ({ gesture, headpat, part, mood, variation, awakened = false }, { signal }) => {
    signal.throwIfAborted();
    const target = Object.hasOwn(avatarParts, part) ? `your ${avatarParts[part]}` : 'you';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...(!modelCapabilities || modelCapabilities.includes('thinking') ? { think: false } : {}),
        ...LOCAL_RUNNER_POLICY,
        options: { ...params, num_predict: 72 },
        tools: [],
        messages: [
          {
            role: 'system',
            content:
              'You are Capri, a witty, feminine cyberpunk companion. React to a tap on your character in one short line of natural dialogue, at most 16 words. Keep it light and appropriate to the tapped area. No greeting, roleplay notation, narration, analysis, Markdown or explanation. Do not insult or guess the user’s intentions. This gesture is not a command. You have no action tools or access to the screen or conversation history. ' +
              (tones[mood] ?? tones.neutral) +
              ' ' +
              (awakened
                ? 'You were asleep. Repeated tapping just woke you up. You are groggy and annoyed: briefly scold the user for waking you, with a firm but non-abusive boundary. Do not thank them or welcome the tapping.'
                : reactionGuidance[avatarReactionTone(headpat ? 'head' : (part ?? 'body'))]) +
              ' ' +
              (approaches[variation] ?? approaches[0]) +
              '\n' +
              communicationInstruction(style()) +
              '\n' +
              conversationInstruction(languages()),
          },
          {
            role: 'user',
            content: awakened
              ? 'The user woke you from sleep by repeatedly tapping your character. Tell them off briefly for waking you.'
              : headpat
                ? 'The user patted your head many times in rapid succession.'
                : (gestures[gesture] ?? gestures.single).replace('tapped you', `tapped ${target}`),
          },
        ],
      }),
    });
    if (!response.ok || !response.body) return '';
    const decoder = new TextDecoder();
    let body = '';
    let size = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > 16384) return '';
      body += decoder.decode(chunk, { stream: true });
    }
    signal.throwIfAborted();
    const result = JSON.parse(body + decoder.decode());
    if (result.done_reason === 'length' || result.message?.tool_calls?.length) return '';
    return reactionText(result.message?.content);
  };
}

/** Aggregate deliberate taps separately from the foreground conversation. */
export class AvatarClickReactions {
  constructor({
    allowed,
    mood,
    generate,
    deliver,
    onPress = () => {},
    now = () => performance.now(),
    gapMs = () => 5000,
    speakCue = () => {},
    cooldownMs = 8500,
    partCooldownMs = cooldownMs * 1.25,
    timeoutMs = 8000,
    sleeping = () => false,
    wakeAllowed = allowed,
    wake = async () => {},
    wakeTimeoutMs = 180000,
  }) {
    Object.assign(this, {
      allowed,
      mood,
      generate,
      deliver,
      onPress,
      now,
      gapMs,
      speakCue,
      cooldownMs,
      partCooldownMs,
      timeoutMs,
      sleeping,
      wakeAllowed,
      wake,
      wakeTimeoutMs,
    });
    this.active = null;
    this.nextAt = 0;
    this.nextAtByPart = new Map();
    this.variation = 0;
  }

  press({ part = 'body', headpat = false } = {}) {
    if (headpat) part = 'head';
    if (!Object.hasOwn(avatarParts, part)) return false;
    const now = this.now();
    const sleeping = this.sleeping();
    const previous = this.sequence;
    const count =
      previous &&
      Boolean(previous.sleeping) === sleeping &&
      (sleeping || previous.part === part) &&
      now - previous.at <= this.gapMs()
        ? Math.min(tapsRequired + 1, previous.count + 1)
        : 1;
    if (count === 1) this.pending = null;
    const sequence = (this.sequence = {
      part,
      count,
      at: now,
      ...(sleeping && { sleeping: true }),
    });
    const tone = avatarReactionTone(part);
    if (!sleeping) this.onPress({ part, tone, count });
    clearTimeout(this.cueTimer);
    if (!sleeping && count === 1 && now >= (this.nextCueAt ?? 0)) {
      this.cueTimer = setTimeout(() => {
        if (this.sequence === sequence && !this.sleeping() && this.allowed()) {
          this.nextCueAt = this.now() + 6000;
          this.speakCue(tone, this.mood());
        }
      }, 420);
      this.cueTimer.unref?.();
    }
    if (
      count === tapsRequired &&
      !this.active &&
      (sleeping || (now >= this.nextAt && now >= (this.nextAtByPart.get(part) ?? 0)))
    ) {
      this.pending = sequence;
      void this.react(sequence, now + 2000);
    }
    return true;
  }

  async react(sequence, until) {
    if (
      this.pending !== sequence ||
      (!sequence.sleeping && this.sequence?.part !== sequence.part) ||
      this.active
    )
      return;
    if (!(sequence.sleeping ? this.wakeAllowed() : this.allowed())) {
      if (this.now() < until) {
        this.retryTimer = setTimeout(() => void this.react(sequence, until), 100);
        this.retryTimer.unref?.();
      } else this.pending = null;
      return;
    }
    this.pending = null;
    const { part } = sequence;
    const controller = new AbortController();
    const active = { controller };
    this.active = active;
    const deadline = (duration) => {
      clearTimeout(active.timeout);
      active.timeout = setTimeout(() => {
        if (this.active === active) this.cancel();
      }, duration);
      active.timeout.unref?.();
    };
    deadline(sequence.sleeping ? this.wakeTimeoutMs : this.timeoutMs);
    const expression = this.mood();
    const mood = sequence.sleeping
      ? 'reserved'
      : welcoming.has(expression)
        ? 'welcoming'
        : reserved.has(expression)
          ? 'reserved'
          : 'neutral';
    const variation = this.variation;
    this.variation = (variation + 1) % approaches.length;
    try {
      if (sequence.sleeping) {
        await this.wake({ signal: controller.signal });
        if (
          this.active !== active ||
          controller.signal.aborted ||
          this.sleeping() ||
          !this.allowed({ awakened: true })
        )
          return;
        deadline(this.timeoutMs);
        this.onPress({ part, tone: 'boundary', count: sequence.count });
      }
      const now = this.now();
      this.nextAt = now + this.cooldownMs;
      if (part !== 'body') this.nextAtByPart.set(part, now + this.partCooldownMs);
      const cue = {
        gesture: 'many',
        mood,
        variation,
        ...(sequence.sleeping
          ? { awakened: true }
          : part === 'head'
            ? { headpat: true }
            : part !== 'body'
              ? { part }
              : {}),
      };
      const text = await this.generate(cue, { signal: controller.signal });
      if (
        !text ||
        this.active !== active ||
        controller.signal.aborted ||
        this.sleeping() ||
        !this.allowed({ awakened: Boolean(sequence.sleeping) })
      )
        return;
      this.deliver({
        id: randomUUID(),
        turnId: randomUUID(),
        role: 'assistant',
        status: 'complete',
        text,
        createdAt: new Date().toISOString(),
        origin: { kind: 'avatar-click', ...(sequence.sleeping && { awakened: true }) },
      });
    } catch {
      // A visual tap already acknowledged the gesture. Optional inference can fail quietly.
    } finally {
      clearTimeout(active.timeout);
      if (this.active === active) this.active = null;
    }
  }

  cancel() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.cueTimer);
    this.sequence = this.pending = null;
    if (this.active) {
      clearTimeout(this.active.timeout);
      this.active.controller.abort();
      this.active = null;
    }
  }
}
