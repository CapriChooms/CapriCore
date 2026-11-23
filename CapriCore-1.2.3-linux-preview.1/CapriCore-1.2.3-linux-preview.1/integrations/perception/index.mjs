import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { VisualContextService } from './context-service.mjs';
import {
  resolveSessionTranscriptIdentity,
  appendSessionTranscriptMessagesByIdentity,
  publishSessionTranscriptUpdateByIdentity,
} from 'openclaw/plugin-sdk/session-transcript-runtime';

export default {
  id: 'capri-perception',
  name: 'Capri Visual Context',
  register(api) {
    const source = api.source?.startsWith('file:')
        ? fileURLToPath(api.source)
        : (api.source ?? fileURLToPath(import.meta.url)),
      root = path.resolve(path.dirname(source), '../..');
    const isolated = api.pluginConfig?.stateDirectory
      ? path.resolve(root, api.pluginConfig.stateDirectory)
      : null;
    if (isolated && !isolated.startsWith(path.join(root, '.runtime') + path.sep))
      throw new Error('Visual test state must stay in .runtime');
    const directory = isolated ?? path.join(root, 'data/perception');
    mkdirSync(directory, { recursive: true });
    const sessionKey = api.pluginConfig?.sessionKey ?? 'agent:capri:main';
    if (!/^agent:capri:[a-z0-9-]{1,100}$/.test(sessionKey))
      throw new Error('Invalid Capri visual context session');
    const service = new VisualContextService({
      sessionKey,
      database: path.join(directory, 'commits.sqlite'),
      resolve: (key, target) =>
        resolveSessionTranscriptIdentity({
          ...target,
          agentId: 'capri',
          sessionKey: key,
          config: api.config,
        }),
      append: (params) =>
        appendSessionTranscriptMessagesByIdentity({ ...params, config: api.config }),
      publish: (target) => publishSessionTranscriptUpdateByIdentity({ ...target, update: {} }),
    });
    api.registerGatewayMethod(
      'capri.visual.commit',
      async ({ params, respond, signal, sessionMutationAuthorization, sessionAccessAuthority }) => {
        let lease;
        try {
          if (
            !sessionMutationAuthorization ||
            !sessionAccessAuthority ||
            sessionAccessAuthority.sandboxRequired
          )
            throw new Error('Visual context requires current owner session authority');
          lease = sessionAccessAuthority.retain();
          const result = await service.commit(params, {
            signal: signal ? AbortSignal.any([signal, lease.signal]) : lease.signal,
            target: sessionAccessAuthority.target,
            assertCurrent: () => {
              lease.assertCurrent();
              sessionMutationAuthorization.assertCurrent();
              sessionMutationAuthorization.assertTargetCurrent({ sessionKey, agentId: 'capri' });
            },
          });
          respond(true, result);
        } catch (error) {
          respond(false, undefined, { code: 'INVALID_REQUEST', message: error.message });
        } finally {
          lease?.release();
        }
      },
      {
        scope: 'operator.write',
        profileAccess: 'required',
        sessionAccess: { mode: 'write', allowOwnSessionScope: true },
      },
    );
    api.registerService({
      id: 'capri-perception-lifecycle',
      start: () => {},
      stop: () => service.close(),
    });
  },
};
