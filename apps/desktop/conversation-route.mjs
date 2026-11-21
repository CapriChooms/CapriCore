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

/** Questions about the companion and follow-up instructions are requests for text. */
export function companionDialogueQuestion(text) {
  const value = text.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return (
    /^(?:(?:(?:hi|hey|hello),? )?(?:i['’]m|i am|my name is) [\p{L}][\p{L} '\-]{0,45}[.!] )?(?:who are you|what (?:can you do|do you do)|what can you help me with|can i (?:move|drag) you)[?!.]*$/iu.test(
      value,
    ) ||
    /^(?:кто ты|что ты умеешь|чем ты можешь помочь|можно ли тебя (?:переместить|перетащить))[?!.]*$/iu.test(
      value,
    ) ||
    /^(?:how (?:do i|can i) do (?:it|that)|как (?:мне )?это сделать)[?!.]*(?: (?:please )?tell me step by step[?!.]*)?$/iu.test(
      value,
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
