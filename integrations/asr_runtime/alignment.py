"""Conservative token-to-word timing for a confirmed spoken wake address."""
import math
import re


def word_boundaries(text, tokens, timestamps, durations, sample_count):
    if not (len(tokens) == len(timestamps) == len(durations)) or len(tokens) > 4096:
        return []
    raw = ''.join(tokens)
    words = list(re.finditer(r'\S+', raw))
    if ' '.join(word.group() for word in words) != text:
        return []
    ranges, offset = [], 0
    for token, timestamp, duration in zip(tokens, timestamps, durations):
        if not math.isfinite(timestamp) or not math.isfinite(duration) or timestamp < 0 or duration < 0:
            return []
        ranges.append((offset, offset + len(token), min(sample_count, round(timestamp * 16000)),
                       min(sample_count, round((timestamp + duration) * 16000))))
        offset += len(token)
    result, offset = [], 0
    for word in words:
        matches = [(begin, end) for start, stop, begin, end in ranges if start < word.end() and stop > word.start()]
        if not matches:
            return []
        if max(end for _, end in matches) <= 0:
            return []
        result.append(dict(start=offset, end=offset + len(word.group()),
                           startSample=min(begin for begin, _ in matches), endSample=max(end for _, end in matches)))
        offset += len(word.group()) + 1
    return result


def remove_wake_prefix(result, until_sample):
    """Remove only leading words located inside the confirmed wake interval.

    The model still hears the intact utterance; cropping by approximate token
    durations can leave a last syllable or cut the next word's first consonant.
    One encoder-frame margin keeps a boundary word on the command side.
    """
    boundaries = result.get('boundaries', [])
    if not boundaries:
        return result
    cutoff = max(0, until_sample - 1280)
    first = next((word for word in boundaries if word['startSample'] >= cutoff), None)
    return {**result, 'text': result['text'][first['start']:].strip() if first else '', 'prefixRemoved': True}
