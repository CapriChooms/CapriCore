"""Model download integrity, progress and range-resume behavior without network."""

import hashlib
import io
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
from pathlib import Path

from integrations.model_download import download_verified, ModelDownloadError


class Response(io.BytesIO):
    def __init__(self, content, status=200, headers=None):
        super().__init__(content)
        self.status = status
        self.headers = headers or {"Content-Length": str(len(content))}


class Downloads(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / "encoder.int8.onnx"
        self.partial = self.target.with_suffix(".onnx.partial")
        self.data = b"pinned model bytes"
        self.item = {
            "bytes": len(self.data),
            "sha256": hashlib.sha256(self.data).hexdigest(),
        }
        self.lines = []

    def get(self, opener, **options):
        return download_verified(
            "https://huggingface.co/fixture/model",
            self.target,
            self.item,
            opener=opener,
            emit=lambda line, **_: self.lines.append(line),
            sleep=lambda _: None,
            **options,
        )

    def test_verified_download_reports_progress_and_publishes_atomically(self):
        def open_response(request, **_):
            self.assertFalse(self.target.exists())
            self.assertIsNone(request.get_header("Range"))
            return Response(self.data)

        self.get(open_response)
        self.assertEqual(self.target.read_bytes(), self.data)
        self.assertFalse(self.partial.exists())
        self.assertTrue(any("100%" in line and "MB/s" in line for line in self.lines))

    def test_transient_read_failure_resumes_at_written_prefix(self):
        class BrokenResponse(Response):
            def read(inner, size):
                if inner.tell():
                    raise OSError("connection reset fixture")
                return super().read(5)

        calls = []

        def open_response(request, **_):
            calls.append(request.get_header("Range"))
            if len(calls) == 1:
                return BrokenResponse(self.data)
            return Response(
                self.data[5:],
                206,
                {"Content-Range": f"bytes 5-{len(self.data)-1}/{len(self.data)}"},
            )

        self.get(open_response)
        self.assertEqual(calls, [None, "bytes=5-"])
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_connection_reset_changes_official_source_and_keeps_range(self):
        self.partial.write_bytes(self.data[:5])
        calls, progress = [], []
        def open_response(request, **_):
            calls.append(request.full_url)
            self.assertEqual(request.get_header('Range'), 'bytes=5-')
            self.assertEqual(request.get_header('Accept'), 'application/octet-stream')
            if len(calls) == 1:
                raise urllib.error.URLError(ConnectionResetError(10054, 'fixture'))
            return Response(self.data[5:], 206, {'Content-Range': f'bytes 5-{len(self.data)-1}/{len(self.data)}'})
        self.get(open_response, fallback_urls=['https://api.github.com/fixture/model'],
                 progress=lambda stage, received: progress.append((stage, received)))
        self.assertEqual(calls, ['https://huggingface.co/fixture/model', 'https://api.github.com/fixture/model'])
        self.assertEqual(self.target.read_bytes(), self.data)
        self.assertTrue(any('remote server closed' in line for line in self.lines))
        self.assertTrue(any('alternate official source' in line for line in self.lines))
        self.assertEqual(progress, [('connect', 5), ('retry', 5), ('connect', 5),
                                    ('download', 5), ('download', len(self.data))])

    def test_default_retries_allow_longer_outage_and_honor_retry_after(self):
        delays, calls = [], []
        def open_response(request, **_):
            calls.append(request)
            if len(calls) <= 4:
                if len(calls) == 1:
                    raise urllib.error.HTTPError(request.full_url, 429, 'fixture', {'Retry-After': '12'}, None)
                raise urllib.error.URLError(ConnectionResetError(10054, 'fixture'))
            return Response(self.data)
        download_verified('https://huggingface.co/fixture/model', self.target, self.item,
                          opener=open_response, emit=lambda *_a, **_k: None, sleep=delays.append)
        self.assertEqual(len(calls), 5)
        self.assertEqual(delays, [12, 2, 4, 8])

    def test_failure_names_file_and_preserves_bytes_without_exposing_url(self):
        self.partial.write_bytes(self.data[:5])
        def broken(request, **_):
            raise urllib.error.URLError(ConnectionResetError(10054, 'fixture'))
        with self.assertRaises(ModelDownloadError) as caught:
            self.get(broken, attempts=2)
        self.assertIn(self.target.name, str(caught.exception))
        self.assertIn('retry setup to resume', str(caught.exception))
        self.assertNotIn('https://', str(caught.exception))
        self.assertEqual(self.partial.read_bytes(), self.data[:5])

    def test_connection_failure_reports_host_phase_and_os_code_without_signed_url(self):
        def broken(request,**_): raise urllib.error.URLError(ConnectionResetError(10054,'private exception text'))
        with self.assertRaises(ModelDownloadError) as caught:
            download_verified('https://huggingface.co/fixture?token=private-token',self.target,self.item,
                              opener=broken,attempts=1,emit=lambda *_a,**_k:None)
        message=str(caught.exception)
        self.assertIn('host=huggingface.co; stage=connect; code=10054',message)
        self.assertNotIn('private',message)
        self.assertNotIn('token=',message)

    def test_bad_fallback_or_permanent_http_failure_is_not_retried(self):
        with self.assertRaises(ValueError):
            self.get(lambda *_a, **_k: self.fail('network used'), fallback_urls=['http://invalid.test/model'])
        calls = []
        def forbidden(request, **_):
            calls.append(request)
            raise urllib.error.HTTPError(request.full_url, 401, 'fixture', {}, None)
        with self.assertRaises(urllib.error.HTTPError):
            self.get(forbidden)
        self.assertEqual(len(calls), 1)

    def test_server_ignoring_range_restarts_without_duplicating_prefix(self):
        self.partial.write_bytes(self.data[:5])

        def open_response(request, **_):
            self.assertEqual(request.get_header("Range"), "bytes=5-")
            return Response(self.data)

        self.get(open_response)
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_invalid_range_does_not_append_or_publish(self):
        prefix = self.data[:5]
        self.partial.write_bytes(prefix)
        with self.assertRaisesRegex(ValueError, "invalid byte range"):
            self.get(lambda *_args, **_kw: Response(b"bad", 206, {"Content-Range": "bytes 4-6/7"}))
        self.assertEqual(self.partial.read_bytes(), prefix)
        self.assertFalse(self.target.exists())

    def test_corrupt_download_never_replaces_existing_file(self):
        self.target.write_bytes(b"old model preserved")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.get(lambda *_args, **_kw: Response(b"x" * len(self.data)))
        self.assertEqual(self.target.read_bytes(), b"old model preserved")
        self.assertFalse(self.partial.exists())

    def test_verified_cache_and_complete_partial_need_no_network(self):
        def unexpected(*_args, **_kwargs):
            self.fail("A verified cached model should not use the network")

        self.partial.write_bytes(self.data)
        self.get(unexpected)
        self.get(unexpected)
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_exhausted_retries_preserve_partial_for_next_run(self):
        prefix = self.data[:5]
        self.partial.write_bytes(prefix)
        calls = []

        def unavailable(request, **_):
            calls.append(request.get_header("Range"))
            raise OSError("offline fixture")

        with self.assertRaises(OSError):
            self.get(unavailable, attempts=2)
        self.assertEqual(calls, ["bytes=5-", "bytes=5-"])
        self.assertEqual(self.partial.read_bytes(), prefix)
        self.assertFalse(self.target.exists())

    def test_oversized_response_or_directory_cannot_be_promoted(self):
        with self.assertRaisesRegex(ValueError, "pinned metadata"):
            self.get(lambda *_args, **_kw: Response(self.data + b"extra"))
        self.assertFalse(self.target.exists())
        self.partial.mkdir()
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.get(lambda *_args, **_kw: Response(self.data))


if __name__ == "__main__":
    unittest.main()
