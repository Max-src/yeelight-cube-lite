"""Changed-frame streaming, including recovery and Matter routing."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from tests.test_stream_hold import streaming_light, frames, stop, STUDIO
from fakes import run


class ChangedFrameTests(unittest.TestCase):
    """The changed-frames experiment, switched on for Falling Blocks here
    (light_studio.STREAM_CHANGES_ONLY_EFFECTS: off by default)."""

    def setUp(self):
        patcher = patch.object(STUDIO, "STREAM_CHANGES_ONLY_EFFECTS", frozenset({"Falling Blocks"}))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_lan_sends_changes_and_resends_after_connection_recovers(self):
        async def scenario():
            light = streaming_light()
            payload = ['AAAA']
            async def draw(render):
                return payload[0]
            light._studio_payload = draw
            with patch.object(STUDIO, 'STUDIO_HOLD_SECONDS', 0.02):
                await light._activate_native_effect()
                try:
                    await asyncio.sleep(0.16)
                    self.assertEqual([['AAAA']], frames(light))
                    self.assertTrue(light._lamp_client.stream_changes_only)
                    payload[0] = 'BBBB'
                    await asyncio.sleep(0.16)
                    self.assertEqual([['AAAA'], ['BBBB']], frames(light))
                    light._lamp_client.is_unreachable = True
                    await asyncio.sleep(0.12)
                    light._lamp_client.is_unreachable = False
                    await asyncio.sleep(0.16)
                    self.assertEqual([['AAAA'], ['BBBB'], ['BBBB']], frames(light))
                    light._native_effect = 'Lava Lamp'
                    await asyncio.sleep(0.16)
                    self.assertGreater(len(frames(light)), 3)
                    self.assertFalse(light._lamp_client.stream_changes_only)
                finally:
                    await stop(light)
                self.assertFalse(light._lamp_client.stream_changes_only)
        run(scenario())

    def test_matter_skips_duplicates_but_restores_lost_drawing(self):
        async def scenario():
            light = streaming_light()
            pixels = [(10, 20, 30)] * 100
            light.matrix_streams_over_matter = lambda: True
            light._matrix_stream_pixels = AsyncMock(return_value=pixels)
            shown = [True]
            light._matrix_drawing_shown = lambda mixer: shown[0]
            async def send(frame):
                shown[0] = True
            light._send_matrix_stream_frame = AsyncMock(side_effect=send)
            await light._start_studio_stream()
            try:
                await asyncio.sleep(0.16)
                self.assertEqual(1, light._send_matrix_stream_frame.await_count)
                shown[0] = False
                await asyncio.sleep(0.16)
                self.assertEqual(2, light._send_matrix_stream_frame.await_count)
                # A rejected changed frame is retried even if its pixels
                # stay unchanged. Only successful sends enter the cache.
                light._matrix_stream_pixels.return_value = [(30, 20, 10)] * 100
                light._send_matrix_stream_frame.side_effect = [OSError('refused'), None]
                with patch.object(STUDIO, 'STUDIO_RETRY_SECONDS', 0.02):
                    await asyncio.sleep(0.24)
                self.assertEqual(4, light._send_matrix_stream_frame.await_count)
                self.assertEqual([], frames(light))
            finally:
                await stop(light)
        run(scenario())


class ChangedFramesOffTests(unittest.TestCase):
    def test_off_by_default_every_frame_is_sent(self):
        self.assertEqual(frozenset(), STUDIO.STREAM_CHANGES_ONLY_EFFECTS)

        async def scenario():
            light = streaming_light()
            payload = ["AAAA"]

            async def draw(render):
                return payload[0]

            light._studio_payload = draw
            await light._activate_native_effect()
            try:
                await asyncio.sleep(0.3)
                self.assertFalse(light._lamp_client.stream_changes_only)
                self.assertGreater(len(frames(light)), 3)  # the same frame, every render
            finally:
                await stop(light)

        run(scenario())
