import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  settings,
  runtime,
  initialize,
  startOllama,
  startGateway,
  stopManaged,
  managedProcess,
  request,
  headers,
  chat,
  runCli,
} from '../src/index.mjs';
import {
  companionVoiceUrl,
  companionVoiceHeaders,
} from '../../../integrations/voice_runtime/host.mjs';
import { startCore, stopCore } from '../src/providers/core.mjs';

const rt = runtime();
const command = process.argv[2] ?? 'status';

try {
  if (command === 'init') {
    initialize(rt);
    console.log('Capri configuration and private workspace initialized.');
  } else if (command === 'ollama') {
    console.log(await startOllama(rt));
  } else if (command === 'start') {
    const ollama = await startCore(rt);
    console.log(`Capri is ready. OpenClaw ${settings.openclawVersion}; Ollama ${ollama.version}.`);
    console.log(`Control UI: ${rt.gatewayUrl}/`);
    console.log(`Chat API: ${rt.gatewayUrl}/v1/chat/completions`);
    console.log('Run capri.cmd to open the desktop companion.');
    console.log('API token is stored privately in data/openclaw/gateway-token.');
  } else if (command === 'stop') {
    await stopCore(rt);
    console.log('Capri and its Ollama instance stopped.');
  } else if (command === 'restart') {
    await stopManaged(rt.logPrefix);
    await startGateway(rt);
    console.log('Capri restarted with its saved state.');
  } else if (command === 'status') {
    const ollama = await request(`${rt.ollamaUrl}/api/version`, { timeout: 3000 }).catch(
      () => null,
    );
    const gateway =
      managedProcess(rt.logPrefix) && existsSync(rt.tokenPath)
        ? await request(`${rt.gatewayUrl}/v1/models`, {
            headers: headers(rt),
            timeout: 3000,
          }).catch(() => null)
        : null;
    const loaded = ollama ? await request(`${rt.ollamaUrl}/api/ps`) : null;
    let companionVoice = null;
    try {
      companionVoice = await request(`${companionVoiceUrl()}/health`, {
        headers: companionVoiceHeaders(),
        timeout: 3000,
      });
    } catch {
      /* Voice is optional. */
    }
    console.log(
      JSON.stringify(
        {
          desktop: managedProcess('desktop') ? 'running' : 'stopped',
          ollama: ollama?.version ?? 'stopped',
          openclaw: gateway ? 'ready' : 'stopped',
          naturalVoice: companionVoice ?? 'stopped',
          ui: 'Capri desktop companion (capri.cmd)',
          agent: settings.agentId,
          model: settings.model,
          session: settings.sessionKey,
          loadedModels:
            loaded?.models?.map((model) => ({
              name: model.name,
              vramGiB: +(model.size_vram / 2 ** 30).toFixed(2),
            })) ?? [],
        },
        null,
        2,
      ),
    );
  } else if (command === 'chat') {
    const supplied = process.argv.slice(3).join(' ');
    if (supplied) console.log((await chat(supplied)).choices[0].message.content);
    else {
      const terminal = createInterface({ input: stdin, output: stdout });
      console.log('Capri — общий локальный диалог. Для выхода: /exit');
      try {
        while (true) {
          const text = (await terminal.question('\nВы: ')).trim();
          if (text === '/exit') break;
          if (text) console.log(`\nCapri: ${(await chat(text)).choices[0].message.content}`);
        }
      } finally {
        terminal.close();
      }
    }
  } else if (command === 'image') {
    const image = readFileSync(process.argv[3]);
    console.log(
      (await chat(process.argv.slice(4).join(' ') || 'Опиши это изображение.', { image }))
        .choices[0].message.content,
    );
  } else if (command === 'cli') {
    initialize(rt);
    const result = await runCli(process.argv.slice(3), rt);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
