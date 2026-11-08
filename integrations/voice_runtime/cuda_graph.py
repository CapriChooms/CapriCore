"""Fixed-address, single-token GPT-2 replay for the pinned Turbo backend.

The learned weights, sampling rules and FP32 math stay unchanged. Variable-length
text prefill remains eager. No Triton, quantization or compiled model download.
"""
import torch
from transformers import StaticCache
from transformers.generation.logits_process import (
    LogitsProcessorList, RepetitionPenaltyLogitsProcessor, TemperatureLogitsWarper,
    TopKLogitsWarper, TopPLogitsWarper,
)

from .inference import check_cancelled, SpeechGenerationLimit


class TurboGraph:
    @torch.inference_mode()
    def __init__(self, t3, cancelled=lambda: None, capacity=1536, max_tokens=800):
        self.t3, self.cancelled = t3, cancelled
        self.capacity, self.max_tokens = capacity, max_tokens
        self.native = t3.inference_turbo
        self.cache = StaticCache(config=t3.cfg, max_cache_len=capacity)
        self.token = torch.zeros(1, 1, dtype=torch.long, device='cuda:0')
        self.position = torch.zeros(1, dtype=torch.long, device='cuda:0')
        self.history = torch.zeros(1, max_tokens + 2, dtype=torch.long, device='cuda:0')
        self.history_position = torch.ones(1, dtype=torch.long, device='cuda:0')
        self.slots = torch.arange(capacity, device='cuda:0').view(1, 1, 1, -1)
        self.warpers = LogitsProcessorList([
            TemperatureLogitsWarper(.8), TopKLogitsWarper(1000), TopPLogitsWarper(.95),
            RepetitionPenaltyLogitsProcessor(1.2),
        ])
        # Populate cache storage and allocator kernels on a side stream first.
        stream = torch.cuda.Stream()
        stream.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(stream):
            for _ in range(3):
                self._step()
        torch.cuda.current_stream().wait_stream(stream)
        torch.cuda.synchronize()
        self.graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.graph):
            self._step()
        torch.cuda.synchronize()
        self.validation_max_error = self.qualify()

    @torch.inference_mode()
    def qualify(self):
        """Compare replay logits with the native dynamic-cache forward path."""
        prefix = self.t3.speech_emb(torch.tensor([[5, 8, 13, 21]], device='cuda:0'))
        next_id = torch.tensor([[34]], device='cuda:0')
        expected_cache = self.t3.tfmr(inputs_embeds=prefix, use_cache=True).past_key_values
        expected = self.t3.speech_head(self.t3.tfmr(
            inputs_embeds=self.t3.speech_emb(next_id), past_key_values=expected_cache, use_cache=True,
        )[0])[:, -1, :]
        self.cache.reset()
        positions = torch.arange(prefix.shape[1], device='cuda:0')
        mask = torch.where(self.slots <= positions.view(1, 1, -1, 1), 0., torch.finfo(torch.float32).min)
        self.t3.tfmr(inputs_embeds=prefix, past_key_values=self.cache, cache_position=positions,
                     position_ids=positions.unsqueeze(0), attention_mask=mask, use_cache=True)
        self.token.copy_(next_id); self.position.fill_(prefix.shape[1])
        self.history.copy_(next_id.expand_as(self.history)); self.history_position.fill_(1)
        self.graph.replay()
        torch.testing.assert_close(self.logits, expected, atol=2e-4, rtol=2e-4)
        return float((self.logits - expected).abs().max().item())

    def _step(self):
        mask = torch.where(self.slots <= self.position.view(1, 1, 1, 1), 0., torch.finfo(torch.float32).min)
        output = self.t3.tfmr(
            inputs_embeds=self.t3.speech_emb(self.token),
            past_key_values=self.cache, cache_position=self.position,
            position_ids=self.position.view(1, 1), attention_mask=mask, use_cache=True,
        )
        self.logits = self.t3.speech_head(output[0])[:, -1, :]
        processed = self.warpers(self.history, self.logits)
        self.sample = torch.multinomial(torch.softmax(processed, dim=-1), 1)
        self.history.index_copy_(1, self.history_position, self.sample)
        self.token.copy_(self.sample)
        self.history_position.add_(1)
        self.position.add_(1)

    @torch.inference_mode()
    def generate(self, t3_cond, text_tokens, temperature=.8, top_k=1000, top_p=.95,
                 repetition_penalty=1.2, max_gen_len=800):
        if (temperature, top_k, top_p, repetition_penalty) != (.8, 1000, .95, 1.2) or max_gen_len > self.max_tokens:
            return self.native(t3_cond, text_tokens, temperature, top_k, top_p, repetition_penalty, max_gen_len)
        check_cancelled(self.cancelled())
        bos = self.t3.hp.start_speech_token * torch.ones_like(text_tokens[:, :1])
        embeds, _ = self.t3.prepare_input_embeds(t3_cond=t3_cond, text_tokens=text_tokens, speech_tokens=bos, cfg_weight=0.)
        length = embeds.shape[1]
        if length + max_gen_len + 1 > self.capacity:
            return self.native(t3_cond, text_tokens, temperature, top_k, top_p, repetition_penalty, max_gen_len)
        self.cache.reset()
        positions = torch.arange(length, device='cuda:0')
        mask = torch.where(self.slots <= positions.view(1, 1, -1, 1), 0., torch.finfo(torch.float32).min)
        output = self.t3.tfmr(inputs_embeds=embeds, past_key_values=self.cache,
                              cache_position=positions, position_ids=positions.unsqueeze(0),
                              attention_mask=mask, use_cache=True)
        logits = self.t3.speech_head(output[0][:, -1:])[:, -1, :]
        current = torch.multinomial(torch.softmax(self.warpers(bos, logits), dim=-1), 1)
        self.token.copy_(current)
        # Duplicates do not compound scatter-based repetition penalty. Padding
        # with the first real token introduces no otherwise-unseen token IDs.
        self.history.copy_(current.expand_as(self.history))
        self.history_position.fill_(1)
        self.position.fill_(length)
        generated = [current.clone()]
        for _ in range(max_gen_len):
            check_cancelled(self.cancelled())
            self.graph.replay()
            value = self.sample.item()
            if value == self.t3.hp.stop_speech_token:
                break
            generated.append(self.sample.clone())
        else:
            raise SpeechGenerationLimit()
        return torch.cat(generated, dim=1)
