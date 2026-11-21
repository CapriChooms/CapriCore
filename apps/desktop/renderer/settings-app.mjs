import { InferencePanel } from './inference-panel.mjs';
import { ExternalTtsPanel } from './external-tts-panel.mjs';
import { finishSettingsLoading, panelLoading } from './settings-loading.mjs';
import { KnowledgePanel } from './knowledge-panel.mjs';
import { WorkflowsPanel } from './workflows-panel.mjs';
import { CodingPanel } from './coding-panel.mjs';
import { ChessPanel } from './chess-panel.mjs';
import { UserToolsPanel } from './user-tools-panel.mjs';
import { CreditsPanel } from './credits-panel.mjs';
import { DeveloperPanel } from './developer-panel.mjs';
import { inferencePrivacy } from './inference-privacy.mjs';
import { DiscordPanel } from './discord-panel.mjs';
import { MusicListeningPanel } from './music-listening-panel.mjs';
import { AudioRoutingPanel } from './audio-routing-panel.mjs';
import { bindAudioOutput, createAudioOutputContext } from './local-audio-output.mjs';
// SPDX-License-Identifier: GPL-3.0-only
import { InterfaceLanguage, validateLanguages } from './language-settings.mjs';
import { prepareInterfaceLocale } from './interface-translations.mjs';
import { LanguagePanel } from './language-panel.mjs';
import { CompanionPanel } from './companion-panel.mjs';
import { ModelsPanel } from './models-panel.mjs';
import { UpdatesPanel } from './updates-panel.mjs';
import { VoiceEffectsPanel } from './voice-effects-panel.mjs';
import { FileAccessPanel } from './file-access-panel.mjs';
import { ApplicationsPanel } from './applications-panel.mjs';
import { InitiativePanel } from './initiative-panel.mjs';
import { SpeechPanel } from './speech-panel.mjs';
import { microphoneConstraints } from './microphone.mjs';
import { screenObservationText, screenSourceLabel } from './screen-panel.mjs';
import { TimePanel } from './time-panel.mjs';
import { ConfirmationDialog } from './confirmation-dialog.mjs';
import { ConfirmationRequests } from './confirmation-requests.mjs';
import { settingsApi } from './settings-api.mjs';
import { COMPOSER_SKILLS } from '../../../packages/skills/src/settings-catalog.mjs';
import {
  TEXT_ATTACHMENTS,
  OFFICE_ATTACHMENTS,
  IMAGE_ATTACHMENTS,
  FRAME_ATTACHMENTS,
} from '../../../packages/skills/src/attachment-formats.mjs';
import { ButtonFeedback } from './button-feedback.mjs';
import { PanelFrames } from './panel-frames.mjs';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SKILL_BY_SECTION,
  settingsSection,
} from './settings-registry.mjs';
import { findSettings, indexSettings } from './settings-search.mjs';
import { SettingsLocation } from './settings-location.mjs';
import { SettingsGuide } from './settings-guide.mjs';
import { interferenceFrame } from './presence-model.mjs';
import { CALL_VOICE_VOLUME_DEFAULT } from './call-audio-settings.mjs';
import { dimmingFeatherWidth } from './dimming-settings.mjs';
import { CAMERA_BACKGROUND_COLOR, CAMERA_HEIGHT, CAMERA_WIDTH } from '../call-camera-protocol.mjs';

const raw = window.capri,
  ui = new InterfaceLanguage(),
  dirty = new Set(),
  writes = new Set();
const $ = (id) => document.getElementById(id);
const location = new SettingsLocation(SETTINGS_SECTIONS.map(([id]) => id));
let locationSuspended = false,
  locationTimer;
function rememberLocation() {
  clearTimeout(locationTimer);
  if (!current || busy || locationSuspended || $('capri-guide').open) return;
  location.remember(current, $('companion').scrollTop, $('settings-navigation').scrollTop);
}
function restoreLocation() {
  $('companion').scrollTop = location.top(current);
  $('settings-navigation').scrollTop = location.navigation;
}
for (const id of ['companion', 'settings-navigation'])
  $(id).addEventListener(
    'scroll',
    () => {
      if (busy || locationSuspended) return;
      clearTimeout(locationTimer);
      locationTimer = setTimeout(rememberLocation, 120);
    },
    { passive: true },
  );
window.addEventListener('beforeunload', rememberLocation);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) rememberLocation();
});
let current = null,
  busy = false,
  frames,
  companion,
  language,
  noticeTimer,
  latest;
let revisions = {};
let firstContentFrame;
let closeRequested = false,
  applyingDraft = false,
  resettingSettings = false,
  previewTimer,
  previewTail = Promise.resolve(),
  lastPreview;
const deferred = new Map();
new ButtonFeedback();
function notice(message = '') {
  message = String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  clearTimeout(noticeTimer);
  $('settings-notice').textContent = ui.text(message);
  $('settings-notice').hidden = !message;
  if (message) noticeTimer = setTimeout(() => notice(), 10000);
}
const api = settingsApi(raw, {
  writes,
  revisions: () => revisions,
  saved: (panel) => {
    deferred.delete(panel);
  },
});
const confirm = new ConfirmationDialog({ ui, onChange: () => {} });
const confirmationRequests = new ConfirmationRequests({
  dialog: confirm,
  prepare: async () => {
    await Promise.allSettled([...writes]);
    return !applyingDraft;
  },
  respond: (value) => raw.confirmAction(value),
});
async function close() {
  if (settingsGuide.active) {
    settingsGuide.close();
    return;
  }
  if (applyingDraft || resettingSettings || document.querySelector('dialog[open]')) return;
  stopMicrophoneMonitor();
  companion.stopWakePreview();
  await Promise.allSettled([...writes]);
  closeRequested = true;
  if (!syncDraftActions().length) {
    closeRequested = false;
    await finishClose();
    return;
  }
  $('settings-apply').focus({ preventScroll: true });
}
const response = await fetch('index.html');
if (!response.ok) throw new Error('Settings forms unavailable');
const template = new DOMParser().parseFromString(await response.text(), 'text/html');
for (const form of template.querySelectorAll('.preferences-panel, #dimming-panel'))
  $('settings-forms').append(form.cloneNode(true));
const chess = new ChessPanel({ api: raw.chess, ui, host: $('settings-forms') });
const general = document.createElement('section');
general.id = 'general-panel';
general.className = 'preferences-panel';
general.hidden = true;
general.dataset.panelCut = '12';
general.innerHTML = `
  <h2>General</h2>
  <p id="general-status" role="status"></p>
  <div class="preferences-content">
  <section class="settings-card general-group" aria-labelledby="general-window-title">
    <h3 id="general-window-title">Window controls</h3>
    <div class="general-setting">
      <button type="button" data-window-action="hide" aria-describedby="general-hide-help">Hide to tray</button>
      <p id="general-hide-help">Hide the companion window. Bring it back from the system tray.</p>
    </div>
    <div class="general-setting">
      <button type="button" data-window-action="reset-avatar" aria-describedby="general-reset-avatar-help">Reset Capri position and zoom</button>
      <p id="general-reset-avatar-help">Restore Capri’s default position and zoom inside the window.</p>
    </div>
    <div class="general-setting">
      <button type="button" data-window-action="reset-position" aria-describedby="general-reset-position-help">Reset to bottom-right corner</button>
      <p id="general-reset-position-help">Move the companion window to the bottom-right of the primary display.</p>
    </div>
    <div class="general-setting general-switch-row">
      <button id="general-on-top" type="button" class="general-toggle" role="switch" aria-checked="false" aria-pressed="false" aria-describedby="general-on-top-help"><span>Always on top</span><span class="general-switch-track" aria-hidden="true"></span></button>
      <p id="general-on-top-help">Keep the companion window above other windows.</p>
    </div>
    <div class="general-setting general-switch-row">
      <button id="general-portrait" type="button" class="general-toggle" role="switch" aria-checked="false" aria-pressed="false" aria-describedby="general-portrait-help"><span>Keep portrait open</span><span class="general-switch-track" aria-hidden="true"></span></button>
      <p id="general-portrait-help">Keep the portrait visible. Turning this off restores the compact view.</p>
    </div>
    <div class="general-setting general-switch-row">
      <button type="button" class="general-toggle" role="switch" data-window-action="focus-mode" aria-checked="false" aria-pressed="false" aria-describedby="general-focus-mode-help"><span>Focus mode</span><span class="general-switch-track" aria-hidden="true"></span></button>
      <p id="general-focus-mode-help">Hide both windows until you bring Capri back from the system tray.</p>
    </div>
  </section>
  <section class="settings-card general-group" aria-labelledby="general-session-title">
    <h3 id="general-session-title">Connection, sleep and quit</h3>
    <div class="general-setting">
      <button type="button" data-window-action="reconnect" aria-describedby="general-reconnect-help">Reconnect</button>
      <p id="general-reconnect-help">Retry the connection or wake Capri if she’s asleep.</p>
    </div>
    <div class="general-setting">
      <button type="button" data-window-action="sleep" aria-describedby="general-sleep-help">Sleep</button>
      <p id="general-sleep-help">Models will be loaded again when you wake Capri.</p>
    </div>
    <div class="general-setting">
      <button type="button" class="danger-action" data-window-action="quit" aria-describedby="general-quit-help">Quit and unload models</button>
      <p id="general-quit-help">Capri will close and unload the local models. Any active reply will stop.</p>
    </div>
  </section>
  <section class="settings-card general-group" aria-labelledby="general-reset-title">
    <h3 id="general-reset-title">Settings reset</h3>
    <div class="general-setting">
      <button type="button" class="danger-action" id="general-reset-settings" aria-describedby="general-reset-help">Reset settings to defaults</button>
      <p id="general-reset-help">Your conversations, memory, installed models, connections and permissions are kept.</p>
    </div>
  </section>
  </div>
`;
$('settings-forms').append(general);
const shared = {
  api,
  ui,
  onError: notice,
  onOpen: async (open) => {
    if (!open) {
      await close();
      return false;
    }
    return true;
  },
};
language = new LanguagePanel({ ...shared, confirm, onChange: () => renderNavigation() });
companion = new CompanionPanel({
  ...shared,
  confirm,
  wakeOutputDevice: () => audioPlaybackDevice,
  deferDrafts: true,
  onChange: () => {
    captureDrafts('companion-settings');
    syncDraftActions();
  },
});
const models = new ModelsPanel(shared),
  updates = new UpdatesPanel({ ...shared, deferDrafts: true });
const inference = new InferencePanel({ api, ui, onError: notice });
const voiceApi = new ExternalTtsPanel({ api, ui });
const audioRouting = new AudioRoutingPanel({
  api: raw,
  ui,
  onError: notice,
  onOpenSettings: async (section) => {
    await navigate(section);
    if (section === 'calls' && audioRouting.value?.routes?.call) {
      $('call-output-advanced').open = true;
      $('call-output-device').scrollIntoView({ block: 'center' });
    }
  },
});
$('settings-forms').append(audioRouting.panel);
let audioPlaybackDevice = '';
function showAudioRouting(snapshot) {
  if (!snapshot) return;
  audioRouting.show(snapshot);
  if (snapshot.routes) {
    const id = snapshot.routes.speaker ?? '';
    if (audioPlaybackDevice !== id) {
      stopMicrophoneMonitor();
      companion.stopWakePreview();
    }
    audioPlaybackDevice = id;
    voiceApi.setOutputDevice(id);
    models.voices.setOutputDevice(id);
    time.setOutputDevice(id);
  }
}
const knowledge = new KnowledgePanel({ api, ui, onError: notice });
const workflows = new WorkflowsPanel({ api, ui, onError: notice });
const coding = new CodingPanel({ api, ui, onError: notice });
const userTools = new UserToolsPanel({ api, ui, onError: notice });
const credits = new CreditsPanel({ ui });
const developer = new DeveloperPanel({ api, ui, onError: notice });
const discord = new DiscordPanel(shared);
const music = new MusicListeningPanel({
  api,
  ui,
  onError: notice,
  revision: () => revisions.musicListening,
  onChange: () => {
    syncDraftActions();
    queuePreview();
  },
  onCommitted: (snapshot) => {
    if (snapshot.settingsVersions?.musicListening !== undefined)
      revisions.musicListening = snapshot.settingsVersions.musicListening;
    if (
      snapshot.settings &&
      ['enabled', 'notes', 'motion'].every((key) => music.draft()[key] === snapshot.settings[key])
    ) {
      deferred.delete(music.panel.id);
      captureDrafts(music.panel.id);
    }
    syncDraftActions();
    queuePreview();
  },
});
raw.onEvent((event) => {
  if (event.type === 'discord.presence') discord.status(event.settings);
});
const effects = new VoiceEffectsPanel({ ...shared, onSettings: () => {}, deferDrafts: true });
const files = new FileAccessPanel(shared),
  applications = new ApplicationsPanel({
    ...shared,
    deferDrafts: true,
    resumeApplicationAccess: async () => {
      const { id } = SKILL_BY_SECTION.applications;
      if (!skillState[id]?.enabled) {
        await raw.setSkill({ id, enabled: true });
        return raw.applicationAccess();
      }
      return raw.applicationAccess(true);
    },
  });
raw.onEvent((event) => {
  if (event.type === 'computer-access') applications.showComputerAccess(event.settings);
});
const initiative = new InitiativePanel(shared),
  speech = new SpeechPanel(shared),
  time = new TimePanel(shared);

function skillPanel(section, ...controls) {
  const panel = document.createElement('section');
  panel.id = section + '-panel';
  panel.className = 'preferences-panel';
  panel.hidden = true;
  panel.dataset.panelCut = '12';
  const heading = document.createElement('h2');
  heading.textContent = SKILL_BY_SECTION[section].name;
  const content = document.createElement('div');
  content.className = 'preferences-content';
  content.append(...controls);
  panel.append(heading, content);
  $('settings-forms').append(panel);
}

const reasoningSettings = document.createElement('div');
reasoningSettings.className = 'settings-card';
reasoningSettings.innerHTML = `<label for="reasoning-effort">Reasoning effort</label>
  <select id="reasoning-effort" aria-describedby="reasoning-effort-help">
    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
  </select>
  <p id="reasoning-effort-help" class="settings-help">Higher effort gives supported models more time and tokens for difficult requests.</p>`;
skillPanel('reasoning', reasoningSettings);
const webSearchOptions = document.createElement('div');
webSearchOptions.className = 'settings-card';
webSearchOptions.innerHTML = `<label for="web-search-engine">Search engine</label>
  <select id="web-search-engine"><option value="duckduckgo">DuckDuckGo</option><option value="wikipedia">Wikipedia</option></select>
  <label for="web-search-sort">Result order</label>
  <select id="web-search-sort"><option value="relevance">Relevance</option><option value="title">Title (A–Z)</option></select>`;
const webSearchFilter = document.createElement('div');
webSearchFilter.className = 'settings-card';
webSearchFilter.innerHTML = `<label for="web-search-domains">Website domains</label>
  <input id="web-search-domains" type="text" maxlength="512" placeholder="example.org, example.com" aria-describedby="web-search-filter-help">
  <label><input type="checkbox" id="web-search-exclude"> Exclude these domains</label>
  <p id="web-search-filter-help" class="settings-help">Enter domains to keep only results from those sites. Leave empty for all websites.</p>`;
const webSearchActions = document.createElement('div');
webSearchActions.className = 'settings-actions';
webSearchActions.innerHTML =
  '<button id="web-search-save" type="button">Save search settings</button>';
skillPanel('web-search', webSearchOptions, webSearchFilter, webSearchActions);
const attachmentFormats = document.createElement('div');
attachmentFormats.className = 'settings-card';
attachmentFormats.innerHTML = `
  <h3>Formats supported by the current model</h3>
  <dl>
    <dt>Documents</dt><dd data-untranslated>${[...TEXT_ATTACHMENTS, ...Object.keys(OFFICE_ATTACHMENTS)].map((ext) => '.' + ext).join(', ')}</dd>
    <dt>Images</dt><dd id="attachment-format-images"></dd>
    <dt>GIF and video frames</dt><dd id="attachment-format-frames"></dd>
  </dl>`;
skillPanel('attachments', attachmentFormats);
function showAttachmentFormats(vision) {
  for (const [id, formats] of [
    ['attachment-format-images', IMAGE_ATTACHMENTS],
    ['attachment-format-frames', FRAME_ATTACHMENTS],
  ]) {
    $(id).textContent = vision
      ? formats.map((ext) => '.' + ext).join(', ')
      : ui.text('The active model cannot read images or video frames.');
  }
}
reasoningSettings.querySelector('select').onchange = ({ currentTarget }) =>
  void changeSkill(SKILL_BY_SECTION.reasoning, { effort: currentTarget.value });
$('web-search-save').onclick = () =>
  void changeSkill(SKILL_BY_SECTION['web-search'], {
    search: {
      engine: $('web-search-engine').value,
      sort: $('web-search-sort').value,
      domains: $('web-search-domains').value,
      exclude: $('web-search-exclude').checked,
    },
  });
skillPanel('private-memory', $('private-memory-controls'));
const spotifyAccess = applications.panel.querySelector('.spotify-access');
spotifyAccess.classList.add('settings-card');
skillPanel('spotify', spotifyAccess);
const youtubeMusicAccess = document.createElement('section');
youtubeMusicAccess.className = 'settings-card';
youtubeMusicAccess.innerHTML = `
  <p id="youtube-music-help">Use YouTube Music in your browser. Sign in there to use your account. Capri controls only the YouTube Music tab.</p>
  <label><input id="youtube-music-preferred" type="checkbox"> <span>Use YouTube Music for music requests</span></label>
  <div class="settings-actions">
    <button id="youtube-music-open" type="button" aria-describedby="youtube-music-help">Open YouTube Music</button>
    <button id="youtube-music-check" type="button">Verify connection</button>
  </div>
  <p id="youtube-music-status" role="status" data-untranslated></p>`;
skillPanel('youtube-music', youtubeMusicAccess);
const youtubeMusicSkill = SKILL_BY_SECTION['youtube-music'];
let youtubeMusicStatus = '';
let youtubeMusicRequest;
function showYouTubeMusicSettings() {
  const saved = skillState[youtubeMusicSkill.id];
  const pending = pendingSkills.get(youtubeMusicSkill.id);
  const enabled = (pending?.enabled ?? saved?.enabled) === true;
  const preferred = $('youtube-music-preferred');
  preferred.checked = (pending?.preferred ?? saved?.preferred) === true;
  preferred.disabled = !enabled || Boolean(pending);
  $('youtube-music-open').disabled = $('youtube-music-check').disabled =
    !enabled || Boolean(youtubeMusicRequest || pending);
  const status =
    youtubeMusicRequest?.op === 'verify'
      ? 'Checking YouTube Music connection…'
      : youtubeMusicStatus || 'YouTube Music control is enabled.';
  $('youtube-music-status').textContent = ui.text(
    enabled ? status : 'Enable YouTube Music in Settings → Skills first.',
  );
}
async function runYouTubeMusic(op) {
  if (youtubeMusicRequest || !skillState[youtubeMusicSkill.id]?.enabled) return;
  const request = { op };
  youtubeMusicRequest = request;
  showYouTubeMusicSettings();
  try {
    const result = await raw.youtubeMusic(request);
    if (youtubeMusicRequest === request) youtubeMusicStatus = result.message;
  } catch {
    if (youtubeMusicRequest === request)
      youtubeMusicStatus = 'YouTube Music did not confirm this action. Check the player.';
  } finally {
    if (youtubeMusicRequest === request) {
      youtubeMusicRequest = undefined;
      showYouTubeMusicSettings();
    }
  }
}
$('youtube-music-open').onclick = () => void runYouTubeMusic('open');
$('youtube-music-check').onclick = () => void runYouTubeMusic('verify');
$('youtube-music-preferred').onchange = ({ currentTarget }) =>
  void changeSkill(youtubeMusicSkill, { preferred: currentTarget.checked });
const calculatorPermission = $('application-calculator').closest('label');
const calculatorDisplay = document.createElement('label');
calculatorDisplay.innerHTML =
  '<input id="calculator-show-window" type="checkbox"> <span>Show calculations in Windows Calculator</span>';
calculatorDisplay.querySelector('input').onchange = ({ currentTarget }) =>
  void changeSkill(SKILL_BY_SECTION.calculator, { showWindow: currentTarget.checked });
const calculatorCard = document.createElement('div');
calculatorCard.className = 'settings-card';
calculatorCard.append(calculatorDisplay);
skillPanel('calculator', calculatorCard);
calculatorPermission.nextElementSibling.remove();
calculatorPermission.hidden = true;
calculatorPermission.setAttribute('aria-hidden', 'true');
$('application-access-pause').closest('.settings-card').hidden = true;
$('application-access-pause').closest('.settings-card').setAttribute('aria-hidden', 'true');
$('brain-enabled').closest('label').hidden = true;
$('brain-enabled').closest('label').setAttribute('aria-hidden', 'true');
$('discord-enabled').closest('label').hidden = true;
$('discord-enabled').closest('label').setAttribute('aria-hidden', 'true');
const voiceContent = effects.panel.querySelector('.preferences-content');
function moveLanguageControls(id, host) {
  const card = $('language-' + id + '-controls');
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Apply languages';
  apply.onclick = async () => {
    apply.disabled = true;
    try {
      if ((await language.apply()) !== false) captureDrafts('language-panel');
    } catch (error) {
      notice(error.message);
    } finally {
      apply.disabled = false;
      syncDraftActions();
    }
  };
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.append(apply);
  card.append(actions);
  host.prepend(card);
  return card;
}
const voiceLanguageControls = moveLanguageControls('speech', voiceContent);
const recognitionLanguageControls = moveLanguageControls(
  'recognition',
  speech.panel.querySelector('.preferences-content'),
);
const speechInstallation = document.createElement('div');
speechInstallation.append(
  $('language-install-speech').closest('.settings-actions'),
  $('language-install-details'),
  $('language-install-progress'),
);
voiceLanguageControls.lastElementChild.before(speechInstallation);
const effectHeading = document.createElement('h3');
effectHeading.textContent = 'Voice effects';
$('voice-effects-card').prepend(effectHeading);
const voiceSources = document.createElement('div');
voiceSources.className = 'settings-card';
voiceSources.innerHTML = `
  <p id="voice-source-status" role="status"></p>
  <div class="settings-actions" role="group" aria-label="Current voice source">
    <button id="voice-source-local" type="button" aria-controls="voice-local-settings">Local</button>
    <button id="voice-source-api" type="button" aria-controls="external-tts-panel">Voice API</button>
  </div>`;
const localVoicePanel = document.createElement('div');
localVoicePanel.id = 'voice-local-settings';
localVoicePanel.className = 'settings-stack';
localVoicePanel.innerHTML =
  '<div class="settings-actions" id="voice-use-local-actions" hidden><button id="voice-use-local" type="button">Use local voice</button></div>';
voiceLanguageControls.before(voiceSources, localVoicePanel, voiceApi.panel);
localVoicePanel.append(voiceLanguageControls, models.voices.panel);
voiceApi.panel.classList.remove('preferences-panel');
voiceApi.panel.classList.add('skill-embedded-panel');
delete voiceApi.panel.dataset.panelCut;
function showVoiceSource(page) {
  $('voice-source-local').setAttribute('aria-pressed', String(page === 'local'));
  $('voice-source-api').setAttribute('aria-pressed', String(page === 'api'));
  localVoicePanel.hidden = page !== 'local';
  voiceApi.panel.hidden = page !== 'api';
}
$('voice-source-local').onclick = () => showVoiceSource('local');
$('voice-source-api').onclick = () => showVoiceSource('api');
$('voice-use-local').onclick = () => void voiceApi.setEnabled(false);
voiceApi.onSourceChange = (cloud, busy) => {
  $('voice-source-status').textContent =
    ui.text('Current voice source') + ' · ' + ui.text(cloud ? 'Cloud voice' : 'Local');
  $('voice-use-local-actions').hidden = !cloud;
  $('voice-use-local').disabled = busy;
};
const drafts = [];
function addDraft(section, panel, read, apply, discard, preview) {
  const draft = { section, panel, read, apply, discard, preview, baseline: undefined };
  drafts.push(draft);
  return draft;
}
function fieldsValue(roots, include = () => true) {
  return JSON.stringify(
    roots.flatMap((root) =>
      [...root.querySelectorAll('input:not([type="file"]), select, textarea')]
        .filter(include)
        .map((field) => [
          field.id,
          field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value,
        ]),
    ),
  );
}
function captureDrafts(panel) {
  for (const draft of drafts)
    if (
      draft.panel === panel ||
      (!panel && draft.section === current && draft.baseline === undefined)
    )
      draft.baseline = draft.read();
}
function syncDraftActions() {
  const changes = drafts.filter(
    (draft) => draft.baseline !== undefined && draft.baseline !== draft.read(),
  );
  dirty.clear();
  for (const draft of changes) dirty.add(draft.panel);
  $('settings-draft-actions').hidden = !closeRequested || !changes.length;
  const locked = applyingDraft || resettingSettings;
  for (const id of ['settings-stay', 'settings-discard', 'settings-apply', 'settings-window-close'])
    $(id).disabled = locked;
  return changes;
}
function queuePreview(immediate = false) {
  clearTimeout(previewTimer);
  if (resettingSettings) return previewTail;
  if (!immediate) {
    previewTimer = setTimeout(
      () => void queuePreview(true).catch((error) => notice(error.message)),
      55,
    );
    return;
  }
  let value;
  try {
    value = Object.assign({}, ...syncDraftActions().map(({ preview }) => preview?.()));
  } catch (error) {
    return Promise.reject(error);
  }
  const encoded = JSON.stringify(value);
  if (encoded === lastPreview) return previewTail;
  lastPreview = encoded;
  previewTail = previewTail
    .catch(() => {})
    .then(async () => {
      if ((await raw.settingsPreview(value)) === false && lastPreview === encoded)
        lastPreview = undefined;
    })
    .catch((error) => {
      if (lastPreview === encoded) lastPreview = undefined;
      throw error;
    });
  return previewTail;
}
async function finishClose() {
  developer.close();
  rememberLocation();
  locationSuspended = true;
  inference.clear();
  voiceApi.clear();
  companion.savedMemory.close();
  await models.voices.stopPreview();
  clearTimeout(previewTimer);
  await previewTail.catch(() => {});
  await raw.closeSettings();
  lastPreview = undefined;
}
async function resolveDrafts(save) {
  if (applyingDraft || resettingSettings || !closeRequested) return;
  const changes = syncDraftActions();
  if (!changes.length) return;
  applyingDraft = true;
  $('settings-forms').inert = true;
  syncDraftActions();
  let resolved = false;
  let failed;
  try {
    await previewTail.catch(() => {});
    for (const draft of changes) {
      failed = draft;
      if ((await (save ? draft.apply() : draft.discard())) === false) break;
      draft.baseline = draft.read();
      failed = undefined;
    }
    if (!failed && !save) {
      revisions = await raw.settingsVersions();
      deferred.clear();
    }
    resolved = !failed;
  } catch (error) {
    notice(error.message);
  } finally {
    applyingDraft = false;
    if (resolved) closeRequested = false;
    $('settings-forms').inert = false;
    syncDraftActions();
  }
  if (resolved) {
    if (save) {
      $('settings-window-close').focus({ preventScroll: true });
      void queuePreview(true).catch((error) => notice(error.message));
    } else await finishClose();
  } else {
    if (failed && failed.section !== current) await navigate(failed.section);
    void queuePreview(true).catch((error) => notice(error.message));
  }
}
$('settings-stay').onclick = () => {
  closeRequested = false;
  syncDraftActions();
  $('settings-window-close').focus({ preventScroll: true });
};
$('settings-discard').onclick = () => resolveDrafts(false);
$('settings-apply').onclick = () => resolveDrafts(true);
const contents = companion.panel.querySelector('[data-companion-tab="settings"]');
const groups = new Map(
  [...contents.querySelectorAll(':scope > [data-companion-group]')].map((group) => [
    group.dataset.companionGroup,
    group,
  ]),
);
companion.replySettings = $('reply-visibility-settings');
const replyCard = document.createElement('section');
replyCard.className = 'settings-card general-group';
replyCard.append(companion.replySettings);
$('general-window-title').parentElement.after(replyCard);
// Keep one set of motion controls and one draft; legacy deep links resolve to Window.
const windowDimming = $('dimming-panel');
windowDimming.querySelector('.settings-heading')?.setAttribute('hidden', '');
delete windowDimming.dataset.panelCut;
const dimmingTitle = document.createElement('h3');
dimmingTitle.textContent = 'Window dimming';
windowDimming.querySelector('.settings-card').prepend(dimmingTitle);
groups.get('Window motion').after(windowDimming);
const reminderSettings = groups.get('Reminders');
companion.reminderSettings = reminderSettings;
groups.delete('Reminders');
time.panel.querySelector('.preferences-content').append(reminderSettings);
const companionSections = new Map(
  Object.entries({
    appearance: [
      'Visual glitch',
      'Interface theme',
      'Portrait',
      'Desktop presentation',
      'System resource usage',
    ],
    window: ['Window layout', 'Window motion'],
    personality: ['Conversation', 'Hands-free conversation', 'Personality'],
    dialogue: ['Saved memories', 'Memory controls'],
    'avatar-skill': [
      'Desktop roaming',
      'Teleport effects',
      'Drag lightning',
      'Avatar click reactions',
      'Avatar attachment zones',
    ],
    microphone: ['Wake acknowledgement'],
  }).map(([section, headings]) => [
    section,
    [...groups]
      .filter(([label]) => headings.some((name) => label.startsWith(name)))
      .map(([, node]) => node),
  ]),
);
const automaticMemory = document.createElement('label');
automaticMemory.innerHTML =
  '<input id="memory-automatic" type="checkbox"> <span>Let Capri save useful preferences automatically</span>';
automaticMemory.querySelector('input').onchange = ({ currentTarget }) =>
  void changeSkill(SKILL_BY_SECTION.dialogue, { automatic: currentTarget.checked });
const automaticMemoryHelp = document.createElement('p');
automaticMemoryHelp.className = 'settings-help';
automaticMemoryHelp.textContent =
  'The active model may check short statements about your preferences after a reply. You can edit or delete saved facts here.';
const savedMemory = groups.get('Saved memories');
savedMemory.querySelector('h3').after(automaticMemory, automaticMemoryHelp);
const micGroup = document.createElement('div');
micGroup.className = 'settings-card';
micGroup.innerHTML = `
  <label for="settings-audio-device">Microphone input</label>
  <select id="settings-audio-device"></select>
  <button id="settings-device-refresh" type="button">Refresh devices</button>
  <div class="microphone-monitor-row">
    <label class="skill-display-control"><input id="settings-microphone-monitor" type="checkbox" role="switch" aria-describedby="settings-microphone-monitor-help"><span>Listen to microphone</span></label>
    <meter id="settings-microphone-level" min="0" max="1" high="0.95" optimum="0" value="0" aria-label="Microphone level"></meter>
  </div>
  <p id="settings-microphone-monitor-help" class="settings-help">Use headphones to avoid feedback.</p>
  <label class="microphone-gain-label" for="settings-microphone-gain"><span>Microphone gain</span><output id="settings-microphone-gain-value" for="settings-microphone-gain"></output></label>
  <input id="settings-microphone-gain" type="range" step="1">`;
(speech.panel.querySelector('.preferences-content') ?? speech.panel).prepend(micGroup);
const microphoneDevice = $('settings-audio-device');
const microphoneMonitor = $('settings-microphone-monitor');
const microphoneLevel = $('settings-microphone-level');
const microphoneGain = $('settings-microphone-gain');
let monitorRun;
speech.bindGain(microphoneGain, $('settings-microphone-gain-value'), () => {
  const run = monitorRun;
  if (run?.gain)
    run.gain.gain.setTargetAtTime(
      Number(microphoneGain.value) / 100,
      run.context.currentTime,
      0.015,
    );
});
function stopMicrophoneMonitor() {
  const run = monitorRun;
  monitorRun = undefined;
  microphoneMonitor.checked = false;
  microphoneLevel.value = 0;
  if (!run) return;
  void raw.setMicrophoneMonitor(false).catch(() => {});
  clearTimeout(run.timer);
  clearInterval(run.meter);
  for (const track of run.stream?.getTracks() ?? []) track.stop();
  void run.context?.close().catch(() => {});
}
async function startMicrophoneMonitor() {
  if (monitorRun) return;
  const run = (monitorRun = {});
  const deviceId = microphoneDevice.value;
  const fail = (error) => {
    if (monitorRun !== run) return;
    stopMicrophoneMonitor();
    notice(
      error?.code === 'CAPRI_SPEAKER_OUTPUT'
        ? error.message
        : ['NotAllowedError', 'SecurityError'].includes(error?.name)
          ? 'Microphone access was denied. Check Windows microphone access for desktop apps.'
          : 'The microphone could not start.',
    );
  };
  try {
    run.context = createAudioOutputContext(audioPlaybackDevice, { latencyHint: 'interactive' });
    const resumed = bindAudioOutput(run.context, audioPlaybackDevice).then(() =>
      run.context.resume(),
    );
    void resumed.catch(fail);
    run.timer = setTimeout(() => fail(), 10000);
    if (!(await raw.setMicrophoneMonitor(true))) throw new Error('Microphone preview unavailable');
    if (monitorRun !== run) return;
    const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));
    if (monitorRun !== run) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    run.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (track?.readyState !== 'live') throw new Error('Microphone unavailable');
    track.addEventListener('ended', () => fail(), { once: true });
    await resumed;
    if (monitorRun !== run) return;
    const gain = (run.gain = run.context.createGain());
    gain.gain.value = Number(microphoneGain.value) / 100;
    const analyser = run.context.createAnalyser();
    analyser.fftSize = 1024;
    const samples = new Float32Array(analyser.fftSize);
    const playback = run.context.createGain();
    playback.gain.value = 0.3;
    run.context
      .createMediaStreamSource(stream)
      .connect(gain)
      .connect(analyser)
      .connect(playback)
      .connect(run.context.destination);
    run.meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      microphoneLevel.value = Math.min(1, Math.max(peak, microphoneLevel.value * 0.72));
    }, 50);
    clearTimeout(run.timer);
  } catch (error) {
    fail(error);
  }
}
microphoneMonitor.onchange = () => {
  if (microphoneMonitor.checked) void startMicrophoneMonitor();
  else stopMicrophoneMonitor();
};
microphoneDevice.addEventListener('change', stopMicrophoneMonitor);
window.addEventListener('pagehide', stopMicrophoneMonitor);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopMicrophoneMonitor();
});
let savedMicrophoneDevice = '';
async function devices() {
  try {
    const value = await raw.microphoneDevices();
    const select = microphoneDevice;
    const draft = dirty.has('microphone-device') ? select.value : undefined;
    select.replaceChildren();
    const fallback = document.createElement('option');
    fallback.value = '';
    fallback.dataset.uiKey = 'System default';
    fallback.textContent = ui.text('System default');
    select.append(fallback);
    for (const row of value.devices) {
      const option = document.createElement('option');
      option.value = row.deviceId;
      if (row.deviceLabel) option.dataset.untranslated = '';
      option.textContent = row.deviceLabel || ui.text('Microphone');
      select.append(option);
    }
    if (
      value.selection.deviceId &&
      !value.devices.some((row) => row.deviceId === value.selection.deviceId)
    ) {
      const unavailable = document.createElement('option');
      unavailable.value = value.selection.deviceId;
      unavailable.dataset.uiKey = 'Unavailable — {device}';
      unavailable.dataset.deviceName = value.selection.deviceLabel;
      unavailable.textContent = ui.text('Unavailable — {device}', {
        device: value.selection.deviceLabel,
      });
      unavailable.disabled = true;
      select.append(unavailable);
    }
    savedMicrophoneDevice = value.selection.deviceId ?? value.selection.inputDeviceId ?? '';
    const keepDraft = [...select.options].some((row) => row.value === draft);
    select.value = keepDraft ? draft : savedMicrophoneDevice;
    if (!keepDraft) captureDrafts('microphone-device');
    syncDraftActions();
  } catch (error) {
    notice(error.message);
  }
}
$('settings-device-refresh').onclick = () => {
  stopMicrophoneMonitor();
  void devices();
};
let callCamera = {},
  cameraRequest,
  cameraBackgroundBusy = false;
const cameraPreview = $('call-camera-preview');
cameraPreview.width = CAMERA_WIDTH;
cameraPreview.height = CAMERA_HEIGHT;
let settingsVisible = false,
  cameraPreviewInView = false,
  cameraPreviewRequested = false,
  cameraPreviewRevision = 0;

function syncCameraPreview() {
  const requested = settingsVisible && cameraPreviewInView && callCamera.supported === true;
  if (requested === cameraPreviewRequested) return;
  cameraPreviewRequested = requested;
  cameraPreviewRevision++;
  if (!requested) cameraPreview.width = CAMERA_WIDTH;
  void raw.setCameraPreview(requested).catch(() => {});
}

new IntersectionObserver(([entry]) => {
  cameraPreviewInView = entry.isIntersecting;
  syncCameraPreview();
}).observe(cameraPreview);

async function drawCameraPreview(bytes) {
  if (!cameraPreviewRequested) return;
  const revision = ++cameraPreviewRevision;
  const frame = await createImageBitmap(new Blob([bytes], { type: 'image/png' })).catch(() => null);
  if (!frame) return;
  if (revision === cameraPreviewRevision) cameraPreview.getContext('2d')?.drawImage(frame, 0, 0);
  frame.close();
}

function showCallCamera() {
  const input = $('call-camera-enabled');
  const skillEnabled = skillState['capri.voice-calls']?.enabled === true;
  const pending = cameraRequest !== undefined || callCamera.pending === true;
  input.checked = cameraRequest ?? callCamera.enabled === true;
  input.disabled = !callCamera.supported || !skillEnabled || pending;
  $('call-camera-card').setAttribute('aria-busy', String(pending || cameraBackgroundBusy));
  $('call-camera-status').textContent = ui.text(
    !callCamera.supported
      ? 'Unavailable'
      : (callCamera.error ?? (callCamera.enabled ? 'Ready' : 'Off')),
  );
  const { color = CAMERA_BACKGROUND_COLOR, imageRevision = null } = callCamera.background ?? {};
  const editable = callCamera.supported && skillEnabled && !cameraBackgroundBusy;
  $('call-camera-background').hidden = !callCamera.supported;
  $('call-camera-color').value = color;
  $('call-camera-color').disabled = !editable;
  $('call-camera-image-pick').disabled = !editable;
  $('call-camera-image-remove').hidden = imageRevision === null;
  $('call-camera-image-remove').disabled = !editable;
  $('call-camera-background-reset').disabled =
    !editable || (imageRevision === null && color === CAMERA_BACKGROUND_COLOR);
  $('call-camera-preview-panel').hidden = !callCamera.supported;
  syncCameraPreview();
}

$('call-camera-enabled').onchange = async (event) => {
  cameraRequest = event.target.checked;
  showCallCamera();
  try {
    callCamera = await raw.callCamera(cameraRequest);
  } catch (error) {
    notice(error.message);
  } finally {
    cameraRequest = undefined;
    showCallCamera();
  }
};

async function saveCameraBackground(prepare) {
  if (cameraBackgroundBusy) return;
  cameraBackgroundBusy = true;
  showCallCamera();
  try {
    callCamera = await raw.setCallCameraBackground(await prepare());
  } catch (error) {
    notice(error.message);
  } finally {
    cameraBackgroundBusy = false;
    showCallCamera();
  }
}

async function cameraBackgroundPng(file) {
  const invalid = 'Choose a valid PNG or JPEG image up to 12 MB.';
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12 * 1024 * 1024)
    throw new Error(invalid);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = CAMERA_WIDTH;
    canvas.height = CAMERA_HEIGHT;
    const scale = Math.max(CAMERA_WIDTH / bitmap.width, CAMERA_HEIGHT / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    canvas
      .getContext('2d')
      .drawImage(bitmap, (CAMERA_WIDTH - width) / 2, (CAMERA_HEIGHT - height) / 2, width, height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await png.arrayBuffer());
  } catch {
    throw new Error(invalid);
  } finally {
    bitmap?.close();
  }
}

$('call-camera-color').onchange = (event) => {
  const color = event.target.value;
  void saveCameraBackground(() => ({ color }));
};
$('call-camera-image-pick').onclick = () => $('call-camera-image-file').click();
$('call-camera-image-file').onchange = (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) void saveCameraBackground(async () => ({ image: await cameraBackgroundPng(file) }));
};
$('call-camera-image-remove').onclick = () =>
  void saveCameraBackground(() => ({ color: callCamera.background.color }));
$('call-camera-background-reset').onclick = () =>
  void saveCameraBackground(() => ({ color: CAMERA_BACKGROUND_COLOR }));

let callAudio = {},
  callOutputs = [],
  callAudioBusy = false,
  callSetup = { phase: 'idle' },
  callSetupBusy = false;
let callVolumeDraft = null,
  callVolumePending = null,
  callVolumeSaving = false,
  callVolumeTimer;
function showCallVolume() {
  const value = callVolumeDraft ?? callAudio.callVoiceVolume ?? CALL_VOICE_VOLUME_DEFAULT;
  $('call-voice-volume').value = String(value);
  $('call-voice-volume-value').textContent = `${value}%`;
}
async function saveCallVolume() {
  clearTimeout(callVolumeTimer);
  if (callVolumeSaving || callVolumePending === null) return;
  callVolumeSaving = true;
  const volume = callVolumePending;
  callVolumePending = null;
  try {
    callAudio = await raw.callAudioCommand({ action: 'voice-volume', volume });
  } catch (error) {
    notice(error.message);
  } finally {
    callVolumeSaving = false;
    if (callVolumePending === null) callVolumeDraft = null;
    showCallVolume();
    if (callVolumePending !== null) callVolumeTimer = setTimeout(saveCallVolume, 50);
  }
}
$('call-voice-volume').oninput = (event) => {
  callVolumeDraft = callVolumePending = Number(event.target.value);
  showCallVolume();
  clearTimeout(callVolumeTimer);
  callVolumeTimer = setTimeout(saveCallVolume, 50);
};
$('call-voice-volume').onchange = () => void saveCallVolume();
function showCallSetup() {
  const ready = callAudio.callOutputReady === true && callAudio.mixingMic === true;
  const pending = callAudioBusy || callSetupBusy || callSetup.busy === true;
  const phase = ready ? 'ready' : callSetup.phase === 'ready' ? 'idle' : callSetup.phase;
  const missing = phase === 'missing';
  const statuses = {
    idle: 'Set up once, then choose the virtual microphone in your call app.',
    checking: 'Looking for a virtual audio cable…',
    missing: 'A virtual audio cable is needed. Install VB-CABLE to continue.',
    downloading: 'Downloading the official VB-CABLE driver…',
    connecting: 'Connecting your microphone and Capri’s voice…',
    installing: 'Installing VB-CABLE. Approve the Windows permission request if it appears.',
    reboot: 'Restart Windows to finish installing VB-CABLE, then click Set up automatically.',
    ready: 'Connected. Your microphone and Capri can now share the call.',
    error: 'Setup could not finish. You can try again.',
  };
  $('call-setup-status').textContent = ui.text(
    !callAudio.supported
      ? 'Call audio is available on Windows.'
      : phase === 'error' && callSetup.error
        ? callSetup.error
        : (statuses[phase] ?? statuses.idle),
  );
  $('call-setup-status').dataset.phase = phase;
  if (callSetup.defaultsWarning)
    $('call-setup-status').textContent +=
      ' ' +
      ui.text(
        'Check Windows sound settings: keep your usual microphone and speakers as the defaults.',
      );
  else if (ready && callSetup.restartRecommended)
    $('call-setup-status').textContent +=
      ' ' + ui.text('VB-Audio recommends restarting Windows after driver installation.');
  $('call-setup-status').setAttribute('aria-busy', String(pending));
  $('call-setup-connect').hidden = ready;
  $('call-setup-connect').textContent = ui.text(missing ? 'Check again' : 'Set up automatically');
  $('call-setup-connect').disabled = !callAudio.supported || pending;
  $('call-setup-install-options').hidden = !missing;
  $('call-setup-consent').disabled = pending;
  $('call-setup-install').disabled =
    !callAudio.supported || pending || !$('call-setup-consent').checked;
  $('call-setup-website').disabled = pending;
  $('call-setup-license').disabled = pending;
  const inputLabel = ready || phase === 'connecting' ? callSetup.cable?.inputLabel : '';
  $('call-setup-recording').hidden = !inputLabel;
  $('call-setup-recording-name').textContent = inputLabel || '';
  $('call-audio-panel').dataset.setupBusy = String(pending);
}
async function runCallSetup(action) {
  if (callSetupBusy || callAudioBusy || (callSetup.busy && action !== 'state')) return;
  if (action === 'install' && !$('call-setup-consent').checked) return;
  callSetupBusy = true;
  showCallAudio();
  try {
    const state = await raw.callAudioSetup(action);
    if (state) callSetup = state;
    if (action !== 'website' && action !== 'license') {
      callAudio = await raw.callAudioCommand({ action: 'state' });
      if (callAudio.supported) callOutputs = await raw.callAudioDevices();
    }
  } catch (error) {
    callSetup = { ...callSetup, phase: 'error', busy: false, error: error.message };
    notice(error.message);
  } finally {
    callSetupBusy = false;
    showCallAudio();
  }
}
function showCallAudio() {
  const supported = callAudio.supported === true;
  const pending = callAudioBusy || callSetupBusy || callSetup.busy === true;
  $('call-voice-volume').disabled = !supported || pending;
  showCallVolume();
  const select = $('call-output-device');
  const preferred = callAudio.preferredDeviceId ?? '';
  const selected =
    callAudio.deviceId ||
    (select.dataset.preferredDevice === preferred ? select.value || preferred : preferred);
  select.dataset.preferredDevice = preferred;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = ui.text('Choose a call output device…');
  select.replaceChildren(placeholder);
  for (const { deviceId, label } of callOutputs) {
    const option = document.createElement('option');
    option.value = deviceId;
    option.textContent = label;
    option.dataset.untranslated = '';
    select.append(option);
  }
  select.value = callOutputs.some(({ deviceId }) => deviceId === selected) ? selected : '';
  select.disabled = !supported || pending || callAudio.callOutputReady;
  $('call-system-enable').hidden = Boolean(
    callAudio.systemAudioActive || callAudio.systemAudioPending,
  );
  $('call-system-enable').disabled = !supported || pending || !callAudio.micListening;
  $('call-system-wake').disabled = !supported || pending || callAudio.systemAudioActive;
  if (callAudio.systemAudioActive) $('call-system-wake').checked = callAudio.systemAudioWake;
  $('call-system-stop').hidden = !callAudio.systemAudioActive && !callAudio.systemAudioPending;
  $('call-output-refresh').disabled = !supported || pending;
  $('call-output-enable').hidden = Boolean(callAudio.callOutputReady);
  const shareMic = $('call-output-mix-mic');
  const shareReplies = $('call-output-share-replies');
  const allowModel = $('call-output-allow-model');
  shareReplies.checked = callAudio.shareReplies === true;
  shareReplies.disabled = !supported || pending || !callAudio.callOutputReady;
  allowModel.checked = callAudio.allowModel === true;
  allowModel.disabled = !supported || pending;
  shareMic.disabled = !supported || pending || callAudio.callOutputReady;
  if (callAudio.callOutputReady) shareMic.checked = callAudio.mixingMic;
  $('call-output-enable').disabled = !supported || pending || !select.value;
  $('call-output-disable').hidden = !callAudio.callOutputReady;
  $('call-output-disable').disabled = pending;
  $('call-system-stop').disabled = pending;
  $('call-system-status').textContent = ui.text(
    !supported
      ? 'Call audio is available on Windows.'
      : callAudio.systemAudioPending
        ? 'Connecting system audio…'
        : callAudio.systemAudioActive
          ? 'Listening to mic and system audio'
          : callAudio.micListening
            ? 'System audio is off.'
            : 'Turn on Capri’s microphone first.',
  );
  $('call-output-status').textContent = ui.text(
    callAudio.callOutputReady
      ? callAudio.mixingMic
        ? 'Your microphone is live in the call.'
        : 'Call output is ready.'
      : 'Call output is off.',
  );
  showCallSetup();
}
async function runCallAudio(action, selection) {
  if (callAudioBusy || callSetupBusy || callSetup.busy) return;
  callAudioBusy = true;
  showCallAudio();
  try {
    if (action === 'refresh') callOutputs = await raw.callAudioDevices();
    else {
      callAudio = await raw.callAudioCommand({
        action,
        ...(action === 'output-on' && { deviceId: selection }),
        ...(['allow-model', 'share-replies'].includes(action) && { enabled: selection }),
        ...(action === 'system-on' && { wakeFromSystem: $('call-system-wake').checked }),
        ...(action === 'output-on' && { mixMic: $('call-output-mix-mic').checked }),
      });
      if (action === 'state' && callAudio.supported) {
        callOutputs = await raw.callAudioDevices();
        if (raw.callAudioSetup) callSetup = await raw.callAudioSetup('state');
      }
    }
  } catch (error) {
    notice(error.message);
  } finally {
    callAudioBusy = false;
    showCallAudio();
  }
}
$('call-setup-connect').onclick = () => runCallSetup('connect');
$('call-setup-install').onclick = () => runCallSetup('install');
$('call-setup-consent').onchange = showCallSetup;
$('call-setup-website').onclick = () => runCallSetup('website');
$('call-setup-license').onclick = () => runCallSetup('license');
$('call-system-enable').onclick = () => runCallAudio('system-on');
$('call-system-stop').onclick = () => runCallAudio('system-off');
$('call-output-refresh').onclick = () => runCallAudio('refresh');
$('call-output-enable').onclick = () => runCallAudio('output-on', $('call-output-device').value);
$('call-output-disable').onclick = () => runCallAudio('output-off');
$('call-output-device').onchange = showCallAudio;
$('call-output-mix-mic').onchange = showCallAudio;
$('call-output-share-replies').onchange = (event) =>
  runCallAudio('share-replies', event.target.checked);
$('call-output-allow-model').onchange = (event) =>
  runCallAudio('allow-model', event.target.checked);
for (const button of general.querySelectorAll(
  '[data-window-action]:not([data-window-action="focus-mode"])',
))
  button.onclick = () =>
    raw.windowAction(button.dataset.windowAction).catch((e) => notice(e.message));
const focusButton = general.querySelector('[data-window-action="focus-mode"]');
$('general-reset-settings').onclick = async () => {
  if (resettingSettings || applyingDraft || busy) return;
  resettingSettings = true;
  $('settings-forms').inert = true;
  settingsGuide.close({ restoreFocus: false });
  clearTimeout(previewTimer);
  syncDraftActions();
  let reset = false;
  try {
    await Promise.allSettled([...writes, previewTail]);
    const value = await raw.resetSettings();
    if (!value) return;
    reset = true;
    applyReset(value);
    notice('Default settings restored.');
  } catch (error) {
    notice(error.message);
  } finally {
    resettingSettings = false;
    $('settings-forms').inert = false;
    syncDraftActions();
    $('general-reset-settings').focus({ preventScroll: true });
    if (reset) lastPreview = undefined;
    void queuePreview(true).catch((error) => notice(error.message));
  }
};
function showGeneralToggle(button, active) {
  button.setAttribute('aria-pressed', String(Boolean(active)));
  button.setAttribute('aria-checked', String(Boolean(active)));
}
for (const [button, apply] of [[focusButton, (value) => raw.windowAction('focus-mode', value)]]) {
  button.onclick = async () => {
    button.disabled = true;
    try {
      await apply(button.getAttribute('aria-pressed') !== 'true');
    } catch (error) {
      notice(error.message);
    } finally {
      button.disabled = false;
    }
  };
}
const windowToggles = [
  { id: 'general-on-top', action: 'always-on-top', event: 'window.always-on-top' },
  { id: 'general-portrait', action: 'portrait', event: 'window.portrait' },
];
for (const setting of windowToggles) {
  const button = $(setting.id);
  const read = () => button.getAttribute('aria-pressed') === 'true';
  button.onclick = () => showGeneralToggle(button, !read());
  addDraft(
    'general',
    setting.id,
    read,
    async () => {
      const value = read();
      await raw.windowAction(setting.action, value);
      setting.saved = value;
    },
    () => showGeneralToggle(button, setting.saved),
    () => ({ [setting.action === 'portrait' ? 'portrait' : 'alwaysOnTop']: read() }),
  );
}
for (const id of ['dimming-enabled', 'dimming-level', 'dimming-softness'])
  $(id).oninput = () => dimming(dimmingDraft());
$('settings-portrait-zoom').oninput = () => {
  $('settings-portrait-zoom-value').textContent = $('settings-portrait-zoom').value + '%';
};
function dimmingDraft() {
  return {
    enabled: $('dimming-enabled').checked,
    level: Number($('dimming-level').value),
    softness: Number($('dimming-softness').value),
  };
}
const companionPanelId = companion.panel.id;
const companionDiscard = () => companion.show(deferred.get(companionPanelId) ?? companion.value);
const companionDraft = addDraft(
  'appearance',
  companionPanelId,
  () => JSON.stringify(companion.readSettings()),
  () => companion.save(false),
  companionDiscard,
  () => ({ companion: companion.readSettings() }),
);
companion.beforePreview = () => queuePreview(true);
addDraft(
  'personality',
  'personality-text',
  () => companion.get('personality-text').value,
  () => companion.savePersonality(),
  () => {
    companion.get('personality-text').value = companion.savedPersonality ?? '';
  },
  () => ({ personality: companion.get('personality-text').value }),
);
addDraft(
  'personality',
  'communication-style',
  () => companion.get('communication-style').value,
  () => companion.saveCommunicationStyle(),
  () => {
    companion.get('communication-style').value = companion.communicationStyle ?? 'neutral';
  },
  () => ({ style: companion.get('communication-style').value }),
);
addDraft(
  'window',
  'dimming-panel',
  () => JSON.stringify(dimmingDraft()),
  async () => {
    dimming(await raw.setDimming(dimmingDraft()));
  },
  () => dimming(latest.dimming),
  () => ({ dimming: dimmingDraft() }),
);
addDraft(
  'appearance',
  'avatar-layout',
  () => $('settings-portrait-zoom').value,
  async () => {
    latest.avatarLayout = await raw.setAvatarLayout({
      ...latest.avatarLayout,
      zoom: Number($('settings-portrait-zoom').value) / 100,
    });
    showAvatarLayout(latest.avatarLayout);
  },
  () => showAvatarLayout(latest.avatarLayout),
  () => ({ zoom: Number($('settings-portrait-zoom').value) / 100 }),
);
for (const [section, controller, apply, fields, preview] of [
  [
    'microphone',
    speech,
    () => speech.save(),
    () => JSON.stringify(speech.draft()),
    () => {
      const { trailingSilenceSeconds, microphoneGain } = speech.draft();
      return { speechPause: trailingSilenceSeconds, microphoneGain };
    },
  ],
  [
    'languages',
    language,
    () => language.apply(),
    () => JSON.stringify(language.draft()),
    () => {
      const draft = language.draft();
      try {
        return { interface: draft.interface, languages: validateLanguages(draft) };
      } catch {
        return { interface: draft.interface };
      }
    },
  ],
  [
    'initiative',
    initiative,
    () => initiative.save(),
    () => JSON.stringify(initiative.draft()),
    () => ({ initiative: initiative.draft() }),
  ],
  ['discord', discord, () => discord.save(), () => fieldsValue([discord.panel])],
])
  addDraft(
    section,
    controller.panel.id,
    fields,
    apply,
    async () => {
      const value = deferred.get(controller.panel.id) ?? controller.value;
      if (controller === language) await prepareInterfaceLocale(value.interface);
      controller.show(value);
    },
    preview,
  );
addDraft(
  'microphone',
  'microphone-device',
  () => microphoneDevice.value,
  async () => {
    const value = await raw.setMicrophoneDevice(microphoneDevice.value);
    savedMicrophoneDevice = value.deviceId ?? '';
    microphoneDevice.value = savedMicrophoneDevice;
  },
  () => {
    microphoneDevice.value = savedMicrophoneDevice;
  },
  () => ({ microphone: microphoneDevice.value }),
);
addDraft(
  'voice',
  effects.panel.id,
  () => JSON.stringify(effects.settings),
  () => effects.commit(),
  () => effects.show(deferred.get(effects.panel.id) ?? effects.savedSettings),
  () => ({ voiceEffects: effects.settings }),
);
addDraft(
  'updates',
  updates.panel.id,
  () => JSON.stringify(updates.settings()),
  () => updates.saveSettings(),
  () => updates.show(updates.value, { resetSettings: true }),
);
addDraft(
  'music',
  music.panel.id,
  () => JSON.stringify(music.draft()),
  () => music.save(),
  () => music.show(deferred.get(music.panel.id) ?? music.value),
  () => ({ musicListening: music.draft() }),
);
const computerAppearance = applications.appearance;
addDraft(
  'computer',
  'computer-access-panel',
  () => JSON.stringify(computerAppearance.draft()),
  () => computerAppearance.save(),
  () => computerAppearance.open(),
  () => ({ computerAppearance: computerAppearance.draft() }),
);
for (const id of [
  'companion-save',
  'personality-save',
  'speech-apply',
  'language-apply',
  'initiative-apply',
  'discord-save',
])
  $(id).hidden = true;
const screenInterval = $('screen-watch-interval');
const screenDuration = $('screen-watch-duration');
const screenOptions = (value) => ({
  interval: value.intervalMs / 1000,
  duration: value.durationMs / 60000,
});
function showScreenOptions(value) {
  const { interval, duration } = screenOptions(value);
  screenInterval.value = interval;
  screenDuration.value = duration;
}
addDraft(
  'screen',
  'screen-panel',
  () => JSON.stringify([screenInterval.value, screenDuration.value]),
  async () => {
    if (
      !screenInterval.reportValidity() ||
      !screenDuration.reportValidity() ||
      !screenInterval.value ||
      !screenDuration.value
    ) {
      notice('Enter a valid screen observation interval and duration.');
      return false;
    }
    latest.screenSettings = await raw.setScreenSettings({
      intervalMs: Number(screenInterval.value) * 1000,
      durationMs: Number(screenDuration.value) * 60000,
    });
    showScreenOptions(latest.screenSettings);
    await screenCommand({ action: 'state', ...screenOptions(latest.screenSettings) });
    return true;
  },
  () => showScreenOptions(latest.screenSettings),
);
const screenCommand = (command) =>
  raw
    .screenFormCommand(command)
    .then(showScreen)
    .catch((e) => notice(e.message));
$('screen-watch-unlock').onclick = () => screenCommand({ action: 'stop' });
for (const [id, action] of [
  ['screen-refresh', 'refresh'],
  ['screen-capture', 'capture'],
  ['screen-ask', 'ask'],
  ['screen-watch-start', 'start'],
  ['screen-watch-stop', 'stop'],
])
  $(id).onclick = () => {
    if (
      action === 'start' &&
      (!screenInterval.reportValidity() || !screenDuration.reportValidity())
    )
      return;
    return screenCommand({
      action,
      sourceId: $('screen-source').value,
      interval: Number(screenInterval.value),
      duration: Number(screenDuration.value),
      question: $('screen-question').value,
    });
  };
$('screen-source').onchange = () =>
  screenCommand({ action: 'select', sourceId: $('screen-source').value });
let screenState;
function refreshScreenText() {
  if (!screenState) return;
  const options = $('screen-source').options;
  for (const [i, { kind, label }] of screenState.sources.entries())
    options[i].textContent = screenSourceLabel(ui, kind, label);
  $('screen-watch-status').textContent = screenObservationText(ui, screenState.status);
  $('screen-watch-status').dataset.severity = screenState.status.warning ? 'warning' : '';
}
function applyLanguage(locale) {
  const changed = ui.language !== locale;
  ui.apply(locale);
  settingsGuide.refresh();
  audioRouting.render();
  if (changed) speech.renderValue();
  voiceApi.examples();
  voiceApi.sync();
  inference.refreshExamples();
  developer.render();
  companion.savedMemory.render();
  if (changed) language.refreshLocale();
  models.setConversationLanguage(language.draft().conversation);
  for (const option of microphoneDevice.querySelectorAll('[data-ui-key]'))
    option.textContent = ui.text(option.dataset.uiKey, {
      device: option.dataset.deviceName ?? '',
    });
  refreshScreenText();
}
function showScreen(value) {
  if (!value) return;
  const previousWarning = screenState?.warning;
  screenState = value;
  if (value.error) notice(value.error);
  if (value.warning && value.warning !== previousWarning) notice(value.warning);
  const select = $('screen-source');
  select.replaceChildren();
  for (const item of value.sources) {
    const o = document.createElement('option');
    o.value = item.id;
    o.disabled = !item.id;
    select.append(o);
  }
  select.value = value.sourceId;
  refreshScreenText();
  for (const id of [
    'screen-watch-interval',
    'screen-watch-duration',
    'screen-source',
    'screen-refresh',
  ])
    $(id).disabled = value.active;
  $('screen-watch-locked').hidden = !value.active;
  $('screen-watch-start').disabled = value.active || !value.ready || !value.sourceId;
  $('screen-watch-stop').disabled = !value.active;
  $('screen-capture').disabled = value.active || !value.sourceId;
  $('screen-ask').disabled = !value.ready || value.busy || !value.canAsk;
  const image = $('screen-preview');
  image.hidden = !value.png;
  if (value.png) image.src = value.png;
  else image.removeAttribute('src');
}
const helpCaption = 'label, h2, h3';
const helpText = (element) => element.textContent.replace(/\s+/gu, ' ').trim();

function helpAnchor(description) {
  if (description.dataset.helpFor) return $(description.dataset.helpFor);
  for (
    let sibling = description.previousElementSibling;
    sibling;
    sibling = sibling.previousElementSibling
  ) {
    if (sibling.matches(helpCaption)) return sibling;
    if (sibling.matches('summary'))
      return description.nextElementSibling?.matches('label')
        ? description.nextElementSibling
        : null;
    if (sibling.labels?.[0]) return sibling.labels[0];
  }
  const previous = description.parentElement.previousElementSibling;
  if (previous?.matches(helpCaption)) return previous;
  return previous?.matches('.settings-heading') ? previous.querySelector('h2, h3') : null;
}

const guideDescriptions = [
  ...document.querySelectorAll(
    '.preferences-panel p.settings-help, #call-audio-panel .settings-card > p:not([id])',
  ),
].flatMap((description) => {
  if (description.matches('[role], [data-inline-help]') || helpText(description).length <= 130)
    return [];
  const anchor = helpAnchor(description);
  return anchor ? [{ description, anchor }] : [];
});
const navigation = $('settings-navigation');
const search = $('settings-search');
const results = $('settings-search-items');
const svgNamespace = 'http://www.w3.org/2000/svg';
const betaSections = new Set([
  'audio',
  'api',
  'screen',
  'applications',
  'chess',
  'spotify',
  'youtube-music',
  'music',
  'initiative',
  'computer',
]);
function appendBetaBadge(element) {
  const badge = document.createElement('small');
  badge.className = 'beta-badge';
  badge.dataset.untranslated = '';
  badge.textContent = 'BETA';
  element.append(' ', badge);
}
for (const [section, , panel] of SETTINGS_SECTIONS)
  if (betaSections.has(section) && !SKILL_BY_SECTION[section])
    appendBetaBadge($(panel).querySelector('h2'));
for (const selector of [
  '[data-companion-group="Desktop roaming"] h3',
  '#companion-conversation-mode-label',
  '#wild-close-ai-tabs-label',
  '#call-camera-card .skill-display-control > span',
])
  appendBetaBadge(document.querySelector(selector));
const skillHeader = document.createElement('section');
skillHeader.className = 'skill-settings-header';
skillHeader.hidden = true;
skillHeader.innerHTML = `
  <h2><span id="skill-settings-title"></span> <small id="skill-settings-beta" class="beta-badge" data-untranslated hidden>BETA</small></h2>
  <p id="skill-settings-description"></p>
  <div class="settings-card">
    <label class="skill-display-control"><input id="skill-show-button" type="checkbox" role="switch"><span>Show button in Capri’s toolbar</span></label>
    <label class="skill-display-control" id="skill-composer-control"><input id="skill-show-composer" type="checkbox" role="switch"><span>Show button in the message bar</span></label>
  </div>`;
const pendingSkills = new Map();
let skillState = {};
function skillGlyph(icon) {
  const glyph = document.createElementNS(svgNamespace, 'svg');
  const path = document.createElementNS(svgNamespace, 'path');
  glyph.setAttribute('viewBox', '0 0 20 20');
  glyph.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', icon);
  glyph.append(path);
  return glyph;
}
function showSkillSettings() {
  showCallCamera();
  const skill = SKILL_BY_SECTION[current];
  skillHeader.hidden = !skill;
  if (skill) {
    $('skill-settings-title').textContent = ui.text(skill.name);
    $('skill-settings-beta').hidden = !betaSections.has(skill.section);
    $('skill-settings-description').textContent = ui.text(skill.description);
    if (skill === youtubeMusicSkill) showYouTubeMusicSettings();
    $('skill-show-button').checked =
      pendingSkills.get(skill.id)?.showButton ??
      skillState[skill.id]?.showButton ??
      skill.showButton;
    $('skill-show-button').disabled = pendingSkills.has(skill.id);
    $('skill-composer-control').hidden = !Object.hasOwn(COMPOSER_SKILLS, skill.id);
    $('skill-show-composer').checked =
      (pendingSkills.get(skill.id)?.showComposer ?? skillState[skill.id]?.showComposer) !== false;
    $('skill-show-composer').disabled = pendingSkills.has(skill.id);
    if (skill.id === 'capri.reasoning') {
      $('reasoning-effort').value =
        pendingSkills.get(skill.id)?.effort ?? skillState[skill.id]?.effort ?? 'medium';
      $('reasoning-effort').disabled = pendingSkills.has(skill.id);
    }
    if (skill.id === 'capri.calculator') {
      $('calculator-show-window').checked =
        (pendingSkills.get(skill.id)?.showWindow ?? skillState[skill.id]?.showWindow) === true;
      $('calculator-show-window').disabled = pendingSkills.has(skill.id);
    }
    if (skill.id === 'capri.owner-memory') {
      $('memory-automatic').checked =
        (pendingSkills.get(skill.id)?.automatic ?? skillState[skill.id]?.automatic) === true;
      $('memory-automatic').disabled = pendingSkills.has(skill.id);
    }
    if (skill.id === 'capri.web-search') {
      const options = pendingSkills.get(skill.id)?.search ?? skillState[skill.id]?.search;
      const save = $('web-search-save');
      if (
        !save.disabled &&
        options &&
        webSearchOptions.dataset.baseline !== JSON.stringify(options)
      ) {
        $('web-search-engine').value = options.engine;
        $('web-search-sort').value = options.sort;
        $('web-search-domains').value = options.domains;
        $('web-search-exclude').checked = options.exclude;
        webSearchOptions.dataset.baseline = JSON.stringify(options);
      }
      save.disabled = pendingSkills.has(skill.id);
    }
  }
  for (const { tabs } of navGroups)
    for (const { skill: item, toggle } of tabs) {
      if (!toggle) continue;
      toggle.checked =
        (pendingSkills.get(item.id)?.enabled ?? skillState[item.id]?.enabled) === true;
      toggle.disabled = pendingSkills.has(item.id);
      toggle.setAttribute('aria-label', ui.text(item.name));
    }
}
async function changeSkill(skill, change) {
  if (pendingSkills.has(skill.id) || applyingDraft || resettingSettings) {
    showSkillSettings();
    return;
  }
  pendingSkills.set(skill.id, change);
  showSkillSettings();
  try {
    if (change.enabled) {
      const pending = syncDraftActions().filter(
        (draft) =>
          draft.section === skill.section ||
          (draft.panel === 'language-panel' && ['voice', 'microphone'].includes(skill.section)) ||
          (draft.panel === companion.panel.id &&
            ['avatar-skill', 'microphone'].includes(skill.section)),
      );
      for (const draft of pending) {
        if ((await draft.apply()) === false) return;
        draft.baseline = draft.read();
      }
    }
    await raw.setSkill({ id: skill.id, ...change });
  } catch (error) {
    notice(error.message);
  } finally {
    pendingSkills.delete(skill.id);
    showSkillSettings();
    syncDraftActions();
  }
}
for (const [id, key] of [
  ['skill-show-button', 'showButton'],
  ['skill-show-composer', 'showComposer'],
])
  skillHeader.querySelector('#' + id).onchange = ({ currentTarget }) => {
    const skill = SKILL_BY_SECTION[current];
    if (skill) void changeSkill(skill, { [key]: currentTarget.checked });
  };
const settingsGuide = new SettingsGuide({
  ui,
  activeSection: () => current,
  available: () =>
    !busy &&
    !applyingDraft &&
    !resettingSettings &&
    !document.body.hasAttribute('data-settings-loading') &&
    !document.querySelector('dialog[open]:not(.settings-guide)'),
  revealable: (element) =>
    element === localVoicePanel || element === voiceApi.panel || element.id === 'api-form',
  reveal: (element) => {
    if (element.id === 'api-form') {
      inference.setFormOpen(true);
      return { key: 'api-form', restore: () => inference.setFormOpen(false) };
    }
    const previous = localVoicePanel.hidden ? 'api' : 'local';
    showVoiceSource(element === localVoicePanel ? 'local' : 'api');
    return { key: 'voice-view', restore: () => showVoiceSource(previous) };
  },
  descriptions: (anchors) => {
    for (const { description, anchor } of guideDescriptions)
      if (anchors.has(anchor)) description.classList.add('settings-guide-copy');
  },
  onError: notice,
});
const navGroups = SETTINGS_GROUPS.map(({ id, labels, sections, icon }) => {
  const group = document.createElement('div');
  const heading = document.createElement('p');
  const title = document.createElement('span');
  const glyph = document.createElementNS(svgNamespace, 'svg');
  const path = document.createElementNS(svgNamespace, 'path');
  glyph.setAttribute('viewBox', '0 0 20 20');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.setAttribute('focusable', 'false');
  path.setAttribute('d', icon);
  glyph.append(path);
  heading.append(glyph, title);
  group.dataset.settingsGroup = id;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', `settings-group-${id}`);
  heading.id = `settings-group-${id}`;
  group.append(heading);
  const tabs = sections.map(([section, label]) => {
    const button = document.createElement('button');
    const caption = document.createTextNode('');
    const captionContainer = document.createElement('span');
    captionContainer.append(caption);
    if (betaSections.has(section)) appendBetaBadge(captionContainer);
    const skill = SKILL_BY_SECTION[section];
    let toggle;
    button.type = 'button';
    button.dataset.section = section;
    button.onclick = () => navigate(section);
    if (skill) {
      const row = document.createElement('div');
      row.className = 'skill-navigation-row';
      button.append(skillGlyph(skill.icon));
      toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.setAttribute('role', 'switch');
      toggle.className = 'skill-toggle';
      toggle.dataset.skill = skill.id;
      toggle.onchange = () => void changeSkill(skill, { enabled: toggle.checked });
      row.append(button, toggle);
      group.append(row);
    } else group.append(button);
    button.append(captionContainer);
    return { button, caption, section, label, skill, toggle };
  });
  return { group, title, labels, tabs };
});
const searchIndex = indexSettings(
  SETTINGS_SECTIONS.map(([section, sectionLabel, panel]) => ({
    section,
    sectionLabel,
    description: SKILL_BY_SECTION[section]?.description,
    roots:
      panel !== companion.panel.id
        ? [$(panel), ...(companionSections.get(section) ?? [])]
        : (companionSections.get(section) ?? [
            companion.panel.querySelector(`[data-companion-tab="${section}"]`),
          ]),
  })),
);
function renderNavigation() {
  if (!navigation.firstElementChild) navigation.append(...navGroups.map(({ group }) => group));
  for (const { title, labels, tabs } of navGroups) {
    title.textContent = labels.map((label) => ui.text(label)).join(' · ');
    for (const { button, caption, section, label } of tabs) {
      caption.data = ui.text(label);
      if (SKILL_BY_SECTION[section])
        button.title = `${caption.data}\n${ui.text(SKILL_BY_SECTION[section].description)}`;
      if (current === section) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  showSkillSettings();
  const query = search.value.trim();
  navigation.hidden = Boolean(query);
  $('settings-search-results').hidden = !query;
  if (!query) searchHighlight?.classList.remove('setting-search-match');
  const matches = findSettings(searchIndex, query, ui);
  $('settings-search-empty').hidden = !query || matches.length > 0;
  $('settings-search-empty').textContent = ui.text('No matching settings');
  results.replaceChildren(
    ...matches.map((match) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.settingResult = match.target?.id ?? '';
      button.dataset.resultSection = match.section;
      button.textContent = match.displayName;
      if (match.target) {
        const tab = document.createElement('small');
        tab.textContent = ui.text(match.sectionLabel);
        button.append(tab);
      }
      button.onclick = () => navigate(match.section, null, match);
      return button;
    }),
  );
}

let searchHighlight, pendingNavigation;
function revealSearchMatch(match, panel) {
  const { target, label, heading, root } = match;
  if (!target?.isConnected) return;
  if (target.closest('#api-form')?.hidden) inference.setFormOpen(true);
  for (let node = target.parentElement; node && node !== panel; node = node.parentElement)
    if (node.matches('details')) node.open = true;
  const visible = (node) => node?.getClientRects().length;
  const anchor = [label, target, heading, root.querySelector('h2'), panel.querySelector('h2')].find(
    visible,
  );
  if (!anchor) return;
  searchHighlight?.classList.remove('setting-search-match');
  searchHighlight = anchor;
  anchor.classList.add('setting-search-match');
  anchor.scrollIntoView({ block: 'center', behavior: 'instant' });
  const focus = visible(target) && !target.matches(':disabled') ? target : anchor;
  if (focus.tabIndex < 0) focus.tabIndex = -1;
  focus.focus({ preventScroll: true });
}

async function navigate(id, focus = null, match = null) {
  id = settingsSection(id);
  if (busy || applyingDraft || resettingSettings || !SETTINGS_SECTIONS.some((s) => s[0] === id))
    return;
  settingsGuide.close({ restoreFocus: false });
  if (current === 'microphone' && id !== current) {
    stopMicrophoneMonitor();
    companion.stopWakePreview();
  }
  rememberLocation();
  locationSuspended = false;
  busy = true;
  settingsGuide.refresh();
  panelLoading(true);
  try {
    if (id !== 'developer') developer.close();
    if (current && id !== current) {
      if (current === 'voice') void models.voices.stopPreview();
      if (current === 'support') companion.showSupportFrame(false);
      closeRequested = false;
      notice();
    }
    const row = SETTINGS_SECTIONS.find((s) => s[0] === id);
    if (id !== 'dialogue') companion.savedMemory.close();
    current = id;
    for (const panel of document.querySelectorAll('.preferences-panel, #dimming-panel'))
      panel.hidden = true;
    const panel = $(row[2]);
    panel.dataset.panelCut ??= '12';
    panel.hidden = false;
    if (SKILL_BY_SECTION[id]) panel.prepend(skillHeader);
    skillHeader.hidden = !SKILL_BY_SECTION[id];
    if (id === 'voice' || id === 'microphone') {
      const languageControls = id === 'voice' ? voiceLanguageControls : recognitionLanguageControls;
      languageControls.lastElementChild.before(speechInstallation);
    }
    language.installScope = id === 'voice' || id === 'microphone' ? id : null;
    language.details();
    companion.panel.toggleAttribute('data-microphone-section', id === 'microphone');
    if (panel === companion.panel || id === 'microphone') {
      await companion.open(true, ['bug', 'support'].includes(id) ? id : 'settings');
      if (!['bug', 'support'].includes(id))
        $('companion-panel-title').textContent = ui.text(
          id === 'microphone' ? 'Wake acknowledgement' : row[1],
        );
      const allowed = companionSections.get(id) ?? [];
      for (const node of groups.values()) node.hidden = !allowed.includes(node);
      windowDimming.hidden = id !== 'window';
    }
    if (id === 'microphone') await devices();
    if (id === 'voice') {
      await effects.open(true);
      await Promise.all([voiceApi.open(), models.voices.refresh(language.draft().conversation)]);
      showVoiceSource(voiceApi.value?.enabled ? 'api' : 'local');
    } else {
      voiceApi.panel.hidden = true;
      voiceApi.clear();
    }
    if (id === 'models') await models.open(true);
    if (id !== 'api') inference.clear();
    if (id === 'api') await inference.open();
    if (id === 'knowledge') await knowledge.open({ privateMemory: false });
    if (id === 'private-memory') await knowledge.privateMemory.open();
    if (id === 'workflows') await workflows.open();
    if (id === 'coding') await coding.open();
    if (id === 'chess') await chess.open();
    if (id === 'user-tools') await userTools.open();
    if (id === 'developer') await developer.open();
    if (id === 'discord') {
      const pending = dirty.has('discord-panel');
      await discord.open({ refresh: pending });
      if (!pending) captureDrafts('discord-panel');
    }
    if (id === 'updates') await updates.open(true);
    if (id === 'applications') await applications.open(true);
    if (id === 'computer') {
      applications.showComputerAccess(await raw.computerAccessStatus());
      applications.showComputerTask(await raw.computerTaskStatus());
      if (!dirty.has('computer-access-panel')) {
        await applications.appearance.open();
        captureDrafts('computer-access-panel');
      }
    }
    if (id === 'languages') await language.open(true);
    if (id === 'audio') await audioRouting.open();
    if (id === 'time') await time.refresh();
    if (id === 'files') await files.recovery();
    if (id === 'screen') await screenCommand({ action: 'state' });
    if (id === 'calls') await runCallAudio('state');
    if (id === 'youtube-music') void runYouTubeMusic('status');
    if (id === 'music') {
      const pending = dirty.has(music.panel.id);
      await music.open({ preserveDraft: pending });
      if (!pending) captureDrafts(music.panel.id);
    }
    captureDrafts();
    syncDraftActions();
    queuePreview();
    frames?.destroy();
    frames = new PanelFrames();
    await settingsGuide
      .prepare()
      .catch((error) => console.error('Settings guide unavailable:', error));
    applyLanguage(ui.language);
    renderNavigation();
    await document.fonts.ready;
    if (id === 'credits') credits.paintTeamRays();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    panelLoading(false);
    finishSettingsLoading();
    restoreLocation();
    if (id === 'coding') coding.revealPending();
    if (id === 'credits') void credits.open();
    if (match) revealSearchMatch(match, panel);
    else if (id === 'models' && ['context', 'devices', 'model'].includes(focus)) {
      const control = $(
        { context: 'models-context', devices: 'model-device-language', model: 'models-choice' }[
          focus
        ],
      );
      control.scrollIntoView({ block: 'center', behavior: 'instant' });
      const target = control.disabled ? (control.closest('.settings-card') ?? panel) : control;
      if (target !== control) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    panelLoading(false);
    settingsGuide.refresh();
    rememberLocation();
    if (current && !firstContentFrame) {
      // Native ready-to-show can fire for the empty shell. Acknowledge only
      // after the selected form, translations, fonts and layout have painted.
      firstContentFrame = (async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await raw.settingsRendered();
      })().catch((error) => {
        console.error('Settings first frame failed:', error);
        notice(error.message);
        firstContentFrame = null;
      });
    }
    const next = pendingNavigation;
    pendingNavigation = null;
    if (next) void navigate(next.section, next.focus);
  }
}
function dimming(value) {
  $('dimming-enabled').checked = value.enabled;
  $('dimming-level').value = value.level;
  $('dimming-softness').value = value.softness;
  $('dimming-level-value').textContent = value.level + '%';
  const softness = ui.text('{value} px', {
    value: new Intl.NumberFormat(ui.language).format(dimmingFeatherWidth(value.softness)),
  });
  $('dimming-softness-value').textContent = softness;
  $('dimming-softness').setAttribute('aria-valuetext', softness);
}
function showAvatarLayout(value) {
  $('settings-portrait-zoom').value = Math.round(value.zoom * 100);
  $('settings-portrait-zoom-value').textContent = Math.round(value.zoom * 100) + '%';
}
function applyReset(value) {
  revisions = value.settingsVersions;
  windowToggles[0].saved = value.alwaysOnTop;
  windowToggles[1].saved = value.portrait;
  for (const setting of windowToggles) showGeneralToggle($(setting.id), setting.saved);
  latest.dimming = value.dimming;
  latest.avatarLayout = value.avatarLayout;
  companion.show(value.companion);
  dimming(value.dimming);
  showAvatarLayout(value.avatarLayout);
  effects.show(value.voiceEffects);
  speech.show(value.speech);
  initiative.show(value.initiative);
  latest.screenSettings = value.screenSettings;
  showScreenOptions(value.screenSettings);
  computerAppearance.show(value.computerAppearance);
  if (value.musicListening) music.show(value.musicListening);
  for (const panel of [
    companionPanelId,
    'dimming-panel',
    'avatar-layout',
    effects.panel.id,
    speech.panel.id,
    initiative.panel.id,
    'screen-panel',
    'computer-access-panel',
    music.panel.id,
    ...windowToggles.map(({ id }) => id),
  ]) {
    deferred.delete(panel);
    captureDrafts(panel);
  }
}
function show(snapshot) {
  showAttachmentFormats(snapshot.attachmentVision === true);
  latest = snapshot;
  skillState = snapshot.skills ?? {};
  callCamera = snapshot.callCamera ?? {};
  showAudioRouting(snapshot.audioRouting);
  applyLanguage(snapshot.languages.interface);
  showCallCamera();
  inferencePrivacy(snapshot.inference, ui);
  revisions = snapshot.settingsVersions;
  applications.showSpotify(snapshot.spotify);
  models.setConversationLanguage(snapshot.languages.conversation);
  models.show(snapshot.models);
  updates.show(snapshot.updates);
  companion.show(snapshot.companion);
  effects.show(snapshot.voiceEffects);
  effects.availability(!snapshot.activeTurnId && snapshot.voice.language !== 'off');
  language.installed(snapshot.recognitionAvailability, snapshot.speechAvailability);
  language.installStatus(snapshot.speechInstallation);
  language.externalVoice = snapshot.voice.source === 'api';
  language.show(snapshot.languages);
  files.show(snapshot.fileAccess);
  applications.show(snapshot.applications);
  initiative.show(snapshot.initiative);
  initiative.status(snapshot.awareness);
  speech.show(snapshot.speech);
  music.show(snapshot.musicListening);
  time.show(snapshot.time);
  dimming(snapshot.dimming);
  windowToggles[0].saved = snapshot.windowSettings?.alwaysOnTop !== false;
  windowToggles[1].saved = snapshot.presence?.pinned === true;
  for (const setting of windowToggles) showGeneralToggle($(setting.id), setting.saved);
  showGeneralToggle(focusButton, snapshot.windowSettings?.focusMode);
  showAvatarLayout(snapshot.avatarLayout);
  showScreenOptions(snapshot.screenSettings);
  $('general-status').textContent = ui.text(snapshot.backend.message);
  renderNavigation();
  document.title = ui.text('Capri Settings');
}
let savedLanguageRevision = 0;
let languagePreviewRevision = 0;
function event(value) {
  if (value.type === 'saved-memory.changed') {
    void companion.savedMemory.load();
    return;
  }
  if (value.type?.startsWith('coding.')) {
    coding.onEvent(value);
    return;
  }
  if (value.type === 'audio-routing.changed') {
    showAudioRouting(value);
    return;
  }
  if (value.type === 'skills.settings') {
    if (value.changed === youtubeMusicSkill.id) {
      youtubeMusicStatus = '';
      youtubeMusicRequest = undefined;
    }
    skillState = value.settings;
    showSkillSettings();
    return;
  }
  if (value.type === 'settings.visibility') {
    if (value.visible === false) {
      settingsGuide.close({ restoreFocus: false });
      stopMicrophoneMonitor();
      companion.stopWakePreview();
    }
    settingsVisible = value.visible === true;
    companion.showSupportFrame(settingsVisible && current === 'support');
    syncCameraPreview();
    credits.setVisible(value.visible === true);
    developer.setVisible(value.visible === true && current === 'developer');
    if (value.visible === true && current === 'developer') void developer.refresh();
    return;
  }
  if (value.preview === true) return;
  if (value.type === 'companion.settings' && value.monitorChange && companionDraft.baseline) {
    // Rebase only the controls changed by the monitor shortcut. The rest of the
    // open draft still belongs to Settings, even though it shares one revision.
    const { monitorChange } = value;
    companion.value = { ...companion.value, ...monitorChange };
    companion.showMonitorDisplay(monitorChange);
    companionDraft.baseline = JSON.stringify({
      ...JSON.parse(companionDraft.baseline),
      ...monitorChange,
    });
    if (deferred.has(companionPanelId)) deferred.set(companionPanelId, value.settings);
    else revisions.companion = value.settingsVersions.companion;
    void queuePreview(true).catch((error) => notice(error.message));
    return;
  }
  if (value.type === 'music.status' || value.type === 'music-listening.status') {
    const snapshot = value.state ?? value;
    latest.musicListening = snapshot;
    if (dirty.has(music.panel.id)) {
      music.status(snapshot);
      deferred.set(music.panel.id, snapshot);
    } else {
      music.show(snapshot);
      captureDrafts(music.panel.id);
    }
    if (value.settingsVersions?.musicListening !== undefined)
      revisions.musicListening = value.settingsVersions.musicListening;
    return;
  }
  if (value.type === 'window.focus-mode') {
    showGeneralToggle(focusButton, value.active);
    return;
  }
  const windowToggle = windowToggles.find(({ event }) => event === value.type);
  if (windowToggle) {
    windowToggle.saved = value.active;
    if (!dirty.has(windowToggle.id)) {
      showGeneralToggle($(windowToggle.id), value.active);
      captureDrafts(windowToggle.id);
    }
    return;
  }
  if (value.type === 'microphone.device-changed') {
    audioRouting.show({ microphone: { deviceId: value.deviceId, deviceLabel: value.deviceLabel } });
    if (current === 'microphone') {
      stopMicrophoneMonitor();
      void devices();
    }
    return;
  }
  if (value.type === 'microphone.monitor-stop') {
    stopMicrophoneMonitor();
    return;
  }
  if (value.type === 'computer.task') {
    applications.showComputerTask(value);
    return;
  }
  if (value.type === 'computer-access') {
    applications.showComputerAccess(value.settings);
    return;
  }
  if (value.type === 'application.access') {
    applications.showAccess(value.settings);
    return;
  }
  if (value.type === 'brain.status') {
    knowledge.show(value.settings);
    return;
  }
  if (value.type === 'private-memory.status') {
    knowledge.privateMemory.show(value.settings);
    return;
  }
  if (value.type === 'workflow.status') {
    workflows.status(value.settings);
    return;
  }
  if (value.type === 'settings.resume') {
    pendingNavigation = null;
    if (!document.hidden) rememberLocation();
    lastPreview = undefined;
    locationSuspended = false;
    if (!current) void navigate(location.section);
    else {
      restoreLocation();
      queuePreview();
    }
    return;
  }
  if (value.type === 'settings.navigate') {
    lastPreview = undefined;
    // A shortcut can reopen Settings before the previous pane finishes painting.
    if (busy) pendingNavigation = value;
    else void navigate(value.section, value.focus);
    return;
  }
  if (value.type === 'settings.close-request') {
    void close();
    return;
  }
  if (value.type === 'settings.screen-state') {
    showScreen(value.state);
    return;
  }
  if (value.type === 'settings.call-audio' || value.type === 'call-audio.reset') {
    callAudio = value.state ?? {
      supported: callAudio.supported,
      allowModel: callAudio.allowModel,
      callVoiceVolume: callAudio.callVoiceVolume,
    };
    showCallAudio();
    const ready = callAudio.callOutputReady === true;
    const deviceId = callAudio.deviceId ?? '';
    const previousOutput = audioRouting.value?.callOutput;
    if (previousOutput?.ready !== ready || previousOutput?.deviceId !== deviceId)
      audioRouting.show({ callOutput: { ready, deviceId } });
    return;
  }
  if (value.type === 'call-camera.state') {
    callCamera = value.state ?? {};
    showCallCamera();
    return;
  }
  if (value.type === 'call-camera.preview-frame') {
    void drawCameraPreview(value.bytes);
    return;
  }
  if (value.type === 'settings.call-setup') {
    callSetup = value.state ?? { phase: 'idle' };
    showCallAudio();
    return;
  }
  if (value.type === 'confirmation.request') {
    void confirmationRequests.request(value).catch((error) => notice(error.message));
    return;
  }
  if (value.type === 'confirmation.closed') {
    confirmationRequests.close(value.id);
    return;
  }
  if (value.type === 'settings.glitch') {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(event.glitchFrame);
    const received = performance.now(),
      offset = Math.max(0, Date.now() - value.timestamp);
    const draw = (now) => {
      const frame = interferenceFrame(value.start + offset + now - received, value.eventAt, false, {
        enabled: value.settings.glitchEnabled,
        strength: value.settings.glitchStrength / 100,
        intervalMs: value.settings.glitchIntervalSeconds * 1000,
        events: value.settings.glitchEvents,
      });
      document.body.style.setProperty('--glitch-strength', String(frame.strength));
      document.body.style.setProperty('--glitch-x', frame.x + 'px');
      document.body.style.setProperty('--glitch-y', frame.y + 'px');
      if (now - received < 850) event.glitchFrame = requestAnimationFrame(draw);
      else document.body.style.setProperty('--glitch-strength', '0');
    };
    event.glitchFrame = requestAnimationFrame(draw);
    return;
  }
  const updatesMap = {
    'companion.settings': [companion, 'show'],
    'voice.effects': [effects, 'show'],
    'file-access': [files, 'show'],
    applications: [applications, 'show'],
    'initiative.settings': [initiative, 'show'],
    'speech.settings': [speech, 'show'],
    'models.status': [models, 'show'],
    'updates.status': [updates, 'show'],
    'spotify.settings': [applications, 'showSpotify'],
  };
  if (value.type === 'huggingface.status') models.hub.show(value);
  if (value.type === 'voice-catalog.status') models.voices.show(value);
  if (value.type === 'voice-training.status') models.voices.trainingStatus(value);
  if (value.type === 'chess.engine') chess.showEngine(value.engine);
  if (value.type === 'chess.watch') chess.updateTracking(value);
  if (value.type === 'initiative.status') {
    initiative.status(value.settings);
    return;
  }
  if (value.type === 'initiative.activity') {
    initiative.activity(value.settings);
    return;
  }
  if (value.type === 'dimming') {
    latest.dimming = value.settings;
    if (!dirty.has('dimming-panel')) {
      dimming(value.settings);
      captureDrafts('dimming-panel');
    }
  }
  if (value.type === 'languages') {
    const revision = ++savedLanguageRevision;
    void prepareInterfaceLocale(value.settings.interface)
      .then(() => {
        if (revision !== savedLanguageRevision) return;
        if (JSON.stringify(language.draft()) === language.savedDraft) {
          language.show(value.settings);
          captureDrafts('language-panel');
          revisions.languages = value.settingsVersions?.languages ?? revisions.languages;
        } else {
          deferred.set('language-panel', value.settings);
          if (!writes.size && !resettingSettings)
            notice('Settings changed elsewhere. Apply or discard your draft.');
        }
        return previewInterfaceLanguage(language.draft().interface);
      })
      .catch((error) => notice(error.message));
  }
  if (value.type === 'avatar.layout') {
    latest.avatarLayout = value.layout;
    if (value.reset || !dirty.has('avatar-layout')) {
      showAvatarLayout(value.layout);
      captureDrafts('avatar-layout');
      if (value.reset) syncDraftActions();
    }
  }
  if (value.type === 'speech-install.status') {
    language.installStatus(value.settings ?? value);
    models.voices.speechStatus(value.settings ?? value);
  }
  if (value.type === 'speech-components')
    language.installed(value.recognitionAvailability, value.speechAvailability);
  if (value.type === 'voice.settings') {
    latest.voice = value;
    if (audioRouting.value?.voiceVolume !== value.volume)
      audioRouting.show({ voiceVolume: value.volume });
    language.externalVoice = value.source === 'api';
    language.details();
    effects.availability(!latest.activeTurnId && !latest.playbackBusy && value.language !== 'off');
  }
  if (value.type === 'settings.activity') {
    latest.activeTurnId = value.chat;
    latest.playbackBusy = value.playback;
    effects.availability(!value.chat && !value.playback && latest.voice.language !== 'off');
  }
  if (value.type === 'time.changed') time.show(value.objects);
  if (value.type === 'backend') $('general-status').textContent = ui.text(value.message);
  const update = updatesMap[value.type];
  if (update) {
    const id = update[0].panel?.id;
    if (update[0] === updates && dirty.has(id)) {
      updates.show(value.settings ?? value);
      return;
    }
    if (!dirty.has(id)) {
      update[0][update[1]](value.settings ?? value);
      captureDrafts(id);
      const group = {
        'companion.settings': 'companion',
        'speech.settings': 'speech',
        'initiative.settings': 'initiative',
      }[value.type];
      if (group && value.settingsVersions) revisions[group] = value.settingsVersions[group];
    } else {
      deferred.set(id, value.settings ?? value);
      if (!writes.size && !resettingSettings)
        notice('Settings changed elsewhere. Apply or discard your draft.');
    }
  }
}
async function previewInterfaceLanguage(locale) {
  const revision = ++languagePreviewRevision;
  await prepareInterfaceLocale(locale);
  if (revision !== languagePreviewRevision || language.draft().interface !== locale) return;
  applyLanguage(locale);
  renderNavigation();
}
for (const name of ['input', 'change', 'click'])
  document.addEventListener(name, (event) => {
    if (!event.target.closest('.preferences-panel') || applyingDraft || resettingSettings) return;
    closeRequested = false;
    syncDraftActions();
    if (event.target.id === 'language-interface') {
      void previewInterfaceLanguage(language.draft().interface).catch((error) =>
        notice(error.message),
      );
    }
    if (event.target.id === 'language-conversation')
      models.setConversationLanguage(language.draft().conversation);
    queuePreview();
  });
$('settings-window-close').onclick = () =>
  document.body.hasAttribute('data-settings-loading') ? raw.closeSettings() : close();
search.oninput = renderNavigation;
search.onkeydown = (event) => {
  if (event.isComposing || !search.value) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    results.querySelector('button')?.click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    search.value = '';
    renderNavigation();
  }
};
window.addEventListener('capri-open-models', () => navigate('models'));
window.addEventListener('capri-open-updates', () => navigate('updates'));
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (document.body.hasAttribute('data-settings-loading')) {
    void raw.closeSettings();
    return;
  }
  if (closeRequested) $('settings-stay').click();
  else void close();
});
let settingsInitialized = false;
const eventsDuringInitialization = new Map();
raw.onEvent((value) => {
  if (settingsInitialized) event(value);
  else {
    const key = value.type === 'settings.resume' ? 'settings.navigate' : value.type;
    eventsDuringInitialization.set(key, value);
  }
});
try {
  const snapshot = await raw.bootstrap();
  await prepareInterfaceLocale(snapshot.languages.interface);
  show(snapshot);
  await companion.loadPersonality().catch((error) => notice(error.message));
  for (const draft of drafts)
    if (!['microphone-device', 'discord-panel', 'computer-access-panel'].includes(draft.panel))
      draft.baseline = draft.read();
  settingsInitialized = true;
  for (const value of eventsDuringInitialization.values()) event(value);
  eventsDuringInitialization.clear();
  await raw.settingsReady();
} catch (error) {
  console.error('Settings initialization failed:', error);
  notice(error.message);
}
