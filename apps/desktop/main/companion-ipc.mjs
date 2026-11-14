// SPDX-License-Identifier: GPL-3.0-only
import {
  readFileSync,
  existsSync,
  copyFileSync,
  statSync,
  lstatSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  readCommunicationStyle,
  saveCommunicationStyle,
} from '../../../packages/runtime/src/communication.mjs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { createDiagnosticReport, validateReport } from '../diagnostics/report.mjs';
import { COMMUNITY_LINKS, loadCommunityLinks } from '../community-links.mjs';
export { COMMUNITY_LINKS } from '../community-links.mjs';
import {
  readPersonality,
  defaultPersonality,
  savePersonality,
  PERSONALITY_FILE,
} from '../../../packages/runtime/src/personality.mjs';

export function registerCompanionIpc(handle, deps) {
  const { root, state, rt, preferences, dialog, getWindow, emit, shell } = deps;
  const file = path.join(state, 'wake-audio');
  const links = loadCommunityLinks(root);
  let preparing = false;
  let collectingReport = false;
  const snapshot = () => ({ ...preferences.snapshot(), customAudio: existsSync(file) });
  const currentSettings = () => deps.currentSettings?.() ?? preferences.value;
  handle('capri:companion-settings', (value) => {
    preferences.set(value);
    const next = snapshot();
    emit({ type: 'companion.settings', settings: next });
    return next;
  });
  handle('capri:community-link', async (id) => {
    if (!Object.hasOwn(COMMUNITY_LINKS, id)) throw new Error('Unknown community link');
    await shell.openExternal(links[id]);
  });
  handle('capri:personality-get', () => ({
    text: readPersonality(rt.workspace),
    original: defaultPersonality(),
    communicationStyle: readCommunicationStyle(rt.workspace),
  }));
  handle('capri:communication-style', (style) => saveCommunicationStyle(rt.workspace, style));
  handle('capri:personality-save', (value) => {
    deps.assertIdle();
    return savePersonality(rt.workspace, value);
  });
  handle('capri:personality-open', () => {
    const file = path.join(rt.workspace, PERSONALITY_FILE);
    if (!existsSync(file)) savePersonality(rt.workspace, '');
    shell.showItemInFolder(file);
    return true;
  });
  handle('capri:wake-import', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose a short wake sound (up to 10 seconds)',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }],
    });
    if (result.canceled) return null;
    const source = result.filePaths[0],
      info = statSync(source);
    if (!info.isFile() || info.size > 4 * 1024 * 1024 || !/\.(wav|mp3|ogg|flac|m4a)$/i.test(source))
      throw new Error('Choose an audio file smaller than 4 MB.');
    copyFileSync(source, file);
    return snapshot();
  });
  const wakeVoice = () => {
    const language = deps.wakeLanguage?.() ?? 'en';
    const phrase = currentSettings().wakePhrase;
    const identity = deps.wakeIdentity?.() ?? 'default';
    const text = deps.translateWake?.(phrase, language) ?? phrase;
    const key = createHash('sha256')
      .update(JSON.stringify({ language, phrase, text, identity }))
      .digest('hex')
      .slice(0, 20);
    return { language, phrase, text, file: path.join(state, 'wake-voice-' + key + '.pcm') };
  };
  const voiceCacheReady = (file) => {
    try {
      const info = lstatSync(file);
      return (
        info.isFile() &&
        !info.isSymbolicLink() &&
        info.size > 0 &&
        info.size <= 24000 * 4 * 10 &&
        info.size % 4 === 0
      );
    } catch {
      return false;
    }
  };
  handle('capri:wake-audio', () => {
    const selection = currentSettings().wakeSound === 'voice' ? wakeVoice() : null;
    const selected = selection?.file ?? file;
    if (selection && !voiceCacheReady(selected)) return null;
    if (!existsSync(selected) || statSync(selected).size > 4 * 1024 * 1024) return null;
    return {
      bytes: readFileSync(selected),
      pcm: selected.endsWith('.pcm'),
      sampleRate: 24000,
      ...(selection ? { text: selection.text } : {}),
    };
  });
  const prepareWakeVoice = async () => {
    const selected = wakeVoice();
    if (voiceCacheReady(selected.file)) {
      emit({ type: 'wake.audio-ready' });
      return true;
    }
    deps.assertIdle();
    if (preparing) throw new Error('The wake voice is already being prepared.');
    preparing = true;
    try {
      await deps.prepareVoice();
      const { phrase, language, text } = selected;
      const request = { text, language, requestId: `wake:${randomUUID()}` };
      const signal = AbortSignal.timeout(90000);
      const response = deps.synthesizeVoice
        ? await deps.synthesizeVoice(request, signal)
        : await fetch(`${deps.voiceUrl}/synthesize`, {
            method: 'POST',
            headers: { ...deps.voiceHeaders(), 'content-type': 'application/json' },
            body: JSON.stringify(request),
            signal,
            redirect: 'error',
          });
      if (!response.ok || response.headers.get('x-sample-rate') !== '24000')
        throw new Error('The voice is unavailable. Enable it and retry.');
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 24000 * 4 * 10) throw new Error('Wake audio is too long.');
        chunks.push(chunk);
      }
      if (!size || size % 4) throw new Error('Invalid wake audio');
      const temporary = selected.file + '.' + randomUUID() + '.tmp';
      try {
        writeFileSync(temporary, Buffer.concat(chunks), { flag: 'wx' });
        renameSync(temporary, selected.file);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      emit({ type: 'wake.audio-ready' });
      return true;
    } finally {
      preparing = false;
    }
  };
  handle('capri:wake-prepare', prepareWakeVoice);
  snapshot.prepareWakeVoice = prepareWakeVoice;
  handle('capri:reset-context', () => deps.resetContext());
  handle('capri:reset-memory', () => deps.resetMemory());
  const createReport = (input) =>
    (deps.createReport ?? createDiagnosticReport)({
      root: deps.diagnosticRoot ?? root,
      state,
      rt,
      input,
      snapshot: deps.diagnosticSnapshot?.() ?? {},
      resourceProbe: deps.diagnosticResources,
      health: deps.verification
        ? async () => ({
            available: false,
            error: 'Verification mode: real services were not queried',
          })
        : deps.voiceHealth,
      ...(deps.verification ? { installerDirectory: null } : {}),
    });
  handle('capri:bug-report-send', async (value, { role }) => {
    if (role !== 'settings' || deps.verification) throw new Error('Open Report a bug in Settings.');
    const input = validateReport(value);
    if (!input.description) throw new Error('Describe the problem before sending the report.');
    if (collectingReport) throw new Error('A diagnostic report is already being collected.');
    collectingReport = true;
    try {
      const report = await createReport(input);
      if (report.bytes.length > 4 * 1024 ** 2)
        throw new Error('The report is too large. Try sending without recent logs.');
      const response = await fetch('https://capri-core.com/api/reports/v1', {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        body: report.bytes,
      }).catch(() => null);
      const id = response?.headers.get('x-capri-report-id');
      await response?.body?.cancel();
      if (response?.status !== 202 || !/^[a-f0-9]{32}$/u.test(id ?? ''))
        throw new Error('The report could not be sent. You can save a ZIP and share it manually.');
      return { sent: true, reportId: id };
    } finally {
      collectingReport = false;
    }
  });
  handle('capri:bug-report', async (value) => {
    const input = validateReport(value);
    if (collectingReport) throw new Error('A diagnostic report is already being collected.');
    collectingReport = true;
    let temporary;
    try {
      const destination = await dialog.showSaveDialog(getWindow(), {
        title: 'Save and review bug report',
        defaultPath: `capri-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: 'Diagnostic ZIP archive', extensions: ['zip'] }],
      });
      if (destination.canceled) return false;
      const report = await createReport(input);
      temporary = destination.filePath + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, report.bytes, { flag: 'wx' });
      await rename(temporary, destination.filePath);
      shell.showItemInFolder?.(destination.filePath);
      return {
        saved: true,
        reportId: report.id,
        files: report.fileCount,
        bytes: report.bytes.length,
      };
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      collectingReport = false;
    }
  });
  return snapshot;
}
