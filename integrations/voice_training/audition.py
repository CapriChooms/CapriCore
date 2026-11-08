"""Unseen English prompts, blind A/B listening and an explicitly selected export."""

import html
import json
import random
import secrets
import shutil
import time

import soundfile as sf
import torch

from .backend import load_adapter, load_engine, synthesize, verify_dataset
from .dataset import ROOT, digest, inside, write_json
from .provision import verify_model


def make_preview(config, text, emotion="neutral", adapter=None):
    torch.set_num_threads(8)
    _, bank = verify_dataset(config)
    verify_model(config)
    selected = emotion if emotion in bank else "neutral"
    engine = load_engine(config)
    dtype = (
        torch.float32
        if config["inference"]["precision"] == "float32"
        else torch.bfloat16
    )
    engine.t3.to(device="cuda:0", dtype=dtype)
    if adapter:
        load_adapter(engine.t3, adapter, config)
    engine.t3.eval()
    audio, rate = synthesize(
        engine,
        text,
        bank[selected]["audio"],
        seed=config["seed"],
        max_tokens=config["inference"]["maxSpeechTokens"],
    )
    folder = config["datasetPath"] / "previews"
    folder.mkdir(exist_ok=True)
    file = folder / f"{secrets.token_hex(6)}.wav"
    sf.write(file, audio, rate, subtype="FLOAT")
    write_json(
        file.with_suffix(".json"),
        {
            "text": text,
            "requestedEmotion": emotion,
            "referenceStyle": selected,
            "adapter": str(adapter) if adapter else None,
            "sampleRate": rate,
            "seconds": len(audio) / rate,
        },
    )
    return file


def blind_review(config, adapter, limit=20):
    torch.set_num_threads(8)
    _, bank = verify_dataset(config)
    verify_model(config)
    prompts_file = ROOT / f"config/voice-evaluation.{config['language']}.json"
    prompts = json.loads(prompts_file.read_text(encoding="utf-8"))["prompts"][:limit]
    folder = config["datasetPath"] / "reviews" / secrets.token_hex(6)
    folder.mkdir(parents=True, exist_ok=False)
    engine = load_engine(config)
    dtype = (
        torch.float32
        if config["inference"]["precision"] == "float32"
        else torch.bfloat16
    )
    engine.t3.to(device="cuda:0", dtype=dtype)
    samples = {}
    for candidate in ["baseline", "adapter"]:
        if candidate == "adapter":
            load_adapter(engine.t3, adapter, config)
        engine.t3.eval()
        for prompt in prompts:
            reference = prompt["emotion"] if prompt["emotion"] in bank else "neutral"
            started = time.monotonic()
            audio, rate = synthesize(
                engine,
                prompt["text"],
                bank[reference]["audio"],
                seed=config["seed"],
                max_tokens=config["inference"]["maxSpeechTokens"],
            )
            elapsed = time.monotonic() - started
            filename = secrets.token_hex(8) + ".wav"
            sf.write(folder / filename, audio, rate, subtype="FLOAT")
            samples[(candidate, prompt["id"])] = {
                "file": filename,
                "candidate": candidate,
                "referenceStyle": reference,
                "seconds": len(audio) / rate,
                "generationSeconds": elapsed,
                "rtf": elapsed / (len(audio) / rate),
            }
            print(f"Generated {candidate}: {prompt['id']}", flush=True)
    rng = random.Random(config["seed"])
    sections, key = [], []
    ratings = [
        "prompt_id,naturalness_A,naturalness_B,identity_A,identity_B,expression_A,expression_B,clarity_A,clarity_B,preferred,notes"
    ]
    for prompt in prompts:
        order = ["baseline", "adapter"]
        rng.shuffle(order)
        pair = {
            label: samples[(candidate, prompt["id"])]
            for label, candidate in zip("AB", order)
        }
        key.append({"id": prompt["id"], **pair})
        players = "".join(
            f'<div><strong>{label}</strong><audio controls preload="none" src="{pair[label]["file"]}"></audio></div>'
            for label in "AB"
        )
        sections.append(
            f"<section><h2>{html.escape(prompt['id'])}</h2><p>{html.escape(prompt['text'])}</p>{players}</section>"
        )
        ratings.append(prompt["id"] + "," * 10)
    page = (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Capri blind voice comparison</title><style>body{font:16px system-ui;background:#10131a;color:#eef3f7;max-width:850px;margin:35px auto;padding:20px}section{border-top:1px solid #3d4954;padding:20px 0}audio{display:block;width:100%;margin:8px 0 18px}h2{font-size:15px;color:#b3f6f3}</style><h1>Blind voice comparison</h1><p>Rate naturalness, voice identity, expression and clarity separately (1–5) in ratings.csv. Listen before opening private-key.json. Neither voice is assumed to be better.</p>'
        + "".join(sections)
        + "</html>"
    )
    (folder / "listen.html").write_text(page, encoding="utf-8")
    (folder / "ratings.csv").write_text("\n".join(ratings) + "\n", encoding="utf-8")
    write_json(
        folder / "private-key.json",
        {
            "adapterSha256": digest(adapter / "adapter.safetensors"),
            "promptsSha256": digest(prompts_file),
            "pairs": key,
        },
    )
    return folder / "listen.html"


def export_voice(config, adapter, name):
    import re

    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,60}", name):
        raise ValueError("Export name must be a short filename without paths")
    _, bank = verify_dataset(config)
    metadata = json.loads((adapter / "adapter.json").read_text(encoding="utf-8"))
    if metadata["datasetSha256"] != digest(config["datasetPath"] / "dataset.json"):
        raise ValueError(
            "Export references must match the dataset used to train this adapter"
        )
    upstream = json.loads(
        (ROOT / "config/voice-upstream.json").read_text(encoding="utf-8")
    )
    if metadata["upstream"] != upstream or metadata["language"] != config["language"]:
        raise ValueError("Adapter does not match this engine and language")
    folder = inside(config["datasetPath"] / "exports", name)
    folder.mkdir(parents=True, exist_ok=False)
    for filename in ["adapter.json", "adapter.safetensors"]:
        shutil.copy2(adapter / filename, folder / filename)
    references = {}
    (folder / "references").mkdir()
    for emotion, reference in bank.items():
        target = folder / "references" / f"{emotion}.wav"
        shutil.copy2(reference["audio"], target)
        references[emotion] = {
            "file": f"references/{emotion}.wav",
            "sha256": digest(target),
        }
    write_json(
        folder / "voice-profile.json",
        {
            "schemaVersion": 1,
            "id": name,
            "character": config["profile"],
            "language": config["language"],
            "engine": config["engine"],
            "baseModel": upstream["model"],
            "adapter": "adapter.safetensors",
            "adapterConfig": "adapter.json",
            "adapterSha256": digest(folder / "adapter.safetensors"),
            "references": references,
            "capabilities": {
                "languages": ["en"],
                "referenceStyles": sorted(references),
                "nativeTags": ["[laugh]", "[chuckle]"],
                "instructionControl": False,
                "tokenStreaming": False,
            },
            "sampleRate": 24000,
            "selection": "Explicitly exported by the user; audition quality remains a human judgement.",
        },
    )
    return folder
