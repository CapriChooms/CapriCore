"""Bounded, ephemeral PCM -> music/speech scores, CPU only, private stdio.

No microphone/device access, network, audio files, transcripts or owner paths are
read or written by this worker. The host owns capture consent and model download.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from collections import deque
from pathlib import Path

# Avoid a second thread pool competing with inference on weaker computers.
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

try:
    import numpy as np
    import onnxruntime as ort

    if __package__:
        from .features import log_mel_patch, probabilities
        from .tempo import TempoTracker
    else:
        from features import log_mel_patch, probabilities
        from tempo import TempoTracker
except ImportError:
    # A missing optional runtime must not expose installation paths/tracebacks.
    print('{"type":"error","code":"MUSIC_RUNTIME_UNAVAILABLE"}', flush=True)
    raise SystemExit(1)

MAX_LINE_BYTES = 128 * 1024
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class MusicClassifier:
    def __init__(self, model_dir):
        config_file = Path(__file__).resolve().parents[2] / "config/music-detector.json"
        self.config = json.loads(config_file.read_text(encoding="utf-8-sig"))
        directory = Path(model_dir)
        for entry in self.config["files"]:
            file = directory / entry["name"]
            if (
                file.is_symlink()
                or not file.is_file()
                or file.stat().st_size != entry["bytes"]
            ):
                raise ValueError("Music model verification failed")
            if hashlib.sha256(file.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError("Music model verification failed")
        labels = (directory / "labels.txt").read_text(encoding="utf-8").splitlines()
        if len(labels) != 521 or any(
            labels[index].lower() != name
            for name, index in self.config["classes"].items()
        ):
            raise ValueError("Music class map verification failed")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(
            str(directory / "yamnet.onnx"),
            options,
            providers=["CPUExecutionProvider"],
        )
        if self.session.get_inputs()[0].shape != [1, 1, 96, 64]:
            raise ValueError("Music input shape verification failed")
        self.reset()

    def reset(self):
        self.owner = None
        self.sequence = None
        self.samples = np.empty(0, dtype=np.float32)
        self.scores = deque(maxlen=3)
        self.since_inference = 0
        self.tempo = TempoTracker()

    def process(self, packet):
        if set(packet) != {"type", "sessionId", "sequence", "pcm"}:
            raise ValueError("Invalid music packet")
        session_id, sequence = packet["sessionId"], packet["sequence"]
        if (
            not isinstance(session_id, str)
            or not SESSION_ID.fullmatch(session_id)
            or isinstance(sequence, bool)
            or not isinstance(sequence, int)
            or not 0 <= sequence <= 9007199254740991
            or not isinstance(packet["pcm"], str)
            or len(packet["pcm"]) > 44000
        ):
            raise ValueError("Invalid music packet")
        raw = base64.b64decode(packet["pcm"], validate=True)
        if len(raw) != self.config["packetSamples"] * 4:
            raise ValueError("Invalid music packet")
        samples = np.frombuffer(raw, dtype="<f4")
        if not np.isfinite(samples).all():
            raise ValueError("Invalid music packet")
        if self.owner != session_id or (
            self.sequence is not None and sequence != self.sequence + 1
        ):
            self.reset()
        self.owner, self.sequence = session_id, sequence
        self.tempo.accept(samples)
        self.samples = np.concatenate((self.samples, np.clip(samples, -1.0, 1.0)))[
            -self.config["windowSamples"] :
        ]
        self.since_inference += samples.size
        if self.since_inference < self.config["hopSamples"]:
            return None
        self.since_inference = 0
        rms = float(np.sqrt(np.mean(self.samples.astype(np.float64) ** 2)))
        started = time.perf_counter()
        if rms < 0.0003:
            scores = np.zeros(521, dtype=np.float32)
        else:
            scores = probabilities(
                self.session.run(None, {"audio": log_mel_patch(self.samples)})[0][0]
            )
        self.scores.append(scores)
        mean = np.mean(self.scores, axis=0)
        return {
            "type": "classification",
            "sessionId": session_id,
            "sequence": sequence,
            **{
                name: round(float(mean[index]), 6)
                for name, index in self.config["classes"].items()
            },
            "rms": round(rms, 6),
            **self.tempo.estimate(
                music=bool(
                    mean[self.config["classes"]["music"]] >= 0.6 and rms >= 0.0003
                )
            ),
            "inferenceMs": round((time.perf_counter() - started) * 1000.0, 3),
        }


def output(value):
    print(json.dumps(value, separators=(",", ":"), allow_nan=False), flush=True)


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    try:
        classifier = MusicClassifier(args.model_dir)
    except Exception:
        output({"type": "error", "code": "MUSIC_MODEL_UNAVAILABLE"})
        return 1
    output({"type": "ready", "modelId": classifier.config["id"]})
    while True:
        line = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
        if not line:
            break
        if len(line) > MAX_LINE_BYTES:
            while line and not line.endswith(b"\n"):
                line = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
            classifier.reset()
            output({"type": "error", "code": "MUSIC_AUDIO_PACKET_INVALID"})
            continue
        try:
            packet = json.loads(line)
            if not isinstance(packet, dict):
                raise ValueError("Invalid music packet")
            if packet.get("type") == "stop" and set(packet) == {"type"}:
                break
            if packet.get("type") == "reset" and set(packet) == {"type"}:
                classifier.reset()
                continue
            if packet.get("type") != "audio":
                raise ValueError("Invalid music packet")
            result = classifier.process(packet)
            if result is not None:
                output(result)
        except Exception:
            classifier.reset()
            output({"type": "error", "code": "MUSIC_AUDIO_PACKET_INVALID"})
    classifier.reset()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
