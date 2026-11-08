"""Native Turbo token layout and FP32 decoder on a configurable device."""
import time

import numpy as np
import torch


class VoiceCancelled(RuntimeError):
    pass


class SpeechGenerationLimit(RuntimeError):
    """No partial waveform is available; one bounded phrase retry is safe."""
    code = 'CAPRI_VOICE_SPEECH_LIMIT'

    def __init__(self):
        super().__init__('Speech exceeded its generation limit')


def check_cancelled(event):
    if event is not None and event.is_set():
        raise VoiceCancelled("Speech was cancelled")


@torch.inference_mode()
def render(engine, text, *, device, reference, seed, max_tokens, cancelled=None):
    from chatterbox.models.s3gen.const import S3GEN_SIL
    from chatterbox.tts_turbo import punc_norm

    started = time.perf_counter()
    check_cancelled(cancelled)
    torch.manual_seed(seed)
    tokens = engine.t3.inference_turbo(
        t3_cond=engine.conds.t3.to(device="cuda:0"),
        text_tokens=engine.tokenizer(punc_norm(text), return_tensors="pt").input_ids.to("cuda:0"),
        max_gen_len=max_tokens, temperature=.8, top_p=.95, top_k=1000,
        repetition_penalty=1.2,
    )
    if tokens.shape[-1] >= max_tokens:
        raise SpeechGenerationLimit()
    check_cancelled(cancelled)
    tokens = tokens[tokens < 6561].to(device)
    tokens = torch.cat((tokens, torch.tensor([S3GEN_SIL] * 3, device=device, dtype=torch.long))).unsqueeze(0)
    if device.startswith('cuda'):
        torch.cuda.synchronize()
    token_done = time.perf_counter()
    if device == "cpu":
        wave, _ = engine.s3gen.inference(speech_tokens=tokens, ref_dict=reference, n_cfm_timesteps=2)
    else:
        # Keep the original CPU noise generator, two flow steps and watermark.
        noise = torch.randn(1, 80, tokens.shape[-1] * 2, device="cpu").to(device) if engine.s3gen.meanflow else None
        mel, _ = engine.s3gen.flow.inference(
            token=tokens, token_len=torch.tensor([tokens.shape[-1]], device=device),
            finalize=True, noised_mels=noise, n_timesteps=2,
            meanflow=engine.s3gen.meanflow, **reference,
        )
        check_cancelled(cancelled)
        wave, _ = engine.s3gen.mel2wav.inference(
            speech_feat=mel, cache_source=torch.zeros(1, 1, 0, device=device),
        )
        wave[:, :engine.s3gen.trim_fade.numel()] *= engine.s3gen.trim_fade
    check_cancelled(cancelled)
    audio = wave.squeeze().detach().cpu().numpy()
    audio = engine.watermarker.apply_watermark(audio, sample_rate=engine.sr)
    if not len(audio) or not np.isfinite(audio).all():
        raise RuntimeError("Empty or invalid synthesized audio")
    finished = time.perf_counter()
    return audio.astype("<f4").tobytes(), engine.sr, {
        "tokenMs": round((token_done - started) * 1000, 2),
        "decoderMs": round((finished - token_done) * 1000, 2),
        "totalMs": round((finished - started) * 1000, 2),
        "speechTokens": tokens.shape[-1] - 3,
    }
