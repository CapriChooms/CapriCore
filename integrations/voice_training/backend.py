"""English Turbo backend, native token layout and small, portable LoRA adapters.

Uses Resemble AI's MIT-licensed Chatterbox implementation (revision in config).
The English BPE vocabulary, voice encoder, decoder and watermark stay unchanged.
"""

import json
import os
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
import torch
from safetensors.torch import load_file, save_file
from torch import nn
from torch.nn import functional as F

from .dataset import ROOT, digest, write_json


def local_environment():
    os.environ["HF_HOME"] = str(ROOT / "data/speech/hf-cache")
    os.environ["TORCH_HOME"] = str(ROOT / "data/speech/torch-cache")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"


def load_engine(config):
    from .provision import verify_model

    verify_model(config)
    local_environment()
    from .low_memory import load_turbo_cpu
    engine = load_turbo_cpu(config["modelPath"])
    if len(engine.tokenizer) != 50276:
        raise ValueError(
            "The native Turbo English tokenizer must not be replaced or expanded"
        )
    return engine


class LoRAProjection(nn.Module):
    """GPT-2 Conv1D uses weight[in,out]; the adapter is B[out,r] @ A[r,in]."""

    def __init__(self, base, rank, alpha, dropout):
        super().__init__()
        self.base = base
        for parameter in base.parameters():
            parameter.requires_grad_(False)
        width_in, width_out = base.weight.shape
        self.lora_A = nn.Parameter(
            torch.empty(rank, width_in, dtype=torch.float32, device=base.weight.device)
        )
        self.lora_B = nn.Parameter(
            torch.zeros(width_out, rank, dtype=torch.float32, device=base.weight.device)
        )
        nn.init.kaiming_uniform_(self.lora_A, a=5**0.5)
        self.scale = alpha / rank
        self.dropout = nn.Dropout(dropout)

    @property
    def weight(self):
        return self.base.weight

    def forward(self, value):
        adapted = F.linear(F.linear(self.dropout(value), self.lora_A), self.lora_B)
        return self.base(value) + adapted * self.scale


def add_adapters(t3, options):
    from transformers.pytorch_utils import Conv1D

    for parameter in t3.parameters():
        parameter.requires_grad_(False)
    names = []
    for name, module in list(t3.named_modules()):
        if (
            name.startswith("tfmr.h.")
            and name.rsplit(".", 1)[-1] in {"c_attn", "c_proj", "c_fc"}
            and isinstance(module, Conv1D)
        ):
            parent_name, child = name.rsplit(".", 1)
            t3.get_submodule(parent_name)._modules[child] = LoRAProjection(
                module, options["rank"], options["alpha"], options["dropout"]
            )
            names.append(name)
    if not names:
        raise ValueError("Pinned Turbo projection layout was not found")
    return names


def adapter_state(t3):
    return {
        name: value.detach().float().cpu().contiguous()
        for name, value in t3.named_parameters()
        if name.endswith(("lora_A", "lora_B"))
    }


def save_adapter(t3, folder, metadata):
    folder.mkdir(parents=True, exist_ok=False)
    save_file(adapter_state(t3), str(folder / "adapter.safetensors"))
    write_json(folder / "adapter.json", metadata)


def load_adapter(t3, folder, config):
    metadata = json.loads((folder / "adapter.json").read_text(encoding="utf-8"))
    expected = json.loads(
        (ROOT / "config/voice-upstream.json").read_text(encoding="utf-8")
    )
    if metadata["upstream"] != expected or metadata["language"] != config["language"]:
        raise ValueError("Adapter belongs to a different base model or language")
    add_adapters(t3, metadata["adapter"])
    state = load_file(str(folder / "adapter.safetensors"))
    parameters = dict(t3.named_parameters())
    if set(state) != set(adapter_state(t3)):
        raise ValueError("Adapter projection set does not match the pinned model")
    with torch.no_grad():
        for name, value in state.items():
            if value.shape != parameters[name].shape or not torch.isfinite(value).all():
                raise ValueError(f"Invalid adapter tensor: {name}")
            parameters[name].copy_(value)
    return metadata


def verify_dataset(config):
    folder = config["datasetPath"]
    report = json.loads((folder / "quality-report.json").read_text(encoding="utf-8"))
    receipt = json.loads((folder / "dataset.json").read_text(encoding="utf-8"))
    if receipt.get("provisionalTranscripts") and not config.get(
        "allowProvisionalTranscripts", False
    ):
        raise ValueError(
            "This experimental dataset contains ASR-only transcripts; "
            "use its explicit provisional configuration"
        )
    if not report["ready"] or receipt["metadataSha256"] != digest(
        folder / "metadata.csv"
    ):
        raise ValueError("Dataset changed or is not ready; run prepare again")
    for row in report["clips"]:
        source = folder / row["file"]
        if digest(source) != row["sourceSha256"]:
            raise ValueError(f"Source changed after approval/preparation: {row['id']}")
    for row in receipt["clips"]:
        if digest(folder / "prepared" / f"{row['id']}.wav") != row["audioSha256"]:
            raise ValueError(f"Prepared audio changed: {row['id']}")
    bank = json.loads((folder / "reference-bank.json").read_text(encoding="utf-8"))
    for reference in bank.values():
        if digest(Path(reference["audio"])) != reference["sha256"]:
            raise ValueError("Reference bank changed; run prepare again")
    return receipt, bank


def build_cache(config):
    receipt, bank = verify_dataset(config)
    torch.set_num_threads(8)
    folder = config["datasetPath"]
    cache = folder / "cache"
    cache.mkdir(exist_ok=True)
    engine = load_engine(config)
    references = {}
    with torch.inference_mode():
        for emotion, reference in bank.items():
            engine.prepare_conditionals(reference["audio"], norm_loudness=False)
            references[emotion] = (
                engine.conds.t3.speaker_emb.cpu().numpy(),
                engine.conds.t3.cond_prompt_speech_tokens.cpu().numpy(),
            )
        for split in ["train", "validation", "test"]:
            rows = [
                json.loads(line)
                for line in (folder / f"{split}.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line
            ]
            for row in rows:
                from chatterbox.tts_turbo import punc_norm

                audio, rate = sf.read(row["audio"], dtype="float32")
                audio = soxr.resample(audio, rate, 16000, quality="HQ")
                codes, lengths = engine.s3gen.tokenizer([audio])
                codes = codes[0, : int(lengths[0])].cpu().numpy()
                text = (
                    engine.tokenizer(punc_norm(row["text"]), return_tensors="pt")
                    .input_ids[0]
                    .cpu()
                    .numpy()
                )
                if (
                    len(text) > config["training"]["maxTextTokens"]
                    or len(codes) > config["training"]["maxSpeechTokens"]
                ):
                    raise ValueError(
                        f"Clip {row['id']} exceeds a token limit. Split it manually; no silent truncation is performed."
                    )
                speaker, prompt = references.get(row["emotion"], references["neutral"])
                np.savez_compressed(
                    cache / f"{row['id']}.npz",
                    text=text,
                    speech=codes,
                    speaker=speaker,
                    prompt=prompt,
                )
                print(f"Cached {split}: {row['id']}", flush=True)
    cache_files = {file.name: digest(file) for file in sorted(cache.glob("*.npz"))}
    write_json(
        cache / "receipt.json",
        {
            "datasetSha256": digest(folder / "dataset.json"),
            "referenceBankSha256": digest(folder / "reference-bank.json"),
            "manifests": {
                split: digest(folder / f"{split}.jsonl")
                for split in ["train", "validation", "test"]
            },
            "files": cache_files,
            "upstream": json.loads(
                (ROOT / "config/voice-upstream.json").read_text(encoding="utf-8")
            ),
        },
    )
    return len(cache_files)


def cached_rows(config, split):
    verify_dataset(config)
    folder = config["datasetPath"]
    receipt = json.loads((folder / "cache/receipt.json").read_text(encoding="utf-8"))
    if receipt["datasetSha256"] != digest(folder / "dataset.json") or receipt[
        "referenceBankSha256"
    ] != digest(folder / "reference-bank.json"):
        raise ValueError("Cached tokens are stale; run cache again")
    if receipt["upstream"] != json.loads(
        (ROOT / "config/voice-upstream.json").read_text(encoding="utf-8")
    ):
        raise ValueError("Token cache belongs to another model revision")
    if receipt["manifests"][split] != digest(folder / f"{split}.jsonl"):
        raise ValueError("Dataset split changed; run prepare and cache again")
    rows = [
        json.loads(line)
        for line in (folder / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    for row in rows:
        file = folder / "cache" / f"{row['id']}.npz"
        if receipt["files"].get(file.name) != digest(file):
            raise ValueError(f"Cached clip changed: {row['id']}")
    return rows


def speech_loss(t3, arrays, device):
    """Native Turbo layout: [conditioning][English BPE][BOS,speech] -> [speech,EOS]."""
    from chatterbox.models.t3.modules.cond_enc import T3Cond

    text = torch.as_tensor(
        arrays["text"].copy(), device=device, dtype=torch.long
    ).unsqueeze(0)
    speech = torch.as_tensor(
        arrays["speech"].copy(), device=device, dtype=torch.long
    ).unsqueeze(0)
    bos = torch.full((1, 1), t3.hp.start_speech_token, dtype=torch.long, device=device)
    eos = torch.full((1, 1), t3.hp.stop_speech_token, dtype=torch.long, device=device)
    inputs, labels = torch.cat((bos, speech), dim=1), torch.cat((speech, eos), dim=1)
    condition = T3Cond(
        speaker_emb=torch.as_tensor(
            arrays["speaker"].copy(), device=device, dtype=t3.speech_emb.weight.dtype
        ),
        cond_prompt_speech_tokens=torch.as_tensor(
            arrays["prompt"].copy(), device=device, dtype=torch.long
        ),
    )
    embeds, _ = t3.prepare_input_embeds(
        t3_cond=condition, text_tokens=text, speech_tokens=inputs
    )
    output = t3.tfmr(inputs_embeds=embeds, use_cache=False, return_dict=True)
    logits = t3.speech_head(output.last_hidden_state[:, -inputs.shape[1] :])
    return F.cross_entropy(
        logits.float().reshape(-1, logits.shape[-1]), labels.reshape(-1)
    ), labels.numel()


def synthesize(engine, text, reference, device="cuda:0", seed=417, max_tokens=800):
    """CPU waveform decoder; native reference conditioning and watermark retained."""
    from chatterbox.models.s3gen.const import S3GEN_SIL
    from chatterbox.tts_turbo import punc_norm

    torch.manual_seed(seed)
    if reference is not None:
        engine.prepare_conditionals(reference, norm_loudness=False)
    if engine.conds is None:
        raise ValueError("Reference conditioning is required")
    condition = engine.conds.t3.to(device=device)
    text_tokens = engine.tokenizer(punc_norm(text), return_tensors="pt").input_ids.to(
        device
    )
    with (
        torch.inference_mode(),
        torch.autocast(
            "cuda",
            dtype=torch.bfloat16,
            enabled=str(device).startswith("cuda")
            and engine.t3.speech_emb.weight.dtype == torch.bfloat16,
        ),
    ):
        tokens = engine.t3.inference_turbo(
            t3_cond=condition,
            text_tokens=text_tokens,
            max_gen_len=max_tokens,
            temperature=0.8,
            top_p=0.95,
            top_k=1000,
            repetition_penalty=1.2,
        )
    if tokens.shape[-1] >= max_tokens:
        raise RuntimeError(
            "Speech hit its generation limit; reject this sample rather than save a cut-off reply"
        )
    tokens = tokens[tokens < 6561].to("cpu")
    tokens = torch.cat((tokens, torch.tensor([S3GEN_SIL] * 3, dtype=torch.long)))
    with torch.inference_mode():
        audio, _ = engine.s3gen.inference(
            speech_tokens=tokens, ref_dict=engine.conds.gen, n_cfm_timesteps=2
        )
    audio = audio.squeeze().detach().cpu().numpy()
    audio = engine.watermarker.apply_watermark(audio, sample_rate=engine.sr)
    if not np.isfinite(audio).all():
        raise RuntimeError("Non-finite generated audio")
    return audio, engine.sr
