// SPDX-License-Identifier: GPL-3.0-only
const steps = [
  { id: 'overview', target: '#portrait-panel', fallbackTarget: '#avatar-viewport, #handle' },
  { id: 'type', target: '.composer', fallbackTarget: '#input-dock' },
  {
    id: 'voice',
    target: '#input-microphone',
    fallbackTarget: '#microphone-toggle, .composer',
  },
  { id: 'replies', target: '#history-toggle', fallbackTarget: '#subtitle-stage, #handle' },
  {
    id: 'settings',
    target: '#settings-open',
    fallbackTarget: '#quick-actions',
    section: 'general',
  },
  {
    id: 'models',
    target: '#inference-picker',
    fallbackTarget: '#inference-label, #handle',
    panel: 'inference',
  },
  {
    id: 'local',
    target: '#inference-picker [data-settings="models"]',
    fallbackTarget: '#inference-label, #handle',
    panel: 'inference',
    section: 'models',
  },
  {
    id: 'api',
    target: '#inference-picker [data-settings="api"]',
    fallbackTarget: '#inference-label, #handle',
    panel: 'inference',
    section: 'api',
  },
];

const translations = {
  en: {
    kicker: 'CAPRI // GUIDE',
    beginnerTitle: '1. Getting started',
    beginnerDescription: 'Meet Capri, learn how to talk to her, and choose a language model.',
    close: 'Close guide',
    back: 'Back',
    next: 'Next',
    skip: 'Skip step',
    finish: 'Finish',
    stepLabel: (current, total) => `Step ${current} of ${total}`,
    statusUnavailable: 'I couldn’t open Settings. You can still use the gear to get there.',
    steps: {
      overview: {
        title: 'Hey, I’m Capri',
        description:
          'This is my main window. My portrait shows my current state, and the bar above it has the model picker and window controls. I’ll show you what you need for our first chat.',
      },
      type: {
        title: 'Send me a message',
        description:
          'Type here and press Enter or click the send arrow. Shift+Enter starts a new line. After the guide, try asking “What can you help me with?”',
      },
      voice: {
        title: 'Talk to me',
        description:
          'Enable Voice input in Settings, then click the mic beside the send arrow to speak. With the toolbar mic on, you can say “Hey, Capri” to get my attention. The Voice input page also lets you choose your microphone and recognition language.',
      },
      replies: {
        title: 'Find my replies',
        description:
          'My latest reply appears above my portrait. Use the speech bubble to read past messages, or the speaker button to turn my spoken replies on or off.',
      },
      settings: {
        title: 'Make me yours',
        description:
          'The gear opens Settings. Use Languages to change the interface or conversation language. In Skills you can turn individual features on and off.',
        actionLabel: 'Open Settings',
      },
      models: {
        title: 'See which model I’m using',
        description:
          'The label in the top bar shows my current model. Open it to switch between Local and any saved API connections. The menu shows which one is active.',
      },
      local: {
        title: 'Run a model on this PC',
        description:
          'Open Language model, pick a model that suits your hardware, and select Use local model. I’ll prepare it and download the model files if they’re missing.',
        actionLabel: 'Language model',
      },
      api: {
        title: 'Connect an API provider',
        description:
          'Open API connections and select Add an API connection. Choose a provider, then enter its model ID and API key. Save and select Use connection. Your chat requests go to that provider.',
        actionLabel: 'API connections',
      },
    },
  },
  ru: {
    kicker: 'CAPRI // ГАЙД',
    beginnerTitle: '1. Первые шаги',
    beginnerDescription:
      'Познакомься с Капри, узнай, как с ней общаться, и выбери языковую модель.',
    close: 'Закрыть гайд',
    back: 'Назад',
    next: 'Далее',
    skip: 'Пропустить шаг',
    finish: 'Завершить',
    stepLabel: (current, total) => `Шаг ${current} из ${total}`,
    statusUnavailable: 'Не получилось открыть настройки. Попробуй нажать на шестерёнку.',
    steps: {
      overview: {
        title: 'Привет, я Капри',
        description:
          'Это моё главное окно. По портрету видно, что я сейчас делаю, а на верхней панели можно выбрать модель и управлять окном. Покажу, как начать со мной разговор.',
      },
      type: {
        title: 'Напиши мне',
        description:
          'Введи сообщение и нажми Enter или стрелку отправки. Shift+Enter добавляет новую строку. После гайда можешь спросить «Чем ты можешь мне помочь?»',
      },
      voice: {
        title: 'Поговори со мной',
        description:
          'Включи «Голосовой ввод» в настройках и нажми на микрофон рядом со стрелкой отправки, чтобы говорить. Когда микрофон на верхней панели включён, меня можно позвать «Эй, Капри». В разделе «Голосовой ввод» можно выбрать устройство и язык распознавания.',
      },
      replies: {
        title: 'Где читать мои ответы',
        description:
          'Мой последний ответ появляется над портретом. Кнопка с облачком открывает историю разговора, а кнопка с динамиком включает или выключает озвучку ответов.',
      },
      settings: {
        title: 'Настрой меня под себя',
        description:
          'Шестерёнка открывает настройки. В разделе «Языки» можно изменить язык интерфейса или диалога. В группе «Навыки» можно включать и выключать отдельные функции.',
        actionLabel: 'Открыть настройки',
      },
      models: {
        title: 'Как узнать, какая модель активна',
        description:
          'Текущая модель указана на верхней панели. Нажми на её название, чтобы выбрать локальную модель или сохранённое подключение API. В меню отмечен активный вариант.',
      },
      local: {
        title: 'Запусти модель на компьютере',
        description:
          'Открой раздел «Языковая модель», выбери вариант для своего компьютера и нажми «Использовать локальную модель». Я подготовлю её и скачаю файлы, если их ещё нет.',
        actionLabel: 'Языковая модель',
      },
      api: {
        title: 'Подключи провайдера API',
        description:
          'Открой «Подключения API» и нажми «Добавить подключение API». Выбери провайдера и введи ID модели и ключ API. Сохрани настройки и нажми «Использовать подключение». Запросы будут отправляться этому провайдеру.',
        actionLabel: 'Подключения API',
      },
    },
  },
};

export function guideContent(locale) {
  const language = /^ru(?:-|$)/i.test(locale) ? 'ru' : 'en';
  const { steps: localizedSteps, ...labels } = translations[language];
  return { ...labels, steps: steps.map((step) => ({ ...step, ...localizedSteps[step.id] })) };
}
