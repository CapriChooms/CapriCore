import logging
import threading
import unittest
from integrations.hub_download_messages import HubDownloadProgress, PublicHubHint, public_hub_messages


class HubMessageTests(unittest.TestCase):
    def test_long_first_file_shows_bytes_speed_and_eta_without_double_counting(self):
        now, notices = [0.0], []
        progress = HubDownloadProgress(10, notices.append, clock=lambda: now[0])
        progress.report()
        self.assertIn('waiting for model metadata or connection', notices[-1])
        progress.update('files', 0, 10, 'it')
        progress.update('transfer', 20_000_000, 100_000_000, 'B')
        progress.update('reconstructed', 30_000_000, 100_000_000, 'B')
        now[0] = 5
        progress.report()
        self.assertIn('0/10 files ready', notices[-1])
        self.assertIn('30.0/100.0 MB', notices[-1])
        self.assertIn('4.00 MB/s', notices[-1])
        self.assertIn('~18 s for known files', notices[-1])
        self.assertNotIn('50.0/200.0', notices[-1])
        self.assertNotIn('\r', notices[-1])
        self.assertNotIn('\x1b', notices[-1])
        now[0] = 25
        progress.report()
        self.assertIn('last progress 25 s ago', notices[-1])
        self.assertNotIn('MB/s', notices[-1])
        progress.update('files', 1, 10, 'it')
        now[0] = 28
        progress.report()
        self.assertIn('1/10 files ready', notices[-1])

    def test_heartbeat_updates_during_metadata_wait_and_stops_on_failure(self):
        notices, beat = [], threading.Event()
        def notify(message):
            notices.append(message)
            if len(notices) >= 3:
                beat.set()
        progress = HubDownloadProgress(10, notify, interval=0.01)
        with self.assertRaisesRegex(OSError, 'original network error'):
            with progress:
                self.assertTrue(beat.wait(1), 'No progress while waiting for metadata')
                raise OSError('original network error')
        self.assertFalse(progress.thread.is_alive())
        self.assertFalse(any('download complete' in message for message in notices))

    def test_success_reports_verification_as_a_separate_step(self):
        notices = []
        with HubDownloadProgress(2, notices.append) as progress:
            progress.update('files', 2, 2, 'it')
        self.assertFalse(progress.thread.is_alive())
        self.assertIn('No account is required', notices[0])
        self.assertIn('Checking downloaded files', notices[-1])

    def test_tqdm_reports_first_file_bytes_even_when_native_output_is_disabled(self):
        try:
            import tqdm
        except ImportError:
            self.skipTest('tqdm required for the native speech progress adapter')
        notices = []
        progress = HubDownloadProgress(10, notices.append)
        cls = progress.tqdm_class()
        with cls(total=1_000_000, unit='B', disable=True) as bar:
            bar.update(250_000)
            bar.refresh()
            progress.report()
        self.assertIn('0/10 files ready', notices[-1])
        self.assertIn('0.2/1.0 MB', notices[-1])
        self.assertFalse(any('\r' in line or '\x1b' in line for line in notices))

    def test_only_the_optional_token_hint_is_replaced_once(self):
        notices = []
        filter_ = PublicHubHint(notices.append)
        hint = 'Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.'
        record = lambda text, level=logging.WARNING: logging.LogRecord('huggingface_hub.utils._http', level, '', 0, text, (), None)
        self.assertFalse(filter_.filter(record(hint)))
        self.assertFalse(filter_.filter(record(hint)))
        self.assertEqual(len(notices), 1)
        for text in ['HTTP 429: rate limited; set HF_TOKEN', 'HTTP 403 forbidden', 'Checksum failed', 'Retrying download', hint + ' HTTP 401 failed']:
            self.assertTrue(filter_.filter(record(text)))
        self.assertTrue(filter_.filter(record(hint, logging.ERROR)))

    def test_filter_is_removed_even_when_download_fails(self):
        logger = logging.getLogger('huggingface_hub.utils._http')
        before = list(logger.filters)
        with self.assertRaises(ValueError):
            with public_hub_messages(lambda _: None):
                self.assertEqual(len(logger.filters), len(before) + 1)
                raise ValueError('download failed')
        self.assertEqual(logger.filters, before)
