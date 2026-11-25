# OpenClaw compatibility fixes

These fixes target the version in `patches.json`. The root `npm ci` postinstall applies them, and Gateway startup checks them again. The manifest records the exact edits and SHA-256 values before and after patching. A version or hash mismatch stops preparation. Recheck each edit when upgrading OpenClaw.

The local `capri-qwen3.5:9b` alias uses the upstream GGUF weights and vision projector with the GGUF's native chat template. The installed llama-server enforces `LLAMA_ARG_THINK_BUDGET`, configured by `reasoningBudget` in `config/core.json`. This closes the thinking block at the budget and continues generation; it does not truncate the visible answer.

## Delivery after tools

The planning pass keeps the normal conversational sampling and bounded thinking. After a tool result, the native transport explicitly disables thinking **after** provider payload policies have run. It uses temperature 0.2 and presence penalty 0 for a precise confirmation. This avoids a repetition penalty pushing the model away from the exact factual acknowledgement in the tool result. The final pass returns a complete JSON response, consumed by the same NDJSON adapter; normal dialogue continues to stream. Tool selection and arguments remain Qwen's responsibility in the one existing OpenClaw session.

A native response can also misclassify an already completed `[avatar:ID]` reply as thinking. Only a thinking-only terminal reply that starts with that explicit Capri delivery protocol, has no tool calls, and belongs to the Capri model is recovered as visible text. Ordinary private reasoning and marker mentions inside analysis remain hidden. This avoids generating a replacement answer when the intended reply is already available.

The emergency settled-tool finalizer originally received an empty system prompt. It now carries the original extra system instructions and uses thinking off for Ollama, while retaining the upstream `disableTools` restriction. It cannot repeat completed actions. This prevents fallback replies from dropping Capri's persona, formatting or brevity rules. No conversation hooks or new tool permissions are granted.

Compaction retries for Capri desktop turns retain the current owner request and its supplied web references in the internal continuation. The upstream generic "continue the transcript" note alone could become the small model's apparent task, causing a long recovery monologue and ignoring successful web results after an empty memory search. The continuation now identifies itself as internal, asks for the actual answer, and retains the prohibition on replaying completed actions. It is not persisted as another user turn. Other agents and non-desktop calls retain upstream behavior.

Foreground local turns use a transient output budget before SDK prompt checks: up to 2,048 tokens ordinarily and 8,192 with Thinking. The same model reaches native compaction settings and Ollama's per-request output limit. This covers shipped Qwen, Gemma and Ministral profiles and managed Hugging Face imports, preserving smaller explicit limits and stored context/provider configuration. Other agents and unknown providers retain upstream behavior. See [the budget comparison](../../docs/performance/local-output-budget.md).

## One-shot conversation routing

The authenticated Capri owner can send `x-capri-thinking-once` or `x-capri-tools-once` on a chat request. The HTTP adapter validates the headers after existing authentication and session authorization. Thinking and tool selections apply to the current turn. The tool mask intersects existing permissions, and scoped turns skip OpenClaw's tool-definition pinning so a previous turn cannot add tools to the current provider request. `tests/request-router.test.mjs` checks validation. `tools/verify/verify-inference-api.mjs` checks tool scopes across consecutive turns in the same Gateway session.

## Validation

Capri's foreground preflight skips optional memory extraction, which remains available after delivery with its own ten-second signal. Required context compaction and explicit memory tools are preserved. Two call-site markers and the memory runner guard are pinned in the same manifest; no tools, session permissions or other agents change. The accompanying small-context policy and desktop first-text watchdog are documented in [context management](../../docs/context-management.md).

`npm test` checks version/hash guards, safe partial-install recovery, late payload overrides, complete JSON delivery, ordinary streaming and separation of private analysis from the explicit final-answer protocol. `npm run verify:spotify:dialogue` checks actual state changes and real Qwen tool calls in an isolated conversation, including external playback changes and read-only requests. `npm run benchmark:latency` measures real text and selected-voice readiness after startup.

## Bounded tool progress

An authenticated Capri owner may opt in to `x-capri-tool-progress: 1`. The HTTP stream includes only sanitized tool names, call IDs and start/result phases for that exact run. Arguments, results and private reasoning are not included. Both native result and legacy end phases are normalized. Other agents, non-owners and invalid values are rejected; ordinary clients do not receive these extra packets. Desktop timers distinguish actual tool execution from silent model stalls, with bounded execution/post-result windows and an unchanged absolute request deadline. The footer indicates Spotify work while its tool runs.

The patch manifest also records the exact hash of the previously reviewed HTTP adapter and the explicit edits needed to upgrade it. Unknown code still prevents all writes. `tests/openclaw-compat.test.mjs` covers the reviewed upgrade path; `tests/desktop-chat.test.mjs` checks slow tools, duplicate events, the absolute deadline and no automatic replay. `node scripts/verify-spotify-timeouts.mjs` checks real Gateway progress with a read-only status request and tests Qwen's direct `play(query)` selection without executing playback.

## Local desktop prompt budget

Only Capri/Ollama requests carrying the desktop interface marker use the native compact prompt surface. Tool schemas and permission policies are unchanged, and the desktop explicitly retains memory-search guidance. Native context excludes SOUL.md only when its exact body is already present in the same request's persona. Source files, shared history and memory are preserved. The single-agent local Capri model reserves its declared maximum output (up to 2048 tokens) rather than the generic quarter-window reserve. All other profiles keep upstream behavior. These guards and the previous patched prompt-preparation hash are pinned in the manifest.
