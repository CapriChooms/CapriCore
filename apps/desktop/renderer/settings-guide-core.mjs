// SPDX-License-Identifier: GPL-3.0-only
export const coreGuides = {
  general: [
    [
      '[data-window-action="hide"]',
      [
        'Hide Capri to the tray',
        'The window disappears while Capri keeps running. Use her Windows notification-area icon to bring it back.',
      ],
      [
        'Сверни Капри в трей',
        'Окно исчезнет, а Капри продолжит работать. Верни её через значок в области уведомлений Windows.',
      ],
    ],
    [
      '[data-window-action="reset-avatar"]',
      [
        'Reset the portrait',
        'Fit Capri’s full sprite inside the portrait and restore the default zoom.',
      ],
      ['Сбрось положение аватара', 'Капри снова будет видна в полный рост с исходным масштабом.'],
    ],
    [
      '[data-window-action="reset-position"]',
      [
        'Return the window to its corner',
        'Move Capri’s window to the bottom-right corner of the primary display.',
      ],
      ['Верни окно в угол экрана', 'Окно Капри вернётся в правый нижний угол основного монитора.'],
    ],
    [
      '#general-on-top',
      ['Keep Capri on top', 'Enable this to keep her window above normal application windows.'],
      [
        'Закрепи Капри поверх окон',
        'Включи настройку, чтобы её окно оставалось над обычными окнами приложений.',
      ],
    ],
    [
      '#general-portrait',
      [
        'Keep the portrait expanded',
        'Enable this to keep the portrait open. Turn it off to allow the compact view.',
      ],
      [
        'Оставь портрет развёрнутым',
        'Включи настройку, чтобы портрет всегда оставался открытым. Выключи её для компактного вида.',
      ],
    ],
    [
      '[data-window-action="focus-mode"]',
      [
        'Switch to focus mode',
        'Focus mode hides Capri and Settings. Restore Capri from her icon in the system tray.',
      ],
      [
        'Переключись в режим фокуса',
        'Режим фокуса скрывает и Капри, и настройки. Чтобы вернуть её, нажми значок в трее.',
      ],
    ],
    [
      '#reply-auto-hide',
      [
        'Hide completed replies automatically',
        'Spoken replies hide after playback. You can find them again in Conversation.',
      ],
      [
        'Скрывай завершённые ответы',
        'Облачко с озвученным ответом скрывается после воспроизведения. Ответ можно снова прочитать в истории.',
      ],
    ],
    [
      '#reply-auto-hide-seconds',
      [
        'Set the text reply delay',
        'With auto-hide on, this determines how long a text-only reply remains visible, from 2 to 60 seconds.',
      ],
      [
        'Задай задержку для текста',
        'При автоскрытии ответ без озвучки остаётся на экране от 2 до 60 секунд по твоей настройке.',
      ],
    ],
    [
      '[data-window-action="reconnect"]',
      [
        'Reconnect or wake Capri',
        'Reconnect if Capri is offline or asleep. If she asks for a model, visit Language model or API connections.',
      ],
      [
        'Переподключи или разбуди Капри',
        'Нажми, если Капри не в сети или спит. Если она просит выбрать модель, открой «Языковая модель» или «Подключения API».',
      ],
    ],
    [
      '[data-window-action="sleep"]',
      ['Put Capri to sleep', 'Sleep unloads local models. They load again when you wake Capri.'],
      [
        'Отправь Капри спать',
        'Капри выгрузит локальные модели и снова загрузит их при пробуждении.',
      ],
    ],
    [
      '[data-window-action="quit"]',
      [
        'Close Capri and unload the models',
        'Quit stops any current reply, closes Capri and unloads her local models.',
      ],
      [
        'Закрой Капри и выгрузи модели',
        'При выходе текущий ответ прервётся, Капри закроется, а локальные модели выгрузятся.',
      ],
    ],
    [
      '#general-reset-settings',
      [
        'Restore default settings',
        'Reset restores preferences and keeps your conversations, memory, installed models, saved connections and permissions.',
      ],
      [
        'Верни стандартные настройки',
        'Сброс возвращает настройки по умолчанию. Диалоги, память, модели, подключения и разрешения сохраняются.',
      ],
    ],
  ],
  languages: [
    [
      '#language-interface',
      [
        'Choose the interface language',
        'This sets labels, menus and settings. The conversation language has its own selection.',
      ],
      [
        'Выбери язык интерфейса',
        'Эта настройка меняет надписи и меню. Язык диалога задаётся отдельно.',
      ],
    ],
    [
      '#language-conversation',
      [
        'Choose the language of replies',
        'The selected model uses this language for subsequent replies. Choose Custom to enter another language. Voice input and spoken replies have their own controls.',
      ],
      [
        'Выбери язык ответов',
        'Выбранная модель следует этому языку в следующих ответах. Для другого языка выбери «Другой язык». Голосовой ввод и озвучка настраиваются отдельно.',
      ],
    ],
    [
      '#language-custom',
      [
        'Name the language',
        'Enter the name of the language you want Capri to use. The selected model must understand it.',
      ],
      [
        'Укажи название языка',
        'Впиши название языка, на котором хочешь общаться с Капри. Текущая модель должна его понимать.',
      ],
    ],
    [
      '#language-apply',
      [
        'Apply your language choices',
        'This saves your changes for future replies. Existing messages keep their original language.',
      ],
      [
        'Примени выбранные языки',
        'Настройки сохранятся для следующих ответов. Уже отправленные сообщения сохраняют исходный язык.',
      ],
    ],
  ],
  audio: [
    [
      '#audio-routing-refresh',
      [
        'Refresh the audio devices',
        'Connect your headset or start a virtual mixer first. System default follows the device selected in Windows.',
      ],
      [
        'Обнови список устройств',
        'Сначала подключи гарнитуру или запусти виртуальный микшер. Системный вариант следует выбору в Windows.',
      ],
    ],
    [
      '#audio-route-microphone',
      [
        'Choose Capri’s microphone',
        'Pick the input carrying your speech, including a virtual input from VoiceMeeter, Voicemod or NVIDIA Broadcast. Microphone settings has gain and a listening test.',
      ],
      [
        'Выбери микрофон Капри',
        'Укажи вход с твоим голосом, в том числе виртуальный от VoiceMeeter, Voicemod или NVIDIA Broadcast. Усиление и проверка сигнала доступны в настройках микрофона.',
      ],
      {
        help: '[data-audio-settings="microphone"]',
      },
    ],
    [
      '#audio-route-speaker',
      [
        'Choose where Capri’s replies play',
        'Pick your speakers or headphones. Voice effects opens the controls for the sound of her voice.',
      ],
      [
        'Выбери, где слышно Капри',
        'Укажи колонки или наушники. Кнопка «Эффекты голоса» открывает настройки обработки звука.',
      ],
      {
        help: '[data-audio-settings="voice"]',
      },
    ],
    [
      '#audio-route-volume',
      [
        'Set the local voice volume',
        'This slider controls Capri’s spoken replies on the selected playback device.',
      ],
      [
        'Настрой громкость голоса',
        'Ползунок меняет громкость ответов Капри на выбранном устройстве воспроизведения.',
      ],
    ],
    [
      '#audio-route-music',
      [
        'Isolate the music signal',
        'Select a recording input or a playback device under Loopback. For a virtual cable, send the player into the cable and choose its recording end here.',
      ],
      [
        'Выдели музыку из звуков ПК',
        'Выбери вход записи либо устройство воспроизведения из группы Loopback. Для виртуального кабеля направь в него звук плеера и укажи здесь парный вход записи.',
      ],
      {
        help: '[data-audio-settings="music"]',
      },
    ],
    [
      '#audio-route-system',
      [
        'Choose system audio in calls',
        'This is what Capri hears when system audio is enabled in a call. Pick the system playback device carrying the call sound.',
      ],
      [
        'Выбери системный звук в звонках',
        'Отсюда Капри слышит звук компьютера, когда прослушивание включено в звонке. Укажи устройство, на которое выводится звук звонка.',
      ],
    ],
    [
      '#audio-route-call',
      [
        'Route the virtual microphone',
        'Choose the cable playback end for Capri’s mix. In Discord or another call app, select that cable’s recording input as the microphone. Use headphones if you hear echo.',
      ],
      [
        'Настрой выход виртуального микрофона',
        'Выбери выход кабеля, куда Капри отправит смесь. В Discord или другой программе звонков выбери вход записи этого кабеля как микрофон. Если слышно эхо, используй наушники.',
      ],
      {
        help: '[data-audio-settings="calls"]',
      },
    ],
  ],
  personality: [
    [
      '#communication-style',
      [
        'Choose Capri’s tone',
        'Neutral, Romantic, Business and Wild change the tone of the next reply. The Personality field provides character instructions.',
      ],
      [
        'Выбери манеру общения',
        'Нейтральный, романтичный, деловой и дикий стили задают тон следующего ответа. Поле «Личность» содержит инструкции о характере.',
      ],
    ],
    [
      '#wild-close-ai-tabs',
      [
        'React to other AI tabs',
        'This works in every communication style. When a supported AI site is active in Chrome or Edge, Capri can make a short comment in her current style. Select Keep tab open within eight seconds to cancel the close.',
      ],
      [
        'Реакция на другие ИИ-вкладки',
        'Работает при любом стиле общения. Если в Chrome или Edge активна вкладка поддерживаемого ИИ-сайта, Капри может прокомментировать это в своём текущем стиле. Чтобы отменить закрытие, нажми «Оставить вкладку открытой» в течение восьми секунд.',
      ],
    ],
    [
      '#companion-conversation-mode',
      [
        'Use hands-free conversation',
        'While voice input is on, Capri can respond to transcribed speech or stay silent. Say her name at the start of a voice command to use a skill.',
      ],
      [
        'Говори без постоянных нажатий',
        'Пока включён голосовой ввод, Капри может ответить на распознанную речь или промолчать. Чтобы вызвать навык голосом, начни команду с её имени.',
      ],
    ],
    [
      '#companion-follow-up',
      [
        'Answer Capri’s follow-up question',
        'After a voice request, a question from Capri opens a listening window when she finishes speaking. The microphone needs to be on.',
      ],
      [
        'Ответь на встречный вопрос',
        'Если Капри задаст вопрос в ответ на голосовую реплику, она начнёт слушать после окончания озвучки. Микрофон должен быть включён.',
      ],
    ],
    [
      '#companion-follow-up-seconds',
      [
        'Set the follow-up listening time',
        'Choose how long Capri waits for your reply after asking a question, from 5 to 30 seconds.',
      ],
      [
        'Задай время прослушивания',
        'Выбери, сколько Капри ждёт твой ответ на вопрос, от 5 до 30 секунд.',
      ],
    ],
    [
      '#companion-save',
      [
        'Apply conversation settings',
        'Save the communication style and conversation switches for the next reply.',
      ],
      [
        'Примени настройки общения',
        'Сохрани стиль общения и переключатели диалога. Они начнут действовать со следующего ответа.',
      ],
    ],
    [
      '#personality-text',
      [
        'Write a custom personality',
        'Describe how you want Capri to behave, ideally with an example. This shapes future replies within your current permissions and conversation. Save an empty field to restore the original character.',
      ],
      [
        'Напиши свой характер Капри',
        'Опиши, как Капри должна себя вести, и приведи пример. Текст влияет на будущие ответы с учётом текущего диалога и разрешений. Сохрани пустое поле, чтобы вернуть исходный характер.',
      ],
      {
        help: '#personality-save',
      },
    ],
    [
      '#personality-open',
      [
        'Edit the personality file',
        'Open the folder with PERSONALITY.md and edit it in your preferred editor. Saved file changes apply to the next reply.',
      ],
      [
        'Открой файл характера',
        'Открой папку с PERSONALITY.md и отредактируй файл. Сохранённые изменения действуют со следующего ответа.',
      ],
    ],
    [
      '#personality-reset',
      [
        'Restore the original personality',
        'This restores Capri’s standard character for the next reply.',
      ],
      [
        'Верни исходный характер',
        'Эта кнопка возвращает стандартный характер Капри со следующего ответа.',
      ],
    ],
  ],
  appearance: [
    [
      '#theme-preset',
      [
        'Choose an interface palette',
        'Pick a preset or choose Custom. The three swatches show the accent, background and panel colors.',
      ],
      [
        'Выбери палитру интерфейса',
        'Выбери готовую тему или свою палитру. Три образца показывают цвета акцента, фона и панелей.',
      ],
    ],
    [
      '#theme-hue',
      [
        'Tune the accent color',
        'In Custom, hue changes the color of highlights. Saturation changes its vividness.',
      ],
      [
        'Настрой цвет акцента',
        'В своей теме оттенок задаёт цвет выделения, а насыщенность — его выразительность.',
      ],
      {
        help: '#theme-saturation',
      },
    ],
    [
      '#theme-background-hue',
      [
        'Tune the background color',
        'Choose the background hue and saturation. Brightness changes how light the background appears.',
      ],
      [
        'Настрой цвет фона',
        'Подбери оттенок и насыщенность фона. Яркость определяет, насколько светлым он выглядит.',
      ],
      {
        help: '#theme-background-saturation, #theme-background-brightness',
      },
    ],
    [
      '#theme-panel-linked',
      [
        'Link the panel color to the background',
        'Match background derives the panel palette from your background. Turn it off for independent panel colors.',
      ],
      [
        'Свяжи цвет панелей с фоном',
        'При включённой связи цвет панелей подстраивается под фон. Выключи её для отдельной настройки.',
      ],
    ],
    [
      '#theme-panel-hue',
      [
        'Tune the panel color',
        'With Match background off, set the panel hue and saturation independently.',
      ],
      [
        'Настрой цвет панели',
        'Если связь с фоном выключена, подбери отдельные оттенок и насыщенность панелей.',
      ],
      {
        help: '#theme-panel-saturation',
      },
    ],
    [
      '#companion-glitch-enabled',
      [
        'Enable visual glitches',
        'Glitches briefly split the colors of Capri’s avatar and the interface edges. Reduced motion disables moving glitches.',
      ],
      [
        'Включи визуальные глитчи',
        'Глитчи кратко разделяют цвета аватара и рамок интерфейса. Системное снижение анимации отключает движущиеся глитчи.',
      ],
    ],
    [
      '#companion-glitch-strength',
      [
        'Tune the visual glitch',
        'This sets the strength of the color split. At zero the effect is invisible. Preview glitch shows a sample.',
      ],
      [
        'Настрой интенсивность глитча',
        'Ползунок задаёт силу разделения цветов. На нуле эффект незаметен. Кнопка предпросмотра показывает пример.',
      ],
      {
        help: '#glitch-preview',
      },
    ],
    [
      '#companion-glitch-interval',
      [
        'Space out ambient glitches',
        'This interval controls how often ambient glitches appear while Capri is visible.',
      ],
      [
        'Настрой частоту фоновых глитчей',
        'Интервал задаёт частоту фоновых вспышек, пока Капри видна.',
      ],
    ],
    [
      '#companion-glitch-events',
      [
        'Use glitches on speech and poses',
        'Speech and pose changes can trigger larger glitches, at least six seconds apart.',
      ],
      [
        'Добавь глитчи при речи и смене позы',
        'Речь и смена позы могут запускать более сильные глитчи с интервалом от шести секунд.',
      ],
    ],
    [
      '#process-graphs',
      [
        'Show resource graphs',
        'Choose up to four metrics. The counter shows how many are selected. With fewer graphs, each graph has space for more seconds of history.',
      ],
      [
        'Включи графики ресурсов',
        'Выбери до четырёх показателей. Счётчик показывает, сколько выбрано. Когда графиков меньше, на каждом помещается больше секунд истории.',
      ],
      {
        help: '[data-resource-display="graphMetrics"]',
      },
    ],
    [
      '#memory-monitor',
      [
        'Show compact resource meters',
        'Turn on compact meters and choose up to four metrics. The selection is independent of the graphs.',
      ],
      [
        'Включи компактные индикаторы',
        'Включи индикаторы и выбери до четырёх показателей. Список для графиков настраивается отдельно.',
      ],
      {
        help: '[data-resource-display="meterMetrics"]',
      },
    ],
    [
      '#memory-style',
      ['Choose the meter shape', 'Choose Circles or Bars for the compact indicators.'],
      ['Выбери форму индикаторов', 'Для компактных индикаторов доступны круги и полосы.'],
    ],
    [
      '#memory-interval',
      [
        'Set the resource refresh interval',
        'Choose how often the graphs and meters refresh, from one to ten seconds. Temperature depends on which CPU sensors Windows or LibreHardwareMonitor can read.',
      ],
      [
        'Настрой обновление показателей',
        'Выбери интервал от одной до десяти секунд для графиков и индикаторов. Показания температуры зависят от доступных датчиков Windows или LibreHardwareMonitor.',
      ],
    ],
    [
      '#settings-portrait-zoom',
      [
        'Set the portrait size',
        'Zoom changes the size of the avatar inside the portrait. Use General to reset its size and position.',
      ],
      [
        'Настрой размер портрета',
        'Масштаб меняет размер аватара внутри портрета. Размер и положение можно сбросить во вкладке «Общее».',
      ],
    ],
    [
      '#companion-expand-reply',
      [
        'Expand Capri for replies',
        'Enable this to open the portrait for voice activation and replies. In compact view, use the diamond button on the top toolbar to open the portrait.',
      ],
      [
        'Разворачивай Капри для ответов',
        'Настройка открывает портрет при голосовой активации и ответах. В компактном режиме портрет можно открыть кнопкой с ромбом в верхней панели.',
      ],
    ],
    [
      '#minimized-chip',
      [
        'Show the restore chip',
        'The desktop chip gives you a quick way to bring Capri back when her window is minimized.',
      ],
      [
        'Показывай метку восстановления',
        'Метка на рабочем столе позволяет быстро вернуть свёрнутое окно Капри.',
      ],
    ],
    [
      '#detached-style',
      [
        'Choose the detached appearance',
        'Show the character sprite or dialogue only when the avatar is out of frame. Moving and attachment controls are under Avatar interaction.',
      ],
      [
        'Выбери вид Капри вне рамки',
        'Показывай спрайт персонажа или только диалог вне рамки. Перемещение и прикрепление настраиваются во вкладке взаимодействия с аватаром.',
      ],
    ],
  ],
  window: [
    [
      '#companion-window-layout',
      [
        'Window layout',
        'Vertical stacks the reply, portrait and message box from top to bottom. Horizontal gives you a wider, shorter window with the portrait on the left and the reply and message box on the right.',
      ],
      [
        'Компоновка окна',
        'В вертикальной компоновке ответ, портрет и поле ввода идут сверху вниз. Горизонтальная делает окно шире и ниже, с портретом слева и перепиской справа.',
      ],
    ],
    [
      '#companion-float-enabled',
      [
        'Enable window motion',
        'This makes the interface drift inside Capri’s window. The preview shows the motion. Interaction pauses it, and reduced motion disables it.',
      ],
      [
        'Включи плавание окна',
        'Интерфейс мягко движется внутри окна Капри. Движение видно в предпросмотре. Оно приостанавливается при взаимодействии и отключается при сниженной анимации.',
      ],
    ],
    [
      '#companion-float-amplitude',
      [
        'Set the motion distance',
        'Amplitude controls how far the interface moves. Zero keeps it still.',
      ],
      [
        'Настрой размах движения',
        'Амплитуда определяет, как далеко смещается интерфейс. Ноль оставляет его неподвижным.',
      ],
    ],
    [
      '#companion-float-period',
      ['Set the motion cycle', 'A longer cycle makes each movement take more time.'],
      ['Настрой длительность цикла', 'Чем дольше цикл, тем медленнее движение.'],
    ],
    [
      '#dimming-enabled',
      ['Dim the desktop behind Capri', 'Enable dimming to make the area behind Capri darker.'],
      ['Затемни рабочий стол за Капри', 'Настройка затемняет участок рабочего стола за Капри.'],
    ],
    [
      '#dimming-level',
      ['Set dimming strength', 'Choose how dark the affected area should become.'],
      ['Настрой силу затемнения', 'Выбери, насколько сильно должен потемнеть фон.'],
    ],
    [
      '#dimming-softness',
      [
        'Soften the dimming edge',
        'A larger value blends the dark area with more of the surrounding desktop.',
      ],
      [
        'Сделай границу затемнения мягче',
        'Большее значение растягивает переход между затемнённым участком и рабочим столом.',
      ],
    ],
  ],
  models: [
    [
      '#models-choice',
      [
        'Choose a local language model',
        'Start with a model recommended for your language and hardware. Disk size, system RAM and GPU memory are separate estimates.',
      ],
      [
        'Выбери локальную языковую модель',
        'Начни с модели, рекомендованной для языка диалога и оборудования. Место на диске, RAM и видеопамять оцениваются отдельно.',
      ],
    ],
    [
      '#models-local',
      [
        'Switch to the selected local model',
        'Capri prepares the selected model if needed, then switches to it. Your conversation and saved memory are kept.',
      ],
      [
        'Переключись на выбранную локальную модель',
        'Капри при необходимости подготовит модель и переключится на неё. Диалог и сохранённая память сохраняются.',
      ],
    ],
    [
      '#models-refresh',
      [
        'Refresh model availability',
        'Refresh models updates which files are downloaded. Open models folder shows where files for the selected source are stored.',
      ],
      [
        'Обнови статус моделей',
        'Кнопка обновляет сведения о скачанных моделях. «Открыть папку моделей» покажет папку выбранного источника.',
      ],
      {
        help: '#models-folder',
      },
    ],
    [
      '#models-prepare',
      [
        'Prepare a model without switching',
        'Download and prepare leaves the current model active. Use Switch model and restart afterwards to activate the download.',
      ],
      [
        'Подготовь модель заранее',
        '«Скачать и подготовить» оставляет текущую модель активной. Чтобы включить новую, нажми «Сменить модель и перезапустить».',
      ],
      {
        help: '#models-apply, #models-cancel',
      },
    ],
    [
      '#models-context',
      [
        'Choose the context window',
        '32K is the recommended starting point. 16K leaves less room for long chats and images. Larger contexts use more RAM and GPU memory. Apply and restart to save.',
      ],
      [
        'Подбери контекстное окно',
        'Начни с рекомендуемых 32K. При 16K вмещается меньше текста и изображений. Большой контекст расходует больше RAM и VRAM. Чтобы сохранить выбор, нажми «Применить и перезапустить».',
      ],
      {
        help: '#models-context-apply',
      },
    ],
    [
      '#model-device-language',
      [
        'Choose where the language model runs',
        'Automatic picks a supported accelerator when possible. CPU mode uses system RAM and can be slower. An external API uses the provider’s hardware.',
      ],
      [
        'Выбери устройство для языковой модели',
        'Автоматический режим по возможности выбирает поддерживаемый ускоритель. CPU расходует оперативную память и может работать медленнее. Внешний API использует оборудование провайдера.',
      ],
    ],
    [
      '#model-device-voice',
      [
        'Choose where the voice model runs',
        'Voice and language model devices can differ. If both use one GPU, they share its memory.',
      ],
      [
        'Выбери устройство для голоса',
        'Озвучка и языковая модель могут работать на разных устройствах. Если они используют одну видеокарту, то делят её память.',
      ],
    ],
    [
      '#model-device-refresh',
      [
        'Read device availability',
        'Refresh the device list and read the status beside each selection. Save and restart Capri to apply changes.',
      ],
      [
        'Проверь доступные устройства',
        'Обнови список устройств и посмотри статус рядом с каждым полем. Сохрани изменения и перезапусти Капри.',
      ],
      {
        help: '#model-device-apply',
      },
    ],
    [
      '#model-device-npu-advanced > summary',
      [
        'Configure an NPU',
        'Use advanced NPU setup with compatible hardware and runtimes. If setup is needed, follow the installation guide for the device.',
      ],
      [
        'Настрой NPU',
        'Расширенная настройка NPU требует совместимого оборудования и движка. Если нужна установка, открой руководство для выбранного устройства.',
      ],
      {
        help: '#model-device-npu-guide',
      },
    ],
    [
      '[data-npu="backend"]',
      [
        'Choose the NPU runtime',
        'Choose the runtime that matches your hardware and driver. Intel uses OpenVINO, AMD uses Ryzen AI, and Qualcomm uses QNN.',
      ],
      [
        'Выбери движок для NPU',
        'Выбери движок, совместимый с устройством и драйвером. Для Intel используется OpenVINO, для AMD — Ryzen AI, для Qualcomm — QNN.',
      ],
    ],
    [
      '[data-npu="folder"]',
      [
        'Select a converted model folder',
        'Choose OpenVINO IR or ONNX GenAI files prepared for the selected NPU. GGUF is for a different runtime. AMD hybrid models also use GPU resources.',
      ],
      [
        'Выбери папку преобразованной модели',
        'Укажи файлы OpenVINO IR или ONNX GenAI для выбранного NPU. Для GGUF нужен другой движок. Гибридные модели AMD также используют видеокарту.',
      ],
      { help: '[data-npu="modelPath"]' },
    ],
    [
      '[data-npu="python"]',
      [
        'Choose the vendor Python environment',
        'Choose the Python installed by your NPU vendor. For Intel you can use the private OpenVINO runtime prepared by Capri.',
      ],
      [
        'Выбери среду Python от производителя',
        'Укажи Python, установленный производителем NPU. Для Intel можно использовать среду OpenVINO, подготовленную Капри.',
      ],
      { help: '[data-npu="install"]' },
    ],
    [
      '[data-npu="contextTokens"]',
      [
        'Set the NPU model context',
        'Set a limit the converted model supports. Larger contexts can increase memory use.',
      ],
      [
        'Укажи контекст модели на NPU',
        'Выбери лимит, поддерживаемый преобразованной моделью. Большой контекст может занять больше памяти.',
      ],
    ],
    [
      '[data-npu="test"]',
      [
        'Test and activate the native model',
        'Test native model checks that the selected configuration runs. If the test passes, choose Use NPU and restart.',
      ],
      [
        'Проверь и включи модель на NPU',
        'Проверка подтверждает запуск с выбранными настройками. Если она успешна, нажми «Использовать NPU и перезапустить».',
      ],
      { help: '[data-npu="use"]' },
    ],
    [
      '#hf-query',
      [
        'Find a Hugging Face repository',
        'Enter a model name or a repository in owner/model format. Use Search to find matches or Open repository for an exact name.',
      ],
      [
        'Найди репозиторий Hugging Face',
        'Введи название модели или путь owner/model. Поиск покажет варианты, а кнопка открытия сразу откроет точный репозиторий.',
      ],
      {
        help: '#hf-search, #hf-inspect, #hf-results button',
      },
    ],
    [
      '#hf-task',
      [
        'Choose what kind of model to look for',
        'Language models search for GGUF. Voice results can require a separate engine. Open Spoken replies for voices Capri can install.',
      ],
      [
        'Выбери тип модели',
        'Поиск языковых моделей ищет GGUF. Голосовым моделям может требоваться отдельный движок. Устанавливаемые голоса доступны в «Озвучке ответов».',
      ],
      {
        help: '#hf-voices',
      },
    ],
    [
      '#hf-file',
      [
        'Choose a GGUF and quantization',
        'Smaller quantizations can save memory at the cost of answer quality. Check the repository license before downloading.',
      ],
      [
        'Выбери GGUF и квантизацию',
        'Более компактная квантизация экономит память, но может снизить качество ответов. Перед скачиванием проверь лицензию.',
      ],
    ],
    [
      '#hf-projector',
      [
        'Choose the vision projector',
        'A vision model may require a matching projector file before it can handle screenshots and image attachments.',
      ],
      [
        'Выбери модуль обработки изображений',
        'Для скриншотов и графических вложений модели со зрением может понадобиться совместимый файл проектора.',
      ],
    ],
    [
      '#hf-plan',
      [
        'Check the download and prepare the model',
        'Check the size first, then download and prepare. After it completes, use the model selector to activate the import.',
      ],
      [
        'Проверь объём загрузки и подготовь модель',
        'Сначала уточни объём, затем скачай и подготовь модель. После загрузки её можно включить в списке моделей.',
      ],
      {
        help: '#hf-install, #hf-cancel',
      },
    ],
    [
      'section:has(> #hf-installed) h3',
      [
        'Review imported Hugging Face models',
        'Activate an imported model from the selector above. Repair replaces missing files, and Remove deletes the import from this PC.',
      ],
      [
        'Посмотри импортированные модели Hugging Face',
        'Импортированную модель можно включить в списке выше. Восстановление возвращает недостающие файлы, а удаление убирает модель с этого ПК.',
      ],
      { help: '#hf-installed button' },
    ],
    [
      'details:has(#hf-token) > summary',
      [
        'Use a token for restricted repositories',
        'Public repositories work without a token. For a private or gated model, obtain repository access and save a Hugging Face read token.',
      ],
      [
        'Укажи токен для закрытого репозитория',
        'Публичные репозитории доступны без токена. Для закрытой модели получи доступ к репозиторию и сохрани токен Hugging Face на чтение.',
      ],
      {
        help: '#hf-token, #hf-save-token, #hf-remove-token',
      },
    ],
  ],
  api: [
    [
      '#api-add',
      [
        'Create an API connection',
        'Open the form to enter a provider, base URL, model ID and API key. A saved connection can be activated from the list.',
      ],
      [
        'Создай подключение API',
        'Открой форму и укажи провайдера, базовый URL, ID модели и ключ API. Сохранённое подключение можно включить из списка.',
      ],
    ],
    [
      '#api-name',
      [
        'Name the connection',
        'Use a label that helps you tell saved connections apart. You can also leave this field empty.',
      ],
      [
        'Назови подключение',
        'По имени проще отличать сохранённые подключения. Это поле можно оставить пустым.',
      ],
    ],
    [
      '#api-provider',
      [
        'Choose the API provider',
        'A preset enters common defaults. Choose Custom for another OpenAI-compatible endpoint.',
      ],
      [
        'Выбери провайдера API',
        'Готовый вариант подставляет стандартные значения. Для другого OpenAI-совместимого сервера выбери «Свой».',
      ],
    ],
    [
      '#api-url',
      [
        'Enter the provider’s API address',
        'Copy the API base URL from the provider’s developer settings. Local services use the address of their running local server.',
      ],
      [
        'Укажи адрес API провайдера',
        'Скопируй базовый URL из настроек API провайдера. Для локального сервиса укажи адрес запущенного локального сервера.',
      ],
    ],
    [
      '#api-model',
      [
        'Enter the model ID',
        'Copy the exact model ID listed by your provider. An incorrect ID can make an otherwise valid connection fail.',
      ],
      [
        'Укажи ID модели',
        'Скопируй точный ID из списка провайдера. При неверном ID подключение может не работать даже с правильным ключом.',
      ],
    ],
    [
      '#api-key',
      [
        'Enter the connection’s API key',
        'Create a key in the provider’s developer account and paste it here. Stored keys are encrypted and excluded from diagnostics.',
      ],
      [
        'Введи ключ API',
        'Создай ключ в кабинете провайдера для разработчиков и вставь его сюда. Сохранённые ключи шифруются и исключаются из диагностики.',
      ],
    ],
    [
      '#api-tools',
      [
        'Enable tool calls if supported',
        'Turn this on when the endpoint supports tool calling. The skills and permissions still control what Capri may do.',
      ],
      [
        'Включи вызов инструментов при поддержке',
        'Включи настройку, если сервер поддерживает вызов инструментов. Действия Капри по-прежнему зависят от навыков и разрешений.',
      ],
    ],
    [
      '#api-vision',
      [
        'Enable image support if available',
        'Vision lets a compatible model work with screenshots and image attachments. Match this switch to the model’s capabilities.',
      ],
      [
        'Включи изображения при поддержке',
        'Зрение позволяет совместимой модели работать со скриншотами и графическими вложениями. Выставь переключатель по возможностям модели.',
      ],
    ],
    [
      '#api-context',
      [
        'Match the provider’s context limit',
        'Enter the server’s supported maximum so that Capri can size requests appropriately.',
      ],
      [
        'Укажи лимит контекста провайдера',
        'Укажи максимальный объём, который принимает сервер, чтобы Капри рассчитывала размер запросов.',
      ],
    ],
    [
      '#api-save',
      [
        'Save or cancel the connection draft',
        'Save connection adds or updates the row in the list. Cancel closes the form and discards the draft.',
      ],
      [
        'Сохрани или отмени черновик',
        'Сохранение добавляет или обновляет подключение в списке. Отмена закрывает форму и сбрасывает черновик.',
      ],
      {
        help: '#api-cancel',
      },
    ],
    [
      '#api-test-all',
      [
        'Check saved connections',
        'Tests send short samples without conversation history and can use quota. The saved row offers individual testing, activation, editing and removal.',
      ],
      [
        'Проверь сохранённые подключения',
        'Тесты отправляют короткие примеры без истории и могут расходовать квоту. В строке подключения доступны отдельная проверка, включение, правка и удаление.',
      ],
      {
        help: '#api-connections button',
      },
    ],
    [
      '#api-mode',
      [
        'See the active model source',
        'External models receive your messages, relevant personality and memory, and authorized tool results. Images are sent when a vision feature is used. The provider’s terms and charges apply.',
      ],
      [
        'Проверь источник активной модели',
        'Внешняя модель получает сообщения, относящиеся к запросу сведения о личности и памяти, а также разрешённые результаты инструментов. При использовании зрения ей могут отправляться изображения. Действуют условия и тарифы провайдера.',
      ],
    ],
    [
      '#api-skip-local-model',
      [
        'Skip the local model while using an API',
        'This saves local memory and skips warmup while your external connection is active. Voice input and speech output have separate settings.',
      ],
      [
        'Пропускай локальную модель в режиме API',
        'Настройка освобождает память ПК и пропускает прогрев при активном внешнем подключении. Распознавание и озвучка настраиваются отдельно.',
      ],
    ],
    [
      '#desktop-ai-details > summary',
      [
        'Find installed AI apps and local servers',
        'Scan reads application metadata and known local model lists. Results may include a local server you can use for a connection.',
      ],
      [
        'Найди ИИ-приложения и локальные серверы',
        'Поиск проверяет сведения о программах и списки моделей известных локальных серверов. Из результатов можно выбрать сервер для подключения.',
      ],
      {
        help: '#desktop-ai-scan, #desktop-ai-installed button, #desktop-ai-servers button',
      },
    ],
    [
      '#chatgpt-plan-connect',
      [
        'Sign in with a ChatGPT account',
        'Continue with ChatGPT starts browser sign-in for an eligible account. Add account saves a second login.',
      ],
      [
        'Войди через аккаунт ChatGPT',
        'Кнопка входа открывает браузер для подходящего аккаунта. «Добавить аккаунт» сохраняет дополнительный вход.',
      ],
      {
        help: '#chatgpt-plan-add-account, #chatgpt-plan-cancel',
      },
    ],
    [
      '#chatgpt-plan-account',
      [
        'Choose a saved ChatGPT account',
        'Select the account for the model you want Capri to use. Sign out removes that stored sign-in.',
      ],
      [
        'Выбери аккаунт ChatGPT',
        'Укажи аккаунт, через который Капри будет использовать модель. Выход удаляет сохранённый вход для него.',
      ],
      {
        help: '#chatgpt-plan-signout',
      },
    ],
    [
      '#chatgpt-plan-model',
      [
        'Choose a model for this account',
        'Choose an available model, then select Use connection. Refresh models reloads the list, and Test connection sends a sample.',
      ],
      [
        'Выбери модель для аккаунта',
        'Выбери доступную модель и включи подключение. Можно обновить список моделей или отправить пробный запрос.',
      ],
      {
        help: '#chatgpt-plan-save, #chatgpt-plan-models, #chatgpt-plan-test',
      },
    ],
    [
      '#chatgpt-plan-usage',
      ['Review ChatGPT usage', 'Open account usage to check activity and plan limits.'],
      [
        'Посмотри использование ChatGPT',
        'Открой сведения об использовании аккаунта, чтобы проверить активность и лимиты плана.',
      ],
    ],
  ],
  microphone: [
    [
      '#skill-show-button',
      [
        'Show the voice input shortcut',
        'Enable the skill in the sidebar. Its toolbar shortcut controls wake-phrase listening. The mic in the message bar captures speech on demand.',
      ],
      [
        'Покажи кнопку голосового ввода',
        'Включи навык в боковой панели. Кнопка на верхней панели управляет ожиданием имени, а микрофон у строки ввода записывает фразу по нажатию.',
      ],
    ],
    [
      '#settings-audio-device',
      [
        'Select the recording input',
        'Choose a physical mic or a virtual input carrying your voice. Refresh devices after connecting a new one.',
      ],
      [
        'Выбери вход записи',
        'Укажи физический микрофон или виртуальный вход с твоим голосом. После подключения устройства обнови список.',
      ],
      {
        help: '#settings-device-refresh',
      },
    ],
    [
      '#settings-microphone-monitor',
      [
        'Listen to your microphone',
        'Listen to the selected input and watch the meter. Use headphones to avoid feedback.',
      ],
      [
        'Прослушай микрофон',
        'Прослушай выбранный вход и посмотри на индикатор уровня. Используй наушники, чтобы избежать эха и свиста.',
      ],
    ],
    [
      '#settings-microphone-gain',
      [
        'Amplify a quiet microphone',
        '100% keeps the original level. Raise it gradually and reduce it if speech clips or background noise becomes distracting.',
      ],
      [
        'Усиль тихий микрофон',
        '100% оставляет исходный уровень. Повышай усиление постепенно и уменьши его, если речь хрипит или мешает фоновый шум.',
      ],
    ],
    [
      '#language-recognition',
      [
        'Choose the recognition language',
        'Automatic follows the conversation language when a recognition pack is available. Apply the change, then turn the microphone back on.',
      ],
      [
        'Выбери язык распознавания',
        'Автоматический режим следует языку диалога, когда доступен пакет распознавания. Примени настройку, затем снова включи микрофон.',
      ],
      {
        help: '#language-recognition-controls > .settings-actions:last-child button',
      },
    ],
    [
      '#language-install-speech',
      [
        'Install missing recognition components',
        'Install and enable downloads the components needed for the selected recognition language. Keep Capri open while it runs.',
      ],
      [
        'Установи компоненты распознавания',
        'Кнопка скачивает компоненты для выбранного языка распознавания. Оставь Капри открытой до конца установки.',
      ],
      {
        help: '#language-install-details > summary, #language-install-cancel, #language-install-report',
      },
    ],
    [
      '#speech-pause',
      [
        'Set the pause after speaking',
        'A short pause lets Capri answer sooner. Increase it if she interrupts your thought. Reset to 1 s restores the usual pause.',
      ],
      [
        'Настрой паузу после речи',
        'Короткая пауза позволяет ответить быстрее. Увеличь её, если Капри перебивает на середине мысли. Сброс возвращает одну секунду.',
      ],
      {
        help: '#speech-reset, #speech-apply',
      },
    ],
    [
      '#wake-restore-from-tray',
      [
        'Restore Capri at the wake phrase',
        'Enable this to show the window when voice activation hears her name while Capri is in the tray.',
      ],
      [
        'Возвращай Капри из трея по имени',
        'Настройка показывает окно, если голосовая активация услышит имя Капри, пока окно свёрнуто в трей.',
      ],
    ],
    [
      '#wake-sound',
      [
        'Choose a wake sound',
        'Pick a tone, a short custom file, Capri’s voice, or silence. Custom audio can be up to ten seconds.',
      ],
      [
        'Выбери звук активации',
        'Можно выбрать сигнал, короткий файл, голос Капри или тишину. Свой звук может длиться до десяти секунд.',
      ],
      {
        help: '#wake-import',
      },
    ],
    [
      '#wake-phrase',
      [
        'Pick the spoken acknowledgement',
        'Choose a phrase and prepare it once with the current voice. Capri uses a signal tone while a prepared sample is unavailable.',
      ],
      [
        'Выбери фразу подтверждения',
        'Укажи фразу и один раз подготовь её текущим голосом. Пока готового образца нет, Капри подаёт обычный сигнал.',
      ],
      {
        help: '#wake-prepare',
      },
    ],
    [
      '#wake-volume',
      [
        'Set the wake acknowledgement volume',
        'Set how loud the acknowledgement is and select Play to test it.',
      ],
      [
        'Настрой громкость звука активации',
        'Выбери громкость подтверждения и нажми «Прослушать» для проверки.',
      ],
      {
        help: '#wake-play',
      },
    ],
  ],
  voice: [
    [
      '#voice-source-local',
      [
        'Set up a local voice',
        'Local opens speech settings for this PC. The source status shows which voice Capri actually uses.',
      ],
      [
        'Настрой локальную озвучку',
        'Кнопка «Локально» открывает настройки озвучки на этом ПК. Активный источник указан выше.',
      ],
    ],
    [
      '#voice-use-local',
      [
        'Switch back to local voice',
        'Use local voice turns off the external voice connection and returns to the selected local voice.',
      ],
      [
        'Вернись к локальной озвучке',
        'Эта кнопка отключает облачную озвучку и возвращает выбранный локальный голос.',
      ],
    ],
    [
      '#language-speech',
      [
        'Choose the speech language',
        'Automatic follows the conversation language. Text replies only silences speech. Choose a specific language if your voice supports it, then apply.',
      ],
      [
        'Выбери язык озвучки',
        'Автоматический режим следует языку диалога. «Только текст» отключает голос. Можно выбрать поддерживаемый языковой пакет и нажать «Применить».',
      ],
      {
        help: '#language-speech-controls > .settings-actions:last-child button',
      },
    ],
    [
      '#language-install-speech',
      [
        'Install the missing voice',
        'Install and enable downloads the voice for your chosen language. Keep Capri open while the download runs.',
      ],
      [
        'Установи недостающий голос',
        'Кнопка скачивает и включает голос для выбранного языка. Оставь Капри открытой до конца установки.',
      ],
      {
        help: '#language-install-details > summary, #language-install-cancel, #language-install-report',
      },
    ],
    [
      '#voice-model-language',
      [
        'Filter voices by language',
        'Choose the intended speech language to see the compatible Hugging Face voices.',
      ],
      [
        'Отфильтруй голоса по языку',
        'Выбери язык озвучки, чтобы увидеть совместимые голосовые модели Hugging Face.',
      ],
    ],
    [
      '#voice-model-choice',
      [
        'Choose a local voice model',
        'Choose a voice from the list for the selected language. Its source, disk size and installation status appear below.',
      ],
      [
        'Выбери локальную голосовую модель',
        'Выбери голос для нужного языка. Под списком указаны источник, размер и статус установки.',
      ],
    ],
    [
      '#voice-model-details',
      [
        'Check voice hardware requirements',
        'Check CPU and GPU requirements for the selected voice. When available, install NVIDIA or AMD acceleration or select the suggested CPU-compatible voice.',
      ],
      [
        'Проверь требования к оборудованию',
        'Проверь требования выбранного голоса к процессору и видеокарте. Если доступно, установи ускорение NVIDIA или AMD либо выбери предложенную модель для CPU.',
      ],
      {
        help: '#voice-model-cuda, #voice-model-rocm, #voice-model-cpu-alternative',
      },
    ],
    [
      '#voice-model-install',
      [
        'Download a voice',
        'Download the chosen model first. Cancel download interrupts preparation of that model.',
      ],
      ['Скачай голос', 'Сначала скачай выбранный голос. Кнопка отмены прерывает его подготовку.'],
      {
        help: '#voice-model-install-cancel',
      },
    ],
    [
      '#voice-model-select',
      [
        'Use a downloaded voice',
        'Use this voice model activates the downloaded voice. Try a short reply after selecting it.',
      ],
      [
        'Включи скачанный голос',
        '«Использовать эту голосовую модель» включает скачанный голос. Проверь его на коротком ответе.',
      ],
    ],
    [
      '#voice-model-breeze-import',
      [
        'Set up a Breeze voice',
        'Select Breeze for English or Mandarin. Read and accept the model license before downloading. Import a .breeze profile you have permission to use, then activate the downloaded model. Breeze uses Vulkan on compatible GPUs and can run on the CPU.',
      ],
      [
        'Настрой голос Breeze',
        'Выбери Breeze для английского или китайского. Прочитай и прими лицензию перед скачиванием. Импортируй профиль .breeze, на использование которого у тебя есть разрешение, и включи скачанную модель. Breeze работает через Vulkan на совместимых видеокартах и умеет работать на CPU.',
      ],
      {
        help: '#voice-model-breeze-license, #voice-model-breeze-accept',
      },
    ],
    [
      '#voice-model-import',
      [
        'Choose recordings for voice training',
        'Choose recordings you have permission to use. Use separate takes and keep clips from the same scene together. Review transcripts before importing.',
      ],
      [
        'Выбери записи для обучения голоса',
        'Выбери записи, на использование которых у тебя есть разрешение. Бери отдельные дубли, а клипы одной сцены храни вместе. Перед импортом сверь расшифровки.',
      ],
    ],
    [
      '#voice-model-recording-reference',
      [
        'Review recordings and choose a reference',
        'Check each clip’s words and select a clear, neutral reference. Import reviewed recordings saves the set for later. Import and train starts training immediately.',
      ],
      [
        'Проверь записи и выбери образец',
        'Сверь текст с каждым клипом и выбери чистый образец с нейтральной интонацией. Можно сохранить проверенные записи или сразу запустить обучение.',
      ],
      {
        help: '#voice-model-recording-list :is(textarea, button), #voice-model-approve, #voice-model-approve-train, #voice-model-discard',
      },
    ],
    [
      '#voice-model-train',
      [
        'Train the local voice',
        'Start training on the reviewed recordings. It runs on this PC and can be stopped with Cancel training.',
      ],
      [
        'Обучи локальный голос',
        'Запусти обучение на проверенных записях. Оно идёт на этом ПК. При необходимости нажми «Отменить обучение».',
      ],
      {
        help: '#voice-model-cancel',
      },
    ],
    [
      '#voice-model-preview',
      [
        'Check and apply the trained voice',
        'Listen to the result. Apply trained voice selects it for future speech.',
      ],
      [
        'Послушай и включи обученный голос',
        'Прослушай результат. Кнопка применения включает новый голос для следующих ответов.',
      ],
      {
        help: '#voice-model-apply',
      },
    ],
    [
      '#voice-source-api',
      [
        'Open the cloud voice settings',
        'Voice API opens the external speech settings. Cloud speech uses its own provider and connection.',
      ],
      [
        'Открой настройки облачной озвучки',
        'Вкладка «API голоса» открывает настройки внешней озвучки. Для неё используется отдельное подключение к провайдеру.',
      ],
    ],
    [
      '#tts-api-provider',
      [
        'Choose the voice provider',
        'Choose your speech service. For another OpenAI-compatible provider, use its API endpoint and credentials.',
      ],
      [
        'Выбери провайдера озвучки',
        'Выбери голосовой сервис. Для другого OpenAI-совместимого провайдера используй его адрес API и ключ.',
      ],
    ],
    [
      '#tts-api-key',
      [
        'Enter the provider’s voice API key',
        'Create a voice API key with the provider and paste it here. A ChatGPT sign-in and a voice API key are separate.',
      ],
      [
        'Введи ключ голосового API',
        'Создай голосовой API-ключ у провайдера и вставь его сюда. Вход в ChatGPT и голосовой API подключаются отдельно.',
      ],
    ],
    [
      '#tts-api-model',
      [
        'Enter the voice model ID',
        'Copy the exact model ID from the voice provider. The choice must support the selected voice.',
      ],
      [
        'Укажи ID модели озвучки',
        'Скопируй точный ID модели у голосового провайдера. Модель должна поддерживать выбранный голос.',
      ],
    ],
    [
      '#tts-api-voice',
      [
        'Enter the voice name or ID',
        'Use the name or ID listed by your provider. Try the connection to hear how this voice sounds.',
      ],
      [
        'Укажи имя или ID голоса',
        'Введи имя или ID из списка провайдера. Проверка подключения позволит услышать этот голос.',
      ],
    ],
    [
      '#tts-api-url',
      [
        'Enter the server address',
        'For compatible services, enter the base API URL from the provider’s documentation.',
      ],
      [
        'Укажи адрес сервера',
        'Для совместимого сервиса возьми базовый URL API из документации провайдера.',
      ],
    ],
    [
      '#tts-api-save',
      [
        'Save and test the connection',
        'The test plays a short sample and may use provider credit. Check the key, model and voice if there is an error.',
      ],
      [
        'Сохрани и проверь подключение',
        'Проверка воспроизводит короткий образец и может расходовать баланс провайдера. При ошибке проверь ключ, модель и голос.',
      ],
    ],
    [
      '#tts-api-enabled',
      [
        'Enable cloud speech',
        'Enable Use cloud voice after a successful test. The voice request contains the text Capri will speak.',
      ],
      [
        'Включи облачную озвучку',
        'После успешного теста включи облачный голос. В голосовой запрос попадает только текст для озвучки.',
      ],
    ],
    [
      '#tts-api-remove',
      [
        'Remove the voice connection',
        'Remove the saved service when you no longer want to use its voice.',
      ],
      [
        'Удали голосовое подключение',
        'Удали сохранённое подключение, если перестал пользоваться этим голосовым сервисом.',
      ],
    ],
    [
      '#voice-effects-enabled',
      [
        'Turn on voice effects',
        'Voice effects change playback of Capri’s spoken replies. Enable them to hear the processing.',
      ],
      [
        'Включи эффекты голоса',
        'Эффекты меняют звучание ответов Капри. Включи обработку, чтобы услышать результат.',
      ],
    ],
    [
      '#voice-effects-preset',
      [
        'Choose an effect preset',
        'Choose a ready-made sound, then adjust individual sliders if you want to make it your own.',
      ],
      [
        'Выбери пресет эффектов',
        'Выбери готовое звучание. Затем его можно подстроить отдельными ползунками.',
      ],
    ],
    [
      '#fx-intensity',
      ['Set the effect strength', 'Intensity changes the overall strength of the processing.'],
      ['Настрой силу обработки', 'Интенсивность меняет общую силу обработки.'],
    ],
    [
      '#fx-mix',
      [
        'Blend the original and processed voice',
        'Lower Effect mix to make the original voice clearer.',
      ],
      [
        'Смешай исходный звук и эффекты',
        'Уменьши долю эффекта, чтобы лучше слышать исходный голос.',
      ],
    ],
    [
      '#fx-reverb',
      [
        'Add a room sound',
        'Reverb gives the voice a sense of space. Reduce it to keep words crisp.',
      ],
      [
        'Добавь звучание помещения',
        'Реверберация добавляет объём. Уменьши её для более чёткой речи.',
      ],
    ],
    [
      '#fx-delay',
      ['Add a short echo', 'Short delay adds a faint repeat after each sound.'],
      ['Добавь короткое эхо', 'Задержка добавляет тихий повтор за звуком.'],
    ],
    [
      '#fx-filter',
      ['Shape the radio sound', 'Radio filtering narrows the tone like a radio transmission.'],
      ['Настрой радиофильтр', 'Радиофильтр сужает тембр до звучания радиопередачи.'],
    ],
    [
      '#fx-glitch',
      [
        'Control voice glitch frequency',
        'Raise this setting to hear more electronic interruptions in the voice.',
      ],
      [
        'Выбери частоту голосовых глитчей',
        'Увеличь значение, если хочешь чаще слышать электронные перебои.',
      ],
    ],
    [
      '#fx-electronicMix',
      [
        'Blend in a synthetic layer',
        'Raise the blend to make the electronic layer more prominent.',
      ],
      ['Подмешай электронный слой', 'Увеличь долю, чтобы электронный слой звучал заметнее.'],
    ],
    [
      '#fx-carrierHz',
      [
        'Tune the electronic layer',
        'The carrier frequency changes the pitch of the synthetic layer.',
      ],
      ['Настрой частоту электронного слоя', 'Несущая определяет высоту электронного слоя.'],
    ],
    [
      '#voice-effects-reset',
      ['Reset the voice effects', 'Reset to clean restores the clean effect settings.'],
      ['Сбрось эффекты голоса', 'Сброс возвращает настройки чистого звучания.'],
    ],
    [
      '#voice-effects-preview',
      [
        'Listen to the voice',
        'The preview uses the current voice and effect settings. If it is silent, check the source, language and Audio output.',
      ],
      [
        'Послушай голос',
        'Предпросмотр использует текущий голос и эффекты. Если звука нет, проверь источник, язык и устройство вывода во вкладке «Аудио».',
      ],
    ],
  ],
  reasoning: [
    [
      '#skill-show-composer',
      [
        'Use Deep thinking when you need it',
        'Enable the skill in the sidebar. Show its button in the message bar to turn it on for requests that need more reasoning.',
      ],
      [
        'Включай глубокое размышление по ситуации',
        'Включи навык в боковой панели. Покажи кнопку в строке ввода, чтобы включать размышление для сложных запросов.',
      ],
    ],
    [
      '#reasoning-effort',
      [
        'Balance depth and response time',
        'Low, Medium and High set how much effort a supported model spends thinking. Higher effort may take longer and use more API tokens.',
      ],
      [
        'Выбери глубину размышлений',
        'Низкий, средний и высокий уровни задают объём размышлений для совместимой модели. Высокий уровень может увеличить время ответа и расход токенов API.',
      ],
    ],
  ],
  'web-search': [
    [
      '#web-search-engine',
      [
        'Choose the search engine',
        'DuckDuckGo searches the broader web. Wikipedia searches encyclopedia articles. The search service receives the query.',
      ],
      [
        'Выбери поисковик',
        'DuckDuckGo ищет по разным сайтам, Wikipedia — по энциклопедическим статьям. Поисковая служба получает текст запроса.',
      ],
    ],
    [
      '#web-search-sort',
      [
        'Choose the result order',
        'Relevance puts likely matches first. Title (A–Z) sorts result titles alphabetically.',
      ],
      [
        'Выбери порядок результатов',
        'По релевантности сначала показываются наиболее подходящие страницы. Вариант «По заголовку» сортирует их по алфавиту.',
      ],
    ],
    [
      '#web-search-domains',
      [
        'Filter the sites in search results',
        'Enter hostnames separated by commas. An empty list searches all sites. A narrow filter can produce no results.',
      ],
      [
        'Отфильтруй сайты в выдаче',
        'Введи домены через запятую. Пустой список ищет по всем сайтам. Слишком узкий фильтр может оставить выдачу пустой.',
      ],
    ],
    [
      '#web-search-exclude',
      [
        'Exclude domains instead of keeping them',
        'Enable this to omit listed sites. With it off, only the listed sites are kept.',
      ],
      [
        'Исключи перечисленные домены',
        'Переключатель убирает перечисленные сайты из выдачи. Когда он выключен, остаются только перечисленные сайты.',
      ],
    ],
    [
      '#web-search-save',
      [
        'Save and test the search settings',
        'Save the settings, then try a concrete query. If the result is empty, widen the filter or switch engines.',
      ],
      [
        'Сохрани и проверь поиск',
        'Сохрани настройки и попробуй конкретный запрос. Если выдача пустая, расширь фильтр или смени поисковик.',
      ],
    ],
  ],
};
