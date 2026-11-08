import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { request, runtime, headers, settings } from '../../packages/runtime/src/index.mjs';
import { validateCommand } from './service.mjs';

export async function invokeSpotify(command, runtimeOptions) {
  const rt = runtime(runtimeOptions);
  const response = await request(rt.gatewayUrl + '/tools/invoke', {
    method: 'POST',
    headers: { ...headers(rt), 'x-openclaw-message-channel': 'webchat' },
    timeout: 35000,
    body: JSON.stringify({
      tool: 'spotify_control',
      args: validateCommand(command),
      sessionKey: settings.sessionKey,
    }),
  });
  const result = response.result?.details;
  if (!response.ok || !result)
    throw new Error('Spotify tool is unavailable. Run setup-spotify.cmd and start Capri.');
  if (!result.ok)
    throw Object.assign(new Error(result.error?.message ?? 'Spotify command failed.'), {
      code: result.error?.code,
    });
  return result.data;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action = 'status', ...args] = process.argv.slice(2);
    let command = { action };
    if (['play', 'search', 'queue_add'].includes(action)) command.query = args.join(' ');
    if (action === 'volume') command.value = Number(args[0]);
    if (action === 'seek') command.seconds = Number(args[0]);
    if (['mute', 'shuffle'].includes(action)) command.enabled = args[0] === 'on';
    if (action === 'repeat') command.mode = args[0];
    console.log(JSON.stringify(await invokeSpotify(command), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
