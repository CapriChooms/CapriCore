"""Lossless, reviewed, scene-separated voice datasets; source recordings stay intact."""

import csv
import hashlib
import json
import math
import random
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ["id", "file", "text", "emotion", "scene", "split", "approved"]
SPLITS = {"train", "validation", "test", "reference"}


def read_config(file=None):
    config = json.loads(
        Path(file or ROOT / "config/voice-training.json").read_text(
            encoding="utf-8-sig"
        )
    )
    if file is None:
        from integrations.voice_runtime.profile_settings import merge_local_settings
        config = merge_local_settings(ROOT, 'voice-training', config)
    if config.get("schemaVersion") != 1 or config.get("engine") != "chatterbox-turbo":
        raise ValueError("Unsupported training configuration")
    if (
        config["language"] not in config["enabledLanguages"]
        or config["language"] != "en"
    ):
        raise ValueError(
            "This backend supports English only; another language needs its own backend"
        )
    if config["sampleRate"] != 24000 or not 0 < config["maxDatasetSeconds"] <= 300:
        raise ValueError("Use 24 kHz and a dataset budget of at most 300 seconds")
    if type(config.get("allowProvisionalTranscripts", False)) is not bool:
        raise ValueError("allowProvisionalTranscripts must be a boolean")
    options = config["training"]
    for key, low, high in [
        ("rank", 1, 64),
        ("alpha", 1, 256),
        ("epochs", 1, 50),
        ("gradientAccumulation", 1, 32),
        ("maxTextTokens", 16, 1024),
        ("maxSpeechTokens", 25, 2048),
        ("earlyStoppingPatience", 1, 50),
    ]:
        if type(options[key]) is not int or not low <= options[key] <= high:
            raise ValueError(f"Invalid training option: {key}")
    if not 0 <= options["dropout"] < 1 or not 0 < options["learningRate"] <= 0.001:
        raise ValueError("Invalid dropout or learning rate")
    config["datasetPath"] = inside(ROOT, config["datasetDir"])
    config["modelPath"] = inside(ROOT, config["modelDir"])
    return config


def inside(folder, relative):
    candidate = (folder / relative).resolve()
    if not folder.resolve().is_relative_to(
        ROOT.resolve()
    ) or not candidate.is_relative_to(folder.resolve()):
        raise ValueError(f"Path must stay inside {folder.name}: {relative}")
    return candidate


def digest(file):
    with Path(file).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix(file.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    temporary.replace(file)


def init_dataset(config):
    folder = config["datasetPath"]
    for child in ["raw", "prepared", "references", "runs"]:
        (folder / child).mkdir(parents=True, exist_ok=True)
    metadata = folder / "metadata.csv"
    if not metadata.exists():
        with metadata.open("w", encoding="utf-8", newline="") as handle:
            csv.DictWriter(handle, fieldnames=FIELDS).writeheader()
    return folder


def scan(config):
    folder = init_dataset(config)
    with (folder / "metadata.csv").open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise ValueError(
                "metadata.csv has unexpected columns; preserve the documented header"
            )
        rows = list(reader)
    known = {row["file"] for row in rows}
    ids = {row["id"] for row in rows}
    added = 0
    for file in sorted((folder / "raw").rglob("*")):
        if not file.is_file() or file.suffix.lower() not in {".wav", ".flac"}:
            continue
        relative = file.relative_to(folder).as_posix()
        if relative in known:
            continue
        name = re.sub(r"[^a-zA-Z0-9_-]", "_", file.stem)[:55] or "clip"
        name += "_" + hashlib.sha256(relative.encode()).hexdigest()[:8]
        if name in ids:
            raise ValueError(f"Duplicate clip ID: {name}")
        rows.append(
            dict(
                id=name,
                file=relative,
                text="",
                emotion="neutral",
                scene="",
                split="",
                approved="no",
            )
        )
        ids.add(name)
        added += 1
    temporary = folder / "metadata.csv.tmp"
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(folder / "metadata.csv")
    return added


def audio_metrics(file, sample_rate):
    audio, rate = sf.read(file, dtype="float32", always_2d=True)
    if not np.isfinite(audio).all() or audio.shape[0] == 0:
        raise ValueError("Empty or non-finite audio")
    if rate < 16000 or audio.shape[1] > 2:
        raise ValueError(
            "Use source audio at 16 kHz or higher with one or two channels"
        )
    mono = audio.mean(axis=1)
    energy = float(np.mean(mono.astype(np.float64) ** 2))
    channel_energy = float(np.mean(audio.astype(np.float64) ** 2))
    if audio.shape[1] == 2 and energy < channel_energy * 0.03:
        raise ValueError(
            "Stereo phase cancellation; export the clean voice channel as mono"
        )
    metrics = {
        "seconds": len(audio) / rate,
        "sourceRate": rate,
        "channels": audio.shape[1],
        "peak": float(np.max(np.abs(audio))),
        "clippedFraction": float(np.mean(np.abs(audio) >= 0.999)),
        "rmsDb": 10 * math.log10(max(energy, 1e-14)),
        "dc": float(np.mean(mono)),
    }
    warnings = []
    if metrics["clippedFraction"] > 0.001 or metrics["peak"] > 1.001:
        raise ValueError(
            "Clipped waveform; choose a clean source rather than normalizing damaged samples"
        )
    if metrics["rmsDb"] < -45:
        raise ValueError("Audio is silent or extremely quiet")
    if abs(metrics["dc"]) > 0.015:
        warnings.append("DC offset: inspect the original")
    edge = max(1, int(rate * 0.025))
    for label, part in [("start", mono[:edge]), ("end", mono[-edge:])]:
        if float(np.mean(part**2)) > energy * 0.7:
            warnings.append(f"Speech near {label}: check that no syllable was cut")
    # No denoising, VAD trimming, compression, gain or pitch processing.
    prepared = (
        soxr.resample(mono, rate, sample_rate, quality="HQ")
        if rate != sample_rate
        else mono
    )
    metrics["pcmSha256"] = hashlib.sha256(prepared.astype("<f4").tobytes()).hexdigest()
    return prepared, metrics, warnings


def assign_splits(rows, seed):
    groups = defaultdict(list)
    for row in rows:
        groups[row["scene"]].append(row)
    explicit = {}
    for scene, members in groups.items():
        values = {
            row["split"]
            for row in members
            if row["split"] and row["split"] != "reference"
        }
        if len(values) > 1:
            raise ValueError(f"Scene {scene} crosses dataset splits")
        if values:
            explicit[scene] = values.pop()
    candidates = [
        scene
        for scene, members in groups.items()
        if any(row["split"] != "reference" for row in members)
    ]
    for scene in candidates:
        if any(row["split"] == "reference" for row in groups[scene]):
            if explicit.get(scene) in {"validation", "test"}:
                raise ValueError("A held-out scene cannot supply reference audio")
            explicit[scene] = "train"
    random.Random(seed).shuffle(candidates)
    for split in ["validation", "test", "train"]:
        if split not in explicit.values():
            available = [
                scene
                for scene in candidates
                if scene not in explicit
                and not any(row["split"] == "reference" for row in groups[scene])
            ]
            if not available:
                raise ValueError(
                    "Need at least three distinct scenes for train/validation/test, plus training-only references"
                )
            # Keep small scenes for held-out sets; reserve most speech for training.
            chosen = (
                min(
                    available,
                    key=lambda key: sum(
                        row["metrics"]["seconds"] for row in groups[key]
                    ),
                )
                if split != "train"
                else available[0]
            )
            explicit[chosen] = split
    for row in rows:
        if row["split"] == "reference":
            if explicit.get(row["scene"]) in {"validation", "test"}:
                raise ValueError("Reference audio must not come from a held-out scene")
        else:
            row["split"] = explicit.get(row["scene"], "train")
    return rows


def prepare(config):
    folder = init_dataset(config)
    with (folder / "metadata.csv").open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise ValueError("metadata.csv must use the documented columns")
        source_rows = list(reader)
    errors, results = [], []
    seen_ids, seen_audio = set(), set()
    for item in source_rows:
        name = item.get("id", "?")
        try:
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", name) or name in seen_ids:
                raise ValueError("Invalid or duplicate clip ID")
            seen_ids.add(name)
            approval = item["approved"].strip().lower()
            if approval == "asr-consensus" and not config.get(
                "allowProvisionalTranscripts", False
            ):
                raise ValueError(
                    "ASR-only transcripts require allowProvisionalTranscripts=true "
                    "for an experimental run"
                )
            if approval not in {"yes", "true", "1", "asr-consensus"}:
                continue
            if not item["text"].strip() or not item["scene"].strip():
                raise ValueError(
                    "A manually checked transcript and scene ID are required"
                )
            if item["emotion"] not in config["emotions"] or (
                item["split"] and item["split"] not in SPLITS
            ):
                raise ValueError("Unsupported emotion or split")
            audio_file = inside(folder, item["file"])
            if not audio_file.is_relative_to(
                (folder / "raw").resolve()
            ) or audio_file.suffix.lower() not in {".wav", ".flac"}:
                raise ValueError("Use lossless WAV/FLAC files inside raw/")
            audio, metrics, warnings = audio_metrics(audio_file, config["sampleRate"])
            if (
                not config["minClipSeconds"]
                <= metrics["seconds"]
                <= config["maxClipSeconds"]
            ):
                raise ValueError("Clip length is outside the configured range")
            if metrics["pcmSha256"] in seen_audio:
                raise ValueError("Duplicate audio, even if the file name differs")
            seen_audio.add(metrics["pcmSha256"])
            output = folder / "prepared" / f"{name}.wav"
            sf.write(output, audio, config["sampleRate"], subtype="FLOAT")
            results.append(
                {
                    **item,
                    "language": config["language"],
                    "audio": str(output),
                    "sourceSha256": digest(audio_file),
                    "metrics": metrics,
                    "warnings": warnings,
                }
            )
        except (ValueError, OSError, RuntimeError) as error:
            errors.append({"id": name, "error": str(error)})
    report = {
        "schemaVersion": 1,
        "clips": results,
        "errors": errors,
        "approvedSeconds": sum(row["metrics"]["seconds"] for row in results),
        "provisionalTranscripts": any(
            row["approved"].strip().lower() == "asr-consensus" for row in results
        ),
        "note": "Statistics cannot prove clean dialogue or one speaker: listen and approve every source clip.",
    }
    if report["approvedSeconds"] > config["maxDatasetSeconds"]:
        errors.append({"error": "Approved dataset exceeds the five-minute budget"})
    if not results:
        errors.append(
            {
                "error": "No approved audio yet. Add clips, transcripts and approval before preparing."
            }
        )
    if not errors:
        try:
            assign_splits(results, config["seed"])
            refs = defaultdict(list)
            for row in results:
                if row["split"] == "reference":
                    refs[row["emotion"]].append(row)
            if "neutral" not in refs:
                raise ValueError(
                    "Reserve neutral reference audio in split=reference (6–15 seconds total)"
                )
            reference_bank = {}
            for emotion, rows in refs.items():
                pieces = [sf.read(row["audio"], dtype="float32")[0] for row in rows]
                reference = np.concatenate(pieces)
                duration = len(reference) / config["sampleRate"]
                if not 5.2 <= duration <= 15:
                    raise ValueError(
                        f"Reference {emotion} must total more than 5 and at most 15 seconds; no mid-word truncation"
                    )
                file = folder / "references" / f"{emotion}.wav"
                sf.write(file, reference, config["sampleRate"], subtype="FLOAT")
                reference_bank[emotion] = {
                    "audio": str(file),
                    "ids": [row["id"] for row in rows],
                    "sha256": digest(file),
                }
            texts = {}
            for row in results:
                key = re.sub(r"\W+", "", row["text"].lower())
                if (
                    len(key) >= 20
                    and key in texts
                    and texts[key] != row["split"]
                    and row["split"] != "reference"
                ):
                    raise ValueError(
                        "The same long transcript occurs in different splits; avoid evaluation leakage"
                    )
                if row["split"] != "reference":
                    texts[key] = row["split"]
            for split in ["train", "validation", "test"]:
                records = [row for row in results if row["split"] == split]
                (folder / f"{split}.jsonl").write_text(
                    "".join(
                        json.dumps(row, ensure_ascii=False) + "\n" for row in records
                    ),
                    encoding="utf-8",
                )
            write_json(folder / "reference-bank.json", reference_bank)
            write_json(
                folder / "dataset.json",
                {
                    "schemaVersion": 1,
                    "language": config["language"],
                    "metadataSha256": digest(folder / "metadata.csv"),
                    "provisionalTranscripts": report["provisionalTranscripts"],
                    "clips": [
                        {
                            "id": row["id"],
                            "split": row["split"],
                            "sourceSha256": row["sourceSha256"],
                            "audioSha256": digest(row["audio"]),
                        }
                        for row in results
                    ],
                },
            )
        except ValueError as error:
            errors.append({"error": str(error)})
    report["ready"] = not errors
    write_json(folder / "quality-report.json", report)
    if errors:
        raise ValueError(
            f"Dataset not ready: {errors[0]['error']}; see {folder / 'quality-report.json'}"
        )
    return report
