// SPDX-License-Identifier: GPL-3.0-only
import { canClickTarget } from './computer-click-target.mjs';

const libraryLabel =
  /^(?:library|(?:my|the) library|steam library|(?:ma |la )?biblioth[eè]que|библиотек\p{L}*|мо[яю] библиотек\p{L}*)$/iu;
const librarySearchLabel = /^(?:search (?:the )?library|library search|поиск по библиотеке)$/iu;
const playLabel =
  /^(?:Play|Launch|Играть|Запустить|Jouer|Spielen|Jugar|Jogar|Gioca|Graj|プレイ|开始游戏|開始遊戲|플레이)$/iu;
export const isSteamPlayLabel = (value) => playLabel.test(value?.trim() ?? '');

export const isSteamClient = (executable) =>
  /(?:^|[\\/])steam(?:webhelper)?\.exe$/iu.test(executable ?? '');

const normalized = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();

function gameName(value) {
  const name = value.replace(/^["«“]|["»”]$/gu, '').trim();
  if (
    /^(?:cyberpunk|киберпанк)(?:\s+(?:2077|twenty seventy[- ]seven|две тысячи семьдесят семь))?$/iu.test(
      name,
    )
  )
    return 'Cyberpunk 2077';
  return name;
}

/** Explicit single-goal Steam launch. A multi-app goal still uses the planner. */
export function explicitSteamGame(goal) {
  const text = goal
    .normalize('NFKC')
    .trim()
    .replace(/^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu, '')
    .replace(/^(?:please|can you|could you|можешь|пожалуйста)[,\s]+/iu, '')
    .replace(
      /^(?:use (?:full )?computer access[,.: ]+|используй полное управление компьютером[,.: ]+)/iu,
      '',
    )
    .replace(/[.!?]\s+(?:i['’]ll be glad|i['’]d appreciate it|thanks|thank you)[.!?]*$/iu, '')
    .replace(/(?:\s*,\s*|\s+)(?:for me|please|пж|плиз|пожалуйста)(?=[.!?]*$)/iu, '')
    .replace(
      /(?:,?\s+)(?:and(?:\s+then)?|then)\s+(?:click|press)\s+(?:the\s+)?[“"]?play[”"]?(?:\s+button)?[.!?]*$/iu,
      '',
    );
  const name =
    /^(?:open|play|launch|start)\s+(?:the game\s+)?([^,;!?]{1,90}?)\s+(?:in|on|via|through|from)\s+steam(?:(?:[,;]\s*|\s+)(?:and(?:\s+then)?|then)\s+(?:(?:uh|um|please)\s+)*(?:play|launch|start)\s+(?:it|the game))?[.!?]*$/iu.exec(
      text,
    )?.[1] ??
    /^(?:open|start|launch)\s+(?:the\s+)?steam(?:\s+library)?(?:\s*[,.;]\s*(?:(?:and(?:\s+then)?|then)\s+)?|\s+(?:and(?:\s+then)?|then)\s+)(?:launch|start|play)\s+(?:the game\s+)?("[^"\r\n]{1,90}"|“[^”\r\n]{1,90}”|[^,;.!?\r\n]{1,90})[.!?]*$/iu.exec(
      text,
    )?.[1] ??
    /^(?:открой|запусти)\s+(?:игру\s+)?([^,;!?]{1,90}?)\s+(?:в|через|из)\s+(?:steam|стим[ае]?)(?:(?:[,;]\s*|\s+)(?:и|затем|потом)\s+запусти\s+(?:игру|его|её|ее))?[.!?]*$/iu.exec(
      text,
    )?.[1] ??
    /^(?:открой|запусти)\s+(?:приложение\s+)?(?:steam|стим)\s*(?:[,.;]\s*|\s+(?:и|затем|потом)\s+)найди\s+(?:там\s+)?(?:игру\s+)?([^,;!?]{1,90}?)(?:[,;]\s*|\s+)(?:и|затем|потом)\s+запусти\s+(?:игру|его|её|ее)[.!?]*$/iu.exec(
      text,
    )?.[1];
  if (
    !name ||
    (!/^["«“].*["»”]$/u.test(name) &&
      /\b(?:and|then|after)\s+(?:open|launch|start|play|find|click|install|close|show|search)\b|(?:^|\s)(?:и|затем|потом)\s+(?:открой|запусти|найди|нажми|установи|закрой|покажи)(?:\s|$)/iu.test(
        name,
      ))
  )
    return null;
  return gameName(name) || null;
}

const conditionalSteamCommands = [
  /^(?:открой|запусти)\s+(?:steam|стим)\s*[,.;]\s*(?:найди|выбери)\s+(?:там\s+)?(?:игру\s+)?(?<name>[^,.;!?\r\n]{1,90})[,.;]\s*если\s+(?:(?:он[ао]?|игра)\s+)?не\s+(?:скачан|установлен)[ао]?\s*,\s*(?:нажми\s+[«"“]?скачать[»"”]?\s+и\s+)?(?:установи|скачай)(?:\s+(?:игру|её|ее|его))?(?:\s+на\s+(?:диск\s+)?(?<drive>[a-z]):?)?[,.;]\s*(?:иначе|в противном случае|если\s+(?:нет|да|(?:(?:он[ао]?|игра)\s+)?(?:уже\s+)?установлен[ао]?))\s*,?\s*(?:нажми\s+[«"“]?играть[»"”]?|запусти(?:\s+(?:игру|её|ее|его))?)[.!?]*$/iu,
  /^(?:open|launch)\s+steam\s*[,.;]\s*(?:find|select)\s+(?:the game\s+)?(?<name>[^,.;!?\r\n]{1,90})[,.;]\s*if\s+(?:(?:it(?:'s|’s| is)|the game is)\s+)?not\s+(?:downloaded|installed)\s*,\s*(?:install|download)(?:\s+(?:it|the game))?(?:\s+(?:to|on)\s+(?:(?:drive\s+)?(?<drive>[a-z]):?)(?:\s+drive)?)?[,.;]\s*(?:otherwise|if\s+(?:it(?:'s|’s| is)\s+(?:already\s+)?installed|not))\s*,?\s*(?:(?:click|press)\s+(?:the\s+)?["“]?play["”]?(?:\s+button)?|(?:play|launch|start)(?:\s+(?:it|the game))?)[.!?]*$/iu,
];

export function steamGameCommand(goal) {
  const name = explicitSteamGame(goal);
  if (name) return { name, installIfMissing: false };
  for (const pattern of conditionalSteamCommands) {
    const match = pattern.exec(goal)?.groups;
    if (!match) continue;
    const name = gameName(match.name);
    if (
      !name ||
      /\b(?:and|then)\s+(?:open|play|launch|install)\b|(?:^|\s)(?:и|затем|потом)\s+(?:открой|запусти|нажми|установи)\s/iu.test(
        name,
      )
    )
      return null;
    return { name, installIfMissing: true, drive: match.drive?.toUpperCase() ?? null };
  }
  return null;
}

/** Host checks for the named-game steps a model can otherwise confuse with opening Steam. */
export function steamGameGoal(goal) {
  if (!/\bsteam\b|стим/iu.test(goal)) return null;
  const explicit = explicitSteamGame(goal);
  if (explicit) return { name: explicit, play: true };
  const commands = [
    ...goal.matchAll(
      /(?:^|\s)(?:select|go to|find|выбери|перейди к|найди)\s+(?:the\s+)?([^,.;!?]{1,100}?)(?=\s+(?:and|then|so|go to|затем|и)\s|[,.;!?]|$)/giu,
    ),
  ];
  const game = commands
    .at(-1)?.[1]
    ?.replace(/^(?:там|there)\s+/iu, '')
    ?.replace(/\s+(?:game|in (?:my|the) library)$/iu, '')
    .trim();
  if (!game || libraryLabel.test(game) || /^steam$/iu.test(game)) return null;
  const name = gameName(game);
  const play =
    /(?:\b(?:and|then)\s+(?:(?:uh|um|please)\s+)*(?:(?:click|press)\s+(?:the\s+)?[“"]?(?:play|launch)\b|(?:play|launch|start)\s+it\b)|(?:затем|потом|и)\s+(?:нажми\s+[«"]?(?:играть|запустить)|запусти\s+(?:игру|его|её|ее)))/iu.test(
      goal,
    );
  return { name, play };
}

export function steamGamePage(goal, view) {
  return Boolean(
    goal &&
      view.window?.applicationKind === 'steam' &&
      !view.window.modal &&
      view.steamLibrary?.page === 'game' &&
      normalized(view.steamLibrary.gameTitle) === normalized(goal.name),
  );
}

export function steamMilestones(goal, view, history) {
  if (!goal) return null;
  const wanted = normalized(goal.name);
  const steamWindow = view.window?.applicationKind === 'steam' && !view.window.modal;
  const inLibrary = steamWindow && ['library', 'game'].includes(view.steamLibrary?.page);
  const gamePage = steamGamePage(goal, view);
  const launchState = gamePage ? view.steamLibrary.launchState : null;
  const playPressed = history.some((step) => step.steamPlay);
  const verified = gamePage && (!goal.play || launchState === 'running');
  const target = (match) => {
    if (!steamWindow) return null;
    const matches = view.targets.filter((item) => !item.surface && match(item));
    return matches.length === 1 ? matches[0].targetId : null;
  };
  const libraryTarget =
    !playPressed && !inLibrary
      ? target(
          (item) =>
            (item.steamRole === 'library' ||
              (/\.(?:Button|TabItem|Hyperlink)$/u.test(item.role ?? '') &&
                libraryLabel.test(item.untrustedLabel?.trim() ?? ''))) &&
            canClickTarget(item),
        )
      : null;
  const gameTarget =
    inLibrary && !gamePage && !playPressed
      ? target(
          (item) =>
            item.steamRole === 'game_row' &&
            normalized(item.untrustedLabel) === wanted &&
            canClickTarget(item),
        )
      : null;
  const searchTarget =
    inLibrary && !gamePage && !gameTarget && !playPressed
      ? target(
          (item) =>
            !item.browserAddress &&
            (item.steamRole === 'library_search' ||
              (item.editable && librarySearchLabel.test(item.untrustedLabel?.trim() ?? ''))),
        )
      : null;
  const playTarget =
    goal.play && launchState === 'ready' && !playPressed
      ? target(
          (item) =>
            item.steamRole === 'play' &&
            isSteamPlayLabel(item.untrustedLabel) &&
            canClickTarget(item),
        )
      : null;
  const remaining = verified
    ? null
    : playPressed
      ? `Verify that Steam shows "${goal.name}" running. Play was already requested. Wait or observe without further input, or ask the owner if a launcher or dialog needs attention.`
      : !steamWindow
        ? 'Open or restore the Steam desktop client before using its Library.'
        : !inLibrary
          ? 'Verify that the Steam Library is open. Use only the observed Library tab. If there is no verified control, observe or ask the owner.'
          : !gamePage
            ? `Select the exact row "${goal.name}", or search for that exact name in the Library search. Verify the title on the main game page. A sidebar entry is insufficient.`
            : `The main Library page is "${goal.name}". Click only its verified Play button when it is available. If it is starting, wait and observe. If installation, a dialog or another launcher is required, ask the owner.`;
  return {
    name: goal.name,
    steamWindow,
    remaining,
    gamePage,
    playPressed,
    libraryTarget,
    gameTarget,
    searchTarget,
    playTarget,
  };
}

export function steamActionAllowed(state, step, view) {
  if (!state) return true;
  if (['observe', 'wait', 'ask_user'].includes(step.action)) return true;
  const target = view.targets.find((item) => item.targetId === step.targetId);
  if (!state.remaining)
    return !(
      step.action === 'click' &&
      state.steamWindow &&
      isSteamPlayLabel(target?.untrustedLabel)
    );
  if (step.action === 'launch')
    return (
      !state.steamWindow &&
      !state.playPressed &&
      /^(?:steam|стим)$/iu.test(step.query?.trim() ?? '')
    );
  if (step.action === 'click')
    return Boolean(
      target &&
        (step.button ?? 'left') === 'left' &&
        (step.clickCount ?? 1) === 1 &&
        [state.libraryTarget, state.gameTarget, state.searchTarget, state.playTarget].includes(
          target.targetId,
        ),
    );
  return (
    step.action === 'enter_text' &&
    target?.editable === true &&
    target.targetId === state.searchTarget &&
    (step.mode ?? 'replace') === 'replace' &&
    normalized(step.text) === normalized(state.name)
  );
}
