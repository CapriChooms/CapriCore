import { LANGUAGE_DEFAULTS, languageName } from './renderer/language-settings.mjs';
import { LANGUAGE_PACKS } from './renderer/language-settings.mjs';

const delivery = {
  en: 'Reply only in English. Speech recognition language controls input transcription, not reply or voice language. Translate the meaning of non-English input into a natural English reply; never copy a whole foreign-language answer into the English voice.',
  ru: 'Отвечай только на русском языке.',
  ja: '必ず日本語だけで答えてください。',
  zh: '请只用中文回答。',
  de: 'Antworte ausschließlich auf Deutsch.',
  fr: 'Réponds uniquement en français.',
  es: 'Responde únicamente en español.',
  pt: 'Responda apenas em português.',
  it: 'Rispondi soltanto in italiano.',
  ko: '반드시 한국어로만 대답하세요.',
  ar: 'أجب باللغة العربية فقط.',
  hi: 'केवल हिन्दी में उत्तर दें।',
  he: 'עני רק בעברית.',
};

export function conversationInstruction(value = LANGUAGE_DEFAULTS) {
  const name =
    value.conversation === 'custom' ? value.customConversation : languageName(value.conversation);
  const native = LANGUAGE_PACKS.find((p) => p.id === value.conversation)?.label ?? name;
  return `CURRENT CONVERSATION LANGUAGE: ${JSON.stringify(name)} (${native}, ${value.conversation}). Write your entire user-facing reply in this language, even if the user's message or older conversation uses another language. Keep Capri's personality, shared memories, warmth and wit; adapt slang naturally instead of forcing English catchphrases. Do not add an English translation unless requested. A tool's confirmation is factual data: translate it into this language in one short sentence without adding claims. Proper names, song titles, file paths and code may keep their original spelling. Use plain text and punctuation only, with no emoji, asterisks or Markdown. This language choice applies to this interface and overrides older delivery instructions. Final answer language: ${name}. ${delivery[value.conversation] ?? `Respond only in ${name}.`}`;
}

export const VOICE_PREVIEWS = Object.freeze({
  en: 'Hey choom, I am right here. How does this sound?',
  ru: 'Привет, чумба. Я рядом. Как тебе мой голос?',
  de: 'Hey, ich bin hier. Wie klingt meine Stimme?',
  fr: 'Salut, je suis là. Tu aimes ma voix ?',
  es: 'Hola, estoy aquí. ¿Qué te parece mi voz?',
  pt: 'Olá, estou aqui. O que acha da minha voz?',
  it: 'Ciao, sono qui. Come ti sembra la mia voce?',
  nl: 'Hoi, ik ben hier. Hoe klinkt mijn stem?',
  ja: 'こんにちは。ここにいるよ。私の声はどう？',
  zh: '嗨，我就在这里。你觉得我的声音怎么样？',
  ko: '안녕, 나 여기 있어. 내 목소리 어때?',
  ar: 'مرحباً، أنا هنا. كيف يبدو صوتي؟',
  he: 'שלום, אני כאן. איך הקול שלי נשמע?',
  hi: 'नमस्ते, मैं यहीं हूँ। मेरी आवाज़ कैसी लग रही है?',
  da: 'Hej, jeg er her. Hvordan lyder min stemme?',
  fi: 'Hei, olen täällä. Miltä ääneni kuulostaa?',
  no: 'Hei, jeg er her. Hvordan høres stemmen min ut?',
  sv: 'Hej, jag är här. Hur låter min röst?',
  pl: 'Hej, jestem tutaj. Jak brzmi mój głos?',
  tr: 'Selam, buradayım. Sesim nasıl geliyor?',
  el: 'Γεια σου, είμαι εδώ. Πώς σου φαίνεται η φωνή μου;',
  ms: 'Hai, saya di sini. Bagaimana suara saya?',
  sw: 'Habari, niko hapa. Sauti yangu inasikika vipi?',
});
