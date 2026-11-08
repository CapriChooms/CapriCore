// SPDX-License-Identifier: GPL-3.0-only
import {
  discordObservation,
  discordCurrentMessageParts,
  discordTaskRequest,
  validateDiscordRequest,
} from './discord-application.mjs';
import { mentionsDiscord } from './computer-mode-request.mjs';

// This is a final, conservative check of an already classified owner task. It
// grants no permission and never accepts observations or generated reply text.
const quotedData =
  /"([^"\r\n]*)"|“([^”\r\n]*)”|„([^“\r\n]*)“|«([^»\r\n]*)»|「([^」\r\n]*)」|『([^』\r\n]*)』|‘([^’\r\n]*)’|(?<![\p{L}\p{N}])'([^'\r\n]*)'(?![\p{L}\p{N}])/gu;
const words = {
  send_message:
    'send|post|write|отправь(?:те)?|отправить|напиши(?:те)?|написать|опубликуй(?:те)?|опубликовать|envoie|envoyez|envoyer|poste|postez|poster|publie|publiez|publier|écris|écrivez|écrire|ecris|ecrire|sende|senden|schick|schicke|schicken|schreib|schreibe|schreiben|veröffentliche|envía|envia|envíe|envíen|enviar|manda|mande|mandar|publica|publique|publicar|escribe|escriba|escribir|envie|escreve|escreva|escrever|invia|inviare|scrivi|scrivere|pubblica|pubblicare|أرسل|ارسل|انشر|اكتب|gönder|yolla|paylaş|yaz',
  join_voice:
    'join|connect|подключись|подключитесь|подключиться|присоединись|присоединитесь|присоединиться|зайди(?:те)?|войди(?:те)?|rejoins|rejoignez|rejoindre|connecte-toi|connectez-vous|tritt|trete|betritt|verbinde|verbinden|únete|unete|unirse|conéctate|conectate|entra|entre|entrar|ingresa|junta-te|junte-se|conecta-te|conecte-se|unisciti|unire|collegati|connettiti|انضم|اتصل|ادخل|katıl|bağlan|gir',
  leave_voice:
    'leave|disconnect|выйди(?:те)?|отключись|отключитесь|отключиться|покинь(?:те)?|quitte|quittez|quitter|déconnecte-toi|déconnectez-vous|verlasse|verlassen|trenne|trenn|trennen|sal|salte|desconéctate|desconectate|abandona|sai|saia|desconecta|desconecte|deixa|deixe|esci|lascia|disconnettiti|غادر|اخرج|افصل|ayrıl|çık|bağlantıyı\\s+kes',
  navigate:
    'open|navigate|go\\s+to|switch\\s+to|find|открой(?:те)?|перейди(?:те)?|переключись|найди(?:те)?|ouvre|ouvrez|ouvrir|va|allez|navigue|naviguez|öffne|öffnen|gehe|geh|wechsle|wechsel|abre|abrir|abra|navega|navegue|ve|cambia|busca|vai|vá|muda|mude|procura|procure|apri|aprire|passa|cerca|افتح|انتقل|اذهب|ابحث|aç|git|geç',
  read_context:
    'read|summarize|summarise|прочитай(?:те)?|перескажи(?:те)?|суммируй(?:те)?|lis|lisez|lire|résume|résumez|lese|lies|lesen|fasse|lee|leer|resume|resuma|resumir|lê|leia|ler|leggi|leggere|riassumi|اقرأ|لخص|لخّص|oku|özetle',
  list_channels:
    'list|show|enumerate|перечисли(?:те)?|покажи(?:те)?|liste|listez|lister|montre|montrez|affiche|affichez|zeige|zeig|auflisten|enumera|lista|muestra|mostrar|mostra|mostre|elenca|اعرض|اسرد|listele|göster',
};
const direct = Object.fromEntries(
  Object.entries(words).map(([action, source]) => [
    action,
    new RegExp(`^(?:${source})(?!\\p{L})`, 'iu'),
  ]),
);
const polite = Object.fromEntries(
  Object.entries(words).map(([action, source]) => [
    action,
    new RegExp(`(?<!\\p{L})(?:${source})(?!\\p{L})`, 'iu'),
  ]),
);
const scripts = {
  send_message:
    /送って|送信して|投稿して|書いて|보내\s*(?:줘|주세요)|보내세요|전송해|게시해|써\s*(?:줘|주세요)|작성해/u,
  join_voice: /参加して|接続して|入って|참여해|접속해|들어가(?:\s*(?:줘|주세요))?|연결해/u,
  leave_voice: /退出して|切断して|抜けて|나가(?:\s*(?:줘|주세요))?|연결을\s*끊어|퇴장해/u,
  navigate: /開いて|移動して|切り替えて|열어|이동해|전환해/u,
  read_context: /読んで|要約して|읽어|요약해/u,
  list_channels: /(?:チャンネル|一覧|リスト).*表示して|列挙して|(?:채널|목록).*보여|나열해/u,
};
const chinese = {
  send_message: /发送|發送|发布|發佈|写下|寫下/u,
  join_voice: /加入|连接|連接|进入|進入/u,
  leave_voice: /离开|離開|断开|斷開|退出/u,
  navigate: /打开|打開|切换|切換|前往/u,
  read_context: /阅读|閱讀|读一下|讀一下|总结|總結/u,
  list_channels: /列出|显示|顯示/u,
};
const turkish = {
  send_message: /(?<!\p{L})(?:gönder|yolla|paylaş|yaz)[.!?\s]*$/iu,
  join_voice: /(?<!\p{L})(?:katıl|bağlan|gir)[.!?\s]*$/iu,
  leave_voice: /(?<!\p{L})(?:ayrıl|çık|bağlantıyı\s+kes)[.!?\s]*$/iu,
  navigate: /(?<!\p{L})(?:aç|git|geç)[.!?\s]*$/iu,
  read_context: /(?<!\p{L})(?:oku|özetle)[.!?\s]*$/iu,
  list_channels: /(?<!\p{L})(?:listele|göster)[.!?\s]*$/iu,
};
const chineseLead =
  /^(?:请|請|帮我|幫我|替我|在|到|从|從|发送|發送|发布|發佈|写下|寫下|加入|连接|連接|进入|進入|离开|離開|断开|斷開|退出|打开|打開|切换|切換|前往|阅读|閱讀|读一下|讀一下|总结|總結|列出|显示|顯示)|我(?:想|需要|要)(?:让|讓|请|請)你/u;
const channel =
  /(?<!\p{L})(?:channel|channels|канал\p{L}*|salon|salons|canal|canaux|kanal|kanäle|canales|canais|canali|kanalları|kanallar)(?!\p{L})|チャンネル|채널|频道|頻道|القنا[ةت]|قنوات/iu;
const voice =
  /(?<!\p{L})(?:voice|call|audio|vocal|vocale|sprach\p{L}*|anruf|voz|голос\p{L}*|звон\p{L}*|созвон\p{L}*|ses|arama)(?!\p{L})|ボイス|音声|通話|음성|통화|语音|語音|صوت/iu;
const context =
  /(?<!\p{L})(?:chat|context|messages?|discussion|чат\p{L}*|сообщени\p{L}*|контекст|обсуждени\p{L}*|contexte|nachrichten|mensajes|mensagens|messaggi)(?!\p{L})|メッセージ|会話|메시지|대화|消息|聊天|رسائل|mesaj/iu;
const appPrefix =
  /^(?:(?:in|on|dans|sur|auf|en|no|na|nel|su|в|во|في)\s+(?:(?:my|the|мо[её]м|mon|le|mi|el|meu|o|mio|il|meinem|dem)\s+)?(?:discord|дискорд(?:а|е|ом|у)?|ديسكورد)[,:،\s]*|discord['’](?:da|de|ta|te)[,:\s]*|(?:discord|дискорд(?:а|е|ом|у)?)[,:]\s*)/iu;
const politePrefix =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|(?:можешь|можете)\s+(?:пожалуйста\s+)?|(?:peux-tu|pourrais-tu|pouvez-vous)\s+|(?:kannst|könntest)\s+du\s+|(?:puedes|podrías)\s+|(?:pode|podes|poderia)\s+|(?:puoi|potresti)\s+)/iu;
const requestPrefix =
  /^(?:i\s+(?:want|need|would\s+like)\s+you\s+to\s+|я\s+(?:хочу|прошу)(?:,?\s*чтобы\s+ты)?\s+|je\s+(?:veux|voudrais)\s+que\s+tu\s+|ich\s+möchte,?\s+dass\s+du\s+|quiero\s+que\s+|quero\s+que\s+|voglio\s+che\s+|أريد\s+منك\s+أن\s+)/iu;
const courtesyPrefix =
  /^(?:(?:(?:hey\s+)?capri|капри)[,\s:]+|(?:please|пожалуйста|s'il te plaît|s’il te plaît|bitte|por favor|per favore|lütfen)[,\s:]+|من\s+فضلك[,\s:،]+)/iu;
const accessPrefix =
  /^(?:(?:use|using|with)\s+full\s+(?:computer|pc|desktop)\s+(?:access|control)(?:\s+(?:to|and))?[,\s:]*|(?:используй|используя|через)\s+полн\p{L}*\s+(?:доступ|управление)\p{L}*\s+(?:к\s+)?(?:моему\s+)?(?:компьютер\p{L}*|пк)(?:\s+и)?[,\s:]*)/iu;
const meta =
  /^(?:how|what|why|explain|describe|translate|teach|tell\s+me|show\s+me\s+how|do\s+you\s+know|are\s+you\s+able|как|что|почему|объясни|переведи|научи|умеешь|ты\s+умеешь|можешь\s+ли|можно\s+ли|comment|pourquoi|explique|traduis|sais-tu|wie|warum|erkläre|übersetze|cómo|como\s+(?:puedo|fazer)|qué|explica|traduce|com[eo]\s+(?:si|posso)|spiega|traduci|nasıl|açıkla|çevir|كيف|اشرح|ترجم)(?!\p{L})/iu;
const negation =
  /(?<!\p{L})(?:do\s+not|don't|don’t|never|не|нельзя|nicht|kein\p{L}*|não|nao|non|nunca|jamais)(?!\p{L})|(?:^|[.!?;,]\s*|\bpero\s+)no\s+|(?<!\p{L})ne\s+[^.!?]{0,100}\s+pas(?!\p{L})|しないで|送らないで|入らないで|参加しない|하지\s*마|보내지\s*마|들어가지\s*마|不要|别|別|(?<!\p{L})لا\s+|gönderme|katılma|bağlanma|ayrılma/iu;
const draftOnly =
  /(?<!\p{L})(?:draft|without\s+sending|without\s+submitting|without\s+(?:pressing|hitting|using)\s+(?:the\s+)?(?:enter|return)|do\s+not\s+press|don't\s+press|черновик|черновика|без\s+нажати\p{L}*\s+(?:enter|ввод)|brouillon|sans\s+envoyer|entwurf|ohne\s+(?:zu\s+)?senden|borrador|sin\s+enviar|rascunho|sem\s+enviar|bozza|senza\s+inviare|taslak)(?!\p{L})|下書き|초안|草稿|مسودة/iu;
const hypothetical =
  /(?:^|[,;.!?\n]\s*)(?:for\s+example|as\s+an\s+example|e\.g\.|imagine|suppose|hypothetically|if|when\s+(?:i|we)\s+ask|например|к\s+примеру|представь|допустим|если|когда\s+я\s+попрошу|par\s+exemple|si\s+je|zum\s+beispiel|falls|wenn\s+ich|por\s+ejemplo|si\s+te\s+pido)(?!\p{L})|(?<!\p{L})(?:if\s+(?:i|we)\s+(?:ask|tell|request)|when\s+(?:i|we)\s+ask|если\s+я\s+попрошу)(?!\p{L})/iu;
const synthesis =
  /(?<!\p{L})(?:reply|respond|response|answer|greeting|friendly|appropriate|something|anything|whatever|guide|instructions?|tutorial|ответ\p{L}*|приветств\p{L}*|что-нибудь|инструкци\p{L}*|répond\p{L}*|réponse|antwort\p{L}*|respuesta|resposta|risposta|répondre|yanıt|cevap)(?!\p{L})|返信|返事|답장|回复|回覆|(?<!\p{L})رد(?:ًا)?(?!\p{L})/iu;

function commandForms(text) {
  let command = text.trim(),
    isPolite = false;
  for (let i = 0; i < 6; i++) {
    const before = command;
    if (politePrefix.test(command)) isPolite = true;
    command = command
      .replace(courtesyPrefix, '')
      .replace(politePrefix, '')
      .replace(requestPrefix, '')
      .replace(accessPrefix, '')
      .replace(appPrefix, '')
      .trim();
    if (before === command) break;
  }
  return { command, isPolite };
}

const containsName = (goal, value) => {
  const literal = value.normalize('NFKC').trim().toLocaleLowerCase();
  return literal.length > 1 && goal.toLocaleLowerCase().includes(literal);
};

function clauseData(raw) {
  const literals = [];
  const unquoted = raw.replace(quotedData, (...parts) => {
    const start = parts.at(-2);
    literals.push({
      text: parts.slice(1, -2).find((part) => part !== undefined),
      start,
      end: start + parts[0].length,
    });
    return ' '.repeat(parts[0].length);
  });
  return { raw, unquoted, literals, ...commandForms(unquoted.normalize('NFKC')) };
}

const clauseBoundary =
  /[,،;；.!?。！？\n]|\s+(?:and(?:\s+then)?|then|и|затем|потом|et|puis|ensuite|und|dann|danach|y|luego|después|e|depois|poi|ve|sonra)\s+|そして|それから|그리고|그런\s+다음|然后|然後|接着/giu;
const foreignApp =
  /(?<!\p{L})(?:notepad|блокнот\p{L}*|chrome|edge|firefox|browser|браузер\p{L}*|word|excel|telegram|whatsapp|slack|teams|zoom|obsidian|vscode|terminal|терминал\p{L}*)(?!\p{L})|メモ帳|ノートパッド|메모장|记事本|記事本/iu;
const location =
  /(?<!\p{L})(?:in|into|on|to|dans|sur|auf|im|zu|zum|en|al|em|no|na|ao|su|nel|в|во|на|في|إلى)\s+(?:(?:the|my|this|that|a|an|current|selected|latest|last|le|la|les|mon|mi|el|los|o|os|il|i|dem|den|die|der|мой|этот|текущий)\s+)*([\p{L}\p{N}#_-]+)/giu;
const localDestination =
  /^(?:discord|дискорд\p{L}*|channel\p{L}*|server\p{L}*|chat\p{L}*|text|voice|call|audio|vocal|vocale|канал\p{L}*|сервер\p{L}*|чат\p{L}*|текстов\p{L}*|голос\p{L}*|звон\p{L}*|salon\p{L}*|canal\p{L}*|serveur\p{L}*|sprach\p{L}*|kanal\p{L}*|kanäle|canais|canali|message\p{L}*|everyone|ديسكورد|القناة|القنوات)$/iu;

function anotherDestination(clause, request) {
  if (foreignApp.test(clause.command)) return true;
  for (const match of clause.command.matchAll(location)) {
    const destination = match[1];
    if (
      request.action === 'send_current_message' &&
      discordCurrentMessageParts(clause.raw) &&
      /^(?:right|left|current|selected|active|open|screen|dm|conversation|справа|слева|прав\p{L}*|лев\p{L}*|текущ\p{L}*|выбранн\p{L}*|открыт\p{L}*|этот|этом|droite|gauche|actuel\p{L}*|courant\p{L}*|sélectionn\p{L}*|rechts|links|aktuell\p{L}*|ausgewählt\p{L}*|derecha|izquierda|actual|direita|esquerda|atual|destra|sinistra|corrente|questo|questa|sağ\p{L}*|sol\p{L}*|mevcut|seçili)$/iu.test(
        destination,
      )
    )
      continue;
    if (
      localDestination.test(destination) ||
      mentionsDiscord(destination) ||
      [request.server, request.channel].some((value) => value && containsName(value, destination))
    )
      continue;
    return true;
  }
  return false;
}

const destinationLabels = {
  server: String.raw`(?<!\p{L})(?:server|сервер\p{L}*|serveur|servidor|sunucu\p{L}*|الخادم|خادم|السيرفر|سيرفر)(?!\p{L})|サーバー|サーバ|서버|服务器|伺服器`,
  channel: String.raw`(?<!\p{L})(?:channel|канал\p{L}*|salon|canal|canale|kanal\p{L}*|sprachkanal|textkanal|القناة|قناة)(?!\p{L})|チャンネル|채널|频道|頻道`,
};
const namePrefix =
  /^\s*[:=]?\s*#?\s*(?:(?:de\s+(?:voz|texto)|vocal|textuel|vocale|voice|text|голосов\p{L}*|текстов\p{L}*|الصوتية|النصية)\s+)*/iu;
const nameStop =
  /\s+(?:in|on|at|of|from|to|into|en|del|de\s+(?:la|los)|sur|dans|auf|im|на|в|во|из|на|في|إلى|server|serveur|servidor|сервер\p{L}*)(?!\p{L})|[,،:;.!?。！？]/iu;
const noName =
  /^(?:in|on|at|of|from|to|into|en|del|sur|dans|auf|im|на|в|во|из|في|إلى)(?!\p{L})|^(?:(?:the|a|an|current|selected|active|same|this|that|available|actuel|courant|actual|atual|corrente|текущ\p{L}*|этот|этом|выбранн\p{L}*|الحالي\p{L}*|المحدد\p{L}*)\s*)+$/iu;
const nfcName = (value, kind) =>
  value
    .normalize('NFC')
    .trim()
    .replace(kind === 'channel' ? /^#\s*/u : /$^/u, '');

function explicitDestinations(clause) {
  const names = { server: [], channel: [] };
  for (const [kind, source] of Object.entries(destinationLabels)) {
    for (const label of clause.unquoted.matchAll(new RegExp(source, 'giu'))) {
      const end = label.index + label[0].length;
      const suffix = clause.raw.slice(end);
      const prefix = namePrefix.exec(suffix)[0];
      const start = end + prefix.length;
      const literal = clause.literals.find((entry) => entry.start === start);
      if (literal) {
        names[kind].push(nfcName(literal.text, kind));
        continue;
      }
      // East Asian and Turkish interfaces commonly put a quoted name BEFORE
      // the channel/server label rather than after it.
      const previous = clause.literals.findLast((entry) => entry.end <= label.index);
      if (
        previous &&
        /^[\sの의]*$|^\s*(?:voice|text|ses|음성|텍스트|ボイス|テキスト|语音|語音|文字)\s*$/iu.test(
          clause.raw.slice(previous.end, label.index),
        )
      ) {
        names[kind].push(nfcName(previous.text, kind));
        continue;
      }
      const tail = clause.unquoted.slice(start);
      if (
        !tail.trim() ||
        noName.test(tail.trim()) ||
        /^(?:に|へ|を|で|から|의|에|에서|을|를|中|里|裡|上)/u.test(tail.trim()) ||
        Object.values(direct).some((pattern) => pattern.test(tail.trim()))
      )
        continue;
      const stop = nameStop.exec(tail);
      const supplied = tail.slice(0, stop?.index ?? tail.length).trim();
      if (supplied && !noName.test(supplied) && !mentionsDiscord(supplied))
        names[kind].push(nfcName(supplied, kind));
    }
  }
  for (const hash of clause.unquoted.matchAll(
    /(?<![\p{L}\p{N}])#([\p{L}\p{N}_-]{1,100})(?![\p{L}\p{N}_-])/gu,
  ))
    names.channel.push(nfcName(hash[1], 'channel'));
  return names;
}

const currentWord = String.raw`(?:(?<!\p{L})(?:current|selected|active|same|this|that|текущ\p{L}*|выбранн\p{L}*|этот|этом|этого|actuel\p{L}*|courant\p{L}*|sélectionn\p{L}*|ce|cet|actual|este|esta|atual|corrente|questo|questa|aktuell\p{L}*|ausgewählt\p{L}*|diesen|gleichen|mevcut|geçerli|seçili|bu|الحالي\p{L}*|المحدد\p{L}*|هذه|هذا)(?!\p{L})|現在|今|選択中|この|현재|지금|선택한|현재의|이|当前|當前|这个|這個|已选|已選)`;
function currentDestination(clause, kind, operation) {
  const target =
    kind === 'server'
      ? destinationLabels.server
      : `(?:${destinationLabels.channel})|calls?|звон\\p{L}*|созвон\\p{L}*|通話|통화` +
        (operation === 'read_context'
          ? '|messages?|chat|context|conversation|сообщени\\p{L}*|чат\\p{L}*|メッセージ|메시지|消息|聊天|رسائل'
          : '');
  return new RegExp(
    `(?:${currentWord})[^,;.!?。！？]{0,35}(?:${target})|(?:${target})[^,;.!?。！？]{0,35}(?:${currentWord})`,
    'iu',
  ).test(clause.command);
}

function destinationProblem(clause, request, view) {
  if (request.action === 'leave_voice') return null;
  const supplied = explicitDestinations(clause);
  for (const kind of ['server', 'channel']) {
    if (kind === 'channel' && request.action === 'list_channels') continue;
    const values = [...new Set(supplied[kind])];
    if (values.length > 1)
      return `The Discord ${kind} is ambiguous in this operation. Ask for its exact name.`;
    if (values.length && values[0] !== nfcName(request[kind], kind))
      return `Use the exact Discord ${kind} name from this owner-requested operation; do not choose another destination.`;
  }
  const currentChannel =
    request.action !== 'list_channels' && currentDestination(clause, 'channel', request.action);
  const currentServer = currentChannel || currentDestination(clause, 'server', request.action);
  const observation = discordObservation(view);
  if (currentServer || !supplied.server.length) {
    if (!observation?.activeServer || request.server !== observation.activeServer.normalize('NFC'))
      return 'Observe the current Discord server and bind this operation to that exact server, or ask for its name.';
  }
  if (request.action !== 'list_channels') {
    if (!supplied.channel.length && !currentChannel)
      return 'Ask for the exact Discord channel name or an explicit request to use the current channel.';
    if (
      currentChannel &&
      (!observation?.activeChannel ||
        request.channel !== observation.activeChannel.normalize('NFC'))
    )
      return 'Use the exact currently observed Discord channel and server; do not navigate to an arbitrary destination.';
    const wantsVoice = voice.test(clause.command);
    const wantsText =
      /(?<!\p{L})(?:text|textuel|textkanal|texto|testuale|текстов\p{L}*)(?!\p{L})|テキスト|텍스트|文本|文字/iu.test(
        clause.command,
      );
    if (
      (wantsVoice && wantsText) ||
      (wantsVoice && request.channelType !== 'voice') ||
      (wantsText && request.channelType !== 'text')
    )
      return 'Preserve the channel type requested by the owner; text and voice channels are different destinations.';
  }
  const parsed = discordTaskRequest(
    mentionsDiscord(clause.unquoted) ? clause.raw : `In Discord, ${clause.raw}`,
  );
  if (parsed && parsed.action !== 'clarify') {
    if (parsed.action !== request.action)
      return 'Preserve the exact Discord action requested in this operation.';
    for (const kind of ['server', 'channel', 'channelType'])
      if (parsed[kind] !== undefined && parsed[kind] !== request[kind])
        return `Preserve the owner-requested Discord ${kind}; do not change destinations.`;
  }
  return null;
}

function scopedClauses(goal, request) {
  // Non-whitespace placeholders keep a separator's leading whitespace from
  // swallowing the quoted destination immediately before "then" or "and".
  const masked = goal.replace(quotedData, (literal) => '\uE000'.repeat(literal.length));
  const clauses = [];
  let start = 0,
    scoped = false;
  for (const boundary of [...masked.matchAll(clauseBoundary), { index: goal.length, 0: '' }]) {
    const clause = { ...clauseData(goal.slice(start, boundary.index)), start };
    start = boundary.index + boundary[0].length;
    if (!clause.unquoted.trim()) continue;
    if (anotherDestination(clause, request)) scoped = false;
    else if (mentionsDiscord(clause.unquoted)) scoped = true;
    clauses.push({ ...clause, scoped });
  }
  return clauses;
}

function requested(clause, action) {
  if (meta.test(clause.command)) return false;
  return (
    direct[action].test(clause.command) ||
    (clause.isPolite && polite[action].test(clause.command)) ||
    scripts[action].test(clause.command) ||
    turkish[action].test(clause.command) ||
    (chineseLead.test(clause.command) && chinese[action].test(clause.command))
  );
}

function messageLiterals(clause) {
  return clause.literals
    .filter((literal, index) => {
      const before = clause.raw.slice(clause.literals[index - 1]?.end ?? 0, literal.start);
      const after = clause.raw.slice(
        literal.end,
        clause.literals[index + 1]?.start ?? clause.raw.length,
      );
      if (
        /(?:server|channel|сервер\p{L}*|канал\p{L}*|serveur|salon|canal|kanal|canais|canali)\s*#?\s*$/iu.test(
          before,
        )
      )
        return false;
      return (
        polite.send_message.test(before) ||
        polite.send_message.test(after) ||
        scripts.send_message.test(before + after) ||
        turkish.send_message.test(after) ||
        chinese.send_message.test(before) ||
        /(?:message|text|сообщение|текст)\s*:?[\s]*$/iu.test(before) ||
        /:\s*$/u.test(before)
      );
    })
    .map((literal) => literal.text);
}

function colonMessage(goal, clause) {
  const colon = clause.raw.lastIndexOf(':');
  return colon >= 0 && polite.send_message.test(clause.raw.slice(0, colon))
    ? goal.slice(clause.start + colon + 1).trim()
    : null;
}

function currentOwnerScope(goal, request, unquoted) {
  const parsed = discordCurrentMessageParts(goal);
  // A colon body, like quoted text, is data rather than authorization. Keep all
  // original prefixes and suffix qualifiers when checking the owner's intent.
  if (parsed?.literal === 'colon' && parsed.text === request.text) {
    const end = goal.trimEnd().length;
    return unquoted.slice(0, end - parsed.text.length);
  }
  return unquoted;
}

/** Compound goals must keep every step in the ordinary planning loop. */
export function discordSingleOperationGoal(goal) {
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 8000) return false;
  const current = discordCurrentMessageParts(goal);
  if (current) {
    const request = { action: 'send_current_message', side: current.side, text: current.text };
    const clauses = scopedClauses(goal, request);
    const message = (clause) => Boolean(discordCurrentMessageParts(clause.raw));
    if (clauses.length === 1 && message(clauses[0])) return true;
    if (
      clauses.length === 2 &&
      message(clauses[1]) &&
      /^(?:open|launch|start|открой(?:те)?|запусти(?:те)?|ouvre|ouvrez|öffne|abre|apri)\s+(?:discord|дискорд(?:а|е|ом|у)?)[.!?\s]*$/iu.test(
        clauses[0].command,
      )
    )
      return true;
  }
  const command = goal.replace(quotedData, ' ').normalize('NFKC');
  if (
    /[&;；]|(?<!\p{L})(?:and|then|also|additionally|и|потом|затем|также|ensuite|puis|et|luego|después|y|depois|e|poi|dann|danach|und|ve|sonra|ثم)(?!\p{L})|そして|それから|次に|그리고|그런\s+다음|然后|然後|接着|並且|并且|(?:^|\s)و(?=\p{L})/iu.test(
      command,
    )
  )
    return false;
  const operations = command
    .split(/[,،，、.!?。！？\n]/u)
    .map((part) => clauseData(part))
    .filter(
      (part) =>
        Object.keys(words).some((action) => requested(part, action)) ||
        /^(?:turn|enable|disable|press|click|type|share|copy|paste|delete|create|save|export|включи|выключи|нажми|создай|удали|сохрани|экспортируй)(?!\p{L})/iu.test(
          part.command,
        ),
    );
  return operations.length <= 1;
}

/** Return a correction for the planner, never a replacement goal or message. */
export function discordRequestProblem(goal, request, view) {
  let action;
  try {
    action = validateDiscordRequest(request);
  } catch (error) {
    return error.message;
  }
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 8000 || goal.includes('\0'))
    return 'Use the complete current owner-requested Discord goal.';
  const unquoted = clauseData(goal).unquoted.normalize('NFKC');
  if (!mentionsDiscord(unquoted))
    return 'The current owner goal must explicitly request an action in Discord.';
  const ownerScope =
    action.action === 'send_current_message' ? currentOwnerScope(goal, action, unquoted) : unquoted;
  const { command } = commandForms(ownerScope);
  if (
    meta.test(command) ||
    /如何|怎么|怎麼|能否|可否|是否|请问|請問|(?:能|可以|会|會)[^。！？!?]*(?:吗|嗎|么|麼)[?？]?\s*$|できますか|할\s*수\s*있/u.test(
      command,
    )
  )
    return 'A question, explanation or quoted command does not authorize a Discord action.';
  if (negation.test(command))
    return 'The owner prohibited or qualified this Discord action; ask for clarification.';
  if (
    action.action === 'send_current_message' &&
    (draftOnly.test(command) || hypothetical.test(command))
  )
    return 'A draft, example or future conditional does not authorize sending a Discord message now.';
  const candidates = scopedClauses(goal, action).filter(
    (clause) =>
      clause.scoped &&
      (requested(
        clause,
        action.action === 'send_current_message' ? 'send_message' : action.action,
      ) ||
        (action.action === 'send_current_message' &&
          /^(?:type|набери(?:те)?|введи(?:те)?)(?!\p{L})/iu.test(clause.command))),
  );
  if (!candidates.length)
    return `The owner did not explicitly request the Discord ${action.action} operation. Ask instead of changing the task.`;
  if (action.action === 'send_current_message') {
    const exact = candidates.find((clause) => {
      if (draftOnly.test(clause.command)) return false;
      const parsed = discordCurrentMessageParts(clause.raw);
      const text = parsed?.literal === 'colon' ? colonMessage(goal, clause) : parsed?.text;
      return text === action.text && parsed.side === action.side;
    });
    if (!exact)
      return 'Use the exact owner-supplied message and explicitly requested current, left or right visible Discord chat; drafts and generated replies do not authorize sending.';
    const supplied = explicitDestinations(exact);
    if (supplied.server.length || supplied.channel.length)
      return 'Use a named Discord action for an explicitly named destination; do not substitute a different visible chat.';
    return null;
  }
  const messageCandidates =
    action.action === 'send_message'
      ? candidates.filter(
          (entry) => entry.raw.includes(action.text) || colonMessage(goal, entry) === action.text,
        )
      : candidates;
  if (!messageCandidates.length)
    return 'The exact message must belong to the owner-requested Discord send operation.';
  const clause =
    messageCandidates.find((entry) => !destinationProblem(entry, action, view)) ??
    messageCandidates[0];
  const wrongDestination = destinationProblem(clause, action, view);
  if (wrongDestination) return wrongDestination;
  const namedChannel =
    action.channel && containsName(clause.unquoted.normalize('NFKC'), action.channel);
  const destination = channel.test(clause.command) || voice.test(clause.command) || namedChannel;
  const literals = messageLiterals(clause);
  if (
    clause.isPolite &&
    !namedChannel &&
    !literals.includes(action.text) &&
    /\b(?:channels|calls|servers|messages|salons|canaux|canales|canais|canali)\b|канал(?:ы|ов)|сообщения|nachrichten/iu.test(
      clause.command,
    )
  )
    return 'Ask whether the owner wants an action; a general capability question is not authorization.';
  if (action.action === 'send_message') {
    if (draftOnly.test(clause.command))
      return 'The owner requested a draft or no submission. Do not send a Discord message.';
    const colonBody = colonMessage(goal, clause);
    if (
      (!clause.raw.includes(action.text) && colonBody !== action.text) ||
      (literals.length && !literals.includes(action.text))
    )
      return 'Use only the exact message text explicitly supplied in the current owner goal; never generate a reply.';
    if (!literals.length && colonBody !== action.text)
      return 'Ask for the exact message in quotes, or preserve the entire colon-introduced message body without truncation.';
    const literal = literals.includes(action.text) || colonBody === action.text;
    if (
      !literal &&
      (synthesis.test(clause.command) ||
        /^(?:a\s+|the\s+)?(?:message|reply|response|this|that|it|сообщение|ответ|это)$/iu.test(
          action.text.trim(),
        ))
    )
      return 'Ask for the exact message to send; do not synthesize a Discord reply.';
  } else if (
    action.action === 'join_voice' &&
    !channel.test(clause.command) &&
    !voice.test(clause.command)
  ) {
    return 'The owner must explicitly request joining a voice call or channel in Discord.';
  } else if (action.action === 'leave_voice') {
    const disconnect =
      /(?<!\p{L})(?:disconnect|отключ\p{L}*|déconnect\p{L}*|trenn\p{L}*|descon[ée]ct\p{L}*|disconnett\p{L}*|افصل|bağlantıyı\s+kes)(?!\p{L})|切断して|연결을\s*끊어|断开|斷開/iu.test(
        clause.command,
      );
    if (
      !voice.test(clause.command) &&
      (!disconnect ||
        /\b(?:account|profile|integration)\b|аккаунт|уч[её]тн|compte|konto|cuenta|conta|hesap/iu.test(
          clause.command,
        ))
    )
      return 'Specify leaving a Discord voice channel; closing the app or leaving a server is a different action.';
  } else if (action.action === 'navigate' && !destination) {
    return 'Opening Discord alone does not authorize choosing a server or channel.';
  } else if (action.action === 'read_context' && !destination && !context.test(clause.command)) {
    return 'The owner must request reading the visible Discord channel or conversation context.';
  } else if (action.action === 'list_channels' && !channel.test(clause.command)) {
    return 'The owner must request listing Discord channels, not another list.';
  }
  return null;
}
