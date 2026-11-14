# Local model load control

Open the **Local** badge next to Capri's name. **Limit CPU and GPU load** is on at
**85%** by default. The slider accepts 10–100%. Changes apply during a reply and
are saved for the next launch; no model restart is needed. Uncheck the option to
restore the runner's unrestricted CPU budget.

This controls Capri's managed local language and embedding model runners on
Windows. It does not control external API servers, local TTS, speech recognition,
other applications, or the desktop interface. The helper runs only during local
work or local backend startup. It does not poll while idle or in API mode.

## What the percentage means

- **CPU:** a Windows Job Object quota, as a percentage of the machine's CPU
  scheduling budget. This is a ceiling, not a promise that inference will use all
  of it. A single-threaded workload may already use less.
- **GPU:** an adaptive utilization target. A local helper samples Windows GPU
  engine counters every 500 ms and adjusts the model runner's CPU submission
  budget. This reduces average GPU activity but cannot interrupt a GPU kernel
  that has already started. Short prefill and generation peaks can exceed the
  target. Other applications can also keep total GPU usage above it.
- **Memory:** this is not a RAM or VRAM limit. Loaded weights and the context
  cache keep their existing allocation. Lower targets slow replies, particularly
  at the bottom of the range.

The controller uses the busiest WDDM engine on the GPU(s) associated with the
owned runners, including activity from other applications on those engines.
Driver tools may report a different utilization measure or sampling interval.
When GPU counters are unavailable, the menu says **CPU limit only**; it does not
invent a GPU reading. Windows driver, Job Object or process access restrictions
can make control unavailable, which is also reported in the menu.

## Ownership and recovery

The native helper verifies the managed Ollama executable, PID and creation time.
It adds only verified descendant `llama-server.exe` processes from that Ollama
installation's `lib/ollama` directory to its named Job Object. Retained process
handles prevent PID reuse from selecting an unrelated application. Model/device
selection, context length, GPU offload, clocks, power limits and drivers remain
under their existing controls.

Every command renews a five-second lease. A stale lease, closed input, desktop
exit, helper shutdown, or an exception restores the full CPU budget. The host
also runs a verified reset after helper termination. Stopping control never
terminates a model runner. A non-inheritable Job Object handle retained by the
desktop keeps the same quota reachable after a forced helper exit. One handle
per supervisor is kept between turns at the unrestricted budget, so subsequent
turns reuse the same job instead of nesting new quotas. Final shutdown releases
the retained handles. Commands and telemetry contain only quotas, process
identity and numeric utilization; no conversation, API key or prompt is sent to
the helper or recorded by it.

## Verification

`tests/local-model-load.test.mjs` covers validation, persistence, controller
bounds, missing counters, supervisor ownership and quota release. The isolated
Electron check `tools/verify/verify-local-model-load.mjs` exercises the actual
menu, IPC, slider keyboard controls, persistence and enable/disable behavior.

Real local-model GPU measurements must compare the same model, device, prompt,
context and thread count, allowing time for the controller to settle. Include
an unrestricted baseline and a final unrestricted run to verify recovery.
Measure average utilization and reply throughput as well as peaks. GPU-specific
results are not guarantees for other hardware. Do not commit personal hardware
identifiers or private installation paths in benchmark reports.

Windows quota semantics are documented in
[JOBOBJECT_CPU_RATE_CONTROL_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information)
and [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
