// SPDX-License-Identifier: GPL-3.0-only
const completed = new Set([
  'mate',
  'resign',
  'stalemate',
  'timeout',
  'draw',
  'outoftime',
  'cheat',
  'noStart',
  'variantEnd',
  'unknownFinish',
]);
const localePrefix = /^\/[a-z]{2}(?:-[a-z]{2,8})?(?=\/)/i;
const chessComOrigins = new Set(['https://chess.com', 'https://www.chess.com']);

export function chessBotPage(view) {
  return Boolean(
    chessComOrigins.has(view?.origin) &&
      typeof view.path === 'string' &&
      /^\/(?:play\/computer(?:\/(?:group\/)?[\w-]+)?|game\/computer\/[\w-]+)\/?$/.test(
        view.path.replace(localePrefix, ''),
      ),
  );
}

export function sameChessView(previous, current) {
  const sameTab = /^[0-9A-F]{64}$/.test(previous.tabId) && previous.tabId === current.tabId;
  if (previous.tabId && current.tabId && !sameTab) return false;
  const sameWindow =
    /^[0-9A-F]{64}$/.test(previous.windowId) && previous.windowId === current.windowId;
  return (
    previous.token === current.token ||
    (chessBotPage(previous) && chessBotPage(current) && (sameTab || sameWindow))
  );
}

export function chessPage(view) {
  if (
    !view ||
    !/^[0-9A-F]{64}$/.test(view.token) ||
    !view.bounds ||
    !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(view.bounds[key])) ||
    view.bounds.width <= 0 ||
    view.bounds.height <= 0
  )
    return null;
  const route = view.path;
  if (typeof route !== 'string' || route.length > 1024 || /[\\#?]/.test(route)) return null;
  if (chessComOrigins.has(view.origin)) {
    const path = route.replace(localePrefix, '');
    // A live/daily game ID embedded in an analysis URL does not prove the game ended.
    if (/^\/analysis\/game\/(?:live|daily)(?:\/|$)/i.test(path)) return null;
    if (/^\/analysis(?:\/|$)/.test(path) || chessBotPage(view)) return { ...view };
  }
  if (view.origin === 'https://lichess.org') {
    if (/^\/analysis(?:\/?$|\/(?:standard|fromPosition)(?:\/|$))|^\/study(?:\/|$)/.test(route))
      return { ...view };
    const game = /^\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(route);
    if (game) return { ...view, game: game[1] };
  }
  return null;
}

export class ChessPageAccess {
  constructor({ inspect, fetchImpl = fetch }) {
    Object.assign(this, { inspect, fetchImpl });
    this.games = new Map();
  }
  async allowed(signal, point, onDecision) {
    const observation = await this.inspect(signal, point);
    const view = observation?.probe ? null : observation;
    const page = chessPage(view);
    const chessCom = chessComOrigins.has(view?.origin);
    const details = {
      provider: chessCom
        ? 'chess-com'
        : view?.origin === 'https://lichess.org'
          ? 'lichess'
          : 'other',
      localized: chessCom && typeof view.path === 'string' && localePrefix.test(view.path),
      browserProbe: observation?.probe,
    };
    const decide = (reason, extra) => onDecision?.({ ...details, ...extra, reason });
    if (!page?.game || this.games.has(page.game)) {
      decide(
        page?.game
          ? 'game_already_verified'
          : page
            ? 'route_allowed'
            : view
              ? 'route_rejected'
              : 'no_browser_view',
      );
      return page?.game ? { ...page, computerSide: this.games.get(page.game) } : page;
    }
    try {
      const reply = await this.fetchImpl(
        `https://lichess.org/game/export/${page.game}?moves=false&clocks=false`,
        {
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        },
      );
      if (!reply.ok) {
        decide('game_lookup_failed', { httpStatus: reply.status });
        return null;
      }
      const reader = reply.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32768) {
            decide('game_lookup_failed');
            return null;
          }
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const game = JSON.parse(Buffer.concat(chunks).toString());
      const computerSide = Number.isInteger(game.players?.white?.aiLevel)
        ? 'w'
        : Number.isInteger(game.players?.black?.aiLevel)
          ? 'b'
          : null;
      if (
        game.id !== page.game ||
        game.variant !== 'standard' ||
        !(completed.has(game.status) || computerSide)
      ) {
        decide('game_rejected');
        return null;
      }
      if (this.games.size >= 16) this.games.delete(this.games.keys().next().value);
      this.games.set(page.game, computerSide);
      decide('game_allowed');
      return { ...page, computerSide };
    } catch {
      decide('game_lookup_failed');
      return null;
    }
  }
}

export function chessRectInside(rect, bounds) {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.x + bounds.width &&
    rect.y + rect.height <= bounds.y + bounds.height
  );
}

export function scaleChessRect(rect, xScale, yScale) {
  const x = Math.round(rect.x * xScale);
  const y = Math.round(rect.y * yScale);
  return {
    x,
    y,
    width: Math.round((rect.x + rect.width) * xScale) - x,
    height: Math.round((rect.y + rect.height) * yScale) - y,
  };
}
