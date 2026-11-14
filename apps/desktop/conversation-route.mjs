// SPDX-License-Identifier: GPL-3.0-only
/** Identify unambiguous social turns without swallowing commands or follow-ups. */
export function conversationOnly(text, routing) {
  if (routing?.mode === 'fast' && routing.reason === 'simple-dialogue') return true;
  if (typeof text !== 'string' || text.length > 100) return false;
  const greeting = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
  return (
    /^(?:how are you(?: doing)?|how(?:['’]s| is) it going|как (?:дела|ты|жизнь)|comment (?:vas-tu|ça va)|¿?cómo estás|wie geht(?:['’]s| es dir))\s*[?!.]*$/u.test(
      greeting,
    ) ||
    /^(?:(?:hey|hi|hello|привет|здравствуй)[,! ]+)?(?:capri|капри)[,! ]*(?:(?:how are you(?: doing)?|как (?:твои )?дела|как ты)[?!.]*)?$/u.test(
      greeting,
    ) ||
    /^(?:(?:say|скажи)\s+)?(?:hi|hello|hey|привет|здравствуй)(?:[, ]+(?:capri|капри))?(?:\s+briefly)?[?!.]*$/u.test(
      greeting,
    ) ||
    /^(?:bonjour|salut|coucou|hola|buenas|hallo|guten tag|olá|ola|oi|ciao|buongiorno|merhaba|你好|您好|こんにちは|안녕|안녕하세요|مرحبا)(?:[,，! ]*(?:capri|капри))?[?!.！。]*$/u.test(
      greeting,
    )
  );
}
