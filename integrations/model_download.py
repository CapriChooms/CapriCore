"""Explicit model provisioning: bounded, resumable downloads with visible progress."""

import hashlib
import os
import http.client
import re
import stat
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from email.utils import parsedate_to_datetime
from pathlib import Path


class ModelDownloadError(OSError):
    """A bounded network failure with enough information to resume setup."""


class _DownloadPaused(Exception):
    pass


def _retry_delay(error, attempt):
    delay = min(2 ** (attempt - 1), 30)
    if isinstance(error, urllib.error.HTTPError):
        value = error.headers.get('Retry-After', '') if error.headers else ''
        try:
            delay = max(delay, float(value))
        except ValueError:
            try:
                delay = max(delay, parsedate_to_datetime(value).timestamp() - time.time())
            except (ValueError, TypeError, OverflowError):
                pass
    return max(0, min(delay, 30))


def _reason(error):
    if isinstance(error, urllib.error.HTTPError):
        return f'HTTP {error.code}'
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, ConnectionResetError) or getattr(reason, 'winerror', None) == 10054:
        return 'remote server closed the connection'
    if isinstance(reason, TimeoutError):
        return 'network timeout'
    if isinstance(reason, http.client.IncompleteRead):
        return 'incomplete server response'
    return 'network connection failed'


def _network_detail(error, source, stage):
    # Report only the host and a numeric OS error. Signed redirect URLs, query
    # strings, credentials and arbitrary exception text never enter this detail.
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    code = getattr(reason, 'winerror', None) or getattr(reason, 'errno', None)
    return f'host={urlsplit(source).hostname}; stage={stage}' + (f'; code={code}' if isinstance(code, int) else '')


def _regular_path(path):
    for entry in (path, *path.parents):
        try:
            info = entry.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        ):
            raise ValueError("Model download paths cannot follow filesystem links")
    if path.exists() and not path.is_file():
        raise ValueError("Model download target must be a regular file")


def _verified(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == digest


def download_verified(
    url,
    target,
    item,
    *,
    timeout=45,
    attempts=6,
    fallback_urls=(),
    emit=print,
    opener=urllib.request.urlopen,
    sleep=time.sleep,
):
    """Never publish an incomplete model; preserve partial bytes for retry."""
    target = Path(target).absolute()
    partial = target.with_suffix(target.suffix + ".partial")
    expected, checksum = item["bytes"], item["sha256"]
    if not isinstance(fallback_urls, (tuple, list)):
        raise ValueError("Invalid model download sources")
    sources = (url, *fallback_urls)
    if (
        any(not isinstance(source, str) or not source.startswith("https://") for source in sources)
        or not isinstance(expected, int)
        or expected <= 0
        or not re.fullmatch(r"[a-f0-9]{64}", checksum)
        or type(attempts) is not int or not 1 <= attempts <= 10
        or not 1 <= len(sources) <= 4
    ):
        raise ValueError("Invalid pinned model download")
    _regular_path(target)
    _regular_path(partial)
    target.parent.mkdir(parents=True, exist_ok=True)

    def log(message):
        emit(message, flush=True)

    if _verified(target, expected, checksum):
        log("Verified " + target.name)
        return target
    if _verified(partial, expected, checksum):
        partial.replace(target)
        log("Verified resumed " + target.name)
        return target
    if partial.exists() and partial.stat().st_size >= expected:
        partial.unlink()

    pause_file = os.environ.get('CAPRI_INSTALL_PAUSE_FILE')
    paused = lambda: bool(pause_file and Path(pause_file).exists())
    attempt = 1
    while attempt <= attempts:
        if paused():
            log('Download paused. Partial model retained.')
            while paused():
                sleep(0.2)
            log('Resuming model download.')
        offset = partial.stat().st_size if partial.exists() else 0
        headers = {"Accept-Encoding": "identity", "Accept": "application/octet-stream",
                   "Cache-Control": "no-cache", "User-Agent": "Capri-Installer/0.3"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        log(
            f"Connecting: {target.name} ({expected / 1e6:.1f} MB)"
            + (f", resuming at {offset / 1e6:.1f} MB" if offset else "")
        )
        source_index = (attempt - 1) % len(sources)
        if source_index:
            log(f"Using alternate official source {source_index + 1}/{len(sources)} for {target.name}")
        failure = None
        stage = 'connect'
        try:
            if offset == expected and _verified(partial, expected, checksum):
                partial.replace(target)
                log("Verified resumed " + target.name)
                return target
            request = urllib.request.Request(sources[source_index], headers=headers)
            with opener(request, timeout=timeout) as source:
                stage = 'headers'
                status = source.status
                if status == 206:
                    match = re.fullmatch(
                        r"bytes (\d+)-(\d+)/(\d+)",
                        source.headers.get("Content-Range", ""),
                    )
                    if (
                        not match
                        or int(match[1]) != offset
                        or int(match[3]) != expected
                        or int(match[2]) != expected - 1
                    ):
                        raise ValueError("Model server returned an invalid byte range")
                elif status == 200:
                    # A server may ignore Range. Replace the partial instead
                    # of appending a complete response to its existing prefix.
                    offset = 0
                else:
                    raise ValueError("Unexpected model server response")
                declared = source.headers.get("Content-Length")
                if declared is not None and int(declared) != expected - offset:
                    raise ValueError("Model response size differs from pinned metadata")
                digest = hashlib.sha256()
                if offset:
                    with partial.open("rb") as prefix:
                        while chunk := prefix.read(1024 * 1024):
                            digest.update(chunk)
                size = offset
                previous_size, previous_time = size, time.monotonic()
                log(f"{target.name}: {size * 100 // expected}% | {size / 1e6:.1f}/{expected / 1e6:.1f} MB")
                with partial.open("ab" if offset else "wb") as dest:
                    stage = 'transfer'
                    while chunk := source.read(256 * 1024):
                        if paused():
                            raise _DownloadPaused()
                        size += len(chunk)
                        if size > expected:
                            raise ValueError("Model download exceeds pinned size")
                        digest.update(chunk)
                        dest.write(chunk)
                        now = time.monotonic()
                        if now - previous_time >= 1 or size == expected:
                            rate = (size - previous_size) / max(now - previous_time, 0.001)
                            remaining = (expected - size) / max(rate, 1)
                            log(
                                f"{target.name}: {size * 100 // expected}% | "
                                f"{size / 1e6:.1f}/{expected / 1e6:.1f} MB | "
                                f"{rate / 1e6:.2f} MB/s | ~{remaining:.0f} s"
                            )
                            previous_size, previous_time = size, now
                if size != expected:
                    raise http.client.IncompleteRead(b"", expected - size)
                if digest.hexdigest() != checksum:
                    partial.unlink(missing_ok=True)
                    raise ValueError("Model download checksum mismatch")
            partial.replace(target)
            log("Verified " + target.name)
            return target
        except _DownloadPaused:
            continue
        except urllib.error.HTTPError as error:
            failure = error
            if error.code == 416 and offset:
                partial.unlink(missing_ok=True)
            elif (error.code not in (408, 429, 500, 502, 503, 504)
                  and not (len(sources) > 1 and error.code in (403, 404))):
                raise
        except (OSError, urllib.error.URLError, http.client.IncompleteRead, http.client.RemoteDisconnected) as error:
            if isinstance(error, (PermissionError, IsADirectoryError)) or getattr(error, 'errno', None) == 28:
                raise
            failure = error
        saved = partial.stat().st_size if partial.exists() else 0
        reason = _reason(failure)
        detail = _network_detail(failure, sources[source_index], stage)
        if attempt == attempts:
            raise ModelDownloadError(
                f"Could not download {target.name} after {attempts} attempts: {reason} ({detail}). "
                f"Saved {saved / 1e6:.1f}/{expected / 1e6:.1f} MB; retry setup to resume. "
                "Already verified models are preserved."
            ) from None
        delay = _retry_delay(failure, attempt)
        log(f"Download interrupted: {target.name} ({reason}; {detail}). Retrying {attempt + 1}/{attempts} "
            f"in {delay:g} s; {saved / 1e6:.1f} MB retained.")
        sleep(delay)
        attempt += 1
