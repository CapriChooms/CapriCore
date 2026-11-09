# First visible reply latency

## Confirmed defect and fix

The managed OpenClaw transport uses Ollama's `shift: false`. The computer-intent
classifier omitted that option, so Ollama defaulted to context shifting. Alternating
the classifier and gateway requests restarted the resident runner twice per turn.
`/api/ps` still reported the model resident, so residency alone could not reveal it.

A controlled test changed **only** `shift` on the same loaded 4B model at 32K:

| Request                       |  Elapsed | Ollama model loading |
| ----------------------------- | -------: | -------------------: |
| Repeated `shift: true`        |    54 ms |                 3 ms |
| Change to `shift: false`      | 3,727 ms |             3,510 ms |
| Repeat `shift: false`         |    70 ms |                 3 ms |
| Change to `shift: true`       | 3,729 ms |             3,510 ms |
| Change back to `shift: false` | 3,713 ms |             3,494 ms |

The classifier now shares the gateway's runner policy. Click reactions, public
thinking briefings, call replies and private dialogue also use it. The last three
now receive the selected context size rather than silently requesting a default
window. This preserves the selected model, context capacity, hardware preference,
personality and permissions. Regression tests check the actual serialized requests
and the installed native gateway adapter.

Two further changes remove avoidable work:

- Sending a message uses the existing context monitor's cached technical metadata.
  Its optional session RPC refresh runs in the background. A stalled metadata read
  previously added up to 1.2 seconds before inference.
- Turns already restricted to conversation/memory use concise conversation
  instructions instead of unrelated desktop, filesystem and media action manuals.
  Personality, language, memory tools and the existing host permission boundary
  remain intact. Unknown/action requests retain their action instructions; no
  benchmark-specific prompt exception was added.

## Configured thread count: a second runner-reload defect

A later Gemma `gemma4:e2b` diagnostic showed a separate mismatch despite identical
`shift`, `truncate` and 32K context settings. The classifier omitted `num_thread`,
while the gateway used the configured four threads. Its 6.811 s intent stage
included 6.329 s of model loading, followed by another 6.725 s load for the answer.
The model had already appeared resident in `/api/ps`.

A controlled comparison on that same resident model changed only whether the
classifier supplied the configured thread count. Generation limits, intent
instructions, selected device and context capacity stayed unchanged:

| Request                  | Before: elapsed / loading | After: elapsed / loading |
| ------------------------ | ------------------------: | -----------------------: |
| Intent classifier        |          7,016 / 6,518 ms |               281 / 4 ms |
| Following short answer   |          7,035 / 6,781 ms |               144 / 4 ms |
| Repeat intent classifier |                         — |               168 / 4 ms |
| Repeat short answer      |                         — |                71 / 3 ms |

One shared allocation helper now supplies CPU/GPU and thread options to the
gateway, native model alias, startup/first-turn warmup and all desktop auxiliary
requests, including intent, vision, planning, initiative and thinking briefings.
Each task keeps its own sampling and output limit. Remote API requests do not
receive these local device options. Regression checks cover explicit CPU mode,
GPU/automatic mode, configured threads and host thread limits.

Two additional complete `ChatService → intent → OpenClaw → Ollama` checks used
the installed application backend and a fresh session with the public personality
and a benign question. Intent took 252 and 230 ms; first streamed answer text
arrived after 4.325 and 1.500 s. Both replies completed, and both provider calls
reused their resident runner (4–6 ms reported loading). These complete-chain
checks use a different prompt/history from the diagnostic and are not a direct
before/after comparison. A genuinely cold model still needs its initial load.

## CPU-only profile budget

A separate diagnostic confirmed zero GPU offload but no visible answer before
the CPU first-text deadline of 120 seconds. The selected built-in minimal profile
retained its two-thread budget while replaying a long conversation and running
compaction. That default is conservative for a small PC, but unnecessarily
restricts a larger processor.

Explicit CPU execution now scales unmodified built-in profile budgets to half
the host's logical cores, capped at eight. Smaller hosts retain a smaller budget;
non-default thread counts and custom profiles are preserved. The effective
configuration is shared by preparation, auxiliary requests and the gateway.
Changing back to GPU mode restores the saved profile's original CPU budget.

Real Qwen 3.5 0.8B, CPU-only, 32K-context checks with the same public personality
measured prompt evaluation at 13.138 s / two threads versus 4.855 s / eight threads
for 1,427 prompt tokens. An eight-thread 5,904-token prefill took 29.586 s.
An additional actual gateway conversation, seeded with public synthetic history,
completed both turns; first text arrived at 43.425 s and 76.879 s. The latter
included audited compaction and a 9,096-token final prompt. These are intentionally
reported as end-to-end timings, not inference-only speedups. No original user
history was replayed in these checks.

The real Chatterbox CPU worker also loaded, warmed and synthesized a short phrase
without initializing CUDA. The measured phrase took 4.353 s after warmup; its
audio was validated without playback. CPU execution remains considerably slower
than GPU execution on large prompts; increasing the context does not make its
prefill free.

## Earlier desktop measurements

The test used a separate installed Capri instance, its real Electron renderer,
real OpenClaw gateway (2026.10.6) and real Ollama inference (0.40.10).
Model: `capri-qwen3.5:4b`, context:
32,768, synthetic personality: 7,372 characters. Each request was exactly:

> Reply with exactly one word: Ready.

| Run                                   | Before: first text | After: first text |
| ------------------------------------- | -----------------: | ----------------: |
| First request after application start |           11.815 s |          12.545 s |
| Warm request 1                        |           11.417 s |           2.409 s |
| Warm request 2                        |           12.682 s |           1.671 s |

All six replies completed. The warm mean fell from 12.050 s to 2.040 s, about 83%.
Gateway model loading fell from roughly 3.5 s per request to 3–5 ms; warm prompt
evaluation fell from roughly 2.5 s to 0.11–0.13 s, consistent with retaining the
runner and its prompt cache. Display added tens of milliseconds after delivery,
not the observed multi-second delay.

These are a small diagnostic sample, not a general performance guarantee. The
synthetic conversation grew between runs, and the first after-fix turn included
an additional gateway model call (468 output tokens, about five seconds), followed
by a full prefill. That first-turn overhead remains visible in the trace and is
not counted as a warm-run improvement. In that earlier 4B experiment, separate
thread/keep-alive controls did not reproduce the restart; changing `shift` did.
The later Gemma test above independently reproduces the thread mismatch.

The tester's exact 58–59 seconds has **not** been reproduced on their AMD system.
This study used a different GPU, without Chatterbox co-residency. Runner restarts
are a confirmed product defect, not proof that they account for every second on
that machine. The new traces are needed there before attributing the remaining
time to CPU/GPU offload, memory pressure, compaction or model-specific behavior.
Counter-only measurements are in [response-latency-measurements.json](response-latency-measurements.json).

## Capture a slow turn without exposing its contents

1. Run the patched application with the same model, context and voice settings.
2. Send the test prompt three times, allowing each reply to finish. Keep the
   first request separate from later warm requests. Do not clear memory or change
   model settings during the comparison.
3. Save a diagnostic ZIP with logs enabled and review it before sharing.
4. Correlate `response-desktop.jsonl` and `response-provider.jsonl` by `traceId`.
   Different processes have their own `elapsedMs` origins; use their UTC `time`
   fields to compare across processes. `requestId` separates multiple model calls
   within one gateway turn.

| Stage                                        | Meaning                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `received`, `chat_started`                   | Desktop accepted the turn and entered chat handling                 |
| `model_start`, `model_ready`                 | Model preparation; includes cold/resident resource counters         |
| `routing_start/ready`, `intent_start/ready`  | CPU routing and computer-intent classification                      |
| `context_start/ready`                        | Preparation of the current screen/file/knowledge context            |
| `gateway_dispatch`, `gateway_received`       | Desktop dispatch and gateway receipt                                |
| `provider_request`, `provider_headers`       | Actual native Ollama dispatch and response headers                  |
| `provider_first_token`                       | First Ollama output, including thinking if enabled                  |
| `provider_first_content`                     | First content output, separately from thinking                      |
| `provider_finished`                          | Ollama's load/prompt-evaluation/generation timings and token counts |
| `gateway_first_delta`, `gateway_first_token` | Gateway emitted content and desktop received it                     |
| `first_delta`, `first_paint`                 | Visible prose emitted; visible main renderer acknowledged a frame   |
| `completed`, `failed`, `cancelled`           | Terminal desktop status                                             |

Ollama reports prompt evaluation and loading durations in its **final** packet;
they are not invented start/finish timestamps. Non-streaming auxiliary responses
can only report their first output at response completion. The paint acknowledgement
uses two animation frames and is an approximation, not a hardware display timestamp;
hidden/minimized renderers do not claim a visible main-window paint.

Only fixed technical stages, random correlation IDs, validated model IDs,
timestamps and bounded numeric counts are retained. No prompt, reply, personality,
memory, tool arguments, image, path, credential, header or raw error is logged.
Payload observation is limited to Capri's configured loopback Ollama endpoint;
remote API bodies are not inspected. Logs are batched off the response path, with
a 128-record queue and 512 KiB file plus one rotated backup per process. Diagnostic
ZIP export applies the same explicit allowlist again. Observability failures cannot
prevent a reply.
