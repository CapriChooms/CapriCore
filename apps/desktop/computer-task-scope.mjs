// SPDX-License-Identifier: GPL-3.0-only
import { exactApplications } from './application-target.mjs';

const browserActions = new Set(['open_url', 'browser_search', 'browser_input']);
const inputActions = new Set([
  'click',
  'move_pointer',
  'drag',
  'enter_text',
  'press_keys',
  'scroll',
  'resolve_assemble',
]);
const words = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /(?<=[\p{Script=Latin}\p{N}])(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])|(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])(?=[\p{Script=Latin}\p{N}])/gu,
      ' ',
    )
    .match(/[\p{L}\p{N}+#]+/gu) ?? [];
const quoted = /"[^"\n]*"|«[^»\n]*»|“[^”\n]*”/gu;
const transition =
  /(?:^|[^\p{L}\p{N}])(?:open|launch|start|switch to|go back to|activate|открой|запусти|переключись на|вернись в|ouvre|ouvrez|lance|lancez|reviens dans|abre|inicia|wechsel zu|öffne|starte)\s+(?:the\s+|le client\s+|приложение\s+|клиент\s+)?/giu;
const desktopNavigation =
  /\b(?:switch|taskbar|alt\s*\+\s*tab)\b|переключ|панел\p{L}* задач|barre des tâches|barra de tareas/iu;
export const taskbarApplication = (target) =>
  target?.surface === 'taskbar' && !target.notificationArea
    ? (target.untrustedLabel ?? '')
        .trim()
        .replace(/^(?:application|приложение)\s+/iu, '')
        .replace(/\s*[-–—]\s*(?:\d+\s+.*|запущенных окон:\s*\d+.*)$/iu, '')
        .replace(/\s+(?:pinned|закреплено)$/iu, '')
    : '';

export function ownerNamesApplication(goal, name) {
  const label = words(name).join(' ');
  return Boolean(label && ` ${words(goal.replace(quoted, ' ')).join(' ')} `.includes(` ${label} `));
}

export function ownerRequestsWeb(goal, opening) {
  const source = goal.replace(quoted, ' [quoted] ');
  if (
    /\b(?:do not|don['’]t|never)\s+(?:search|open|use|visit)[^.!?]{0,60}\b(?:web|browser|google)\b|не\s+(?:гугли|ищи\s+в\s+интернете|открывай\s+браузер)|ne\s+(?:cherche|recherche)\s+pas/iu.test(
      source,
    )
  )
    return false;
  if (
    /https?:\/\/|\b(?:www\.|website|address bar|current tab|search the web|on the web|look up online|in (?:a|the|my) browser)\b|адресн\p{L}* строк|в интернет|(?:^|\s)сайт\p{L}*|\b(?:dans (?:le|un) navigateur|en ligne|site web|en (?:el|un) navegador|sitio web)\b/iu.test(
      source,
    ) ||
    /\b(?:open|visit|go to)\s+["“]https?:\/\/|открой\s+["«]https?:\/\//iu.test(goal)
  )
    return true;
  if (/\bgoogle\s+(?!chrome\b)\S|погугли|sur google|en google/iu.test(source)) return true;
  if (
    /^(?:google chrome|chrome|(?:microsoft )?edge|firefox|opera(?: gx)?|brave|vivaldi|browser|браузер|хром)$/iu.test(
      opening?.name ?? '',
    ) &&
    /\b(?:search|go to|visit|type|page|tab)\b|(?:поиск|перейди|введи|вкладк)|\b(?:cherche|recherche|onglet)\b/iu.test(
      source,
    )
  )
    return true;
  if (/^(?:youtube|netflix)$/iu.test(opening?.name ?? '')) return true;
  if (opening) return false;
  return /\b(?:search|look up|find (?:where|how|the official)|chrome|edge|firefox|youtube|netflix)\b|^\s*in\s+[^,]{1,180}\btab\s*,|\bfind\b[^.!?]{0,180}\b(?:where|how)\b[^.!?]{0,100}\b(?:download|buy|get|order)\b|(?:^|\s)(?:поищи|найди где|найди как|найди официальный)|\b(?:cherche|recherche|busca)\b/iu.test(
    source,
  );
}

/** The owner goal fixes the task scope. Neither the model nor observed text may widen it. */
export class ComputerTaskScope {
  constructor(goal, opening, { web = ownerRequestsWeb(goal, opening) } = {}) {
    this.goal = goal;
    this.opening = opening;
    this.web = web;
    this.canBindCurrent = !opening && !web && !desktopNavigation.test(goal.replace(quoted, ' '));
    this.window = null;
    this.closedWindow = false;
  }

  requestedApplication(query) {
    if (this.opening && exactApplications([{ name: this.opening.name }], query).length) return true;
    const label = words(query).join(' ');
    if (!label) return false;
    const text = this.goal.replace(quoted, (part, offset) => {
      const prefix = this.goal.slice(0, offset);
      const verb = [...prefix.matchAll(transition)].at(-1);
      return verb && verb.index + verb[0].length === offset
        ? part.slice(1, -1)
        : ' '.repeat(part.length);
    });
    return [...text.matchAll(transition)].some((match) => {
      const before = text.slice(0, match.index + 1).trimEnd();
      if (/(?:\bdo not|\bdon['’]t|\bnever|(?:^|\s)не)$/iu.test(before)) return false;
      return `${words(text.slice(match.index + match[0].length)).join(' ')} `.startsWith(
        `${label} `,
      );
    });
  }

  bind(app, receipt) {
    if (!receipt?.windowId || receipt.focused !== true || receipt.windowVerified === false) return;
    this.window = {
      app,
      windowId: receipt.windowId,
      processId: receipt.processId,
      startedAtTicks: receipt.startedAtTicks,
      recoveryAttempted: false,
    };
    this.closedWindow = false;
  }

  expectWindowClose(step, selected) {
    if (!this.window?.startedAtTicks) return;
    const text = this.goal.replace(quoted, ' ');
    if (!/\b(?:close|quit|exit|ferme|quitte)\b|закрой|выйди из/iu.test(text)) return;
    const shortcut =
      step.action === 'press_keys' &&
      step.keys?.length === 2 &&
      step.keys.includes('ALT') &&
      step.keys.includes('F4');
    const control =
      step.action === 'click' &&
      !selected?.surface &&
      /^(?:close(?: window)?|закрыть(?: окно)?|fermer(?: la fenêtre)?)$/iu.test(
        selected?.untrustedLabel ?? '',
      );
    if (shortcut || control) this.window.closing = true;
  }

  markWindowClosed() {
    this.window = null;
    this.closedWindow = true;
  }

  ownsForeground(view, identity) {
    const bound = this.window;
    if (!bound) return false;
    const sameProcess =
      String(identity?.processId) === String(bound.processId) &&
      identity?.startedAtTicks === bound.startedAtTicks;
    if (view.window?.windowId === bound.windowId) return !bound.startedAtTicks || sameProcess;
    // A modal can have its own HWND. Require the original process instance.
    return view.window?.modal === true && Boolean(bound.startedAtTicks) && sameProcess;
  }

  followWindow(view, identity, appName) {
    const bound = this.window;
    if (
      !bound ||
      !identity?.startedAtTicks ||
      !identity.processId ||
      !view.window?.windowId ||
      bound.windowId === view.window.windowId
    )
      return false;
    const sameInstance =
      String(identity.processId) === String(bound.processId) &&
      identity.startedAtTicks === bound.startedAtTicks;
    if (appName) {
      // A mutable window title is not proof that the switch reached the named app.
      if (
        !this.requestedApplication(appName) ||
        !exactApplications([{ name: '', executable: identity.executable }], appName).length
      )
        return false;
    } else if (!sameInstance) return false;
    this.bind(appName ? { name: appName } : bound.app, {
      ...identity,
      windowId: view.window.windowId,
      focused: true,
    });
    return true;
  }

  problem(step, view, identity) {
    if (
      !this.web &&
      browserActions.has(step.action) &&
      typeof step.query === 'string' &&
      step.query.trim()
    )
      return 'The owner requested work on the computer. Use the requested application and its own controls; this task does not authorize browser search or navigation.';
    if (this.closedWindow && inputActions.has(step.action))
      return 'The bound application window has closed. Open the next application from the owner request before sending more input.';
    if ((!this.opening && !this.window) || this.web) return '';
    if (step.action === 'launch' && !this.requestedApplication(step.query))
      return 'Use the installed application named in the original request. Do not substitute a different application.';
    if (this.window && inputActions.has(step.action) && !this.ownsForeground(view, identity))
      return 'The requested application is no longer in the foreground. No input was sent. Restore the bound window before continuing.';
    const targets = view.targets ?? [];
    const selected = targets.find((target) => target.targetId === step.targetId);
    const switchApp = taskbarApplication(selected);
    if (
      step.action === 'click' &&
      switchApp &&
      this.requestedApplication(switchApp) &&
      (step.button ?? 'left') === 'left' &&
      (step.clickCount ?? 1) === 1
    )
      return '';
    if (
      inputActions.has(step.action) &&
      (selected?.surface ||
        selected?.browserAddress ||
        (step.action === 'press_keys' &&
          targets.some((target) => target.focused && target.browserAddress)))
    )
      return 'Choose a control inside the requested application. Do not use taskbar or address-bar controls for this action.';
    return '';
  }
}

const labelKey = (value) =>
  words(
    String(value ?? '')
      .normalize('NFD')
      .replace(/\p{M}/gu, ''),
  ).join(' ');
const sectionAliases = [
  ['library', 'bibliotheque', 'библиотека', 'библиотеку'],
  ['settings', 'preferences', 'parametres', 'настройки'],
  ['downloads', 'telechargements', 'загрузки'],
  ['history', 'historique', 'история', 'историю'],
  ['inbox', 'входящие'],
];

/** A native selected control or exact title can prove a requested UI section is open. */
export function observedSection(view, section, application) {
  const key = labelKey(section),
    app = labelKey(application);
  const labels = sectionAliases.find((names) => names.includes(key)) ?? [key];
  const title = labelKey(view.window?.untrustedTitle);
  const control = (target) => !target.surface && labels.includes(labelKey(target.untrustedLabel));
  const candidates = (view.targets ?? []).filter(control);
  const verified =
    labels.some((label) => [label, `${app} ${label}`, `${label} ${app}`].includes(title)) ||
    candidates.some((target) => target.selected === true);
  const clickable = candidates.filter((target) =>
    /\.(?:TabItem|MenuItem|Button|Hyperlink)$/u.test(target.role ?? ''),
  );
  return { verified, target: clickable.length === 1 ? clickable[0] : null };
}
