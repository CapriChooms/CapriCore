// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { loadStartupIntro } from '../startup-intro-assets.mjs';
const rendererFiles = [
  'index.html',
  'minimized-chip.html',
  'minimized-chip.css',
  'minimized-chip.mjs',
  'recording-indicator.html',
  'recording-indicator.css',
  'recording-indicator.mjs',
  'settings.html',
  'settings.css',
  'model-device-panel.mjs',
  'credits.css',
  'credits-panel.mjs',
  'settings-app.mjs',
  'settings-api.mjs',
  'settings-registry.mjs',
  'settings-search.mjs',
  'settings-location.mjs',
  'settings-help.html',
  'settings-help.css',
  'settings-help.mjs',
  'stopwatch-hud.mjs',
  'memory-hud.mjs',
  'motion-settings.mjs',
  'app.js',
  'attachment-composer.mjs',
  'clipboard-files.mjs',
  'history-attachments.mjs',
  'attachment-viewer.html',
  'attachment-viewer.mjs',
  'attachment-viewer.css',
  'styles.css',
  'cyberpunk.css',
  'presence-model.mjs',
  'thinking-mode.mjs',
  'internet-mode.mjs',
  'thinking-mode.css',
  'signal-fx.mjs',
  'glitch-settings.mjs',
  'interface-theme.mjs',
  'panel-frames.mjs',
  'crt-screen.mjs',
  'screen-geometry.mjs',
  'animation-director.mjs',
  'avatar-mouth.mjs',
  'avatar-drag-tether.mjs',
  'avatar-detach.html',
  'avatar-detach.css',
  'avatar-detach.mjs',
  'detached-reply-layout.mjs',
  'reply-bubble-outline.mjs',
  'reply-pages.mjs',
  'avatar-composer.html',
  'avatar-composer.css',
  'avatar-composer.mjs',
  'avatar-headpat.mjs',
  'avatar-tap-effect.mjs',
  'avatar-headpat.css',
  'avatar-teleport-motion.mjs',
  'avatar-teleport-sound.mjs',
  'dimming-settings.mjs',
  'dimming-mask.mjs',
  'overflow-ticker.mjs',
  'subtitles.mjs',
  'subtitle-controller.mjs',
  'speech-text.mjs',
  'voice-player.mjs',
  'reply-visibility.mjs',
  'call-audio-settings.mjs',
  'call-audio-route.mjs',
  'call-microphone.mjs',
  'voice-effects.mjs',
  'voice-effects-settings.mjs',
  'voice-effects-panel.mjs',
  'speech-panel.mjs',
  'speech-settings.mjs',
  'interface-translations.mjs',
  'language-settings.mjs',
  'language-panel.mjs',
  'companion-panel.mjs',
  'saved-memory-panel.mjs',
  'knowledge-panel.mjs',
  'private-memory-panel.mjs',
  'workflows-panel.mjs',
  'user-tools-panel.mjs',
  'updates-panel.mjs',
  'update-notification.mjs',
  'update-notification.css',
  'models-panel.mjs',
  'huggingface-panel.mjs',
  'voice-model-panel.mjs',
  'discord-panel.mjs',
  'inference-panel.mjs',
  'inference-picker.mjs',
  'inference-endpoint.mjs',
  'api-key.mjs',
  'music-animation.mjs',
  'system-music-capture.mjs',
  'music-worklet.mjs',
  'music-listening-panel.mjs',
  'inference-privacy.mjs',
  'control-overlay.html',
  'control-overlay.css',
  'control-overlay.mjs',
  'computer-appearance-panel.mjs',
  'confirmation-dialog.mjs',
  'confirmation-requests.mjs',
  'button-feedback.mjs',
  'startup-panel.mjs',
  'startup-intro.mjs',
  'startup-intro-motion.mjs',
  'microphone-button.mjs',
  'file-access-panel.mjs',
  'applications-panel.mjs',
  'initiative-panel.mjs',
  'screen-panel.mjs',
  'screen-mosaic.mjs',
  'time-panel.mjs',
  'screen-watch.mjs',
  'screen-change.mjs',
  'microphone.mjs',
  'wake-feedback.mjs',
  'microphone-worklet.mjs',
];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};
/** An explicit resource table; never expose a directory or user-supplied path. */
export function createDesktopResources({
  root,
  directory,
  catalog,
  spriteFile,
  startupIntro = loadStartupIntro(root),
}) {
  const resources = new Map(
    rendererFiles.map((name) => [
      '/' + name,
      { file: path.join(directory, 'renderer', name), type: types[path.extname(name)] },
    ]),
  );
  for (const name of [
    'clip-command.mjs',
    'credits-epithets.mjs',
    'wake-phrase.mjs',
    'avatar-layout.mjs',
    'music-listening-settings.mjs',
    'avatar-body-regions.mjs',
    'avatar-grip-rig.mjs',
    'avatar-pose-motion.mjs',
    'sleep-service.mjs',
  ])
    resources.set('/' + name, { file: path.join(directory, name), type: types['.mjs'] });
  for (const name of ['languages.json', 'interface-locales.json'])
    resources.set('/shared/' + name, {
      file: path.join(root, 'apps/shared', name),
      type: 'application/json; charset=utf-8',
    });
  resources.set('/hall-of-fame.json', {
    file: path.join(root, 'config/hall-of-fame.json'),
    type: 'application/json; charset=utf-8',
  });
  for (const name of ['pdf.mjs', 'pdf.worker.mjs'])
    resources.set('/attachment-' + name, {
      file: path.join(root, 'node_modules/pdfjs-dist/build', name),
      type: types['.mjs'],
    });
  resources.set('/fonts/exo2.ttf', {
    file: path.join(root, 'assets/fonts/exo2/Exo2-Variable.ttf'),
    type: 'font/ttf',
  });
  resources.set('/sprite.png', { file: spriteFile, type: 'image/png' });
  resources.set('/headpat-face.png', {
    file: path.join(root, 'assets/default/capri-headpat.png'),
    type: 'image/png',
  });
  for (const brand of ['boosty', 'discord', 'github', 'capricore'])
    resources.set(`/brand/${brand}.svg`, {
      file: path.join(root, 'assets/default/brand', `${brand}.svg`),
      type: 'image/svg+xml',
    });
  for (const frame of catalog.portraitFrames)
    resources.set(`/sprites/${frame.id}.png`, { file: frame.file, type: 'image/png' });
  for (const frame of catalog.desktopPoseFrames ?? [])
    resources.set(new URL(frame.url).pathname, { file: frame.file, type: 'image/png' });
  for (const note of catalog.musicNotes ?? [])
    resources.set(new URL(note.url).pathname, { file: note.file, type: 'image/png' });
  for (const frame of startupIntro?.frames ?? [])
    resources.set(new URL(frame.url).pathname, { file: frame.file, type: 'image/png' });
  return resources;
}
