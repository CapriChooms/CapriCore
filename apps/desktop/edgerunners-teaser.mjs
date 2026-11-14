// SPDX-License-Identifier: GPL-3.0-only
import { canClickTarget } from './computer-click-target.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { browserNavigationState } from './browser-search-state.mjs';

// Publisher and Netflix catalogue pages. Verify both in the browser before acting.
export const edgerunnersPages = Object.freeze({
  official: 'https://www.cyberpunk.net/en/edgerunners2',
  netflix: 'https://www.netflix.com/title/81054853',
});

const title = String.raw`(?:cyberpunk|cyberpung|киберпанк)\s*[:–-]?\s+(?:edge\s*runners|adrinas|бегущие по краю)\s*(?:2|two|два)`;
const officialSite = String.raw`(?:the\s+)?official\s+(?:${title}\s+(?:web\s*site|site)|(?:web\s*site|site)\s+(?:of|for)\s+${title})`;
const request = new RegExp(
  [
    String.raw`^(?:(?:hey\s+)?capri|капри)?[\s,:]*(?:(?:can you|could you|можешь|please|пожалуйста|i want you to|use my computer to)\s+)*`,
    String.raw`(?:открой|открыть|запусти|open|launch)\s+(?:google\s+)?(?:chrome|хром)\s*(?:,|and|then|и|->|→)\s*`,
    String.raw`(?:search for|find|найди|найти)\s+(?:${officialSite}|официальный\s+сайт\s+${title})\s*[.!?,;]*\s*`,
    String.raw`(?:after that|and then|then|затем|потом|->|→)\s*(?:watch (?:it|the show) on|open(?: it on)?|посмотри(?: его)? на|посмотреть(?: его)? на|открой)\s+netflix\s*(?:[,;.]|and|и)\s*`,
    String.raw`(?:(?:scroll down(?: a bit)?|прокрути(?: немного)? вниз|пролистай(?: немного)? вниз)\s*(?:[,;.]|and|и)\s*)?`,
    String.raw`(?:play (?:the )?teaser|включи (?:первый )?тизер|запусти (?:первый )?тизер)\s*(?:please|пожалуйста)?[.!?]*$`,
  ].join(''),
  'iu',
);

export const edgerunnersTeaserRequest = (goal) =>
  typeof goal === 'string' && goal.length <= 500 && request.test(goal.normalize('NFKC').trim());

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\s]+/gu, ' ')
    .trim();
const pageControls = (view) =>
  view.targets.filter(
    (target) => target.pageContent === true && !target.surface && !target.editable,
  );
const teaserLabel =
  /^(?:(?:\d+m \d+s )?(?:teaser |тизер )?)?(?:(?:play(?: video)?|воспроизвести) )?(?:(?:season 2|сезон 2) )?(?:teaser|тизер) (?:cyberpunk edgerunners|киберпанк бегущие по краю) 2(?: \d+m \d+s)?$/u;
const pauseLabel =
  /^(?:pause(?: video)?|пауза|приостановить(?: воспроизведение)?|pausar|pausa|pause playback)$/u;

function namedWatchPage(view, windowId) {
  if (view.window?.windowId !== windowId) return false;
  const address = view.targets.find((target) => target.browserAddress && !target.focused);
  try {
    const value = address?.untrustedValue ?? '';
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://' + value);
    return url.origin === 'https://www.netflix.com' || url.origin === 'https://netflix.com'
      ? /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/\d+\/?$/i.test(url.pathname) &&
          (teaserLabel.test(
            normalize(view.window.untrustedTitle?.replace(/\s*[|–-]\s*Netflix.*$/iu, '')),
          ) ||
            pageControls(view).some((t) => teaserLabel.test(normalize(t.untrustedLabel))))
      : false;
  } catch {
    return false;
  }
}

export function edgerunnersReply({ stage, status }, language) {
  const russian = language === 'ru';
  if (status === 'playing')
    return russian
      ? 'Открыла официальный сайт и запустила первый тизер второго сезона на Netflix.'
      : 'I opened the official site and started the first Season 2 teaser on Netflix.';
  if (status === 'window_changed')
    return russian
      ? 'Окно Chrome сменилось. Я остановила цепочку.'
      : 'The Chrome window changed, so I stopped the task.';
  if (stage === 'official')
    return russian
      ? 'Не удалось подтвердить загрузку официального сайта Edgerunners 2.'
      : 'I could not verify that the official Edgerunners 2 site loaded.';
  if (stage === 'netflix')
    return russian
      ? 'Официальный сайт открыла. Не удалось подтвердить загрузку страницы сериала на Netflix.'
      : 'I opened the official site, but could not verify that the Netflix title page loaded.';
  if (stage === 'playback')
    return russian
      ? 'Открыла тизер, но не смогла подтвердить воспроизведение.'
      : 'I opened the teaser but could not verify playback.';
  return russian
    ? 'Страница сериала на Netflix открылась. Не удалось подтвердить кнопку первого тизера второго сезона.'
    : 'The Netflix title page loaded. I could not verify the first Season 2 teaser control.';
}

/** Run the recognized owner workflow using current window/control observations.
 * Every input still passes the existing computer session and native preflight. */
export async function runEdgerunnersTeaser({ navigate, observe, input, signal }) {
  const wait = () => delay(550, undefined, { signal });
  const load = async (url, title) => {
    signal.throwIfAborted();
    const receipt = await navigate(url);
    if (!receipt?.navigationRequested || !receipt.windowId) return { status: 'window_changed' };
    const expected = { windowId: receipt.windowId, navigationUrl: url };
    let status;
    for (let attempt = 0; attempt < 24; attempt++) {
      const view = await observe();
      status = browserNavigationState(view, expected);
      if (
        status === 'ready' &&
        ![view.window.untrustedTitle, ...pageControls(view).map((t) => t.untrustedLabel)].some(
          (label) => title.test(normalize(label)),
        )
      )
        status = 'loading';
      if (status !== 'loading') return { status, view, expected };
      await wait();
    }
    return { status };
  };
  const official = await load(edgerunnersPages.official, /(?:edgerunners|бегущие по краю) 2/u);
  if (official.status !== 'ready') return { stage: 'official', status: official.status };
  const netflix = await load(
    edgerunnersPages.netflix,
    /(?:cyberpunk edgerunners|киберпанк бегущие по краю)/u,
  );
  if (netflix.status !== 'ready') return { stage: 'netflix', status: netflix.status };
  let view = netflix.view;
  const state = (current) => browserNavigationState(current, netflix.expected);
  for (let scroll = 0; scroll < 4; scroll++) {
    signal.throwIfAborted();
    if (state(view) !== 'ready' || view.targets.some((t) => t.focused && t.editable))
      return { stage: 'teaser', status: 'window_changed' };
    if (
      !(
        await input({ action: 'press_keys', keys: ['PAGEDOWN'], observationId: view.observationId })
      )?.ok
    )
      return { stage: 'teaser', status: 'scroll_failed' };
    await wait();
    view = await observe();
    if (state(view) !== 'ready') return { stage: 'teaser', status: state(view) };
    const controls = pageControls(view);
    const labels = controls.filter(
      (t) => canClickTarget(t) && teaserLabel.test(normalize(t.untrustedLabel)),
    );
    const clickable = labels.filter((t) =>
      /\.(?:Button|Hyperlink)$/u.test(t.actionRole ?? t.role ?? ''),
    );
    const candidates = clickable.length
      ? clickable
      : labels.filter((t) => /\.(?:Image|Text)$/u.test(t.role ?? ''));
    if (candidates.length > 1) return { stage: 'teaser', status: 'ambiguous' };
    if (candidates.length === 1) {
      const alreadyPlaying = controls.some((t) => pauseLabel.test(normalize(t.untrustedLabel)));
      if (alreadyPlaying) return { stage: 'teaser', status: 'ambiguous' };
      if (!(await input({ action: 'click', targetId: candidates[0].targetId }))?.ok)
        return { stage: 'teaser', status: 'click_failed' };
      let consecutive = 0;
      for (let attempt = 0; attempt < 16; attempt++) {
        await wait();
        const playback = await observe();
        const status = state(playback);
        if (['sign_in', 'profile', 'network', 'window_changed'].includes(status))
          return { stage: 'playback', status };
        const pausedControl = pageControls(playback).some(
          (t) => /\.Button$/u.test(t.role ?? '') && pauseLabel.test(normalize(t.untrustedLabel)),
        );
        const expectedPlayer =
          status === 'ready' || namedWatchPage(playback, netflix.expected.windowId);
        consecutive = expectedPlayer && pausedControl ? consecutive + 1 : 0;
        if (consecutive >= 2) return { stage: 'playback', status: 'playing' };
      }
      return { stage: 'playback', status: 'unverified' };
    }
  }
  return { stage: 'teaser', status: 'missing' };
}
