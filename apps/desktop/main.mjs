import { InferenceApi, apiSettings, readApiSettings } from './inference-api.mjs';
import { openLocalModelFolder } from './local-model-folder.mjs';
import { isLemonadeNpuEndpoint, isLocalApiEndpoint } from './renderer/inference-endpoint.mjs';
import { ComputerControl } from './computer-control.mjs';
import { thinkingBriefing } from './thinking-briefing.mjs';
import { WebSearch } from './web-search.mjs';
import { prepareInternetSearch } from './internet-search.mjs';
import { webSources } from './web-sources.mjs';
import { visualReplyFailure } from './visual-response.mjs';
import { NativeEscapeStop } from './native-escape-stop.mjs';
import { ResolveAdapter } from '../../integrations/resolve/service.mjs';
import { ComputerAgent } from './computer-agent.mjs';
import { steamGameLauncher } from './steam-game-launch.mjs';
import { computerIntentClassifier, computerPlanner } from './computer-planner.mjs';
import { computerVision } from './computer-vision.mjs';
import { FullComputerAccess } from './full-computer-access.mjs';
import { ComputerRequests } from './computer-requests.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import discordDefaults from '../../config/discord-presence.json' with { type: 'json' };
import { DiscordPresence, discordSettings } from './discord-presence.mjs';
import { loadCommunityLinks } from './community-links.mjs';
import {
  diagnosticModelId,
  writeModelSelectionLog,
} from '../../packages/runtime/src/privacy-log.mjs';
import { createSecureWindow } from './main/secure-window.mjs';
import {
  ResponseTimingLog,
  configureResponseTimings,
  withResponseTiming,
  acknowledgeResponsePaint,
} from '../../packages/runtime/src/response-timing.mjs';
import { timingFetch } from '../../packages/runtime/src/response-probe.mjs';
import { wantsVoiceFollowUp } from './voice-follow-up.mjs';
import { screenFormState } from './main/screen-form-state.mjs';
import { localizedDialog } from './main/localized-dialog.mjs';
import { SettingsWindow } from './main/settings-window.mjs';
import { AvatarComposer } from './main/avatar-composer.mjs';
import { MinimizedChip } from './main/minimized-chip.mjs';
import { CallAudioDiagnostics } from './main/call-audio-diagnostics.mjs';
import { DeveloperDiagnostics } from './diagnostics/developer.mjs';
import { replyHistory } from './renderer/reply-pages.mjs';
import {
  validateAvatarComposerAction,
  sanitizeAvatarComposerState,
  readSelectedComposerFiles,
} from './main/avatar-composer-bridge.mjs';
import { SETTINGS_CHANNELS } from './main/settings-channels.mjs';
import {
  PANEL_SECTIONS,
  SETTINGS_SECTIONS,
  settingsSection,
} from './renderer/settings-registry.mjs';
import { publishLaunchReceipt } from '../../packages/runtime/src/host/launch-receipt.mjs';
import { CompanionActions } from './companion-actions.mjs';
import { DesktopCatalog } from './desktop-catalog.mjs';
import { ApplicationAccess } from './application-access.mjs';
import { BrainKnowledge } from './brain-knowledge.mjs';
import { PrivateMemory } from './private-memory.mjs';
import { privateDialogue } from './private-dialogue.mjs';
import { TaskWorkflows } from './task-workflows.mjs';
import { UserTools } from './user-tools.mjs';
import { interfaceThemeColors } from './renderer/interface-theme.mjs';
import { FileService } from '../../integrations/filesystem/service.mjs';
import { TimeConversation } from './time-conversation.mjs';
import { ReminderDelivery } from './reminder-delivery.mjs';
import { speakReminder } from './reminder-playback.mjs';
import {
  observationOptions,
  prepareScreenObservationContext,
  SCREEN_VISION_REQUIRED,
  isModelImagesUnsupported,
  MODEL_IMAGES_UNSUPPORTED_MESSAGE,
  selectedScreenSource,
} from './screen-observation.mjs';
import { applicationId } from '../../packages/runtime/src/host/desktop-identity.mjs';
import { PointerController } from './main/pointer-controller.mjs';
import { createDesktopResources } from './main/resources.mjs';
import { createIpcHandler, settingsVersion } from './main/ipc.mjs';
import { resourceResponse } from './main/protocol.mjs';
import { registerScreenIpc } from './main/screen-ipc.mjs';
import { registerAccessIpc } from './main/access-ipc.mjs';
import { registerCompanionIpc } from './main/companion-ipc.mjs';
import { UpdateService } from './update-service.mjs';
import { GitHubAccess, githubTokenUrl, credentialStorage } from './github-access.mjs';
import { installSpeechComponents } from '../../packages/installer/src/speech-components.mjs';
import { SpeechInstallService } from './speech-install-service.mjs';
import { ModelService } from './model-service.mjs';
import { HuggingFaceHub } from '../../packages/runtime/src/huggingface/hub.mjs';
import { HuggingFaceService } from './huggingface-service.mjs';
import { HuggingFaceCredentials } from './huggingface-credentials.mjs';
import { VoiceCatalogService, voiceBackendChanged } from './voice-catalog-service.mjs';
import { ModelDeviceService } from './model-device-service.mjs';
import { VoiceTrainingService } from './voice-training-service.mjs';
import { SpotifySettings } from './spotify-settings.mjs';
import { SpotifyService, SpotifyWorker } from '../../integrations/spotify/service.mjs';
import { ApplicationService } from '../../integrations/desktop-actions/service.mjs';
import {
  saveModelProfile,
  saveContextWindow,
  saveInferenceSettings,
} from '../../packages/runtime/src/hardware/model-profile.mjs';
import { validateContextChoice } from '../../packages/runtime/src/config/context-policy.mjs';
import { responsiveness } from '../../packages/runtime/src/hardware/responsiveness.mjs';
import { consumeFirstLaunchPreload, startModelServices } from './model-startup.mjs';
import { memorySampler } from '../../packages/runtime/src/hardware/memory.mjs';
import { ProcessLoadSampler } from './process-load.mjs';
import { probeResourceUsage } from './diagnostics/resources.mjs';
import { LocalModelResidencySampler } from './local-model-residency.mjs';
import { CpuSampler } from './system-resources.mjs';
import { ContextSampler } from './context-usage.mjs';
import { MutedVoiceResidency } from './voice-residency.mjs';
import { ensureLanguageModelReady } from '../../packages/runtime/src/providers/model-residency.mjs';
import { localRunnerOptions } from '../../packages/runtime/src/providers/runner-policy.mjs';
import { conversationBudget } from './conversation-budget.mjs';
import { Confirmations } from './main/confirmations.mjs';
import {
  COMPANION_DEFAULTS,
  setMonitorDisplay,
  validateCompanionSettings,
} from './companion-settings.mjs';
import { clearSavedMemory } from './memory-controls.mjs';
import { readSavedMemory } from './saved-memory.mjs';
import { saveOwnerNote } from './owner-notes.mjs';
import { StartupProgress } from './startup-progress.mjs';
import { loadStartupIntro, startupIntroSnapshot } from './startup-intro-assets.mjs';
import { StartupIntroGate } from './main/startup-intro.mjs';
import {
  recognitionModelsInstalled,
  speechModelsInstalled,
  ENGLISH_VOICE_SETUP_MESSAGE,
} from './language-models.mjs';
import { VOICE_PREVIEWS } from './language-context.mjs';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  protocol,
  screen,
  session,
  globalShortcut,
  dialog,
  desktopCapturer,
  powerMonitor,
  shell,
  safeStorage,
  Notification,
} from 'electron';
import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  root,
  nodePath,
  ollamaPath,
  settings,
  runtime,
  initialize,
  personaPrompt,
  request,
  headers,
  stopManaged,
  managedProcess,
} from '../../packages/runtime/src/index.mjs';
import { startCore, stopCore } from '../../packages/runtime/src/providers/core.mjs';
import { ChatService, validateInput } from './chat-service.mjs';
import { TranscriptStore, writeJsonAtomic } from './storage.mjs';
import { readLegacyPrivateStorage } from './legacy-private-storage.mjs';
import { installTrayOnlyWindows } from './main/tray-only-windows.mjs';
import {
  avatarDropOutside,
  placeInWorkArea,
  placeVisibleInWorkArea,
  pointInRect,
  spriteGrabPoint,
  validateRegions,
  validWindowFootprint,
  visibleWindowBounds,
} from './geometry.mjs';
import { loadInstalledAvatar } from './avatar-catalog.mjs';
import { AvatarState } from './avatar-state.mjs';
import { DEFAULT_AVATAR_LAYOUT, validateAvatarLayout } from './avatar-layout.mjs';
import { VoiceService } from './voice-service.mjs';
import { speechLanguageMismatch } from './renderer/speech-text.mjs';
import { ASRWorker } from './asr-worker.mjs';
import { MicrophoneService, audioPermission } from './microphone-service.mjs';
import { AudioInputSettings } from './audio-input-settings.mjs';
import { SystemAudioCapture } from './system-audio-capture.mjs';
import { MusicAudioCapture } from './music-audio-capture.mjs';
import { MusicListeningService } from './music-listening-service.mjs';
import {
  MUSIC_LISTENING_DEFAULTS,
  musicAnimationReady,
  validateMusicListeningSettings,
} from './music-listening-settings.mjs';
import { callResponseGenerator } from './call-response.mjs';
import { CallAudioSetup } from './call-audio-setup.mjs';
import { VirtualCableInstaller } from './virtual-cable-installer.mjs';
import {
  callAudioCommand,
  callAudioPreferences,
  callAudioState,
  callOutputDevices,
  speakerSelectionAllowed,
} from './main/call-audio.mjs';
import { validateSpeechSettings } from './renderer/speech-settings.mjs';
import { DIMMING_DEFAULTS, validateDimming } from './renderer/dimming-settings.mjs';
import { RequestRouter } from './request-router.mjs';
import { randomUUID } from 'node:crypto';
import { freemem } from 'node:os';
import { Preferences } from './preferences.mjs';
import { INFERENCE_STARTUP_DEFAULTS, inferenceStartupSettings } from './inference-startup.mjs';
import { VOICE_EFFECT_DEFAULTS, validateVoiceEffects } from './renderer/voice-effects-settings.mjs';
import {
  LANGUAGE_DEFAULTS,
  LANGUAGE_PACKS,
  INTERFACE_LOCALES,
  validateLanguages,
  resolveLanguages,
  languageBehaviorChanged,
  languageName,
  uiText,
} from './renderer/language-settings.mjs';
import { FilePermissions, protectedLocations } from '../../integrations/filesystem/permissions.mjs';
import {
  APPLICATION_DEFAULTS,
  validateApplications,
} from '../../integrations/desktop-actions/settings.mjs';
import { ensureDesktopActions } from '../../integrations/desktop-actions/provision.mjs';
import { INITIATIVE_DEFAULTS, validateInitiative } from './initiative-settings.mjs';
import { WindowsObserver } from './windows-observer.mjs';
import { syncAwareness } from './awareness-sync.mjs';
import { InitiativeService } from './initiative-service.mjs';
import { initiativeGenerator } from './initiative-generator.mjs';
import { CompanionRpc } from './gateway-rpc.mjs';
import { ensureAwareness } from '../../integrations/awareness/provision.mjs';
import { ScreenCapturePolicy } from './screen-capture-policy.mjs';
import { VisualService, snapshotBytes } from './visual-service.mjs';
import { AttachmentDrafts } from './attachments.mjs';
import { AttachmentHistory } from './attachment-history.mjs';
import { AttachmentViewer } from './main/attachment-viewer.mjs';
import { ScreenObservation } from './screen-observation.mjs';
import { screenObserverModel } from './screen-observer-model.mjs';
import { isClipCommand } from './clip-command.mjs';
import { avatarTapsSleeping, isSleepCommand, SleepService } from './sleep-service.mjs';
import { ScreenshotFiles } from './screenshot-files.mjs';
import { ScreenClipFrames } from './screen-clip-frames.mjs';
import { captureActiveDisplay } from './native-screenshot.mjs';
import { ControlOverlay } from './main/control-overlay.mjs';
import { ControlWindowLayer } from './main/control-window-layer.mjs';
import { AvatarDetach, avatarDragCanTeleport } from './main/avatar-detach.mjs';
import { DesktopTeleportMenu } from './main/desktop-teleport-menu.mjs';
import {
  settingsAvatarWindowId,
  watchAvatarSettingsWindow,
} from './main/avatar-settings-window.mjs';
import {
  desktopAvatarCommand,
  isSettingsWindowTitle,
  randomAvatarDestination,
} from './desktop-avatar-commands.mjs';
import {
  AvatarClickReactions,
  avatarClickCue,
  avatarClickGenerator,
} from './avatar-click-reactions.mjs';
import {
  avatarDockFrame,
  avatarDockPoint,
  nearestAvatarDock,
  nearestDisplayAvatarDock,
  pointInReservedDesktop,
  visibleAvatarDock,
} from './avatar-docking.mjs';
import {
  COMMUNICATION_STYLES,
  readCommunicationStyle,
} from '../../packages/runtime/src/communication.mjs';
import {
  defaultPersonality,
  validatePersonality,
} from '../../packages/runtime/src/personality.mjs';
import { COMPUTER_DEFAULTS, computerPreferences } from './computer-preferences.mjs';
import {
  companionVoiceSettings,
  companionVoiceInstalled,
  companionVoiceUrl,
  companionVoiceHeaders,
  startCompanionVoice,
} from '../../integrations/voice_runtime/host.mjs';

const callAudioDiagnostics = new CallAudioDiagnostics();
const directory = path.dirname(fileURLToPath(import.meta.url));
const applicationIcon = path.join(root, 'assets/default/icon-source.png');
const verification = process.argv.includes('--verification');
const verificationFolder = process.env.CAPRI_DESKTOP_VERIFICATION_DIR;
if (
  verification &&
  (!verificationFolder ||
    !path.resolve(verificationFolder).startsWith(path.join(root, '.runtime') + path.sep))
) {
  throw new Error('Verification state must be inside this project’s .runtime directory');
}
const state = verification
  ? path.join(verificationFolder, 'desktop')
  : path.join(root, 'data/desktop');
// Resolve the installation-specific identity before reading credentials or
// initializing owner files. A duplicate must only notify the current owner.
app.setName(verification ? 'Capri Verification' : 'Capri');
if (process.platform === 'win32') app.setAppUserModelId(applicationId(verification ? state : root));
app.setPath('userData', path.join(state, 'profile'));
app.setPath('sessionData', path.join(state, 'profile'));
app.setPath('crashDumps', path.join(state, 'crashes'));
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'capri',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.exit(0);
else {
  installTrayOnlyWindows(app);
  // Also brand windows opened directly from source, before their first show.
  if (process.platform !== 'darwin')
    app.on('browser-window-created', (_event, window) => window.setIcon(applicationIcon));
}
async function initializeDesktop() {
  configureResponseTimings(
    new ResponseTimingLog(
      path.join(verification ? verificationFolder : root, 'logs/response-desktop.jsonl'),
    ),
  );
  const localTimingFetch = timingFetch(fetch, { ollamaPort: settings.ollamaPort });
  const rt = verification
    ? runtime({
        stateDir: path.join(verificationFolder, 'openclaw'),
        workspace: path.join(verificationFolder, 'workspace'),
        gatewayPort: Number(process.env.CAPRI_DESKTOP_VERIFICATION_PORT || 18790),
        logPrefix: 'desktop-verification',
      })
    : runtime();
  const privateStorage = await readLegacyPrivateStorage({
    keyFile: path.join(state, 'private-data-key.json'),
    storage: credentialStorage(safeStorage),
  });
  const inferenceApi = new InferenceApi({
    root: verification ? verificationFolder : root,
    storage: credentialStorage(safeStorage),
    proxySession: () => session.fromPartition('capri-inference-proxy', { cache: false }),
    ...(verification ? { config: apiSettings() } : {}),
  });
  rt.remote = inferenceApi.config;
  const diagnosticModel = diagnosticModelId(rt.remote.enabled ? rt.remote.model : settings.model);
  if (diagnosticModel)
    writeModelSelectionLog(
      path.join(verification ? verificationFolder : root, 'logs'),
      diagnosticModel,
    );
  const npuDialogue =
    rt.remote.enabled && isLemonadeNpuEndpoint(new URL(rt.remote.baseUrl), rt.remote.model);
  const screenVisionAvailable = rt.remote.enabled
    ? rt.remote.vision
    : !settings.modelCapabilities || settings.modelCapabilities.includes('vision');
  rt.inferenceUrl = rt.remote.enabled ? `http://127.0.0.1:${rt.gatewayPort + 2}` : rt.ollamaUrl;
  rt.remoteProxyToken = inferenceApi.proxyToken;
  const inferenceOptions = rt.remote.enabled
    ? {
        fetchImpl: inferenceApi.localFetch,
        modelCapabilities: [
          ...(rt.remote.tools ? ['tools'] : []),
          ...(rt.remote.vision ? ['vision'] : []),
        ],
      }
    : { fetchImpl: localTimingFetch };
  const auxiliaryRunnerParams = Object.freeze({
    num_ctx: settings.contextTokens,
    ...(!rt.remote.enabled ? localRunnerOptions(settings) : {}),
  });
  const prepareThinking = thinkingBriefing({
    url: rt.inferenceUrl,
    model: settings.model,
    params: auxiliaryRunnerParams,
    ...inferenceOptions,
  });
  if (!Number.isInteger(rt.gatewayPort) || rt.gatewayPort < 1024 || rt.gatewayPort > 65535)
    throw new Error('Invalid local Gateway port');
  mkdirSync(state, { recursive: true });
  for (const folder of ['profile', 'crashes'])
    mkdirSync(path.join(state, folder), { recursive: true });
  initialize(rt);

  const rendererUrl = 'capri://desktop/index.html';
  const settingsUrl = 'capri://desktop/settings.html';
  const windowFile = path.join(state, 'window.json');
  const stopFile = path.join(root, 'data/run/desktop.stop');
  const showFile = path.join(root, 'data/run/desktop.show');
  const desktopTeleportMenu =
    !verification && process.platform === 'win32'
      ? new DesktopTeleportMenu(root, (point) => {
          void teleportToCursor(screen.screenToDipPoint(point)).catch(() => {});
        })
      : null;
  const installedAvatar = loadInstalledAvatar(root);
  const { catalog } = installedAvatar;
  const startupIntroPack = catalog.animated ? loadStartupIntro(root) : null;
  const startupIntroGate = new StartupIntroGate({
    enabled: Boolean(startupIntroPack),
    available: () =>
      Boolean(
        !sessionLocked &&
          !shuttingDown &&
          !quitting &&
          !focusMode &&
          !avatarOnly &&
          window &&
          !window.isDestroyed() &&
          window.isVisible() &&
          !window.isMinimized() &&
          window.webContents.getURL() === rendererUrl &&
          !settingsHost?.window?.isVisible(),
      ),
  });
  const dockFrames = new Map(catalog.desktopPoseFrames.map((frame) => [frame.id, frame]));
  console.log('Capri avatar:', JSON.stringify(installedAvatar.diagnostics));
  const spriteFile = catalog.sprites.find((sprite) => sprite.id === catalog.defaultId).file;
  const avatarFile = path.join(state, 'avatar.json');
  const avatarLayoutFile = path.join(state, 'avatar-layout.json');
  const dimmingFile = path.join(state, 'dimming.json');
  const presenceFile = path.join(state, 'presence.json');
  let presencePinned = false;
  try {
    const bytes = readFileSync(presenceFile);
    if (bytes.length < 4096) {
      const value = JSON.parse(bytes.toString('utf8'));
      presencePinned = value.schemaVersion === 1 && value.pinned === true;
    }
  } catch {
    /* Standby core is the default. */
  }
  let dimming = { ...DIMMING_DEFAULTS };
  try {
    const bytes = readFileSync(dimmingFile);
    if (bytes.length < 4096) {
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.schemaVersion === 1) dimming = validateDimming(value);
    }
  } catch {
    /* First launch uses a gentle dimming level. */
  }
  let avatarLayout = { ...DEFAULT_AVATAR_LAYOUT };
  try {
    const bytes = readFileSync(avatarLayoutFile);
    if (bytes.length < 4096) {
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.schemaVersion === 1) avatarLayout = validateAvatarLayout(value);
    }
  } catch {
    /* Restore the centred default if the layout is missing or invalid. */
  }
  let restoredAvatar;
  try {
    const bytes = readFileSync(avatarFile);
    if (bytes.length < 4096) {
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.schemaVersion === 1) restoredAvatar = value.id;
    }
  } catch {
    /* Missing or invalid state uses the catalog default. */
  }
  const avatar = new AvatarState(catalog.publicSprites(), catalog.defaultId, {
    restoredId: restoredAvatar,
    persist: (value) => {
      try {
        writeJsonAtomic(avatarFile, value);
      } catch {
        console.error('Could not save avatar selection');
      }
    },
  });
  const masks = new Map();
  let activeMask;
  let frameSequence = -1;
  let frameRevision = -1;
  const frameIds = new Map(
    [...catalog.portraitFrames, ...(catalog.musicFrames ?? [])]
      .filter((frame) => frame.kind !== 'effect')
      .map((frame) => [frame.id, frame]),
  );
  function maskFor(id, artwork = frameIds.get(id)) {
    if (masks.has(id)) {
      const value = masks.get(id);
      masks.delete(id);
      masks.set(id, value);
      return value;
    }
    if (!artwork) throw new Error('Unknown animation frame');
    const image = nativeImage.createFromPath(artwork.file);
    if (image.isEmpty()) throw new Error('Could not decode animation frame');
    const imageSize = image.getSize(),
      bitmap = image.toBitmap(),
      alpha = new Uint8Array(imageSize.width * imageSize.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = bitmap[i * 4 + 3];
    let visibleBounds = artwork.visibleBounds;
    if (!visibleBounds) {
      let left = imageSize.width,
        top = imageSize.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < imageSize.height; y++) {
        for (let x = 0; x < imageSize.width; x++) {
          if (alpha[y * imageSize.width + x] < 16) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      if (right >= left && bottom >= top)
        visibleBounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    }
    const value = {
      alpha,
      imageSize,
      visibleBounds,
      ...(['reviewed_pose', 'reviewed_music'].includes(artwork.kind) && { poseId: id }),
    };
    masks.set(id, value);
    while (masks.size > 20) masks.delete(masks.keys().next().value);
    return value;
  }
  const size = { width: 480, height: 660 };
  const allowedResources = createDesktopResources({
    root,
    directory,
    catalog,
    spriteFile,
    startupIntro: startupIntroPack,
  });

  let window, tray, regions, pointer, controlTimer, saveTimer, layoutSaveTimer;
  let attachmentViewer;
  let windowFootprint, compactPlacement;
  let avatarDetach, avatarClickReactions, avatarComposer;
  let avatarComposerDismissed = false;
  let avatarComposerState = sanitizeAvatarComposerState({});
  let detachedReplyHovered = false;
  const avatarComposerActions = new Map();
  let avatarComposerPicking = false;
  let perch,
    desktopFrame,
    avatarRoamCapture,
    avatarRoamAt = 0,
    avatarDesktopUpdate = false;
  let settingsHost;
  let settingsPreview = {};
  const liveCompanionSettings = () => settingsPreview.companion ?? companionPreferences.value;
  const liveLanguages = () => settingsPreview.languages ?? languages.snapshot();
  const liveMicrophone = () => settingsPreview.microphone ?? audioInputs.snapshot();
  const livePersona = () => personaPrompt(rt, settingsPreview);
  let focusMode = false;
  let minimizedChip;
  let recordingIndicator;
  let recordingShown = false;
  let avatarOnly = false;
  let workflowTurn = null,
    workflows;
  const VOICE_REQUIRED_MESSAGE = 'Enable Capri’s voice first.';
  let prepareWakeAudio = async () => {};
  let temporal;
  let reminders,
    sessionLocked = false;
  const reminderListeners = new Set();
  let shuttingDown = false;
  let rendererReady = false;
  let rendererFailed = false,
    rendererRecovery = null,
    nextRendererRecovery = 0;
  let quitting = false;
  let backendPromise = null;
  let backendController = null;
  let backendState = { phase: 'starting', message: 'Starting local core…' };
  let saved = {};
  const preferredAlwaysOnTop = () => settingsPreview.alwaysOnTop ?? saved.alwaysOnTop !== false;
  const controlWindowLayer = new ControlWindowLayer({
    getWindow: () => window,
    desired: preferredAlwaysOnTop,
  });
  let dimmingSaveTimer;
  try {
    saved = JSON.parse(readFileSync(windowFile, 'utf8'));
  } catch {
    /* First launch or invalid saved geometry. */
  }
  // Preserve the bottom-right anchor when upgrading the original 380×680 panel.
  if (saved.schemaVersion === 1 && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    saved.x += 380 - size.width;
    saved.y += 680 - size.height;
  }
  if (saved.schemaVersion === 2 && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    saved.x += 460 - size.width;
    saved.y += 580 - size.height;
  }
  const store = new TranscriptStore(path.join(state, 'transcript.json'), {
    privacy: privateStorage,
  });
  const attachmentHistory = new AttachmentHistory({
    privacy: privateStorage,
    directory: path.join(state, 'conversation-attachments'),
    references: () => store.snapshot(),
    canPrune: () => !store.warning,
    normalizeImage: (png) => {
      const image = nativeImage.createFromBuffer(png);
      if (image.isEmpty()) throw new Error('Image preview unavailable');
      const size = image.getSize();
      const scale = Math.min(1, 320 / size.width, 180 / size.height);
      return {
        preview: image.toPNG(),
        thumb: image
          .resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: 'good',
          })
          .toPNG(),
      };
    },
  });
  attachmentHistory.prune();
  store.onAttachmentsChanged = () => {
    attachmentHistory.prune();
    attachmentViewer?.closeIfUnavailable();
  };
  const processLoad = new ProcessLoadSampler({ root });
  const systemCpu = new CpuSampler();
  const companionPreferences = new Preferences(
    path.join(state, 'companion.json'),
    COMPANION_DEFAULTS,
    validateCompanionSettings,
  );
  const inferenceStartup = new Preferences(
    path.join(state, 'inference-startup.json'),
    INFERENCE_STARTUP_DEFAULTS,
    inferenceStartupSettings,
  );
  const computerAppearance = new Preferences(
    path.join(state, 'computer-control.json'),
    COMPUTER_DEFAULTS,
    computerPreferences,
  );
  const confirmations = new Confirmations({
    emit,
    show: () =>
      settingsHost?.window?.isVisible()
        ? settingsHost.window.focus()
        : avatarOnly
          ? restoreCompanion()
          : showCompanion(true),
  });
  const githubAccess = new GitHubAccess({
    root: verification ? verificationFolder : root,
    storage: credentialStorage(safeStorage),
    ...(verification ? { fallback: async () => null } : {}),
  });
  const updates = new UpdateService({
    root,
    state,
    node: nodePath,
    emit,
    credential: () => githubAccess.credential(),
  });
  const speechInstaller = new SpeechInstallService({
    root: verification ? verificationFolder : root,
    node: nodePath,
    emit,
    install: (selection, options) =>
      installSpeechComponents(selection, {
        ...options,
        credential: () => githubAccess.credential(),
      }),
    before: async (signal) => {
      microphone.stop();
      microphone.worker.close();
      voiceStartController?.abort();
      voice.close();
      voice.setReady(false);
      await voiceStartPromise?.catch(() => {});
      signal.throwIfAborted();
      if (!verification) await stopManaged('companion-voice');
    },
    ready: async () => {
      voiceAvailable = verification || companionVoiceInstalled();
      voiceAllowed =
        voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
      asrInstalled = recognitionInstalled(asrConfig.language);
      microphone.publish({ available: asrAllowed && asrInstalled });
      emit({
        type: 'speech-components',
        speechAvailability: Object.fromEntries(
          LANGUAGE_PACKS.map((p) => [p.id, speechInstalled(p.id)]),
        ),
        recognitionAvailability: recognitionAvailability(),
      });
    },
  });
  const hfCredentials = new HuggingFaceCredentials({
    root: verification ? verificationFolder : root,
    storage: credentialStorage(safeStorage),
  });
  const hfHub = new HuggingFaceHub({
    root: verification ? verificationFolder : root,
    ollamaUrl: rt.ollamaUrl,
    token: () => hfCredentials.tokenFor('https://huggingface.co'),
  });
  const importedProfiles = async () =>
    (await hfHub.list()).filter((item) => item.profile).map((item) => item.profile);
  const localModelName =
    hfHub.list().find((item) => item.profile?.alias === settings.model)?.repository ??
    settings.upstreamModel ??
    settings.model;
  const localResidency = new LocalModelResidencySampler({ url: rt.ollamaUrl });
  const models = new ModelService({ rt, config: settings, emit, customProfiles: importedProfiles });
  const modelDevices = new ModelDeviceService({
    root: verification ? verificationFolder : root,
    ollama: ollamaPath,
    config: settings,
  });
  const developerDiagnostics = new DeveloperDiagnostics({
    root: verification ? verificationFolder : root,
    installerDirectory:
      !verification && process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Capri/Installer')
        : null,
  });
  const huggingface = new HuggingFaceService({
    hub: hfHub,
    credentials: hfCredentials,
    emit,
    ensure: () => models.ensure(),
    active: () => settings.model,
    changed: async () => {
      models.prepared = null;
      await models.refresh();
    },
  });
  const stopVoiceForChange = async () => {
    voiceStartController?.abort();
    voice.close();
    voice.setReady(false);
    await voiceStartPromise?.catch(() => {});
    if (!verification) await stopManaged('companion-voice');
  };
  const voiceCatalog = new VoiceCatalogService({
    root: verification ? verificationFolder : root,
    configRoot: root,
    emit,
    beforeChange: stopVoiceForChange,
  });
  const voiceTraining = new VoiceTrainingService({
    root: verification ? verificationFolder : root,
    emit,
    before: async () => {
      if (!verification && !rt.remote.enabled) await sleepService.sleep();
      await stopVoiceForChange();
    },
    ready: async () => {
      if (!verification) {
        try {
          await startCompanionVoice({ language: 'en', modelId: 'chatterbox-turbo' });
        } finally {
          await stopVoiceForChange();
        }
      }
      emit({ type: 'voice-catalog.status', ...voiceCatalog.snapshot() });
    },
  });
  const spotifyService = new SpotifyService(new SpotifyWorker({ root }));
  const spotify = new SpotifySettings({
    root,
    rt,
    agentId: settings.agentId,
    node: nodePath,
    emit,
    readStatus: (signal) => spotifyService.execute(randomUUID(), { action: 'status' }, signal),
  });
  const startup = new StartupProgress({ file: path.join(state, 'startup-times.json'), emit });
  const voiceEffects = new Preferences(
    path.join(state, 'voice-effects.json'),
    VOICE_EFFECT_DEFAULTS,
    validateVoiceEffects,
  );
  const languages = new Preferences(
    path.join(state, 'languages.json'),
    LANGUAGE_DEFAULTS,
    validateLanguages,
  );
  const applications = new Preferences(
    path.join(state, 'applications.json'),
    APPLICATION_DEFAULTS,
    validateApplications,
  );
  const applicationAccess = new ApplicationAccess({
    file: path.join(state, 'application-access.json'),
    changed: (settings) => emit({ type: 'application.access', settings }),
    stop: async () => {
      workflows?.cancel();
      companionActions.approvals.cancel();
      await spotifyService?.close();
      if (computerAgent.running || computerControl.session) await emergencyComputerStop();
    },
  });
  const brain = new BrainKnowledge({
    data: verification ? verificationFolder : path.join(root, 'data'),
    state,
    changed: (settings) => emit({ type: 'brain.status', settings }),
  });
  const privateMemory = new PrivateMemory({
    file: path.join(state, 'private-memory.enc.json'),
    changed: (settings) => emit({ type: 'private-memory.status', settings }),
  });
  const userTools = new UserTools({
    root,
    data: verification ? path.join(verificationFolder, 'data') : path.join(root, 'data'),
    state,
    node: nodePath,
    storage: credentialStorage(safeStorage),
    onRun: () => chat.computerProgress(),
  });
  const initiativeSettings = new Preferences(
    path.join(state, 'initiative.json'),
    INITIATIVE_DEFAULTS,
    validateInitiative,
  );
  const fullComputerAccess = new FullComputerAccess({
    file: path.join(state, 'full-computer-access.json'),
    discover: async () => (await callApplicationBridge(root, { action: 'catalog_drives' })).drives,
    confirm: (options) => confirmations.request(options),
    onChange: (value) => {
      if (!value.enabled) void computerControl.stop();
      chat.computerApproval(value.enabling);
      emit({ type: 'computer-access', settings: value });
    },
  });
  const filePermissions = new FilePermissions(path.join(state, 'file-permissions.json'), {
    protectedRoots: verification ? [state] : protectedLocations(root),
    privatePaths: [
      state,
      brain.folder,
      path.join(verification ? verificationFolder : path.join(root, 'data'), 'workflows'),
      path.join(userTools.data, 'secrets'),
      userTools.publicFile,
      path.join(root, '.runtime/native-helpers'),
      path.join(root, '.runtime/tool-runs'),
    ],
    applicationRoot: verification ? verificationFolder : root,
    computerScopes: () => fullComputerAccess.scopes(),
  });
  function fileAccessSnapshot() {
    try {
      return { scopes: filePermissions.snapshot(), warning: null };
    } catch {
      return {
        scopes: [],
        warning:
          'Saved folder permissions could not be read. File access is disabled until you revoke and select folders again.',
      };
    }
  }
  const audioInputs = new AudioInputSettings(path.join(state, 'microphone.json'));
  const musicPreferences = new Preferences(
    path.join(state, 'music-listening.json'),
    MUSIC_LISTENING_DEFAULTS,
    validateMusicListeningSettings,
  );
  const liveMusicSettings = () => settingsPreview.musicListening ?? musicPreferences.snapshot();
  const callAudioPolicy = new Preferences(
    path.join(state, 'call-audio.json'),
    callAudioPreferences({ allowModel: false }),
    callAudioPreferences,
  );
  const generateCallReply = callResponseGenerator({
    url: rt.inferenceUrl,
    model: settings.model,
    params: auxiliaryRunnerParams,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
  });
  let listingAudioInputs = false,
    audioInputRefresh;
  let listingCallOutputs = 0,
    enablingCallOutput = false,
    callMicrophoneArmed = false,
    currentCallAudio = callAudioState(),
    callVoiceTurn = null;
  const chatSessionKey = verification
    ? process.env.CAPRI_DESKTOP_VERIFICATION_SESSION || settings.sessionKey
    : settings.sessionKey;
  const screenshots = new ScreenshotFiles({
    root,
    directory: verification
      ? path.join(verificationFolder, 'screenshots')
      : path.join(root, 'data/screenshots'),
  });
  const lastScreenshotFile = path.join(state, 'last-screenshot.json');
  let lastScreenshot = null;
  try {
    const value = JSON.parse(readFileSync(lastScreenshotFile, 'utf8')),
      saved = screenshots.saved(value.id);
    if (saved)
      lastScreenshot = {
        id: saved.id,
        name: saved.name,
        path: path.relative(root, saved.file).split(path.sep).join('/'),
        capturedAt: saved.capturedAt,
      };
  } catch {}
  const clipJobs = new Map();
  const requestRouter = new RequestRouter({
    root,
    ...(verification && process.env.CAPRI_DESKTOP_VERIFICATION_ROUTER !== '1'
      ? { config: { schemaVersion: 1, enabled: false, timeoutMs: 150 } }
      : {}),
  });
  const responseTiming = responsiveness({ ...settings, availableRamBytes: freemem() });
  const internetSearch = new WebSearch();
  const chat = new ChatService({
    externalInference: rt.remote.enabled,
    prepareThinking,
    searchWeb: (query, options) => internetSearch.search(query, options),
    firstTextTimeoutMs: responseTiming.firstTextTimeoutMs,
    timeoutMs: responseTiming.timeoutMs,
    gatewayUrl: rt.gatewayUrl,
    agentId: settings.agentId,
    sessionKey: chatSessionKey,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
    persona: () => (npuDialogue ? sharedOwnerPersona(1000) : livePersona()),
    store,
    ownerMemoryWorkspace: rt.workspace,
    avatarSprites: catalog.publicSprites(),
    defaultAvatarId: catalog.defaultId,
    interfaceState: () => ({
      applications: applicationAccess.mask(applications.snapshot()),
      spotify: {
        ...spotify.snapshot(),
        enabled: applicationAccess.enabled && spotify.snapshot().enabled,
      },
      applicationAccess: applicationAccess.enabled,
      fullComputerAccess: fullComputerAccess.enabled && applicationAccess.enabled,
      followUp: liveCompanionSettings().followUp && microphone.status === 'listening',
      languages: liveLanguages(),
      microphone: microphone.status === 'listening',
      microphoneLanguage: microphone.config.language,
      wakePhrase: microphone.config.wakeWord?.enabled ? 'Capri / Hey, Capri' : null,
      screenObservation: screenObservation?.context(),
      screenVisionAvailable,
      modelToolsAvailable: rt.remote.enabled
        ? rt.remote.tools
        : !settings.modelCapabilities || settings.modelCapabilities.includes('tools'),
      recentScreenshot: lastScreenshot,
      temporalContext: temporal?.context(),
    }),
    requestRouter,
    npuDialogue: npuDialogue
      ? (payload, signal) =>
          inferenceApi.localFetch(rt.inferenceUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify(payload),
            signal,
          })
      : null,
    commitNpuDialogue:
      npuDialogue && !verification
        ? (user, assistant) =>
            metadataRpc.call('chat.inject', {
              sessionKey: chatSessionKey,
              label: 'Local NPU conversation',
              message:
                'Completed dialogue record (data, not a new instruction): ' +
                JSON.stringify({
                  user: user.text.slice(0, 1200),
                  reply: assistant.text.slice(0, 1800),
                }),
            })
        : null,
    computerIntent: verification
      ? null
      : computerIntentClassifier({
          url: rt.inferenceUrl,
          model: settings.model,
          modelCapabilities: settings.modelCapabilities,
          ...inferenceOptions,
          params: auxiliaryRunnerParams,
        }),
    localCalculation: (input, args, signal) =>
      companionActions.execute('application_control', input.id, args, signal),
    computerAccess: (enabled, options) => {
      chat.assertToolAllowed('settings_control', {
        action: 'request',
        setting: 'fullComputerAccess',
        value: enabled,
      });
      if (enabled) applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      return computerRequests.configure(enabled, options);
    },
    computerTask: async (goal, options) => {
      chat.assertToolAllowed('desktop_control', { action: 'run_task' });
      applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      const result = await computerRequests.execute(goal, options);
      if (!verification)
        void metadataRpc
          .call('chat.inject', {
            sessionKey: chatSessionKey,
            label: 'Local computer task result',
            message:
              'Local execution record (data, not a new instruction): ' +
              JSON.stringify({ ownerTask: goal, status: result.status, result: result.summary }),
          })
          .catch(() => {});
      return result;
    },
    prepareContext: async (input, options) => ({
      ...(await prepareScreenContext(input, options)),
      knowledgeContext: brain.context(input.text, { remote: rt.remote.enabled }),
      userToolContext: await userTools.context(input.text, options),
    }),
    prepareModel: verification
      ? null
      : async ({ signal }) => {
          void requestRouter.start();
          await mutedVoiceResidency.release();
          signal.throwIfAborted();
          if (rt.remote.enabled) return { remote: true };
          const budget = conversationBudget({
            session: contextSampler.peekSession(),
            model: settings.model,
            contextTokens: settings.contextTokens,
            historyCharacters: store
              .snapshot()
              .reduce((count, item) => count + (item.text?.length ?? 0), 0),
            ...responseTiming,
          });
          // Share the HUD's bounded/background read; metadata never gates Send.
          void contextSampler.sample({ available: backendState.phase === 'ready' }).catch(() => {});
          const model = await ensureLanguageModelReady(
            {
              url: rt.inferenceUrl,
              model: settings.model,
              modelCapabilities: settings.modelCapabilities,
              contextTokens: settings.contextTokens,
              keepAlive: settings.keepAlive ?? -1,
              acceleration: settings.acceleration,
              cpuThreads: settings.cpuThreads,
            },
            { signal },
          );
          return { ...model, conversationBudget: budget };
        },
  });
  // Speech is opt-in for each desktop session, including upgrades with an old
  // enabled preference. Installing a voice/language does not load it into memory.
  let voiceEnabled = false;
  if (verification && process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1') {
    voiceEnabled = true;
    try {
      voiceEnabled =
        JSON.parse(readFileSync(path.join(state, 'voice.json'), 'utf8')).enabled === true;
    } catch {}
  }
  let voiceAvailable = verification || companionVoiceInstalled();
  let voiceAllowed =
    voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
  const speechInstalled = (language) => {
    if (verification && ['0', '1'].includes(process.env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS))
      return (
        process.env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS === '1' &&
        LANGUAGE_PACKS.some((pack) => pack.id === language && pack.speechReady)
      );
    return speechModelsInstalled(root, language);
  };
  const voice = new VoiceService({
    url: companionVoiceUrl(),
    headers: companionVoiceHeaders,
    emit,
    enabled: voiceAllowed && voiceEnabled,
    language: voiceAvailable ? resolveLanguages(languages.value).speech : 'off',
  });
  const asrConfig = JSON.parse(readFileSync(path.join(root, 'config/companion-asr.json'), 'utf8'));
  const speechDefaults = { trailingSilenceSeconds: asrConfig.trailingSilenceSeconds };
  const speechPreferences = new Preferences(
    path.join(state, 'speech.json'),
    speechDefaults,
    validateSpeechSettings,
  );
  asrConfig.trailingSilenceSeconds = speechPreferences.value.trailingSilenceSeconds;
  // The separate continuous-ASR regression exercises the documented disabled gate.
  if (verification && process.env.CAPRI_DESKTOP_VERIFICATION_WAKE === '0')
    asrConfig.wakeWord = { ...asrConfig.wakeWord, enabled: false };
  asrConfig.language = resolveLanguages(languages.value).recognition;
  const asrAllowed = !verification || process.env.CAPRI_DESKTOP_VERIFICATION_ASR === '1';
  const recognitionInstalled = (language) => {
    if (verification && ['0', '1'].includes(process.env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS))
      return process.env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS === '1' && language !== 'off';
    return recognitionModelsInstalled(root, language, asrConfig);
  };
  const recognitionAvailability = () =>
    Object.fromEntries(
      [...LANGUAGE_PACKS.map((p) => p.id), 'auto', 'auto-europe'].map((id) => [
        id,
        recognitionInstalled(id),
      ]),
    );
  let asrInstalled = recognitionInstalled(asrConfig.language);
  let currentChatTask = null,
    visualTurn = null;
  let visualResponse = { active: false, lastFailure: null };
  let screenObservation;
  let voicePreviewRequest = null;
  function cancelVisual(id) {
    if (!visualTurn || (id && visualTurn.id !== id)) return false;
    visualTurn.controller.abort();
    return true;
  }
  const turnOrigins = new Map();
  let thinkingMode = false;
  let internetMode = false;
  function thinkingInput(value) {
    return validateInput({
      ...value,
      thinking: value?.thinking === undefined ? thinkingMode : value.thinking,
      internet: value?.internet === undefined ? internetMode : value.internet,
    });
  }
  async function submitMessage(value, origin = 'text') {
    return withResponseTiming(value?.id, () => submitMessageTurn(value, origin));
  }
  async function submitMessageTurn(value, origin = 'text') {
    avatarClickReactions?.cancel();
    const input = thinkingInput(value);
    const movement = desktopAvatarCommand(input.text);
    if (movement) return submitAvatarCommand(input, movement);
    if (voiceTraining.busy())
      throw new Error('Wait for voice training to finish, or cancel it in Languages.');
    if (settings.modelSetupRequired && !rt.remote.enabled)
      throw new Error('Choose and prepare a language model in Settings → Language model first.');
    if (speechInstaller.busy())
      throw new Error('Wait for speech installation to finish, or cancel it in Languages.');
    initiative.activity();
    screenObservation?.activity();
    pendingFollowUp = null;
    if (origin === 'text') microphone.cancelContinuation();
    turnOrigins.set(input.id, {
      origin,
      sessionId: origin === 'microphone' ? microphone.capture?.id : null,
    });
    if (turnOrigins.size > 128) turnOrigins.delete(turnOrigins.keys().next().value);
    if (shuttingDown) throw new Error('Capri is shutting down');
    const approval = await companionActions.approvals.text(input.text);
    if (approval) {
      const createdAt = new Date().toISOString();
      const user = {
        id: randomUUID(),
        turnId: input.id,
        role: 'user',
        text: input.text,
        status: 'complete',
        createdAt,
      };
      const assistant = {
        id: randomUUID(),
        turnId: input.id,
        role: 'assistant',
        text: approval.cancelled
          ? uiText('Cancelled.', languages.value.conversation)
          : uiText(approval.confirmation ?? 'Done.', languages.value.conversation),
        status: 'complete',
        createdAt,
      };
      store.put(user);
      store.put(assistant);
      emit({ type: 'turn.started', turnId: input.id, user, assistant, silent: true });
      emit({ type: 'turn.completed', turnId: input.id, assistant });
      return { ok: true };
    }
    const elapsedReply = !currentChatTask && temporal?.read(input.text);
    if (elapsedReply) {
      const createdAt = new Date().toISOString();
      const user = {
        id: randomUUID(),
        turnId: input.id,
        role: 'user',
        text: input.text,
        status: 'complete',
        createdAt,
      };
      const assistant = {
        id: randomUUID(),
        turnId: input.id,
        role: 'assistant',
        text: elapsedReply,
        status: 'complete',
        createdAt,
      };
      store.put(user);
      store.put(assistant);
      emitChat({
        type: 'turn.started',
        turnId: input.id,
        user,
        assistant: { ...assistant, text: '' },
      });
      emitChat({ type: 'turn.delta', turnId: input.id, text: elapsedReply });
      emitChat({ type: 'turn.completed', turnId: input.id, assistant });
      if (backendState.phase === 'ready')
        void metadataRpc
          .call('chat.inject', {
            sessionKey: chatSessionKey,
            message: elapsedReply,
            label: 'Verified local clock response',
          })
          .catch(() => {});
      return { ok: true };
    }
    if (isSleepCommand(input.text)) {
      if (currentChatTask || chat.active) throw new Error('A reply is already in progress.');
      const task = sleepService.sleep();
      currentChatTask = task;
      try {
        await task;
        const createdAt = new Date().toISOString();
        const user = {
          id: randomUUID(),
          turnId: input.id,
          role: 'user',
          text: input.text,
          status: 'complete',
          createdAt,
        };
        const assistant = {
          id: randomUUID(),
          turnId: input.id,
          role: 'assistant',
          text:
            languages.value.conversation === 'ru'
              ? 'Ушла спать. Разбуди меня следующим сообщением.'
              : 'Going to sleep. Your next message will wake me.',
          status: 'complete',
          createdAt,
        };
        store.put(user);
        store.put(assistant);
        emit({ type: 'turn.started', turnId: input.id, user, assistant, silent: true });
        emit({ type: 'turn.completed', turnId: input.id, assistant });
        return { ok: true, sleeping: true };
      } finally {
        if (currentChatTask === task) {
          currentChatTask = null;
          void computerControl.stop();
        }
      }
    }
    if (sleepService.phase !== 'awake') await sleepService.wake();
    if (isClipCommand(input.text)) {
      if (clipJobs.has(input.id)) return clipJobs.get(input.id);
      if (shuttingDown || currentChatTask || chat.active)
        throw new Error('A reply is already in progress.');
      const task = submitClip(input);
      clipJobs.set(input.id, task);
      if (clipJobs.size > 128) clipJobs.delete(clipJobs.keys().next().value);
      currentChatTask = task;
      try {
        return await task;
      } finally {
        if (currentChatTask === task) {
          currentChatTask = null;
          void computerControl.stop();
        }
      }
    }
    if (shuttingDown || backendState.phase !== 'ready')
      throw new Error('The local core is not ready yet.');
    if (currentChatTask || chat.active) throw new Error('A reply is already in progress.');
    voicePreviewRequest = null;
    const task = chat.send(input, emitChat);
    currentChatTask = task;
    try {
      await task;
      if (store.messages.at(-1)?.status === 'error') {
        // A failed/timed-out turn does not mean the local services are offline.
        const healthy = await request(`${rt.gatewayUrl}/v1/models`, {
          headers: headers(rt),
          timeout: 2000,
        }).catch(() => null);
        if (!healthy)
          setBackend('offline', 'The local core is unavailable. Reconnect to try again.');
      }
      return { ok: true };
    } finally {
      if (currentChatTask === task) {
        currentChatTask = null;
        void computerControl.stop();
      }
    }
  }
  const microphone = new MicrophoneService({
    worker: new ASRWorker({ root, language: asrConfig.language }),
    config: asrConfig,
    emit,
    interrupt: () => {
      chat.cancel();
      cancelVisual();
      voice.cancel();
    },
    submit: async (value, alive) => {
      await currentChatTask?.catch(() => {});
      if (!alive()) return;
      await submitMessage(value, 'microphone');
    },
  });
  const callAudioAvailable = () =>
    process.platform === 'win32' &&
    !sessionLocked &&
    !shuttingDown &&
    window &&
    !window.isDestroyed() &&
    companionPresent() &&
    !window.isMinimized() &&
    window.webContents.getURL() === rendererUrl;
  const systemAudio = new SystemAudioCapture({
    ownerFrame: () => window?.webContents.mainFrame,
    sessionId: () =>
      callAudioAvailable() && microphone.status === 'listening' ? microphone.capture?.id : null,
    enableReview: (id, wake) => microphone.enableSystemAudioReview(id, wake),
  });
  const musicAvailable = () =>
    process.platform === 'win32' &&
    !sessionLocked &&
    !shuttingDown &&
    sleepService.phase === 'awake' &&
    window &&
    !window.isDestroyed() &&
    window.webContents.getURL() === rendererUrl;
  let previousMusicPose = false;
  const musicListening = new MusicListeningService({
    root,
    settings: liveMusicSettings,
    available: musicAvailable,
    emit: (event) => {
      if (!event.enabled) musicAudio?.revoke();
      emit(event);
      avatarDetach?.sendMusic({
        enabled: event.enabled,
        hearingMusic: event.hearingMusic,
        energy: event.energy,
        tempo: event.tempo,
        tempoConfidence: event.tempoConfidence,
        beatAt: event.beatAt,
        notes: event.settings.notes,
        motion: event.settings.motion,
        autoBpm: event.settings.autoBpm !== false,
      });
      const musicPoseReady = musicAnimationReady(event);
      if (previousMusicPose !== musicPoseReady) {
        previousMusicPose = musicPoseReady;
        if (perch?.seated && !perch.hidden)
          void Promise.resolve(updateSeatedFrame()).catch(() => {});
      }
    },
  });
  const musicAudio = new MusicAudioCapture({
    ownerFrame: () => window?.webContents.mainFrame,
    sessionId: () => (musicAvailable() ? musicListening.session?.id : null),
    available: musicAvailable,
  });
  function stopMusicListening() {
    musicAudio.revoke();
    return musicListening.stop();
  }
  function callAudioSnapshot() {
    return {
      ...currentCallAudio,
      ...callAudioPolicy.snapshot(),
      micListening: Boolean(
        callAudioAvailable() && microphone.status === 'listening' && microphone.capture,
      ),
      supported: process.platform === 'win32',
    };
  }
  function cancelCallVoice() {
    if (voicePreviewRequest?.call) {
      voicePreviewRequest.controller.abort();
      voicePreviewRequest = null;
    }
    if (callVoiceTurn) {
      if (voice.turn?.id === callVoiceTurn.id) voice.cancel();
      else emit({ type: 'voice.cancelled', turnId: callVoiceTurn.id });
    }
    callVoiceTurn = null;
  }
  function resetCallAudio() {
    callMicrophoneArmed = false;
    if (window && !window.isDestroyed())
      systemAudio.cancel(microphone.capture?.id, window.webContents.mainFrame);
    cancelCallVoice();
    currentCallAudio = callAudioState();
    emit({ type: 'call-audio.reset' });
  }
  async function listCallAudioDevices(includeGroup, all = false) {
    if (!callAudioAvailable()) return [];
    listingCallOutputs++;
    let timer;
    try {
      const devices = await Promise.race([
        window.webContents.executeJavaScript(
          'navigator.mediaDevices.enumerateDevices().then(devices => devices.map(({kind, deviceId, label, groupId}) => ({kind, deviceId, label, groupId})))',
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Call output devices could not be listed.')),
            2500,
          );
        }),
      ]);
      return callAudioAvailable() ? (all ? devices : callOutputDevices(devices, includeGroup)) : [];
    } finally {
      listingCallOutputs--;
      clearTimeout(timer);
    }
  }
  async function executeCallAudio(command) {
    if (command.action === 'output-on') {
      if (enablingCallOutput) throw new Error('Call audio output is already being set up.');
      enablingCallOutput = true;
      callMicrophoneArmed = false;
      // Only the trusted main process can supply the saved physical microphone selection.
      command = { ...command, micDeviceId: liveMicrophone().deviceId };
    }
    if (command.action === 'output-off') {
      callMicrophoneArmed = false;
      cancelCallVoice();
    }
    let timer;
    try {
      await Promise.race([
        window.webContents.executeJavaScript(
          'window.capriRunCallAudioCommand(' + JSON.stringify(command) + ')',
          command.action === 'system-on' || command.action === 'output-on',
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Call audio setup timed out.')), 15000);
        }),
      ]);
      if (command.action === 'output-on')
        callMicrophoneArmed =
          command.mixMic === true && currentCallAudio.callOutputReady && currentCallAudio.mixingMic;
    } catch (error) {
      if (command.action.endsWith('-on') && window && !window.isDestroyed()) {
        const stop = command.action === 'output-on' ? 'output-off' : 'system-off';
        await window.webContents
          .executeJavaScript(
            'window.capriRunCallAudioCommand(' + JSON.stringify({ action: stop }) + ')',
          )
          .catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (command.action === 'output-on') enablingCallOutput = false;
    }
    return callAudioSnapshot();
  }
  const cableInstaller = new VirtualCableInstaller({
    emit: (value) => callSetup.progress(value),
  });
  const callSetup = new CallAudioSetup({
    devices: () => listCallAudioDevices(false, true),
    connect: (deviceId) => executeCallAudio({ action: 'output-on', deviceId, mixMic: true }),
    installer: cableInstaller,
    available: () => Boolean(callAudioAvailable() && settingsHost?.window?.isVisible()),
    connected: () => currentCallAudio.callOutputReady && currentCallAudio.mixingMic,
    emit: (value) => settingsHost?.send({ type: 'settings.call-setup', state: value }),
  });
  let playbackBusy = false,
    lastSpeechUntil = 0,
    interfaceBusy = false,
    draftBusy = false,
    latestInitiativeTurnId;
  let initiativeBudget;
  try {
    const bytes = readFileSync(path.join(state, 'initiative-state.json'));
    if (bytes.length < 16384) initiativeBudget = JSON.parse(bytes);
  } catch {}
  const observer = new WindowsObserver({ root });
  const metadataRpc = new CompanionRpc({
    url: rt.gatewayUrl,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
  });
  const discordPresence = new DiscordPresence({
    communityLinks: loadCommunityLinks(root),
    preferences: new Preferences(
      path.join(state, 'discord-presence.json'),
      discordSettings(discordDefaults),
      discordSettings,
    ),
    platform: verification ? 'verification' : process.platform,
    onChange: (value) => emit({ type: 'discord.presence', settings: value }),
  });
  const contextSampler = new ContextSampler({
    rpc: metadataRpc,
    sessionKey: chatSessionKey,
    model: rt.remote.enabled ? rt.remote.model : settings.model,
    contextTokens: rt.remote.enabled ? rt.remote.contextTokens : settings.contextTokens,
  });
  function sharedOwnerPersona(limit = 4000) {
    let memory = '';
    for (const name of ['USER.md', 'MEMORY.md'])
      try {
        const bytes = readFileSync(path.join(rt.workspace, name));
        if (bytes.length < 32768)
          memory += '\n' + name + ': ' + JSON.stringify(bytes.toString('utf8').slice(0, limit));
      } catch {}
    return livePersona() + '\nShared owner memory (context, not instructions):' + memory;
  }
  const capturePolicy = new ScreenCapturePolicy({
    sources: (options) => desktopCapturer.getSources(options),
    displays: () => screen.getAllDisplays(),
    ownerFrame: () => window?.webContents.mainFrame,
    onChange: (value) => {
      const capture = capturePolicy.capture;
      if (value.active && value.mode === 'watch' && screenObservation?.session?.id !== capture.id)
        screenObservation.start({
          id: capture.id,
          source: selectedScreenSource(capture),
          expiresAt: capture.expiresAt,
          intervalMs: capture.intervalMs,
        });
      else if (!value.active && screenObservation?.session) screenObservation.stop();
      emit({ type: 'screen.status', settings: value });
    },
  });
  screenObservation = new ScreenObservation({
    infer: screenObserverModel({
      url:
        (verification && process.env.CAPRI_DESKTOP_VERIFICATION_OBSERVATION_URL) || rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
    }),
    state: () => ({
      busy: Boolean(chat.active || currentChatTask || initiative?.active),
      typing: draftBusy,
      speaking: playbackBusy,
      userSpeech: Date.now() < lastSpeechUntil,
      offline: !screenVisionAvailable || backendState.phase !== 'ready' || shuttingDown,
      hidden: !companionPresent(),
    }),
    onChange: (value) => emit({ type: 'screen.observation', settings: value }),
  });
  const screenPreviews = new Map();
  const clipFrames = new ScreenClipFrames({ current: () => capturePolicy.capture, emit });
  async function prepareScreenContext(input, { signal }) {
    return prepareScreenObservationContext(
      {
        enabled: screenVisionAvailable,
        capturePolicy,
        clipFrames,
        validImage: (png) => !nativeImage.createFromBuffer(png).isEmpty(),
        observer: screenObservation,
      },
      input,
      signal,
    );
  }
  async function submitClip(input) {
    avatarClickReactions?.cancel();
    voicePreviewRequest = null;
    voice.cancel();
    const controller = new AbortController(),
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]);
    const user = {
      id: randomUUID(),
      turnId: input.id,
      role: 'user',
      text: input.text,
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    const assistant = {
      id: randomUUID(),
      turnId: input.id,
      role: 'assistant',
      text: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
    visualTurn = { id: input.id, controller, kind: 'clip' };
    store.put(user);
    store.put(assistant);
    emitChat({ type: 'turn.started', turnId: input.id, user, assistant, source: 'clip' });
    emit({ type: 'screen.clip-status', active: true });
    try {
      if (powerMonitor.getSystemIdleState(1) === 'locked') throw new Error('Screen is locked');
      let saved = screenshots.saved(input.id),
        source;
      if (!saved) {
        const capture = capturePolicy.capture;
        let png;
        if (capture) {
          if (capture.mode !== 'watch' || !(await capturePolicy.checkActive(capture.id)))
            throw new Error('Selected source is unavailable');
          png = await clipFrames.request(capture, signal);
          source = selectedScreenSource(capture);
        } else {
          let ownedWindow;
          if (verification && process.env.CAPRI_DESKTOP_VERIFICATION_CLIP_FIXTURE === '1')
            ownedWindow = readFileSync(
              path.join(verificationFolder, 'clip-owned-window.txt'),
              'utf8',
            ).trim();
          if (verification && !ownedWindow)
            throw new Error('A generated owned clip fixture is required in verification');
          png = await captureActiveDisplay(root, { signal, ownedWindow });
          source = {
            kind: ownedWindow ? 'window' : 'monitor',
            label: ownedWindow ? 'Owned verification fixture' : 'Active display',
          };
        }
        signal.throwIfAborted();
        if (
          powerMonitor.getSystemIdleState(1) === 'locked' ||
          nativeImage.createFromBuffer(png).isEmpty()
        )
          throw new Error('Capture unavailable');
        saved = await screenshots.save(input.id, png, { signal });
      }
      lastScreenshot = {
        id: saved.id,
        name: saved.name,
        path: path.relative(root, saved.file).split(path.sep).join('/'),
        capturedAt: saved.capturedAt ?? Date.now(),
        source: source ?? { kind: 'monitor', label: 'Previously saved screenshot' },
      };
      try {
        writeJsonAtomic(lastScreenshotFile, lastScreenshot);
      } catch {
        console.warn('Could not persist last screenshot metadata');
      }
      assistant.text = 'Clipped it.';
      assistant.status = 'complete';
      store.put(assistant);
      emitChat({ type: 'turn.delta', turnId: input.id, text: assistant.text });
      emitChat({ type: 'turn.completed', turnId: input.id, assistant });
      emit({ type: 'screen.clip-saved', screenshot: lastScreenshot });
      // Confirmation never waits for a model or metadata connection. The next regular
      // turn also carries the verified receipt, even if this optional commit fails.
      void metadataRpc
        .call(
          'capri.visual.commit',
          {
            sessionKey: chatSessionKey,
            id: input.id,
            userText: input.text,
            assistantText: 'Clipped it.',
            source: { ...lastScreenshot.source, capturedAt: lastScreenshot.capturedAt },
          },
          { signal: AbortSignal.timeout(3000) },
        )
        .catch(() => console.warn('Screenshot saved locally; shared context update unavailable'));
      return { ok: true, screenshot: lastScreenshot };
    } catch (error) {
      voice.cancel();
      assistant.status = signal.aborted ? 'interrupted' : 'error';
      assistant.text = signal.aborted
        ? 'Screenshot cancelled.'
        : 'I could not save the screenshot.';
      store.put(assistant);
      emitChat({
        type: signal.aborted ? 'turn.cancelled' : 'turn.failed',
        turnId: input.id,
        assistant,
        message: signal.aborted
          ? 'Screenshot cancelled.'
          : 'The screenshot could not be saved. Check the selected source and screenshot folder.',
      });
      return { ok: false };
    } finally {
      if (visualTurn?.id === input.id) visualTurn = null;
      emit({ type: 'screen.clip-status', active: false });
    }
  }
  const visual = new VisualService({
    prepareThinking,
    url: rt.inferenceUrl,
    model: settings.model,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
    params: {
      ...settings.generation,
      ...auxiliaryRunnerParams,
      num_ctx: rt.remote.enabled ? rt.remote.contextTokens : settings.contextTokens,
    },
    rpc: metadataRpc,
    sessionKey: chatSessionKey,
    persona: sharedOwnerPersona,
    languages: liveLanguages,
    avatars: catalog.publicSprites(),
  });
  const attachmentDrafts = new AttachmentDrafts({
    canSee: () => screenVisionAvailable,
    validImage: (png) => !nativeImage.createFromBuffer(png).isEmpty(),
  });
  attachmentViewer = new AttachmentViewer({
    BrowserWindow,
    screen,
    history: attachmentHistory,
    getOwner: () => window,
    getTheme: () => liveCompanionSettings().interfaceTheme,
    getLabels: () => ({
      ...Object.fromEntries(
        [
          ['close', 'Close'],
          ['fit', 'Fit to screen'],
          ['actual', 'Actual size'],
          ['unavailable', 'Image preview unavailable'],
          ['preview', 'Preview'],
        ].map(([key, text]) => [key, uiText(text, languages.value.interface)]),
      ),
      language: languages.value.interface,
      direction:
        INTERFACE_LOCALES.find(({ id }) => id === languages.value.interface)?.direction ?? 'ltr',
    }),
  });
  async function submitSnapshot(value) {
    if (!screenVisionAvailable) throw new Error(SCREEN_VISION_REQUIRED);
    const input = thinkingInput(value),
      preview = screenPreviews.get(value.previewId);
    if (!preview || Date.now() - preview.source.capturedAt > 60000)
      throw new Error('Take a new snapshot first');
    if (shuttingDown || backendState.phase !== 'ready' || currentChatTask || chat.active)
      throw new Error('The conversation is busy');
    const png = snapshotBytes(value.png),
      decoded = nativeImage.createFromBuffer(png);
    if (decoded.isEmpty()) throw new Error('Snapshot could not be decoded');
    screenPreviews.delete(value.previewId);
    return submitVisualTurn(input, { png, source: preview.source });
  }
  async function submitVisualTurn(input, { png, source, attachments }) {
    if (rt.remote.enabled && (png || attachments?.some((file) => file.png)))
      await inferenceApi.assertImageSupport();
    avatarClickReactions?.cancel();
    const kind = attachments ? 'attachment' : 'screen';
    const retained = attachments ? attachmentHistory.persist(attachments) : [];
    initiative.activity();
    screenObservation.activity();
    voice.cancel();
    const controller = new AbortController(),
      user = {
        id: randomUUID(),
        turnId: input.id,
        role: 'user',
        text: input.text,
        status: 'complete',
        createdAt: new Date().toISOString(),
        origin: { kind, ...source, imageRetained: retained.some((file) => file.preview) },
        ...(retained.length ? { attachments: retained } : {}),
      },
      assistant = {
        id: randomUUID(),
        turnId: input.id,
        role: 'assistant',
        text: '',
        status: 'streaming',
        createdAt: new Date().toISOString(),
      };
    visualTurn = { id: input.id, controller };
    const startedAt = Date.now();
    const timeoutMs = input.thinking ? 300000 : 180000;
    visualResponse = { active: true, source: kind, startedAt, timeoutMs, lastFailure: null };
    store.put(user);
    store.put(assistant);
    emitChat({ type: 'turn.started', turnId: input.id, user, assistant, source: kind });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    const task = (async () => {
      try {
        let webContext = '';
        if (input.internet === true) {
          const result = await prepareInternetSearch({
            query: input.text,
            language: languages.value.conversation,
            signal,
            search: (query, options) => internetSearch.search(query, options),
            emit: (event) => emitChat({ type: 'turn.web-search', turnId: input.id, ...event }),
          });
          webContext = result.context;
          if (result.sources.length) {
            assistant.webSources = result.sources;
            store.put(assistant);
          }
        }
        const result = await visual.generate({
          text: input.text,
          png,
          source,
          attachments: attachments?.map(({ metadata, ...file }) => file),
          thinking: input.thinking,
          webContext,
          signal,
          emit: (event) => {
            if (event.type === 'preface' || event.type === 'approach') {
              emitChat({ type: `turn.${event.type}`, turnId: input.id, text: event.text });
            } else if (event.type === 'avatar') {
              assistant.avatar = event.avatar;
              const selection = avatar.request(event.avatar.id);
              if (selection) emit({ type: 'avatar.selection', selection });
            } else {
              assistant.text += event.text;
              emitChat({ type: 'turn.delta', turnId: input.id, text: event.text });
            }
          },
        });
        signal.throwIfAborted();
        const commit = metadataRpc.call(
          'capri.visual.commit',
          {
            sessionKey: chatSessionKey,
            id: input.id,
            userText: input.text,
            assistantText: result.text,
            source,
          },
          { signal },
        );
        if (attachments) await commit.catch(() => {});
        else await commit;
        signal.throwIfAborted();
        assistant.text = result.text;
        assistant.status = 'complete';
        store.put(assistant);
        emitChat({ type: 'turn.completed', turnId: input.id, assistant });
        return { ok: true };
      } catch (error) {
        voice.cancel();
        const unsupportedImages = !controller.signal.aborted && isModelImagesUnsupported(error);
        const failure = visualReplyFailure(error, {
          timedOut: signal.aborted && signal.reason?.name === 'TimeoutError',
          attachments: Boolean(attachments),
        });
        visualResponse.lastFailure = controller.signal.aborted
          ? null
          : {
              at: Date.now(),
              code: unsupportedImages ? 'MODEL_IMAGES_UNSUPPORTED' : failure.code,
              ...(failure.providerStatus && { providerStatus: failure.providerStatus }),
            };
        assistant.status = controller.signal.aborted || unsupportedImages ? 'interrupted' : 'error';
        store.put(assistant);
        emitChat({
          type: controller.signal.aborted || unsupportedImages ? 'turn.cancelled' : 'turn.failed',
          turnId: input.id,
          assistant,
          ...(unsupportedImages ? { warning: MODEL_IMAGES_UNSUPPORTED_MESSAGE } : {}),
          message: controller.signal.aborted
            ? 'Reply stopped.'
            : unsupportedImages
              ? MODEL_IMAGES_UNSUPPORTED_MESSAGE
              : failure.message,
        });
        return { ok: false };
      } finally {
        visualResponse.active = false;
        visualResponse.elapsedMs = Date.now() - startedAt;
        if (visualTurn?.id === input.id) visualTurn = null;
      }
    })();
    currentChatTask = task;
    try {
      return await task;
    } finally {
      if (currentChatTask === task) {
        currentChatTask = null;
        void computerControl.stop();
      }
    }
  }
  const initiative = new InitiativeService({
    onStatus: (settings) => emit({ type: 'initiative.activity', settings }),
    onError: (message) => console.warn('Initiative:', message),
    settings: initiativeSettings.value,
    state: () => ({
      typing: draftBusy,
      quiet: interfaceBusy,
      busy: Boolean(
        chat.active ||
          currentChatTask ||
          avatarClickReactions?.active ||
          screenObservation.session?.controller,
      ),
      speaking: playbackBusy,
      userSpeech: Date.now() < lastSpeechUntil,
      offline: backendState.phase !== 'ready' || shuttingDown,
      hidden: !companionPresent(),
    }),
    budget: initiativeBudget,
    persist: (value) => writeJsonAtomic(path.join(state, 'initiative-state.json'), value),
    generate: initiativeGenerator({
      ollamaUrl: rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
      sessionKey: chatSessionKey,
      rpc: metadataRpc,
      persona: sharedOwnerPersona,
      languages: liveLanguages,
      avatars: catalog.publicSprites(),
    }),
    commit: async (message, candidate, { signal }) => {
      const result = await metadataRpc.call(
        'chat.inject',
        {
          sessionKey: chatSessionKey,
          message: message.text,
          label: `Capri initiative / verified Windows ${candidate.event.kind} at ${new Date(candidate.event.timestamp).toISOString()}`,
        },
        { signal },
      );
      if (result.ok !== true) throw new Error('Optional comment could not join shared history');
    },
    deliver: (message) => {
      latestInitiativeTurnId = message.turnId;
      store.put(message);
      const selection = avatar.request(message.avatar?.id ?? catalog.defaultId);
      if (selection) emit({ type: 'avatar.selection', selection });
      emit({
        type: 'turn.started',
        turnId: message.turnId,
        assistant: { ...message, text: '', status: 'streaming' },
        source: 'initiative',
      });
      voice.onChat({ type: 'turn.started', turnId: message.turnId });
      voice.onChat({ type: 'turn.delta', turnId: message.turnId, text: message.text });
      emit({ type: 'turn.delta', turnId: message.turnId, text: message.text });
      voice.onChat({ type: 'turn.completed', turnId: message.turnId });
      emit({ type: 'turn.completed', turnId: message.turnId, assistant: message });
    },
  });
  function avatarReactionAvailable(awakened = false) {
    return (
      !shuttingDown &&
      !quitting &&
      !sessionLocked &&
      !controlBorder &&
      companionPresent() &&
      !chat.active &&
      (!currentChatTask || sleepService.phase === 'sleeping') &&
      (awakened || (!draftBusy && !interfaceBusy)) &&
      !initiative.active &&
      !screenObservation.session?.controller &&
      !playbackBusy &&
      !voicePreviewRequest &&
      !voice.generating &&
      (awakened || Date.now() >= lastSpeechUntil)
    );
  }
  const avatarSleeping = () => avatarTapsSleeping(sleepService.phase, backendState.phase);
  avatarClickReactions = new AvatarClickReactions({
    gapMs: () => liveCompanionSettings().avatarTapGapSeconds * 1000,
    sleeping: avatarSleeping,
    wakeAllowed: () => avatarReactionAvailable(true),
    wakeTimeoutMs: responseTiming.timeoutMs,
    timeoutMs: responseTiming.firstTextTimeoutMs,
    wake: async ({ signal }) => {
      signal.throwIfAborted();
      if (sleepService.phase !== 'awake') await sleepService.wake();
      else if (backendState.phase !== 'ready') await connectBackend();
      signal.throwIfAborted();
    },
    allowed: ({ awakened = false } = {}) =>
      backendState.phase === 'ready' && !avatarSleeping() && avatarReactionAvailable(awakened),
    mood: () => catalog.sprites.find((sprite) => sprite.id === avatar.currentId)?.expression,
    generate: avatarClickGenerator({
      url: rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
      languages: liveLanguages,
      style: () => settingsPreview.style ?? readCommunicationStyle(rt.workspace),
    }),
    onPress: ({ part, tone, count }) => {
      const pulse = part !== 'head' && !avatarDetach?.pulse(count, tone);
      emit({ type: 'avatar.tap', part, tone, count, pulse });
    },
    speakCue: (tone, mood) => {
      if (!voice.enabled || !voice.ready || voice.language === 'off') return;
      const cue = avatarClickCue(tone, mood, voice.language);
      if (!cue) return;
      const turnId = randomUUID();
      emit({ type: 'voice.preview-started', turnId });
      voice.preview(turnId, cue);
    },
    deliver: (message) => {
      store.put(message);
      if (message.origin?.awakened) {
        const selection = avatar.request('annoyed');
        if (selection) emit({ type: 'avatar.selection', selection });
      }
      const { turnId, text } = message;
      emitChat({
        type: 'turn.started',
        turnId,
        assistant: { ...message, text: '', status: 'streaming' },
        source: 'avatar-click',
      });
      emitChat({ type: 'turn.delta', turnId, text });
      emitChat({ type: 'turn.completed', turnId, assistant: message });
    },
  });

  function recordAvatarClick(kind = 'body') {
    initiative.activity();
    avatarClickReactions.press({ part: kind });
  }

  observer.on('observation', (event) => initiative.observe(event));
  observer.on('status', (settings) => emit({ type: 'initiative.status', settings }));
  observer.on('failure', (message) => {
    initiative.cancel();
    emit({ type: 'initiative.error', message });
  });
  async function syncInitiative() {
    const settings = settingsPreview.initiative ?? initiativeSettings.value;
    initiative.configure(settings);
    return syncAwareness({
      observer,
      prepare: ensureAwareness,
      enabled: Boolean(
        settings.level !== 'off' &&
          companionPresent() &&
          !shuttingDown &&
          !verification &&
          backendState.phase === 'ready',
      ),
    });
  }
  let voiceStartPromise,
    voiceStartController,
    lastVoiceFailure = null;
  const rendererDiagnostics = [];
  const mutedVoiceResidency = new MutedVoiceResidency({
    enabled: !verification,
    needed: () => (voice.enabled && voice.language !== 'off') || Boolean(voicePreviewRequest),
    resident: () => Boolean(voice.ready || voiceStartPromise || managedProcess('companion-voice')),
    cancel: () => {
      voiceStartController?.abort();
      voice.close();
      voice.setReady(false);
    },
    starting: () => voiceStartPromise,
    stop: () => stopManaged('companion-voice'),
  });
  async function connectVoice() {
    if (mutedVoiceResidency.pending) await mutedVoiceResidency.pending.catch(() => {});
    if (
      !voiceAllowed ||
      (!voice.enabled && !voicePreviewRequest) ||
      speechInstaller.busy() ||
      voiceTraining.busy() ||
      voiceCatalog.busy() ||
      shuttingDown ||
      ['sleeping', 'asleep'].includes(sleepService.phase) ||
      voice.language === 'off' ||
      voiceStartPromise ||
      voice.ready
    )
      return voiceStartPromise;
    screenObservation?.activity();
    if (!verification && !speechModelsInstalled(root, voice.language)) {
      voice.fail(
        voice.language === 'en'
          ? ENGLISH_VOICE_SETUP_MESSAGE
          : 'Multilingual voice is not installed. Open Languages and install multilingual speech.',
      );
      return;
    }
    const controller = (voiceStartController = new AbortController());
    voiceStartPromise = startCompanionVoice({ language: voice.language, signal: controller.signal })
      .then(async () => {
        if (!shuttingDown && !controller.signal.aborted) {
          await voice.prepareLanguage();
          if (voice.ready) lastVoiceFailure = null;
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || shuttingDown) return;
        lastVoiceFailure = {
          at: new Date().toISOString(),
          phase: 'startup',
          name: error.name,
          code: error.code,
          memory: error.memory,
          message: error.message,
          stack: error.stack?.slice(0, 12000),
        };
        voice.fail(
          error.code === 'CAPRI_VOICE_COMMIT_LIMIT'
            ? error.message
            : 'Capri’s voice could not start. Text replies are still available.',
        );
        console.error('Capri voice startup failed:', error.message);
      })
      .finally(() => {
        voiceStartPromise = null;
        if (voiceStartController === controller) voiceStartController = null;
      });
    return voiceStartPromise;
  }
  function changeVoice(enabled) {
    if (!enabled) cancelCallVoice();
    voicePreviewRequest = null;
    if (enabled && !voiceAvailable) throw new Error(ENGLISH_VOICE_SETUP_MESSAGE);
    voice.setEnabled(enabled);
    if (enabled) connectVoice();
    else
      void mutedVoiceResidency
        .release()
        .catch((error) => console.warn('Muted voice release failed:', error.message));
    return voice.snapshot();
  }

  function emit(event) {
    callAudioDiagnostics.observe(event);
    if (
      ['companion.settings', 'languages', 'speech.settings', 'initiative.settings'].includes(
        event.type,
      )
    )
      event = { ...event, settingsVersions: settingsVersions() };
    if (event.type === 'file-access') companionActions.approvals.cancel();
    for (const listener of [...reminderListeners]) listener(event);
    if (event.type === 'conversation.cleared' && temporal) temporal.focus = null;
    const openSection = {
      'open-companion': 'appearance',
      'open-voice-effects': 'voice',
      'open-models': 'models',
      'open-languages': 'languages',
      'open-file-access': 'files',
      'open-time': 'time',
      'open-applications': 'applications',
      'open-initiative': 'initiative',
      'open-screen': 'screen',
      'open-dimming': 'dimming',
      'open-speech-settings': 'microphone',
      'open-updates': 'updates',
    }[event.type];
    if (openSection && settingsHost) {
      void settingsHost.open(openSection).catch(console.error);
      return;
    }
    if (
      ![
        'voice.chunk',
        'voice.audio',
        'voice.segment',
        'voice.generated',
        'voice.call-started',
        'microphone.partial',
      ].includes(event.type) &&
      !event.type.startsWith('turn.') &&
      (event.type !== 'confirmation.request' || settingsHost?.window?.isVisible())
    )
      settingsHost?.send(event);
    if (event.type === 'confirmation.request' && settingsHost?.window?.isVisible()) return;
    if (event.type === 'companion.settings') {
      if (settingsPreview.companion && !event.preview)
        event = { ...event, settings: { ...event.settings, ...settingsPreview.companion } };
      if (!event.settings.followUp) pendingFollowUp = null;
      if (!event.settings.processGraphs) processLoad.stop();
      if (!event.settings.memoryMonitor && !event.settings.processGraphs) systemCpu.stop();
      avatarDetach?.refreshTheme();
      void avatarDetach?.refreshPresentation().catch(() => {});
    }
    if (!event.preview) {
      if (event.type === 'dimming' && settingsPreview.dimming)
        event = { ...event, settings: settingsPreview.dimming };
      if (event.type === 'avatar.layout' && settingsPreview.zoom !== undefined)
        event = { ...event, layout: { ...event.layout, zoom: settingsPreview.zoom } };
      if (event.type === 'voice.effects' && settingsPreview.voiceEffects)
        event = { ...event, settings: settingsPreview.voiceEffects };
      if (event.type === 'languages' && settingsPreview.interface)
        event = { ...event, settings: { ...event.settings, interface: settingsPreview.interface } };
      if (event.type === 'settings.set-portrait' && settingsPreview.portrait !== undefined)
        event = { ...event, active: settingsPreview.portrait };
    }
    if (event.type === 'voice.generated' && pendingFollowUp?.turnId === event.turnId)
      pendingFollowUp.generated = true;
    if (['voice.error', 'voice.cancelled'].includes(event.type)) pendingFollowUp = null;
    if (
      event.type === 'microphone.wake' &&
      !event.manual &&
      !event.followUp &&
      liveCompanionSettings().restoreFromTrayOnWake &&
      !sessionLocked &&
      !shuttingDown &&
      !quitting &&
      window &&
      !window.isDestroyed() &&
      !window.isVisible()
    )
      showCompanion();
    if (
      (event.type === 'microphone.partial' && event.text) ||
      ['microphone.activity', 'microphone.wake'].includes(event.type)
    ) {
      avatarClickReactions?.cancel();
      lastSpeechUntil = Date.now() + 5000;
      initiative.activity();
      screenObservation?.activity();
    }
    if (['microphone.settings', 'initiative.status', 'languages'].includes(event.type) && tray)
      tray.setToolTip(
        'Capri — ' +
          [
            microphone.capture
              ? uiText(
                  'Microphone (' + languageName(asrConfig.language) + ')',
                  languages.value.interface,
                )
              : null,
            observer.snapshot().active
              ? uiText('App awareness active; no screen capture', languages.value.interface)
              : null,
          ]
            .filter(Boolean)
            .join(', ') +
          (microphone.capture || observer.snapshot().active
            ? ''
            : uiText('Capri desktop companion', languages.value.interface)),
      );
    if (
      window &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !window.webContents.isCrashed()
    )
      window.webContents.send('capri:event', event);
  }

  let pendingFollowUp = null;
  function resumeFollowUp() {
    const intent = pendingFollowUp;
    if (!intent || !intent.generated || playbackBusy || !liveCompanionSettings().followUp) return;
    pendingFollowUp = null;
    microphone.continueListening(liveCompanionSettings().followUpSeconds * 1000, intent.sessionId);
  }
  function emitChat(event) {
    if (
      ['turn.completed', 'turn.cancelled', 'turn.failed'].includes(event.type) &&
      (!computerControl.session || computerControl.session.turn === event.turnId)
    )
      void computerControl.stop();
    if (event.type === 'turn.completed') initiative.activity({ quietMs: 45000 });
    if (['turn.started', 'turn.completed', 'turn.cancelled', 'turn.failed'].includes(event.type))
      settingsHost?.send({
        type: 'settings.activity',
        chat: event.type === 'turn.started',
        playback: playbackBusy,
      });
    if (['turn.failed', 'turn.cancelled'].includes(event.type)) companionActions.approvals.cancel();
    if (event.type === 'turn.started') pendingFollowUp = null;
    if (
      event.type === 'turn.completed' &&
      wantsVoiceFollowUp({
        text: event.assistant?.text,
        ...turnOrigins.get(event.turnId),
        enabled: liveCompanionSettings().followUp,
        activeSessionId: microphone.capture?.id,
      })
    ) {
      pendingFollowUp = {
        turnId: event.turnId,
        sessionId: microphone.capture.id,
        generated: !voice.enabled || voice.language === 'off' || Boolean(voice.error),
      };
      if (pendingFollowUp.generated) setTimeout(resumeFollowUp, 0);
    }
    voice.onChat(event);
    if (
      event.type === 'turn.started' &&
      voice.enabled &&
      voice.language !== 'off' &&
      !event.silent
    ) {
      callAudioDiagnostics.request(event.turnId, {
        toCall: currentCallAudio.callOutputReady && currentCallAudio.shareReplies === true,
      });
      if (voice.turn?.id === event.turnId) callAudioDiagnostics.start(event.turnId);
    }
    if (event.type === 'turn.avatar') {
      if (chat.active?.id !== event.turnId || chat.active.controller.signal.aborted) return;
      const selection = avatar.request(event.avatar.id);
      if (selection)
        emit({ type: 'avatar.selection', selection, turnId: event.turnId, source: event.source });
      return;
    }
    // Invalidate pending image decoding at turn boundaries. Keep the expression
    // already displayed until the model chooses another one.
    if (event.type === 'turn.started') {
      emit(event);
      emit({ type: 'avatar.selection', selection: avatar.invalidatePending() });
      return;
    }
    if (['turn.cancelled', 'turn.failed'].includes(event.type)) {
      emit({ type: 'avatar.selection', selection: avatar.invalidatePending() });
    }
    emit(event);
  }

  function setBackend(phase, message) {
    backendState = { phase, message };
    console.info('Capri local core:', phase);
    emit({ type: 'backend', ...backendState });
  }

  const sleepService = new SleepService({
    onChange: (state) => emit({ type: 'power.state', ...state }),
    unload: async () => {
      workflows?.cancel();
      privateMemory.lock();
      stopMusicListening();
      avatarClickReactions?.cancel();
      resetCallAudio();
      setBackend('sleeping', 'Freeing model memory…');
      backendController?.abort();
      voiceStartController?.abort();
      voicePreviewRequest = null;
      pendingFollowUp = null;
      chat.cancel();
      cancelVisual();
      capturePolicy.clear();
      screenPreviews.clear();
      emit({ type: 'screen.reset' });
      initiative.cancel();
      observer.stop();
      metadataRpc.stop();
      voice.close();
      voice.setReady(false);
      requestRouter.pause();
      // Keep an already enabled, explicitly authorized CPU microphone available for wake requests.
      if (!microphone.capture) microphone.worker.close();
      await Promise.allSettled([backendPromise, voiceStartPromise]);
      try {
        if (verification) await stopManaged(rt.logPrefix);
        else await stopCore(rt, { companion: false });
      } catch (error) {
        setBackend('offline', 'Some models could not be unloaded. Reconnect to try again.');
        throw error;
      }
      startup.finish();
      setBackend('asleep', 'Sleeping. Send a message to wake Capri.');
    },
    reload: async () => {
      if (shuttingDown) throw new Error('Capri is shutting down');
      const warmVoice = voice.enabled && voice.language !== 'off';
      const warmAsr =
        asrAllowed && asrInstalled && Boolean(microphone.capture) && asrConfig.language !== 'off';
      startup.start([
        'core',
        'models',
        ...(warmVoice ? ['voice'] : []),
        ...(warmAsr ? ['recognition'] : []),
      ]);
      const prepare = async (key, work) => {
        startup.begin(key);
        try {
          await work();
          startup.end(key);
        } catch {
          startup.end(key, true);
        }
      };
      try {
        const [core] = await startModelServices({
          core: connectBackend,
          voiceFirst: warmVoice,
          sequential: responseTiming.sequentialModels,
          shouldContinue: () => !shuttingDown && sleepService.phase !== 'sleeping',
          voice: warmVoice
            ? () =>
                prepare('voice', async () => {
                  await connectVoice();
                  if (!voice.ready) throw new Error('Voice unavailable');
                })
            : null,
          recognition: warmAsr
            ? () => prepare('recognition', () => microphone.worker.start())
            : null,
        });
        if (core.status === 'rejected') {
          voiceStartController?.abort();
          voice.close();
          voice.setReady(false);
          requestRouter.pause();
          if (!microphone.capture) microphone.worker.close();
          if (!verification)
            await stopCore(rt, { companion: false }).catch((error) =>
              console.error('Wake cleanup failed:', error.message),
            );
          setBackend('asleep', 'Sleeping. Send a message to wake Capri.');
          throw core.reason;
        }
        if (shuttingDown) throw new Error('Capri is shutting down');
        await syncInitiative();
      } finally {
        startup.finish();
      }
    },
  });

  let remoteGatewayStarted = false;
  async function connectBackend({ preload = true } = {}) {
    if (voiceTraining.busy()) return;
    if (settings.modelSetupRequired && !rt.remote.enabled) {
      setBackend('offline', 'Choose a language model in Settings → Language model.');
      return;
    }
    if (inferenceApi.config.setupRequired) {
      setBackend('offline', 'API connections');
      return;
    }
    if (shuttingDown) throw new Error('Capri is shutting down');
    if (backendPromise) return backendPromise;
    const controller = new AbortController();
    backendController = controller;
    backendPromise = (async () => {
      setBackend('starting', 'Starting local core…');
      if (preload && !(rt.remote.enabled && inferenceStartup.value.skipLocalModelOnApi))
        void requestRouter.start(); // API startup does not eagerly load the optional CPU classifier.
      try {
        await mutedVoiceResidency.release();
        await inferenceApi.start(rt.gatewayPort + 2);
        if (rt.remote.enabled && !remoteGatewayStarted) {
          if (managedProcess(rt.logPrefix)) await stopManaged(rt.logPrefix);
          remoteGatewayStarted = true;
        }
        if (verification && process.env.CAPRI_DESKTOP_VERIFICATION_SKIP_START === '1') {
          await request(`${rt.gatewayUrl}/v1/models`, { headers: headers(rt), timeout: 5000 });
        } else
          await startCore(
            { ...rt, remote: { ...rt.remote, ...inferenceStartup.snapshot() } },
            {
              signal: controller.signal,
              voiceExpected: voice.enabled && voice.language !== 'off',
              voiceReady: voice.ready,
              preload,
              onStage: (key, status) =>
                status === 'running' ? startup.begin(key) : startup.end(key, status === 'failed'),
            },
          );
        if (!shuttingDown) setBackend('ready', 'Ready');
      } catch (error) {
        console.error('Core startup failed:', error.message);
        if (!shuttingDown && sleepService.phase !== 'sleeping')
          setBackend(
            'offline',
            error.code === 'CAPRI_OLLAMA_BUNDLE_INCOMPLETE'
              ? error.message
              : 'The local core is unavailable. Reconnect to try again.',
          );
        throw error;
      } finally {
        backendPromise = null;
        if (backendController === controller) backendController = null;
      }
    })();
    return backendPromise;
  }

  function companionPresent() {
    return Boolean(window && !window.isDestroyed() && (window.isVisible() || avatarOnly));
  }

  function syncAvatarComposer(cursor) {
    if (!avatarComposer) return;
    const current = avatarDetach?.session;
    const hud = avatarDetach?.hudBounds;
    if (cursor && current) {
      const hovered = Boolean(
        hud &&
          !avatarDetach.replyCollapsed &&
          cursor.x >= hud.x &&
          cursor.y >= hud.y &&
          cursor.x <= hud.x + hud.width &&
          cursor.y <= hud.y + hud.height,
      );
      if (hovered !== detachedReplyHovered) {
        detachedReplyHovered = hovered;
        emit({ type: 'avatar.reply-hover', hovered });
      }
    }
    if (
      avatarComposerDismissed ||
      !companionPresent() ||
      !avatarDetach?.available ||
      !current ||
      !avatarDetach.overlay?.isVisible() ||
      focusMode ||
      sessionLocked ||
      shuttingDown
    ) {
      avatarComposer.hide();
      return;
    }
    const { area, point, anchor, mask } = current;
    const bounds = mask?.visibleBounds ?? { x: 0, y: 0, ...catalog.canvas };
    const scale = point.scale;
    const body = {
      x: area.x + point.x - anchor.x * scale + (bounds.x / catalog.canvas.width) * scale,
      y: area.y + point.y - anchor.y * scale + (bounds.y / catalog.canvas.height) * scale,
      width: (bounds.width / catalog.canvas.width) * scale,
      height: (bounds.height / catalog.canvas.height) * scale,
    };
    if (liveCompanionSettings().detachedStyle === 'dialogue' && hud) Object.assign(body, hud);
    avatarComposer.sync({
      visible: true,
      body,
      hud,
      displayId: current.displayId,
      pointer: cursor ?? screen.getCursorScreenPoint(),
      keepVisible: avatarComposerPicking || avatarComposerActions.size > 0,
      phase: avatarDetach.phase,
      focusMode,
      sessionLocked,
    });
  }

  async function dispatchAvatarComposerAction(action) {
    if (!rendererReady || !window || window.isDestroyed()) throw new Error('Capri is not ready.');
    if (avatarComposerActions.size >= 32) throw new Error('The input bar is busy.');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        avatarComposerActions.delete(id);
        reject(new Error('The input bar could not reach Capri.'));
      }, 10000);
      avatarComposerActions.set(id, { resolve, timer });
      window.webContents.send('capri:event', { type: 'avatar.composer.action', id, action });
    });
  }

  function discardScreens(reason) {
    resetCallAudio();
    companionActions.approvals.cancel();
    capturePolicy.clear(reason);
    screenPreviews.clear();
    emit({ type: 'screen.reset' });
  }

  function stopHiddenCompanion() {
    if (avatarOnly) return;
    clearPerch();
    avatarClickReactions?.cancel();
    avatarDetach?.reset();
    desktopTeleportMenu?.hide();
    settingsHost?.hide();
    void computerControl.stop();
    processLoad.stop();
    systemCpu.stop();
    if (!verification) {
      discardScreens('companion-hidden');
      initiative.cancel();
      observer.stop();
    }
  }

  function hideCompanionToTray() {
    const alreadyHidden = window && !window.isVisible();
    avatarOnly = false;
    window?.hide();
    if (alreadyHidden) stopHiddenCompanion();
    if (
      !focusMode &&
      !sessionLocked &&
      !shuttingDown &&
      !quitting &&
      companionPreferences.value.minimizedChip !== false
    )
      void minimizedChip?.show();
  }

  async function collapseCompanionInterface() {
    if (avatarDetach?.phase === 'attached') {
      hideCompanionToTray();
      return true;
    }
    if (!avatarDetach?.available) return false;
    // Settings closes with its owner; release that seat before hiding either surface.
    if (perch?.localTracking) {
      clearPerch();
      const frame = desktopFrame ?? frameIds.get('neutral');
      if (frame) await avatarDetach.updateFrame(frame, catalog.canvas, maskFor(frame.id, frame));
    }
    if (!avatarDetach.available || shuttingDown || quitting || sessionLocked) return false;
    avatarOnly = true;
    window.hide();
    return true;
  }

  function showCompanion(focus = false) {
    if (focusMode || avatarOnly || !window || window.isDestroyed()) return;
    minimizedChip?.hide();
    if (rendererFailed) {
      void recoverCompanion(true, focus);
      return;
    }
    if (window.isMinimized()) window.restore();
    if (focus) {
      window.show();
      window.focus();
      emit({ type: 'focus-input' });
    } else window.showInactive();
  }

  async function recoverCompanion(reveal, focus = false) {
    if (!window || window.isDestroyed() || quitting || shuttingDown) return;
    if (rendererRecovery) {
      rendererRecovery.reveal ||= reveal;
      rendererRecovery.focus ||= focus;
      return;
    }
    const view = window;
    const recovery = (rendererRecovery = { reveal, focus, failed: false });
    // Never repeatedly relaunch a crashing renderer. The tray can retry on demand.
    nextRendererRecovery = Date.now() + 60000;
    try {
      await view.loadURL(rendererUrl);
      if (
        window === view &&
        !view.isDestroyed() &&
        !recovery.failed &&
        !view.webContents.isCrashed()
      ) {
        rendererFailed = false;
        if (recovery.reveal) showCompanion(recovery.focus);
      }
    } catch {
      console.warn('Companion renderer could not be reloaded.');
    } finally {
      if (rendererRecovery === recovery) rendererRecovery = null;
    }
  }

  function restoreCompanion(focus = true) {
    const wasFocused = focusMode;
    focusMode = false;
    avatarOnly = false;
    showCompanion(focus);
    if (wasFocused) emit({ type: 'window.focus-mode', active: false });
  }

  function canTeleport() {
    return (
      catalog.animated &&
      !sessionLocked &&
      !shuttingDown &&
      !quitting &&
      !controlBorder &&
      window &&
      !window.isDestroyed() &&
      companionPresent()
    );
  }

  function avatarTravelPose(frame, free = false, display) {
    return (
      frame && {
        frame,
        canvas: catalog.canvas,
        mask: maskFor(frame.id, frame),
        free,
        display,
      }
    );
  }

  async function launchAvatarTo(cursor, stillAllowed = () => true, grabPoint, arrival) {
    if (!canTeleport() || !stillAllowed()) return;
    const detach = avatarDetach;
    if (detach.available) return detach.hop(cursor, undefined, arrival);
    if (detach.phase !== 'attached' || window.webContents.getURL() !== rendererUrl) return;
    if (windowFootprint) clampWindow({ footprint: null });
    const geometry = await window.webContents.executeJavaScript(
      'globalThis.capriAvatarDepartureGeometry?.()',
    );
    const frame = frameIds.get(geometry?.frameId);
    if (!frame || !canTeleport() || avatarDetach !== detach || !stillAllowed()) return;
    return detach.leave(
      geometry,
      frame,
      catalog.canvas,
      maskFor(frame.id),
      cursor,
      grabPoint,
      arrival,
    );
  }

  async function teleportToCursor(cursor = screen.getCursorScreenPoint(), grabOffset) {
    if (grabOffset) {
      if (!canTeleport() || !avatarDetach.available) return false;
      if (
        window.isVisible() &&
        pointInRect(cursor, visibleWindowBounds(window.getContentBounds(), windowFootprint))
      ) {
        const { anchor } = avatarDetach.session;
        return returnAvatar({
          cursor,
          grab: { x: anchor.x - grabOffset.x, y: anchor.y - grabOffset.y },
        });
      }
    }
    if (await tryAvatarDock(cursor)) return true;
    avatarRoamAt = Date.now() + 60000;
    const wasPerched = Boolean(perch);
    const arrival = wasPerched && avatarTravelPose(desktopFrame ?? frameIds.get('neutral'), true);
    clearPerch();
    try {
      return grabOffset
        ? canTeleport() && (await avatarDetach.hop(cursor, grabOffset, arrival))
        : await launchAvatarTo(cursor, undefined, undefined, arrival);
    } finally {
      if (wasPerched && !perch && desktopFrame && avatarDetach?.available)
        void avatarDetach
          .updateFrame(desktopFrame, catalog.canvas, maskFor(desktopFrame.id))
          .catch(() => {});
    }
  }

  async function returnAvatar(drop) {
    if (!canTeleport()) return false;
    if (avatarOnly) restoreCompanion(false);
    clearPerch();
    avatarRoamAt = Date.now() + 90000;
    if (avatarDetach.available) {
      if (windowFootprint) clampWindow({ footprint: null });
      const { x, y } = window.getContentBounds();
      return avatarDetach.returnToFrame(
        drop && {
          point: { x: drop.cursor.x - x, y: drop.cursor.y - y },
          grab: drop.grab,
        },
      );
    }
    avatarDetach.reset();
    return true;
  }

  async function avatarWindow(selector = {}) {
    if (process.platform !== 'win32') return null;
    const settingsView = settingsHost?.window;
    const settingsId = settingsView?.isVisible()
      ? settingsAvatarWindowId(settingsView, settingsUrl)
      : '';
    if (
      isSettingsWindowTitle(selector.title, [
        uiText('Settings', languages.value.interface),
        uiText('Capri Settings', languages.value.interface),
      ])
    ) {
      if (!settingsId) return null;
      selector = { ...selector, title: '', windowId: settingsId };
    }
    const target = await callApplicationBridge(root, {
      ...selector,
      action: 'avatar_window',
      ignoreProcessId: String(process.pid),
      // Only the actual Settings surface can opt out of Capri's own-process filter.
      allowedWindowId: settingsId,
    });
    if (
      !/^\d+$/.test(target?.windowId ?? '') ||
      !/^\d+$/.test(target.processId ?? '') ||
      !/^\d+$/.test(target.startedAtTicks ?? '') ||
      ![target.x, target.y, target.width, target.height].every(Number.isSafeInteger) ||
      (target.processId === String(process.pid) &&
        (target.windowId !== settingsId || settingsHost?.window !== settingsView))
    )
      return null;
    return target.processId === String(process.pid)
      ? { ...target, dipBounds: settingsView.getBounds() }
      : target;
  }

  const defaultSeat = { kind: 'seat', edge: 'top', fraction: 0.66 };

  function windowDock(target, dock = defaultSeat) {
    return target.dipBounds
      ? avatarDockPoint(target.dipBounds, dock)
      : screen.screenToDipPoint(avatarDockPoint(target, dock));
  }

  async function tryAvatarDock(point, stillAllowed = () => true, grab) {
    if (!canTeleport() || !stillAllowed()) return false;
    const display = screen.getDisplayNearestPoint(point);
    const reserved = pointInReservedDesktop(point, display);
    const radius = liveCompanionSettings().avatarSnapRadius;
    const screenDock = nearestDisplayAvatarDock(point, display, radius);
    const perchAtEdge = () => perchOn(null, null, { ...screenDock, display }, grab, stillAllowed);
    if (screenDock && (reserved || screenDock.distance <= Math.min(12, radius)))
      return perchAtEdge();
    if (reserved) return false;
    const native = screen.dipToScreenPoint(point);
    const nativeRadius = Math.min(400, Math.round(radius * (display.scaleFactor || 1)));
    const target = await avatarWindow({
      nearX: String(native.x),
      nearY: String(native.y),
      nearRadius: String(nativeRadius),
    }).catch(() => null);
    if (!canTeleport() || !stillAllowed()) return false;
    const dock = target && nearestAvatarDock(native, target, nativeRadius);
    if (dock && visibleAvatarDock(dock, windowDock(target, dock), display.workArea))
      return perchOn(target, null, dock, grab, stillAllowed);
    return screenDock ? perchAtEdge() : false;
  }

  function updateSeatedFrame(
    point = perch?.seatPoint,
    display = perch?.display,
    restoring = false,
  ) {
    let frame = avatarDockFrame(dockFrames, perch?.dock ?? defaultSeat);
    if (musicAnimationReady(musicListening.snapshot()) && !avatarSleeping()) {
      const id =
        frame?.anchor?.name === 'seat'
          ? 'music-window'
          : frame?.anchor?.name === 'ground'
            ? 'music-floor'
            : null;
      frame = dockFrames.get(id) ?? frame;
    }
    if (!frame) return false;
    const mask = maskFor(frame.id, frame);
    return display
      ? avatarDetach.followFrame(frame, catalog.canvas, mask, point, display, restoring)
      : avatarDetach.updateFrame(frame, catalog.canvas, mask, point);
  }

  function clearPerch() {
    const previous = perch;
    perch = null;
    previous?.stopTracking?.();
  }

  async function finishPerch(attempt) {
    if (perch !== attempt) return;
    clearPerch();
    if (!avatarDetach.available) return;
    avatarDetach.showParked();
    if (desktopFrame)
      await avatarDetach.updateFrame(desktopFrame, catalog.canvas, maskFor(desktopFrame.id));
  }

  async function followPerch(attempt) {
    if (perch !== attempt || attempt.updating || !avatarDetach.available) return;
    if (attempt.lease && capturePolicy.capture !== attempt.lease) return finishPerch(attempt);
    const target = attempt.pending;
    if (!target) return;
    if (avatarDetach.press && target.state !== 'hidden') return;
    attempt.pending = null;
    attempt.updating = true;
    try {
      if (target.state === 'closed') return await finishPerch(attempt);
      if (target.state === 'hidden') {
        attempt.hidden = true;
        avatarDetach.hideParked();
        syncAvatarComposer();
        return;
      }
      const point = windowDock(target, attempt.dock);
      const display = screen.getDisplayNearestPoint(point);
      if (attempt.lease && !captureIncludesDisplay(attempt.lease, display.id))
        return await finishPerch(attempt);
      if (!visibleAvatarDock(attempt.dock, point, display.workArea)) {
        // Moving the contact off screen does not close the verified target.
        // Keep its watcher so the same perch returns when the contact is visible.
        attempt.hidden = true;
        avatarDetach.hideParked();
        syncAvatarComposer();
        return;
      }
      const restoring = attempt.hidden === true;
      attempt.hidden = false;
      attempt.seatPoint = point;
      attempt.display = display;
      await updateSeatedFrame(point, display, restoring);
      // Follow the same window event as the sprite. Hover polling can run at a
      // lower cadence on Windows, so it must not pace the input bar's movement.
      syncAvatarComposer(avatarComposer?.pointer);
    } finally {
      attempt.updating = false;
      if (attempt.pending && perch === attempt) void followPerch(attempt).catch(() => {});
    }
  }

  async function perchOn(
    target,
    lease = null,
    dock = defaultSeat,
    grab,
    stillAllowed = () => true,
  ) {
    const arrival = avatarDockFrame(dockFrames, dock);
    if (
      (!target && !dock.display) ||
      !arrival ||
      !canTeleport() ||
      !stillAllowed() ||
      (lease && capturePolicy.capture !== lease)
    )
      return false;
    const seat = dock.display ? avatarDockPoint(dock.bounds, dock) : windowDock(target, dock);
    const record = target && {
      windowId: target.windowId,
      processId: target.processId,
      startedAtTicks: target.startedAtTicks,
    };
    clearPerch();
    perch = { record, lease, dock, nextCheck: Date.now() + 1800, seated: false, seatPoint: seat };
    const attempt = perch;
    const allowed = () =>
      perch === attempt && stillAllowed() && (!lease || capturePolicy.capture === lease);
    try {
      if (
        !(await launchAvatarTo(
          seat,
          allowed,
          grab,
          avatarTravelPose(arrival, false, dock.display),
        )) ||
        !allowed()
      )
        return false;
      attempt.seated = true;
      if (attempt.seated && allowed()) {
        if (record) {
          const changed = (value) => {
            if (perch !== attempt) return;
            attempt.lastNativeUpdate = Date.now();
            attempt.pending = value;
            void followPerch(attempt).catch(() => {});
          };
          const localWatch = watchAvatarSettingsWindow(settingsHost?.window, record, {
            processId: process.pid,
            url: settingsUrl,
            onChange: changed,
          });
          attempt.localTracking = Boolean(localWatch);
          attempt.stopTracking = localWatch ?? desktopTeleportMenu?.watchWindow(record, changed);
        }
        return true;
      }
      return false;
    } finally {
      if (perch === attempt && (!attempt.seated || !allowed())) clearPerch();
    }
  }

  async function submitAvatarCommand(input, movement) {
    if (currentChatTask || chat.active) throw new Error('A reply is already in progress.');
    initiative.activity();
    avatarRoamAt = Date.now() + 90000;
    const ru = languages.value.conversation === 'ru';
    const work =
      movement.action === 'return'
        ? returnAvatar()
        : avatarWindow(movement.title ? { title: movement.title } : {}).then((target) =>
            perchOn(target),
          );
    currentChatTask = work;
    try {
      const success = await work.catch(() => false);
      const text =
        movement.action === 'return'
          ? success
            ? ru
              ? 'Я снова в рамке.'
              : 'I’m back in my frame.'
            : ru
              ? 'Не получилось вернуться.'
              : 'I couldn’t get back to my frame.'
          : success
            ? ru
              ? 'Я на краю окна.'
              : 'I’m perched on the window.'
            : ru
              ? 'Не нашла подходящего открытого окна.'
              : 'I couldn’t find an open window to perch on.';
      const stamp = { turnId: input.id, status: 'complete', createdAt: new Date().toISOString() };
      const user = { ...stamp, id: randomUUID(), role: 'user', text: input.text };
      const assistant = { ...stamp, id: randomUUID(), role: 'assistant', text };
      store.put(user);
      store.put(assistant);
      emitChat({
        type: 'turn.started',
        turnId: input.id,
        user,
        assistant: { ...assistant, text: '', status: 'streaming' },
      });
      emitChat({ type: 'turn.delta', turnId: input.id, text });
      emitChat({ type: 'turn.completed', turnId: input.id, assistant });
      return { ok: true };
    } finally {
      if (currentChatTask === work) currentChatTask = null;
    }
  }

  async function updateDesktopAvatar() {
    if (
      avatarDesktopUpdate ||
      !canTeleport() ||
      avatarDetach.operation ||
      avatarDetach.press ||
      pointer?.avatarPress ||
      pointer?.drag
    )
      return;
    const now = Date.now();
    const capture = capturePolicy.capture;
    const watching = capture?.mode === 'watch' && capturePolicy.snapshot().active ? capture : null;
    if (watching !== avatarRoamCapture) {
      avatarRoamCapture = watching;
      avatarRoamAt = Math.max(avatarRoamAt, now + 20000);
    }
    if (perch?.stopTracking && (perch.localTracking || desktopTeleportMenu?.session?.ready)) {
      await followPerch(perch);
      return;
    }
    if (
      !perch &&
      (!watching ||
        now < avatarRoamAt ||
        verification ||
        interfaceBusy ||
        draftBusy ||
        currentChatTask ||
        chat.active ||
        controlBorder ||
        playbackBusy ||
        voice.generating ||
        Date.now() < lastSpeechUntil ||
        sleepService.phase !== 'awake' ||
        screenObservation.snapshot().analysing)
    )
      return;
    if (perch?.pending) {
      await followPerch(perch);
      return;
    }
    if (
      perch &&
      (!perch.record ||
        !perch.seated ||
        now < perch.nextCheck ||
        (perch.lastNativeUpdate && desktopTeleportMenu?.session?.ready))
    )
      return;
    avatarDesktopUpdate = true;
    try {
      if (perch) {
        const current = perch;
        current.nextCheck = now + 1800;
        const target =
          (!current.lease || current.lease === watching) && (await avatarWindow(current.record));
        if (perch !== current || !canTeleport() || !avatarDetach.available || avatarDetach.press)
          return;
        if (!target) {
          await finishPerch(current);
        } else {
          const point = windowDock(target, current.dock);
          const display = screen.getDisplayNearestPoint(point);
          if (current.lease && !captureIncludesDisplay(current.lease, display.id)) {
            await finishPerch(current);
            return;
          }
          if (perch === current) {
            current.seatPoint = point;
            current.display = display;
            await updateSeatedFrame(point, display);
          }
        }
        return;
      }
      avatarRoamAt = now + 45000 + Math.floor(Math.random() * 35000);
      if (watching.nativeId.startsWith('window:')) {
        const target = await avatarWindow({ windowId: watching.nativeId.split(':')[1] });
        if (capturePolicy.capture === watching && !avatarDetach.press && !pointer?.avatarPress)
          await perchOn(target, watching);
        return;
      }
      const displays = screen.getAllDisplays();
      const approved = displays.filter(
        ({ id }) =>
          (watching.allMonitors || watching.displayId || displays.length === 1) &&
          captureIncludesDisplay(watching, id),
      );
      const display = approved[Math.floor(Math.random() * approved.length)];
      if (!display) return;
      if (Math.random() < 0.35) {
        const target = await avatarWindow();
        if (capturePolicy.capture !== watching || avatarDetach.press || pointer?.avatarPress)
          return;
        if (
          target &&
          screen.getDisplayNearestPoint(windowDock(target)).id === display.id &&
          (await perchOn(target, watching))
        )
          return;
      }
      const point = randomAvatarDestination(
        display.workArea,
        window.getBounds(),
        avatarDetach.desktopPoint,
      );
      if (
        point &&
        capturePolicy.capture === watching &&
        !avatarDetach.press &&
        !pointer?.avatarPress
      )
        await launchAvatarTo(point, () => capturePolicy.capture === watching);
    } finally {
      avatarDesktopUpdate = false;
    }
  }

  function captureIncludesDisplay(capture, displayId) {
    const id = String(displayId);
    return capture.allMonitors
      ? capture.displayIds.includes(id)
      : !capture.displayId || capture.displayId === id;
  }

  function showDesktopTeleportMenu() {
    if (catalog.animated)
      void desktopTeleportMenu?.show(uiText('Teleport Capri', languages.value.interface));
  }

  function enterFocusMode() {
    minimizedChip?.hide();
    if (focusMode) return;
    focusMode = true;
    settingsHost.hide();
    hideCompanionToTray();
    emit({ type: 'window.focus-mode', active: true });
  }

  function writeWindowPreferences(alwaysOnTop) {
    const bounds = window.getBounds();
    writeJsonAtomic(windowFile, {
      schemaVersion: 3,
      x: bounds.x,
      y: bounds.y,
      footprint: windowFootprint,
      compactPlacement,
      alwaysOnTop,
    });
  }

  function saveWindow() {
    if (!window || window.isDestroyed()) return;
    try {
      writeWindowPreferences(saved.alwaysOnTop !== false);
    } catch {
      console.error('Could not save companion position');
    }
  }

  function setAlwaysOnTop(value) {
    saved.alwaysOnTop = value;
    controlWindowLayer.sync();
    emit({ type: 'window.always-on-top', active: value });
    saveWindow();
  }

  async function updateSettingsPreview(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid settings preview.');
    const validateFlag = (input) => {
      if (typeof input !== 'boolean') throw new Error('Invalid settings preview.');
      return input;
    };
    const validators = {
      companion: validateCompanionSettings,
      dimming: validateDimming,
      zoom: (zoom) => validateAvatarLayout({ ...avatarLayout, zoom }).zoom,
      alwaysOnTop: validateFlag,
      portrait: validateFlag,
      voiceEffects: validateVoiceEffects,
      interface: (language) =>
        validateLanguages({ ...languages.value, interface: language }).interface,
      languages: validateLanguages,
      personality: (text) => validatePersonality(text) || defaultPersonality(),
      style: (style) => {
        if (!Object.hasOwn(COMMUNICATION_STYLES, style))
          throw new Error('Unknown communication style.');
        return style;
      },
      initiative: validateInitiative,
      microphone: (id) => audioInputs.describe(id),
      speechPause: (pause) =>
        validateSpeechSettings({ trailingSilenceSeconds: pause }).trailingSilenceSeconds,
      computerAppearance: computerPreferences,
      musicListening: validateMusicListeningSettings,
    };
    const next = {};
    for (const [key, input] of Object.entries(value)) {
      if (!Object.hasOwn(validators, key)) throw new Error('Invalid settings preview.');
      next[key] = validators[key](input);
    }
    if (Object.keys(next).length && !settingsHost?.requested) return false;
    const previous = settingsPreview;
    settingsPreview = next;
    const changed = (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]);
    const send = (type, fields) => emit({ type, ...fields, preview: true });
    if (changed('musicListening')) musicListening.publish();
    if (changed('companion'))
      send('companion.settings', {
        settings: {
          ...liveCompanionSettings(),
          customAudio: existsSync(path.join(state, 'wake-audio')),
        },
      });
    if (changed('dimming')) send('dimming', { settings: next.dimming ?? dimming });
    if (changed('zoom'))
      send('avatar.layout', { layout: { ...avatarLayout, zoom: next.zoom ?? avatarLayout.zoom } });
    if (changed('portrait'))
      send('settings.set-portrait', { active: next.portrait ?? presencePinned });
    if (changed('alwaysOnTop') && window && !window.isDestroyed()) controlWindowLayer.sync();
    if (changed('voiceEffects'))
      send('voice.effects', { settings: next.voiceEffects ?? voiceEffects.snapshot() });
    if (changed('interface'))
      send('languages', {
        settings: {
          ...languages.snapshot(),
          interface: next.interface ?? languages.value.interface,
        },
      });
    if (changed('computerAppearance'))
      controlBorder?.configure(next.computerAppearance ?? computerAppearance.snapshot());
    if (changed('initiative')) void syncInitiative().catch(() => observer.publish('failed'));
    if (
      changed('microphone') &&
      (previous.microphone?.deviceId ?? audioInputs.deviceId) !== liveMicrophone().deviceId
    ) {
      const restart = Boolean(microphone.capture);
      if (restart) microphone.stop();
      send('microphone.device-changed', { ...liveMicrophone(), restart });
    }
    if (changed('speechPause'))
      await microphone.configurePause(
        next.speechPause ?? speechPreferences.value.trailingSilenceSeconds,
      );
    return true;
  }

  function saveAvatarLayout() {
    clearTimeout(layoutSaveTimer);
    try {
      writeJsonAtomic(avatarLayoutFile, { schemaVersion: 1, ...avatarLayout });
    } catch {
      console.error('Could not save avatar placement');
    }
  }

  function saveDimming() {
    clearTimeout(dimmingSaveTimer);
    try {
      writeJsonAtomic(dimmingFile, { schemaVersion: 1, ...dimming });
    } catch {
      console.error('Could not save screen dimming');
    }
  }

  function changeDimming(value) {
    dimming = validateDimming(value);
    clearTimeout(dimmingSaveTimer);
    dimmingSaveTimer = setTimeout(saveDimming, 200);
    emit({ type: 'dimming', settings: dimming });
    return dimming;
  }

  function resetAvatarLayout() {
    avatarDetach?.reset();
    pointer?.endAvatar();
    avatarLayout = { ...DEFAULT_AVATAR_LAYOUT };
    saveAvatarLayout();
    emit({ type: 'avatar.layout', layout: avatarLayout });
  }

  function resetPosition() {
    avatarDetach?.reset();
    compactPlacement = undefined;
    const display = screen.getPrimaryDisplay();
    const bounds = placeInWorkArea(null, display.workArea, size);
    window.setBounds(bounds);
    saveWindow();
    restoreCompanion(false);
  }

  function companionDisplay(footprint = windowFootprint) {
    return screen.getDisplayMatching(visibleWindowBounds(window.getBounds(), footprint));
  }

  function clampWindow({ footprint = windowFootprint, display, preferredSize, anchor } = {}) {
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    display ??= companionDisplay();
    const requested =
      anchor && footprint
        ? { ...bounds, x: anchor.x - footprint.x, y: anchor.y - footprint.y }
        : bounds;
    const next = placeVisibleInWorkArea(
      requested,
      display.workArea,
      preferredSize ?? bounds,
      footprint,
    );
    if (['x', 'y', 'width', 'height'].some((key) => next[key] !== bounds[key]))
      window.setBounds(next);
  }

  function queueDesktopRelaunch() {
    const launcher = path.join(root, 'Capri.exe');
    app.relaunch(
      existsSync(launcher)
        ? { execPath: launcher, args: [] }
        : {
            execPath: nodePath,
            args: [path.join(root, 'packages/runtime/bin/capri.mjs'), 'desktop'],
          },
    );
  }
  async function shutdownForRestart(message) {
    await computerControl.stop();
    shuttingDown = true;
    attachmentViewer?.close();
    attachmentDrafts.clear();
    avatarDetach?.reset();
    settingsHost?.destroy();
    await speechInstaller.close();
    huggingface.close();
    await voiceTraining.close();
    await voiceCatalog.close();
    sleepService.close();
    reminders?.close();
    backendController?.abort(new Error('Startup cancelled for restart'));
    voiceStartController?.abort();
    cancelVisual();
    capturePolicy.clear();
    screenPreviews.clear();
    initiative.close();
    observer.stop();
    metadataRpc.stop();
    chat.cancel();
    voice.close();
    microphone.close();
    requestRouter.close();
    setBackend('stopping', message);
    try {
      await Promise.allSettled([backendPromise, voiceStartPromise, sleepService.pending]);
      if (verification) await stopManaged(rt.logPrefix);
      else await stopCore(rt, { companion: false });
    } catch (error) {
      shuttingDown = false;
      setBackend('offline', 'Reconnect to try again.');
      throw error;
    }
  }

  async function quitAndUnload() {
    if (shuttingDown) return;
    if (cableInstaller.snapshot().busy)
      throw new Error('Wait for VB-CABLE setup to finish before closing or restarting Capri.');
    await computerControl.stop();
    const choice = await confirmations.choose({
      title: 'Quit Capri?',
      detail: 'Capri will close and unload the local models. Any active reply will stop.',
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'sleep', label: 'Sleep' },
        { id: 'restart', label: 'Restart' },
        { id: 'confirm', label: 'Quit and unload models', danger: true },
      ],
    });
    if (choice === 'cancel' || shuttingDown) return;
    if (choice === 'sleep') {
      await sleepService.sleep();
      return;
    }
    if (choice === 'restart') {
      try {
        await shutdownForRestart('Preparing to restart Capri...');
        queueDesktopRelaunch();
        app.quit();
      } catch (error) {
        shuttingDown = false;
        setBackend('offline', 'Reconnect to try again.');
        throw error;
      }
      return;
    }
    shuttingDown = true;
    // Keep a parked avatar visible long enough to show DISCONNECTING.
    attachmentViewer?.close();
    attachmentDrafts.clear();
    if (avatarDetach?.available) avatarDetach.stopPointer();
    else avatarDetach?.reset();
    settingsHost?.destroy();
    sleepService.close();
    reminders?.close();
    backendController?.abort(new Error('Startup cancelled for shutdown'));
    voiceStartController?.abort();
    cancelVisual();
    capturePolicy.clear();
    screenPreviews.clear();
    initiative.close();
    observer.stop();
    metadataRpc.stop();
    chat.cancel();
    voice.close();
    microphone.close();
    requestRouter.close();
    setBackend('stopping', 'Stopping Capri and freeing model memory…');
    try {
      await Promise.allSettled([backendPromise, voiceStartPromise, sleepService.pending]);
      if (verification) await stopManaged(rt.logPrefix);
      else await stopCore(rt, { companion: false });
      await speechInstaller.close();
      app.quit();
    } catch (error) {
      console.error('Shutdown failed:', error.message);
      shuttingDown = false;
      if (avatarDetach?.available) avatarDetach.startPointer();
      setBackend('offline', 'Some services could not be stopped. Use stop.cmd or try again.');
    }
  }

  function menuTemplate() {
    const template = [
      { label: 'Show Capri', click: () => restoreCompanion() },
      {
        id: 'tray-settings',
        label: 'Settings',
        click: () => void settingsHost.open().catch(console.error),
      },
      ...(canTeleport() && (avatarDetach.phase === 'attached' || avatarDetach.available)
        ? [{ label: 'Teleport Capri', click: () => void teleportToCursor().catch(() => {}) }]
        : []),
      ...(avatarDetach?.available
        ? [
            {
              label: 'Return to frame',
              click: () => void returnAvatar().catch(() => {}),
            },
          ]
        : []),
      {
        label: 'Focus mode',
        type: 'checkbox',
        checked: focusMode,
        click: (item) => (item.checked ? enterFocusMode() : restoreCompanion()),
      },
      { label: 'Reset to bottom-right corner', click: resetPosition },
      { label: 'Reset Capri position and zoom', click: resetAvatarLayout },
      {
        label: 'Window dimming…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-dimming' });
        },
      },
      {
        label: 'Voice',
        type: 'checkbox',
        checked: voice.enabled,
        click: (item) => changeVoice(item.checked),
      },
      {
        label: 'Voice effects…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-voice-effects' });
        },
      },
      {
        label: 'Qwen model…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-models' });
        },
      },
      {
        label: 'Languages…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-languages' });
        },
      },
      {
        label: 'File access…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-file-access' });
        },
      },
      {
        label: 'Timers and reminders…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-time' });
        },
      },
      {
        label: 'Application access…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-applications' });
        },
      },
      {
        label: 'Initiative…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-initiative' });
        },
      },
      {
        label: 'Screen snapshot…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-screen' });
        },
      },
      {
        label: 'Open screenshots folder',
        click: () => {
          void shell.openPath(screenshots.folder());
        },
      },
      {
        label: 'Stop screen observation',
        enabled: capturePolicy.capture?.mode === 'watch',
        click: () => capturePolicy.clear(),
      },
      {
        label: 'Microphone (' + languageName(asrConfig.language) + ')',
        type: 'checkbox',
        checked: Boolean(microphone.capture),
        enabled: asrAllowed && asrInstalled && ['ready', 'asleep'].includes(backendState.phase),
        click: () => {
          restoreCompanion();
          emit({ type: 'microphone.toggle-request' });
        },
      },
      {
        id: 'microphone-input',
        label: 'Microphone input',
        submenu: audioInputs.menu((id) => {
          try {
            changeAudioInput(id);
          } catch {
            emit({
              type: 'microphone.device-error',
              message:
                'The microphone selection could not be saved. Reopen the menu and try again.',
            });
          }
        }),
      },
      {
        id: 'speech-settings',
        label: 'Microphone settings…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-speech-settings' });
        },
      },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: preferredAlwaysOnTop(),
        click: (item) => {
          setAlwaysOnTop(item.checked);
        },
      },
      { type: 'separator' },
      {
        label: 'Updates…',
        click: () => {
          restoreCompanion();
          emit({ type: 'open-updates' });
        },
      },
      {
        label: 'Reconnect',
        enabled: !backendPromise && !shuttingDown,
        click: () => {
          (sleepService.phase === 'awake' ? connectBackend() : sleepService.wake()).catch(() => {});
        },
      },
      { label: 'Hide to tray', click: hideCompanionToTray },
      { type: 'separator' },
      {
        label: 'Quit and unload models',
        click: () => {
          quitAndUnload().catch(console.error);
        },
      },
    ];
    const localize = (items, devices = false) =>
      items.map((item, index) => {
        let label = item.label;
        if (label) {
          if (devices && item.type === 'radio' && index > 0) {
            if (item.enabled === false && label.startsWith('Unavailable — '))
              label = uiText('Unavailable — {device}', languages.value.interface, {
                device: label.slice(14),
              });
          } else {
            label = uiText(label, languages.value.interface);
            if (['Initiative…', 'Screen snapshot…'].includes(item.label)) label += ' (BETA)';
          }
        }
        return {
          ...item,
          ...(label ? { label } : {}),
          ...(item.submenu
            ? { submenu: localize(item.submenu, item.id === 'microphone-input') }
            : {}),
        };
      });
    return localize(template);
  }

  async function refreshAudioInputs() {
    if (audioInputRefresh) return audioInputRefresh;
    audioInputRefresh = (async () => {
      if (!window || window.isDestroyed() || window.webContents.getURL() !== rendererUrl)
        throw new Error('The companion is not ready');
      // enumerateDevices reveals names only while its audio permission check is
      // allowed. This bounded metadata query never calls getUserMedia.
      if (!window.isVisible()) showCompanion(false);
      listingAudioInputs = true;
      let timer;
      try {
        const devices = await Promise.race([
          window.webContents.executeJavaScript(
            "navigator.mediaDevices.enumerateDevices().then(devices => devices.filter(device => device.kind === 'audioinput').map(device => ({kind: device.kind, deviceId: device.deviceId, label: device.label})))",
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Audio input list timed out')), 2500);
          }),
        ]);
        audioInputs.update(devices);
        return {
          selection: audioInputs.snapshot(),
          devices: audioInputs.devices.map((device) => ({ ...device })),
        };
      } finally {
        listingAudioInputs = false;
        clearTimeout(timer);
      }
    })().finally(() => {
      audioInputRefresh = null;
    });
    return audioInputRefresh;
  }
  function changeAudioInput(id) {
    const previous = liveMicrophone().deviceId;
    if (!audioInputs.select(id)) return audioInputs.snapshot();
    if (previous === liveMicrophone().deviceId) {
      settingsHost?.send({ type: 'microphone.device-changed', ...audioInputs.snapshot() });
      return audioInputs.snapshot();
    }
    const restart = Boolean(microphone.capture);
    if (restart) microphone.stop();
    emit({ type: 'microphone.device-changed', ...audioInputs.snapshot(), restart });
    return audioInputs.snapshot();
  }
  async function openMenu(fromTray = false) {
    // Opening a tray menu must not raise the companion just to enumerate devices.
    if (window?.isVisible()) await refreshAudioInputs().catch(() => {});
    if (!window || window.isDestroyed()) return;
    const menu = Menu.buildFromTemplate(menuTemplate());
    if (fromTray) tray?.popUpContextMenu(menu);
    else menu.popup({ window });
  }

  const handle = createIpcHandler(ipcMain, {
    getWindow: () => window,
    url: rendererUrl,
    getSettingsWindow: () => settingsHost?.window,
    settingsUrl,
    settingsChannels: SETTINGS_CHANNELS,
    revisionReaders: {
      'capri:companion-settings': () => companionPreferences.snapshot(),
      'capri:languages': () => languages.snapshot(),
      'capri:speech-settings': () => speechPreferences.snapshot(),
      'capri:initiative': () => initiativeSettings.snapshot(),
    },
  });
  function settingsVersions() {
    return {
      companion: settingsVersion(companionPreferences.snapshot()),
      languages: settingsVersion(languages.snapshot()),
      speech: settingsVersion(speechPreferences.snapshot()),
      initiative: settingsVersion(initiativeSettings.snapshot()),
    };
  }

  function savePresencePinned(value) {
    writeJsonAtomic(presenceFile, { schemaVersion: 1, pinned: value });
    presencePinned = value;
  }

  function setPresencePinned(value) {
    if (typeof value !== 'boolean') throw new Error('Invalid presence setting');
    savePresencePinned(value);
    emit({ type: 'window.portrait', active: value });
    return value;
  }
  const screenPreferences = new Preferences(
    path.join(state, 'screen-observation.json'),
    observationOptions(),
    observationOptions,
  );
  const desktopCatalog = new DesktopCatalog({
    fullAccess: () => fullComputerAccess.enabled && applicationAccess.enabled,
    accessAllowed: () => applicationAccess.enabled,
    accessSignal: () => applicationAccess.signal,
    currentTurn: () => chat.active?.id ?? null,
    root,
    state,
    filePermissions,
    trash: (file) => shell.trashItem(file),
    translate: (text) => uiText(text, languages.value.interface),
  });
  let controlBorder = null;
  const nativeEscape = process.platform === 'win32' ? new NativeEscapeStop({ root }) : null;
  const computerControl = new ComputerControl({
    allowed: () => fullComputerAccess.enabled && applicationAccess.enabled,
    canStart: () =>
      Boolean(
        (workflowTurn || (chat.active && !chat.active.controller.signal.aborted)) && !shuttingDown,
      ),
    currentTurn: () => workflowTurn ?? chat.active?.id ?? null,
    bridge: (command, options) =>
      desktopCatalog.bridge(
        root,
        command.action === 'computer_state'
          ? { ...command, ignoreProcessId: String(process.pid) }
          : command,
        options,
      ),
    pointerDuration: () =>
      (settingsPreview.computerAppearance ?? computerAppearance.value).pointerDuration,
    applicationAdapter: new ResolveAdapter({
      root,
      bridge: (command, options) => desktopCatalog.bridge(root, command, options),
      allowed: () =>
        fullComputerAccess.enabled &&
        applicationAccess.enabled &&
        Boolean(chat.active) &&
        !shuttingDown,
    }),
    capture: async ({ signal }) => {
      const result = await captureActiveDisplay(root, { signal, withGeometry: true });
      const source = nativeImage.createFromBuffer(result.png),
        original = source.getSize();
      const factor = Math.min(1, 1280 / original.width, 720 / original.height);
      const image = source.resize({
        width: Math.max(1, Math.round(original.width * factor)),
        height: Math.max(1, Math.round(original.height * factor)),
      });
      return { png: image.toPNG(), ...image.getSize(), bounds: result.bounds };
    },
    describe: computerVision({
      url: rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
    }),
    registerEscape: async () => {
      let shortcut = false;
      try {
        shortcut = globalShortcut.register('Escape', () => void emergencyComputerStop());
      } catch {}
      if (!nativeEscape) return shortcut;
      try {
        const armed = await nativeEscape.start({
          onEscape: () => void emergencyComputerStop(),
          onFailure: () => void emergencyComputerStop(),
        });
        if (!armed || !nativeEscape.active)
          throw new Error('Escape emergency stop is unavailable.');
        return true;
      } catch {
        nativeEscape.stop();
        globalShortcut.unregister('Escape');
        return false;
      }
    },
    unregisterEscape: () => {
      try {
        nativeEscape?.stop();
      } finally {
        globalShortcut.unregister('Escape');
      }
    },
    showBorder: async () => {
      if (controlBorder) throw new Error('Computer control indicator is already open.');
      avatarDetach?.reset();
      const overlay = new ControlOverlay({
        BrowserWindow,
        screen,
        owner: window,
        onLost: (reason) => {
          if (controlBorder !== overlay) return;
          console.warn('Computer control indicator lost:', reason);
          return emergencyComputerStop();
        },
      });
      controlBorder = overlay;
      controlWindowLayer.begin();
      overlay.configure(settingsPreview.computerAppearance ?? computerAppearance.snapshot());
      await overlay.show(
        uiText('Computer control active — press Escape to stop', languages.value.interface),
      );
    },
    hideBorder: () => {
      const overlay = controlBorder;
      controlBorder = null;
      try {
        overlay?.hide();
      } finally {
        controlWindowLayer.end();
      }
    },
    emit: (event) => {
      if (event.type === 'computer.input') controlBorder?.pulse(event.action);
      emit(event);
    },
  });
  const computerAgent = new ComputerAgent({
    control: computerControl,
    applications: desktopCatalog,
    callFocusWindow: () => {
      const focused = BrowserWindow.getFocusedWindow();
      return focused === window || focused === settingsHost?.window ? focused : null;
    },
    launchSteamGame:
      process.platform === 'win32' && !verification
        ? steamGameLauncher({ openExternal: (uri) => shell.openExternal(uri) })
        : undefined,
    language: () => languages.value.conversation,
    audit: (event) => console.log('Computer task:', JSON.stringify(event)),
    plan: computerPlanner({
      url: rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
    }),
    emit: (event) => {
      controlBorder?.phase(event.phase);
      chat.computerProgress();
      emit(event);
    },
  });
  const computerRequests = new ComputerRequests({
    access: fullComputerAccess,
    run: (goal, options) => computerAgent.run(goal, options),
    language: () => languages.value.conversation,
  });
  function emergencyComputerStop() {
    workflows?.cancel();
    const stopped = computerControl.stop();
    chat.cancel();
    cancelVisual();
    companionActions.approvals.cancel();
    return stopped;
  }
  workflows = new TaskWorkflows({
    root,
    data: verification ? verificationFolder : path.join(root, 'data'),
    control: computerControl,
    catalog: desktopCatalog,
    allowed: () =>
      fullComputerAccess.enabled && applicationAccess.enabled && !sessionLocked && !shuttingDown,
    turn: (id) => {
      workflowTurn = id;
    },
    changed: (settings) => {
      if (settings.recording !== recordingShown) {
        recordingShown = settings.recording;
        if (settings.recording) void recordingIndicator?.show();
        else recordingIndicator?.hide();
      }
      chat.computerProgress();
      emit({ type: 'workflow.status', settings });
    },
  });
  // Also catch Escape in Capri-owned windows if OS shortcut delivery is interrupted.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.key === 'Escape' &&
        (computerControl.session || controlBorder)
      ) {
        event.preventDefault();
        void emergencyComputerStop();
      }
    });
  });
  const companionActions = new CompanionActions({
    userTools,
    workflows,
    authorizeAction: (tool, args) => {
      applicationAccess.assertAllowed(tool, args);
      if (
        (tool === 'workflow_control' && args?.action === 'run') ||
        /^capri_tool_\d{2}$/.test(tool)
      )
        chat.assertToolAllowed('desktop_control', { action: 'run_task' });
      chat.assertToolAllowed(tool, args);
    },
    computerAgent,
    requestComputerAccess: (enabled, options) => {
      chat.assertToolAllowed('settings_control', {
        action: 'request',
        setting: 'fullComputerAccess',
        value: enabled,
      });
      if (enabled) applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      return computerRequests.configure(enabled, options);
    },
    runComputerTask: (goal, options) => {
      chat.assertToolAllowed('desktop_control', { action: 'run_task' });
      applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      return chat.active?.computerTaskResult ?? computerRequests.execute(goal, options);
    },
    spotify: {
      execute: (id, args, signal) => {
        applicationAccess.assertAllowed('spotify_control', args);
        const access = spotify.snapshot();
        if (!access.enabled || !access.prepared)
          throw new Error('Enable Spotify in Settings → Application access first.');
        return spotifyService.execute(
          id,
          args,
          AbortSignal.any([applicationAccess.signal, ...(signal ? [signal] : [])]),
        );
      },
      close: () => spotifyService.close(),
    },
    applications: new ApplicationService({
      root,
      permissionsFile: path.join(state, 'applications.json'),
      database: path.join(state, 'fixed-applications.sqlite'),
      permissionSnapshot: () => ({
        ...applicationAccess.mask(applications.snapshot()),
        ...(fullComputerAccess.enabled && applicationAccess.enabled
          ? { notepad: true, calculator: true }
          : {}),
      }),
    }),
    computer: computerControl,
    fullAccess: () => fullComputerAccess.enabled,
    files: (() => {
      const folder = path.join(verification ? verificationFolder : root, 'data/filesystem');
      mkdirSync(folder, { recursive: true });
      return new FileService(filePermissions, {
        knownLocations: () =>
          verification
            ? []
            : ['downloads', 'desktop', 'documents', 'pictures', 'music', 'videos'].map((name) => ({
                name,
                path: app.getPath(name),
              })),
        database: path.join(folder, 'operations.sqlite'),
        recovery: path.join(folder, 'recovery'),
        review: (detail, execute) =>
          companionActions.approvals.propose({
            title: 'Replace existing file?',
            detail: [
              detail.path,
              `${uiText('Before', languages.value.interface)}:\n${detail.before}`,
              `${uiText('After', languages.value.interface)}:\n${detail.after}`,
            ].join('\n\n'),
            kind: 'replace',
            voice: false,
            execute,
          }),
        replaceFile: async (command, signal, stillAllowed) => {
          await ensureDesktopActions();
          return desktopCatalog.bridge(
            root,
            { action: 'file_replace', ...command },
            { signal, stillAllowed },
          );
        },
      });
    })(),
    onResult: (tool, args, result) => {
      chat.recordToolResult(tool, args, result);
      if (
        result?.cancelled &&
        ((tool === 'settings_control' && args.setting === 'fullComputerAccess') ||
          (tool === 'desktop_control' && args.action === 'run_task'))
      )
        chat.cancel();
      if (tool === 'time_control') temporal?.observe(args, result);
      if (tool === 'time_control' && args.action === 'cancel' && result.ok)
        reminders?.cancel(result.object?.id ?? args.id);
    },
    root: verification ? verificationFolder : root,
    emit,
    desktop: desktopCatalog,
    settings: () => ({
      ...companionPreferences.snapshot(),
      applications: applications.snapshot(),
      screenObservation: screenObservation.snapshot().active,
      fullComputerAccess: fullComputerAccess.enabled && applicationAccess.enabled,
      spotify: spotify.snapshot().enabled && applicationAccess.enabled,
    }),
    setSetting: (key, value) => {
      const settings = companionPreferences.set({
        ...companionPreferences.snapshot(),
        [key]: value,
      });
      emit({ type: 'companion.settings', settings });
      return settings[key];
    },
    requestSetting: (setting, approvals) => {
      if (['notepad', 'calculator'].includes(setting))
        return approvals.propose({
          title: 'Allow this application?',
          detail: uiText(
            'Allow Capri to open {application}, bring it to the front and read its accessible controls. Revoke this grant in Application access.',
            languages.value.interface,
            {
              application: uiText(
                setting === 'notepad' ? 'Notepad' : 'Calculator',
                languages.value.interface,
              ),
            },
          ),
          kind: 'permission',
          execute: () => {
            ensureDesktopActions();
            const settings = applications.set({ ...applications.snapshot(), [setting]: true });
            emit({ type: 'applications', settings });
            return { ok: true, confirmation: 'Application access enabled.' };
          },
        });
      const panel = {
        screenObservation: 'screen',
        spotify: 'applications',
        languages: 'languages',
        models: 'models',
      }[setting];
      if (!panel) throw new Error('Unsupported setting.');
      return approvals.propose({
        title: 'Open the required controls?',
        detail: uiText(
          setting === 'screenObservation'
            ? 'Choose the exact window or monitor and observation duration. Screen access will not begin until you select a source.'
            : 'Review and apply this setting in its dedicated panel.',
          languages.value.interface,
        ),
        kind: 'permission',
        execute: () => {
          if (focusMode)
            return {
              ok: false,
              applied: false,
              confirmation: 'Show Capri from the tray to open these settings.',
            };
          emit({ type: 'open-' + panel });
          return {
            ok: true,
            applied: false,
            setting,
            confirmation: {
              screenObservation:
                'Choose a window or monitor in Screen snapshot, then press Start observation. Capture has not started yet.',
              spotify: 'Opened Application access. Enable Spotify there to connect it.',
              languages:
                'Opened Languages. Choose the languages, then press Apply languages. No language was changed yet.',
              models:
                'Opened Language model. Choose and prepare a model, then apply it. The current model has not changed.',
            }[setting],
          };
        },
      });
    },
    deliver: (object) => reminders.enqueue(object),
  });

  temporal = new TimeConversation({
    service: () => companionActions.time,
    language: () => languages.value.conversation,
  });

  reminders = new ReminderDelivery({
    file: path.join(state, 'reminder-delivery.json'),
    visual: async (object) => {
      if (!rendererReady) throw new Error('Reminder waits for the interface.');
      emit({ type: 'time.due', object });
      if (!verification && Notification.isSupported()) {
        const notification = new Notification({
          title: 'Capri · ' + uiText('Reminder', languages.value.interface),
          icon: applicationIcon,
          body: sessionLocked
            ? uiText('Reminder', languages.value.interface)
            : object.title || uiText('Timer finished.', languages.value.interface),
          silent: true,
        });
        notification.on('click', () => {
          restoreCompanion();
          void settingsHost.open('time');
        });
        notification.show();
      }
    },
    ready: () => {
      if (
        !rendererReady ||
        shuttingDown ||
        currentChatTask ||
        chat.active ||
        playbackBusy ||
        voice.generating ||
        ['sleeping', 'waking'].includes(sleepService.phase)
      )
        return 'busy';
      if (sessionLocked) return 'locked';
      if (
        !voice.enabled ||
        voice.language === 'off' ||
        (!liveCompanionSettings().wakeOnReminder && !voice.ready)
      )
        return 'silent';
      return 'ready';
    },
    prepare: async () => {
      if (!voice.ready)
        await sleepService.wakeForReminder(async () => {
          await connectVoice();
          if (!voice.ready)
            throw new Error(
              'The reminder voice could not start. Open Languages to check its installation.',
            );
        });
      emit({ type: 'reminder.wake' });
    },
    speak: (object) =>
      speakReminder({
        voice,
        emit,
        turnId: 'reminder-' + randomUUID(),
        playbackBusy: () => playbackBusy,
        shuttingDown: () => shuttingDown,
        subscribe: (listener) => {
          reminderListeners.add(listener);
          return () => reminderListeners.delete(listener);
        },
        text: object.title
          ? uiText('Choom, your reminder: {text}', languages.value.conversation, {
              text: object.title,
            })
          : uiText('Timer finished.', languages.value.conversation),
      }),
    cancelSpeech: () => {
      if (voice.turn?.id.startsWith('reminder-')) voice.cancel();
    },
    notify: (item) =>
      emit({ type: 'reminder.delivery', state: item.state, id: item.object.id, error: item.error }),
  });
  reminders.start();

  function installIpc() {
    const miniHandle = (name, callback, visible = false) =>
      ipcMain.handle(`capri:avatar-composer-${name}`, (event, value) => {
        if (
          !avatarComposer?.owns(event) ||
          focusMode ||
          sessionLocked ||
          shuttingDown ||
          (visible &&
            (!avatarDetach?.available || !companionPresent() || !avatarComposer.window.isVisible()))
        )
          throw new Error('Input bar unavailable.');
        return callback(value);
      });
    miniHandle('bootstrap', () => ({ ...avatarComposerState, mode: avatarComposer.mode }));
    miniHandle('resize', (height) => {
      if (!Number.isInteger(height) || height < 44 || height > 240)
        throw new Error('Invalid input size.');
      return avatarComposer.setHeight(height);
    });
    miniHandle(
      'hide',
      () => {
        avatarComposerDismissed = true;
        avatarComposer.hide();
        return true;
      },
      true,
    );
    miniHandle(
      'action',
      async (value) => {
        const action = validateAvatarComposerAction(value);
        if (action.type === 'keyboard') {
          avatarComposer.setMode(avatarComposer.mode === 'text' ? 'compact' : 'text');
          return true;
        }
        if (action.type === 'menu') {
          if (window.isVisible() && !avatarOnly) {
            await collapseCompanionInterface();
            avatarComposer.setMode('compact');
          } else {
            restoreCompanion(false);
            avatarComposer.setMode('expanded');
          }
          return true;
        }
        if (action.type === 'submit' && !avatarComposerState.canSend) return false;
        if (action.type === 'microphone' && avatarComposerState.microphone.disabled) return false;
        if (action.type === 'paste-files') {
          const pasteOwner = avatarComposer.window;
          const canImport = () =>
            avatarComposer.window === pasteOwner &&
            !pasteOwner.isDestroyed() &&
            pasteOwner.isVisible() &&
            pasteOwner.isFocused() &&
            avatarDetach?.available &&
            companionPresent() &&
            !avatarComposerDismissed &&
            !sessionLocked &&
            !focusMode &&
            !shuttingDown &&
            avatarComposerState.canAttach &&
            !avatarComposerState.busy;
          if (avatarComposerPicking || !canImport()) return false;
          avatarComposerPicking = true;
          try {
            return await dispatchAvatarComposerAction({
              type: 'files',
              files: action.files,
              overflow: action.overflow,
            });
          } finally {
            avatarComposerPicking = false;
          }
        }
        if (action.type === 'attach') {
          if (!avatarComposerState.canAttach || avatarComposerPicking) return false;
          avatarComposerPicking = true;
          const pickerOwner = avatarComposer.window;
          const canImport = () =>
            avatarComposer.window === pickerOwner &&
            !pickerOwner.isDestroyed() &&
            pickerOwner.isVisible() &&
            avatarDetach?.available &&
            companionPresent() &&
            !avatarComposerDismissed &&
            !sessionLocked &&
            !focusMode &&
            !shuttingDown &&
            avatarComposerState.canAttach;
          try {
            const selected = await dialog.showOpenDialog(pickerOwner, {
              properties: ['openFile', 'multiSelections'],
            });
            if (selected.canceled) return true;
            if (!canImport()) return false;
            let files;
            try {
              files = await readSelectedComposerFiles(selected.filePaths);
            } catch {
              if (!canImport()) return false;
              return dispatchAvatarComposerAction({ type: 'attachment-error' });
            }
            if (!canImport()) return false;
            return dispatchAvatarComposerAction({
              type: 'files',
              files,
              overflow: selected.filePaths.length > files.length,
            });
          } finally {
            avatarComposerPicking = false;
          }
        }
        return dispatchAvatarComposerAction(action);
      },
      true,
    );
    handle('capri:avatar-composer-state', (value, { role }) => {
      if (role !== 'companion') throw new Error('Companion frame required.');
      avatarComposerState = sanitizeAvatarComposerState(value);
      avatarComposer?.sendState(avatarComposerState);
      syncAvatarComposer();
      return true;
    });
    handle('capri:avatar-composer-ack', (value, { role }) => {
      if (role !== 'companion' || typeof value?.id !== 'string') return false;
      const pending = avatarComposerActions.get(value.id);
      if (!pending) return false;
      clearTimeout(pending.timer);
      avatarComposerActions.delete(value.id);
      pending.resolve(value.accepted === true);
      return true;
    });
    handle('capri:monitor-display', (action) => {
      if (shuttingDown || !window?.isVisible() || window.isMinimized()) return false;
      const change = (mode) => {
        const settings = companionPreferences.set(
          setMonitorDisplay(companionPreferences.value, mode),
        );
        emit({ type: 'companion.settings', settings });
      };
      if (action === 'toggle') change(action);
      else if (action === 'menu') {
        const { processGraphs, memoryMonitor, memoryStyle } = liveCompanionSettings();
        const current = processGraphs ? 'graphs' : memoryMonitor ? memoryStyle : null;
        Menu.buildFromTemplate(
          [
            ['rings', 'Circles'],
            ['bars', 'Bars'],
            ['graphs', 'Graphs'],
          ].map(([id, label]) => ({
            label: uiText(label, languages.value.interface),
            type: 'radio',
            checked: current === id,
            click: () => {
              try {
                change(id);
              } catch {
                emit({ type: 'monitor.error', message: 'Monitor display could not be saved.' });
              }
            },
          })),
        ).popup({ window });
      } else throw new Error('Invalid monitor display action');
      return true;
    });
    handle('capri:memory-status', async () => {
      const { memoryMonitor, processGraphs } = liveCompanionSettings();
      if (
        shuttingDown ||
        !(memoryMonitor || processGraphs) ||
        !window?.isVisible() ||
        window.isMinimized()
      )
        return null;
      const [memory, context, load, cpu] = await Promise.all([
        memorySampler.sample(),
        memoryMonitor
          ? contextSampler.sample({ available: !verification && backendState.phase === 'ready' })
          : null,
        processGraphs ? processLoad.sample() : null,
        systemCpu.sample(),
      ]);
      return { ...memory, context, processLoad: load, cpu };
    });
    handle('capri:settings-versions', settingsVersions);
    handle('capri:settings-open', async (section) => {
      if (focusMode) return false;
      startupIntroGate.claim('skip');
      emit({ type: 'startup-intro.skip' });
      section = section == null ? null : settingsSection(section);
      const focus = section === 'model-context' ? 'context' : null;
      if (focus) section = 'models';
      if (section !== null && !SETTINGS_SECTIONS.some((row) => row[0] === section))
        section = 'general';
      await settingsHost.open(section, focus);
      return true;
    });
    handle('capri:settings-close', () => {
      settingsHost.hide();
      return true;
    });
    handle('capri:settings-preview', (value, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      return updateSettingsPreview(value);
    });
    let resettingDesktopSettings = false;
    handle('capri:settings-reset', async (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      const view = settingsHost?.window;
      if (resettingDesktopSettings || !view?.isVisible()) return false;
      resettingDesktopSettings = true;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      view.once('hide', cancel);
      view.once('closed', cancel);
      view.webContents.once('render-process-gone', cancel);
      try {
        if (
          !(await confirmations.request({
            title: 'Reset settings to defaults?',
            detail:
              'This restores the default window and appearance settings, monitoring, voice effects, speech pause, initiative, screen observation and computer control effects. Unsaved changes to these settings will be discarded.',
            confirmLabel: 'Reset settings',
            danger: true,
            delayMs: 3000,
            signal: controller.signal,
          }))
        )
          return false;
        if (controller.signal.aborted || shuttingDown) return false;
        return await resetDesktopSettings();
      } finally {
        resettingDesktopSettings = false;
        view.removeListener('hide', cancel);
        view.removeListener('closed', cancel);
        if (!view.isDestroyed()) view.webContents.removeListener('render-process-gone', cancel);
      }
    });
    async function resetDesktopSettings() {
      const changes = [
        [companionPreferences, COMPANION_DEFAULTS],
        [inferenceStartup, INFERENCE_STARTUP_DEFAULTS],
        [voiceEffects, VOICE_EFFECT_DEFAULTS],
        [speechPreferences, speechDefaults],
        [initiativeSettings, INITIATIVE_DEFAULTS],
        [screenPreferences, observationOptions()],
        [computerAppearance, COMPUTER_DEFAULTS],
        [musicPreferences, MUSIC_LISTENING_DEFAULTS],
      ].map(([preferences, value]) => ({
        previous: preferences.snapshot(),
        value,
        write: (next) => preferences.set(next),
      }));
      changes.push(
        {
          previous: saved.alwaysOnTop !== false,
          value: true,
          write: (next) => {
            writeWindowPreferences(next);
            saved.alwaysOnTop = next;
          },
        },
        { previous: presencePinned, value: false, write: savePresencePinned },
        {
          previous: dimming,
          value: DIMMING_DEFAULTS,
          write: (next) => {
            writeJsonAtomic(dimmingFile, { schemaVersion: 1, ...next });
            clearTimeout(dimmingSaveTimer);
            dimming = next;
          },
        },
        {
          previous: avatarLayout,
          value: { ...avatarLayout, zoom: DEFAULT_AVATAR_LAYOUT.zoom },
          write: (next) => {
            writeJsonAtomic(avatarLayoutFile, { schemaVersion: 1, ...next });
            clearTimeout(layoutSaveTimer);
            avatarLayout = next;
          },
        },
      );
      const applied = [];
      try {
        for (const change of changes) {
          change.write(change.value);
          applied.push(change);
        }
      } catch {
        for (const change of applied.reverse()) {
          try {
            change.write(change.previous);
          } catch {
            console.error('Could not restore a preference after a failed settings reset');
          }
        }
        throw new Error(
          'Could not reset settings. Check that Capri can save its preferences and try again.',
        );
      }
      await updateSettingsPreview({});
      stopMusicListening();
      const result = {
        alwaysOnTop: saved.alwaysOnTop,
        portrait: presencePinned,
        companion: companionAccess(),
        dimming,
        avatarLayout,
        voiceEffects: voiceEffects.snapshot(),
        speech: speechPreferences.snapshot(),
        initiative: initiativeSettings.snapshot(),
        screenSettings: screenPreferences.snapshot(),
        computerAppearance: computerAppearance.snapshot(),
        musicListening: musicListening.snapshot(),
        settingsVersions: settingsVersions(),
      };
      controlWindowLayer.sync();
      emit({ type: 'window.always-on-top', active: result.alwaysOnTop });
      emit({ type: 'window.portrait', active: result.portrait });
      emit({ type: 'settings.set-portrait', active: result.portrait, preservePresentation: true });
      controlBorder?.configure(result.computerAppearance);
      void syncInitiative().catch(() => observer.publish('failed'));
      await microphone.configurePause(result.speech.trailingSilenceSeconds);
      for (const [type, settings] of [
        ['companion.settings', result.companion],
        ['dimming', result.dimming],
        ['voice.effects', result.voiceEffects],
        ['speech.settings', result.speech],
        ['initiative.settings', result.initiative],
        ['screen.settings', result.screenSettings],
        ['computer.appearance', result.computerAppearance],
      ])
        emit({ type, settings, ...(type === 'companion.settings' ? { reset: true } : {}) });
      emit({ type: 'avatar.layout', layout: result.avatarLayout });
      return result;
    }
    handle('capri:settings-ready', (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      settingsHost.loaded();
      return true;
    });
    handle('capri:settings-loading', (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      settingsHost.loading();
      return true;
    });
    handle('capri:settings-help', (value, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      return settingsHost.setHelp(value);
    });
    handle('capri:settings-rendered', (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      settingsHost.rendered();
      return true;
    });
    handle('capri:window-action', async ({ action, value } = {}, { role }) => {
      if (action === 'leave-frame' || action === 'return-to-frame') {
        if (role !== 'companion') throw new Error('Companion frame required.');
        if (shuttingDown || quitting || sessionLocked || controlBorder || !companionPresent())
          return false;
        if (action === 'return-to-frame') return returnAvatar();
        if (!catalog.animated) return false;
        const frame = frameIds.get(value?.frameId);
        return avatarDetach.leave(value, frame, catalog.canvas, frame && maskFor(frame.id));
      }
      if (action === 'always-on-top' && typeof value === 'boolean') {
        setAlwaysOnTop(value);
      } else if (action === 'reset-position') resetPosition();
      else if (action === 'reset-avatar') resetAvatarLayout();
      else if (action === 'reconnect')
        await (sleepService.phase === 'awake' ? connectBackend() : sleepService.wake());
      else if (action === 'hide') hideCompanionToTray();
      else if (action === 'focus-mode' && (value === undefined || typeof value === 'boolean')) {
        if (value ?? !focusMode) enterFocusMode();
        else if (focusMode) restoreCompanion(role !== 'settings');
        return focusMode;
      } else if (action === 'portrait' && typeof value === 'boolean') {
        setPresencePinned(value);
        emit({ type: 'settings.set-portrait', active: value });
      } else if (action === 'portrait' && value === undefined)
        emit({ type: 'settings.toggle-portrait' });
      else if (action === 'microphone') emit({ type: 'microphone.toggle-request' });
      else if (action === 'quit') await quitAndUnload();
      else if (action === 'sleep') {
        if (
          await confirmations.request({
            title: 'Unload models and sleep?',
            detail: 'Models will be loaded again when you wake Capri.',
            confirmLabel: 'Unload models',
          })
        )
          await sleepService.sleep();
      } else throw new Error('Unsupported window action');
      return true;
    });
    handle('capri:initiative-test', () => {
      initiative.tick(true);
      return initiative.snapshot();
    });
    handle('capri:glitch-preview', (value = {}) => {
      if (
        Object.keys(value).some(
          (key) =>
            !['glitchEnabled', 'glitchStrength', 'glitchIntervalSeconds', 'glitchEvents'].includes(
              key,
            ),
        )
      )
        throw new Error('Invalid glitch preview');
      const settings = validateCompanionSettings({ ...companionPreferences.snapshot(), ...value });
      emit({ type: 'glitch.preview', settings });
      return true;
    });
    handle('capri:glitch-frame', (value) => {
      if (
        !value ||
        !['start', 'timestamp', 'eventAt'].every((k) => Number.isFinite(value[k])) ||
        Math.abs(Date.now() - value.timestamp) > 2000 ||
        !value.settings
      )
        return false;
      settingsHost?.send({ type: 'settings.glitch', ...value });
      return true;
    });
    handle('capri:screen-form-command', async (command) => {
      if (
        !command ||
        !['state', 'refresh', 'select', 'start', 'stop', 'capture', 'ask'].includes(
          command.action,
        ) ||
        Object.keys(command).some(
          (k) => !['action', 'sourceId', 'interval', 'duration', 'question'].includes(k),
        ) ||
        (command.sourceId !== undefined &&
          (typeof command.sourceId !== 'string' || command.sourceId.length > 300)) ||
        (command.question !== undefined &&
          (typeof command.question !== 'string' || command.question.length > 8000)) ||
        (command.interval !== undefined &&
          (!Number.isFinite(command.interval) ||
            command.interval < 15 ||
            command.interval > 300)) ||
        (command.duration !== undefined &&
          (!Number.isFinite(command.duration) || command.duration < 0.5 || command.duration > 120))
      )
        throw new Error('Invalid screen form command');
      if (!window || window.isDestroyed() || !rendererReady)
        throw new Error('Screen interface is not ready.');
      // Fixed local function and JSON data only. Preserve this explicit user gesture for getDisplayMedia.
      return window.webContents.executeJavaScript(
        'window.capriRunScreenCommand(' + JSON.stringify(command) + ')',
        true,
      );
    });
    handle('capri:screen-form-state', (state) => {
      settingsHost?.send({ type: 'settings.screen-state', state: screenFormState(state) });
      return true;
    });
    handle('capri:reminder-retry', (id) => {
      if (!voice.enabled || voice.language === 'off')
        throw new Error('Enable Capri’s voice to hear this reminder.');
      return reminders.retry(id);
    });
    handle('capri:stopwatch-select', (id) => {
      const object = companionActions.time
        .snapshot()
        .find((row) => row.id === id && row.kind === 'stopwatch');
      if (!object) throw new Error('Choose an existing stopwatch');
      emit({ type: 'time.hud-selected', id });
      return true;
    });
    handle('capri:time-status', () => companionActions.time.snapshot());
    handle('capri:time-action', async (value) => {
      const result = await companionActions.time.execute(randomUUID(), value);
      if (value.action === 'cancel') reminders.cancel(result.object?.id ?? value.id);
      return result;
    });
    handle('capri:action-respond', (value) => {
      if (!value || Object.keys(value).some((k) => !['id', 'accepted'].includes(k)))
        throw new Error('Invalid approval.');
      return companionActions.approvals.respond(value.id, value.accepted);
    });
    handle('capri:app-catalog', () => desktopCatalog.apps());
    handle('capri:app-discover', async (value) => {
      if (
        !value ||
        Object.keys(value).some((key) => !['query', 'refresh'].includes(key)) ||
        typeof value.refresh !== 'boolean'
      )
        throw new Error('Invalid application search.');
      ensureDesktopActions();
      return desktopCatalog.discoverForOwner(value.query, value.refresh);
    });
    handle('capri:app-discover-grant', (id) => desktopCatalog.grantDiscovered(id));
    handle('capri:application-access', async (value) => {
      if (value === undefined) return applicationAccess.snapshot();
      if (typeof value !== 'boolean') throw new Error('Invalid application access setting.');
      return applicationAccess.set(value);
    });
    handle('capri:screen-select-source', async (_, { role }) => {
      if (role !== 'companion' || !companionPresent())
        throw new Error('Open Capri to choose a screen source.');
      const sources = await capturePolicy.discover();
      if (!sources.length) return null;
      return new Promise((resolve) => {
        let selected = null;
        Menu.buildFromTemplate(
          sources.map((source) => ({
            label:
              (source.type === 'monitor'
                ? uiText('Monitor', languages.value.interface)
                : uiText('Window', languages.value.interface)) +
              ': ' +
              source.label,
            click: () => {
              selected = source.id;
            },
          })),
        ).popup({ window, callback: () => resolve(selected) });
      });
    });
    handle('capri:app-catalog-add', async () => {
      const result = await dialog.showOpenDialog(
        settingsHost?.window?.isVisible() ? settingsHost.window : window,
        {
          title: uiText('Choose an application', languages.value.interface),
          filters: [{ name: 'Windows application', extensions: ['exe'] }],
          properties: ['openFile', 'dontAddToRecent'],
        },
      );
      if (result.canceled) return desktopCatalog.apps();
      ensureDesktopActions();
      return desktopCatalog.add(result.filePaths[0]);
    });
    handle('capri:app-catalog-update', (value) => desktopCatalog.update(value));
    handle('capri:desktop-journal', () => desktopCatalog.journal());
    handle('capri:file-recovery', () => desktopCatalog.recovery());
    handle('capri:file-purge-recovery', async (id) => {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(id))
        throw new Error('Invalid recovery ID.');
      const row = desktopCatalog.recovery().find((entry) => entry.id === id);
      if (!row) throw new Error('Recovery copy is unavailable.');
      if (
        !(await confirmations.request({
          title: 'Delete recovery copy permanently?',
          detail:
            row.relative +
            '\n\n' +
            uiText(
              'Capri will permanently delete this recovery copy. It cannot be restored through Capri. The Windows Recycle Bin, restored originals and other backups are managed separately.',
              languages.value.interface,
            ),
          confirmLabel: 'Delete permanently',
          danger: true,
          delayMs: 3000,
        }))
      )
        return { ok: true, cancelled: true };
      return desktopCatalog.purgeRecovery(id);
    });
    handle('capri:file-restore', async (id) => {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(id))
        throw new Error('Invalid recovery ID.');
      const row = desktopCatalog.recovery().find((entry) => entry.id === id);
      if (!row) throw new Error('Recovery copy is unavailable.');
      if (
        !(await confirmations.request({
          title: 'Restore this file?',
          detail:
            row.relative +
            '\n\n' +
            uiText(
              'The current folder write permission is required. Existing files are never overwritten.',
              languages.value.interface,
            ),
        }))
      )
        return { ok: true, cancelled: true };
      return desktopCatalog.restore(id);
    });
    handle('capri:screen-settings', (value) => {
      return screenPreferences.set(observationOptions(value));
    });
    handle('capri:spotify-status', () => spotify.snapshot());
    handle('capri:spotify-check', () => {
      if (verification)
        throw new Error('Spotify connection checks are disabled in desktop verification.');
      return spotify.check();
    });
    handle('capri:spotify-access', async (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid Spotify permission.');
      if (verification) throw new Error('Spotify setup is disabled in desktop verification.');
      assertModelIdle();
      if (spotify.busy() || models.busy())
        throw new Error('Wait for the current operation to finish.');
      if (
        !(await confirmations.request({
          title: enabled ? 'Enable Spotify control?' : 'Disable Spotify control?',
          detail:
            'Capri will restart to apply Spotify access. Your history, memory and voice settings will be kept. Only the Spotify desktop app is controlled.',
          confirmLabel: enabled ? 'Enable and restart' : 'Disable and restart',
        }))
      )
        return false;
      assertModelIdle();
      const previous = backendState;
      let stopped = false;
      setBackend('starting', 'Preparing Spotify integration...');
      try {
        await spotify.setEnabled(enabled, {
          beforeCommit: async () => {
            assertModelIdle({ spotifyChange: true });
            await shutdownForRestart('Applying Spotify access...');
            stopped = true;
          },
          restart: () => queueDesktopRelaunch(),
        });
        app.quit();
        return true;
      } catch (error) {
        if (!stopped && !shuttingDown) setBackend(previous.phase, previous.message);
        else {
          shuttingDown = false;
          setBackend('offline', 'Spotify access could not be applied. Reconnect to try again.');
        }
        throw error;
      }
    });
    handle('capri:models-status', () => models.snapshot());
    handle('capri:models-folder', (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings window required.');
      return openLocalModelFolder(root, _value, (folder) => shell.openPath(folder));
    });
    const voiceDeviceLanguage = () => {
      const language = resolveLanguages(liveLanguages()).speech;
      return language && language !== 'off' ? language : 'en';
    };
    handle('capri:model-devices', () => modelDevices.refresh(voiceDeviceLanguage()));
    handle('capri:developer-diagnostics', (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings window required.');
      return developerDiagnostics.snapshot();
    });
    handle('capri:developer-log', (id, { role }) => {
      if (role !== 'settings') throw new Error('Settings window required.');
      return developerDiagnostics.read(id);
    });
    handle('capri:developer-open-logs', async (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings window required.');
      const error = await shell.openPath(await developerDiagnostics.folder());
      if (error) throw new Error('The logs folder is not available yet.');
      return true;
    });
    handle('capri:model-devices-apply', async (value) => {
      if (verification) throw Error('Model changes are disabled in desktop verification.');
      assertModelIdle();
      const selected = await modelDevices.validate(value, voiceDeviceLanguage());
      const current = modelDevices.current();
      if (selected.language === current.language && selected.voice === current.voice) return false;
      if (
        !(await confirmations.request({
          title: 'Model devices',
          detail:
            'Capri will restart with the prepared model. Your conversation, memory, voice and personal settings will be kept.',
          confirmLabel: 'Save and restart Capri',
        }))
      )
        return false;
      assertModelIdle();
      await shutdownForRestart('Preparing to restart Capri...');
      let restore, inferenceChange;
      try {
        restore = modelDevices.save(selected);
        inferenceChange = saveInferenceSettings({
          root,
          rt,
          overrides: { acceleration: selected.language === 'cpu' ? 'cpu' : 'auto' },
        });
        queueDesktopRelaunch();
      } catch (error) {
        inferenceChange?.restore();
        restore?.();
        shuttingDown = false;
        setBackend('offline', 'Reconnect to try again.');
        throw error;
      }
      app.quit();
      return true;
    });
    handle('capri:models-refresh', () => models.refresh());
    handle('capri:models-cancel', () => models.cancel());
    handle('capri:models-prepare', (id) => {
      if (verification) throw new Error('Model downloads are disabled in desktop verification.');
      if (
        shuttingDown ||
        updates.busy() ||
        spotify.busy() ||
        speechInstaller.busy() ||
        huggingface.busy() ||
        voiceCatalog.busy() ||
        voiceTraining.busy()
      )
        throw new Error('Wait for the current operation to finish.');
      return models.prepare(id);
    });
    const assertModelIdle = ({ spotifyChange = false } = {}) => {
      if (speechInstaller.busy())
        throw new Error('Wait for speech installation to finish, or cancel it in Languages.');
      if (
        shuttingDown ||
        currentChatTask ||
        chat.active ||
        visualTurn ||
        backendPromise ||
        updates.busy() ||
        huggingface.busy() ||
        voiceCatalog.busy() ||
        voiceTraining.busy() ||
        models.busy() ||
        (!spotifyChange && spotify.busy())
      )
        throw new Error('Wait for the current reply or operation to finish.');
    };
    handle('capri:huggingface-status', () => huggingface.refresh());
    handle('capri:huggingface-search', (value) => huggingface.search(value));
    handle('capri:huggingface-inspect', (repository) => huggingface.inspect(repository));
    handle('capri:huggingface-plan', (selection) => huggingface.plan(selection));
    handle('capri:huggingface-cancel', () => huggingface.cancel());
    handle('capri:huggingface-install', () => {
      if (verification) throw new Error('Model downloads are disabled in desktop verification.');
      assertModelIdle();
      return huggingface.install();
    });
    handle('capri:huggingface-remove', async (id) => {
      assertModelIdle();
      if (
        await confirmations.request({
          title: 'Remove downloaded model?',
          detail: 'The selected Hugging Face package will be removed from this PC.',
          confirmLabel: 'Remove',
        })
      ) {
        assertModelIdle();
        return huggingface.remove(id);
      }
      return huggingface.snapshot();
    });
    handle('capri:huggingface-repair', (id) => {
      if (verification) throw new Error('Model downloads are disabled in desktop verification.');
      assertModelIdle();
      return huggingface.repair(id);
    });
    handle('capri:huggingface-token-save', async (token) => {
      await hfCredentials.save(token);
      return huggingface.refresh();
    });
    handle('capri:huggingface-token-remove', async () => {
      huggingface.cancel();
      await hfCredentials.remove();
      return huggingface.refresh();
    });
    handle('capri:voice-catalog', () => voiceCatalog.snapshot());
    handle('capri:voice-model-select', async (selection) => {
      assertModelIdle();
      const result = await voiceCatalog.select(selection);
      voiceAvailable = verification || companionVoiceInstalled();
      voiceAllowed =
        voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
      if (voice.enabled) void connectVoice();
      return result;
    });
    handle('capri:voice-model-install', (selection) => {
      if (verification) throw new Error('Voice downloads are disabled in desktop verification.');
      assertModelIdle();
      return voiceCatalog.install(selection);
    });
    handle('capri:voice-model-install-cancel', () => voiceCatalog.cancel());
    handle('capri:voice-training-status', () => voiceTraining.snapshot());
    handle('capri:voice-training-import', async () => {
      if (verification)
        throw new Error('Voice dataset import is disabled in desktop verification.');
      assertModelIdle();
      const result = await dialog.showOpenDialog(
        settingsHost?.window?.isVisible() ? settingsHost.window : window,
        {
          title: uiText(
            'Choose reviewed Capri recordings (metadata.csv and WAV)',
            languages.value.interface,
          ),
          properties: ['openDirectory', 'dontAddToRecent'],
        },
      );
      if (result.canceled) return voiceTraining.snapshot();
      assertModelIdle();
      return voiceTraining.importDataset({ source: result.filePaths[0] });
    });
    handle('capri:voice-training-start', (selection) => {
      if (verification) throw new Error('Voice training is disabled in desktop verification.');
      assertModelIdle();
      return voiceTraining.start(selection);
    });
    handle('capri:voice-training-cancel', () => voiceTraining.cancel());
    handle('capri:voice-training-preview', () => voiceTraining.preview());
    handle('capri:voice-training-apply', async () => {
      assertModelIdle();
      return voiceTraining.apply();
    });
    const inferenceStatus = async () => {
      const status = await inferenceApi.status();
      return {
        ...status,
        localModel: localModelName,
        localResidency: await localResidency.sample({
          model: settings.model,
          remote: Boolean(status.activeId || status.setupRequired || rt.remote.enabled),
          available: !verification && !shuttingDown,
        }),
        startup: inferenceStartup.snapshot(),
      };
    };
    handle('capri:inference-api-status', inferenceStatus);
    handle('capri:inference-startup-set', async (value, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible())
        throw new Error('Open Settings to change model startup.');
      inferenceStartup.set(value);
      return inferenceStatus();
    });
    handle('capri:inference-api-save', async (value) => {
      if (typeof value?.id !== 'string' || value.id !== inferenceApi.activeProfileId())
        return inferenceApi.saveProfile(value);
      if (verification) throw new Error('API switching is disabled in desktop verification.');
      assertModelIdle();
      const next = apiSettings(value.settings);
      if (
        !(await confirmations.request({
          title: 'Change AI provider?',
          detail: isLocalApiEndpoint(new URL(next.baseUrl))
            ? 'Capri will send requests to the selected server on this PC and restart.'
            : 'Your conversation, personality, relevant memory and tool results will be sent to this provider. Images are sent only with enabled vision and screen features. Provider charges may apply. Capri will restart.',
          confirmLabel: 'Apply and restart',
        }))
      )
        return false;
      assertModelIdle();
      let previousFiles = [];
      let shutdownStarted = false;
      let filesTouched = false;
      let savedId;
      try {
        savedId = await inferenceApi.saveProfile(value, async () => {
          assertModelIdle();
          previousFiles = [inferenceApi.profilesFile, inferenceApi.settingsFile].map((file) => ({
            file,
            value: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined,
          }));
          shutdownStarted = true;
          await shutdownForRestart('Preparing to restart Capri...');
          filesTouched = true;
        });
        await inferenceApi.selectProfile(savedId);
        queueDesktopRelaunch();
      } catch (error) {
        const rollbackErrors = [];
        if (filesTouched)
          for (const { file, value: previous } of previousFiles)
            try {
              if (previous !== undefined) writeJsonAtomic(file, previous);
              else if (existsSync(file)) unlinkSync(file);
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError);
            }
        if (shutdownStarted) {
          shuttingDown = false;
          setBackend('offline', 'Reconnect to try again.');
        }
        if (rollbackErrors.length)
          throw new AggregateError([error, ...rollbackErrors], 'Reconnect to try again.');
        throw error;
      }
      app.quit();
      return savedId;
    });
    handle('capri:inference-api-test', (id) => {
      if (verification) throw new Error('API testing is disabled in desktop verification.');
      return inferenceApi.testProfile(id);
    });
    handle('capri:inference-api-use', async (id) => {
      if (verification) throw new Error('API switching is disabled in desktop verification.');
      assertModelIdle();
      if (
        id === inferenceApi.activeProfileId() &&
        (id !== null || !rt.remote.enabled) &&
        !rt.remote.setupRequired
      )
        return false;
      const next = id !== null ? inferenceApi.profile(id).settings : null;
      if (
        !(await confirmations.request({
          title: 'Change AI provider?',
          detail: next
            ? isLocalApiEndpoint(new URL(next.baseUrl))
              ? 'Capri will send requests to the selected server on this PC and restart.'
              : 'Your conversation, personality, relevant memory and tool results will be sent to this provider. Images are sent only with enabled vision and screen features. Provider charges may apply. Capri will restart.'
            : 'Capri will restart using your downloaded local language model.',
          confirmLabel: 'Apply and restart',
        }))
      )
        return false;
      assertModelIdle();
      const previousApi = readApiSettings(root);
      let selectionTouched = false;
      try {
        await shutdownForRestart('Preparing to restart Capri...');
        selectionTouched = true;
        await inferenceApi.selectProfile(id);
        queueDesktopRelaunch();
      } catch (error) {
        if (selectionTouched) writeJsonAtomic(inferenceApi.settingsFile, previousApi);
        shuttingDown = false;
        setBackend('offline', 'Reconnect to try again.');
        throw error;
      }
      app.quit();
      return true;
    });
    handle('capri:inference-api-remove', async (id) => {
      inferenceApi.profile(id);
      if (
        await confirmations.request({
          title: 'Remove API connection?',
          detail: 'Its saved API key will be removed from this PC.',
          confirmLabel: 'Remove',
        })
      )
        inferenceApi.removeProfile(id);
      return inferenceStatus();
    });
    handle('capri:computer-access-status', () => ({
      ...fullComputerAccess.snapshot(),
      paused: !applicationAccess.enabled,
    }));
    handle('capri:computer-access-set', (enabled) => {
      if (enabled) applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      return fullComputerAccess.configure(enabled);
    });
    handle('capri:computer-task-status', () => computerAgent.snapshot());
    handle('capri:computer-appearance', () => computerAppearance.snapshot());
    handle('capri:computer-appearance-set', (value) => {
      const saved = computerAppearance.set(value);
      controlBorder?.configure(saved);
      emit({ type: 'computer.appearance', settings: saved });
      return saved;
    });
    handle('capri:computer-preview', async (value) => {
      if (computerControl.session || shuttingDown)
        throw new Error('Stop computer control before previewing its effects.');
      const preview = new ControlOverlay({ BrowserWindow, screen, owner: window });
      preview.configure(
        value === undefined ? computerAppearance.snapshot() : computerPreferences(value),
      );
      try {
        await preview.show(
          `${uiText('Computer control', languages.value.interface)} // ${uiText('Preview', languages.value.interface)} · 3 s`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } finally {
        preview.hide();
      }
      return true;
    });
    handle('capri:computer-task', async (text) => {
      applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      if (!fullComputerAccess.snapshot().enabled)
        throw new Error('Enable Full computer access in Settings → Computer control first.');
      return submitMessage({ id: randomUUID(), text, mode: 'computer' }, 'text');
    });
    handle('capri:discord-status', () => discordPresence.snapshot());
    handle('capri:discord-configure', (value) => discordPresence.configure(value));
    handle('capri:discord-portal', () =>
      shell.openExternal('https://discord.com/developers/applications'),
    );
    handle('capri:models-apply', async () => {
      if (verification) throw new Error('Model changes are disabled in desktop verification.');
      assertModelIdle();
      if (!models.prepared || models.busy()) throw new Error('Prepare the selected model first.');
      if (
        !(await confirmations.request({
          title: 'Switch language model?',
          detail:
            'Capri will restart with the prepared model. Your conversation, memory, voice and personal settings will be kept.',
          confirmLabel: 'Switch model and restart',
        }))
      )
        return false;
      assertModelIdle();
      const previousApi = readApiSettings(root);
      const applied = await models.apply(async (profile) => {
        let change;
        let selectionTouched = false;
        try {
          await shutdownForRestart('Switching language model...');
          change = saveModelProfile({
            root,
            rt: rt.remote.enabled
              ? { ...rt, remote: { enabled: false }, inferenceUrl: rt.ollamaUrl }
              : rt,
            id: profile.id,
            hardware: models.device,
            importedProfiles: await importedProfiles(),
          });
          if (previousApi.enabled || previousApi.setupRequired) {
            selectionTouched = true;
            await inferenceApi.selectProfile(null);
          }
          queueDesktopRelaunch();
        } catch (error) {
          change?.restore();
          if (selectionTouched) writeJsonAtomic(inferenceApi.settingsFile, previousApi);
          shuttingDown = false;
          setBackend('offline', 'The model could not be changed. Reconnect to try again.');
          throw error;
        }
      });
      if (applied) app.quit();
      return applied;
    });
    handle('capri:context-apply', async (tokens) => {
      validateContextChoice(tokens, settings);
      if (verification) throw new Error('Model changes are disabled in desktop verification.');
      assertModelIdle();
      if (tokens === settings.contextTokens) return false;
      if (
        !(await confirmations.request({
          title: 'Context window',
          detail:
            'Capri will restart with the prepared model. Your conversation, memory, voice and personal settings will be kept.',
          confirmLabel: 'Apply and restart',
        }))
      )
        return false;
      assertModelIdle();
      await shutdownForRestart('Preparing to restart Capri...');
      let change;
      try {
        change = saveContextWindow({ root, rt, contextTokens: tokens });
        queueDesktopRelaunch();
      } catch (error) {
        change?.restore();
        shuttingDown = false;
        setBackend('offline', 'The model could not be changed. Reconnect to try again.');
        throw error;
      }
      app.quit();
      return true;
    });
    handle('capri:update-status', () => updates.snapshot());
    handle('capri:update-remind-later', () => updates.remindLater());
    handle('capri:github-status', () => githubAccess.status());
    handle('capri:github-connect', (value) => {
      if (verification)
        throw new Error('GitHub authentication is disabled in desktop verification.');
      updates.cancelStartup();
      return githubAccess.connect(value);
    });
    handle('capri:github-remove', async () => {
      updates.cancelStartup();
      const status = await githubAccess.remove();
      updates.remindLater();
      return status;
    });
    handle('capri:github-token-page', async (kind) => {
      const url = githubTokenUrl(kind);
      if (!verification) await shell.openExternal(url);
      return true;
    });
    handle('capri:update-settings', (value) => updates.setSettings(value));
    handle('capri:update-check', (value) => updates.check(value));
    handle('capri:update-download', () => updates.prepare());
    handle('capri:update-cancel', () => updates.cancel());
    handle('capri:update-install', async () => {
      assertIdle({ requireBackend: false });
      if (
        models.busy() ||
        spotify.busy() ||
        speechInstaller.busy() ||
        huggingface.busy() ||
        voiceTraining.busy() ||
        voiceCatalog.busy()
      )
        throw new Error('Wait for the current operation to finish.');
      if (verification) throw new Error('Installing updates is disabled in desktop verification.');
      const managed = updates.mode === 'managed';
      const fullInstaller = Boolean(updates.prepared?.executable);
      if (
        !(await confirmations.request({
          title:
            managed && !fullInstaller ? 'Install this update?' : 'Open the downloaded installer?',
          detail:
            managed && fullInstaller
              ? 'Capri will close and open the full installer. Select this installation folder to keep your data.'
              : managed
                ? 'Capri will close and install the verified update. Your history, memory, models and personal settings will be kept.'
                : 'The installer will open. Choose a separate managed installation; this development checkout will be kept.',
          confirmLabel: managed && !fullInstaller ? 'Restart and update' : 'Open installer',
        }))
      )
        return false;
      assertIdle({ requireBackend: false });
      if (models.busy() || spotify.busy())
        throw new Error('Wait for the current operation to finish.');
      const installed = await updates.install({
        parentPid: process.pid,
        language: languages.value.interface,
        shutdown: () => shutdownForRestart('Preparing to restart Capri...'),
      });
      if (installed && managed) app.quit();
      return installed;
    });
    handle('capri:confirmation', (value) => confirmations.respond(value));
    const assertIdle = ({ requireBackend = true } = {}) => {
      if (
        shuttingDown ||
        currentChatTask ||
        chat.active ||
        visualTurn ||
        (requireBackend && backendState.phase !== 'ready')
      )
        throw new Error('Wait for the current reply to finish.');
    };
    let maintenance = false;
    handle('capri:user-tool', async (value, { role }) => {
      if (
        role !== 'settings' ||
        sessionLocked ||
        shuttingDown ||
        (value?.action !== 'status' && !settingsHost?.window?.isVisible())
      )
        throw new Error('Open User tools in Settings.');
      if (
        !value ||
        Object.keys(value).some(
          (key) => !['action', 'id', 'enabled', 'parameters', 'settings'].includes(key),
        )
      )
        throw new Error('Invalid user-tool action.');
      if (value.action === 'status') return userTools.list();
      if (value.action === 'open') {
        await shell.openPath(userTools.folder);
        return true;
      }
      if (value.action === 'refresh') return userTools.refresh();
      if (value.action === 'enable') return userTools.enable(value.id, value.enabled);
      if (value.action === 'settings') return userTools.saveSettings(value.id, value.settings);
      if (value.action === 'inputs') {
        const selected = await dialog.showOpenDialog(settingsHost.window, {
          title: uiText('Choose input files', languages.value.interface),
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
        });
        return selected.canceled ? { count: 0 } : userTools.inputs(value.id, selected.filePaths);
      }
      if (value.action === 'stop') {
        userTools.cancel();
        return true;
      }
      if (value.action === 'test') return userTools.run(value.id, value.parameters ?? {});
      if (value.action === 'example') return userTools.example();
      throw new Error('Invalid user-tool action.');
    });
    handle('capri:workflow', async (value, { role }) => {
      if (
        role !== 'settings' ||
        sessionLocked ||
        shuttingDown ||
        (value?.action !== 'status' && !settingsHost?.window?.isVisible())
      )
        throw new Error('Open Task training in Settings.');
      if (
        !value ||
        Object.keys(value).some((key) => !['action', 'workflow', 'id', 'variables'].includes(key))
      )
        throw new Error('Invalid workflow action.');
      if (value.action === 'status')
        return {
          status: workflows.snapshot(),
          workflows: workflows.list(),
          draft: structuredClone(workflows.draft),
        };
      if (value.action === 'record') {
        if (!applicationAccess.enabled) throw new Error('Enable application access first.');
        return workflows.start();
      }
      if (value.action === 'stop') {
        workflows.cancel();
        return { steps: await workflows.stopRecording() };
      }
      if (value.action === 'save') return workflows.save(value.workflow);
      if (value.action === 'remove') return workflows.remove(value.id);
      if (value.action === 'run') {
        if (chat.active) throw new Error('Wait for the current reply to finish.');
        return workflows.run(value.id, value.variables ?? {});
      }
      throw new Error('Invalid workflow action.');
    });
    const respondPrivately = privateDialogue({
      url: rt.inferenceUrl,
      model: () => settings.model,
      params: () => auxiliaryRunnerParams,
      remote: () => rt.remote.enabled,
      fetchImpl: (url, options) =>
        rt.remote.enabled ? inferenceApi.localFetch(url, options) : fetch(url, options),
      prepare: async (signal) => {
        if (backendState.phase !== 'ready') throw new Error('Wait for Capri to connect.');
        if (!rt.remote.enabled)
          await ensureLanguageModelReady(
            {
              url: rt.inferenceUrl,
              model: settings.model,
              modelCapabilities: settings.modelCapabilities,
              contextTokens: settings.contextTokens,
              keepAlive: settings.keepAlive ?? -1,
              acceleration: settings.acceleration,
              cpuThreads: settings.cpuThreads,
            },
            { signal },
          );
      },
    });
    handle('capri:private-memory', async (value, { role }) => {
      if (
        role !== 'settings' ||
        (value?.action !== 'status' && !settingsHost?.window?.isVisible()) ||
        sessionLocked ||
        shuttingDown
      )
        throw new Error('Open private memory in Settings.');
      if (
        !value ||
        Object.keys(value).some(
          (key) => !['action', 'password', 'oldPassword', 'text', 'id', 'allowApi'].includes(key),
        )
      )
        throw new Error('Invalid private-memory action.');
      if (value.action === 'status') return privateMemory.snapshot();
      if (value.action === 'lock') {
        privateMemory.lock();
        return privateMemory.snapshot();
      }
      if (value.action === 'create' || value.action === 'unlock')
        return privateMemory.unlock(value.password, { create: value.action === 'create' });
      if (value.action === 'list') return privateMemory.list();
      if (value.action === 'add') return privateMemory.add(value.text);
      if (value.action === 'remove') return privateMemory.remove(value.id);
      if (value.action === 'password')
        return privateMemory.changePassword(value.oldPassword, value.password);
      if (value.action === 'chat')
        return privateMemory.chat(value.text, respondPrivately, {
          allowApi: value.allowApi === true,
        });
      throw new Error('Invalid private-memory action.');
    });
    handle('capri:brain', async (value, { role }) => {
      if (
        role !== 'settings' ||
        (value?.action !== 'status' && !settingsHost?.window?.isVisible()) ||
        sessionLocked ||
        shuttingDown
      )
        throw new Error('Open Brain in Settings.');
      if (
        !value ||
        Object.keys(value).some(
          (key) => !['action', 'enabled', 'shareWithApi', 'query'].includes(key),
        )
      )
        throw new Error('Invalid Brain action.');
      if (value.action === 'status') return brain.snapshot();
      if (value.action === 'open') {
        await shell.openPath(brain.folder);
        return true;
      }
      if (value.action === 'refresh') return brain.refresh();
      if (value.action === 'search') return brain.search(value.query);
      if (value.action === 'configure')
        return brain.configure({ enabled: value.enabled, shareWithApi: value.shareWithApi });
      throw new Error('Invalid Brain action.');
    });
    handle('capri:memory-save', async (value, { role }) => {
      if (
        role !== 'settings' ||
        !settingsHost?.window?.isVisible() ||
        sessionLocked ||
        shuttingDown ||
        maintenance
      )
        throw new Error('Open Memory controls in Settings.');
      if (typeof value !== 'string') throw new Error('Enter a memory to save.');
      return saveOwnerNote(rt.workspace, value.trim());
    });
    handle('capri:saved-memory', async (value, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible() || value !== undefined)
        throw new Error('Open Memory controls in Settings.');
      if (sessionLocked || shuttingDown || maintenance)
        return { items: [], truncated: false, unavailable: true };
      try {
        return await readSavedMemory(rt.workspace);
      } catch {
        // A private path or memory content must never enter a renderer error/diagnostic.
        throw new Error('Saved memories could not be loaded. Try again.');
      }
    });
    const confirmReset = async (memory) => {
      assertIdle();
      if (maintenance) return false;
      maintenance = true;
      try {
        const confirmed = await confirmations.request({
          title: memory ? 'Delete saved notes about you?' : 'Start a new conversation?',
          detail: memory
            ? 'USER.md, MEMORY.md and notes in memory will be cleared. Conversation archives remain separate. This cannot be undone.'
            : 'Current context and the visible history will be cleared. Long-term memory is retained.',
          confirmLabel: 'Clear',
          danger: true,
        });
        if (!confirmed) return false;
        assertIdle();
        microphone.stop();
        voice.cancel();
        initiative.cancel();
        if (memory) {
          setBackend('starting', 'Updating shared memory…');
          metadataRpc.stop();
          await stopManaged(rt.logPrefix);
          try {
            await clearSavedMemory(rt);
          } finally {
            await connectBackend();
          }
        } else {
          await metadataRpc.call('sessions.reset', { key: chatSessionKey, reason: 'new' });
          contextSampler.invalidate();
          attachmentViewer?.close();
          attachmentDrafts.clear();
          store.clear();
          attachmentHistory.clear();
          emit({ type: 'conversation.cleared' });
        }
        return true;
      } finally {
        maintenance = false;
      }
    };
    const companionAccess = registerCompanionIpc(handle, {
      root,
      state,
      rt,
      preferences: companionPreferences,
      currentSettings: liveCompanionSettings,
      dialog: localizedDialog(dialog, (text) => uiText(text, languages.value.interface)),
      getWindow: () => (settingsHost?.window?.isVisible() ? settingsHost.window : window),
      emit,
      shell,
      assertIdle,
      prepareVoice: async () => {
        if (!voice.enabled || voice.language === 'off')
          throw Object.assign(new Error(VOICE_REQUIRED_MESSAGE), { code: 'CAPRI_VOICE_DISABLED' });
        await connectVoice();
        if (!voice.ready) throw new Error('The voice is unavailable. Enable it and retry.');
      },
      voiceUrl: companionVoiceUrl(),
      voiceHeaders: companionVoiceHeaders,
      wakeLanguage: () => (voice.language === 'off' ? 'en' : voice.language),
      wakeIdentity: () => {
        const config = companionVoiceSettings();
        try {
          return (
            config.profileDir +
            ':' +
            JSON.parse(
              readFileSync(path.join(root, config.profileDir, 'voice-profile.json'), 'utf8'),
            ).adapterSha256
          );
        } catch {
          return config.profileDir;
        }
      },
      translateWake: (text, language) => uiText(text, language),
      resetContext: () => confirmReset(false),
      resetMemory: () => confirmReset(true),
      diagnosticRoot: verification ? verificationFolder : root,
      verification,
      diagnosticResources: verification
        ? undefined
        : () =>
            probeResourceUsage({
              model: rt.remote.enabled ? null : settings.model,
              readModels: () =>
                request(`${rt.ollamaUrl}/api/ps`, { timeout: 2000, maxBytes: 128 * 1024 }),
              readProcess: () => processLoad.sample(),
            }),
      diagnosticSnapshot: () => ({
        artwork: installedAvatar.diagnostics,
        response: chat.diagnostics(),
        inferenceTransport: inferenceApi.diagnostics(),
        visualResponse,
        modelStartup: { sequential: responseTiming.sequentialModels },
        backend: backendState,
        startup: startup.snapshot(),
        github: githubAccess.diagnostics(),
        updates: updates.snapshot(),
        settingsWindow: settingsHost?.snapshot(),
        discordPresence: {
          phase: discordPresence.phase,
          enabled: discordPresence.snapshot().enabled,
        },
        spotify: spotify.snapshot(),
        confirmationPending: Boolean(confirmations.pending),
        desktopActions: companionActions.broker.diagnostics(),
        applicationAccess: {
          fullComputerAccess: fullComputerAccess.enabled,
          grants: desktopCatalog
            .apps()
            .map(({ launch, inspect, text }) => ({ launch, inspect, text })),
        },
        computerTask: computerAgent.diagnostics(),
        screenCapture: capturePolicy.diagnostics(),
        screenObservation: (() => {
          const { source, ...state } = screenObservation.snapshot();
          return state;
        })(),
        voice: voice.diagnostics(),
        musicListening: musicListening.snapshot(),
        callAudio: callAudioDiagnostics.snapshot({
          ...callAudioSnapshot(),
          setup: callSetup.diagnostics(),
          voiceEnabled: voice.enabled && voice.language !== 'off',
        }),
        speechInstallation: speechInstaller.snapshot(),
        voiceResidency: mutedVoiceResidency.diagnostics(),
        voiceInstalled: voiceAvailable,
        voiceAllowed,
        lastVoiceFailure,
        languages: languages.snapshot(),
        recognition: {
          performance: microphone.diagnostics(),
          available: asrInstalled,
          language: asrConfig.language,
          enabled: Boolean(microphone.capture),
          status: microphone.status,
        },
        inference: {
          provider: rt.remote.enabled ? 'external-api' : 'local',
          model: rt.remote.enabled ? rt.remote.model : settings.model,
          modelCapabilities: settings.modelCapabilities,
          resourceProfile: settings.resourceProfile,
          acceleration: settings.acceleration,
          cpuThreads: settings.cpuThreads,
          contextTokens: rt.remote.enabled ? rt.remote.contextTokens : settings.contextTokens,
          keepAlive: settings.keepAlive,
        },
        window:
          window?.isDestroyed() === false
            ? {
                bounds: window.getBounds(),
                scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
              }
            : null,
        audioPlayback: { busy: playbackBusy },
        rendererDiagnostics,
      }),
      voiceHealth: () =>
        request(`${companionVoiceUrl()}/health`, {
          headers: companionVoiceHeaders(),
          timeout: 2500,
        }),
    });
    prepareWakeAudio = companionAccess.prepareWakeVoice;
    handle('capri:startup-intro', (action, { role }) => {
      if (role !== 'companion') throw new Error('Startup presentation belongs to the companion.');
      return startupIntroGate.claim(action);
    });
    handle('capri:bootstrap', (_value, { role }) => {
      if (role === 'companion') rendererReady = true;
      return {
        attachmentVision: screenVisionAvailable,
        thinking: { enabled: thinkingMode },
        internet: { enabled: internetMode },
        time: companionActions.time.snapshot(),
        inference: {
          remote: rt.remote.enabled,
          vision: rt.remote.vision,
          setupRequired: rt.remote.setupRequired,
          model: rt.remote.enabled ? rt.remote.model : localModelName,
          ...(rt.remote.enabled ? { providerHost: new URL(rt.remote.baseUrl).hostname } : {}),
        },
        windowSettings: { alwaysOnTop: saved.alwaysOnTop !== false, focusMode, avatarOnly },
        settingsVersions: settingsVersions(),
        screenSettings: screenPreferences.snapshot(),
        spotify: spotify.snapshot(),
        models: models.snapshot(),
        updates: updates.snapshot(),
        messages: store.snapshot(),
        companion: companionPreferences.snapshot(),
        startup: startup.snapshot(),
        backend: backendState,
        power: { phase: sleepService.phase },
        warning:
          [
            installedAvatar.warning,
            !voiceAvailable && resolveLanguages(languages.value).speech !== 'off'
              ? ENGLISH_VOICE_SETUP_MESSAGE
              : null,
            store.warning,
            reminders?.warning,
          ]
            .filter(Boolean)
            .join('\n') || null,
        artwork: installedAvatar.diagnostics,
        activeTurnId: chat.active?.id ?? visualTurn?.id ?? null,
        language: languageName(languages.value.conversation),
        sprite: catalog.canvas,
        avatars: catalog.publicSprites(),
        animation: catalog.publicAnimation(),
        musicArtwork: catalog.publicMusic(),
        musicListening: musicListening.snapshot(),
        startupIntro: startupIntroGate.pending ? startupIntroSnapshot(startupIntroPack) : null,
        avatar: avatar.snapshot(),
        avatarLayout,
        dimming,
        voice: voice.snapshot(),
        speech: speechPreferences.snapshot(),
        microphone: {
          ...microphone.snapshot(),
          ...audioInputs.snapshot(),
          available: asrAllowed && asrInstalled,
        },
        presence: { pinned: presencePinned },
        voiceEffects: voiceEffects.snapshot(),
        allowModelCallAudio: callAudioPolicy.value.allowModel,
        callVoiceVolume: callAudioPolicy.value.callVoiceVolume,
        languages: languages.snapshot(),
        languagePacks: LANGUAGE_PACKS,
        recognitionAvailability: recognitionAvailability(),
        speechAvailability: Object.fromEntries(
          LANGUAGE_PACKS.map((p) => [p.id, speechInstalled(p.id)]),
        ),
        speechInstallation: speechInstaller.snapshot(),
        fileAccess: fileAccessSnapshot(),
        applications: applications.snapshot(),
        applicationAccess: applicationAccess.snapshot(),
        initiative: initiativeSettings.snapshot(),
        awareness: { ...observer.snapshot(), scheduling: initiative.snapshot() },
        screen: capturePolicy.snapshot(),
        screenObservation: screenObservation.snapshot(),
        lastScreenshot,
      };
    });
    handle('capri:send', (value) => submitMessage(value));
    handle('capri:response-painted', (value) => {
      if (!value || Object.keys(value).some((key) => !['id', 'elapsedMs'].includes(key)))
        return false;
      return acknowledgeResponsePaint(value.id, value.elapsedMs);
    });
    handle('capri:thinking-mode-set', (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid thinking mode');
      thinkingMode = enabled;
      const settings = { enabled };
      emit({ type: 'thinking.settings', settings });
      return settings;
    });
    handle('capri:internet-mode-set', (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid internet mode');
      if (currentChatTask || chat.active) throw new Error('Wait for the current reply to finish.');
      internetMode = enabled;
      const settings = { enabled };
      emit({ type: 'internet.settings', settings });
      return settings;
    });
    handle('capri:web-source-open', async (value, { role }) => {
      if (
        sessionLocked ||
        shuttingDown ||
        role !== 'companion' ||
        !value ||
        typeof value.turnId !== 'string' ||
        !/^[a-f0-9-]{36}$/iu.test(value.turnId) ||
        !Number.isInteger(value.index) ||
        value.index < 0 ||
        value.index > 4 ||
        Object.keys(value).some((key) => !['turnId', 'index'].includes(key))
      )
        throw new Error('Web search is unavailable.');
      const message = store
        .snapshot()
        .find((item) => item.role === 'assistant' && item.turnId === value.turnId);
      const source = webSources(message?.webSources)[value.index];
      if (!source) throw new Error('Web search is unavailable.');
      if (!verification) await shell.openExternal(source.url);
      return true;
    });
    handle('capri:attachment-add', (value, { frame }) => attachmentDrafts.add(value, frame));
    handle('capri:attachment-remove', (id, { frame }) => attachmentDrafts.remove(id, frame));
    handle('capri:attachment-send', (value, { frame }) => {
      const input = thinkingInput(value);
      if (shuttingDown || backendState.phase !== 'ready' || currentChatTask || chat.active)
        throw new Error('The conversation is busy');
      const attachments = attachmentDrafts.take(value.attachmentIds, frame, {
        includeMetadata: true,
      });
      if (!attachments)
        return { accepted: false, message: 'Attach the files again for the active model.' };
      return submitVisualTurn(input, {
        source: { kind: 'attachment', label: 'Attachment', capturedAt: Date.now() },
        attachments,
      });
    });
    handle('capri:attachment-open', (id) => attachmentViewer.open(id));
    handle('capri:speech-availability', () =>
      Object.fromEntries(LANGUAGE_PACKS.map((p) => [p.id, speechInstalled(p.id)])),
    );
    handle('capri:speech-install-status', () => speechInstaller.snapshot());
    handle('capri:speech-install-cancel', () => speechInstaller.cancel());
    handle('capri:speech-install', (selection) => {
      if (verification) throw new Error('Speech downloads are disabled in desktop verification.');
      if (
        shuttingDown ||
        currentChatTask ||
        chat.active ||
        visualTurn ||
        updates.busy() ||
        models.busy() ||
        huggingface.busy() ||
        voiceTraining.busy() ||
        voiceCatalog.busy() ||
        spotify.busy()
      )
        throw new Error('Wait for the current reply or operation to finish.');
      return speechInstaller.start(selection);
    });
    registerScreenIpc(handle, {
      root,
      screenVisionAvailable,
      capturePolicy,
      screenObservation,
      screenPreviews,
      clipFrames,
      screenshots,
      openPath: (file) => shell.openPath(file),
      validImage: (bytes) => !nativeImage.createFromBuffer(bytes).isEmpty(),
      canSubmit: () =>
        !shuttingDown && backendState.phase === 'ready' && !currentChatTask && !chat.active,
      getVisualTurn: () => visualTurn,
      cancelVisual,
      submitSnapshot,
    });
    registerAccessIpc(handle, {
      dialog: localizedDialog(dialog, (text) => uiText(text, languages.value.interface)),
      getWindow: () => (settingsHost?.window?.isVisible() ? settingsHost.window : window),
      getInterfaceLanguage: () => languages.value.interface,
      filePermissions,
      fileAccessSnapshot,
      applications,
      ensureDesktopActions,
      emit,
    });
    handle('capri:initiative', async (value) => {
      const settings = initiativeSettings.set(value);
      emit({ type: 'initiative.settings', settings });
      try {
        await syncInitiative();
      } catch (error) {
        if (error.name !== 'AbortError') {
          observer.publish('failed');
          emit({
            type: 'initiative.error',
            message: 'App awareness could not start. Apply its settings to try again.',
          });
        }
      }
      return settings;
    });
    handle('capri:initiative-dismiss', () => {
      initiative.dismiss();
      if (voice.turn?.id === latestInitiativeTurnId) voice.cancel();
      return true;
    });
    handle('capri:initiative-restore', () => {
      initiative.restore();
      return true;
    });
    handle('capri:activity', () => {
      initiative.activity();
      screenObservation.activity();
      return true;
    });
    handle('capri:playback-state', (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid playback state');
      callAudioDiagnostics.playback(value, voice.turn?.id);
      playbackBusy = value;
      for (const listener of [...reminderListeners])
        listener({ type: 'playback.state', busy: value });
      settingsHost?.send({
        type: 'settings.activity',
        chat: Boolean(chat.active || currentChatTask),
        playback: value,
      });
      if (!value) resumeFollowUp();
      if (value) screenObservation.activity();
      return true;
    });
    handle('capri:interface-busy', (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid interface state');
      interfaceBusy = value || Boolean(settingsHost?.window?.isVisible());
      if (value) {
        initiative.cancel();
        avatarClickReactions.cancel();
      }
      return true;
    });
    handle('capri:draft-state', (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid draft state');
      draftBusy = value;
      if (value) {
        avatarClickReactions.cancel();
        initiative.activity();
        screenObservation.activity();
      }
      return true;
    });
    handle('capri:microphone-start', async () => {
      if (speechInstaller.busy())
        throw new Error('Wait for speech installation to finish, or cancel it in Languages.');
      if (
        !asrAllowed ||
        !asrInstalled ||
        shuttingDown ||
        !['ready', 'asleep'].includes(backendState.phase)
      )
        throw new Error(
          'The selected speech recognition model is unavailable. Run setup-multilingual.cmd.',
        );
      const capture = { ...(await microphone.start()), ...liveMicrophone() };
      if (
        !verification &&
        liveCompanionSettings().wakeSound === 'voice' &&
        sleepService.phase === 'awake' &&
        !currentChatTask &&
        !chat.active &&
        !voice.generating &&
        !playbackBusy
      )
        void prepareWakeAudio().catch((error) => {
          const type = error.code === 'CAPRI_VOICE_DISABLED' ? 'voice.warning' : 'wake.error';
          emit({ type, message: error.message });
        });
      return capture;
    });
    handle('capri:microphone-devices', refreshAudioInputs);
    handle('capri:microphone-device', changeAudioInput);
    handle('capri:system-audio-prepare', (value, { frame }) =>
      systemAudio.prepare(value?.id, frame, value?.wake),
    );
    handle('capri:system-audio-cancel', (id, { frame }) => systemAudio.cancel(id, frame));
    handle('capri:music-status', () => musicListening.snapshot());
    handle('capri:music-settings', (value, { role }) => {
      if (role !== 'settings') throw Error('Open Music listening in Settings.');
      musicPreferences.set(validateMusicListeningSettings(value));
      return musicListening.publish();
    });
    handle('capri:music-command', async (action, { role }) => {
      if (
        role !== 'settings' ||
        !settingsHost?.window?.isVisible() ||
        !['start', 'stop'].includes(action) ||
        (action === 'start' && !musicAvailable())
      )
        throw Error('Music listening could not start. Try again from Settings.');
      if (action === 'stop') return stopMusicListening();
      if (action === 'start')
        musicPreferences.set({ ...musicPreferences.snapshot(), enabled: true });
      let timer;
      try {
        await Promise.race([
          window.webContents.executeJavaScript(
            'window.capriRunMusicCommand(' + JSON.stringify(action) + ')',
            true,
          ),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error('Music listening could not start. Try again from Settings.')),
              15000,
            );
          }),
        ]);
      } catch {
        stopMusicListening();
        throw Error('Music listening could not start. Try again from Settings.');
      } finally {
        clearTimeout(timer);
      }
      return musicListening.snapshot();
    });
    handle('capri:music-audio-start', () => {
      musicPreferences.set({ ...musicPreferences.snapshot(), enabled: true });
      return musicListening.start();
    });
    handle('capri:music-audio-ready', (id) => musicListening.ready(id));
    handle('capri:music-audio-packet', (value) => musicListening.packet(value));
    handle('capri:music-audio-stop', (id) => {
      musicAudio.revoke();
      return musicListening.stop(id);
    });
    handle('capri:music-audio-prepare', (id, { frame }) => musicAudio.prepare(id, frame));
    handle('capri:music-audio-cancel', (id, { frame }) => musicAudio.cancel(id, frame));
    handle('capri:call-audio-devices', (_, { role }) => {
      if (role !== 'settings' && !enablingCallOutput && !currentCallAudio.callOutputReady)
        return [];
      return listCallAudioDevices(role === 'companion');
    });
    handle('capri:call-audio-command', async (value, { role }) => {
      if (role !== 'settings') throw new Error('Open Voice calls in Settings.');
      const command = callAudioCommand(value);
      if (command.action === 'state') return callAudioSnapshot();
      if (!callAudioAvailable() || !settingsHost?.window?.isVisible())
        throw new Error('Call audio requires an open Capri window.');
      if (command.action === 'allow-model' || command.action === 'voice-volume') {
        const policy = callAudioPolicy.set({
          ...callAudioPolicy.snapshot(),
          ...(command.action === 'allow-model'
            ? { allowModel: command.enabled }
            : { callVoiceVolume: command.volume }),
        });
        const { allowModel } = policy;
        if (!allowModel && (voicePreviewRequest?.model || callVoiceTurn?.model)) cancelCallVoice();
        emit({ type: 'call-audio.policy', ...policy });
        return callAudioSnapshot();
      }
      return executeCallAudio(command);
    });
    handle('capri:call-audio-setup', async (action, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible())
        throw new Error('Open Voice calls in Settings.');
      if (!['state', 'connect', 'install', 'website', 'license'].includes(action))
        throw new Error('Invalid virtual microphone setup action.');
      if (action === 'state') return callSetup.snapshot();
      if (!callAudioAvailable()) throw new Error('Call audio requires an open Capri window.');
      if (action === 'website' || action === 'license') {
        await shell.openExternal(
          action === 'website'
            ? 'https://vb-audio.com/Cable/'
            : 'https://vb-audio.com/Services/licensing.htm',
        );
        return callSetup.snapshot();
      }
      return callSetup.run(action === 'install');
    });
    handle('capri:call-audio-state', (value) => {
      const previous = currentCallAudio;
      currentCallAudio = callAudioAvailable() ? callAudioState(value) : callAudioState();
      if (!currentCallAudio.callOutputReady) callMicrophoneArmed = false;
      if (previous.callOutputReady && !currentCallAudio.callOutputReady) cancelCallVoice();
      settingsHost?.send({ type: 'settings.call-audio', state: callAudioSnapshot() });
    });
    handle('capri:call-audio-speak', async (value) => {
      const { id, text } = validateInput(value);
      if (
        Object.keys(value).some((key) => !['id', 'text', 'model'].includes(key)) ||
        (value.model !== undefined && typeof value.model !== 'boolean')
      )
        throw new Error('Invalid call request.');
      const model = value.model === true;
      callAudioDiagnostics.request(id, { explicit: true, model, toCall: false, toOwner: false });
      if (model && !callAudioPolicy.value.allowModel) {
        callAudioDiagnostics.reject(id);
        throw new Error('Enable model-selected replies in Voice calls first.');
      }
      if (!callAudioAvailable() || !currentCallAudio.callOutputReady) {
        callAudioDiagnostics.reject(id);
        throw new Error('Enable a call output in Voice calls first.');
      }
      if (!voice.enabled || voice.language === 'off') {
        callAudioDiagnostics.reject(id);
        emit({ type: 'voice.warning', message: VOICE_REQUIRED_MESSAGE });
        return false;
      }
      if (currentChatTask || chat.active || playbackBusy || voice.running || voicePreviewRequest) {
        callAudioDiagnostics.reject(id);
        throw new Error('Wait for the current reply or preview to finish.');
      }
      if (sleepService.phase !== 'awake' || backendState.phase !== 'ready') {
        callAudioDiagnostics.reject(id);
        throw new Error('The local core is not ready yet.');
      }
      const request = { call: true, model, controller: new AbortController() };
      voicePreviewRequest = request;
      initiative.activity();
      screenObservation.activity();
      try {
        const decision = model
          ? await generateCallReply(
              text,
              languages.snapshot(),
              AbortSignal.any([request.controller.signal, AbortSignal.timeout(20000)]),
            )
          : { route: 'owner-and-call', reply: text };
        if (request.controller.signal.aborted || voicePreviewRequest !== request) {
          callAudioDiagnostics.cancel(id);
          return false;
        }
        await connectVoice();
        if (
          voicePreviewRequest !== request ||
          !callAudioAvailable() ||
          !currentCallAudio.callOutputReady ||
          (model && !callAudioPolicy.value.allowModel) ||
          currentChatTask
        ) {
          callAudioDiagnostics.cancel(id);
          return false;
        }
        if (!voice.ready) throw new Error('The local voice service could not start.');
        callVoiceTurn = { id, model };
        emit({
          type: 'voice.call-started',
          turnId: id,
          route: decision.route,
          ...(model && { reply: decision.reply }),
        });
        voice.preview(id, decision.reply);
        return true;
      } catch (error) {
        if (request.controller.signal.aborted) {
          callAudioDiagnostics.cancel(id);
          return false;
        }
        callAudioDiagnostics.fail(id);
        throw error;
      } finally {
        if (voicePreviewRequest === request) voicePreviewRequest = null;
      }
    });
    handle('capri:speech-settings', async (value) => {
      const next = speechPreferences.set(value);
      await microphone.configurePause(next.trailingSilenceSeconds);
      emit({ type: 'speech.settings', settings: next });
      return next;
    });
    handle('capri:microphone-ready', (id) => microphone.confirm(id));
    handle('capri:microphone-listen', () => {
      if (speechInstaller.busy())
        throw new Error('Wait for speech installation to finish, or cancel it in Languages.');
      if (shuttingDown || !['ready', 'asleep'].includes(backendState.phase)) return false;
      return microphone.listenNow();
    });
    handle('capri:microphone-stop', (value) => {
      const { id, keepModelWarm = false } =
        value && typeof value === 'object' ? value : { id: value };
      if (typeof keepModelWarm !== 'boolean' || (id !== undefined && typeof id !== 'string'))
        throw new Error('Invalid microphone stop mode');
      const stopped = microphone.stop(id);
      if (stopped && !keepModelWarm) {
        microphone.worker.close();
        microphone.publish();
      }
      return stopped;
    });
    handle('capri:quit', quitAndUnload);
    handle('capri:microphone-audio', (value) => microphone.audio(value));
    handle('capri:microphone-playback', (value) => microphone.playback(value));
    handle('capri:computer-stop', async () => {
      return emergencyComputerStop();
    });
    handle('capri:cancel', (id) => {
      void computerControl.stop();
      initiative.cancel();
      if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid turn');
      companionActions.approvals.cancel();
      const cancelled = chat.cancel(id);
      const visualCancelled = cancelVisual(id);
      voice.cancel();
      if (cancelled) emit({ type: 'avatar.selection', selection: avatar.invalidatePending() });
      return cancelled || visualCancelled;
    });
    handle('capri:voice-enabled', changeVoice);
    handle('capri:languages', async (value) => {
      const next = validateLanguages(value),
        resolved = resolveLanguages(next),
        language = resolved.recognition;
      const behaviorChanged = languageBehaviorChanged(languages.value, next);
      if (
        shuttingDown ||
        (behaviorChanged &&
          (currentChatTask ||
            chat.active ||
            visualTurn ||
            voicePreviewRequest ||
            voiceTraining.busy() ||
            voiceCatalog.busy() ||
            speechInstaller.busy()))
      )
        throw new Error('Wait for the current reply to finish before changing languages.');
      const oldSpeech = resolveLanguages(languages.value).speech;
      const restartVoice = !verification && voiceBackendChanged(root, oldSpeech, resolved.speech);
      if (restartVoice) await stopVoiceForChange();
      if (behaviorChanged) {
        initiative.cancel();
        screenObservation?.activity();
      }
      const saved = languages.set(next);
      if (window?.isVisible()) showDesktopTeleportMenu();
      if (language !== asrConfig.language) {
        microphone.stop();
        microphone.worker.close();
        microphone.worker.language = language;
        asrConfig.language = language;
        asrInstalled = recognitionInstalled(language);
        microphone.publish({ available: asrAllowed && asrInstalled });
      }
      if (resolved.speech !== oldSpeech || (!voice.ready && voice.enabled)) {
        voice.setLanguage(voiceAvailable ? resolved.speech : 'off');
        if (voiceAllowed && voice.enabled && resolved.speech !== 'off') {
          if (voice.ready) void voice.prepareLanguage();
          else void connectVoice();
        }
        if (resolved.speech === 'off')
          void mutedVoiceResidency
            .release()
            .catch((error) => console.warn('Muted voice release failed:', error.message));
      }
      emit({ type: 'languages', settings: saved });
      return saved;
    });
    handle('capri:voice-effects', (value) => {
      const settings = voiceEffects.set(value);
      emit({ type: 'voice.effects', settings });
      return settings;
    });
    handle('capri:voice-preview', async (value) => {
      const effects = value === undefined ? undefined : validateVoiceEffects(value);
      initiative.activity();
      screenObservation.activity();
      if (currentChatTask || playbackBusy || voice.running || voicePreviewRequest || shuttingDown)
        throw new Error('Wait for the current reply or preview to finish.');
      const request = {};
      voicePreviewRequest = request;
      try {
        if (sleepService.phase !== 'awake') await sleepService.wake();
        await connectVoice();
        if (voicePreviewRequest !== request || shuttingDown || currentChatTask) return false;
        if (!voice.ready) throw new Error('The local voice service could not start.');
        const turnId = randomUUID();
        emit({ type: 'voice.preview-started', turnId, effects });
        voice.preview(turnId, VOICE_PREVIEWS[voice.language] ?? VOICE_PREVIEWS.en);
        return true;
      } finally {
        if (voicePreviewRequest === request) voicePreviewRequest = null;
      }
    });
    handle('capri:presence-pinned', setPresencePinned);
    handle('capri:voice-stop', () => {
      cancelCallVoice();
      voicePreviewRequest = null;
      voice.cancel();
      return true;
    });
    handle('capri:avatar-ready', (value) => {
      if (!avatar.acknowledge(value)) return false;
      if (!catalog.animated)
        activeMask = maskFor(catalog.sprites.find((sprite) => sprite.id === value.id).frameId);
      return true;
    });
    handle('capri:avatar-frame-ready', (value) => {
      if (
        !value ||
        value.revision !== avatar.revision ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 0 ||
        (frameRevision === value.revision && value.sequence <= frameSequence) ||
        !frameIds.has(value.id)
      )
        return false;
      activeMask = maskFor(value.id);
      desktopFrame = frameIds.get(value.id);
      if (!perch && avatarDetach?.available)
        void avatarDetach.updateFrame(desktopFrame, catalog.canvas, activeMask).catch(() => {});
      else if (perch?.seated && !perch.hidden && avatarDetach?.available)
        void updateSeatedFrame().catch(() => {});
      frameRevision = value.revision;
      frameSequence = value.sequence;
      return true;
    });
    handle('capri:avatar-reply', (value, { role }) => {
      const { text, turnId, fullText, autoCollapsed } = value ?? {};
      if (
        role !== 'companion' ||
        typeof text !== 'string' ||
        text.length > 512 ||
        typeof turnId !== 'string' ||
        turnId.length > 128 ||
        (fullText !== undefined && (typeof fullText !== 'string' || fullText.length > 16000)) ||
        (autoCollapsed !== undefined && typeof autoCollapsed !== 'boolean')
      )
        return false;
      if (avatarDetach?.phase === 'attached') return false;
      const recent = store.messages.filter((message) => message.id !== turnId);
      if (turnId && typeof fullText === 'string')
        recent.push({ role: 'assistant', id: turnId, text: fullText });
      else {
        const current = store.messages.find((message) => message.id === turnId);
        if (current) recent.push(current);
      }
      avatarDetach?.sendReply({
        text,
        turnId,
        autoCollapsed,
        history: turnId ? replyHistory(recent) : [],
      });
      return true;
    });
    handle('capri:avatar-mouth', (shape, { role }) => {
      if (
        role !== 'companion' ||
        !['closed', 'small', 'round', 'wide'].includes(shape) ||
        avatarDetach?.phase === 'attached'
      )
        return false;
      avatarDetach?.sendMouth(shape);
      return true;
    });
    handle('capri:avatar-status', (value, { role }) => {
      if (
        role !== 'companion' ||
        !avatarDetach ||
        avatarDetach.phase === 'attached' ||
        typeof value?.text !== 'string' ||
        !value.text.trim() ||
        value.text.length > 100 ||
        typeof value.color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(value.color)
      )
        return false;
      const language = settingsPreview.interface ?? languages.value.interface;
      avatarDetach.sendStatus({
        text: value.text,
        color: value.color,
        sleeping: avatarSleeping(),
        replyLabels: {
          show: uiText('Show reply', language),
          hide: uiText('Hide reply', language),
          previous: uiText('Previous part of this reply', language),
          next: uiText('Next part of this reply', language),
          navigation: uiText('Subtitle playback', language),
        },
      });
      return true;
    });
    handle('capri:avatar-failed', (value) => {
      if (value?.revision !== avatar.revision || value?.id !== avatar.pendingId) return false;
      console.error('Could not decode avatar:', value.id);
      emit({ type: 'avatar.selection', selection: avatar.invalidatePending() });
      return true;
    });
    handle('capri:reconnect', async () => {
      if (chat.active) throw new Error('Wait for the current reply to finish.');
      if (sleepService.phase !== 'awake') await sleepService.wake();
      else await connectBackend();
      return backendState;
    });
    handle('capri:hide', collapseCompanionInterface);
    handle('capri:menu', async () => {
      await openMenu();
      return true;
    });
    handle('capri:dimming', changeDimming);
    handle('capri:regions', (value) => {
      const first = !regions;
      const previous = windowFootprint;
      regions = validateRegions(value, window.getContentBounds());
      windowFootprint = regions.footprint;
      if (
        !pointer?.drag &&
        ((first && windowFootprint) ||
          ['x', 'y', 'width', 'height'].some((key) => previous?.[key] !== windowFootprint?.[key]))
      ) {
        const anchor = windowFootprint && compactPlacement;
        const display = anchor
          ? screen.getDisplayMatching(anchor)
          : companionDisplay(previous ?? windowFootprint);
        clampWindow({ display, anchor });
      }
      return true;
    });
    handle('capri:avatar-layout', (value, { role }) => {
      avatarLayout = validateAvatarLayout(
        role === 'companion' && settingsPreview.zoom !== undefined
          ? { ...value, zoom: avatarLayout.zoom }
          : value,
      );
      const update = { type: 'avatar.layout', layout: avatarLayout };
      // The dragging renderer already applied this frame. Echoing it back ends
      // its own pointer capture and can roll a fast gesture back to an old frame.
      if (role === 'companion') settingsHost?.send(update);
      else emit(update);
      clearTimeout(layoutSaveTimer);
      layoutSaveTimer = setTimeout(saveAvatarLayout, 250);
      return avatarLayout;
    });
    handle('capri:avatar-drag-start', (value) => {
      if (
        avatarDetach.phase !== 'attached' ||
        avatarDetach.operation ||
        !frameIds.has(value?.frameId)
      )
        return false;
      const { sprite } = validateRegions(
        { controls: [], sprite: value.sprite },
        window.getContentBounds(),
      );
      return pointer.beginAvatar(value.point, sprite, maskFor(value.frameId), catalog.animated);
    });
    handle('capri:avatar-drag-end', async (value) => {
      const click = value?.click === true;
      const press = pointer.avatarPress;
      if (
        !pointer.endAvatar(click ? value.point : undefined, (kind, point) => {
          if (kind === 'head' && !avatarSleeping()) emit({ type: 'avatar.headpat', point });
          recordAvatarClick(kind);
        })
      )
        return false;
      if (!click) {
        saveAvatarLayout();
        const content = window.getContentBounds();
        const release = value?.drop;
        if (
          press &&
          canTeleport() &&
          avatarDragCanTeleport(press.point, release, liveCompanionSettings()) &&
          avatarDropOutside(release, { ...content, x: 0, y: 0 })
        ) {
          const target = { x: content.x + release.x, y: content.y + release.y };
          const grab = spriteGrabPoint(press.point, press.sprite);
          const stillAllowed = () => !pointer.avatarPress;
          if (!(await tryAvatarDock(target, stillAllowed, grab)))
            await launchAvatarTo(target, stillAllowed, grab);
        }
      }
      return true;
    });
    handle('capri:drag-start', () => {
      pointer.beginWindow();
      return true;
    });
    handle('capri:drag-end', () => {
      pointer.endWindow();
      return true;
    });
  }

  function createWindow() {
    desktopTeleportMenu?.hide();
    const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y);
    const origin = { x: Math.round(saved.x), y: Math.round(saved.y), ...size };
    const footprint =
      hasPosition && validWindowFootprint(saved.footprint, size) ? saved.footprint : undefined;
    const remembered = saved.compactPlacement;
    if (
      remembered &&
      [remembered.x, remembered.y].every(
        (coordinate) => Number.isInteger(coordinate) && Math.abs(coordinate) < 2 ** 30,
      ) &&
      validWindowFootprint({ ...remembered, x: 0, y: 0 }, size)
    )
      compactPlacement = {
        x: remembered.x,
        y: remembered.y,
        width: remembered.width,
        height: remembered.height,
      };
    const display = hasPosition
      ? footprint
        ? screen.getDisplayMatching(visibleWindowBounds(origin, footprint))
        : screen.getDisplayNearestPoint(origin)
      : screen.getPrimaryDisplay();
    const bounds = placeInWorkArea(saved, display.workArea, size);
    windowFootprint = validWindowFootprint(footprint, bounds) ? footprint : undefined;
    window = createSecureWindow(BrowserWindow, {
      bounds: windowFootprint
        ? placeVisibleInWorkArea(
            { ...bounds, x: origin.x, y: origin.y },
            display.workArea,
            size,
            windowFootprint,
          )
        : bounds,
      directory,
      verification,
      alwaysOnTop: saved.alwaysOnTop !== false,
    });
    avatarDetach = new AvatarDetach({
      BrowserWindow,
      screen,
      owner: window,
      getOwnerDisplay: companionDisplay,
      getPortraitGeometry: (drop) =>
        window.webContents.getURL() === rendererUrl
          ? window.webContents.executeJavaScript(
              `globalThis.capriAvatarReturnGeometry?.(${drop ? JSON.stringify(drop) : ''})`,
            )
          : undefined,
      onReturnPlacement: (layout) => {
        avatarLayout = validateAvatarLayout(layout);
        saveAvatarLayout();
        emit({ type: 'avatar.layout', layout: avatarLayout });
      },
      verification,
      onClick: recordAvatarClick,
      getSleeping: avatarSleeping,
      getTheme: () => liveCompanionSettings().interfaceTheme,
      getPresentation: () => liveCompanionSettings().detachedStyle,
      onHeadpat: () => recordAvatarClick('head'),
      onDragDrop: (point, offset) => void teleportToCursor(point, offset).catch(() => {}),
      onRaised: () => avatarComposer?.raise(),
      onPointer: syncAvatarComposer,
      watchRelease: (overlay, callback) =>
        desktopTeleportMenu?.watchRelease(overlay.getNativeWindowHandle(), (point) =>
          callback(screen.screenToDipPoint(point)),
        ),
      onPhase: (phase) => {
        detachedReplyHovered = false;
        if (phase === 'detached')
          queueMicrotask(() => void avatarDetach?.refreshPresentation().catch(() => {}));
        avatarComposerDismissed = false;
        if (phase !== 'detached') avatarComposer?.hide();
        if (phase === 'attached') {
          const wasAvatarOnly = avatarOnly;
          avatarOnly = false;
          clearPerch();
          if (wasAvatarOnly && !window.isVisible()) stopHiddenCompanion();
        }
        emit({ type: 'avatar.detach', phase });
        syncAvatarComposer();
      },
      getEffects: () => {
        const {
          teleportIntensity,
          teleportJaggedness,
          teleportBranches,
          teleportReducedFlash,
          avatarDragTether,
          avatarDragTetherIntensity,
          avatarDragTetherChaos,
          avatarDragTetherDeadZone,
        } = liveCompanionSettings();
        return {
          teleportIntensity,
          teleportJaggedness,
          teleportBranches,
          teleportReducedFlash,
          avatarDragTether:
            avatarDragTether && liveCompanionSettings().detachedStyle !== 'dialogue',
          avatarDragTetherIntensity,
          avatarDragTetherChaos,
          avatarDragTetherDeadZone,
        };
      },
    });
    avatarComposer = new AvatarComposer({
      BrowserWindow,
      screen,
      onClose: () => {
        avatarComposerDismissed = true;
      },
      onError: () => console.warn('The detached input bar could not open.'),
    });
    avatarComposer.sendState(avatarComposerState);
    minimizedChip = new MinimizedChip({
      BrowserWindow,
      screen,
      ipcMain,
      restore: () => restoreCompanion(),
      getLabels: () => {
        const colors = interfaceThemeColors(liveCompanionSettings().interfaceTheme);
        return {
          title: uiText('Show Capri', languages.value.interface),
          language: languages.value.interface,
          accent: colors.cyan,
          background: colors['theme-background'],
        };
      },
    });
    recordingIndicator = new MinimizedChip({
      BrowserWindow,
      screen,
      ipcMain,
      restore: () => void workflows.stopRecording(),
      url: 'capri://desktop/recording-indicator.html',
      channel: 'capri:recording-stop',
      width: 260,
      height: 40,
      top: true,
      preload: path.join(directory, 'recording-indicator-preload.cjs'),
      onClose: () => void workflows.stopRecording(),
      onUnavailable: () => void workflows.stopRecording(),
      getLabels: () => ({
        text: uiText('RECORDING ACTIONS · ESC', languages.value.interface),
        title: uiText('Stop recording', languages.value.interface),
        language: languages.value.interface,
        direction: /^(ar|he|fa|ur|ps)(-|$)/.test(languages.value.interface) ? 'rtl' : 'ltr',
      }),
    });
    window.on('hide', stopHiddenCompanion);
    window.on('show', () => {
      avatarComposerDismissed = false;
      syncAvatarComposer();
    });
    app.on('browser-window-focus', (_event, view) => {
      if (view !== avatarDetach.overlay) avatarDetach.raiseOverlay();
    });
    window.on('show', showDesktopTeleportMenu);
    window.on('always-on-top-changed', () => {
      if (controlWindowLayer.active) return;
      emit({
        type: 'window.always-on-top',
        active: window.isAlwaysOnTop(),
        preview: settingsPreview.alwaysOnTop !== undefined,
      });
    });
    window.on('minimize', hideCompanionToTray);
    window.on('closed', () => avatarDetach.reset());
    window.on('minimize', () => processLoad.stop());
    window.on('minimize', () => systemCpu.stop());
    settingsHost = new SettingsWindow({
      BrowserWindow,
      screen,
      owner: window,
      getOwnerDisplay: companionDisplay,
      directory,
      url: settingsUrl,
      quitting: () => shuttingDown || quitting,
      onBusy: (value) => {
        interfaceBusy = value;
        if (!value) privateMemory.lock();
        if (!value && Object.keys(settingsPreview).length)
          void updateSettingsPreview({}).catch((error) => console.error(error.message));
      },
      onRendererLost: () => emit({ type: 'settings.renderer-lost' }),
      onError: (message) => {
        console.error(message);
        rendererDiagnostics.push({
          at: new Date().toISOString(),
          level: 3,
          source: 'settings',
          message,
        });
      },
    });
    window.webContents.on('console-message', (details) => {
      const level =
        typeof details.level === 'string'
          ? ({ warning: 2, error: 3 }[details.level] ?? 0)
          : details.level;
      if (level < 2 || typeof details.message !== 'string') return;
      rendererDiagnostics.push({
        at: new Date().toISOString(),
        level,
        message: details.message.slice(0, 4000),
        source: String(details.sourceId ?? details.url ?? '').slice(0, 300),
      });
      if (rendererDiagnostics.length > 50) rendererDiagnostics.shift();
    });
    pointer = new PointerController({
      window,
      screen,
      getRegions: () => regions,
      getMask: () => activeMask,
      onAvatarTether: (press, cursor, bounds, now) =>
        avatarDetach.trackAttachedTether(press, cursor, bounds, now),
      placeDrag: (bounds, cursor) => {
        if (!windowFootprint) return bounds;
        const area = screen.getDisplayNearestPoint(cursor).workArea;
        if (windowFootprint.width > area.width || windowFootprint.height > area.height)
          return bounds;
        return placeVisibleInWorkArea(bounds, area, bounds, windowFootprint);
      },
      onEnd: (drag) => {
        clampWindow({ preferredSize: size });
        if (drag && (drag.bounds.x !== drag.last.x || drag.bounds.y !== drag.last.y)) {
          compactPlacement = windowFootprint
            ? visibleWindowBounds(window.getBounds(), windowFootprint)
            : undefined;
        }
        saveWindow();
      },
      verification,
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      stopMusicListening();
      if (quitting || shuttingDown || !window || window.isDestroyed()) return;
      const reveal = window.isVisible() && !window.isMinimized();
      console.warn('Companion renderer stopped:', details.reason, details.exitCode);
      rendererFailed = true;
      rendererReady = false;
      attachmentDrafts.clear();
      resetCallAudio();
      draftBusy = false;
      playbackBusy = false;
      pendingFollowUp = null;
      voicePreviewRequest = null;
      regions = null;
      pointer?.cancel();
      chat.cancel();
      cancelVisual();
      voice.cancel();
      microphone.stop();
      capturePolicy.clear('renderer-stopped');
      screenPreviews.clear();
      hideCompanionToTray();
      if (rendererRecovery) rendererRecovery.failed = true;
      else if (Date.now() >= nextRendererRecovery) void recoverCompanion(reveal);
    });
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        hideCompanionToTray();
        return;
      }
      chat.cancel();
      saveWindow();
    });
    window.on('moved', () => {
      avatarDetach.checkDisplay();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveWindow, 350);
    });
    window.on('blur', () => {
      if (pointer.drag) pointer.endWindow();
      pointer.endAvatar();
    });
    window.on('hide', () => pointer.cancel());
    window.once('ready-to-show', () => {
      if (!verification) showCompanion();
      if (!verification) publishLaunchReceipt(root, process.env.CAPRI_LAUNCH_NONCE);
      if (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_UPDATE_CHECK === '1')
        void updates.checkOnStartup().catch(() => {});
      console.info('Capri companion window ready.', JSON.stringify(window.getBounds()));
    });
    window.loadURL(rendererUrl).catch((error) => {
      if (rendererFailed || nextRendererRecovery) return;
      console.error('Could not load companion:', error.message);
      app.quit();
    });

    activeMask = maskFor(avatar.currentId);
    pointer.start();

    tray = new Tray(path.join(root, 'assets/default/app.ico'));
    tray.setToolTip(uiText('Capri desktop companion', languages.value.interface));
    tray.on('click', () => restoreCompanion());
    tray.on('right-click', () => {
      openMenu(true).catch(() => {});
    });
    if (!verification)
      globalShortcut.register('CommandOrControl+Shift+Space', () => {
        if (window.isVisible() && window.isFocused()) hideCompanionToTray();
        else restoreCompanion();
      });
    screen.on('display-removed', () => {
      capturePolicy.displayTopologyChanged();
      avatarDetach.reset();
      clampWindow({ preferredSize: size });
    });
    screen.on('display-added', () => capturePolicy.displayTopologyChanged());
    screen.on('display-metrics-changed', (_event, _display, metrics) => {
      if (metrics?.some((metric) => ['bounds', 'scaleFactor', 'rotation'].includes(metric)))
        capturePolicy.displayTopologyChanged();
      avatarDetach.reset();
      if (!pointer.drag) clampWindow({ preferredSize: size });
    });
  }

  if (hasSingleInstanceLock) {
    app.on('second-instance', () => restoreCompanion());
    app.on('before-quit', (event) => {
      recordingIndicator?.destroy();
      userTools.close();
      workflows?.close();
      privateMemory.close();
      brain.close();
      minimizedChip?.destroy();
      attachmentViewer?.close();
      attachmentDrafts.clear();
      stopMusicListening();
      if (cableInstaller.snapshot().busy) {
        event.preventDefault();
        void cableInstaller.whenSettled().then(() => app.quit());
        return;
      }
      resetCallAudio();
      desktopTeleportMenu?.hide();
      avatarClickReactions.cancel();
      avatarDetach?.reset();
      avatarComposer?.destroy();
      for (const pending of avatarComposerActions.values()) {
        clearTimeout(pending.timer);
        pending.resolve(false);
      }
      avatarComposerActions.clear();
      processLoad.stop();
      systemCpu.stop();
      inferenceApi.close();
      discordPresence.close();
      void computerControl.stop();
      companionActions.close();
      sleepService.close();
      reminders?.close();
      spotify.close();
      backendController?.abort(new Error('Desktop closed during startup'));
      voiceStartController?.abort();
      models.close();
      huggingface.close();
      void voiceTraining.close();
      void voiceCatalog.close();
      updates.close();
      githubAccess.close();
      void speechInstaller.close();
      confirmations.cancel();
      cancelVisual();
      capturePolicy.clear();
      screenPreviews.clear();
      initiative.close();
      observer.stop();
      metadataRpc.stop();
      quitting = true;
      settingsHost?.destroy();
      chat.cancel();
      voice.close();
      microphone.close();
      requestRouter.close();
      saveWindow();
      pointer?.stop();
      clearInterval(controlTimer);
      clearTimeout(saveTimer);
      saveAvatarLayout();
      saveDimming();
      globalShortcut.unregisterAll();
      tray?.destroy();
    });
    app.on('window-all-closed', () => app.quit());
    app
      .whenReady()
      .then(async () => {
        if (!verification) brain.start();
        await userTools
          .refresh()
          .catch(() => console.warn('User tools could not be listed. Open Settings to retry.'));
        const micArmed = () =>
          asrAllowed &&
          Boolean(microphone.capture) &&
          ['arming', 'listening'].includes(microphone.status);
        const displayPermission = (contents, permission, origin, details) =>
          permission === 'display-capture' &&
          (Boolean(capturePolicy.capture) || systemAudio.armed() || musicAudio.armed()) &&
          contents === window?.webContents &&
          contents.getURL() === rendererUrl &&
          details?.isMainFrame !== false &&
          ['capri://desktop', 'capri://desktop/'].includes(origin);
        const callSpeakerPermission = (contents, permission, origin, details) =>
          speakerSelectionAllowed({
            active: (enablingCallOutput || listingCallOutputs > 0) && callAudioAvailable(),
            owner: window?.webContents,
            contents,
            permission,
            origin,
            details,
            url: rendererUrl,
          });
        session.defaultSession.setPermissionRequestHandler(
          (contents, permission, respond, details) =>
            respond(
              displayPermission(contents, permission, details.securityOrigin, details) ||
                callSpeakerPermission(contents, permission, details.securityOrigin, details) ||
                audioPermission({
                  armed:
                    micArmed() ||
                    Boolean(
                      enablingCallOutput &&
                        callAudioAvailable() &&
                        settingsHost?.window?.isVisible(),
                    ),
                  owner: window?.webContents,
                  contents,
                  permission,
                  origin: details.securityOrigin,
                  details,
                  request: true,
                }),
            ),
        );
        session.defaultSession.setPermissionCheckHandler(
          (contents, permission, origin, details) =>
            displayPermission(contents, permission, origin, details) ||
            callSpeakerPermission(contents, permission, origin, details) ||
            audioPermission({
              armed:
                micArmed() ||
                Boolean(
                  callAudioAvailable() &&
                    ((enablingCallOutput && settingsHost?.window?.isVisible()) ||
                      callMicrophoneArmed),
                ),
              listingDevices: listingAudioInputs || listingCallOutputs > 0 || enablingCallOutput,
              owner: window?.webContents,
              contents,
              permission,
              origin,
              details,
            }),
        );
        session.defaultSession.setDisplayMediaRequestHandler(
          (request, respond) => {
            if (!musicAudio.consume(request, respond) && !systemAudio.consume(request, respond))
              void capturePolicy.consume(request, respond);
          },
          { useSystemPicker: false },
        );
        protocol.handle('capri', (req) =>
          resourceResponse(req, allowedResources, { attachments: attachmentHistory }),
        );
        await companionActions.start();
        installIpc();
        const preload = consumeFirstLaunchPreload(state);
        createWindow();
        if (inferenceApi.config.setupRequired)
          window.once('ready-to-show', () => {
            if (!shuttingDown && !focusMode)
              void settingsHost.open('api', 'api-key').catch(console.error);
          });
        else if (settings.modelSetupRequired && !rt.remote.enabled)
          window.once('ready-to-show', () => {
            if (!shuttingDown) void settingsHost.open('models', 'hf-query').catch(console.error);
          });
        discordPresence.start();
        window.on('minimize', resetCallAudio);
        powerMonitor.on('unlock-screen', () => {
          sessionLocked = false;
          void reminders.pump();
        });
        powerMonitor.on('lock-screen', () => {
          recordingIndicator?.hide();
          userTools.cancel();
          workflows?.cancel();
          privateMemory.lock();
          minimizedChip?.hide();
          stopMusicListening();
          void computerControl.stop();
          sessionLocked = true;
          avatarClickReactions.cancel();
          avatarDetach.reset();
          discardScreens('screen-locked');
          cancelVisual();
        });
        powerMonitor.on('suspend', () => {
          recordingIndicator?.hide();
          userTools.cancel();
          workflows?.cancel();
          privateMemory.lock();
          minimizedChip?.hide();
          stopMusicListening();
          avatarClickReactions.cancel();
          void computerControl.stop();
          avatarDetach.reset();
          discardScreens('system-suspended');
          cancelVisual();
        });
        window.on('show', () => {
          void syncInitiative().catch((error) => {
            if (error.name !== 'AbortError')
              emit({ type: 'initiative.error', message: 'App awareness could not start.' });
          });
        });
        controlTimer = setInterval(() => {
          computerControl.supervise({
            indicatorVisible: Boolean(controlBorder),
            escapeAvailable:
              !computerControl.session?.ready ||
              globalShortcut.isRegistered('Escape') ||
              Boolean(nativeEscape?.active),
          });
          if (!verification && existsSync(stopFile)) {
            unlinkSync(stopFile);
            app.quit();
            return;
          }
          void updateDesktopAvatar().catch(() => {});
          syncAvatarComposer();
          if (!verification && existsSync(showFile)) {
            let launchNonce;
            try {
              launchNonce = JSON.parse(readFileSync(showFile, 'utf8')).launchNonce;
            } catch {}
            unlinkSync(showFile);
            restoreCompanion();
            publishLaunchReceipt(root, launchNonce);
          }
        }, 400);
        controlTimer.unref();
        const warmRecognition =
          preload &&
          !verification &&
          asrAllowed &&
          asrInstalled &&
          Boolean(microphone.capture) &&
          asrConfig.language !== 'off';
        const warmVoice = preload && !verification && voice.enabled && voice.language !== 'off';
        startup.start([
          'core',
          ...(preload ? ['models'] : []),
          ...(warmRecognition ? ['recognition'] : []),
          ...(warmVoice ? ['voice'] : []),
        ]);
        const prepare = async (key, work) => {
          startup.begin(key);
          try {
            await work();
            startup.end(key);
          } catch {
            startup.end(key, true);
          }
        };
        await startModelServices({
          core: () => connectBackend({ preload }),
          voiceFirst: warmVoice,
          sequential: responseTiming.sequentialModels,
          shouldContinue: () => !shuttingDown && sleepService.phase !== 'sleeping',
          voice: warmVoice
            ? () =>
                prepare('voice', async () => {
                  await connectVoice();
                  if (!voice.ready) throw new Error('Voice unavailable');
                })
            : null,
          recognition: warmRecognition
            ? () => prepare('recognition', () => microphone.worker.start())
            : null,
        });
        startup.finish();
        await syncInitiative().catch((error) => {
          if (error.name !== 'AbortError')
            emit({ type: 'initiative.error', message: 'App awareness could not start.' });
        });
      })
      .catch((error) => {
        console.error('Desktop startup failed:', error.message);
        app.exit(1);
      });
  }
}

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(initializeDesktop)
    .catch(() => {
      console.error('CAPRI_DESKTOP_INIT');
      let language = 'en';
      try {
        const saved = JSON.parse(readFileSync(path.join(state, 'languages.json'), 'utf8'));
        language = saved.settings?.interface ?? saved.interface ?? 'en';
      } catch {}
      dialog.showErrorBox(
        uiText('Capri could not start.', language),
        uiText(
          'Your saved data has been preserved. Repair Capri with the installer and try again.',
          language,
        ),
      );
      app.exit(1);
    });
}
