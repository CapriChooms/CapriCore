// SPDX-License-Identifier: GPL-3.0-only
const closingPhrases = [
  /^(?:thank you|thanks)(?:(?: so| very) much| a lot| for (?:your help|the help|everything))?(?: (?:capri|that is all|that['’]s all|goodbye))?$/iu,
  /^(?:no thanks|no thank you|goodbye|bye|see you(?: later)?|that is all|that['’]s (?:all|enough)|good night)(?: capri)?$/iu,
  /^(?:спасибо(?: большое)?|большое спасибо)(?: (?:капри|это вс[её]|на этом вс[её]|пока))?$/iu,
  /^(?:нет спасибо|до свидания|до встречи|пока|это вс[её]|на этом вс[её]|спокойной ночи)(?: капри)?$/iu,
  /^(?:merci(?: beaucoup)?|au revoir|gracias(?: por todo)?|muchas gracias|adiós|obrigad[oa]|tchau|danke(?: schön)?|tschüss|grazie|arrivederci)$/iu,
];
const otherClosingPhrases = new Set([
  'дякую',
  'до побачення',
  'dziękuję',
  'do widzenia',
  'dank je',
  'tot ziens',
  'díky',
  'na shledanou',
  'ďakujem',
  'dovidenia',
  'благодаря',
  'довиждане',
  'hvala',
  'doviđenja',
  'хвала',
  'довиђења',
  'nasvidenje',
  'mulțumesc',
  'la revedere',
  'köszönöm',
  'viszlát',
  'ευχαριστώ',
  'αντίο',
  'tak',
  'farvel',
  'takk',
  'tack',
  'hej då',
  'kiitos',
  'näkemiin',
  'aitäh',
  'head aega',
  'paldies',
  'uz redzēšanos',
  'ačiū',
  'viso gero',
  'takk fyrir',
  'bless',
  'gràcies',
  'adéu',
  'شكرا',
  'شكرًا',
  'مع السلامة',
  'תודה',
  'להתראות',
  'ممنون',
  'خداحافظ',
  'شکریہ',
  'خدا حافظ',
  'धन्यवाद',
  'अलविदा',
  'ধন্যবাদ',
  'বিদায়',
  'நன்றி',
  'விடைபெறுகிறேன்',
  'ధన్యవాదాలు',
  'మళ్ళీ కలుద్దాం',
  'निरोप',
  'આભાર',
  'આવજો',
  'ਧੰਨਵਾਦ',
  'ਅਲਵਿਦਾ',
  '谢谢',
  '谢谢你',
  '再见',
  'ありがとう',
  'ありがとうございます',
  'さようなら',
  '감사합니다',
  '고마워요',
  '안녕히 계세요',
  'cảm ơn',
  'tạm biệt',
  'ขอบคุณ',
  'ขอบคุณค่ะ',
  'ขอบคุณครับ',
  'ลาก่อน',
  'terima kasih',
  'selamat tinggal',
  'salamat',
  'paalam',
  'teşekkürler',
  'teşekkür ederim',
  'hoşça kal',
  'asante',
  'kwaheri',
  'dankie',
  'totsiens',
]);

export function endsVoiceConversation(text) {
  const phrase = text
    .normalize('NFKC')
    .trim()
    .replace(/^(?:capri|капри)(?:[,\s]+|[.!?]\s+)/iu, '')
    .replace(/[\p{P}\s]+$/u, '')
    .replace(/[.,!?;:…\s]+/gu, ' ');
  return (
    otherClosingPhrases.has(phrase.toLowerCase()) ||
    closingPhrases.some((pattern) => pattern.test(phrase))
  );
}

/** Only the trusted microphone callback can create a voice-origin turn. */
export function wantsVoiceFollowUp({
  text,
  origin,
  enabled,
  sessionId,
  activeSessionId,
  afterAnyReply = false,
  ended = false,
}) {
  const reply = typeof text === 'string' ? text.trim() : '';
  return Boolean(
    enabled &&
      !ended &&
      origin === 'microphone' &&
      sessionId &&
      sessionId === activeSessionId &&
      reply &&
      (afterAnyReply || /[?？؟][\s\p{Pe}\p{Pf}"'»]*$/u.test(reply)),
  );
}
