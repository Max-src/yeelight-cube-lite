"""Changed-frame streaming, including recovery and Matter routing."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from tests.test_stream_hold import streaming_light, frames, stop, STUDIO
from fakes import run, module


# These tests check the stream's mechanics frame by frame: a Cube Lite's
# LAN pacing (light_studio.LITE_LAN_GAP) off; test_lite_lan_pace checks it.
_UNPACED = None


def setUpModule():
    global _UNPACED
    from unittest.mock import patch as _patch
    _UNPACED = _patch.multiple(module("light_studio"), LITE_LAN_GAP=0.0, LITE_LAN_RESEND=0.0)
    _UNPACED.start()


def tearDownModule():
    _UNPACED.stop()


def skip_unchanged(light, on=True):
    """The Skip Unchanged Stream Frames switch (light_studio._skips_unchanged_frames)."""
    entry = light._config_entry
    entry.options = {**entry.options, module("const").CONF_SKIP_UNCHANGED_FRAMES: on}


class ChangedFrameTests(unittest.TestCase):
    """Skip Unchanged Stream Frames switched on."""

    def test_lan_sends_changes_and_resends_after_connection_recovers(self):
        async def scenario():
            light = streaming_light()
            skip_unchanged(light)
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
                    # Switched off: the same frame again, every render.
                    skip_unchanged(light, False)
                    await asyncio.sleep(0.16)
                    self.assertGreater(len(frames(light)), 3)
                    # A Cube Lite over the LAN: the stream sends again itself
                    # (light_studio.LITE_LAN_RESEND), not the transport.
                    self.assertTrue(light._lamp_client.stream_changes_only)
                finally:
                    await stop(light)
                self.assertFalse(light._lamp_client.stream_changes_only)
        run(scenario())

    def test_matter_sends_every_frame_unchanged_ones_too(self):
        # The lamp fades its drawing in again at each new data: skipped
        # (unchanged) frames left pauses that made the picture pulse
        # (filmed 2026-11-17). Over Matter the cadence stays steady.
        async def scenario():
            light = streaming_light()
            skip_unchanged(light)
            pixels = [(10, 20, 30)] * 100
            light.matrix_streams_over_matter = lambda: True
            light._matrix_stream_pixels = AsyncMock(return_value=pixels)
            light._matrix_drawing_shown = lambda: True
            light._send_matrix_stream_frame = AsyncMock()
            await light._start_studio_stream()
            try:
                await asyncio.sleep(0.6)
                self.assertGreater(light._send_matrix_stream_frame.await_count, 3)
                self.assertEqual([], frames(light))
            finally:
                await stop(light)
        run(scenario())


class ChangedFramesOffTests(unittest.TestCase):
    def test_off_by_default_every_frame_is_sent(self):
        async def scenario():
            light = streaming_light()
            self.assertFalse(light._skips_unchanged_frames())
            payload = ["AAAA"]

            async def draw(render):
                return payload[0]

            light._studio_payload = draw
            await light._activate_native_effect()
            try:
                await asyncio.sleep(0.3)
                self.assertTrue(light._lamp_client.stream_changes_only)  # paced by the stream
                self.assertGreater(len(frames(light)), 3)  # the same frame, every render
            finally:
                await stop(light)

        run(scenario())
