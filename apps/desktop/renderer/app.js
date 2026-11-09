import { SubtitleController } from './subtitle-controller.mjs';
import { AttachmentComposer } from './attachment-composer.mjs';
import { HistoryAttachments } from './history-attachments.mjs';
import { VoicePlayer } from './voice-player.mjs';
import { ReplyVisibility } from './reply-visibility.mjs';
import { VoiceEffectsPanel } from './voice-effects-panel.mjs';
import { InterfaceLanguage, languageName } from './language-settings.mjs';
import { LanguagePanel } from './language-panel.mjs';
import { CompanionPanel } from './companion-panel.mjs';
import { UpdatesPanel } from './updates-panel.mjs';
import { UpdateNotification } from './update-notification.mjs';
import { ThinkingMode } from './thinking-mode.mjs';
import { InternetMode } from './internet-mode.mjs';
import { ModelsPanel } from './models-panel.mjs';
import { ConfirmationDialog } from './confirmation-dialog.mjs';
import { ConfirmationRequests } from './confirmation-requests.mjs';
import { ButtonFeedback } from './button-feedback.mjs';
import { inferencePrivacy } from './inference-privacy.mjs';
import { renderInferenceLabel } from './inference-panel.mjs';
import { InferencePicker } from './inference-picker.mjs';
import { StartupPanel } from './startup-panel.mjs';
import { StartupIntro } from './startup-intro.mjs';
import { interfaceThemeColors } from './interface-theme.mjs';
import { FileAccessPanel } from './file-access-panel.mjs';
import { ApplicationsPanel } from './applications-panel.mjs';
import { InitiativePanel } from './initiative-panel.mjs';
import { ScreenPanel, screenImageWarning } from './screen-panel.mjs';
import { TimePanel } from './time-panel.mjs';
import { MicrophoneClient } from './microphone.mjs';
import { microphoneButtonState, setMicrophoneButtonBusy } from './microphone-button.mjs';
import { CallMicrophone } from './call-microphone.mjs';
import { SystemMusicClient } from './system-music-capture.mjs';
import { MusicAnimation, MusicPoseLayer, MusicNotesLayer } from './music-animation.mjs';
import { musicAnimationReady } from './music-listening-settings.mjs';
import { SpeechPanel } from './speech-panel.mjs';
import { validateDimming, shadeBounds } from './dimming-settings.mjs';
import { DimmingMask } from './dimming-mask.mjs';
import { OverflowTicker } from './overflow-ticker.mjs';
import { isClipCommand } from './clip-command.mjs';
import {
  avatarTapsSleeping,
  isSleepCommand,
  sleepCaption,
  visuallySleeping,
} from './sleep-service.mjs';
import { WakeFeedback, playScreenshotShutter } from './wake-feedback.mjs';
import { PresenceModel, SIGNAL_STATES } from './presence-model.mjs';
import { SignalFX } from './signal-fx.mjs';
import { PANEL_SECTIONS } from './settings-registry.mjs';
import { StopwatchHUD } from './stopwatch-hud.mjs';
import { MemoryHUD } from './memory-hud.mjs';
import { AnimationDirector, SpriteImages } from './animation-director.mjs';
import { AvatarHeadpat } from './avatar-headpat.mjs';
import { showAvatarTapEffect } from './avatar-tap-effect.mjs';
import { AvatarMouthLayer, AvatarVisemes, avatarPoseLandmarks } from './avatar-mouth.mjs';
import { playTeleportSound } from './avatar-teleport-sound.mjs';
import { CRT_CURVATURE, screenSample } from './screen-geometry.mjs';
import {
  DEFAULT_AVATAR_LAYOUT,
  avatarRect,
  registeredAvatarRect,
  avatarFacePoint,
  centerAvatarFace,
  clippedAvatarRect,
  moveAvatar,
  zoomAvatar,
  validateAvatarLayout,
} from './avatar-layout.mjs';

const api = window.capri;
const headpat = new AvatarHeadpat(document.getElementById('avatar-viewport'), () =>
  signalFx?.invalidate(),
);
const dimmingMask = new DimmingMask(document.getElementById('window-shade'));
const microphoneLabelTicker = new OverflowTicker(document.getElementById('microphone-label'));
const microphoneTextTicker = new OverflowTicker(document.getElementById('microphone-text'));
const ui = new InterfaceLanguage();
const historyAttachments = new HistoryAttachments({
  openImage: (id) => api.openAttachmentImage(id),
  text: (value) => ui.text(value),
});
const thinkingMode = new ThinkingMode({
  button: document.getElementById('thinking-toggle'),
  preface: document.getElementById('thinking-preface'),
  progress: document.getElementById('thinking-progress'),
  approachButton: document.getElementById('thinking-approach-toggle'),
  approach: document.getElementById('thinking-approach'),
  api,
  ui,
  onError: (message) => notice(message),
  onChange: () => {
    if (document.body.dataset.initialized === 'true') {
      publishAvatarComposer();
      scheduleRegions();
    }
  },
});
const internetMode = new InternetMode({
  button: document.getElementById('internet-toggle'),
  status: document.getElementById('internet-status'),
  api,
  ui,
  onError: (message) => notice(message),
  onChange: () => {
    if (document.body.dataset.initialized === 'true') {
      publishAvatarComposer();
      scheduleRegions();
    }
  },
});
let musicState = {
  enabled: false,
  hearingMusic: false,
  settings: { enabled: false, notes: true, motion: true },
};
let musicNotes, currentMusicMotion;
const musicAnimation = new MusicAnimation(),
  musicPose = new MusicPoseLayer();
const musicButton = document.getElementById('music-toggle');
function renderMusicState() {
  const busy = ['starting', 'preparing'].includes(musicState.phase);
  musicButton.setAttribute('aria-pressed', String(musicState.enabled));
  musicButton.setAttribute('aria-busy', String(busy));
  musicButton.dataset.loading = String(busy);
  musicButton.disabled = musicState.supported === false;
  document.body.dataset.musicListening = String(musicAnimationReady(musicState));
  signalFx?.invalidate();
}
const musicClient = new SystemMusicClient({
  api,
  onState: () => renderMusicState(),
  onError: () => notice('Music listening could not start. Try again from Settings.', 'warning'),
});
window.capriRunMusicCommand = async (action) => {
  if (action === 'stop') await musicClient.stop();
  else if (action === 'start') {
    if (!(await musicClient.start()))
      throw Error('Music listening could not start. Try again from Settings.');
  } else throw Error('Invalid music listening command.');
  return true;
};
musicButton.onclick = () =>
  window.capriRunMusicCommand(musicClient.run ? 'stop' : 'start').catch(() => {});
const memoryHUD = new MemoryHUD({
  element: document.getElementById('memory-hud'),
  contextButton: document.getElementById('context-hud'),
  graphs: document.getElementById('process-graphs-hud'),
  warnings: document.getElementById('resource-warnings'),
  toggle: document.getElementById('monitor-display'),
  api,
  ui,
  onLayout: () => scheduleRegions(),
  onError: notice,
});
const stopwatchHUD = new StopwatchHUD({
  element: document.getElementById('stopwatch-hud'),
  api,
  ui,
  onChange: () => scheduleRegions(),
  onError: notice,
  confirm: (options) => confirmDialog.ask(options),
});
let pendingAction = null;
let pendingActionTimer;
let dueReminder;
let computerTaskLabel;
const buttonFeedback = new ButtonFeedback();
const confirmDialog = new ConfirmationDialog({
  ui,
  onChange: (open) => {
    if (open) presence.reveal();
    api
      .interfaceBusy(open || Boolean(document.querySelector('.preferences-panel:not([hidden])')))
      .catch(() => {});
    scheduleRegions();
  },
});
const startupPanel = new StartupPanel(ui);
const confirmationRequests = new ConfirmationRequests({
  dialog: confirmDialog,
  prepare: () => mayLeaveSettings(null),
  respond: (value) => api.confirmAction(value),
});
let companionSettings;
let replyVisibility, subtitleController;
let startupIntro;
let inference;
let noticeSource = '';
let attachmentComposer,
  attachmentVision = false;
const wakeFeedback = new WakeFeedback({
  element: document.getElementById('wake-feedback'),
  root: document.body,
  text: (value) => ui.text(value),
  onSound: (value) => {
    if (!value.speaking && voicePlayer.source) return;
    microphoneClient?.playback(value);
  },
});
const elements = Object.fromEntries(
  [
    'messages',
    'welcome',
    'message',
    'send',
    'stop',
    'status',
    'notice',
    'reconnect',
    'sprite-region',
    'sprite',
    'avatar-expression',
    'handle',
    'announcement',
    'subtitle-stage',
    'last-input',
    'subtitle-text',
    'subtitle-state',
    'subtitle-controls',
    'subtitle-previous',
    'subtitle-next',
    'subtitle-position',
    'history-panel',
    'history-toggle',
    'history-close',
    'history-empty',
  ].map((id) => [id, document.getElementById(id)]),
);
const messages = new Map();
const modelsPanel = new ModelsPanel({
  api,
  ui,
  onError: notice,
  onOpen: (open) => preferencesOpened('models-panel', open),
});
window.addEventListener('capri-open-models', () =>
  modelsPanel.open(true).catch((error) => notice(error.message)),
);
const updatesPanel = new UpdatesPanel({
  api,
  ui,
  onError: notice,
  onOpen: (open) => preferencesOpened('updates-panel', open),
});
const updateNotification = new UpdateNotification({
  element: document.getElementById('update-notification'),
  ui,
  onLayout: () => {
    if (document.body.dataset.initialized === 'true') scheduleRegions();
  },
  onError: notice,
  onLater: () => api.remindUpdateLater(),
  onUpdate: async () => {
    await api.openSettings('updates');
    await api.remindUpdateLater();
    return api.downloadUpdate();
  },
});
window.addEventListener('capri-open-updates', () =>
  updatesPanel.open(true).catch((error) => notice(error.message)),
);
const companionPanel = new CompanionPanel({
  confirm: confirmDialog,
  api,
  ui,
  onError: notice,
  onOpen: (open) => preferencesOpened('companion-settings', open),
  onChange: (value) => {
    buttonFeedback.configure(value.buttonFeedback);
    companionSettings = value;
    replyVisibility?.configure(value);
    presence.expandOnReply = value.expandOnReply !== false;
    memoryHUD.configure(value);
    signalFx?.configure(value);
    wakeFeedback.configure(value, () => api.wakeAudio());
  },
});
document.getElementById('support-author').onclick = () => api.openSettings('support');
document.getElementById('report-bug').onclick = () => api.openSettings('bug');
const inferencePicker = new InferencePicker({
  button: document.getElementById('inference-label'),
  api,
  ui,
  onError: notice,
  onLayout: scheduleRegions,
  isBusy: () => Boolean(activeTurnId),
});
document.getElementById('notice-report').onclick = () => api.openSettings('bug');
document.getElementById('notice-dismiss').onclick = () => notice();
let applicationAccessState = { enabled: true };
function showApplicationAccess(value) {
  applicationAccessState = value;
  const button = document.querySelector('[data-quick="applications"]');
  button.setAttribute('aria-pressed', String(value.enabled));
  button.title = ui.text(value.enabled ? 'Pause application access' : 'Enable application access');
  applicationsPanel.showAccess(value);
}
document.querySelectorAll('[data-quick]').forEach((button) => {
  button.onclick = async () => {
    const feature = button.dataset.quick;
    if (feature === 'applications') {
      button.disabled = true;
      try {
        showApplicationAccess(await api.applicationAccess(!applicationAccessState.enabled));
      } catch (error) {
        notice(error.message);
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (feature === 'companion') api.openSettings();
    else onEvent({ type: 'open-' + feature });
  };
  if (button.dataset.quick === 'applications')
    button.oncontextmenu = (event) => {
      event.preventDefault();
      void api.openSettings('applications');
    };
});
const inputMic = document.getElementById('input-microphone'),
  headerMic = document.getElementById('microphone-toggle');
inputMic.onclick = async () => {
  if (inputMic.disabled || headerMic.getAttribute('aria-busy') === 'true') return;
  if (document.body.dataset.commandListening === 'true') {
    if (microphoneClient.state.wakeState === 'disabled')
      microphoneClient.stop(true, { keepModelWarm: true });
    else api.listenNow().catch(() => notice('The microphone could not start.'));
    return;
  }
  if (voiceSettings.enabled) voicePlayer.unlock().catch(() => {});
  notice();
  const wasRunning = Boolean(microphoneClient.run);
  if (!wasRunning) await microphoneClient.start();
  if (microphoneClient.state.wakeState === 'disabled') {
    if (wasRunning) microphoneClient.stop(true, { keepModelWarm: true });
    return;
  }
  if (microphoneClient.state.status === 'listening')
    api.listenNow().catch(() => notice('The microphone could not start.'));
};
const syncInputMic = () => {
  const loading = headerMic.getAttribute('aria-busy') === 'true';
  inputMic.disabled = headerMic.disabled || loading;
  setMicrophoneButtonBusy(inputMic, loading);
  const active = !loading && document.body.dataset.commandListening === 'true';
  inputMic.setAttribute('aria-pressed', String(active));
  const label = ui.text(
    loading ? 'Preparing speech recognition…' : active ? 'Stop voice input' : 'Speak now',
  );
  inputMic.setAttribute('aria-label', label);
  inputMic.title = label;
};
new MutationObserver(syncInputMic).observe(headerMic, { attributes: true });
new MutationObserver(syncInputMic).observe(document.body, {
  attributes: true,
  attributeFilter: ['data-command-listening'],
});
syncInputMic();
for (const id of [
  'language-panel',
  'file-access-panel',
  'applications-panel',
  'initiative-panel',
  'screen-panel',
  'time-panel',
  'voice-effects-panel',
]) {
  const heading = document.querySelector('#' + id + ' h2');
  if (heading) {
    const badge = document.createElement('small');
    badge.className = 'beta-badge';
    badge.textContent = ' (BETA)';
    heading.append(badge);
  }
}
let backend = { phase: 'starting', message: 'Starting local core…' };
let power = { phase: 'awake' },
  sleepAt = 0;
function showPower(value) {
  power = value ?? { phase: 'awake' };
  controls();
}
function syncSleepingVisual() {
  const wasSleeping = presence.sleeping;
  presence.setSleeping(visuallySleeping(power.phase, backend.phase));
  document.body.dataset.sleeping = String(presence.sleeping);
  if (avatarTapsSleeping(power.phase, backend.phase)) headpat.clear();
  if (presence.sleeping && !wasSleeping) sleepAt = performance.now();
  document.getElementById('sleep-indicator').hidden = !presence.sleeping;
  if (wasSleeping && !presence.sleeping) {
    presence.wakeUp({ reveal: presence.expandOnReply });
    director?.attend(performance.now(), true);
  }
}
let activeTurnId = null;
const pendingSpotifyTools = new Set();
let submitting = false;
const responsePaintStarts = new Map();
let ready = false;
let miniDraftRevision = 0,
  lastMiniSnapshot;
let dragPointer = null;
let regionsFrame = null;
let followOutput = true;
let companionLocale = ui.language;
const packetOriginLabel = document.querySelector('#packet-context > span');
let packetOrigin = 'YOU';
let packetPrompt = 'Connection established.';
const avatars = new Map();
const decodedImages = new Map();
let director = null,
  frameImages = null,
  renderedFrame = null,
  frameCatalog = new Map();
let frameTicket = 0,
  frameSequence = 0,
  wantedFrame = '',
  wantedRevision = -1;
const reportedImageFailures = new Set();
let avatarRevision = -1;
let avatarExpression = 'Neutral';
let catalogReady = false;
let queuedSelection = null;
let avatarPlacement = { ...DEFAULT_AVATAR_LAYOUT };
let placementReady = false;
let avatarCenterFrame = 0;
let spriteDrag = null;
let lastSpriteTap = null;
const presence = new PresenceModel();
const avatarDetachButton = document.getElementById('avatar-detach');
let avatarDetachPhase = 'attached';
let avatarDetachPending = false;
let desktopCue;
let desktopStatus;
replyVisibility = new ReplyVisibility({
  onChange: ({ hidden, turnId }) => {
    document.body.dataset.replyHidden = String(hidden);
    document.getElementById('subtitle-collapse').hidden = hidden;
    document.getElementById('subtitle-reveal').hidden = !hidden;
    subtitleController?.setHidden(hidden);
    if (desktopCue?.turnId === turnId && avatarDetachPhase !== 'attached')
      void api.avatarReply({ ...desktopCue, autoCollapsed: hidden }).catch(() => {});
    scheduleRegions();
  },
});
const replyStage = elements['subtitle-stage'];
replyStage.addEventListener('pointerenter', () => replyVisibility.hold('hover', true));
replyStage.addEventListener('pointerleave', () => replyVisibility.hold('hover', false));
replyStage.addEventListener('focusin', () => replyVisibility.hold('focus', true));
replyStage.addEventListener('focusout', () => replyVisibility.hold('focus', false));
document.addEventListener('selectionchange', () => {
  const selection = document.getSelection();
  replyVisibility.hold(
    'selection',
    Boolean(selection?.toString() && replyStage.contains(selection.anchorNode)),
  );
});
let signalFx;
let voiceSettings = { enabled: false, ready: false };
subtitleController = new SubtitleController({
  elements,
  ui,
  presence,
  getVoice: () => voicePlayer,
  getVoiceSettings: () => voiceSettings,
  onLayout: scheduleRegions,
  onCue: (text, turnId = '') => {
    turnId ??= '';
    const fullText = subtitleController.state.text.slice(0, 16000);
    if (
      avatarDetachPhase === 'attached' ||
      (text === desktopCue?.text &&
        turnId === desktopCue.turnId &&
        fullText === desktopCue.fullText)
    )
      return;
    desktopCue = { text, turnId, fullText };
    void api
      .avatarReply({ ...desktopCue, ...(replyVisibility.hidden && { autoCollapsed: true }) })
      .catch(() => {});
  },
});
let voiceBusy = false;
let microphoneClient, screenPanel;
let savedScreenshotId = null;
let screenshotAudioContext, screenshotSample;
async function screenshotSound() {
  try {
    const context =
      [screenshotAudioContext, voicePlayer.context].find((c) => c && c.state !== 'closed') ??
      (screenshotAudioContext = new AudioContext({ latencyHint: 'interactive' }));
    if (context.state === 'suspended') await context.resume();
    screenshotSample ??= api
      .screenshotSound()
      .then((bytes) =>
        bytes?.length ? context.decodeAudioData(Uint8Array.from(bytes).buffer) : null,
      )
      .catch(() => null);
    const buffer = await screenshotSample;
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => source.disconnect();
      source.start();
    } else playScreenshotShutter(context);
  } catch {
    /* Saving succeeds even if the system audio device is unavailable. */
  }
}
let microphoneText = '',
  publishedCallAudio = '',
  callAudioUpdate,
  callSpeechRequest = null,
  callSpeechPending = false,
  allowModelCallAudio = false;
function publishCallAudio() {
  const mic = microphoneClient?.state;
  const output = voicePlayer.callOutputState();
  const state = {
    micListening: mic?.enabled && mic.status === 'listening',
    systemAudioActive: mic?.systemAudioActive === true,
    systemAudioPending: mic?.systemAudioPending === true,
    systemAudioReview: mic?.systemAudioReview === true,
    systemAudioWake: mic?.systemAudioWake === true,
    callOutputReady: output.available,
    mixingMic: output.mixingMic,
    shareReplies: output.shareReplies,
    deviceId: output.available ? output.deviceId : '',
  };
  const serialized = JSON.stringify(state);
  if (serialized !== publishedCallAudio) {
    publishedCallAudio = serialized;
    callAudioUpdate = api.publishCallAudio(state).catch(() => {
      if (publishedCallAudio === serialized) publishedCallAudio = '';
    });
  }
  return callAudioUpdate;
}
function lastCallReply() {
  const last = [...messages.values()].at(-1)?.message;
  return last?.role === 'assistant' && last.status === 'complete' ? last.text : '';
}
async function speakInCall(text, model = false) {
  if (callSpeechPending || !voicePlayer.callOutputState().available || !text?.trim()) return;
  if (
    model &&
    (!allowModelCallAudio || attachmentComposer?.items.length || attachmentComposer?.pending)
  )
    return;
  const id = crypto.randomUUID();
  callSpeechRequest = id;
  callSpeechPending = true;
  controls();
  try {
    if (!(await api.speakInCall({ id, text, ...(model && { model }) }))) callSpeechRequest = null;
  } catch (error) {
    callSpeechRequest = null;
    notice(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
  } finally {
    callSpeechPending = false;
    controls();
  }
}
let callOutputGeneration = 0;
const callMicrophone = new CallMicrophone({ onLost: () => voicePlayer.disableCallOutput() });
const voicePlayer = new VoicePlayer({
  onPlayback: subtitlePlayback,
  enumerateCallOutputs: () => api.callAudioDevices(),
  onCallOutputState: () => {
    if (!voicePlayer.callOutputState().available) {
      callSpeechRequest = null;
      callMicrophone.stop();
    }
    void publishCallAudio();
    controls();
  },
  onState: (value) => {
    voiceBusy = value.busy;
    replyVisibility.playback(voicePlayer.turnId, value.busy);
    api.playbackState(value.busy).catch(() => {});
    presence.playback({ busy: value.busy, speaking: Boolean(value.text) });
    document.body.dataset.speaking = String(Boolean(value.text));
    microphoneClient?.playback({
      speaking: Boolean(value.text),
      text: value.text ?? '',
      outputBusy: value.busy && !value.waiting,
    });
    musicClient.playback({
      speaking: Boolean(value.text),
      outputBusy: value.busy && !value.waiting,
    });
    controls();
  },
  onError: (error) => {
    console.error('Voice playback failed:', error?.message ?? 'Unknown audio output error');
    api.stopVoice().catch(() => {});
    notice('Audio playback failed. Try unmuting Capri again.');
  },
});
const voiceEffectsPanel = new VoiceEffectsPanel({
  api,
  ui,
  onSettings: (value) => voicePlayer.setEffects(value),
  onOpen: (open) => preferencesOpened('voice-effects-panel', open),
  onError: notice,
});
const languagePanel = new LanguagePanel({
  confirm: confirmDialog,
  api,
  ui,
  onChange: refreshInterface,
  onOpen: (open) => preferencesOpened('language-panel', open),
  onError: notice,
});
const fileAccessPanel = new FileAccessPanel({
  api,
  ui,
  onOpen: (open) => preferencesOpened('file-access-panel', open),
  onError: notice,
});
const applicationsPanel = new ApplicationsPanel({
  api,
  ui,
  onOpen: (open) => preferencesOpened('applications-panel', open),
  onError: notice,
});
const speechPanel = new SpeechPanel({
  api,
  ui,
  onOpen: (open) => preferencesOpened('speech-panel', open),
  onError: notice,
});
const initiativePanel = new InitiativePanel({
  api,
  ui,
  onOpen: (open) => preferencesOpened('initiative-panel', open),
  onError: notice,
});
let screenFormTimer;
screenPanel = new ScreenPanel({
  onFormChange: () => {
    if (screenFormTimer || !screenPanel) return;
    screenFormTimer = setTimeout(() => {
      screenFormTimer = null;
      api.screenFormState(screenPanel.formState()).catch(() => {});
    }, 100);
  },
  api,
  ui,
  onOpen: (open) => preferencesOpened('screen-panel', open),
  onError: notice,
  onSend: () => {
    voicePlayer.stop();
    if (voiceSettings.enabled) voicePlayer.unlock().catch(() => {});
  },
});
window.capriRunScreenCommand = (command) => screenPanel.formCommand(command);
const timePanel = new TimePanel({
  api,
  ui,
  onOpen: (open) => preferencesOpened('time-panel', open),
  onError: notice,
});
document.getElementById('time-alert-open').onclick = () => {
  document.getElementById('time-alert').hidden = true;
  void timePanel.open(true);
  scheduleRegions();
};
document.getElementById('time-alert-dismiss').onclick = async () => {
  const id = dueReminder?.id;
  document.getElementById('time-alert').hidden = true;
  dueReminder = null;
  if (id) await api.timeAction({ action: 'cancel', id }).catch((error) => notice(error.message));
  scheduleRegions();
};
for (const [id, accepted] of [
  ['action-approve', true],
  ['action-reject', false],
])
  document.getElementById(id).onclick = async () => {
    if (!pendingAction) return;
    const request = pendingAction;
    document.getElementById('action-approve').disabled = true;
    document.getElementById('action-reject').disabled = true;
    try {
      const value = await api.actionRespond({ id: request.id, accepted });
      notice(ui.text(value.confirmation ?? (value.cancelled ? 'Cancelled.' : 'Done.')));
    } catch (error) {
      notice(error.message);
    } finally {
      document.getElementById('action-approve').disabled = false;
      document.getElementById('action-reject').disabled = false;
    }
  };
async function mayLeaveSettings(id) {
  for (const panel of [languagePanel, companionPanel]) {
    if (
      !panel.panel.hidden &&
      (panel.panel.id !== id || id === 'companion-settings') &&
      !(await panel.beforeClose())
    )
      return false;
  }
  return true;
}
let navigationBusy = false;
async function preferencesOpened(id, open) {
  if (open) {
    await api.openSettings(PANEL_SECTIONS[id] ?? 'general');
    return false;
  }
  if (navigationBusy) return false;
  navigationBusy = true;
  try {
    if (open ? !(await mayLeaveSettings(id)) : !(await mayLeaveSettings(null))) return false;
    if (open) {
      setHistory(false);
      for (const p of document.querySelectorAll('.preferences-panel')) p.hidden = p.id !== id;
      document.getElementById('dimming-panel').hidden = true;
      presence.reveal();
    }
    api.interfaceBusy(open).catch(() => {});
    scheduleRegions();
    return true;
  } finally {
    navigationBusy = false;
  }
}
microphoneClient = new MicrophoneClient({
  api,
  onState: (value) => {
    callMicrophone.sync(microphoneClient?.run?.stream);
    void publishCallAudio();
    wakeFeedback.settings(value);
    presence.microphone =
      value.enabled && value.status === 'listening' && value.wakeState !== 'waiting';
    presence.wake = value.enabled && value.status === 'listening' && value.wakeState === 'waiting';
    document.body.dataset.microphone = value.status;
    const code = (value.language ?? 'en').toUpperCase();
    renderMicrophoneLabel(value);
    if (!value.enabled && !microphoneText)
      document.getElementById('microphone-preview').hidden = true;
    else document.getElementById('microphone-preview').hidden = false;
    controls();
    redrawAvatar();
  },
  onText: (value) => {
    microphoneText = value.text;
    renderMicrophoneLabel(microphoneClient.state);
    document.getElementById('microphone-preview').hidden =
      !value.text && !microphoneClient.state.enabled;
    document.getElementById('microphone-preview').dataset.final = String(value.final);
    if (value.text) {
      director?.attend(performance.now(), true);
      presence.replyAttention();
    }
    if (value.final && value.autoSend === false && !elements.message.value.trim()) {
      elements.message.value = value.text;
      sizeInput();
    }
    redrawAvatar();
    controls();
  },
  onInterrupt: () => {
    voicePlayer.stop();
    director?.attend(performance.now(), true);
    presence.replyAttention();
  },
  onWake: (_event, context) => {
    wakeFeedback.activate(context);
    presence.wakeUp({ reveal: presence.expandOnReply });
    director?.attend(performance.now(), true);
    redrawAvatar();
    scheduleRegions();
  },
  onError: (message) => notice(message),
  onLevel: (value) => {
    document
      .getElementById('microphone-preview')
      .style.setProperty('--microphone-level', String(value));
    document.getElementById('wake-feedback').style.setProperty('--level', String(value));
  },
});
window.capriRunCallAudioCommand = async ({
  action,
  deviceId,
  micDeviceId,
  wakeFromSystem,
  mixMic,
  enabled,
}) => {
  if (action === 'output-on') {
    const generation = ++callOutputGeneration;
    voicePlayer.disableCallOutput();
    callMicrophone.stop();
    try {
      const stream = mixMic
        ? await callMicrophone.start({
            deviceId: micDeviceId,
            shared: microphoneClient.run?.stream,
          })
        : null;
      if (generation !== callOutputGeneration) return;
      await voicePlayer.enableCallOutput(deviceId, stream);
    } catch (error) {
      if (generation === callOutputGeneration) {
        callMicrophone.stop();
        voicePlayer.disableCallOutput();
      }
      throw error;
    }
  }
  if (action === 'output-off') {
    callOutputGeneration++;
    callMicrophone.stop();
    voicePlayer.disableCallOutput();
  }
  if (action === 'share-replies') voicePlayer.setCallReplySharing(enabled);
  if (action === 'system-on') {
    if (microphoneClient.state.status !== 'listening')
      throw new Error('System audio requires an active microphone in Capri.');
    if (!(await microphoneClient.setSystemAudio(true, wakeFromSystem)))
      throw new Error('System audio could not start. Microphone input is still active.');
  }
  if (action === 'system-off') await microphoneClient.setSystemAudio(false);
  // Flush the setting before returning to the Settings window.
  await publishCallAudio();
};
document.getElementById('call-speak').onclick = () => speakInCall(elements.message.value);
document.getElementById('call-speak-last').onclick = () => speakInCall(lastCallReply());
document.getElementById('call-ask').onclick = () => speakInCall(elements.message.value, true);
document.getElementById('call-output-stop').onclick = () => voicePlayer.disableCallOutput();
function showVoiceSettings(value) {
  const changedLanguage = value.language !== voiceSettings.language;
  voiceSettings = value;
  if (changedLanguage && companionSettings.wakeSound === 'voice')
    wakeFeedback.configure(companionSettings, () => api.wakeAudio());
  const button = document.getElementById('voice-toggle');
  button.setAttribute('aria-pressed', String(value.enabled));
  const label = ui.text(
    value.language === 'off'
      ? 'Text replies only'
      : value.error
        ? 'Retry voice'
        : value.enabled
          ? 'Mute Capri'
          : 'Unmute Capri',
  );
  button.disabled = value.language === 'off';
  button.setAttribute('aria-label', label);
  button.title =
    !value.error && value.enabled && !value.ready && value.language !== 'off'
      ? ui.text('Capri’s voice is loading…')
      : label;
  if (!value.enabled || value.error || value.language === 'off') voicePlayer.stop();
}
function stopReply() {
  callSpeechRequest = null;
  voicePlayer.stop();
  api.stopVoice().catch(() => {});
  if (activeTurnId) api.cancel(activeTurnId).catch(() => notice('The reply could not be stopped.'));
}

function avatarViewport() {
  const frame = document.getElementById('portrait-panel').getBoundingClientRect();
  const origin = document.getElementById('companion').getBoundingClientRect();
  const width = Math.max(1, frame.width - 24),
    height = Math.max(1, frame.height - 44);
  return {
    x: frame.x - origin.x + 12,
    y: frame.y - origin.y + 14,
    width,
    height,
    baseSize: Math.min(430, width, director ? height : height * 2),
    centerFaces: true,
  };
}

function avatarClip(rect) {
  const viewport = avatarViewport();
  const origin = document.getElementById('companion').getBoundingClientRect();
  return clippedAvatarRect(
    rect,
    { width: innerWidth, height: innerHeight },
    { ...viewport, x: viewport.x + origin.x, y: viewport.y + origin.y },
  );
}

function avatarHitRegion(rect) {
  const sprite = avatarClip(rect);
  sprite.enabled =
    presence.snapshot().expanded &&
    avatarDetachPhase === 'attached' &&
    !startupIntro?.pending &&
    !startupIntro?.active &&
    !document.body.dataset.avatarArriving;
  if (sprite.enabled && document.body.dataset.crt === 'webgl') {
    const viewport = avatarViewport();
    const origin = document.getElementById('companion').getBoundingClientRect();
    sprite.lens = {
      x: viewport.x + origin.x,
      y: viewport.y + origin.y,
      width: viewport.width,
      height: viewport.height,
      curve: CRT_CURVATURE,
    };
  }
  return sprite;
}

function currentAvatarFrameId() {
  return director ? renderedFrame?.id : undefined;
}

function avatarGeometry() {
  const { x, y, width, height } = elements['sprite-region'].getBoundingClientRect();
  const rect = { x, y, width, height };
  const clip = avatarClip(rect);
  return { rect, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } };
}

function avatarDepartureGeometry() {
  startupIntro?.cancel();
  cancelAvatarCentering();
  const frameId = currentAvatarFrameId();
  if (avatarDetachPhase !== 'attached' || !frameId || document.body.dataset.avatarArriving)
    return null;
  presence.touch();
  endSpriteDrag();
  return { frameId, ...avatarGeometry() };
}

globalThis.capriAvatarDepartureGeometry = () => {
  if (avatarDetachPhase !== 'attached' || !currentAvatarFrameId()) return null;
  if (document.body.dataset.presence !== 'portrait') {
    presence.reveal();
    const { dataset } = document.body;
    dataset.avatarMeasuring = 'true';
    dataset.presence = 'portrait';
    try {
      redrawAvatar();
      return avatarDepartureGeometry();
    } finally {
      delete dataset.avatarMeasuring;
    }
  }
  return avatarDepartureGeometry();
};

globalThis.capriAvatarReturnGeometry = (drop) => {
  if (avatarDetachPhase !== 'detached') return null;
  const { dataset } = document.body;
  const { presence: previousPresence, avatarDock } = dataset;
  const previousPlacement = avatarPlacement;
  // Measure the expanded portrait without presenting it while the avatar is outside.
  dataset.avatarMeasuring = 'true';
  dataset.presence = 'portrait';
  delete dataset.avatarDock;
  try {
    redrawAvatar();
    // The teleport and home renderer must agree on the centered arrival,
    // including a return by button rather than only a drag-and-drop return.
    avatarPlacement = centeredHomePlacement();
    redrawAvatar();
    return { ...avatarGeometry(), layout: avatarPlacement };
  } finally {
    avatarPlacement = previousPlacement;
    dataset.presence = previousPresence;
    if (avatarDock) dataset.avatarDock = avatarDock;
    redrawAvatar();
    delete dataset.avatarMeasuring;
  }
};

function updateAvatarDetachButton() {
  const attached = avatarDetachPhase === 'attached';
  const outside = !attached && avatarDetachPhase !== 'leaving';
  const label = ui.text(outside ? 'Return to frame' : 'Leave frame');
  avatarDetachButton.title = label;
  avatarDetachButton.setAttribute('aria-label', label);
  avatarDetachButton.disabled =
    avatarDetachPending ||
    Boolean(document.body.dataset.avatarArriving) ||
    (outside ? avatarDetachPhase !== 'detached' : !attached || !currentAvatarFrameId());
  const hide = document.getElementById('hide');
  hide.title = ui.text(attached ? 'Hide to tray' : 'Hide interface');
  hide.setAttribute('aria-label', ui.text(attached ? 'Hide Capri to tray' : 'Hide interface'));
  hide.disabled =
    avatarDetachPending ||
    Boolean(document.body.dataset.avatarArriving) ||
    (!attached && avatarDetachPhase !== 'detached');
}

function updateAvatarDetachPhase(phase) {
  if (
    !['attached', 'leaving', 'detached', 'teleporting', 'returning'].includes(phase) ||
    phase === avatarDetachPhase
  )
    return;
  const returning = avatarDetachPhase === 'returning' && phase === 'attached';
  cancelAvatarCentering();
  avatarDetachPhase = phase;
  desktopCue = undefined;
  desktopStatus = undefined;
  subtitleController.render();
  publishDesktopStatus();
  headpat.clear();
  const body = document.body;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  body.dataset.avatarDetach = phase;
  if (phase === 'attached') delete body.dataset.avatarDock;
  else {
    endSpriteDrag();
    if (phase !== 'leaving' || reduced) body.dataset.avatarDock = 'compact';
  }
  body.removeAttribute('data-avatar-arriving');
  if (returning) {
    presence.reveal();
    body.dataset.presence = 'portrait';
    if (!reduced) body.dataset.avatarArriving = 'true';
  }
  if (phase === 'attached') {
    redrawAvatar();
    centerHomeAvatar({ immediate: returning });
  }
  frameTicket++;
  wantedFrame = '';
  updateAvatarDetachButton();
  scheduleRegions();
}

function publishDesktopStatus() {
  if (avatarDetachPhase === 'attached') return;
  const { label, color } = SIGNAL_STATES[presence.snapshot().state];
  const text = ui.text(label);
  const sleeping = avatarTapsSleeping(power.phase, backend.phase);
  if (
    desktopStatus?.text === text &&
    desktopStatus.color === color &&
    desktopStatus.language === ui.language &&
    desktopStatus.sleeping === sleeping
  )
    return;
  desktopStatus = { text, color, language: ui.language, sleeping };
  void api.avatarStatus({ text, color }).catch(() => {});
}

avatarDetachButton.addEventListener('click', async () => {
  if (avatarDetachButton.disabled) return;
  const leaving = avatarDetachPhase === 'attached';
  if (leaving && !presence.snapshot().expanded) return;
  avatarDetachPending = true;
  updateAvatarDetachButton();
  try {
    const geometry = leaving ? avatarDepartureGeometry() : undefined;
    if (leaving && !geometry) return;
    if (!(await api.windowAction(leaving ? 'leave-frame' : 'return-to-frame', geometry)))
      notice('Could not teleport Capri.');
  } catch {
    notice('Could not teleport Capri.');
  } finally {
    avatarDetachPending = false;
    updateAvatarDetachButton();
  }
});
document.getElementById('portrait-panel').addEventListener('animationend', (event) => {
  if (event.animationName === 'avatar-frame-leave' && avatarDetachPhase === 'leaving') {
    document.body.dataset.avatarDock = 'compact';
    scheduleRegions();
  }
});
for (const eventName of ['animationend', 'animationcancel']) {
  document.body.addEventListener(eventName, (event) => {
    if (event.target !== document.body || event.animationName !== 'avatar-frame-return') return;
    delete document.body.dataset.avatarArriving;
    updateAvatarDetachButton();
    scheduleRegions();
  });
}

function redrawAvatar() {
  document.body.style.setProperty(
    '--dock-height',
    `${Math.round(document.getElementById('input-dock').getBoundingClientRect().height)}px`,
  );
  const viewport = avatarViewport();
  const rect = director
    ? registeredAvatarRect(avatarPlacement, viewport, renderedFrame)
    : avatarRect(avatarPlacement, viewport);
  const viewportStyle = document.getElementById('avatar-viewport').style;
  viewportStyle.clipPath = `inset(${viewport.y}px ${innerWidth - viewport.x - viewport.width}px ${innerHeight - viewport.y - viewport.height}px ${viewport.x}px)`;
  if (document.body.dataset.avatarArriving) {
    const frame = document.getElementById('portrait-panel').getBoundingClientRect();
    const origin = document.getElementById('companion').getBoundingClientRect();
    viewportStyle.setProperty(
      '--avatar-frame-center',
      `${frame.y - origin.y + frame.height / 2}px`,
    );
    viewportStyle.setProperty('--avatar-frame-reach', `${frame.height / 2 + 20}px`);
  }
  const style = elements['sprite-region'].style;
  style.left = `${rect.x}px`;
  style.top = `${rect.y}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  elements['sprite-region'].dataset.zoom = String(avatarPlacement.zoom);
  scheduleRegions();
}

function centeredHomePlacement() {
  return centerAvatarFace(
    avatarPlacement,
    avatarViewport(),
    renderedFrame,
    avatarPoseLandmarks(renderedFrame?.id)?.face,
  );
}

function cancelAvatarCentering() {
  cancelAnimationFrame(avatarCenterFrame);
  avatarCenterFrame = 0;
  delete document.body.dataset.avatarCentering;
}

function centerHomeAvatar({ immediate = false } = {}) {
  cancelAvatarCentering();
  if (!placementReady || !director || spriteDrag || avatarDetachPhase !== 'attached') return;
  const from = { ...avatarPlacement };
  const target = centeredHomePlacement();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (immediate || reduced.matches || Math.hypot(target.x - from.x, target.y - from.y) < 0.0001) {
    avatarPlacement = target;
    redrawAvatar();
    signalFx?.invalidate();
    return;
  }
  const started = performance.now();
  document.body.dataset.avatarCentering = 'true';
  const step = (now) => {
    if (spriteDrag || avatarDetachPhase !== 'attached') {
      cancelAvatarCentering();
      return;
    }
    // Re-evaluate the destination while the home frame unfolds or resizes.
    const to = centeredHomePlacement();
    const progress = reduced.matches ? 1 : Math.min(1, Math.max(0, (now - started) / 320));
    const ease = 1 - (1 - progress) ** 3;
    avatarPlacement = {
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease,
      zoom: from.zoom,
    };
    redrawAvatar();
    signalFx?.invalidate();
    if (progress < 1) avatarCenterFrame = requestAnimationFrame(step);
    else cancelAvatarCentering();
  };
  avatarCenterFrame = requestAnimationFrame(step);
}

function setPlacement(value, persist = true) {
  cancelAvatarCentering();
  presence.touch();
  avatarPlacement = validateAvatarLayout(value);
  redrawAvatar();
  if (persist)
    api.setAvatarLayout(avatarPlacement).catch(() => notice('Could not save Capri’s placement.'));
}

function changeZoom(zoom, anchor) {
  if (!placementReady || spriteDrag) return;
  if (anchor) {
    const origin = document.getElementById('companion').getBoundingClientRect();
    anchor = { x: anchor.x - origin.x, y: anchor.y - origin.y };
  }
  setPlacement(zoomAvatar(avatarPlacement, avatarViewport(), zoom, anchor));
}

function startSpriteDrag(event) {
  if (event.button !== 0 || !placementReady || dragPointer !== null || spriteDrag) return;
  const frameId = currentAvatarFrameId() ?? avatars.get(elements.sprite.dataset.avatar)?.frameId;
  if (!frameId || avatarDetachPhase !== 'attached' || !presence.snapshot().expanded) return;
  cancelAvatarCentering();
  const target = elements['sprite-region'];
  const sprite = avatarHitRegion(target.getBoundingClientRect());
  event.preventDefault();
  target.setPointerCapture(event.pointerId);
  const gesture = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    sample: screenSample({ x: event.clientX, y: event.clientY }, sprite.lens),
    lens: sprite.lens,
    layout: { ...avatarPlacement },
    viewport: avatarViewport(),
    started: performance.now(),
    accepted: false,
    moved: false,
  };
  spriteDrag = gesture;
  api
    .startAvatarDrag({ frameId, sprite, point: { x: gesture.x, y: gesture.y } })
    .then((accepted) => {
      if (spriteDrag !== gesture) return;
      if (!accepted) {
        endSpriteDrag();
        return;
      }
      gesture.accepted = true;
      if (gesture.released) endSpriteDrag(gesture.released);
      else if (gesture.last) moveSprite(gesture.last);
    })
    .catch(() => {
      if (spriteDrag === gesture) endSpriteDrag();
    });
}

function moveSprite(event) {
  const gesture = spriteDrag;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (performance.now() - gesture.started > 30000) {
    endSpriteDrag();
    return;
  }
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  gesture.moved ||= Math.hypot(dx, dy) >= 5;
  if (!gesture.accepted) {
    gesture.last = event;
    return;
  }
  if (!gesture.moved) return;
  headpat.clear();
  elements['sprite-region'].dataset.dragging = 'true';
  const sample = screenSample({ x: event.clientX, y: event.clientY }, gesture.lens);
  setPlacement(
    moveAvatar(
      gesture.layout,
      gesture.viewport,
      sample.x - gesture.sample.x,
      sample.y - gesture.sample.y,
    ),
    false,
  );
}

function endSpriteDrag(event = {}) {
  const gesture = spriteDrag;
  if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.pointerId)) return;
  if (event.type === 'lostpointercapture' && gesture.released) return;
  const released = event.type === 'pointerup';
  if (released) {
    moveSprite(event);
    if (spriteDrag !== gesture) return;
    if (!gesture.accepted) {
      gesture.released = event;
      return;
    }
  }
  const click = released && !gesture.moved;
  if (click) lastSpriteTap = { x: gesture.x, y: gesture.y };
  spriteDrag = null;
  const target = elements['sprite-region'];
  target.dataset.dragging = 'false';
  if (target.hasPointerCapture(gesture.pointerId)) target.releasePointerCapture(gesture.pointerId);
  const point = click ? { x: event.clientX, y: event.clientY } : undefined;
  const drop = released && gesture.moved ? { x: event.clientX, y: event.clientY } : undefined;
  if (gesture.accepted && gesture.moved) setPlacement(avatarPlacement);
  void api.endAvatarDrag({ click, point, drop }).catch(() => {});
}

function showAvatarTap(count, tone) {
  if (avatarDetachPhase !== 'attached' || !lastSpriteTap) return;
  const target = document.getElementById('avatar-viewport');
  const box = target.getBoundingClientRect();
  showAvatarTapEffect(target, {
    x: lastSpriteTap.x - box.x,
    y: lastSpriteTap.y - box.y,
    count,
    tone,
  });
  lastSpriteTap = null;
}

function subtitlePlayback(event) {
  if (event.type === 'started') replyVisibility.expectSpeech(event.turnId);
  subtitleController.playback(event);
}
function renderSubtitle() {
  subtitleController.render();
}
function showSubtitles(message, reset = false) {
  subtitleController.update(message, reset);
  if (message && (!activeTurnId || message.turnId === activeTurnId))
    replyVisibility.update(
      message,
      Boolean(
        voiceSettings.enabled &&
          !voiceSettings.error &&
          voiceSettings.language !== 'off' &&
          voicePlayer.turnId === message.turnId,
      ),
    );
}
function stepSubtitle(direction) {
  replyVisibility.reveal();
  subtitleController.step(direction);
}

async function setHistory(open) {
  if (open && !(await mayLeaveSettings(null))) return false;
  replyVisibility.hold('history', open);
  if (open) replyVisibility.reveal();
  api.interfaceBusy(open).catch(() => {});
  presence.touch();
  if (open) presence.reveal();
  if (open) document.getElementById('dimming-panel').hidden = true;
  if (open) for (const p of document.querySelectorAll('.preferences-panel')) p.hidden = true;
  elements['history-panel'].hidden = !open;
  elements['history-toggle'].setAttribute('aria-expanded', String(open));
  elements['history-toggle'].setAttribute(
    'aria-label',
    ui.text(open ? 'Close conversation history' : 'Open conversation history'),
  );
  subtitleController.activity();
  if (open) {
    followOutput = true;
    scrollToLatest();
    elements['history-close'].focus();
  } else elements['history-toggle'].focus();
  scheduleRegions();
}

async function setDimmingPanel(open) {
  if (open) {
    await api.openSettings('dimming');
    return;
  }
  if (open && !(await mayLeaveSettings(null))) return false;
  if (open) presence.reveal();
  if (open && !elements['history-panel'].hidden) setHistory(false);
  if (open) for (const p of document.querySelectorAll('.preferences-panel')) p.hidden = true;
  document.getElementById('dimming-panel').hidden = !open;
  api.interfaceBusy(open).catch(() => {});
  if (open) document.getElementById('dimming-level').focus();
  else document.getElementById('settings-open')?.focus();
  scheduleRegions();
}

function showDimmingSettings(value) {
  value = validateDimming(value);
  const shade = document.getElementById('window-shade');
  shade.style.setProperty('--shade-strength', String(value.enabled ? value.level / 100 : 0));
  shade.style.setProperty('--shade-softness', `${value.softness}px`);
  shade.dataset.softEdges = String(value.softness > 0);
  document.getElementById('dimming-enabled').checked = value.enabled;
  document.getElementById('dimming-level').value = String(value.level);
  document.getElementById('dimming-softness').value = String(value.softness);
  refreshDimmingLabels();
  scheduleRegions();
}

function refreshDimmingLabels() {
  const level = Number(document.getElementById('dimming-level').value),
    softness = Number(document.getElementById('dimming-softness').value);
  document.getElementById('dimming-level-value').textContent = new Intl.NumberFormat(ui.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(level / 100);
  document.getElementById('dimming-softness-value').textContent = ui.text('{value} px', {
    value: new Intl.NumberFormat(ui.language).format(softness),
  });
}

function updateDimming() {
  const value = {
    enabled: document.getElementById('dimming-enabled').checked,
    level: Number(document.getElementById('dimming-level').value),
    softness: Number(document.getElementById('dimming-softness').value),
  };
  showDimmingSettings(value);
  api.setDimming(value).catch(() => notice('Screen dimming could not be updated.'));
}

let lastDraftBusy = false;
function sizeInput() {
  const busy = Boolean(
    elements.message.value.trim() ||
      attachmentComposer?.items.length ||
      attachmentComposer?.pending,
  );
  if (busy !== lastDraftBusy) {
    lastDraftBusy = busy;
    api.draftState(busy).catch(() => {});
  }
  elements.message.style.height = '29px';
  const maximum = innerHeight <= 400 ? 29 : innerHeight <= 540 ? 48 : 67;
  elements.message.style.height = `${Math.max(29, Math.min(maximum, elements.message.scrollHeight))}px`;
  scheduleRegions();
}

function setAvatarExpression(label) {
  avatarExpression = label;
  const localized = label
    .split(' · ')
    .map((part) => ui.text(part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' · ');
  elements['avatar-expression'].textContent = localized;
  elements.sprite.alt = `Capri — ${localized}`;
}

function setPacketInput(text = '', prompt = '') {
  packetPrompt = prompt;
  elements['last-input'].textContent = prompt ? ui.text(prompt) : text;
}

function setPacketOrigin(origin) {
  packetOrigin =
    {
      initiative: 'CAPRI // INITIATIVE',
      screen: 'YOU // SNAPSHOT',
      'avatar-click': 'CAPRI',
    }[origin] ?? 'YOU';
  packetOriginLabel.textContent = ui.text(packetOrigin);
}

async function showAvatar(selection) {
  if (!catalogReady) {
    if (!queuedSelection || selection.revision >= queuedSelection.revision)
      queuedSelection = selection;
    return;
  }
  const sprite = avatars.get(selection.id);
  if (!sprite || !Number.isSafeInteger(selection.revision) || selection.revision < avatarRevision)
    return;
  avatarRevision = selection.revision;
  try {
    if (frameImages) await frameImages.get(sprite.frameId);
    else await decodedImages.get(sprite.id);
    if (selection.revision !== avatarRevision) return;
    if (!(await api.avatarReady({ id: sprite.id, revision: selection.revision }))) return;
    if (selection.revision !== avatarRevision) return;
    // Every PNG uses the same full canvas and ground anchor. Never fit to its
    // visible bounds: future body poses must retain their natural placement.
    if (!director) elements.sprite.src = sprite.url;
    if (!director) {
      elements.sprite.dataset.avatar = sprite.id;
      elements.sprite.dataset.pose = sprite.pose;
      elements.sprite.dataset.expression = sprite.expression;
      if (avatarDetachButton.disabled && !avatarDetachPending) updateAvatarDetachButton();
    }
    setAvatarExpression(sprite.label);
    if (director) {
      director.select(sprite.id, selection.revision, performance.now());
      const animation = director.sequence;
      for (const frame of animation?.frames ?? []) frameImages.get(frame.id).catch(() => {});
      if (animation?.effect) frameImages.get(animation.effect.id).catch(() => {});
      wantedFrame = '';
      frameTicket++;
      animateCharacter(
        performance.now(),
        presence.snapshot(),
        matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
    }
    if (presence.expanded) presence.burst();
  } catch {
    if (selection.revision !== avatarRevision) return;
    notice('An expression could not be loaded. Keeping the current sprite.');
    if (elements.sprite.dataset.avatar !== sprite.id && !reportedImageFailures.has(sprite.id)) {
      reportedImageFailures.add(sprite.id);
      api.avatarFailed({ id: sprite.id, revision: selection.revision }).catch(() => {});
    }
  }
}

let spriteReaction, spriteReactionTimer, poseSettle;
const avatarVisemes = new AvatarVisemes();
const portraitMouth = new AvatarMouthLayer(elements.sprite);
let mouthShape = 'closed',
  desktopMouth;
function animateCharacter(now, snapshot, reduced) {
  if (avatarDetachPhase !== 'attached' && companionSettings?.detachedStyle === 'dialogue') return;
  if (startupIntro?.active) {
    musicNotes?.clear();
    startupIntro.tick(now);
    return;
  }
  const detached = avatarDetachPhase === 'detached';
  mouthShape = avatarVisemes.sample(
    now,
    presence.speaking && !presence.sleeping,
    voicePlayer.level,
  );
  if (detached && desktopMouth !== mouthShape) {
    desktopMouth = mouthShape;
    api.avatarMouth(mouthShape).catch(() => {});
  } else if (!detached) desktopMouth = undefined;
  if (avatarDetachPhase === 'attached')
    portraitMouth.update(headpat.image(elements.sprite), mouthShape, renderedFrame?.id);
  if (!director || (!detached && avatarDetachPhase !== 'attached')) {
    musicNotes?.clear();
    return;
  }
  if (presence.sleeping) {
    const label = document.getElementById('sleep-indicator');
    label.textContent = sleepCaption(reduced ? 1500 : now - sleepAt);
    const box = elements['sprite-region'].getBoundingClientRect();
    const origin = document.getElementById('companion').getBoundingClientRect();
    label.style.left = `${Math.min(innerWidth - 95, Math.max(16, box.x - origin.x + box.width * 0.7))}px`;
    label.style.top = `${Math.max(92, box.y - origin.y + box.height * 0.12)}px`;
  }
  const state = director.tick(now, {
    expanded: detached || snapshot.expanded,
    active: Boolean(activeTurnId),
    typing: Boolean(elements.message.value.trim() || microphoneText),
    speaking: presence.speaking,
    dragging: Boolean(spriteDrag || dragPointer !== null),
    reduced: reduced || startupIntro?.pending,
    sleeping: presence.sleeping,
  });
  if (!state) return;
  // Moving Capri or her window changes placement, not the current music pose.
  const musicActive = Boolean(
    musicAnimationReady(musicState) &&
      !presence.sleeping &&
      !activeTurnId &&
      !elements.message.value.trim() &&
      !microphoneText &&
      !spriteReaction &&
      !startupIntro?.pending &&
      headpat.image(elements.sprite) === elements.sprite,
  );
  if (musicActive && frameCatalog.has('music-floor')) {
    state.frameId = 'music-floor';
    state.activity = 'Music listening';
    state.effect = null;
  }
  currentMusicMotion = musicAnimation.sample(now, {
    active: musicActive && avatarDetachPhase === 'attached',
    strength: musicState.energy,
    autoBpm: musicState.settings.autoBpm !== false,
    tempo: musicState.tempo ?? 0,
    tempoConfidence: musicState.tempoConfidence ?? 0,
    beatAt: musicState.beatAt ?? 0,
    reduced,
    frameId: renderedFrame?.id,
  });
  if (musicState.settings.motion === false)
    currentMusicMotion = { ...currentMusicMotion, angle: 0, dy: 0 };
  if (avatarDetachPhase === 'attached' && musicState.settings.notes !== false)
    musicNotes?.update(currentMusicMotion, {
      rect: elements.sprite.getBoundingClientRect(),
      clip: document.getElementById('avatar-viewport').getBoundingClientRect(),
    });
  else musicNotes?.clear();
  if (spriteReaction && frameCatalog.has(spriteReaction) && !presence.sleeping && !spriteDrag) {
    state.frameId = spriteReaction;
    state.activity = 'reaction';
  }
  const effect = document.getElementById('avatar-effect');
  effect.hidden = detached || !state.effect || !snapshot.expanded;
  if (!effect.hidden) {
    const asset = frameCatalog.get(state.effect.id),
      box = elements['sprite-region'].getBoundingClientRect(),
      origin = document.getElementById('companion').getBoundingClientRect();
    const size = (state.effect.width * 1254) / asset.visibleBounds.width,
      progress = state.effect.progress;
    if (effect.src !== asset.url) effect.src = asset.url;
    effect.style.width = effect.style.height = `${size}px`;
    effect.style.left = `${box.x - origin.x + box.width * 0.55 - size / 2 + progress * 28}px`;
    effect.style.top = `${box.y - origin.y + box.height * 0.36 - size / 2 - progress * 35}px`;
    effect.style.opacity = String(Math.sin(progress * Math.PI));
    effect.style.transform = `scale(${0.65 + progress * 0.4})`;
  }
  document.body.dataset.activity = state.activity;
  if (state.frameId === wantedFrame && state.revision === wantedRevision) return;
  wantedFrame = state.frameId;
  wantedRevision = state.revision;
  const ticket = ++frameTicket,
    sequence = ++frameSequence,
    frame = frameCatalog.get(state.frameId);
  if (!frame || frame.kind === 'effect') return;
  frameImages
    .get(frame.id)
    .then(async () => {
      if (ticket !== frameTicket || state.revision !== avatarRevision) return;
      if (!(await api.avatarFrameReady({ id: frame.id, revision: state.revision, sequence })))
        return;
      if (ticket !== frameTicket || state.revision !== avatarRevision) return;
      const poseChanged = renderedFrame && frame.pose !== renderedFrame.pose;
      const previousFace =
        poseChanged && avatarDetachPhase === 'attached' && !spriteDrag
          ? avatarFacePoint(
              avatarPlacement,
              avatarViewport(),
              renderedFrame,
              avatarPoseLandmarks(renderedFrame.id)?.face,
            )
          : null;
      const reviewedTransition =
        poseChanged &&
        [renderedFrame.kind, frame.kind].some((kind) =>
          ['reviewed_pose', 'reviewed_music'].includes(kind),
        );
      if (reviewedTransition) headpat.clear();
      renderedFrame = frame;
      if (previousFace) {
        cancelAvatarCentering();
        const viewport = avatarViewport();
        const nextFace = avatarFacePoint(
          avatarPlacement,
          viewport,
          frame,
          avatarPoseLandmarks(frame.id)?.face,
        );
        avatarPlacement = moveAvatar(
          avatarPlacement,
          viewport,
          previousFace.x - nextFace.x,
          previousFace.y - nextFace.y,
        );
      }
      elements.sprite.src = frame.url;
      elements.sprite.dataset.avatar = state.choiceId;
      elements.sprite.dataset.pose = avatars.get(state.choiceId)?.pose ?? frame.pose;
      elements.sprite.dataset.expression =
        avatars.get(state.choiceId)?.expression ?? frame.expression;
      elements.sprite.dataset.frame = frame.id;
      elements.sprite.dataset.framePose = frame.pose;
      if (avatarDetachButton.disabled && !avatarDetachPending) updateAvatarDetachButton();
      const activity =
        frameCatalog.get(state.activity)?.label ??
        {
          sleep: 'Sleeping',
          'looking-around': 'Looking around',
        }[state.activity];
      setAvatarExpression(activity ?? avatars.get(state.choiceId)?.label ?? frame.label);
      if (avatarDetachPhase === 'attached') redrawAvatar();
      if (poseChanged && avatarDetachPhase === 'attached') centerHomeAvatar();
      if (reviewedTransition && !reduced && avatarDetachPhase === 'attached') {
        poseSettle?.cancel();
        poseSettle = document
          .getElementById('avatar-viewport')
          .animate([{ opacity: 0.45 }, { opacity: 1 }], {
            duration: 175,
            easing: 'cubic-bezier(.19,.75,.2,1)',
          });
      } else if (poseChanged && !reviewedTransition) presence.burst();
    })
    .catch(() => {
      if (ticket === frameTicket) {
        wantedFrame = renderedFrame?.id ?? '';
        notice('An animation frame could not be loaded. Keeping the current pose.');
      }
    });
}

function notice(text = '', severity = 'error') {
  noticeSource = String(text ?? '').replace(
    /^Error invoking remote method 'capri:[a-z-]+': (?:Error: )?/,
    '',
  );
  if (screenImageWarning(noticeSource)) severity = 'warning';
  document.getElementById('notice-message').textContent = ui.text(noticeSource);
  elements.notice.dataset.severity = severity === 'warning' ? 'warning' : 'error';
  document.getElementById('notice-report').hidden = severity === 'warning';
  elements.notice.hidden = !noticeSource;
  scheduleRegions();
}
function renderMicrophoneLabel(value) {
  const label =
    value.status === 'listening'
      ? value.wakeState === 'waiting'
        ? 'SAY CAPRI'
        : value.recognitionPhase === 'processing'
          ? 'TRANSCRIBING'
          : 'LISTENING'
      : value.enabled
        ? 'STARTING'
        : 'TRANSCRIPT';
  const language = (value.language ?? 'en').toUpperCase();
  microphoneLabelTicker.set(ui.text(label));
  microphoneTextTicker.set(microphoneText || language);
  document.getElementById('microphone-preview').title =
    language + ' // ' + ui.text(label) + (microphoneText ? '\n' + microphoneText : '');
}
function refreshInterface() {
  thinkingMode.refresh();
  internetMode.refresh();
  renderInferenceLabel(inference, ui);
  if (!inferencePicker.menu.hidden && inferencePicker.value) inferencePicker.render();
  if (companionLocale !== ui.language) {
    companionLocale = ui.language;
    setAvatarExpression(avatarExpression);
    packetOriginLabel.textContent = ui.text(packetOrigin);
    if (packetPrompt) setPacketInput('', packetPrompt);
    subtitleController.render();
    if (computerTaskLabel)
      document.getElementById('computer-task-live').textContent = ui.text(computerTaskLabel);
    if (dueReminder && !dueReminder.title)
      document.getElementById('time-alert-text').textContent = ui.text('Timer finished.');
    stopwatchHUD.draw();
    attachmentComposer?.render();
    publishDesktopStatus();
  }
  showVoiceSettings(voiceSettings);
  speechPanel.renderValue();
  refreshDimmingLabels();
  voiceEffectsPanel.refreshLocale();
  if (noticeSource) notice(noticeSource, elements.notice.dataset.severity);
  if (microphoneClient?.state) renderMicrophoneLabel(microphoneClient.state);
  if (initiativePanel.currentStatus) initiativePanel.status(initiativePanel.currentStatus);
  screenPanel?.refreshLocale();
  memoryHUD.refreshLocale();
  for (const view of messages.values()) {
    historyAttachments.render(view.attachments, view.message.attachments);
    internetMode.renderSources(
      view.sources,
      view.message.role === 'assistant' ? view.message.webSources : [],
      { turnId: view.message.turnId },
    );
    view.node.querySelector('.message-label').textContent =
      view.message.role === 'user' ? ui.text('You') : 'Capri';
    view.status.textContent = ui.text(
      view.message.status === 'interrupted'
        ? 'Stopped'
        : view.message.status === 'error'
          ? 'Response incomplete'
          : '',
    );
  }
  controls();
  updateAvatarDetachButton();
  scheduleRegions();
}

function controls() {
  inferencePicker.syncBusy();
  thinkingMode.setReady(ready);
  syncSleepingVisual();
  presence.phase = backend.phase;
  presence.typing =
    document.activeElement === elements.message && Boolean(elements.message.value.trim());
  const busy =
    submitting ||
    callSpeechPending ||
    Boolean(activeTurnId) ||
    languagePanel.installation?.phase === 'installing';
  internetMode.setReady(ready);
  internetMode.setBusy(busy || Boolean(attachmentComposer?.pending));
  const draft = elements.message.value.trim();
  screenPanel?.availability(ready && backend.phase === 'ready', busy);
  elements.send.hidden = Boolean(activeTurnId);
  elements.stop.hidden = !activeTurnId && !voiceBusy && !callSpeechPending;
  elements.send.disabled =
    !ready ||
    busy ||
    Boolean(attachmentComposer?.pending) ||
    (backend.phase !== 'ready' &&
      power.phase === 'awake' &&
      !isClipCommand(draft) &&
      !isSleepCommand(draft)) ||
    (!draft && !attachmentComposer?.items.length) ||
    draft.length > 8000;
  if (attachmentComposer) {
    attachmentComposer.button.disabled =
      busy || attachmentComposer.pending || !ready || backend.phase !== 'ready';
    if (attachmentComposer.items.length && backend.phase !== 'ready') elements.send.disabled = true;
  }
  elements.reconnect.hidden = backend.phase !== 'offline' || busy;
  elements.status.textContent = ui.text(
    activeTurnId
      ? pendingSpotifyTools.size
        ? 'Working with Spotify…'
        : 'Capri is replying…'
      : voiceBusy
        ? 'Capri is speaking…'
        : backend.message,
  );
  document.body.dataset.phase = backend.phase;
  document.body.dataset.replying = String(Boolean(activeTurnId));
  document.body.dataset.voiceBusy = String(voiceBusy);
  voiceEffectsPanel.availability(!voiceBusy && !activeTurnId && voiceSettings.language !== 'off');
  const mic = microphoneClient?.state;
  const callOutput = voicePlayer.callOutputState().available;
  const systemIndicator = document.getElementById('system-audio-indicator');
  const callSpeechDisabled =
    !ready ||
    backend.phase !== 'ready' ||
    power.phase !== 'awake' ||
    busy ||
    voiceBusy ||
    callSpeechPending ||
    !voiceSettings.enabled ||
    voiceSettings.error ||
    voiceSettings.language === 'off';
  systemIndicator.hidden = !mic?.systemAudioActive;
  document.getElementById('call-microphone-indicator').hidden =
    !voicePlayer.callOutputState().mixingMic;
  document.getElementById('call-audio-dock').hidden = !callOutput && systemIndicator.hidden;
  document.getElementById('call-speak').hidden = !callOutput;
  document.getElementById('call-speak-last').hidden = !callOutput;
  document.getElementById('call-ask').hidden = !callOutput || !allowModelCallAudio;
  document.getElementById('call-output-stop').hidden = !callOutput;
  document.getElementById('call-speak').disabled = callSpeechDisabled || !draft;
  document.getElementById('call-speak-last').disabled =
    !callOutput || callSpeechDisabled || !lastCallReply();
  document.getElementById('call-ask').disabled =
    callSpeechDisabled ||
    !draft ||
    draft.length > 1200 ||
    Boolean(attachmentComposer?.items.length || attachmentComposer?.pending);
  const micButton = document.getElementById('microphone-toggle');
  const micState = microphoneButtonState(mic, { ready, backendPhase: backend.phase });
  const micEnabled = micState.enabled;
  micButton.disabled = micState.headerDisabled;
  setMicrophoneButtonBusy(micButton, micState.loading);
  micButton.setAttribute('aria-pressed', String(micEnabled));
  const micLabel = micState.loading
    ? `${ui.text('Preparing speech recognition…')} — ${ui.text('Cancel')}`
    : ui.text(
        micEnabled
          ? 'Disable microphone'
          : 'Enable microphone (' + languageName(mic?.language ?? 'en') + ')',
      );
  micButton.setAttribute('aria-label', micLabel);
  micButton.title = !mic?.available
    ? ui.text('Install the selected recognition pack first.')
    : micLabel + ' — ' + (mic.actualDeviceLabel || mic.deviceLabel || ui.text('System default'));
  publishAvatarComposer();
  scheduleRegions();
}

function publishAvatarComposer(force = false) {
  if (!ready || !attachmentComposer || !api.publishAvatarComposer) return;
  const loading = headerMic.getAttribute('aria-busy') === 'true';
  const listening = document.body.dataset.commandListening === 'true';
  const value = {
    draft: elements.message.value,
    draftRevision: miniDraftRevision,
    canSend: !elements.send.disabled,
    canAttach: !attachmentComposer.button.disabled,
    busy: Boolean(
      submitting ||
        activeTurnId ||
        attachmentComposer.pending ||
        callSpeechPending ||
        languagePanel.installation?.phase === 'installing',
    ),
    attachments: attachmentComposer.items.map(({ id, name }) => ({ id, name })),
    thinking: thinkingMode.snapshot(),
    internet: internetMode.snapshot(),
    microphone: {
      loading,
      listening,
      disabled: headerMic.disabled || loading,
      label: ui.text(
        loading ? 'Preparing speech recognition…' : listening ? 'Stop voice input' : 'Speak now',
      ),
    },
    labels: {
      message: ui.text('Message Capri'),
      placeholder: elements.message.placeholder,
      attach: ui.text('Attach files'),
      attachments: ui.text('Attachments'),
      microphone: ui.text('Speak now'),
      keyboard: ui.text('Message Capri'),
      menu: ui.text('Show Capri'),
      send: ui.text('Send message'),
      sendHint: ui.text('Send (Enter)'),
      remove: ui.text('Remove'),
      working: ui.text('Capri is replying…'),
      microphoneLoading: ui.text('Preparing speech recognition…'),
      actionFailed: ui.text('Your message could not be sent. Reconnect or try again.'),
    },
    locale: ui.language,
    status:
      internetMode.statusText || thinkingMode.prefaceText || attachmentComposer.info.textContent,
    error: elements.notice.hidden ? '' : document.getElementById('notice-message').textContent,
    theme: interfaceThemeColors(companionSettings?.interfaceTheme),
  };
  const encoded = JSON.stringify(value);
  if (!force && encoded === lastMiniSnapshot) return;
  lastMiniSnapshot = encoded;
  api.publishAvatarComposer(value).catch(() => {
    lastMiniSnapshot = undefined;
  });
}

async function avatarComposerAction(event) {
  const action = event.action;
  let accepted = false;
  try {
    if (
      action.type === 'edit' &&
      (action.revision > miniDraftRevision ||
        (action.revision === miniDraftRevision && action.draft === elements.message.value))
    ) {
      miniDraftRevision = action.revision;
      elements.message.value = action.draft;
      presence.touch();
      sizeInput();
      controls();
      accepted = true;
    } else if (action.type === 'submit' && !elements.send.disabled) {
      void send();
      accepted = true;
    } else if (action.type === 'thinking') {
      accepted = await thinkingMode.setEnabled(action.enabled);
    } else if (action.type === 'internet') {
      accepted = await internetMode.setEnabled(action.enabled);
    } else if (
      action.type === 'microphone' &&
      !headerMic.disabled &&
      headerMic.getAttribute('aria-busy') !== 'true'
    ) {
      void inputMic.onclick();
      accepted = true;
    } else if (action.type === 'files' && !attachmentComposer.button.disabled) {
      const files = action.files.map(({ name, bytes }) => new File([bytes], name));
      if (action.overflow) files.push(new File([], ''));
      void attachmentComposer.add(files);
      accepted = true;
    } else if (action.type === 'remove') {
      accepted = attachmentComposer.remove(action.id);
    } else if (action.type === 'attachment-error') {
      attachmentComposer.messages = ['Capri could not read this file or its media codec.'];
      attachmentComposer.render();
      accepted = true;
    }
    publishAvatarComposer(action.type === 'edit' && !accepted);
  } finally {
    await api.acknowledgeAvatarComposer({ id: event.id, accepted }).catch(() => {});
  }
}

function scrollToLatest() {
  if (followOutput) elements.messages.scrollTop = elements.messages.scrollHeight;
}

function putMessage(message) {
  let view = messages.get(message.id);
  if (!view) {
    const node = document.createElement('article');
    node.className = 'message';
    node.dataset.role = message.role;
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = message.role === 'user' ? ui.text('You') : 'Capri';
    const text = document.createElement('p');
    text.className = 'message-text';
    text.dir = 'auto';
    const attachments = document.createElement('ul');
    attachments.className = 'message-attachments';
    attachments.hidden = true;
    const status = document.createElement('div');
    status.className = 'message-status';
    const sources = document.createElement('section');
    sources.className = 'message-web-sources';
    sources.hidden = true;
    node.append(label, attachments, text, sources, status);
    elements.messages.append(node);
    view = { node, text, attachments, sources, status, message: { ...message } };
    messages.set(message.id, view);
  }
  view.message = { ...message };
  view.text.textContent = message.text;
  historyAttachments.render(view.attachments, message.attachments);
  internetMode.renderSources(view.sources, message.role === 'assistant' ? message.webSources : [], {
    turnId: message.turnId,
  });
  view.node.dataset.status = message.status;
  view.status.textContent = ui.text(
    message.status === 'interrupted'
      ? 'Stopped'
      : message.status === 'error'
        ? 'Response incomplete'
        : '',
  );
  elements['history-empty'].hidden = messages.size > 0;
  scrollToLatest();
}

function onEvent(event) {
  if (event.type === 'application.access') {
    showApplicationAccess(event.settings);
    return;
  }
  if (event.type === 'avatar.reply-hover') {
    replyVisibility.hold('detached', event.hovered === true);
    return;
  }
  if (event.type === 'thinking.settings') {
    thinkingMode.configure(event.settings);
    return;
  }
  if (event.type === 'internet.settings') {
    internetMode.configure(event.settings);
    return;
  }
  if (event.type === 'music.status') {
    musicState = { ...musicState, ...event };
    musicClient.setState(event);
    renderMusicState();
    return;
  }
  if (event.type === 'avatar.composer.action') {
    void avatarComposerAction(event);
    return;
  }
  if (event.type === 'startup-intro.skip') {
    startupIntro?.cancel(false);
    return;
  }
  if (event.type === 'avatar.headpat') {
    lastSpriteTap = null;
    if (avatarTapsSleeping(power.phase, backend.phase)) return;
    if (avatarDetachPhase === 'attached')
      headpat.play(
        elements.sprite,
        event.point,
        avatarViewport(),
        renderedFrame?.kind !== 'reviewed_music',
        renderedFrame?.id,
      );
    return;
  }
  if (event.type === 'avatar.tap') {
    if (avatarTapsSleeping(power.phase, backend.phase)) return;
    if (renderedFrame?.kind === 'reviewed_music') {
      if (avatarDetachPhase === 'attached' && event.part !== 'head' && lastSpriteTap) {
        headpat.play(elements.sprite, lastSpriteTap, avatarViewport(), false, renderedFrame.id);
        lastSpriteTap = null;
      }
      return;
    }
    if (event.pulse) showAvatarTap(event.count, event.tone);
    const localized = ['reviewed_pose', 'reviewed_music'].includes(renderedFrame?.kind);
    if (localized && avatarDetachPhase === 'attached')
      headpat.react(elements.sprite, renderedFrame.id, event.tone);
    spriteReaction = localized
      ? undefined
      : {
          affectionate: 'happy',
          curious: 'skeptical',
          neutral: 'attentive',
          boundary: 'annoyed',
        }[event.tone];
    signalFx?.invalidate();
    clearTimeout(spriteReactionTimer);
    spriteReactionTimer = setTimeout(() => {
      spriteReaction = undefined;
      signalFx?.invalidate();
    }, 740);
    return;
  }
  if (event.type === 'avatar.detach') {
    replyVisibility.hold('detached', false);
    updateAvatarDetachPhase(event.phase);
    const preset =
      companionSettings?.detachedStyle === 'dialogue' ? 'off' : companionSettings?.teleportSound;
    if (
      preset &&
      preset !== 'off' &&
      ['leaving', 'teleporting', 'returning'].includes(event.phase)
    ) {
      try {
        if (!screenshotAudioContext || screenshotAudioContext.state === 'closed')
          screenshotAudioContext = new AudioContext();
        playTeleportSound(screenshotAudioContext, preset);
      } catch {
        /* The animation still completes when the audio device is unavailable. */
      }
    }
    return;
  }
  if (event.type === 'wake.error') {
    notice(event.message);
    return;
  }
  if (event.type === 'voice.warning') {
    notice(event.message, 'warning');
    return;
  }
  if (event.type === 'wake.audio-ready') {
    wakeFeedback.configure(companionSettings, () => api.wakeAudio());
    return;
  }
  if (event.type === 'time.hud-selected') {
    stopwatchHUD.select(event.id);
    return;
  }
  if (event.type === 'initiative.activity') {
    initiativePanel.activity(event.settings);
    return;
  }
  if (event.type === 'settings.toggle-portrait') {
    togglePresence();
    return;
  }
  if (event.type === 'settings.set-portrait') {
    const expanded = presence.snapshot().expanded;
    presence.setPinned(event.active);
    if (event.preservePresentation === true && expanded) presence.reveal();
    scheduleRegions();
    return;
  }
  if (event.type === 'reminder.wake') {
    presence.wakeUp();
    presence.reveal();
    redrawAvatar();
    return;
  }
  if (event.type === 'reminder.delivery' && event.state === 'failed') {
    notice(event.error || 'Reminder voice unavailable.');
    return;
  }
  if (event.type === 'glitch.preview') {
    signalFx.preview(event.settings);
    return;
  }
  if (event.type === 'open-time') {
    void timePanel.open(true);
    return;
  }
  if (event.type === 'time.changed') {
    stopwatchHUD.show(event.objects);
    if (!timePanel.panel.hidden) timePanel.show(event.objects);
    return;
  }
  if (event.type === 'time.due') {
    presence.reveal();
    dueReminder = event.object;
    document.getElementById('time-alert-text').textContent =
      event.object.title || ui.text('Timer finished.');
    document.getElementById('time-alert').hidden = false;
    scheduleRegions();
    return;
  }
  if (event.type === 'action.approval') {
    pendingAction = event.proposal;
    clearTimeout(pendingActionTimer);
    document.getElementById('action-approval').hidden = !pendingAction;
    if (pendingAction) {
      presence.reveal();
      document.getElementById('action-approval-title').textContent = ui.text(pendingAction.title);
      document.getElementById('action-approval-detail').textContent = pendingAction.detail;
      pendingActionTimer = setTimeout(
        () => {
          const request = pendingAction;
          pendingAction = null;
          document.getElementById('action-approval').hidden = true;
          if (request) api.actionRespond({ id: request.id, accepted: false }).catch(() => {});
          scheduleRegions();
        },
        Math.max(0, pendingAction.expiresAt - Date.now()),
      );
    }
    scheduleRegions();
    return;
  }
  if (event.type === 'spotify.settings') {
    applicationsPanel.showSpotify(event.settings);
    return;
  }
  if (event.type === 'models.status') {
    modelsPanel.show(event);
    scheduleRegions();
    return;
  }
  if (event.type === 'open-models') {
    modelsPanel.open(true).catch((error) => notice(error.message));
    return;
  }
  if (event.type === 'updates.status') {
    updatesPanel.show(event);
    updateNotification.show(event);
    scheduleRegions();
    return;
  }
  if (event.type === 'open-updates') {
    updatesPanel.open(true).catch((error) => notice(error.message));
    return;
  }
  if (event.type === 'confirmation.request') {
    void confirmationRequests.request(event).catch((error) => notice(error.message));
    return;
  }
  if (event.type === 'confirmation.closed') {
    confirmationRequests.close(event.id);
    return;
  }
  if (event.type === 'startup.progress') {
    startupPanel.update(event);
    scheduleRegions();
    return;
  }
  if (event.type === 'companion.settings') {
    companionSettings = event.settings;
    replyVisibility.configure(event.settings);
    presence.expandOnReply = event.settings.expandOnReply !== false;
    memoryHUD.configure(event.settings);
    signalFx?.configure(event.settings);
    buttonFeedback.configure(event.settings.buttonFeedback);
    companionPanel.show(event.settings);
    wakeFeedback.configure(event.settings, () => api.wakeAudio());
    if (event.reset === true) {
      // A preference reset is not a new reply: keep the current answer readable.
      // The next turn clears the manual reveal and follows the restored defaults.
      replyVisibility.reveal();
      subtitleController.render();
    }
    scheduleRegions();
    return;
  }
  if (event.type === 'monitor.error') {
    notice(event.message);
    return;
  }
  if (event.type === 'settings.renderer-lost') {
    notice('Settings closed unexpectedly. Open Settings to try again.');
    return;
  }
  if (event.type === 'open-companion') {
    companionPanel.open(true);
    return;
  }
  if (event.type === 'conversation.cleared') {
    thinkingMode.clear();
    internetMode.clear();
    attachmentComposer?.clear();
    voicePlayer.stop();
    subtitleController.clear();
    messages.clear();
    elements.messages.replaceChildren();
    elements['history-empty'].hidden = false;
    setPacketOrigin();
    setPacketInput();
    elements['subtitle-text'].textContent = '';
    return;
  }
  if (microphoneClient.event(event)) return;
  if (event.type === 'voice.settings') {
    showVoiceSettings(event);
    controls();
    return;
  }
  if (event.type === 'open-voice-effects') {
    voiceEffectsPanel.open(true);
    return;
  }
  if (event.type === 'open-languages') {
    languagePanel.open(true);
    return;
  }
  if (event.type === 'open-speech-settings') {
    speechPanel.open(true);
    return;
  }
  if (event.type === 'speech.settings') {
    speechPanel.show(event.settings);
    return;
  }
  if (event.type === 'open-file-access') {
    fileAccessPanel.open(true);
    return;
  }
  if (event.type === 'file-access') {
    fileAccessPanel.show(event.settings);
    ui.apply(ui.language);
    return;
  }
  if (event.type === 'open-applications') {
    applicationsPanel.open(true);
    return;
  }
  if (event.type === 'applications') {
    applicationsPanel.show(event.settings);
    return;
  }
  if (event.type === 'open-initiative') {
    initiativePanel.open(true);
    return;
  }
  if (event.type === 'initiative.settings') {
    initiativePanel.show(event.settings);
    return;
  }
  if (event.type === 'initiative.status') {
    initiativePanel.status(event.settings);
    scheduleRegions();
    return;
  }
  if (event.type === 'initiative.error') {
    notice(event.message);
    return;
  }
  if (event.type === 'open-screen') {
    screenPanel.open(true);
    return;
  }
  if (event.type === 'computer.control') {
    const stop = document.getElementById('computer-control-stop');
    stop.hidden = !event.active;
    stop.onclick = () => window.capri.stopComputerControl();
    sizeInput();
    scheduleRegions();
    return;
  }
  if (event.type === 'computer.task') {
    const status = document.getElementById('computer-task-live');
    const labels = {
      'call-focus': 'Switch to the meeting tab',
      observing: 'Observing the current window',
      planning: 'Thinking',
      acting: 'Performing the action',
      verifying: 'Checking the result',
      completed: 'Ready',
      stopped: 'Stopped',
    };
    status.hidden = !event.active;
    computerTaskLabel = labels[event.phase] ?? 'Computer control';
    status.textContent = ui.text(computerTaskLabel);
    scheduleRegions();
    return;
  }
  if (event.type === 'screen.status') {
    screenPanel.status(event.settings);
    return;
  }
  if (event.type === 'screen.observation') {
    screenPanel.observation(event.settings);
    return;
  }
  if (event.type === 'screen.clip-request') {
    void screenPanel.clipFrame(event);
    return;
  }
  if (event.type === 'screen.clip-status') {
    screenPanel.clipping = event.active;
    screenPanel.renderIndicator();
    return;
  }
  if (event.type === 'screen.clip-saved') {
    void screenshotSound();
    savedScreenshotId = event.screenshot.id;
    const result = document.getElementById('clip-result');
    result.hidden = false;
    result.title = event.screenshot.name;
    sizeInput();
    scheduleRegions();
    return;
  }
  if (event.type === 'screen.reset') {
    screenPanel.reset();
    return;
  }
  if (event.type === 'languages') {
    languagePanel.show(event.settings);
    modelsPanel.setConversationLanguage(event.settings.conversation);
    updateNotification.refresh();
    return;
  }
  if (event.type === 'speech-install.status') {
    languagePanel.installStatus(event);
    controls();
    return;
  }
  if (event.type === 'speech-components') {
    languagePanel.installed(event.recognitionAvailability, event.speechAvailability);
    languagePanel.details();
    return;
  }
  if (event.type === 'screen.settings') screenPanel.settings(event.settings);
  if (event.type === 'voice.effects') {
    if (!voiceEffectsPanel.saveTimer && !voiceEffectsPanel.pending)
      voiceEffectsPanel.show(event.settings);
    return;
  }
  if (event.type === 'voice.preview-started') {
    voicePlayer.begin(event.turnId, { effects: event.effects });
    voiceBusy = true;
    controls();
    return;
  }
  if (event.type === 'call-audio.reset') {
    callSpeechRequest = null;
    callOutputGeneration++;
    callMicrophone.stop();
    voicePlayer.disableCallOutput();
    void microphoneClient.setSystemAudio(false);
    controls();
    return;
  }
  if (event.type === 'call-audio.policy') {
    allowModelCallAudio = event.allowModel === true;
    voicePlayer.setCallVoiceVolume(event.callVoiceVolume);
    controls();
    return;
  }
  if (event.type === 'voice.call-started') {
    if (event.turnId === callSpeechRequest && voicePlayer.callOutputState().available) {
      callSpeechRequest = null;
      voicePlayer.begin(event.turnId, { call: event.route === 'owner-and-call' });
      if (event.reply) notice(event.reply);
      voiceBusy = true;
      controls();
    }
    return;
  }
  if (event.type === 'voice.audio') {
    voicePlayer.accept(event);
    return;
  }
  if (event.type === 'voice.generated') {
    replyVisibility.generated(event.turnId);
    voicePlayer.finish(event.turnId);
    return;
  }
  if (event.type === 'voice.cancelled') {
    replyVisibility.protect(event.turnId);
    if (voicePlayer.turnId === event.turnId) voicePlayer.stop();
    return;
  }
  if (event.type === 'voice.error') {
    replyVisibility.protect(event.turnId);
    voicePlayer.stop();
    notice(event.message);
    return;
  }
  if (event.type === 'open-dimming') {
    setDimmingPanel(true);
    return;
  }
  if (event.type === 'dimming') {
    showDimmingSettings(event.settings);
    return;
  }
  if (event.type === 'backend') {
    backend = { phase: event.phase, message: event.message };
    controls();
    return;
  }
  if (event.type === 'power.state') {
    showPower(event);
    return;
  }
  if (event.type === 'focus-input') {
    elements.message.focus();
    return;
  }
  if (event.type === 'avatar.selection') {
    voicePlayer.burst();
    showAvatar(event.selection);
    return;
  }
  if (event.type === 'avatar.layout') {
    endSpriteDrag();
    setPlacement(event.layout, false);
    return;
  }
  if (event.type === 'turn.started') {
    if (!responsePaintStarts.has(event.turnId))
      responsePaintStarts.set(event.turnId, performance.now());
    replyVisibility.update(
      { turnId: event.turnId, text: '', status: 'streaming' },
      Boolean(
        !event.silent &&
          voiceSettings.enabled &&
          !voiceSettings.error &&
          voiceSettings.language !== 'off',
      ),
    );
    thinkingMode.begin(event.turnId);
    internetMode.begin(event.turnId);
    if (event.source === 'attachment') attachmentComposer?.clear();
    pendingSpotifyTools.clear();
    director?.attend(performance.now(), true);
    frameTicket++;
    wantedFrame = '';
    if (!voiceSettings.error && !event.silent) voicePlayer.beginReply(event.turnId);
    else voicePlayer.stop();
    presence.begin(event.turnId);
    voiceBusy =
      !event.silent &&
      voiceSettings.enabled &&
      !voiceSettings.error &&
      voiceSettings.language !== 'off';
    presence.voiceBusy = voiceBusy;
    setPacketOrigin(event.source);
    if (event.user?.text != null) setPacketInput(event.user.text);
    else setPacketInput('', event.source === 'avatar-click' ? '' : 'A thought of her own.');
    activeTurnId = event.turnId;
    followOutput = true;
    notice();
    if (event.user) putMessage(event.user);
    putMessage(event.assistant);
    showSubtitles(event.assistant, true);
    controls();
    return;
  }
  if (event.turnId !== activeTurnId) return;
  if (internetMode.event(event)) {
    if (
      event.type === 'turn.web-search' &&
      event.phase === 'ready' &&
      Array.isArray(event.sources)
    ) {
      const view = [...messages.values()].find(
        (item) => item.message.turnId === event.turnId && item.message.role === 'assistant',
      );
      if (view) putMessage({ ...view.message, webSources: event.sources });
    }
    return;
  }
  if (thinkingMode.event(event)) return;
  if (event.type === 'turn.tool') {
    if (event.turnId === activeTurnId && event.tool === 'spotify_control') {
      if (event.phase === 'start') pendingSpotifyTools.add(event.callId);
      else pendingSpotifyTools.delete(event.callId);
      controls();
    }
    return;
  }
  if (event.type === 'turn.delta') {
    presence.text(event.turnId);
    const view = [...messages.values()].find(
      (item) => item.message.turnId === event.turnId && item.message.role === 'assistant',
    );
    if (view) {
      const firstVisibleText = !view.message.text;
      const message = { ...view.message, text: view.message.text + event.text };
      putMessage(message);
      showSubtitles(message);
      if (firstVisibleText && document.visibilityState === 'visible') {
        const started = responsePaintStarts.get(event.turnId);
        responsePaintStarts.delete(event.turnId);
        if (started !== undefined)
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              void api
                .responsePainted?.({ id: event.turnId, elapsedMs: performance.now() - started })
                .catch(() => {});
            }),
          );
      }
    }
    return;
  }
  if (['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type)) {
    pendingSpotifyTools.clear();
    if (event.type === 'turn.completed' && event.assistant?.text?.trim())
      presence.text(event.turnId);
    presence.finish(event.turnId);
    putMessage(event.assistant);
    showSubtitles(event.assistant);
    activeTurnId = null;
    responsePaintStarts.delete(event.turnId);
    notice(event.warning || (event.type === 'turn.failed' ? event.message : ''));
    elements.announcement.textContent = ui.text(
      event.type === 'turn.completed' ? 'Capri has replied.' : event.message,
    );
    controls();
  }
}

attachmentComposer = new AttachmentComposer({
  api,
  text: (value, variables) => ui.text(value, variables),
  onChange: () => {
    sizeInput();
    controls();
  },
  canAttach: () => !attachmentComposer.button.disabled,
  isRemote: () => Boolean(inference?.remote),
  canSee: () => attachmentVision,
});

async function send() {
  if (elements.send.disabled) return;
  const text = elements.message.value.trim();
  const attachmentIds = attachmentComposer.items.map(({ id }) => id);
  const thinking = thinkingMode.enabled;
  const internet = internetMode.enabled;
  submitting = true;
  notice();
  controls();
  voicePlayer.stop();
  api.stopVoice().catch(() => {});
  if (voiceSettings.enabled) voicePlayer.unlock().catch(() => {});
  const id = crypto.randomUUID();
  responsePaintStarts.set(id, performance.now());
  if (responsePaintStarts.size > 32)
    responsePaintStarts.delete(responsePaintStarts.keys().next().value);
  elements.message.value = '';
  sizeInput();
  try {
    if (attachmentIds.length) {
      const result = await api.sendAttachments({
        id,
        text: text || 'Describe the attached files.',
        attachmentIds,
        thinking,
        internet,
      });
      if (result?.accepted === false) {
        elements.message.value = text;
        attachmentComposer.clear();
        attachmentComposer.message = result.message;
        attachmentComposer.render();
      }
    } else await api.send({ id, text, thinking, internet });
  } catch (error) {
    if (!activeTurnId) {
      elements.message.value = text;
      notice(
        screenImageWarning(error) ?? 'Your message could not be sent. Reconnect or try again.',
      );
    }
  } finally {
    submitting = false;
    sizeInput();
    controls();
  }
}

const visualRegionSelector = '#handle, #input-dock, #subtitle-stage, .resource-warning';

function publishRegions() {
  regionsFrame = null;
  const { avatarDock, presence: mode } = document.body.dataset;
  const compact = mode === 'core' || avatarDock === 'compact';
  // Collapsing the reply preserves the native window size and portrait layout.
  // Shade only the remaining UI instead of its now-empty reserved reply area.
  const fitBackdrop = compact || document.body.dataset.replyHidden === 'true';
  const modal = confirmDialog.dialog.open;
  const viewport = { width: innerWidth, height: innerHeight };
  const rectangle = (element) => {
    const rect = element.getBoundingClientRect();
    const notifications =
      mode === 'core' ? element.closest('.dock-notifications')?.getBoundingClientRect() : null;
    const x = Math.max(rect.left, notifications?.left ?? rect.left);
    const y = Math.max(rect.top, notifications?.top ?? rect.top);
    return {
      x,
      y,
      width: Math.min(rect.right, notifications?.right ?? rect.right) - x,
      height: Math.min(rect.bottom, notifications?.bottom ?? rect.bottom) - y,
    };
  };
  const measured = [
    ...document.querySelectorAll(
      fitBackdrop
        ? `[data-hit-region], ${visualRegionSelector}${compact ? '' : ', #portrait-panel'}`
        : '[data-hit-region]',
    ),
  ]
    .filter((element) => getComputedStyle(element).visibility === 'visible')
    .map((element) => ({ hit: element.hasAttribute('data-hit-region'), rect: rectangle(element) }));
  // Only the actual answer text is interactive for deliberate selection/copy.
  // The surrounding transparent subtitle stage still passes desktop clicks through.
  const controls = measured
    .filter(({ hit }) => hit)
    .map(({ rect }) => {
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      return {
        x,
        y,
        width: Math.min(innerWidth, rect.x + rect.width) - x,
        height: Math.min(innerHeight, rect.y + rect.height) - y,
      };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .filter(
      (rect, index, all) =>
        !all.some(
          (other, at) =>
            at !== index &&
            other.x <= rect.x &&
            other.y <= rect.y &&
            other.x + other.width >= rect.x + rect.width &&
            other.y + other.height >= rect.y + rect.height &&
            (at < index || other.width > rect.width || other.height > rect.height),
        ),
    );
  const shade = document.getElementById('window-shade');
  const backdrop = measured.map(({ rect }) => rect);
  const bounds = shadeBounds(backdrop, viewport, fitBackdrop);
  for (const [name, value] of Object.entries({
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }))
    shade.style[name] = value + 'px';
  dimmingMask.draw(
    bounds.width,
    bounds.height,
    Number(document.getElementById('dimming-softness').value) || 0,
  );
  let footprint;
  if (modal) controls.push({ x: 0, y: 0, ...viewport });
  else if (compact) {
    // Clamp native placement around the dock's resting position, without its float animation.
    const floatY = Number.parseFloat(document.body.style.getPropertyValue('--float-y')) || 0;
    const resting = shadeBounds(backdrop, viewport, true, floatY);
    if (resting.width > 0 && resting.height > 0) {
      const x = Math.floor(resting.x);
      // Chromium rounds translated DOM rectangles to its internal subpixel precision.
      const y = Math.floor(resting.y + 0.001);
      footprint = {
        x,
        y,
        width: Math.ceil(resting.x + resting.width) - x,
        height: Math.ceil(resting.y + resting.height - 0.001) - y,
      };
    }
  }
  const sprite = avatarHitRegion(elements['sprite-region'].getBoundingClientRect());
  api.setRegions({ controls, sprite, footprint }).catch(() => {});
}

function scheduleRegions() {
  if (!regionsFrame) regionsFrame = requestAnimationFrame(publishRegions);
}

function startDrag(event) {
  if (event.button !== 0 || event.target.closest('button') || spriteDrag) return;
  dragPointer = event.pointerId;
  event.currentTarget.setPointerCapture(event.pointerId);
  api.startDrag().catch(() => {});
}

function endDrag(event) {
  if (dragPointer === null || (event.pointerId !== undefined && event.pointerId !== dragPointer))
    return;
  dragPointer = null;
  api.endDrag().catch(() => {});
}

for (const element of [elements.handle]) {
  element.addEventListener('pointerdown', startDrag);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', endDrag);
}
elements.handle.title = ui.text('Drag to move the whole window');
function togglePresence() {
  presence.toggle();
  scheduleRegions();
  api
    .setPresencePinned(presence.pinned)
    .catch(() => notice('Could not save Capri’s presence setting.'));
}
document.getElementById('presence-core').addEventListener('click', togglePresence);
document.getElementById('presence-toggle').addEventListener('click', togglePresence);
document.getElementById('companion').addEventListener('pointerenter', () => {
  presence.interacting = true;
  presence.touch();
});
document.getElementById('companion').addEventListener('pointerleave', () => {
  presence.interacting = false;
  presence.touch();
});
elements.message.addEventListener('focus', () => {
  presence.touch();
  controls();
});
elements.message.addEventListener('blur', controls);
document.addEventListener('pointerdown', () => presence.touch(), { passive: true });
elements['sprite-region'].addEventListener('pointerdown', startSpriteDrag);
elements['sprite-region'].addEventListener('pointermove', moveSprite);
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  elements['sprite-region'].addEventListener(name, endSpriteDrag);
elements['sprite-region'].addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const delta = Math.max(-240, Math.min(240, event.deltaY * units));
    changeZoom(avatarPlacement.zoom * Math.exp(-delta * 0.0015), {
      x: event.clientX,
      y: event.clientY,
    });
  },
  { passive: false },
);
window.addEventListener('blur', () => {
  endDrag({});
  endSpriteDrag();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    endDrag({});
    endSpriteDrag();
  } else if (subtitleController.state.id) renderSubtitle();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modelsPanel.panel.hidden && !confirmDialog.dialog.open) {
    event.preventDefault();
    modelsPanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !updatesPanel.panel.hidden && !confirmDialog.dialog.open) {
    event.preventDefault();
    updatesPanel.open(false);
    return;
  }
  if (confirmDialog.dialog.open) return;
  if (event.key === 'Escape' && !companionPanel.panel.hidden) {
    event.preventDefault();
    companionPanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !document.getElementById('dimming-panel').hidden) {
    event.preventDefault();
    setDimmingPanel(false);
    return;
  }
  if (event.key === 'Escape' && !voiceEffectsPanel.panel.hidden) {
    event.preventDefault();
    if (voiceBusy && !activeTurnId) stopReply();
    voiceEffectsPanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !languagePanel.panel.hidden) {
    event.preventDefault();
    languagePanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !fileAccessPanel.panel.hidden) {
    event.preventDefault();
    fileAccessPanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !applicationsPanel.panel.hidden) {
    event.preventDefault();
    applicationsPanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !initiativePanel.panel.hidden) {
    event.preventDefault();
    initiativePanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !screenPanel.panel.hidden) {
    event.preventDefault();
    screenPanel.open(false);
    return;
  }
  if (event.key === 'Escape' && !elements['history-panel'].hidden) {
    event.preventDefault();
    setHistory(false);
    return;
  }
  if (event.key === 'Escape' && (activeTurnId || voiceBusy || callSpeechPending)) {
    event.preventDefault();
    stopReply();
  }
});
elements.send.addEventListener('click', send);
let activityAt = 0;
elements.message.addEventListener('input', () => {
  miniDraftRevision++;
  if (performance.now() - activityAt > 150) {
    activityAt = performance.now();
    api.activity().catch(() => {});
  }
  presence.touch();
  director?.attend(performance.now(), true);
  sizeInput();
  controls();
});
elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});
elements.stop.addEventListener('click', stopReply);
document.getElementById('voice-toggle').addEventListener('click', () => {
  const enabled = voiceSettings.error ? true : !voiceSettings.enabled;
  if (enabled) voicePlayer.unlock().catch(() => {});
  else voicePlayer.stop();
  api
    .setVoiceEnabled(enabled)
    .then(showVoiceSettings)
    .catch((error) => notice(error.message || 'Voice settings could not be saved.'));
});
document.getElementById('microphone-toggle').addEventListener('click', () => {
  if (voiceSettings.enabled) voicePlayer.unlock().catch(() => {});
  notice();
  microphoneClient.toggle();
});
document.getElementById('hide').addEventListener('click', () => api.hide().catch(() => {}));
document
  .getElementById('quit')
  .addEventListener('click', () => api.quit().catch((error) => notice(error.message)));

elements.reconnect.addEventListener('click', () => {
  notice();
  api.reconnect().catch(() => notice('Could not reconnect. Check the local core.'));
});
elements['history-toggle'].addEventListener('click', () =>
  setHistory(elements['history-panel'].hidden),
);
elements['history-close'].addEventListener('click', () => setHistory(false));
document.getElementById('dimming-close').addEventListener('click', () => setDimmingPanel(false));
document.getElementById('dimming-enabled').addEventListener('change', updateDimming);
document.getElementById('dimming-level').addEventListener('input', updateDimming);
document.getElementById('dimming-softness').addEventListener('input', updateDimming);
elements['subtitle-previous'].addEventListener('click', () => stepSubtitle(-1));
elements['subtitle-next'].addEventListener('click', () => stepSubtitle(1));
document.getElementById('subtitle-collapse').addEventListener('click', () => {
  replyVisibility.hide();
  document.getElementById('subtitle-reveal').focus({ preventScroll: true });
});
document.getElementById('subtitle-reveal').addEventListener('click', () => {
  replyVisibility.reveal();
  document.getElementById('subtitle-collapse').focus({ preventScroll: true });
});
elements.messages.addEventListener('scroll', () => {
  followOutput =
    elements.messages.scrollHeight - elements.messages.clientHeight - elements.messages.scrollTop <
    45;
});
const regionObserver = new ResizeObserver(() => {
  redrawAvatar();
  scheduleRegions();
});
for (const element of [
  document.body,
  ...document.querySelectorAll(`[data-hit-region], ${visualRegionSelector}`),
  elements['sprite-region'],
])
  regionObserver.observe(element);
document.getElementById('clip-open').addEventListener('click', () => {
  if (savedScreenshotId)
    api
      .openScreenshot(savedScreenshotId)
      .catch(() => notice('The screenshot could not be opened.'));
});
document
  .getElementById('clip-folder')
  .addEventListener('click', () =>
    api.openScreenshotsFolder().catch(() => notice('The screenshot folder could not be opened.')),
  );
document.getElementById('clip-close').addEventListener('click', () => {
  document.getElementById('clip-result').hidden = true;
  sizeInput();
  scheduleRegions();
});
window.addEventListener('resize', () => {
  endSpriteDrag();
  sizeInput();
  redrawAvatar();
  if (subtitleController.state.id) showSubtitles(subtitleController.state);
  scheduleRegions();
});
document.fonts.ready.then(() => {
  if (subtitleController.state.id) showSubtitles(subtitleController.state);
  scheduleRegions();
});
const unsubscribe = api.onEvent(onEvent);
startupIntro = new StartupIntro({
  canvas: document.getElementById('startup-intro'),
  api,
  eligible: () =>
    ready &&
    presence.snapshot().expanded &&
    document.body.dataset.presence === 'portrait' &&
    avatarDetachPhase === 'attached' &&
    !document.body.dataset.avatarArriving &&
    (!director || renderedFrame?.id === director.base?.frameId) &&
    elements.sprite.complete &&
    elements.sprite.naturalWidth > 0,
  readyImage: () => portraitMouth.image(headpat.image(elements.sprite)),
  interrupted: () =>
    Boolean(
      activeTurnId ||
        voiceBusy ||
        presence.sleeping ||
        presence.speaking ||
        elements.message.value.trim() ||
        microphoneText ||
        avatarDetachPhase !== 'attached',
    ),
  onChange: () => {
    if (!startupIntro?.active) director?.attend(performance.now(), true);
    redrawAvatar();
    signalFx?.invalidate();
    if (ready) controls();
    scheduleRegions();
  },
});
signalFx = new SignalFX({
  onGlitch: undefined,
  canvas: document.getElementById('signal-fx'),
  model: presence,
  sprite: elements.sprite,
  getSpriteImage: () =>
    startupIntro?.texture ??
    musicPose.image(portraitMouth.image(headpat.image(elements.sprite)), currentMusicMotion),
  orb: document.getElementById('presence-core'),
  frame: document.getElementById('portrait-panel'),
  audioLevel: () => voicePlayer.level,
  onLayout: () => {
    redrawAvatar();
    scheduleRegions();
    publishDesktopStatus();
  },
  onMovement: scheduleRegions,
  onFrame: animateCharacter,
  text: (value) => ui.text(value),
});
signalFx.onGlitch = (value) => api.glitchFrame(value).catch(() => {});
window.addEventListener(
  'beforeunload',
  () => {
    cancelAvatarCentering();
    startupIntro?.destroy();
    microphoneClient.stop();
    void musicClient.stop();
    musicNotes?.destroy();
    musicPose.clear();
    signalFx.destroy();
    voicePlayer.stop();
    subtitleController.dispose();
    replyVisibility.dispose();
    stopwatchHUD.destroy();
    memoryHUD.destroy();
    unsubscribe();
    regionObserver.disconnect();
  },
  { once: true },
);

try {
  const snapshot = await api.bootstrap();
  showApplicationAccess(snapshot.applicationAccess ?? { enabled: true });
  thinkingMode.configure(snapshot.thinking);
  internetMode.configure(snapshot.internet);
  if (snapshot.musicListening) musicState = snapshot.musicListening;
  renderMusicState();
  musicNotes = new MusicNotesLayer(
    document.getElementById('avatar-viewport'),
    snapshot.musicArtwork?.notes ?? [],
  );
  allowModelCallAudio = snapshot.allowModelCallAudio === true;
  voicePlayer.setCallVoiceVolume(snapshot.callVoiceVolume);
  inference = snapshot.inference;
  attachmentVision = snapshot.attachmentVision === true;
  screenPanel.visionBlocked = Boolean(inference?.remote && !inference.vision);
  applicationsPanel.showSpotify(snapshot.spotify);
  modelsPanel.show(snapshot.models);
  updatesPanel.show(snapshot.updates);
  updateNotification.show(snapshot.updates);
  startupPanel.update(snapshot.startup);
  companionSettings = snapshot.companion;
  replyVisibility.configure(snapshot.companion);
  presence.expandOnReply = snapshot.companion.expandOnReply !== false;
  memoryHUD.configure(snapshot.companion);
  signalFx.configure(snapshot.companion);
  buttonFeedback.configure(snapshot.companion.buttonFeedback);
  companionPanel.show(snapshot.companion);
  wakeFeedback.configure(snapshot.companion, () => api.wakeAudio());
  backend = snapshot.backend;
  activeTurnId = snapshot.activeTurnId;
  if (snapshot.presence?.pinned) {
    presence.pinned = true;
    presence.reveal();
  }
  showVoiceSettings(snapshot.voice);
  showPower(snapshot.power);
  voiceEffectsPanel.show(snapshot.voiceEffects);
  languagePanel.installed(snapshot.recognitionAvailability, snapshot.speechAvailability);
  languagePanel.installStatus(snapshot.speechInstallation ?? { phase: 'idle' });
  languagePanel.show(snapshot.languages);
  modelsPanel.setConversationLanguage(snapshot.languages.conversation);
  fileAccessPanel.show(snapshot.fileAccess);
  ui.apply(ui.language);
  renderInferenceLabel(inference, ui);
  updateNotification.refresh();
  applicationsPanel.show(snapshot.applications);
  initiativePanel.show(snapshot.initiative);
  initiativePanel.status(snapshot.awareness);
  screenPanel.status(snapshot.screen);
  screenPanel.observation(snapshot.screenObservation);
  screenPanel.settings(snapshot.screenSettings);
  inferencePrivacy(snapshot.inference, ui);
  timePanel.show(snapshot.time);
  stopwatchHUD.show(snapshot.time);
  microphoneClient.settings(snapshot.microphone);
  speechPanel.show(snapshot.speech);
  showDimmingSettings(snapshot.dimming);
  avatarPlacement = validateAvatarLayout(snapshot.avatarLayout);
  for (const sprite of snapshot.avatars) {
    avatars.set(sprite.id, sprite);
    if (!snapshot.animation) {
      const image = new Image();
      image.src = sprite.url;
      const decoded = image.decode().then(() => image);
      decoded.catch(() => {});
      decodedImages.set(sprite.id, decoded);
    }
  }
  if (snapshot.animation) {
    const animationFrames = [
      ...snapshot.animation.frames,
      ...(snapshot.musicArtwork?.frames ?? []),
    ];
    frameCatalog = new Map(animationFrames.map((frame) => [frame.id, frame]));
    frameImages = new SpriteImages(animationFrames);
    director = new AnimationDirector({
      choices: snapshot.avatars,
      frames: animationFrames,
      clips: snapshot.animation.clips,
      settings: snapshot.animation.autonomy,
    });
    renderedFrame = frameCatalog.get('neutral');
    presence.autonomous = snapshot.animation.autonomy.enabled;
    if (snapshot.animation.autonomy.startExpanded) presence.reveal();
  }
  placementReady = true;
  if (director) avatarPlacement = centeredHomePlacement();
  redrawAvatar();
  catalogReady = true;
  await showAvatar(
    queuedSelection?.revision > snapshot.avatar.revision ? queuedSelection : snapshot.avatar,
  );
  queuedSelection = null;
  for (const message of snapshot.messages) putMessage(message);
  const lastUserText = snapshot.messages.findLast((message) => message.role === 'user')?.text;
  if (lastUserText) setPacketInput(lastUserText);
  else setPacketInput('', 'Connection established.');
  const latestOrigin = snapshot.messages.at(-1)?.origin?.kind;
  setPacketOrigin(latestOrigin);
  if (latestOrigin === 'initiative') {
    setPacketInput('', 'A thought of her own.');
  } else if (latestOrigin === 'avatar-click') {
    setPacketInput();
  }
  elements['history-empty'].hidden = messages.size > 0;
  showSubtitles(
    snapshot.messages.findLast((message) => message.role === 'assistant'),
    true,
  );
  if (snapshot.warning) notice(snapshot.warning);
  ready = true;
  // Core readiness can arrive before avatar decoding and restored preferences.
  // Expose completion of renderer initialization independently of backend phase.
  document.body.dataset.initialized = 'true';
  startupIntro.configure(snapshot.startupIntro);
  controls();
  scheduleRegions();
} catch {
  startupIntro?.cancel();
  backend = { phase: 'offline', message: 'Capri could not initialize.' };
  notice('Restart Capri to restore the connection.');
  controls();
}
