// SPDX-License-Identifier: GPL-3.0-only
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] ?? '../assets/capri/media/face-expressions-redraw');
mkdirSync(target, { recursive: true });
const app = 'apps/desktop/renderer/';
const source = (file) => readFileSync(app + file, 'utf8').replace(/^export /gm, '');
const image = (layer) =>
  'data:image/png;base64,' +
  readFileSync('assets/default/capri-blink-' + layer + '.png').toString('base64');
const clips = {
  blink: 'Моргание и улыбка',
  speech: 'Речь',
  wink: 'Подмигивание',
  gaze: 'Осмотр по сторонам',
  surprise: 'Удивление',
  laugh: 'Смех',
  excited: 'Восторг',
  sleepy: 'Сонливость',
};
const frames = {
  neutral: 'Нейтральная',
  annoyed: 'Раздражённая',
  attentive: 'Внимательная',
  'idle-blink_closed': 'Моргание, глаза закрыты',
  'idle-blink_half': 'Моргание, глаза прикрыты',
  concerned: 'Обеспокоенная',
  embarrassed: 'Смущённая',
  'idle-excited': 'В восторге',
  flirty: 'Кокетливая',
  focused: 'Сосредоточенная',
  happy: 'Радостная',
  'idle-laughing': 'Смеётся',
  'idle-look_down': 'Смотрит вниз',
  'idle-look_left': 'Смотрит влево',
  'idle-look_right': 'Смотрит вправо',
  'idle-look_up': 'Смотрит вверх',
  'idle-mouth_round': 'Речь, круглый рот',
  'idle-mouth_small': 'Речь, рот приоткрыт',
  'idle-mouth_wide': 'Речь, широкий рот',
  sad: 'Грустная',
  skeptical: 'Скептическая',
  sleepy: 'Сонная',
  smirk: 'Игривая',
  'idle-surprised_closed': 'Удивление, глаза закрыты',
  surprised: 'Удивлённая',
  thinking: 'Задумчивая',
  'idle-wink_closed': 'Подмигивание, глаз закрыт',
  'idle-wink_half': 'Подмигивание, глаз прикрыт',
};
const panels = [
  ['pose', '1. Поза и зелёное лицо'],
  ['eyes', '2. Глаза и глазницы'],
  ['lids', '3. Веки'],
  ['mask', 'Маска глаз'],
  ['mouth', '4. Белый рот'],
  ['composite', 'Собранный кадр'],
];
const options = (items, prefix) =>
  Object.entries(items)
    .map(([id, label]) => '<option value="' + prefix + id + '">' + label + '</option>')
    .join('');
const cards = panels
  .map(
    ([id, label]) =>
      '<section><h2>' +
      (id === 'composite'
        ? label
        : '<label><input type="checkbox" data-layer="' + id + '" checked> ' + label + '</label>') +
      '</h2><canvas id="' +
      id +
      '" width="740" height="564" aria-label="' +
      label +
      '"></canvas></section>',
  )
  .join('');
const html = `<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CapriCore · Мимика</title>
<style>
  :root{color-scheme:dark;background:#0c151b;color:#e2faf5;font:16px system-ui,sans-serif}
  body{max-width:1200px;margin:24px auto;padding:0 20px}
  h1{font-size:1.65rem;margin:0 0 18px;color:#99f9e9}
  button,select{border:1px solid #529994;background:#173037;color:inherit;padding:8px 10px;font:inherit}
  button,select,input{cursor:pointer} input{accent-color:#89eadf}
  a{color:#a1f4e8} button:disabled{opacity:.48;cursor:default}
  .controls{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center}
  .timeline{display:flex;align-items:center;gap:10px;margin:15px 0 10px}
  .timeline input{flex:1;min-width:100px} output{font-size:.875rem;white-space:nowrap;font-variant-numeric:tabular-nums}
  main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  section{border:1px solid #2f6b6c;background:#111f27;min-width:0}
  section:last-child{border-color:#86ecde}
  h2{font-size:.94rem;margin:0;padding:10px 12px;font-weight:600}
  canvas{display:block;width:100%;height:auto;background:repeating-conic-gradient(#1e2d34 0% 25%,#34444a 0% 50%) 0 0 / 24px 24px}
  p{margin:0 0 14px;color:#b6cfd1;font-size:.9rem}
  select{max-width:100%}
  @media(max-width:760px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:490px){main{grid-template-columns:1fr}.controls{gap:10px}body{padding:0 12px}}
</style>
<body>
<h1>CapriCore · Мимика</h1>
<div class="controls">
  <select id="selection" aria-label="Анимация или выражение">
    <optgroup label="Анимации">${options(clips, 'clip:')}</optgroup>
    <optgroup label="Лицевые кадры">${options(frames, 'frame:')}</optgroup>
  </select>
  <button id="play" type="button" aria-pressed="false">Воспроизвести</button>
  <label><input id="full" type="checkbox"> В полный рост</label>
  <a id="download" download>Скачать WebP</a>
</div>
<div class="timeline"><label for="time">Время</label><input id="time" type="range" min="0" step="1"><output id="at"></output></div>
<p>Галочки управляют собранным кадром. Чёрные области на маске показывают, где скрывается слой глаз.</p>
<main>${cards}</main>
<script type="module">
${source('avatar-layered-blink.mjs')}
const {faceAnimations, faceFrames} = (() => {
${source('avatar-face-expressions.mjs').replace(/^import [^\n]+\n/m, '')}
return {faceAnimations, faceFrames};
})();
const load = async (url) => { const img = new Image(); img.src = url; await img.decode(); return img; };
const draw = prepareLayeredBlink(...await Promise.all([load(${JSON.stringify(image('pose'))}), load(${JSON.stringify(image('eyes'))})]));
const contexts = [...document.querySelectorAll('canvas')].map(canvas => [canvas.id, canvas.getContext('2d')]);
const toggles = Object.fromEntries([...document.querySelectorAll('[data-layer]')].map(input => [input.dataset.layer, input]));
const selection = document.querySelector('#selection');
const time = document.querySelector('#time');
const at = document.querySelector('#at');
const play = document.querySelector('#play');
const full = document.querySelector('#full');
const download = document.querySelector('#download');
let playback = null;

function paint(state) {
  for (const [name, ctx] of contexts) {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    if (full.checked) {
      ctx.translate((width - height) / 2, 0);
      ctx.scale(height / size, height / size);
    } else {
      ctx.scale(width / 185, height / 141);
      ctx.translate(-551, -318);
    }
    if (name === 'composite') {
      for (const part of ['pose', 'eyes', 'lids', 'mouth']) {
        if (!toggles[part].checked) continue;
        draw(ctx, size, state, part === 'eyes' && !toggles.mask.checked ? 'eye-art' : part);
      }
    } else draw(ctx, size, state, name === 'eyes' ? 'eye-art' : name);
    ctx.restore();
  }
}

const selected = () => selection.value.split(':')[1];
const motion = () => selection.value.startsWith('clip:') ? faceAnimations[selected()] : null;
const seconds = ms => (ms / 1000).toFixed(2).replace('.', ',') + ' с';
function show(ms) {
  const clip = motion();
  at.value = clip ? seconds(ms) + ' / ' + seconds(clip.duration) : 'Кадр';
  paint(clip ? clip.sample(ms) : faceFrames[selected()]);
}

function stop() {
  if (playback !== null) cancelAnimationFrame(playback);
  playback = null;
  play.textContent = 'Воспроизвести';
  play.setAttribute('aria-pressed', 'false');
}

function choose(ms = 0) {
  stop();
  const clip = motion();
  time.disabled = play.disabled = !clip;
  time.max = clip?.duration ?? 0;
  time.value = ms;
  download.hidden = !clip;
  if (clip) download.href = 'animation/' + selected() + '.webp';
  show(ms);
}

selection.onchange = () => choose();
time.oninput = () => { stop(); show(Number(time.value)); };
full.onchange = () => show(Number(time.value));
Object.values(toggles).forEach(input => input.onchange = full.onchange);
play.onclick = () => {
  if (playback !== null) { stop(); return; }
  const start = performance.now() - (Number(time.value) % motion().duration);
  play.setAttribute('aria-pressed', 'true');
  play.textContent = 'Пауза';
  const tick = now => {
    const ms = Math.floor((now - start) % motion().duration);
    time.value = ms;
    show(ms);
    playback = requestAnimationFrame(tick);
  };
  playback = requestAnimationFrame(tick);
};
choose(535);
document.body.dataset.ready = 'true';
</script>
</body></html>`;
writeFileSync(path.join(target, 'index.html'), html);
