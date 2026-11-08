// SPDX-License-Identifier: GPL-3.0-only
/** Restrict unambiguous social turns to memory tools, preserving shared history. */
export function conversationOnly(text, routing) {
  if (routing?.mode === 'fast' && routing.reason === 'simple-dialogue') return true;
  if (typeof text !== 'string' || text.length > 100) return false;
  const greeting = text.normalize('NFKC').trim().toLowerCase();
  return (
    /^(?:(?:hey|hi|hello|привет|здравствуй)[, ]+)?(?:capri|капри)[,! ]*(?:(?:how are you|как дела)[?!.]*)?$/u.test(
      greeting,
    ) ||
    /^(?:(?:say|скажи)\s+)?(?:hi|hello|hey|привет|здравствуй)(?:[, ]+(?:capri|капри))?(?:\s+briefly)?[?!.]*$/u.test(
      greeting,
    )
  );
}
