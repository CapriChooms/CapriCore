// SPDX-License-Identifier: GPL-3.0-only

export function isSettingsWindowTitle(title, localizedTitles = []) {
  if (typeof title !== 'string' || !title.trim()) return false;
  const normalized = (value) => value.normalize('NFKC').trim().toLowerCase();
  const value = normalized(title);
  return (
    localizedTitles.some((label) => normalized(label) === value) ||
    /^(?:(?:the|your|her|capri(?:['’]s)?)\s+)?settings(?:\s+capri)?$/u.test(value) ||
    /^(?:(?:твои|твоих|свои|своих)\s+)?настро(?:йки|ек)(?:\s+(?:capri|капри))?$/u.test(value)
  );
}

const performanceCommands = [
  [
    'hang-next',
    /^(?:(?:do|show(?: me)?|perform) (?:a|another|one more) (?:hanging|ledge) trick|(?:покажи|сделай)(?: ещё| еще)? (?:один )?трюк на весу)$/iu,
  ],
  [
    'hang-pullup',
    /^(?:(?:(?:do|perform|try|show(?: me)?) )?(?:a |the |some |one |a few |another )?(?:hanging )?(?:pull[ -]?ups?|chin[ -]?ups?)(?: (?:animation|on the (?:ledge|edge|window)|while hanging))?|pull yourself up)$/iu,
  ],
  [
    'hang-pullup',
    /^(?:подтянись|подтянуться|(?:(?:сделай|сделать|покажи(?: мне)?|показать(?: мне)?) )?(?:(?:одно|несколько) )?подтягивани[еяй])(?: на (?:краю|перекладине))?$/iu,
  ],
  [
    'hang-catch',
    /^(?:(?:catch|toss and catch|flip and catch) (?:(?:a|the|that|your) )?(?:data )?chip|(?:поймай|поймать|подбрось и поймай|подбросить и поймать) чип)$/iu,
  ],
  [
    'hang-wrist-scan',
    /^(?:(?:use|open|check|activate|show(?: me)?) (?:(?:your|the) )?wrist scanner|(?:проверь|проверить|включи|включить|покажи|показать) (?:наручный )?сканер(?: на запястье)?)$/iu,
  ],
  [
    'ledge-keytar',
    /^(?:play (?:(?:a|another) keytar (?:riff|solo)|(?:some |the |your )?keytar)|(?:сыграй|сыграть|поиграй|поиграть)(?: (?:риф|соло))? на (?:кейтаре|китаре))$/iu,
  ],
  [
    'lean',
    /^(?:lean (?:on|against) (?:the |this )?(?:(?:active|current) )?window(?: edge)?|обопрись на (?:край )?окн[оа])$/iu,
  ],
  [
    'peek',
    /^(?:peek (?:over|around|under|from behind) (?:the |this )?(?:window|window edge)|выгляни из-за края окна)$/iu,
  ],
  [
    'read',
    /^(?:mime reading|pretend to read) (?:the )?(?:search|address) (?:bar|box|field)$|^сделай вид,? что читаешь строку поиска$/iu,
  ],
  [
    'tap',
    /^(?:mime tapping|pretend to tap) (?:on )?(?:the )?(?:search|address) (?:bar|box|field)$|^сделай вид,? что постукиваешь по строке поиска$/iu,
  ],
  [
    'search',
    /^(?:mime (?:searching|typing)|pretend to (?:search|type)) (?:in|on|using) (?:the )?(?:search|address) (?:bar|box|field)$|^изобрази поиск в строке поиска$/iu,
  ],
  [
    'field-lean',
    /^(?:lean (?:on|against) (?:the )?(?:search|address) (?:bar|box|field)|обопрись на строку поиска)$/iu,
  ],
  [
    'field-perch',
    /^(?:(?:sit|perch) on (?:the )?(?:search|address) (?:bar|box|field)|сядь на строку поиска)$/iu,
  ],
  [
    'present',
    /^(?:(?:present|point to) (?:the )?(?:search|address) (?:bar|box|field)|покажи жестом на строку поиска)$/iu,
  ],
];

/** The avatar's own movement and gesture commands run before desktop tools or inference. */
export function desktopAvatarCommand(text) {
  const command = text
    .normalize('NFKC')
    .replace(/[\u2010-\u2014\u2212]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?…]+$/u, '')
    .replace(/^(?:(?:hey|hi|эй|привет)[\s,]+)?(?:capri|капри)[\s,:!]+/iu, '')
    .replace(/,\s*(?:capri|капри)$/iu, '')
    .replace(/^(?:please|пожалуйста)[,\s]+/iu, '')
    .replace(/(?:,?\s+please|,?\s+пожалуйста)$/iu, '')
    .trim();
  if (
    /^(?:(?:can|could|would) you )?(?:wave(?: at me| hello| to me)?|give me a wave)$/iu.test(
      command,
    ) ||
    /^(?:помаши|махни|(?:можешь|могла бы) помахать)(?: мне(?: рукой)?| рукой(?: мне)?)?$/iu.test(
      command,
    ) ||
    /^(?:fais-moi (?:signe|coucou)(?: de la main)?|fais coucou|saluda con la mano|acena(?: para mim)?|winke?(?: mir)?(?: zu)?)$/iu.test(
      command,
    )
  )
    return { action: 'wave' };
  const act = command.replace(
    /^(?:(?:can|could|would|will) you[, ]+(?:please[, ]+)?|how about |(?:(?:ты )?можешь(?: ли ты)?|(?:не )?могла бы ты|давай)[, ]+(?:пожалуйста[, ]+)?)\s*/iu,
    '',
  );
  const performance = performanceCommands.find(([, pattern]) => pattern.test(act));
  if (performance) return { action: 'performance', performance: performance[0] };
  if (
    /^(?:return|go back|come back|teleport back) (?:(?:to|into) (?:your|the) (?:frame|window)|home)$/iu.test(
      command,
    ) ||
    /^(?:вернись|возвращайся|телепортируйся обратно)(?: (?:обратно )?(?:в (?:сво[еёю] )?(?:окно|окошко|рамку)|к себе|домой|на место))?$/iu.test(
      command,
    )
  )
    return { action: 'return' };
  const perch = command.match(
    /^(?:(?:sit|perch) on (?:top of )?(?:the )?(?:(?:active|current) )?window|(?:сядь|присядь|посиди) на (?:(?:край|верх) )?(?:(?:активное|активном|текущее|текущем) )?окн[ое])(?:\s+(.*))?$/iu,
  );
  if (perch) {
    const title = (perch[1] ?? '').replace(/^[«"']|[»"']$/gu, '').slice(0, 160);
    const aliases = [
      [/^(?:гугл )?хрома?$/iu, 'chrome'],
      [/^блокнота?$/iu, 'notepad'],
      [/^дискорда?$/iu, 'discord'],
      [/^проводника?$/iu, 'explorer'],
    ];
    return { action: 'perch', title: aliases.find(([name]) => name.test(title))?.[1] ?? title };
  }
  const named = command.match(/^(?:sit|perch) on (?:top of )?(?:the )?(.+?) window$/iu);
  if (named) return { action: 'perch', title: named[1].slice(0, 160) };
  return null;
}

export function randomAvatarDestination(area, owner, previous, random = Math.random) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const point = {
      x: Math.round(area.x + area.width * (0.13 + random() * 0.74)),
      y: Math.round(area.y + area.height * (0.34 + random() * 0.55)),
    };
    if (
      (point.x < owner.x - 40 ||
        point.x >= owner.x + owner.width + 40 ||
        point.y < owner.y ||
        point.y >= owner.y + owner.height + 40) &&
      (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 140)
    )
      return point;
  }
  return null;
}
