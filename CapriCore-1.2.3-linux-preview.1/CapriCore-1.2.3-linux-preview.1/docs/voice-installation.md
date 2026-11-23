# Installing a voice

## During Capri Setup

Choose your **Conversation language**, then select **Spoken voice → Chatterbox / Capri /
Conversation language** on supported GPU hardware. Setup installs the matching voice, its Python
dependencies and model files automatically in your Capri installation. You do not
need to download a voice ZIP, create a voice folder or train a model.

English uses the included trained Capri voice. Supported non-English languages
use one shared multilingual model (BETA). For example, choosing Portuguese with
voice replies selected installs the multilingual model for Portuguese. It does
not download the English Turbo model just to enable a non-English voice. Accent
and similarity vary by language.

**Text replies only** skips the voice runtime and models. The small included
reference/profile pack is retained so you can enable speech later. **Import
another compatible voice pack** is an advanced option for an existing exported
pack; it is not a destination folder picker and is not needed for Capri's voice.

Chatterbox requires compatible NVIDIA CUDA hardware or one of the supported AMD ROCm GPUs on Windows 11
(experimental); it does not support every AMD card. For compatible languages,
**Hugging Face · Qwen3-TTS (CPU, BETA)** provides a separate CPU voice option using
Capri's included reference. It needs additional system RAM and may synthesize slower
than real time. See [speech requirements](../README.md#optional-speech-and-local-components)
and [AMD voice compatibility](amd-voice.md). Text replies and microphone recognition remain available on other
supported hardware. English Turbo and the shared multilingual model each contain
about 3 GB of weights. Setup also budgets for the selected Python/GPU runtime,
package cache and temporary files. Review its separate disk and download estimates
before starting.

On each Capri launch, microphone capture and voice replies start off. Enable the
microphone or speaker button when needed; installed language choices and model
files are retained.

## After installation

1. Open **Languages** in Capri and choose your **Conversation language**. To choose
   a different supported backend, open **Settings → Language model → Voice models · Hugging Face**.
2. Set **Spoken voice** to **Automatic**. The status shows whether its files are
   installed. If anything is missing, click **Install and enable**.
3. Keep Capri open. Progress appears in the same panel. You may close the panel
   and reopen it to see the current installation.
4. When installation succeeds, Capri applies the selected language and enables
   voice replies automatically. Microphone capture is not enabled automatically.

The same action installs the selected recognition components if they are missing.
Choosing **Text replies only** with a missing recognition model installs recognition
without downloading a voice or requiring an NVIDIA GPU.

Cancel stops the owned installation command. Verified/partial downloads and package
caches remain available for a retry. If Capri closes unexpectedly, reopen Languages
and use **Install and enable** again. Permanent network blocks, insufficient disk
space or unsupported hardware still need to be resolved. On failure, **Report a
problem** opens Capri's diagnostic export; the bounded installation log is included
with the normal runtime logs. Reports are saved locally and are not uploaded.

The release attachment **capri-en-v1.zip** contains a reference/profile/adapter
pack, not Python dependencies or a complete speech model. It is included in Capri
Setup; downloading it separately is unnecessary for the normal installation. The
public release and automatic recovery use **CapriChooms/CapriCore** without a GitHub
account or token. A gated upstream Hugging Face model may have its own access terms.
