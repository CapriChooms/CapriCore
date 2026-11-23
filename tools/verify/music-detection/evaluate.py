"""Evaluate the pinned local classifier on public recordings, not owner audio.

Run fetch-benchmark.mjs first. Audio and score reports stay under .runtime.
Music/speech labels derive from MUSAN and FLEURS; mixed clips are synthetic
combinations of those real recordings. These results are a regression sample,
not a claim of universal genre/language accuracy.
"""

# ruff: noqa: E402 -- Bootstrap the checkout import path for direct execution.
import hashlib
import json
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
import numpy as np

from integrations.music_runtime.features import log_mel_patch, probabilities
from integrations.music_runtime.worker import MusicClassifier

DATA = ROOT / ".runtime/music-detection-research/benchmark"
MODEL = ROOT / ".runtime/music-detection-research/yamnet-onnx-float"


def read_audio(file):
    body = Path(file).read_bytes()
    position, format_data, raw = 12, None, None
    while position + 8 <= len(body):
        kind = body[position : position + 4]
        size = struct.unpack_from("<I", body, position + 4)[0]
        start = position + 8
        if kind == b"fmt ":
            format_data = struct.unpack_from("<HHIIHH", body, start)
        if kind == b"data":
            raw = body[start : min(start + size, len(body))]
            break
        position = start + size + size % 2
    if format_data is None or raw is None:
        raise ValueError("Expected public WAV")
    encoding, channels, rate, _, _, bits = format_data
    width = bits // 8
    raw = raw[: len(raw) // (width * channels) * (width * channels)]
    if encoding == 1 and bits == 16:
        samples = np.frombuffer(raw, "<i2").astype(np.float32) / 32768.0
    elif encoding == 3 and bits == 32:
        samples = np.frombuffer(raw, "<f4").astype(np.float32)
    else:
        raise ValueError("Expected public PCM16/float32 WAV")
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(1)
    if rate != 16000:
        count = round(len(samples) * 16000 / rate)
        samples = np.interp(
            np.arange(count) * rate / 16000, np.arange(len(samples)), samples
        ).astype(np.float32)
    return samples


def maximum_run(flags):
    current = maximum = 0
    for flag in flags:
        current = current + 1 if flag else 0
        maximum = max(current, maximum)
    return maximum


def measure(classifier, samples):
    scores, timings = [], []
    for end in range(16000, len(samples) + 1, 16000):
        segment = samples[end - 16000 : end]
        start = time.perf_counter()
        score = probabilities(
            classifier.session.run(None, {"audio": log_mel_patch(segment)})[0][0]
        )
        timings.append((time.perf_counter() - start) * 1000)
        scores.append([float(score[i]) for i in [132, 0, 24]])
    values = np.asarray(scores)
    smoothed = np.asarray(
        [values[max(0, i - 2) : i + 1].mean(0) for i in range(len(values))]
    )
    return {
        "musicMean": round(float(values[:, 0].mean()), 6),
        "musicMax": round(float(values[:, 0].max()), 6),
        "speechMean": round(float(values[:, 1].mean()), 6),
        "singingMean": round(float(values[:, 2].mean()), 6),
        "musicScores": values[:, 0].round(6).tolist(),
        "speechScores": values[:, 1].round(6).tolist(),
        "smoothMusicScores": smoothed[:, 0].round(6).tolist(),
        "timingsMs": timings,
    }


def main():
    classifier = MusicClassifier(MODEL)
    recordings = json.loads((DATA / "recordings.json").read_text(encoding="utf-8"))
    results, audio = [], {}
    for recording in recordings:
        file = DATA / recording["name"]
        if hashlib.sha256(file.read_bytes()).hexdigest() != recording["sha256"]:
            raise ValueError("Benchmark source checksum changed")
        samples = read_audio(file)
        start = 5 * 16000 if len(samples) >= 10 * 16000 else 0
        samples = samples[start : start + 20 * 16000]
        if len(samples) < 16000:
            continue
        audio[recording["name"]] = samples
        results.append(
            {
                "name": recording["name"],
                "category": recording["category"],
                "language": recording["language"],
                "seconds": len(samples) / 16000,
                "split": "heldout"
                if hashlib.sha256(recording["name"].encode()).digest()[0] >= 128
                else "calibration",
                **measure(classifier, samples),
            }
        )
    music = [recording for recording in results if recording["category"] == "music"]
    speech = [recording for recording in results if recording["category"] == "speech"]
    for i, (song, voice) in enumerate(zip(music[:6], speech[:6])):
        left, right = audio[song["name"]], audio[voice["name"]]
        count = min(len(left), len(right))
        left = left[:count] / max(float(np.sqrt(np.mean(left**2))), 0.00001)
        right = right[:count] / max(float(np.sqrt(np.mean(right**2))), 0.00001)
        for speech_db in [-10, 0, 10]:
            samples = (left + right * 10 ** (speech_db / 20)) * 0.05
            samples = np.clip(samples, -1, 1)
            results.append(
                {
                    "name": f"mixed-{i}-speech-{speech_db}dB",
                    "category": "mixed",
                    "language": "varied",
                    "seconds": count / 16000,
                    "split": "heldout",
                    **measure(classifier, samples),
                }
            )
    rng = np.random.default_rng(43070)
    controls = {
        "silence": np.zeros(20 * 16000, np.float32),
        "white-noise": rng.normal(0, 0.05, 20 * 16000).astype(np.float32),
        "single-tone": (
            0.05 * np.sin(2 * np.pi * 1000 * np.arange(20 * 16000) / 16000)
        ).astype(np.float32),
        "periodic-clicks": np.tile(np.r_[np.ones(80) * 0.1, np.zeros(7920)], 40).astype(
            np.float32
        ),
    }
    for name, samples in controls.items():
        results.append(
            {
                "name": name,
                "category": "synthetic-negative",
                "language": "none",
                "seconds": 20,
                "split": "heldout",
                **measure(classifier, samples),
            }
        )
    thresholds = []
    for threshold in [0.35, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]:
        matrix = {}
        for split in ["calibration", "heldout"]:
            group = [
                r for r in results if r["split"] == split and r["category"] != "mixed"
            ]
            tp = fp = tn = fn = 0
            for row in group:
                predicted = (
                    maximum_run(
                        [score >= threshold for score in row["smoothMusicScores"]]
                    )
                    >= 3
                )
                positive = row["category"] == "music"
                tp += positive and predicted
                fp += not positive and predicted
                tn += not positive and not predicted
                fn += positive and not predicted
            matrix[split] = {
                "truePositive": tp,
                "falsePositive": fp,
                "trueNegative": tn,
                "falseNegative": fn,
            }
        matrix["threshold"] = threshold
        matrix["mixedDetected"] = sum(
            maximum_run([s >= threshold for s in row["smoothMusicScores"]]) >= 3
            for row in results
            if row["category"] == "mixed"
        )
        thresholds.append(matrix)
    durations = [v for row in results for v in row.pop("timingsMs")]
    report = {
        "modelId": classifier.config["id"],
        "recordings": len(recordings),
        "samples": len(results),
        "noOwnerAudio": True,
        "cpuOnly": True,
        "threads": 1,
        "timingMs": {
            "median": float(np.median(durations)),
            "p95": float(np.percentile(durations, 95)),
            "maximum": max(durations),
        },
        "thresholds": thresholds,
        "results": results,
        "limitations": [
            "Bounded convenience sample, not an exhaustive benchmark.",
            "Public MUSAN/FLEURS sources can overlap AudioSet training; this is functional regression testing, not unbiased generalization measurement.",
            "Quiet background music under louder speech and unusual unpitched music remain difficult.",
        ],
    }
    (DATA / "evaluation.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                key: report[key]
                for key in ["recordings", "samples", "timingMs", "thresholds"]
            }
        )
    )


if __name__ == "__main__":
    main()
