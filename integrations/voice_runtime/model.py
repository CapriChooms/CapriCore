import json
import os
import subprocess
import time

import torch

from integrations.voice_training.backend import load_adapter, load_engine
from integrations.voice_training.dataset import ROOT, digest, inside, read_config
from .inference import check_cancelled, render, SpeechGenerationLimit
from .optimize import merge_adapters
from .profile_settings import merge_local_settings
from .reference_memory import prepare_reference
from .initialization import initialization_threads


def settings():
    value = json.loads((ROOT / "config/companion-voice.json").read_text(encoding="utf-8"))
    value = merge_local_settings(ROOT, 'companion-voice', value)
    if (
        value.get("schemaVersion") != 1
        or value.get("engine") != "chatterbox-turbo"
        or type(value.get("enabled")) is not bool
        or type(value.get("port")) is not int
        or not 1024 <= value["port"] <= 65535
        or value.get("precision") != "float32"
        or type(value.get("cpuThreads")) is not int
        or not 1 <= value["cpuThreads"] <= 16
        or type(value.get("maxSpeechTokens")) is not int
        or not 100 <= value["maxSpeechTokens"] <= 1000
        or type(value.get("seed")) is not int
        or not 0 <= value["seed"] < 2**63
        or value.get("decoderDevice", "auto") not in {"auto", "cpu", "cuda:0"}
        or type(value.get("mergeAdapter", True)) is not bool
        or type(value.get("cudaGraph", True)) is not bool
    ):
        raise ValueError("Invalid companion voice configuration")
    configured_threads = value['cpuThreads']
    value["cpuThreads"] = max(1, min(configured_threads, os.cpu_count() or 1, int(os.environ.get("CAPRI_CPU_THREADS", "16"))))
    value["profilePath"] = inside(ROOT, value["profileDir"])
    device = os.environ.get('CAPRI_VOICE_COMPUTE_DEVICE', 'auto')
    if device not in {'auto', 'cpu', 'cuda:0'}:
        raise ValueError('Invalid voice compute device')
    value['computeDevice'] = 'cpu' if device == 'cpu' else 'cuda:0'
    # The LLM's small-model thread budget also reaches this process. On a
    # larger CPU, permit the voice's configured budget while loading on GPU;
    # return to the low inference budget before serving requests. Weak PCs and
    # explicitly CPU-only speech retain their existing limit.
    value['startupCpuThreads'] = value['cpuThreads']
    if value['computeDevice'] != 'cpu' and (os.cpu_count() or 1) >= 16:
        value['startupCpuThreads'] = max(value['cpuThreads'], min(configured_threads, 8))
    return value


class DecoderMemoryBudget:
    """Leave physical VRAM for the LLM, CUDA Graph and acoustic work buffers.

    WDDM can page live CUDA weights into system RAM without raising OOM. Under
    that pressure, CPU acoustic decoding is faster than a paged GPU transformer.
    Check only between phrases; hysteresis avoids device transfers every phrase.
    """
    decoder_reserve_bytes = 1024 * 1024**2
    decoder_promotion_bytes = 2560 * 1024**2

    def choose_decoder(self):
        if self.config.get('computeDevice') == 'cpu':
            self.set_decoder_device('cpu')
            self.decoder_reason = 'configured-cpu'
            return
        requested = self.config.get('decoderDevice', 'auto')
        target = 'cpu'
        self.decoder_reason = 'configured-cpu'
        if requested == 'cuda:0':
            target, self.decoder_reason = 'cuda:0', 'configured-cuda'
        elif requested == 'auto':
            if self.free_gpu_bytes() >= self.decoder_promotion_bytes:
                target, self.decoder_reason = 'cuda:0', 'available-vram'
            else:
                self.decoder_reason = 'vram-reserve'
        try:
            self.set_decoder_device(target)
            if (requested == 'auto' and target == 'cuda:0'
                    and self.free_gpu_bytes() < self.decoder_reserve_bytes):
                self.set_decoder_device('cpu')
                torch.cuda.empty_cache()
                self.decoder_reason = 'vram-reserve'
        except torch.cuda.OutOfMemoryError:
            self.decoder_oom()
        self._decoder_check_after = time.monotonic() + 30

    def decoder_oom(self):
        self.set_decoder_device('cpu')
        torch.cuda.empty_cache()
        self.decoder_reason = 'cuda-oom'
        self._decoder_check_after = time.monotonic() + 30

    def rebalance_decoder(self):
        if self.config.get('computeDevice') == 'cpu':
            return
        if self.config.get('decoderDevice', 'auto') != 'auto':
            return
        now = time.monotonic()
        if now < getattr(self, '_decoder_check_after', 0):
            return
        self._decoder_check_after = now + 5
        free = self.free_gpu_bytes()
        if self.decoder_device == 'cuda:0' and free < self.decoder_reserve_bytes:
            # First release only inactive allocations; live buffers stay intact.
            torch.cuda.empty_cache()
            if self.free_gpu_bytes() < self.decoder_reserve_bytes:
                self.set_decoder_device('cpu')
                torch.cuda.empty_cache()
                self.decoder_reason = 'vram-reserve'
                self._decoder_check_after = now + 30
        elif self.decoder_device == 'cpu' and free >= self.decoder_promotion_bytes:
            try:
                self.set_decoder_device('cuda:0')
                self.decoder_reason = 'available-vram'
                if self.free_gpu_bytes() < self.decoder_reserve_bytes:
                    self.set_decoder_device('cpu')
                    torch.cuda.empty_cache()
                    self.decoder_reason = 'vram-reserve'
            except torch.cuda.OutOfMemoryError:
                self.decoder_oom()
            self._decoder_check_after = now + 30

    @staticmethod
    def free_gpu_bytes():
        free = torch.cuda.mem_get_info()[0]
        if getattr(torch.version, 'hip', None):
            return free
        # On WDDM cudaMemGetInfo may include a budget backed by system RAM.
        try:
            visible = os.environ.get('CAPRI_VOICE_GPU_UUID')
            if os.environ.get('CUDA_VISIBLE_DEVICES') and not visible:
                return free  # No reliable NVML identity; never read another card's row.
            result = subprocess.run(
                ['nvidia-smi', *(['--id=' + visible] if visible else []),
                 '--query-gpu=memory.free', '--format=csv,noheader,nounits'],
                capture_output=True, text=True, timeout=3, check=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            )
            free = min(free, int(result.stdout.splitlines()[0].strip()) * 1024**2)
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        return free


class CapriVoice(DecoderMemoryBudget):
    @initialization_threads
    def __init__(self, config):
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        compute = config.get('computeDevice', 'cuda:0')
        if compute != 'cpu' and not torch.cuda.is_available():
            raise RuntimeError("The selected voice needs the local CUDA environment")
        folder = config["profilePath"]
        profile = json.loads((folder / "voice-profile.json").read_text(encoding="utf-8"))
        upstream = json.loads((ROOT / "config/voice-upstream.json").read_text(encoding="utf-8"))
        if (profile["engine"] != config["engine"] or profile["language"] != "en"
                or profile["baseModel"] != upstream["model"]):
            raise ValueError("Exported voice belongs to another model or language")
        adapter = inside(folder, profile["adapter"])
        if digest(adapter) != profile["adapterSha256"]:
            raise ValueError("Exported voice adapter changed")
        reference = profile["references"]["neutral"]
        reference_file = inside(folder, reference["file"])
        if digest(reference_file) != reference["sha256"]:
            raise ValueError("Exported voice reference changed")
        self.engine = load_engine(read_config())
        load_adapter(self.engine.t3, folder, read_config())
        self.engine.t3.eval()
        self.adapter_merge_device = 'cpu'
        if (compute != 'cpu' and config.get('mergeAdapter', True)
                and self.free_gpu_bytes() >= sum(p.numel()*p.element_size() for p in self.engine.t3.parameters()) + 1024**3):
            # Fold on the selected GPU only with generous transient headroom.
            # FP32 and TF32 policy stay unchanged; low-VRAM/CPU devices keep
            # the existing CPU path without extra peak GPU allocations.
            self.engine.t3.to(device=compute, dtype=torch.float32)
            self.adapter_merge_device = compute
        self.merged_projections = len(merge_adapters(self.engine.t3)) if config.get("mergeAdapter", True) else 0
        self.engine.t3.to(device=compute, dtype=torch.float32)
        self.reference_memory = prepare_reference(self.engine, str(reference_file), norm_loudness=False)
        # Reference/speaker encoders remain on CPU during conditioning.
        self.engine.device = compute
        torch.cuda.empty_cache()
        self.config = config
        self.decoder_device = "cpu"
        self.reference = self.engine.conds.gen
        self.choose_decoder()
        self.cancelled = None
        self.engine.t3.tfmr.register_forward_pre_hook(lambda *_args: check_cancelled(self.cancelled))
        estimator = getattr(self.engine.s3gen.flow.decoder, 'estimator', None)
        if estimator is not None:
            estimator.register_forward_pre_hook(lambda *_args: check_cancelled(self.cancelled))
        self.config, self.profile = config, profile
        self.last_metrics = {}
        self.graph = None
        if compute != 'cpu' and not getattr(torch.version, 'hip', None) and config.get('cudaGraph', True) and config.get('mergeAdapter', True) and self.free_gpu_bytes() >= 768 * 1024**2:
            try:
                from .cuda_graph import TurboGraph
                self.graph = TurboGraph(self.engine.t3, cancelled=lambda: self.cancelled, max_tokens=config['maxSpeechTokens'])
                self.engine.t3.inference_turbo = self.graph.generate
            except (RuntimeError, ValueError, AssertionError) as error:
                self.graph = None
                torch.cuda.empty_cache()
                print(f'CUDA Graph unavailable; using native FP32 inference ({type(error).__name__})', flush=True)
        # Loading and graph validation leave inactive CUDA allocations behind.
        # Release those once, after setup, so the LLM can share the same GPU.
        # Live model/graph buffers remain allocated; no per-token cache flushing.
        torch.cuda.empty_cache()

    def set_decoder_device(self, device):
        self.engine.s3gen.flow.to(device)
        self.engine.s3gen.mel2wav.to(device)
        self.engine.s3gen.trim_fade = self.engine.s3gen.trim_fade.to(device)
        self.reference = {key: value.to(device) if torch.is_tensor(value) else value for key, value in self.reference.items()}
        # Keep one reference owner when the decoder moves between CPU and GPU.
        self.engine.conds.gen = self.reference
        self.decoder_device = device

    def generate(self, text, cancelled=None):
        self.cancelled = cancelled
        try:
            check_cancelled(cancelled)
            self.rebalance_decoder()
            started = time.perf_counter()
            seed = self.config['seed']
            try:
                audio, rate, self.last_metrics = self.render_phrase(text, cancelled, seed)
            except SpeechGenerationLimit:
                # Some samples never emit EOS in the replay path. Discard those
                # tokens and retry the intact sentence once using native FP32
                # inference and a fresh deterministic seed. No partial audio has
                # left this worker, so subtitle/audio ordering stays unchanged.
                check_cancelled(cancelled)
                failed_ms = (time.perf_counter()-started)*1000
                graph = getattr(self, 'graph', None)
                previous = self.engine.t3.inference_turbo if graph is not None else None
                try:
                    if graph is not None:
                        self.engine.t3.inference_turbo = graph.native
                    print('Voice speech-token limit: retrying the sentence once with native FP32 inference.', flush=True)
                    audio, rate, self.last_metrics = self.render_phrase(text, cancelled, (seed+1) % (2**63))
                finally:
                    if graph is not None:
                        self.engine.t3.inference_turbo = previous
                self.last_metrics = {**self.last_metrics,
                    'tokenMs':round(self.last_metrics['tokenMs']+failed_ms,2),
                    'totalMs':round((time.perf_counter()-started)*1000,2),
                    'recovery':'native-retry', 'recoveryMs':round(failed_ms,2)}
                self.generation_recoveries = getattr(self,'generation_recoveries',0)+1
            return audio, rate
        finally:
            self.cancelled = None

    def render_phrase(self, text, cancelled, seed):
        try:
            return render(self.engine, text, device=self.decoder_device, reference=self.reference,
                          seed=seed, max_tokens=self.config['maxSpeechTokens'], cancelled=cancelled)
        except torch.cuda.OutOfMemoryError:
            if self.decoder_device == 'cpu':
                raise
            self.decoder_oom()
            check_cancelled(cancelled)
            return render(self.engine, text, device='cpu', reference=self.reference,
                          seed=seed, max_tokens=self.config['maxSpeechTokens'], cancelled=cancelled)
