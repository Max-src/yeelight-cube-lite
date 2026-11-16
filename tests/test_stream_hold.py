"""A stream whose lamp cannot take frames (no UDP connection, or a lamp that
left its last check unanswered) looks again every STUDIO_HOLD_SECONDS, not 25
times a second, and its frames resume once the lamp can take them."""

import asyncio
import unittest

import fakes
from fakes import FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
STUDIO = module("light_studio")


def streaming_light():
    light = make_light(hass=FakeHass(), entry=FakeEntry())
    light._is_on = True
    light._brightness = 3
    light._native_effect = "Falling Blocks"
    light._enter_mode("Native Effect")
    return light


def frames(light, since=0):
    return [p for _, method, p in light._lamp_client.sent[since:] if method == "update_leds"]


async def stop(light):
    light._is_on = False
    task = light._studio_task
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


class StreamHoldTests(unittest.TestCase):
    def test_hold_values(self):
        self.assertLess(STUDIO.STUDIO_FRAME_SECONDS, STUDIO.STUDIO_HOLD_SECONDS)
        self.assertLessEqual(STUDIO.STUDIO_HOLD_SECONDS, 1.0)  # resumes within a second

    def check_held_then_resumed(self, block, unblock, count):
        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.2)
            self.assertTrue(frames(light))  # streaming
            block(light)
            await asyncio.sleep(0.1)  # a frame already drawn may still be due
            mark, checks = len(light._lamp_client.sent), count(light)
            await asyncio.sleep(0.6)
            # About 15 frame slots went by: looked at no more than twice.
            self.assertLessEqual(count(light) - checks, 2)
            self.assertEqual([], frames(light, mark))
            unblock(light)
            await asyncio.sleep(STUDIO.STUDIO_HOLD_SECONDS + 0.3)
            self.assertTrue(frames(light, mark))  # frames again
            await stop(light)

        run(scenario())

    def test_no_connection_is_looked_at_every_hold_not_every_frame(self):
        def counted(light):
            client = light._lamp_client
            client.connected_checks = 0
            real = type(client).is_connected

            def is_connected():
                client.connected_checks += 1
                return real(client)

            client.is_connected = is_connected
            client.is_unreachable = True

        def back(light):
            light._lamp_client.is_unreachable = False

        self.check_held_then_resumed(counted, back, lambda light: light._lamp_client.connected_checks)

    def test_a_silent_lamp_is_looked_at_every_hold_not_every_frame(self):
        def silent(light):
            light._lamp_client.stream_silent = True
            light._direct_losses = 0
            real = light._direct_mode_lost

            def lost():
                light._direct_losses += 1
                real()

            light._direct_mode_lost = lost

        def answers(light):
            light._lamp_client.stream_silent = False

        self.check_held_then_resumed(silent, answers, lambda light: light._direct_losses)


if __name__ == "__main__":
    unittest.main()
