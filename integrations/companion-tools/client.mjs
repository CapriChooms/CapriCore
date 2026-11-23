// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
export async function desktopAction(root, input, signal) {
  const file = path.join(root, 'data/secrets/desktop-actions.json');
  for (let p = file; p !== path.dirname(p); p = path.dirname(p))
    if (lstatSync(p).isSymbolicLink()) throw new Error('Linked desktop endpoint is unsupported');
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 4096) throw new Error('Open Capri to use desktop actions.');
  const endpoint = JSON.parse(readFileSync(file, 'utf8')),
    url = new URL(endpoint.url);
  if (
    endpoint.schemaVersion !== 1 ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(endpoint.token)
  )
    throw new Error('Invalid desktop endpoint');
  const response = await fetch(new URL('/action', url), {
    method: 'POST',
    redirect: 'error',
    headers: { authorization: 'Bearer ' + endpoint.token, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(input.tool === 'spotify_control' ? 75000 : 15000),
    ]),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(typeof value.error === 'string' ? value.error : 'Desktop action failed');
  return value;
}
