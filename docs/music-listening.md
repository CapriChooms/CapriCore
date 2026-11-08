# Music listening

Music listening is an optional, local animation feature. It is disabled by
default. When enabled, Capri listens to Windows system playback, across playback
applications, and reacts after music is detected consistently. This is separate
from microphone recognition, system-audio wake words, screen observation, and
conversation. Turning off music listening stops its capture and classifier.

Use the musical-note button beside the voice controls, or open **Settings → Music
listening** and select **Start music listening**. The small detector downloads
on first use. **Stop music listening** stops system-audio capture. **Music
animations**, **Floating notes**, and **Move to the music** control the visual
reaction independently. Saved visual preferences do not restart recording after
Capri is relaunched; listening always requires an explicit start.

## Architecture and resource use

The renderer captures the permitted system-playback stream, selects the stronger
stereo channel to preserve phase-inverted audio,
resamples to 16 kHz mono, and sends bounded half-second Float32 PCM packets to
`MusicListeningService`. The service runs a dedicated Python child using the
existing CPU request-router environment, with the ASR environment as a fallback.
The child uses NumPy and ONNX Runtime; it does not load a language model, speech
recognizer, TensorFlow, PyTorch, or GPU provider.

The optional official Qualcomm YAMNet ONNX float export is approximately 13.25 MiB
to download and 14.39 MiB extracted. `config/music-detector.json` pins the release,
archive hash, and every extracted file's size and SHA-256. The host verifies these
before use; the Python worker verifies them again before loading the model. The
worker has no download or device-access functionality.

The NumPy frontend reproduces the pinned export's TorchAudio transform: a
400-sample periodic Hann window, 512-point FFT, 160-sample hop, 64 HTK mel bands
from 125 to 7500 Hz, and log magnitude with a 0.001 offset. The ONNX export emits
logits; these are converted to probabilities. A classification uses the latest
second of audio, with a three-result moving average. PCM storage is capped at
three seconds and is discarded on stop, reset, session changes, or packet gaps.
Inference uses one CPU thread. The host enters the music state after three
successive scores of at least 0.60; it leaves after three scores below 0.28 or
insufficient audio energy. This hysteresis avoids reacting to isolated syllables
or flickering between animation states.

On the local regression run, feature extraction and inference took a median
1.85 ms and a 95th percentile of 2.37 ms per one-second update. Those are observed
timings, not a performance guarantee for every computer. Capture and the worker
stop when the feature is disabled; the model does not occupy VRAM.

## Privacy

Audio travels only through bounded, private local process pipes. It is not
transcribed, saved to audio files, written to logs, added to conversation or
memory, or submitted to an API. Only music/speech/singing scores and a coarse
energy value reach the animation state. Capri's own speech playback suppresses
packets to avoid responding to its voice. Downloading the fixed public model
requires a network connection; classification does not.

Permission for music listening does not enable microphone recognition or grant
screen observation. It does not bypass the user's separate capture controls.
The input is what Windows supplies as system playback; application-exclusive,
protected, or differently routed audio can be unavailable.

## Reproducing verification

Run from the repository root, with Capri's existing router environment installed:

```powershell
node tools/verify/music-detection/fetch-benchmark.mjs
.\.runtime\router-venv\Scripts\python.exe tools/verify/music-detection/fetch_fleurs.py
.\.runtime\router-venv\Scripts\python.exe tools/verify/music-detection/fetch_commons.py
.\.runtime\router-venv\Scripts\python.exe tools/verify/music-detection/evaluate.py
.\.runtime\router-venv\Scripts\python.exe tools/verify/music-detection/test_detector.py
node tools/verify/music-detection/verify-service.mjs
node tools/verify/verify-music-provision.mjs
node tools/verify/verify-music-capture.mjs
node tools/verify/verify-music-animation.mjs
node tools/verify/verify-music-settings.mjs
```

The optional Commons fetch needs an existing `ffmpeg` solely to convert public
Ogg recordings for evaluation. HTTP rate limits may require retrying later.
The model should already be provisioned, or its pinned official archive extracted
into `.runtime/music-detection-research/yamnet-onnx-float`. The optional reference
frontend check can run in an existing environment that has TorchAudio:

```powershell
.\.runtime\voice-training-venv\Scripts\python.exe tools/verify/music-detection/test_detector.py --torchaudio-parity
```

The reference check measured a maximum log-mel absolute difference of 0.000288
against TorchAudio 2.6 on silence, a sine wave, and random noise. TorchAudio is
not installed for this music feature.

The completed sample contains 59 public real recordings: 25 MUSAN music clips,
two explicitly vocal Commons recordings, 12 MUSAN speech clips, 12 FLEURS speech
clips in Russian, German, French, Japanese, Mandarin and Arabic, and eight MUSAN
noise clips. It also tests 18 speech/music mixtures at three relative levels and
four synthetic negatives: silence, white noise, a fixed tone and periodic clicks.
At the 0.60 threshold, the deterministic held-out split detected 13 of 13 music
clips and rejected 24 of 24 non-music controls. The calibration split detected
14 of 14 music clips and rejected 12 of 12 non-music controls. Four of the 18
mixtures were missed, mainly when speech overwhelmed quiet music.

This is a small functional regression sample, not an exhaustive or unbiased
accuracy study. Some public source recordings may overlap AudioSet training.
Unusual unpitched music, short musical fragments and quiet music under loud speech
can be missed. Rhythmic speech, sound effects and game audio remain worthwhile
future adversarial test cases. The detector does not identify songs or guarantee
recognition of every music genre.

Reports, recording hashes, source URLs, attribution and any downloaded benchmark
audio remain under `.runtime/music-detection-research/`. No benchmark recording is
included in Capri source or release packages. Sources are [MUSAN](https://www.openslr.org/17/),
the bounded [MUSAN mirror](https://huggingface.co/datasets/dys-asr/musan-sr16000),
[Google FLEURS](https://huggingface.co/datasets/google/fleurs), and the licensed
Commons [ensemble recording](https://commons.wikimedia.org/wiki/File:Free_Software_Song_Bulgarian_Style.ogg)
and [isolated synthesized vocals](<https://commons.wikimedia.org/wiki/File:JamieP_-_Machine_Love_(Snippet,_Vocals_Only).ogg>).
