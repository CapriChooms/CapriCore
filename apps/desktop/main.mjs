import {
  InferenceApi,
  apiSettings,
  openRouterFreeReplyTimeoutMs,
  readApiSettings,
} from './inference-api.mjs';
import { CapriCore } from '../../packages/core/src/index.mjs';
import { codingSkill } from '../../packages/skills/src/coding.mjs';
import { computerSkill } from '../../packages/skills/src/computer.mjs';
import { avatarSkill } from '../../packages/skills/src/avatar/index.mjs';
import { discordPresenceSkill } from '../../packages/skills/src/discord-presence.mjs';
import { reasoningSkill } from '../../packages/skills/src/reasoning/index.mjs';
import { webSearchSkill } from '../../packages/skills/src/web-search/index.mjs';
import { installCodingBridge } from './main/coding-bridge.mjs';
import { faceAnimations, faceFrames } from './renderer/avatar-face-expressions.mjs';
import { describeOwnAvatar } from './avatar-awareness.mjs';
import { prepareMacModels } from './main/macos-models.mjs';
import { createMediaSkills } from './main/media-skills.mjs';
import { createConversationSkills, createOwnerMemory } from './main/conversation-skills.mjs';
import { createVoiceSkills } from './main/voice-skills.mjs';
import { SkillSettings } from './main/skill-settings.mjs';
import { skillPreferences, TURN_MODE_SKILLS } from '../../packages/skills/src/settings-catalog.mjs';
import { ACTION_SKILLS } from '../../packages/skills/src/action-tools.mjs';
import { NpuInference } from '../../packages/runtime/src/providers/npu-inference.mjs';
import { NpuSetupService, prepareIntelNpu } from './npu-setup-service.mjs';
import { CodingService } from './coding-service.mjs';
import { CodingAgent } from './coding-agent.mjs';
import { CodingRevisions } from './coding-revisions.mjs';
import { discoverCodingEditors } from './coding-editors.mjs';
import { windowsCompatibility } from '../../packages/runtime/src/host/windows-compatibility.mjs';
import {
  readNpuSettings,
  saveNpuSettings,
} from '../../packages/runtime/src/providers/npu-settings.mjs';
import {
  readModelDevices,
  saveModelDevices,
} from '../../packages/runtime/src/model-device-settings.mjs';
import { ExternalTts } from './external-tts.mjs';
import { ChatGPTPlanAuth, CHATGPT_RESOURCE } from './chatgpt-plan-auth.mjs';
import { chatGPTCompletion } from './chatgpt-plan-completions.mjs';
import { DesktopAiDiscovery } from './desktop-ai-discovery.mjs';
import { AvatarRoaming, chooseRoamingDisplay } from './avatar-roaming.mjs';
import { LocalModelLoad } from './local-model-load.mjs';
import { openLocalModelFolder } from './local-model-folder.mjs';
import { isLemonadeNpuEndpoint, isLocalApiEndpoint } from './renderer/inference-endpoint.mjs';
import { ComputerControl } from './computer-control.mjs';
import { WebSearch } from './web-search.mjs';
import { prepareFreshTurn } from './fresh-context.mjs';
import { appendKeepWarmLog, modelPing, startKeepWarm, voicePing } from './idle-keep-warm.mjs';
import { webSources } from './web-sources.mjs';
import { visualReplyFailure } from './visual-response.mjs';
import { NativeEscapeStop } from './native-escape-stop.mjs';
import {
  VOICE_VOLUME_DEFAULT,
  validateVoiceVolume,
  voiceVolumeSettings,
} from './renderer/voice-volume.mjs';
import { ResolveAdapter } from '../../integrations/resolve/service.mjs';
import { ComputerAgent } from './computer-agent.mjs';
import { computerPlanner } from './computer-planner.mjs';
import { computerToolSelector } from './computer-tool-selection.mjs';
import { spotifyPlanner } from './spotify-planner.mjs';
import { computerVision } from './computer-vision.mjs';
import { readSteamScreenText } from './steam-screen-text.mjs';
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
  configureWindowGraphics,
  saveSoftwareRendering,
  softwareRenderingRequested,
} from './main/window-graphics.mjs';
import {
  ResponseTimingLog,
  configureResponseTimings,
  withResponseTiming,
  markResponseTiming,
  acknowledgeResponsePaint,
} from '../../packages/runtime/src/response-timing.mjs';
import { timingFetch } from '../../packages/runtime/src/response-probe.mjs';
import { endsVoiceConversation, wantsVoiceFollowUp } from './voice-follow-up.mjs';
import { handsFreeReply } from './lemonade-dialogue.mjs';
import { screenFormState } from './main/screen-form-state.mjs';
import { localizedDialog } from './main/localized-dialog.mjs';
import { SettingsWindow } from './main/settings-window.mjs';
import { AvatarComposer } from './main/avatar-composer.mjs';
import { MinimizedChip } from './main/minimized-chip.mjs';
import { CallAudioDiagnostics } from './main/call-audio-diagnostics.mjs';
import { CallCamera } from './main/call-camera.mjs';
import { CallCameraBackground } from './main/call-camera-background.mjs';
import { CAMERA_BACKGROUND_IMAGE_BYTES } from './call-camera-protocol.mjs';
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
import { localToolsFor } from './local-tool-intent.mjs';
import { interfaceThemeColors } from './renderer/interface-theme.mjs';
import { FileService } from '../../integrations/filesystem/service.mjs';
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
import { ChessCapture } from './chess/capture.mjs';
import { ChessDiagnostics, chessUiDecisions } from './chess/diagnostics.mjs';
import {
  chessArrowAppearance,
  DEFAULT_CHESS_ARROW,
  restoreChessArrowAppearance,
} from './renderer/chess-arrow-style.mjs';
import {
  chessFrameAppearance,
  DEFAULT_CHESS_FRAME,
  restoreChessFrameAppearance,
} from './renderer/chess-frame-style.mjs';
import { ChessEngineInstall } from './chess/engine-install.mjs';
import { importGame } from './chess/position.mjs';
import { ChessSession } from './chess/session.mjs';
import { ChessReactions } from './chess/reactions.mjs';
import {
  CHESS_REACTION_DEFAULTS,
  chessReactionSettings,
} from './renderer/chess-reaction-settings.mjs';
import { ChessPageAccess } from './chess/source.mjs';
import { registerAccessIpc } from './main/access-ipc.mjs';
import { registerCompanionIpc } from './main/companion-ipc.mjs';
import { WildPranks } from './main/wild-pranks.mjs';
import {
  WildInputPranks,
  classifyWildTarget,
  fallbackWildPrank,
  wildPrankPlanner,
} from './wild-input-pranks.mjs';
import { UpdateService } from './update-service.mjs';
import { GitHubAccess, githubTokenUrl, credentialStorage } from './github-access.mjs';
import { installSpeechComponents } from '../../packages/installer/src/speech-components.mjs';
import { SpeechInstallService } from './speech-install-service.mjs';
import { ModelService } from './model-service.mjs';
import {
  HuggingFaceHub,
  hasSpeculativeDraft,
} from '../../packages/runtime/src/huggingface/hub.mjs';
import { HF_DRAFT_CHAT_ERROR } from '../../packages/runtime/src/hardware/imported-model.mjs';
import { HuggingFaceService } from './huggingface-service.mjs';
import { HuggingFaceCredentials } from './huggingface-credentials.mjs';
import {
  selectedVoiceModel,
  VoiceCatalogService,
  voiceBackendChanged,
} from './voice-catalog-service.mjs';
import { BREEZE_LICENSE_URL, BreezeVoice } from './breeze-voice.mjs';
import { ModelDeviceService } from './model-device-service.mjs';
import { VoiceTrainingService } from './voice-training-service.mjs';
import { SpotifySettings } from './spotify-settings.mjs';
import { SpotifyService, SpotifyWorker } from '../../integrations/spotify/service.mjs';
import { YouTubeMusicService } from '../../integrations/youtube-music/service.mjs';
import { ApplicationService } from '../../integrations/desktop-actions/service.mjs';
import {
  saveModelProfile,
  saveContextWindow,
  saveInferenceSettings,
} from '../../packages/runtime/src/hardware/model-profile.mjs';
import { validateContextChoice } from '../../packages/runtime/src/config/context-policy.mjs';
import {
  responsiveness,
  windowsX64Emulation,
} from '../../packages/runtime/src/hardware/responsiveness.mjs';
import {
  consumeFirstLaunchPreload,
  consumeMicrophoneRestart,
  saveMicrophoneRestart,
  startModelServices,
} from './model-startup.mjs';
import { memorySampler } from '../../packages/runtime/src/hardware/memory.mjs';
import { ProcessLoadSampler } from './process-load.mjs';
import { probeResourceUsage } from './diagnostics/resources.mjs';
import { LocalModelResidencySampler } from './local-model-residency.mjs';
import { CpuSampler, resourceDiskUsage } from './system-resources.mjs';
import {
  resourceMonitorDisplay,
  resourceMonitorNeedsProcessLoad,
} from './renderer/resource-metrics.mjs';
import { ContextSampler } from './context-usage.mjs';
import { MutedVoiceResidency } from './voice-residency.mjs';
import { ensureLanguageModelReady } from '../../packages/runtime/src/providers/model-residency.mjs';
import { localRunnerOptions } from '../../packages/runtime/src/providers/runner-policy.mjs';
import { conversationBudget } from './conversation-budget.mjs';
import { Confirmations } from './main/confirmations.mjs';
import {
  COMPANION_DEFAULTS,
  monitorDisplayChange,
  validateCompanionSettings,
} from './companion-settings.mjs';
import { teleportEffectSettings, teleportLightningSettings } from './renderer/teleport-effects.mjs';
import { clearSavedMemory } from './memory-controls.mjs';
import {
  automaticFactCandidate,
  changeOwnerFact,
  listOwnerFacts,
  recallOwnerNote,
  saveOwnerFact,
  saveOwnerNote,
} from './owner-notes.mjs';
import { StartupProgress, coreStartupFailure } from './startup-progress.mjs';
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
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  clipboard,
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
import * as keepWarmFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  root,
  resourceRoot,
  nodePath,
  llamaPath,
  settings,
  runtime,
  initialize,
  personaPrompt,
  request,
  headers,
  stopManaged,
  managedProcess,
} from '../../packages/runtime/src/index.mjs';
import {
  prewarmEmbedding,
  prewarmModels,
  startCore,
  stopCore,
} from '../../packages/runtime/src/providers/core.mjs';
import {
  modelIdlePolicyFile,
  readModelIdlePolicy,
  validModelIdleMinutes,
} from '../../packages/runtime/src/providers/model-idle-policy.mjs';
import { ChatService, validateInput } from './chat-service.mjs';
import { TranscriptStore, writeJsonAtomic } from './storage.mjs';
import { readLegacyPrivateStorage } from './legacy-private-storage.mjs';
import { installTrayOnlyWindows } from './main/tray-only-windows.mjs';
import {
  WINDOW_RESIZE_EDGES,
  avatarDropOutside,
  placeInWorkArea,
  placeVisibleInWorkArea,
  pointInRect,
  spriteGrabPoint,
  validateRegions,
  validWindowFootprint,
  visibleWindowBounds,
} from './geometry.mjs';
import { REPLY_SPACE, compactReplyHeight, fittedReplyHeight } from './renderer/reply-geometry.mjs';
import { loadInstalledAvatar } from './avatar-catalog.mjs';
import { matchCharacterPortrait } from './character-portraits.mjs';
import { AvatarState } from './avatar-state.mjs';
import {
  DEFAULT_AVATAR_LAYOUT,
  FULL_AVATAR_LAYOUT,
  validateAvatarLayout,
} from './avatar-layout.mjs';
import { VoiceService } from './voice-service.mjs';
import { speechLanguageMismatch } from './renderer/speech-text.mjs';
import { ASRWorker } from './asr-worker.mjs';
import { MicrophoneService, audioPermission } from './microphone-service.mjs';
import { AudioInputSettings } from './audio-input-settings.mjs';
import {
  AUDIO_ROUTING_DEFAULTS,
  audioRouteRequest,
  audioRoutingPreferences,
  localPlaybackDevices,
  nativeMusicPackets,
} from './audio-routing.mjs';
import { WindowsAudioEndpoints } from './windows-audio-endpoints.mjs';
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
  callAudioPreferences,
  callAudioState,
  callOutputDevices,
  speakerSelectionAllowed,
} from './main/call-audio.mjs';
import {
  SPEECH_DEFAULTS,
  validateMicrophoneGain,
  validateSpeechSettings,
} from './renderer/speech-settings.mjs';
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
} from './renderer/language-settings.mjs';
import { uiText } from './interface-translations.mjs';
import { FilePermissions, protectedLocations } from '../../integrations/filesystem/permissions.mjs';
import {
  APPLICATION_DEFAULTS,
  validateApplications,
} from '../../integrations/desktop-actions/settings.mjs';
import { ensureDesktopActions } from '../../integrations/desktop-actions/provision.mjs';
import {
  INITIATIVE_DEFAULTS,
  initiativeAppExcluded,
  quietHour,
  validateInitiative,
} from './initiative-settings.mjs';
import { WindowsObserver } from './windows-observer.mjs';
import { WildTabs, wildTabReactionGenerator } from './wild-tabs.mjs';
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
import { createWindowsPlaybackReader } from '../../integrations/perception/windows-playback.mjs';
import { isClipCommand } from './clip-command.mjs';
import { avatarTapsSleeping, isSleepCommand, SleepService } from './sleep-service.mjs';
import { ScreenshotFiles } from './screenshot-files.mjs';
import { ScreenClipFrames } from './screen-clip-frames.mjs';
import { ScreenFrameWorker } from './screen-frame-worker.mjs';
import { ControlOverlay } from './main/control-overlay.mjs';
import { ControlWindowLayer } from './main/control-window-layer.mjs';
import { AvatarDetach, avatarDragCanTeleport } from './main/avatar-detach.mjs';
import { createAvatarScreenTargetDetector } from './main/avatar-screen-targets.mjs';
import {
  ambientSurfaceClip,
  nextSurfaceActions,
  surfaceLanding,
} from './main/avatar-surface-landing.mjs';
import { hangingCelActions } from './renderer/hanging-cels.mjs';
import { DesktopTeleportMenu } from './main/desktop-teleport-menu.mjs';
import {
  settingsAvatarWindowId,
  watchAvatarSettingsWindow,
} from './main/avatar-settings-window.mjs';
import { isSettingsWindowTitle, randomAvatarDestination } from './desktop-avatar-commands.mjs';
import {
  AvatarClickReactions,
  avatarClickCue,
  avatarClickGenerator,
} from './avatar-click-reactions.mjs';
import {
  avatarDockFrame,
  avatarDockPoint,
  nearestAvatarDock,
  nearestWindowAvatarDock,
  nearestDisplayAvatarDock,
  pointInReservedDesktop,
  visibleAvatarDock,
} from './avatar-docking.mjs';
import {
  COMMUNICATION_STYLES,
  readCommunicationSelection,
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
import { OncePerLaunch } from './microphone-on-start.mjs';

const callAudioDiagnostics = new CallAudioDiagnostics();
// The microphone is offered once per launch, not on every window reload.
const microphoneLaunch = new OncePerLaunch();
const directory = path.dirname(fileURLToPath(import.meta.url));
const applicationIcon = path.join(resourceRoot, 'assets/default/icon-source.png');
const verification = process.argv.includes('--verification');
if (verification) {
  // Legacy visual verifiers enumerate application windows with an attached page.
  // Include the companion BaseWindow alongside the BrowserWindow-based dialogs.
  BrowserWindow.getAllWindows = () => BaseWindow.getAllWindows().filter((view) => view.webContents);
}
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
const graphicsFile = path.join(state, 'window-graphics.json');
const windowGraphics = configureWindowGraphics(app, graphicsFile);
// Resolve the installation-specific identity before reading credentials or
// initializing owner files. A duplicate must only notify the current owner.
app.setName(verification ? 'Capri Verification' : 'Capri');
if (process.platform === 'win32') app.setAppUserModelId(applicationId(verification ? state : root));
for (const folder of ['profile', 'crashes'])
  mkdirSync(path.join(state, folder), { recursive: true, mode: 0o700 });
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
  let window;
  let gpuProcessFailures = 0;
  app.on('child-process-gone', (_event, { type, reason }) => {
    if (type !== 'GPU' || reason === 'clean-exit') return;
    if (++gpuProcessFailures !== 1 || !window || window.isDestroyed()) return;
    const contents = window.webContents;
    if (contents.isDestroyed() || contents.isCrashed()) return;
    try {
      contents.send('capri:event', { type: 'window.portrait-fallback' });
    } catch {
      // If Chromium is restarting, bootstrap will apply the fallback on reload.
    }
  });
  const skillSettings = new SkillSettings(path.join(state, 'skills.json'));
  const skillEnabled = (id) => skillSettings.enabled(id);
  const skills = new CapriCore({
    operationSignal: (request) => skillSettings.operationSignal(request),
  });
  const callSkill = (skillId, command, input, { source = 'host', signal } = {}) =>
    skills.call({ skillId, command, input }, { source, signal });
  const setComposerTurnMode = (id, enabled) => {
    skillSettings.setTurnMode(id, enabled);
    return callSkill(id, 'setMode', enabled, { source: 'companion' });
  };
  const requestComputerAccess = (enabled, { signal } = {}) =>
    callSkill('capri.computer', 'requestAccess', enabled, { signal, source: 'tool' });
  const runComputerSkill = (
    goal,
    { signal, previousTask, ownerRequestedCall, planningEffort } = {},
  ) =>
    callSkill(
      'capri.computer',
      'run',
      {
        goal,
        previousTask,
        ownerRequestedCall,
        planningEffort,
      },
      { signal, source: 'tool' },
    );
  configureResponseTimings(
    new ResponseTimingLog(
      path.join(verification ? verificationFolder : root, 'logs/response-desktop.jsonl'),
    ),
  );
  const chessDiagnostics = new ChessDiagnostics(
    path.join(verification ? verificationFolder : root, 'logs/chess.jsonl'),
  );
  const chessTrace = (operation, context) => chessDiagnostics.start(operation, context);
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
  const chatgpt = new ChatGPTPlanAuth({
    root: verification ? verificationFolder : root,
    storage: credentialStorage(safeStorage),
    openBrowser: (url) => shell.openExternal(url),
    fetchImpl: (url, options) =>
      session.fromPartition('capri-chatgpt', { cache: false }).fetch(url, {
        ...options,
        bypassCustomProtocolHandlers: true,
      }),
  });
  const inferenceApi = new InferenceApi({
    root: verification ? verificationFolder : root,
    storage: credentialStorage(safeStorage),
    proxySession: () => session.fromPartition('capri-inference-proxy', { cache: false }),
    chatgpt,
    ...(verification ? { config: apiSettings() } : {}),
  });
  rt.remote = inferenceApi.config;
  let nativeNpu = null;
  if (
    !rt.remote.enabled &&
    readModelDevices(verification ? verificationFolder : root).language.startsWith('npu-')
  ) {
    try {
      nativeNpu = new NpuInference({ root: verification ? verificationFolder : root });
    } catch {
      nativeNpu = new NpuInference({
        root,
        config: { backend: 'openvino', modelPath: '', python: '', contextTokens: 8192 },
      });
    }
    if (!nativeNpu.active)
      nativeNpu.ready = async () => {
        throw Error('The native NPU selection changed. Select your NPU again in Model devices.');
      };
    rt.nativeNpu = nativeNpu; // A bad NPU selection must fail visibly, never load an unrelated CPU/GPU model.
  }
  const externalTts = new ExternalTts({
    root: verification ? verificationFolder : root,
    storage: credentialStorage(safeStorage),
    fetchImpl: (url, options) =>
      session.fromPartition('capri-voice-api', { cache: false }).fetch(url, {
        ...options,
        bypassCustomProtocolHandlers: true,
      }),
  });
  const diagnosticModel = diagnosticModelId(rt.remote.enabled ? rt.remote.model : settings.model);
  if (diagnosticModel)
    writeModelSelectionLog(
      path.join(verification ? verificationFolder : root, 'logs'),
      diagnosticModel,
    );
  const npuDialogue =
    Boolean(rt.nativeNpu) ||
    (rt.remote.enabled && isLemonadeNpuEndpoint(new URL(rt.remote.baseUrl), rt.remote.model));
  const screenVisionAvailable = rt.nativeNpu
    ? false
    : rt.remote.enabled
      ? rt.remote.vision
      : !settings.modelCapabilities || settings.modelCapabilities.includes('vision');
  rt.inferenceUrl = rt.remote.enabled ? `http://127.0.0.1:${rt.gatewayPort + 2}` : rt.ollamaUrl;
  rt.remoteProxyToken = inferenceApi.proxyToken;
  const inferenceOptions = rt.nativeNpu
    ? { fetchImpl: nativeNpu.fetch, modelCapabilities: [] }
    : rt.remote.enabled
      ? {
          fetchImpl: inferenceApi.localFetch,
          modelCapabilities: [
            ...(rt.remote.tools ? ['tools'] : []),
            ...(rt.remote.vision ? ['vision'] : []),
          ],
        }
      : { fetchImpl: localTimingFetch };
  const auxiliaryRunnerParams = Object.freeze({
    num_ctx: nativeNpu?.config.contextTokens ?? settings.contextTokens,
    ...(!rt.remote.enabled ? localRunnerOptions(settings) : {}),
  });
  if (!Number.isInteger(rt.gatewayPort) || rt.gatewayPort < 1024 || rt.gatewayPort > 65535)
    throw new Error('Invalid local Gateway port');
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
  const installedAvatar = loadInstalledAvatar(resourceRoot);
  const { catalog } = installedAvatar;
  const startupIntroPack = catalog.animated ? loadStartupIntro(resourceRoot) : null;
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
  const avatarFramesByUrl = new Map(catalog.frames.map((frame) => [frame.url, frame]));
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
  const verticalSize = { width: 480, height: 660 };
  const horizontalSize = { width: 698, height: 282 };
  const layoutMinimum = {
    vertical: { width: 380, height: 520 },
    horizontal: { width: 525, height: 235 },
  };
  let activeWindowSize = verticalSize;
  let activeWindowLayout = 'vertical';
  let activeMonitorWidth = 0;
  let replyWindowSpace = REPLY_SPACE;
  let replyResizeTimer;
  function windowSize(workArea) {
    if (replyWindowSpace === REPLY_SPACE) return activeWindowSize;
    const height = Math.min(activeWindowSize.height, workArea.height);
    return {
      width: activeWindowSize.width,
      height: fittedReplyHeight(height, replyWindowSpace),
    };
  }
  function companionMonitorWidth(settings, { graphs, meters } = resourceMonitorDisplay(settings)) {
    if (settings.windowLayout !== 'horizontal') return 0;
    if (graphs.length) return 122;
    if (meters.length) return settings.memoryStyle === 'rings' ? 80 : 122;
    return 0;
  }
  function preferredWindowSize(layout, monitorWidth) {
    const fallback = layout === 'horizontal' ? horizontalSize : verticalSize;
    const remembered = saved.layoutSizes?.[layout];
    const minimum = layoutMinimum[layout];
    const valid = (key) => Number.isSafeInteger(remembered?.[key]) && remembered[key] > 0;
    return {
      width:
        (valid('width') ? Math.max(minimum.width, remembered.width) : fallback.width) +
        monitorWidth,
      height: valid('height') ? Math.max(minimum.height, remembered.height) : fallback.height,
    };
  }
  const allowedResources = createDesktopResources({
    root: resourceRoot,
    directory,
    catalog,
    spriteFile,
    startupIntro: startupIntroPack,
  });

  let tray, regions, pointer, resizeSurface, controlTimer, saveTimer, layoutSaveTimer;
  let attachmentViewer;
  let windowFootprint, compactPlacement;
  let avatarDetach, avatarClickReactions, avatarComposer, wildTabs;
  let avatarComposerDismissed = false;
  let avatarComposerState = sanitizeAvatarComposerState({});
  let detachedReplyHovered = false;
  const avatarComposerActions = new Map();
  let avatarComposerPicking = false;
  let perch,
    desktopFrame,
    portraitFace,
    avatarRoamCapture,
    avatarDesktopUpdate = false;
  function currentAvatarContext() {
    const phase = avatarDetach?.phase ?? 'attached';
    let mode = 'hidden';
    let frame, face;
    if (phase === 'detached') {
      const overlay = avatarDetach.overlay;
      if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
        mode = avatarDetach.presentation === 'character' ? 'desktop' : 'dialogue';
        frame = avatarFramesByUrl.get(avatarDetach.session?.spriteUrl);
        face = avatarDetach.face;
      }
    } else if (phase !== 'attached') {
      mode = 'moving';
    } else if (
      rendererReady &&
      window &&
      !window.isDestroyed() &&
      window.isVisible() &&
      !window.isMinimized()
    ) {
      mode = regions?.sprite.enabled ? 'portrait' : regions?.footprint ? 'compact' : 'hidden';
      frame = desktopFrame;
      face = portraitFace;
    }
    const elapsed = Date.now() - (face?.startedAt ?? 0);
    const activity =
      elapsed >= 0 && elapsed < (faceAnimations[face?.clip]?.duration ?? 0) ? face.clip : undefined;
    return describeOwnAvatar({
      mode,
      frame,
      expression: face?.expression ?? frame?.expression,
      activity,
      placement: perch?.seated && !perch.hidden && perch.record ? 'window' : 'display',
      character: catalog.animated,
    });
  }
  const avatarRoaming = new AvatarRoaming();
  const idleCursorRoaming = new AvatarRoaming({ enabledKey: 'avatarRoamCursorPranks' });
  let settingsHost;
  let settingsPreview = {};
  const liveCompanionSettings = () => settingsPreview.companion ?? companionPreferences.value;
  const liveLanguages = () => settingsPreview.languages ?? languages.snapshot();
  const liveMicrophone = () => settingsPreview.microphone ?? audioInputs.snapshot();
  const livePersona = () =>
    personaPrompt(rt, {
      ...settingsPreview,
      prioritizeStyle: true,
      unrestrictedConversation: companionPreferences.value.unrestrictedConversation,
    });
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
  let chess, chessReactions;
  let reminders,
    sessionLocked = false;
  let pendingMemoryDecision, latestMemoryCandidate;
  let memoryWarmup;
  const reminderListeners = new Set();
  let shuttingDown = false;
  let maintenance = false;
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
  const localModelLoad = new LocalModelLoad({
    root,
    dataRoot: verification ? verificationFolder : root,
  });
  let localInferenceTasks = 0;
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
    installSupported: process.platform === 'win32',
    root,
    state,
    node: nodePath,
    emit,
    credential: () => githubAccess.credential(),
  });
  const automaticUpdatesEnabled =
    !verification || process.env.CAPRI_DESKTOP_VERIFICATION_UPDATE_CHECK === '1';
  let updateNoticeTag;
  const speechInstaller = new SpeechInstallService({
    root: verification ? verificationFolder : root,
    node: nodePath,
    emit,
    install: (selection, options) =>
      installSpeechComponents(selection, {
        ...options,
        credential: () => githubAccess.credential(),
      }),
    before: async (signal, selection) => {
      if (selection.recognition !== 'off') {
        microphone.stop();
        microphone.worker.close();
      }
      voiceStartController?.abort();
      voice.close();
      voice.setReady(false);
      await voiceStartPromise?.catch(() => {});
      signal.throwIfAborted();
      if (!verification) await stopManaged('companion-voice');
    },
    ready: async () => {
      voiceAvailable = externalTts.config.enabled || verification || companionVoiceInstalled();
      voiceAllowed =
        voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
      asrInstalled = recognitionInstalled(asrConfig.language);
      microphone.publish({ available: asrAllowed && asrInstalled });
      if (
        skillEnabled('capri.voice-output') &&
        voiceAvailable &&
        !voice.enabled &&
        voiceVolume.value.volume > 0
      )
        changeVoice(true);
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
    hfHub
      .list()
      .filter((item) => item.profile && !hasSpeculativeDraft(item))
      .map((item) => item.profile);
  const activeHfPackage = hfHub.list().find((item) => item.profile?.alias === settings.model);
  const localModelName = activeHfPackage?.repository ?? settings.upstreamModel ?? settings.model;
  const localResidency = new LocalModelResidencySampler({ url: rt.ollamaUrl });
  const models = new ModelService({ rt, config: settings, emit, customProfiles: importedProfiles });
  let modelIdlePolicy = readModelIdlePolicy(state);
  const modelIdleSeconds = () => modelIdlePolicy.idleMinutes * 60;
  nativeNpu?.setIdleUnload(modelIdlePolicy.unloadIdle, modelIdleSeconds());
  let modelWarmup, modelWarmupController;
  const localLanguage = Boolean(nativeNpu || !rt.remote.enabled);
  let modelMemory = localLanguage && !verification ? 'unloaded' : 'ready';
  let nextModelMemoryProbe = 0,
    modelMemoryProbePending = false;
  function setModelMemory(value) {
    if (!localLanguage || modelMemory === value) return;
    modelMemory = value;
    emit({ type: 'models.memory', state: value });
  }
  async function refreshModelMemory() {
    if (
      verification ||
      !localLanguage ||
      shuttingDown ||
      !companionPresent() ||
      backendState.phase !== 'ready' ||
      modelMemory === 'loading' ||
      modelMemoryProbePending ||
      Date.now() < nextModelMemoryProbe
    )
      return;
    const priorState = modelMemory;
    nextModelMemoryProbe = Date.now() + 2000;
    modelMemoryProbePending = true;
    try {
      if (nativeNpu) {
        if (nativeNpu.resident) setModelMemory('ready');
        else if (priorState !== 'failed') setModelMemory('unloaded');
        return;
      }
      const residency = await localResidency.sample({ model: settings.model });
      if (modelMemory !== priorState || backendState.phase !== 'ready') return;
      if (residency.totalBytes > 0 || ['cpu', 'gpu', 'partial'].includes(residency.status))
        setModelMemory('ready');
      else if (residency.status === 'unloaded' && priorState !== 'failed')
        setModelMemory('unloaded');
    } finally {
      modelMemoryProbePending = false;
    }
  }
  async function prepareLocalModel(work, signal) {
    if (modelMemory !== 'ready') setModelMemory('loading');
    try {
      const value = await work();
      setModelMemory('ready');
      return value;
    } catch (error) {
      setModelMemory(signal?.aborted ? 'unloaded' : 'failed');
      throw error;
    } finally {
      localResidency.invalidate();
      nextModelMemoryProbe = 0;
    }
  }
  const npuSetup = new NpuSetupService({ root: verification ? verificationFolder : root });
  const modelDevices = new ModelDeviceService({
    root: verification ? verificationFolder : root,
    ollama: llamaPath,
    config: settings,
    npuSetup,
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
    await breezeVoice.cancel();
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
  const youtubeMusicService = new YouTubeMusicService({
    root,
    openExternal: (url) => shell.openExternal(url),
  });
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
  const wildInputPranks = new WildInputPranks();
  const applicationAccess = new ApplicationAccess({
    file: path.join(state, 'application-access.json'),
    changed: (settings) => emit({ type: 'application.access', settings }),
    stop: async () => {
      workflows?.cancel();
      companionActions.approvals.cancel();
      await spotifyService?.close();
      wildInputPranks.pause();
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
      if (!value.enabled) {
        wildInputPranks.pause();
        void computerControl.stop();
      }
      chat.computerApproval(value.enabling);
      emit({ type: 'computer-access', settings: value });
    },
  });
  const filePermissions = new FilePermissions(path.join(state, 'file-permissions.json'), {
    protectedRoots: verification ? [state] : protectedLocations(root),
    privatePaths: [
      state,
      rt.stateDir,
      brain.folder,
      path.join(root, 'data/secrets'),
      path.join(root, 'data/speech/companion-voice-token'),
      path.join(root, 'data/config-backups'),
      path.join(root, 'data/run'),
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
  const audioRoutes = new Preferences(
    path.join(state, 'audio-routing.json'),
    AUDIO_ROUTING_DEFAULTS,
    audioRoutingPreferences,
  );
  const windowsAudio = new WindowsAudioEndpoints({ root });
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
  const callCamera = new CallCamera({
    root,
    background: new CallCameraBackground(path.join(state, 'call-camera-background.json')),
    platform:
      verification && process.env.CAPRI_DESKTOP_VERIFICATION_CAMERA !== '1' ? '' : process.platform,
    notify: (state) => {
      emit({ type: 'call-camera.state', state });
      syncCameraPreview();
    },
  });
  let cameraPreview = false;
  function setCameraPreview(enabled) {
    if (cameraPreview === enabled) return;
    cameraPreview = enabled;
    syncCameraPreview();
  }
  function syncCameraPreview() {
    const enabled = cameraPreview && !sessionLocked;
    const detached = Boolean(avatarDetach?.cameraSource());
    if (window && !window.isDestroyed() && !window.webContents.isCrashed())
      window.webContents.send('capri:event', {
        type: 'call-camera.preview',
        enabled,
        detached,
      });
    avatarDetach?.sendCameraState(sessionLocked ? null : callCamera.snapshot(), enabled);
  }
  const generateCallReply = callResponseGenerator({
    url: rt.inferenceUrl,
    model: settings.model,
    params: auxiliaryRunnerParams,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
  });
  let listingAudioInputs = false,
    audioInputRefresh;
  let microphoneMonitorGrant;
  function stopMicrophoneMonitor() {
    microphoneMonitorGrant = undefined;
    settingsHost?.send({ type: 'microphone.monitor-stop' });
  }
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
    ...(process.platform === 'darwin' ||
    (verification && process.env.CAPRI_DESKTOP_VERIFICATION_ROUTER !== '1')
      ? { config: { schemaVersion: 1, enabled: false, timeoutMs: 150 } }
      : {}),
  });
  const responseTiming = responsiveness({ ...settings, availableRamBytes: freemem() });
  const emulatedX64 = windowsX64Emulation();
  const internetSearch = new WebSearch({ readPages: true });
  const coding = new CodingService({
    root: verification ? verificationFolder : root,
    onProjectChange: (monitor) => emit({ type: 'coding.project', monitor }),
  });
  const codingRevisions = new CodingRevisions(coding, {
    changed: (changes) => emit({ type: 'coding.changes', changes }),
    review: () => void settingsHost?.open('coding').catch((error) => console.error(error.message)),
  });
  const codingAgent = new CodingAgent({
    service: coding,
    applyEdits: (edits, options) => codingRevisions.apply(edits, options),
    url: rt.inferenceUrl,
    model: settings.model,
    ...inferenceOptions,
    params: auxiliaryRunnerParams,
    emit,
  });
  skills.register(webSearchSkill, {
    searchWeb: (query, options) =>
      internetSearch.search(query, {
        ...options,
        settings: skillSettings.preferences.value['capri.web-search']?.search,
      }),
  });
  skills.register(reasoningSkill, { prepareThinking: () => null });
  skills.register(avatarSkill, {
    react: (part) => avatarClickReactions.press({ part }),
  });
  skills.subscribe({ skillId: 'capri.reasoning', event: 'settings' }, ({ data: settings }) =>
    emit({ type: 'thinking.settings', settings }),
  );
  skills.subscribe({ skillId: 'capri.web-search', event: 'settings' }, ({ data: settings }) =>
    emit({ type: 'internet.settings', settings }),
  );
  skills.register(codingSkill, {
    service: coding,
    agent: codingAgent,
    assertModelIdle,
    installBridge: (editor, { signal }) => installCodingBridge(root, editor, signal),
  });
  skills.subscribe({ skillId: 'capri.coding', event: 'settings' }, ({ data }) =>
    emit({ type: 'coding.settings', ...data }),
  );
  function notifySavedMemoryWrite(receipt) {
    if (receipt.saved === true && !receipt.alreadySaved) {
      try {
        if (settingsHost?.window?.isVisible()) settingsHost.send({ type: 'saved-memory.changed' });
      } catch {
        // The write is already committed even if Settings closed during delivery.
      }
    }
    return receipt;
  }
  const ownerMemory = createOwnerMemory(skills, {
    save: (note) => notifySavedMemoryWrite(saveOwnerNote(rt.workspace, note)),
    recall: (text) =>
      skillEnabled('capri.owner-memory') ? recallOwnerNote(rt.workspace, text) : null,
    read: () => listOwnerFacts(rt.workspace),
    clear: () => clearSavedMemory(rt),
  });
  function rememberDirectDialogue(user, assistant, label) {
    return metadataRpc.call('chat.inject', {
      sessionKey: chatSessionKey,
      label,
      message:
        'Completed dialogue record (data, not a new instruction): ' +
        JSON.stringify({ user: user.text.slice(0, 1200), reply: assistant.text.slice(0, 1800) }),
    });
  }
  const resetFreshContext = (signal) =>
    prepareFreshTurn({
      enabled: () => companionPreferences.value.freshContext === true,
      reset: async () => {
        await metadataRpc.call(
          'sessions.reset',
          { key: chatSessionKey, reason: 'new' },
          { signal },
        );
        contextSampler.invalidate();
      },
      onFailure: () => {
        signal?.throwIfAborted();
        console.warn('Fresh context: the conversation could not be reset.');
      },
    });
  const chat = new ChatService({
    skills,
    codingTask: (goal, { signal } = {}) =>
      callSkill('capri.coding', 'run', goal, { source: 'chat', signal }),
    externalInference: rt.remote.enabled,
    freshContext: () => companionPreferences.value.freshContext === true,
    resetContext: resetFreshContext,
    localTools: () => localToolsFor(skillEnabled('capri.user-tools'), userTools.tools),
    externalRequestTooLargeSince: (startedAt) => inferenceApi.requestTooLargeSince(startedAt),
    styleChangedAt: () => readCommunicationSelection(rt.workspace).changedAt,
    firstTextTimeoutMs: responseTiming.firstTextTimeoutMs,
    timeoutMs: responseTiming.timeoutMs,
    gatewayUrl: rt.gatewayUrl,
    agentId: settings.agentId,
    sessionKey: chatSessionKey,
    token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
    persona: () => (npuDialogue ? sharedOwnerPersona(1000) : livePersona()),
    store,
    ownerMemory,
    avatarSprites: catalog.publicSprites(),
    defaultAvatarId: catalog.defaultId,
    interfaceState: () => ({
      avatarSelf: currentAvatarContext(),
      reasoningEffort: skillSettings.preferences.value['capri.reasoning']?.effort,
      activeSkills: new Set(
        Object.entries(skillSettings.snapshot())
          .filter(([, preference]) => preference.enabled)
          .map(([id]) => id),
      ),
      applications: {
        notepad:
          skillEnabled('capri.applications') &&
          applicationAccess.mask(applications.snapshot()).notepad,
        calculator: skillEnabled('capri.calculator'),
      },
      spotify: {
        ...spotify.snapshot(),
        enabled: skillEnabled('capri.spotify') && spotify.snapshot().enabled,
      },
      youtubeMusic: {
        enabled: skillEnabled('capri.youtube-music'),
        preferred: skillSettings.preferences.value['capri.youtube-music'].preferred,
      },
      applicationAccess: skillEnabled('capri.applications') && applicationAccess.enabled,
      computerSkillEnabled: skillEnabled('capri.computer'),
      fullComputerAccess:
        skillEnabled('capri.computer') && fullComputerAccess.enabled && applicationAccess.enabled,
      followUp:
        liveCompanionSettings().followUp &&
        !microphone.capture?.conversationMode &&
        microphone.status === 'listening',
      languages: liveLanguages(),
      microphone: microphone.status === 'listening',
      microphoneLanguage: microphone.config.language,
      wakePhrase: microphone.snapshot().wakePhrase,
      screenObservation: skillEnabled('capri.screen') ? media.screen.context() : null,
      screenVisionAvailable: skillEnabled('capri.screen') && screenVisionAvailable,
      modelToolsAvailable: rt.nativeNpu
        ? false
        : rt.remote.enabled
          ? rt.remote.tools
          : !settings.modelCapabilities || settings.modelCapabilities.includes('tools'),
      recentScreenshot: skillEnabled('capri.screen') ? lastScreenshot : null,
      temporalContext: skillEnabled('capri.timers') ? temporal?.context() : '',
    }),
    requestRouter,
    selectComputerTool:
      !verification && process.platform === 'win32'
        ? computerToolSelector({
            url: rt.inferenceUrl,
            model: rt.remote.enabled ? rt.remote.model : settings.model,
            params: auxiliaryRunnerParams,
            ...inferenceOptions,
          })
        : null,
    directLocalDialogue:
      !verification && !npuDialogue && !rt.remote.enabled
        ? (payload, signal) =>
            inferenceOptions.fetchImpl(rt.inferenceUrl + '/v1/chat/completions', {
              method: 'POST',
              redirect: 'error',
              headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
              body: JSON.stringify({ ...payload, model: settings.model, reasoning_effort: 'none' }),
              signal,
            })
        : null,
    npuDialogue: npuDialogue
      ? (payload, signal) =>
          (rt.nativeNpu ? nativeNpu.fetch : inferenceApi.localFetch)(
            rt.inferenceUrl + '/v1/chat/completions',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
              body: JSON.stringify(payload),
              signal,
            },
          )
      : null,
    commitNpuDialogue:
      npuDialogue && !verification
        ? (user, assistant) => rememberDirectDialogue(user, assistant, 'Local NPU conversation')
        : null,
    localCalculation: (input, args, signal) =>
      companionActions.execute('application_control', input.id, args, signal),
    localMusic: (input, args, signal) =>
      companionActions.execute('spotify_control', input.id, args, signal),
    localYouTubeMusic: (input, args, signal) =>
      companionActions.execute('youtube_music_control', input.id, args, signal),
    prepareMusic: spotifyPlanner({
      url: rt.inferenceUrl,
      model: settings.model,
      params: auxiliaryRunnerParams,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
    }),
    prepareYouTubeMusic: spotifyPlanner({
      url: rt.inferenceUrl,
      model: rt.remote.enabled ? rt.remote.model : settings.model,
      params: auxiliaryRunnerParams,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      player: 'YouTube Music',
    }),
    computerTask: async (goal, options) => {
      chat.assertToolAllowed('desktop_control', { action: 'run_task' });
      applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      const result = await runComputerSkill(goal, options);
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
      ...(skillEnabled('capri.screen') && !options.smallTalk
        ? await media.screen.prepare(input, options)
        : {}),
      knowledgeContext:
        !options.smallTalk && skillEnabled('capri.brain')
          ? conversation.brain.context(input.text, { remote: rt.remote.enabled })
          : '',
      userToolContext:
        !options.smallTalk && skillEnabled('capri.user-tools')
          ? await userTools.context(input.text, options)
          : '',
    }),
    prepareModel: verification
      ? null
      : async ({ signal }) => {
          void requestRouter.start();
          await mutedVoiceResidency.release();
          signal.throwIfAborted();
          if (rt.remote.enabled) {
            const firstTextTimeoutMs = openRouterFreeReplyTimeoutMs(rt.remote);
            return {
              remote: true,
              ...(firstTextTimeoutMs && {
                conversationBudget: { firstTextTimeoutMs, source: 'remote-provider' },
              }),
            };
          }
          if (rt.nativeNpu) return prepareLocalModel(() => nativeNpu.ready({ signal }), signal);
          const budgetOptions = {
            session: contextSampler.peekSession(),
            model: settings.model,
            contextTokens: settings.contextTokens,
            emulatedX64,
            historyCharacters: store
              .snapshot()
              .reduce((count, item) => count + (item.text?.length ?? 0), 0),
            ...responseTiming,
          };
          // Share the HUD's bounded/background read; metadata never gates Send.
          void contextSampler.sample({ available: backendState.phase === 'ready' }).catch(() => {});
          const model = await prepareLocalModel(
            () =>
              ensureLanguageModelReady(
                {
                  url: rt.inferenceUrl,
                  model: settings.model,
                  modelCapabilities: settings.modelCapabilities,
                  contextTokens: settings.contextTokens,
                  acceleration: settings.acceleration,
                  cpuThreads: settings.cpuThreads,
                },
                { signal },
              ),
            signal,
          );
          return {
            ...model,
            conversationBudget: conversationBudget({ ...budgetOptions, ...model }),
          };
        },
  });
  // Speech is opt-in for each desktop session, including upgrades with an old
  // enabled preference. Installing a voice/language does not load it into memory.
  let voiceEnabled = skillEnabled('capri.voice-output');
  if (verification && process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1') {
    voiceEnabled = true;
    try {
      voiceEnabled =
        JSON.parse(readFileSync(path.join(state, 'voice.json'), 'utf8')).enabled === true;
    } catch {}
  }
  let voiceAvailable = externalTts.config.enabled || verification || companionVoiceInstalled();
  let voiceAllowed =
    voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
  const voiceVolumeDefaults = { volume: VOICE_VOLUME_DEFAULT, lastAudible: VOICE_VOLUME_DEFAULT };
  const voiceVolume = new Preferences(
    path.join(state, 'voice-volume.json'),
    voiceVolumeDefaults,
    voiceVolumeSettings,
  );
  const voiceSnapshot = () => ({ ...voice.snapshot(), volume: voiceVolume.value.volume });
  let lastSpokenApi;
  const speechInstalled = (language) => {
    if (externalTts.config.enabled) return true;
    if (verification && ['0', '1'].includes(process.env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS))
      return (
        process.env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS === '1' &&
        LANGUAGE_PACKS.some((pack) => pack.id === language && pack.speechReady)
      );
    return speechModelsInstalled(root, language);
  };
  const breezeVoice = new BreezeVoice({ root });
  const nativeVoice = (language) => {
    if (language === 'off') return null;
    try {
      return selectedVoiceModel(root, language).backend === 'breeze-tts' ? breezeVoice : null;
    } catch {
      return null;
    }
  };
  const voice = new VoiceService({
    url: companionVoiceUrl(),
    headers: companionVoiceHeaders,
    external: externalTts,
    native: nativeVoice,
    ensureReady: () => connectVoice(),
    emit: (event) => {
      emit(event);
      if (event.type === 'voice.generated' && externalTts.config.enabled)
        lastSpokenApi = externalTts.config;
      if (['voice.settings', 'voice.generated', 'voice.cancelled'].includes(event.type))
        mutedVoiceResidency.scheduleIdle();
    },
    enabled: voiceAllowed && voiceEnabled && voiceVolume.value.volume > 0,
    language: voiceAvailable ? resolveLanguages(languages.value).speech : 'off',
  });
  const asrConfig = JSON.parse(readFileSync(path.join(root, 'config/companion-asr.json'), 'utf8'));
  const speechDefaults = {
    ...SPEECH_DEFAULTS,
    trailingSilenceSeconds: asrConfig.trailingSilenceSeconds,
  };
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
  let lastConversationApi;
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
  class SubmissionError extends Error {
    constructor(reason, message) {
      super(message);
      this.reason = reason;
    }
  }
  function thinkingInput(value) {
    const input = validateInput({
      ...value,
      mode: value?.mode ?? (callSkill('capri.coding', 'enabled') ? 'coding' : undefined),
      thinking:
        value?.thinking === undefined ? callSkill('capri.reasoning', 'mode') : value.thinking,
      internet:
        value?.internet === undefined ? callSkill('capri.web-search', 'mode') : value.internet,
    });
    if (input.mode)
      skillSettings.require(input.mode === 'coding' ? 'capri.coding' : 'capri.computer');
    // A composer can still have the old toggle state when a skill is switched off in Settings.
    if (input.thinking && !skillEnabled('capri.reasoning')) input.thinking = false;
    if (input.internet && !skillEnabled('capri.web-search')) input.internet = false;
    return input;
  }
  async function submitMessage(value, origin = 'text') {
    if (origin === 'text' && visualTurn?.kind === 'hands-free') {
      cancelVisual();
      await currentChatTask?.catch(() => {});
    }
    localInferenceTasks++;
    try {
      return await withResponseTiming(value?.id, async () => {
        try {
          return await submitMessageTurn(value, origin);
        } catch (error) {
          markResponseTiming('failed', {
            reason:
              error instanceof SubmissionError
                ? error.reason
                : error?.code === 'skill_disabled'
                  ? 'skill_disabled'
                  : 'internal',
          });
          throw error;
        }
      });
    } finally {
      localInferenceTasks--;
    }
  }
  async function submitMessageTurn(value, origin = 'text') {
    if (maintenance)
      throw new SubmissionError(
        'maintenance',
        'Wait for the current reply or operation to finish.',
      );
    if (chatgpt.signingIn)
      throw new SubmissionError(
        'sign_in',
        'Finish ChatGPT sign-in or cancel it before sending a message.',
      );
    avatarClickReactions?.cancel();
    chessReactions?.cancel();
    wildTabs?.reset();
    const input = thinkingInput(value);
    surfaceRequest++;
    if (surfacePlayUntil > Date.now()) avatarDetach?.playReaction('stopSurface');
    const movement = skillEnabled('capri.avatar-interaction')
      ? callSkill('capri.avatar-interaction', 'interpret', input.text)
      : null;
    if (movement) return submitAvatarCommand(input, movement);
    if (voiceTraining.busy())
      throw new SubmissionError(
        'voice_training',
        'Wait for voice training to finish, or cancel it in Languages.',
      );
    if (settings.modelSetupRequired && !rt.remote.enabled && !rt.nativeNpu)
      throw new SubmissionError(
        'model_setup',
        'Choose and prepare a language model in Settings → Language model first.',
      );
    if (speechInstaller.busy('recognition'))
      throw new SubmissionError(
        'speech_installation',
        'Wait for speech installation to finish, or cancel it in Languages.',
      );
    initiative.activity();
    screenObservation?.activity();
    pendingFollowUp = null;
    if (origin === 'text') microphone.cancelContinuation();
    turnOrigins.set(input.id, {
      origin,
      sessionId: origin === 'microphone' ? microphone.capture?.id : null,
      ended: origin === 'microphone' && endsVoiceConversation(input.text),
    });
    if (turnOrigins.size > 128) turnOrigins.delete(turnOrigins.keys().next().value);
    if (shuttingDown) throw new SubmissionError('shutting_down', 'Capri is shutting down');
    const approval = await companionActions.approvals.text(input.text, {
      source: origin === 'text' ? 'text' : 'voice',
    });
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
    const elapsedReply =
      skillEnabled('capri.timers') && !currentChatTask && temporal?.read(input.text);
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
      if (currentChatTask || chat.active)
        throw new SubmissionError('busy', 'A reply is already in progress.');
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
    if (shuttingDown) throw new SubmissionError('shutting_down', 'Capri is shutting down');
    if (isClipCommand(input.text)) {
      if (clipJobs.has(input.id)) return clipJobs.get(input.id);
      if (currentChatTask || chat.active)
        throw new SubmissionError('busy', 'A reply is already in progress.');
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
    if (backendState.phase !== 'ready')
      throw new SubmissionError('backend_unavailable', 'The local core is not ready yet.');
    if (currentChatTask || chat.active)
      throw new SubmissionError('busy', 'A reply is already in progress.');
    voicePreviewRequest = null;
    const task = chat.send(input, emitChat);
    currentChatTask = task;
    try {
      await task;
      const lastReply = store.messages.at(-1);
      if (
        lastReply?.turnId === input.id &&
        lastReply.status === 'complete' &&
        inferenceApi.config.enabled
      )
        lastConversationApi = inferenceApi.config;
      if (lastReply?.status === 'error') {
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
  async function submitHandsFree(value, alive) {
    if (
      !alive() ||
      currentChatTask ||
      chat.active ||
      playbackBusy ||
      shuttingDown ||
      sessionLocked ||
      maintenance ||
      backendState.phase !== 'ready' ||
      sleepService.phase !== 'awake' ||
      chatgpt.signingIn ||
      voiceTraining.busy() ||
      speechInstaller.busy('recognition')
    )
      return;
    const input = validateInput(value);
    const controller = new AbortController();
    const pending = { id: input.id, controller, kind: 'hands-free' };
    visualTurn = pending;
    localInferenceTasks++;
    const task = (async () => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
      const reply = await handsFreeReply({
        input,
        history: store.snapshot(),
        persona: chat.persona(),
        styleChangedAt: readCommunicationSelection(rt.workspace).changedAt,
        languages: liveLanguages(),
        avatarSelf: currentAvatarContext(),
        model: rt.nativeNpu
          ? nativeNpu.model
          : rt.remote.enabled
            ? rt.remote.model
            : settings.model,
        signal,
        request: (payload, requestSignal) =>
          (inferenceOptions.fetchImpl ?? fetch)(rt.inferenceUrl + '/v1/chat/completions', {
            method: 'POST',
            redirect: 'error',
            signal: requestSignal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
      }).catch(() => null);
      if (!reply || signal.aborted || !alive() || sessionLocked || shuttingDown || maintenance)
        return;
      const base = { turnId: input.id, status: 'complete', createdAt: new Date().toISOString() };
      const user = {
        ...base,
        id: randomUUID(),
        role: 'user',
        text: input.text,
        origin: 'microphone',
      };
      const assistant = { ...base, id: randomUUID(), role: 'assistant', text: reply };
      store.put(user);
      store.put(assistant);
      emitChat({
        type: 'turn.started',
        turnId: input.id,
        user,
        assistant: { ...assistant, text: '' },
      });
      emitChat({ type: 'turn.delta', turnId: input.id, text: reply });
      emitChat({ type: 'turn.completed', turnId: input.id, assistant, warning: store.warning });
      if (!verification)
        void rememberDirectDialogue(user, assistant, 'Hands-free conversation').catch(() => {});
    })();
    currentChatTask = task;
    try {
      await task;
    } finally {
      localInferenceTasks--;
      if (visualTurn === pending) visualTurn = null;
      if (currentChatTask === task) currentChatTask = null;
    }
  }
  const microphone = new MicrophoneService({
    worker: new ASRWorker({
      root,
      language: asrConfig.language,
      deferModel: true,
      unloadIdle: modelIdlePolicy.unloadIdle,
      idleSeconds: modelIdleSeconds(),
    }),
    config: asrConfig,
    conversationMode: companionPreferences.value.conversationMode,
    emit,
    interrupt: () => {
      chat.cancel();
      cancelVisual();
      voice.cancel();
    },
    submit: async (value, alive, { handsFree } = {}) => {
      if (handsFree) return submitHandsFree(value, alive);
      await currentChatTask?.catch(() => {});
      if (!alive()) return;
      await submitMessage(value, 'microphone');
    },
  });
  const routingAvailable = () =>
    process.platform === 'win32' &&
    !sessionLocked &&
    !shuttingDown &&
    window &&
    !window.isDestroyed() &&
    window.webContents.getURL() === rendererUrl;
  const callAudioWindowAvailable = () =>
    routingAvailable() && companionPresent() && !window.isMinimized();
  const callAudioAvailable = () => skillEnabled('capri.voice-calls') && callAudioWindowAvailable();
  const systemAudio = new SystemAudioCapture({
    ownerFrame: () => window?.webContents.mainFrame,
    sessionId: () =>
      callAudioAvailable() && microphone.status === 'listening' ? microphone.capture?.id : null,
    enableReview: (id, wake) => microphone.enableSystemAudioReview(id, wake),
  });
  let nativeSystemArm;
  let nativeSystemCapture;
  function stopNativeSystemAudio() {
    nativeSystemArm = null;
    const capture = nativeSystemCapture;
    nativeSystemCapture = null;
    capture?.controller.abort();
  }
  async function prepareSystemSource(value, { frame, role }) {
    const arm = nativeSystemArm;
    const selected = audioRoutes.value.routes.system;
    if (!selected && !value?.token) {
      return systemAudio.prepare(value?.id, frame, value?.wake);
    }
    if (
      !arm ||
      arm.token !== value?.token ||
      arm.deviceId !== selected ||
      role !== 'companion' ||
      !callAudioAvailable() ||
      frame !== window.webContents.mainFrame ||
      value.wake !== arm.wake ||
      value.id !== microphone.capture?.id ||
      microphone.status !== 'listening'
    )
      throw Error('System audio requires an active microphone in Capri.');

    stopNativeSystemAudio();
    const capture = (nativeSystemCapture = {
      ...arm,
      id: value.id,
      controller: new AbortController(),
    });
    const active = () =>
      nativeSystemCapture === capture &&
      callAudioAvailable() &&
      frame === window.webContents.mainFrame &&
      microphone.capture?.id === capture.id &&
      microphone.status === 'listening';
    const failed = (error) => {
      if (nativeSystemCapture !== capture) return;
      stopNativeSystemAudio();
      if (window && !window.isDestroyed() && frame === window.webContents.mainFrame)
        window.webContents.send('capri:event', {
          type: 'system-audio.source-ended',
          token: capture.token,
          message: error.message,
        });
    };
    try {
      await windowsAudio.capture(selected, {
        signal: capture.controller.signal,
        onError: failed,
        onPacket: (pcm) => {
          if (!active()) {
            if (nativeSystemCapture === capture)
              failed(Error('The selected audio source disconnected.'));
            return;
          }
          window.webContents.send('capri:event', {
            type: 'system-audio.pcm',
            token: capture.token,
            pcm,
          });
        },
      });
      if (!active() || !microphone.enableSystemAudioReview(capture.id, value.wake))
        throw Error('System audio requires an active microphone in Capri.');
      return { native: true };
    } catch (error) {
      if (nativeSystemCapture === capture) stopNativeSystemAudio();
      throw error;
    }
  }
  let musicSuspended = false;
  // The enabled music listener can still pace the portrait while Capri sleeps.
  const musicAvailable = () =>
    skillEnabled('capri.music') &&
    process.platform === 'win32' &&
    !sessionLocked &&
    !musicSuspended &&
    !shuttingDown &&
    !quitting &&
    window &&
    !window.isDestroyed() &&
    window.webContents.getURL() === rendererUrl;
  const musicListening = new MusicListeningService({
    root,
    settings: liveMusicSettings,
    available: musicAvailable,
    emit: (event) => {
      if (!event.enabled) musicAudio?.revoke();
      emit(event);
      avatarDetach?.sendMusic({
        enabled: event.enabled && event.settings.enabled,
        hearingMusic: event.hearingMusic,
        energy: event.energy,
        tempo: event.tempo,
        tempoConfidence: event.tempoConfidence,
        beatAt: event.beatAt,
        notes: event.settings.notes,
        motion: event.settings.motion,
        autoBpm: event.settings.autoBpm !== false,
      });
    },
  });
  const musicAudio = new MusicAudioCapture({
    ownerFrame: () => window?.webContents.mainFrame,
    sessionId: () => (musicAvailable() ? musicListening.session?.id : null),
    available: musicAvailable,
  });
  const media = createMediaSkills(skills, {
    microphone: {
      start: startMicrophone,
      confirm: (id) => microphone.confirm(id),
      listen: listenMicrophone,
      devices: refreshAudioInputs,
      selectDevice: changeAudioInput,
      stop: ({ id, keepModelWarm }) => {
        const stopped = microphone.stop(id);
        if (stopped && !keepModelWarm) {
          microphone.worker.close();
          microphone.publish();
        }
        return stopped;
      },
      snapshot: () => microphone.snapshot(),
    },
    music: {
      configure: (value) => {
        musicPreferences.set(validateMusicListeningSettings(value));
        return musicListening.publish();
      },
      start: () => musicListening.start(),
      ready: (id) => musicListening.ready(id),
      stop: (id) => {
        if (id === undefined || id === musicListening.session?.id) musicAudio.revoke();
        return musicListening.stop(id);
      },
      snapshot: () => musicListening.snapshot(),
    },
    screen: {
      context: () => screenObservation?.context() ?? null,
      prepare: prepareScreenContext,
      configure: (value) => screenPreferences.set(observationOptions(value)),
      preferences: () => screenPreferences.snapshot(),
      snapshot: () => screenObservation.snapshot(),
      stop: () => screenObservation.stop(),
    },
  });
  let musicStartup;
  let nativeMusicPlaybackTail = 0;
  async function startNativeMusic(deviceId, startup) {
    const { sessionId } = await media.music.start();
    const musicSession = musicListening.session;
    if (!musicSession || musicSession.id !== sessionId)
      throw Error('The selected audio source could not start.');
    startup.signal.throwIfAborted();
    await windowsAudio.capture(deviceId, {
      signal: musicSession.controller.signal,
      onPacket: nativeMusicPackets({
        muted: () => !musicSession.capture || playbackBusy || Date.now() < nativeMusicPlaybackTail,
        deliver: (sequence, pcm) =>
          musicListening.packet({ sessionId, sequence, pcm, capturedAt: Date.now() }),
      }),
      onError: (error) => {
        if (musicListening.session === musicSession) musicListening.fail(error.message);
      },
    });
    if (!(await media.music.ready(sessionId)))
      throw Error('The selected audio source could not start.');
  }
  function stopMusicListening() {
    if (musicStartup) {
      musicStartup.abort();
      musicStartup = undefined;
      emit({ type: 'music.stop-requested' });
    }
    return media.music.stop(undefined, 'host');
  }
  async function startMusicListening() {
    if (musicStartup || musicListening.session) return;
    const startup = (musicStartup = new AbortController());
    const error = () => Error('Music listening could not start. Try again from Settings.');
    const source = audioRoutes.value.routes.music;
    let timer;
    try {
      if (!musicAvailable()) throw error();
      await Promise.race([
        source
          ? startNativeMusic(source, startup)
          : window.webContents.executeJavaScript('window.capriStartMusicListening()', true),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(error()), 15000);
          startup.signal.addEventListener('abort', () => reject(error()), { once: true });
        }),
      ]);
    } catch {
      if (musicStartup !== startup) return;
      stopMusicListening();
      const failure = source ? Error('The selected audio source could not start.') : error();
      musicListening.fail(failure.message);
      throw failure;
    } finally {
      clearTimeout(timer);
      if (musicStartup === startup) musicStartup = undefined;
    }
  }
  function restoreMusicListening() {
    if (!musicAvailable() || window.webContents.isLoading()) return;
    if (powerMonitor.getSystemIdleState(1) === 'locked') return;
    void startMusicListening().catch(() => {});
  }
  async function startMicrophone() {
    if (speechInstaller.busy('recognition')) return microphone.startBlocked('ASR_START_INSTALLING');
    if (
      shuttingDown ||
      sessionLocked ||
      powerMonitor.getSystemIdleState(1) === 'locked' ||
      !['ready', 'asleep'].includes(backendState.phase)
    )
      return microphone.startBlocked('ASR_START_CORE_NOT_READY');
    if (!asrAllowed || !asrInstalled) return microphone.startBlocked('ASR_START_PACK_MISSING');
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
  }
  function listenMicrophone() {
    if (speechInstaller.busy('recognition'))
      throw new Error('Wait for speech installation to finish, or cancel it in Languages.');
    if (shuttingDown || !['ready', 'asleep'].includes(backendState.phase)) return false;
    return microphone.listenNow();
  }
  function callAudioSnapshot() {
    return {
      ...currentCallAudio,
      ...callAudioPolicy.snapshot(),
      preferredDeviceId: audioRoutes.value.routes.call,
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
    stopNativeSystemAudio();
    if (window && !window.isDestroyed())
      systemAudio.cancel(microphone.capture?.id, window.webContents.mainFrame);
    cancelCallVoice();
    currentCallAudio = callAudioState();
    emit({ type: 'call-audio.reset' });
  }
  async function listOwnerAudioDevices(available = routingAvailable) {
    if (!available()) return [];
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
      return available() && Array.isArray(devices) ? devices.slice(0, 128) : [];
    } finally {
      listingCallOutputs--;
      clearTimeout(timer);
    }
  }
  async function listCallAudioDevices(includeGroup, all = false) {
    const devices = await listOwnerAudioDevices(callAudioWindowAvailable);
    return all ? devices : callOutputDevices(devices, includeGroup);
  }
  function audioRoutingState(devices) {
    const { routes } = audioRoutes.value;
    const activeId = currentCallAudio.deviceId;
    return {
      supported: process.platform === 'win32',
      ...audioRoutes.snapshot(),
      microphone: audioInputs.snapshot(),
      voiceVolume: voiceVolume.value.volume,
      callOutput: {
        ready: currentCallAudio.callOutputReady,
        deviceId: activeId,
        deviceLabel:
          devices?.callOutputs.find(({ id }) => id === activeId)?.label ??
          (routes.call === activeId ? audioRoutes.value.routeLabels.call : ''),
      },
      ...(devices && { devices }),
    };
  }
  async function audioRoutingInventory() {
    const [web, windows] = await Promise.allSettled([
      listOwnerAudioDevices(),
      routingAvailable() ? windowsAudio.list() : [],
    ]);
    if (web.status === 'fulfilled') audioInputs.update(web.value);
    const devices = {
      inputs:
        web.status === 'fulfilled'
          ? audioInputs.devices.map(({ deviceId: id, deviceLabel: label }) => ({ id, label }))
          : [],
      outputs: localPlaybackDevices(web.status === 'fulfilled' ? web.value : []),
      callOutputs: callOutputDevices(web.status === 'fulfilled' ? web.value : []).map(
        ({ deviceId: id, label }) => ({ id, label }),
      ),
      endpoints: windows.status === 'fulfilled' ? windows.value : [],
    };
    return {
      ...audioRoutingState(devices),
      ...(web.status === 'rejected' || windows.status === 'rejected'
        ? { error: 'Audio devices could not be listed.' }
        : {}),
    };
  }
  function requireAudioSettings(role) {
    if (role !== 'settings' || !settingsHost?.window?.isVisible() || !routingAvailable())
      throw Error('The selected audio device is unavailable.');
  }
  async function setAudioRoute(value, role) {
    requireAudioSettings(role);
    const { route, deviceId } = audioRouteRequest(value);
    const inventory = await audioRoutingInventory();
    requireAudioSettings(role);
    const { devices } = inventory;
    const candidates =
      route === 'speaker'
        ? devices.outputs
        : route === 'call'
          ? devices.callOutputs
          : devices.endpoints;
    const device = candidates.find(({ id }) => id === deviceId);
    if (deviceId && !device) throw Error('The selected audio device is unavailable.');
    const saved = audioRoutes.snapshot();
    const changed = saved.routes[route] !== deviceId;
    if (changed) {
      saved.routes[route] = deviceId;
      saved.routeLabels[route] = device?.label ?? '';
      audioRoutes.set(saved);
      emit({ type: 'audio-routing.changed', ...audioRoutingState() });
      if (route === 'music') {
        await stopMusicListening();
        if (musicAvailable() && audioRoutes.value.routes.music === deviceId)
          void startMusicListening().catch(() => {});
      }
      if (
        route === 'system' &&
        (currentCallAudio.systemAudioActive || currentCallAudio.systemAudioPending)
      ) {
        const wakeFromSystem = currentCallAudio.systemAudioWake;
        await executeCallAudio({ action: 'system-off' });
        if (
          callAudioAvailable() &&
          audioRoutes.value.routes.system === deviceId &&
          wakeFromSystem !== undefined
        )
          await executeCallAudio({ action: 'system-on', wakeFromSystem }).catch(() => {});
      }
    }
    return audioRoutingState(devices);
  }
  async function executeCallAudio(command) {
    if (command.action === 'system-off') stopNativeSystemAudio();
    if (command.action === 'system-on' && audioRoutes.value.routes.system) {
      if (nativeSystemArm || nativeSystemCapture) throw Error('Connecting system audio…');
      nativeSystemArm = {
        token: randomUUID(),
        deviceId: audioRoutes.value.routes.system,
        wake: command.wakeFromSystem === true,
      };
      command = { ...command, systemToken: nativeSystemArm.token };
    }
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
        if (command.action === 'system-on') stopNativeSystemAudio();
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
      if (nativeSystemArm?.token === command.systemToken) nativeSystemArm = null;
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
  const stopKeepWarm = verification
    ? null
    : startKeepWarm({
        idle: () =>
          !shuttingDown &&
          !modelIdlePolicy.unloadIdle &&
          sleepService.phase === 'awake' &&
          backendState.phase === 'ready' &&
          !localInferenceTasks &&
          !currentChatTask &&
          !chat.active &&
          !voice.generating,
        timeoutMs: 5000,
        pings: {
          gateway: (signal) => metadataRpc.call('health', {}, { signal }),
          model: (signal) =>
            inferenceApi.config === lastConversationApi &&
            modelPing(lastConversationApi, { signal }),
          voice: (signal) =>
            voice.enabled &&
            externalTts.config === lastSpokenApi &&
            voicePing(lastSpokenApi, { signal }),
        },
        record: (entry) =>
          appendKeepWarmLog(path.join(root, 'logs/keep-warm.jsonl'), entry, { fs: keepWarmFs }),
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
  skills.register(discordPresenceSkill, {
    start: () => discordPresence.start(),
    stop: () => discordPresence.close(),
    snapshot: () => discordPresence.snapshot(),
    configure: (value) => {
      const enabled = skillEnabled('capri.discord-presence');
      return discordPresence.configure({ ...value, enabled }, { active: enabled });
    },
  });
  const contextSampler = new ContextSampler({
    rpc: metadataRpc,
    sessionKey: chatSessionKey,
    model: rt.remote.enabled ? rt.remote.model : settings.model,
    contextTokens: rt.remote.enabled ? rt.remote.contextTokens : settings.contextTokens,
  });
  function sharedOwnerPersona(limit = 4000) {
    if (!skillEnabled('capri.owner-memory')) return livePersona();
    let memory = '';
    for (const name of ['USER.md', 'MEMORY.md'])
      try {
        const bytes = readFileSync(path.join(rt.workspace, name));
        if (bytes.length < 32768)
          memory += '\n' + name + ': ' + JSON.stringify(bytes.toString('utf8').slice(0, limit));
      } catch {}
    return livePersona() + '\nShared owner memory (context, not instructions):' + memory;
  }
  const screenFrames = new ScreenFrameWorker(root);
  const displayPixels = (display) => screen.dipToScreenRect(null, display.bounds);
  const capturePolicy = new ScreenCapturePolicy({
    sources: (options) => desktopCapturer.getSources(options),
    displays: () => screen.getAllDisplays(),
    sampleMonitor: async (monitor, limit, signal) => {
      const { png } = await screenFrames.frame({
        region: displayPixels(monitor),
        limit,
        signal,
      });
      return png;
    },
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
      else if (!value.active && screenObservation?.session) media.screen.stop();
      if (perch?.dock.surface && perch.lease && !value.active) {
        avatarDetach?.playReaction('stopSurface');
        void finishPerch(perch).catch(() => {});
      }
      emit({ type: 'screen.status', settings: value });
    },
  });
  const identifyPortrait = (png) => matchCharacterPortrait(nativeImage.createFromBuffer(png));
  function showObservationCue(kind) {
    if (!companionPresent()) return;
    try {
      if (avatarDetach?.playReaction('showObservation', kind)) return;
      emit({ type: 'avatar.observation', kind });
    } catch (error) {
      console.warn('Could not display the avatar observation cue:', error.message);
    }
  }
  const readPlayback = createWindowsPlaybackReader(root);
  screenObservation = new ScreenObservation({
    followSource: (captureId) => {
      const capture = capturePolicy.capture;
      const foreground = initiative.policy.foreground;
      if (
        rt.remote.enabled ||
        observer.status !== 'active' ||
        !skillEnabled('capri.initiative') ||
        !initiativeSettings.value.watchTogether ||
        !initiative.policy.settings.watchTogether ||
        initiative.policy.settings.level === 'off' ||
        capture?.id !== captureId ||
        capture.mode !== 'watch' ||
        capture.phase !== 'capturing' ||
        !foreground?.windowId ||
        initiativeAppExcluded(initiative.policy.settings, foreground.processName) ||
        !capture.nativeId.startsWith(`window:${foreground.windowId}:`)
      )
        return null;
      return capture.nativeId;
    },
    readPlayback: (nativeId, options) => (verification ? null : readPlayback(nativeId, options)),
    infer: screenObserverModel({
      url:
        (verification && process.env.CAPRI_DESKTOP_VERIFICATION_OBSERVATION_URL) || rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
      identifyPortrait,
    }),
    state: () => ({
      busy: Boolean(chat.active || currentChatTask || initiative?.active),
      typing: draftBusy,
      speaking: playbackBusy,
      userSpeech: Date.now() < lastSpeechUntil,
      offline:
        !screenVisionAvailable ||
        backendState.phase !== 'ready' ||
        shuttingDown ||
        Boolean(chatgpt.signingIn),
      hidden: !companionPresent(),
    }),
    onChange: (value) => {
      initiative.screenChanged();
      emit({ type: 'screen.observation', settings: value });
    },
    onAnalysis: () => showObservationCue('screen'),
  });
  const screenPreviews = new Map();
  const clipFrames = new ScreenClipFrames({ current: () => capturePolicy.capture, emit });
  async function prepareScreenContext(input, { signal }) {
    return prepareScreenObservationContext(
      {
        enabled: screenVisionAvailable && !chatgpt.signingIn,
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
          ({ png } = await screenFrames.frame({ signal, ownedWindow }));
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
    skills,
    identifyPortrait,
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
        await resetFreshContext(signal);
        let webContext = '';
        if (input.internet === true) {
          const result = await chat.prepareWebSearch(input, {
            language: languages.value.conversation,
            signal,
            source: 'visual-turn',
            emit: (event) => emitChat({ type: 'turn.web-search', turnId: input.id, ...event }),
          });
          webContext = result.context;
          if (result.sources.length) {
            assistant.webSources = result.sources;
            store.put(assistant);
          }
        }
        signal.throwIfAborted();
        if (kind === 'screen') showObservationCue('screen');
        const result = await visual.generate({
          requestId: input.id,
          text: input.text,
          png,
          source,
          attachments: attachments?.map(({ metadata, ...file }) => file),
          thinking: input.thinking,
          effort: skillSettings.preferences.value['capri.reasoning']?.effort,
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
  const generateInitiative = initiativeGenerator({
    ollamaUrl: rt.inferenceUrl,
    model: settings.model,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
    params: { ...auxiliaryRunnerParams, ...settings.generation },
    sessionKey: chatSessionKey,
    rpc: metadataRpc,
    persona: sharedOwnerPersona,
    screenPersona: livePersona,
    languages: liveLanguages,
    avatars: catalog.publicSprites(),
  });
  const initiative = new InitiativeService({
    onStatus: (settings) => emit({ type: 'initiative.activity', settings }),
    onError: (message) => console.warn('Initiative:', message),
    settings: initiativeSettings.value,
    screenEvidence: () => {
      const capture = capturePolicy.capture;
      if (capture?.mode !== 'watch' || capture.phase !== 'capturing') return null;
      const evidence = screenObservation.commentEvidence();
      return evidence?.captureId === capture.id ? evidence : null;
    },
    state: () => ({
      disabled: !skillEnabled('capri.initiative'),
      typing: draftBusy,
      quiet: interfaceBusy,
      busy: Boolean(
        chat.active ||
          currentChatTask ||
          chessReactions?.active ||
          avatarClickReactions?.active ||
          screenObservation.session?.foreground ||
          screenObservation.session?.controller,
      ),
      speaking: playbackBusy,
      userSpeech: Date.now() < lastSpeechUntil,
      offline:
        backendState.phase !== 'ready' ||
        sessionLocked ||
        Boolean(chatgpt.signingIn) ||
        shuttingDown,
      hidden: !companionPresent(),
    }),
    budget: initiativeBudget,
    persist: (value) => writeJsonAtomic(path.join(state, 'initiative-state.json'), value),
    generate: (candidate, context) => {
      if (candidate.category === 'media-app') showObservationCue('attention');
      return generateInitiative(candidate, context);
    },
    commit: async (message, candidate, { signal }) => {
      if (candidate.category === 'screen') return;
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
    deliver: (message, candidate) => {
      const screenComment = candidate.category === 'screen';
      const speak = !screenComment || !externalTts.config.enabled;
      latestInitiativeTurnId = message.turnId;
      if (!screenComment && !candidate.preview) store.put(message);
      const selection = avatar.request(message.avatar?.id ?? catalog.defaultId);
      if (selection) emit({ type: 'avatar.selection', selection });
      emit({
        type: 'turn.started',
        turnId: message.turnId,
        assistant: { ...message, text: '', status: 'streaming' },
        source: 'initiative',
        silent: !speak,
      });
      if (speak) {
        voiceSkills.output.turn({ type: 'turn.started', turnId: message.turnId });
        voiceSkills.output.turn({ type: 'turn.delta', turnId: message.turnId, text: message.text });
      }
      emit({ type: 'turn.delta', turnId: message.turnId, text: message.text });
      if (speak) voiceSkills.output.turn({ type: 'turn.completed', turnId: message.turnId });
      emit({ type: 'turn.completed', turnId: message.turnId, assistant: message });
    },
  });
  const conversation = createConversationSkills(skills, {
    initiative: {
      async configure(value) {
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
      },
      dismiss() {
        initiative.dismiss();
        if (voice.turn?.id === latestInitiativeTurnId) voice.cancel();
        return true;
      },
      restore() {
        initiative.restore();
        return true;
      },
      test: () => initiative.preview(),
      snapshot: () => initiative.snapshot(),
    },
    brain: {
      service: brain,
      async open() {
        await shell.openPath(brain.folder);
        return true;
      },
    },
    privateMemory: { service: privateMemory },
    files: { permissions: filePermissions, snapshot: fileAccessSnapshot },
    attachments: { open: (id) => attachmentViewer.open(id) },
  });
  const voiceSkills = createVoiceSkills(skills, {
    setVoiceEnabled: changeVoice,
    onVoiceTurn: (event) => {
      if (skillEnabled('capri.voice-output')) voice.onChat(event);
    },
    readCallAudio: callAudioSnapshot,
    canConfigureCallAudio: () => settingsHost?.window?.isVisible(),
    configureCallAudio: applyCallAudioCommand,
    configureSpeech: applySpeechSettings,
  });
  function applyCallAudioCommand(command) {
    if (command.action === 'allow-model' || command.action === 'voice-volume') {
      const policy = callAudioPolicy.set({
        ...callAudioPolicy.snapshot(),
        ...(command.action === 'allow-model'
          ? { allowModel: command.enabled }
          : { callVoiceVolume: command.volume }),
      });
      if (!policy.allowModel && (voicePreviewRequest?.model || callVoiceTurn?.model))
        cancelCallVoice();
      emit({ type: 'call-audio.policy', ...policy });
      return callAudioSnapshot();
    }
    if (!callAudioAvailable()) throw new Error('Enable Voice calls in Settings and open Capri.');
    return executeCallAudio(command);
  }
  async function applySpeechSettings(value) {
    const previousPause = speechPreferences.value.trailingSilenceSeconds;
    const next = speechPreferences.set({ ...speechPreferences.value, ...value });
    if (previousPause !== next.trailingSilenceSeconds)
      await microphone.configurePause(settingsPreview.speechPause ?? next.trailingSilenceSeconds);
    emit({ type: 'speech.settings', settings: next });
    return next;
  }
  function avatarReactionAvailable(awakened = false) {
    return (
      skillEnabled('capri.avatar-interaction') &&
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
      const language = liveLanguages().conversation;
      if (!voice.enabled || !voice.ready || voice.language !== language) return;
      const cue = avatarClickCue(tone, mood, language);
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
    wildInputPranks.noteAttention();
    chessReactions?.cancel();
    if (!skillEnabled('capri.avatar-interaction')) return false;
    callSkill('capri.avatar-interaction', 'react', kind);
    return true;
  }

  function wildTabsEnabled() {
    return (
      process.platform === 'win32' &&
      !verification &&
      !shuttingDown &&
      !sessionLocked &&
      !chatgpt.signingIn &&
      companionPresent() &&
      window.isVisible() &&
      !window.isMinimized() &&
      backendState.phase === 'ready' &&
      companionPreferences.value.wildCloseAiTabs
    );
  }
  const wildPranks = new WildPranks({ BrowserWindow, screen });
  const planWildPrank = wildPrankPlanner({
    url: rt.inferenceUrl,
    model: settings.model,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
    params: { ...auxiliaryRunnerParams, ...settings.generation },
    persona: livePersona,
    style: () => settingsPreview.style ?? readCommunicationStyle(rt.workspace),
    languages: liveLanguages,
  });
  let prankStyle;
  function prankEnvironment() {
    return (
      !shuttingDown &&
      !quitting &&
      !sessionLocked &&
      !musicSuspended &&
      !computerControl.session &&
      !controlBorder
    );
  }
  function updateWildPranks() {
    const enabled =
      !verification &&
      companionPreferences.value.wildDesktopPranks &&
      companionPresent() &&
      window.isVisible() &&
      !window.isMinimized() &&
      !focusMode &&
      sleepService.phase === 'awake' &&
      (prankStyle ??= readCommunicationStyle(rt.workspace)) === 'wild';
    wildPranks.tick(
      enabled,
      () =>
        prankEnvironment() &&
        powerMonitor.getSystemIdleState(6) === 'idle' &&
        !settingsHost?.window?.isVisible() &&
        !interfaceBusy &&
        !draftBusy &&
        !currentChatTask &&
        !chat.active &&
        !playbackBusy &&
        !voice.generating &&
        !pointer?.drag &&
        !pointer?.avatarPress &&
        !resizeSurface?.active &&
        !avatarDetach?.operation &&
        !avatarDetach?.press,
    );
  }
  function wildInputPrankStyle(preview = false) {
    const style = preview
      ? (settingsPreview.style ?? (prankStyle ??= readCommunicationStyle(rt.workspace)))
      : (prankStyle ??= readCommunicationStyle(rt.workspace));
    return style === 'wild';
  }
  function wildInputPrankEligible(preview = false, { allowActiveSession = false } = {}) {
    const environmentOk = allowActiveSession
      ? !shuttingDown && !quitting && !sessionLocked && !musicSuspended
      : prankEnvironment();
    if (
      process.platform !== 'win32' ||
      verification ||
      !wildInputPrankStyle(preview) ||
      !idleCursorAccess() ||
      !environmentOk ||
      sleepService.phase !== 'awake' ||
      workflowTurn ||
      chat.active ||
      currentChatTask ||
      callMicrophoneArmed ||
      recordingShown ||
      chess?.watchRun ||
      avatarDesktopUpdate ||
      idleCursorMoving ||
      maintenance ||
      chatgpt.signingIn
    )
      return false;
    if (preview) return true;
    return Boolean(
      companionPreferences.value.wildInputPranks === true &&
        companionPresent() &&
        window.isVisible() &&
        !window.isMinimized() &&
        !window.isFocused() &&
        !focusMode &&
        !settingsHost?.window?.isVisible() &&
        !interfaceBusy &&
        !draftBusy &&
        !playbackBusy &&
        !voice.generating &&
        !pointer?.drag &&
        !pointer?.avatarPress &&
        !resizeSurface?.active &&
        !avatarDetach?.operation &&
        !avatarDetach?.press &&
        !initiative.active &&
        !avatarClickReactions?.active &&
        !screenObservation.session?.controller &&
        Date.now() >= lastSpeechUntil &&
        !quietHour(initiativeSettings.value, new Date().getHours()),
    );
  }
  async function executeWildInputPrank({ preview, neglectSeconds, signal }) {
    if (!wildInputPrankEligible(preview))
      return {
        ok: false,
        code: !wildInputPrankStyle(preview)
          ? 'CAPRI_WILD_PRANK_STYLE_REQUIRED'
          : !idleCursorAccess()
            ? 'CAPRI_WILD_PRANK_ACCESS_REQUIRED'
            : 'CAPRI_WILD_PRANK_ABORTED',
      };
    let state;
    try {
      state = await callApplicationBridge(
        root,
        { action: 'wild_prank_state', ignoreProcessId: String(process.pid) },
        { signal },
      );
    } catch (error) {
      if (signal?.aborted) return { ok: false, aborted: true, code: 'CAPRI_WILD_PRANK_ABORTED' };
      return { ok: false, code: 'CAPRI_WILD_PRANK_BLOCKED', reason: error?.code ?? 'no_target' };
    }
    const excludedApps = initiativeSettings.value.appExclusionsEnabled
      ? initiativeSettings.value.excludedApps
      : [];
    const classification = classifyWildTarget(state, { excludedApps });
    if (classification.blocked)
      return { ok: false, code: 'CAPRI_WILD_PRANK_BLOCKED', reason: classification.reason };

    const capriBounds =
      window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
        ? screen.dipToScreenRect(window, window.getBounds())
        : undefined;

    let png = null;
    if (screenVisionAvailable && backendState.phase === 'ready') {
      try {
        const frame = await screenFrames.frame({
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
          displayWindow: state.windowId,
          limit: { width: 960, height: 540 },
        });
        png = frame?.png ?? null;
      } catch {
        if (signal?.aborted) return { ok: false, aborted: true, code: 'CAPRI_WILD_PRANK_ABORTED' };
      }
    }

    let plan = null;
    if (backendState.phase === 'ready') {
      localInferenceTasks++;
      const planSignal = AbortSignal.any([signal, AbortSignal.timeout(png ? 10_000 : 6_000)]);
      try {
        plan = await planWildPrank({
          state,
          classification,
          png,
          capriBounds,
          neglectSeconds,
          recent: wildInputPranks.recent,
          signal: planSignal,
        });
      } catch {
        if (signal?.aborted) return { ok: false, aborted: true, code: 'CAPRI_WILD_PRANK_ABORTED' };
        plan = null;
      } finally {
        localInferenceTasks--;
      }
    }
    if (!plan)
      plan = fallbackWildPrank({
        mode: classification.mode,
        displayBounds: state.displayBounds,
        capriBounds,
        cursor: state.cursor,
        editableFocus: state.editableFocus,
      });
    if (!plan) return { ok: false, code: 'CAPRI_WILD_PRANK_BLOCKED', reason: 'no_plan' };

    if (signal?.aborted || !wildInputPrankEligible(preview))
      return { ok: false, aborted: true, code: 'CAPRI_WILD_PRANK_ABORTED' };

    const canFinish = () =>
      wildInputPrankStyle(preview) &&
      idleCursorAccess() &&
      !shuttingDown &&
      !quitting &&
      !sessionLocked &&
      !musicSuspended &&
      !workflowTurn &&
      !chat.active &&
      (preview ||
        (companionPreferences.value.wildInputPranks === true &&
          !focusMode &&
          sleepService.phase === 'awake'));

    let result;
    try {
      result = await computerControl.runWildPrank({
        permitted: () => wildInputPrankEligible(preview, { allowActiveSession: true }),
        canFinish,
        preview,
        signal,
        releaseKeys: () => plan.releaseKeys,
        releaseButtons: () => plan.releaseButtons,
        run: async ({ signal: sessionSignal, stillAllowed }) => {
          if (plan.quip) {
            emit({ type: 'wild-pranks.reaction', text: plan.quip, expression: plan.expression });
            const language = liveLanguages().conversation;
            if (
              voice.enabled &&
              voice.ready &&
              voice.language === language &&
              !playbackBusy &&
              !voice.generating &&
              !voicePreviewRequest &&
              !currentCallAudio.shareReplies
            ) {
              const turnId = randomUUID();
              emit({ type: 'voice.preview-started', turnId });
              voice.preview(turnId, plan.quip);
            }
          }
          return callApplicationBridge(
            root,
            {
              action: 'wild_prank_run',
              windowId: state.windowId,
              processId: state.processId,
              startedAtTicks: state.startedAtTicks,
              allowButtons: classification.allowButtons,
              allowKeys: classification.allowKeys,
              steps: plan.steps,
            },
            { signal: sessionSignal, stillAllowed },
          );
        },
      });
    } catch (error) {
      console.warn('Wild input prank failed:', error?.code ?? error?.message ?? error);
      return { ok: false, aborted: true, code: 'CAPRI_WILD_PRANK_ABORTED' };
    }
    if (!result || result.ok !== true)
      return { ok: false, aborted: true, code: result?.code ?? 'CAPRI_WILD_PRANK_ABORTED' };
    wildInputPranks.record(plan);
    if (result.aborted)
      return {
        ok: false,
        aborted: true,
        code: 'CAPRI_WILD_PRANK_ABORTED',
        reason: result.reason,
        quip: plan.quip,
      };
    return {
      ok: true,
      mode: classification.mode,
      idea: plan.idea,
      quip: plan.quip,
      stepsExecuted: result.stepsExecuted,
    };
  }
  function updateWildInputPranks() {
    const enabled =
      process.platform === 'win32' &&
      !verification &&
      companionPreferences.value.wildInputPranks === true &&
      wildInputPrankStyle(false) &&
      idleCursorAccess() &&
      companionPresent() &&
      window.isVisible() &&
      !window.isMinimized() &&
      !focusMode &&
      sleepService.phase === 'awake';
    wildInputPranks.tick({
      enabled,
      intervalSeconds: companionPreferences.value.wildInputPrankIntervalSeconds ?? 300,
      eligible: () => wildInputPrankEligible(false),
      run: executeWildInputPrank,
    });
  }
  function wildTabsAllowed() {
    return (
      wildTabsEnabled() &&
      powerMonitor.getSystemIdleState(60) === 'active' &&
      !settingsHost?.window?.isVisible() &&
      !draftBusy &&
      !interfaceBusy &&
      !chat.active &&
      !currentChatTask &&
      !computerControl.session &&
      Date.now() >= lastSpeechUntil
    );
  }
  const generateTabReaction = wildTabReactionGenerator({
    url: rt.inferenceUrl,
    model: settings.model,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
    params: { ...auxiliaryRunnerParams, ...settings.generation },
    persona: livePersona,
    style: () => readCommunicationStyle(rt.workspace),
    languages: liveLanguages,
  });
  wildTabs = new WildTabs({
    allowed: wildTabsAllowed,
    inspect: async (signal) =>
      (await callApplicationBridge(root, { action: 'wild_tab_inspect' }, { signal })).tab,
    close: ({ token }, signal) =>
      callApplicationBridge(
        root,
        { action: 'wild_tab_close', token },
        { signal, stillAllowed: wildTabsAllowed },
      ),
    onCloseFailure: (reason) => console.warn('Wild tab close did not confirm:', reason),
    prompt: (pending) => {
      if (pending) {
        if (!window.isAlwaysOnTop()) window.moveTop();
        showObservationCue('attention');
      }
      emit({ type: 'wild-tabs.prompt', pending });
    },
    react: async ({ id, service }, signal) => {
      if (
        initiative.active ||
        avatarClickReactions.active ||
        chessReactions?.active ||
        playbackBusy ||
        voice.generating ||
        screenObservation.session?.controller
      )
        return false;
      const language = liveLanguages().conversation;
      const reaction = await generateTabReaction(
        service,
        AbortSignal.any([signal, AbortSignal.timeout(6500)]),
      );
      if (
        !reaction ||
        signal.aborted ||
        !wildTabsAllowed() ||
        language !== liveLanguages().conversation
      )
        return false;
      emit({ type: 'wild-tabs.reaction', id, ...reaction });
      if (
        voice.enabled &&
        voice.ready &&
        voice.language === language &&
        !playbackBusy &&
        !voice.generating &&
        !voicePreviewRequest &&
        !currentCallAudio.shareReplies
      ) {
        const turnId = randomUUID();
        emit({ type: 'voice.preview-started', turnId });
        voice.preview(turnId, reaction.text);
      }
      return true;
    },
  });
  const wildBrowserProcesses = new Set(['chrome', 'msedge']);
  observer.on('browser-tab-changed', ({ windowId, processName }) => {
    if (!windowId || windowId === initiative.policy.foreground?.windowId)
      screenObservation.invalidateFollow();
    if (!processName || wildBrowserProcesses.has(processName)) wildTabs.refresh();
  });
  observer.on('observation', (event) => {
    const previousWindow = initiative.policy.foreground?.windowId;
    initiative.observe(event);
    if (event.kind === 'app.foreground') {
      if (previousWindow !== event.windowId) screenObservation.invalidateFollow();
      if (wildBrowserProcesses.has(event.processName.toLowerCase())) wildTabs.refresh();
      else wildTabs.reset();
    } else if (['session.lock', 'power.suspend', 'session.ending'].includes(event.kind)) {
      wildTabs.reset();
    }
  });
  observer.on('status', (settings) => {
    if (!settings.active) {
      screenObservation.invalidateFollow();
      wildTabs.reset();
    }
    emit({ type: 'initiative.status', settings });
  });
  observer.on('failure', (message) => {
    initiative.cancel();
    wildTabs.reset();
    emit({ type: 'initiative.error', message });
  });
  async function syncInitiative() {
    const settings = settingsPreview.initiative ?? initiativeSettings.value;
    const hadFollow = initiative.policy.settings.watchTogether;
    initiative.configure(settings);
    if (hadFollow && !settings.watchTogether) screenObservation.invalidateFollow();
    const wildEnabled = wildTabsEnabled();
    const roaming = companionPreferences.value;
    const observeForRoaming =
      process.platform === 'win32' &&
      initiativeSettings.value.appExclusionsEnabled &&
      (roaming.avatarRoaming || roaming.avatarRoamCursorPranks);
    const observeForWildInput =
      process.platform === 'win32' &&
      initiativeSettings.value.appExclusionsEnabled &&
      roaming.wildInputPranks === true;
    if (wildEnabled) wildTabs.refresh();
    else wildTabs.reset();
    return syncAwareness({
      observer,
      prepare: ensureAwareness,
      enabled: Boolean(
        process.platform === 'win32' &&
          (observeForRoaming ||
            observeForWildInput ||
            wildEnabled ||
            (skillEnabled('capri.initiative') && settings.level !== 'off')) &&
          companionPresent() &&
          !shuttingDown &&
          !verification &&
          (observeForRoaming || observeForWildInput || backendState.phase === 'ready'),
      ),
    });
  }
  let voiceStartPromise,
    voiceStartController,
    wakeVoicePreparing = false,
    lastVoiceFailure = null;
  const rendererDiagnostics = [];
  const mutedVoiceResidency = new MutedVoiceResidency({
    enabled: !verification,
    needed: () => (voice.enabled && voice.language !== 'off') || Boolean(voicePreviewRequest),
    resident: () => Boolean(voice.ready || voiceStartPromise || managedProcess('companion-voice')),
    idleEligible: () =>
      modelIdlePolicy.unloadIdle &&
      voice.ready &&
      voice.enabled &&
      !shuttingDown &&
      !externalTts.config.enabled &&
      !nativeVoice(voice.language),
    idleBusy: () =>
      Boolean(
        voice.generating ||
          voiceStartPromise ||
          currentChatTask ||
          playbackBusy ||
          voicePreviewRequest ||
          wakeVoicePreparing,
      ),
    idleMs: () => modelIdleSeconds() * 1000,
    onIdleError: (error) => console.warn('Idle voice release failed:', error.message),
    cancel: ({ idle }) => {
      voiceStartController?.abort();
      voice.close();
      voice.setReady(false, { idle });
    },
    starting: () => voiceStartPromise,
    stop: () => stopManaged('companion-voice'),
  });
  async function connectVoice() {
    if (!skillEnabled('capri.voice-output')) return false;
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
    if (
      !externalTts.config.enabled &&
      !verification &&
      !speechModelsInstalled(root, voice.language)
    ) {
      voice.fail(
        voice.language === 'en'
          ? ENGLISH_VOICE_SETUP_MESSAGE
          : 'Multilingual voice is not installed. Open Languages and install multilingual speech.',
      );
      return;
    }
    const controller = (voiceStartController = new AbortController());
    if (voice.idle) voice.setReady(false);
    voiceStartPromise = (
      externalTts.config.enabled || nativeVoice(voice.language)
        ? Promise.resolve()
        : startCompanionVoice({ language: voice.language, signal: controller.signal })
    )
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
    if (enabled) skillSettings.require('capri.voice-output');
    if (!enabled) cancelCallVoice();
    voicePreviewRequest = null;
    if (enabled && !voiceAvailable) throw new Error(ENGLISH_VOICE_SETUP_MESSAGE);
    if (enabled && voiceVolume.value.volume === 0)
      voiceVolume.set({ ...voiceVolume.value, volume: voiceVolume.value.lastAudible });
    voice.setEnabled(enabled);
    if (enabled) connectVoice();
    else
      void mutedVoiceResidency
        .release()
        .catch((error) => console.warn('Muted voice release failed:', error.message));
    return voiceSnapshot();
  }

  function changeVoiceVolume(value) {
    const volume = validateVoiceVolume(value);
    const previous = voiceVolume.value;
    const enable = !voice.enabled && volume > 0;
    if (volume === previous.volume && !enable) return voiceSnapshot();
    if (enable) {
      skillSettings.require('capri.voice-output');
      if (!voiceAvailable || voice.language === 'off') throw new Error(VOICE_REQUIRED_MESSAGE);
    }
    voiceVolume.set({ volume, lastAudible: volume || previous.lastAudible });
    if (volume === 0 || enable) return changeVoice(enable);
    emit({ type: 'voice.settings', ...voiceSnapshot() });
    return voiceSnapshot();
  }

  async function applySkillActivation(id, enabled) {
    switch (id) {
      case 'capri.microphone':
        if (!enabled) {
          media.microphone.stop({ keepModelWarm: false }, 'host');
          microphone.worker.close();
          microphone.publish();
          resetCallAudio();
        } else if (asrAllowed && asrInstalled && ['ready', 'asleep'].includes(backendState.phase))
          emit({ type: 'microphone.toggle-request' });
        break;
      case 'capri.voice-output':
        if (!enabled || (voiceAvailable && voiceVolume.value.volume > 0)) changeVoice(enabled);
        break;
      case 'capri.owner-memory':
        memoryWarmup?.abort();
        memoryWarmup = null;
        if (enabled && !verification && (backendState.phase === 'ready' || backendPromise)) {
          const controller = new AbortController();
          memoryWarmup = controller;
          void Promise.resolve(backendPromise)
            .then(() => {
              if (!controller.signal.aborted && backendState.phase === 'ready')
                return prewarmEmbedding(rt, { signal: controller.signal });
            })
            .catch(() => {
              if (!controller.signal.aborted) console.warn('Capri memory warmup failed.');
            })
            .finally(() => {
              if (memoryWarmup === controller) memoryWarmup = null;
            });
        }
        break;
      case 'capri.music':
        if (enabled) await startMusicListening();
        else stopMusicListening();
        break;
      case 'capri.chess':
        if (!enabled) {
          chess?.stop();
          chess?.install.cancel();
        }
        break;
      case 'capri.screen':
        if (!enabled) {
          capturePolicy.clear();
          screenPreviews.clear();
          media.screen.stop();
          lastScreenshot = null;
        }
        break;
      case 'capri.reasoning':
      case 'capri.web-search':
        callSkill(id, 'setMode', skillSettings.turnMode(id));
        break;
      case 'capri.coding':
        coding.setMonitoring(enabled);
        if (!enabled) callSkill(id, 'resetMode');
        break;
      case 'capri.applications':
        if (enabled) await applicationAccess.set(true);
        else companionActions.approvals.cancel();
        break;
      case 'capri.computer':
        if (enabled) await applicationAccess.set(true);
        else {
          wildInputPranks.pause();
          if (computerAgent.running || computerControl.session) await emergencyComputerStop();
        }
        break;
      case 'capri.workflows':
        if (!enabled) workflows.cancel();
        break;
      case 'capri.user-tools':
        if (!enabled) userTools.cancel();
        break;
      case 'capri.spotify':
        if (!enabled) await spotifyService.close();
        break;
      case 'capri.voice-calls':
        if (enabled) callSetup.onSkillEnabled();
        else {
          await callCamera.stop();
          resetCallAudio();
          if (window && !window.isDestroyed())
            await executeCallAudio({ action: 'output-off' }).catch(() => {});
        }
        break;
      case 'capri.initiative':
        if (!enabled) initiative.cancel();
        else initiative.activity();
        await syncInitiative();
        break;
      case 'capri.avatar-interaction':
        if (!enabled) avatarClickReactions.cancel();
        break;
      case 'capri.timers':
        if (enabled) companionActions.time.start();
        else companionActions.time.suspend();
        break;
      case 'capri.brain':
        brain.configure({ enabled, shareWithApi: brain.snapshot().shareWithApi });
        break;
      case 'capri.private-memory':
        if (!enabled) privateMemory.lock();
        break;
      case 'capri.discord-presence':
        discordPresence.configure({ ...discordPresence.preferences.snapshot(), enabled });
        break;
      case 'capri.attachment-viewer':
        if (!enabled) {
          attachmentDrafts.clear();
          attachmentViewer.close();
        }
        break;
    }
  }

  function emit(event) {
    if (event.type === 'updates.status' && event.notification?.tag !== updateNoticeTag) {
      try {
        showUpdateTrayNotice(event.notification?.tag);
      } catch (error) {
        console.warn('Could not show the update notice in the Windows tray:', error.message);
      }
    }
    if (event.type === 'voice.settings') event = { ...event, volume: voiceVolume.value.volume };
    callAudioDiagnostics.observe(event);
    if (
      ['companion.settings', 'languages', 'speech.settings', 'initiative.settings'].includes(
        event.type,
      )
    )
      event = { ...event, settingsVersions: settingsVersions() };
    if (event.type === 'file-access') companionActions.approvals.cancel();
    for (const listener of [...reminderListeners]) listener(event);
    if (event.type === 'conversation.cleared') temporal?.clear();
    const openSection = {
      'open-companion': 'appearance',
      'open-voice-effects': 'voice',
      'open-models': 'models',
      'open-languages': 'languages',
      'open-file-access': 'files',
      'open-time': 'time',
      'open-applications': 'applications',
      'open-spotify': 'spotify',
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
      if (!event.preview && !companionPreferences.value.wildDesktopPranks) wildPranks.tick(false);
      if (!event.preview && !companionPreferences.value.wildInputPranks) wildInputPranks.pause();
      if (
        !event.preview &&
        microphone.setConversationMode(companionPreferences.value.conversationMode)
      ) {
        if (visualTurn?.kind === 'hands-free') cancelVisual();
        pendingFollowUp = null;
      }
      if (!event.preview) void syncInitiative().catch(() => observer.publish('failed'));
      if (settingsPreview.companion && !event.preview)
        event = { ...event, settings: { ...event.settings, ...settingsPreview.companion } };
      if (!event.settings.followUp) {
        pendingFollowUp = null;
        microphone.cancelContinuation();
      }
      const display = resourceMonitorDisplay(event.settings);
      resizeCompanion(event.settings.windowLayout, companionMonitorWidth(event.settings, display));
      if (!resourceMonitorNeedsProcessLoad(display)) processLoad.stop();
      if (!display.graphs.length && !display.meters.length) systemCpu.stop();
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
    if (['voice.error', 'voice.cancelled'].includes(event.type)) pendingFollowUp = null;
    if (event.type === 'microphone.settings' && event.status !== 'listening' && nativeSystemCapture)
      stopNativeSystemAudio();
    if (
      event.type === 'microphone.settings' &&
      visualTurn?.kind === 'hands-free' &&
      (event.status !== 'listening' || event.systemAudioReview)
    )
      cancelVisual();
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
      wildTabs?.reset();
      lastSpeechUntil = Date.now() + 5000;
      initiative.activity();
      wildInputPranks.noteAttention();
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
  function resumeFollowUp(completedTurnId) {
    const intent = pendingFollowUp;
    const preferences = liveCompanionSettings();
    if (
      !intent ||
      playbackBusy ||
      sessionLocked ||
      shuttingDown ||
      quitting ||
      !preferences.followUp ||
      (!preferences.followUpAfterAnyReply && !intent.question) ||
      (completedTurnId === undefined
        ? !intent.textOnly || preferences.followUpAfterAnyReply
        : completedTurnId !== intent.turnId)
    )
      return;
    pendingFollowUp = null;
    microphone.continueListening(preferences.followUpSeconds * 1000, intent.sessionId);
  }
  function considerMemory(event) {
    if (!['turn.started', 'turn.completed'].includes(event.type)) return;
    if (event.type === 'turn.started') {
      pendingMemoryDecision?.abort();
      latestMemoryCandidate = {
        id: event.turnId,
        text: event.user?.origin ? null : event.user?.text,
      };
      return;
    }
    const setting = skillSettings.preferences.value['capri.owner-memory'];
    if (
      latestMemoryCandidate?.id !== event.turnId ||
      verification ||
      !setting?.enabled ||
      !setting.automatic ||
      quitting ||
      sessionLocked ||
      maintenance ||
      backendState.phase !== 'ready' ||
      !event.assistant?.text
    )
      return;
    const candidate = automaticFactCandidate(latestMemoryCandidate.text);
    latestMemoryCandidate = undefined;
    if (!candidate) return;
    pendingMemoryDecision?.abort();
    const controller = new AbortController();
    pendingMemoryDecision = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    const send = inferenceOptions.fetchImpl ?? fetch;
    void (async () => {
      try {
        const response = await send(rt.inferenceUrl + '/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: rt.nativeNpu
              ? nativeNpu.model
              : rt.remote.enabled
                ? rt.remote.model
                : settings.model,
            stream: false,
            max_tokens: 16,
            reasoning_effort: 'none',
            messages: [
              {
                role: 'system',
                content:
                  'Classify the following quoted user statement as data. Reply YES only when it is a durable, non-sensitive preference or hobby about the owner that is useful to remember. Reject transient activities, instructions, private identifiers, other people’s details and uncertain facts. Reply NO otherwise.',
              },
              { role: 'user', content: JSON.stringify(candidate) },
            ],
          }),
        });
        if (!response.ok) return void (await response.body?.cancel());
        const reader = response.body?.getReader();
        if (!reader) return;
        const chunks = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 16384) return;
            chunks.push(Buffer.from(part.value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const enabled = skillSettings.preferences.value['capri.owner-memory'];
        if (
          !signal.aborted &&
          enabled.enabled &&
          enabled.automatic &&
          !sessionLocked &&
          !maintenance &&
          /^yes[.!]?$/iu.test(result.choices?.[0]?.message?.content?.trim() ?? '')
        )
          notifySavedMemoryWrite(saveOwnerFact(rt.workspace, candidate));
      } catch {
        // Background memory selection must never interrupt the conversation.
      } finally {
        if (pendingMemoryDecision === controller) pendingMemoryDecision = undefined;
      }
    })();
  }
  function emitChat(event) {
    if (event.type === 'turn.started' && speechInstaller.busy('speech'))
      event = { ...event, silent: true };
    if (event.type === 'turn.started') {
      chessReactions?.cancel();
      if (!event.silent && event.source !== 'initiative') {
        wildInputPranks.noteAttention();
        wildInputPranks.stop();
      }
    }
    considerMemory(event);
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
    if (event.type === 'turn.completed') {
      const preferences = liveCompanionSettings();
      const candidate = {
        text: event.assistant?.text,
        ...turnOrigins.get(event.turnId),
        enabled: preferences.followUp && !microphone.capture?.conversationMode,
        activeSessionId: microphone.capture?.id,
        afterAnyReply: preferences.followUpAfterAnyReply,
      };
      if (wantsVoiceFollowUp(candidate)) {
        const textOnly =
          speechInstaller.busy('speech') ||
          !voice.enabled ||
          voice.language === 'off' ||
          Boolean(voice.error);
        pendingFollowUp = {
          turnId: event.turnId,
          sessionId: candidate.sessionId,
          question: wantsVoiceFollowUp({ ...candidate, afterAnyReply: false }),
          textOnly,
        };
        if (textOnly) {
          if (preferences.followUpAfterAnyReply) pendingFollowUp = null;
          else setTimeout(resumeFollowUp, 0);
        }
      }
    }
    if (!quitting && !(event.type === 'turn.started' && event.silent)) {
      try {
        voiceSkills.output.turn(event);
      } catch (error) {
        console.warn('Voice turn delivery failed:', error?.name ?? 'Error');
      }
    }
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

  function setBackend(phase, message, code, exitCode) {
    if (phase === 'asleep' && !verification) setModelMemory('unloaded');
    if (phase === 'ready') nextModelMemoryProbe = 0;
    backendState = {
      phase,
      message,
      ...(code && { code }),
      ...(exitCode !== undefined && { exitCode }),
    };
    console.info('Capri local core:', phase);
    emit({ type: 'backend', ...backendState });
  }

  let previousPowerPhase = 'awake';
  const sleepService = new SleepService({
    onChange: (state) => {
      const awakened = state.phase === 'awake' && previousPowerPhase === 'waking';
      previousPowerPhase = state.phase;
      emit({ type: 'power.state', ...state });
      if (awakened) showAvatarWave();
      if (state.phase === 'awake') restoreMusicListening();
    },
    unload: async () => {
      workflows?.cancel();
      wildInputPranks.pause();
      privateMemory.lock();
      avatarClickReactions?.cancel();
      resetCallAudio();
      setBackend('sleeping', 'Freeing model memory…');
      modelWarmupController?.abort();
      backendController?.abort();
      memoryWarmup?.abort();
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
      await breezeVoice.cancel();
      requestRouter.pause();
      // Keep an already enabled, explicitly authorized CPU microphone available for wake requests.
      if (!microphone.capture) microphone.worker.close();
      await Promise.allSettled([backendPromise, voiceStartPromise, modelWarmup]);
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
      startup.start(['core', ...(warmVoice ? ['voice'] : []), ...(warmAsr ? ['recognition'] : [])]);
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
            ? () => prepare('recognition', () => microphone.worker.send({ type: 'warm-model' }))
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
  async function connectBackend({ preload = false } = {}) {
    if (voiceTraining.busy()) return;
    if (
      !rt.remote.enabled &&
      !rt.nativeNpu &&
      activeHfPackage &&
      hasSpeculativeDraft(activeHfPackage)
    ) {
      setBackend('offline', HF_DRAFT_CHAT_ERROR);
      return;
    }
    if (settings.modelSetupRequired && !rt.remote.enabled && !rt.nativeNpu) {
      setBackend(
        'offline',
        'Choose a language model in Settings → Language model.',
        'CAPRI_LOCAL_MODEL_SETUP_REQUIRED',
      );
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
        if (process.platform === 'darwin' && app.isPackaged && !verification) {
          const prepared = await prepareMacModels({
            root,
            settings,
            localChat: !rt.remote.enabled && !rt.nativeNpu,
            signal: controller.signal,
            confirm: (options) => dialog.showMessageBox(window, options),
            progress: (message, fraction) => {
              if (window && !window.isDestroyed()) window.setProgressBar(fraction);
              if (message !== backendState.message) setBackend('downloading-models', message);
            },
          }).finally(() => {
            if (window && !window.isDestroyed()) window.setProgressBar(-1);
          });
          if (!prepared) {
            setBackend('offline', 'Model download deferred. Select Reconnect to download.');
            return;
          }
          if (backendState.phase === 'downloading-models')
            setBackend('starting', 'Starting local core…');
        }
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
              warmMemory: skillEnabled('capri.owner-memory'),
              preload,
              onStage: (key, status) => {
                if (status === 'running') startup.begin(key);
                else startup.end(key, status === 'failed');
                if (key === 'models') setModelMemory(status === 'running' ? 'loading' : status);
              },
            },
          );
        if (!shuttingDown) setBackend('ready', 'Ready');
      } catch (error) {
        console.error('Core startup failed:', error.code ?? '', error.message);
        if (!shuttingDown && sleepService.phase !== 'sleeping') {
          startup.end('core', true);
          const { code, message, exitCode } =
            error.code === 'CAPRI_MAC_MODEL_SETUP'
              ? error
              : coreStartupFailure(error, { platform: process.platform });
          setBackend('offline', message, code, exitCode);
        }
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
    chess?.stop();
    resetCallAudio();
    companionActions.approvals.cancel();
    capturePolicy.clear(reason);
    screenPreviews.clear();
    emit({ type: 'screen.reset' });
  }

  function stopHiddenCompanion() {
    wildPranks.pause();
    wildInputPranks.pause();
    if (avatarOnly) return;
    clearPerch();
    avatarClickReactions?.cancel();
    avatarDetach?.reset();
    desktopTeleportMenu?.hide();
    settingsHost?.hide();
    void computerControl.stop();
    processLoad.stop();
    systemCpu.stop();
    if (!verification || capturePolicy.capture) discardScreens('companion-hidden');
    if (!verification) {
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
    if (perch?.localTracking) await finishPerch(perch, true);
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
      await view.webContents.loadURL(rendererUrl);
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

  function showUpdateTrayNotice(tag) {
    const previousTag = updateNoticeTag;
    updateNoticeTag = tag;
    if (process.platform !== 'win32' || !tray || tray.isDestroyed()) return;
    if (previousTag) tray.removeBalloon();
    if (
      !tag ||
      !automaticUpdatesEnabled ||
      shuttingDown ||
      quitting ||
      (window && !window.isDestroyed() && window.isVisible() && !window.isMinimized())
    )
      return;
    const language = languages.value.interface;
    tray.displayBalloon({
      title: 'Capri · ' + uiText('Updates', language),
      content: uiText('A new update is available: {version}', language, { version: tag }),
      icon: applicationIcon,
      noSound: true,
      respectQuietTime: true,
    });
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

  async function teleportToCursor(cursor = screen.getCursorScreenPoint(), grabOffset, dragPress) {
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
    avatarRoaming.postpone(liveCompanionSettings(), 60000);
    const stillAllowed = () => !dragPress || (!avatarDetach.press && avatarDetach.available);
    if (await tryAvatarDock(cursor, stillAllowed, undefined, dragPress)) return true;
    if (!stillAllowed()) return false;
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
    avatarRoaming.postpone(liveCompanionSettings(), 90000);
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
    if (process.platform !== 'win32') return selector.listEdges ? [] : null;
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
    const result = await callApplicationBridge(root, {
      ...selector,
      action: 'avatar_window',
      ignoreProcessId: String(process.pid),
      // Only the actual Settings surface can opt out of Capri's own-process filter.
      allowedWindowId: settingsId,
    });
    function validate(target) {
      if (
        !/^\d+$/.test(target?.windowId ?? '') ||
        !/^\d+$/.test(target.processId ?? '') ||
        !/^\d+$/.test(target.startedAtTicks ?? '') ||
        ![target.x, target.y, target.width, target.height].every(Number.isSafeInteger) ||
        (target.processId === String(process.pid) &&
          (target.windowId !== settingsId ||
            settingsHost?.window !== settingsView ||
            settingsView.isDestroyed() ||
            !settingsView.isVisible()))
      )
        return null;
      return target.processId === String(process.pid)
        ? { ...target, dipBounds: settingsView.getBounds() }
        : target;
    }
    if (selector.listEdges)
      return Array.isArray(result?.windows) ? result.windows.map(validate).filter(Boolean) : [];
    return validate(result);
  }

  function sampleAvatarDragWindows(press) {
    if (process.platform !== 'win32' || !canTeleport()) return;
    const scan = (press.dockScan ??= {});
    const now = performance.now();
    if (scan.pending || now - (scan.started ?? -Infinity) < 500) return;
    scan.started = now;
    scan.pending = avatarWindow({ listEdges: true })
      .then((windows) => {
        scan.windows = windows;
      })
      .catch(() => {})
      .finally(() => {
        scan.pending = undefined;
      });
  }

  const defaultSeat = { kind: 'seat', edge: 'top', fraction: 0.66 };
  const surfaceFrames = new Map([...dockFrames, ['focused', frameIds.get('focused')]]);
  function ownedAvatarOverlayIds() {
    return [avatarDetach?.overlay, avatarComposer?.window].flatMap((overlay) => {
      if (!overlay || overlay.isDestroyed()) return [];
      const handle = overlay.getNativeWindowHandle();
      return [String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE())];
    });
  }
  const surfaceDetector = createAvatarScreenTargetDetector({
    capturePolicy,
    screen,
    avatarWindow,
    callApplicationBridge: (command, options) => callApplicationBridge(root, command, options),
    permitted: () => Boolean(surfaceWatch()) && surfaceAvailable(),
    ownedOverlayWindowIds: ownedAvatarOverlayIds,
  });
  let surfaceRequest = 0;
  let lastSurfaceAction;
  let lastHangingAction;
  let lastAmbientClip;
  let surfacePlayUntil = 0;
  let nextAmbientSurface = Date.now() + 24000;

  function surfaceWatch() {
    const lease = capturePolicy.capture;
    return skillEnabled('capri.screen') &&
      lease?.mode === 'watch' &&
      capturePolicy.snapshot().active
      ? lease
      : null;
  }

  function surfaceAvailable() {
    return (
      avatarDetach &&
      skillEnabled('capri.avatar-interaction') &&
      canTeleport() &&
      !focusMode &&
      !avatarSleeping() &&
      !avatarDetach.session?.reducedMotion &&
      liveCompanionSettings().detachedStyle === 'character' &&
      !avatarDetach.press &&
      !pointer?.avatarPress &&
      !pointer?.drag
    );
  }

  function planSurface(target, action) {
    const display = screen.getAllDisplays().find(({ id }) => id === target.displayId);
    if (!display) return null;
    const area = display.workArea;
    const portrait = regions?.sprite;
    const portraitWidth =
      portrait?.source?.width > 0 ? portrait.width / portrait.source.width : 240;
    const base = avatarDetach.session?.point.scale ?? Math.max(108, Math.min(240, portraitWidth));
    const plan = surfaceLanding(target, action, {
      area,
      scale: Math.min(base, area.width * 0.42, area.height * 0.48),
      canvas: catalog.canvas,
      frames: surfaceFrames,
    });
    return (
      plan && {
        ...plan,
        display,
        contact: plan.action === 'present' ? target.point : plan.point,
        contactEdge: target.kind === 'window-top' ? 'top' : 'inside',
      }
    );
  }

  async function avatarContactVisible(record, dock, point, stillAllowed = () => true) {
    const contact = dock.surface?.contact ?? point;
    const { x, y } = screen.dipToScreenPoint(contact);
    try {
      const result = await callApplicationBridge(
        root,
        {
          action: 'avatar_dock_visible',
          ...record,
          x: String(x),
          y: String(y),
          edge: dock.surface?.contactEdge ?? dock.edge,
          ignoreProcessId: String(process.pid),
          overlays: ownedAvatarOverlayIds(),
        },
        { stillAllowed },
      );
      return stillAllowed() && result?.visible === true;
    } catch {
      return false;
    }
  }

  async function startSurfaceClip(action, side) {
    // This upper bound also leaves room for loading a sprite sheet on a cold start.
    surfacePlayUntil = Date.now() + 8500;
    nextAmbientSurface = Date.now() + 24000 + Math.random() * 24000;
    const target = perch;
    const request = surfaceRequest;
    const started = await avatarDetach.playSurface(
      action,
      side,
      () =>
        request === surfaceRequest &&
        perch === target &&
        surfaceAvailable() &&
        (!target?.lease || surfaceWatch() === target.lease),
    );
    if (!started) surfacePlayUntil = 0;
    return started;
  }

  async function performSurface(action, lease, stillAllowed = () => true, displayId) {
    if (action === 'hang-next')
      action =
        hangingCelActions[
          (hangingCelActions.indexOf(lastHangingAction) + 1) % hangingCelActions.length
        ];
    const hanging = hangingCelActions.includes(action);
    if (!surfaceAvailable() || !stillAllowed()) return false;
    const currentPose =
      perch?.seated &&
      !perch.hidden &&
      (perch.dock.surface?.frame ?? avatarDockFrame(dockFrames, perch.dock));
    const localTrick =
      (currentPose?.id === 'pose-ceiling' && hanging) ||
      (currentPose?.id === 'pose-sit-edge' && action === 'ledge-keytar');
    if (localTrick && (!perch.lease || perch.lease === lease)) {
      const started = await startSurfaceClip(action);
      if (started && hanging) lastHangingAction = action;
      if (started) return true;
    }
    if (!lease && !hanging) return false;
    const request = ++surfaceRequest;
    const allowed = () =>
      request === surfaceRequest &&
      surfaceAvailable() &&
      stillAllowed() &&
      (!lease || surfaceWatch() === lease);
    const targets = lease ? await surfaceDetector.detect() : [];
    if (hanging) {
      const owner = window.getContentBounds();
      const from = avatarDetach.desktopPoint ?? {
        x: Math.round(owner.x + owner.width / 2),
        y: Math.round(owner.y + owner.height / 2),
      };
      const display = screen.getDisplayNearestPoint(from);
      const { x, y, width } = display.workArea;
      targets.push({
        kind: 'desktop-edge',
        id: 'display:' + display.id,
        displayId: display.id,
        bounds: { x, y, width, height: 1 },
        point: { x: from.x, y },
      });
    }
    if (!allowed()) return false;
    const existing = perch?.dock.surface?.targetId;
    if (existing) targets.sort((a, b) => Number(b.id === existing) - Number(a.id === existing));
    const choices = action === 'auto' ? nextSurfaceActions(lastSurfaceAction) : [action];
    for (const choice of choices) {
      for (const target of targets) {
        if (displayId !== undefined && target.displayId !== displayId) continue;
        const surface = planSurface(target, choice);
        if (!surface) continue;
        const targetLease = target.window ? lease : null;
        const samePose =
          perch?.seated &&
          perch.dock.surface?.targetId === surface.targetId &&
          perch.dock.surface.frame.id === surface.frame.id &&
          perch.seatPoint.x === surface.point.x &&
          perch.seatPoint.y === surface.point.y;
        const dock = { ...defaultSeat, surface };
        const landed = samePose
          ? !target.window ||
            (await avatarContactVisible(perch.record, dock, surface.point, allowed))
          : await perchOn(target.window, targetLease, dock, undefined, allowed);
        if (!allowed()) return false;
        if (!landed) continue;
        perch.dock.surface = surface;
        if (!(await startSurfaceClip(surface.clipId, surface.side))) return false;
        lastSurfaceAction = choice;
        if (hanging) lastHangingAction = choice;
        return true;
      }
    }
    return false;
  }

  function windowDock(target, dock = defaultSeat) {
    return target.dipBounds
      ? avatarDockPoint(target.dipBounds, dock)
      : screen.screenToDipPoint(avatarDockPoint(target, dock));
  }

  async function tryAvatarDock(point, stillAllowed = () => true, grab, dragPress) {
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
    let target, dock;
    if (dragPress) {
      const scan = dragPress.dockScan;
      if (scan?.pending && !scan.windows) {
        // A very fast release can overlap the first scan. Give only that
        // in-flight scan a short deadline and never launch discovery here.
        let timer;
        try {
          await Promise.race([
            scan.pending,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 45);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      ({ target, dock } = nearestWindowAvatarDock(native, scan?.windows ?? [], nativeRadius) ?? {});
    } else {
      target = await avatarWindow({
        nearX: String(native.x),
        nearY: String(native.y),
        nearRadius: String(nativeRadius),
      }).catch(() => null);
      dock = target && nearestAvatarDock(native, target, nativeRadius);
    }
    if (!canTeleport() || !stillAllowed()) return false;
    if (dock && visibleAvatarDock(dock, windowDock(target, dock), display.workArea))
      return perchOn(target, null, dock, grab, stillAllowed);
    return screenDock ? perchAtEdge() : false;
  }

  function updateSeatedFrame(
    point = perch?.seatPoint,
    display = perch?.display,
    restoring = false,
  ) {
    const surface = perch?.dock.surface;
    const frame =
      desktopFrame?.id === 'pose-sleep'
        ? desktopFrame
        : (surface?.frame ?? avatarDockFrame(dockFrames, perch?.dock ?? defaultSeat));
    if (!frame) return false;
    const mask = maskFor(frame.id, frame);
    return display
      ? avatarDetach.followFrame(frame, catalog.canvas, mask, point, display, restoring)
      : avatarDetach.updateFrame(frame, catalog.canvas, mask, point);
  }

  function clearPerch() {
    const previous = perch;
    perch = null;
    if (previous) avatarDetach?.playReaction('stopSurface');
    previous?.stopTracking?.();
  }

  async function finishPerch(attempt, teleport = false) {
    if (perch !== attempt) return;
    clearPerch();
    if (!avatarDetach.available) return;
    const frame = desktopFrame ?? frameIds.get('neutral');
    if (teleport) {
      avatarRoaming.postpone(liveCompanionSettings(), 60000);
      if (
        await avatarDetach
          .hop(undefined, undefined, avatarTravelPose(frame, true))
          .catch(() => false)
      )
        return;
      if (!avatarDetach.available) return;
    }
    avatarDetach.showParked();
    if (frame) await avatarDetach.updateFrame(frame, catalog.canvas, maskFor(frame.id));
  }

  async function followPerch(attempt) {
    if (perch !== attempt || attempt.updating || !avatarDetach.available) return;
    if (attempt.targetLost) {
      if (canTeleport()) await finishPerch(attempt, true);
      return;
    }
    if (attempt.lease && capturePolicy.capture !== attempt.lease) return finishPerch(attempt);
    const target = attempt.pending;
    if (!target) return;
    if (avatarDetach.press && target.state === 'visible') return;
    attempt.pending = null;
    attempt.updating = true;
    try {
      if (target.state === 'unavailable') {
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
      if ((attempt.targetLost || attempt.pending) && perch === attempt)
        void followPerch(attempt).catch(() => {});
    }
  }

  async function perchOn(
    target,
    lease = null,
    dock = defaultSeat,
    grab,
    stillAllowed = () => true,
  ) {
    const surface = dock.surface;
    const arrival =
      desktopFrame?.id === 'pose-sleep'
        ? desktopFrame
        : (surface?.frame ?? avatarDockFrame(dockFrames, dock));
    if (
      (!target && !dock.display && !surface) ||
      !arrival ||
      !canTeleport() ||
      !stillAllowed() ||
      (lease && capturePolicy.capture !== lease)
    )
      return false;
    const seat =
      surface?.point ??
      (dock.display ? avatarDockPoint(dock.bounds, dock) : windowDock(target, dock));
    const record = target && {
      windowId: target.windowId,
      processId: target.processId,
      startedAtTicks: target.startedAtTicks,
    };
    const previous = perch;
    const canLand = () =>
      perch === previous &&
      canTeleport() &&
      stillAllowed() &&
      (!lease || capturePolicy.capture === lease);
    if (record && (!(await avatarContactVisible(record, dock, seat, canLand)) || !canLand()))
      return false;
    clearPerch();
    perch = {
      record,
      lease,
      dock,
      nextCheck: Date.now() + 1800,
      seated: false,
      seatPoint: seat,
      display: surface?.display,
    };
    const attempt = perch;
    const allowed = () =>
      perch === attempt && stillAllowed() && (!lease || capturePolicy.capture === lease);
    try {
      if (
        !(await launchAvatarTo(
          seat,
          allowed,
          grab,
          avatarTravelPose(arrival, false, surface?.display ?? dock.display),
        )) ||
        !allowed()
      )
        return false;
      if (record && !(await avatarContactVisible(record, dock, seat, allowed))) {
        await finishPerch(attempt);
        return false;
      }
      attempt.seated = true;
      if (attempt.seated && allowed()) {
        if (record && !surface) {
          const changed = (value) => {
            if (perch !== attempt || attempt.targetLost) return;
            attempt.lastNativeUpdate = Date.now();
            if (value.state === 'closed' || value.state === 'hidden') attempt.targetLost = true;
            else attempt.pending = value;
            // The local Settings tracker emits its first state while being installed.
            queueMicrotask(() => void followPerch(attempt).catch(() => {}));
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

  function showAvatarWave() {
    if (!companionPresent()) return;
    if (!avatarDetach?.playReaction('playWave')) emit({ type: 'avatar.wave' });
  }

  async function requestAvatarWave() {
    // A successful wake already plays the greeting.
    if (sleepService.phase !== 'awake') await sleepService.wake();
    else showAvatarWave();
    return true;
  }

  async function submitAvatarCommand(input, movement) {
    if (currentChatTask || chat.active) throw new Error('A reply is already in progress.');
    initiative.activity();
    avatarRoaming.postpone(liveCompanionSettings(), 90000);
    const ru = languages.value.conversation === 'ru';
    const wave = movement.action === 'wave';
    const performance = movement.action === 'performance';
    const work = performance
      ? performSurface(movement.performance, surfaceWatch())
      : wave
        ? requestAvatarWave()
        : movement.action === 'return'
          ? returnAvatar()
          : avatarWindow(movement.title ? { title: movement.title } : {}).then((target) =>
              perchOn(target),
            );
    currentChatTask = work;
    try {
      const success = await work.catch(() => false);
      const text = performance
        ? success
          ? uiText('Done.', languages.value.conversation)
          : ru
            ? 'Не нашла подходящую позу или видимое место. Для сценок у окна включи наблюдение за экраном.'
            : 'I couldn’t find a suitable pose or visible spot. Turn on screen observation for window performances.'
        : wave
          ? uiText(
              success ? 'Done.' : 'The local core is unavailable. Reconnect to try again.',
              languages.value.conversation,
            )
          : movement.action === 'return'
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
        ...((wave || performance) && { silent: true }),
        assistant: { ...assistant, text: '', status: 'streaming' },
      });
      emitChat({ type: 'turn.delta', turnId: input.id, text });
      emitChat({ type: 'turn.completed', turnId: input.id, assistant });
      return { ok: true };
    } finally {
      if (currentChatTask === work) currentChatTask = null;
    }
  }

  function desktopIdleAllowed({ allowInactiveInterface = false } = {}) {
    const settingsOpen = interfaceBusy || settingsHost?.window?.isVisible();
    return Boolean(
      companionPresent() &&
        (avatarOnly || !window.isMinimized()) &&
        !focusMode &&
        !shuttingDown &&
        !quitting &&
        !sessionLocked &&
        !musicSuspended &&
        !avatarDetach.operation &&
        !avatarDetach.press &&
        !pointer?.avatarPress &&
        !pointer?.drag &&
        !resizeSurface?.active &&
        (!settingsOpen ||
          (allowInactiveInterface && powerMonitor.getSystemIdleState(15) === 'idle')) &&
        !draftBusy &&
        !currentChatTask &&
        !chat.active &&
        !playbackBusy &&
        !voice.generating &&
        !avatarClickReactions?.active &&
        !avatarComposerPicking &&
        !detachedReplyHovered &&
        Date.now() >= lastSpeechUntil &&
        sleepService.phase === 'awake' &&
        !screenObservation.snapshot().analysing,
    );
  }

  function avatarIdleAllowed() {
    return (
      skillEnabled('capri.avatar-interaction') &&
      canTeleport() &&
      !perch?.hidden &&
      desktopIdleAllowed()
    );
  }

  function initiativeDesktopRestriction() {
    const { foreground } = initiative.policy;
    const settings = initiativeSettings.value;
    if (quietHour(settings, new Date().getHours())) return 'quiet_hours';
    const awarenessActive = observer.snapshot().active;
    if (
      process.platform === 'win32' &&
      settings.appExclusionsEnabled &&
      settings.excludedApps.length &&
      (!awarenessActive || !foreground)
    )
      return 'app_awareness_unavailable';
    if (awarenessActive && initiativeAppExcluded(settings, foreground?.processName))
      return 'excluded_app';
    if (awarenessActive && foreground?.fullscreen) return 'fullscreen';
    return null;
  }

  let idleCursorMoving = false;
  let lastCursorMovement = null;
  const idleCursorAccess = () =>
    skillEnabled('capri.computer') && fullComputerAccess.enabled && applicationAccess.enabled;
  function idleCursorBlockReason() {
    if (!companionPreferences.value.avatarRoamCursorPranks) return 'disabled';
    if (process.platform !== 'win32' || verification) return 'unavailable';
    if (!idleCursorAccess()) return 'computer_access_unavailable';
    if (backendState.phase !== 'ready') return 'sleeping_or_offline';
    if (
      workflowTurn ||
      avatarDesktopUpdate ||
      callMicrophoneArmed ||
      recordingShown ||
      chess?.watchRun ||
      !desktopIdleAllowed({ allowInactiveInterface: true })
    )
      return 'busy';
    if (powerMonitor.getSystemIdleState(15) !== 'idle') return 'not_idle';
    return initiativeDesktopRestriction();
  }

  async function previewCursorPrank(owner) {
    if (process.platform !== 'win32' || verification)
      return { moved: false, code: 'CAPRI_IDLE_CURSOR_UNAVAILABLE' };
    if (!idleCursorAccess()) return { moved: false, code: 'CAPRI_IDLE_CURSOR_ACCESS_REQUIRED' };
    const cancelled = { moved: false, code: 'CAPRI_IDLE_CURSOR_CANCELLED' };
    const canFinish = () =>
      owner === settingsHost?.window &&
      owner?.isDestroyed() === false &&
      owner.isFocused() &&
      idleCursorAccess() &&
      !sessionLocked &&
      !quitting &&
      !shuttingDown &&
      !workflowTurn &&
      !chat.active &&
      !avatarDesktopUpdate &&
      !chess?.watchRun;
    if (idleCursorMoving || controlBorder || !canFinish()) return cancelled;
    const origin = screen.getCursorScreenPoint();
    const allowed = () => {
      if (!canFinish()) return false;
      const pointer = screen.getCursorScreenPoint();
      return pointer.x === origin.x && pointer.y === origin.y;
    };
    idleCursorMoving = true;
    try {
      return await computerControl.runIdleCursor(allowed, undefined, canFinish, { preview: true });
    } catch {
      return cancelled;
    } finally {
      idleCursorMoving = false;
    }
  }

  async function updateIdleCursor() {
    const settings = companionPreferences.value;
    const permitted = !idleCursorBlockReason();
    if (idleCursorMoving) return;
    const due = idleCursorRoaming.due(settings, {
      blocked: !permitted || Boolean(computerControl.session),
    });
    if (!due) return;
    idleCursorRoaming.postpone(settings);
    const revision = idleCursorRoaming.revision;
    idleCursorMoving = true;
    const current = () => idleCursorRoaming.current(companionPreferences.value, revision);
    const allowed = () => current() && !idleCursorBlockReason();
    const canFinish = () =>
      current() && skillEnabled('capri.computer') && !sessionLocked && !quitting && !shuttingDown;
    const attemptedAt = Date.now();
    try {
      const outcome = await computerControl.runIdleCursor(allowed, undefined, canFinish);
      lastCursorMovement = { attemptedAt, ...outcome };
    } catch (error) {
      lastCursorMovement = {
        attemptedAt,
        moved: false,
        code: error.code ?? 'CAPRI_IDLE_CURSOR_CANCELLED',
      };
      if (error.name !== 'AbortError' && allowed())
        console.warn('Idle cursor prank did not complete:', error.code ?? error.name);
    } finally {
      idleCursorMoving = false;
    }
  }

  function avatarRoamingAllowed() {
    return (
      companionPreferences.value.avatarRoaming &&
      !idleCursorMoving &&
      canTeleport() &&
      !perch?.hidden &&
      desktopIdleAllowed({ allowInactiveInterface: true }) &&
      !initiativeDesktopRestriction() &&
      surfacePlayUntil <= Date.now()
    );
  }

  async function playAmbientSurface(now) {
    if (
      now < nextAmbientSurface ||
      !perch?.seated ||
      perch.hidden ||
      !avatarDetach.available ||
      !surfaceAvailable() ||
      !avatarIdleAllowed() ||
      musicAnimationReady(musicListening.snapshot())
    )
      return false;
    const frame = perch.dock.surface?.frame ?? avatarDockFrame(dockFrames, perch.dock);
    const action = ambientSurfaceClip(frame?.id, lastAmbientClip);
    nextAmbientSurface = now + 24000 + Math.random() * 24000;
    if (!action || !(await startSurfaceClip(action, perch.dock.surface?.side))) return false;
    lastAmbientClip = action;
    return true;
  }

  async function roamDesktopAvatar(watching, revision) {
    const mode = companionPreferences.value.avatarRoamMonitors;
    const allowed = () =>
      avatarRoaming.current(companionPreferences.value, revision) && avatarRoamingAllowed();
    const watchAllowed = () => allowed() && capturePolicy.capture === watching;
    const randomSeat = { ...defaultSeat, fraction: 0.2 + Math.random() * 0.6 };
    const windowObservation = watching?.nativeId.startsWith('window:');
    if (mode === 'current' && windowObservation) {
      if (
        Math.random() < 0.4 &&
        (await performSurface('auto', watching, watchAllowed).catch(() => false))
      )
        return;
      if (watchAllowed()) {
        const target = await avatarWindow({ windowId: watching.nativeId.split(':')[1] }).catch(
          () => null,
        );
        if (await perchOn(target, watching, randomSeat, undefined, watchAllowed).catch(() => false))
          return;
      }
    }
    const bounds = window.getBounds();
    const displays = screen.getAllDisplays();
    const observed =
      watching && !windowObservation
        ? new Set(
            displays
              .filter(
                ({ id }) =>
                  (watching.allMonitors || watching.displayId || displays.length === 1) &&
                  captureIncludesDisplay(watching, id),
              )
              .map(({ id }) => id),
          )
        : null;
    const current = screen.getDisplayNearestPoint(
      avatarDetach.desktopPoint ?? {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
    );
    const display = chooseRoamingDisplay({
      mode,
      displays,
      observed,
      currentId: current.id,
      pointerId:
        mode === 'pointer'
          ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
          : undefined,
    });
    if (!display || !allowed()) return;
    // Only inspect/perch on apps with an existing screen-observation grant.
    // Purely geometric random movement does not capture or inspect the screen.
    if (observed?.has(display.id) && watchAllowed() && Math.random() < 0.35) {
      if (await performSurface('auto', watching, watchAllowed, display.id).catch(() => false))
        return;
      const target = watchAllowed() ? await avatarWindow().catch(() => null) : null;
      if (
        target &&
        screen.getDisplayNearestPoint(windowDock(target)).id === display.id &&
        (await perchOn(target, watching, randomSeat, undefined, watchAllowed).catch(() => false))
      )
        return;
    }
    const point = randomAvatarDestination(display.workArea, bounds, avatarDetach.desktopPoint);
    if (!point) return;
    const stillAllowed = () => allowed() && screen.getDisplayNearestPoint(point).id === display.id;
    if (!stillAllowed()) return;
    const wasPerched = Boolean(perch);
    const arrival = wasPerched && avatarTravelPose(desktopFrame ?? frameIds.get('neutral'), true);
    clearPerch();
    try {
      await launchAvatarTo(point, stillAllowed, undefined, arrival);
    } finally {
      if (wasPerched && !perch && desktopFrame && avatarDetach.available)
        await avatarDetach.updateFrame(desktopFrame, catalog.canvas, maskFor(desktopFrame.id));
    }
  }

  async function updateDesktopAvatar() {
    if (idleCursorMoving) return;
    const roam = avatarRoaming.due(companionPreferences.value, {
      blocked:
        !avatarRoamingAllowed() ||
        Boolean(perch?.updating || perch?.pending || (perch && !perch.seated)),
    });
    if (
      avatarDesktopUpdate ||
      !canTeleport() ||
      avatarDetach.operation ||
      pointer?.avatarPress ||
      pointer?.drag
    )
      return;
    if (perch?.targetLost) {
      await followPerch(perch);
      return;
    }
    const now = Date.now();
    const capture = capturePolicy.capture;
    const watching = capture?.mode === 'watch' && capturePolicy.snapshot().active ? capture : null;
    if (perch?.dock.surface && perch.lease && perch.lease !== surfaceWatch()) {
      await finishPerch(perch);
      return;
    }
    if (watching !== avatarRoamCapture) {
      avatarRoamCapture = watching;
      if (watching) avatarRoaming.postpone(companionPreferences.value, 20000);
    }
    if (roam && avatarRoaming.due(companionPreferences.value)) {
      avatarDesktopUpdate = true;
      avatarRoaming.postpone(companionPreferences.value);
      const revision = avatarRoaming.revision;
      try {
        await roamDesktopAvatar(watching, revision);
      } finally {
        if (avatarRoaming.current(companionPreferences.value, revision))
          avatarRoaming.postpone(companionPreferences.value);
        avatarDesktopUpdate = false;
      }
      return;
    }
    if (await playAmbientSurface(now)) return;
    if (!perch) return;
    if (perch.pending) {
      await followPerch(perch);
      return;
    }
    const current = perch;
    if (!current.record || !current.seated || now < current.nextCheck) return;
    avatarDesktopUpdate = true;
    try {
      current.nextCheck = now + 1800;
      if (current.lease && current.lease !== watching) {
        await finishPerch(current);
        return;
      }
      if (current.dock.surface) {
        const previous = current.dock.surface;
        const targets = await surfaceDetector.detect({ windowId: previous.windowId });
        if (current !== perch || !avatarDetach.available) return;
        const target = targets.find(({ id }) => id === previous.targetId);
        const next =
          target && current.lease === surfaceWatch() && planSurface(target, previous.action);
        if (!next || next.frame.id !== previous.frame.id) return await finishPerch(current);
        const dock = { ...current.dock, surface: next };
        const allowed = () =>
          perch === current && avatarDetach.available && current.lease === surfaceWatch();
        if (!(await avatarContactVisible(current.record, dock, next.point, allowed)))
          return await finishPerch(current, true);
        if (!allowed()) return;
        current.dock.surface = { ...next, side: previous.side };
        current.seatPoint = next.point;
        current.display = next.display;
        await updateSeatedFrame(next.point, next.display);
        syncAvatarComposer(avatarComposer?.pointer);
        return;
      }
      if (
        current.stopTracking &&
        (current.localTracking || (current.lastNativeUpdate && desktopTeleportMenu?.session?.ready))
      ) {
        if (current.hidden) return;
        const point = current.seatPoint;
        const allowed = () =>
          perch === current &&
          canTeleport() &&
          avatarDetach.available &&
          !avatarDetach.operation &&
          current.seatPoint === point;
        if (
          !(await avatarContactVisible(current.record, current.dock, point, allowed)) &&
          allowed()
        )
          await finishPerch(current, true);
        return;
      }
      const target = await avatarWindow(current.record);
      if (perch !== current || !canTeleport() || !avatarDetach.available) return;
      if (!target) await finishPerch(current, true);
      else {
        const point = windowDock(target, current.dock);
        const allowed = () => perch === current && canTeleport() && avatarDetach.available;
        if (!(await avatarContactVisible(current.record, current.dock, point, allowed)))
          return await finishPerch(current, true);
        if (!allowed()) return;
        current.pending = { ...target, state: 'visible' };
        await followPerch(current);
      }
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
    wildInputPranks.pause();
    settingsHost.hide();
    hideCompanionToTray();
    emit({ type: 'window.focus-mode', active: true });
  }

  function writeWindowPreferences(alwaysOnTop) {
    const bounds = resizeSurface?.bounds ?? window.getBounds();
    // Keep the same bottom edge when the next launch restores the full portrait.
    let y = bounds.y;
    if (replyWindowSpace !== REPLY_SPACE) {
      const { workArea } = companionDisplay();
      const restoredHeight = Math.min(activeWindowSize.height, workArea.height);
      y = Math.max(workArea.y, bounds.y + bounds.height - restoredHeight);
    }
    writeJsonAtomic(windowFile, {
      schemaVersion: 3,
      x: bounds.x,
      y,
      footprint: windowFootprint,
      compactPlacement,
      alwaysOnTop,
      layoutSizes: saved.layoutSizes,
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
      microphoneGain: validateMicrophoneGain,
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
    if (changed('microphoneGain'))
      send('microphone.gain', {
        microphoneGain: next.microphoneGain ?? speechPreferences.value.microphoneGain,
      });
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
    delete settingsPreview.zoom;
    avatarLayout = { ...FULL_AVATAR_LAYOUT };
    saveAvatarLayout();
    emit({ type: 'avatar.layout', layout: avatarLayout, reset: true });
  }

  function resetPosition() {
    stopReplyWindowResize();
    pointer?.cancel();
    resizeSurface?.cancel();
    avatarDetach?.reset();
    compactPlacement = undefined;
    const display = screen.getPrimaryDisplay();
    const bounds = placeInWorkArea(null, display.workArea, windowSize(display.workArea));
    window.setBounds(bounds);
    saveWindow();
    restoreCompanion(false);
  }

  function companionDisplay(footprint = windowFootprint) {
    return screen.getDisplayMatching(
      visibleWindowBounds(resizeSurface?.bounds ?? window.getBounds(), footprint),
    );
  }

  function resizeCompanion(layout, monitorWidth) {
    const size = preferredWindowSize(layout, monitorWidth);
    if (
      !window ||
      window.isDestroyed() ||
      (layout === activeWindowLayout &&
        monitorWidth === activeMonitorWidth &&
        size.width === activeWindowSize.width &&
        size.height === activeWindowSize.height)
    )
      return;
    const { workArea } = companionDisplay();
    stopReplyWindowResize();
    pointer?.cancel();
    resizeSurface?.cancel();
    const current = window.getBounds();
    activeWindowSize = size;
    activeWindowLayout = layout;
    activeMonitorWidth = monitorWidth;
    replyWindowSpace = REPLY_SPACE;
    const next = placeInWorkArea(current, workArea, size);
    // Keep the edge the companion was closest to when changing its shape.
    if (current.x + current.width / 2 > workArea.x + workArea.width / 2)
      next.x = current.x + current.width - next.width;
    if (current.y + current.height / 2 > workArea.y + workArea.height / 2)
      next.y = current.y + current.height - next.height;
    compactPlacement = undefined;
    windowFootprint = undefined;
    window.setBounds(placeInWorkArea(next, workArea, size), false);
    saveWindow();
  }

  function stopReplyWindowResize() {
    clearTimeout(replyResizeTimer);
    replyResizeTimer = undefined;
  }

  function syncReplyWindowSize() {
    if (!window || window.isDestroyed() || pointer?.drag || resizeSurface?.active) return false;
    const collapsed = activeWindowLayout === 'vertical' && regions?.replyCollapsed === true;
    const space = collapsed
      ? 0
      : activeWindowLayout === 'vertical'
        ? (regions?.replySpace ?? REPLY_SPACE)
        : REPLY_SPACE;
    if (replyWindowSpace === space) return false;
    const { workArea } = companionDisplay();
    const bounds = window.getBounds();
    stopReplyWindowResize();
    replyWindowSpace = space;
    const fullHeight = Math.min(activeWindowSize.height, workArea.height);
    const compactHeight = compactReplyHeight(fullHeight);
    const height = fittedReplyHeight(fullHeight, space);
    const expandedHeight = collapsed ? Math.max(bounds.height, compactHeight) : height;
    const next = placeInWorkArea({ ...bounds, y: bounds.y + bounds.height - height }, workArea, {
      width: bounds.width,
      height,
    });
    const animated =
      liveCompanionSettings().replyAnimation &&
      regions?.replyMotion === true &&
      expandedHeight > compactHeight &&
      bounds.height !== height &&
      window.isVisible() &&
      !window.isMinimized();
    const target = window;
    target.webContents.send('capri:event', {
      type: 'window.reply-resize',
      animated,
      collapsed,
      expandedHeight,
      compactHeight,
    });
    if (bounds.height === height) return false;
    windowFootprint = undefined;
    if (!animated) {
      target.setBounds(next, false);
      saveWindow();
      return true;
    }
    // Allow the renderer to prepare the reply slot before the first native resize.
    const start = performance.now() + 24;
    let previous = bounds;
    const frame = () => {
      if (window !== target || target.isDestroyed()) {
        stopReplyWindowResize();
        return;
      }
      const fraction = Math.min(1, Math.max(0, (performance.now() - start) / 240));
      const ease = fraction * fraction * (3 - 2 * fraction);
      const current = {
        x: Math.round(bounds.x + (next.x - bounds.x) * ease),
        y: Math.round(bounds.y + (next.y - bounds.y) * ease),
        width: Math.round(bounds.width + (next.width - bounds.width) * ease),
        height: Math.round(bounds.height + (next.height - bounds.height) * ease),
      };
      if (Object.keys(current).some((key) => current[key] !== previous[key]))
        target.setBounds(current, false);
      previous = current;
      if (fraction < 1) replyResizeTimer = setTimeout(frame, 16);
      else {
        stopReplyWindowResize();
        saveWindow();
      }
    };
    replyResizeTimer = setTimeout(frame, 24);
    return true;
  }

  function clampWindow({
    footprint = windowFootprint,
    display,
    fitPreferredSize = false,
    anchor,
  } = {}) {
    if (!window || window.isDestroyed() || pointer?.drag || resizeSurface?.active) return;
    const bounds = window.getBounds();
    display ??= companionDisplay();
    const requested =
      anchor && footprint
        ? { ...bounds, x: anchor.x - footprint.x, y: anchor.y - footprint.y }
        : bounds;
    const next = placeVisibleInWorkArea(
      requested,
      display.workArea,
      fitPreferredSize ? windowSize(display.workArea) : bounds,
      footprint,
    );
    if (['x', 'y', 'width', 'height'].some((key) => next[key] !== bounds[key]))
      window.setBounds(next);
  }

  function queueDesktopRelaunch() {
    if (process.platform === 'darwin') {
      app.relaunch();
      return;
    }
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
    pendingMemoryDecision?.abort();
    memoryWarmup?.abort();
    await computerControl.stop();
    shuttingDown = true;
    modelWarmupController?.abort();
    await callCamera.stop();
    await localModelLoad.stop();
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
    await breezeVoice.cancel();
    microphone.close();
    requestRouter.close();
    setBackend('stopping', message);
    try {
      await Promise.allSettled([
        backendPromise,
        voiceStartPromise,
        modelWarmup,
        sleepService.pending,
      ]);
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
    modelWarmupController?.abort();
    // Keep a parked avatar visible long enough to show DISCONNECTING.
    await localModelLoad.close();
    attachmentViewer?.close();
    attachmentDrafts.clear();
    if (avatarDetach?.available) avatarDetach.stopPointer();
    else avatarDetach?.reset();
    settingsHost?.destroy();
    sleepService.close();
    reminders?.close();
    backendController?.abort(new Error('Startup cancelled for shutdown'));
    memoryWarmup?.abort();
    voiceStartController?.abort();
    cancelVisual();
    capturePolicy.clear();
    screenPreviews.clear();
    initiative.close();
    observer.stop();
    metadataRpc.stop();
    chat.cancel();
    voice.close();
    await breezeVoice.cancel();
    microphone.close();
    requestRouter.close();
    setBackend('stopping', 'Stopping Capri and freeing model memory…');
    try {
      await Promise.allSettled([
        backendPromise,
        voiceStartPromise,
        modelWarmup,
        sleepService.pending,
      ]);
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
        click: (item) => voiceSkills.output.setEnabled(item.checked, 'host'),
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
      ...(process.platform === 'win32'
        ? [
            {
              id: 'software-rendering',
              label: 'Software rendering (restart Capri to apply)',
              type: 'checkbox',
              checked: softwareRenderingRequested(graphicsFile),
              click: (item) => {
                try {
                  saveSoftwareRendering(graphicsFile, item.checked);
                } catch (error) {
                  console.error('Could not save software rendering preference:', error.message);
                  dialog.showErrorBox(
                    'Capri',
                    uiText('Could not save the graphics setting.', languages.value.interface),
                  );
                }
              },
            },
          ]
        : []),
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
    openDefaultBrowser: (url) => shell.openExternal(url),
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
    visionAvailable: () => screenVisionAvailable,
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
    capture: async ({ signal, displayWindow, steamGame, cyberpunkLauncher }) => {
      const overlay = controlBorder;
      const screen = await screenFrames.frame({
        signal,
        displayWindow,
        limit:
          steamGame || cyberpunkLauncher
            ? { width: 3840, height: 2160 }
            : { width: 1280, height: 720 },
        ...(overlay && { aroundCapture: (take) => overlay.captureWithoutOverlay(take) }),
      });
      const scale = Math.min(1, 1280 / screen.width, 720 / screen.height);
      if (scale === 1) return screen;
      const scaled = nativeImage.createFromBuffer(screen.png).resize({
        width: Math.max(1, Math.floor(screen.width * scale)),
        height: Math.max(1, Math.floor(screen.height * scale)),
        quality: 'best',
      });
      return {
        bounds: screen.bounds,
        png: scaled.toPNG(),
        ...scaled.getSize(),
        ocrPng: screen.png,
        ocrWidth: screen.width,
        ocrHeight: screen.height,
      };
    },
    readSteamText: readSteamScreenText,
    describe: computerVision({
      url: rt.inferenceUrl,
      model: settings.model,
      modelCapabilities: settings.modelCapabilities,
      ...inferenceOptions,
      params: { ...auxiliaryRunnerParams, ...settings.generation },
    }),
    registerEscape: async (stop, { idleCursor, wildPrank } = {}) => {
      const interrupt = idleCursor || wildPrank ? stop : emergencyComputerStop;
      let shortcut = false;
      try {
        shortcut = globalShortcut.register('Escape', () => void interrupt());
      } catch {}
      if (!nativeEscape) return shortcut;
      try {
        const armed = await nativeEscape.start({
          onEscape: interrupt,
          onFailure: interrupt,
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
    showBorder: async ({ idleCursor, wildPrank, preview } = {}) => {
      if (controlBorder) throw new Error('Computer control indicator is already open.');
      if (!idleCursor) avatarDetach?.reset();
      const visibleCompanion =
        window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
          ? window
          : undefined;
      const overlay = new ControlOverlay({
        BrowserWindow,
        screen,
        owner: wildPrank ? visibleCompanion : preview ? settingsHost?.window : window,
        idlePoint: idleCursor ? screen.getCursorScreenPoint() : undefined,
        onLost: (reason) => {
          if (controlBorder !== overlay) return;
          console.warn('Computer control indicator lost:', reason);
          return idleCursor || wildPrank ? computerControl.stop() : emergencyComputerStop();
        },
      });
      controlBorder = overlay;
      if (!idleCursor) controlWindowLayer.begin();
      overlay.configure(settingsPreview.computerAppearance ?? computerAppearance.snapshot());
      await overlay.show(
        uiText(
          wildPrank
            ? 'Wild prank active — press Escape to stop'
            : idleCursor
              ? 'Cursor teleport — press Escape to stop'
              : 'Computer control active — press Escape to stop',
          languages.value.interface,
        ),
      );
    },
    showIdleLightning: (move) =>
      controlBorder?.idleLightning({
        ...move,
        effects: teleportLightningSettings(companionPreferences.value),
      }),
    hideBorder: () => {
      const overlay = controlBorder;
      controlBorder = null;
      try {
        overlay?.hide();
      } finally {
        if (controlWindowLayer.active) controlWindowLayer.end();
      }
    },
    emit: (event) => {
      if (event.type === 'computer.input') controlBorder?.pulse(event.action);
      emit(event);
    },
  });
  const planComputer = computerPlanner({
    url: rt.inferenceUrl,
    model: settings.model,
    modelCapabilities: settings.modelCapabilities,
    ...inferenceOptions,
    params: { ...auxiliaryRunnerParams, ...settings.generation },
  });
  const computerAgent = new ComputerAgent({
    onPlan: (value) => controlBorder?.plan(value),
    control: computerControl,
    applications: desktopCatalog,
    callFocusWindow: () => {
      const focused = BaseWindow.getFocusedWindow();
      return focused === window || focused === settingsHost?.window ? focused : null;
    },
    language: () => languages.value.conversation,
    audit: ({ lastOutcome, lastFailure, plan, actions }) =>
      markResponseTiming('computer_outcome', {
        reason: lastOutcome?.reason,
        phase: lastFailure?.phase ?? lastOutcome?.phase,
        failureCode: lastFailure?.code,
        httpStatus: lastFailure?.httpStatus,
        ...(actions.some(({ outcome }) => outcome === 'incremental_fallback') && {
          outlineFallback: true,
        }),
        steps: lastOutcome?.steps,
        completedCheckpoints: plan?.completed,
        remainingCheckpoints: plan?.remaining,
      }),
    plan: planComputer,
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
  skills.register(computerSkill, {
    access: fullComputerAccess,
    requests: computerRequests,
    agent: computerAgent,
    isApplicationAccessEnabled: () => applicationAccess.enabled,
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
        if (computerControl.session?.idleCursor || computerControl.session?.wildPrank)
          void computerControl.stop();
        else void emergencyComputerStop();
      }
    });
  });
  const companionActions = new CompanionActions({
    skills,
    userTools,
    workflows,
    authorizeAction: (tool, args) => {
      if (tool === 'desktop_control' && !['end_control', 'control_status'].includes(args?.action)) {
        const appAction = [
          'apps',
          'find_app',
          'launch',
          'launch_executable',
          'inspect',
          'browser_input',
          'open_url',
        ].includes(args?.action);
        if (!appAction || !skillEnabled('capri.computer'))
          skillSettings.require(appAction ? 'capri.applications' : 'capri.computer');
      }
      if (tool === 'settings_control' && args?.action === 'request') {
        const id = {
          screenObservation: 'capri.screen',
          notepad: 'capri.applications',
          calculator: 'capri.calculator',
          spotify: 'capri.spotify',
        }[args.setting];
        if (id) skillSettings.require(id);
      }
      if (
        tool === 'desktop_control' ||
        (tool === 'application_control' && args?.action !== 'calculate')
      )
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
      return requestComputerAccess(enabled, options);
    },
    runComputerTask: (goal, options) => {
      chat.assertToolAllowed('desktop_control', { action: 'run_task' });
      applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      return chat.active?.computerTaskResult ?? chat.selectModelComputerTask(goal, options);
    },
    spotify: {
      execute: (id, args, signal) => {
        const access = spotify.snapshot();
        if (!access.enabled || !access.prepared)
          throw new Error('Enable Spotify in Settings → Application access first.');
        return spotifyService.execute(id, args, signal);
      },
      close: () => spotifyService.close(),
    },
    youtubeMusic: youtubeMusicService,
    applications: new ApplicationService({
      root,
      permissionsFile: path.join(state, 'applications.json'),
      database: path.join(state, 'fixed-applications.sqlite'),
      showCalculatorWindow: () =>
        skillSettings.preferences.value['capri.calculator']?.showWindow === true,
      permissionSnapshot: () => ({
        ...applicationAccess.mask(applications.snapshot()),
        calculator: skillEnabled('capri.calculator'),
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
        spotify: 'spotify',
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
              spotify: 'Opened Spotify settings. Connect Spotify there.',
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
    formatElapsed: (time) =>
      uiText('Elapsed time: {time}.', languages.value.conversation, { time }),
  });

  temporal = companionActions.time.conversation;

  reminders = new ReminderDelivery({
    file: path.join(state, 'reminder-delivery.json'),
    visual: async (object) => {
      skillSettings.require('capri.timers');
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
        !skillEnabled('capri.timers') ||
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
        (!liveCompanionSettings().wakeOnReminder && sleepService.phase === 'asleep')
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

  function assertModelIdle({ spotifyChange = false } = {}) {
    if (speechInstaller.busy())
      throw new Error('Wait for speech installation to finish, or cancel it in Languages.');
    if (
      shuttingDown ||
      currentChatTask ||
      chat.active ||
      visualTurn ||
      backendPromise ||
      modelWarmup ||
      updates.busy() ||
      huggingface.busy() ||
      voiceCatalog.busy() ||
      voiceTraining.busy() ||
      models.busy() ||
      (!spotifyChange && spotify.busy())
    )
      throw new Error('Wait for the current reply or operation to finish.');
  }
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
        const monitorChange = monitorDisplayChange(liveCompanionSettings(), mode);
        const settings = companionPreferences.set({
          ...companionPreferences.value,
          ...monitorChange,
        });
        if (settingsPreview.companion) Object.assign(settingsPreview.companion, monitorChange);
        emit({
          type: 'companion.settings',
          settings: { ...settings, customAudio: existsSync(path.join(state, 'wake-audio')) },
          monitorChange,
        });
      };
      if (action === 'toggle') change(action);
      else if (action === 'menu') {
        const settings = liveCompanionSettings();
        const { graphs, meters } = resourceMonitorDisplay(settings);
        const current = graphs.length ? 'graphs' : meters.length ? settings.memoryStyle : 'off';
        Menu.buildFromTemplate(
          [
            ['rings', 'Circles'],
            ['bars', 'Bars'],
            ['graphs', 'Graphs'],
            ['off', 'Off'],
          ].map(([id, label]) => ({
            label: uiText(label, liveLanguages().interface),
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
      const settings = liveCompanionSettings();
      const display = resourceMonitorDisplay(settings);
      const selected = display.graphs.length ? display.graphs : display.meters;
      if (shuttingDown || !selected.length || !window?.isVisible() || window.isMinimized())
        return null;
      const [memory, context, load, cpu, disk] = await Promise.all([
        memorySampler.sample(),
        settings.memoryMonitor
          ? contextSampler.sample({ available: !verification && backendState.phase === 'ready' })
          : null,
        resourceMonitorNeedsProcessLoad(display) ? processLoad.sample() : null,
        systemCpu.sample({ awaitTemperature: false }),
        selected.includes('disk') ? resourceDiskUsage(root) : null,
      ]);
      return { ...memory, context, processLoad: load, cpu, disk };
    });
    handle('capri:settings-versions', settingsVersions);
    handle('capri:skill-settings', async (change, { role }) => {
      if (change === undefined) return skillSettings.snapshot();
      const musicShortcut =
        role === 'companion' &&
        change?.id === 'capri.music' &&
        typeof change.enabled === 'boolean' &&
        Object.keys(change).every((key) => ['id', 'enabled'].includes(key));
      if (role !== 'settings' && !musicShortcut)
        throw new Error('Open Settings → Skills to configure a skill.');
      if (
        role === 'settings' &&
        change?.id === 'capri.music' &&
        change.enabled === true &&
        !settingsHost?.window?.isVisible()
      )
        throw Error('Music listening could not start. Try again from Settings.');
      const before = skillEnabled(change?.id);
      const settings = skillSettings.set(change);
      if (
        change.id === 'capri.owner-memory' &&
        (change.enabled === false || change.automatic === false)
      )
        pendingMemoryDecision?.abort();
      emit({
        type: 'skills.settings',
        settings,
        ...(typeof change.enabled === 'boolean' && before !== change.enabled
          ? { changed: change.id }
          : {}),
      });
      if (typeof change.enabled === 'boolean' && before !== change.enabled)
        await applySkillActivation(change.id, change.enabled);
      return skillSettings.snapshot();
    });
    handle('capri:settings-open', async (section) => {
      if (focusMode) return false;
      startupIntroGate.claim('skip');
      emit({ type: 'startup-intro.skip' });
      section = section == null ? null : settingsSection(section);
      const focus =
        new Map([
          ['model-context', 'context'],
          ['model-devices', 'devices'],
          ['local-model', 'model'],
        ]).get(section) ?? null;
      if (focus) section = 'models';
      if (section !== null && !SETTINGS_SECTIONS.some((row) => row[0] === section))
        section = 'general';
      await settingsHost.open(section, focus);
      return true;
    });
    handle('capri:settings-close', (_value, { role }) => {
      settingsHost.hide({ releaseWhenIdle: role === 'settings' });
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
      const previousSkills = skillSettings.snapshot();
      const changes = [
        [companionPreferences, COMPANION_DEFAULTS],
        [inferenceStartup, INFERENCE_STARTUP_DEFAULTS],
        [voiceEffects, VOICE_EFFECT_DEFAULTS],
        [voiceVolume, voiceVolumeDefaults],
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
          previous: previousSkills,
          value: skillPreferences(),
          write: (next) => skillSettings.replace(next),
        },
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
      emit({ type: 'skills.settings', settings: skillSettings.snapshot() });
      for (const [id, value] of Object.entries(previousSkills))
        if (value.enabled) await applySkillActivation(id, false);
      emit({ type: 'voice.settings', ...voiceSnapshot() });
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
        screenSettings: media.screen.preferences(),
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
        avatarRoaming.postpone(liveCompanionSettings(), 60000);
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
    handle('capri:initiative-test', (_value, { role }) => conversation.initiative.test(role));
    handle('capri:cursor-prank-preview', (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings window required.');
      return previewCursorPrank(settingsHost?.window);
    });
    handle('capri:wild-prank-preview', async (_value, { role }) => {
      if (role !== 'settings') throw new Error('Settings window required.');
      if (process.platform !== 'win32' || verification)
        return { ok: false, code: 'CAPRI_WILD_PRANK_UNAVAILABLE' };
      if (!wildInputPrankStyle(true)) return { ok: false, code: 'CAPRI_WILD_PRANK_STYLE_REQUIRED' };
      if (!idleCursorAccess()) return { ok: false, code: 'CAPRI_WILD_PRANK_ACCESS_REQUIRED' };
      return wildInputPranks.preview({
        countdownMs: 3000,
        allowed: () =>
          wildInputPrankStyle(true) &&
          idleCursorAccess() &&
          prankEnvironment() &&
          sleepService.phase === 'awake' &&
          !workflowTurn &&
          !chat.active &&
          !currentChatTask,
        onCountdown: (seconds) =>
          settingsHost?.send({ type: 'wild-prank.preview-status', seconds }),
        run: executeWildInputPrank,
      });
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
      if (['start', 'ask', 'capture'].includes(command.action))
        skillSettings.require('capri.screen');
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
      skillSettings.require('capri.timers');
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
      const result = await companionActions.time.execute(randomUUID(), value, {
        source: 'settings',
      });
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
      if (value) skillSettings.require('capri.applications');
      return applicationAccess.set(value);
    });
    handle('capri:screen-select-source', async (_, { role }) => {
      skillSettings.require('capri.screen');
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
    handle('capri:screen-settings', (value, { role }) => {
      return media.screen.configure(value, role);
    });
    handle('capri:spotify-status', () => spotify.snapshot());
    handle('capri:youtube-music', async (value, { role }) => {
      if (
        role !== 'settings' ||
        !value ||
        Object.keys(value).length !== 1 ||
        !['status', 'open', 'verify'].includes(value.op)
      )
        throw new Error('Invalid YouTube Music request.');
      const configured = skillEnabled('capri.youtube-music');
      if (!configured)
        return {
          ok: false,
          configured,
          message: 'Enable YouTube Music in Settings → Skills first.',
        };
      if (value.op === 'status')
        return { ok: true, configured, message: 'YouTube Music control is enabled.' };
      const signal = skillSettings.operationSignal({
        skillId: 'capri.youtube-music',
        command: 'execute',
      });
      const action = value.op === 'verify' ? 'status' : 'open';
      const result = await youtubeMusicService.execute(randomUUID(), { action }, signal);
      const message = result.ok
        ? value.op === 'verify'
          ? 'Connected to YouTube Music.'
          : 'Opened YouTube Music.'
        : result.status === 'tab_not_found'
          ? 'YouTube Music tab not found. Open it in your browser and select the tab.'
          : 'YouTube Music did not confirm this action. Check the player.';
      return { ok: result.ok, configured, message };
    });
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
    handle('capri:model-devices', async () => ({
      ...(await modelDevices.refresh(voiceDeviceLanguage())),
      external: rt.remote.enabled,
    }));
    async function codingPanelState(status, role) {
      const config = coding.snapshot();
      if (role === 'settings' && config.bridge && config.workspace) {
        const handshake = await coding.bridge
          .request(config.workspace, { action: 'context' }, AbortSignal.timeout(1200))
          .catch(() => null);
        config.bridgeConnected = handshake !== null && Object.hasOwn(handshake, 'active');
      }
      return { ...status, config, changes: codingRevisions.snapshot() };
    }
    handle('capri:coding', async (request, { role }) => {
      const { op, value, enabled, id, path: file, apply, line } = request ?? {};
      if (op === 'status') {
        const status = callSkill('capri.coding', 'status', undefined, { source: role });
        return codingPanelState(status, role);
      }
      if (op === 'open-project' || op === 'open-file' || op === 'diff' || op === 'review') {
        if (role !== 'settings' || !settingsHost?.window?.isVisible())
          throw Error('Open Coding mode in Settings.');
        if (op === 'open-project') return coding.openProject();
        if (op === 'open-file') return coding.execute({ action: 'open', path: file, line });
        if (op === 'diff') return codingRevisions.diff(id, file);
        if (sessionLocked || shuttingDown || !skillEnabled('capri.coding'))
          throw Error('Coding mode is unavailable.');
        return codingRevisions.decide(id, apply);
      }
      if (op === 'editors') return discoverCodingEditors();
      if (op === 'folder' || op === 'executable') {
        const selected = await dialog.showOpenDialog({
          properties: [op === 'folder' ? 'openDirectory' : 'openFile'],
          ...(op === 'executable'
            ? { filters: [{ name: 'Executable', extensions: ['exe'] }] }
            : {}),
        });
        return selected.canceled ? null : selected.filePaths[0];
      }
      if (op === 'save') {
        const previous = coding.config.workspace;
        const status = callSkill('capri.coding', 'save', value, { source: role });
        if (coding.config.workspace !== previous) codingRevisions.reset();
        coding.setMonitoring(skillEnabled('capri.coding'));
        return codingPanelState(status, role);
      }
      if (op === 'install-bridge')
        return callSkill('capri.coding', 'installBridge', undefined, { source: role });
      if (op === 'mode' && typeof enabled === 'boolean') {
        const result = callSkill('capri.coding', 'mode', enabled, { source: role });
        if (enabled && result.enabled && role === 'settings' && !skillEnabled('capri.coding')) {
          const settings = skillSettings.set({ id: 'capri.coding', enabled: true });
          await applySkillActivation('capri.coding', true);
          emit({ type: 'skills.settings', settings, changed: 'capri.coding' });
        }
        if (result.projectRequired && role === 'companion') await settingsHost?.open('coding');
        return result;
      }
      throw Error('Invalid coding operation.');
    });
    async function restartWithModelDevice(selected, npuConfig) {
      assertModelIdle();
      const capture = microphone.snapshot();
      const resumeMicrophone =
        capture.status === 'listening' &&
        !capture.systemAudioReview &&
        !sessionLocked &&
        sleepService.phase === 'awake';
      await shutdownForRestart('Preparing to restart Capri...');
      let restoreDevices, restoreNpu, inferenceChange;
      try {
        if (npuConfig) restoreNpu = saveNpuSettings(root, npuConfig);
        restoreDevices = modelDevices.save(selected);
        inferenceChange = saveInferenceSettings({
          root,
          rt,
          overrides: { acceleration: selected.language === 'cpu' ? 'cpu' : 'auto' },
        });
        if (npuConfig && rt.remote.enabled) await inferenceApi.selectProfile(null);
        if (resumeMicrophone && !verification) saveMicrophoneRestart(state);
        queueDesktopRelaunch();
      } catch (error) {
        if (resumeMicrophone && !verification) consumeMicrophoneRestart(state);
        inferenceChange?.restore();
        restoreDevices?.();
        restoreNpu?.();
        shuttingDown = false;
        setBackend('offline', 'Reconnect to try again.');
        throw error;
      }
      app.quit();
      return true;
    }
    handle('capri:native-npu', async ({ op, config, backend } = {}) => {
      if (op === 'setup-status') return npuSetup.status ?? null;
      if (op === 'install-guide')
        return npuSetup.openInstallGuide(backend, (url) => shell.openExternal(url));
      if (op === 'status') return { config: readNpuSettings(root), active: Boolean(rt.nativeNpu) };
      if (op === 'folder' || op === 'python') {
        const selected = await dialog.showOpenDialog({
          properties: [op === 'folder' ? 'openDirectory' : 'openFile'],
          ...(op === 'python' ? { filters: [{ name: 'Python', extensions: ['exe'] }] } : {}),
        });
        return selected.canceled ? null : selected.filePaths[0];
      }
      if (verification) throw Error('Model changes are disabled in desktop verification.');
      assertModelIdle();
      if (npuSetup.status) throw Error('NPU setup is already running.');
      if (op === 'install') {
        await prepareIntelNpu(root);
        return true;
      }
      if (!['test', 'use'].includes(op)) throw Error('Invalid native NPU operation.');
      const candidate = new NpuInference({ root, config });
      try {
        await candidate.test();
      } finally {
        candidate.stop();
      }
      if (op === 'test') return { ready: true };
      if (
        !(await confirmations.request({
          title: 'Native NPU',
          detail:
            'Capri will restart using the tested native NPU model. Conversation and memory will be kept.',
          confirmLabel: 'Use NPU and restart',
        }))
      )
        return false;
      return restartWithModelDevice(
        { language: candidate.deviceId, voice: readModelDevices(root).voice },
        candidate.config,
      );
    });
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
      const wantsNpu = selected.language.startsWith('npu-');
      if (npuSetup.status) throw Error('NPU setup is already running.');
      if (wantsNpu && (selected.language !== current.language || rt.remote.enabled)) {
        const prepared = await npuSetup.prepare(selected.language);
        return restartWithModelDevice(
          { ...selected, language: prepared.deviceId },
          prepared.config,
        );
      }
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
      return restartWithModelDevice(selected);
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
    handle('capri:voice-catalog', () => voiceCatalog.refresh());
    const voiceApiStatus = async () => ({
      ...externalTts.status(),
      secureStorage: await credentialStorage(safeStorage).available(),
    });
    const beforeVoiceApiChange = async () => {
      assertModelIdle();
      if (voice.generating || playbackBusy || voicePreviewRequest || externalTts.controllers.size)
        throw new Error('Wait for the current reply or preview to finish.');
      await stopVoiceForChange();
    };
    const afterVoiceApiChange = async () => {
      voiceAvailable = externalTts.config.enabled || verification || companionVoiceInstalled();
      voiceAllowed =
        voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
      voice.setLanguage(voiceAvailable ? resolveLanguages(languages.value).speech : 'off');
      if (!voiceAvailable) voice.setEnabled(false);
      emit({
        type: 'speech-components',
        speechAvailability: Object.fromEntries(
          LANGUAGE_PACKS.map((p) => [p.id, speechInstalled(p.id)]),
        ),
        recognitionAvailability: recognitionAvailability(),
      });
      const value = await voiceApiStatus();
      emit({ type: 'voice-api.settings', settings: value });
      if (voice.enabled) void connectVoice();
      return value;
    };
    handle('capri:voice-api-status', voiceApiStatus);
    handle('capri:voice-api-save', async (value) => {
      try {
        await externalTts.save(value, beforeVoiceApiChange);
      } catch (error) {
        if (voice.enabled && !voice.ready) void connectVoice();
        throw error;
      }
      return afterVoiceApiChange();
    });
    handle('capri:voice-api-remove', async () => {
      try {
        await externalTts.remove(beforeVoiceApiChange);
      } catch (error) {
        if (voice.enabled && !voice.ready) void connectVoice();
        throw error;
      }
      return afterVoiceApiChange();
    });
    handle('capri:voice-api-test', () => {
      if (externalTts.controllers.size)
        throw new Error('Wait for the current reply or preview to finish.');
      return externalTts.test();
    });
    handle('capri:voice-model-select', async (selection) => {
      assertModelIdle();
      const wasAvailable = voiceAvailable;
      const result = await voiceCatalog.select(selection);
      voiceAvailable = externalTts.config.enabled || verification || companionVoiceInstalled();
      voiceAllowed =
        voiceAvailable && (!verification || process.env.CAPRI_DESKTOP_VERIFICATION_VOICE === '1');
      if (!wasAvailable && voiceAllowed) {
        voice.setLanguage(resolveLanguages(languages.value).speech);
        if (skillEnabled('capri.voice-output') && voiceVolume.value.volume > 0)
          voice.setEnabled(true);
      }
      emit({
        type: 'speech-components',
        speechAvailability: Object.fromEntries(
          LANGUAGE_PACKS.map((pack) => [pack.id, speechInstalled(pack.id)]),
        ),
        recognitionAvailability: recognitionAvailability(),
      });
      if (voice.enabled) void connectVoice();
      return result;
    });
    handle('capri:voice-model-install', (selection) => {
      if (verification) throw new Error('Voice downloads are disabled in desktop verification.');
      assertModelIdle();
      return voiceCatalog.install(selection);
    });
    handle('capri:voice-model-install-cancel', () => voiceCatalog.cancel());
    handle('capri:breeze-license', async (_value, { role }) => {
      if (role !== 'settings') return false;
      await shell.openExternal(BREEZE_LICENSE_URL);
      return true;
    });
    handle('capri:breeze-voice-import', async (_value, { role }) => {
      if (role !== 'settings') return null;
      assertModelIdle();
      const selected = await dialog.showOpenDialog(settingsHost.window, {
        title: uiText('Import .breeze voice', languages.value.interface),
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'Breeze TTS 2', extensions: ['breeze'] }],
      });
      if (selected.canceled || !selected.filePaths[0]) return null;
      assertModelIdle();
      try {
        return await voiceCatalog.importBreezeVoice(selected.filePaths[0]);
      } finally {
        if (voice.enabled) void connectVoice();
      }
    });
    handle('capri:voice-training-status', () => voiceTraining.snapshot());
    handle('capri:voice-training-import', async () => {
      if (verification)
        throw new Error('Voice dataset import is disabled in desktop verification.');
      assertModelIdle();
      const result = await dialog.showOpenDialog(
        settingsHost?.window?.isVisible() ? settingsHost.window : window,
        {
          title: uiText('Choose a recordings folder', languages.value.interface),
          properties: ['openDirectory', 'dontAddToRecent'],
        },
      );
      if (result.canceled) return voiceTraining.snapshot();
      assertModelIdle();
      return voiceTraining.chooseDataset(result.filePaths[0]);
    });
    handle('capri:voice-training-recording', (value) => voiceTraining.recordingAudio(value));
    handle('capri:voice-training-approve', (value) => {
      assertModelIdle();
      return voiceTraining.approveRecordings(value);
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
        localLoad: localModelLoad.snapshot(),
      };
    };
    const desktopAi = new DesktopAiDiscovery({
      discover: (query, refresh) => desktopCatalog.discoverForOwner(query, refresh),
    });
    handle('capri:desktop-ai-scan', async (refresh, { role }) => {
      if (role !== 'settings' || typeof refresh !== 'boolean')
        throw new Error('Open API connections in Settings.');
      ensureDesktopActions();
      return desktopAi.scan(refresh);
    });
    handle('capri:chatgpt-plan', async (value, { role }) => {
      if (
        role !== 'settings' ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !['action', 'accountId', 'model', 'id'].includes(key))
      )
        throw new Error('Open API connections in Settings.');
      const { action, accountId, model } = value;
      if (action === 'status') return chatgpt.status();
      if (action === 'cancel-sign-in') {
        chatgpt.cancelSignIn();
        return true;
      }
      if (action === 'manage-usage') return chatgpt.manageUsage();
      if (action === 'sign-in') {
        if (verification) throw new Error('Browser sign-in is disabled in desktop verification.');
        assertModelIdle();
        media.screen.stop();
        capturePolicy.clear();
        screenPreviews.clear();
        emit({ type: 'screen.reset' });
        initiative.cancel();
        observer.stop();
        try {
          return await chatgpt.signIn(accountId ?? null);
        } finally {
          void syncInitiative();
        }
      }
      if (action === 'select-account') return chatgpt.select(accountId);
      if (action === 'models') return chatgpt.models(accountId);
      if (action === 'sign-out') {
        if (rt.remote.authMode === 'chatgpt' && rt.remote.accountId === accountId)
          throw new Error(
            'Switch Capri to another AI connection before signing out of this account.',
          );
        return chatgpt.signOut(accountId);
      }
      if (action === 'add-local') {
        const connection = desktopAi.connection(value.id, model);
        const existing = inferenceApi
          .readProfiles()
          .find(
            (p) => p.settings.baseUrl === connection.settings.baseUrl && p.settings.model === model,
          );
        if (!existing) await inferenceApi.saveProfile(connection);
        return inferenceStatus();
      }
      if (action === 'add-connection' || action === 'test') {
        if (typeof model !== 'string' || !/^[a-zA-Z0-9:._/-]{1,128}$/.test(model))
          throw new Error('Choose an available ChatGPT model.');
        const available = await chatgpt.models(accountId);
        const selectedModel = available.find((item) => item.id === model);
        if (!selectedModel)
          throw new Error('Refresh the ChatGPT model list and choose an available model.');
        if (action === 'test') {
          const started = performance.now(),
            signal = AbortSignal.timeout(60000);
          const accessToken = await chatgpt.accessToken(accountId);
          const response = await chatGPTCompletion(
            chatgpt,
            {
              accountId,
              model,
              messages: [{ role: 'user', content: 'Reply with exactly: Ready.' }],
              stream: false,
              max_tokens: 1024,
            },
            signal,
            accessToken,
          );
          const result = await response.json();
          if (!result.choices?.some((choice) => choice.message?.content?.trim()))
            throw new Error('ChatGPT returned no text.');
          return { elapsedMs: Math.round(performance.now() - started) };
        }
        const existing = inferenceApi
          .readProfiles()
          .find(
            (p) =>
              p.settings.authMode === 'chatgpt' &&
              p.settings.accountId === accountId &&
              p.settings.model === model,
          );
        if (!existing)
          await inferenceApi.saveProfile({
            name: 'ChatGPT plan',
            settings: {
              enabled: true,
              authMode: 'chatgpt',
              accountId,
              baseUrl: CHATGPT_RESOURCE,
              model,
              contextTokens: 32768,
              tools: selectedModel.capabilities?.tools !== false,
              vision: selectedModel.capabilities?.vision === true,
              visionMode:
                typeof selectedModel.capabilities?.vision === 'boolean' ? 'catalog' : 'auto',
            },
          });
        return inferenceStatus();
      }
      throw new Error('Unknown AI connection action.');
    });
    handle('capri:inference-api-status', inferenceStatus);
    handle('capri:model-idle-policy', async (value, { role }) => {
      if (
        role !== 'settings' ||
        typeof value?.unloadIdle !== 'boolean' ||
        !validModelIdleMinutes(value.idleMinutes)
      )
        throw new Error('Invalid model setting.');
      const policy = { unloadIdle: value.unloadIdle, idleMinutes: value.idleMinutes };
      writeJsonAtomic(path.join(state, modelIdlePolicyFile), { schemaVersion: 1, ...policy });
      modelIdlePolicy = policy;
      nativeNpu?.setIdleUnload(policy.unloadIdle, modelIdleSeconds());
      mutedVoiceResidency.scheduleIdle();
      await microphone.worker.setIdleUnload(policy.unloadIdle, modelIdleSeconds()).catch(() => {});
      return policy;
    });
    handle('capri:models-warm', async (_value, { role }) => {
      if (role !== 'companion' || sessionLocked) throw new Error('Open Capri to load models.');
      if (modelWarmup) return modelWarmup;
      assertIdle();
      assertModelIdle();
      const warmVoice = voice.enabled && voice.language !== 'off' && !externalTts.config.enabled;
      const warmRecognition = asrAllowed && asrInstalled && asrConfig.language !== 'off';
      const controller = (modelWarmupController = new AbortController());
      modelWarmup = (async () => {
        startup.start([
          'models',
          ...(warmVoice ? ['voice'] : []),
          ...(warmRecognition ? ['recognition'] : []),
        ]);
        const prepare = async (stage, work) => {
          startup.begin(stage);
          try {
            await work();
            startup.end(stage);
          } catch (error) {
            startup.end(stage, true);
            throw error;
          }
        };
        const results = await startModelServices({
          core: () =>
            prepare('models', () =>
              prepareLocalModel(async () => {
                if (verification) return;
                await prewarmModels(
                  { ...rt, remote: { ...rt.remote, ...inferenceStartup.snapshot() } },
                  { signal: controller.signal, warmMemory: skillEnabled('capri.owner-memory') },
                );
                await rt.nativeNpu?.ready({ signal: controller.signal });
              }, controller.signal),
            ),
          voice: warmVoice
            ? () =>
                prepare('voice', async () => {
                  await connectVoice();
                  if (!voice.ready) throw new Error('Voice unavailable');
                })
            : null,
          recognition: warmRecognition
            ? () => prepare('recognition', () => microphone.worker.send({ type: 'warm-model' }))
            : null,
          sequential: responseTiming.sequentialModels,
          shouldContinue: () => !shuttingDown && sleepService.phase === 'awake',
        });
        if (results.some(({ status }) => status === 'rejected'))
          throw new Error('Some models could not be loaded. Check model settings.');
        return true;
      })().finally(() => {
        modelWarmup = null;
        modelWarmupController = null;
        startup.finish();
      });
      return modelWarmup;
    });
    handle('capri:local-model-load-set', (value, { role }) => {
      if (role !== 'companion') throw new Error('Open the Local menu in Capri.');
      return localModelLoad.set(value);
    });
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
      if (id === null && settings.modelSetupRequired) {
        await settingsHost.open('models');
        return false;
      }
      if (
        id === inferenceApi.activeProfileId() &&
        (id !== null || (!rt.remote.enabled && !rt.nativeNpu)) &&
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
      let restoreNpuDevice;
      try {
        await shutdownForRestart('Preparing to restart Capri...');
        if (id === null && rt.nativeNpu)
          restoreNpuDevice = saveModelDevices(root, {
            language: 'auto',
            voice: readModelDevices(root).voice,
          });
        selectionTouched = true;
        await inferenceApi.selectProfile(id);
        queueDesktopRelaunch();
      } catch (error) {
        restoreNpuDevice?.();
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
    handle('capri:computer-access-status', () => callSkill('capri.computer', 'accessStatus'));
    handle('capri:computer-access-set', (enabled, { role }) => {
      if (enabled) applicationAccess.assertAllowed('desktop_control', { action: 'run_task' });
      return callSkill('capri.computer', 'setAccess', enabled, { source: role });
    });
    handle('capri:computer-task-status', () => callSkill('capri.computer', 'status'));
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
    handle('capri:discord-status', (_value, { role }) =>
      callSkill('capri.discord-presence', 'snapshot', undefined, { source: role }),
    );
    handle('capri:discord-configure', (value, { role }) =>
      callSkill('capri.discord-presence', 'configure', value, { source: role }),
    );
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
        let restoreNpuDevice;
        let selectionTouched = false;
        try {
          await shutdownForRestart('Switching language model...');
          if (rt.nativeNpu)
            restoreNpuDevice = saveModelDevices(root, {
              language: 'auto',
              voice: readModelDevices(root).voice,
            });
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
          restoreNpuDevice?.();
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
      updates.cancelAutomaticCheck();
      return githubAccess.connect(value);
    });
    handle('capri:github-remove', async () => {
      updates.cancelAutomaticCheck();
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
    handle('capri:update-versions', (experimental, { role }) => {
      if (role !== 'settings') throw new Error('Open Updates in Settings.');
      return updates.history(experimental);
    });
    handle('capri:update-version-choose', (id, { role }) => {
      if (role !== 'settings') throw new Error('Open Updates in Settings.');
      return updates.chooseHistory(id);
    });
    handle('capri:update-version-open', (id, { role }) => {
      if (role !== 'settings') throw new Error('Open Updates in Settings.');
      return shell.openExternal(updates.historyUrl(id));
    });
    handle('capri:update-download', async () => {
      if (updates.mode !== 'archive') return updates.prepare();
      const url = updates.archiveReleaseUrl();
      if (!verification) await shell.openExternal(url);
      return updates.snapshot();
    });
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
      if (updates.mode === 'manual') return false;
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
    handle('capri:copy-message', (id) => {
      if (typeof id !== 'string' || id.length > 100 || sessionLocked || shuttingDown) return false;
      const message = store.messages.find((entry) => entry.id === id);
      if (!message?.text.trim() || message.status === 'streaming') return false;
      clipboard.writeText(message.text);
      return true;
    });
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
          (key) => !['action', 'id', 'enabled', 'parameters', 'settings', 'metadata'].includes(key),
        )
      )
        throw new Error('Invalid user-tool action.');
      if (['status', 'refresh', 'stop', 'example'].includes(value.action))
        return callSkill(ACTION_SKILLS.userTools, value.action, undefined, { source: role });
      if (value.action === 'open') {
        await shell.openPath(userTools.folder);
        return true;
      }
      if (value.action === 'edit') return userTools.edit(value.id, value.metadata);
      if (value.action === 'open-tool')
        return shell.openPath(await userTools.toolDirectory(value.id));
      if (value.action === 'remove') {
        const t = (text) => uiText(text, languages.value.interface);
        const { response } = await dialog.showMessageBox(settingsHost.window, {
          type: 'warning',
          message: t('Move this tool to the Recycle Bin?'),
          buttons: [t('Cancel'), t('Delete')],
          defaultId: 0,
          cancelId: 0,
        });
        return response === 1
          ? userTools.remove(value.id, (folder) => shell.trashItem(folder))
          : userTools.list();
      }
      if (value.action === 'enable')
        return callSkill(
          ACTION_SKILLS.userTools,
          'enable',
          {
            id: value.id,
            enabled: value.enabled,
          },
          { source: role },
        );
      if (value.action === 'settings')
        return callSkill(
          ACTION_SKILLS.userTools,
          'settings',
          {
            id: value.id,
            settings: value.settings,
          },
          { source: role },
        );
      if (value.action === 'inputs') {
        const selected = await dialog.showOpenDialog(settingsHost.window, {
          title: uiText('Choose input files', languages.value.interface),
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
        });
        return selected.canceled ? { count: 0 } : userTools.inputs(value.id, selected.filePaths);
      }
      if (value.action === 'test')
        return callSkill(
          ACTION_SKILLS.userTools,
          'test',
          { name: value.id, parameters: value.parameters ?? {} },
          { source: role },
        );
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
      if (value.action === 'record' && !applicationAccess.enabled)
        throw new Error('Enable application access first.');
      if (['status', 'record', 'stop'].includes(value.action))
        return callSkill(ACTION_SKILLS.workflows, value.action, undefined, { source: role });
      if (value.action === 'save')
        return callSkill(ACTION_SKILLS.workflows, 'save', value.workflow, { source: role });
      if (value.action === 'remove')
        return callSkill(ACTION_SKILLS.workflows, 'remove', value.id, { source: role });
      if (value.action === 'run') {
        if (chat.active) throw new Error('Wait for the current reply to finish.');
        return callSkill(
          ACTION_SKILLS.workflows,
          'run',
          { id: value.id, variables: value.variables ?? {} },
          { source: role },
        );
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
      if (value.action === 'chat') {
        skillSettings.require('capri.private-memory');
        return privateMemory.chat(value.text, respondPrivately, {
          allowApi: value.allowApi === true,
        });
      }
      if (value.action === 'create' && !skillEnabled('capri.private-memory')) {
        await conversation.privateMemory.settings(value);
        return conversation.privateMemory.settings({ action: 'lock' });
      }
      return conversation.privateMemory.settings(value);
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
      return conversation.brain.settings(
        value.action === 'configure' ? { ...value, enabled: skillEnabled('capri.brain') } : value,
      );
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
      return saveOwnerFact(rt.workspace, value);
    });
    handle('capri:saved-memory', async (value, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible())
        throw new Error('Open Memory controls in Settings.');
      if (sessionLocked || shuttingDown || maintenance)
        return { items: [], truncated: false, unavailable: true };
      try {
        if (value !== undefined) {
          pendingMemoryDecision?.abort();
          return changeOwnerFact(rt.workspace, value);
        }
        return await ownerMemory.read();
      } catch {
        // A private path or memory content must never enter a renderer error/diagnostic.
        throw new Error('Saved memories could not be loaded. Try again.');
      }
    });
    const confirmReset = async (memory) => {
      assertIdle();
      pendingMemoryDecision?.abort();
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
          contextSampler.invalidate();
          metadataRpc.stop();
          try {
            await stopManaged(rt.logPrefix);
            await ownerMemory.clear();
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
      onStyleChanged: (style) => {
        prankStyle = style;
        if (style !== 'wild') {
          wildPranks.tick(false);
          wildInputPranks.pause();
        }
        void syncInitiative().catch(() => observer.publish('failed'));
      },
      dialog: localizedDialog(dialog, (text) => uiText(text, languages.value.interface)),
      getWindow: () => (settingsHost?.window?.isVisible() ? settingsHost.window : window),
      emit,
      shell,
      assertIdle,
      onWakeVoicePreparation: (active) => {
        wakeVoicePreparing = active;
        if (!active) mutedVoiceResidency.scheduleIdle();
      },
      prepareVoice: async () => {
        if (!voice.enabled || voice.language === 'off')
          throw Object.assign(new Error(VOICE_REQUIRED_MESSAGE), { code: 'CAPRI_VOICE_DISABLED' });
        await connectVoice();
        if (!voice.ready) throw new Error('The voice is unavailable. Enable it and retry.');
      },
      voiceUrl: companionVoiceUrl(),
      voiceHeaders: companionVoiceHeaders,
      synthesizeVoice: (request, signal) => {
        const adapter = externalTts.config.enabled ? externalTts : nativeVoice(request.language);
        if (adapter) return adapter.synthesize({ text: request.text, signal });
        return fetch(`${companionVoiceUrl()}/synthesize`, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { ...companionVoiceHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify(request),
        });
      },
      wakeLanguage: () => (voice.language === 'off' ? 'en' : voice.language),
      wakeIdentity: () => {
        if (externalTts.config.enabled) return JSON.stringify(externalTts.config);
        if (nativeVoice(voice.language)) return breezeVoice.identity();
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
      prepareDiagnosticLogs: () => chessDiagnostics.flush(),
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
        windowsCompatibility: windowsCompatibility(),
        windowGraphics: {
          ...windowGraphics,
          gpuCompositing: app.getGPUFeatureStatus().gpu_compositing?.startsWith('enabled') ?? null,
          gpuProcessFailures,
        },
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
        computerTask: callSkill('capri.computer', 'diagnostics'),
        initiative: {
          ...initiative.snapshot(),
          roamingEnabled: liveCompanionSettings().avatarRoaming,
          cursorEnabled: companionPreferences.value.avatarRoamCursorPranks,
          cursor: {
            code: 'CAPRI_IDLE_CURSOR_' + (idleCursorBlockReason() ?? 'eligible').toUpperCase(),
            nextAt: idleCursorRoaming.nextAt,
            last: lastCursorMovement,
          },
        },
        chess: chess?.diagnosticState(),
        screenCapture: capturePolicy.diagnostics(),
        screenObservation: (() => {
          const { source, ...state } = screenObservation.snapshot();
          return state;
        })(),
        voice: {
          ...voice.diagnostics(),
          configuredLanguage: resolveLanguages(languages.value).speech,
        },
        musicListening: musicListening.snapshot(),
        callAudio: callAudioDiagnostics.snapshot({
          ...callAudioSnapshot(),
          setup: callSetup.diagnostics(),
          voiceEnabled: voice.enabled && voice.language !== 'off',
        }),
        speechInstallation: speechInstaller.snapshot(),
        voiceCatalog: voiceCatalog.diagnostics(),
        voiceResidency: mutedVoiceResidency.diagnostics(),
        voiceApi: externalTts.diagnostics(),
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
          provider: rt.nativeNpu ? 'native-npu' : rt.remote.enabled ? 'external-api' : 'local',
          model: rt.nativeNpu
            ? nativeNpu.model
            : rt.remote.enabled
              ? rt.remote.model
              : settings.model,
          modelCapabilities: rt.remote.enabled
            ? inferenceOptions.modelCapabilities
            : settings.modelCapabilities,
          resourceProfile: settings.resourceProfile,
          acceleration: settings.acceleration,
          cpuThreads: settings.cpuThreads,
          contextTokens: rt.remote.enabled ? rt.remote.contextTokens : settings.contextTokens,
          keepAlive: modelIdlePolicy.unloadIdle ? modelIdleSeconds() : -1,
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
      voiceHealth: () => {
        const language = resolveLanguages(languages.value).speech;
        if (language === 'off') return { ready: false, activeEngine: 'off' };
        const { ready } = voice.snapshot();
        if (externalTts.config.enabled) return { ready, activeEngine: 'external-api' };
        if (nativeVoice(language)) return { ready, activeEngine: 'breeze-tts' };
        return request(`${companionVoiceUrl()}/health`, {
          headers: companionVoiceHeaders(),
          timeout: 2500,
        });
      },
    });
    handle('capri:wild-tabs-keep', (id) => typeof id === 'string' && wildTabs.keep(id));
    handle('capri:wild-tabs-shown', (id) => typeof id === 'string' && wildTabs.shown(id));
    prepareWakeAudio = companionAccess.prepareWakeVoice;
    handle('capri:startup-intro', (action, { role }) => {
      if (role !== 'companion') throw new Error('Startup presentation belongs to the companion.');
      return startupIntroGate.claim(action);
    });
    handle('capri:patch-notes', (shown, { role }) => {
      if (role !== 'companion') throw new Error('Patch notes belong to the companion.');
      return shown === undefined
        ? updates.currentPatchNotes({ network: !verification })
        : updates.patchNotes.shown(shown);
    });
    handle('capri:bootstrap', (_value, { role }) => {
      if (role === 'companion') rendererReady = true;
      const mainLaunch = role === 'companion' && !verification;
      const resumeMicrophone = mainLaunch && consumeMicrophoneRestart(state);
      const launchMicrophone =
        mainLaunch && microphoneLaunch.take(companionPreferences.value.microphoneOnStart === true);
      return {
        attachmentVision: screenVisionAvailable,
        skills: skillSettings.snapshot(),
        thinking: { enabled: callSkill('capri.reasoning', 'mode') },
        coding: { enabled: callSkill('capri.coding', 'enabled') },
        internet: { enabled: callSkill('capri.web-search', 'mode') },
        time: companionActions.time.snapshot(),
        inference: {
          remote: rt.remote.enabled,
          vision: rt.remote.vision,
          setupRequired: rt.remote.setupRequired,
          model: rt.nativeNpu
            ? nativeNpu.model
            : rt.remote.enabled
              ? rt.remote.model
              : localModelName,
          ...(rt.remote.authMode === 'chatgpt' ? { authMode: 'chatgpt' } : {}),
          ...(rt.remote.enabled ? { providerHost: new URL(rt.remote.baseUrl).hostname } : {}),
        },
        windowSettings: { alwaysOnTop: saved.alwaysOnTop !== false, focusMode, avatarOnly },
        callCamera: callCamera.snapshot(),
        settingsVersions: settingsVersions(),
        screenSettings: media.screen.preferences(),
        spotify: spotify.snapshot(),
        models: models.snapshot(),
        modelIdlePolicy,
        modelMemory,
        updates: updates.snapshot(),
        ...(role === 'companion' && {
          messages: store.snapshot(),
          offerPatchNotes: updates.patchNotes.offer(),
          portraitFallback: gpuProcessFailures > 0,
          offerBeginnerGuide: !verification || process.env.CAPRI_DESKTOP_VERIFICATION_GUIDE === '1',
        }),
        companion: companionPreferences.snapshot(),
        startup: startup.snapshot(),
        backend: backendState,
        power: { phase: sleepService.phase },
        warning:
          [
            installedAvatar.warning,
            skillEnabled('capri.voice-output') &&
            !voiceAvailable &&
            resolveLanguages(languages.value).speech !== 'off'
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
        ...(role === 'settings' && {
          avatarGallery: {
            ...catalog.publicGallery(),
            intro: startupIntroSnapshot(startupIntroPack),
          },
        }),
        musicArtwork: catalog.publicMusic(),
        musicListening: musicListening.snapshot(),
        audioRouting:
          role === 'settings'
            ? audioRoutingState()
            : { routes: { speaker: audioRoutes.value.routes.speaker } },
        startupIntro: startupIntroGate.pending ? startupIntroSnapshot(startupIntroPack) : null,
        avatar: avatar.snapshot(),
        avatarLayout,
        dimming,
        voice: voiceSnapshot(),
        speech: speechPreferences.snapshot(),
        microphone: {
          ...microphone.snapshot(),
          ...audioInputs.snapshot(),
          microphoneGain: settingsPreview.microphoneGain ?? speechPreferences.value.microphoneGain,
          available: asrAllowed && asrInstalled,
          resumeAfterRestart:
            (resumeMicrophone || launchMicrophone) &&
            asrAllowed &&
            asrInstalled &&
            skillEnabled('capri.microphone') &&
            powerMonitor.getSystemIdleState(1) !== 'locked',
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
        screenObservation: media.screen.snapshot(),
        lastScreenshot,
      };
    });
    handle('capri:send', async (value) => {
      try {
        return await submitMessage(value);
      } catch (error) {
        if (!(error instanceof SubmissionError)) throw error;
        return { ok: false, message: error.message };
      }
    });
    handle('capri:response-painted', (value) => {
      if (!value || Object.keys(value).some((key) => !['id', 'elapsedMs'].includes(key)))
        return false;
      return acknowledgeResponsePaint(value.id, value.elapsedMs);
    });
    handle('capri:thinking-mode-set', (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid thinking mode');
      return setComposerTurnMode('capri.reasoning', enabled);
    });
    handle('capri:internet-mode-set', (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid internet mode');
      if (currentChatTask || chat.active) throw new Error('Wait for the current reply to finish.');
      return setComposerTurnMode('capri.web-search', enabled);
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
    handle('capri:attachment-add', (value, { frame }) => {
      skillSettings.require('capri.attachment-viewer');
      return attachmentDrafts.add(value, frame);
    });
    handle('capri:attachment-remove', (id, { frame }) => attachmentDrafts.remove(id, frame));
    handle('capri:attachment-send', (value, { frame }) => {
      skillSettings.require('capri.attachment-viewer');
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
    handle('capri:attachment-open', conversation.attachments.open);
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
    const chessEnabled = () =>
      skillEnabled('capri.chess') && !shuttingDown && !sessionLocked && !computerControl.session;
    const chessPreferences = new Preferences(
      path.join(state, 'chess.json'),
      {
        autoMove: false,
        moveLightning: true,
        showArrow: true,
        boardFrame: true,
        arrow: DEFAULT_CHESS_ARROW,
        frameStyle: DEFAULT_CHESS_FRAME,
        reactions: CHESS_REACTION_DEFAULTS,
      },
      (value) => {
        if (typeof value?.autoMove !== 'boolean') throw new Error('Invalid chess settings');
        const { autoMove, moveLightning = true, showArrow = true, boardFrame = true } = value;
        if ([moveLightning, showArrow, boardFrame].some((flag) => typeof flag !== 'boolean'))
          throw new Error('Invalid chess settings');
        return {
          autoMove,
          moveLightning,
          showArrow,
          boardFrame,
          arrow: restoreChessArrowAppearance(value.arrow),
          frameStyle: restoreChessFrameAppearance(value.frameStyle),
          reactions: chessReactionSettings(value.reactions),
        };
      },
    );
    chessReactions = new ChessReactions({
      preferences: () => chessPreferences.value.reactions,
      style: () => settingsPreview.style ?? readCommunicationStyle(rt.workspace),
      language: () => {
        const { conversation, interface: interfaceLanguage } = liveLanguages();
        return INTERFACE_LOCALES.some(({ id }) => id === conversation)
          ? conversation
          : interfaceLanguage;
      },
      trace: chessTrace,
      allowed: () =>
        chessEnabled() &&
        !quitting &&
        !maintenance &&
        companionPresent() &&
        !chat.active &&
        !currentChatTask &&
        !draftBusy &&
        !playbackBusy &&
        !voice.generating &&
        !voicePreviewRequest &&
        !initiative.active &&
        !avatarClickReactions.active &&
        !screenObservation.session?.controller,
      deliver: (text, spoken) => {
        const turnId = randomUUID();
        const assistant = {
          id: randomUUID(),
          turnId,
          role: 'assistant',
          text,
          status: 'complete',
          createdAt: new Date().toISOString(),
          origin: { kind: 'chess-reaction' },
        };
        const speak =
          spoken &&
          skillEnabled('capri.voice-output') &&
          voice.enabled &&
          voice.language !== 'off' &&
          !currentCallAudio.shareReplies;
        emit({
          type: 'turn.started',
          turnId,
          assistant: { ...assistant, text: '', status: 'streaming' },
          source: 'chess-reaction',
          silent: !speak,
        });
        if (speak) {
          voiceSkills.output.turn({ type: 'turn.started', turnId });
          voiceSkills.output.turn({ type: 'turn.delta', turnId, text });
        }
        emit({ type: 'turn.delta', turnId, text });
        if (speak) voiceSkills.output.turn({ type: 'turn.completed', turnId });
        emit({ type: 'turn.completed', turnId, assistant });
      },
    });
    chess = new ChessSession({
      capture: new ChessCapture({
        BrowserWindow,
        screen,
        desktopCapturer,
        enabled: chessEnabled,
        teleportEffects: liveCompanionSettings,
        windowBounds: (windowId, signal) =>
          callApplicationBridge(
            root,
            { action: 'avatar_window', windowId },
            { signal, stillAllowed: chessEnabled },
          ),
        regionBitmap: async (region, limit, signal, windowClient) => {
          const { bgra, width, height } = await screenFrames.frame({
            region,
            windowClient,
            limit,
            signal,
            format: 'bgra',
          });
          return nativeImage.createFromBitmap(bgra, { width, height, scaleFactor: 1 });
        },
      }),
      access: new ChessPageAccess({
        inspect: async (signal, target) => {
          const response = await callApplicationBridge(
            root,
            {
              action: 'chess_view',
              ...(target.hwnd
                ? { hwnd: target.hwnd }
                : { x: String(target.x), y: String(target.y) }),
            },
            { signal, stillAllowed: chessEnabled },
          );
          return response.view ?? (response.probe ? { probe: response.probe } : null);
        },
      }),
      install: new ChessEngineInstall({
        root,
        directory: path.join(
          verification ? verificationFolder : path.join(root, '.runtime'),
          'chess',
        ),
        progress: (engine) => settingsHost?.send({ type: 'chess.engine', engine }),
        trace: chessTrace,
      }),
      enabled: chessEnabled,
      trace: chessTrace,
      autoMove: () => chessPreferences.value.autoMove,
      playScreenMove: async ({ token, tabId, target, from, to, signal, onMovePressed }) => {
        const response = await callApplicationBridge(
          root,
          {
            action: 'chess_move',
            token,
            ...(tabId ? { tabId } : {}),
            x: String(target.x),
            y: String(target.y),
            fromX: String(from.x),
            fromY: String(from.y),
            toX: String(to.x),
            toY: String(to.y),
          },
          {
            signal,
            onMovePressed,
            stillAllowed: () => chessEnabled() && chessPreferences.value.autoMove,
          },
        );
        return {
          status: response.status ?? 'blocked',
          moveProbe: response.moveProbe,
          browserProbe: response.probe,
        };
      },
      prompt: () =>
        uiText(
          'Drag a square around the chessboard. Enter confirms. Esc cancels.',
          languages.value.interface,
        ),
      event: (value) => settingsHost?.send({ type: 'chess.watch', ...value }),
      react: (events, signal) => chessReactions.submit(events, signal),
      reactionsEnabled: () => chessPreferences.value.reactions.enabled,
    });
    chess.capture.configureAppearance(chessPreferences.value.arrow);
    chess.capture.configureMoveLightning(chessPreferences.value.moveLightning);
    chess.capture.configureShowArrow(chessPreferences.value.showArrow);
    chess.capture.configureBoardFrame(chessPreferences.value.boardFrame);
    chess.capture.configureFrameStyle(chessPreferences.value.frameStyle);
    handle('capri:chess', (request, { role }) => {
      if (role !== 'settings') throw new Error('Settings frame required');
      if (request?.action === 'status')
        return chess
          .snapshot()
          .then((value) => ({ ...value, reactions: chessPreferences.value.reactions }));
      if (request?.action === 'ui-diagnostic') {
        const { reason, boardIndex } = request.payload ?? {};
        if (!chessUiDecisions.has(reason)) throw new Error('Invalid chess diagnostic event');
        chessTrace('ui', {
          scanId: chess.scanned?.scanId,
          boardIndex:
            Number.isInteger(boardIndex) && boardIndex >= 0 && boardIndex < 3
              ? boardIndex
              : undefined,
        })('decision', { reason });
        return true;
      }
      if (request?.action === 'auto-move') {
        const { autoMove } = chessPreferences.set({
          ...chessPreferences.value,
          autoMove: request.payload,
        });
        chessTrace('command', { command: 'auto-move', autoMove })('completed');
        return autoMove;
      }
      if (request?.action === 'move-lightning') {
        if (typeof request.payload !== 'boolean') throw new Error('Invalid chess settings');
        const { moveLightning } = chessPreferences.set({
          ...chessPreferences.value,
          moveLightning: request.payload,
        });
        chess.capture.configureMoveLightning(moveLightning);
        return moveLightning;
      }
      if (request?.action === 'board-frame') {
        if (typeof request.payload !== 'boolean') throw new Error('Invalid chess settings');
        const { boardFrame } = chessPreferences.set({
          ...chessPreferences.value,
          boardFrame: request.payload,
        });
        chess.capture.configureBoardFrame(boardFrame);
        return boardFrame;
      }
      if (request?.action === 'show-arrow') {
        if (typeof request.payload !== 'boolean') throw new Error('Invalid chess settings');
        const { showArrow } = chessPreferences.set({
          ...chessPreferences.value,
          showArrow: request.payload,
        });
        chess.capture.configureShowArrow(showArrow);
        return showArrow;
      }
      if (request?.action === 'frame-appearance') {
        const frameStyle = chessFrameAppearance(request.payload);
        chessPreferences.set({ ...chessPreferences.value, frameStyle });
        chess.capture.configureFrameStyle(frameStyle);
        return frameStyle;
      }
      if (request?.action === 'reactions') {
        if (request.payload === undefined) throw new Error('Invalid chess reaction settings');
        const { reactions } = chessPreferences.set({
          ...chessPreferences.value,
          reactions: request.payload,
        });
        chessReactions.cancel();
        return reactions;
      }
      if (request?.action === 'arrow-appearance') {
        const arrow = chessArrowAppearance(request.payload);
        chessPreferences.set({ ...chessPreferences.value, arrow });
        chess.capture.configureAppearance(arrow);
        return arrow;
      }
      if (request?.action === 'stop') {
        chessReactions.cancel();
        chessTrace('command', { command: 'stop', scanId: chess.scanned?.scanId })('completed');
        chess.stop();
        return true;
      }
      if (request?.action === 'cancel') {
        chessTrace('command', { command: 'cancel' })('completed');
        chess.install.cancel();
        return true;
      }
      if (!chessEnabled()) {
        chessTrace('command', { command: request?.action })('failed', { reason: 'skill_disabled' });
        throw new Error('Enable the Chess skill first');
      }
      switch (request?.action) {
        case 'install':
          if (!chess.install.snapshot().installed) chess.stopWatch();
          return chess.install.install();
        case 'remove':
          return chess.removeEngine();
        case 'scan':
          return chess.scan(request.payload ?? {});
        case 'preview-board':
          return chess.preview(request.payload?.index);
        case 'import': {
          const trace = chessTrace('command', { command: 'import', source: 'local' });
          const { fen, count, ply } = importGame(request.payload);
          trace('completed', { historyPlies: count, ply, turn: fen.split(' ')[1] });
          return { fen, count, ply };
        }
        case 'analyse':
          return chess.analyse(request.payload ?? {});
        case 'watch':
          return chess.watch(request.payload ?? {});
        case 'explain': {
          const analysis = chess.last;
          if (!analysis?.result.bestMove || analysis.position.fen !== request.payload?.fen)
            throw new Error('Analyse a chess position first');
          const pv = analysis.result.lines[0]?.moves.map(({ san }) => san).join(' ') ?? '';
          const question = uiText(
            'Why does Stockfish suggest this chess move?',
            languages.value.interface,
          );
          settingsHost.hide();
          restoreCompanion();
          emit({
            type: 'chess.explain',
            draft: `${question}\nFEN ${analysis.position.fen}\nStockfish ${analysis.result.bestMove.san}${pv ? ` · ${pv}` : ''}`,
          });
          return true;
        }
        default:
          chessTrace('command')('failed', { reason: 'invalid_request' });
          throw new Error('Invalid chess action');
      }
    });
    registerScreenIpc(handle, {
      root,
      requireEnabled: () => skillSettings.require('capri.screen'),
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
      onCapture: () => showObservationCue('screen'),
    });
    registerAccessIpc(handle, {
      dialog: localizedDialog(dialog, (text) => uiText(text, languages.value.interface)),
      getWindow: () => (settingsHost?.window?.isVisible() ? settingsHost.window : window),
      getInterfaceLanguage: () => languages.value.interface,
      files: conversation.files,
      applications,
      ensureDesktopActions,
      emit,
    });
    handle('capri:initiative', (value, { role }) => conversation.initiative.configure(value, role));
    handle('capri:initiative-dismiss', (_value, { role }) => conversation.initiative.dismiss(role));
    handle('capri:initiative-restore', (_value, { role }) => conversation.initiative.restore(role));
    handle('capri:activity', () => {
      initiative.activity();
      screenObservation.activity();
      return true;
    });
    handle('capri:playback-state', (value) => {
      const completedTurnId = value?.completedTurnId;
      if (
        typeof value !== 'boolean' &&
        (typeof completedTurnId !== 'string' || !completedTurnId || completedTurnId.length > 128)
      )
        throw new Error('Invalid playback state');
      const busy = value === true;
      callAudioDiagnostics.playback(busy, voice.turn?.id);
      if (playbackBusy && !busy) nativeMusicPlaybackTail = Date.now() + 600;
      playbackBusy = busy;
      mutedVoiceResidency.scheduleIdle();
      for (const listener of [...reminderListeners]) listener({ type: 'playback.state', busy });
      settingsHost?.send({
        type: 'settings.activity',
        chat: Boolean(chat.active || currentChatTask),
        playback: busy,
      });
      if (!busy) resumeFollowUp(completedTurnId);
      if (busy) screenObservation.activity();
      return true;
    });
    handle('capri:interface-busy', (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid interface state');
      interfaceBusy = value || Boolean(settingsHost?.window?.isVisible());
      if (value) {
        initiative.cancel();
        avatarClickReactions.cancel();
        wildTabs.reset();
      }
      return true;
    });
    handle('capri:draft-state', (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid draft state');
      draftBusy = value;
      if (value) {
        avatarClickReactions.cancel();
        wildTabs.reset();
        initiative.activity();
        screenObservation.activity();
      }
      return true;
    });
    handle('capri:microphone-start', media.microphone.start);
    handle('capri:microphone-devices', (_value, { role }) => media.microphone.devices(role));
    handle('capri:microphone-monitor', (enabled, { role, frame }) => {
      if (role !== 'settings' || typeof enabled !== 'boolean') return false;
      microphoneMonitorGrant = undefined;
      if (!enabled) return true;
      if (sessionLocked || shuttingDown || !settingsHost?.window?.isVisible()) return false;
      microphoneMonitorGrant = { frame, expiresAt: performance.now() + 5000 };
      return true;
    });
    handle('capri:microphone-device', (value, { role }) =>
      media.microphone.selectDevice(value, role),
    );
    handle('capri:system-audio-prepare', prepareSystemSource);
    handle('capri:system-audio-cancel', (id, { frame }) => systemAudio.cancel(id, frame));
    handle('capri:system-audio-native-stop', (token, { role }) => {
      if (
        role === 'companion' &&
        token &&
        (nativeSystemCapture?.token === token || nativeSystemArm?.token === token)
      )
        stopNativeSystemAudio();
    });
    handle('capri:music-status', media.music.snapshot);
    handle('capri:music-settings', (value, { role }) => {
      if (role !== 'settings') throw Error('Open Music listening in Settings.');
      return media.music.configure(value, { role });
    });
    handle('capri:music-audio-start', () => {
      if (audioRoutes.value.routes.music) throw Error('The selected audio source could not start.');
      return media.music.start();
    });
    handle('capri:music-audio-ready', media.music.ready);
    handle('capri:music-audio-packet', (value) => musicListening.packet(value));
    handle('capri:music-audio-stop', (id) => media.music.stop(id));
    handle('capri:music-audio-prepare', (id, { frame }) => musicAudio.prepare(id, frame));
    handle('capri:music-audio-cancel', (id, { frame }) => musicAudio.cancel(id, frame));
    handle('capri:call-audio-devices', (_, { role }) => {
      if (role === 'settings')
        return listOwnerAudioDevices().then((devices) => callOutputDevices(devices));
      if (!enablingCallOutput && !currentCallAudio.callOutputReady) return [];
      return listCallAudioDevices(true);
    });
    handle('capri:call-audio-command', (value, { role }) => voiceSkills.calls.command(value, role));
    handle('capri:audio-routing', (_value, { role }) => {
      if (role !== 'settings') throw Error('The selected audio device is unavailable.');
      if (!routingAvailable()) return audioRoutingState();
      return audioRoutingInventory();
    });
    handle('capri:audio-routing-device', (value, { role }) => setAudioRoute(value, role));
    handle('capri:audio-routing-microphone', async (deviceId, { role }) => {
      requireAudioSettings(role);
      const { devices } = await audioRoutingInventory();
      requireAudioSettings(role);
      changeAudioInput(deviceId);
      return audioRoutingState(devices);
    });
    handle('capri:call-camera', async (value, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible())
        throw new Error('Open Voice calls in Settings.');
      if (typeof value !== 'boolean') throw new TypeError('Invalid camera setting.');
      if (value) {
        skillSettings.require('capri.voice-calls');
        if (shuttingDown || sessionLocked || powerMonitor.getSystemIdleState(1) === 'locked')
          return callCamera.snapshot();
      }
      return callCamera.setEnabled(value);
    });
    handle(
      'capri:call-camera-frame',
      (bytes, { role }) =>
        role === 'companion' &&
        !sessionLocked &&
        !avatarDetach?.cameraSource() &&
        callCamera.frame(bytes),
    );
    handle('capri:call-camera-preview', (enabled, { role }) => {
      if (role !== 'settings' || typeof enabled !== 'boolean') return false;
      const visible = settingsHost?.window?.isVisible();
      setCameraPreview(enabled && visible === true && callCamera.platform === 'win32');
      return cameraPreview;
    });
    const publishCameraPreview = (bytes) => {
      if (
        !cameraPreview ||
        sessionLocked ||
        !settingsHost?.window?.isVisible() ||
        !(bytes instanceof Uint8Array) ||
        !bytes.byteLength ||
        bytes.byteLength > CAMERA_BACKGROUND_IMAGE_BYTES
      )
        return false;
      settingsHost.send({ type: 'call-camera.preview-frame', bytes });
      return true;
    };
    handle(
      'capri:call-camera-preview-frame',
      (bytes, { role }) =>
        role === 'companion' && !avatarDetach?.cameraSource() && publishCameraPreview(bytes),
    );
    handle('capri:call-camera-background', (value, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible())
        throw new Error('Open Voice calls in Settings.');
      skillSettings.require('capri.voice-calls');
      if (callCamera.platform !== 'win32' || shuttingDown || sessionLocked)
        return callCamera.snapshot();
      callCamera.background.set(value);
      return callCamera.publishState();
    });
    handle('capri:call-camera-background-image', (revision, { role }) =>
      role === 'companion' && !sessionLocked && (cameraPreview || callCamera.snapshot().enabled)
        ? callCamera.background.image(revision)
        : null,
    );
    ipcMain.handle(
      'capri:avatar-camera-frame',
      (event, bytes) =>
        !sessionLocked && avatarDetach?.ownsCameraSource(event) && callCamera.frame(bytes),
    );
    ipcMain.handle(
      'capri:avatar-camera-preview-frame',
      (event, bytes) => avatarDetach?.ownsCameraSource(event) && publishCameraPreview(bytes),
    );
    ipcMain.handle('capri:avatar-camera-background-image', (event, revision) =>
      !sessionLocked &&
      avatarDetach?.ownsCameraSource(event) &&
      (cameraPreview || callCamera.snapshot().enabled)
        ? callCamera.background.image(revision)
        : null,
    );
    handle('capri:call-audio-setup', async (action, { role }) => {
      if (role !== 'settings' || !settingsHost?.window?.isVisible())
        throw new Error('Open Voice calls in Settings.');
      if (!['state', 'connect', 'install', 'website', 'license'].includes(action))
        throw new Error('Invalid virtual microphone setup action.');
      if (action === 'state') return callSetup.snapshot();
      if (action === 'website' || action === 'license') {
        await shell.openExternal(
          action === 'website'
            ? 'https://vb-audio.com/Cable/'
            : 'https://vb-audio.com/Services/licensing.htm',
        );
        return callSetup.snapshot();
      }
      if (!skillEnabled('capri.voice-calls'))
        return callSetup.unavailable('skill-disabled', 'Call output is off.');
      if (!callAudioWindowAvailable() && routingAvailable()) restoreCompanion(false);
      if (!callAudioWindowAvailable())
        return callSetup.unavailable(
          'window-unavailable',
          'Call audio requires an open Capri window.',
        );
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
    handle('capri:speech-settings', (value, { role }) => voiceSkills.speech.configure(value, role));
    handle('capri:microphone-ready', media.microphone.confirm);
    handle('capri:microphone-listen', media.microphone.listen);
    handle('capri:microphone-stop', (value) => {
      const { id, keepModelWarm = false } =
        value && typeof value === 'object' ? value : { id: value };
      if (typeof keepModelWarm !== 'boolean' || (id !== undefined && typeof id !== 'string'))
        throw new Error('Invalid microphone stop mode');
      return media.microphone.stop({ id, keepModelWarm });
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
    handle('capri:voice-enabled', (value, { role }) => voiceSkills.output.setEnabled(value, role));
    handle('capri:voice-volume', changeVoiceVolume);
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
      const restartVoice =
        !externalTts.config.enabled &&
        !verification &&
        voiceBackendChanged(root, oldSpeech, resolved.speech);
      if (restartVoice) await stopVoiceForChange();
      if (behaviorChanged) {
        avatarClickReactions?.cancel();
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
      if (voiceVolume.value.volume === 0) throw new Error(VOICE_REQUIRED_MESSAGE);
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
    handle('capri:avatar-face', (state, { role }) => {
      const { expression, clip, startedAt } = state ?? {};
      if (
        role !== 'companion' ||
        !avatarDetach ||
        !['attached', 'detached'].includes(avatarDetach.phase) ||
        (expression !== null && !Object.hasOwn(faceFrames, expression)) ||
        (clip !== null && !Object.hasOwn(faceAnimations, clip)) ||
        !Number.isSafeInteger(startedAt)
      )
        return false;
      const face = { expression, clip, startedAt };
      if (avatarDetach.phase === 'attached') portraitFace = face;
      else avatarDetach.sendFace(face);
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
      if (backendState.phase === 'downloading-models') {
        backendController?.abort(
          Object.assign(new Error('Model download paused. Select Reconnect to resume.'), {
            code: 'CAPRI_MAC_MODEL_SETUP',
          }),
        );
        return backendState;
      }
      if (backendState.code === 'CAPRI_LOCAL_MODEL_SETUP_REQUIRED') {
        await settingsHost.open('models');
        return backendState;
      }
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
      if (pointer?.drag?.resize || resizeSurface?.active) return true;
      const first = !regions;
      const previous = windowFootprint;
      regions = validateRegions(value, window.getContentBounds());
      windowFootprint = regions.footprint;
      if (syncReplyWindowSize()) return true;
      if (replyResizeTimer) return true;
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
      const accepted = pointer.beginAvatar(
        value.point,
        sprite,
        maskFor(value.frameId),
        catalog.animated,
      );
      if (accepted) sampleAvatarDragWindows(pointer.avatarPress);
      return accepted;
    });
    handle('capri:avatar-drag-end', async (value) => {
      const click = value?.click === true;
      const press = pointer.avatarPress;
      if (
        !pointer.endAvatar(click ? value.point : undefined, (kind, point) => {
          if (kind === 'head' && skillEnabled('capri.avatar-interaction') && !avatarSleeping())
            emit({ type: 'avatar.headpat', point });
          recordAvatarClick(kind);
        })
      )
        return false;
      if (!click) {
        avatarRoaming.postpone(liveCompanionSettings(), 60000);
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
          if (!(await tryAvatarDock(target, stillAllowed, grab, press)))
            await launchAvatarTo(target, stillAllowed, grab);
        }
      }
      return true;
    });
    handle('capri:drag-start', (request) => {
      if (pointer.drag || resizeSurface?.active) return false;
      stopReplyWindowResize();
      clearTimeout(saveTimer);
      if (request === undefined) return pointer.beginWindow(undefined, true);
      const edge = request?.edge;
      if (!WINDOW_RESIZE_EDGES.includes(edge)) throw new Error('Invalid window edge');
      const { workArea } = companionDisplay();
      const minimum = layoutMinimum[activeWindowLayout];
      const content = window.getContentBounds();
      const origin = request.origin;
      const pressedAt =
        Number.isFinite(origin?.x) &&
        Number.isFinite(origin.y) &&
        pointInRect(origin, { ...content, x: 0, y: 0 })
          ? { x: content.x + origin.x, y: content.y + origin.y }
          : undefined;
      return pointer.beginWindow(
        {
          edge,
          workArea,
          minimum: {
            width: minimum.width + activeMonitorWidth,
            height: fittedReplyHeight(minimum.height, replyWindowSpace),
          },
        },
        // Moving the native host can interrupt Chromium's pointer-move events.
        // Sample the screen cursor during Windows resize until the grip releases.
        !resizeSurface,
        pressedAt,
      );
    });
    handle('capri:drag-frame', () => pointer.sampleWindow());
    handle('capri:drag-end', async (released) => {
      await pointer.endWindow(released === true);
      return true;
    });
  }

  function createWindow() {
    desktopTeleportMenu?.hide();
    stopReplyWindowResize();
    const settings = liveCompanionSettings();
    activeWindowLayout = settings.windowLayout;
    activeMonitorWidth = companionMonitorWidth(settings);
    activeWindowSize = preferredWindowSize(activeWindowLayout, activeMonitorWidth);
    replyWindowSpace = REPLY_SPACE;
    const size = activeWindowSize;
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
    ({ window, resizeSurface } = createSecureWindow(
      { BaseWindow, BrowserWindow, WebContentsView },
      {
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
        softwareRendering: windowGraphics.softwareRendering,
      },
    ));
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
      onDragSample: sampleAvatarDragWindows,
      onDragDrop: (point, offset, press) =>
        void teleportToCursor(point, offset, press).catch(() => {}),
      onRaised: () => avatarComposer?.raise(),
      onPointer: syncAvatarComposer,
      onCameraSourceChanged: syncCameraPreview,
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
        syncCameraPreview();
        syncAvatarComposer();
      },
      getEffects: () => {
        const settings = liveCompanionSettings();
        const {
          avatarDragTether,
          avatarDragTetherColor,
          avatarDragTetherIntensity,
          avatarDragTetherChaos,
          avatarDragTetherDeadZone,
        } = settings;
        return {
          ...teleportEffectSettings(settings),
          avatarDragTether: avatarDragTether && settings.detachedStyle !== 'dialogue',
          avatarDragTetherColor,
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
        if (!value) setCameraPreview(false);
        if (!value) microphoneMonitorGrant = undefined;
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
      onAvatarTether: (press, cursor, bounds, now) => {
        if (press && !pointInRect(cursor, bounds)) sampleAvatarDragWindows(press);
        avatarDetach.trackAttachedTether(press, cursor, bounds, now);
      },
      placeDrag: (bounds, cursor) => {
        if (!windowFootprint) return bounds;
        const area = screen.getDisplayNearestPoint(cursor).workArea;
        if (windowFootprint.width > area.width || windowFootprint.height > area.height)
          return bounds;
        return placeVisibleInWorkArea(bounds, area, bounds, windowFootprint);
      },
      applyWindowBounds: (bounds, drag) => {
        if (!drag.resize) {
          // Position-only moves can round the native content size at fractional scale.
          if (resizeSurface) window.setContentBounds(bounds);
          else window.setPosition(bounds.x, bounds.y, false);
        } else if (resizeSurface) resizeSurface.resize(drag.bounds, drag.resize, bounds);
        else window.setBounds(bounds, false);
      },
      onEnd: async (drag) => {
        if (drag.resize) {
          const target = window;
          const committed = !resizeSurface || (await resizeSurface.finish());
          if (!committed || window !== target || target.isDestroyed()) return;
          const { width, height } = window.getBounds();
          if (width !== drag.bounds.width || height !== drag.bounds.height) {
            const remembered = (saved.layoutSizes ??= {});
            const base = { ...remembered[activeWindowLayout] };
            if (width !== drag.bounds.width) base.width = width - activeMonitorWidth;
            if (height !== drag.bounds.height)
              base.height = height + REPLY_SPACE - replyWindowSpace;
            remembered[activeWindowLayout] = base;
            activeWindowSize = preferredWindowSize(activeWindowLayout, activeMonitorWidth);
          }
        }
        if (!syncReplyWindowSize() && !drag.resize) clampWindow({ fitPreferredSize: true });
        if (drag.resize) {
          compactPlacement = undefined;
        } else if (drag.bounds.x !== drag.last.x || drag.bounds.y !== drag.last.y) {
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
      void callCamera.stop();
      if (quitting || shuttingDown || !window || window.isDestroyed()) return;
      const reveal = window.isVisible() && !window.isMinimized();
      console.warn('Companion renderer stopped:', details.reason, details.exitCode);
      rendererFailed = true;
      rendererReady = false;
      portraitFace = undefined;
      attachmentDrafts.clear();
      resetCallAudio();
      draftBusy = false;
      playbackBusy = false;
      pendingFollowUp = null;
      voicePreviewRequest = null;
      regions = null;
      pointer?.cancel();
      resizeSurface?.cancel();
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
    window.on('move', () => pointer.invalidateHitTest());
    window.on('resize', () => pointer.invalidateHitTest());
    window.on('show', () => pointer.start());
    window.on('moved', () => {
      avatarDetach.checkDisplay();
      if (pointer.drag || resizeSurface?.active) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveWindow, 350);
    });
    window.on('blur', () => {
      if (pointer.drag) pointer.endWindow();
      pointer.endAvatar();
    });
    window.on('hide', () => {
      pointer.stop();
      resizeSurface?.cancel();
    });
    const readyToShow = () => {
      if (!verification) showCompanion();
      if (!verification) publishLaunchReceipt(root, process.env.CAPRI_LAUNCH_NONCE);
      if (automaticUpdatesEnabled) void updates.startAutomaticChecks();
      console.info('Capri companion window ready.', JSON.stringify(window.getBounds()));
    };
    if (resizeSurface) window.webContents.once('did-finish-load', readyToShow);
    else window.once('ready-to-show', readyToShow);
    window.webContents.on('did-stop-loading', restoreMusicListening);
    window.webContents.loadURL(rendererUrl).catch((error) => {
      if (rendererFailed || nextRendererRecovery) return;
      console.error('Could not load companion:', error.message);
      app.quit();
    });

    activeMask = maskFor(avatar.currentId);

    tray = new Tray(
      process.platform === 'darwin'
        ? nativeImage.createFromPath(applicationIcon).resize({ width: 18, height: 18 })
        : process.platform === 'linux'
          ? applicationIcon
          : path.join(resourceRoot, 'assets/default/app.ico'),
    );
    tray.setToolTip(uiText('Capri desktop companion', languages.value.interface));
    tray.on('click', () => restoreCompanion());
    tray.on('balloon-click', () => {
      if (!updateNoticeTag || shuttingDown || quitting) return;
      restoreCompanion();
      void settingsHost.open('updates').catch(console.error);
    });
    tray.on('right-click', () => {
      openMenu(true).catch(() => {});
    });
    if (!verification)
      globalShortcut.register('CommandOrControl+Shift+Space', () => {
        if (window.isVisible() && window.isFocused()) hideCompanionToTray();
        else restoreCompanion();
      });
    screen.on('display-removed', () => {
      wildPranks.pause();
      wildInputPranks.pause();
      capturePolicy.displayTopologyChanged();
      pointer.cancel();
      resizeSurface?.cancel();
      avatarDetach.reset();
      clampWindow({ fitPreferredSize: true });
    });
    screen.on('display-added', () => capturePolicy.displayTopologyChanged());
    screen.on('display-metrics-changed', (_event, _display, metrics) => {
      if (metrics?.some((metric) => ['bounds', 'scaleFactor', 'rotation'].includes(metric))) {
        wildPranks.pause();
        wildInputPranks.pause();
        capturePolicy.displayTopologyChanged();
        pointer.cancel();
        resizeSurface?.cancel();
      }
      avatarDetach.reset();
      if (!pointer.drag) clampWindow({ fitPreferredSize: true });
    });
  }

  if (hasSingleInstanceLock) {
    app.on('second-instance', () => restoreCompanion());
    if (process.platform === 'darwin') {
      app.on('activate', () => {
        if (!window || window.isDestroyed() || quitting || shuttingDown || sessionLocked) return;
        if (focusMode || avatarOnly || !window.isVisible() || window.isMinimized())
          restoreCompanion();
      });
    }
    app.on('before-quit', (event) => {
      if (quitting) return;
      wildPranks.pause();
      wildInputPranks.pause();
      void callCamera.stop();
      chess?.close();
      void chessDiagnostics.flush();
      nativeNpu?.stop();
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
      stopKeepWarm?.();
      externalTts.close();
      chatgpt.close();
      void localModelLoad.close();
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
      screenFrames.dispose();
      initiative.close();
      observer.stop();
      metadataRpc.stop();
      quitting = true;
      settingsHost?.destroy();
      chat.cancel();
      voice.close();
      void breezeVoice.cancel();
      microphone.close();
      requestRouter.close();
      coding.setMonitoring(false);
      saveWindow();
      pointer?.stop();
      clearInterval(controlTimer);
      clearTimeout(saveTimer);
      saveAvatarLayout();
      saveDimming();
      globalShortcut.unregisterAll();
      tray?.destroy();
      void skills.close();
    });
    app.on('window-all-closed', () => app.quit());
    app
      .whenReady()
      .then(async () => {
        if (!verification && skillEnabled('capri.brain')) brain.start();
        await userTools
          .refresh()
          .catch(() => console.warn('User tools could not be listed. Open Settings to retry.'));
        const micArmed = () =>
          asrAllowed &&
          Boolean(microphone.capture) &&
          ['arming', 'listening'].includes(microphone.status);
        const microphoneMonitorPermission = (contents, permission, origin, details, request) => {
          const view = settingsHost?.window;
          const grant = microphoneMonitorGrant;
          if (
            !grant ||
            performance.now() >= grant.expiresAt ||
            sessionLocked ||
            shuttingDown ||
            !view?.isVisible() ||
            view.webContents.mainFrame !== grant.frame ||
            !audioPermission({
              armed: true,
              owner: view.webContents,
              contents,
              permission,
              origin,
              details,
              request,
              url: settingsUrl,
            })
          )
            return false;
          if (request) microphoneMonitorGrant = undefined;
          return true;
        };
        const displayPermission = (contents, permission, origin, details) =>
          permission === 'display-capture' &&
          (Boolean(capturePolicy.capture) || systemAudio.armed() || musicAudio.armed()) &&
          contents === window?.webContents &&
          contents.getURL() === rendererUrl &&
          details?.isMainFrame !== false &&
          ['capri://desktop', 'capri://desktop/'].includes(origin);
        const callSpeakerPermission = (contents, permission, origin, details) =>
          speakerSelectionAllowed({
            active:
              routingAvailable() &&
              (listingCallOutputs > 0 ||
                Boolean(audioRoutes.value.routes.speaker) ||
                (enablingCallOutput && callAudioAvailable())),
            owner: window?.webContents,
            contents,
            permission,
            origin,
            details,
            url: rendererUrl,
          }) ||
          speakerSelectionAllowed({
            active:
              routingAvailable() &&
              Boolean(audioRoutes.value.routes.speaker) &&
              settingsHost?.window?.isVisible(),
            owner: settingsHost?.window?.webContents,
            contents,
            permission,
            origin,
            details,
            url: settingsUrl,
          });
        session.defaultSession.setPermissionRequestHandler(
          (contents, permission, respond, details) =>
            respond(
              displayPermission(contents, permission, details.securityOrigin, details) ||
                callSpeakerPermission(contents, permission, details.securityOrigin, details) ||
                microphoneMonitorPermission(
                  contents,
                  permission,
                  details.securityOrigin,
                  details,
                  true,
                ) ||
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
            microphoneMonitorPermission(contents, permission, origin, details, false) ||
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
        if (!skillEnabled('capri.timers')) companionActions.time.suspend();
        for (const id of TURN_MODE_SKILLS)
          if (skillSettings.turnMode(id)) callSkill(id, 'setMode', true);
        installIpc();
        const preload = consumeFirstLaunchPreload(state);
        createWindow();
        coding.setMonitoring(skillEnabled('capri.coding'));
        if (inferenceApi.config.setupRequired)
          window.once('ready-to-show', () => {
            if (!shuttingDown && !focusMode)
              void settingsHost.open('api', 'api-key').catch(console.error);
          });
        else if (settings.modelSetupRequired && !rt.remote.enabled && !rt.nativeNpu)
          window.once('ready-to-show', () => {
            if (!shuttingDown) void settingsHost.open('models', 'hf-query').catch(console.error);
          });
        if (skillEnabled('capri.discord-presence')) callSkill('capri.discord-presence', 'start');
        window.on('minimize', resetCallAudio);
        powerMonitor.on('unlock-screen', () => {
          sessionLocked = false;
          if (cameraPreview) syncCameraPreview();
          restoreMusicListening();
          void reminders.pump();
        });
        powerMonitor.on('lock-screen', () => {
          wildPranks.pause();
          wildInputPranks.pause();
          pendingMemoryDecision?.abort();
          recordingIndicator?.hide();
          userTools.cancel();
          workflows?.cancel();
          privateMemory.lock();
          minimizedChip?.hide();
          sessionLocked = true;
          if (cameraPreview) syncCameraPreview();
          void callCamera.stop();
          chess?.stop();
          stopMusicListening();
          void computerControl.stop();
          stopMicrophoneMonitor();
          avatarClickReactions.cancel();
          avatarDetach.reset();
          discardScreens('screen-locked');
          cancelVisual();
        });
        powerMonitor.on('suspend', () => {
          wildPranks.pause();
          wildInputPranks.pause();
          musicSuspended = true;
          void callCamera.stop();
          chess?.stop();
          stopMicrophoneMonitor();
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
        powerMonitor.on('resume', () => {
          musicSuspended = false;
          restoreMusicListening();
        });
        window.on('show', () => {
          void syncInitiative().catch((error) => {
            if (error.name !== 'AbortError')
              emit({ type: 'initiative.error', message: 'App awareness could not start.' });
          });
        });
        controlTimer = setInterval(() => {
          void refreshModelMemory().catch(() => {});
          localModelLoad.synchronize(
            !verification &&
              !shuttingDown &&
              !rt.remote.enabled &&
              Boolean(
                localInferenceTasks ||
                  wildInputPranks.running ||
                  chat.active ||
                  initiative.active ||
                  avatarClickReactions?.active ||
                  backendState.phase === 'starting',
              ),
          );
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
          void updateIdleCursor().catch(() => {});
          void updateDesktopAvatar().catch(() => {});
          updateWildPranks();
          updateWildInputPranks();
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
            ? () => prepare('recognition', () => microphone.worker.send({ type: 'warm-model' }))
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
