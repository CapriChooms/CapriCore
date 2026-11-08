# Optional external language models (BETA)

Open **Settings → External AI provider → Add an API connection**. Select a
preset or enter a Chat Completions base URL under **Custom**. Save the profile,
test the connection, then choose **Use connection** to restart Capri with it.

For ProxyAPI, use a ProxyAPI key and a full model ID such as
`openai/gpt-5-mini`. The preset uses `https://api.proxyapi.ru/v1`.
See the [ProxyAPI model catalog](https://proxyapi.ru/docs/models).
Capri uses the Windows proxy route when one is configured for ProxyAPI. If
the connection times out before HTTPS starts, check how the VPN or proxy routes
`api.proxyapi.ru`.

Enable tool calls and images only if the selected model supports them.

### Google Gemini

Choose **Google Gemini**, or **Custom** on an older build, with this base URL:
`https://generativelanguage.googleapis.com/v1beta/openai/`.
Use a Gemini API key copied from Google AI Studio and a current model ID available
to that same Google project. Model names and availability change independently of
Capri; copy the exact ID from the provider's current catalog. Save the connection,
test it, then choose **Use connection**.
See Google's [OpenAI compatibility guide](https://ai.google.dev/gemini-api/docs/openai).

The `gemini-1.5-pro` model in older examples has been retired. An unavailable
model produces a provider error such as HTTP 404, independently of key validation;
see the [Google model retirement table](https://firebase.google.com/docs/ai-logic/faq-and-troubleshooting).

The updated key field accepts up to 4,096 characters without requiring a vendor
prefix. It removes copied whitespace and invisible formatting at the outer edges,
plus one surrounding pair of double quotes. Spaces, line breaks or other formatting
inside the key are rejected with an actionable message. Paste the key itself,
without an authorization header or a JSON credentials file. A local **Enter a valid
API key** message happens before any request to Google and does not establish
whether the provider accepts the credential. No real account key is needed for
Capri's development tests.

### Lemonade on the same PC

Start Lemonade and load the model. Choose **Lemonade (local)** for the default
`http://127.0.0.1:13305/api/v1` address and `Phi-4-mini-instruct-NPU` preset.
If your server lists a different ID in `/api/v1/models`, copy that exact ID.
Leave the key blank unless Lemonade was configured to require one. Capri treats
this Phi model as text-only and tests a streamed reply using sample dialogue.
Set Lemonade's model context to 8,192 tokens or higher and match the configured
size in Capri.

Custom plain-HTTP connections are limited to this PC's loopback addresses.
Remote API connections still require HTTPS and a key. See the
[Lemonade API reference](https://github.com/lemonade-sdk/lemonade/blob/main/docs/api/openai.md).

This replaces local **language-model inference**, including enabled vision and
initiative. It does not replace speech recognition, voice synthesis or the local
CPU embedding index. Downloaded language models stay on disk; they are not loaded
for API chat by default. Open **Settings → Language model → Use local model**, or
use the **Local/API** selector in the main header, to switch back. Keep enough RAM/VRAM
for any local voice you enable.

The provider receives conversation context, personality, relevant memories and
tool results. A computer-control task may therefore share inspected application
labels or requested file content. Selected screen images leave the PC when vision
is enabled and used. Full-computer permission does not enable API sharing or
screen observation by itself. Provider pricing, quotas, retention and privacy
terms apply; Capri does not include an account, credit or a universal free model.

The real API key is encrypted with Electron safeStorage/Windows DPAPI for the
current Windows account under `data/secrets/inference-api-profiles.json`. It is never
returned by status IPC, embedded in OpenClaw configuration, placed in child
arguments/environment variables, or included in diagnostic exports. Do not share
your entire private data directory. DPAPI protects stored data, not a compromised
Windows account or a program with access to your process memory.
Changing the provider to a different HTTPS origin requires a new key. The saved
key cannot be reused by a different origin while Capri is restarting.

A loopback-only authenticated proxy adds the real authorization header in the
desktop main process. OpenClaw uses its separate random, per-process proxy token.
Remote requests reject redirects, use bounded sizes/timeouts and return generic
errors without provider error bodies. Screens are interpreted without action
tools; transient PNGs are not persisted in conversation history. Cancellation
aborts the upstream request. An offline provider, missing credits, incompatible
tool/JSON support or an invalid model can still prevent a reply.

Protocol, SSE/tool round-trip, cancellation and secret-redaction tests use isolated
fixtures. A paid live-provider account is not part of release testing. No real
owner API key is required for development tests.
