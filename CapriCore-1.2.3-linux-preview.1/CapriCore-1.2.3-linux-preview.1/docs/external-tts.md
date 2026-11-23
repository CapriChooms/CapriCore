# External voice (optional)

Local speech is the default. **Settings → Voice API** independently selects an
external TTS connection; it does not change the LLM or speech recognition provider.
No external voice is contacted until you enable it and request speech, or press
the explicit connection test.

1. Choose **OpenAI / OpenAI-compatible** or **ElevenLabs**.
2. Enter your provider's base URL, TTS model ID, voice name/ID and API key.
3. Enable **Use external TTS**, then **Save connection**. The speaker button
   separately enables Capri's spoken replies, as it does for local voice.
4. Press **Test voice connection** to hear a short fixed sample. It can incur
   a provider charge and uses your saved settings, without conversation history.
5. Disable **Use external TTS** and save to return to the installed local voice.
   **Remove connection** also deletes its saved key.

Example OpenAI base URL: `https://api.openai.com/v1`, model
`gpt-4o-mini-tts`, voice `coral`. Other OpenAI-compatible services must implement
`POST /audio/speech` with `response_format: "pcm"`: signed 16-bit little-endian,
mono 24 kHz audio. Equivalent 24 kHz PCM WAV responses are also accepted.
Compressed audio and other sample rates are rejected with a format message,
instead of being played at an incorrect pitch or speed.

For ElevenLabs, use `https://api.elevenlabs.io/v1`, a model such as
`eleven_multilingual_v2`, and the voice ID from your ElevenLabs account. Capri
uses the provider's `/text-to-speech/{voice_id}` endpoint with `pcm_24000`.
Model/voice availability, languages, quotas and billing depend on the provider.
The selected cloud voice is not guaranteed to sound like Capri. No reference
recording is uploaded automatically.

Enabling this route stops the managed local voice process and skips its startup
and language preparation. No Python voice runtime or local voice weights are
required for external synthesis. Subtitles, mouth animation, effects and the
existing call output receive the same normalized 24 kHz float audio as local TTS.
Text generation never waits for the voice queue. Muting/cancelling aborts the
current provider request and discards stale speech; failures leave text available
and never automatically start a local model. Provider latency is outside Capri's
control. Sentence requests are bounded to 45 seconds and are not automatically
retried or sent to another provider.

Only the sentence to be spoken and the configured model/voice IDs are sent.
The request contains no system prompt, tools, history, microphone audio, screen
images or stored memories. A spoken sentence may itself contain personal data.
Saving the connection performs no provider request. Keys are encrypted with
Windows DPAPI in `data/secrets/tts-api.json`; status IPC returns only whether a
key exists. A different provider origin requires a new key. Remote endpoints
require HTTPS; plain HTTP is restricted to loopback. Redirects are rejected.
Never share the secrets directory. Provider error bodies, text and audio are not
written into the external TTS diagnostics, which contain only technical codes
and elapsed time. DPAPI does not protect a compromised Windows account.

Protocol references: [OpenAI speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create),
[OpenAI audio formats](https://developers.openai.com/api/docs/guides/text-to-speech#supported-output-formats),
[ElevenLabs speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

Verification: `node --test tests/external-tts.test.mjs` covers persistence,
credentials, payload boundaries, PCM/WAV conversion, provider errors, cancellation
and a real HTTP sentence queue. `node tools/verify/verify-external-tts.mjs` opens
the actual Electron settings and tests encrypted saving, fixed-sample playback,
speaker activation and returning to local mode. These checks use synthetic audio
and no paid provider credential.
