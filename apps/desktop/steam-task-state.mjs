// SPDX-License-Identifier: GPL-3.0-only
const playLabel = /^(?:play|launch|играть|запустить)$/iu;
const libraryLabel =
  /^(?:library|(?:my|the) library|steam library|(?:ma |la )?biblioth[eè]que|библиотек\p{L}*|мо[яю] библиотек\p{L}*)$/iu;
export const isSteamLibraryControl = (target) =>
  !target.surface && libraryLabel.test(target.untrustedLabel?.trim() ?? '');

const normalized = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();

/** Explicit single-goal Steam launch. A multi-app goal still uses the planner. */
export function explicitSteamGame(goal) {
  const text = goal
    .trim()
    .replace(
      /^(?:use (?:full )?computer access[,.: ]+|используй полное управление компьютером[,.: ]+)/iu,
      '',
    );
  const name =
    /^(?:open|play|launch|start)\s+(?:the game\s+)?([^,;!?]{1,90}?)\s+(?:in|on|via|through)\s+steam[.!]?$/iu.exec(
      text,
    )?.[1] ??
    /^(?:открой|запусти)\s+(?:игру\s+)?([^,;!?]{1,90}?)\s+(?:в|через)\s+(?:steam|стиме?)[.!]?$/iu.exec(
      text,
    )?.[1];
  if (!name || /\b(?:and|then|after)\b|(?:^|\s)(?:и|затем|потом)(?:\s|$)/iu.test(name)) return null;
  return name.replace(/^["«“]|["»”]$/gu, '').trim() || null;
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
    ?.replace(/\s+(?:game|in (?:my|the) library)$/iu, '')
    .trim();
  if (!game || libraryLabel.test(game) || /^steam$/iu.test(game)) return null;
  const name = game.replace(/\btwenty seventy[- ]seven\b/iu, '2077');
  const play =
    /(?:\b(?:and|then)\s+(?:(?:click|press)\s+(?:the\s+)?(?:play|launch)\b|(?:play|launch|start)\s+it\b)|(?:затем|и)\s+(?:нажми\s+[«"]?(?:играть|запустить)|запусти\s+(?:игру|её|ее)))/iu.test(
      goal,
    );
  return { name, play };
}

export function steamMilestones(goal, view, history) {
  if (!goal) return null;
  const wanted = normalized(goal.name);
  const isGame = (label) => normalized(label) === wanted;
  const steamWindow = history.some(
    (step) =>
      step.ok &&
      step.action === 'launch' &&
      /^(?:steam|стим)$/iu.test(step.query?.trim()) &&
      step.windowId === view.window?.windowId,
  );
  const lastSelection = history.findLast(
    (step) =>
      step.ok &&
      step.action === 'click' &&
      !step.targetSurface &&
      !playLabel.test(step.target ?? ''),
  );
  const selected = isGame(lastSelection?.target);
  const gamePage =
    steamWindow &&
    selected &&
    lastSelection.windowId === view.window?.windowId &&
    view.targets.some((t) => !t.surface && isGame(t.untrustedLabel)) &&
    view.targets.some(isSteamPlayControl);
  const playPressed = history.some(
    (step, index) =>
      index > history.indexOf(lastSelection) &&
      step.windowId === lastSelection?.windowId &&
      step.ok &&
      step.action === 'click' &&
      playLabel.test(step.target ?? ''),
  );
  const remaining = !selected
    ? `The owner asked for the exact Steam game "${goal.name}". Opening Steam or its Library does not select the game. If it is not visible, locate it using the Library search or request visual analysis. Do not press Play for any other game.`
    : goal.play && !playPressed
      ? `The Play/Launch control for "${goal.name}" has not been clicked. Verify the game page before clicking the actual button.`
      : null;
  const matchingControls =
    steamWindow && !selected
      ? view.targets.filter(
          (t) =>
            !t.surface &&
            isGame(t.untrustedLabel) &&
            (t.source === 'vision' ||
              /\.(?:Button|ListItem|TreeItem|Hyperlink)$/u.test(t.role ?? '')),
        )
      : [];
  const libraryControls =
    steamWindow &&
    !selected &&
    !matchingControls.length &&
    !history.some(
      (step) =>
        step.ok && step.windowId === view.window?.windowId && libraryLabel.test(step.target ?? ''),
    )
      ? view.targets.filter(isSteamLibraryControl)
      : [];
  const playControls =
    gamePage && goal.play && !playPressed ? view.targets.filter(isSteamPlayControl) : [];
  return {
    gamePage,
    playPressed,
    remaining,
    ...(matchingControls.length === 1 ? { gameTarget: matchingControls[0].targetId } : {}),
    ...(libraryControls.length === 1 ? { libraryTarget: libraryControls[0].targetId } : {}),
    ...(playControls.length === 1 ? { playTarget: playControls[0].targetId } : {}),
  };
}

export const isSteamPlayControl = (target) =>
  target && !target.surface && playLabel.test(target.untrustedLabel ?? '');
