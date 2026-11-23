# Optional playback effects

Open **Settings → Voice effects**. Clean is the default and leaves the original voice untouched. Choose Subtle cybernetic, Radio link or Holographic room, or adjust intensity, effect mix, room/reverb, short delay, filtering and glitch frequency. Settings apply while speaking and persist privately in `data/desktop/voice-effects.json`. Reset to clean bypasses the graph. Invalid saved settings fall back to clean without destroying the original file.

Intensity, reverb, delay, filtering and glitch frequency now extend to 200%; effect mix extends to 100%. Existing presets and the original 0–100% effect range keep their previous sound. Above 100%, reverb blends in a longer procedural space, delay gains repeated echoes, radio filtering becomes narrower, drive becomes stronger and glitches become deeper and more frequent. The extra room is blended smoothly rather than replacing its impulse while talking. The mix can remove the clean component entirely; the filtered voice remains present and the output limiter bounds peaks.

**Preview voice** uses the selected real Capri voice with a fixed short English line. It works even with automatic voice replies muted, starts the local voice service on demand and preserves the mute setting. It waits for the current reply/playback to finish; preparing or playing a preview blocks repeated clicks. It creates no conversation message and calls no language model. Stop/Escape or muting stops preview too. Preview is optional; changing a slider never starts sound by itself.

The Synthetic preset adds an electronic timbre using ring modulation. Electronic voice blend (0–100%) and carrier frequency (20–200 Hz) adjust the effect independently. Zero electronic blend preserves the previous sound. The oscillator and modulation graph stay alive across sentence chunks; Stop clears the effect tail.

Processing uses a persistent local Web Audio graph after PCM synthesis. Source samples, adapter weights and TTS settings are unchanged. Filters, procedural room impulses and the echo retain state across audio chunks; the next reply starts with fresh state. Glitches briefly color the timbre without a zero-volume gate. Speaking and pose changes can trigger stronger interference when glitch frequency is nonzero; autonomous visual effects remain separate.

Effects are off by default. The enabled path limits peaks and uses smoothed controls. The clean path contains no limiter, room, filter or delay processing. Bypass/cancellation disconnects delayed sound so old effects cannot bleed into a new turn. Original settings retain their 360 ms tail allowance; extended settings smoothly increase it to at most two seconds. Stop clears tails immediately. Source-to-playback generation is unchanged; the dry path does not wait for an effect buffer.

Verification:

```powershell
node --test tests/voice-effects.test.mjs tests/desktop-voice.test.mjs
npm run verify:voice-effects
```

The Electron test uses the selected real voice, an isolated profile and no physical microphone. Physical output is muted for automation. Actual OfflineAudioContext rendering checks clean PCM identity, continuous state across a two-part split, finite output, bounded peaks, reverb tails, reset, live preview, isolated history and persistence through the real settings boundary. A 2.08-second sample rendered with the holographic graph in about 8.3 ms on this PC; clean and chunk-split errors were both zero in that run. This is an offline rendering cost, not an acoustic or end-to-end latency measurement. Report: `logs/voice-effects-verification.json`.

Subjective comparison on headphones/speakers remains a release listening check; numerical tests do not establish naturalness or a preferred effect strength. Use preview to choose a preset and keep Clean for an unprocessed voice.

Implementation references: [Web Audio convolution](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode), [smoothed AudioParam changes](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setTargetAtTime), [offline rendering](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext).
