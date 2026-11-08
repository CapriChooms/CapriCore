# Capri v0.4.4: implementation and qualification plan

Updated: 2026-11-02. Owner request: clean Windows installation, issue triage,
fresh screen questions, AMD speech, remote inference, broader desktop actions,
an explicit full-computer grant, animation planning, Discord presence and model choice.

## Baseline and order

Keep Electron as the permission/UI owner, OpenClaw as the conversation/tool runtime,
Ollama as the local inference service and Python as the speech service. Extend
these boundaries instead of building another unrelated conversation history.
Work in the following order; update each completion record with actual evidence.

1. **Installer and reported regressions.** Retain the TLS EOF recovery and
   newline-based speech download progress. Inspect new issues #44/#45 and older
   reports with useful diagnostics. Reproduce causes before changing timeouts or
   claiming fixes. Do not close reports whose cause remains unconfirmed.
2. **Fresh screen questions.** A foreground screen question takes a new frame
   after submission from the currently selected, permitted source. It bypasses
   the background analysis interval/change detector, cancels lower-priority
   analysis and shares the turn's abort signal. Failed capture cannot fall back
   to a previous scene description. No access is inferred merely from a question.
3. **Animation design contract.** Document the shot/state graph and asset brief
   against the existing 68-frame runtime pack. Separate locomotion, gesture,
   expression, blinking and speech. Do not claim new animation drawings exist.
4. **Additional local language models.** Extend the existing catalog and model
   switch transaction. Read actual Ollama capabilities and context bounds before
   activating a model. Store model family/capabilities rather than inferring them
   from a Qwen-only alias. Preserve current Qwen defaults and shared memory.
5. **Discord Rich Presence.** Implement optional local Discord IPC, no Discord
   user token or bot account. Handle framing, READY/PING/PONG, reconnect and clear
   on exit. Generic activity, elapsed time, Get Capri/Join Discord buttons only;
   never include conversations, filenames, screen contents or microphone text.
6. **Full-computer grant.** An explicit owner setting, off by default. Main
   process issues an expiring one-use confirmation challenge and enforces a
   three-second delay. Model calls cannot approve it. Persist the owner's choice,
   expose immediate revocation and apply it to host capabilities consistently.
7. **Desktop action expansion.** Add launch discovery, key chords, bounded key
   holds and pointer operations through the native Windows bridge. Add visible,
   cancellable action sessions before allowing chained computer operation.
8. **Remote inference.** Add the credential store, provider boundary and settings,
   then integrate streaming, tools, vision and startup/unload behavior.
9. **AMD speech.** Qualify a separate supported AMD/PyTorch configuration; preserve
   Capri's trained adapter/reference. Generalize NVIDIA-only checks/optimizations
   without changing the established CUDA path. Hardware qualification is separate
   from unit tests and successful package installation.
10. **Release gate.** Clean-profile installation on D, targeted real-function
    checks, full regression/format/source-export checks, build verification,
    GitHub CI, then v0.4.4 with short English notes and explicit limitations.

## Installer and clean profile

- Preserve the current D installation, diagnostic ZIPs and user data. Use a new
  empty test target for clean-profile qualification; do not recursively delete it.
- Use the real packaged EXE, not a source-tree-only launch. Verify the embedded
  source manifest, bundled sprite pack, English adapter and exact runtime pins.
- Record which components are freshly downloaded and which verified package/model
  caches are reused. Cache reuse is not evidence of clean network availability.
- Check install, retry, pause/resume, settings persistence, first startup, model
  warmup, text/voice, settings first-open/tray/exit, sleep/wake, languages,
  screen questions, permissions and shortcuts. Test destructive actions only in
  disposable fixtures. Check Spotify by safe read-only operations when connected.
- Capture concrete pass/fail evidence; missing external accounts/hardware remain
  explicit qualification limits rather than synthetic success reports.

## Fresh screen implementation

Trace `renderer/screen-watch.mjs` -> authenticated screen IPC ->
`ChatService.prepareContext` -> `ScreenObservation.foreground` -> visual inference.
The image must belong to the active capture ID and be captured after submission.
Recognize ordinary screen questions in both typed and final voice input, including
look at my screen, what is on my screen, and localized equivalents. Retain source
selection/lease checks in the main process and keep screenshots transient.

Tests: repeated questions within one background interval, unchanged scene,
changing scene, selected window/monitor, stopped observation, lease expiry,
capture failure, cancellation and an expired/mismatched capture ID. Use a fixture
window whose content visibly changes between two consecutive questions.

## Language model catalog

- Keep hardware profiles separate from model families. Add reviewed optional
  tool-capable Ollama families and allow installed-model discovery.
- Query `/api/show` for tools, vision, thinking and context limits. Refuse an
  incompatible choice with an actionable explanation; do not advertise tools or
  images that the selected model cannot process.
- Reuse `ModelService`, staged preparation, cancellation and atomic restart/
  rollback. Keep original model caches and user context. Label memory estimates
  as estimates and report actual installed size when known.
- Remove Qwen-only labels/alias construction from generic code. Preserve Qwen's
  native multimodal preparation specifically for Qwen; do not apply it to other
  families. Keep vision routing explicit for text-only language models.
- Test personality/plain text, tool arguments, memory and restart for each
  advertised family. A download is not a quality qualification.

## Discord implementation

Use a bounded Node `net` connection to Windows `discord-ipc-N` pipes. Validate
opcodes and lengths, buffer fragmented frames, correlate nonces and ignore
unrelated events. Do not block startup if Discord is absent. Coalesce activity
updates and use bounded reconnect backoff. Close sockets/timers on shutdown.

The app name and asset belong to a registered Discord application. Store its
public Application ID and asset key in configuration; neither is a password.
Expose an opt-in switch and setup guidance. A missing Application ID is a setup
requirement, not a reason to borrow another developer's application identity.

Tests: protocol fragmentation, oversized frames, reconnect, absence, shutdown,
activity clearing and snapshots proving private user content never enters activity.

## Permissions and desktop automation

Extend the existing `ActionBroker`, `DesktopCatalog`, approvals and operation
journal. Normal mode keeps scoped grants; full-computer mode grants supported
capabilities through the same host policy. It does not disable Windows ACLs,
elevation boundaries or the API credential boundary.

- Discover applications from owner-selected executables and Windows registrations;
  resolve actual identities before launch. Do not pass arbitrary model-generated
  shell commands to PowerShell/cmd or synthesize executable arguments implicitly.
- Key/chord inputs use a validated key vocabulary, maximum hold duration and
  `finally` release of held keys/buttons. Pointer coordinates are bounded by
  current monitor geometry. Require a verified intended foreground target.
- Chain operations only in an owner-requested action session with a visible
  click-through border, stop button and global Escape cancellation. Refuse a
  session if the emergency stop cannot be registered. Bound time/step count,
  stop on lock/target loss and never resume a cancelled chain automatically.
- Capture/inspect after actions to verify results. Return real tool evidence to
  the existing agent loop. Screenshots and application text remain untrusted
  observations and cannot grant permissions or change the owner's goal.
- Keep a content-minimized journal. Full access reduces repeated approvals for
  the owner's supported actions; it is never silently enabled by a model request.
- Do not claim reliable game input where Windows focus/UIPI, a game's input API
  or anti-cheat blocks standard Windows input. Report the actual failure.

Tests: countdown/replay/revocation, fresh process after restart, focus changes,
unsupported keys, mixed-DPI/multiple monitors, Escape during a key hold and a
multi-step chain, no held input after failure, safe test app launch and fixture
text entry. No destructive tests against personal files or real games/accounts.

## Remote inference and secret handling

Use an OpenAI-compatible provider boundary while retaining OpenClaw's tool loop
and canonical conversation/memory. A main-process-owned local inference gateway
can translate the current local protocol into remote Chat Completions/SSE so the
user sees the same streaming/voice pipeline. Keep embeddings on the local CPU
unless a separate embedding provider is deliberately configured.

- Provider configuration contains an endpoint, model, capabilities and credential
  reference. Encrypt keys with Electron safeStorage/Windows DPAPI under
  `data/secrets`; never save plaintext keys in core/OpenClaw configuration.
- Renderer accepts a password field once and receives connection status only.
  The agent cannot retrieve the key through a tool, prompt or diagnostic export.
- Require HTTPS for external endpoints, reject credentials/query strings in URLs,
  refuse redirects carrying Authorization and bound request/response sizes.
  Permit explicit loopback endpoints for locally hosted compatible servers.
- Keep the remote bearer in the main-process transport. Do not pass it on process
  command lines, stdout, exception bodies, histories or model-visible settings.
  Log allowlisted error codes/status only. Test malicious responses echoing keys.
- Explain the remote data boundary before enabling it: conversation/context and
  deliberately attached images go to the selected provider. No automatic remote
  fallback from local mode. Keep separate image capability/consent checks.
- Skip loading/unload the local language model in remote mode. Keep local voice
  and recognition choices independent. Preserve settings transaction rollback,
  cancellation, SSE tool-call deltas and incomplete-response behavior.

Tests: Windows encryption round trip, fake-secret canaries across logs/diagnostics/
configuration, 401/429/5xx, unsafe redirects, malformed streams, tool calls, vision,
restart, disconnect and switching back to local mode. Live paid-provider checks
require an owner-configured key; never invent a successful live test.

## AMD speech qualification

Prefer a separate native Windows AMD PyTorch environment from the official
supported matrix, with its required Python and exact framework/audio wheels.
Keep CUDA and AMD dependency sets isolated; no in-place replacement of a working
NVIDIA voice environment. Select explicitly or from confirmed GPU/backend data.

PyTorch HIP may expose `torch.cuda`: distinguish `torch.version.hip` from CUDA
before NVIDIA architecture checks, nvidia-smi use or CUDA Graph selection.
Probe real arithmetic, matrix and synthesis operations. Keep the same adapter,
reference, tokenizer and inference limits. Separate language generation/acoustic
decoder placement and report their actual device rather than a generic GPU flag.

DirectML/ONNX remains a separate fallback route requiring a merged export of the
trained adapter, compatible operators and audio comparisons. Do not substitute
stock voice cloning or call CPU execution AMD GPU acceleration. Unsupported GPUs
must receive a precise compatibility explanation and a working alternative when
available. AMD behavior cannot be hardware-qualified on this NVIDIA-only PC.

## Animation rework specification

Prepare registered model sheets and fixed-canvas layer/anchor contracts first.
Define idle/attention/listen/think/speak/gesture/sleep as a state graph with
explicit entry/exit poses and priority interrupts. Each clip specifies key poses,
breakdowns/in-betweens, frame holds, easing, eye line and contact points.

Preserve silhouettes and planted contacts during transitions; avoid using a long
crossfade between unrelated body poses as a substitute for drawing motion.
Separate blink and mouth timing from body clips. Add bounded breathing/secondary
motion with reduced-motion controls. Keep sprite registration, manifest validation
and asset provenance. Review storyboard/contact-sheet previews before new art is
integrated, then measure texture memory/frame pacing and test interruptions.

## Primary references

- [AMD Windows support matrix](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/windows/windows_compatibility.html)
- [AMD PyTorch installation](https://rocm.docs.amd.com/projects/ai-ecosystem/en/latest/frameworks/pytorch/install.html)
- [Discord Rich Presence](https://github.com/discord/discord-api-docs/blob/main/developers/discord-social-sdk/development-guides/setting-rich-presence.mdx)
- [Discord Application IDs](https://support-dev.discord.com/hc/en-us/articles/360028717192-Where-can-I-find-my-Application-Team-Server-ID)
- [Ollama API/capabilities](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml)
- [OpenRouter compatible API](https://openrouter.ai/developers)

## Completion evidence

- Implemented fresh-track screen capture with bounded waits and frame disposal. Native Electron verification confirmed different pixels for consecutive questions without waiting for the background interval; source leases, stop/restart, hide, camera denial and expiry checks passed.
- Application discovery now returns launch recipes and explains separate inspection permission. The native bridge also uses UI Automation as a focus fallback. Issue #45's archive confirms repeated inspection failures, but omits exact arguments; its root cause is not proven for that user's installation.
- Implemented optional Ministral 3 3B and Gemma 4 E2B selection, actual capability checks, model-specific thinking/context metadata and transactional switching. Both real Ollama models passed greeting, a launch-tool call and a generated red-image question. These small probes do not establish persona/quality parity or comparative speed.
- Discord RPC protocol tests passed: opt-in, no token, framing, fragmented messages, heartbeat/retry and clearing on exit. Public activity requires the author's registered Application ID; none was supplied during qualification.
- Full-computer access is off by default and uses a main-process three-second confirmation. Real settings UI verified countdown and cancellation; scope/revocation/race tests passed.
- Native Windows fixture verified inspected text entry, Ctrl+A, held-key cancellation/release and pointer click. It exposed and fixed the serializer's ArrayList key representation and a focus failure. No owner application was used as the input fixture.
- External API fixture passed the actual OpenClaw → proxy → compatible-provider → tool → answer round trip. Tests cover separate loopback authentication, encrypted key storage, split streaming echoes and provider-error redaction. Real Windows encryption also passed. No paid-provider account was used.
- AMD dependencies actually installed under isolated Python 3.12.12; Torch/TorchAudio ROCm and Chatterbox Turbo imports passed. HIP dispatch skips NVIDIA-only checks/graphs. The pinned SDK bundle avoids the upstream path-with-spaces trampoline issue. Radeon hardware/audio/speed qualification remains pending.
- Animation storyboard, drawing registration, layered mouth/blink contract, interruption graph and memory/performance gates are in ANIMATION-V2.md; no new drawings are claimed.
- Final unit regression: 506 passed. Python transport/compatibility suite: 52 passed with one optional tqdm-dependent case skipped in the minimal interpreter. Native settings, 50-locale interface and five-language installer UI checks passed. The real gateway/provider fixture verified that social turns expose only memory tools and the next task regains its normal tool surface.
- Issue #44's report shows only about 1 GB free system RAM, failed agent warmup and a large estimated prompt. Resource pressure is plausible, not a proven single root cause; no blanket timeout increase or closure is claimed.
- Dependency triage pinned the patched Undici 8.12.2 and Zod 4.6.6 runtime libraries without changing OpenClaw's version or reviewed source patches. Upstream audit alerts remain in bundled npm tooling and minimatch; they are not dismissed or represented as resolved. This qualification is not a complete dependency-security audit.
- Packaged installation into a fresh Windows folder completed with fresh dependencies, speech models, classifier and Qwen. Only checksum-verified runtime archives were reused; no conversation, memory or personal settings were copied. A subsequent real packaged worker repair also completed. Installed Parakeet recognized the complete English fixture sentence; installed Electron/Qwen/voice playback, stopwatch, new settings and wake/reload checks passed without renderer errors. A separate ordinary production launch confirmed automatic voice/ASR preparation, a completed spoken answer, actual shutdown of both Ollama and voice on sleep, and another real answer after reload. Short greetings began playing after about 3.4–4.4 seconds in a local smoke test.

## Remaining issue findings

The ordinary installed launch exposed a small-Qwen failure absent from the disposable verification profile: an initial greeting could start unrelated app-control calls and loop through status replies. Unambiguous greetings and high-confidence simple dialogue now use an authenticated one-turn tool intersection containing only memory_search/memory_get. The same session/history remains in use; the next task regains its normal permissions. The pinned gateway patch validates the owner and agent, and does not persist the override. Rolling OpenClaw loop detection is also enabled for the managed agent unless the owner explicitly configured a policy. Cold classifier preparation has more background startup allowance without increasing the foreground classification deadline.

- #42 records interrupted/timed-out PyTorch R2 downloads. The official-host fallback and bounded retries address this recovery gap; network paths can still fail independently of Capri.
- #40 contains a Node download failure and a later Hugging Face connection reset before any model bytes arrived. Retrying preserves verified data; these archives do not prove a local recognition defect or identify the intermediary closing the connection.
- #38 reports slow Russian speech. Its health record identifies the acoustic decoder on CPU with `vram-reserve` on an 8 GB GPU. English Turbo and multilingual v3 are different inference paths. Keep the VRAM protection; forcing the decoder onto a crowded GPU can make paging or failures worse. Equivalent multilingual speed is not claimed.
- #39 records repeated failed Spotify tool calls on v0.4.0, plus an earlier plugin-capture path failure. The current source uses the original plugin entry path, but the archive lacks failed call arguments. No successful Spotify retest or definitive closure is claimed.
- #41 contains an earlier Electron GPU-process exit and context-overflow errors, despite all sprite files being present. The archive cannot establish a single cause for the reported animation freeze. #43 has no diagnostic archive. Keep both open for a reproducible case.
- Reports #18, #19 and #26 remain unconfirmed. In particular RX 6700 XT is outside the pinned Windows ROCm matrix; the experimental AMD backend does not claim support for that GPU.
