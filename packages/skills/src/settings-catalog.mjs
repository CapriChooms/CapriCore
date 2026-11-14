// SPDX-License-Identifier: GPL-3.0-only
import { webSearchSettings } from './web-search/settings.mjs';
// UI metadata for the desktop's registered, user-facing skills. Port adapters
// such as speech-settings and file-access share their parent skill's page.
export const SKILL_SETTINGS = Object.freeze(
  [
    [
      'capri.microphone',
      'microphone',
      'Voice input',
      'Listen for the wake phrase and transcribe what you say.',
      'M8 4a2 2 0 0 1 4 0v5a2 2 0 0 1-4 0zM5 8v1a5 5 0 0 0 10 0V8m-5 6v4m-3 0h6',
      'microphone-toggle',
      true,
    ],
    [
      'capri.voice-output',
      'voice',
      'Spoken replies',
      'Read Capri’s replies aloud using a local voice or a voice API.',
      'M3 8h3l4-4v12l-4-4H3zm10-1a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10',
      'voice-toggle',
      true,
    ],
    [
      'capri.reasoning',
      'reasoning',
      'Deep thinking',
      'Give Capri more time to work through difficult questions.',
      'M8 3H5L3 6v7l3 4h2l2-2 2 2h2l3-4V6l-2-3h-3l-2 2zm2 2v10M3 9h4l1 2m9-2h-4l-1 2',
      'thinking-toggle',
    ],
    [
      'capri.web-search',
      'web-search',
      'Web search',
      'Search the web for current information and show sources.',
      'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM3 10h14M10 3c4 4 4 10 0 14m0-14c-4 4-4 10 0 14',
      'internet-toggle',
    ],
    [
      'capri.owner-memory',
      'dialogue',
      'Conversation memory',
      'Remember facts you ask Capri to save and recall them in later conversations.',
      'M4 4h12v3H4zm0 5h12v3H4zm0 5h12v3H4zm3-9h1m-1 5h1m-1 5h1',
    ],
    [
      'capri.attachment-viewer',
      'attachments',
      'Attachments',
      'Attach files to messages and open previews from conversation history.',
      'M13 7l-5 5a2 2 0 0 0 3 3l6-6a4 4 0 0 0-6-6l-7 7a5 5 0 0 0 7 7l5-5',
    ],
    [
      'capri.timers',
      'time',
      'Timers and reminders',
      'Set timers, reminders and stopwatches.',
      'M10 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm-2-3h4m-2 3V2m0 6v3l2 1m3-7 2-2',
      'time-open',
    ],
    [
      'capri.screen',
      'screen',
      'Screen observation',
      'Describe or capture a display or window you explicitly share.',
      'M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4m0-7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
      'screen-indicator',
    ],
    [
      'capri.applications',
      'applications',
      'Application access',
      'Launch and use apps you approve by name.',
      'M3 3h5v5H3zm9 0h5v5h-5zm-9 9h5v5H3zm9 0h5v5h-5z',
      'applications-open',
    ],
    [
      'capri.calculator',
      'calculator',
      'Calculator',
      'Check arithmetic and scientific calculations with a calculator.',
      'M5 2h10v16H5zm2 3h6v3H7zm0 6h1m4 0h1m-6 3h1m4 0h1',
    ],
    [
      'capri.spotify',
      'spotify',
      'Spotify',
      'Find tracks, control playback and change Spotify volume.',
      'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM6 8c3-1 5 0 8 1m-8 1c2-1 5 0 7 1m-6 1c2 0 3 0 5 1',
    ],
    [
      'capri.music',
      'music',
      'Music listening',
      'Detect music from system audio and animate Capri to the beat.',
      'M7 14V5l9-2v9M7 14c0 2-4 3-4 1s4-3 4-1zm9-2c0 2-4 3-4 1s4-3 4-1z',
      'music-toggle',
    ],
    [
      'capri.avatar-interaction',
      'avatar-skill',
      'Avatar interaction',
      'Let Capri react to taps and respond to movement requests.',
      'M10 2l7 5-2 9-5 2-5-2-2-9zm-3 7 1 1m5-1-1 1m-4 3h4',
    ],
    [
      'capri.initiative',
      'initiative',
      'Initiative',
      'Let Capri start occasional conversations when appropriate.',
      'M10 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2zm5 12h4m-2-2v4',
    ],
    [
      'capri.voice-calls',
      'calls',
      'Voice calls',
      'Mix Capri’s voice into calls or listen to system audio with your microphone.',
      'M5 6v5m3-7v9m4-9v9m3-7v5M3 15h14m-10 3h6',
    ],
    [
      'capri.computer',
      'computer',
      'Computer control',
      'Carry out approved desktop tasks with a visible control indicator.',
    ],
    [
      'capri.coding',
      'coding',
      'Coding mode',
      'Work in a selected code project using its editor connection.',
      'M7 5l-5 5 5 5m6-10 5 5-5 5M12 2 8 18',
      'coding-toggle',
    ],
    [
      'capri.files',
      'files',
      'File access',
      'Read or edit files only in the folders you share.',
      'M2 5h6l2 2h8v10H2zm3 5h10m-10 3h6',
    ],
    [
      'capri.brain',
      'knowledge',
      'Local Brain',
      'Retrieve relevant excerpts from documents in your Brain folder.',
      'M4 4l6-2 6 2v10l-6 4-6-4zm6-2v16M4 9l6 3 6-3',
    ],
    [
      'capri.private-memory',
      'private-memory',
      'Private memory',
      'Keep sensitive notes in a password-protected vault.',
      'M5 9h10v8H5zm2 0V6a3 3 0 0 1 6 0v3m-3 3v2',
    ],
    [
      'capri.discord-presence',
      'discord',
      'Discord presence',
      'Display Capri as an activity in Discord.',
      'M5 4l3-1m4 0 3 1 3 10-4 2-2-3H8l-2 3-4-2zm2 5h1m4 0h1',
    ],
    [
      'capri.workflows',
      'workflows',
      'Task training',
      'Record and replay a workflow you teach Capri.',
      'M2 4h6v4H2zm10 0h6v4h-6zM7 13h6v4H7zm1-7h4m3 2v3h-5v2',
    ],
    [
      'capri.user-tools',
      'user-tools',
      'User tools',
      'Configure and run user-installed tools with their declared permissions.',
      'M8 2h4v3l3 2 3-1v5l-3 1-2 3v3H7v-3l-2-3-3-1V6l3 1 3-2zm2 6v4m-2-2h4',
    ],
  ].map(([id, section, name, description, icon, buttonId, showButton = false]) =>
    Object.freeze({
      id,
      section,
      name,
      description,
      buttonId,
      showButton,
      icon: icon ?? 'M2 4h16v10H2zm5 13h6m-3-3v3M6 9h3m3-2 2 2-2 2',
    }),
  ),
);

export const SKILL_BY_ID = Object.freeze(
  Object.fromEntries(SKILL_SETTINGS.map((skill) => [skill.id, skill])),
);
export const SKILL_BY_SECTION = Object.freeze(
  Object.fromEntries(SKILL_SETTINGS.map((skill) => [skill.section, skill])),
);
export const COMPOSER_SKILLS = Object.freeze({
  'capri.reasoning': 'thinking-toggle',
  'capri.web-search': 'internet-toggle',
  'capri.attachment-viewer': 'attachment-open',
});
export const REASONING_BUDGETS = Object.freeze({ low: 4096, medium: 8192, high: 16384 });
export function reasoningEffort(value) {
  return typeof value === 'string' && Object.hasOwn(REASONING_BUDGETS, value) ? value : 'medium';
}

export function showComposerSkill(settings, id) {
  const value = settings?.[id];
  return (
    Object.hasOwn(COMPOSER_SKILLS, id) && value?.enabled === true && value.showComposer !== false
  );
}

const russianSkills = {
  'capri.microphone': ['Голосовой ввод', 'Распознаёт фразу активации и переводит речь в текст.'],
  'capri.voice-output': [
    'Озвучка ответов',
    'Читает ответы Capri вслух через локальную модель или голосовой API.',
  ],
  'capri.reasoning': [
    'Глубокое размышление',
    'Даёт Capri больше времени на решение сложных задач.',
  ],
  'capri.web-search': ['Поиск в интернете', 'Ищет актуальную информацию и показывает источники.'],
  'capri.owner-memory': [
    'Память диалогов',
    'Сохраняет факты по твоей просьбе и вспоминает их в следующих разговорах.',
  ],
  'capri.attachment-viewer': [
    'Вложения',
    'Прикрепляет файлы к сообщениям и открывает их превью из истории.',
  ],
  'capri.timers': ['Таймеры и напоминания', 'Запускает таймеры, напоминания и секундомеры.'],
  'capri.screen': [
    'Просмотр экрана',
    'Описывает или снимает экран либо окно, которым ты поделился.',
  ],
  'capri.applications': [
    'Доступ к приложениям',
    'Открывает разрешённые приложения по названию и работает с ними.',
  ],
  'capri.calculator': ['Калькулятор', 'Проверяет арифметические и научные вычисления.'],
  'capri.spotify': ['Spotify', 'Находит треки, управляет воспроизведением и громкостью Spotify.'],
  'capri.music': [
    'Прослушивание музыки',
    'Распознаёт музыку в системном звуке и анимирует Capri в такт.',
  ],
  'capri.avatar-interaction': [
    'Взаимодействие с аватаром',
    'Позволяет Capri реагировать на нажатия и команды перемещения.',
  ],
  'capri.initiative': ['Инициатива', 'Позволяет Capri иногда первой начинать разговор.'],
  'capri.voice-calls': [
    'Голосовые звонки',
    'Передаёт голос Capri в звонок и позволяет слушать системный звук вместе с микрофоном.',
  ],
  'capri.computer': [
    'Управление компьютером',
    'Выполняет разрешённые задачи на рабочем столе с видимым индикатором.',
  ],
  'capri.coding': ['Режим кодинга', 'Работает с выбранным проектом через подключение к редактору.'],
  'capri.files': ['Доступ к файлам', 'Читает и редактирует файлы в папках, которыми ты поделился.'],
  'capri.brain': [
    'Локальная база знаний',
    'Находит подходящие фрагменты документов из папки Brain.',
  ],
  'capri.private-memory': [
    'Личная память',
    'Хранит конфиденциальные заметки в защищённом паролем хранилище.',
  ],
  'capri.discord-presence': [
    'Активность в Discord',
    'Показывает Capri как активность в профиле Discord.',
  ],
  'capri.workflows': [
    'Обучение задачам',
    'Записывает и воспроизводит сценарии, которым ты обучил Capri.',
  ],
  'capri.user-tools': [
    'Пользовательские инструменты',
    'Настраивает и запускает установленные инструменты с их разрешениями.',
  ],
};

export const SKILL_TEXT_RU = Object.freeze({
  ...Object.fromEntries(
    SKILL_SETTINGS.flatMap(({ id, name, description }) => [
      [name, russianSkills[id][0]],
      [description, russianSkills[id][1]],
    ]),
  ),
  Skills: 'Навыки',
  'The model reached its reply limit. Ask for a shorter answer or try another model.':
    'Модель исчерпала лимит ответа. Попросите ответить короче или выберите другую модель.',
  'Hides the reply after playback, or after a delay when voice is off.':
    'Облачко скрывается после озвучки, а при выключенном голосе — через заданное время.',
  'Text-only reply delay (seconds)': 'Задержка для текстового ответа (секунды)',
  'Recognition is not installed. Use Install below.':
    'Распознавание речи не установлено. Нажми «Установить» ниже.',
  'Voice is not installed. Use Install below.':
    'Голосовая модель не установлена. Нажми «Установить» ниже.',
  'Install NVIDIA acceleration': 'Установить ускорение NVIDIA',
  'Install AMD ROCm acceleration': 'Установить ускорение AMD ROCm',
  'AMD ROCm is installed. Select a Radeon GPU or Automatic in Model devices.':
    'AMD ROCm установлен. Выберите Radeon или автоматический режим в разделе устройств для моделей.',
  'AMD ROCm requires Windows 11, a supported Radeon GPU, a compatible AMD driver and 12 GiB of free disk space.':
    'Для AMD ROCm нужны Windows 11, поддерживаемая Radeon, совместимый драйвер AMD и 12 ГиБ свободного места.',
  'AMD ROCm acceleration requires a supported Radeon GPU on Windows 11.':
    'Для ускорения AMD ROCm нужна поддерживаемая Radeon и Windows 11.',
  'Download the Qwen voice model before installing AMD ROCm acceleration.':
    'Скачайте голосовую модель Qwen перед установкой AMD ROCm.',
  'The selected voice GPU runtime is missing. Install acceleration or choose another device in Model devices.':
    'Для выбранной видеокарты не установлен голосовой движок. Установите ускорение или выберите другое устройство.',
  'Checking cached AMD ROCm packages…': 'Проверяем кэш пакетов AMD ROCm…',
  'Connecting to the AMD ROCm package source…': 'Подключаемся к серверу пакетов AMD ROCm…',
  'Downloading AMD ROCm packages…': 'Скачиваем пакеты AMD ROCm…',
  'AMD ROCm download interrupted. Retrying…': 'Загрузка AMD ROCm прервалась. Повторяем…',
  'Unpacking and installing AMD ROCm packages…': 'Распаковываем и устанавливаем AMD ROCm…',
  'Verifying AMD ROCm acceleration…': 'Проверяем ускорение AMD ROCm…',
  'AMD ROCm is installed.': 'AMD ROCm установлен.',
  'Could not download or verify AMD ROCm packages. Retry to resume the download.':
    'Не удалось скачать или проверить пакеты AMD ROCm. Повторите попытку, чтобы продолжить загрузку.',
  'Could not start AMD ROCm acceleration. Check your Radeon GPU and AMD driver.':
    'Не удалось запустить AMD ROCm. Проверьте совместимость Radeon и драйвера AMD.',
  'Checking cached NVIDIA packages…': 'Проверяем сохранённые пакеты NVIDIA…',
  'Connecting to the NVIDIA package source…': 'Подключаемся к серверу пакетов NVIDIA…',
  'Downloading NVIDIA packages…': 'Скачиваем пакеты NVIDIA…',
  'NVIDIA download interrupted. Retrying…':
    'Загрузка пакетов NVIDIA прервалась. Повторяем попытку…',
  'Unpacking and installing NVIDIA packages…': 'Распаковываем и устанавливаем пакеты NVIDIA…',
  'Verifying NVIDIA acceleration…': 'Проверяем ускорение NVIDIA…',
  'NVIDIA acceleration is installed.': 'Ускорение NVIDIA установлено.',
  'Could not download or verify NVIDIA packages. Retry to resume the download.':
    'Не удалось скачать или проверить пакеты NVIDIA. Повторите попытку, чтобы продолжить загрузку.',
  'Could not start NVIDIA acceleration. Check your GPU and NVIDIA driver.':
    'Не удалось запустить ускорение NVIDIA. Проверьте видеокарту и драйвер NVIDIA.',
  'Optional NVIDIA acceleration needs a GPU with BF16 support and 12 GiB of free disk space.':
    'Для ускорения NVIDIA нужна видеокарта с поддержкой BF16 и 12 ГиБ свободного места на диске.',
  'NVIDIA acceleration is installed. Automatic uses the GPU when at least 6 GiB of VRAM are free. Choose CPU in Model devices to keep using the CPU.':
    'Ускорение NVIDIA установлено. Автовыбор задействует видеокарту, если свободно хотя бы 6 ГиБ видеопамяти. Чтобы оставить озвучку на процессоре, выбери CPU в настройках устройств моделей.',
  'Show button in Capri’s toolbar': 'Показывать кнопку в верхней панели Capri',
  'Show button in the message bar': 'Показывать кнопку в строке ввода',
  'Reasoning effort': 'Глубина размышления',
  'Higher effort gives supported models more time and tokens for difficult requests.':
    'На высоком уровне совместимые модели получают больше времени и токенов для сложных задач.',
  'Search engine': 'Поисковая система',
  'Result order': 'Порядок результатов',
  Relevance: 'По релевантности',
  'Title (A–Z)': 'По названию',
  'Website domains': 'Домены сайтов',
  'Exclude these domains': 'Исключать эти домены',
  'Enter domains to keep only results from those sites. Leave empty for all websites.':
    'Укажи домены, чтобы оставить только результаты с этих сайтов. Пустое поле означает поиск по всем сайтам.',
  'Enter up to 12 website domains without paths or URLs.':
    'Укажи до 12 доменов без протоколов и путей.',
  'Save search settings': 'Сохранить настройки поиска',
  'Formats supported by the current model': 'Форматы, доступные для текущей модели',
  'GIF and video frames': 'Кадры GIF и видео',
  'Show calculations in Windows Calculator': 'Показывать вычисления в Калькуляторе Windows',
  'Maximum conversations per hour (1–120; blank uses the preset)':
    'Максимум реплик в час (1–120, пустое поле оставляет значение пресета)',
  'Let Capri save useful preferences automatically':
    'Разрешить Capri автоматически запоминать предпочтения',
  'The active model may check short statements about your preferences after a reply. You can edit or delete saved facts here.':
    'После ответа активная модель может оценить короткие фразы о твоих предпочтениях. Здесь можно менять и удалять сохранённые факты.',
  'Facts Capri can recall in future conversations.':
    'Факты, которые Capri может вспомнить в следующих разговорах.',
  'Memory deleted.': 'Факт удалён.',
  'Open tool folder': 'Открыть папку инструмента',
  'Edit tool details': 'Изменить описание инструмента',
  'Move this tool to the Recycle Bin?': 'Переместить инструмент в корзину?',
  'Experimental builds in the private repository are available to Lava.top subscribers with GitHub access.':
    'Экспериментальные сборки в закрытом репозитории доступны подписчикам Lava.top с доступом на GitHub.',
  'View Lava.top subscription': 'Открыть подписку на Lava.top',
  'Release history': 'История версий',
  'Load versions': 'Загрузить список версий',
  'Choose this update': 'Выбрать это обновление',
  'No release notes.': 'Описания изменений нет.',
  'Private preview versions are unavailable. Connect GitHub to see them.':
    'Закрытые версии недоступны. Подключи GitHub, чтобы увидеть их.',
  'No releases found.': 'Релизы не найдены.',
  'Send your description and selected diagnostics privately to the Capri maintainer. You can also save and review a ZIP on this PC.':
    'Отправь описание и выбранные данные диагностики разработчику Capri. Можно также сохранить ZIP на этом ПК и просмотреть его.',
  'Send report': 'Отправить отчёт',
  'Sending report…': 'Отправляю отчёт…',
  'Report sent.': 'Отчёт отправлен.',
  'Copy timing summary': 'Скопировать замеры',
  'Timing summary copied.': 'Замеры скопированы.',
  'Longest measured stage': 'Самый долгий этап',
  'Enable this skill in Settings → Skills first.': 'Сначала включи этот навык в Settings → Навыки.',
});

export function skillPreferences(value) {
  let search;
  try {
    search = webSearchSettings(value?.['capri.web-search']?.search);
  } catch {
    search = webSearchSettings();
  }
  return Object.fromEntries(
    SKILL_SETTINGS.map(({ id, showButton }) => [
      id,
      {
        enabled:
          typeof value?.[id]?.enabled === 'boolean'
            ? value[id].enabled
            : ['capri.avatar-interaction', 'capri.attachment-viewer'].includes(id),
        showButton:
          typeof value?.[id]?.showButton === 'boolean' ? value[id].showButton : showButton,
        ...(Object.hasOwn(COMPOSER_SKILLS, id)
          ? { showComposer: value?.[id]?.showComposer !== false }
          : {}),
        ...(id === 'capri.reasoning' ? { effort: reasoningEffort(value?.[id]?.effort) } : {}),
        ...(id === 'capri.web-search' ? { search } : {}),
        ...(id === 'capri.calculator' ? { showWindow: value?.[id]?.showWindow === true } : {}),
        ...(id === 'capri.owner-memory' ? { automatic: value?.[id]?.automatic === true } : {}),
      },
    ]),
  );
}
