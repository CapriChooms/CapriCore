"""Retry transient locked-package transfers without changing pins or clearing caches."""
# SPDX-License-Identifier: GPL-3.0-only
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import subprocess
import signal
import sys
from tempfile import TemporaryDirectory
import threading
import time

TAIL_BYTES = 64 * 1024
ATTEMPT_TIMEOUT_SECONDS = 15 * 60
ATTEMPT_TIMEOUT_CODE = 'CAPRI_DEPENDENCY_ATTEMPT_TIMEOUT'
ROOT = Path(__file__).resolve().parents[2]
_PYTORCH = re.compile(
    r'https://(download(?:-r2)?\.pytorch\.org)/whl/(cu\d+)/(?:torch|torchaudio)(?:/|-)',
    re.I,
)
_PYTORCH_ORIGIN = 'https://download.pytorch.org'
_PERMANENT = re.compile(
    r'no solution found|requirements are unsatisfiable|'
    r'hash mismatch|hashes? (?:do|does) not match|checksum mismatch|'
    r'certificate verify failed|certificate verification failed|certificate_verify_failed|'
    r'ssl certificate problem|invalid peer certificate|self[- ]signed certificate|'
    r'error adding trust anchors from file|'
    r'permission denied|access (?:is )?denied|operation not permitted|no space left|'
    r'authentication failed|could not read username|terminal prompts disabled|'
    r'repository [^\r\n]*not found|couldn.t find remote ref|not our ref|'
    r'reference is not a tree|revision or path not in the working tree|'
    r'(?:HTTP|status(?: code)?|returned error:)\s*[:=]?\s*(?:401|403|404|410)\b|'
    r'HTTP status (?:client|server) error\s*\((?:401|403|404|410)\b|'
    r'build backend returned an error|subprocess-exited-with-error|failed to build\b|failed to prepare metadata', re.I,
)
_CURL = re.compile(r'\bcurl[ :]+(\d+)\b', re.I)
_NETWORK = re.compile(
    r'connection (?:reset|aborted|closed prematurely)|ECONNRESET|'
    r'network is unreachable|temporary failure in name resolution|'
    r'could not resolve host|failed to (?:connect|lookup address)|'
    r'(?:connect|read|operation|request)\w* timed? out|operation timed out|'
    r'\bnetwork timeout\b|\b(?:os error|WinError)\s*[:=]?\s*(?:10054|10053|10060)\b|'
    # TLS transport EOF is a closed connection, not a certificate rejection.
    # Keep certificate/authentication failures in _PERMANENT above this match.
    r'\b(?:tls|ssl) handshake (?:unexpected )?eof\b|'
    r'\bunexpected eof (?:while|during) (?:reading|(?:the )?(?:tls|ssl) handshake)\b|'
    r'peer closed connection without sending (?:a )?(?:tls )?close_notify|'
    r'incomplete (?:message|body|download)|peer closed connection|'
    r'HTTP status (?:client|server) error\s*\((?:408|429|500|502|503|504)\b|'
    r'(?:HTTP|status(?: code)?|returned error:)\s*[:=]?\s*(?:408|429|500|502|503|504)\b', re.I,
)


def transient_failure(returncode, output):
    """An exit code/early EOF alone cannot establish a retryable Git failure."""
    if returncode not in (1, 2, 128):
        return None
    fatal = output
    # uv can wrap a timed-out wheel stream as an invalid package and then print
    # "requirements are unsatisfiable". Only that proven transport wrapper is
    # retryable; hash, certificate, authentication and real resolver errors stay fatal.
    if (re.search(r'invalid package format', output, re.I) and
            re.search(r'Failed to download distribution due to network timeout', output, re.I)):
        fatal = re.sub(r'no solution found|requirements are unsatisfiable', '', output, flags=re.I)
    if _PERMANENT.search(fatal):
        return None
    curl = _CURL.search(output)
    if curl and int(curl[1]) in {6, 7, 16, 18, 28, 52, 55, 56, 92}:
        return 'git-curl-' + curl[1]
    if re.search(r'RPC failed|Git operation failed', output, re.I) and re.search(
        r'unexpected disconnect|fatal: early EOF|transfer closed', output, re.I
    ):
        return 'git-disconnected'
    if _NETWORK.search(output):
        return 'git-network' if re.search(r'Git operation failed|git fetch|RPC failed', output, re.I) else 'package-network'
    return None


def git_config(environ, settings):
    """Append process-scoped Git configuration without writing any config files."""
    env = dict(environ)
    count = int(env.get('GIT_CONFIG_COUNT', '0'))
    if count < 0 or count > 1024:
        raise ValueError('Invalid inherited GIT_CONFIG_COUNT')
    for index, (name, value) in enumerate(settings.items(), start=count):
        env[f'GIT_CONFIG_KEY_{index}'] = name
        env[f'GIT_CONFIG_VALUE_{index}'] = value
    env['GIT_CONFIG_COUNT'] = str(count + len(settings))
    return env


def windows_git_trust(environ):
    """Use the Windows trust store for Capri's pinned public Git dependencies."""
    excluded = {
        'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_SSL_CAINFO',
        'GIT_SSL_CAPATH', 'GIT_SSL_NO_VERIFY',
    }
    env = {
        name: value for name, value in environ.items()
        if name.upper() not in excluded
        and not name.upper().startswith(('GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_'))
    }
    # A previous Git for Windows install can still point to its old PEM bundle.
    # Isolate this subprocess from those configs and preserve environment proxies.
    env['GIT_CONFIG_NOSYSTEM'] = '1'
    env['GIT_CONFIG_GLOBAL'] = os.devnull
    return git_config(env, {
        'http.sslBackend': 'schannel',
        'http.schannelUseSSLCAInfo': 'false',
        'http.sslVerify': 'true',
    })


def _write_output(chunk):
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()


def _stop_owned_tree(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        try:
            subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, timeout=5, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.poll() is None:
        process.kill()


def stream_process(command, env, output=_write_output, *, timeout_seconds=ATTEMPT_TIMEOUT_SECONDS):
    """Stream progress immediately and retain only a bounded diagnostic tail."""
    options = {'stdout': subprocess.PIPE, 'stderr': subprocess.STDOUT, 'env': env}
    if os.name == 'nt':
        options['creationflags'] = subprocess.CREATE_NO_WINDOW
    else:
        options['start_new_session'] = True
    with subprocess.Popen(command, **options) as process:
        tail = b''
        stopped, expired = threading.Event(), threading.Event()
        pause = env.get('CAPRI_INSTALL_PAUSE_FILE')

        def watchdog():
            active, previous = 0.0, time.monotonic()
            while not stopped.wait(min(1.0, timeout_seconds / 10)):
                now = time.monotonic()
                if not pause or not Path(pause).exists():
                    active += now - previous
                previous = now
                if active >= timeout_seconds and process.poll() is None:
                    expired.set()
                    _stop_owned_tree(process)
                    return

        monitor = threading.Thread(target=watchdog, daemon=True)
        monitor.start()
        try:
            while chunk := process.stdout.read1(4096):
                output(chunk)
                tail = (tail + chunk)[-TAIL_BYTES:]
            code = process.wait()
            text = tail.decode('utf-8', errors='replace')
            if expired.is_set():
                message = (ATTEMPT_TIMEOUT_CODE + ': Voice dependency download timed out '
                           '(network timeout). Completed cached packages were preserved.\n')
                output(message.encode('utf-8'))
                return 2, text + '\n' + message
            return code, text
        except BaseException:
            # The installer cancels the enclosing owned process tree. Standalone
            # interruption must also stop the immediate uv process before leaving.
            _stop_owned_tree(process)
            raise
        finally:
            stopped.set()
            monitor.join(timeout=6)


def wait_for_resume(environ):
    pause = environ.get('CAPRI_INSTALL_PAUSE_FILE')
    while pause and Path(pause).exists():
        time.sleep(0.1)


def pytorch_fallback(command, profile, output, *, source=None, temporary=None):
    """Use reviewed direct URLs, never construct download URLs from error text."""
    failed = _PYTORCH.search(output)
    if profile not in {'legacy', 'blackwell'} or source == 'mirror':
        return None
    if not failed and (source is not None or ATTEMPT_TIMEOUT_CODE not in output):
        return None
    runtimes = json.loads((ROOT / 'config/voice-runtime.json').read_text(encoding='utf-8'))
    selected = runtimes['profiles'][profile]
    # Do not accidentally change another environment's CUDA/profile selection.
    try:
        backend = command[command.index('--torch-backend') + 1]
    except (ValueError, IndexError):
        return None
    if backend != selected['backend'] or (failed and failed[2].lower() != backend):
        return None
    constraints = ROOT / selected['transportConstraints']
    if not constraints.is_file():
        return None
    mirror = source == 'official' or (failed and failed[1].lower() == 'download.pytorch.org')
    if not mirror:
        return [*command, '--constraints', str(constraints)], 'official'
    content = constraints.read_text(encoding='utf-8')
    mirrored, replaced = re.subn(
        r'^(torch(?:audio)? @ )' + re.escape(_PYTORCH_ORIGIN) + r'(?=/whl/)',
        lambda match: match[1] + runtimes['pytorchWheelMirror'],
        content,
        flags=re.MULTILINE,
    )
    if replaced != 2:
        return None
    path = Path(temporary()) / constraints.name
    path.write_text(mirrored, encoding='utf-8')
    return [*command, '--constraints', str(path)], 'mirror'


def run_uv(command, *, environ=None, run=stream_process, sleep=time.sleep,
           notify=lambda message: print(message, flush=True), before_attempt=wait_for_resume,
           pytorch_profile=None, use_windows_git_trust=False):
    """Retry locked dependencies, optionally switching only the PyTorch delivery host."""
    base_env = dict(os.environ if environ is None else environ)
    # Installer subprocesses use only the package sources and integrity policy in
    # Capri's lock. Proxy, cache and timeout settings still work normally.
    for name in list(base_env):
        if name.upper() in {
            'UV_INDEX', 'UV_EXTRA_INDEX_URL', 'UV_INDEX_URL', 'UV_DEFAULT_INDEX',
            'UV_FIND_LINKS', 'UV_NO_INDEX', 'UV_INDEX_STRATEGY', 'UV_TORCH_BACKEND',
            'UV_OVERRIDE', 'UV_CONSTRAINT', 'UV_BUILD_CONSTRAINT', 'UV_NO_VERIFY_HASHES',
            'UV_INSECURE_HOST', 'UV_CONFIG_FILE', 'UV_NO_DEPS', 'UV_NO_BUILD_ISOLATION',
            'UV_NO_BUILD_ISOLATION_PACKAGE', 'UV_REQUIRE_HASHES',
        }:
            del base_env[name]
    base_env['UV_NO_CONFIG'] = 'true'
    if use_windows_git_trust:
        base_env = windows_git_trust(base_env)
    base_env['GIT_TERMINAL_PROMPT'] = '0'
    # These are connect/idle-read deadlines, not a limit on a multi-GB transfer.
    # Respect user settings (including uv's older timeout aliases). Scope every
    # default to the child process; no registry or global environment changes.
    if not any(key in base_env for key in ('UV_HTTP_TIMEOUT','UV_REQUEST_TIMEOUT','HTTP_TIMEOUT')):
        base_env['UV_HTTP_TIMEOUT'] = '120'
    base_env.setdefault('UV_HTTP_CONNECT_TIMEOUT','30')
    # uv's own retries otherwise multiply our three whole-operation attempts.
    base_env.setdefault('UV_HTTP_RETRIES', '0')
    adaptive_downloads = 'UV_CONCURRENT_DOWNLOADS' not in base_env
    base_env.setdefault('UV_CONCURRENT_DOWNLOADS','8')
    git_fallback = False
    torch_source = None
    active_command = list(command)
    with ExitStack() as cleanup:
        for attempt in range(1, 4):
            before_attempt(base_env)
            env = git_config(base_env, {'http.version': 'HTTP/1.1'}) if git_fallback else dict(base_env)
            if torch_source:
                env['UV_NO_VERIFY_HASHES'] = 'false'
            if adaptive_downloads and not git_fallback and attempt > 1:
                env['UV_CONCURRENT_DOWNLOADS'] = '2' if attempt == 2 else '1'
            code, tail = run(list(active_command), env)
            if code == 0:
                return 0
            reason = transient_failure(code, tail)
            if not reason:
                return code if code > 0 else 130
            if attempt == 3:
                notify('Voice dependency download failed after 3 attempts (' + reason +
                       '). Cached packages were preserved. Retry setup when the connection is available.')
                if torch_source:
                    host = 'the PyTorch mirror' if torch_source == 'mirror' else 'the alternate official PyTorch source'
                    notify(f'Setup tried {host}. Try another network or a system-wide VPN/proxy, then retry setup.')
                return code
            if reason == 'package-network':
                alternate = pytorch_fallback(
                    command, pytorch_profile, tail, source=torch_source,
                    temporary=lambda: cleanup.enter_context(TemporaryDirectory(prefix='capri-pytorch-')),
                )
                if alternate:
                    active_command, torch_source = alternate
                    host = 'the Nanjing University PyTorch mirror' if torch_source == 'mirror' else 'official download.pytorch.org'
                    notify(f'PyTorch download interrupted. Switching to {host} with the same CUDA versions and pinned SHA-256 checksums.')
            git_fallback = git_fallback or reason.startswith('git-')
            notify('Voice dependency transfer interrupted (' + reason + '). Retrying ' +
                   str(attempt + 1) + '/3 with the same locked packages and existing cache' +
                   ('; Git will use HTTP/1.1.' if git_fallback else '.'))
            sleep(2 * attempt)
    raise AssertionError('Unreachable dependency retry state')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uv', required=True)
    parser.add_argument('--pytorch-profile', choices=['legacy', 'blackwell'])
    parser.add_argument('--windows-git-trust', action='store_true')
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    arguments = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
    if len(arguments) < 2 or arguments[0] != 'pip' or arguments[1] not in {'sync', 'install'}:
        parser.error('Only locked uv pip sync/install commands are supported')
    try:
        print('Voice dependencies: at most 3 attempts; stalled network reads time out after '
              '120 seconds. Each attempt is limited to 15 active minutes; user pauses do not count.',
              flush=True)
        return run_uv([args.uv, *arguments], pytorch_profile=args.pytorch_profile,
                      use_windows_git_trust=args.windows_git_trust and os.name == 'nt')
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
