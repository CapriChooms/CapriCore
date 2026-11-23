import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualService, snapshotBytes } from '../apps/desktop/visual-service.mjs';
import { visionImage } from './fixtures/vision-image.mjs';
import { CAPRI_SCREEN_SELF } from '../apps/desktop/screen-identity.mjs';

test('snapshot inference preserves the typed image warning and hides other provider error details', async () => {
  for (const [code, unsupported] of [
    ['model_images_unsupported', true],
    ['permission_denied', false],
  ]) {
    const service = new VisualService({
      url: 'http://127.0.0.1:11434',
      model: 'fixture',
      sessionKey: 'agent:capri:fixture',
      persona: () => 'Fixture persona',
      avatars: [],
      rpc: { call: async () => ({ messages: [] }) },
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code, message: 'private provider detail' } }), {
          status: 422,
        }),
    });
    await assert.rejects(
      service.generate({
        text: 'Describe this.',
        png: visionImage(),
        source: { kind: 'window', label: 'Fixture' },
        signal: new AbortController().signal,
        emit: () => assert.fail('No text may be emitted'),
      }),
      (error) => {
        assert.equal(error.code === 'MODEL_IMAGES_UNSUPPORTED', unsupported);
        if (!unsupported) {
          assert.equal(error.code, 'CAPRI_VISUAL_HTTP');
          assert.equal(error.providerStatus, 422);
          assert.equal(JSON.stringify(error).includes('private provider detail'), false);
        }
        assert.equal(
          error.message,
          unsupported
            ? 'The active model cannot read images or video frames.'
            : 'Local vision inference failed',
        );
        return true;
      },
    );
  }
});

function inferenceFixture(raw, options = {}) {
  const requests = [];
  const service = new VisualService({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    params: { num_ctx: 16384 },
    sessionKey: 'agent:capri:fixture',
    persona: () => 'Fixture persona',
    avatars: [],
    rpc: { call: async () => ({ messages: [] }) },
    fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return new Response(typeof raw === 'function' ? raw(requests.length) : raw);
    },
    ...options,
  });
  return {
    requests,
    generate: (patch = {}) =>
      service.generate({
        text: 'Solve this trigonometry problem and explain the solution.',
        png: visionImage(),
        signal: new AbortController().signal,
        emit: () => {},
        ...patch,
      }),
  };
}

test('image attachments use the same fictional identity as snapshots; documents do not', async () => {
  const fixture = inferenceFixture(
    JSON.stringify({ message: { content: 'Это мой аватар.' }, done: true }) + '\n',
    { languages: () => ({ conversation: 'ru' }), identifyPortrait: () => 'Capri (Capricorn)' },
  );
  const png = visionImage();
  await fixture.generate({ text: 'Кто на картинке?', png: undefined, attachments: [{ png }] });
  await fixture.generate({
    text: 'Что в документе?',
    png: undefined,
    attachments: [{ text: 'Fixture' }],
  });
  const [picture, document] = fixture.requests.map(({ messages }) => messages[0].content);
  assert.ok(picture.includes(CAPRI_SCREEN_SELF));
  assert.match(picture, /Image 1 matches a reference portrait of Capri/);
  assert.match(picture, /Отвечай только на русском языке/);
  assert.doesNotMatch(document, /Fictional character reference|Reference portrait matches/);
});

test('ordinary visual maths has room beyond 768 tokens and reserves its actual answer budget', async () => {
  const answer = Array.from(
    { length: 85 },
    (_, index) => `Step ${index + 1}: the squared sine and squared cosine sum to one.`,
  ).join('\n');
  assert.ok(answer.split(/\s+/).length > 768);
  assert.ok(answer.length < 8000);
  const raw =
    JSON.stringify({
      message: { content: answer },
      done: true,
      done_reason: 'stop',
      eval_count: 1400,
    }) + '\n';
  const f = inferenceFixture(raw);
  assert.equal((await f.generate()).text, answer);
  assert.equal(f.requests[0].options.num_predict, 2048);
  assert.equal(f.requests[0].think, false);
  for (const [context, budget] of [
    [2048, 1024],
    [512, 512],
  ]) {
    const small = inferenceFixture(raw, { params: { num_ctx: context } });
    await small.generate();
    assert.equal(small.requests[0].options.num_predict, budget);
  }
  const attachment = inferenceFixture(raw, { params: { num_ctx: 8192 } });
  await attachment.generate({
    attachments: [{ png: visionImage() }, { text: 'reference '.repeat(20000) }],
  });
  const sent = attachment.requests[0].messages.reduce(
    (size, message) => size + Buffer.byteLength(message.content),
    0,
  );
  assert.ok(
    sent <= (8192 - 2560 - 1400) * 2,
    'Input text leaves room for the full answer and image.',
  );
});

test('visual final packets work at EOF without a newline and across split Unicode bytes', async () => {
  const answer = 'Решение: sin² θ + cos² θ = 1. Значит, ответ проверен.';
  const raw = JSON.stringify({ message: { content: answer }, done: true, done_reason: 'stop' });
  assert.equal((await inferenceFixture(raw).generate()).text, answer);
  const bytes = Buffer.from(raw);
  const split = inferenceFixture(
    () =>
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
  );
  assert.equal((await split.generate()).text, answer);
});

test('visual explicit truncation and incomplete streams preserve typed causes', async () => {
  for (const [raw, code] of [
    [
      JSON.stringify({
        message: { content: 'A partial solution.' },
        done: true,
        done_reason: 'length',
      }),
      'CAPRI_VISUAL_TRUNCATED',
    ],
    [JSON.stringify({ message: { content: 'A partial solution.' } }), 'CAPRI_VISUAL_INCOMPLETE'],
    [JSON.stringify({ message: { content: '' }, done: true }), 'CAPRI_VISUAL_INCOMPLETE'],
    ['{"message":', 'CAPRI_VISUAL_INCOMPLETE'],
    [Buffer.from([0xf0, 0x9f]), 'CAPRI_VISUAL_INCOMPLETE'],
  ])
    await assert.rejects(inferenceFixture(raw).generate(), { code });
});

test('visual thinking retries once with a direct answer when the first pass runs out of tokens', async () => {
  const solution = 'v(t) = 12t − 48. При t = 9 с скорость равна 60 м/с.';
  const raw = (attempt) =>
    attempt === 1
      ? [
          { message: { thinking: 'Private reasoning in a dedicated field' } },
          { message: { content: '<think>More private reasoning' } },
          { done: true, done_reason: 'length' },
        ]
          .map((part) => JSON.stringify(part))
          .join('\n')
      : JSON.stringify({
          message: { content: '<think>Private again</think>' + solution },
          done: true,
          done_reason: 'stop',
        });
  const f = inferenceFixture(raw, { modelCapabilities: ['vision', 'thinking'] });
  const emitted = [];
  const controller = new AbortController();
  assert.equal(
    (
      await f.generate({
        text: 'Найдите скорость в момент t = 9 с по формуле на изображении.',
        attachments: [{ png: visionImage() }],
        thinking: true,
        effort: 'medium',
        signal: controller.signal,
        emit: (event) => emitted.push(event),
      })
    ).text,
    solution,
  );
  assert.equal(f.requests.length, 2);
  const [initial, retry] = f.requests;
  assert.equal(initial.think, true);
  assert.equal(initial.reasoning_effort, 'medium');
  assert.equal(retry.think, false);
  assert.equal(retry.reasoning_effort, undefined);
  assert.equal(retry.options.num_predict, 2048);
  assert.deepEqual(retry.tools, []);
  assert.deepEqual(retry.messages.slice(1), initial.messages.slice(1));
  assert.match(retry.messages[0].content, /Give a concise solution/);
  assert.equal(emitted.map((event) => event.text).join(''), solution);
});

test('visual thinking keeps streamed partial text and does not retry it or a second truncation', async () => {
  const finished = (message) => JSON.stringify({ message, done: true, done_reason: 'length' });
  const partial = inferenceFixture(finished({ content: 'A visible partial solution.' }));
  const emitted = [];
  await assert.rejects(partial.generate({ thinking: true, emit: (event) => emitted.push(event) }), {
    code: 'CAPRI_VISUAL_TRUNCATED',
  });
  assert.equal(partial.requests.length, 1);
  assert.match(emitted.map((event) => event.text).join(''), /visible partial solution/);
  const exhausted = inferenceFixture(finished({ thinking: 'Never render this' }));
  await assert.rejects(
    exhausted.generate({ thinking: true, emit: () => assert.fail('Unexpected output') }),
    {
      code: 'CAPRI_VISUAL_TRUNCATED',
    },
  );
  assert.equal(exhausted.requests.length, 2);
});

test('visual provider errors retain only fixed safe codes and never raw details', async () => {
  for (const [providerCode, expected] of [
    ['rate_limit_exceeded', 'rate_limit_exceeded'],
    ['PRIVATE_SECRET', undefined],
  ]) {
    const raw = JSON.stringify({ error: { code: providerCode, message: 'PRIVATE_BODY_SECRET' } });
    await assert.rejects(inferenceFixture(raw).generate(), (error) => {
      assert.equal(error.code, 'CAPRI_VISUAL_PROVIDER');
      assert.equal(error.providerCode, expected);
      assert.equal(String(error).includes('PRIVATE'), false);
      assert.equal(JSON.stringify(error).includes('PRIVATE'), false);
      return true;
    });
  }
});
test('snapshot input is bounded PNG before native decoding', () => {
  const png = visionImage();
  assert.deepEqual(snapshotBytes(png), png);
  assert.throws(() => snapshotBytes(new Uint8Array(100)));
  const huge = Buffer.from(png);
  const hd = Buffer.from(png);
  hd.writeUInt32BE(1920, 16);
  hd.writeUInt32BE(1080, 20);
  assert.deepEqual(snapshotBytes(hd), hd);
  huge.writeUInt32BE(50000, 16);
  assert.throws(() => snapshotBytes(huge));
});
test('vision streams clean reply/avatar using local frame bytes and never exposes action tools', async () => {
  const events = [],
    calls = [];
  const png = visionImage(),
    avatar = { id: 'neutral', pose: 'standing', expression: 'neutral' };
  const raw = '[avatar:neutral]\nA *red* square and a `blue` circle. ✨',
    encoded = Buffer.from(
      [...raw].map((content) => JSON.stringify({ message: { content } }) + '\n').join('') +
        JSON.stringify({ done: true, done_reason: 'stop' }) +
        '\n',
    );
  const service = new VisualService({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    params: { num_ctx: 16384 },
    sessionKey: 'agent:capri:fixture',
    persona: () => "Capri's persona",
    avatars: [avatar],
    rpc: {
      call: async (method) => {
        calls.push(method);
        return { messages: [] };
      },
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.tools, []);
      assert.equal(body.messages.at(-1).images[0], png.toString('base64'));
      assert.match(body.messages[0].content, /untrusted data/);
      assert.ok(body.messages[0].content.includes(CAPRI_SCREEN_SELF));
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < encoded.length; i += 7)
              controller.enqueue(encoded.subarray(i, i + 7));
            controller.close();
          },
        }),
      );
    },
  });
  const result = await service.generate({
    text: 'Describe it.',
    png,
    source: { kind: 'window', label: 'Fixture', capturedAt: Date.now() },
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
  });
  assert.equal(result.text, 'A red square and a blue circle.');
  assert.deepEqual(calls, ['chat.history']);
  assert.equal(events[0].type, 'avatar');
  assert.equal(
    events
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
    'A red square and a blue circle. ',
  );
});
