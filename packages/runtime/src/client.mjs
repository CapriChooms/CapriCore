import { spawn } from 'node:child_process';
import { root } from './host/paths.mjs';
import { nodePath, openclawPath } from './host/executables.mjs';
import { environment } from './host/environment.mjs';
import { settings } from './config/settings.mjs';
import { runtime, headers, personaPrompt } from './context.mjs';
import { request } from './http.mjs';
import { plainDialogueText } from './text.mjs';

export async function chat(
  text,
  { rt = runtime(), sessionKey = settings.sessionKey, channel = 'webchat', image } = {},
) {
  const mime = image?.[0] === 0xff && image?.[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  const content = image
    ? [
        { type: 'text', text },
        {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${image.toString('base64')}` },
        },
      ]
    : text;
  const response = await request(`${rt.gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    timeout: 240000,
    headers: {
      ...headers(rt),
      'x-openclaw-session-key': sessionKey,
      'x-openclaw-message-channel': channel,
    },
    body: JSON.stringify({
      model: `openclaw/${settings.agentId}`,
      stream: false,
      messages: [
        { role: 'system', content: personaPrompt(rt) },
        { role: 'user', content },
      ],
    }),
  });
  for (const choice of response.choices ?? [])
    if (typeof choice.message?.content === 'string')
      choice.message.content = plainDialogueText(choice.message.content).trim();
  return response;
}
export function runCli(args, rt = runtime(), { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [openclawPath, ...args], {
      cwd: root,
      env: environment(rt),
      windowsHide: true,
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      overflow = false;
    const receive = (text, chunk) => {
      if (text.length + chunk.length > 8 * 1024 * 1024) {
        overflow = true;
        child.kill();
        return text;
      }
      return text + chunk;
    };
    child.stdout.on('data', (chunk) => {
      stdout = receive(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = receive(stderr, chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 && !overflow
        ? resolve({ stdout, stderr })
        : reject(
            new Error(
              overflow
                ? 'OpenClaw output exceeded limit'
                : `OpenClaw ${args[0]} exited ${code}: ${stderr.slice(-3000)}`,
            ),
          ),
    );
  });
}
