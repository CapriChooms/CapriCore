// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discordRequestProblem,
  discordSingleOperationGoal,
} from '../apps/desktop/discord-task-intent.mjs';

const request = (action, extra = {}) => ({
  action,
  ...(action !== 'leave_voice' ? { server: 'Friends' } : {}),
  ...(!['leave_voice', 'list_channels'].includes(action)
    ? { channel: 'General', channelType: action === 'join_voice' ? 'voice' : 'text' }
    : {}),
  ...extra,
});
const currentView = {
  window: { applicationKind: 'discord', untrustedTitle: '#General | Friends - Discord' },
  targets: [],
};
const permitted = (goal, action, extra, view = currentView) =>
  assert.equal(discordRequestProblem(goal, request(action, extra), view), null, goal);
const denied = (goal, action, extra, view = currentView) =>
  assert.equal(typeof discordRequestProblem(goal, request(action, extra), view), 'string', goal);

test('only explicitly requested Discord operations pass, with names resolved from current UI when needed', () => {
  permitted('Join voice channel General in Discord.', 'join_voice');
  permitted('Join the current Discord voice channel.', 'join_voice');
  permitted('Capri, please connect to the current Discord call.', 'join_voice');
  permitted('In Discord, leave the voice channel.', 'leave_voice');
  permitted('Disconnect from Discord.', 'leave_voice');
  permitted('Open channel General in Discord.', 'navigate');
  permitted('In Discord, go to the current text channel.', 'navigate');
  permitted('Read the current Discord messages.', 'read_context');
  permitted('Summarize channel General in Discord.', 'read_context');
  permitted('List the available Discord channels.', 'list_channels');
  permitted('Show the channels in Discord.', 'list_channels');
  permitted('Open Discord and join voice channel General.', 'join_voice');
  permitted('Open Discord then send "Hello" in the current channel.', 'send_message', {
    text: 'Hello',
  });
  permitted(
    'Use full computer control to join the current voice channel in Discord.',
    'join_voice',
  );
  permitted('Write "hello" in Discord channel #General.', 'send_message', { text: 'hello' });
  permitted('Send this message in Discord channel #General: Yes.', 'send_message', {
    text: 'Yes.',
  });
  permitted('Send "Draft only, do not send" in Discord channel #General.', 'send_message', {
    text: 'Draft only, do not send',
  });
  permitted(
    'Write "Yes" as a reply to the latest message in Discord channel #General.',
    'send_message',
    {
      text: 'Yes',
    },
  );
  for (const [goal, action] of [
    ['Open Discord.', 'navigate'],
    ['Read about Discord.', 'read_context'],
    ['List my Discord servers.', 'list_channels'],
    ['Join the Friends server in Discord.', 'join_voice'],
    ['Join Discord server "Friends".', 'join_voice'],
    ['Join General in Discord.', 'join_voice'],
    ['Connect my Discord account.', 'join_voice'],
    ['Leave Discord.', 'leave_voice'],
    ['Leave the Friends server in Discord.', 'leave_voice'],
    ['Disconnect my Discord account.', 'leave_voice'],
    ['Open General in Discord.', 'join_voice'],
    ['Read General in Discord.', 'send_message'],
    ['Join General in Discord.', 'leave_voice'],
    ['List the channels in Discord.', 'read_context'],
  ])
    denied(goal, action, action === 'send_message' ? { text: 'General' } : undefined);
  denied('Join Discord server "Friends".', 'join_voice', { channel: 'Friends' });
});

test('explicit send commands preserve original literal text across supported languages', () => {
  for (const goal of [
    'Send "Hello! 👋" in Discord.',
    'Отправь «Hello! 👋» в Дискорде.',
    'Envoie «Hello! 👋» sur Discord.',
    'Schreibe "Hello! 👋" in Discord.',
    'Envía "Hello! 👋" en Discord.',
    'Envie "Hello! 👋" no Discord.',
    'Scrivi "Hello! 👋" su Discord.',
    'ディスコードで「Hello! 👋」と送って。',
    '디스코드에서 "Hello! 👋"를 보내 줘.',
    '在Discord发送「Hello! 👋」。',
    'أرسل «Hello! 👋» في ديسكورد.',
    'Discord\'da "Hello! 👋" yaz.',
    'Could you send "Hello! 👋" in Discord?',
    'Можешь отправить «Hello! 👋» в Дискорде?',
    'Peux-tu envoyer «Hello! 👋» sur Discord ?',
    'Kannst du "Hello! 👋" in Discord senden?',
    'Puedes enviar "Hello! 👋" en Discord?',
    'Pode enviar "Hello! 👋" no Discord?',
    'Puoi scrivere "Hello! 👋" su Discord?',
  ])
    permitted(goal.replace(/[.。?？]\s*$/u, '') + ' #General.', 'send_message', {
      text: 'Hello! 👋',
    });
  for (const text of ['hello! 👋', 'Hello!', 'Hello! 👋 ', 'A generated answer.'])
    denied('Send "Hello! 👋" in Discord.', 'send_message', { text });
});

test('join, leave, navigation, read and channel listing are checked in common interface languages', () => {
  const goals = [
    [
      'Подключись к голосовому каналу в Дискорде.',
      'Выйди из голосового канала в Дискорде.',
      'Открой канал в Дискорде.',
      'Прочитай сообщения в Дискорде.',
      'Покажи каналы в Дискорде.',
    ],
    [
      'Rejoins le salon vocal sur Discord.',
      'Quitte le salon vocal sur Discord.',
      'Ouvre le canal General sur Discord.',
      'Lis les messages sur Discord.',
      'Liste les salons sur Discord.',
    ],
    [
      'Tritt dem Sprachkanal in Discord bei.',
      'Verlasse den Sprachkanal in Discord.',
      'Öffne General in Discord.',
      'Lies die Nachrichten in Discord.',
      'Zeige die Kanäle in Discord.',
    ],
    [
      'Únete al canal de voz en Discord.',
      'Sal del canal de voz en Discord.',
      'Abre el canal en Discord.',
      'Lee los mensajes en Discord.',
      'Enumera los canales en Discord.',
    ],
    [
      'Entre no canal de voz no Discord.',
      'Saia do canal de voz no Discord.',
      'Abra o canal no Discord.',
      'Leia as mensagens no Discord.',
      'Liste os canais no Discord.',
    ],
    [
      'Unisciti al canale vocale su Discord.',
      'Esci dal canale vocale su Discord.',
      'Apri il canale General su Discord.',
      'Leggi i messaggi su Discord.',
      'Elenca i canali su Discord.',
    ],
    [
      'ディスコードのボイスチャンネルに参加して。',
      'ディスコードのボイスチャンネルから退出して。',
      'ディスコードのチャンネルを開いて。',
      'ディスコードのメッセージを読んで。',
      'ディスコードのチャンネル一覧を表示して。',
    ],
    [
      '디스코드 음성 채널에 들어가 줘.',
      '디스코드 음성 채널에서 나가 줘.',
      '디스코드 채널을 열어 줘.',
      '디스코드 메시지를 읽어 줘.',
      '디스코드 채널 목록을 보여 줘.',
    ],
    [
      '加入Discord语音频道。',
      '退出Discord语音频道。',
      '打开Discord频道。',
      '阅读Discord消息。',
      '列出Discord频道。',
    ],
    [
      'انضم إلى القناة الصوتية في ديسكورد.',
      'غادر القناة الصوتية في ديسكورد.',
      'افتح القناة في ديسكورد.',
      'اقرأ رسائل ديسكورد.',
      'اعرض قنوات ديسكورد.',
    ],
    [
      "Discord'da ses kanalına katıl.",
      "Discord'da ses kanalından ayrıl.",
      "Discord'da General kanalını aç.",
      "Discord'da mesajları oku.",
      "Discord'da kanalları listele.",
    ],
  ];
  const actions = ['join_voice', 'leave_voice', 'navigate', 'read_context', 'list_channels'];
  for (const row of goals)
    for (let i = 0; i < actions.length; i++) {
      const goal = row[i].startsWith("Discord'da ")
        ? row[i].replace("Discord'da ", "Discord'da #General ")
        : row[i].replace(/[.。?？]\s*$/u, '') + ' #General.';
      permitted(goal, actions[i]);
    }
});

test('capability questions, quotations and descriptions never authorize an account action', () => {
  for (const goal of [
    'Can you join Discord voice channels?',
    'Can you read Discord messages?',
    'How do I join General in Discord?',
    'Explain how to join General in Discord.',
    'I want to join General in Discord.',
    'Discord can join General voice channel.',
    'Tell me whether you can join General in Discord.',
    'Переведи «Подключись к голосовому каналу General в Discord».',
    'Как подключиться к голосовому каналу General в Дискорде?',
    'Comment rejoindre General sur Discord ?',
    'Wie tritt man General in Discord bei?',
    '¿Cómo puedo unirme a General en Discord?',
    'Como posso entrar no canal General no Discord?',
    'Come posso entrare nel canale General su Discord?',
    'DiscordのGeneralに参加できますか？',
    '디스코드 General에 들어갈 수 있니?',
    '你能加入Discord的General频道吗？',
    '请问能加入Discord的General频道吗？',
    'كيف أنضم إلى General في ديسكورد؟',
    'Discord General kanalına nasıl katılırım?',
    'Write "Join General in Discord" in Notepad.',
  ])
    denied(goal, 'join_voice');
});

test('negative and draft-only instructions block sending, and replies cannot be invented from screen text', () => {
  for (const goal of [
    'Do not send "Hello" in Discord.',
    'Send "Hello" in Discord, but do not press Enter.',
    'Draft "Hello" in Discord.',
    'Write "Hello" in Discord without sending.',
    'Не отправляй «Hello» в Дискорде.',
    'Напиши черновик «Hello» в Дискорде.',
    'Ne poste pas «Hello» sur Discord.',
    'Schreibe "Hello" als Entwurf in Discord.',
    'No envíes "Hello" en Discord.',
    'Escribe el borrador "Hello" en Discord.',
    'Não envie "Hello" no Discord.',
    'Scrivi "Hello" come bozza su Discord.',
    'Discordに「Hello」を送らないで。',
    'Discord에서 "Hello"를 보내지 마.',
    '不要在Discord发送「Hello」。',
    'لا ترسل «Hello» في ديسكورد.',
    'Discord\'da "Hello" gönderme.',
    'Send a friendly reply to the latest Discord message.',
    'Write a response in Discord based on the conversation.',
    'Send something appropriate in Discord.',
    'Write a guide about Discord.',
  ])
    denied(goal, 'send_message', { text: goal.includes('Hello') ? 'Hello' : 'reply' });
  denied('Send a friendly reply to the latest Discord message.', 'send_message', {
    text: 'a friendly reply',
  });
  denied('Read "Hello" in Discord.', 'send_message', { text: 'Hello' });
  denied('Read the current Discord chat.', 'send_message', {
    text: 'A reply copied from the screen',
  });
  denied('Send a message in Discord.', 'send_message', { text: 'a message' });
  denied('Send "Hello" in Discord channel "General" on server "Friends".', 'send_message', {
    text: 'Friends',
  });
  denied('Send "Hello" in Discord channel "General" on server "Friends".', 'send_message', {
    text: 'General',
  });
  denied(
    'Write message "private scratch text" in Notepad and join Discord voice channel "General" on server "Friends".',
    'send_message',
    { text: 'private scratch text' },
  );
  denied(
    'Open Discord channel #general on server "Friends" and write "note for myself" in Notepad.',
    'send_message',
    { text: 'note for myself' },
  );
  denied(
    'Write "private scratch text" in Obsidian and join Discord voice channel "General" on server "Friends".',
    'send_message',
    { text: 'private scratch text' },
  );
  denied('Open Discord then write "note" in SomeOtherEditor.', 'send_message', { text: 'note' });
  denied('Join a Zoom voice call and then open Discord.', 'join_voice');
  assert.equal(
    typeof discordRequestProblem('Send "Hello" in Discord.', {
      ...request('send_message', { text: 'Hello' }),
      token: 'bad',
    }),
    'string',
  );
  assert.equal(typeof discordRequestProblem(null, request('join_voice')), 'string');
});

test('only a single unquoted operation can use the fast path', () => {
  for (const goal of [
    'Join channel "Research and Development" on server "Friends & family" in Discord.',
    'Send "Read this; then reply and leave" in Discord.',
    'Отправь «прочитай и затем ответь» в Дискорде.',
    'Join General in Discord.',
  ])
    assert.equal(discordSingleOperationGoal(goal), true, goal);
  for (const goal of [
    'Join General in Discord and open Notepad.',
    'Open Discord and join General.',
    'Join General in Discord & open Notepad.',
    'Join General in Discord; open Notepad.',
    'Join General in Discord then open Notepad.',
    'Join General in Discord, open Notepad.',
    'Join General in Discord. Open Notepad.',
    'Join General in Discord, turn on the microphone.',
    'Подключись к General в Дискорде и открой Блокнот.',
    'Подключись к General в Дискорде, потом открой Блокнот.',
    'Rejoins General sur Discord puis ouvre le Bloc-notes.',
    'Rejoins General sur Discord ensuite ouvre le Bloc-notes.',
    'Entra en General en Discord luego abre el Bloc de notas.',
    'DiscordでGeneralに参加して、それからメモ帳を開いて。',
    '加入Discord的General频道，然后打开记事本。',
    null,
  ])
    assert.equal(discordSingleOperationGoal(goal), false, goal);
});

test('explicit destination names bind to the same operation with exact NFC identity', () => {
  const send = 'Open Discord and send "Hello" in channel #general on server "Friends".';
  permitted(send, 'send_message', { text: 'Hello', channel: 'general' }, null);
  denied(send, 'send_message', { text: 'Hello', channel: 'other', server: 'Strangers' }, null);
  denied(send, 'send_message', { text: 'Hello', channel: 'general', server: 'Strangers' }, null);
  denied(send, 'send_message', { text: 'Hello', channel: 'General' }, null);
  for (const action of ['join_voice', 'navigate', 'read_context']) {
    const verb = { join_voice: 'Join voice', navigate: 'Open text', read_context: 'Read text' }[
      action
    ];
    const goal = `${verb} Discord channel "General" on server "Friends".`;
    permitted(goal, action, {}, null);
    denied(goal, action, { channel: 'Other' }, null);
    denied(goal, action, { server: 'Strangers' }, null);
  }
  permitted(
    'Entra al canal de voz Lounge del servidor Friends en Discord.',
    'join_voice',
    { channel: 'Lounge' },
    null,
  );
  denied(
    'Entra al canal de voz Lounge del servidor Friends en Discord.',
    'join_voice',
    { channel: 'Other', server: 'Strangers' },
    null,
  );
  permitted(
    'Подключись к голосовому каналу «Общий» на сервере «Друзья» в Дискорде.',
    'join_voice',
    { channel: 'Общий', server: 'Друзья' },
    null,
  );
  denied(
    'Подключись к голосовому каналу «Общий» на сервере «Друзья» в Дискорде.',
    'join_voice',
    { channel: 'Other', server: 'Strangers' },
    null,
  );
  permitted(
    'Open Discord channel "Cafe\u0301" on server "Friends".',
    'navigate',
    { channel: 'Café' },
    null,
  );
  permitted(
    'Open Discord channel "Research  Room" on server "Friends".',
    'navigate',
    { channel: 'Research  Room' },
    null,
  );
  denied(
    'Open Discord channel "Research  Room" on server "Friends".',
    'navigate',
    { channel: 'Research Room' },
    null,
  );
  denied(
    'Open Discord channel "Ｇｅｎｅｒａｌ" on server "Friends".',
    'navigate',
    { channel: 'General' },
    null,
  );
  const compound =
    'Send "Hello" in Discord channel #one on server "Friends" then send "Hello" in channel #two on server "Work".';
  permitted(compound, 'send_message', { channel: 'one', text: 'Hello' }, null);
  permitted(compound, 'send_message', { channel: 'two', server: 'Work', text: 'Hello' }, null);
  denied(compound, 'send_message', { channel: 'one', server: 'Work', text: 'Hello' }, null);
});

test('missing and current destinations bind to the observed native Discord view rather than generated names', () => {
  permitted('Join the current Discord voice channel.', 'join_voice');
  denied('Join the current Discord voice channel.', 'join_voice', { channel: 'Other' });
  denied('Join the current Discord voice channel.', 'join_voice', { server: 'Strangers' });
  denied('Join the current Discord voice channel.', 'join_voice', {}, null);
  permitted('Join Discord voice channel #General.', 'join_voice');
  denied('Join Discord voice channel #General.', 'join_voice', { server: 'Strangers' });
  denied('Join Discord voice channel #General.', 'join_voice', {}, null);
  denied('Join a voice channel in Discord.', 'join_voice');
  denied('Send this message "Hello" in Discord.', 'send_message', { text: 'Hello' });
  denied('Open a text channel in Discord.', 'navigate');
  permitted('List channels on the current Discord server.', 'list_channels');
  denied('List channels on the current Discord server.', 'list_channels', { server: 'Strangers' });
  denied('List channels in Discord.', 'list_channels', {}, null);
  for (const goal of [
    'Подключись к текущему голосовому каналу в Дискорде.',
    'Rejoins le salon vocal actuel sur Discord.',
    'Tritt dem aktuellen Sprachkanal in Discord bei.',
    'Únete al canal de voz actual en Discord.',
    'Entre no canal de voz atual no Discord.',
    'Unisciti al canale vocale corrente su Discord.',
    'ディスコードの現在のボイスチャンネルに参加して。',
    '디스코드의 현재 음성 채널에 들어가 줘.',
    '加入Discord当前语音频道。',
    'انضم إلى القناة الصوتية الحالية في ديسكورد.',
    "Discord'da mevcut ses kanalına katıl.",
  ]) {
    permitted(goal, 'join_voice');
    denied(goal, 'join_voice', { channel: 'Other' });
  }
  denied('Join Discord text channel "General" on server "Friends".', 'join_voice', {}, null);
  denied(
    'Open Discord voice channel "General" on server "Friends".',
    'navigate',
    { channelType: 'text' },
    null,
  );
});

test('colon bodies require the complete original text, including punctuation and semicolons', () => {
  permitted('Send this message in Discord channel #General: Hello world', 'send_message', {
    text: 'Hello world',
  });
  denied('Send this message in Discord channel #General: Hello world', 'send_message', {
    text: 'Hello',
  });
  denied('Send this message in Discord channel #General: Hello; world', 'send_message', {
    text: 'Hello',
  });
  permitted('Send this message in Discord channel #General: Hello; world', 'send_message', {
    text: 'Hello; world',
  });
  denied('Write hello world in Discord channel #General.', 'send_message', { text: 'hello' });
});
