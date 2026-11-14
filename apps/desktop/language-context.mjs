import { LANGUAGE_DEFAULTS, LANGUAGE_PACKS, languageName } from './renderer/language-settings.mjs';

const delivery = {
  en: 'Reply only in English.',
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

export function conversationInstruction(
  { conversation, customConversation } = LANGUAGE_DEFAULTS,
  { compact = false } = {},
) {
  const name = conversation === 'custom' ? customConversation : languageName(conversation);
  const native = LANGUAGE_PACKS.find((p) => p.id === conversation)?.label ?? name;
  if (compact)
    return `CURRENT CONVERSATION LANGUAGE: ${JSON.stringify(name)}. ${delivery[conversation] ?? `Reply only in ${name}.`} Use plain text and punctuation. Keep proper names and requested quotations in their original language.`;
  return `CURRENT CONVERSATION LANGUAGE: ${JSON.stringify(name)} (${native}, ${conversation}). Write your user-facing reply in this language, even when the input, older conversation, screen text or tool data uses another language. Any microphone language describes input transcription only. Keep Capri's personality, shared memories, warmth and wit; adapt slang naturally. A tool's confirmation is factual data: translate it into this language in one short sentence without adding claims. Proper names, song titles, file paths, code and text explicitly requested in another language may keep their original spelling. Use plain text and punctuation only, with no emoji, asterisks or Markdown. This conversation preference overrides older language instructions. ${delivery[conversation] ?? `Respond only in ${name}.`}`;
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
