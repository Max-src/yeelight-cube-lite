"""A Matter server that lost a lamp for a while (2026-11-16 09:58: both Cube
Lites, ~1.5 min) subscribes to it again and reports every value anew. Those
values are the lamp's unchanged state, not a change by a button or an app: a
stream Home Assistant sends goes on, and a reported effect that is the
drawing Home Assistant keeps the lamp in never stops it."""

import asyncio
import types
import unittest

import fakes
from fakes import FakeEntry, FakeHass, make_light, module, run
from tests.test_matter_link import CUBE_ATTRIBUTES, LAMP_IP, LINK, FakeClient, hass_with, node

fakes.install_stubs()
MATTER = module("light_matter")


class ResubscribeReportTests(unittest.TestCase):
    """matter_link: the same value again is no report."""

    def setUp(self):
        self.reports = []
        self.client = FakeClient([node(2, dict(CUBE_ATTRIBUTES))])
        self.link = LINK.MatterLink(hass_with(self.client), lambda *report: self.reports.append(report))
        self.link.refresh(LAMP_IP, None)
        self.reports.clear()

    def test_the_same_values_again_are_not_reported(self):
        # The server's new subscription: every value the lamp has, again.
        for name, path in LINK.REPORTED.items():
            self.client.push(2, path, self.link.values[name])
        self.assertEqual([], [r for r in self.reports if r[0] != "effect_sub"])

    def test_a_changed_value_still_is(self):
        self.client.push(2, LINK.EFFECT, 34)
        self.assertEqual([("effect", 34, False)], self.reports)

    def test_a_remote_slot_pressed_again_is_still_reported(self):
        # A playlist of one slot: each press reports the same custom id.
        self.client.push(2, LINK.EFFECT_SUB, 1000)
        self.client.push(2, LINK.EFFECT_SUB, 1000)
        self.assertEqual([("effect_sub", 1000, False)] * 2, self.reports)


def streaming_light():
    light = make_light(hass=FakeHass(), entry=FakeEntry())
    light._is_on = True
    light._brightness = 255
    light._native_effect = "Falling Blocks"
    light._native_effect_speed = 0
    light._enter_mode("Native Effect")
    light._matter = types.SimpleNamespace(values={"effect": 50, "effect_sub": 50, "on_off": True, "level": 254})
    return light


def frames(light):
    return sum(1 for _, method, _ in light._lamp_client.sent if method == "update_leds")


async def stop(light):
    light._is_on = False
    task = light._studio_task
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


class StreamThroughResubscribeTests(unittest.TestCase):
    def long_after_the_last_command(self, light):
        # Frames are no commands: no echo window is open mid-stream.
        light._lamp_command_at -= 2 * MATTER.MATTER_ECHO_WINDOW
        light._fx_restore_at -= 2 * MATTER.MATTER_ECHO_WINDOW

    def test_the_drawing_reported_again_keeps_the_stream(self):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.3)
            self.long_after_the_last_command(light)
            for name, value in (("on_off", True), ("effect", 50), ("effect_sub", 50)):
                light._on_matter_report(name, value, False)
            before = frames(light)
            await asyncio.sleep(1.5)
            self.assertTrue(light.studio_streaming())
            self.assertFalse(light._external_display)
            self.assertFalse(light._studio_task.done())
            self.assertGreater(frames(light), before)
            await stop(light)

        run(scenario())

    def test_the_lamp_s_own_effect_still_takes_over(self):
        # A button or the app starting an effect of its own is followed:
        # the stream gives way to it, as before.
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.3)
            self.long_after_the_last_command(light)
            rainbow = MATTER.NATIVE_EFFECTS["Rainbow"]["effect_id"]
            light._on_matter_report("effect", rainbow, False)
            await asyncio.sleep(0.3)
            self.assertFalse(light.studio_streaming())
            self.assertEqual("Rainbow", light._native_effect)
            await stop(light)

        run(scenario())

    def test_another_app_s_drawing_still_takes_over(self):
        # Effect 36 (an app's drawing) is not the integration's: followed.
        async def scenario():
            light = streaming_light()
            light._matter.values.update(effect=36, effect_sub=12345)
            await light._activate_native_effect()
            await asyncio.sleep(0.3)
            self.long_after_the_last_command(light)
            light._on_matter_report("effect", 36, False)
            await asyncio.sleep(MATTER.EXTERNAL_DRAWING_WAIT + 0.3)
            self.assertTrue(light._external_display)
            self.assertFalse(light.studio_streaming())
            await stop(light)

        run(scenario())


class LampStartTests(unittest.TestCase):
    """2026-11-16 14:53: a Cube Lite's network chip restarted mid-stream (its
    panel kept the picture) and reported its start-up state, effect 0 and
    colour 0/0, which was taken for the Yeelight app's colour: the stream
    stopped and a power cycle did not bring it back."""

    def chip_restart(self, light, ago=0.0):
        light._on_matter_report("reboot_count", 3923, False)
        light._lamp_started_at -= ago
        light._matter.values.update(effect=0, effect_sub=0, hue=0, saturation=0, level=200)
        for name, value in (("effect", 0), ("effect_sub", 0), ("hue", 0), ("saturation", 0)):
            light._on_matter_report(name, value, False)

    def test_the_start_up_state_is_not_another_app(self):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.3)
            light._lamp_command_at -= 2 * MATTER.MATTER_ECHO_WINDOW
            brightness = light._brightness
            self.chip_restart(light)
            light._on_matter_report("level", 200, False)
            await asyncio.sleep(MATTER.EXTERNAL_DRAWING_WAIT + 0.3)
            self.assertFalse(light._external_display)
            self.assertTrue(light.studio_streaming())
            self.assertEqual(brightness, light._brightness)  # its start-up level is not followed
            await stop(light)

        run(scenario())

    def test_the_app_s_colour_later_still_takes_over(self):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.3)
            light._lamp_command_at -= 2 * MATTER.MATTER_ECHO_WINDOW
            self.chip_restart(light, ago=MATTER.LAMP_START_DEFAULTS_SECONDS + 1)
            await asyncio.sleep(MATTER.EXTERNAL_DRAWING_WAIT + 0.3)
            self.assertTrue(light._external_display)
            self.assertFalse(light.studio_streaming())
            await stop(light)

        run(scenario())

    def test_the_cube_lite_follows_its_reboot_count(self):
        self.assertIn("reboot_count", LINK.REPORTED)


if __name__ == "__main__":
    unittest.main()
