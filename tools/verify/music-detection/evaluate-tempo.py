# SPDX-License-Identifier: GPL-3.0-only
"""Bounded offline tempo evaluation; no audio devices, downloads or GPU access.

Synthetic metrical labels are known. Cached public recordings have category
labels only, so they test bounds and speech gating, never BPM accuracy. All
generated audio and public source material stay in memory; JSON goes to .runtime.
"""

# ruff: noqa: E402 -- Configure one CPU thread before importing NumPy.
import argparse
import base64
import hashlib
import json
import math
import os
import struct
import sys
import time
from collections import deque
from pathlib import Path

os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
import numpy as np

from integrations.music_runtime.tempo import TempoTracker

TEMPO_FILE = ROOT / "integrations/music_runtime/tempo.py"
TEMPO_SOURCE_SHA256 = hashlib.sha256(TEMPO_FILE.read_bytes()).hexdigest()
RATE = 16000
PACKET = 8000
DATA = ROOT / ".runtime/music-detection-research/benchmark"
MODEL = ROOT / ".runtime/music-detection-research/yamnet-onnx-float"


def bounded(value):
    assert set(value) == {"tempo", "tempoConfidence", "beatPhase"}
    assert all(isinstance(item, (int, float)) and math.isfinite(item) for item in value.values())
    assert value["tempo"] == 0 or 40 <= value["tempo"] <= 240
    assert 0 <= value["tempoConfidence"] <= 1
    assert 0 <= value["beatPhase"] < 1
    if value["tempo"] == 0:
        assert value["tempoConfidence"] == value["beatPhase"] == 0


def retained_bytes(value, seen=None):
    """Approximate retained tracker memory, including NumPy arrays and deques."""
    seen = set() if seen is None else seen
    if id(value) in seen:
        return 0
    seen.add(id(value))
    if isinstance(value, np.ndarray):
        return max(sys.getsizeof(value), value.nbytes)
    size = sys.getsizeof(value)
    if isinstance(value, dict):
        return size + sum(retained_bytes(k, seen) + retained_bytes(v, seen) for k, v in value.items())
    if isinstance(value, (list, tuple, deque)):
        return size + sum(retained_bytes(item, seen) for item in value)
    if hasattr(value, "__dict__"):
        return size + retained_bytes(value.__dict__, seen)
    return size


def add(audio, at, signal, gain=1.0):
    start = round(at * RATE)
    if start < 0 or start >= len(audio):
        return
    count = min(len(signal), len(audio) - start)
    audio[start : start + count] += gain * signal[:count]


def groove(bpm, style="drums", seconds=20, seed=735):
    """Independent waveform synthesis, not the tracker's onset representation."""
    rng = np.random.default_rng(seed)
    t = np.arange(round(seconds * RATE), dtype=np.float32) / RATE
    audio = 0.006 * (np.sin(2 * np.pi * 220 * t) + 0.4 * np.sin(2 * np.pi * 330 * t))
    dt = np.arange(round(0.11 * RATE), dtype=np.float32) / RATE
    kick = np.sin(2 * np.pi * (56 * dt + 1.8 * (1 - np.exp(-dt * 60)))) * np.exp(-dt * 45)
    noise = rng.normal(0, 1, len(dt)).astype(np.float32)
    snare = noise * np.exp(-dt * 80)
    hat = np.concatenate(([0], np.diff(noise))).astype(np.float32) * np.exp(-dt * 170)
    period = 60 / bpm
    beats = np.arange(0.4, seconds - 0.1, period)
    if style == "jitter":
        beats += rng.normal(0, period * 0.012, len(beats))
    for index, beat in enumerate(beats):
        if style == "equal-subdivisions":
            add(audio, beat, kick, 0.65)
            add(audio, beat + period / 2, kick, 0.65)
            continue
        gain = 0.72
        if style == "half-accents":
            gain = 0.8 if index % 2 == 0 else 0.06
        if style != "syncopated" or index % 8 != 6:
            add(audio, beat, kick, gain)
        if style in {"backbeat", "swing", "syncopated"} and index % 2:
            add(audio, beat, snare, 0.25)
        if style in {"backbeat", "swing", "syncopated"}:
            add(audio, beat + period * (2 / 3 if style == "swing" else 0.5), hat, 0.07)
        if style == "syncopated" and index % 4 == 2:
            add(audio, beat + period * 0.75, kick, 0.28)
    return np.clip(audio, -1, 1).astype(np.float32), beats


def evaluate_stream(audio, music=True, chunk=PACKET, expected_bpm=None, beat_times=None):
    tracker = TempoTracker()
    trace, timings = [], []
    previous_second = 0
    for begin in range(0, len(audio), chunk):
        packet = audio[begin : begin + chunk]
        started = time.process_time()
        tracker.accept(packet)
        end = begin + len(packet)
        second = end // RATE
        if second > previous_second:
            previous_second = second
            result = tracker.estimate(music=music)
            timings.append((time.process_time() - started) * 1000)
            bounded(result)
            row = {"at": round(end / RATE, 5), **result}
            if beat_times is not None and result["tempo"] and expected_bpm:
                candidates = beat_times[beat_times <= end / RATE]
                if len(candidates):
                    expected_phase = ((end / RATE - candidates[-1]) / (60 / expected_bpm)) % 1
                    error = abs(result["beatPhase"] - expected_phase)
                    row["phaseError"] = round(min(error, 1 - error), 6)
            trace.append(row)
        else:
            timings.append((time.process_time() - started) * 1000)
    return {"trace": trace, "cpuMs": sum(timings), "maxPacketMs": max(timings), "retainedBytes": retained_bytes(tracker)}


def synthetic_cases():
    rows = []
    for bpm in [60, 75, 90, 120, 150, 180, 210, 240]:
        for style in ["drums", "backbeat", "swing"]:
            rows.append((bpm, style, False))
    for bpm in [90, 120, 150]:
        rows.extend((bpm, style, False) for style in ["jitter", "syncopated"])
    for bpm in [60, 90, 120, 180]:
        rows.extend((bpm, style, True) for style in ["equal-subdivisions", "half-accents"])
    for seed in [101, 741, 2026]:
        for bpm in [90, 120, 150, 180]:
            rows.append((bpm, "jitter", False, seed))
    results = []
    for bpm, style, ambiguous, *extra in rows:
        seed = extra[0] if extra else 735
        audio, beats = groove(bpm, style, seed=seed)
        result = evaluate_stream(audio, expected_bpm=bpm, beat_times=beats)
        tail = result["trace"][-6:]
        stable = [row["tempo"] for row in tail if row["tempo"]]
        measured = float(np.median(stable)) if stable else 0
        tolerance = max(2.0, bpm * 0.025)
        exact = bool(measured and abs(measured - bpm) <= tolerance)
        octave = bool(measured and min(abs(measured / bpm - 0.5), abs(measured / bpm - 2)) <= 0.055)
        phase = [row["phaseError"] for row in tail if "phaseError" in row and abs(row["tempo"] - bpm) <= tolerance]
        results.append({
            "name": f"{style}-{bpm}" + (f"-seed{seed}" if extra else ""), "bpm": bpm, "style": style, "seed": seed,
            "metricallyAmbiguous": ambiguous, "measuredBpm": round(measured, 3),
            "exact": exact, "halfOrDouble": octave, "knownTailFraction": len(stable) / len(tail),
            "medianPhaseError": round(float(np.median(phase)), 6) if phase else None,
            "seconds": len(audio) / RATE, **result,
        })
    return results


def reset_and_resources():
    tracker = TempoTracker()
    packet = groove(120, seconds=1)[0][:PACKET]
    sizes, cpu_ms = {}, 0
    for index in range(240):  # Two minutes processed serially, never real-time capture.
        started = time.process_time()
        tracker.accept(packet)
        if index % 2:
            bounded(tracker.estimate(music=True))
        cpu_ms += (time.process_time() - started) * 1000
        if index in [35, 119, 239]:
            sizes[str((index + 1) / 2)] = retained_bytes(tracker)
    assert sizes["120.0"] <= sizes["18.0"] * 1.15 + 8192, "Tracker retained memory grows after warmup"
    tracker.reset()
    reset = tracker.estimate(music=True)
    bounded(reset)
    assert reset["tempo"] == 0
    audio, beats = groove(120)
    chunked = []
    for chunk in [1600, 5920, PACKET]:
        result = evaluate_stream(audio, chunk=chunk, expected_bpm=120, beat_times=beats)
        chunked.append({"chunkSamples": chunk, "last": result["trace"][-1]})
    known = [item["last"]["tempo"] for item in chunked if item["last"]["tempo"]]
    assert len(known) == len(chunked) and max(known) - min(known) <= 3
    return {"retainedBytes": sizes, "cpuMsFor120AudioSeconds": round(cpu_ms, 3), "resetUnknown": True, "chunkEquivalence": chunked}


def transition(from_bpm=120, to_bpm=90):
    old, _ = groove(from_bpm, seconds=24)
    new, _ = groove(to_bpm, seconds=24, seed=736)
    result = evaluate_stream(np.concatenate((old, new)))
    tail = [row for row in result["trace"] if row["at"] > 24]
    recovery = None
    for index in range(len(tail) - 2):
        if all(abs(row["tempo"] - to_bpm) <= 3 for row in tail[index : index + 3]):
            recovery = tail[index]["at"] - 24
            break
    return {"fromBpm": from_bpm, "toBpm": to_bpm, "changeAt": 24, "stableRecoverySeconds": recovery, **result}


def negatives():
    t = np.arange(20 * RATE, dtype=np.float32) / RATE
    rng = np.random.default_rng(739)
    samples = {
        "silence": np.zeros_like(t),
        "steady-tone": (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32),
        "stationary-noise": rng.normal(0, 0.05, len(t)).astype(np.float32),
    }
    rows = []
    for name, audio in samples.items():
        for music in [False, True]:
            result = evaluate_stream(audio, music=music)
            if not music:
                assert all(row["tempo"] == 0 for row in result["trace"])
            rows.append({"name": name, "musicGate": music, **result})
    return rows


def read_public_wav(file):
    body = file.read_bytes()
    position, audio_format, raw = 12, None, None
    assert body[:4] == b"RIFF" and body[8:12] == b"WAVE"
    while position + 8 <= len(body):
        kind, size = body[position : position + 4], struct.unpack_from("<I", body, position + 4)[0]
        start = position + 8
        if kind == b"fmt ":
            audio_format = struct.unpack_from("<HHIIHH", body, start)
        if kind == b"data":
            raw = body[start : start + size]
            break
        position = start + size + size % 2
    assert audio_format and raw is not None
    encoding, channels, rate, _, _, bits = audio_format
    assert channels in [1, 2] and rate == RATE
    frame_bytes = channels * (bits // 8)
    raw = raw[: len(raw) // frame_bytes * frame_bytes]
    if encoding == 1 and bits == 16:
        samples = np.frombuffer(raw, "<i2").astype(np.float32) / 32768
    else:
        assert encoding == 3 and bits == 32
        samples = np.frombuffer(raw, "<f4")
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(1)
    return samples


def public_recordings():
    from integrations.music_runtime.worker import MusicClassifier

    classifier = MusicClassifier(MODEL)
    assert classifier.session.get_providers() == ["CPUExecutionProvider"]
    records = json.loads((DATA / "recordings.json").read_text(encoding="utf-8"))
    results = []
    for record in records:
        if record["category"] not in {"speech", "music", "noise"}:
            continue
        name = record["name"]
        assert Path(name).name == name
        file = DATA / name
        assert hashlib.sha256(file.read_bytes()).hexdigest() == record["sha256"]
        audio = read_public_wav(file)
        start = 5 * RATE if len(audio) >= 15 * RATE else 0
        audio = audio[start : start + 20 * RATE]
        if len(audio) < 2 * RATE:
            continue
        tracker = TempoTracker()
        classifier.reset()
        rows = []
        for sequence, begin in enumerate(range(0, len(audio) - PACKET + 1, PACKET)):
            packet = audio[begin : begin + PACKET]
            tracker.accept(packet)
            output = classifier.process({"type": "audio", "sessionId": "public-tempo-fixture", "sequence": sequence, "pcm": base64.b64encode(packet.astype("<f4").tobytes()).decode("ascii")})
            if output is None:
                continue
            gate = output["music"] >= 0.6
            result = tracker.estimate(music=gate)
            bounded(result)
            rows.append({"at": (begin + PACKET) / RATE, "musicGate": gate, **result})
        results.append({"name": name, "category": record["category"], "language": record.get("language"), "knownBpmGroundTruth": False, "startSeconds": start / RATE, "seconds": len(audio) / RATE, "musicGateWindows": sum(row["musicGate"] for row in rows), "tempoWindows": sum(bool(row["tempo"]) for row in rows), "windows": len(rows), "trace": rows})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public", action="store_true", help="Use only already cached and checksum-verified public WAV/model files")
    args = parser.parse_args()
    folder = ROOT / ".runtime/music-tempo-evaluation" / time.strftime("run-%Y%m%d-%H%M%S")
    folder.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    report = {
        "passed": False, "noOwnerAudio": True, "audioDevicesAccessed": False,
        "networkUsed": False, "gpuUsed": False, "cpuThreads": 1,
        "sampleRate": RATE,
        "limits": ["Synthetic musical metre is not a universal tempo ground truth.", "Half/double pulse interpretations are reported separately, not silently counted as exact.", "Public clips have no BPM annotations; they test gating/bounds only.", "A single serial CPU run is a functional regression, not a hardware benchmark."],
    }
    try:
        report["synthetic"] = synthetic_cases()
        strong = [case for case in report["synthetic"] if not case["metricallyAmbiguous"]]
        report["syntheticSummary"] = {
            "unambiguousCases": len(strong),
            "exact": sum(case["exact"] for case in strong),
            "halfOrDouble": sum(case["halfOrDouble"] for case in strong),
            "unknown": sum(not case["measuredBpm"] for case in strong),
        }
        report["negatives"] = negatives()
        report["transition"] = transition()
        report["octaveTransitions"] = [transition(60, 120), transition(180, 90)]
        report["resources"] = reset_and_resources()
        report["public"] = public_recordings() if args.public else []
        report["criticalChecks"] = {
            "unambiguousSyntheticExact": bool(strong) and all(case["exact"] for case in strong),
            "silenceToneNoiseUnknown": all(not row["tempo"] for case in report["negatives"] for row in case["trace"]),
            "boundedTrackChangeRecovery": all(case["stableRecoverySeconds"] is not None and case["stableRecoverySeconds"] <= 12 for case in [report["transition"], *report["octaveTransitions"]]),
            "publicSpeechAndNoiseUnknown": all(not case["tempoWindows"] for case in report["public"] if case["category"] in {"speech", "noise"}),
            "retainedMemoryAndChunksBounded": True,
        }
    except Exception as error:
        report["error"] = {"type": type(error).__name__, "message": str(error)}
    report["elapsedSeconds"] = round(time.perf_counter() - started, 3)
    report["tempoSourceSha256"] = TEMPO_SOURCE_SHA256
    report["sourceChangedDuringRun"] = TEMPO_SOURCE_SHA256 != hashlib.sha256(TEMPO_FILE.read_bytes()).hexdigest()
    report["publicSummary"] = {
        category: {
            "recordings": sum(row["category"] == category for row in report.get("public", [])),
            "windows": sum(row["windows"] for row in report.get("public", []) if row["category"] == category),
            "withAnyTempo": sum(bool(row["tempoWindows"]) for row in report.get("public", []) if row["category"] == category),
            "tempoWindows": sum(row["tempoWindows"] for row in report.get("public", []) if row["category"] == category),
        }
        for category in ["music", "speech", "noise"]
    }
    report["passed"] = not report.get("error") and not report["sourceChangedDuringRun"] and bool(report.get("criticalChecks")) and all(report["criticalChecks"].values())
    (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "report": str(folder / "report.json"), "syntheticSummary": report.get("syntheticSummary"), "publicRecordings": len(report.get("public", [])), "criticalChecks": report.get("criticalChecks"), "elapsedSeconds": report["elapsedSeconds"]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
