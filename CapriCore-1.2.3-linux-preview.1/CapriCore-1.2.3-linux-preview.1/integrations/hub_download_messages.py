"""Readable, line-oriented Hub progress for the installer's redirected output."""
# SPDX-License-Identifier: GPL-3.0-only
from contextlib import contextmanager
import io
import logging
import threading
import time


class HubDownloadProgress:
    """Report real byte counters, including during long first-file downloads."""

    def __init__(self, file_count, notify=lambda message: print(message, flush=True),
                 clock=time.monotonic, interval=3):
        self.file_count = file_count
        self.notify = notify
        self.clock = clock
        self.interval = interval
        self.started = clock()
        self.last_data = self.started
        self.last_report = None
        self.last_bytes = 0
        self.bars = {}
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None

    def update(self, key, count, total, unit):
        with self.lock:
            previous = self.bars.get(key, (0, None, unit))[0]
            if unit == 'B' and count != previous:
                self.last_data = self.clock()
            self.bars[key] = (count, total, unit)

    def report(self):
        with self.lock:
            now = self.clock()
            byte_bars = [b for b in self.bars.values() if b[2] == 'B']
            # Hub exposes transfer and reconstruction bars for the same bytes.
            # Never sum them: resumed/cache bytes may only be in reconstruction.
            available = max((b[0] for b in byte_bars), default=0)
            total = max((b[1] or 0 for b in byte_bars), default=0)
            transferred = min((b[0] for b in byte_bars), default=0)
            ready = max((b[0] for b in self.bars.values() if b[2] != 'B'), default=0)
            details = f'{int(ready)}/{self.file_count} files ready'
            if total:
                divisor, unit = (1e3, 'kB') if total < 1e6 else (1e6, 'MB')
                details += f' | {available / divisor:.1f}/{total / divisor:.1f} {unit} available (known files)'
            elif available:
                details += f' | {available / 1e6:.1f} MB available'
            elapsed = max(0, int(now - self.started))
            idle = max(0, int(now - self.last_data))
            if self.last_report is not None and now > self.last_report:
                rate = max(0, transferred - self.last_bytes) / (now - self.last_report)
                if rate > 0:
                    details += f' | {rate / 1e6:.2f} MB/s'
                    if total > available:
                        details += f' | ~{(total - available) / rate:.0f} s for known files'
            if not byte_bars or not (total or available):
                details += f' | waiting for model metadata or connection; {elapsed} s elapsed'
            elif idle >= 10:
                details += f' | waiting for server data; last progress {idle} s ago'
            self.last_report, self.last_bytes = now, transferred
            self.notify('Voice models: ' + details)

    def tqdm_class(self):
        # Keep the module and its standard-library tests usable without speech
        # dependencies. Import tqdm only when provisioning an actual model.
        from tqdm.auto import tqdm
        progress = self

        class InstallerTqdm(tqdm):
            def __init__(self, *args, **kwargs):
                self.progress_key = object()
                # HF otherwise auto-disables byte bars in a non-TTY subprocess.
                # Discard terminal cursor control; status is emitted as full lines.
                kwargs.update(disable=False, file=io.StringIO(), leave=False)
                super().__init__(*args, **kwargs)

            def display(self, *args, **kwargs):
                progress.update(self.progress_key, self.n, self.total, self.unit)

        return InstallerTqdm

    def _heartbeat(self):
        while not self.stop.wait(self.interval):
            self.report()

    def __enter__(self):
        noun = 'file' if self.file_count == 1 else 'files'
        self.notify(f'Preparing {self.file_count} public voice model {noun}. No account is required.')
        self.report()
        self.thread = threading.Thread(target=self._heartbeat, name='capri-model-progress', daemon=True)
        self.thread.start()
        return self

    def __exit__(self, error_type, error, traceback):
        self.stop.set()
        self.thread.join(timeout=1)
        if error_type is None:
            self.report()
            self.notify('Voice model download complete. Checking downloaded files...')
        # The original download exception remains visible to the installer.
        return False


class PublicHubHint(logging.Filter):
    def __init__(self, notify):
        super().__init__()
        self.notify = notify
        self.shown = False

    def filter(self, record):
        text = record.getMessage()
        hint = (record.levelno == logging.WARNING
                and 'unauthenticated requests' in text.lower()
                and 'HF_TOKEN' in text
                and not any(word in text.lower() for word in
                            ('429', '401', '403', 'forbidden', 'unauthorized', 'rate limited', 'failed')))
        if hint:
            if not self.shown:
                self.shown = True
                self.notify('Downloading public voice models. A Hugging Face account or HF_TOKEN is not required.')
            return False
        return True


@contextmanager
def public_hub_messages(notify=lambda message: print(message, flush=True)):
    logger = logging.getLogger('huggingface_hub.utils._http')
    filter_ = PublicHubHint(notify)
    logger.addFilter(filter_)
    try:
        yield
    finally:
        logger.removeFilter(filter_)
