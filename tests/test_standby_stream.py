"""Keep Streaming When Off (light_studio's standby stream): turning off an
effect Home Assistant streams to a Cube Lite keeps the stream going, black,
until the lamp is turned on, and the effect goes on where it was."""

import asyncio
import unittest

import fakes
from fakes import FakeCube, FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
CONST = module("const")
PROFILE = module("device_profile")


def streaming_light(*, option=True, effect="Falling Blocks", profile=None, brightness=3):
    entry = FakeEntry()
    entry.options = {**entry.options, CONST.CONF_KEEP_STREAMING_WHEN_OFF: option}
    light = make_light(hass=FakeHass(), entry=entry, cube=FakeCube(profile) if profile else None)
    light._is_on = True
    light._brightness = brightness
    light._native_effect = effect
    light._enter_mode("Native Effect")
    return light


def frames(light, since=0):
    return [params[0] for how, method, params in light._lamp_client.sent[since:] if method == "update_leds"]


def commands(light, since=0):
    return [(method, params) for how, method, params in light._lamp_client.sent[since:] if method != "update_leds"]


async def stop(light):
    light._studio_standby = False
    light._is_on = False
    task = light._studio_task
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


class StandbyStreamTests(unittest.TestCase):
    def test_off_streams_black_and_on_goes_on_where_the_effect_was(self):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.4)
            self.assertTrue(light.keeps_streaming_when_off())
            black = light._standby_payload()
            last = light._studio_last_render

            mark = len(light._lamp_client.sent)
            await light.async_turn_off()
            await asyncio.sleep(0.4)
            self.assertFalse(light.is_on)
            # Never powered off, never silent: black frames, about 25 a second.
            self.assertNotIn("set_power", [method for method, _ in commands(light, mark)])
            sent = frames(light, mark)
            self.assertGreaterEqual(len(sent), 6)
            self.assertEqual({black}, set(sent[-5:]))
            # The effect is held where it was.
            self.assertEqual(last, light._studio_last_render)

            mark = len(light._lamp_client.sent)
            await light.async_turn_on()
            await asyncio.sleep(0.3)
            self.assertTrue(light.is_on)
            # Falling Blocks sends only changes: resuming can produce just
            # one frame while the piece stays in place.
            self.assertNotEqual(black, frames(light, mark)[-1])
            # From the frame after the last one shown, not jumped ahead by
            # the time it was off (0.4 s: 10 frames).
            self.assertLessEqual(light._studio_last_render - last, 9)
            # The same brightness: not sent again (a set_bright after frames
            # can bring an older picture back).
            self.assertNotIn("set_bright", [method for method, _ in commands(light, mark)])
            await stop(light)

        run(scenario())

    def test_a_brightness_set_while_off_is_sent_when_it_comes_back(self):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.2)
            await light.async_turn_off()
            await asyncio.sleep(0.2)
            mark = len(light._lamp_client.sent)
            await light.async_turn_on(brightness=128)
            await asyncio.sleep(0.1)
            self.assertIn(("set_bright", [50]), commands(light, mark))
            await stop(light)

        run(scenario())

    def test_without_the_option_off_powers_the_lamp_off(self):
        async def scenario():
            light = streaming_light(option=False)
            await light._activate_native_effect()
            await asyncio.sleep(0.2)
            self.assertFalse(light.keeps_streaming_when_off())
            mark = len(light._lamp_client.sent)
            await light.async_turn_off()
            await asyncio.sleep(0.2)
            self.assertIn(("set_power", ["off"]), commands(light, mark))
            self.assertTrue(light._studio_task is None or light._studio_task.done())
            await stop(light)

        run(scenario())

    def test_only_a_stream_to_a_cube_lite_stays_on_standby(self):
        # The lamp's own effect: nothing streams, off powers it off.
        light = streaming_light(effect="Rainbow")
        self.assertFalse(light.keeps_streaming_when_off())
        # A Cube Matrix (its music connection or Matter): never on standby.
        matrix = streaming_light(profile=PROFILE.profile_for("CubeMatrix"))
        matrix._studio_task = asyncio.Future(loop=asyncio.new_event_loop())
        self.assertFalse(matrix.keeps_streaming_when_off())

    def test_the_standby_ends_with_the_stream(self):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.2)
            await light.async_turn_off()
            await asyncio.sleep(0.1)
            self.assertTrue(light._studio_standby)
            # Another content chosen while off (nothing streams any more).
            light._enter_mode("Solid Color")
            await asyncio.sleep(0.2)
            self.assertTrue(light._studio_task is None or light._studio_task.done())
            self.assertFalse(light._studio_standby)
            await stop(light)

        run(scenario())


if __name__ == "__main__":
    unittest.main()
