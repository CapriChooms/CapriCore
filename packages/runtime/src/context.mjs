import { randomBytes, randomUUID } from 'node:crypto';
import { initializeOwnerMemory } from './owner-memory.mjs';
import { applyInferenceProfile } from './config/inference-profile.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { root, paths } from './host/paths.mjs';
import { settings, generationParams } from './config/settings.mjs';
import { writeJsonAtomic } from './atomic-json.mjs';
import { readCommunicationStyle, communicationInstruction } from './communication.mjs';
import {
  initializePersonality,
  readPersonality,
  PERSONALITY_PROMPT_HEADER,
} from './personality.mjs';
import { applyLocalContextPolicy, ensureManagedContext } from './config/context-policy.mjs';
import { localRunnerOptions } from './providers/runner-policy.mjs';

export function runtime({
  stateDir = path.join(paths.data, 'openclaw'),
  workspace = path.join(paths.data, 'workspace'),
  gatewayPort = settings.gatewayPort,
  logPrefix = 'capri',
} = {}) {
  if (
    !Number.isInteger(gatewayPort) ||
    gatewayPort < 1024 ||
    gatewayPort > 65535 ||
    !/^[a-z0-9-]{1,64}$/i.test(logPrefix)
  )
    throw new Error('Invalid runtime service identity');
  return {
    stateDir,
    workspace,
    gatewayPort,
    logPrefix,
    configPath: path.join(stateDir, 'openclaw.json'),
    tokenPath: path.join(stateDir, 'gateway-token'),
    localEngine: 'llama.cpp',
    ollamaUrl: `http://127.0.0.1:${settings.ollamaPort}`,
    gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
  };
}

export function createGatewayConfiguration(rt, config = settings) {
  const model = `ollama/${config.model}`;
  const generation = {
    ...generationParams(config.generation),
    ...localRunnerOptions(config),
  };
  const result = {
    // OpenClaw's raw logs can contain user/tool content. Capri records bounded
    // service lifecycle/error codes separately; no raw prompt traces are enabled.
    logging: { level: 'silent', consoleLevel: 'silent', audit: { enabled: false } },
    diagnostics: {
      enabled: false,
      cacheTrace: { enabled: false },
      otel: { enabled: false, captureContent: false },
    },
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: rt.gatewayPort,
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      controlUi: { enabled: true, sessionObserver: false },
      http: { endpoints: { chatCompletions: { enabled: true } } },
    },
    agents: {
      defaults: {
        workspace: rt.workspace,
        skipBootstrap: true,
        userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        model: { primary: model, fallbacks: [] },
        // Capri has no Activity recap UI. Avoid a second Qwen request competing
        // with each foreground answer and replacing its prompt cache.
        utilityModel: '',
        imageModel: model,
        thinkingDefault: 'off',
        maxConcurrent: 1,
        timeoutSeconds: 180,
        skills: [],
      },
      entries: {
        [config.agentId]: {
          name: config.name,
          workspace: rt.workspace,
          identity: { name: config.name },
          tools: { loopDetection: { enabled: true } },
          thinkingDefault: 'off',
        },
      },
    },
    models: {
      providers: {
        ollama: {
          baseUrl: rt.ollamaUrl,
          api: 'ollama',
          apiKey: 'ollama-local',
          timeoutSeconds: 180,
          models: [
            {
              id: config.model,
              name: config.model,
              input:
                !config.modelCapabilities || config.modelCapabilities.includes('vision')
                  ? ['text', 'image']
                  : ['text'],
              reasoning: !config.modelCapabilities || config.modelCapabilities.includes('thinking'),
              ...(config.modelCapabilities && !config.modelCapabilities.includes('tools')
                ? { compat: { supportsTools: false } }
                : {}),
              contextWindow: config.contextTokens,
              contextTokens: config.contextTokens,
              maxTokens: 8192,
              params: {
                num_ctx: config.contextTokens,
                keep_alive: config.keepAlive,
                ...generation,
              },
            },
          ],
        },
      },
    },
    memory: {
      search: {
        enabled: true,
        provider: 'ollama',
        model: config.embeddingModel,
        fallback: 'none',
        remote: { baseUrl: rt.ollamaUrl, apiKey: 'ollama-local' },
        rememberAcrossConversations: true,
      },
    },
    session: { dmScope: 'main', notifyOnCreate: false },
    tools: {
      allow: [
        'read',
        'write',
        'edit',
        'memory_search',
        'memory_get',
        'session_status',
        'filesystem_control',
        'application_control',
        'time_control',
        'settings_control',
        'desktop_control',
        'workflow_control',
        ...Array.from(
          { length: 20 },
          (_, index) => 'capri_tool_' + String(index + 1).padStart(2, '0'),
        ),
      ],
      fs: { workspaceOnly: true },
      toolSearch: false,
    },
    plugins: {
      load: {
        paths: ['filesystem', 'desktop-actions', 'perception', 'companion-tools'].map((name) =>
          path.join(root, 'integrations', name),
        ),
      },
      entries: {
        'capri-filesystem': { enabled: true, config: {} },
        'capri-applications': { enabled: true, config: {} },
        'capri-perception': { enabled: true, config: { sessionKey: config.sessionKey } },
        'capri-companion-tools': { enabled: true, config: {} },
      },
    },
    update: { checkOnStart: false },
  };
  applyLocalContextPolicy(result, config.contextTokens);
  return applyInferenceProfile(result, rt, config);
}

/** Explicit profile changes update only Capri's managed inference fields. */
export function applyModelProfile(existing, rt, config) {
  const next = relocateManagedPaths(existing, rt),
    desired = createGatewayConfiguration(rt, config);
  next.agents ??= {};
  next.agents.defaults ??= {};
  const defaults = next.agents.defaults,
    model = `ollama/${config.model}`;
  defaults.model =
    typeof defaults.model === 'object' && defaults.model
      ? { ...defaults.model, primary: model }
      : { primary: model, fallbacks: [] };
  if (!defaults.utilityModel || /^ollama\/capri-qwen3[.]5:/.test(defaults.utilityModel))
    defaults.utilityModel = '';
  defaults.imageModel = model;
  defaults.thinkingDefault = 'off';
  const entry = next.agents.entries?.[config.agentId];
  if (entry) {
    entry.thinkingDefault = 'off';
    entry.tools ??= {};
    entry.tools.loopDetection ??= { enabled: true };
  }
  if (entry?.model)
    entry.model = typeof entry.model === 'string' ? model : { ...entry.model, primary: model };
  next.models ??= {};
  next.models.providers ??= {};
  const previous = next.models.providers.ollama ?? {},
    target = desired.models.providers.ollama;
  next.models.providers.ollama = {
    ...target,
    ...previous,
    baseUrl: target.baseUrl,
    models: [
      ...(previous.models ?? []).filter(
        (item) => !item.id?.startsWith('capri-qwen3.5:') && item.id !== config.model,
      ),
      ...target.models,
    ],
  };
  next.gateway ??= {};
  next.gateway.port = config.gatewayPort;
  applyLocalContextPolicy(next, config.contextTokens);
  return next;
}

export function relocateManagedPaths(existing, rt) {
  const next = structuredClone(existing),
    workspace = next.agents?.defaults?.workspace;
  if (
    typeof workspace !== 'string' ||
    !path.isAbsolute(workspace) ||
    !path.normalize(workspace).endsWith(path.join(path.sep, 'data', 'workspace'))
  )
    return next;
  const previousRoot = path.resolve(workspace, '../..'),
    plugins = next.plugins?.load?.paths ?? [];
  const owned = ['filesystem', 'desktop-actions', 'perception', 'spotify', 'companion-tools'];
  const normalize = (value) =>
    process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
  const oldPaths = owned.map((name) => path.join(previousRoot, 'integrations', name));
  if (
    normalize(previousRoot) === normalize(root) ||
    oldPaths.filter((old) =>
      plugins.some((value) => typeof value === 'string' && normalize(value) === normalize(old)),
    ).length < 2
  )
    return next;
  next.agents.defaults.workspace = rt.workspace;
  for (const entry of Object.values(next.agents.entries ?? {}))
    if (entry.workspace === workspace) entry.workspace = rt.workspace;
  next.plugins.load.paths = plugins.map((value) => {
    const index = oldPaths.findIndex(
      (old) => typeof value === 'string' && normalize(value) === normalize(old),
    );
    return index < 0 ? value : path.join(root, 'integrations', owned[index]);
  });
  return next;
}

export function initialize(rt = runtime()) {
  for (const directory of [
    rt.stateDir,
    rt.workspace,
    path.join(rt.workspace, 'memory'),
    path.join(paths.data, 'models'),
    path.join(paths.data, 'run'),
    paths.logs,
    path.join(paths.cache, 'tmp'),
  ])
    mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(rt.tokenPath, randomBytes(32).toString('hex') + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  initializePersonality(rt.workspace);
  // New installations never inherit development-machine context. Repair only
  // exact known shipped prefixes in managed installs; preserve user additions.
  initializeOwnerMemory(rt.workspace, {
    repairShippedDefaults: existsSync(path.join(root, '.capri-install.json')),
  });
  if (!existsSync(rt.configPath)) writeJsonAtomic(rt.configPath, createGatewayConfiguration(rt));
  else {
    const previous = JSON.parse(readFileSync(rt.configPath, 'utf8')),
      next = relocateManagedPaths(previous, rt);
    next.logging = {
      ...next.logging,
      level: 'silent',
      consoleLevel: 'silent',
      audit: { enabled: false },
    };
    next.diagnostics = {
      enabled: false,
      cacheTrace: { enabled: false },
      otel: { enabled: false, captureContent: false },
    };
    next.agents ??= {};
    next.agents.defaults ??= {};
    next.agents.defaults.skipBootstrap = true;
    // Add only Capri's reviewed local plugin; preserve all existing owner settings.
    const companionPlugin = path.join(root, 'integrations/companion-tools');
    next.plugins ??= {};
    next.plugins.load ??= {};
    next.plugins.load.paths ??= [];
    if (!next.plugins.load.paths.includes(companionPlugin))
      next.plugins.load.paths.push(companionPlugin);
    next.plugins.entries ??= {};
    next.plugins.entries['capri-companion-tools'] ??= { enabled: true, config: {} };
    if (Array.isArray(next.tools?.allow))
      for (const tool of [
        'time_control',
        'settings_control',
        'desktop_control',
        'workflow_control',
        ...Array.from(
          { length: 20 },
          (_, index) => 'capri_tool_' + String(index + 1).padStart(2, '0'),
        ),
      ])
        if (!next.tools.allow.includes(tool)) next.tools.allow.push(tool);
    const preserveApiSelection =
      rt.remote === undefined &&
      String(next.agents.defaults.model?.primary).startsWith('capri-api/');
    if (
      !preserveApiSelection &&
      ensureManagedContext(next, settings.model, settings.contextTokens)
    ) {
      const backups = path.join(paths.data, 'config-backups');
      mkdirSync(backups, { recursive: true });
      copyFileSync(rt.configPath, path.join(backups, `context-window-${randomUUID()}.json`));
    }
    applyInferenceProfile(next, rt, settings);
    if (JSON.stringify(previous) !== JSON.stringify(next)) writeJsonAtomic(rt.configPath, next);
  }
  return rt;
}
export function headers(rt = runtime()) {
  return {
    authorization: `Bearer ${readFileSync(rt.tokenPath, 'utf8').trim()}`,
    'content-type': 'application/json',
    'x-openclaw-session-key': settings.sessionKey,
  };
}
export function personaPrompt(rt = runtime(), { personality, style } = {}) {
  // Older installations retain their editable profile. Neutralize the exact
  // factory wording on the way to the model, including for read-only profiles.
  const promptPersonality = (personality ?? readPersonality(rt.workspace)).replace(
    /^You are Capri, a fictional personal companion inspired by Cyberpunk: Edgerunners 2, living in the owner's Windows desktop\. Speak in the first person and in the conversation language selected by the interface\. Be present in the conversation: respond as Capri, rather than explaining how somebody could portray her\.(?=\r?$)/m,
    "You are Capri, a fictional personal companion inspired by Cyberpunk: Edgerunners 2, living in the owner's Windows desktop. Speak in the first person. Be present in the conversation: respond as Capri, rather than explaining how somebody could portray her.",
  );
  return (
    PERSONALITY_PROMPT_HEADER +
    '\n' +
    promptPersonality +
    '\n\n' +
    communicationInstruction(style ?? readCommunicationStyle(rt.workspace))
  );
}
