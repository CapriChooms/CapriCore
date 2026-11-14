// SPDX-License-Identifier: GPL-3.0-only
import { conversationOnly } from './conversation-route.mjs';
import {
  computerModeRequest,
  dedicatedMusicRequest,
  mentionsComputerMode,
  rejectsDesktopAction,
} from './computer-mode-request.mjs';
import { isScientificExpression } from '../../integrations/desktop-actions/math-expression.mjs';

const number = String.raw`-?\d{1,60}(?:\.\d{1,60})?`;
const root = new RegExp(
  String.raw`^(?:(?:square root of|квадратный корень(?: из)?)\s+(${number})|(?:sqrt|√)\s*\(\s*(${number})\s*\)|√\s*(${number}))$`,
  'iu',
);

/** Route only a complete standalone expression. Mixed requests still go through the model. */
export function standaloneCalculation(text) {
  if (text.length > 280) return null;
  const value = text
    .trim()
    .replace(/^(?:capri|капри)[, ]+\s*/iu, '')
    .replace(
      /^(?:(?:please\s+)?use\s+(?:the\s+)?calculator|(?:пожалуйста[, ]+)?используй\s+калькулятор)(?:\s+and\s+|\s+и\s+|[,.:]\s*|\s+)/iu,
      '',
    )
    .replace(
      /^(?:please\s+|пожалуйста[, ]+)?(?:(?:what is|what's|calculate|compute|find)\s+(?:the\s+)?|(?:вычисли|посчитай|найди|чему равен)\s+)/iu,
      '',
    )
    .replace(/[.?]+$/u, '')
    .replace(
      /\s+(?:(?:via|using|with)\s+(?:the\s+)?calculator|через\s+калькулятор|на\s+калькуляторе|с\s+помощью\s+калькулятора)$/iu,
      '',
    )
    .trim()
    .replace(/\s+/gu, ' ');
  const match = root.exec(value);
  if (match) return `sqrt(${match[1] ?? match[2] ?? match[3]})`;
  return /[+*/^!%()×÷π²³-]|\bmod\b/u.test(value) && isScientificExpression(value) ? value : null;
}

function computerAccessDiscussion(text) {
  const value = text
    .trim()
    .replace(/^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu, '')
    .replace(/^(?:please|пожалуйста)[,\s]+/iu, '');
  if (
    /^(?:can|could|do)\s+you\s+(?:actually\s+)?(?:control|operate|use|have\s+access\s+to)\s+(?:(?:my|the|this)\s+)?(?:computer|pc|desktop)(?:\s+(?:right\s+)?now)?[?!.\s]*$/iu.test(
      value,
    ) ||
    /^(?:ты\s+)?(?:можешь|умеешь)\s+(?:управлять|пользоваться)\s+(?:(?:моим|этим|всем)\s+)?(?:компьютером|пк)[?!.\s]*$/iu.test(
      value,
    )
  )
    return true;
  if (!mentionsComputerMode(text.replace(/["“”«»]/gu, '')) || computerModeRequest(text))
    return false;
  const unquoted = text.replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/gu, '');
  if (
    unquoted
      .split(/[?？;.!]\s*/u)
      .slice(1)
      .some((part) => {
        const command = part
          .trim()
          .replace(/^(?:please|пожалуйста)[,\s]+/iu, '')
          .replace(/^(?:can|could|would)\s+you\s+(?:please\s+)?|^(?:можешь|можете)\s+/iu, '');
        return (
          computerModeRequest(part) ||
          /^(?:enable|disable|activate|deactivate|turn\s+(?:on|off)|open|launch|start|find|search|type|write|click|press|move|create|copy|delete|play|calculate|включи|выключи|отключи|открой|запусти|найди|введи|напиши|нажми|перемести|создай|скопируй|удали|посчитай)(?=\s)/iu.test(
            command,
          )
        );
      })
  )
    return false;
  // Discussing a permission is not an instruction to request it. Preserve the
  // positive command parser first, including polite questions such as "Could
  // you enable full computer access?", and leave unfamiliar app tasks alone.
  return (
    /^(?:what\s+(?:is|are|does|do|can|would|happens)|why\s+(?:do|does|did|are|is|have|would)|how\s+(?:does|do|is|can|would)|(?:do|did)\s+(?:you|i|we)|(?:is|are|was|were|has|have)\s|(?:can|could|would)\s+you\s+(?:please\s+)?(?:explain|describe|tell|say)|explain\s|describe\s|tell\s+me\s)/iu.test(
      value,
    ) ||
    /^(?:i\s+(?:(?:never|only|just)\s+(?:asked|wanted|said|questioned)|(?:did\s+not|didn['’]t)\s+ask)|you\s+(?:keep|always|continue)|no\s+matter\s+what\s+i\s+say|stop\s+(?:saying|telling|claiming|repeating|bringing\s+up))/iu.test(
      value,
    ) ||
    /^(?:почему\s|зачем\s|что\s+(?:такое|значит|означает|делает)|как\s+(?:работает|устроен|действует)|есть\s+ли\s|у\s+тебя\s|(?:можешь|можете)\s+(?:пожалуйста\s+)?(?:объяснить|рассказать)|объясни\s|расскажи\s|я\s+(?:не\s+просил[аи]?|никогда\s+не\s+просил[аи]?|(?:только|лишь)\s+спросил[аи]?)|ты\s+(?:опять|снова|постоянно|вс[её]\s+время|говоришь|повторяешь)|перестань\s+(?:говорить|повторять|писать))/iu.test(
      value,
    )
  );
}

/** Domain selection only. The model still chooses every action and argument. */
export function toolDomain(text, state, routing) {
  const value = String(text).normalize('NFKC');
  if (rejectsDesktopAction(value)) return 'conversation';
  if (computerAccessDiscussion(value)) return 'conversation';
  if (mentionsComputerMode(value)) return 'desktop';
  if (
    /\bspotify\b|спотиф/iu.test(value) &&
    /\b(?:click|press|drag|cursor|mouse|keyboard|button|search\s+bar|type|write)\b|нажми|кликни|перетащи|курсор|мыш[ьи]|клавиш|кнопк|введи|напиши/iu.test(
      value,
    )
  )
    return 'desktop';
  if (dedicatedMusicRequest(value))
    return state.spotify
      ? state.spotify.enabled && state.spotify.prepared
        ? 'spotify'
        : 'conversation'
      : null;
  if (
    /\bspotify\b|спотиф/iu.test(value) &&
    /^(?:do\s+you\s+have\s+access|can\s+you\s+(?:use|control)|у\s+тебя\s+есть\s+доступ|ты\s+можешь\s+управлять)/iu.test(
      value.trim(),
    )
  )
    return 'conversation';
  const temporal =
    /\b(?:timer|stopwatch|remind|reminder|alarm|schedule)\b|таймер|секундомер|напомни|будильник/iu.test(
      value,
    );
  const mathematics =
    /(?:\d\s*[-+*/^%]\s*\d)|\b(?:sqrt|square|squared|cube|cubed|root|logarithm|logarithmic|sine|cosine|tangent|factorial|plus|minus|divided by|multiplied by|calculate)\b|корень|корня|квадрат|возвед|логарифм|синус|косинус|плюс|минус/iu.test(
      value,
    );
  const nonMath =
    /\b(?:file|folder|directory|path|root access|root directory|square one|root for|root of the problem)\b|папк|файл|директор/iu.test(
      value,
    );
  const browserTask =
    /\b(?:chrome|edge|browser|search bar|address bar)\b|хром|браузер|адресн(?:ую|ой|ая) строк/iu.test(
      value,
    ) &&
    /\b(?:open|launch|start|type|write|enter|search|find|look up)\b|откро|откры|запуст|напиш|введи|найди|поищи/iu.test(
      value,
    );
  if (
    browserTask &&
    state.spotify?.enabled &&
    /\b(?:play|pause|resume|skip)\b.*\b(?:music|song|spotify)\b|включи.*музык/iu.test(value)
  )
    return null;
  if (!temporal && !nonMath && browserTask && state.fullComputerAccess) return 'desktop';
  if (
    !temporal &&
    !nonMath &&
    mathematics &&
    (state.applications?.calculator || state.fullComputerAccess)
  )
    return 'calculator';
  // A music topic is not a player action. Only an actual request above may
  // require a Spotify receipt; otherwise the normal model path can discuss it.
  return conversationOnly(value, routing) ? 'conversation' : null;
}
