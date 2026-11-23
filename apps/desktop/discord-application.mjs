// SPDX-License-Identifier: GPL-3.0-only
// Discord is controlled through the owner's existing desktop session only.
// This module plans existing ComputerControl actions; it cannot inject input,
// open a connection, read a token or grant computer permissions itself.
import { createHash } from 'node:crypto';

const name = (value) =>
  String(value ?? '')
    .normalize('NFC')
    .trim();
const key = (value) => name(value).toLowerCase();
const quoted = String.raw`(?:"([^"\r\n]+)"|«([^»\r\n]+)»|“([^”\r\n]+)”)`;
const quoteText = (match) => match?.slice(1).find((part) => part !== undefined);
const currentQuoted =
  /"([^"\r\n]*)"|“([^”\r\n]*)”|«([^»\r\n]*)»|「([^」\r\n]*)」|『([^』\r\n]*)』|‘([^’\r\n]*)’|(?<![\p{L}\p{N}])'([^'\r\n]*)'(?![\p{L}\p{N}])/gu;
const currentVerbs =
  /(?<!\p{L})(?:send|post|write|type|отправь(?:те)?|напиши(?:те)?|набери(?:те)?|введи(?:те)?|envoie|envoyez|écris|écrivez|ecris|escribe|escriba|envía|envia|sende|schreib|schreibe|escreva|envie|scrivi|invia|gönder|yaz|اكتب|أرسل|ارسل)(?!\p{L})/giu;
const currentChat =
  /(?<!\p{L})(?:chat|conversation|dm|direct\s+messages?|message\s+(?:pane|panel)|чат\p{L}*|переписк\p{L}*|сообщени\p{L}*|личн\p{L}*|conversation|salon|discussion|nachrichten|mensajes|mensagens|messaggi|mesaj\p{L}*|رسائل)(?!\p{L})|チャット|メッセージ|채팅|메시지|聊天|对话|對話/iu;
const currentSide = {
  right:
    /(?<!\p{L})(?:right(?:[ -]hand)?|справа|прав(?:ый|ом|ую|ой|ого|ому|ые|ых)|droite|rechts|recht(?:e|en|er|es|em)|derech[ao]|direit[ao]|destra|sağ(?:daki|da|a|dan)?|يمين)(?!\p{L})|右|오른쪽/iu,
  left: /(?<!\p{L})(?:left(?:[ -]hand)?|слева|лев(?:ый|ом|ую|ой|ого|ому|ые|ых)|gauche|links|link(?:e|en|er|es|em)|izquierd[ao]|esquerd[ao]|sinistra|sol(?:daki|da|a|dan)?|يسار)(?!\p{L})|左|왼쪽/iu,
  current:
    /(?<!\p{L})(?:current|selected|active|open|this|that|текущ\p{L}*|выбранн\p{L}*|открыт\p{L}*|этот|этом|actuel\p{L}*|courant\p{L}*|sélectionn\p{L}*|actual|este|esta|atual|corrente|questo|questa|aktuell\p{L}*|ausgewählt\p{L}*|mevcut|seçili|الحالي\p{L}*|المحدد\p{L}*)(?!\p{L})|現在|この|현재|선택한|当前|當前|这个|這個/iu,
};
const currentLocation =
  /\s+(?:in|into|on|to|в|во|на|dans|sur|en|al|em|no|na|nel|su|im|auf|an|في|إلى)\s+/giu;
const exactMessage = (text) =>
  typeof text === 'string' &&
  text.trim().length > 0 &&
  text.length <= 2000 &&
  !/^\s*\//u.test(text) &&
  !/[\x00-\x1f\x7f]/u.test(text);
function visibleChatSide(text) {
  if (!currentChat.test(text)) return null;
  const sides = ['left', 'right'].filter((side) => currentSide[side].test(text));
  return sides.length > 1
    ? null
    : (sides[0] ?? (currentSide.current.test(text) ? 'current' : null));
}

/** Lexical owner text only. This does not authorize a task or read an observation. */
export function discordCurrentMessageParts(value) {
  if (typeof value !== 'string' || value.length > 8000) return null;
  const literals = [];
  const masked = value.replace(currentQuoted, (...parts) => {
    const start = parts.at(-2),
      text = parts.slice(1, -2).find((part) => part !== undefined);
    literals.push({ start, end: start + parts[0].length, text });
    return ' '.repeat(parts[0].length);
  });
  if (!currentChat.test(masked)) return null;
  const verbs = [...masked.matchAll(currentVerbs)];
  if (verbs.length !== 1) return null;
  const verbEnd = verbs[0].index + verbs[0][0].length;
  const prefix =
    /^(?:\s+(?:(?:the|a|this|following)\s+)?(?:message|text|сообщение|текст)\s*:?)?\s*/iu.exec(
      value.slice(verbEnd),
    )[0];
  const start = verbEnd + prefix.length;
  const literal = literals.find((entry) => entry.start === start);
  if (literal && exactMessage(literal.text)) {
    const side = visibleChatSide(masked.slice(literal.end));
    return side ? { side, text: literal.text, literal: 'quoted' } : null;
  }
  // A colon after the destination marks the exact entire message body.
  const colon = value.indexOf(':', verbEnd);
  if (colon >= 0 && currentChat.test(masked.slice(verbEnd, colon))) {
    const intro = masked.slice(verbEnd, colon);
    const location = [...intro.matchAll(currentLocation)][0];
    const side = visibleChatSide(location ? intro.slice(location.index) : intro);
    const text = value.slice(colon + 1).trim();
    if (side && exactMessage(text)) return { side, text, literal: 'colon' };
  }
  const cuts = [...masked.matchAll(currentLocation)].filter(
    (match) => match.index > start && visibleChatSide(masked.slice(match.index)),
  );
  if (cuts.length !== 1) return null;
  const text = value.slice(start, cuts[0].index).trim();
  if (
    !exactMessage(text) ||
    /^(?:something|anything|a\s+(?:reply|response)|что-нибудь|что-то|quelque\s+chose|algo|etwas)(?!\p{L})/iu.test(
      text,
    )
  )
    return null;
  return { side: visibleChatSide(masked.slice(cuts[0].index)), text, literal: 'plain' };
}
const boundedName = (value) =>
  typeof value === 'string' &&
  name(value).length > 0 &&
  name(value).length <= 100 &&
  !/[\x00-\x1f]/u.test(value);
const voiceSuffix = /\s*\((?:voice channel|голосовой канал)\)\s*$/iu;
const textSuffix = /\s*\((?:text channel|текстовый канал)\)\s*$/iu;
const serverGroup = /^(?:servers(?: sidebar)?|server list|серверы|список серверов)$/iu;
const channelGroup =
  /^(?:channels(?: sidebar| list)?|channel list|каналы|список каналов|панель каналов)$/iu;
const channelContentGroup =
  /^(?:channel content|channel chat|chat input|message composer|message input|чат канала|поле сообщения|ввод сообщения|редактор сообщения)$/iu;
const messageGroup =
  /^(?:messages(?: in .*)?|message list|chat messages|message content|activity|сообщения(?: в .*)?|список сообщений|содержимое сообщения|активность)$/iu;
const voiceGroup =
  /^(?:voice controls|voice status|voice connection|voice panel|user status and settings|голосовое подключение|управление голосом|статус подключения|панель голосовой связи)$/iu;
const actualUserGroup = /^user status and settings$/iu;
const userGroup =
  /^(?:user area|user controls|user status and settings|область пользователя|панель пользователя)$/iu;
const channelSuffix = /\s*\(channel\)\s*$/iu;
const connectedLabel =
  /^(?:voice connected|connected to voice|голосовая связь подключена|голосовое подключение установлено|подключено к голосовому каналу)$/iu;
const disconnectedLabel =
  /^(?:not connected|voice disconnected|не подключено|голосовая связь отключена)$/iu;
const disconnectLabel =
  /^(?:disconnect(?: from voice)?|leave voice(?: channel)?|отключиться(?: от голосового канала)?|покинуть голосовой канал)$/iu;
const joinLabel =
  /^(?:join voice(?: channel)?|connect(?: to voice)?|присоединиться к голосовому каналу|подключиться(?: к голосовому каналу)?)$/iu;
const settingsLabel = /^(?:user settings|настройки пользователя)$/iu;
const quickGroup =
  /^(?:quick switcher|quick switch|быстрое переключение|быстрый переключатель|переключатель каналов)$/iu;
const quickFieldLabel =
  /^(?:where would you like to go\??|куда (?:вы )?(?:хотите|хотел[аи] бы) перейти\??)$/iu;
const click = (target, summary) => ({ action: 'click', targetId: target.targetId, summary });
const ask = (summary) => ({ action: 'ask_user', summary });
const messageMatches = (target, text) =>
  !target.editable &&
  /(?:Text|ListItem)$/u.test(target.role ?? '') &&
  (target.untrustedLabel === text ||
    target.untrustedTextSha256 === createHash('sha256').update(text, 'utf8').digest('hex'));
const draftMatches = (target, text) =>
  target.untrustedValue === text ||
  target.untrustedValueSha256 === createHash('sha256').update(text, 'utf8').digest('hex');
const emptyDraftHash = createHash('sha256').update('').digest('hex');
const isButton = (target) => /(?:^|\.)Button$/u.test(target.role ?? '');
const inVoicePanel = (target) => target.ancestors.some((entry) => voiceGroup.test(entry));
const isTextbox = (target) => /(?:^|\.)(?:Edit|Document)$/u.test(target.role ?? '');
const isConnectedStatus = (target) =>
  inVoicePanel(target) &&
  !target.inMessages &&
  (connectedLabel.test(target.label) ||
    (isButton(target) &&
      target.ancestors.some((entry) => actualUserGroup.test(entry)) &&
      /\bvoice connected\b/iu.test(target.label) &&
      !/\b(?:not|disconnected|failed)\b/iu.test(target.label)));

/** A deliberately narrow fast path. Unspecified names are clarified, never guessed. */
export function discordTaskRequest(value) {
  if (typeof value !== 'string' || value.length > 8000) return null;
  const goal = value.trim();
  // Normalize routing words and names, but never transform the message body.
  const commands = goal.replace(new RegExp(quoted, 'gu'), '').normalize('NFKC');
  if (!/\bdiscord\b|дискорд/iu.test(commands)) return null;
  const current = discordCurrentMessageParts(goal);
  if (
    /\b(?:draft|without\s+sending|do not\s+(?:send|submit|press\s+enter)|don't\s+(?:send|submit|press\s+enter))\b|черновик|не\s+(?:отправляй|отправлять|нажимай\s+(?:enter|ввод))/iu.test(
      commands,
    )
  )
    return null;
  const intent = commands
    .trim()
    .replace(/^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu, '')
    .replace(/^(?:please|пожалуйста)[,\s]+/iu, '')
    .replace(/^(?:can|could|would)\s+you\s+(?:please\s+)?/iu, '')
    .replace(
      /^(?:i\s+(?:want|need|would\s+like)\s+you\s+to|я\s+(?:хочу|прошу)(?:,\s*чтобы\s+ты)?)\s+/iu,
      '',
    )
    .replace(/^(?:in|on)\s+(?:(?:my|the)\s+)?discord[,\s:]+/iu, '')
    .replace(/^в\s+(?:мо[её]м\s+)?дискорд[еа]?[,\s:]+/iu, '');
  if (/^(?:open|launch|start|открой|запусти)\s+(?:discord|дискорд)[.!?\s]*$/iu.test(intent))
    return null;
  if (
    !/^(?:join|send|post|write|leave|disconnect|read|summarize|list|show|open|navigate|go\s+to|find)\b|^(?:зайди|войди|подключись|присоединись|выйди|отключись|покинь|прочитай|перескажи|суммируй|открой|перейди|найди|напиши|отправь|опубликуй|покажи|перечисли)(?=\s)/iu.test(
      intent,
    )
  )
    return null;
  if (/^(?:how|what)\b|^(?:как|что)(?=\s)|^(?:ты\s+)?(?:умеешь|можешь)\s+ли/iu.test(commands))
    return null;
  if (
    /(?:\b(?:do not|don't|never)\s+(?:join|send|post|write|leave|open)|не\s+(?:заходи|вступай|отправляй|пиши|покидай|открывай))/iu.test(
      commands,
    )
  )
    return null;
  if (/\bbot\b|бот[а-яё]*/iu.test(commands)) return null;
  const send =
    Boolean(current) ||
    /\b(?:send|post|write)\b|(?:^|\s)(?:напиши|отправь|опубликуй)(?=\s)/iu.test(commands);
  const leave = /\b(?:leave|disconnect)\b|(?:выйди|отключись|покинь)/iu.test(commands);
  const join = /\bjoin\b|(?:зайди|войди|подключись|присоединись)/iu.test(commands);
  const read = /\b(?:read|summarize)\b|(?:прочитай|перескажи|суммируй)/iu.test(commands);
  const list =
    /\b(?:list|show)\b[^.!?]{0,100}\bchannels\b|(?:покажи|перечисли)[^.!?]{0,100}канал/iu.test(
      commands,
    );
  const navigate = /\b(?:open|navigate|go to|find)\b|(?:открой|перейди|найди)/iu.test(commands);
  if (![send, leave, join, read, navigate, list].some(Boolean)) return null;
  if ([send, join, read, list].filter(Boolean).length > 1)
    return { action: 'clarify', reason: 'Specify one Discord operation at a time.' };
  if (
    /(?:\b(?:screen.?share|share\s+(?:my\s+|the\s+)?screen|camera|video call|invite|delete|ban|kick|mute)\b|демонстрац|камер|видеозвон|пригласи|удали|забань|кикни|заглуши)/iu.test(
      commands,
    )
  )
    return {
      action: 'clarify',
      reason:
        'This Discord request includes another operation. Specify the server, channel and single action.',
    };
  if (leave && (send || join || read))
    return { action: 'clarify', reason: 'Specify one Discord action at a time.' };
  if (leave) return { action: 'leave_voice' };
  if (current)
    return validateDiscordRequest({
      action: 'send_current_message',
      text: current.text,
      side: current.side,
    });
  const serverMatch = new RegExp(String.raw`(?:\bserver\b|сервер(?:е|а)?)\s*${quoted}`, 'iu').exec(
    goal,
  );
  const channelMatch = new RegExp(
    String.raw`(?:\bchannel\b|канал(?:е|а)?)\s*#?\s*${quoted}`,
    'iu',
  ).exec(goal);
  const hashChannel = /(?:^|\s)#([\p{L}\p{N}_-]{1,100})(?=\s|[,.!?;]|$)/u.exec(commands);
  const server = quoteText(serverMatch),
    channel = quoteText(channelMatch) ?? hashChannel?.[1];
  const channelType = /\bvoice\b|голосов/iu.test(commands) || join ? 'voice' : 'text';
  if (list && server) return validateDiscordRequest({ action: 'list_channels', server });
  if (!server || !channel)
    return {
      action: 'clarify',
      reason: 'Specify exact server and channel names; put each name in quotes.',
    };
  if (send) {
    const message = new RegExp(
      String.raw`(?:\b(?:send|post|write)\b|напиши|отправь|опубликуй)\s+(?:(?:the|a)\s+)?(?:(?:message|сообщение)\s*:?\s*)?${quoted}`,
      'iu',
    ).exec(goal);
    const text = quoteText(message);
    if (!text || channelType === 'voice')
      return {
        action: 'clarify',
        reason: 'Specify the exact message in quotes and a text channel.',
      };
    return validateDiscordRequest({
      action: 'send_message',
      server,
      channel,
      channelType: 'text',
      text,
    });
  }
  return validateDiscordRequest({
    action: join ? 'join_voice' : read ? 'read_context' : 'navigate',
    server,
    channel,
    channelType,
  });
}

export function validateDiscordRequest(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![
      'navigate',
      'join_voice',
      'leave_voice',
      'list_channels',
      'read_context',
      'send_message',
      'send_current_message',
    ].includes(value.action) ||
    Object.keys(value).some(
      (field) => !['action', 'server', 'channel', 'channelType', 'text', 'side'].includes(field),
    )
  )
    throw Error('Invalid Discord desktop action.');
  if (value.action === 'send_current_message') {
    if (
      !['current', 'left', 'right'].includes(value.side) ||
      !exactMessage(value.text) ||
      Object.keys(value).some((field) => !['action', 'text', 'side'].includes(field))
    )
      throw Error('Choose one visible Discord chat and the exact message to send.');
    return { action: value.action, text: value.text, side: value.side };
  }
  if (value.side !== undefined) throw Error('Only a visible-chat action can contain a side.');
  if (value.action === 'leave_voice') {
    if (Object.keys(value).some((field) => field !== 'action'))
      throw Error('Unexpected Discord leave argument.');
    return { action: value.action };
  }
  if (value.action === 'list_channels') {
    if (
      !boundedName(value.server) ||
      Object.keys(value).some((field) => !['action', 'server'].includes(field))
    )
      throw Error('Choose the exact Discord server name.');
    return { action: value.action, server: name(value.server) };
  }
  if (
    !boundedName(value.server) ||
    !boundedName(value.channel) ||
    !['text', 'voice'].includes(value.channelType)
  )
    throw Error('Choose exact Discord server/channel names and the channel type.');
  if (value.action === 'join_voice' && value.channelType !== 'voice')
    throw Error('Choose a voice channel.');
  if (value.action === 'send_message') {
    if (
      value.channelType !== 'text' ||
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      value.text.length > 2000 ||
      /^\s*\//u.test(value.text) ||
      /[\x00-\x1f\x7f]/u.test(value.text)
    )
      throw Error('Choose a text channel and one explicit message of at most 2000 characters.');
  } else if (value.text !== undefined)
    throw Error('Only an explicit send action can contain message text.');
  return {
    action: value.action,
    server: name(value.server),
    channel: name(value.channel).replace(/^#/u, ''),
    channelType: value.channelType,
    ...(value.action === 'send_message' ? { text: value.text } : {}),
  };
}

/** Read only the bounded, fresh UI observation supplied by ComputerControl. */
export function discordObservation(view) {
  if (view?.window?.applicationKind !== 'discord' && view?.application?.kind !== 'discord')
    return null;
  const targets = (view.targets ?? [])
    .filter((target) => !target.surface && target.source !== 'vision')
    .map((target) => {
      const label = name(target.untrustedLabel);
      const ancestors = (target.untrustedAncestors ?? [])
        .map((ancestor) => name(typeof ancestor === 'string' ? ancestor : ancestor?.untrustedName))
        .filter(Boolean)
        .slice(0, 8);
      const inMessages = ancestors.some((entry) => messageGroup.test(entry));
      const channelControl =
        !inMessages &&
        /(?:^|\.)(?:Hyperlink|TreeItem|Button)$/u.test(target.role ?? '') &&
        ancestors.some((entry) => channelGroup.test(entry));
      const serverControl =
        !inMessages &&
        /(?:^|\.)(?:TreeItem|ListItem|Button)$/u.test(target.role ?? '') &&
        ancestors.some((entry) => serverGroup.test(entry));
      const kind =
        channelControl && voiceSuffix.test(label)
          ? 'voice'
          : channelControl && textSuffix.test(label)
            ? 'text'
            : serverControl
              ? 'server'
              : null;
      return {
        ...target,
        label,
        ancestors,
        inMessages,
        kind,
        name: label.replace(voiceSuffix, '').replace(textSuffix, '').replace(/^#\s*/u, ''),
      };
    });
  const title = name(view.window?.untrustedTitle).replace(/\s*[-–—]\s*Discord$/iu, '');
  const titleParts = title.split(/\s+\|\s+/u);
  const activeServer = titleParts.length === 2 ? name(titleParts[1]) : null;
  const activeChannel = titleParts.length === 2 ? name(titleParts[0]).replace(/^#\s*/u, '') : null;
  const disconnect = targets.filter(
    (target) => isButton(target) && inVoicePanel(target) && disconnectLabel.test(target.label),
  );
  const connectionLabels = targets.filter(isConnectedStatus);
  const voicePanel = targets.filter(inVoicePanel);
  const quickFields = targets.filter(
    (target) =>
      target.editable &&
      isTextbox(target) &&
      (quickFieldLabel.test(target.label) ||
        target.ancestors.some((entry) => quickGroup.test(entry))),
  );
  const nativePanel = view.window?.discordUserPanel;
  const userPanel =
    nativePanel?.complete === true &&
    typeof nativePanel.settingsPresent === 'boolean' &&
    typeof nativePanel.disconnectPresent === 'boolean'
      ? {
          complete: true,
          settingsPresent: nativePanel.settingsPresent,
          disconnectPresent: nativePanel.disconnectPresent,
        }
      : null;
  return {
    targets,
    activeServer,
    activeChannel,
    disconnect,
    connectionLabels,
    voicePanel,
    quickFields,
    userPanel,
    disconnected: targets.find(
      (target) => inVoicePanel(target) && disconnectedLabel.test(target.label),
    ),
    loaded:
      !view.window?.modal &&
      targets.some(
        (target) =>
          isButton(target) &&
          settingsLabel.test(target.label) &&
          target.ancestors.some((entry) => userGroup.test(entry)),
      ),
    truncated:
      view.window?.controlsTruncated === true ||
      view.application?.controlsTruncated === true ||
      targets.length >= 140,
  };
}

const same = (left, right) => key(left) === key(right);
const paneId = (target) =>
  /^[a-f0-9]{64}$/u.test(target.discordPaneId ?? '') ? target.discordPaneId : null;
function composerContext(target) {
  const labelled = /[#@]([^#@\r\n]{1,100})$/u.exec(target.label)?.[1];
  if (labelled) return key(labelled);
  const ancestor = target.ancestors.find((entry) =>
    /\((?:channel|text channel|voice channel|direct message|dm)\)$/iu.test(entry),
  );
  return ancestor ? key(ancestor.replace(/\s*\([^)]*\)$/u, '')) : null;
}
function currentComposerState(view) {
  const observation = discordObservation(view);
  if (
    !observation ||
    !view.window?.windowId ||
    view.window?.modal ||
    observation.quickFields.length
  )
    return { candidates: [], reason: 'discord_current_scope_unavailable' };
  const candidates = observation.targets.filter(
    (target) =>
      target.editable &&
      isTextbox(target) &&
      !target.inMessages &&
      !target.browserSearch &&
      !target.browserAddress &&
      (target.discordMessageComposer === true ||
        (!paneId(target) && target.discordChatInput === true)) &&
      composerContext(target) &&
      Number.isFinite(target.position?.x) &&
      Number.isFinite(target.position?.y) &&
      target.position.x >= 0 &&
      target.position.x <= 100 &&
      target.position.y >= 0 &&
      target.position.y <= 100,
  );
  const inventory = view.window.discordComposerScan;
  if (
    inventory !== undefined &&
    (inventory?.complete !== true ||
      !Number.isInteger(inventory.count) ||
      inventory.count < 0 ||
      inventory.count > 8 ||
      inventory.count !== candidates.length)
  )
    return { candidates: [], reason: 'discord_current_composer_scan_incomplete' };
  if (observation.truncated && inventory?.complete !== true)
    return { candidates: [], reason: 'discord_current_observation_truncated' };
  if (candidates.length > 1 && candidates.some((target) => !paneId(target)))
    return { candidates: [], reason: 'discord_current_composer_ambiguous' };
  return { observation, candidates, reason: 'discord_current_composer_unavailable' };
}
/** Structural metadata only. No recipient labels, pane IDs, drafts, or fingerprints reach the model. */
export function discordCurrentComposers(view) {
  const { candidates } = currentComposerState(view);
  return candidates.map((target) => ({
    targetId: target.targetId,
    side: target.position.x <= 45 ? 'left' : target.position.x >= 55 ? 'right' : 'current',
    position: { x: target.position.x, y: target.position.y },
    role: 'message-composer',
  }));
}
const inChannel = (request, observation) =>
  same(observation.activeServer, request.server) &&
  same(observation.activeChannel, request.channel);
function connectionEvidence(request, observation) {
  if (observation.disconnect.length !== 1 || !observation.connectionLabels.length) return null;
  // A selected channel or a generic Connected label alone does not establish
  // which channel this account joined. Bind both names to the voice panel.
  return (
    observation.voicePanel.find((target) => {
      if (
        target.inMessages ||
        (target.ancestors.some((entry) => actualUserGroup.test(entry)) &&
          !/(?:^|\.)Hyperlink$/u.test(target.role ?? ''))
      )
        return false;
      const pieces = target.label.split(/\s*(?:\/|\||,|\n)\s*/u);
      return (
        pieces.some((piece) => same(piece, request.channel)) &&
        pieces.some((piece) => same(piece, request.server))
      );
    })?.label ?? null
  );
}

/** Task-local state. Never persist message contents or visible conversation text. */
export class DiscordGuiTask {
  constructor(request, { language = 'en' } = {}) {
    this.request = validateDiscordRequest(request);
    this.language = language;
    this.performed = [];
    this.uncertain = false;
    this.currentBinding = null;
  }
  record(step, result, before) {
    if (result?.ok !== true) {
      this.uncertain = true;
      return;
    }
    const observation = discordObservation(before);
    this.performed.push({
      action: step.action,
      target: observation?.targets.find((target) => target.targetId === step.targetId)?.label,
      ...(step.action === 'press_keys' ? { keys: step.keys } : {}),
      ...(step.action === 'enter_text' ? { text: step.text } : {}),
      ...(step.action === 'press_keys' &&
      step.keys?.includes('ENTER') &&
      ['send_message', 'send_current_message'].includes(this.request.action)
        ? {
            messageCount:
              this.request.action === 'send_current_message'
                ? this.currentMessageCount(observation)
                : (observation?.targets.filter((target) =>
                    messageMatches(target, this.request.text),
                  ).length ?? 0),
          }
        : {}),
    });
  }
  outcome(view) {
    const observation = discordObservation(view),
      request = this.request;
    if (!observation || this.uncertain || view.window?.modal || observation.quickFields.length)
      return null;
    if (request.action === 'send_current_message') {
      const selection = this.currentSelection(view);
      const submission = this.performed.find(
        (step) => step.action === 'press_keys' && step.keys?.includes('ENTER'),
      );
      if (
        !this.currentBinding ||
        !selection.target ||
        !this.sameCurrentScope(selection.target, view) ||
        !submission ||
        this.currentMessageCount(observation) <= submission.messageCount ||
        selection.target.untrustedValue !== '' ||
        selection.target.untrustedValueSha256 !== emptyDraftHash
      )
        return null;
      return {
        verified: true,
        status: 'submitted',
        submitted: true,
        deliveryConfirmed: false,
        evidence: request.text,
        summary:
          this.language === 'ru'
            ? 'Отправила сообщение в указанный открытый чат Discord.'
            : 'Message submitted in the requested visible Discord chat.',
      };
    }
    if (
      request.channel &&
      observation.targets.filter(
        (target) => target.kind === request.channelType && same(target.name, request.channel),
      ).length > 1
    )
      return null;
    if (request.action === 'leave_voice') {
      const left = this.performed.some(
        (step) => step.action === 'click' && disconnectLabel.test(step.target ?? ''),
      );
      const panelDisconnected =
        observation.userPanel?.complete === true &&
        observation.userPanel.settingsPresent === true &&
        observation.userPanel.disconnectPresent === false;
      const verified =
        observation.disconnected ||
        (left &&
          (panelDisconnected ||
            (observation.loaded &&
              !observation.truncated &&
              !observation.disconnect.length &&
              !observation.connectionLabels.length)));
      return verified
        ? {
            verified: true,
            evidence:
              observation.disconnected?.label ??
              (panelDisconnected
                ? 'User status and settings'
                : (observation.targets.find((target) => settingsLabel.test(target.label))?.label ??
                  'User Settings')),
            summary:
              this.language === 'ru'
                ? 'Вышла из голосового канала Discord.'
                : 'Left the Discord voice channel.',
          }
        : null;
    }
    if (request.action === 'join_voice') {
      const evidence = connectionEvidence(request, observation);
      return evidence
        ? {
            verified: true,
            evidence,
            summary:
              this.language === 'ru'
                ? `Подключилась к голосовому каналу «${request.channel}» на сервере «${request.server}».`
                : `Joined voice channel “${request.channel}” on “${request.server}”.`,
          }
        : null;
    }
    if (request.action === 'list_channels') {
      if (!same(observation.activeServer, request.server)) return null;
      const channels = observation.targets
        .filter((target) => ['voice', 'text'].includes(target.kind))
        .map((target) => ({ name: target.name, type: target.kind }));
      if (!channels.length) return null;
      return {
        verified: true,
        evidence: view.window.untrustedTitle,
        summary:
          this.language === 'ru'
            ? 'Прочитала видимые каналы указанного сервера Discord.'
            : 'Read the visible channels in the requested Discord server.',
        untrustedVisibleChannels: channels,
        contextScope: 'visible_only',
      };
    }
    if (!inChannel(request, observation)) return null;
    if (request.action === 'send_message') {
      const submission = this.performed.find(
        (step) => step.action === 'press_keys' && step.keys?.includes('ENTER'),
      );
      const count = observation.targets.filter((target) =>
        messageMatches(target, request.text),
      ).length;
      const composer = this.composers(observation);
      if (
        !submission ||
        count <= submission.messageCount ||
        composer.length !== 1 ||
        composer[0].untrustedValue !== '' ||
        composer[0].untrustedValueSha256 !== emptyDraftHash
      )
        return null;
      return {
        verified: true,
        status: 'submitted',
        submitted: true,
        deliveryConfirmed: false,
        evidence: request.text,
        summary:
          this.language === 'ru'
            ? 'Передала сообщение в указанный канал Discord.'
            : 'Message submitted in the specified Discord channel.',
      };
    }
    return {
      verified: true,
      evidence: view.window.untrustedTitle,
      summary:
        this.language === 'ru'
          ? `Открыла канал «${request.channel}» на сервере «${request.server}».`
          : `Opened “${request.channel}” on “${request.server}”.`,
      ...(request.action === 'read_context'
        ? {
            untrustedVisibleContext: observation.targets
              .filter(
                (target) =>
                  !target.editable &&
                  target.inMessages &&
                  /(?:Text|ListItem)$/u.test(target.role ?? ''),
              )
              .map((target) => target.label)
              .filter(Boolean)
              .join('\n')
              .slice(0, 6000),
            contextScope: 'visible_only',
          }
        : {}),
    };
  }
  composers(observation) {
    return observation.targets.filter(
      (target) =>
        target.editable &&
        isTextbox(target) &&
        !target.inMessages &&
        target.ancestors.some(
          (entry) =>
            channelContentGroup.test(entry) ||
            (textSuffix.test(entry) && same(entry.replace(textSuffix, ''), this.request.channel)) ||
            (target.discordChatInput === true &&
              channelSuffix.test(entry) &&
              same(entry.replace(channelSuffix, ''), this.request.channel)),
        ) &&
        /^(?:message\s+#|сообщение\s+#|написать\s+в\s+#)/iu.test(target.label) &&
        same(
          target.label.replace(/^(?:message\s+#|сообщение\s+#|написать\s+в\s+#)/iu, ''),
          this.request.channel,
        ),
    );
  }
  currentSelection(view) {
    const state = currentComposerState(view);
    if (!state.candidates.length) return state;
    const selected =
      this.request.side === 'current'
        ? state.candidates
        : state.candidates.filter((target) =>
            this.request.side === 'left' ? target.position.x <= 45 : target.position.x >= 55,
          );
    return selected.length === 1
      ? { ...state, target: selected[0] }
      : {
          ...state,
          reason:
            selected.length > 1
              ? 'discord_current_composer_ambiguous'
              : 'discord_current_composer_unavailable',
        };
  }
  currentScope(target, view) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          view.window.windowId,
          view.window.untrustedTitle,
          paneId(target),
          target.label,
          target.ancestors,
          composerContext(target),
          paneId(target)
            ? null
            : target.position.x <= 45
              ? 'left'
              : target.position.x >= 55
                ? 'right'
                : 'current',
        ]),
      )
      .digest('hex');
  }
  sameCurrentScope(target, view) {
    return this.currentBinding?.fingerprint === this.currentScope(target, view);
  }
  currentMessageCount(observation) {
    if (!this.currentBinding || !observation) return 0;
    return observation.targets.filter((target) => {
      if (
        (!target.inMessages && target.discordMessage !== true) ||
        !messageMatches(target, this.request.text)
      )
        return false;
      if (this.currentBinding.paneId) return paneId(target) === this.currentBinding.paneId;
      // Legacy observations are usable only for a unique, exactly named chat.
      return (
        !paneId(target) &&
        target.ancestors.some((ancestor) => {
          const labelled = ancestor
            .replace(/^(?:messages in|сообщения в)\s+/iu, '')
            .replace(/\s*\((?:channel|text channel|voice channel|direct message|dm)\)$/iu, '');
          return labelled !== ancestor && key(labelled) === this.currentBinding.context;
        })
      );
    }).length;
  }
  nextCurrent(view) {
    const selected = this.currentSelection(view);
    const stop = (reason, summary) => ({ action: 'ask_user', reason, summary });
    if (!selected.target)
      return stop(
        selected.reason,
        selected.reason === 'discord_current_composer_ambiguous'
          ? 'More than one Discord chat matches. Specify the intended visible chat.'
          : 'I could not identify the requested visible Discord message composer.',
      );
    const target = selected.target;
    if (this.currentBinding && !this.sameCurrentScope(target, view))
      return stop(
        'discord_current_scope_changed',
        'The selected Discord chat changed. Check it before retrying.',
      );
    if (!this.currentBinding)
      this.currentBinding = {
        fingerprint: this.currentScope(target, view),
        paneId: paneId(target),
        context: composerContext(target),
      };
    if (this.performed.some((step) => step.action === 'press_keys' && step.keys?.includes('ENTER')))
      return stop(
        'discord_current_submission_unverified',
        'Sending was attempted once. Check the selected chat before sending again.',
      );
    const entered = this.performed.some((step) => step.action === 'enter_text');
    if (entered) {
      if (!draftMatches(target, this.request.text))
        return stop(
          'discord_current_draft_changed',
          'The Discord draft changed after entry. It will not be overwritten or submitted.',
        );
      if (!target.focused) return click(target, 'Focus the verified Discord message draft.');
      return {
        action: 'press_keys',
        keys: ['ENTER'],
        discordMutation: {
          expectedValueSha256: createHash('sha256').update(this.request.text, 'utf8').digest('hex'),
          ...(this.currentBinding.paneId
            ? { expectedDiscordPaneId: this.currentBinding.paneId }
            : {}),
        },
        summary: 'Send the exact owner-requested message once.',
      };
    }
    if (target.untrustedValue !== '' || target.untrustedValueSha256 !== emptyDraftHash)
      return stop(
        'discord_current_draft_present',
        'This Discord chat already has a draft, or its empty state is unavailable. It was not overwritten.',
      );
    return {
      action: 'enter_text',
      targetId: target.targetId,
      text: this.request.text,
      mode: 'replace',
      discordMutation: {
        expectedValueSha256: emptyDraftHash,
        ...(this.currentBinding.paneId
          ? { expectedDiscordPaneId: this.currentBinding.paneId }
          : {}),
      },
      summary: 'Enter the exact owner-requested message in the verified visible chat.',
    };
  }
  quickStep(purpose, observation) {
    const request = this.request;
    if (purpose === 'channel' && request.channelType === 'voice' && request.action !== 'join_voice')
      return ask(
        'Quick Switcher may connect this voice channel. Explicitly request joining it to continue.',
      );
    const query =
      (purpose === 'server' ? '*' : request.channelType === 'voice' ? '!' : '#') +
      (purpose === 'server' ? request.server : request.channel);
    const field = observation.quickFields;
    if (!field.length) {
      if (this.performed.some((step) => step.action === 'enter_text' && step.text === query))
        return ask('Discord did not verify the requested Quick Switcher result.');
      const last = this.performed.at(-1);
      if (last?.action === 'press_keys' && last.keys?.join('+') === 'CTRL+K')
        return ask('Discord did not expose its Quick Switcher search field; no text was entered.');
      return { action: 'press_keys', keys: ['CTRL', 'K'], summary: 'Open Discord Quick Switcher.' };
    }
    if (field.length !== 1)
      return ask('Discord exposed multiple Quick Switcher fields. Choose the intended field.');
    if (field[0].untrustedValue !== query)
      return {
        action: 'enter_text',
        targetId: field[0].targetId,
        text: query,
        mode: 'replace',
        summary: 'Search the exact Discord server or channel in Quick Switcher.',
      };
    const matches = observation.targets.filter((target) => {
      if (
        target.editable ||
        !/(?:ListItem|Button|Hyperlink|TreeItem)$/u.test(target.role ?? '') ||
        !target.ancestors.some((entry) => quickGroup.test(entry))
      )
        return false;
      const parts = target.label
        .replace(voiceSuffix, '')
        .replace(textSuffix, '')
        .replace(/^[*!#]\s*/u, '')
        .split(/\s*[,|]\s*/u);
      if (purpose === 'server')
        return (
          same(parts[0], request.server) &&
          (parts.length === 1 || parts.slice(1).some((part) => /^(?:server|сервер)$/iu.test(part)))
        );
      return (
        same(parts[0], request.channel) &&
        parts.some((part) => same(part, request.server)) &&
        (target.kind === request.channelType ||
          parts.some((part) =>
            request.channelType === 'voice'
              ? /^(?:voice channel|голосовой канал)$/iu.test(part)
              : /^(?:text channel|текстовый канал)$/iu.test(part),
          ))
      );
    });
    if (matches.length !== 1)
      return ask(
        matches.length > 1
          ? 'More than one exact Discord search result matches. Specify the server or category.'
          : 'Quick Switcher has no unambiguous exact result with the requested server and channel type.',
      );
    if (this.performed.some((step) => step.action === 'click' && step.target === matches[0].label))
      return ask(
        'The selected Discord search result did not become active. Check Discord before retrying.',
      );
    // Clicking an explicitly matched result avoids Enter submitting an unrelated
    // focused field or accepting the switcher's first, approximate result.
    return click(matches[0], 'Select the exact Discord Quick Switcher result.');
  }
  next(view) {
    const request = this.request;
    if (this.uncertain)
      return ask(
        'The previous Discord action may have partially completed. Check its current state before retrying.',
      );
    const observation = discordObservation(view);
    if (!observation) {
      const apps = (view?.targets ?? []).filter(
        (target) =>
          target.surface === 'taskbar' &&
          !target.notificationArea &&
          /^(?:discord|discord\s*[-–—].*)$/iu.test(name(target.untrustedLabel)),
      );
      return apps.length === 1
        ? click(apps[0], 'Focus the already open Discord window.')
        : ask('Bring the already open Discord window to the foreground.');
    }
    if (view.window?.modal && !observation.quickFields.length)
      return ask('Discord has an open dialog. Resolve it before continuing.');
    const outcome = this.outcome(view);
    if (outcome) return { action: 'finish', evidence: outcome.evidence, summary: outcome.summary };
    if (request.action === 'send_current_message') return this.nextCurrent(view);
    if (request.action === 'leave_voice') {
      if (observation.disconnect.length !== 1)
        return ask('I could not identify one active Discord voice connection.');
      if (
        this.performed.some(
          (step) => step.action === 'click' && disconnectLabel.test(step.target ?? ''),
        )
      )
        return ask(
          'The voice disconnection is not yet verified; it will not be repeated automatically.',
        );
      return click(observation.disconnect[0], 'Leave the current Discord voice channel.');
    }
    if (!same(observation.activeServer, request.server)) {
      const servers = observation.targets.filter(
        (target) => target.kind === 'server' && same(target.name, request.server),
      );
      if (servers.length > 1)
        return ask(
          'More than one visible Discord server has that exact name. Specify which server.',
        );
      if (!servers.length || observation.quickFields.length)
        return this.quickStep('server', observation);
      if (
        this.performed.some((step) => step.action === 'click' && step.target === servers[0].label)
      )
        return ask(
          'The requested server did not become active after clicking; check Discord before retrying.',
        );
      return click(servers[0], 'Open the exact requested Discord server.');
    }
    if (request.action === 'list_channels')
      return ask(
        'The server is active, but its channel list is not visible. Expand its categories before listing channels.',
      );
    const channels = observation.targets.filter(
      (target) => target.kind === request.channelType && same(target.name, request.channel),
    );
    if (channels.length > 1)
      return ask(
        'More than one visible Discord channel has that exact name and type. Specify its category.',
      );
    if (!inChannel(request, observation)) {
      if (!channels.length || observation.quickFields.length)
        return this.quickStep('channel', observation);
      if (request.action !== 'join_voice' && request.channelType === 'voice')
        return ask(
          'Opening this voice channel may connect the account. Explicitly request joining it to continue.',
        );
      if (
        this.performed.some((step) => step.action === 'click' && step.target === channels[0].label)
      )
        return ask(
          'The requested channel did not become active after clicking; check Discord before retrying.',
        );
      return click(channels[0], 'Open the exact requested Discord channel.');
    }
    if (request.action === 'join_voice') {
      if (observation.disconnect.length)
        return ask(
          'Discord shows an active voice connection, but the exact server/channel connection is not verified.',
        );
      const join = observation.targets.filter(
        (target) =>
          isButton(target) &&
          joinLabel.test(target.label) &&
          (inVoicePanel(target) ||
            target.ancestors.some(
              (entry) =>
                voiceSuffix.test(entry) && same(entry.replace(voiceSuffix, ''), request.channel),
            )),
      );
      if (join.length !== 1)
        return ask('I could not identify one Join Voice control for the requested channel.');
      if (
        this.performed.some((step) => step.action === 'click' && joinLabel.test(step.target ?? ''))
      )
        return ask(
          'Discord did not verify the requested voice connection; joining will not be repeated automatically.',
        );
      return click(join[0], 'Join the requested Discord voice channel.');
    }
    if (request.action === 'send_message') {
      if (
        this.performed.some((step) => step.action === 'press_keys' && step.keys?.includes('ENTER'))
      )
        return ask(
          'The send was attempted once, but the new message is not verified. Check the channel before sending again.',
        );
      const composers = this.composers(observation);
      if (composers.length !== 1)
        return ask('I could not identify the message composer for the exact requested channel.');
      const composer = composers[0];
      if (draftMatches(composer, request.text)) {
        if (!composer.focused) return click(composer, 'Focus the verified Discord message draft.');
        return {
          action: 'press_keys',
          keys: ['ENTER'],
          summary: 'Send the exact owner-requested message once.',
        };
      }
      if (composer.untrustedValue !== '')
        return ask(
          'This Discord channel already has a draft. Clear or save it before sending another message.',
        );
      if (composer.untrustedValueSha256 !== emptyDraftHash)
        return ask(
          'The current Discord draft is hidden or unavailable. Its empty state must be verified before entering a message.',
        );
      if (
        this.performed.some(
          (step) =>
            step.action === 'enter_text' &&
            step.target === composer.label &&
            step.text === request.text,
        )
      )
        return ask(
          'The verified Discord draft changed after entry. Check the channel before typing or sending again.',
        );
      return {
        action: 'enter_text',
        targetId: composer.targetId,
        text: request.text,
        mode: 'replace',
        summary: 'Draft the exact owner-requested message.',
      };
    }
    return ask('The requested Discord result is not verified.');
  }
}
