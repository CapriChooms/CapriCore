import { root, runtime, settings } from '../../packages/runtime/src/index.mjs';
import { saveSpotifyAccess } from '../../integrations/spotify/configuration.mjs';

saveSpotifyAccess({ root, rt: runtime(), agentId: settings.agentId, enabled: true });
console.log(
  'Spotify plugin configured for Capri. Existing tools and shared conversation were preserved.',
);
