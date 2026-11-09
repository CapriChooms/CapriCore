"""Pinned model download and offline integrity receipt."""

import json
import re
from urllib.error import HTTPError

from .dataset import ROOT, digest, write_json
from integrations.model_download import ModelDownloadError, _regular_path, download_verified


def download_model(config, *, root=ROOT, download=download_verified):
    upstream = json.loads(
        (root / "config/voice-upstream.json").read_text(encoding="utf-8")
    )
    metadata = json.loads(
        (root / "config/voice-model-download.json").read_text(encoding="utf-8")
    )
    model = upstream["model"]
    if (
        model["repository"] != "ResembleAI/chatterbox-turbo"
        or not re.fullmatch(r"[0-9a-f]{40}", model["revision"])
        or metadata["revision"] != model["revision"]
        or set(metadata["files"]) != set(model["files"])
        or not all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name) for name in model["files"])
    ):
        raise ValueError("Voice download metadata differs from the pinned model")
    folder = config["modelPath"]
    receipt = folder / "model-receipt.json"
    _regular_path(receipt)
    _regular_path(receipt.with_suffix(".json.tmp"))
    total = len(model["files"])
    total_bytes = sum(spec["bytes"] for spec in metadata["files"].values())
    completed_bytes = 0
    print(f"Preparing {total} public voice model files. No account is required.", flush=True)
    base = f'https://huggingface.co/{model["repository"]}/resolve/{model["revision"]}'
    files = {}
    for index, name in enumerate(model["files"], 1):
        spec = metadata["files"][name]
        print(f"Voice model file {index}/{total}: {name}", flush=True)

        def progress(message, *, flush):
            # Installers take the first percentage on a line. Keep that value
            # cumulative while preserving per-file counts and rate in the log.
            transferred = re.match(r"^[^:]+: (\d{1,3})% \|", message)
            if transferred:
                received = completed_bytes + spec["bytes"] * int(transferred[1]) // 100
                overall = min(99, received * 100 // total_bytes)
                message = f"{overall}% overall | {message}"
            print(message, flush=flush)

        try:
            download(f"{base}/{name}", folder / name, spec, timeout=25, attempts=5, emit=progress)
        except HTTPError as error:
            raise ModelDownloadError(
                f"Could not download {name}: HTTP {error.code} from the model host. "
                "Already verified models are preserved."
            ) from None
        files[name] = spec["sha256"]
        completed_bytes += spec["bytes"]
        print(f"{min(99, completed_bytes * 100 // total_bytes)}% overall | {index}/{total} voice files verified", flush=True)
    write_json(receipt, {"upstream": upstream, "files": files})
    print("100% overall | Voice model download verified.", flush=True)
    return files


def verify_model_metadata(config):
    import importlib.metadata

    folder = config["modelPath"]
    receipt = json.loads((folder / "model-receipt.json").read_text(encoding="utf-8"))
    upstream = json.loads(
        (ROOT / "config/voice-upstream.json").read_text(encoding="utf-8")
    )
    installed = json.loads(
        importlib.metadata.distribution("chatterbox-tts").read_text("direct_url.json")
        or "{}"
    )
    if installed.get("vcs_info", {}).get("commit_id") != upstream["source"]["revision"]:
        raise ValueError(
            "Installed source is not pinned correctly; run setup-voice-training.cmd"
        )
    if receipt["upstream"] != upstream or set(receipt["files"]) != set(
        upstream["model"]["files"]
    ):
        raise ValueError(
            "Model revision differs from the pinned download; rerun download"
        )
    return receipt


def verify_model(config):
    receipt = verify_model_metadata(config)
    folder = config['modelPath']
    for name, expected in receipt["files"].items():
        if digest(folder / name) != expected:
            raise ValueError(f"Model file changed: {name}")
    return receipt
