"""Utterance recognition: VAD boundaries, one accurate decoder, no text drafts."""
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from .alignment import remove_wake_prefix


class RecognitionSession:
    def __init__(self, vad, session_id, config, queue, emit):
        self.vad, self.session_id, self.queue, self.emit = vad, session_id, queue, emit
        self.lock = threading.RLock()
        self.alive = True
        self.active = False
        self.wake_enabled = config.get('wakeWord', {}).get('enabled', False)
        self.attention = not self.wake_enabled
        self.max_seconds = config['maxUtteranceSeconds']
        self.max_samples = int((self.max_seconds + max(4, config.get('trailingSilenceSeconds', 1.0) + 2)) * 16000)
        self.probe_step = int(config['vad']['wakeProbeSeconds'] * 16000)
        self.utterance, self.revision, self.probes, self.last_probe = 0, 0, 0, 0
        self.pcm = None
        self.start = 0
        self.turn_start = None
        self.received_samples, self.next_activity = 0, 0
        self.history = deque()
        self.vad_offset, self.pending_vad = 0, None
        self.wake_end_sample = None

    def configure_pause(self, vad, seconds):
        with self.lock:
            if not self.alive:
                raise ValueError('Inactive recognition session')
            self.pending_vad = (vad, seconds)
            self.apply_pending_pause()

    def apply_pending_pause(self):
        # Keep the old detector through an active utterance and its decode.
        # A replacement starts its own sample clock, mapped to capture history.
        if self.pending_vad and not self.active and self.pcm is None:
            self.vad, seconds = self.pending_vad
            self.vad_offset = self.received_samples
            self.max_samples = int((self.max_seconds + max(4, seconds + 2)) * 16000)
            self.pending_vad = None

    def audio(self, start, end):
        # VAD onset can lag a quiet first consonant or a short name. Preserve
        # 400ms before it and a small real tail instead of cropping those words.
        start = max(self.vad_offset, start - 6400)
        end = min(self.received_samples, end + 2400)
        parts = [chunk[max(0, start - offset):min(len(chunk), end - offset)]
                 for offset, chunk in self.history if offset < end and offset + len(chunk) > start]
        if not parts:
            raise ValueError('Speech audio is outside the bounded history')
        return start, np.concatenate(parts)

    def state(self, phase):
        self.emit(dict(type='recognition-state', sessionId=self.session_id,
                       utterance=self.utterance, phase=phase))

    def discard_turn(self):
        """Drop one unfinished turn, not the capture or the loaded recognizer.

        A VAD can split continuous game/music audio without finding real silence.
        Never send a cropped instruction or permit a stale decode/wake candidate
        from that overlong turn to become a new command after this reset.
        """
        discarded = self.utterance
        self.utterance += 1
        self.revision += 1
        self.active = False
        self.attention = not self.wake_enabled
        self.pcm = None
        self.turn_start = None
        self.start = self.received_samples
        self.probes, self.last_probe, self.next_activity = 0, 0, 0
        self.wake_end_sample = None
        self.history.clear()
        self.vad.reset()
        self.vad_offset = self.received_samples
        self.apply_pending_pause()
        self.emit(dict(type='recognition-reset', sessionId=self.session_id,
                       utterance=discarded, nextUtterance=self.utterance,
                       reason='utterance_limit'))

    def accept(self, samples, finish=False):
        pcm = np.asarray(samples, dtype=np.float32)
        if pcm.ndim != 1 or len(pcm) > 3200 or not np.isfinite(pcm).all():
            raise ValueError('Expected at most 200ms of finite mono PCM')
        with self.lock:
            if not self.alive:
                raise ValueError('Inactive recognition session')
            self.apply_pending_pause()
            pcm = np.clip(pcm, -1, 1)
            if len(pcm):
                self.history.append((self.received_samples, pcm.copy()))
            self.received_samples += len(pcm)
            while self.history and self.history[0][0] + len(self.history[0][1]) <= self.received_samples - self.max_samples:
                self.history.popleft()
            self.vad.accept_waveform(pcm)
            if finish:
                self.vad.flush()
            active = self.vad.is_speech_detected() and not finish
            if active and self.turn_start is None:
                self.turn_start = max(self.vad_offset, self.received_samples - len(pcm) - 6400)
            if (self.turn_start is not None and (active or not self.vad.empty()) and
                    self.received_samples - self.turn_start > self.max_samples):
                self.discard_turn()
                return
            if active and not self.active:
                # Invalidate an endpoint still being decoded if the speaker resumed.
                # The next decode includes the original audio and its continuation.
                self.revision += 1
            if active and (not self.active or self.received_samples >= self.next_activity):
                self.state('speech')
                self.next_activity = self.received_samples + 16000
            self.active = active
            completed = False
            while not self.vad.empty():
                segment = self.vad.front
                start = segment.start + self.vad_offset
                if (len(segment.samples) > self.max_samples or
                        (self.history and max(self.vad_offset, start - 6400) < self.history[0][0])):
                    self.discard_turn()
                    return
                start, audio = self.audio(start, start + len(segment.samples))
                self.vad.pop()
                if not len(audio):
                    continue
                if self.pcm is None:
                    self.start, self.pcm = start, audio
                    self.turn_start = start
                else:
                    gap = start - (self.start + len(self.pcm))
                    size = len(self.pcm) + max(0, gap) + max(0, len(audio) + min(0, gap))
                    if size > self.max_samples:
                        self.discard_turn()
                        return
                    self.pcm = np.concatenate((self.pcm, np.zeros(max(0, gap), dtype=np.float32), audio[max(0, -gap):]))
                if len(self.pcm) > self.max_samples:
                    self.discard_turn()
                    return
                completed = True
            if completed and not active:
                self.revision += 1
                self.state('processing')
                # A short padded tail protects the final phoneme after VAD trimming.
                self.queue.submit(self, ('final', self.utterance, self.revision,
                                         np.concatenate((self.pcm, np.zeros(3200, dtype=np.float32))), self.start))
            elif active and not self.attention and self.pcm is None and self.probes < 3:
                segment = self.vad.current_segment
                size = len(segment.samples)
                if size >= self.probe_step and size - self.last_probe >= self.probe_step:
                    start = segment.start + self.vad_offset
                    audio_start, audio = self.audio(start, start + size)
                    if size <= 4 * 16000 and self.queue.submit(self, ('wake', self.utterance, self.revision, audio, audio_start)):
                        self.probes += 1
                        self.last_probe = size

    def deliver(self, job, result, elapsed):
        kind, utterance, revision, pcm, audio_start = job
        text = result['text']
        with self.lock:
            if not self.alive or utterance != self.utterance or revision != self.revision:
                return
            if kind == 'wake':
                if self.active and not self.attention and text:
                    # Internal wake matching only; never preview or submit these words.
                    self.emit(dict(type='wake-candidate', sessionId=self.session_id,
                                   utterance=utterance, text=text,
                                   boundaries=[{**word, 'startSample': audio_start + word['startSample'], 'endSample': audio_start + word['endSample']}
                                               for word in result.get('boundaries', [])][:64]))
                return
            if self.active:
                return
            if self.wake_end_sample is not None:
                result = remove_wake_prefix(result, self.wake_end_sample - audio_start)
                text = result['text']
            self.pcm = None
            self.turn_start = None
            self.wake_end_sample = None
            self.utterance += 1
            self.revision += 1
            self.probes, self.last_probe = 0, 0
            self.emit(dict(type='transcript', sessionId=self.session_id, utterance=utterance,
                           final=True, text=text, audioSeconds=round(len(pcm) / 16000, 3),
                           prefixRemoved=bool(result.get('prefixRemoved')),
                           recognitionMs=round(elapsed, 2)))

    def set_attention(self, active, *, utterance=None, wake_end_sample=None):
        if type(active) is not bool:
            raise ValueError('Invalid attention state')
        with self.lock:
            self.attention = active
            if not active:
                self.wake_end_sample = None
            elif utterance == self.utterance and wake_end_sample is not None:
                if type(wake_end_sample) is not int or not 0 < wake_end_sample <= self.received_samples:
                    raise ValueError('Invalid wake audio boundary')
                self.wake_end_sample = wake_end_sample

    def stop(self):
        with self.lock:
            self.alive = False
            self.pcm = None
            self.history.clear()
            self.pending_vad = None
            self.vad.reset()


class RecognitionQueue:
    """One CPU decode at a time; finals supersede pending wake probes."""
    def __init__(self, recognizer, emit):
        self.recognizer, self.emit = recognizer, emit
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='capri-asr')
        self.lock = threading.RLock()
        self.futures = {}

    def submit(self, session, job):
        kind = job[0]

        def decode():
            with session.lock:
                if not session.alive or job[1:3] != (session.utterance, session.revision):
                    return
                audio = job[3]
                addressed = session.attention
            started = time.perf_counter()
            result = self.recognizer.recognize(audio, wake=kind == 'wake', addressed=addressed) if len(audio) else {'text': ''}
            session.deliver(job, result, (time.perf_counter() - started) * 1000)

        with self.lock:
            if kind == 'wake' and self.futures:
                return False
            # Cancel stale queued work; a running decode is discarded by revision.
            for future in list(self.futures):
                if not future.running():
                    future.cancel()
                    self.futures.pop(future, None)
            if len(self.futures) >= 2:
                raise ValueError('Recognition queue is full')
            future = self.executor.submit(decode)
            self.futures[future] = session

        def completed(done):
            with self.lock:
                self.futures.pop(done, None)
            if done.cancelled():
                return
            try:
                done.result()
            except Exception:
                if session.alive and job[1:3] == (session.utterance, session.revision):
                    self.emit(dict(type='recognition-error', sessionId=session.session_id,
                                   code='recognition_failed'))
        future.add_done_callback(completed)
        return True

    def stop(self, session):
        if session is None:
            return
        session.stop()
        with self.lock:
            queued = [future for future, owner in self.futures.items() if owner is session]
        for future in queued:
            future.cancel()

    def close(self):
        with self.lock:
            sessions = list(self.futures.values())
        for session in sessions:
            self.stop(session)
        self.executor.shutdown(wait=False, cancel_futures=True)
