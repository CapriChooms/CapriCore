import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  root,
  settings,
  runtime,
  initialize,
  startOllama,
  startGateway,
  stopManaged,
  request,
  headers,
  chat,
} from '../../packages/runtime/src/index.mjs';

// Exercise the real Gateway, model and memory in a separate state directory.
// No test facts or simulated Telegram messages enter the owner's real memory.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const folder = path.join(root, '.runtime/verification', stamp);
const rt = runtime({
  stateDir: path.join(folder, 'state'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: 18790,
  logPrefix: 'verification',
});
const report = {
  timestamp: new Date().toISOString(),
  versions: { openclaw: settings.openclawVersion, model: settings.model },
  checks: [],
};
const record = (name, detail = {}) => {
  report.checks.push({ name, passed: true, ...detail });
  console.log(`PASS ${name}`);
};

function pngFixture() {
  const width = 320,
    height = 180;
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      let color = [255, 255, 255];
      if (x >= 30 && x < 130 && y >= 40 && y < 140) color = [240, 0, 0];
      if ((x - 240) ** 2 + (y - 90) ** 2 <= 50 ** 2) color = [0, 60, 240];
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      raw.set(color, offset);
    }
  }
  function chunk(type, data) {
    const name = Buffer.from(type),
      body = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, sum]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function memoryText(folderPath) {
  return readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => readFileSync(path.join(folderPath, entry.name), 'utf8'))
    .join('\n');
}

async function ask(text, options = {}) {
  const start = Date.now();
  const response = await chat(text, { rt, ...options });
  const answer = response.choices?.[0]?.message?.content;
  assert.equal(typeof answer, 'string');
  assert.ok(answer.trim(), 'Assistant returned an empty answer');
  return {
    answer,
    elapsedSeconds: +((Date.now() - start) / 1000).toFixed(2),
    usage: response.usage,
  };
}

try {
  initialize(rt);
  await startOllama(rt);
  await startGateway(rt);
  const unauthenticated = await fetch(`${rt.gatewayUrl}/v1/models`);
  assert.equal(unauthenticated.status, 401);
  record('API requires authentication');

  const code = `capri-${randomBytes(4).toString('hex')}`;
  const first = await ask(
    `Это техническая проверка контекста. Код тестового объекта: ${code}. Ответь кратко, что приняла код. Ничего не сохраняй в файлы.`,
    { channel: 'webchat' },
  );
  assert.match(first.answer, /[А-Яа-яЁё]/);
  record('Local Russian text reply', first);
  const continuity = await ask(
    'Назови код тестового объекта из предыдущего сообщения. Ответь только кодом.',
    { channel: 'telegram' },
  );
  assert.ok(continuity.answer.includes(code), `Cross-interface context lost: ${continuity.answer}`);
  record('Shared desktop/Telegram API context', continuity);

  await stopManaged(rt.logPrefix);
  await startGateway(rt);
  const restored = await ask(
    'Повтори код тестового объекта из нашего разговора. Ответь только кодом.',
  );
  assert.ok(
    restored.answer.includes(code),
    `Session did not survive Gateway restart: ${restored.answer}`,
  );
  record('Conversation survives Gateway restart', restored);

  const durable = `PROJECT-${randomBytes(4).toString('hex').toUpperCase()}`;
  const saved = await ask(
    `Запомни долговременный факт: название моего тестового проекта — ${durable}. Сейчас обязательно используй инструмент write или edit, чтобы записать этот факт в MEMORY.md. Это разрешённая запись в твою память. Затем кратко подтверди сохранение.`,
  );
  assert.ok(
    (memoryText(rt.workspace) + memoryText(path.join(rt.workspace, 'memory'))).includes(durable),
    'Assistant claimed memory without writing it',
  );
  record('Assistant writes durable memory through real file tool', saved);

  await stopManaged(rt.logPrefix);
  await startGateway(rt);
  const recalled = await ask(
    'Как называется мой тестовый проект? Найди сохранённое название в долговременной памяти.',
    { sessionKey: `agent:capri:verification-fresh-${stamp}` },
  );
  assert.ok(
    recalled.answer.includes(durable),
    `Fresh session did not recall durable memory: ${recalled.answer}`,
  );
  record('Fresh session recalls durable memory after restart', recalled);

  const image = pngFixture();
  writeFileSync(path.join(folder, 'vision-fixture.png'), image);
  const vision = await ask(
    'Назови цвета и формы двух фигур на изображении, слева направо. Ответь кратко по-русски.',
    { image, sessionKey: `agent:capri:verification-image-${stamp}` },
  );
  assert.match(vision.answer, /красн/i);
  assert.match(vision.answer, /син/i);
  assert.match(vision.answer, /квадрат/i);
  assert.match(vision.answer, /круг|окружност/i);
  record('Image reaches Qwen and is understood correctly', vision);

  const search = await request(`${rt.gatewayUrl}/tools/invoke`, {
    method: 'POST',
    headers: headers(rt),
    timeout: 120000,
    body: JSON.stringify({
      tool: 'memory_search',
      args: { query: durable, maxResults: 3 },
      sessionKey: settings.sessionKey,
    }),
  });
  assert.ok(
    JSON.stringify(search).includes(durable),
    'Memory search did not return the stored fact',
  );
  record('Local indexed memory search finds the saved fact');
  report.loadedModels = (await request(`${rt.ollamaUrl}/api/ps`)).models.map((model) => ({
    name: model.name,
    sizeVramBytes: model.size_vram,
    contextLength: model.context_length,
  }));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopManaged(rt.logPrefix).catch((error) =>
    console.error(`Verification cleanup: ${error.message}`),
  );
  mkdirSync(path.join(root, 'logs'), { recursive: true });
  writeFileSync(
    path.join(root, 'logs/verification-latest.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
