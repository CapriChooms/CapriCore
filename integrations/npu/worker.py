# SPDX-License-Identifier: GPL-3.0-only
"""Private data-only NPU worker. Protocol output is never a service log."""
import gc
import hashlib
import json
import os
import sys
import threading

PROTOCOL = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
NULL = open(os.devnull, "w", encoding="utf-8")
os.dup2(NULL.fileno(), 1)
os.dup2(NULL.fileno(), 2)
sys.stdout = sys.stderr = NULL
WRITE_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
ACTIVE = None
PIPELINE = None
IDENTITY = None
MAX_INPUT = 131072
MAX_OUTPUT = 65536


class NpuError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def emit(value):
    with WRITE_LOCK:
        PROTOCOL.write(json.dumps(value, ensure_ascii=False) + "\n")
        PROTOCOL.flush()


def runtime(backend):
    try:
        if backend == "openvino":
            import openvino as ov
            import openvino_genai as genai
            return ov, genai
        if backend == "vitis":
            import onnxruntime_genai as genai
            return None, genai
        if backend == "qnn":
            import onnxruntime as ort
            import onnxruntime_genai as genai
            return ort, genai
    except (ImportError, OSError):
        raise NpuError("CAPRI_NPU_RUNTIME_MISSING") from None
    raise NpuError("CAPRI_NPU_BACKEND_UNSUPPORTED")


def probe(backend):
    sdk, _ = runtime(backend)
    if backend == "openvino":
        core = sdk.Core()
        devices = [str(value) for value in core.available_devices if str(value).split(".")[0] == "NPU"]
        return {"backend": backend, "available": bool(devices), "devices": devices,
                "sdkVersion": str(sdk.__version__)[:80]}
    expected = ("VitisAIExecutionProvider", "RyzenAIExecutionProvider") if backend == "vitis" else ("QNNExecutionProvider",)
    # RyzenAI is registered by the AMD GenAI runtime. A separate Python
    # onnxruntime package can report unrelated CPU/GPU providers.
    providers = [] if sdk is None else sdk.get_available_providers()
    return {"backend": backend, "available": any(value in providers for value in expected),
            "providers": [value for value in providers if value in expected], "requiresHardwareCheck": True,
            "sdkVersion": str(sdk.__version__)[:80]}


def load(request):
    global PIPELINE, IDENTITY
    backend, folder = request["backend"], request["modelPath"]
    identity = (backend, folder, request.get("contextTokens", 8192))
    if IDENTITY == identity and PIPELINE is not None:
        return {"ready": True, "backend": backend}
    PIPELINE, IDENTITY = None, None
    gc.collect()
    inventory = probe(backend)
    # RyzenAI can be registered in the vendor GenAI DLL rather than Python ORT.
    # Model construction and device_type below are the authoritative AMD check.
    if not inventory["available"] and backend != "vitis":
        raise NpuError("CAPRI_NPU_NOT_FOUND")
    _, genai = runtime(backend)
    if backend == "openvino":
        config = {"MAX_PROMPT_LEN": identity[2], "MIN_RESPONSE_LEN": 512}
        if request.get("cachePath"):
            config["CACHE_DIR"] = request["cachePath"]
        pipeline = genai.LLMPipeline(folder, "NPU", config)
    else:
        # The vendor-prepared config selects VitisAI/QNN. The host validates it
        # before this worker ever opens ONNX files; no CPU/DirectML substitution.
        validate_onnx(folder)
        pipeline = genai.Model(folder)
        device = str(pipeline.device_type).lower()
        if not any(value in device for value in (("vitis", "ryzen", "npu") if backend == "vitis" else ("qnn", "npu"))):
            raise NpuError("CAPRI_NPU_PROVIDER_MISMATCH")
    PIPELINE, IDENTITY = pipeline, identity
    return {"ready": True, "backend": backend}


def validate_onnx(folder):
    # Never allow an ONNX external tensor to read outside the selected model.
    try:
        import onnx
    except (ImportError, OSError):
        if validate_pinned_amd_graph(folder):
            return
        raise NpuError("CAPRI_NPU_RUNTIME_MISSING") from None
    from pathlib import Path
    base = Path(folder).resolve()
    for file in base.rglob("*.onnx"):
        model = onnx.load_model(str(file), load_external_data=False)
        # Follow populated message fields, including sparse tensors, subgraphs,
        # training graphs and function attributes. Never load tensor contents.
        pending = [model]
        while pending:
            value = pending.pop()
            if isinstance(value, onnx.TensorProto):
                if value.external_data or value.data_location == onnx.TensorProto.EXTERNAL:
                    paths = [item.value for item in value.external_data if item.key == "location"]
                    if len(paths) != 1 or not paths[0] or Path(paths[0]).drive or Path(paths[0]).is_absolute():
                        raise NpuError("CAPRI_NPU_MODEL_INVALID")
                    location = (file.parent / paths[0]).resolve()
                    if not location.is_relative_to(base) or not location.is_file():
                        raise NpuError("CAPRI_NPU_MODEL_INVALID")
                continue
            for field, child in value.ListFields():
                if field.type == field.TYPE_MESSAGE:
                    repeated = getattr(field, "is_repeated", None)
                    if repeated is None:
                        repeated = field.label == field.LABEL_REPEATED
                    pending.extend(child if repeated else (child,))


def validate_pinned_amd_graph(folder):
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    with (root / "config" / "npu-models.json").open(encoding="utf-8") as handle:
        pack = json.load(handle)["vitis"]
    expected = root / "data" / "models" / "npu" / "vitis" / pack["revision"][:12] / "model"
    base = Path(folder).resolve()
    if base != expected:
        return False
    # The reviewed AMD graph has one external tensor file, model.onnx.data.
    # Match the shipped graph/config digests before using that known layout.
    files = {spec["path"]: spec for spec in pack["files"]}
    for name in ("genai_config.json", "model.onnx", "model.pb.bin"):
        file = base / name
        spec = files[name]
        if not file.is_file() or file.stat().st_size != spec["bytes"]:
            raise NpuError("CAPRI_NPU_MODEL_INVALID")
        if hashlib.sha256(file.read_bytes()).hexdigest() != spec["sha256"]:
            raise NpuError("CAPRI_NPU_MODEL_INVALID")
    for name in ("model.onnx.data", "model.bin"):
        file = base / name
        if not file.is_file() or file.stat().st_size != files[name]["bytes"]:
            raise NpuError("CAPRI_NPU_MODEL_INVALID")
    return True


def generate(request, cancelled):
    if PIPELINE is None or IDENTITY is None:
        raise NpuError("CAPRI_NPU_NOT_READY")
    backend = IDENTITY[0]
    messages = request.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 100:
        raise NpuError("CAPRI_NPU_INPUT_INVALID")
    size = 0
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant") or not isinstance(message.get("content"), str):
            raise NpuError("CAPRI_NPU_INPUT_INVALID")
        size += len(message["content"])
    if size > MAX_INPUT:
        raise NpuError("CAPRI_NPU_INPUT_LIMIT")
    maximum = request.get("maxTokens", 512)
    if not isinstance(maximum, int) or isinstance(maximum, bool) or not 1 <= maximum <= 4096:
        raise NpuError("CAPRI_NPU_INPUT_INVALID")
    total = 0

    def delta(text):
        nonlocal total
        if cancelled.is_set() or total >= MAX_OUTPUT:
            return True
        text = text[:MAX_OUTPUT - total]
        total += len(text)
        if text:
            emit({"id": request["id"], "type": "delta", "text": text})
        return cancelled.is_set() or total >= MAX_OUTPUT

    _, genai = runtime(backend)
    if backend == "openvino":
        tokenizer = PIPELINE.get_tokenizer()
        prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
        tokens = tokenizer.encode(prompt).input_ids
        count = int(tokens.get_shape()[-1])
        if count + maximum > IDENTITY[2]:
            raise NpuError("CAPRI_NPU_CONTEXT_LIMIT")
        PIPELINE.generate(prompt, max_new_tokens=maximum, do_sample=False, streamer=delta)
    else:
        tokenizer = genai.Tokenizer(PIPELINE)
        template_file = os.path.join(IDENTITY[1], "chat_template.jinja")
        if os.path.isfile(template_file):
            with open(template_file, encoding="utf-8") as handle:
                template = handle.read(65537)
        else:
            with open(os.path.join(IDENTITY[1], "tokenizer_config.json"), encoding="utf-8") as handle:
                template = json.load(handle).get("chat_template")
        if not isinstance(template, str) or len(template) > 65536:
            raise NpuError("CAPRI_NPU_MODEL_INVALID")
        prompt = tokenizer.apply_chat_template(
            template_str=template, messages=json.dumps(messages, ensure_ascii=False),
            add_generation_prompt=True,
        )
        tokens = tokenizer.encode(prompt)
        if len(tokens) + maximum > IDENTITY[2]:
            raise NpuError("CAPRI_NPU_CONTEXT_LIMIT")
        params = genai.GeneratorParams(PIPELINE)
        params.set_search_options(max_length=len(tokens) + maximum, do_sample=False)
        stream = tokenizer.create_stream()
        generator = genai.Generator(PIPELINE, params)
        generator.append_tokens(tokens)
        while not generator.is_done() and not cancelled.is_set():
            generator.generate_next_token()
            if delta(stream.decode(int(generator.get_next_tokens()[0]))):
                break
        del generator
    return {"finishReason": "cancelled" if cancelled.is_set() else "stop", "outputCharacters": total}


def work(request, cancelled):
    global ACTIVE, PIPELINE, IDENTITY
    identifier = request["id"]
    try:
        operation = request["op"]
        if operation == "probe":
            result = probe(request["backend"])
        elif operation == "load":
            emit({"id": identifier, "type": "status", "state": "loading"})
            result = load(request)
        elif operation == "generate":
            result = generate(request, cancelled)
        elif operation == "unload":
            PIPELINE, IDENTITY = None, None
            gc.collect()
            result = {"ready": False}
        else:
            raise NpuError("CAPRI_NPU_PROTOCOL_INVALID")
        packet = {"id": identifier, "type": "result", "ok": True, "data": result}
    except Exception as error:
        # Exception strings can contain file paths, prompts or model text.
        packet = {"id": identifier, "type": "result", "ok": False,
                  "code": error.code if isinstance(error, NpuError) else "CAPRI_NPU_EXECUTION_FAILED"}
    finally:
        with STATE_LOCK:
            if ACTIVE and ACTIVE[0] == identifier:
                ACTIVE = None
    emit(packet)


def main():
    global ACTIVE
    emit({"type": "ready", "protocol": 1})
    for raw in sys.stdin:
        if len(raw) > 1024 * 1024:
            break
        try:
            request = json.loads(raw)
            identifier = request.get("id")
            if not isinstance(identifier, int) or isinstance(identifier, bool) or identifier < 1:
                raise ValueError()
            operation = request.get("op")
            # First NumPy/native DLL initialization on Windows must happen on
            # the main thread, before it waits on a pipe. Generation remains
            # cancellable in the job thread; the parent can kill a hung import.
            if operation in ("probe", "load") and ACTIVE is None:
                try:
                    runtime(request.get("backend"))
                except NpuError as error:
                    emit({"id": identifier, "type": "result", "ok": False, "code": error.code})
                    continue
            with STATE_LOCK:
                if operation in ("cancel", "shutdown"):
                    if ACTIVE:
                        ACTIVE[1].set()
                    if operation == "shutdown":
                        break
                    continue
                if ACTIVE:
                    emit({"id": identifier, "type": "result", "ok": False, "code": "CAPRI_NPU_BUSY"})
                    continue
                cancelled = threading.Event()
                ACTIVE = (identifier, cancelled)
                threading.Thread(target=work, args=(request, cancelled), daemon=True).start()
        except Exception:
            emit({"type": "protocol-error", "code": "CAPRI_NPU_PROTOCOL_INVALID"})
    if ACTIVE:
        ACTIVE[1].set()


if __name__ == "__main__":
    main()
