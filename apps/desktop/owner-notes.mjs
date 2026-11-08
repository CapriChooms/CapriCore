// SPDX-License-Identifier: GPL-3.0-only
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const maxNote = 1200;
const maxFile = 128 * 1024;
const noteFile = 'capri-owner-notes.md';
const optionalName = /^(?:(?:hey\s+)?(?:capri|капри)[,:!]?\s+)/iu;
const englishFact = /^(?:my|our)\s+(.+?)\s+(?:is|are|was|were)\s+(.+)$/iu;
const russianFact = /^мо(?:й|я|ё|е|и)\s+(.+?)\s*[:—–-]\s*(.+)$/iu;
const portugueseFact =
  /^(?:(?:o|a|os|as)\s+)?(?:meu|minha|meus|minhas|nosso|nossa|nossos|nossas)\s+(.+?)\s+(?:é|são|era|eram)\s+(.+)$/iu;
const fileSubject =
  /(?:^|[^\p{L}\p{N}_])(?:files?|folders?|documents?|workbooks?|spreadsheets?|reports?|scripts?|screenshots?|images?|pictures?|videos?|recordings?|screens?|cameras?|microphones?|logs?|applications?|apps?|programs?|notes?|drafts?|projects?|work|homework|progress|sessions?|tabs?|pages?|windows?|bookmarks?|selections?|clipboard|browsers?|views?|text|content|messages?|chats?|conversations?|arquivos?|ficheiros?|pastas?|documentos?|planilhas?|relat[oó]rios?|imagens?|v[ií]deos?|grava[cç][oõ]es|telas?|c[aâ]meras?|microfones?|aplicativos?|programas?|rascunhos?|projetos?|trabalho|tarefas?|sess[oõ]es|abas?|guias?|p[aá]ginas?|janelas?|favoritos?|marcadores?|sele[cç][aã]o|sele[cç][oõ]es|[aá]rea de transfer[eê]ncia|navegadores?|visualiza[cç][aã]o|textos?|conte[uú]do|mensagens?|conversas?)(?=$|[^\p{L}\p{N}_])|[\\/:]/iu;
const sensitive =
  /\b(?:password|passphrase|passcode|pin(?: code)?|secret key|api key|access token|private key|recovery phrase|seed phrase|bearer|senhas?|palavra[ -]passe|c[oó]digo de acesso|token de acesso|chave(?: de)? (?:api|acesso|recupera[cç][aã]o|privada|secreta)|frase (?:semente|de recupera[cç][aã]o))\b|парол[ьяюе]|код доступа|секретн\p{L}* ключ|токен|api[ -]?ключ|\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{16,}|hf_[\w]{16,}|AKIA[A-Z0-9]{16})\b|-----BEGIN [A-Z ]+PRIVATE KEY-----|https?:\/\/[^\s/@:]+:[^\s/@]+@/iu;
const compound =
  /(?:\b(?:and|then|also)\s+(?:then\s+)?(?:(?:please|kindly)\s+)?(?:open|launch|start|stop|send|save|store|record|write|type|click|download|delete|install|run|turn|tell|show|search|find|set|change|enable|disable|use|play|pause|resume|press|scroll|move|copy|read)\b|(?:\s|^)(?:и|затем|потом|также)\s+(?:пожалуйста\s+)?(?:открой|запусти|закрой|отправь|сохрани|напиши|нажми|скачай|удали|установи|включи|выключи|скажи|покажи|найди|измени)|(?:\s|^)(?:e|depois|ent[aã]o|tamb[eé]m|em seguida)\s+(?:por\s+favor\s+)?(?:abra|inicie|execute|envie|salve|anote|digite|clique|baixe|apague|exclua|instale|ative|desative|diga|mostre|procure|pesquise|altere|use|toque|pause|copie|mova))/iu;
const prompt = (value) => value.trim().replace(optionalName, '').trim();
const withoutCourtesy = (value) =>
  value
    .replace(/,\s*(?:please|kindly|por favor|пожалуйста)[.!?]*$/iu, '')
    .replace(/[.!?]+$/u, '')
    .trim();
const redundantSave =
  /(?:,\s*(?:and\s+)?|\s+and\s+)(?:(?:please|kindly)\s+)?(?:(?:write|note|jot)\s+(?:it|that)\s+down|(?:save|store|record|remember)\s+(?:it|that)(?:\s+(?:in|to)\s+(?:(?:your|long-term|long term)\s+)?(?:memory|notes))?)$|(?:,\s*(?:e\s+)?|\s+e\s+)(?:anote(?:\s+isso)?|(?:guarde|salve|registre)\s+isso(?:\s+(?:na|em sua)\s+mem[oó]ria)?)$/iu;

function suppliedFact(value, asValue = false) {
  if (englishFact.test(value) || russianFact.test(value) || portugueseFact.test(value))
    return value;
  if (!asValue) return null;
  const english = /^(my|our)\s+(.+?)\s+as\s+(.+)$/iu.exec(value);
  if (english) return `${english[1]} ${english[2]} is ${english[3]}`;
  const portuguese =
    /^(?:(?:o|a|os|as)\s+)?(meu|minha|meus|minhas|nosso|nossa|nossos|nossas)\s+(.+?)\s+como\s+(.+)$/iu.exec(
      value,
    );
  return portuguese ? `${portuguese[1]} ${portuguese[2]} é ${portuguese[3]}` : null;
}

/** Match an explicit note supplied in this user turn, never the model's prose. */
export function ownerNoteRequest(value) {
  const text = prompt(value)
    .replace(
      /^(?:(?:please|kindly)[,\s]+)?(?:(?:(?:can|could|would)\s+you|i\s+(?:want|need|would\s+like)\s+you\s+to)\s+)?(?:(?:please|kindly)[,\s]+)?/iu,
      '',
    )
    .replace(
      /^(?:por\s+favor[,\s]+)?(?:(?:voc[eê]\s+)?(?:pode|poderia)\s+(?:por\s+favor[,\s]+)?)?/iu,
      '',
    );
  const explicit =
    /^remember\s*(?:that\s+|:\s*)(.+)$/iu.exec(text) ??
    /^(?:пожалуйста[, ]+)?запомни(?:те)?(?:,?\s+что\s+|\s*:\s*|[, ]+)(.+)$/iu.exec(text) ??
    /^(?:lembre(?:-se)?|lembrar(?:-se)?)(?:\s+de)?(?:\s+que\s+|\s*:\s*)(.+)$/iu.exec(text);
  const plain = /^(?:remember|lembre(?:-se)?|lembrar(?:-se)?)\s+(?:de\s+)?(.+)$/iu.exec(text);
  const alias =
    /^(?:save|store|record|write\s+down|note\s+down|jot\s+down|anote|anotar|guarde|guardar|salve|salvar|registre|registrar)(?:\s+(?:(?:that|que)\s+)?|:\s*)(.+)$/iu.exec(
      text,
    );
  let note = withoutCourtesy((explicit?.[1] ?? plain?.[1] ?? alias?.[1] ?? '').trim());
  for (let n = 0; n < 2; n++) note = note.replace(redundantSave, '').trim();
  if (!note) return null;
  if (!explicit) {
    note = suppliedFact(note, Boolean(alias));
    if (!note) return null;
    const fact = englishFact.exec(note) ?? russianFact.exec(note) ?? portugueseFact.exec(note);
    if (alias && fileSubject.test(fact[1])) return null;
  }
  if (sensitive.test(note)) return { refused: true };
  if (
    note.length > maxNote ||
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(note) ||
    /\?(?:\s|$)/.test(note) ||
    compound.test(note)
  )
    return null;
  return { note };
}

const subjectKey = (value) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const recallSubject = (value) =>
  /^(?:what(?: is| was|'s)|do you remember|can you recall|tell me)\s+(?:my|our)\s+(.+?)(?:\s+(?:is|was))?[?.!]*$/iu.exec(
    value,
  )?.[1] ??
  /^(?:what|which)\s+(.+?)\s+did I (?:ask|tell) you to (?:remember|save)[?.!]*$/iu.exec(
    value,
  )?.[1] ??
  /^(?:како[йея]|какая|какие|какого цвета)\s+(?:мо[йяёи]|мое)\s+(.+?)[?.!]*$/iu.exec(value)?.[1] ??
  /^(?:qual|quais)\s+(?:é|são|era|eram)\s+(?:(?:o|a|os|as)\s+)?(?:meu|minha|meus|minhas|nosso|nossa|nossos|nossas)\s+(.+?)[?.!]*$/iu.exec(
    value,
  )?.[1];

function fileFor(workspace, create) {
  const root = realpathSync(workspace);
  const directory = path.join(root, 'memory');
  if (create) mkdirSync(directory, { recursive: true });
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    path.relative(root, realpathSync(directory)) !== 'memory'
  )
    throw new Error('Unsafe owner notes directory');
  return path.join(directory, noteFile);
}

function openNoteFile(workspace, create) {
  const file = fileFor(workspace, create);
  let before;
  try {
    before = lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
  }
  if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1))
    throw new Error('Unsafe owner notes file');
  const flags = create
    ? constants.O_CREAT | constants.O_RDWR | constants.O_APPEND | (!before ? constants.O_EXCL : 0)
    : constants.O_RDONLY;
  const fd = openSync(file, flags | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > maxFile ||
      (before && (info.dev !== before.dev || info.ino !== before.ino))
    )
      throw new Error('Unsafe or oversized owner notes file');
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function records(content) {
  return content.split(/\r?\n/u).flatMap((line) => {
    const entry = /^- \d{4}-\d{2}-\d{2} (".*")$/u.exec(line);
    if (!entry) return [];
    try {
      const note = JSON.parse(entry[1]);
      return typeof note === 'string' && note.length <= maxNote && !sensitive.test(note)
        ? [note]
        : [];
    } catch {
      return [];
    }
  });
}

/** Only this fixed Markdown file is written. OpenClaw indexes it under memory/. */
export function saveOwnerNote(workspace, note) {
  if (
    typeof note !== 'string' ||
    !note.trim() ||
    note.length > maxNote ||
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(note) ||
    sensitive.test(note)
  )
    throw new Error('Invalid owner note');
  const fd = openNoteFile(workspace, true);
  try {
    const content = readFileSync(fd, 'utf8');
    if (records(content).at(-1) === note) return { saved: true, alreadySaved: true };
    const line = '- ' + new Date().toISOString().slice(0, 10) + ' ' + JSON.stringify(note) + '\n';
    const entry = !content
      ? '# Explicit owner notes\n\n' + line
      : (content.endsWith('\n') ? '' : '\n') + line;
    if (Buffer.byteLength(content) + Buffer.byteLength(entry) > maxFile)
      throw new Error('Owner notes file is full');
    writeFileSync(fd, entry, 'utf8');
    fsyncSync(fd);
    const bytes = Buffer.alloc(fstatSync(fd).size);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== bytes.length || records(bytes.toString('utf8')).at(-1) !== note)
      throw new Error('The memory could not be verified.');
    return { saved: true };
  } finally {
    closeSync(fd);
  }
}

/** Read back a matching simple owner fact without a model or a stale index. */
export function recallOwnerNote(workspace, value) {
  const subject = recallSubject(withoutCourtesy(prompt(value)));
  if (!subject || sensitive.test(subject)) return null;
  const key = subjectKey(subject);
  if (!key || key.length > 120) return null;
  let fd;
  try {
    fd = openNoteFile(workspace, false);
    const facts = new Map();
    for (const note of records(readFileSync(fd, 'utf8'))) {
      const match = englishFact.exec(note) ?? russianFact.exec(note) ?? portugueseFact.exec(note);
      if (match) facts.set(subjectKey(match[1]), match[2]);
    }
    if (facts.has(key)) return facts.get(key);
    const matches = [...facts].filter(([subject]) => subject.endsWith(' ' + key));
    return matches.length === 1 ? matches[0][1] : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
