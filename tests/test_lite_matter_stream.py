"""A Cube Lite's stream over Matter (light_matrix, light_studio, light_matter).

2026-11-16, filmed on the top Cube Lite: its drawing effect (36) started with
setEffect, then setData at 25 a second, each acknowledged: 1,499 of 1,499 in
60 s, 24.9 picture changes a second, no older picture flashing back. The
drawing's data is column by column from the base (each column from the
bottom), update_leds' row by row; the same pixels both ways gave the same
picture and colours."""

import asyncio
import base64
import types
import unittest

import fakes
from fakes import FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
PROFILE = module("device_profile")
PROTOCOL = module("lamp_protocol")
EFFECTS = module("matrix_effects")
MATRIX = module("light_matrix")
MATTER = module("light_matter")


class Channel:
    """Home Assistant's Matter server, delivering Yeelight commands."""

    backend = "matter"

    def __init__(self, refuse=False):
        self.sent = []
        self.refuse = refuse

    async def async_command(self, cluster, name, payload, endpoint_id=None):
        if self.refuse:
            raise RuntimeError("refused")
        self.sent.append((name, payload))


def lite(channel=None, **values):
    light = make_light(hass=FakeHass(), entry=FakeEntry())
    light._matter = types.SimpleNamespace(linked=True, values={"effect": 50, "effect_sub": 0, **values})
    light._matter_commands = channel or Channel()
    light._is_on = True
    light._brightness = 255
    light._native_effect = "Falling Blocks"
    light._native_effect_speed = 0
    light._enter_mode("Native Effect")
    return light


def marked_frame():
    """Lamp order (row * 20 + column), each pixel's colour its index."""
    return [(index, 0, 0) for index in range(100)]


class PixelOrderTests(unittest.TestCase):
    def test_a_lite_s_drawing_is_column_by_column_from_the_bottom(self):
        pixels = PROFILE.CUBE_LITE_PROFILE.drawing_pixels(marked_frame())
        # Filmed: data 0 bottom-left, 1 above it, 5 right of 0, 99 top-right.
        self.assertEqual([0, 20, 40, 60, 80, 1, 21], [pixel[0] for pixel in pixels[:7]])
        self.assertEqual(99, pixels[99][0])
        self.assertEqual(sorted(range(100)), sorted(pixel[0] for pixel in pixels))

    def test_the_lan_frame_decodes_back(self):
        frame = [(1, 2, 3), (250, 128, 0)] * 50
        self.assertEqual(frame, PROTOCOL.decode_rgb_frame(PROTOCOL.encode_rgb_frame(frame)))


class RouteTests(unittest.TestCase):
    def test_a_linked_lite_streams_over_matter(self):
        self.assertTrue(lite().matrix_streams_over_matter())

    def test_not_without_the_link_nor_the_server_nor_after_a_refusal(self):
        light = lite()
        light._matter.linked = False
        self.assertFalse(light.matrix_streams_over_matter())
        light = lite()
        light._matter_commands.backend = None
        self.assertFalse(light.matrix_streams_over_matter())
        light = lite()
        light._refuse_matrix_native()
        self.assertFalse(light.matrix_streams_over_matter())

    def test_tried_again_after_a_refusal(self):
        light = lite()
        light._refuse_matrix_native()
        light._matrix_refused_at -= MATRIX.MATTER_RETRY_FIRST + 1
        self.assertTrue(light._retry_matrix_native())
        self.assertTrue(light.matrix_streams_over_matter())


class FrameTests(unittest.TestCase):
    def test_the_first_frame_starts_the_own_drawing_then_set_data(self):
        async def scenario():
            light = lite()
            light._lamp_client.profile = PROFILE.CUBE_LITE_PROFILE
            pixels = PROFILE.CUBE_LITE_PROFILE.drawing_pixels(marked_frame())
            await light._send_matrix_stream_frame(pixels)
            await light._send_matrix_stream_frame(pixels)
            names = [name for name, _ in light._matter_commands.sent]
            self.assertEqual(["setEffect", "setData"], names)
            effect = light._matter_commands.sent[0][1]["effect"]
            self.assertEqual((36, EFFECTS.OWN_DRAWING_ID), (effect["effectId"], effect["customId"]))
            # Direct mode is not put back by a new UDP session.
            self.assertIn("end_direct_mode", light._lamp_client.methods())
            data = base64.b64decode(light._matter_commands.sent[1][1]["data"])
            self.assertEqual(bytes((0xFF, 0, 0, 0, 0xFF, 20, 0, 0)), data[:8])

        run(scenario())

    def test_its_pixels_are_the_lan_stream_s_own(self):
        async def scenario():
            light = lite()
            sent = PROTOCOL.encode_rgb_frame(marked_frame())

            async def payload(render):
                return sent

            light._studio_payload = payload
            pixels = await light._matrix_stream_pixels(3)
            self.assertEqual(PROFILE.CUBE_LITE_PROFILE.drawing_pixels(marked_frame()), pixels)

        run(scenario())

    def test_lan_frames_start_the_drawing_again(self):
        light = lite()
        light._matrix_shown = ("setEffect", {"effect": {"effectId": 36, "effectParams": [{"mixer": 0}]}})
        light._entered_direct_mode(True)
        self.assertIsNone(light._matrix_shown)


class ReportTests(unittest.TestCase):
    """The lamp's reports of the stream's drawing are the stream's, not the
    Yeelight app's nor a remote press."""

    def streaming(self, **values):
        light = lite(**values)
        light.studio_selected = lambda: True
        light._matrix_shown = ("setEffect", {"effect": {"effectId": 36, "effectParams": [{"mixer": 0}]}})
        light._fx_mode_is_direct = False
        taken = []
        light._check_lamp_content = lambda: taken.append("content")
        light._lamp_changed_effect = lambda value: taken.append(value)
        return light, taken

    def test_its_own_drawing_is_expected(self):
        light, _ = self.streaming()
        self.assertEqual(MATTER.REMOTE_DRAWING_EFFECT, light._expected_effect())

    def test_its_own_drawing_reported_is_no_other_app(self):
        light, taken = self.streaming(effect_sub=EFFECTS.OWN_DRAWING_ID)
        light._on_matter_report("effect", 36, False)
        light._on_matter_report("effect_sub", EFFECTS.OWN_DRAWING_ID, False)
        self.assertEqual([], taken)
        self.assertIsNotNone(light._matrix_shown)

    def test_the_app_s_drawing_still_takes_over(self):
        light, taken = self.streaming(effect_sub=123456)
        light._on_matter_report("effect", 36, False)
        self.assertEqual(["content"], taken)
        self.assertIsNone(light._matrix_shown)

    def test_another_effect_ends_the_drawing(self):
        light, _ = self.streaming(effect_sub=EFFECTS.OWN_DRAWING_ID)
        light._on_matter_report("effect", 34, False)
        self.assertIsNone(light._matrix_shown)


class SilentLampTests(unittest.TestCase):
    def test_no_frame_goes_to_a_lamp_that_does_not_answer(self):
        async def scenario():
            light = lite()
            light.studio_streaming = lambda: True

            async def payload(render):
                return PROTOCOL.encode_rgb_frame(marked_frame())

            light._studio_payload = payload
            light._lamp_client.stream_silent = True
            light._studio_origin = asyncio.get_running_loop().time()
            light._studio_last_render = 0
            task = asyncio.get_running_loop().create_task(light._studio_loop())
            await asyncio.sleep(0.3)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.assertEqual([], light._matter_commands.sent)

        run(scenario())


if __name__ == "__main__":
    unittest.main()
