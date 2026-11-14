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

export function observedBrowserAddress(view) {
  const fields = (view.targets ?? []).filter((target) => target.browserAddress);
  const omnibox = fields.find((target) => !target.browserDocumentAddress);
  // A focused address draft takes precedence over any loaded document. When
  // Chromium exposes multiple documents, prefer the active window title and
  // reject different URLs among documents that share that title.
  if (omnibox) return omnibox;
  const title = view.window?.untrustedTitle?.trim() ?? '';
  const matching = fields.filter((target) => {
    const label = target.untrustedLabel?.trim();
    return (
      label &&
      (title === label || title.startsWith(label + ' - ') || title.startsWith(label + ' — '))
    );
  });
  const current = matching.length ? matching : fields;
  return current.length &&
    current.every((target) => target.untrustedValue === current[0].untrustedValue)
    ? current[0]
    : null;
}

export function browserNavigationState(view, navigation) {
  if (
    navigation.allowUnboundNavigation &&
    navigation.browserExecutable &&
    view.window?.browserExecutable !== navigation.browserExecutable
  )
    return 'loading';
  if (view.window?.windowId !== navigation.windowId && !navigation.allowUnboundNavigation)
    return 'window_changed';
  const address = observedBrowserAddress(view);
  try {
    const requested = new URL(navigation.navigationUrl);
    const actual = new URL(
      /^[a-z]+:\/\//i.test(address?.untrustedValue ?? '')
        ? address.untrustedValue
        : 'https://' + address?.untrustedValue,
    );
    if (/^(?:www\.)?google\.com$/i.test(actual.hostname) && actual.pathname.startsWith('/sorry/'))
      return 'challenge';
    if ((view.targets ?? []).some((t) => /^ERR_[A-Z_]+$/.test(t.untrustedLabel ?? '')))
      return 'network';
    const document =
      address.focused &&
      observedBrowserAddress({
        ...view,
        targets: (view.targets ?? []).filter((target) => target.browserDocumentAddress),
      });
    const loaded =
      !address.focused ||
      (document?.untrustedValue &&
        new URL(
          /^[a-z]+:\/\//iu.test(document.untrustedValue)
            ? document.untrustedValue
            : 'https://' + document.untrustedValue,
        ).href === actual.href);
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
      loaded &&
      view.window.untrustedTitle &&
      !/^(?:https?:|new tab\b|новая вкладка(?:\s|$))/iu.test(view.window.untrustedTitle)
    )
      return 'ready';
  } catch {}
  return 'loading';
}

export function browserPageState(view) {
  const address = observedBrowserAddress(view);
  try {
    const raw = address?.untrustedValue ?? '';
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw);
    const site = /^(?:www\.)?youtube\.com$/i.test(url.hostname) ? 'youtube' : 'google';
    const query = url.searchParams.get(site === 'youtube' ? 'search_query' : 'q');
    if (
      !query ||
      browserSearchState(view, { windowId: view.window?.windowId, text: query, site }) !== 'ready'
    )
      return null;
    return {
      source: 'Current browser address and window title',
      query,
      ...(site === 'youtube' ? { site: 'youtube' } : {}),
      results:
        site === 'youtube'
          ? 'video'
          : url.searchParams.get('udm') === '2' || url.searchParams.get('tbm') === 'isch'
            ? 'images'
            : 'web',
      ...(/[?#&](?:imgrc|vhid|imgdii|vssid|sv)=/i.test(url.href) ? { imageViewer: true } : {}),
    };
  } catch {
    return null;
  }
}

export function browserSearchState(view, search) {
  if (
    search.allowUnboundNavigation &&
    search.browserExecutable &&
    view.window?.browserExecutable !== search.browserExecutable
  )
    return 'loading';
  if (view.window?.windowId !== search.windowId && !search.allowUnboundNavigation)
    return 'window_changed';
  const address = observedBrowserAddress(view);
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
  const youtube = /^(?:www\.)?youtube\.com$/i.test(url.hostname);
  if (google && url.pathname.startsWith('/sorry/')) return 'challenge';
  if (view.targets.some((t) => /^ERR_[A-Z_]+$/.test(t.untrustedLabel ?? ''))) return 'network';
  const normalize = (value) =>
    String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
  const title = normalize(view.window.untrustedTitle);
  if (search.site === 'youtube') {
    if (
      !youtube ||
      url.pathname !== '/results' ||
      normalize(url.searchParams.get('search_query')) !== normalize(search.text) ||
      address.focused ||
      !/youtube/i.test(title) ||
      /^https?:/i.test(title)
    )
      return 'loading';
    const filters = view.targets.some(
      (target) =>
        /^(?:filters?|search filters?|фильтры|фильтр поиска|filtres?|filter|filtros?)$/iu.test(
          (target.untrustedLabel ?? '').trim(),
        ) && !target.editable,
    );
    return title.includes(normalize(search.text)) || filters ? 'ready' : 'loading';
  }
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

export const browserSearchUrl = (text, site = 'google') =>
  (site === 'youtube'
    ? 'https://www.youtube.com/results?search_query='
    : 'https://www.google.com/search?q=') + encodeURIComponent(text.trim());

/** An exact owner-supplied URL needs no model-generated tab or keyboard input. */
export function explicitBrowserDestination(goal) {
  const match =
    /^(?:please\s+)?(?:open|launch|start)\s+(Google Chrome|Chrome|Microsoft Edge|Edge|Firefox|Brave|Vivaldi|Opera)\s*,?\s*(?:and\s+(?:then\s+)?|then\s+)(?:go\s+to|open|navigate\s+to|visit)\s+(?:"(https?:\/\/[^"\s]+)"|(https?:\/\/[^\s"<>]+?))\s*(?:[.!?](?=\s|$)|$)([\s\S]*)$/iu.exec(
      String(goal).trim(),
    );
  if (!match) return null;
  const suffix = match[4].trim();
  if (
    suffix &&
    !/^leave\s+(?:this|the)\s+(?:tab|page|video)\s+open[.;]?\s*(?:do\s+not\s+sign\s+in\s+or\s+change\s+any\s+settings[.!]?)?$/iu.test(
      suffix,
    )
  )
    return null;
  try {
    const url = new URL(match[2] ?? match[3]);
    if (
      url.href.length > 2048 ||
      url.username ||
      url.password ||
      url.hash ||
      !['http:', 'https:'].includes(url.protocol)
    )
      return null;
    return { browser: match[1], url: url.href };
  } catch {
    return null;
  }
}

/** Only an explicit, literal YouTube search. Do not infer a site from page content. */
export function quotedYouTubeSearch(goal) {
  if (
    requiresPageSearch(goal) ||
    /\b(?:do not|don't|never)\s+(?:search|open|visit|use)\b[^.!?;]{0,50}\byoutube\b|не\s+(?:открывай|ищи|используй)\s+(?:ютуб|youtube)/iu.test(
      goal,
    )
  )
    return null;
  const match =
    /(?:\b(?:go\s+to|visit|open)\s+(?:www\.)?youtube\b|(?:открой|перейди\s+на)\s+(?:ютуб|youtube))\s*[,;:]?\s*(?:(?:and|then|и|затем)\s+)?(?:search\s+for|find|найди|поищи)\s+["“«]([^"”»\r\n]{1,200})["”»]/iu.exec(
      goal,
    );
  return match?.[1]?.trim() || null;
}

const videoTitleKey = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// Keep the exact title separate from the search keywords. A watch page for a
// related music video, anniversary trailer or recommendation is not proof.
export function youtubeWatchRequirement(goal) {
  const query = quotedYouTubeSearch(goal);
  if (!query) return null;
  const suffix = goal.slice(goal.indexOf(query) + query.length + 1);
  const followUp = /^(?:"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|[^.!?\n"“«])*/u.exec(suffix)?.[0] ?? '';
  if (
    /\b(?:do not|don['’]t|never)\s+(?:open|play|watch|click)\b|не\s+(?:открывай|включай|смотри)/iu.test(
      followUp,
    )
  )
    return null;
  const match =
    /(?:\b(?:open|play|watch|click)\s+|(?:открой|включи|посмотри)\s+)(?:the\s+)?(?:video\s+(?:titled|named)\s+)?["“«]([^"”»\r\n]{1,200})["”»]/iu.exec(
      followUp,
    );
  if (match) return { exactTitle: videoTitleKey(match[1]) };
  if (!/\b(?:open|play|watch|click)\b|открой|включи|посмотри/iu.test(followUp)) return null;
  const teaser = /\bteaser\b|тизер/iu.test(followUp);
  const trailer = /\btrailer\b|трейлер/iu.test(followUp);
  if (teaser || trailer) {
    const topic = videoTitleKey(query)
      .split(' ')
      .filter(
        (word) =>
          word.length > 2 &&
          !/^(?:the|for|official|teaser|trailer|video|netflix|youtube|официальн\p{L}*|тизер|трейлер)$/u.test(
            word,
          ),
      );
    return { teaser, trailer, topic, netflix: /\bofficial\s+netflix\b/iu.test(followUp) };
  }
  return { watchPage: true };
}

export function exactYoutubeVideoTarget(view, requirement) {
  if (!requirement?.exactTitle || browserPageState(view)?.site !== 'youtube') return null;
  const matches = (view.targets ?? []).filter(
    (target) =>
      target.pageContent === true &&
      target.role === 'ControlType.Hyperlink' &&
      target.targetId &&
      videoTitleKey(target.untrustedLabel) === requirement.exactTitle,
  );
  return matches.length === 1 ? matches[0].targetId : null;
}

export function youtubeWatchVerified(view, requirement) {
  if (!requirement) return true;
  const address = observedBrowserAddress(view);
  if (!address || address.focused || view.window?.modal) return false;
  let url;
  try {
    const raw = address.untrustedValue ?? '';
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.port ||
    !/^(?:www\.)?youtube\.com$/i.test(url.hostname) ||
    url.pathname !== '/watch' ||
    !/^[\w-]{11}$/.test(url.searchParams.get('v') ?? '')
  )
    return false;
  const rawTitle = String(view.window?.untrustedTitle ?? '');
  const title = videoTitleKey(rawTitle.replace(/\s+[-–—]\s+YouTube(?:\s+[-–—]\s+.*)?$/iu, ''));
  const words = new Set(title.split(' '));
  if (requirement.exactTitle) return title === requirement.exactTitle;
  if (requirement.watchPage) return Boolean(title && title !== 'youtube');
  const netflixChannel = (view.targets ?? []).some(
    (target) =>
      target.pageContent === true &&
      !target.editable &&
      /^netflix(?: anime| geeked)?$/iu.test(String(target.untrustedLabel ?? '').trim()) &&
      /^https:\/\/(?:www\.)?youtube\.com\/@netflix(?:anime|geeked)?\/?$/iu.test(
        target.untrustedValue ?? '',
      ),
  );
  return Boolean(
    title &&
      (!requirement.teaser || words.has('teaser') || words.has('тизер')) &&
      (!requirement.trailer || words.has('trailer') || words.has('трейлер')) &&
      requirement.topic.every((word) => words.has(word)) &&
      (!requirement.netflix || netflixChannel),
  );
}
