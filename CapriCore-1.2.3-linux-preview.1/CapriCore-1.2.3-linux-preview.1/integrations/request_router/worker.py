"""Owned JSON-line IPC; no listener, cloud calls, transcript logging or action tools."""
import json
import sys
import time

from .model import Router


def emit(value):
    print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def run():
    router = Router()
    emit(dict(type='ready', protocol=1, provider='cpu'))
    for line in iter(lambda: sys.stdin.buffer.readline(65537), b''):
        if len(line) > 65536:
            raise ValueError('Router IPC line exceeds limit')
        value = json.loads(line)
        text, context, request = value.get('text'), value.get('context', []), value.get('request')
        if (type(request) is not int or request < 1 or not isinstance(text, str) or len(text) > 8000
                or not isinstance(context, list) or len(context) > 2
                or any(not isinstance(item, str) or len(item) > 400 for item in context)):
            raise ValueError('Invalid router request')
        started = time.perf_counter()
        result = router.classify(text, context)
        emit(dict(type='result', request=request, **result, elapsedMs=round((time.perf_counter()-started)*1000, 3)))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('Local request classifier unavailable', file=sys.stderr, flush=True)
        sys.exit(1)
