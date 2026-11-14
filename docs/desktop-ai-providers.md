# Installed AI apps and official model connections

Open **Settings → API connections → Connect your ChatGPT plan** to sign in directly.
The optional **AI apps and ChatGPT plan** discovery section stays collapsed.
Detection and authorization are separate steps. Discovering an app does not authorize Capri to
use its account, read its conversations, or run its commands.

| Detected app or service     | Supported connection                                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT or Codex            | **Continue with ChatGPT** authorizes Capri separately using the published Sign in with ChatGPT flow. Eligible accounts can allow ChatGPT plan usage. The desktop app itself is not required.                                                                                      |
| Claude or Claude Code       | Configure a Claude API connection with your own API key and model ID. An installed app's subscription/OAuth session is not imported. Use a workspace-scoped API key for the preset; keys requiring an additional workspace header need a provider configuration that supplies it. |
| Gemini or Gemini CLI        | Configure the official Google OpenAI-compatible API with your own Gemini API key. CLI OAuth credentials are not imported.                                                                                                                                                         |
| LM Studio, Ollama, Lemonade | Enable that app's local API server, scan, choose an enumerated model, and add its connection. Then use the existing **Use connection** action to switch Capri.                                                                                                                    |

The default scan is on demand when expanding this section, with a five-minute
cache and a refresh button. It reads Windows application metadata and checks
fixed command filenames in PATH, without executing the detected programs. It
also requests model lists at known loopback endpoints: LM Studio on port 1234,
Ollama on 11434, and Lemonade on 13305. Requests have short deadlines and bounded
response sizes. No prompts, API keys, model-loading commands or downloads are
sent during discovery. Nonstandard ports, portable apps outside PATH and
password-protected servers may require manual API setup. Installation alone
never produces a green connection-test result.

## ChatGPT plan connection

1. Choose **Continue with ChatGPT**. Capri pauses screen observation before
   opening the system browser. Finish sign-in and grant plan usage if your account
   is eligible. Capri uses its own registration, not another app's credentials.
2. Capri automatically loads the selected account's available models after sign-in,
   account switching and reopening Settings. Choose a model from the list.
   **Refresh models** retries a failed or empty list. **Test connection**
   sends only a fixed short sample. Listed models are not a guarantee of account
   entitlement; a completed test verifies inference for that request.
3. **Use connection** saves the selected account/model pair and opens the normal
   provider-switch/restart confirmation in one step. Existing pairs are reused.
   Signing in alone does not switch Capri or send conversation context. The normal
   API-mode choice to skip the local LLM remains in effect.
4. **Manage usage** opens ChatGPT Settings → Usage. Shared plan limits and account
   policies apply. Connection failure never silently switches to a paid API key.
5. Add another account or select a saved registration without changing Capri's
   active inference connection. Each model connection remains bound to its own
   account. Switch Capri away from an active account before signing it out.

This is a local implementation of the documented public OAuth protocol, using
state, nonce, S256 PKCE, an IPv4 loopback callback, RS256 ID-token verification
against OpenAI's fixed JWKS, and account/audience/issuer validation. It does not
vendor the separately licensed Sign in with ChatGPT DevKit. Account identity,
registration and tokens are encrypted together with Windows account-bound DPAPI
under `data/secrets/chatgpt-plan.json`. Rotating token refreshes are serialized;
issued registrations and the opaque installation host ID survive restarts and
sign-out. Tokens are never returned to the renderer, put into child processes,
read from browser or other AI-app profiles, or logged. Signing out attempts remote
revocation and clears local tokens; an unconfirmed revocation produces a warning
and a link to account settings. Ordinary conversation-history encryption remains
a separate feature.

Inference uses only `https://api.openai.com/v1/responses`, with `store: false`
and `stream: true`. Capri adapts text, images and function calls to its existing
gateway. Only Capri's already-authorized functions are exposed in a namespace;
no separate shell agent, hosted computer-use tool, or hidden CLI process is
started. Partial text streams immediately, while success requires
`response.completed`. Failed, incomplete and usage-limited responses retain a
failure state. Stop/cancel aborts the upstream request. All existing computer,
file, screenshot, call and microphone permissions still apply.

The selected provider receives the conversation context and tool results needed
for your request. Images require enabled vision and a model that supports them.
Your ChatGPT desktop conversation history is not imported. Account eligibility,
regional availability, supported models and plan limits are controlled by OpenAI.
No paid account credential is included in automated tests.

Protocol references: [OpenAI overview](https://developers.openai.com/siwc/token-sharing-open-source),
[registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[account sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[Claude compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk),
[Claude authentication rules](https://code.claude.com/docs/en/legal-and-compliance),
[Gemini authentication rules](https://geminicli.com/docs/resources/tos-privacy/),
[LM Studio API](https://lmstudio.ai/docs/developer/openai-compat),
[Lemonade API](https://lemonade-server.ai/docs/api/openai/).

Verification: `node --test tests/chatgpt-plan.test.mjs tests/desktop-ai-discovery.test.mjs`
uses generated signing keys and synthetic provider responses, including an actual
loopback OAuth callback. `node tools/verify/verify-desktop-ai-providers.mjs` tests
the real Electron settings with explicitly synthetic account and discovery IPC.
Live account authorization and entitlement require the account holder's consent.
