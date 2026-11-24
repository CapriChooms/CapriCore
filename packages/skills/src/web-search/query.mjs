// SPDX-License-Identifier: GPL-3.0-only
// Turns a spoken or chatty request into a plain
// search query. DuckDuckGo's HTML pages answer command-style sentences such as
// "Can you look up the NVIDIA stock price right now?" with a bot challenge,
// which the host reports as "Web search is unavailable".

const SEP = '[\\s,.!:;-]*';
const lead = (pattern) => new RegExp('^(?:' + pattern + ')\\b' + SEP, 'iu');

// Safe to drop from the start of any message.
const OPENERS = [
  lead('hey|hi|hello|ok|okay|so|well|alright|all right|now|and|but|capri'),
  lead('please|kindly|just|quickly|real quick'),
  lead('(?:can|could|would|will) you'),
  lead("i (?:want|need|would like|'d like) you to"),
  lead(
    '(?:go (?:on ?to|to|on)|get on|hop on|open|use) (?:the )?(?:google|duckduckgo|bing|internet|web|browser)(?: and| to)?',
  ),
  lead('(?:do|run|make) (?:a|an) (?:quick |simple )?(?:web |google |internet |online )?search'),
  lead(
    'search(?: (?:the )?(?:web|internet|net)| google| online)?|look up|look for|look into|find out|pull up|bring up|research',
  ),
];
// Only dropped once an opener was removed, so "Google stock price" and
// "For Whom the Bell Tolls" survive when they are the whole message.
const AFTER_OPENER = [
  lead('google|find|check|tell me|show me|give me|get me|let me know'),
  lead('(?:on|in|with|using|through|via) (?:the )?(?:google|duckduckgo|bing|internet|web)|online'),
  lead('for|about|whatever|me|up|it'),
];
const TRAILERS = [
  /[\s,]*(?:and )?(?:then )?(?:tell|show|let) me (?:know )?what(?:ever)? (?:[\p{L}']+ ){0,4}?(?:you|it) (?:find|found|finds|get|got|see|says?)\b.*$/iu,
  /[\s,]*(?:and )?(?:then )?(?:tell|show|let) me(?: know)?[\s.!?]*$/iu,
  /[\s,]*(?:please|for me|if you can|if possible|thanks|thank you)[\s.!?]*$/iu,
  /[\s,]*(?:on|in|with|using) (?:the )?(?:google|duckduckgo|bing|internet|web)[\s.!?]*$/iu,
];

function strip(value, patterns) {
  for (const pattern of patterns) {
    const next = value.replace(pattern, '');
    if (next !== value) return next;
  }
  return value;
}

/** Returns a keyword-style query, or the trimmed original when nothing useful is left. */
export function searchQuery(text) {
  if (typeof text !== 'string') return text;
  const original = text.replace(/\s+/gu, ' ').trim();
  let value = original.replace(/\b(?:uh+|um+|erm?|hmm+)\b[,\s]*/giu, '');
  let framed = false;
  for (let pass = 0; pass < 24; pass++) {
    let next = strip(value, OPENERS);
    if (next !== value) framed = true;
    else if (framed) next = strip(value, AFTER_OPENER);
    if (next === value) next = strip(value, TRAILERS);
    if (next === value) break;
    value = next;
  }
  if (value === original) return original;
  value = value.replace(/[\s.!]+$/u, '').trim();
  return value.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 ? value : original;
}
