// SPDX-License-Identifier: GPL-3.0-only
import {
  dedicatedMusicRequest,
  mentionsComputerMode,
  namedSpotifyPlay,
  rejectsDesktopAction,
  spotifyPlaybackCandidate,
} from './computer-mode-request.mjs';

const service = String.raw`(?:you\s*tube\s+music|yt\s*music|ютуб[ -]?(?:музыка|мьюзик)|music\.youtube\.com)`;
const mentioned = new RegExp(`(?<![\\p{L}\\p{N}])${service}(?![\\p{L}\\p{N}])`, 'iu');
const beforeService = new RegExp(
  `(?:^|\\s)(?:(?:on|in|of|for|with|using|via|в|на|через|sur|dans|en|no|na|im|bei|auf)\\s+)?(?:my\\s+)?${service}$`,
  'iu',
);
const serviceFirst = new RegExp(
  `^(?:(?:open|launch|открой|запусти|abre|ouvre)\\s+)?${service}(?:\\s+(?:and|и|et|y))?\\s+`,
  'iu',
);
const inlineService = new RegExp(
  `\\s+(?:(?:in|on|of|for|в|на|sur|en)\\s+)?${service}(?=\\s|$)`,
  'iu',
);
const spotify = /\bspotify\b|спотиф/iu;
const anotherPlayer = /\byoutube\b|\b(?:apple music|deezer|soundcloud|tidal)\b|ютуб/iu;
const quoted = /"[^"\r\n]*"|“[^”\r\n]*”|«[^»\r\n]*»/gu;

const commands = [
  [
    'pause',
    /^(?:pause|stop|приостанови|останови|пауза|pausa|pausar)(?:\s+(?:the )?(?:music|playback|музыку|воспроизведение))?$/iu,
  ],
  [
    'resume',
    /^(?:resume|continue|продолжи|возобнови)(?:\s+(?:the )?(?:music|playback|музыку|воспроизведение))?$/iu,
  ],
  [
    'next',
    /^(?:play (?:the )?)?(?:next|skip)(?:\s+(?:the |this )?(?:song|track))?$|^(?:следующ(?:ий трек|ая песня|ую песню)|переключи трек)$/iu,
  ],
  [
    'previous',
    /^(?:play (?:the )?)?previous(?:\s+(?:song|track))?$|^предыдущ(?:ий трек|ая песня|ую песню)$/iu,
  ],
  [
    'status',
    /^(?:what(?:'s|’s| is) (?:currently )?playing|(?:what|which) (?:song|track) is (?:currently )?playing|(?:playback )?status|что (?:сейчас )?играет|какая песня (?:сейчас )?играет)$/iu,
  ],
];
const open = /^(?:open|launch|открой|запусти|abre|ouvre|öffne|abra)$/iu;
const play =
  /^(?:play|put on|turn on|включи|поставь|воспроизведи|проиграй|joue|mets|reproduce|pon|toca|spiele)\s+(.+)$/iu;
const search =
  /^(?:search(?: for)?|find|найди|поищи|cherche|recherche|busca|procure|suche)\s+(.+)$/iu;
const genericMusic =
  /^(?:(?:me )?(?:(?:(?:some|any|the|good|nice|great)\s+)*(?:music|tunes)|something|anything)|playback|(?:мне )?(?:(?:какую-нибудь|любую|хорошую)\s+)*музыку|(?:de la |un peu de )?musique|(?:algo de |alguna |alguma )?música|(?:etwas |ein bisschen )?musik)$/iu;
const nonMusicPlay = /^(?:(?:a |the )?(?:game|video)|chess|шахматы|игру|видео)(?:\s|$)/iu;
// Match the complete artist/title pair so a different track named Drayton is kept intact.
const dreiton = /^c[\s-]*(?:418|four\s+one\s+eight|4\s+1\s+8)[\s–—-]+(?:dreiton|drayton)$/iu;

const volumeTarget = String.raw`(?:(?:the\s+)?(?:(?:music|playback)\s+)?volume|громкость(?:\s+(?:музыки|воспроизведения))?)`;
const absoluteVolume = new RegExp(
  String.raw`^(?:(?<verb>set|adjust|change|turn|make|установи|поставь|сделай|настрой)\s+)?${volumeTarget}(?:\s+(?<amount>.+))?$`,
  'iu',
);
const relativeVolume = new RegExp(
  String.raw`^(?:(?<increase>increa?sed?|raise[ds]?|turn\s+up|прибавь|увеличь)|(?:decrea?sed?|lower(?:ed)?|reduce[ds]?|turn\s+down|убавь|уменьши))\s+${volumeTarget}(?:\s+(?<amount>.+))?$`,
  'iu',
);
const spokenNumbers = [
  [
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
      ' ',
    ),
    'twenty thirty forty fifty sixty seventy eighty ninety'.split(' '),
  ],
  [
    'ноль один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать'.split(
      ' ',
    ),
    'двадцать тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто'.split(' '),
  ],
];

function volumePercent(text) {
  if (!text) return;
  const amount = text
    .replace(/(?:\s*%|\s+(?:percent|per\s+cent|процент(?:а|ов)?))$/iu, '')
    .trim()
    .toLowerCase();
  if (/^\d{1,3}$/u.test(amount)) return Number(amount) <= 100 ? Number(amount) : undefined;
  if (/^(?:(?:one\s+|a\s+)?hundred|сто|ста)$/u.test(amount)) return 100;
  const [first, second, ...rest] = amount.split(/[\s-]+/u);
  if (rest.length > 0) return;
  for (const [units, tens] of spokenNumbers) {
    const unit = units.indexOf(first);
    if (!second && unit >= 0) return unit;
    const ten = tens.indexOf(first);
    const last = second ? units.indexOf(second) : 0;
    if (ten >= 0 && last >= 0 && last < 10) return (ten + 2) * 10 + last;
  }
}

function volumeCommand(subject) {
  const relative = relativeVolume.exec(subject)?.groups;
  if (relative) {
    if (
      !relative.amount ||
      /^(?:a\s+(?:bit|little)|slightly|чуть|немного)$/iu.test(relative.amount)
    )
      return { action: 'volume', delta: relative.increase ? 10 : -10 };
    const target = /^(?:to|at|до)\s+/iu;
    const amount = volumePercent(relative.amount.replace(/^(?:to|at|by|до|на)\s+/iu, ''));
    if (amount === undefined) return null;
    return target.test(relative.amount)
      ? { action: 'volume', value: amount }
      : { action: 'volume', delta: relative.increase ? amount : -amount };
  }
  const absolute = absoluteVolume.exec(subject)?.groups;
  if (absolute) {
    const amount = volumePercent(absolute.amount?.replace(/^(?:to|at|до|на)\s+/iu, ''));
    if (amount !== undefined) return { action: 'volume', value: amount };
    if (absolute.verb) return null;
  }
}

function trackQuery(value) {
  const query = value
    ?.replace(/^(?:me |мне )?(?:(?:the )?(?:song|track) |(?:песню|трек) )?/iu, '')
    .replace(/^["«“]|["»”]$/gu, '')
    .trim();
  return query && query.length <= 180 && !/[\x00-\x1f{}<>;`]/u.test(query) ? query : null;
}

function musicCommand(subject, explicit, track, playbackCandidate) {
  if (explicit && open.test(subject)) return { action: 'open' };
  const control = commands.find(([, pattern]) => pattern.test(subject));
  if (control) return { action: control[0] };
  if (explicit && /^(?:play|включи|поставь)$/iu.test(subject)) return { action: 'start' };
  if (/^(?:mute|выключи звук)$/iu.test(subject)) return { action: 'volume', value: 0 };
  if (/^(?:quieter|(?:чуть |немного )?потише)$/iu.test(subject))
    return { action: 'volume', delta: -10 };
  if (/^(?:louder|(?:чуть |немного )?погромче)$/iu.test(subject))
    return { action: 'volume', delta: 10 };
  const generic = track ?? /^start(?: playing)?\s+(.+)$/iu.exec(subject)?.[1];
  if (generic && genericMusic.test(generic)) return { action: 'start' };
  const query = trackQuery(track ?? (explicit ? search.exec(subject)?.[1] : undefined));
  if (query && (explicit || playbackCandidate) && dreiton.test(query))
    return { action: track ? 'play' : 'search', query: 'C418 Dreiton' };
  if (!explicit) return namedSpotifyPlay(subject);
  return query ? { action: track ? 'play' : 'search', query } : null;
}

export function youtubeMusicRequest(text, { youtubeMusic, spotify: spotifyState } = {}) {
  const value = text.normalize('NFKC').trim();
  const scope = value.replace(quoted, '');
  const explicit = mentioned.test(scope);
  const preferredPlayer =
    youtubeMusic?.enabled &&
    (youtubeMusic.preferred || !spotifyState?.enabled || !spotifyState?.prepared) &&
    !spotify.test(scope) &&
    !anotherPlayer.test(scope);
  if (
    (!explicit && !preferredPlayer) ||
    value.length > 500 ||
    mentionsComputerMode(scope) ||
    rejectsDesktopAction(scope)
  )
    return null;

  const request = value
    .replace(/^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu, '')
    .replace(
      /^(?:please[ ,]+|(?:can|could|would) you (?:please )?|пожалуйста[ ,]+|можешь\s+|peux-tu\s+|por favor[ ,]+)/iu,
      '',
    )
    .replace(/[.!?。！？\s]+$/u, '')
    .replace(/[ ,]+(?:please|пожалуйста|por favor)$/iu, '');
  const unquoted = request.replace(quoted, '');
  if (
    /^(?:create|edit|copy|move|write)\b.*\b(?:file|folder|notepad)\b|^(?:создай|измени|скопируй|перемести|напиши).*?(?:файл|папк|блокнот)/iu.test(
      unquoted,
    )
  )
    return null;
  if (
    spotify.test(scope) ||
    /^(?:do not|don['’]t|never|не|no|não|ne|nicht)\s/iu.test(unquoted) ||
    /[\r\n;]|\b(?:then|instead)\s+(?:open|play|set|write|tell|pause|resume)\b|\band\s+(?:open|set|write|tell|pause|resume)\b|(?:^|\s)(?:затем|потом|вместо)(?=\s|$)/iu.test(
      unquoted,
    ) ||
    /\b(?:click|press|drag|type into|address bar|browser devtools)\b|нажми|кликни|перетащи/iu.test(
      unquoted,
    )
  )
    return explicit ? { command: null, plan: false } : null;

  const subject = explicit
    ? request
        .replace(/\s+(?:(?:right )?now|сейчас)$/iu, '')
        .replace(serviceFirst, '')
        .replace(beforeService, '')
        .replace(inlineService, '')
        .trim()
        .replace(/[, ]+$/u, '')
    : request;
  const volume = volumeCommand(subject);
  // A recognized volume instruction with an invalid level must not become a
  // free-form reply that claims the player was changed.
  if (volume === null) return { command: null, plan: false, volumeNeedsClarification: true };
  const dedicated = explicit || dedicatedMusicRequest(value);
  const track = play.exec(subject)?.[1];
  const playQuery =
    !explicit && track && !nonMusicPlay.test(track) && spotifyPlaybackCandidate(value)
      ? trackQuery(track)
      : null;
  if (!dedicated && !volume && !playQuery && !namedSpotifyPlay(value)) return null;
  const command = volume ?? musicCommand(subject, explicit, track, playQuery !== null);
  // For other languages and phrasing, the bounded planner must distinguish a
  // player instruction from a question, quote or multi-step request.
  const plan = !command && (dedicated || playQuery !== null);
  return { command, plan, ...(!command && playQuery ? { playQuery } : {}) };
}
