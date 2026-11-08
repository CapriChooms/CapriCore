// SPDX-License-Identifier: GPL-3.0-only
// Public synthetic questions only. No conversation, credentials or machine data.
export const reasoningCases = Object.freeze([
  {
    id: 'logic-en-single-truth',
    language: 'en',
    category: 'logic',
    kind: 'exact',
    expected: 'A',
    prompt:
      'Exactly one of A, B and C stole a key, and exactly one statement is true. A says: "B stole it." B says: "I did not steal it." C says: "A did not steal it." Who stole the key? Answer with A, B or C.',
    reference:
      'If A stole it, only B tells the truth; each other culprit gives two true statements.',
  },
  {
    id: 'logic-ru-card-rule',
    language: 'ru',
    category: 'logic',
    kind: 'set',
    expected: ['A', 'D'],
    prompt:
      'У каждой карточки с одной стороны число, с другой — цвет. Видны четыре карточки: A — 2, B — 3, C — красная, D — синяя. Нужно проверить правило: «Если число чётное, то обратная сторона красная». Какие карточки обязательно перевернуть, чтобы проверить правило? Укажи только буквы через запятую.',
    reference: 'Test the antecedent (A) and negated consequent (D), not the converse.',
  },
  {
    id: 'logic-es-weekday',
    language: 'es',
    category: 'logic',
    kind: 'number',
    expected: '2',
    prompt:
      'Hoy es lunes. ¿Qué día de la semana será exactamente 100 días después de hoy? Codifica lunes=0, martes=1, miércoles=2, jueves=3, viernes=4, sábado=5, domingo=6. Devuelve el número.',
    reference: '100 mod 7 = 2.',
  },
  {
    id: 'logic-fr-ages',
    language: 'fr',
    category: 'logic',
    kind: 'number',
    expected: '9',
    prompt:
      'Trois enfants ont des âges entiers strictement positifs. Le produit de leurs âges est 36 et leur somme est 13. Il y a un seul enfant le plus âgé. Quel est son âge ?',
    reference:
      'The age multisets are (1,6,6) and (2,2,9); only the latter has a unique oldest child.',
  },
  {
    id: 'logic-de-josephus',
    language: 'de',
    category: 'logic',
    kind: 'number',
    expected: '31',
    prompt:
      '41 Personen mit den Nummern 1 bis 41 stehen im Kreis. Ab Person 1 wird wiederholt bis drei gezählt; die dritte Person scheidet aus, und bei der nächsten wird wieder mit eins begonnen. Zuerst scheidet also Person 3 aus. Welche Nummer bleibt zuletzt übrig?',
    reference: 'Zero-based recurrence J(1)=0; J(n)=(J(n-1)+3) mod n. J(41)+1=31.',
  },
  {
    id: 'logic-ja-reversed-digits',
    language: 'ja',
    category: 'logic',
    kind: 'number',
    expected: '74',
    prompt:
      '2桁の正の整数があります。各桁の和は11です。元の整数から、十の位と一の位を入れ替えた整数を引くと27になります。元の整数はいくつですか。',
    reference: 'a+b=11 and 9(a-b)=27 give a=7, b=4.',
  },
  {
    id: 'math-en-power-modulo',
    language: 'en',
    category: 'mathematics',
    kind: 'number',
    expected: '49',
    prompt:
      'What is the remainder when 7^222 is divided by 100? Give the integer remainder from 0 to 99.',
    reference: '7^4 = 1 mod 100 and 222 = 2 mod 4.',
  },
  {
    id: 'math-ru-stars-bars',
    language: 'ru',
    category: 'mathematics',
    kind: 'number',
    expected: '253',
    prompt:
      'Сколько упорядоченных троек целых чисел (x,y,z) удовлетворяет x+y+z=30, x≥2, y≥3, z≥4?',
    reference: 'Shift by (2,3,4); the nonnegative sum is 21, giving C(23,2)=253.',
  },
  {
    id: 'math-es-telescoping',
    language: 'es',
    category: 'mathematics',
    kind: 'number',
    expected: '100/101',
    prompt:
      'Calcula exactamente la suma 1/(1·2)+1/(2·3)+1/(3·4)+...+1/(100·101). Devuelve una fracción irreducible.',
    reference: '1/[k(k+1)] = 1/k - 1/(k+1), so the sum is 1-1/101.',
  },
  {
    id: 'math-fr-root-powers',
    language: 'fr',
    category: 'mathematics',
    kind: 'number',
    expected: '2525',
    prompt:
      'Les nombres p et q sont les deux racines de x²−5x+1=0. Sans approximation décimale des racines, calcule p^5+q^5.',
    reference: 's0=2, s1=5, sn=5*s(n-1)-s(n-2): 23,110,527,2525.',
  },
  {
    id: 'math-de-incircle',
    language: 'de',
    category: 'mathematics',
    kind: 'number',
    expected: '4',
    prompt:
      'Ein Dreieck hat die Seitenlängen 13, 14 und 15. Wie groß ist der Radius seines Inkreises? Gib den exakten Zahlenwert an.',
    reference: 'Semiperimeter 21; Heron area sqrt(21*8*7*6)=84; r=84/21=4.',
  },
  {
    id: 'math-zh-conditional-dice',
    language: 'zh',
    category: 'mathematics',
    kind: 'number',
    expected: '5/11',
    prompt:
      '同时掷两枚公平的六面骰子。已知至少有一枚骰子的点数为6，求两枚骰子点数之和至少为10的条件概率。两枚骰子可以区分，请给出最简分数。',
    reference: 'The condition leaves 11 ordered outcomes; (4,6),(5,6),(6,6),(6,4),(6,5) qualify.',
  },
  {
    id: 'physics-en-friction-incline',
    language: 'en',
    category: 'physics',
    kind: 'number',
    expected: '5/2',
    prompt:
      'A block slides down a straight 30-degree incline. The kinetic friction coefficient is 1/(2√3). Take g=10 m/s² and neglect air resistance. What is the acceleration down the incline, in m/s²?',
    reference: 'a=g(sin30-mu*cos30)=10(1/2-1/4)=5/2.',
  },
  {
    id: 'physics-ru-circuit',
    language: 'ru',
    category: 'physics',
    kind: 'number',
    expected: '3',
    prompt:
      'Резисторы 6 Ом и 3 Ом соединены параллельно. Эта пара последовательно соединена с резистором 2 Ом и подключена к идеальному источнику напряжения 12 В. Какой ток в амперах течёт через источник?',
    reference: 'Parallel resistance 2 ohm; total resistance 4 ohm; I=12/4=3 A.',
  },
  {
    id: 'physics-es-inelastic-collision',
    language: 'es',
    category: 'physics',
    kind: 'number',
    expected: '1',
    prompt:
      'Dos carros chocan en una vía horizontal sin rozamiento y quedan unidos. El primero tiene masa 2 kg y velocidad +3 m/s; el segundo, masa 1 kg y velocidad −3 m/s. ¿Cuál es la velocidad final con signo, en m/s?',
    reference: 'Momentum conservation: (2*3+1*(-3))/(2+1)=1 m/s.',
  },
  {
    id: 'physics-fr-ice-mixture',
    language: 'fr',
    category: 'physics',
    kind: 'number',
    expected: '20/3',
    absoluteTolerance: 0.001,
    prompt:
      'Dans un récipient parfaitement isolé, on mélange 100 g de glace à 0 °C avec 200 g d’eau à 50 °C. La chaleur massique de l’eau est 4200 J/(kg·K) et la chaleur latente de fusion de la glace est 336000 J/kg. Le récipient a une capacité thermique négligeable. Quelle est la température finale en °C ? Donne une fraction exacte ou une valeur à 0,001 près, avec un point décimal.',
    reference: 'Available heat 42000 J, melting heat 33600 J; remaining 8400/(0.3*4200)=20/3 C.',
  },
  {
    id: 'physics-de-capacitor-energy',
    language: 'de',
    category: 'physics',
    kind: 'number',
    expected: '0.0000405',
    prompt:
      'Zwei identische ideale Kondensatoren haben jeweils 2 μF. Einer ist auf 9 V geladen, der andere ungeladen. Die Spannungsquelle ist abgetrennt. Die Kondensatoren werden parallel und gleichpolig über einen kleinen Widerstand verbunden. Wie viel Energie wird bis zum Spannungsausgleich im Widerstand in Wärme umgewandelt? Gib die Energie in Joule an.',
    reference: 'Charge sharing halves voltage and stored energy; lost energy is C*V²/4=40.5e-6 J.',
  },
  {
    id: 'physics-ja-horizontal-projectile',
    language: 'ja',
    category: 'physics',
    kind: 'number',
    expected: '30',
    prompt:
      '高さ20 mの崖の上から、小球を水平方向に15 m/sで投げます。重力加速度を10 m/s²とし、空気抵抗を無視します。小球が地面に着くまでの水平方向の移動距離は何mですか。',
    reference: 'Fall time sqrt(2h/g)=2 s; horizontal range 15*2=30 m.',
  },
]);

function rational(value) {
  const text = String(value).trim();
  if (text.length > 128) return null;
  const parts = text.split('/');
  if (parts.length === 2) {
    if (!/^[+-]?\d{1,80}$/.test(parts[0]) || !/^[+-]?\d{1,80}$/.test(parts[1])) return null;
    const numerator = BigInt(parts[0]),
      denominator = BigInt(parts[1]);
    return denominator === 0n ? null : [numerator, denominator];
  }
  const match = /^([+-]?)(\d{1,80})(?:\.(\d{0,80}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0) - fraction.length;
  if (Math.abs(exponent) > 160) return null;
  const numerator = BigInt((match[1] === '-' ? '-' : '') + match[2] + fraction);
  return exponent >= 0
    ? [numerator * 10n ** BigInt(exponent), 1n]
    : [numerator, 10n ** BigInt(-exponent)];
}

/** Grade only a small explicit answer; generated reasoning is never executed or persisted. */
export function gradeReasoningAnswer(caseValue, content) {
  if (typeof content !== 'string' || content.length > 4096)
    return { pass: false, failure: 'answer_format' };
  let answer;
  try {
    const value = JSON.parse(content);
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !Object.hasOwn(value, 'answer') ||
      !['string', 'number'].includes(typeof value.answer)
    )
      return { pass: false, failure: 'answer_format' };
    answer = String(value.answer).normalize('NFKC').trim();
  } catch {
    return { pass: false, failure: 'answer_format' };
  }
  if (caseValue.kind === 'number') {
    const actual = rational(answer),
      expected = rational(caseValue.expected);
    if (!actual || !expected) return { pass: false, failure: 'answer_format' };
    const exact = actual[0] * expected[1] === expected[0] * actual[1];
    const tolerance = caseValue.absoluteTolerance ?? 0;
    const approximate =
      tolerance > 0 &&
      Math.abs(Number(actual[0]) / Number(actual[1]) - Number(expected[0]) / Number(expected[1])) <=
        tolerance;
    return exact || approximate ? { pass: true } : { pass: false, failure: 'wrong_answer' };
  }
  if (caseValue.kind === 'set') {
    const letters = answer
      .toUpperCase()
      .split(/[,\s]+/u)
      .filter(Boolean);
    if (
      letters.some((letter) => !/^[A-Z]$/.test(letter)) ||
      new Set(letters).size !== letters.length
    )
      return { pass: false, failure: 'answer_format' };
    return [...letters].sort().join(',') === [...caseValue.expected].sort().join(',')
      ? { pass: true }
      : { pass: false, failure: 'wrong_answer' };
  }
  return answer.toUpperCase() === caseValue.expected
    ? { pass: true }
    : { pass: false, failure: 'wrong_answer' };
}
