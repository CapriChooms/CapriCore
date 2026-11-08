"""Inference-only adapter folding; original model files and adapters stay intact."""
import torch

from integrations.voice_training.backend import LoRAProjection


@torch.no_grad()
def merge_adapters(t3):
    if t3.training:
        raise ValueError("Adapter merging is inference-only; switch to eval first")
    merged = []
    for name, layer in list(t3.named_modules()):
        if not isinstance(layer, LoRAProjection):
            continue
        # GPT-2 Conv1D stores [in, out]. Accumulate the update in FP32.
        delta = (layer.lora_B.float() @ layer.lora_A.float()).T * layer.scale
        weight = layer.base.weight.float() + delta
        if not torch.isfinite(weight).all():
            raise ValueError(f"Non-finite merged projection: {name}")
        layer.base.weight.copy_(weight.to(layer.base.weight.dtype))
        parent, _, child = name.rpartition('.')
        t3.get_submodule(parent)._modules[child] = layer.base
        merged.append(name)
    return merged
