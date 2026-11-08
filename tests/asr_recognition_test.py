import threading
import unittest
from types import SimpleNamespace

import numpy as np

from integrations.asr_runtime.recognition import RecognitionSession, RecognitionQueue
from integrations.asr_runtime.model import SpeechDetector, settings, validate_pause
from integrations.asr_runtime.alignment import word_boundaries, remove_wake_prefix


class VAD:
    def __init__(self):
        self.active, self.segments = False, []
        self.current_segment = SimpleNamespace(start=0, samples=np.ones(16000, dtype=np.float32))
    def accept_waveform(self, pcm):
        pass
    def is_speech_detected(self):
        return self.active
    def empty(self):
        return not self.segments
    @property
    def front(self):
        return self.segments[0]
    def pop(self):
        self.segments.pop(0)
    def flush(self):
        self.active = False
    def reset(self):
        self.active = False
        self.segments.clear()


class RecognitionTests(unittest.TestCase):
    def test_timed_address_removal_does_not_depend_on_its_final_spelling(self):
        result = {'text': 'Copy, leave that.', 'boundaries': [
            {'start': 0, 'end': 5, 'startSample': 1600, 'endSample': 9600},
            {'start': 6, 'end': 11, 'startSample': 12000, 'endSample': 16000},
            {'start': 12, 'end': 17, 'startSample': 16800, 'endSample': 21000}]}
        clean = remove_wake_prefix(result, 9600)
        self.assertEqual(clean['text'], 'leave that.')
        self.assertTrue(clean['prefixRemoved'])
        # If the model already omitted the address, keep the whole command.
        command = {'text': 'Copy that file.', 'boundaries': [
            {'start': 0, 'end': 4, 'startSample': 12000, 'endSample': 16000}]}
        self.assertEqual(remove_wake_prefix(command, 9600)['text'], 'Copy that file.')
        # A name alone opens attention without generating a greeting turn.
        name = {'text': 'Capri.', 'boundaries': [
            {'start': 0, 'end': 6, 'startSample': 1600, 'endSample': 9600}]}
        self.assertEqual(remove_wake_prefix(name, 9600)['text'], '')

    def test_word_alignment_keeps_real_token_times_and_rejects_unaligned_text(self):
        tokens, times, durations = [' C', 'ap', 'ri,', ' clip', ' that.'], [.08, .24, .4, .9, 1.2], [.16, .16, .24, .3, .2]
        boundaries = word_boundaries('Capri, clip that.', tokens, times, durations, 32000)
        self.assertEqual(boundaries[0], {'start': 0, 'end': 6, 'startSample': 1280, 'endSample': 10240})
        self.assertEqual(boundaries[1]['startSample'], 14400)
        self.assertEqual(word_boundaries('Different text.', tokens, times, durations, 32000), [])

    def fixture(self, transcribe, wake=False):
        events, vad = [], VAD()
        queue = RecognitionQueue(SimpleNamespace(recognize=lambda pcm, **_: {'text': transcribe(pcm), 'boundaries': []}), events.append)
        session = RecognitionSession(vad, 'capture', {'maxUtteranceSeconds': 30,
            'vad': {'wakeProbeSeconds': .8}, 'wakeWord': {'enabled': wake}}, queue, events.append)
        self.addCleanup(queue.close)
        self.addCleanup(queue.stop, session)
        return session, vad, queue, events

    def endpoint(self, session, vad, start=0, value=.1):
        vad.active = False
        while session.received_samples < start:
            session.accept(np.zeros(min(1600, start - session.received_samples), dtype=np.float32))
        vad.segments.append(SimpleNamespace(start=start, samples=np.full(3200, value, dtype=np.float32)))
        session.accept(np.full(start + 3200 - session.received_samples, value, dtype=np.float32))

    def test_silence_does_not_decode_and_invalid_packets_are_rejected(self):
        session, vad, queue, events = self.fixture(lambda pcm: self.fail('Silence was decoded'))
        for _ in range(30):
            session.accept(np.zeros(1600, dtype=np.float32))
        self.assertEqual(events, [])
        for bad in ([np.nan], [np.inf], np.zeros(3201), np.zeros((2, 10))):
            with self.assertRaises(ValueError):
                session.accept(bad)

    def test_pause_changes_wait_for_current_phrase_and_rebase_sample_positions(self):
        session, vad, queue, events = self.fixture(lambda pcm: 'A complete phrase.')
        vad.active = True
        session.accept(np.full(1600, .1, dtype=np.float32))
        replacement = VAD()
        session.configure_pause(replacement, 4.5)
        self.assertIs(session.vad, vad)
        self.endpoint(session, vad)
        queue.executor.shutdown(wait=True)
        session.accept(np.zeros(1600, dtype=np.float32))
        self.assertIs(session.vad, replacement)
        self.assertEqual(session.vad_offset, 3200)
        self.assertEqual(session.max_samples, int(36.5 * 16000))

    def test_real_vad_uses_the_selected_pause(self):
        detector = SpeechDetector(settings())
        for seconds in (.5, 1.8, 5):
            vad = detector.session(seconds)
            self.assertAlmostEqual(vad.config.silero_vad.min_silence_duration, seconds, places=5)
            self.assertAlmostEqual(vad.config.silero_vad.max_speech_duration,
                settings()['maxUtteranceSeconds'] + max(4, seconds + 2) + 1, places=5)
        for bad in (True, None, float('nan'), float('inf'), .4, 5.1, '1.8', 1.85):
            with self.assertRaises(ValueError):
                validate_pause(bad)

    def test_only_complete_recognition_is_a_transcript(self):
        session, vad, queue, events = self.fixture(lambda pcm: 'Accurate whole phrase.')
        self.endpoint(session, vad)
        queue.executor.shutdown(wait=True)
        transcripts = [e for e in events if e['type'] == 'transcript']
        self.assertEqual(len(transcripts), 1)
        self.assertTrue(transcripts[0]['final'])
        self.assertEqual(transcripts[0]['text'], 'Accurate whole phrase.')
        self.assertFalse(any(e.get('final') is False for e in events))

    def test_wake_probe_never_becomes_a_transcript_or_command(self):
        session, vad, queue, events = self.fixture(lambda pcm: 'Hey Capri, incomplete words', wake=True)
        vad.active = True
        session.accept(np.ones(1600, dtype=np.float32))
        queue.executor.shutdown(wait=True)
        self.assertEqual([e['type'] for e in events], ['recognition-state', 'wake-candidate'])

    def test_resumed_speech_discards_early_result_and_decodes_the_combined_audio(self):
        entered, release = threading.Event(), threading.Event()
        decoded = []
        def transcribe(pcm):
            decoded.append(pcm.copy())
            if len(decoded) == 1:
                entered.set()
                release.wait(3)
                return 'Must not be sent.'
            return 'The complete sentence with its continuation.'
        session, vad, queue, events = self.fixture(transcribe)
        try:
            self.endpoint(session, vad)
            self.assertTrue(entered.wait(2))
            session.accept(np.zeros(1600, dtype=np.float32))
            session.accept(np.zeros(1600, dtype=np.float32))
            vad.active = True
            session.accept(np.full(1600, .2, dtype=np.float32))
            self.endpoint(session, vad, start=6400, value=.2)
            release.set()
            queue.executor.shutdown(wait=True)
            transcripts = [e for e in events if e['type'] == 'transcript']
            self.assertEqual([e['text'] for e in transcripts], ['The complete sentence with its continuation.'])
            self.assertEqual(len(decoded), 2)
            np.testing.assert_allclose(decoded[1][:3200], .1)
            np.testing.assert_allclose(decoded[1][3200:6400], 0)
            np.testing.assert_allclose(decoded[1][6400:9600], .2)
        finally:
            release.set()

    def test_stopping_suppresses_late_decode(self):
        entered, release = threading.Event(), threading.Event()
        def transcribe(pcm):
            entered.set(); release.wait(3)
            return 'Late words.'
        session, vad, queue, events = self.fixture(transcribe)
        try:
            self.endpoint(session, vad)
            self.assertTrue(entered.wait(2))
            queue.stop(session)
            release.set()
            queue.executor.shutdown(wait=True)
            self.assertFalse(any(e['type'] == 'transcript' for e in events))
        finally:
            release.set()

    def test_decoder_failure_has_no_weaker_fallback(self):
        def transcribe(pcm):
            raise ValueError('Fixture failure')
        session, vad, queue, events = self.fixture(transcribe)
        self.endpoint(session, vad)
        queue.executor.shutdown(wait=True)
        self.assertEqual(events[-1]['type'], 'recognition-error')
        self.assertFalse(any(e['type'] == 'transcript' for e in events))

    def test_35_second_continuous_audio_is_dropped_without_stopping_capture(self):
        events, jobs, vad = [], [], VAD()
        queue = SimpleNamespace(submit=lambda session, job: jobs.append(job) or True)
        session = RecognitionSession(vad, 'capture', {'maxUtteranceSeconds': 30,
            'vad': {'wakeProbeSeconds': .8}, 'wakeWord': {'enabled': True}}, queue, events.append)
        # No wake probes in this fixture: a persistent background segment, not a
        # recognized owner address. Earlier code failed at exactly 35 seconds.
        vad.current_segment = SimpleNamespace(start=0, samples=np.zeros(0, dtype=np.float32))
        for packet in range(350):
            vad.active = True
            if packet == 199:
                vad.segments.append(SimpleNamespace(start=0, samples=np.full(320000, .1, dtype=np.float32)))
            session.accept(np.full(1600, .1, dtype=np.float32))
        self.assertTrue(session.alive)
        self.assertEqual(session.session_id, 'capture')
        self.assertEqual(session.utterance, 1)
        self.assertEqual([e['type'] for e in events].count('recognition-reset'), 1)
        self.assertEqual(jobs, [])
        self.assertLessEqual(sum(len(p) for _, p in session.history), session.max_samples + 3200)
        self.assertIsNone(session.pcm)
        self.assertFalse(session.attention)

    def test_repeated_long_noise_stays_bounded_and_a_normal_wake_phrase_still_works(self):
        events, jobs, vad = [], [], VAD()
        queue = SimpleNamespace(submit=lambda session, job: jobs.append(job) or True)
        session = RecognitionSession(vad, 'capture', {'maxUtteranceSeconds': 30,
            'vad': {'wakeProbeSeconds': .8}, 'wakeWord': {'enabled': True}}, queue, events.append)
        vad.current_segment = SimpleNamespace(start=0, samples=np.zeros(0, dtype=np.float32))
        for _ in range(35 * 10 * 4):
            vad.active = True
            session.accept(np.full(1600, .1, dtype=np.float32))
            self.assertLessEqual(sum(len(p) for _, p in session.history), session.max_samples + 3200)
        resets = [e for e in events if e['type'] == 'recognition-reset']
        self.assertEqual([e['utterance'] for e in resets], [0, 1, 2, 3])
        self.assertEqual(jobs, [])
        # End the old background segment without yielding any transcript.
        vad.active = False
        session.accept(np.zeros(1600, dtype=np.float32))
        start = session.received_samples - session.vad_offset
        vad.active = True
        vad.current_segment = SimpleNamespace(start=start, samples=np.full(16000, .1, dtype=np.float32))
        session.accept(np.full(1600, .1, dtype=np.float32))
        wake = jobs.pop()
        self.assertEqual(wake[0], 'wake')
        session.deliver(wake, {'text': 'Hey Capri', 'boundaries': []}, 1)
        candidate = [e for e in events if e['type'] == 'wake-candidate'][-1]
        self.assertEqual(candidate['utterance'], 4)
        self.assertEqual(candidate['text'], 'Hey Capri')
        session.set_attention(True)
        vad.active = False
        vad.segments.append(SimpleNamespace(start=start, samples=np.full(3200, .1, dtype=np.float32)))
        session.accept(np.full(1600, .1, dtype=np.float32))
        final = jobs.pop()
        self.assertEqual(final[0], 'final')
        session.deliver(final, {'text': 'Hey Capri, hello.', 'boundaries': []}, 1)
        self.assertEqual([e['text'] for e in events if e['type'] == 'transcript'], ['Hey Capri, hello.'])
        self.assertTrue(session.alive)

    def test_discarded_turn_cannot_deliver_stale_decode_or_wake_and_applies_pending_pause(self):
        events, jobs, vad = [], [], VAD()
        queue = SimpleNamespace(submit=lambda session, job: jobs.append(job) or True)
        session = RecognitionSession(vad, 'capture', {'maxUtteranceSeconds': 30,
            'vad': {'wakeProbeSeconds': .8}, 'wakeWord': {'enabled': True}}, queue, events.append)
        vad.active = True
        session.accept(np.full(1600, .1, dtype=np.float32))
        wake = jobs.pop()
        self.endpoint(session, vad)
        final = jobs.pop()
        replacement = VAD()
        session.configure_pause(replacement, 4.5)
        session.set_attention(True, utterance=session.utterance, wake_end_sample=1000)
        session.discard_turn()
        session.deliver(final, {'text': 'Never execute this partial instruction.', 'boundaries': []}, 1)
        session.active = True
        session.deliver(wake, {'text': 'Hey Capri', 'boundaries': []}, 1)
        self.assertFalse(any(e['type'] in {'transcript', 'wake-candidate'} for e in events))
        self.assertIs(session.vad, replacement)
        self.assertEqual(session.vad_offset, session.received_samples)
        self.assertEqual(session.max_samples, int(36.5 * 16000))
        self.assertIsNone(session.wake_end_sample)
        self.assertEqual(list(session.history), [])
        self.assertFalse(session.attention)

    def test_slow_complete_decode_is_not_discarded_by_later_silence(self):
        entered, release = threading.Event(), threading.Event()
        def transcribe(pcm):
            entered.set(); release.wait(3)
            return 'A complete genuine request.'
        session, vad, queue, events = self.fixture(transcribe)
        try:
            self.endpoint(session, vad)
            self.assertTrue(entered.wait(2))
            for _ in range(400):
                session.accept(np.zeros(1600, dtype=np.float32))
            release.set()
            queue.executor.shutdown(wait=True)
            self.assertEqual([e['text'] for e in events if e['type'] == 'transcript'], ['A complete genuine request.'])
            self.assertFalse(any(e['type'] == 'recognition-reset' for e in events))
        finally:
            release.set()

    def test_a_vad_endpoint_at_the_bounded_limit_cannot_send_a_partial_command(self):
        events, jobs, vad = [], [], VAD()
        queue = SimpleNamespace(submit=lambda session, job: jobs.append(job) or True)
        session = RecognitionSession(vad, 'capture', {'maxUtteranceSeconds': 30,
            'vad': {'wakeProbeSeconds': .8}, 'wakeWord': {'enabled': True}}, queue, events.append)
        session.set_attention(True)
        vad.current_segment = SimpleNamespace(start=0, samples=np.zeros(0, dtype=np.float32))
        for _ in range(340):
            vad.active = True
            session.accept(np.full(1600, .1, dtype=np.float32))
        # Even if a detector endpoint changes active to false at this boundary,
        # discard the entire turn before scheduling a truncated ASR command.
        vad.active = False
        vad.segments.append(SimpleNamespace(start=0, samples=np.full(544000, .1, dtype=np.float32)))
        session.accept(np.full(1600, .1, dtype=np.float32))
        self.assertEqual(jobs, [])
        self.assertEqual(events[-1]['type'], 'recognition-reset')
        self.assertFalse(session.attention)
        self.assertTrue(session.alive)

    def test_a_genuine_twenty_second_phrase_remains_one_complete_transcript(self):
        events, jobs, vad = [], [], VAD()
        queue = SimpleNamespace(submit=lambda session, job: jobs.append(job) or True)
        session = RecognitionSession(vad, 'capture', {'maxUtteranceSeconds': 30,
            'vad': {'wakeProbeSeconds': .8}, 'wakeWord': {'enabled': True}}, queue, events.append)
        session.set_attention(True)
        for _ in range(200):
            vad.active = True
            session.accept(np.full(1600, .1, dtype=np.float32))
        vad.active = False
        vad.segments.append(SimpleNamespace(start=0, samples=np.full(320000, .1, dtype=np.float32)))
        session.accept(np.zeros(1600, dtype=np.float32))
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0][0], 'final')
        session.deliver(jobs[0], {'text': 'The whole twenty second instruction.', 'boundaries': []}, 1)
        self.assertEqual([e['text'] for e in events if e['type'] == 'transcript'], ['The whole twenty second instruction.'])
        self.assertFalse(any(e['type'] == 'recognition-reset' for e in events))


if __name__ == '__main__':
    unittest.main()
