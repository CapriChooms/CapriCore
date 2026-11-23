// SPDX-License-Identifier: GPL-3.0-only
export const conversationFollowUp = (text) =>
  /^(?:how about you|what about you|а ты|а у тебя|et toi|et vous|¿?y tú)\s*[?!.]*$/iu.test(
    text.trim(),
  );

/** Identify unambiguous social turns without swallowing commands. */
export function conversationOnly(text, routing) {
  if (routing?.mode === 'fast' && routing.reason === 'simple-dialogue') return true;
  if (typeof text !== 'string' || text.length > 100) return false;
  const greeting = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
  return (
    conversationFollowUp(greeting) ||
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

/** A read-only review of code supplied in chat needs no desktop or file tools. */
export function suppliedCodeReview(text) {
  const value = text.trim();
  const fence = /\r?\n\x60{3}[\w+-]*\r?\n[\s\S]+\r?\n\x60{3}$/u.exec(value);
  const lead = (fence ? value.slice(0, fence.index) : value)
    .trim()
    .replace(/[.!?:]$/u, '')
    .replace(/^(?:please|пожалуйста|por favor)[ ,]+/iu, '')
    .trimEnd();
  return [
    /^(?:review|explain)\s+(?:this|the following)\s+(?:code|snippet)$/iu,
    /^(?:проверь|разбери|объясни)\s+(?:этот|следующий)\s+код$/iu,
    /^(?:revise|analise|explique)\s+(?:este|esse|o seguinte)\s+c[oó]digo$/iu,
    /^(?:fa[cç]a\s+uma\s+)?revis[aã]o\s+(?:de|do)\s+c[oó]digo$/iu,
  ].some((pattern) => pattern.test(lead));
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
