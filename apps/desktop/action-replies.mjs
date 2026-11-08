// SPDX-License-Identifier: GPL-3.0-only
import { uiText } from './renderer/interface-translations.mjs';
const mutations = {
  filesystem_control: [
    'write_text',
    'replace_text',
    'create_directory',
    'copy',
    'move',
    'undo',
    'trash',
  ],
  time_control: ['remind', 'timer', 'stopwatch', 'pause', 'resume', 'reset', 'cancel', 'snooze'],
  // Opening an app is only a substep of many desktop requests. Let the final
  // reply explain the complete task; do not replace it with a launch receipt.
  desktop_control: ['type_text', 'open_url', 'trash', 'browser_input'],
};
export function factualActionReply(tool, args, result, language = 'en') {
  if (
    tool === 'desktop_control' &&
    args.action === 'browser_input' &&
    (result?.typed !== true || result?.submitted !== false)
  )
    return null;
  if (
    result?.ok === true &&
    tool === 'application_control' &&
    args.action === 'calculate' &&
    typeof result.result === 'string'
  )
    return uiText('Result: {value}', language, {
      value: (result.displayResult ?? result.result) + (result.unit ? ' ' + result.unit : ''),
    });
  if (
    result?.ok === true &&
    tool === 'spotify_control' &&
    args.action === 'volume' &&
    Number.isFinite(result.data?.volumePercent)
  )
    return uiText('Spotify volume: {value}%.', language, { value: result.data.volumePercent });
  if (result?.ok === true && tool === 'spotify_control') {
    const data = result.data ?? {};
    const text =
      ['pause', 'resume', 'toggle', 'play', 'next', 'previous'].includes(args.action) &&
      typeof data.playing === 'boolean'
        ? data.playing
          ? 'Resumed.'
          : 'Paused.'
        : null;
    if (text) return uiText(text, language);
  }
  if (
    result?.ok !== true ||
    result.cancelled ||
    result.needsWindow ||
    !mutations[tool]?.includes(args.action)
  )
    return null;
  const keys = {
    write_text: 'Created the text file.',
    replace_text: 'Replaced the existing file.',
    create_directory: 'Created the folder.',
    copy: 'Copied the file.',
    move: 'Moved the file.',
    undo: 'Undid the file action.',
    trash: 'Moved the file to the Recycle Bin.',
    stopwatch: 'Stopwatch started.',
    pause: 'Paused.',
    resume: 'Resumed.',
    reset: 'Stopwatch reset.',
    cancel: 'Cancelled.',
    remind: 'Reminder set.',
    timer: 'Timer started.',
    snooze: 'Reminder snoozed.',
    launch:
      result.windowVerified === false
        ? 'Launch requested. No app window could be verified yet.'
        : 'Opened the application.',
    type_text: 'Entered the text without sending it.',
    browser_input: 'Entered the text without sending it.',
    open_url: 'Opened the address in the browser.',
  };
  return uiText(keys[args.action], language);
}
/** Drop stock conversational nudges only on tool turns, before either subtitles or speech. */
export class ActionReplyFilter {
  constructor() {
    this.buffer = '';
    this.enabled = false;
  }
  push(text, final = false) {
    if (!this.enabled) return text;
    this.buffer += text;
    let output = '',
      match;
    while ((match = this.buffer.match(/^([\s\S]*?[.!?。！？](?:\s+|$))/u))) {
      const sentence = match[1];
      this.buffer = this.buffer.slice(sentence.length);
      if (!this.generic(sentence)) output += sentence;
    }
    if (final && this.buffer) {
      if (!this.generic(this.buffer)) output += this.buffer;
      this.buffer = '';
    }
    return output;
  }
  generic(text) {
    return /^(?:(?:and|so|а|ну|и)\s+)?(?:what(?:['’]s| is)\s+(?:next|on your mind)|what (?:else|would you like to do next)|anything else|чт[оё]\s+(?:дальше|ещ[её]|у тебя на уме)|что (?:хочешь|будем) делать дальше|чем ещ[её] (?:помочь|могу помочь)|как(?:ие)?\s+(?:дальше планы|планы))[^.!?。！？]*[?？]?\s*$/iu.test(
      text.trim(),
    );
  }
}
