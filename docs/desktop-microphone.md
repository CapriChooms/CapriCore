# Desktop speech recognition

Enable the microphone with its toolbar button. It is off at every app launch and uses the input chosen in Settings → Microphone settings. Say "Capri" or "Hey, Capri", followed by your request. A sound and visual badge confirm activation, including expansion from signal core. A name spoken alone opens a ten-second command window without creating a chat message. See [wake activation](wake-phrase.md).

There is one speech recognizer: NVIDIA Parakeet TDT 0.6B v2 on CPU. It uses four-path modified beam search with conservative contextual vocabulary, rather than keeping only one greedy decoding path. `config/asr-vocabulary.json` prioritizes the name Capri and phrases such as clip that, screenshot and Spotify in the acoustic decoder. These are model hints, not substitutions of recognized words. Zipformer and the two-stage draft/correction path are removed. English speech is collected in memory and recognized as a whole after the selected silence duration (1 second by default). The interface shows LISTENING, then TRANSCRIBING; it displays only the completed transcript. Typed input remains intact. `autoSend: false` lets the user review the completed transcript before sending.

Silero VAD v5.1.2 detects speech and pauses without recognizing words. A 400 ms pre-roll and a small real audio tail preserve quiet initial consonants and the ends of words. Pauses shorter than the selected threshold stay inside the same utterance. If speech resumes while decoding is still running, the unfinished result is invalidated and the next recognition includes the original audio, the gap and the continuation. This is audio-level recognition with full phrase context, not concatenation of independently corrected drafts. Buffer limits still apply: prefer turns under the configured 30-second utterance limit.

## Installation and settings

Settings → Microphone settings opens the end-of-speech pause slider: 0.5-5.0 seconds in 0.1-second steps. Select a value and press Apply; Reset to 1 s restores the default slider value before applying. Shorter pauses respond sooner, while longer pauses allow more hesitation. The preference is stored privately in `data/desktop/speech.json`, independently of the input-device selection, and survives relaunch. Existing saved pause values are preserved. It overrides the config-file default. The input selector shows the device names and a system-default option. A saved device that is no longer connected is marked unavailable instead of silently selecting a different microphone.

The change reaches the already loaded ASR worker without restarting capture or reloading Parakeet. An utterance already in progress retains its original pause through decoding and any continuation. The replacement detector applies on the next idle audio packet, with its sample positions rebased to the existing in-memory history. Memory bounds allow for the longest selectable trailing pause. Enabling the microphone later also uses the saved value.

Run `setup-streaming-asr.cmd` once; the established launcher name is retained for compatibility. It provisions checksum-verified Parakeet INT8 weights (about 661 MB) and Silero (2.3 MB) in `data/speech/`, using the isolated `.runtime/asr-venv/`. Existing valid Parakeet files are reused. It no longer installs or requires a draft recognizer. Normal microphone startup is offline; a missing or corrupt model fails explicitly instead of falling back to a weaker model.

`config/companion-asr.json` selects the model, eight CPU recognition threads, VAD threshold/minimum speech duration, 1-second trailing pause, bounded 30-second utterances, automatic sending, wake settings and interruption. Restart Capri after editing it. ASR consumes no GPU memory. Optional Russian preview uses Parakeet TDT v3 directly with the same Silero detector; T-one is not required. Recognition-language changes stop capture and require enabling the microphone again.

Interruption remains available on an accurately detected wake address or a completed addressed command. AEC and a text echo guard reject obvious playback echoes; this is not speaker identification. "Stop listening" and "microphone off" disable capture without a wake address. The microphone button always provides an immediate stop.

## Data path

AudioWorklet resamples mono audio to 16 kHz float32 in 100 ms packets. Private bounded Electron IPC sends PCM to an owned Python worker over stdio. The renderer keeps a bounded five-second FIFO to absorb short UI or disk stalls without losing samples. A backlog is drained in order using packets of at most 200 ms; normal live packets are sent immediately without waiting for a batch. Sustained congestion still stops capture visibly rather than silently dropping speech. Silero runs on the capture thread; a single bounded executor runs Parakeet, leaving audio acknowledgements responsive. No Whisper pass, recordings on disk, HTTP ASR listener, cloud recognition or Qwen-based transcription repair are involved. Only the final addressed text enters the same ChatService and OpenClaw session as keyboard input. That text becomes ordinary conversation history.

While waiting for the name, up to three short prefixes per utterance can be checked by the _same Parakeet model_. These internal wake candidates are never displayed, sent as prompts or stored in history. The default check interval is 0.8 seconds of speech; final recognition takes priority. Once awake, prefix checks stop. A confirmed address carries token-derived word times on the same capture sample clock. Final decoding still hears the intact utterance, then excludes only the leading words in that confirmed time interval. Thus an address later spelled Copy does not enter the prompt, while an actual Copy that file command after the address remains intact. A one-frame margin protects the first command word; the gate does not strip the already-cleaned result twice. Speech activity refreshes the open command window while a longer request is being spoken. Final decoding also serves as a fallback when the early name check misses an address.

Packet limits, capture tokens and utterance revisions bound memory and reject stale results. Stopping capture cancels queued work and invalidates in-flight results. Audio remains in RAM; partial speech is discarded on stop. The device opens only after the user enables the microphone. Permission is restricted to audio from the trusted companion main frame; camera access remains denied. Device enumeration does not open a stream, and explicitly chosen devices use exact IDs rather than silently switching to a different microphone.

The command parser remains strict: Leave that, Copy that file, negations and quoted examples are not rewritten into screenshot requests. No Qwen pass guesses what the owner meant. Contextual decoding can still make mistakes, especially with noise or clipped consonants; synthetic checks do not establish accuracy for an individual microphone or accent. `decodingMethod: "greedy_search"` explicitly disables beam vocabulary biasing if evaluating another profile.

## Models and provenance

- [NVIDIA Parakeet v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2), [pinned sherpa-onnx INT8 export](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/tree/1ab9323565ddb038682214b292f588070a538ce2), CC BY 4.0. Sizes, hashes and revision: `config/asr-model-upstream.json`.
- [Silero VAD v5.1.2](https://github.com/snakers4/silero-vad/tree/6478567951ae5c9979ad7b234185b5515f4be7a1), MIT. Sizes, hashes and revision: `config/asr-vad-upstream.json`. [sherpa-onnx VAD integration](https://k2-fsa.github.io/sherpa/onnx/vad/silero-vad.html).

Provisioning installs attribution and the Silero license alongside the weights. Python versions remain pinned in `config/asr-requirements.lock.txt`.

## Verification

For repeatable command checks, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-asr-command-fixtures.ps1`, then `node scripts/verify-asr-commands.mjs`. Windows needs an installed English speech voice. Preparation renders local synthetic audio without playback. Verification feeds it in real time through the owned CPU ASR worker and the real wake gate, checks plain/fast clip requests, copy/leave commands, negations, a name spoken alone and unaddressed negative controls. It opens no microphone and executes no computer actions. Private report: `logs/asr-commands-verification.json`.

- `node --test tests/microphone.test.mjs tests/wake-phrase.test.mjs` checks accurate-only routing, activation, echo filtering, status, duplicate results, shared sending, capture lifecycle and permissions.
- `.runtime/asr-venv/Scripts/python.exe -m unittest discover -s tests -p '*asr*test.py' -v` checks silence, bounds, internal wake probes, resumed-speech invalidation, cancellation and failure without weaker fallback.
- `.runtime/asr-venv/Scripts/python.exe scripts/verify-asr.py` uses a public reference with an inserted one-second hesitation. `--ru` verifies the installed optional Russian preview. Reports: `logs/asr-en-verification.json` and `logs/asr-ru-verification.json`.
- `npm run verify:microphone` checks real CPU ASR, AudioWorklet, IPC, final-only UI, shared-session delivery and device release using Electron's fake microphone and isolated history.
- `npm run verify:wake` checks the name, feedback and expansion from core with generated/public audio. It never uses the owner's physical microphone or Qwen.
- `npm run verify:audio-inputs` checks device selection and persistence in an isolated profile.

In one Windows CPU benchmark, the public 6.6-second English reference with a one-second inserted pause decoded in about 0.30 seconds after VAD endpointing. This excludes waiting for the end-of-speech pause and downstream reply generation. A small fixture does not establish word-error rate or guarantee latency for arbitrary voices, accents, noise or longer turns.

Decoder references: [sherpa-onnx contextual vocabulary](https://k2-fsa.github.io/sherpa/onnx/hotwords/) and [the maintainer's Parakeet per-stream vocabulary example](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/test_asr_non_streaming_nemo_parakeet_tdt_v2_hotwords.js). The derived BPE vocabulary is cached under `.runtime/asr-vocab/` from the already checksum-verified tokens; model weights and GPU use are unchanged.

## Answering a question

When Capri ends a voice-origin answer with a question mark, she can reopen Listening after her playback finishes. This continuation is limited to the same enabled microphone session and the configured 5–30 second response window. Text-origin requests never enable capture. Disable Follow-up listening in the microphone settings to require the wake phrase every time. Typing a new request, disabling capture or ending the session cancels an automatic continuation.
