"""Bounded JSON-line IPC; microphone samples are never written to a file."""
import base64
import json
import sys
import threading

from .protocol import rejection_code

output_lock = threading.Lock()


def emit(value):
    with output_lock:
        print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def run():
    stage = 'ASR_START_DEPENDENCIES'
    try:
        # Flush the last known phase before importing or invoking native code:
        # a native access violation cannot be caught by Python's exception handler.
        emit(dict(type='startup-stage', code=stage))
        import numpy as np
        from .model import Recognizer, SpeechDetector, settings, validate_pause
        from .recognition import RecognitionSession, RecognitionQueue

        stage = 'ASR_START_CONFIG'
        emit(dict(type='startup-stage', code=stage))
        config = settings()
        stage = 'ASR_START_DETECTOR'
        emit(dict(type='startup-stage', code=stage))
        detector = SpeechDetector(config)
        stage = 'ASR_START_MODEL'
        emit(dict(type='startup-stage', code=stage))
        queue = RecognitionQueue(Recognizer(config), emit)
    except Exception:
        # Configuration and model exceptions can contain installation paths.
        emit(dict(type='startup-error', code=stage))
        return 1
    emit(dict(type='ready', protocol=1, language=config['language'], sampleRate=16000, provider='cpu',
              engine=config['engine'], mode='utterance', draft=False))
    session = None
    session_id = None
    while True:
        line = sys.stdin.buffer.readline(32769)
        if not line:
            if queue:
                queue.stop(session)
                queue.close()
            return
        if len(line) > 32768:
            raise ValueError('IPC line exceeds limit')
        command = json.loads(line)
        kind, request = command.get('type'), command.get('request')
        try:
            if kind == 'start':
                if queue:
                    queue.stop(session)
                session_id = command['sessionId']
                if not isinstance(session_id, str) or len(session_id) > 80:
                    raise ValueError('Invalid session')
                config['trailingSilenceSeconds'] = validate_pause(command.get('trailingSilenceSeconds', config['trailingSilenceSeconds']))
                session = RecognitionSession(detector.session(config['trailingSilenceSeconds']), session_id, config, queue, emit)
                session.set_attention(command.get('attention', not config.get('wakeWord', {}).get('enabled', False)))
            elif kind == 'stop':
                if command.get('sessionId') and command['sessionId'] != session_id:
                    emit(dict(type='ack', request=request))
                    continue
                if queue:
                    queue.stop(session)
                session = None
                session_id = None
            elif kind == 'configure':
                if session is None or command.get('sessionId') != session_id:
                    raise ValueError('Inactive capture session')
                pause = validate_pause(command['trailingSilenceSeconds'])
                session.configure_pause(detector.session(pause), pause)
                config['trailingSilenceSeconds'] = pause
            elif kind == 'attention':
                if session is None or command.get('sessionId') != session_id:
                    raise ValueError('Inactive capture session')
                session.set_attention(command['active'], utterance=command.get('utterance'), wake_end_sample=command.get('wakeEndSample'))
            elif kind in {'pcm', 'finish'}:
                if session is None or command.get('sessionId') != session_id:
                    raise ValueError('Inactive capture session')
                raw = base64.b64decode(command.get('pcm', ''), validate=True)
                if len(raw) % 4 or len(raw) > 12800:
                    raise ValueError('Invalid PCM packet')
                session.accept(np.frombuffer(raw, dtype='<f4'), finish=kind == 'finish')
            elif kind == 'quit':
                if queue:
                    queue.stop(session)
                    queue.close()
                return
            else:
                raise ValueError('Unknown IPC command')
            emit(dict(type='ack', request=request))
        except (ValueError, KeyError, TypeError) as error:
            emit(dict(type='error', request=request, code=rejection_code(error)))


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as error:
        print(f'Speech recognizer unavailable: {type(error).__name__}', file=sys.stderr, flush=True)
        sys.exit(1)
