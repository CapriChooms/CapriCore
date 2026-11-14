// SPDX-License-Identifier: GPL-3.0-only
import { cyberpunkSteamLaunch } from './steam-game-launch.mjs';
import { edgerunnersTeaserRequest } from './edgerunners-teaser.mjs';
import { callTaskRequest } from './call-computer-task.mjs';

// Fast paths for common requests. Ambiguous and other-language requests can use
// the desktop intent classifier without starting an ordinary chat turn.
const russianMode = String.raw`(?:режим\s+)?полн(?:ого|ое|ый|ом|ым)\s+(?:управлени[ея]|доступ[а]?)\s+(?:ко?\s+)?(?:(?:всему|моим|моему|моего|всего)\s+)*(?:компьютер(?:ом|у|а)?|пк)`;
const englishMode = String.raw`(?:full\s+(?:computer|pc|desktop)\s+(?:control|access)|full\s+(?:control|access)\s+(?:of|to|over)\s+(?:(?:my|the|this|entire|whole)\s+)*(?:computer|pc|desktop)|computer\s+control)(?:\s+mode)?`;
const mode = String.raw`(?:${russianMode}|${englishMode})`;
const prefix = /^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu;
const polite =
  /^(?:(?:please|пожалуйста)[,\s]+|(?:can|could|would)\s+you\s+(?:please\s+)?|(?:можешь|можете)\s+(?:пожалуйста\s+)?)/iu;
const enable = new RegExp(
  String.raw`^(?:enable|activate|turn\s+on|switch\s+to|use|включи(?:ть)?|активируй|используй|задействуй|перейди\s+в)\s+(?:the\s+)?${mode}(?=$|[\s,.:;!?])`,
  'iu',
);
const disable = new RegExp(
  String.raw`^(?:disable|deactivate|turn\s+off|revoke|отключи(?:ть)?|выключи(?:ть)?|отзови)\s+(?:the\s+)?${mode}(?=$|[\s,.:;!?])`,
  'iu',
);
const using = new RegExp(
  String.raw`^(?:using|with|in|через|используя|в(?:\s+режиме)?)\s+${mode}(?=$|[\s,.:;!?])`,
  'iu',
);
const trailing = new RegExp(
  String.raw`\s+(?:using|with|через|используя|в(?:\s+режиме)?)\s+${mode}[.!?\s]*$`,
  'iu',
);
const action =
  /^(?:open|launch|start|find|search|type|write|click|move|create|copy|delete|play|calculate|открой|запусти|найди|поищи|введи|напиши|нажми|перемести|создай|скопируй|удали|включи|посчитай)(?=\s)/iu;
const mention = new RegExp(String.raw`(?:^|\s)${mode}(?=$|[\s,.:;!?])`, 'iu');
const accessTask =
  /(?:^|[\s,])(?:use|using|with)\s+(?:uh\s+)?(?:(?:my|your|the)\s+)?computer\s+access(?=\s|[.!?,]|$)/iu;
const taskCommand =
  /^(?:open|launch|start|search|find|google|use|открой|открыть|запусти|запустить|найди|найти|поищи|используй)(?=\s)/iu;
const requestText = (text) =>
  String(text)
    .normalize('NFKC')
    .trim()
    .replace(prefix, '')
    .replace(polite, '')
    .replace(/^(?:i\s+(?:want|need|would\s+like)\s+you\s+to\s+|я\s+(?:хочу|прошу)\s+)/iu, '')
    .replace(/^(?:uh|um|please|пожалуйста)\s+/iu, '');

const openReference =
  /^(?:(?:and\s+)?then\s+)?(?:open|launch|start)\s+(?:it|that)[.!?\s]*$|^(?:тогда\s+)?(?:открой|запусти)\s+(?:его|её|ее|это)[.!?\s]*$/iu;
const computerAppReference = (text) => openReference.test(requestText(text));
export const rejectsDesktopAction = (text) =>
  /^(?:do\s+not|don['’]t|never|не)\s+(?:enable|activate|turn\s+on|open|launch|start|use|click|press|включай|включать|включи|активируй|открывай|открыть|открой|запускай|запускайся|используй|нажимай|нажми)(?!\p{L})/iu.test(
    requestText(text),
  );

const recoveredMode =
  /^(?:useful\s+(?:computer|pc|desktop)\s+(?:access|control)|use\s+my\s+(?:computer|pc|desktop)\s+via\s+full\s+access|используй\s+мой\s+(?:компьютер|пк)(?=\s*[,.:;]|\s+и\s))(?=\s|[,.:;!?]|$)/iu;
const launchPrefix =
  /^(?:open|launch|start|открой|запусти|abre|abrir|inicia|iniciar|lanza|lanzar|ouvre|ouvrez|ouvrir|lance|lancez|lancer|démarre|démarrez|démarrer)\s+/iu;
const chainSeparator =
  /(?:[,.;:]\s*(?:(?:then|потом|затем|puis|ensuite)\s+)?|\s+(?:and\s+(?:then\s+)?|then\s+|потом\s+|затем\s+|и\s+|et\s+(?:(?:puis|ensuite)\s+)?|puis\s+|ensuite\s+))(?=(?:go\s+to|switch\s+to|click|open|launch|search|find|google|type|write|press|show|play|do|close|quit|перейди|переключись|открой|нажми|найди|напиши|введи|запусти|закрой|va|ouvre|ouvrez|lance|lancez|clique|cliquez|cherche|recherche|tape|écris|ferme|quitte)(?:\s|$))/iu;
const section = String.raw`(?:library|settings|preferences|downloads|history|inbox|biblioth[eè]que|param[eè]tres|pr[eé]f[eé]rences|t[eé]l[eé]chargements|historique|библиотек[ау]|настройки|загрузки|истори[яю]|входящие)`;
const sectionFirst = new RegExp(
  String.raw`^(?:(?:the|my|la|les|ma|mes|мою)\s+)?(${section})\s+(?:(?:in|of|dans|de|в)\s+)?(.+)$`,
  'iu',
);
const sectionLast = new RegExp(String.raw`^(.+?)\s+(${section})$`, 'iu');
const appName = /^[\p{L}\p{N}][\p{L}\p{N} ._+&'’\-]{0,79}$/u;
const clientName = (name) =>
  name.replace(
    /^(?:l['’](?:application|appli)|le client|the (?:app|application|client)|приложение|клиент)\s+/iu,
    '',
  );

export function ownerAppLaunch(text) {
  const request = requestText(text).replace(
    /^(?:(?:por\s+favor|s['’]il (?:te|vous) plaît)[,\s]+|(?:puedes|podrías|peux-tu|pourrais-tu|pouvez-vous)\s+)/iu,
    '',
  );
  const access = enable.exec(request) ?? using.exec(request) ?? recoveredMode.exec(request);
  const command = (access ? request.slice(access[0].length) : request)
    .replace(/^[,.:;\s]+/u, '')
    .replace(/^(?:and|to|и)\s+/iu, '')
    .replace(trailing, '');
  if (!launchPrefix.test(command) || computerAppReference(command)) return null;
  const remainder = command.replace(launchPrefix, '');
  const separator = remainder.search(chainSeparator);
  let name = (separator < 0 ? remainder : remainder.slice(0, separator))
    .replace(/[.!?]+$/u, '')
    .replace(/(?:\s+please|,?\s+(?:пожалуйста|s['’]il (?:te|vous) plaît))$/iu, '')
    .trim()
    .replace(
      /^(?:"([^"]+)"|«([^»]+)»|“([^”]+)”)$/u,
      (_, straight, french, curly) => straight ?? french ?? curly,
    );
  const before = sectionFirst.exec(name),
    after = before ? null : sectionLast.exec(name);
  const destination = before?.[1] ?? after?.[2];
  const literalName = name;
  name = clientName(before?.[2] ?? after?.[1] ?? name);
  if (/^стим(?:а|е)?$/iu.test(name)) name = 'Steam';
  if (!appName.test(name)) return null;
  if (destination)
    return {
      name,
      single: false,
      section: destination,
      literalName,
      ...(separator < 0 && { sectionOnly: true }),
    };
  return { name, single: separator < 0 };
}

export const computerTaskFollowUp = (text) =>
  computerAppReference(text) ||
  /^(?:continue(?:\s+(?:the|that|this)\s+task)?[.!?\s]*$|(?:open|load|show)\s+(?:(?:your|my|the|that|this)\s+)?(?:(?:most\s+)?(?:recent|latest)\s+)?project\b|(?:export|render)\s+(?:it|that|this|the project|the video)\b|продолжи(?:ть)?(?:\s+(?:задачу|это))?[.!?\s]*$|(?:открой|загрузи)\s+(?:(?:мой|этот|последний|текущий)\s+)?проект\b)/iu.test(
    requestText(text),
  );

// Keep the settings and desktop tools available for semantic paraphrases, without
// treating a mere mention as permission or starting a session.
export const mentionsComputerMode = (text) => mention.test(String(text).normalize('NFKC'));

export function exactClickLabel(text) {
  const request = requestText(text);
  const access = enable.exec(request) ?? using.exec(request) ?? recoveredMode.exec(request);
  const command = (access ? request.slice(access[0].length) : request)
    .replace(/^[,.:;\s]+/u, '')
    .replace(/^(?:and|to|и)\s+/iu, '')
    .replace(trailing, '');
  return (
    /^(?:click|press|нажми|кликни|clique(?:z)? sur|pulsa|haz clic en)\s+(?:(?:the\s+)?button\s+|(?:на\s+)?кнопку\s+)?(?:"([^"\r\n]{1,100})"|«([^»\r\n]{1,100})»|“([^”\r\n]{1,100})”)[.!?\s]*$/iu
      .exec(command)
      ?.slice(1)
      .find(Boolean)
      ?.trim() || null
  );
}

function musicRequestScope(text) {
  const value = String(text).normalize('NFKC');
  if (mentionsComputerMode(value) || rejectsDesktopAction(value)) return null;
  const gui =
    /\b(?:click|press|drag|cursor|mouse|keyboard|button|search\s+bar|address\s+bar|type|write|clipboard)\b|нажми|кликни|перетащи|курсор|мыш[ьи]|клавиш|кнопк|строк[ауе]\s+поиска|введи|напиши/iu.test(
      value,
    );
  const mixed =
    /\b(?:chrome|edge|browser|notepad|discord|davinci|calculator|timer|reminder|file|folder)\b|хром|браузер|блокнот|дискорд|давинчи|калькулятор|таймер|напомни|файл|папк/iu.test(
      value,
    );
  return gui || mixed ? null : value;
}

/** Candidate only; the bounded semantic planner must confirm a music action. */
export function spotifyPlaybackCandidate(text) {
  const scoped = musicRequestScope(text);
  if (scoped === null) return false;
  return /^(?:play|put\s+on|turn\s+on|resume|pause|skip|next|previous|включи|поставь|воспроизведи|продолжи|приостанови|останови)(?=\s|[.!?]|$)/iu.test(
    requestText(scoped),
  );
}

/** Only an explicit, single owner request can bypass generated tool syntax. */
export function namedSpotifyPlay(text) {
  const scoped = musicRequestScope(text);
  if (scoped === null) return null;
  const request = requestText(scoped)
    .replace(/[,\s]+(?:please|пожалуйста)[.!?\s]*$/iu, '')
    .replace(/[.!?\s]+$/u, '');
  const match = /^(?:play|put\s+on|turn\s+on|включи|поставь|воспроизведи)\s+(.+)$/iu.exec(request);
  if (!match) return null;
  let query = match[1];
  const spotify =
    /^(?:in|on|в)\s+(?:spotify|спотифа[йе])\s+|\s+(?:in|on|в)\s+(?:spotify|спотифа[йе])$/iu;
  const explicit = spotify.test(query);
  query = query.replace(spotify, '').replace(/^(?:me\s+|мне\s+)/iu, '');
  const named = /^(?:the\s+)?(?:song|track|песню|трек)\s+/iu;
  if (!explicit && !named.test(query) && !/\s[-–—]\s/u.test(query)) return null;
  query = query.replace(named, '').trim();
  // Ambiguous references, compound tasks and quoted tool output stay on the
  // normal language-model route. Never repair/execute assistant text here.
  if (
    !query ||
    query.length > 180 ||
    /[\x00-\x1f{}<>;`]/u.test(query) ||
    /\b(?:and|then|but|before|after|instead|not|don't|never|if|when)\b|(?:^|\s)(?:и|затем|потом|не|если|когда)(?=\s|$)/iu.test(
      query,
    ) ||
    /^(?:is|means|was|are|were)\b/iu.test(query) ||
    /^(?:(?:some|any|the|this|that|my|your|current|next|previous)\s+)*(?:music|song|track|playlist|it|something|anything)$|^(?:музыку|песню|трек|её|ее|его|это|что-нибудь)$/iu.test(
      query,
    )
  )
    return null;
  return { action: 'play', query };
}

/** Topic guard only: never authorizes a tool, execution or a verified-action reply. */
export function dedicatedMusicContext(text) {
  const value = musicRequestScope(text);
  return (
    value !== null &&
    /\b(?:spotify|music|songs?|tracks?|playlists?|volume|shuffle|quieter|louder)\b|спотиф|музык|песн|трек|плейлист|громк|потише|погромче/iu.test(
      value,
    )
  );
}

/** Music playback is a dedicated skill, not an implicit request for a GUI session. */
export function dedicatedMusicRequest(text) {
  const value = musicRequestScope(text);
  if (value === null) return false;
  const request = requestText(value)
    .replace(/[.!?\s]+$/u, '')
    .replace(/[,\s]+(?:please|пожалуйста)$/iu, '')
    .trim();
  // A topic or a quoted song title is not an instruction. Unrecognized wording
  // stays on the general model path rather than being promoted to an action.
  if (/^(?:do\s+not|don['’]t|not|never|не)(?=\s)/iu.test(request)) return false;
  if (
    /^(?:play|pause|stop|next|previous|repeat|shuffle|volume)\s+(?:is|means|was|are|were)\b/iu.test(
      request,
    ) ||
    /^(?:start|find|search(?:\s+for)?|repeat)\s+(?:(?:a|the)\s+)?(?:discussion|conversation|meaning|lyrics|title|name|history)\b/iu.test(
      request,
    ) ||
    /^repeat\s+(?:(?:the|this|current)\s+)?(?:song|track)\s+(?:title|name|lyrics)\b/iu.test(request)
  )
    return false;
  if (/^(?:pause|resume|next|previous|skip)$/iu.test(request)) return true;
  if (
    /^(?:(?:a\s+(?:little|bit)|slightly|even|much)\s+)?(?:quieter|louder)$/iu.test(request) ||
    /^(?:(?:сделай|сделать)\s+)?(?:(?:чуть|немного|ещ[её])\s+)?(?:потише|погромче)$/iu.test(request)
  )
    return true;
  if (
    /^(?:what(?:['’]s|\s+is)\s+(?:(?:currently|now)\s+)?playing|(?:what|which)\s+(?:song|track|music)\s+is\s+(?:(?:currently|now)\s+)?playing)(?:\s+(?:on|in)\s+spotify)?(?:\s+(?:right\s+now|now))?$/iu.test(
      request,
    ) ||
    /^(?:что|какая\s+песня|какой\s+трек)\s+(?:сейчас\s+)?(?:играет|воспроизводится)(?:\s+в\s+(?:spotify|спотифа[йе]))?(?:\s+сейчас)?$/iu.test(
      request,
    ) ||
    /^(?:check|show|tell\s+me)\s+(?:(?:the|current|spotify['’]s?)\s+)*(?:spotify\s+)?(?:volume|playback\s+status|now\s+playing)(?:\s+(?:on|in)\s+spotify)?$/iu.test(
      request,
    ) ||
    /^(?:проверь|покажи)\s+(?:текущую\s+)?(?:громкость|статус\s+воспроизведения)(?:\s+(?:в\s+)?(?:spotify|спотифа[йе]))?$/iu.test(
      request,
    )
  )
    return true;
  const music =
    /\b(?:spotify|music|songs?|tracks?|playlists?|shuffle)\b|спотиф|музык|песн|трек|плейлист/iu.test(
      request,
    );
  const playback =
    /^(?:play|pause|resume|stop|skip|next|previous|shuffle|repeat|seek|turn\s+on|put\s+on|start|search|find|включи(?:ть)?|поставь|поставить|воспроизведи|воспроизвести|проиграй|проиграть|останови(?:ть)?|приостанови(?:ть)?|продолжи(?:ть)?|переключи(?:ть)?|найди|найти|поищи)(?=\s|$)/iu.test(
      request,
    );
  const openAndPlay =
    /^(?:open|launch|открой|запусти)\s/iu.test(request) &&
    /\s(?:and(?:\s+then)?|then|и|затем)\s+(?:turn\s+on|put\s+on|play|start|resume|включи|поставь|воспроизведи)(?=\s)/iu.test(
      request,
    );
  if (music && (playback || openAndPlay)) return true;
  const volumeAction =
    /^(?:turn|make|set|adjust|lower|reduce|raise|increase|decrease|mute|unmute|убавь|уменьши|прибавь|увеличь|сделай|сделать|установи|настрой)(?=\s|$)/iu.test(
      request,
    );
  const volume =
    /\b(?:volume|quieter|louder|mute|unmute)\b|громк|потише|погромче/iu.test(request) ||
    (music && /\b(?:up|down)\b/iu.test(request));
  return (
    volumeAction &&
    volume &&
    !/\bvolume\s+of\s+(?!(?:(?:the|my)\s+)?(?:spotify|music|song|track)\b)/iu.test(request)
  );
}

// This is only an application anchor for semantic routing, never permission or
// an action classifier. Keep translated product names usable with any language.
export const mentionsDiscord = (text) =>
  /\bdiscord\b|(?<!\p{L})дискорд(?:а|е|ом|у)?(?!\p{L})|ディスコード|디스코드|迪斯科德|狄斯科德|ديسكورد|דיסקורד|डिस्कॉर्ड/iu.test(
    String(text).normalize('NFKC'),
  );

function authorizedDiscordCommand(text) {
  // A quoted command is data. Questions and less familiar phrasing go through
  // the multilingual intent classifier, including polite action questions.
  const unquoted = String(text)
    .normalize('NFKC')
    .replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/gu, '');
  const addressed = unquoted.trim().replace(prefix, '');
  if (
    !mentionsDiscord(unquoted) ||
    /[?？]|^(?:(?:can|could|would)\s+you(?!\p{L})|(?:можешь|можете)(?!\p{L}))/iu.test(addressed)
  )
    return false;
  const command = requestText(unquoted);
  if (
    /^(?:join|connect|leave|disconnect|navigate|go\s+to|switch\s+to|подключись|присоединись|отключись|покинь|выйди|войди|зайди|перейди|переключись)(?=\s)/iu.test(
      command,
    )
  )
    return true;
  return (
    /^(?:send|post|type|write|отправь|напиши|введи|набери)(?=\s)/iu.test(command) &&
    /\b(?:in|into|to|on)\s+(?:the\s+)?discord\b|(?:^|\s)в\s+(?:discord\b|дискорд(?:а|е|ом|у)?(?!\p{L}))/iu.test(
      command,
    )
  );
}

// Route an already-authorized app sequence as one goal. An address-bar draft
// remains a single narrow action.
function authorizedSequence(value) {
  const unquoted = value.replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/gu, '');
  const command = requestText(unquoted);
  const browser =
    /\b(?:chrome|edge|browser|computer\s+control)\b|хром|браузер|управлени[ея]\s+компьютером/iu;
  const app = /\b(?:discord|davinci\s+resolve)\b|дискорд|давинчи/iu;
  const nextNavigation =
    /(?:,\s*|\b(?:and(?:\s+then)?|then|after\s+(?:this|that)|next|finally)\s+|(?:затем|потом|после\s+этого|и)\s+)(?:(?:please|uh|um)\s+)*(?:go\s+to|click|open|search|find|google|show|display|press|navigate|watch|export|перейди|нажми|открой|найди|поищи|покажи|разверни)(?=\s)/iu;
  return (
    taskCommand.test(command) &&
    ((accessTask.test(unquoted) &&
      /\b(?:open|search|google|find|launch|turn\s+on|go\s+to)\b/iu.test(command)) ||
      (/^(?:open|launch|start|открой|запусти)\s/iu.test(command) &&
        nextNavigation.test(unquoted)) ||
      ((browser.test(unquoted) || app.test(unquoted)) && nextNavigation.test(unquoted)) ||
      (app.test(unquoted) &&
        /\b(?:uh|um)\s+(?:go\s+to|open|click|type|press|export)\s/iu.test(command)) ||
      (/^(?:search|find|google)\s/iu.test(command) && browser.test(unquoted)))
  );
}

export function computerModeRequest(text, { fullComputerAccess = false } = {}) {
  if (callTaskRequest(text)) return { enabled: true, run: true };
  const value = String(text).normalize('NFKC').trim().replace(prefix, '').replace(polite, '');
  const off = disable.exec(value);
  if (off && !value.slice(off[0].length).replace(/[\s.!?,;:]/g, ''))
    return { enabled: false, run: false };
  const on = enable.exec(value) ?? using.exec(value);
  if (on) {
    const remaining = value
      .slice(on[0].length)
      .replace(/^[\s,.:;!?]*(?:please|пожалуйста|now|сейчас)?[\s,.:;!?]*$/iu, '')
      .trim();
    return { enabled: true, run: Boolean(remaining) };
  }
  // Common voice transcription of "use full"; require an actual task after it.
  const recovered = recoveredMode.exec(value);
  if (recovered) {
    const command = value
      .slice(recovered[0].length)
      .replace(/^[,.:;\s]+/u, '')
      .replace(/^(?:and|to|и)\s+/iu, '');
    if (action.test(command) || /^(?:do|switch|press|navigate|go)\s/iu.test(command))
      return { enabled: true, run: true };
  }
  if (action.test(value) && trailing.test(value)) return { enabled: true, run: true };
  // "Open Spotify and turn on music" can look like one application name to
  // the permissive app launcher. Keep playback on its dedicated permission.
  if (dedicatedMusicRequest(value)) return null;
  if (fullComputerAccess) {
    if (authorizedDiscordCommand(text)) return { enabled: true, run: true };
    if (exactClickLabel(text)) return { enabled: true, run: true };
    if (cyberpunkSteamLaunch(value) || edgerunnersTeaserRequest(value))
      return { enabled: true, run: true };
    const opening = ownerAppLaunch(value);
    const browserDraft =
      opening &&
      /^(?:google chrome|chrome|edge|microsoft edge|browser|браузер|хром)$/iu.test(opening.name);
    if (authorizedSequence(value) || (opening && (opening.single || !browserDraft)))
      return { enabled: true, run: true };
  }
  return null;
}
