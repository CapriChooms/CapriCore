import argparse
import importlib.metadata
import json
import os
import sys
from pathlib import Path

from .dataset import (
    ROOT,
    init_dataset,
    inside,
    prepare,
    read_config,
    scan,
    write_json,
)


def doctor(config, *, inference_only=False):
    import torch

    from .provision import verify_model

    report = {
        "python": sys.version.split()[0],
        "engine": config["engine"],
        "language": config["language"],
        "torch": torch.__version__,
        "cuda": torch.cuda.is_available(),
        "versions": {
            name: importlib.metadata.version(name)
            for name in ["chatterbox-tts", "transformers", "soundfile", "soxr"]
        },
    }
    from integrations.voice_runtime.compatibility import cuda_preflight
    report['cudaCompute'] = cuda_preflight(torch)
    if report["cudaCompute"].get("device"):
        report["gpu"] = report["cudaCompute"]["device"]
    if report["cudaCompute"]["kernelReady"]:
        try:
            free, total = torch.cuda.mem_get_info()
            report.update(freeVramGiB=round(free / 1024**3, 2),
                          totalVramGiB=round(total / 1024**3, 2))
        except (RuntimeError, OSError, AttributeError):
            report["vramTelemetryAvailable"] = False
    try:
        verify_model(config)
        report["modelReady"] = True
    except (OSError, ValueError) as error:
        report["modelReady"] = False
        report["modelNote"] = str(error)
    if not inference_only:
        report["datasetReady"] = False
        try:
            from .backend import verify_dataset

            verify_dataset(config)
            report["datasetReady"] = True
        except FileNotFoundError:
            report["datasetNote"] = (
                "Waiting for reviewed English recordings. Add clips, then run scan and prepare."
            )
        except (OSError, ValueError, KeyError) as error:
            report["datasetNote"] = str(error)
    write_json(ROOT / "logs/voice-training-doctor.json", report)
    return report


def main():
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    parser = argparse.ArgumentParser(
        description="Capri voice preparation and English LoRA training"
    )
    parser.add_argument(
        "--config",
        type=Path,
        help="Training configuration (default config/voice-training.json)",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    for name in [
        "init",
        "scan",
        "prepare",
        "download",
        "cache",
        "train",
        "qualify",
    ]:
        commands.add_parser(name)
    commands.add_parser("doctor").add_argument("--inference-only", action="store_true")
    preview = commands.add_parser("preview")
    preview.add_argument("--text", required=True)
    preview.add_argument("--emotion", default="neutral")
    preview.add_argument("--adapter", type=Path)
    review = commands.add_parser("review")
    review.add_argument("--adapter", required=True, type=Path)
    review.add_argument("--limit", type=int, default=20)
    export = commands.add_parser("export")
    export.add_argument("--adapter", required=True, type=Path)
    export.add_argument("--name", required=True)
    args = parser.parse_args()
    config = read_config(args.config)
    if getattr(args, "adapter", None):
        args.adapter = inside(config["datasetPath"] / "runs", args.adapter)
    if args.command == "init":
        print(init_dataset(config))
    elif args.command == "scan":
        print(
            f"Added {scan(config)} clips to metadata.csv; fill the exact transcripts and mark reviewed clips approved=yes."
        )
    elif args.command == "prepare":
        report = prepare(config)
        print(
            f"Prepared {len(report['clips'])} clips, {report['approvedSeconds']:.1f} seconds"
        )
    elif args.command == "download":
        from .provision import download_model

        print(f"Pinned model files ready: {len(download_model(config))}")
    elif args.command == "doctor":
        print(json.dumps(doctor(config, inference_only=args.inference_only), indent=2))
    elif args.command == "cache":
        from .backend import build_cache

        print(f"Cached {build_cache(config)} clips")
    elif args.command == "train":
        from .trainer import train

        print(f"Run saved in {train(config)}")
    elif args.command == "qualify":
        from .trainer import qualify

        print(json.dumps(qualify(config), indent=2))
    elif args.command == "preview":
        from .audition import make_preview

        print(make_preview(config, args.text, args.emotion, args.adapter))
    elif args.command == "review":
        if not 1 <= args.limit <= 20:
            raise ValueError("Review limit must be between 1 and 20")
        from .audition import blind_review

        print(blind_review(config, args.adapter, args.limit))
    elif args.command == "export":
        from .audition import export_voice

        print(export_voice(config, args.adapter, args.name))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, KeyError) as error:
        print(f"Voice preparation: {error}", file=sys.stderr)
        raise SystemExit(1)
