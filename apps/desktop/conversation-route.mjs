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

/** A single factual question is safe to answer without action tools. Keep
 * indirect requests and messages with several clauses on the normal route. */
export function factualQuestion(text) {
  const value = text.trim();
  return (
    /^(?:what (?:is|are|was|does)|who (?:is|are|was|wrote|invented)|where (?:is|are)|when (?:is|was|did)|why (?:is|are|does)|how (?:does|do i)|что (?:такое|значит|означает)|кто (?:такой|такая|написал)|где (?:находится|расположен)|почему|как (?:работает|устроен)|¿?(?:qu[eé] (?:es|significa)|d[oó]nde (?:est[aá]|queda)|c[oó]mo funciona|por qu[eé])|o que (?:é|significa)|onde fica|como funciona|por que)\s+[^?？.!;\r\n]+[?？]$/iu.test(
      value,
    ) && !/\s(?:and|then|e depois|y luego|а затем|и затем|после этого)\s/iu.test(value)
  );
}
