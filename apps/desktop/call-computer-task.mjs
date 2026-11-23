// SPDX-License-Identifier: GPL-3.0-only
import { once } from 'node:events';

const client = String.raw`(google meet|meet|teams|microsoft teams|гугл мит|тимс)`;
const englishChat = String.raw`(?:the\s+|this\s+|current\s+)?(?:call|meeting)\s+chat`;
const russianChat = String.raw`чат\s+(?:(?:этого|текущего)\s+)?(?:звонка|созвона|встречи)`;
const join = new RegExp(
  String.raw`^(?:join\s+(?:(?:this|the|my|current|open)\s+){0,2}(?:call|meeting)(?:\s+(?:in|on)\s+${client})?|(?:подключись|присоединись)\s+к\s+(?:(?:этому|текущему|открытому|этой|текущей|открытой)\s+)?(?:звонку|созвону|встрече)(?:\s+в\s+${client})?)[.!?]?$`,
  'iu',
);
const draft = new RegExp(
  String.raw`^(type|draft|write|send|post|введи|набери|напиши|отправь)\s+(?:(?:(?:in|into|to|в)\s+)?(?:${englishChat}|${russianChat})(?:\s+(?:in|on|в)\s+${client})?\s*:\s*([^\r\n]+)|(?:"([^"\r\n]+)"|“([^”\r\n]+)”|«([^»\r\n]+)»)\s+(?:in|into|to|в)\s+(?:${englishChat}|${russianChat})(?:\s+(?:in|on|в)\s+${client})?[.!?]?)$`,
  'iu',
);
const chatAction = new RegExp(
  String.raw`^(?:type|draft|write|send|post|введи|набери|напиши|отправь)\s+[^\r\n]*(?:${englishChat}|${russianChat}|${client}\s+chat)`,
  'iu',
);
const stripRequest = (text) =>
  text
    .trim()
    .replace(/^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu, '')
    .replace(/^(?:(?:can|could|would)\s+you\s+|(?:можешь|можете)\s+)/iu, '')
    .replace(/^(?:please|пожалуйста)[,\s]+/iu, '');
const meetingClient = (name) => (/teams|тимс/iu.test(name) ? 'teams' : 'meet');

export function callTaskRequest(text) {
  if (typeof text !== 'string') return null;
  const request = stripRequest(text);
  const joining = join.exec(request);
  if (joining) {
    const name = joining[1] ?? joining[2];
    return { action: 'join', client: name ? meetingClient(name) : null };
  }
  const writing = draft.exec(request);
  if (writing) {
    const [, verb, firstClient, colonText, straight, curly, angled, lastClient] = writing;
    const literal = colonText?.trim() ?? straight ?? curly ?? angled;
    if (!literal.trim() || literal.length > 400 || /[\x00-\x1f\x7f]/u.test(literal))
      return { action: 'clarify' };
    const name = firstClient ?? lastClient;
    return {
      action: 'draft',
      client: name ? meetingClient(name) : null,
      text: literal,
      sendRequested: /^(?:send|post|отправь)$/iu.test(verb),
    };
  }
  return chatAction.test(request) ? { action: 'clarify' } : null;
}

function meetingTab(view) {
  const addresses = view.targets.filter((target) => target.browserAddress && !target.focused);
  if (view.window?.modal || !view.window?.windowId || addresses.length !== 1) return null;
  try {
    const address = addresses[0].untrustedValue;
    const url = new URL(/^https:\/\//i.test(address) ? address : 'https://' + address);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const path = url.pathname.replace(/\/$/u, '');
    const meet = url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(path);
    const teams =
      ['teams.microsoft.com', 'teams.live.com'].includes(url.hostname) &&
      /^\/(?:meet\/\d+|l\/meetup-join\/[^/]+(?:\/0)?)$/iu.test(path);
    if (meet || teams)
      return {
        client: meet ? 'meet' : 'teams',
        key: view.window.windowId + '\n' + url.origin + path,
      };
  } catch {
    // An absent or inaccessible browser address does not identify a meeting.
  }
  return null;
}

const joinButton =
  /^(?:join now|ask to join|присоединиться|присоединиться сейчас|попросить присоединиться|запросить подключение)$/iu;
const joinRequest = /^(?:ask to join|попросить присоединиться|запросить подключение)$/iu;
const hangUp =
  /^(?:leave(?: call| meeting)?|hang up|покинуть (?:встречу|звонок)|завершить (?:вызов|звонок))(?:\s*\([^)]*\))?$/iu;
const micOff =
  /^(?:turn on microphone|unmute microphone|unmute|включить микрофон)(?:\s*\([^)]*\))?$/iu;
const cameraOff =
  /^(?:turn on camera|start video|включить камеру|включить видео)(?:\s*\([^)]*\))?$/iu;
const openChat =
  /^(?:chat|show chat|open chat|in-call messages|чат|показать чат|открыть чат|сообщения в чате)$/iu;
const composer =
  /^(?:send a message(?: to everyone)?|type a message|write a message|отправить сообщение(?: всем)?|введите сообщение|написать сообщение)$/iu;

const match = (view, names, editable = false) =>
  view.targets.filter(
    (target) =>
      target.pageContent === true &&
      !target.source &&
      !target.surface &&
      !target.browserAddress &&
      (editable
        ? target.editable && !target.browserSearch
        : target.role === 'ControlType.Button') &&
      names.test(target.untrustedLabel?.trim() ?? ''),
  );

export function callTaskNeedsOwner(language) {
  return {
    ok: false,
    status: 'needs_user',
    verified: false,
    steps: 0,
    summary:
      language === 'ru'
        ? 'Попроси меня напрямую подключиться к открытой встрече или укажи точный текст черновика в кавычках.'
        : 'Ask me directly to join the open call or give me the exact text in quotation marks for a meeting chat draft.',
  };
}

export async function waitForCallForeground(window, { signal, onWaiting, timeoutMs = 5000 }) {
  signal?.throwIfAborted();
  if (!window?.isFocused()) return true;
  onWaiting();
  const deadline = AbortSignal.timeout(timeoutMs);
  const boundary = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    await once(window, 'blur', { signal: boundary });
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    if (!deadline.aborted) throw error;
    return false;
  }
}

export async function runCallComputerTask(
  task,
  { observe, input, wait, waitForForeground, russian },
) {
  const result = (status, en, ru) => ({
    ok: status === 'completed',
    status,
    verified: status === 'completed',
    summary: russian ? ru : en,
  });
  const targetMissing = () =>
    result(
      'needs_user',
      'After asking me, switch to the open Google Meet or Teams meeting tab within five seconds.',
      'После запроса переключись на открытую вкладку встречи Google Meet или Teams в течение пяти секунд.',
    );
  const draftReady = () =>
    task.sendRequested
      ? result(
          'needs_user',
          'The draft is ready. Review it and click Send in the meeting chat.',
          'Черновик готов. Проверь его и нажми «Отправить» в чате встречи.',
        )
      : result(
          'completed',
          'I entered the draft in the meeting chat.',
          'Я ввела черновик в чат встречи.',
        );
  if (!(await waitForForeground())) return targetMissing();
  let view;
  try {
    view = await observe();
  } catch (error) {
    if (error.code !== 'COMPUTER_OBSERVATION_CHANGED') throw error;
    view = await observe();
  }
  const tab = meetingTab(view);
  if (!tab || (task.client && task.client !== tab.client)) return targetMissing();
  const inMeeting = (current) => meetingTab(current)?.key === tab.key;
  if (task.action === 'join') {
    if (match(view, hangUp).length === 1)
      return result(
        'completed',
        'The meeting tab is already in the call.',
        'Вкладка встречи уже подключена к звонку.',
      );
    const buttons = match(view, joinButton);
    if (buttons.length !== 1)
      return result(
        'needs_user',
        'I could not identify a single Join button in the meeting.',
        'Я не смогла однозначно найти кнопку подключения к встрече.',
      );
    if (match(view, micOff).length !== 1 || match(view, cameraOff).length !== 1)
      return result(
        'needs_user',
        'Turn off the microphone and camera in the meeting preview first.',
        'Сначала выключи микрофон и камеру на экране входа во встречу.',
      );
    const [button] = buttons;
    const clicked = await input({ action: 'click', targetId: button.targetId });
    if (clicked?.ok) {
      for (let i = 0; i < 5; i++) {
        view = await observe();
        if (!inMeeting(view)) return targetMissing();
        if (match(view, hangUp).length === 1)
          return result(
            'completed',
            'The meeting tab is now in the call.',
            'Вкладка встречи подключена к звонку.',
          );
        if (i < 4) await wait();
      }
      if (joinRequest.test(button.untrustedLabel.trim()))
        return result(
          'needs_user',
          'I clicked Ask to join. Admission is still unverified.',
          'Я нажала кнопку запроса на вход. Подключение пока не подтверждено.',
        );
    }
    return result(
      'incomplete',
      'I could not verify that the meeting tab joined the call.',
      'Я не смогла подтвердить подключение к звонку.',
    );
  }

  if (match(view, hangUp).length !== 1)
    return result(
      'needs_user',
      'Join the meeting before asking me to draft a message in its chat.',
      'Подключись к встрече, прежде чем просить меня написать черновик в её чат.',
    );
  if (!match(view, composer, true).length) {
    const buttons = match(view, openChat);
    if (buttons.length === 1) {
      await input({ action: 'click', targetId: buttons[0].targetId });
      view = await observe();
      if (!inMeeting(view) || match(view, hangUp).length !== 1) return targetMissing();
    }
  }
  const fields = match(view, composer, true);
  if (fields.length !== 1)
    return result(
      'needs_user',
      'Open the meeting chat so I can identify its message field.',
      'Открой чат встречи, чтобы я могла найти поле сообщения.',
    );
  const [field] = fields;
  if (field.untrustedValue === task.text) return draftReady();
  if (field.untrustedValue !== '')
    return result(
      'needs_user',
      'The meeting chat already has a draft. Clear it first if you want me to replace it.',
      'В чате встречи уже есть черновик. Очисти его, если хочешь заменить текст.',
    );
  const typed = await input({ action: 'enter_text', targetId: field.targetId, text: task.text });
  if (typed?.ok && typed.submitted === false) {
    view = await observe();
    const drafts = match(view, composer, true);
    if (
      inMeeting(view) &&
      match(view, hangUp).length === 1 &&
      drafts.length === 1 &&
      drafts[0].untrustedValue === task.text
    )
      return draftReady();
  }
  return result(
    'incomplete',
    'I could not verify the meeting chat draft. Check the message field before retrying.',
    'Я не смогла проверить черновик. Проверь поле сообщения перед повторной попыткой.',
  );
}
