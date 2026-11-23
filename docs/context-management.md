# Bounded context maintenance

## October 27: installed lightweight profiles

The first installed 2B profile allocated 8192 tokens, while one complete desktop
request already required 8470 tokens. Its automatic compaction could not remove
the mandatory tool/persona instructions and repeatedly failed summary validation.
Simply reconnecting or deleting the conversation could not repair this mismatch.

All managed Capri Qwen profiles now use a minimum 32768-token inference window.
The initial 16384-token correction was insufficient for a multi-turn tool chain:
the conservative mid-turn estimate exceeded its remaining prompt budget. Existing
managed configuration is upgraded with a backup, with model metadata and the
actual Ollama `num_ctx` kept consistent. Larger configured windows, memory files,
conversation history, permissions and custom sampling options are preserved.

The 2048-token output reservation and native post-tool delivery guards now apply
to every supported Capri alias (0.8B, 2B, 4B and 9B), rather than only 9B. Unrelated
models retain upstream behavior. Ordinary arithmetic no longer requires opening
Calculator; explicit requests to use that application still use its scoped tool.

Three isolated Russian desktop-handler requests completed on the installed 2B
model, including a read-only application tool call. The first request, including
context reallocation/prefill, completed in 16.09 seconds; the following requests
completed in 1.79 and 2.94 seconds. Ollama reported an actual 32768-token window.
No owner conversation was reset or used for the test. These are small local
samples excluding voice playback; larger contexts increase KV-cache memory and
do not guarantee high-quality summaries from the smallest models. The sections
below describe the earlier baseline.

The October 26 stall was a foreground memory-maintenance run that consumed the 180-second command deadline. Its prompt-pressure estimate was about 19,800 tokens against a 12,288-token prompt budget. The installed OpenClaw default also retained a 20,000-token recent tail despite Capri's 16,384-token working context. Increasing the overall timeout would not fix that mismatch.

`scripts/context-policy.mjs` sizes the recent tail to one eighth of the configured context, capped at 4,096 tokens. The current profile retains 2,048 tokens and two recent turns, uses safeguard summaries with thinking off, no corrective regeneration loop, a ten-second summary progress timeout, asynchronous indexing and a pressure check after tool results. Old transcript entries remain on disk; compaction changes the model's active view, not the saved conversation. The upstream summary progress timeout resets on actual output, so it is not an absolute ten-second cap on all compaction work.

For Capri only, pinned compatibility guards skip optional memory extraction during foreground preflight. The usual required context compaction still runs. Automatic extraction remains available after delivery, with its own ten-second cancellation signal covering preparation, inference and tools. A new owner message still cancels background maintenance under the upstream session lease. A maintenance timeout records a failed attempt instead of claiming that notes were saved. Explicit memory writes, memory search, existing notes and the shared session remain enabled. Other agents retain upstream behavior.

The desktop also cancels a turn if no visible reply text arrives within 30 seconds. A real tool-start event now replaces that first-text timer with a bounded 45-second execution window. A matching result opens a fresh 30-second window for the final answer. Only new, valid tool call IDs affect these timers; duplicate starts, unmatched results, heartbeats and hidden avatar markers cannot keep a stalled turn alive. The absolute 180-second request deadline still applies, and tool actions are never replayed automatically. Heartbeats and hidden avatar markers do not reset that deadline. Once real prose arrives, the watchdog is cleared so a healthy longer reply can continue within the overall command budget. Timeout/cancellation never automatically resubmits a message or repeats a possibly completed file/music/app action. Partial output stays marked incomplete. A failed turn checks actual Gateway health rather than declaring the whole core offline unconditionally.

The ten-second memory budget is a ceiling, not a promise of durable extraction on every turn. If maintenance is interrupted, the existing notes remain and ordinary context summarization still applies. As with the upstream runtime, a summary timeout may retain recent context without fully summarizing older facts; archived history is preserved. There is no claim of perfect recall or a fixed four-second response for an arbitrarily long cold prompt.

For existing installations, `node scripts/configure-context.mjs` backs up the runtime configuration and applies only the context policy. Restart the owned Gateway and desktop to load the compatibility changes. Fresh initialization includes the same policy. User sessions, voice profiles, permissions and sampling settings are not reset.

Verification:

```powershell
node --test tests/context-policy.test.mjs tests/desktop-chat.test.mjs
node scripts/verify-context-pressure.mjs
node scripts/verify-context-pressure.mjs --stall-memory
```

The isolated integration fixture appends inert synthetic text through the public context SDK, verifies that real Qwen answers the current request after compaction, and checks that the archived conversation still contains the early fixture fact. A local proxy is prepared to stall optional memory calls; the passing foreground test makes zero such calls. The pinned runner's independent deadline is separately exercised against deliberately stalled preparation in `tests/context-maintenance.test.mjs`, with the production ten-second duration observed and the test clock accelerated. These tests do not touch the owner's transcript or files. Private reports are under `logs/context-pressure-*.json`. Cold test-Gateway preparation is measured separately from subsequent turns.

Final isolated run: 27.41 seconds to first text on the unprepared test Gateway, 20.64 seconds for the deliberately overfilled context and 4.11 seconds for the following normal request. The two requested readiness codes were answered correctly; original fixture text remained in saved history. This is one recovery sample, not a latency percentile or a guarantee of perfect fact recall after summarization. The complete Node suite passes 138 tests.

The October 26 Spotify failure reached `spotify_control.search` about 24 seconds after the desktop request began. The old first-text watchdog left only six seconds for a bridge operation allowed up to 25 seconds. The opt-in authenticated progress stream fixes that mismatch. Clear named-playback requests now use one `play(query)` tool call, whose bridge already searches and verifies playback, rather than an unnecessary search/model/play sequence.

The desktop's native prompt uses OpenClaw's compact prompt mode for Capri/Ollama turns marked CURRENT DESKTOP INTERFACE. All policy-filtered tool schemas and workspace memory files remain available. Capri supplies its current PERSONALITY.md once through the request. Legacy character bootstrap entries and duplicate Personality entries are omitted from native injection, while USER.md and MEMORY.md are retained. Repeated Spotify instructions are consolidated. The single-agent capri-qwen3.5:9b profile reserves its configured maximum output (currently 2048 tokens) instead of the previous 4096-token quarter-window default. Other profiles keep upstream reserve behavior. This gives real room to tools and recent dialogue without increasing the 16384-token context or GPU allocation. Tests cover both profile-specific and untouched generic reserve behavior.
