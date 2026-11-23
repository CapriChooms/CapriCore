// SPDX-License-Identifier: GPL-3.0-only
import { setTimeout as delay } from 'node:timers/promises';
import { DiscordGuiTask, discordTaskRequest, discordObservation } from './discord-application.mjs';

const messages = {
  clarify: [
    'Укажи одно действие и точные названия сервера и канала Discord.',
    'Specify one action and the exact Discord server and channel names.',
  ],
  failed: [
    'Не удалось проверить действие в Discord. Проверь его состояние перед повтором.',
    'The Discord action could not be verified. Check its current state before retrying.',
  ],
  changed: [
    'Окно или результат Discord изменились во время проверки.',
    'The Discord window or result changed during verification.',
  ],
  timeout: [
    'Discord не подтвердил действие вовремя. Проверь его состояние перед повтором.',
    'Discord did not verify the action in time. Check its current state before retrying.',
  ],
  limit: [
    'Не удалось завершить действие Discord за отведённое число шагов.',
    'The Discord task did not finish within its step limit.',
  ],
  blocked: [
    'Не удалось однозначно определить нужный элемент Discord. Уточни сервер или канал либо открой его в Discord.',
    'The intended Discord control is ambiguous or unavailable. Specify the server/channel or open it in Discord.',
  ],
};
const currentMessages = {
  unavailable: [
    'Не удалось определить поле сообщения Discord. Открой нужный чат и попробуй снова.',
    'I could not identify the Discord message field. Open the intended chat and try again.',
  ],
  ambiguous: [
    'Открыто несколько чатов Discord. Уточни, в какой написать: левый или правый.',
    'Several Discord chats are open. Specify the intended chat: left or right.',
  ],
  draft: [
    'Твой черновик в Discord сохранён. Проверь или сохрани его перед повторной попыткой.',
    'Your Discord draft was kept. Review or save it before trying again.',
  ],
  changed: [
    'Выбранный чат Discord изменился. Проверь нужный чат перед повторной попыткой.',
    'The selected Discord chat changed. Check the intended chat before trying again.',
  ],
  unverified: [
    'Отправку в Discord не удалось подтвердить. Проверь чат; повторять отправку я не буду.',
    'The Discord send could not be confirmed. Check the chat; I will not repeat the send.',
  ],
};
const currentMessageKind = (reason) =>
  ({
    discord_current_composer_ambiguous: 'ambiguous',
    discord_current_draft_present: 'draft',
    discord_current_draft_changed: 'draft',
    discord_current_scope_changed: 'changed',
    discord_current_submission_unverified: 'unverified',
    discord_current_composer_unavailable: 'unavailable',
    discord_current_scope_unavailable: 'unavailable',
    discord_current_observation_truncated: 'unavailable',
    discord_current_composer_scan_incomplete: 'unavailable',
  })[reason];

/**
 * Runs inside an already granted ComputerControl session. It never begins or
 * approves a session. launch, when needed, is called as launch('Discord', signal)
 * once, then its claimed outcome is checked against a fresh native observation.
 * onStep receives only { phase, action, steps }; never private labels or text.
 */
export async function runDiscordComputerTask({
  goal,
  request,
  language = 'en',
  control,
  launch,
  signal,
  onStep,
}) {
  signal?.throwIfAborted();
  const parsed = request ?? discordTaskRequest(goal);
  if (!parsed) return { handled: false };
  const text = (kind) => messages[kind][language === 'ru' ? 0 : 1];
  const failure = (kind, steps, status = 'incomplete', extra = {}) => {
    const currentKind =
      parsed.action === 'send_current_message' &&
      (currentMessageKind(extra.reason) ?? (kind === 'blocked' ? 'unavailable' : null));
    return {
      handled: true,
      success: false,
      status,
      steps,
      summary: currentKind ? currentMessages[currentKind][language === 'ru' ? 0 : 1] : text(kind),
      ...extra,
    };
  };
  if (parsed.action === 'clarify')
    return failure('clarify', 0, 'needs_user', { reason: 'clarify' });
  const timeout = AbortSignal.timeout(60000);
  const sessionSignal = control?.session?.controller?.signal;
  const combined = AbortSignal.any([
    timeout,
    ...(signal ? [signal] : []),
    ...(sessionSignal ? [sessionSignal] : []),
  ]);
  let steps = 0,
    launchAttempted = false,
    settling = 0,
    inputAttempted = false,
    composerReads = 0,
    launchReadyUntil = 0;
  const checkpoint = () => {
    combined.throwIfAborted();
    control.requireSession();
  };
  const report = (phase, action) => onStep?.({ phase, action, steps });
  const observe = async () => {
    checkpoint();
    report('observing', 'observe');
    let result;
    try {
      result = await control.execute({ action: 'observe', vision: false }, combined);
    } catch (error) {
      checkpoint();
      if (
        parsed.action !== 'send_current_message' ||
        inputAttempted ||
        !launch ||
        error.code !== 'COMPUTER_APPLICATION_UNAVAILABLE'
      )
        throw error;
      // Only an explicit app launch can proceed from this non-input placeholder.
      result = { window: {}, targets: [], observationUnavailable: true };
    }
    checkpoint();
    return result;
  };
  try {
    const task = new DiscordGuiTask(parsed, { language });
    let current = await observe();
    for (let decision = 0; decision < 60 && steps < 30; decision++) {
      checkpoint();
      const outcome = task.outcome(current);
      if (outcome) {
        // Do not accept a control label left over from the action's first UI
        // update. Both independent fresh reads must still prove the same goal.
        report('verifying', 'observe');
        const first = await observe(),
          second = await observe();
        const firstOutcome = task.outcome(first),
          secondOutcome = task.outcome(second);
        if (
          !current.window?.windowId ||
          current.window.windowId !== first.window?.windowId ||
          current.window.windowId !== second.window?.windowId ||
          !firstOutcome?.verified ||
          !secondOutcome?.verified
        )
          return failure('changed', steps);
        return { handled: true, success: true, status: 'completed', steps, ...secondOutcome };
      }
      const step = task.next(current);
      if (step.action === 'ask_user') {
        if (!discordObservation(current) && launch && !launchAttempted) {
          checkpoint();
          launchAttempted = true;
          steps++;
          report('acting', 'launch');
          const launched = await launch('Discord', combined);
          checkpoint();
          if (
            parsed.action === 'send_current_message' &&
            (launched?.ok === false || launched?.needsApproval || launched?.needsWindow)
          )
            return failure('blocked', steps, 'needs_user', {
              reason: 'discord_control_unresolved',
            });
          if (parsed.action === 'send_current_message') launchReadyUntil = Date.now() + 5000;
          await delay(180, undefined, { signal: combined });
          current = await observe();
          continue;
        }
        // A newly opened voice-chat sidebar may not have exposed its native
        // composer yet. Retry reads only, before any potentially delivered input.
        if (
          parsed.action === 'send_current_message' &&
          !inputAttempted &&
          ((launchAttempted && !discordObservation(current)) ||
            step.reason === 'discord_current_composer_unavailable') &&
          (launchAttempted ? Date.now() < launchReadyUntil : composerReads++ < 3)
        ) {
          await delay(
            launchAttempted ? Math.min(250, Math.max(1, launchReadyUntil - Date.now())) : 250,
            undefined,
            { signal: combined },
          );
          current = await observe();
          continue;
        }
        // UI search and voice panels update asynchronously. Settle read-only;
        // never repeat the click, the message submit or an uncertain mutation.
        if (
          settling > 0 &&
          !/more than one|multiple|already has a draft|specify which|specify its category/iu.test(
            step.summary,
          )
        ) {
          settling--;
          await delay(250, undefined, { signal: combined });
          current = await observe();
          continue;
        }
        return failure('blocked', steps, 'needs_user', {
          reason: step.reason ?? 'discord_control_unresolved',
        });
      }
      if (step.action === 'finish') return failure('failed', steps);
      if (!['click', 'enter_text', 'press_keys', 'wait', 'observe'].includes(step.action))
        return failure('failed', steps);
      if (step.action === 'wait' || step.action === 'observe') {
        if (step.action === 'wait') await delay(250, undefined, { signal: combined });
        current = await observe();
        continue;
      }
      checkpoint();
      steps++;
      report('acting', step.action);
      const command = {
        action: step.action,
        ...(step.action === 'click'
          ? { targetId: step.targetId, button: 'left', clickCount: 1 }
          : {}),
        ...(step.action === 'enter_text'
          ? { targetId: step.targetId, text: step.text, mode: step.mode ?? 'replace' }
          : {}),
        ...(step.action === 'press_keys'
          ? { keys: step.keys, observationId: current.observationId }
          : {}),
      };
      let result;
      try {
        inputAttempted = true;
        result = await control.execute(
          command,
          combined,
          step.discordMutation ? { discordMutation: step.discordMutation } : undefined,
        );
        task.record(step, result, current);
      } catch (error) {
        task.record(step, { ok: false }, current);
        throw error;
      }
      checkpoint();
      if (result?.ok !== true) return failure('failed', steps);
      settling = 2;
      await delay(180, undefined, { signal: combined });
      current = await observe();
    }
    return failure('limit', steps);
  } catch (error) {
    // Preserve the real owner cancel/Escape/revocation signal for the parent.
    // Diagnostics and user summaries never include native/provider error text,
    // since those errors can contain private window labels or message contents.
    signal?.throwIfAborted();
    sessionSignal?.throwIfAborted();
    const reason = /^COMPUTER_[A-Z_]+$/u.test(error?.code ?? '')
      ? error.code
      : 'discord_action_unverified';
    return failure(timeout.aborted ? 'timeout' : 'failed', steps, 'incomplete', { reason });
  }
}
