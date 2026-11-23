"""Inference-only reference conditioning without retained encoder/autograd state."""
import torch


def _tensors(module):
    return list(module.parameters()) + list(module.buffers())


def _storages(tensors):
    result = {}
    for tensor in tensors:
        if tensor.is_meta:
            raise ValueError('Reference cleanup requires materialized tensors')
        storage = tensor.untyped_storage()
        result[(str(tensor.device), storage.data_ptr())] = storage.nbytes()
    return result


def _cached_reference_decoder(source, conditionals, voice_encoder):
    try:
        from chatterbox.models.s3gen import S3Gen
    except ImportError:
        return None
    # Refuse unknown architectures, buffers or root hooks rather than silently
    # discarding a future inference component. Child decoder hooks stay intact.
    if (
        type(source) is not S3Gen
        or set(source._modules) != {'tokenizer', 'speaker_encoder', 'flow', 'mel2wav'}
        or source._parameters
        or set(source._buffers) != {'trim_fade'}
        or source._non_persistent_buffers_set != {'trim_fade'}
        or set(key for key in vars(source) if not key.startswith('_'))
        != {'training', 'meanflow', 'mel_extractor', 'resamplers', 'estimator_dtype'}
        or type(source.meanflow) is not bool
        or source.estimator_dtype != 'fp32'
        or type(source.resamplers) is not dict
        or source.resamplers
        or any((source._forward_hooks, source._forward_pre_hooks, source._backward_hooks))
        or not isinstance(voice_encoder, torch.nn.Module)
        or not all(isinstance(source._modules[key], torch.nn.Module) for key in source._modules)
        or not torch.is_tensor(source.trim_fade)
        or source.trim_fade.ndim != 1
        or not 0 < source.trim_fade.numel() <= 48000
    ):
        return None
    reference = getattr(conditionals, 'gen', None)
    if (
        not isinstance(reference, dict)
        or set(reference) != {'prompt_token', 'prompt_token_len', 'prompt_feat', 'prompt_feat_len', 'embedding'}
        or not all(torch.is_tensor(reference[key]) and reference[key].numel()
                   for key in ('prompt_token', 'prompt_token_len', 'prompt_feat', 'embedding'))
        or not torch.is_tensor(getattr(getattr(conditionals, 't3', None), 'speaker_emb', None))
        or not hasattr(conditionals.t3, '__dict__')
    ):
        return None
    cached_tensors = [value for value in reference.values() if torch.is_tensor(value)]
    cached_tensors += [value for value in vars(conditionals.t3).values() if torch.is_tensor(value)]
    if any(value.requires_grad or value.grad_fn is not None for value in cached_tensors):
        return None
    flow_parameters = list(source.flow.parameters())
    if not flow_parameters or any(tensor.is_meta for tensor in _tensors(source) + _tensors(voice_encoder)):
        return None

    class CachedReferenceDecoder(S3Gen):
        def __init__(self, original):
            # Reuse the exact learned tensors; do not run S3Gen construction.
            torch.nn.Module.__init__(self)
            self.flow = original.flow
            self.mel2wav = original.mel2wav
            self.register_buffer('trim_fade', original.trim_fade, persistent=False)
            self.meanflow = original.meanflow
            self.estimator_dtype = original.estimator_dtype
            self.eval()

        @property
        def device(self):
            return next(self.flow.parameters()).device

        @property
        def dtype(self):
            return next(self.flow.parameters()).dtype

        def embed_ref(self, *_args, **_kwargs):
            raise RuntimeError('Reference encoders were released; reload the voice to prepare a new reference')

    return CachedReferenceDecoder(source)


def prepare_reference(engine, reference_file, **kwargs):
    """Prepare once, keep detached conditioning, and prune only the pinned layout.

    releasedEncoderBytes counts removed, non-shared tensor storage, not a measured
    process working-set reduction. Unknown layouts retain all reference encoders.
    """
    for name in ('t3', 's3gen', 've'):
        module = getattr(engine, name, None)
        if isinstance(module, torch.nn.Module):
            module.eval().requires_grad_(False)
    with torch.inference_mode():
        engine.prepare_conditionals(str(reference_file), **kwargs)
    conditionals = getattr(engine, 'conds', None)
    reference = getattr(conditionals, 'gen', None)
    if isinstance(reference, dict):
        conditionals.gen = {key: value.detach() if torch.is_tensor(value) else value
                            for key, value in reference.items()}
    t3 = getattr(conditionals, 't3', None)
    if hasattr(t3, '__dict__'):
        for key, value in tuple(vars(t3).items()):
            if torch.is_tensor(value):
                setattr(t3, key, value.detach())
    source = getattr(engine, 's3gen', None)
    voice_encoder = getattr(engine, 've', None)
    replacement = _cached_reference_decoder(source, conditionals, voice_encoder)
    receipt = {'releasedEncoderBytes': 0, 'referenceEncodersReleased': False}
    if replacement is None:
        return receipt
    retained = _tensors(replacement)
    if isinstance(getattr(engine, 't3', None), torch.nn.Module):
        retained += _tensors(engine.t3)
    retained += [value for value in conditionals.gen.values() if torch.is_tensor(value)]
    retained += [value for value in vars(t3).values() if torch.is_tensor(value)]
    try:
        removed = _storages([tensor for module in (source.tokenizer, source.speaker_encoder, voice_encoder)
                             for tensor in _tensors(module)])
        kept = _storages(retained)
    except (RuntimeError, ValueError, TypeError):
        return receipt  # An unknown storage layout must keep its working model.
    engine.s3gen = replacement
    engine.ve = None
    return {'releasedEncoderBytes': sum(size for key, size in removed.items() if key not in kept),
            'referenceEncodersReleased': True}
