"""Dependency transport recovery without package/model downloads or a GPU."""
# SPDX-License-Identifier: GPL-3.0-only
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools/setup/uv-retry.py'
spec = importlib.util.spec_from_file_location('capri_uv_retry', SCRIPT)
retry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retry)
REPORTED = '''error: Failed to download and build `resemble-perth @ git+https://github.com/resemble-ai/Perth.git@ff1c8ac55a976971245cdd53c18d6131ca00d993`
cause: Git operation failed
cause: failed to fetch commit `ff1c8ac55a976971245cdd53c18d6131ca00d993`
error: RPC failed; curl 18 transfer closed with outstanding read data remaining
error: 4460 bytes of body are still expected
fetch-pack: unexpected disconnect while reading sideband packet
fatal: early EOF
fatal: fetch-pack: invalid index-pack output'''
TORCH_TLS_EOF = '''error: Failed to download `torch==2.6.0+cu124`
  cause: Request failed after 3 retries in 88.7s
  cause: Failed to fetch: https://download-r2.pytorch.org/whl/cu124/torch-2.6.0%2Bcu124-cp311-cp311-win_amd64.whl
  cause: error sending request for url (https://download-r2.pytorch.org/whl/cu124/torch-2.6.0%2Bcu124-cp311-cp311-win_amd64.whl)
  cause: client error (Connect)
  cause: tls handshake eof'''


class UvRetryTests(unittest.TestCase):
    def test_reported_tls_eof_recovers_using_the_official_alternate_for_both_cuda_profiles(self):
        profiles = json.loads((ROOT / 'config/voice-runtime.json').read_text())['profiles']
        for profile, spec in profiles.items():
            if profile not in {'legacy', 'blackwell'}:
                continue
            with self.subTest(profile=profile):
                report = TORCH_TLS_EOF.replace('2.6.0', spec['torch'].split('+')[0]).replace('cu124', spec['backend'])
                calls, notices = [], []
                command = ['uv.exe', 'pip', 'sync' if profile == 'legacy' else 'install',
                           '--python', 'D:/Капри test/voice/Scripts/python.exe',
                           '-r', spec['requirements'], '--torch-backend', spec['backend']]
                def run(args, env):
                    calls.append((args, env))
                    return (2, report) if len(calls) == 1 else (0, '')
                original_env = {'UV_CACHE_DIR': 'D:/Капри test/cache'}
                self.assertEqual(retry.run_uv(command, environ=original_env, run=run, sleep=lambda _: None,
                                             notify=notices.append, pytorch_profile=profile), 0)
                self.assertEqual(calls[0][0], command)
                self.assertEqual(calls[1][0], [*command, '--constraints', str(ROOT / spec['transportConstraints'])])
                self.assertEqual(calls[1][1]['UV_CACHE_DIR'], original_env['UV_CACHE_DIR'])
                self.assertEqual(calls[1][1]['UV_NO_VERIFY_HASHES'], 'false')
                self.assertNotIn('GIT_CONFIG_COUNT', calls[1][1])
                self.assertTrue(any('Switching to official download.pytorch.org' in n for n in notices))

    def test_tls_connection_closures_retry_but_certificate_errors_and_cancellation_do_not(self):
        for error in ['tls handshake eof', 'TLS handshake unexpected EOF', 'ssl handshake eof',
                      'unexpected EOF while reading', 'unexpected eof during the TLS handshake',
                      'peer closed connection without sending TLS close_notify']:
            with self.subTest(error=error):
                self.assertEqual(retry.transient_failure(2, error), 'package-network')
                for fatal in ['certificate verify failed', 'invalid peer certificate', 'self-signed certificate',
                              'Hash mismatch', 'HTTP status client error (403 Forbidden)', 'Permission denied']:
                    self.assertIsNone(retry.transient_failure(2, error + '\n' + fatal))
                for exit_code in [0, 130, -15]:
                    self.assertIsNone(retry.transient_failure(exit_code, error))
        self.assertIsNone(retry.transient_failure(2, 'tls handshake failed: protocol version not supported'))
        calls, notices = [], []
        command = ['uv.exe', 'pip', 'sync', 'pinned.lock', '--torch-backend', 'cu124']
        retry.run_uv(command, environ={}, run=lambda args, env: (calls.append(args) or (2, TORCH_TLS_EOF)),
                     sleep=lambda _: None, notify=notices.append, pytorch_profile='legacy')
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[1], calls[2])
        self.assertEqual(calls[1].count('--constraints'), 1)
        self.assertIn('alternate official PyTorch source', notices[-1])

    def test_pytorch_fallback_uses_only_reviewed_matching_profile_and_keeps_original_lock(self):
        profiles = json.loads((ROOT / 'config/voice-runtime.json').read_text())['profiles']
        for profile, spec in profiles.items():
            if profile not in {'legacy', 'blackwell'}:
                continue
            calls, notices, environments = [], [], []
            reported = f'Failed to fetch: https://download-r2.pytorch.org/whl/{spec["backend"]}/torch-file.whl (os error 10054)'
            command = ['uv.exe', 'pip', 'sync', spec['requirements'], '--torch-backend', spec['backend']]
            def run(args, env):
                calls.append(args)
                environments.append(env)
                return (2, reported) if len(calls) == 1 else (0, '')
            self.assertEqual(retry.run_uv(command, environ={}, run=run, sleep=lambda _: None,
                                         notify=notices.append, pytorch_profile=profile), 0)
            self.assertEqual(calls[0], command)
            self.assertEqual(calls[1], [*command, '--constraints', str(ROOT / spec['transportConstraints'])])
            self.assertIn('pinned SHA-256', notices[0])
            self.assertEqual(environments[1]['UV_NO_VERIFY_HASHES'], 'false')
            text = (ROOT / spec['transportConstraints']).read_text()
            entries = [line for line in text.splitlines() if line and not line.startswith('#')]
            self.assertEqual(len(entries), 2)
            for name in ('torch', 'torchaudio'):
                link = next(line.split(' @ ', 1)[1] for line in entries if line.startswith(name+' @ '))
                parsed = urlsplit(link)
                self.assertEqual(parsed.scheme, 'https')
                self.assertEqual(parsed.hostname, 'download.pytorch.org')
                self.assertEqual(unquote(parsed.path), f'/whl/{spec["backend"]}/{name}-{spec[name]}-cp311-cp311-win_amd64.whl')
                self.assertRegex(parsed.fragment, r'^sha256=[a-f0-9]{64}$')
                self.assertIn(f'{name}=={spec[name]}', (ROOT / spec['requirements']).read_text().splitlines())
            self.assertIsNone(retry.pytorch_fallback(command, profile, reported.replace('pytorch.org/', 'pytorch.org.evil.invalid/')))
            wrong = [*command[:-1], 'cpu']
            self.assertIsNone(retry.pytorch_fallback(wrong, profile, reported))

    def test_pytorch_transport_does_not_bypass_fatal_errors_or_loop_hosts_forever(self):
        report = 'https://download-r2.pytorch.org/whl/cu124/torch-file.whl (os error 10054)'
        command = ['uv.exe', 'pip', 'sync', 'pinned.lock', '--torch-backend', 'cu124']
        for fatal in ['Hash mismatch', 'certificate verification failed', 'HTTP 403']:
            calls = []
            self.assertEqual(retry.run_uv(command, environ={}, run=lambda args, env: (calls.append(args) or (2, report+' '+fatal)),
                                         sleep=lambda _: self.fail('Permanent error retried'), notify=lambda _: None, pytorch_profile='legacy'), 2)
            self.assertEqual(calls, [command])
        calls, notices = [], []
        retry.run_uv(command, environ={}, run=lambda args, env: (calls.append(args) or (2, report)),
                     sleep=lambda _: None, notify=notices.append, pytorch_profile='legacy')
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[1], calls[2])
        self.assertEqual(calls[1].count('--constraints'), 1)
        self.assertIn('alternate official PyTorch source', notices[-1])

    def test_real_uv_direct_constraints_preserve_versions_for_sync_and_override_install(self):
        uv = ROOT / '.runtime/uv/uv.exe'
        if not uv.is_file():
            uv = shutil.which('uv')
        if not uv:
            self.skipTest('uv required for direct-URL constraint integration')
        parent = ROOT / '.runtime/uv-retry-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='Wheel transport ', dir=parent) as directory:
            folder = Path(directory)
            venv = folder / 'venv'
            python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            env = {**os.environ, 'UV_NO_CONFIG': '1', 'UV_CACHE_DIR': str(folder / 'cache'), 'UV_NO_VERIFY_HASHES': 'false'}
            def invoke(args):
                return subprocess.run([str(uv), *args], cwd=folder, env=env, capture_output=True,
                                      text=True, encoding='utf-8', errors='replace', timeout=20)
            result = invoke(['venv', str(venv), '--python', sys.executable, '--offline'])
            self.assertEqual(result.returncode, 0, result.stderr)
            for mode, version in [('sync', '2.6.0+cu124'), ('install', '2.7.1+cu128')]:
                entries = []
                for name in ('torch', 'torchaudio'):
                    wheel = folder / f'{name}-{version}-py3-none-any.whl'
                    dist = f'{name}-{version}.dist-info'
                    with zipfile.ZipFile(wheel, 'w') as archive:
                        archive.writestr(dist+'/METADATA', f'Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n')
                        archive.writestr(dist+'/WHEEL', 'Wheel-Version: 1.0\nGenerator: Capri test\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
                        archive.writestr(dist+'/RECORD', '')
                    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
                    entries.append(f'{name} @ {wheel.as_uri()}#sha256={digest}')
                constraints, lock = folder / 'transport.txt', folder / 'pins.txt'
                constraints.write_text('\n'.join(entries), encoding='utf-8')
                lock.write_text(f'torch=={version}\ntorchaudio=={version}\n', encoding='utf-8')
                args = ['pip', mode, '--python', str(python), '--offline', '--no-index', '--constraints', str(constraints)]
                args += [str(lock)] if mode == 'sync' else ['--exact', '-r', str(lock), '--overrides', str(lock)]
                result = invoke(args)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                result = invoke(['pip', 'list', '--python', str(python), '--format', 'json'])
                self.assertEqual({p['name']: p['version'] for p in json.loads(result.stdout)}, {'torch': version, 'torchaudio': version})
                # The URL's SHA-256 must actually be checked, not just displayed.
                constraints.write_text('\n'.join(line.split('#')[0]+'#sha256='+'0'*64 for line in entries), encoding='utf-8')
                result = invoke([*args, '--reinstall'])
                self.assertNotEqual(result.returncode, 0, 'Incorrect transport hash was accepted')
                self.assertIn('hash', result.stderr.lower())

    def test_localized_windows_transport_codes(self):
        for code in (10054, 10053, 10060):
            text = f'error sending request: localized Windows message (os error {code})'
            self.assertEqual(retry.transient_failure(1, text), 'package-network')
            self.assertIsNone(retry.transient_failure(1, text + '\nHash mismatch'))
        self.assertIsNone(retry.transient_failure(1, 'os error 5'))

    def test_reported_transfer_is_retryable_but_permanent_failures_take_precedence(self):
        self.assertEqual(retry.transient_failure(1, REPORTED), 'git-curl-18')
        self.assertEqual(retry.transient_failure(128, 'Git operation failed\nfatal: early EOF'), 'git-disconnected')
        self.assertIsNone(retry.transient_failure(1, 'fatal: early EOF'))
        self.assertIsNone(retry.transient_failure(1, 'fatal: fetch-pack: invalid index-pack output'))
        for code in (0, 130, -15):
            self.assertIsNone(retry.transient_failure(code, REPORTED))
        for fatal in [
            'No solution found when resolving dependencies', 'Hash mismatch for wheel',
            'SSL certificate problem: certificate verify failed', 'Permission denied',
            'Authentication failed', 'repository example not found', "couldn't find remote ref bad-pin",
            'fatal: not our ref abc', 'HTTP 403', 'status code: 404', 'returned error: 401',
            'No space left on device', 'The build backend returned an error', 'Failed to build package',
        ]:
            with self.subTest(fatal=fatal):
                self.assertIsNone(retry.transient_failure(1, REPORTED + '\n' + fatal))

    def test_same_locked_command_and_cache_are_reused_with_a_child_only_git_fallback(self):
        calls, sleeps, notices = [], [], []
        parent_env = {'UV_CACHE_DIR': 'private cache', 'GIT_CONFIG_COUNT': '1',
                      'GIT_CONFIG_KEY_0': 'fixture.setting', 'GIT_CONFIG_VALUE_0': 'unchanged'}
        original = dict(parent_env)
        command = ['uv.exe', 'pip', 'sync', '--python', 'Капри voice/python.exe',
                   'config/requirements-voice-training.lock', '--torch-backend', 'cu124',
                   '--default-index', 'https://pypi.org/simple', '--index-strategy', 'first-index']
        def run(args, env):
            calls.append((args, dict(env)))
            return (1, REPORTED) if len(calls) == 1 else (0, '')
        self.assertEqual(retry.run_uv(command, environ=parent_env, run=run, sleep=sleeps.append,
                                      notify=notices.append), 0)
        self.assertEqual(calls[0][0], command)
        self.assertEqual(calls[1][0], command)
        self.assertEqual(parent_env, original)
        self.assertEqual(calls[0][1]['GIT_CONFIG_COUNT'], '1')
        self.assertEqual(calls[1][1]['GIT_CONFIG_COUNT'], '2')
        self.assertEqual(calls[1][1]['GIT_CONFIG_KEY_1'], 'http.version')
        self.assertEqual(calls[1][1]['GIT_CONFIG_VALUE_1'], 'HTTP/1.1')
        self.assertEqual(calls[1][1]['UV_CACHE_DIR'], 'private cache')
        self.assertEqual(calls[1][1]['GIT_CONFIG_VALUE_0'], 'unchanged')
        self.assertNotIn('GIT_SSL_NO_VERIFY', calls[1][1])
        self.assertEqual(sleeps, [2])
        self.assertIn('Retrying 2/3', notices[0])

    def test_retry_limit_cancellation_and_nonnetwork_failures(self):
        calls, sleeps, notices = [], [], []
        def fail(args, env):
            calls.append(args)
            return 1, REPORTED
        self.assertEqual(retry.run_uv(['uv.exe', 'pip', 'sync'], environ={}, run=fail,
                                     sleep=sleeps.append, notify=notices.append), 1)
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [2, 4])
        self.assertIn('after 3 attempts', notices[-1])
        calls.clear()
        def permanent(args, env):
            calls.append(args)
            return 1, 'No solution found when resolving dependencies'
        retry.run_uv(['uv.exe'], environ={}, run=permanent, sleep=lambda _: self.fail('Unexpected retry'))
        self.assertEqual(len(calls), 1)
        def cancelled(_env):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            retry.run_uv(['uv.exe'], environ={}, run=lambda *_: self.fail('Cancelled command started'),
                         before_attempt=cancelled)
        calls.clear()
        def cancel_backoff(_seconds):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            retry.run_uv(['uv.exe'], environ={}, run=fail, sleep=cancel_backoff, notify=lambda _: None)
        self.assertEqual(len(calls), 1, 'cancellation during backoff must prevent another attempt')

    def test_package_transfer_retry_does_not_change_git_settings(self):
        calls = []
        def run(args, env):
            calls.append(env)
            return (1, 'HTTP 503') if len(calls) == 1 else (0, '')
        self.assertEqual(retry.run_uv(['uv.exe'], environ={}, run=run, sleep=lambda _: None,
                                     notify=lambda _: None), 0)
        self.assertNotIn('GIT_CONFIG_COUNT', calls[1])

    def test_streamed_wheel_network_timeout_is_not_a_permanent_archive_error(self):
        reported = '''error: Failed to download `numba==0.68.0`
cause: Failed to extract archive: numba-0.68.0-cp311-cp311-win_amd64.whl
cause: I/O operation failed during extraction
cause: Failed to download distribution due to network timeout. Try increasing UV_HTTP_TIMEOUT (current value: 30s).'''
        self.assertEqual(retry.transient_failure(2, reported), 'package-network')
        for fatal in ['Hash mismatch', 'Permission denied', 'No space left on device', 'certificate verification failed']:
            self.assertIsNone(retry.transient_failure(2, reported+'\n'+fatal))
        self.assertIsNone(retry.transient_failure(2, 'Failed to extract archive: invalid ZIP'))

    def test_slow_network_defaults_are_child_only_and_explicit_timeouts_are_preserved(self):
        for custom in [{}, {'UV_HTTP_TIMEOUT':'7'}, {'UV_REQUEST_TIMEOUT':'9'}, {'HTTP_TIMEOUT':'11'}]:
            original={**custom,'UV_CACHE_DIR':'preserved'}
            parent=dict(original)
            calls=[]
            def run(args, env):
                calls.append(dict(env))
                return (2,'network timeout') if len(calls)<3 else (0,'')
            self.assertEqual(retry.run_uv(['uv.exe'],environ=parent,run=run,sleep=lambda _:None,notify=lambda _:None),0)
            self.assertEqual(parent,original)
            self.assertEqual(calls[0]['UV_HTTP_CONNECT_TIMEOUT'],'30')
            self.assertEqual([e['UV_CONCURRENT_DOWNLOADS'] for e in calls],['8','2','1'])
            if custom:
                for key,value in custom.items(): self.assertEqual(calls[0][key],value)
                if 'UV_HTTP_TIMEOUT' not in custom: self.assertNotIn('UV_HTTP_TIMEOUT',calls[0])
            else: self.assertEqual(calls[0]['UV_HTTP_TIMEOUT'],'120')
        calls=[]
        retry.run_uv(['uv.exe'],environ={'UV_HTTP_CONNECT_TIMEOUT':'4','UV_CONCURRENT_DOWNLOADS':'3'},run=lambda args,env:(calls.append(env) or (0,'')))
        self.assertEqual(calls[0]['UV_HTTP_CONNECT_TIMEOUT'],'4')
        self.assertEqual(calls[0]['UV_CONCURRENT_DOWNLOADS'],'3')

    def test_uv_exit_two_retries_reported_pytorch_timeout_and_nested_http_errors(self):
        reported = '''error: Failed to download `torch==2.6.0+cu124`
cause: Request failed after 3 retries in 47.3s
cause: client error (Connect)
cause: operation timed out'''
        self.assertEqual(retry.transient_failure(2, reported), 'package-network')
        self.assertEqual(retry.transient_failure(2, 'HTTP status server error (503 Service Unavailable)'), 'package-network')
        self.assertIsNone(retry.transient_failure(2, reported + '\nHTTP status client error (403 Forbidden)'))
        self.assertIsNone(retry.transient_failure(2, 'invalid command-line argument'))
        calls = []
        def run(args, env):
            calls.append((list(args), dict(env)))
            return (2, reported) if len(calls) == 1 else (0, '')
        command = ['uv.exe', 'pip', 'sync', 'reviewed.lock', '--torch-backend', 'cu124']
        self.assertEqual(retry.run_uv(command, environ={'UV_CACHE_DIR': 'preserved'}, run=run, sleep=lambda _: None, notify=lambda _: None), 0)
        self.assertEqual([call[0] for call in calls], [command, command])
        self.assertEqual(calls[1][1]['UV_CACHE_DIR'], 'preserved')
        self.assertNotIn('GIT_CONFIG_COUNT', calls[1][1])

    def test_native_git_honors_the_scoped_http_fallback(self):
        git = shutil.which('git')
        if not git:
            self.skipTest('Git is required for its native configuration check')
        result = subprocess.run([git, 'config', '--get', 'http.version'],
                                env=retry.git_http_fallback(os.environ), capture_output=True,
                                text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'HTTP/1.1')

    def test_a_silent_dependency_process_and_its_child_are_stopped_at_the_attempt_deadline(self):
        output = io.BytesIO()
        started = time.monotonic()
        child = "import time; time.sleep(30)"
        command = [sys.executable, '-u', '-c',
                   "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c'," + repr(child) +
                   "]); print('Downloading torch (2.4GiB)',flush=True); time.sleep(30)"]
        code, tail = retry.stream_process(command, dict(os.environ), output=output.write,
                                          timeout_seconds=0.2)
        self.assertEqual(code, 2)
        self.assertIn(retry.ATTEMPT_TIMEOUT_CODE, tail)
        self.assertIn(b'Downloading torch', output.getvalue())
        self.assertLess(time.monotonic() - started, 7)
        self.assertEqual(retry.transient_failure(code, tail), 'package-network')

    def test_ui_pause_time_does_not_consume_the_dependency_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            pause = Path(directory) / 'pause'
            pause.touch()
            resume = threading.Timer(0.5, pause.unlink)
            resume.start()
            try:
                code, tail = retry.stream_process(
                    [sys.executable, '-c', "import time; time.sleep(0.6); print('ready')"],
                    {**os.environ, 'CAPRI_INSTALL_PAUSE_FILE': str(pause)},
                    output=lambda _: None, timeout_seconds=0.3)
                self.assertEqual(code, 0, tail)
            finally:
                resume.join()

    def test_stalled_dependency_attempts_are_limited_and_select_the_pinned_official_alternate(self):
        calls, notices = [], []
        command = ['uv.exe', 'pip', 'sync', 'reviewed.lock', '--torch-backend', 'cu124']
        timeout = retry.ATTEMPT_TIMEOUT_CODE + ': dependency network timeout'
        environment = {'UV_CACHE_DIR': 'keep-existing-cache'}
        def stalled(args, env):
            calls.append((args, env))
            return 2, timeout
        self.assertEqual(retry.run_uv(command, environ=environment, run=stalled,
                                      sleep=lambda _: None, notify=notices.append,
                                      pytorch_profile='legacy'), 2)
        self.assertEqual(len(calls), 3)
        self.assertNotIn('--constraints', calls[0][0])
        self.assertIn('--constraints', calls[1][0])
        self.assertEqual(calls[1][0], calls[2][0])
        self.assertTrue(all(env['UV_HTTP_RETRIES'] == '0' for _, env in calls))
        self.assertTrue(all(env['UV_CACHE_DIR'] == 'keep-existing-cache' for _, env in calls))
        self.assertEqual(environment, {'UV_CACHE_DIR': 'keep-existing-cache'})
        self.assertTrue(any('after 3 attempts' in notice for notice in notices))

    def test_real_uv_stalled_http_download_does_not_multiply_retries(self):
        uv = shutil.which('uv')
        if not uv:
            self.skipTest('uv required for local stalled-HTTP integration')
        requests = []
        class Stalled(BaseHTTPRequestHandler):
            def do_HEAD(self):
                self.send_response(200)
                self.send_header('Content-Length', '100000')
                self.end_headers()
            def do_GET(self):
                requests.append(self.path)
                self.send_response(200)
                self.send_header('Content-Length', '100000')
                self.end_headers()
                time.sleep(3)
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Stalled)
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        serving.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                env = {**os.environ, 'UV_NO_CONFIG': '1', 'UV_CACHE_DIR': str(Path(directory)/'cache'),
                       'UV_HTTP_TIMEOUT': '1', 'UV_HTTP_CONNECT_TIMEOUT': '1', 'NO_PROXY': '127.0.0.1'}
                venv = Path(directory)/'venv'
                created = subprocess.run([uv, 'venv', str(venv), '--python', sys.executable, '--offline'],
                                         env=env, capture_output=True, timeout=15)
                self.assertEqual(created.returncode, 0, created.stderr)
                python = venv/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
                url = f'http://127.0.0.1:{server.server_port}/stallfixture-1.0-py3-none-any.whl'
                attempts, outcomes = [], []
                def run(args, child_env):
                    attempts.append(args)
                    result = retry.stream_process(args, child_env, output=lambda _: None, timeout_seconds=8)
                    outcomes.append(result)
                    return result
                code = retry.run_uv([uv, 'pip', 'install', '--python', str(python), '--no-deps', '--no-index', url],
                                    environ=env, run=run, sleep=lambda _: None, notify=lambda _: None)
                self.assertNotEqual(code, 0)
                self.assertEqual(len(attempts), 3, outcomes)
                self.assertEqual(len(requests), 3, 'uv must not add its own retries inside each attempt')
        finally:
            server.shutdown()
            server.server_close()
            serving.join(timeout=2)

    def test_network_timeout_inside_uv_resolver_wrapper_never_hides_real_integrity_failures(self):
        wrapped = ('error: No solution found when resolving dependencies\n'
                   'wheel has an invalid package format; requirements are unsatisfiable\n'
                   'Caused by: Failed to download distribution due to network timeout.')
        self.assertEqual(retry.transient_failure(1, wrapped), 'package-network')
        for permanent in ['Hash mismatch', 'certificate verify failed', 'HTTP 403',
                          'Permission denied', 'Failed to build wheel']:
            self.assertIsNone(retry.transient_failure(1, wrapped + '\n' + permanent))
        self.assertIsNone(retry.transient_failure(1, wrapped.replace('due to network timeout', 'due to invalid ZIP')))

    def test_streams_progress_and_bounds_the_retained_tail(self):
        stream = io.BytesIO()
        code, tail = retry.stream_process([sys.executable, '-c',
                                          "import sys; print('p' * 100000); sys.stderr.write('final failure\\n')"],
                                         dict(os.environ), output=stream.write)
        self.assertEqual(code, 0)
        self.assertGreater(len(stream.getvalue()), retry.TAIL_BYTES)
        self.assertLessEqual(len(tail.encode('utf-8')), retry.TAIL_BYTES)
        self.assertIn('final failure', tail)

    def test_real_wrapper_and_windows_splat_preserve_paths_pins_cache_and_progress(self):
        parent = ROOT / '.runtime/uv-retry-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='Капри cache ', dir=parent) as directory:
            folder = Path(directory)
            cache = folder / 'cache'
            cache.mkdir()
            canary = cache / 'downloaded-wheel.canary'
            canary.write_text('verified package cache', encoding='utf-8')
            (folder / 'pip').write_text('''import json, os, sys
from pathlib import Path
p = Path('attempts.json')
calls = json.loads(p.read_text()) if p.exists() else []
calls.append({'args': sys.argv[1:], 'http': os.getenv('GIT_CONFIG_VALUE_' + str(int(os.getenv('GIT_CONFIG_COUNT', '0')) - 1))})
p.write_text(json.dumps(calls))
assert (Path(os.environ['UV_CACHE_DIR']) / 'downloaded-wheel.canary').read_text() == 'verified package cache'
print('Preparing pinned voice dependency', flush=True)
if len(calls) == 1:
    print('Git operation failed; RPC failed; curl 18 transfer closed with outstanding read data remaining', file=sys.stderr)
    sys.exit(1)
assert calls[-1]['http'] == 'HTTP/1.1'
print('Pinned dependency prepared successfully', flush=True)
''', encoding='utf-8')
            arguments = ['pip', 'sync', '--python', str(folder / 'voice environment/python.exe'),
                         'config/requirements-voice-training.lock', '--torch-backend', 'cu124', '--dry-run']
            env = {**os.environ, 'UV_CACHE_DIR': str(cache), 'PYTHONUTF8': '1'}
            if os.name == 'nt':
                literal = lambda value: "'" + str(value).replace("'", "''") + "'"
                script = folder / 'invoke.ps1'
                script.write_text("$ErrorActionPreference='Stop'\nSet-Location -LiteralPath " + literal(folder) +
                                  '\n$capriVoiceSync=@(' + ','.join(map(literal, arguments)) + ')\n& ' +
                                  literal(sys.executable) + ' ' + literal(SCRIPT) + ' --uv ' +
                                  literal(sys.executable) + ' --pytorch-profile legacy -- @capriVoiceSync\nexit $LASTEXITCODE\n', encoding='utf-8-sig')
                command = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(script)]
            else:
                command = [sys.executable, str(SCRIPT), '--uv', sys.executable, '--', *arguments]
            result = subprocess.run(command, cwd=folder, env=env, capture_output=True, text=True,
                                    encoding='utf-8', errors='replace', timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            calls = json.loads((folder / 'attempts.json').read_text())
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0]['args'], arguments[1:])
            self.assertEqual(calls[1]['args'], arguments[1:])
            self.assertEqual(canary.read_text(), 'verified package cache')
            self.assertIn('Preparing pinned voice dependency', result.stdout)
            self.assertIn('Retrying 2/3', result.stdout)
            self.assertIn('prepared successfully', result.stdout)


if __name__ == '__main__':
    unittest.main()
