"""A stream's frame replays an effect's history in full (lamp_core.full_replay).

An effect that draws each frame from the ones before (Aurora, Particle glows,
the music effects...) replays its history when a setting changes. A preview
replays a slice of it per frame (a frame on time), which a stream showed as a
fast-forward; a stream's frame replays all of it, while the lamp keeps its
last frame, then goes on from the frame due."""
import sys
import unittest

from tests.test_native_features import LAMP_RENDERERS

lamp_core = sys.modules[LAMP_RENDERERS["replays_in_full"].__module__]
lamp_settings = LAMP_RENDERERS["lamp_settings"]
timeline_for = LAMP_RENDERERS["timeline_for"]
exact_frames = LAMP_RENDERERS["exact_frames"]
slot_for = LAMP_RENDERERS["slot_for"]

TARGET = 1500


def _history_settings(intensity):
    settings = lamp_settings("Aurora", "Right", 128, None, "normal", "right", intensity, None)
    assert slot_for(settings)["warmup"] is None  # drawn from the frames before
    return settings


class FullReplayTests(unittest.TestCase):
    def setUp(self):
        self._budget = LAMP_RENDERERS["_REPLAY_SECONDS"]
        LAMP_RENDERERS["_REPLAY_SECONDS"] = 0.0  # a host too slow for any replay

    def tearDown(self):
        LAMP_RENDERERS["_REPLAY_SECONDS"] = self._budget

    def test_a_stream_frame_is_the_frame_due_at_once(self):
        settings = _history_settings(intensity=77)
        expected = bytes(next(exact_frames(settings, TARGET, 1)))
        frame = lamp_core.drawn_in_full(timeline_for(settings).frame_at, TARGET)
        self.assertEqual(expected, bytes(frame))

    def test_a_preview_still_replays_a_slice_per_frame(self):
        settings = _history_settings(intensity=91)
        expected = bytes(next(exact_frames(settings, TARGET, 1)))
        self.assertNotEqual(expected, bytes(timeline_for(settings).frame_at(TARGET)))
        self.assertFalse(lamp_core.replays_in_full())  # only inside drawn_in_full


if __name__ == "__main__":
    unittest.main()
