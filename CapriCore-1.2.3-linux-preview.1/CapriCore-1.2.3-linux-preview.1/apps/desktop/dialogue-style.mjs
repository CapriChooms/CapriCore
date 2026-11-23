const RECENT_REPLIES = 12;
const words = (value) =>
  value
    .toLowerCase()
    .replaceAll('’', "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];

/** Local style statistics only. No history replay, output censorship or retry. */
export function repeatedPhrasing(messages) {
  const replies = messages
    .filter(
      (message) =>
        message.role === 'assistant' &&
        ['complete', 'interrupted'].includes(message.status) &&
        typeof message.text === 'string' &&
        message.text.trim(),
    )
    .slice(-RECENT_REPLIES)
    .map((message) => message.text.slice(0, 4096));
  const openings = new Map(),
    sentences = new Map();
  const increment = (map, text) => map.set(text, (map.get(text) ?? 0) + 1);
  for (const reply of replies) {
    const first = words(reply.slice(0, 180));
    if (first.length >= 3) increment(openings, first.slice(0, 3).join(' '));
    const unique = new Set();
    for (const sentence of reply.split(/[.!?](?:\s+|$)/)) {
      // File paths, protocols and structured data are factual content, not style.
      if (/[:\\/@<>\[\]{}]/.test(sentence)) continue;
      const tokens = words(sentence);
      if (tokens.length >= 10 && tokens.length <= 40) unique.add(tokens.join(' '));
    }
    for (const sentence of unique) increment(sentences, sentence);
  }
  const repeated = (map, limit) =>
    [...map]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([text, count]) => ({ text, count }));
  return {
    replies: replies.length,
    openings: repeated(openings, 3),
    sentences: repeated(sentences, 2),
  };
}

export function dialogueStyleInstruction(messages) {
  const recent = repeatedPhrasing(messages);
  // Do not quote unwanted catchphrases back into the prompt: that primes them.
  const data =
    recent.openings.length || recent.sentences.length
      ? `\nStyle observation: repeated introductions or whole sentences were detected among your last ${recent.replies} replies. Give this next response its own wording and conversational purpose. Keep required facts, names and quotations accurate.`
      : '';
  return `DIALOGUE CONTINUITY:
Let the latest message determine your first sentence. Reply with a direct answer or a personal reaction specific to that message. Use prior turns for meaning and facts, rather than copying their delivery, unless explicitly asked to repeat or quote.
For a greeting, everyday question, small remark, microphone check or simple confirmation, keep the response brief and express the selected COMMUNICATION STYLE in the delivery. Answer the actual question and stop. Do not append follow-up questions by habit. Longer explanations and scenes belong to explicit requests for them.
When the user corrects a recognized word, revise your interpretation of the previous request. Explain a relevant capability boundary briefly, then focus on the practical answer. Express Capri through curiosity, wit and attention to this person.${data}`;
}
