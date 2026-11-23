# SPDX-License-Identifier: GPL-3.0-only
"""Generate Capri's original screenshot cue without sampled recordings.

ffmpeg is needed only to regenerate the included MP3, never by the application.
"""
import argparse
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[2] / "assets/default/screenshot-capture.mp3")
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("ffmpeg is required to regenerate the cue")
    rate, duration = 48000, 0.22
    samples = bytearray()
    for frame in range(round(rate * duration)):
        value = 0.0
        for start, frequency in [(0.0, 1450.0), (0.075, 1950.0)]:
            phase = frame / rate - start
            if 0 <= phase <= 0.1:
                envelope = min(1.0, phase / 0.003) * math.exp(-phase / 0.021)
                envelope *= min(1.0, (0.1 - phase) / 0.012)
                value += 0.16 * envelope * (math.sin(2 * math.pi * frequency * phase)
                                           + 0.23 * math.sin(2 * math.pi * frequency * 1.5 * phase))
        pcm = round(max(-1.0, min(1.0, value)) * 32767)
        samples.extend(struct.pack("<hh", pcm, pcm))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="capri-original-cue-") as temporary:
        source = Path(temporary) / "cue.wav"
        with wave.open(str(source), "wb") as recording:
            recording.setnchannels(2)
            recording.setsampwidth(2)
            recording.setframerate(rate)
            recording.writeframes(samples)
        subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(source), "-map_metadata", "-1", "-codec:a", "libmp3lame",
                        "-b:a", "128k", "-id3v2_version", "0", "-write_id3v1", "0",
                        str(args.output)], check=True, stdin=subprocess.DEVNULL,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


if __name__ == "__main__":
    main()
