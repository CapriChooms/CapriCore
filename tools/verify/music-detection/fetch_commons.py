"""Fetch two explicitly licensed vocal recordings, analysis only, no playback.

Requires an existing ffmpeg executable only for this optional benchmark. Neither
ffmpeg nor these recordings are a production detector dependency. Cropped mono
WAV derivatives and attribution stay in .runtime, outside release sources.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESTINATION = ROOT / ".runtime/music-detection-research/benchmark"
EXAMPLES = [
    (
        "Free Software Song Bulgarian Style.ogg",
        "commons-ensemble-vocals.wav",
        "CC-BY-SA-3.0",
        "Mark Forry, Yvette Osborne, Ron Fox, Steve Finney, Bill Cope, Kip McAtee, Ernie Provencher, Dan Auvil",
        "en",
        30,
    ),
    (
        "JamieP - Machine Love (Snippet, Vocals Only).ogg",
        "commons-synth-vocals.wav",
        "CC-BY-SA-4.0",
        'Jamie "JamieP" Paige',
        "en",
        0,
    ),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("An existing ffmpeg is needed for the optional vocal benchmark")
    DESTINATION.mkdir(parents=True, exist_ok=True)
    manifest = DESTINATION / "recordings.json"
    recordings = (
        json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    )
    present = {record["name"] for record in recordings}
    for title, name, license_name, author, language, start in EXAMPLES:
        if name in present and (DESTINATION / name).is_file():
            continue
        filename = title.replace(" ", "_")
        digest = hashlib.md5(filename.encode()).hexdigest()
        url = f"https://upload.wikimedia.org/wikipedia/commons/{digest[0]}/{digest[:2]}/{urllib.parse.quote(filename)}"
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "CapriMusicRegression/1.0 (local public-audio evaluation)"
            },
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            body = response.read(5 * 1024 * 1024 + 1)
        if len(body) > 5 * 1024 * 1024 or body[:4] != b"OggS":
            raise ValueError("Unexpected public audio asset")
        conversion = subprocess.run(
            [
                args.ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-ss",
                str(start),
                "-t",
                "30",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                "pipe:1",
            ],
            input=body,
            capture_output=True,
            timeout=20,
        )
        if conversion.returncode or conversion.stdout[:4] != b"RIFF":
            raise ValueError("Public audio conversion failed")
        (DESTINATION / name).write_bytes(conversion.stdout)
        recordings.append(
            {
                "dataset": "Wikimedia Commons",
                "category": "music",
                "language": language,
                "name": name,
                "bytes": len(conversion.stdout),
                "sha256": hashlib.sha256(conversion.stdout).hexdigest(),
                "originalSha256": hashlib.sha256(body).hexdigest(),
                "audioSource": url,
                "metadataSource": "https://commons.wikimedia.org/wiki/File:"
                + urllib.parse.quote(filename),
                "sourceLicense": license_name,
                "author": author,
                "modifications": f"Crop from {start}s, maximum 30s, resample to 16kHz mono PCM16",
            }
        )
        manifest.write_text(json.dumps(recordings, indent=2) + "\n", encoding="utf-8")
        print(
            json.dumps({"downloaded": name, "bytes": len(conversion.stdout)}),
            flush=True,
        )


if __name__ == "__main__":
    main()
