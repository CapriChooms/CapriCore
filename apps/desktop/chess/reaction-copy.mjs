// SPDX-License-Identifier: GPL-3.0-only
import { uiText } from '../interface-translations.mjs';

export const reactionLabels = Object.freeze({
  start: 'Game start',
  castle: 'Castling',
  capture: 'Capture',
  check: 'Check',
  promotion: 'Pawn promotion',
  mate: 'Checkmate',
  draw: 'Draw',
});

const roles = { player: 'You', opponent: 'Opponent', w: 'White', b: 'Black' };
const priorities = ['mate', 'draw', 'promotion', 'check', 'capture', 'castle', 'start'];
const lead = (text, language) => text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

const english = {
  capture: [
    '{Mover} takes {target}.',
    '{Target} is off the board, courtesy of {mover}.',
    '{Mover} just took {target}.',
  ],
  check: ['{Checker} gives check.', 'Check from {checker}.', '{Checker} has the king in check.'],
  double: [
    'Double check. That king needs a way out.',
    '{Actor} lands a double check.',
    'Two pieces checking the king at once.',
  ],
  mate: ['Checkmate. {Winner}.', '{Winner}, and that’s mate.', 'Mate with {checker}. {Winner}.'],
  promotion: [
    'Promotion for {actor}. That’s {promoted}.',
    'Change of plans. The pawn becomes {promoted}.',
    'That pawn steps up to become {promoted}.',
  ],
  castleShort: [
    'Kingside castle for {actor}.',
    'Kingside castling. King tucked in.',
    'There goes the king. Short castle for {actor}.',
  ],
  castleLong: [
    'Queenside castle for {actor}.',
    'Queenside castle. Over goes the king.',
    'The long way with the king. Queenside castle.',
  ],
  stalemate: [
    'Stalemate. The king is safe, and there’s no move.',
    'No check and no legal move. Stalemate.',
    'Stalemate. A draw by dead end.',
  ],
  draw: [
    'Draw. There’s too little material to mate.',
    'Too few pieces to finish it. Draw.',
    'That’s a draw. Neither side has enough to mate.',
  ],
  short: {
    capture: '{Mover} takes {target}.',
    check: 'And check.',
    double: 'Double check.',
    mate: 'Checkmate.',
    promotion: 'The pawn becomes {promoted}.',
    castleShort: 'Kingside castle.',
    castleLong: 'Queenside castle.',
    stalemate: 'Stalemate.',
    draw: 'It’s a draw.',
  },
  asides: {
    neutral: {
      opening: [
        'Pieces up. Show me something weird.',
        'Let’s see who blinks first.',
        'New board. I’m watching.',
      ],
      tactic: ['I saw that.', 'That’s one way to make a point.', 'Okay, I’m paying attention.'],
      queen: [
        'That changes the board.',
        'Well, there goes the big piece.',
        'Someone has to improvise now.',
      ],
      ending: ['There it is.', 'That one stays with me.', 'I’ll remember that finish.'],
      ahead: [
        '{Edge} has the edge.',
        'The pressure is coming from {edge}.',
        '{Edge} has room to lean in.',
      ],
      even: ['Still close.', 'The board hasn’t picked a side yet.'],
    },
    romantic: {
      opening: [
        'Come on, let me watch this one with you.',
        'A fresh board, and I get the seat next to you.',
      ],
      tactic: [
        'I like watching this with you.',
        'You have my full attention.',
        'I’m right here. Keep going.',
      ],
      queen: [
        'A twist already. Stay with me.',
        'That’s the sort of surprise I like watching with you.',
      ],
      ending: [
        'I’m glad I watched it with you.',
        'Now I want another round with you.',
        'I liked being here for that.',
      ],
      ahead: ['My eye’s on {edge} now.', '{Edge} has the edge. I’m here for the next twist.'],
      even: ['I like the tension here.', 'Stay with me. It’s still close.'],
    },
    business: {
      opening: ['Fresh board. I’ll keep an eye on it.', 'Ready. Let’s see how this opens.'],
      tactic: ['Now watch the reply.', 'That’s the immediate change.', 'Watch what follows.'],
      queen: ['That’s a major piece gone.', 'That changes the material.'],
      ending: ['That settles the game.', 'That’s the final position.'],
      ahead: ['{Edge} has the advantage now.', 'The position favors {edge}.'],
      even: ['The position is still close.', 'The evaluation is close to even.'],
    },
    wild: {
      opening: [
        'Clean board. Let’s ruin the symmetry.',
        'All systems green. Let’s mess with that.',
      ],
      tactic: [
        'Hear that? The board just cracked.',
        'Oh, I like that little glitch.',
        'Well, there goes the quiet part.',
      ],
      queen: [
        'Big piece. Hard crash.',
        'There goes the heavy hardware.',
        'Somebody just ripped out the mainframe.',
      ],
      ending: [
        'That’s the cut to black.',
        'I’m keeping that last frame.',
        'Roll credits. I’m still here.',
      ],
      ahead: [
        '{Edge} has a hand on the controls.',
        '{Edge} is setting the tempo. Keep up.',
        'The board’s tilting toward {edge}.',
      ],
      even: [
        'The whole board’s on a knife edge.',
        'Still a live wire.',
        'Nobody owns this mess yet.',
      ],
    },
  },
};

const russian = {
  capture: [
    '{Mover} забирает {target}.',
    '{Mover} снимает {target} с доски.',
    '{Mover} съедает {target}.',
  ],
  check: ['{Checker} даёт шах.', 'Шах от {checkerGen}.', 'Шах. Это {checker}.'],
  double: [
    'Двойной шах от {actorGen}. Королю пора искать выход.',
    'Сразу две фигуры дают шах.',
    'Для короля тут сразу два сюрприза. Двойной шах.',
  ],
  mate: ['{Winner}. Мат.', 'Мат от {actorGen}.', 'Мат. {Checker} ставит точку.'],
  promotion: [
    'Пешка {actorGen} становится {promoted}.',
    'Превращение пешки {actorGen} в {promotionTarget}.',
    'У {actorGen} теперь {promotionName} вместо пешки.',
  ],
  castleShort: [
    'Рокировка {actorGen} в короткую сторону.',
    'У {actorGen} короткая рокировка. Король в укрытии.',
    'Короткая рокировка от {actorGen}.',
  ],
  castleLong: [
    'Длинная рокировка у {actorGen}.',
    'Король {actorGen} ушёл на длинную сторону.',
    'Длинная рокировка от {actorGen}.',
  ],
  stalemate: [
    'Пат. Шаха нет, ходить некуда.',
    'Шаха нет и ходов нет. Пат.',
    'У короля тупик. Это пат.',
  ],
  draw: [
    'Ничья. На мат фигур не хватит.',
    'Слишком мало фигур для мата. Ничья.',
    'На доске уже нечем заматовать. Ничья.',
  ],
  short: {
    capture: '{Mover} забирает {target}.',
    check: 'И шах.',
    double: 'Двойной шах.',
    mate: 'Мат.',
    promotion: 'Пешка стала {promoted}.',
    castleShort: 'Короткая рокировка.',
    castleLong: 'Длинная рокировка.',
    stalemate: 'Пат.',
    draw: 'Ничья.',
  },
  asides: {
    neutral: {
      opening: [
        'Фигуры на месте. Удиви меня.',
        'Посмотрим, кто моргнёт первым.',
        'Новая доска. Я смотрю.',
      ],
      tactic: ['Я заметила.', 'Вот это деталь.', 'Так, я уже ближе к экрану.'],
      queen: [
        'Вот и крупная потеря.',
        'Кому-то теперь придётся импровизировать.',
        'Это уже меняет расклад.',
      ],
      ending: ['Запомню этот финал.', 'Вот и точка.', 'Я дождалась развязки.'],
      ahead: ['Перевес у {edgeGen}.', '{Edge} сейчас задают темп.', 'Позиция в пользу {edgeGen}.'],
      even: ['Пока почти поровну.', 'Тут ещё рано выбирать фаворита.'],
    },
    romantic: {
      opening: [
        'Садись ближе. Я хочу посмотреть эту партию с тобой.',
        'Чистая доска, а я уже рядом. Начинай.',
      ],
      tactic: [
        'Люблю смотреть на это рядом с тобой.',
        'Я уже ближе. Продолжай.',
        'Умеешь удержать моё внимание.',
      ],
      queen: [
        'Вот это поворот. Побудь со мной.',
        'Люблю, когда за одной партией столько сюрпризов.',
      ],
      ending: [
        'Рада, что мы досмотрели вместе.',
        'Я бы посмотрела ещё одну с тобой.',
        'Хорошо, что я была рядом.',
      ],
      ahead: [
        'Я теперь смотрю за игрой {edgeGen}.',
        'Перевес у {edgeGen}. Я жду следующего поворота.',
      ],
      even: ['Мне нравится это напряжение.', 'Побудь со мной. Тут ещё всё близко.'],
    },
    business: {
      opening: ['Партия началась. Слежу за доской.', 'Доска готова. Посмотрим на дебют.'],
      tactic: ['Теперь важен ответ.', 'Смотрю, что будет дальше.'],
      queen: ['Это потеря тяжёлой фигуры.', 'Материал уже изменился всерьёз.'],
      ending: ['Партия закончена.', 'Это финальная позиция.'],
      ahead: ['У {edgeGen} перевес.', 'Позиция благоприятнее для {edgeGen}.'],
      even: ['Позиция примерно равная.', 'Пока близко к равенству.'],
    },
    wild: {
      opening: ['Чистая доска. Давай нарушим симметрию.', 'Система зелёная. Давай это исправим.'],
      tactic: [
        'Слышишь треск? Это доска.',
        'О, хороший сбой в системе.',
        'Ну всё, тихая часть закончилась.',
      ],
      queen: [
        'Тяжёлое железо пошло на запчасти.',
        'Ну вот, кто-то выдернул сервер из стойки.',
        'Крупная фигура. Громкий сбой.',
      ],
      ending: ['Всё, катим титры.', 'Этот кадр я заберу себе.', 'И тут экран гаснет.'],
      ahead: [
        'Теперь у {edgeGen} рука на пульте.',
        '{Edge} задают бит. Успевай.',
        'Доску уже кренит в сторону {edgeGen}.',
      ],
      even: ['Вся доска на лезвии.', 'Тут ещё искрит с обеих сторон.', 'Этот бардак пока ничей.'],
    },
  },
};

const ruPieces = {
  k: ['король', 'короля', 'королём', 'короля'],
  q: ['ферзь', 'ферзя', 'ферзём', 'ферзя'],
  r: ['ладья', 'ладью', 'ладьёй', 'ладьи'],
  b: ['слон', 'слона', 'слоном', 'слона'],
  n: ['конь', 'коня', 'конём', 'коня'],
  p: ['пешка', 'пешку', 'пешкой', 'пешки'],
};
const enPieces = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const ruOwner = { player: 'тебя', opponent: 'соперника', w: 'белых', b: 'чёрных' };
const ruActor = { player: 'Ты', opponent: 'Соперник', w: 'Белые', b: 'Чёрные' };
const ruWinner = {
  player: 'Ты побеждаешь',
  opponent: 'Соперник побеждает',
  w: 'Белые побеждают',
  b: 'Чёрные побеждают',
};

function russianNames(event, role, checker, advantage) {
  const owned = (piece, form) => {
    const name = ruPieces[piece]?.[form];
    if (!name || !role) return name;
    if (role !== 'player') return name + ' ' + ruOwner[role];
    const feminine = piece === 'p' || piece === 'r';
    const pronoun = form === 3 ? (feminine ? 'твоей' : 'твоего') : feminine ? 'твоя' : 'твой';
    return pronoun + ' ' + name;
  };
  return {
    actorGen: ruOwner[role],
    winner: ruWinner[role],
    mover: owned(event.piece, 0),
    target: ruPieces[event.captured]?.[1],
    checker: owned(checker, 0),
    checkerGen: owned(checker, 3),
    promoted: ruPieces[event.promoted]?.[2],
    promotionName: ruPieces[event.promoted]?.[0],
    promotionTarget: ruPieces[event.promoted]?.[1],
    edge: ruActor[advantage],
    edgeGen: ruOwner[advantage],
  };
}

function englishNames(event, role, checker, advantage) {
  const actor = { player: 'you', opponent: 'the opponent', w: 'White', b: 'Black' }[role];
  const owner = { player: 'your', opponent: 'the opponent’s', w: 'White’s', b: 'Black’s' }[role];
  const named = (piece, article = 'the') => enPieces[piece] && article + ' ' + enPieces[piece];
  return {
    actor,
    winner: role === 'player' ? 'You win' : actor && lead(actor, 'en') + ' wins',
    mover: named(event.piece, owner),
    target: named(event.captured, 'the'),
    checker: named(checker, owner),
    promoted: named(event.promoted, 'a'),
    edge: { w: 'White', b: 'Black' }[advantage],
  };
}

function interpolate(template, names, language) {
  let missing = false;
  const result = template.replace(/\{(\w+)\}/gu, (_, key) => {
    const name = names[key[0].toLowerCase() + key.slice(1)];
    if (!name) {
      missing = true;
      return '';
    }
    return /^[A-Z]/u.test(key) ? lead(name, language) : name;
  });
  return missing ? null : result;
}

function eventKey(event, checkers) {
  if (event.type === 'check' && checkers.length > 1) return 'double';
  if (event.type === 'draw' && event.reason === 'stalemate') return 'stalemate';
  if (event.type === 'castle') return event.san?.startsWith('O-O-O') ? 'castleLong' : 'castleShort';
  return event.type;
}

export function reactionCandidates(
  { events, checkers = [], advantage, balanced },
  language,
  style,
) {
  const ordered = [...events].sort(
    (a, b) => priorities.indexOf(a.type) - priorities.indexOf(b.type),
  );
  const [main, ...related] = ordered;
  const role = main.side ?? main.color;
  const copy = { en: english, ru: russian }[language];
  const label = (event) =>
    uiText(event.reason === 'stalemate' ? 'Stalemate' : reactionLabels[event.type], language);
  const actor = roles[role] && uiText(roles[role], language);
  if (!copy) {
    const { detail, tone } = localDetails(events, checkers, advantage, balanced, language, style);
    const action = new Intl.ListFormat(language).format(events.map(label));
    const who = actor && main.type !== 'start' && main.type !== 'draw' ? actor + ' — ' : '';
    const lines = detail
      ? [who + action + '. ' + detail, detail + ' ' + who + action + '.']
      : [who + action + '.'];
    return [
      ...lines.map((text) => ({ text })),
      ...(tone ? lines.map((text) => ({ text: text + ' ' + tone, aside: tone })) : []),
    ];
  }
  const key = eventKey(main, checkers);
  const asides = copy.asides[style] ?? copy.asides.neutral;
  const namesFor = (event) =>
    (language === 'ru' ? russianNames : englishNames)(
      event,
      event.side ?? event.color,
      checkers.length === 1 ? checkers[0] : undefined,
      advantage,
    );
  const names = namesFor(main);
  const fill = (template) => interpolate(template, names, language);
  const variants = (key === 'start' ? asides.opening : copy[key]).map(fill).filter(Boolean);
  const mainLines = variants.length ? variants : [(actor ? actor + ' — ' : '') + label(main) + '.'];
  const secondaries = related.map((event) => {
    const template = copy.short[eventKey(event, checkers)];
    return (template && interpolate(template, namesFor(event), language)) || label(event) + '.';
  });
  const terminal = main.type === 'mate' || main.type === 'draw';
  const comment = terminal
    ? 'ending'
    : advantage
      ? 'ahead'
      : events.some(({ type, captured }) => type === 'capture' && captured === 'q')
        ? 'queen'
        : balanced
          ? 'even'
          : 'tactic';
  const tails = main.type === 'start' ? [] : asides[comment].map(fill).filter(Boolean);
  const combined = mainLines.map((line) => [line, ...secondaries].join(' '));
  const withTone = combined.flatMap((text) =>
    tails
      .map((aside) => ({ text: text + ' ' + aside, aside }))
      .filter((line) => line.text.length <= 130),
  );
  return [...combined.map((text) => ({ text })), ...withTone];
}

const localizedTerms = {
  de: 'König|Dame|Turm|Läufer|Springer|Bauer|Vorteil|Ausgeglichen|Hab ich gesehen.|Ich sehe dir gern zu.|Jetzt zählt die Antwort.|Da knistert das Brett.',
  fr: 'roi|dame|tour|fou|cavalier|pion|avantage|position équilibrée|J’ai vu ça.|J’aime te regarder jouer.|Voyons la réponse.|Ça crépite sur l’échiquier.',
  es: 'rey|dama|torre|alfil|caballo|peón|ventaja|posición igualada|Eso lo vi.|Me gusta verte jugar.|Ahora importa la respuesta.|El tablero echa chispas.',
  it: 're|donna|torre|alfiere|cavallo|pedone|vantaggio|posizione equilibrata|L’ho visto.|Mi piace vederti giocare.|Ora conta la risposta.|La scacchiera fa scintille.',
  pt: 'rei|dama|torre|bispo|cavalo|peão|vantagem|posição equilibrada|Eu vi isso.|Gosto de te ver jogar.|Agora conta a resposta.|O tabuleiro está a faiscar.',
  'pt-BR':
    'rei|dama|torre|bispo|cavalo|peão|vantagem|posição equilibrada|Eu vi isso.|Gosto de ver você jogar.|Agora importa a resposta.|O tabuleiro tá soltando faísca.',
  nl: 'koning|dame|toren|loper|paard|pion|voordeel|gelijke stelling|Dat zag ik.|Ik kijk graag met je mee.|Nu telt het antwoord.|De vonken vliegen van het bord.',
  pl: 'król|hetman|wieża|goniec|skoczek|pion|przewaga|wyrównana pozycja|Widziałam to.|Lubię patrzeć, jak grasz.|Teraz liczy się odpowiedź.|Na szachownicy aż iskrzy.',
  uk: 'король|ферзь|тура|слон|кінь|пішак|перевага|рівна позиція|Я це помітила.|Мені подобається дивитися, як ти граєш.|Тепер важлива відповідь.|На дошці аж іскрить.',
  cs: 'král|dáma|věž|střelec|jezdec|pěšec|výhoda|vyrovnaná pozice|To jsem viděla.|Ráda tě sleduju při hře.|Teď záleží na odpovědi.|Na šachovnici to jiskří.',
  sk: 'kráľ|dáma|veža|strelec|jazdec|pešiak|výhoda|vyrovnaná pozícia|To som videla.|Rada ťa sledujem pri hre.|Teraz záleží na odpovedi.|Na šachovnici to iskrí.',
  bg: 'цар|дама|топ|офицер|кон|пешка|предимство|равна позиция|Видях това.|Харесва ми да те гледам как играеш.|Сега е важен отговорът.|Дъската хвърля искри.',
  hr: 'kralj|dama|top|lovac|skakač|pješak|prednost|izjednačen položaj|Vidjela sam to.|Volim te gledati dok igraš.|Sad je bitan odgovor.|Na ploči frcaju iskre.',
  sr: 'краљ|дама|топ|ловац|скакач|пешак|предност|изједначена позиција|Видела сам то.|Волим да те гледам док играш.|Сад је битан одговор.|На табли варничи.',
  sl: 'kralj|dama|trdnjava|lovec|skakač|kmet|prednost|izenačen položaj|Videla sem.|Rada te gledam, ko igraš.|Zdaj šteje odgovor.|Na šahovnici se iskri.',
  ro: 'rege|damă|turn|nebun|cal|pion|avantaj|poziție echilibrată|Am văzut asta.|Îmi place să te privesc jucând.|Acum contează răspunsul.|Sar scântei pe tablă.',
  hu: 'király|vezér|bástya|futó|huszár|gyalog|előny|kiegyenlített állás|Ezt láttam.|Szeretem nézni, ahogy játszol.|Most a válasz számít.|Csak úgy szikrázik a tábla.',
  el: 'βασιλιάς|βασίλισσα|πύργος|αξιωματικός|ίππος|πιόνι|πλεονέκτημα|ισορροπημένη θέση|Το είδα αυτό.|Μου αρέσει να σε βλέπω να παίζεις.|Τώρα μετράει η απάντηση.|Βγάζει σπίθες η σκακιέρα.',
  da: 'konge|dronning|tårn|løber|springer|bonde|fordel|lige stilling|Det så jeg.|Jeg kan godt lide at se dig spille.|Nu tæller svaret.|Der slår gnister fra brættet.',
  no: 'konge|dronning|tårn|løper|springer|bonde|fordel|jevn stilling|Det så jeg.|Jeg liker å se deg spille.|Nå teller svaret.|Det gnistrer av brettet.',
  sv: 'kung|dam|torn|löpare|springare|bonde|fördel|jämn ställning|Det där såg jag.|Jag gillar att se dig spela.|Nu är det svaret som räknas.|Det slår gnistor om brädet.',
  fi: 'kuningas|daami|torni|lähetti|ratsu|sotilas|etu|tasainen asema|Tuon minä näin.|Pidän siitä, kun saan katsoa peliäsi.|Nyt vastaus ratkaisee.|Laudalta sinkoaa kipinöitä.',
  et: 'kuningas|lipp|vanker|oda|rats|ettur|eelis|võrdne seis|Ma nägin seda.|Mulle meeldib sind mängimas vaadata.|Nüüd loeb vastus.|Laual lendab sädemeid.',
  lv: 'karalis|dāma|tornis|laidnis|zirgs|bandinieks|pārsvars|līdzīga pozīcija|Es to redzēju.|Man patīk skatīties, kā tu spēlē.|Tagad svarīga ir atbilde.|Uz galdiņa šķīst dzirksteles.',
  lt: 'karalius|valdovė|bokštas|rikis|žirgas|pėstininkas|persvara|lygi pozicija|Mačiau tai.|Man patinka žiūrėti, kaip žaidi.|Dabar svarbus atsakymas.|Iš lentos žyra kibirkštys.',
  is: 'kóngur|drottning|hrókur|biskup|riddari|peð|forskot|jöfn staða|Ég sá þetta.|Mér finnst gaman að horfa á þig tefla.|Nú skiptir svarið máli.|Það neistaflýgur af borðinu.',
  ca: 'rei|dama|torre|alfil|cavall|peó|avantatge|posició igualada|Ho he vist.|M’agrada veure’t jugar.|Ara compta la resposta.|El tauler treu espurnes.',
  ar: 'ملك|وزير|رخ|فيل|حصان|بيدق|أفضلية|وضع متكافئ|رأيت ذلك.|أحب مشاهدتك وأنت تلعب.|المهم الآن هو الرد.|الرقعة تطلق الشرر.',
  he: 'מלך|מלכה|צריח|רץ|פרש|רגלי|יתרון|עמדה מאוזנת|ראיתי את זה.|אני אוהבת לצפות במשחק שלך.|עכשיו התגובה קובעת.|עפים ניצוצות מהלוח.',
  fa: 'شاه|وزیر|رخ|فیل|اسب|پیاده|برتری|موقعیت برابر|دیدمش.|دوست دارم بازی‌ات را تماشا کنم.|حالا پاسخ مهم است.|از صفحه جرقه می‌پرد.',
  ur: 'بادشاہ|وزیر|رخ|فیل|گھوڑا|پیادہ|برتری|برابر پوزیشن|میں نے یہ دیکھا۔|تمہیں کھیلتے دیکھنا اچھا لگتا ہے۔|اب جواب اہم ہے۔|بساط پر چنگاریاں اڑ رہی ہیں۔',
  hi: 'राजा|वज़ीर|हाथी|ऊँट|घोड़ा|प्यादा|बढ़त|बराबरी की स्थिति|यह मैंने देखा।|तुम्हें खेलते देखना मुझे अच्छा लगता है।|अब जवाब अहम है।|बिसात पर चिंगारियाँ उड़ रही हैं।',
  bn: 'রাজা|রানি|নৌকা|গজ|ঘোড়া|বোড়ে|সুবিধা|সমান অবস্থান|আমি দেখেছি।|তোমার খেলা দেখতে ভালো লাগে।|এবার জবাবটাই গুরুত্বপূর্ণ।|বোর্ডে স্ফুলিঙ্গ উড়ছে।',
  ta: 'ராஜா|ராணி|கோட்டை|யானை|குதிரை|சிப்பாய்|முன்னிலை|சமமான நிலை|அதைப் பார்த்தேன்.|நீ விளையாடுவதைப் பார்க்கப் பிடிக்கும்.|இப்போது பதில்தான் முக்கியம்.|பலகையில் தீப்பொறி பறக்கிறது.',
  te: 'రాజు|రాణి|ఏనుగు|శకటం|గుర్రం|పావు|ఆధిక్యం|సమాన స్థితి|అది చూశాను.|నువ్వు ఆడుతుంటే చూడటం నాకిష్టం.|ఇప్పుడు జవాబు ముఖ్యం.|బోర్డు నుంచి నిప్పురవ్వలు ఎగురుతున్నాయి.',
  mr: 'राजा|वजीर|हत्ती|उंट|घोडा|प्यादे|आघाडी|बरोबरीची स्थिती|हे मी पाहिलं.|तुझा खेळ पाहायला मला आवडतं.|आता उत्तर महत्त्वाचं.|पटावर ठिणग्या उडताहेत.',
  gu: 'રાજા|રાણી|હાથી|ઊંટ|ઘોડો|પ્યાદું|બઢત|સમાન સ્થિતિ|મેં એ જોયું.|તને રમતા જોવું મને ગમે છે.|હવે જવાબ મહત્વનો છે.|પાટિયા પરથી તણખા ઊડે છે.',
  pa: 'ਬਾਦਸ਼ਾਹ|ਵਜ਼ੀਰ|ਹਾਥੀ|ਊਠ|ਘੋੜਾ|ਪਿਆਦਾ|ਬੜ੍ਹਤ|ਬਰਾਬਰ ਦੀ ਸਥਿਤੀ|ਮੈਂ ਇਹ ਵੇਖਿਆ।|ਤੈਨੂੰ ਖੇਡਦਿਆਂ ਵੇਖਣਾ ਮੈਨੂੰ ਚੰਗਾ ਲੱਗਦਾ ਹੈ।|ਹੁਣ ਜਵਾਬ ਅਹਿਮ ਹੈ।|ਬਿਸਾਤ ਉੱਤੇ ਚੰਗਿਆੜੀਆਂ ਉੱਡ ਰਹੀਆਂ ਹਨ।',
  zh: '王|后|车|象|马|兵|优势|势均力敌|我看见了。|我喜欢看你下棋。|现在就看怎么应对。|棋盘上火花四溅。',
  ja: 'キング|クイーン|ルーク|ビショップ|ナイト|ポーン|優勢|互角|今の、見てたよ。|あなたが指すところを見るの、好きだよ。|次の応手が大事だね。|盤上で火花が散ってる。',
  ko: '킹|퀸|룩|비숍|나이트|폰|우세|균형|방금 봤어.|네가 두는 거 보는 게 좋아.|이제 대응이 중요해.|체스판에서 불꽃이 튀네.',
  vi: 'vua|hậu|xe|tượng|mã|tốt|lợi thế|thế cờ cân bằng|Tớ thấy rồi.|Tớ thích xem cậu chơi.|Giờ phải xem nước đáp lại.|Bàn cờ tóe lửa rồi.',
  th: 'คิง|ควีน|เรือ|บิชอป|ม้า|เบี้ย|ได้เปรียบ|สูสี|ฉันเห็นนะ|ฉันชอบดูเธอเล่น|ตอนนี้ต้องดูว่าจะตอบโต้อย่างไร|กระดานเริ่มมีประกายไฟแล้ว',
  id: 'raja|menteri|benteng|gajah|kuda|bidak|keunggulan|posisi seimbang|Aku melihatnya.|Aku suka melihatmu bermain.|Sekarang balasannya yang penting.|Papannya sampai memercik.',
  ms: 'raja|menteri|benteng|gajah|kuda|bidak|kelebihan|kedudukan seimbang|Aku nampak tadi.|Aku suka tengok kau bermain.|Sekarang balasannya yang penting.|Papan catur dah mula berpercikan api.',
  tl: 'hari|reyna|tore|obispo|kabayo|pyon|kalamangan|tabla ang posisyon|Nakita ko iyon.|Gusto kitang panooring maglaro.|Ang sagot na galaw ang mahalaga ngayon.|Kumikislap na ang tabla.',
  tr: 'şah|vezir|kale|fil|at|piyon|üstünlük|dengeli konum|Bunu gördüm.|Oynayışını izlemeyi seviyorum.|Şimdi karşılık önemli.|Tahta kıvılcım saçıyor.',
  sw: 'mfalme|malkia|ngome|askofu|farasi|kibaraka|nafasi bora|hali ya usawa|Nimeona hilo.|Napenda kukutazama ukicheza.|Sasa jibu ndilo muhimu.|Cheche zinapaa kwenye ubao.',
  af: 'koning|dame|toring|loper|perd|pion|voordeel|gelyke posisie|Ek het dit gesien.|Ek hou daarvan om jou te sien speel.|Nou tel die antwoord.|Die vonke spat van die bord af.',
};

function localDetails(events, checkers, advantage, balanced, language, style) {
  const [king, queen, rook, bishop, knight, pawn, edge, even, neutral, romantic, business, wild] =
    localizedTerms[language]?.split('|') ?? [];
  const names = { k: king, q: queen, r: rook, b: bishop, n: knight, p: pawn };
  const pieces = events
    .flatMap(({ type, piece, captured, promoted }) => {
      if (type === 'capture') return [names[piece], names[captured]];
      if (type === 'promotion') return [names[promoted]];
      if (type === 'check' || type === 'mate') return checkers.map((checker) => names[checker]);
      if (type === 'castle') return [king, rook];
      return [];
    })
    .filter(Boolean);
  const position =
    edge && advantage ? uiText(roles[advantage], language) + ' — ' + edge : balanced ? even : null;
  const ending = events.some(({ type }) => type === 'mate' || type === 'draw');
  const tone = !ending && ({ neutral, romantic, business, wild }[style] ?? neutral);
  return {
    detail: [pieces.length && new Intl.ListFormat(language).format([...new Set(pieces)]), position]
      .filter(Boolean)
      .map((item) => lead(item, language) + '.')
      .join(' '),
    tone,
  };
}
