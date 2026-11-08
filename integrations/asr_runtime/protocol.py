"""Stable, non-content error codes for diagnostic reports; never return PCM/text."""
def rejection_code(error):
    return {
        'Inactive capture session': 'ASR_INACTIVE_SESSION',
        'Inactive recognition session': 'ASR_INACTIVE_SESSION',
        'Recognition queue is full': 'ASR_QUEUE_FULL',
        'Spoken turn exceeds the bounded recognition buffer': 'ASR_UTTERANCE_LIMIT',
        'Speech audio is outside the bounded history': 'ASR_HISTORY_GAP',
        'Expected at most 200ms of finite mono PCM': 'ASR_INVALID_PCM',
        'Invalid PCM packet': 'ASR_INVALID_PCM',
        'Invalid wake audio boundary': 'ASR_WAKE_BOUNDARY',
    }.get(str(error), 'ASR_PACKET_REJECTED')
