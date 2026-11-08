# User tools in Capri 0.6.2

Open **Settings → User tools → Open tools folder**. Each subfolder contains its own `manifest.json` and code. **Refresh tools** discovers definitions without running scripts. **Create example tool** adds a small, disabled Node example.

Review the code and the displayed permissions, then enable it. Changing any bundled file invalidates approval. A model receives only enabled definitions, parameter schemas and returned JSON. It never receives private tool settings. A model must support tool calling to invoke these tools; context scripts also work with models that do not support tools.

```json
{
  "version": 1,
  "name": "my_tool",
  "description": "Describe when Capri should use this tool.",
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": { "text": { "type": "string", "maxLength": 1000 } },
    "required": ["text"]
  },
  "runtime": "node",
  "entry": "main.mjs",
  "arguments": [],
  "permissions": { "network": false, "files": "none" },
  "timeoutMs": 5000,
  "mode": "tool"
}
```

`runtime` supports `node`, `python` and `executable`. The latter requires an `.exe` entry. Node uses Capri’s Node runtime; Python uses its managed Python 3.11 runtime. Runtime installation is not triggered by tool discovery. Entries are relative paths; shell commands and executable argument interpolation are unsupported. JSON schemas support bounded basic types, objects, arrays, required fields, enums and numeric/string/array limits. External references and regular expressions are rejected.

The process receives one UTF-8 JSON line on stdin:

```json
{
  "parameters": { "text": "hello" },
  "settings": {},
  "inputFiles": [],
  "outputDirectory": "temporary folder"
}
```

Write one JSON value to stdout and exit. Stderr is never added to the prompt. Output is limited to 64 KB and tools run one at a time, with a 256 MB process-memory limit, CPU-time limit and at most 60 seconds of wall time. Ordinary output may still contain sensitive data intentionally read from approved inputs: review a tool before giving it files or network access.

Private settings are entered as a JSON object of strings, encrypted using Windows credential storage, and supplied only to that approved process. Exact secret echoes and common credential formats are removed from returned JSON. This protects accidental echoes; it does not make malicious code trustworthy. Never put secrets in public descriptions or schemas.

`files: "inputs"` permits selecting up to four input files in Settings. Capri copies those files into the tool’s temporary folder. This grants no direct access to their original folders. Temporary files are removed after execution; this version does not automatically publish or retain tool-generated files.

Tools run in a Windows AppContainer and a Job Object. Offline tools also require a temporary, per-container IPv4/IPv6 network block. If Windows refuses this policy, the process is not started; some Windows accounts/configurations cannot install that block. Capri does not silently grant network access or run outside isolation. Only declare `network: true` when network access is actually intended and reviewed.

For a context script, set `mode: "context"`, provide `keywords` and optionally `cacheSeconds`. Its parameter schema cannot require model arguments; use private settings for configuration. Only matching, enabled scripts run, with a shared three-second preparation budget. Each result contributes at most 2,000 characters and the combined context at most 4,000. Results are reference data, never instructions or permission grants. No keyword match means no process is launched.

**Stop user tools**, disabling a tool, closing Capri or locking Windows cancels execution. Context scripts cannot start the microphone, read private-memory contents or inherit Capri’s API credentials.
