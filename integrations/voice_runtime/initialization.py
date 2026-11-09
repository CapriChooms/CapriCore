"""Bound CPU initialization work separately from steady-state voice inference."""
from functools import wraps
import torch


def initialization_threads(initialize):
    @wraps(initialize)
    def load(self, config):
        inference = config['cpuThreads']
        startup = config.get('startupCpuThreads', inference)
        torch.set_num_threads(startup)
        try:
            return initialize(self, config)
        finally:
            torch.set_num_threads(inference)
    return load
