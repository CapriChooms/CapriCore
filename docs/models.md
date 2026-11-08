# Choosing a language model in Capri

Open **Settings → Language model**. The same choices are available on the hardware step of Installation Wizard.
The menu is available after installation, including when the current core is offline.

Choose Qwen3.5 0.8B, 2B, 4B or 9B, or **Ministral 3 3B (BETA)** and **Gemma 4 E2B (BETA)**. Their upstream capabilities are described in the [Ministral catalog](https://ollama.com/library/ministral-3:3b) and [Gemma catalog](https://ollama.com/library/gemma4:e2b).

The installer and Settings show up to two recommended models for the selected
**conversation language** and the detected RAM and dedicated VRAM. Changing the
language preserves your model selection. The regular hardware guidance stays
available for custom languages and combinations with insufficient evidence.

The [benchmark results](../packages/runtime/src/hardware/model-language-benchmark.json) record the model
digests and scores for six models across all 100 built-in conversation languages.
Each model answered two synthetic prompts per language on local Ollama, one about
word meaning and one about a count that changes. A recommendation requires
passing both prompts in that language. Ties favor models that passed both prompts
in more languages, then models with lower memory requirements. These short tests
provide a starting point for model selection. Extended conversation, voice and
computer control require separate evaluation.

The next installer lists approximate text-model VRAM use separately from the system RAM target for the detected GPU/CPU configuration. A supported GPU with enough dedicated memory lowers the system RAM target; the larger CPU-fallback RAM target applies when GPU capacity is insufficient or unknown. The component page separately estimates the combined RAM/VRAM cost of text, voice and recognition, with remaining headroom. See [memory planning](hardware.md#installer-memory-budget-next-build). These ranges are not measured guarantees: context size, voice and other programs also consume memory.

Capri indicates which weights are already downloaded,
shows hardware-dependent RAM guidance, and recommends a profile based on detected hardware.
Each choice includes its model-file size in decimal GB (1 GB = 1,000,000,000 bytes).
**Downloaded** marks weights present on disk, including Capri native aliases; it does
not mean the model is currently loaded in RAM/VRAM. Downloaded sizes come from the
local Ollama inventory. Missing sizes use **≈** estimates from the
[official Qwen3.5 tag catalog](https://ollama.com/library/qwen3.5/tags), recorded in
`config/qwen-download-sizes.json`. Upstream updates and backend variants can change
the estimate. RAM/VRAM consumption is separate and depends on inference settings.
If Ollama cannot be reached, the panel reports that downloaded state cannot be checked.
Choices below the supported RAM threshold are disabled. GPU acceleration is selected
by Ollama, not guaranteed by a model label; CPU inference remains slower for large models.
Voice and other applications need additional memory beyond the language model.

RAM targets refer to nominal system RAM. Windows/firmware reservations can leave
slightly less usable memory: the 32 GiB profile accepts 30 GiB and the 16 GiB
profile accepts 15 GiB. The allowance is bounded by profile size (0.5–2 GiB), and
the native setup and runtime use the same rule for recommending and accepting a
profile. Detected RAM is still displayed unchanged; this does not guarantee that
enough RAM is currently free while other applications are running.

**Download and prepare** downloads missing weights through the owned local Ollama
service and creates/validates Capri's native alias. It shows real progress and supports
cancellation; Ollama keeps verified and partial layers for a later retry. The current
model remains selected during preparation. Already cached weights are reused. A failed
download does not change the selected model or configuration.

Temporary registry DNS/connection failures retry up to four times with bounded
backoff through Ollama's own pull API. Verified/partial layers remain reusable.
Cancellation and pause remain available; missing models, permission and other
permanent errors do not trigger a network retry. This cannot repair an offline
connection, DNS configuration or a blocked registry.

If an installer pull specifically fails its TLS handshake, Capri can probe the
official registry with certificate-validated classical key exchange. Only after a
successful probe, and only when its owned Ollama has no loaded models, it saves a
per-installation compatibility preference and restarts that idle service. TLS 1.3
remains available and certificate verification remains enabled; only the hybrid
post-quantum key exchange is disabled for this managed Ollama process. No Windows,
proxy, DNS or other application setting changes. This addresses networks that
drop the larger handshake messages (see the [Go compatibility documentation](https://go.dev/doc/godebug#go-124)).

The preference is stored in `data/network/registry-tls.json`. Removing that file
and restarting Capri restores the default key exchange. A failed probe, an unowned
server or a loaded model prevents automatic restart. This recovery is limited to
installer model pulls; normal conversation does not restart a running model.

When preparation completes, choose **Switch model and restart**. After confirmation,
Capri stops its owned core/voice services, updates the managed inference fields in
local/Gateway configuration, and relaunches through the windowless launcher. Startup
prepares the chosen model and the enabled speech components. The first start can take
longer than a warm reply. Settings writes restore their previous values if a write
fails. Downloads and model switches cannot run over an update installation.

The same conversation, long-term memory, personality, language, voice, tools and private
overrides remain in place. No conversation is reset and no old model is deleted.
To switch back, select its already downloaded model and prepare it again. Native
aliases use the selected profile's inference settings, tools and native chat template.
The CLI setup command and desktop use the same profile-persistence implementation.

The settings panel uses the selected interface language. Hardware recommendations
are planning estimates. Configure remote endpoints separately in Settings → External AI provider.

To reproduce the benchmark, pull the catalog tags into a dedicated Ollama
instance on loopback port 11537 and run
`node tools/benchmarks/benchmark-model-languages.mjs --write-catalog`.
Check the loaded model digests against the recorded digests when reproducing scores. The runner checkpoints
synthetic answers in `.runtime/model-language-benchmark/results.json`.

Verification uses fixture configuration and a disposable Electron profile. It covers
RAM limits, cached models, cancellable transfers, selected inference parameters,
configuration preservation/rollback, stale-selection buttons and compact layout at
480×660, 380×480 and 320×360. The UI verification never downloads or changes the owner's
language model. Run `node tools/verify/verify-models-layout.mjs` for screenshots.

Local conversation compaction normally uses a structured model-generated summary.
If a managed Capri/Qwen model produces an invalid summary, the compactor can recover
with bounded, role-labelled excerpts from the original conversation instead. The
candidate still passes the native context-budget and quality checks, including the
pending request and exact identifiers. Rejected generated prose is not reused.
This path does not reset a session, delete its transcript, rerun tools or retry the
user's command. Older details may be absent from the active excerpt; the original
transcript and separate long-term memory remain stored. Other agents/providers,
cancellation, transport failures and infeasible context budgets retain native failure
handling. A remaining compaction failure is identified explicitly in diagnostics.
