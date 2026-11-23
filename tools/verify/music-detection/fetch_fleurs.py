"""Fetch two public speech samples per language from Google's pinned FLEURS.

Streams only the beginning of each test archive, never the entire corpus. No
archive path is extracted: known local filenames hold bounded WAV bytes only.
"""

import hashlib
import json
import tarfile
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESTINATION = ROOT / ".runtime/music-detection-research/benchmark"
REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
LANGUAGES = ["ru_ru", "de_de", "fr_fr", "ja_jp", "cmn_hans_cn", "ar_eg"]
LOCK = threading.Lock()


def language_samples(language):
    metadata = DESTINATION / "recordings.json"
    with LOCK:
        recordings = (
            json.loads(metadata.read_text(encoding="utf-8"))
            if metadata.exists()
            else []
        )
        present = {item["name"] for item in recordings}
    if all(f"fleurs-{language}-{i}.wav" in present for i in range(2)):
        return
    url = f"https://huggingface.co/datasets/google/fleurs/resolve/{REVISION}/data/{language}/audio/test.tar.gz"
    try:
        with urllib.request.urlopen(url, timeout=45) as response:
            archive = tarfile.open(fileobj=response, mode="r|gz")
            saved = 0
            for member in archive:
                if not member.isfile() or not member.name.endswith(".wav"):
                    continue
                if member.size > 20 * 1024 * 1024:
                    continue
                source = archive.extractfile(member)
                body = source.read(min(member.size, 960044))
                if body[:4] != b"RIFF" or body[8:12] != b"WAVE":
                    continue
                name = f"fleurs-{language}-{saved}.wav"
                (DESTINATION / name).write_bytes(body)
                record = {
                    "dataset": "google/fleurs",
                    "config": language,
                    "split": "test",
                    "row": saved,
                    "category": "speech",
                    "language": language,
                    "name": name,
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "audioSource": url,
                    "archiveMember": member.name,
                    "sourceLicense": "CC-BY-4.0",
                }
                with LOCK:
                    recordings = (
                        json.loads(metadata.read_text(encoding="utf-8"))
                        if metadata.exists()
                        else []
                    )
                    recordings = [
                        item for item in recordings if item["name"] != name
                    ] + [record]
                    metadata.write_text(
                        json.dumps(recordings, indent=2) + "\n", encoding="utf-8"
                    )
                print(json.dumps({"downloaded": name, "bytes": len(body)}), flush=True)
                saved += 1
                if saved == 2:
                    break
    except Exception as error:
        print(
            json.dumps({"unavailable": language, "reason": type(error).__name__}),
            flush=True,
        )


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(language_samples, LANGUAGES))
