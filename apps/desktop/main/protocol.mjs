// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
export const DESKTOP_CSP =
  "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; media-src blob:; connect-src capri://desktop/shared/languages.json capri://desktop/shared/interface-locales.json; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
export function resourceResponse(request, resources, { attachments } = {}) {
  const url = new URL(request.url);
  const trusted =
    url.protocol === 'capri:' &&
    url.hostname === 'desktop' &&
    request.method === 'GET' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    !url.port;
  const image =
    trusted && /^\/attachments\/([a-f0-9-]{36})\/(thumb|preview)\.png$/.exec(url.pathname);
  if (image) {
    const bytes = attachments?.read(image[1], image[2]);
    return bytes
      ? new Response(bytes, {
          headers: {
            'content-type': 'image/png',
            'content-security-policy': "default-src 'none'",
            'x-content-type-options': 'nosniff',
            'cross-origin-resource-policy': 'same-origin',
            'cache-control': 'no-store',
          },
        })
      : new Response('Not found', { status: 404 });
  }
  const entry = trusted ? resources.get(url.pathname) : null;
  if (!entry) return new Response('Not found', { status: 404 });
  try {
    return new Response(readFileSync(entry.file), {
      headers: {
        'content-type': entry.type,
        'content-security-policy':
          url.pathname === '/settings.html'
            ? DESKTOP_CSP.replace(
                'connect-src ',
                'connect-src capri://desktop/index.html capri://desktop/hall-of-fame.json ',
              )
            : DESKTOP_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error.code === 'ENOENT') return new Response('Not found', { status: 404 });
    throw error;
  }
}
