"""Single-speaker, batch-one LoRA; the held-out test split is never optimized."""

import copy
import json
import math
import random
import secrets
import time
from datetime import datetime, timezone

import numpy as np
import torch

from .backend import (
    adapter_state,
    add_adapters,
    cached_rows,
    load_engine,
    save_adapter,
    speech_loss,
)
from .dataset import ROOT, digest, write_json
from .provision import verify_model


def cuda_preflight(config):
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError("This recipe needs an NVIDIA CUDA GPU with bfloat16 support")
    free, total = torch.cuda.mem_get_info()
    if free < config["training"]["minimumFreeVramGiB"] * 1024**3:
        raise RuntimeError(
            "Not enough free VRAM. Use stop.cmd to unload Capri before training, then retry."
        )
    return {
        "gpu": torch.cuda.get_device_name(),
        "freeGiB": round(free / 1024**3, 2),
        "totalGiB": round(total / 1024**3, 2),
    }


def training_model(config):
    verify_model(config)
    cuda_preflight(config)
    torch.set_num_threads(8)
    torch.manual_seed(config["seed"])
    engine = load_engine(config)
    # Keep waveform and speaker encoders on CPU; only T3 and its adapters train.
    engine.t3.to(device="cuda:0", dtype=torch.bfloat16)
    torch.manual_seed(config["seed"])
    projections = add_adapters(engine.t3, config["training"])
    if config["training"]["gradientCheckpointing"]:
        # Turbo deletes GPT-2's unused wte. Transformers' checkpoint hook must
        # use the real, unchanged English text embedding table instead.
        engine.t3.tfmr.get_input_embeddings = lambda: engine.t3.text_emb
        engine.t3.tfmr.gradient_checkpointing_enable(
            gradient_checkpointing_kwargs={"use_reentrant": False}
        )
    return engine, projections


def evaluate(t3, records, cache):
    t3.eval()
    total, count = 0.0, 0
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
        for row in records:
            with np.load(cache / f"{row['id']}.npz", allow_pickle=False) as arrays:
                loss, tokens = speech_loss(t3, arrays, "cuda:0")
            if not torch.isfinite(loss):
                raise RuntimeError(
                    "Non-finite validation loss; the checkpoint is rejected"
                )
            total += loss.item() * tokens
            count += tokens
    if not count:
        raise ValueError("Validation split must contain speech")
    return total / count


def train(config):
    train_rows = cached_rows(config, "train")
    val_rows = cached_rows(config, "validation")
    if not train_rows or not val_rows:
        raise ValueError("Training and validation data are both required")
    engine, projections = training_model(config)
    t3, options = engine.t3, config["training"]
    parameters = [parameter for parameter in t3.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(
        parameters, lr=options["learningRate"], weight_decay=0.01
    )
    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        + "-"
        + secrets.token_hex(3)
    )
    folder = config["datasetPath"] / "runs" / run_id
    folder.mkdir(parents=True, exist_ok=False)
    cache = config["datasetPath"] / "cache"
    metadata = {
        "schemaVersion": 1,
        "engine": config["engine"],
        "language": config["language"],
        "profile": config["profile"],
        "adapter": {key: options[key] for key in ["rank", "alpha", "dropout"]},
        "seed": config["seed"],
        "upstream": json.loads(
            (ROOT / "config/voice-upstream.json").read_text(encoding="utf-8")
        ),
        "datasetSha256": digest(config["datasetPath"] / "dataset.json"),
        "provisionalTranscripts": json.loads(
            (config["datasetPath"] / "dataset.json").read_text(encoding="utf-8")
        ).get("provisionalTranscripts", False),
        "projections": projections,
        "trainableParameters": sum(parameter.numel() for parameter in parameters),
        "recipe": options,
    }
    write_json(folder / "run.json", metadata)
    best, stale, step = evaluate(t3, val_rows, cache), 0, 0
    write_json(
        folder / "best.json",
        {
            "checkpoint": None,
            "validationLoss": best,
            "note": "Baseline before adaptation. A trained checkpoint replaces this only if validation loss improves; listening is still required.",
        },
    )
    write_json(folder / "baseline-validation.json", {"validationLoss": best})
    print(
        json.dumps({
            "run": str(folder),
            "baselineValidationLoss": best,
            "trainClips": len(train_rows),
            "validationClips": len(val_rows),
        }),
        flush=True,
    )
    planned_steps = (
        math.ceil(len(train_rows) / options["gradientAccumulation"]) * options["epochs"]
    )
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    for epoch in range(1, options["epochs"] + 1):
        order = list(train_rows)
        random.Random(config["seed"] + epoch).shuffle(order)
        t3.train()
        total_loss, total_tokens = 0.0, 0
        for offset in range(0, len(order), options["gradientAccumulation"]):
            group = order[offset : offset + options["gradientAccumulation"]]
            optimizer.zero_grad(set_to_none=True)
            for row in group:
                with np.load(cache / f"{row['id']}.npz", allow_pickle=False) as arrays:
                    with torch.autocast("cuda", dtype=torch.bfloat16):
                        loss, tokens = speech_loss(t3, arrays, "cuda:0")
                    if not torch.isfinite(loss):
                        raise RuntimeError(
                            "Non-finite training loss; stop rather than save damaged weights"
                        )
                    (loss / len(group)).backward()
                total_loss += loss.item() * tokens
                total_tokens += tokens
            torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
            step += 1
            warmup = max(1, round(planned_steps * 0.05))
            ratio = (
                min(1.0, step / warmup)
                if step <= warmup
                else 0.5
                * (
                    1
                    + math.cos(
                        math.pi * (step - warmup) / max(1, planned_steps - warmup)
                    )
                )
            )
            for group_options in optimizer.param_groups:
                group_options["lr"] = options["learningRate"] * ratio
            optimizer.step()
        validation = evaluate(t3, val_rows, cache)
        metrics = {
            "epoch": epoch,
            "optimizerSteps": step,
            "trainLoss": total_loss / total_tokens,
            "validationLoss": validation,
            "seconds": round(time.monotonic() - started, 2),
            "peakReservedGiB": round(torch.cuda.max_memory_reserved() / 1024**3, 3),
        }
        checkpoint = folder / f"epoch-{epoch:03d}"
        save_adapter(t3, checkpoint, {**metadata, "metrics": metrics})
        with (folder / "metrics.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(metrics) + "\n")
        print(json.dumps(metrics), flush=True)
        if validation < best - options["minValidationImprovement"]:
            best, stale = validation, 0
            write_json(
                folder / "best.json",
                {
                    "checkpoint": checkpoint.name,
                    "validationLoss": best,
                    "note": "Lowest validation loss is a candidate, not proof of the best perceived voice. Listen before exporting.",
                },
            )
        else:
            stale += 1
        if stale >= options["earlyStoppingPatience"]:
            break
    write_json(
        folder / "completion.json",
        {
            "status": "completed",
            "epochs": epoch,
            "optimizerSteps": step,
            "seconds": round(time.monotonic() - started, 2),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "best": json.loads((folder / "best.json").read_text(encoding="utf-8")),
            "note": "Completion confirms optimization, not perceptual voice quality.",
        },
    )
    return folder


def qualify(config):
    """One disposable synthetic-token optimizer step: execution/VRAM, not voice quality."""
    engine, projections = training_model(config)
    if engine.conds is None:
        raise ValueError("The official diagnostic conditioning file is missing")
    options = copy.deepcopy(config["training"])
    condition = engine.conds.t3
    raw_prompt = condition.cond_prompt_speech_tokens.cpu().numpy().reshape(-1)
    prompt = np.resize(raw_prompt, (1, engine.t3.hp.speech_cond_prompt_len))
    text = engine.tokenizer(
        "A short qualification run.", return_tensors="np"
    ).input_ids[0]
    arrays = {
        "text": np.resize(text, options["maxTextTokens"]),
        "speech": np.resize(raw_prompt, options["maxSpeechTokens"]),
        "speaker": condition.speaker_emb.cpu().numpy(),
        "prompt": prompt,
    }
    before = {key: value.clone() for key, value in adapter_state(engine.t3).items()}
    parameters = [
        parameter for parameter in engine.t3.parameters() if parameter.requires_grad
    ]
    optimizer = torch.optim.AdamW(parameters, lr=options["learningRate"])
    engine.t3.train()
    torch.cuda.reset_peak_memory_stats()
    with torch.autocast("cuda", dtype=torch.bfloat16):
        loss, tokens = speech_loss(engine.t3, arrays, "cuda:0")
    if not torch.isfinite(loss):
        raise RuntimeError("Qualification loss is not finite")
    loss.backward()
    torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
    optimizer.step()
    after = adapter_state(engine.t3)
    if not any(not torch.equal(before[key], after[key]) for key in before):
        raise RuntimeError("No adapter changed during the optimizer step")
    report = {
        "passed": True,
        "kind": "synthetic-token-execution-only",
        "loss": loss.item(),
        "tokens": tokens,
        "textTokens": len(arrays["text"]),
        "referenceTokens": prompt.shape[1],
        "projections": len(projections),
        "trainableParameters": sum(parameter.numel() for parameter in parameters),
        "peakReservedGiB": round(torch.cuda.max_memory_reserved() / 1024**3, 3),
        "gpu": torch.cuda.get_device_name(),
        "note": "Not trained on Capri, not a quality evaluation, no adapter exported.",
    }
    write_json(ROOT / "logs/voice-training-qualification.json", report)
    return report
