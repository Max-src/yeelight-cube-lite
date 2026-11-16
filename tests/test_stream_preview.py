"""Previews of a streamed effect show the frame the lamp was sent
(light_studio.streamed_preview_frame, the cameras; stream_preview_ws, the
cards), not their own drawing of the effect with its own start and seeds."""

import base64
import unittest

import fakes
from fakes import FakeEntry, FakeHass, make_light, module

fakes.install_stubs()
STUDIO = module("light_studio")
CORE = module("lamp_core")


def streaming_light(effect="Falling Blocks"):
    light = make_light(hass=FakeHass(), entry=FakeEntry())
    light._is_on = True
    light._native_effect = effect
    light._enter_mode("Native Effect")
    light.studio_streaming = lambda: True
    return light


FRAME = [(index, 255 - index, 7) for index in range(100)]


class StreamPreviewTests(unittest.TestCase):
    def test_the_frame_sent_is_the_preview(self):
        light = streaming_light()
        seen = []
        stop = light.add_stream_preview_listener(seen.append)
        light._studio_rendered = (FRAME, False)
        light._publish_stream_frame()
        self.assertEqual(FRAME, light.streamed_preview_frame())
        self.assertEqual([FRAME], seen)
        stop()
        light._publish_stream_frame()
        self.assertEqual(1, len(seen))

    def test_a_lamp_renderer_s_drive_is_shown_as_the_leds_look(self):
        effect = next(iter(STUDIO.LAMP_RENDERED_EFFECTS))
        light = streaming_light(effect)
        light._studio_rendered = (FRAME, True)
        light._publish_stream_frame()
        self.assertEqual([CORE.led_appearance(rgb) for rgb in FRAME], light.streamed_preview_frame())

    def test_none_once_old_or_no_longer_streaming(self):
        light = streaming_light()
        light._studio_rendered = (FRAME, False)
        light._publish_stream_frame()
        at, frame = light._stream_preview
        light._stream_preview = (at - STUDIO.STREAM_PREVIEW_FRESH - 0.1, frame)
        self.assertIsNone(light.streamed_preview_frame())
        light._publish_stream_frame()
        light.studio_streaming = lambda: False
        self.assertIsNone(light.streamed_preview_frame())

    def test_the_cards_get_it_as_base64_rgb(self):
        source = (fakes.ROOT / "stream_preview_ws.py").read_text(encoding="utf-8")
        namespace = {}
        exec(source.split("@websocket_api")[0].split("from .const")[0]
             + "\n" + source[source.index("def encode_preview_frame"):source.index("def _light_for")],
             namespace)
        encoded = namespace["encode_preview_frame"](FRAME)
        self.assertEqual(bytes(channel for rgb in FRAME for channel in rgb), base64.b64decode(encoded))


if __name__ == "__main__":
    unittest.main()
