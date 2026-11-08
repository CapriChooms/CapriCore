// SPDX-License-Identifier: GPL-3.0-only
// Native omnibox observations, not a model's completion claim, establish navigation.
export const requiresFullscreen = (goal) =>
  /\bfull[ -]?screen\b|на\s+весь\s+экран|полноэкран/iu.test(
    String(goal).replace(
      /\b(?:do not|don't|never|without)\b[^.!?\n]{0,50}\bfull[ -]?screen\b|не\s+[^.!?\n]{0,40}(?:полноэкран[\p{L}]*|на\s+весь\s+экран)/giu,
      '',
    ),
  );
export function requiresPageSearch(goal) {
  const value = String(goal).replace(
    /\b(?:do not|don't|never|not|without)\b[^.!?\n]{0,60}\baddress\s+bar\b|не\s+[^.!?\n]{0,50}адресн[\p{L}]*\s+строк[\p{L}]*/giu,
    '',
  );
  return (
    /\bsearch\s+(?:bar|box|field)\b|(?:строк[\p{L}]*|пол[\p{L}]*)\s+поиска/iu.test(value) &&
    !/\baddress\s+bar\b|адресн[\p{L}]*\s+строк/iu.test(value)
  );
}

// A blocking dialog is actionable screen state, not a failed navigation. This
// only releases the loading wait; the planner still chooses and validates a
// current control. Nothing here accepts consent or bypasses a warning.
export function browserNavigationObstacle(view) {
  if (view.window?.modal === true) return 'modal';
  const controls = view.targets ?? [];
  const cookieChoice =
    /^(?:accept all|reject all|reject optional cookies|only necessary|necessary cookies only|i agree|принять все|отклонить все|только необходимые|tout accepter|tout refuser|alle akzeptieren|alle ablehnen|aceptar todo|rechazar todo|aceitar tudo|rejeitar tudo)$/iu;
  if (
    controls.some((target) => cookieChoice.test((target.untrustedLabel ?? '').trim())) &&
    controls.some((target) =>
      /cookie|cookies|consent|файл[\p{L}]* cookie|конфиденциальност/iu.test(
        target.untrustedLabel ?? '',
      ),
    )
  )
    return 'cookie_consent';
  return null;
}

export function browserNavigationState(view, navigation) {
  if (view.window?.windowId !== navigation.windowId) return 'window_changed';
  const address = view.targets?.find((t) => t.browserAddress);
  try {
    const requested = new URL(navigation.navigationUrl);
    const actual = new URL(
      /^[a-z]+:\/\//i.test(address?.untrustedValue ?? '')
        ? address.untrustedValue
        : 'https://' + address?.untrustedValue,
    );
    if (/^(?:www\.)?google\.com$/i.test(actual.hostname) && actual.pathname.startsWith('/sorry/'))
      return 'challenge';
    if (view.targets.some((t) => /^ERR_[A-Z_]+$/.test(t.untrustedLabel ?? ''))) return 'network';
    const netflix =
      requested.protocol === 'https:' &&
      /^(?:www\.)?netflix\.com$/i.test(requested.hostname) &&
      actual.protocol === 'https:' &&
      /^(?:www\.)?netflix\.com$/i.test(actual.hostname) &&
      actual.port === requested.port &&
      !address.focused;
    const netflixPath =
      actual.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//i, '/').replace(/\/$/, '') || '/';
    if (netflix && /^\/(?:login|signup)(?:\/|$)/i.test(netflixPath)) return 'sign_in';
    if (netflix && /^\/(?:profiles|ManageProfiles)(?:\/|$)/i.test(netflixPath)) return 'profile';
    const netflixTitle = /^\/title\/(\d+)$/.exec(requested.pathname)?.[1];
    const sameNetflixPage =
      netflix &&
      ((requested.pathname === '/' && !requested.search && netflixPath === '/browse') ||
        (netflixTitle &&
          (netflixPath === requested.pathname ||
            (netflixPath === '/browse' && actual.searchParams.get('jbv') === netflixTitle))));
    const officialSeriesPage =
      requested.hostname === 'www.cyberpunk.net' &&
      requested.pathname === '/en/edgerunners2' &&
      /^\/[a-z]{2}(?:-[a-z]{2})?\/edgerunners2\/?$/i.test(actual.pathname);
    if (
      actual.protocol === requested.protocol &&
      actual.port === requested.port &&
      actual.hostname.replace(/^www\./i, '') === requested.hostname.replace(/^www\./i, '') &&
      (actual.pathname === requested.pathname || sameNetflixPage || officialSeriesPage) &&
      [...requested.searchParams].every(([key, value]) => actual.searchParams.get(key) === value) &&
      !address.focused &&
      view.window.untrustedTitle &&
      !/^(?:https?:|new tab\b|новая вкладка(?:\s|$))/iu.test(view.window.untrustedTitle)
    )
      return 'ready';
  } catch {}
  return 'loading';
}

export function browserPageState(view) {
  const address = view.targets?.find((target) => target.browserAddress);
  try {
    const raw = address?.untrustedValue ?? '';
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw);
    const query = url.searchParams.get('q');
    if (
      !query ||
      browserSearchState(view, { windowId: view.window?.windowId, text: query }) !== 'ready'
    )
      return null;
    return {
      source: 'Current browser address and window title',
      query,
      results:
        url.searchParams.get('udm') === '2' || url.searchParams.get('tbm') === 'isch'
          ? 'images'
          : 'web',
      ...(/[?#&](?:imgrc|vhid|imgdii|vssid|sv)=/i.test(url.href) ? { imageViewer: true } : {}),
    };
  } catch {
    return null;
  }
}

export function browserSearchState(view, search) {
  if (view.window?.windowId !== search.windowId) return 'window_changed';
  const address = view.targets?.find((t) => t.browserAddress);
  let url;
  try {
    url = new URL(
      /^[a-z]+:\/\//i.test(address?.untrustedValue ?? '')
        ? address.untrustedValue
        : 'https://' + address?.untrustedValue,
    );
  } catch {
    return 'loading';
  }
  const google = /^(?:www\.)?google\.com$/i.test(url.hostname);
  if (google && url.pathname.startsWith('/sorry/')) return 'challenge';
  if (view.targets.some((t) => /^ERR_[A-Z_]+$/.test(t.untrustedLabel ?? ''))) return 'network';
  const normalize = (value) =>
    String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  const title = normalize(view.window.untrustedTitle);
  if (
    google &&
    url.pathname === '/search' &&
    normalize(url.searchParams.get('q')) === normalize(search.text) &&
    !address.focused &&
    !/^https?:/i.test(title) &&
    title.includes(normalize(search.text))
  )
    return 'ready';
  return 'loading';
}
