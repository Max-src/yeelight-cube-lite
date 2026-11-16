"""Partial frames (lamp_protocol.partial_frame, light_studio PARTIAL_FRAME_EFFECTS):
update_leds sets the pixels it is given, from the first, and keeps the
others. Falling Blocks leaves most of a Cube Lite's frames unchanged: it is
streamed as each frame up to its last changed pixel, one pixel when nothing
changed (a frame still goes every render: the lamp never pauses), and a full
frame every PARTIAL_FULL_FRAME_SECONDS and after direct mode is entered again."""

import asyncio
import base64
import unittest
from unittest.mock import patch

import fakes
from fakes import FakeCube, FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
PROTOCOL = module("lamp_protocol")
# Off by default (light_studio.PARTIAL_FRAME_EFFECTS): the stream tests here
# switch it on for Falling Blocks.
STUDIO = module("light_studio")
PROFILE = module("device_profile")


def frame(*colours):
    return base64.b64encode(bytes(c for rgb in colours for c in rgb)).decode("ascii")


def raw(*colours):
    return bytes(c for rgb in colours for c in rgb)


class PartialFrameTests(unittest.TestCase):
    def test_unknown_lamp_gets_the_full_frame(self):
        full = frame(*[(1, 2, 3)] * 100)
        for shown in ((), (base64.b64decode(full),)):  # fewer than the lamp's buffers
            self.assertEqual((full, base64.b64decode(full)), PROTOCOL.partial_frame(full, shown))

    def test_up_to_the_last_pixel_changed_from_either_buffer(self):
        # Pixels changed since either of the last two frames go: a frame
        # the lamp missed is put right by the next.
        older = [(0, 0, 0)] * 100
        last = list(older)
        last[60] = (0, 255, 0)
        now = list(last)
        now[5] = (255, 0, 0)
        sent, shows = PROTOCOL.partial_frame(frame(*now), (raw(*older), raw(*last)))
        self.assertEqual(61 * 3, len(base64.b64decode(sent)))  # pixel 60 too: the older buffer lacks it
        self.assertEqual(raw(*now), shows)

    def test_nothing_changed_in_either_is_one_pixel(self):
        pixels = [(9, 8, 7)] + [(0, 0, 0)] * 99
        sent, _ = PROTOCOL.partial_frame(frame(*pixels), (raw(*pixels), raw(*pixels)))
        self.assertEqual(bytes((9, 8, 7)), base64.b64decode(sent))

    def test_a_change_on_the_last_pixel_is_the_whole_frame(self):
        before = [(0, 0, 0)] * 100
        full = frame(*(before[:99] + [(1, 1, 1)]))
        self.assertIs(full, PROTOCOL.partial_frame(full, (raw(*before), raw(*before)))[0])


def streaming_light(effect="Falling Blocks", profile=None):
    light = make_light(hass=FakeHass(), entry=FakeEntry(), cube=FakeCube(profile) if profile else None)
    light._is_on = True
    light._brightness = 255
    light._native_effect = effect
    light._native_effect_speed = 0
    light._enter_mode("Native Effect")
    return light


def sent_frames(light, since=0):
    return [base64.b64decode(params[0]) for _, method, params in light._lamp_client.sent[since:] if method == "update_leds"]


async def stop(light):
    light._is_on = False
    task = light._studio_task
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


class PartialStreamTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(STUDIO, "PARTIAL_FRAME_EFFECTS", frozenset({"Falling Blocks"}))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_lamp_shows_every_drawn_frame(self):
        # Model lamps that keep the pixels they are not given, with one
        # buffer or two written in turn (the one written is shown): after
        # each frame they show exactly the frame drawn for that render.
        async def scenario():
            light = streaming_light()
            drawn = []
            real = light._studio_payload

            async def payload(render):
                result = await real(render)
                drawn.append(base64.b64decode(result))
                return result

            light._studio_payload = payload
            await light._activate_native_effect()
            mark = len(light._lamp_client.sent)
            drawn.clear()
            await asyncio.sleep(3)
            await stop(light)
            frames = sent_frames(light, mark)
            for buffers in (1, 2):
                lamp = [b""] * buffers
                checked = 0
                for index, (sent, intended) in enumerate(zip(frames, drawn)):
                    target = index % buffers
                    lamp[target] = sent + lamp[target][len(sent):]
                    if all(len(each) == 300 for each in lamp):
                        self.assertEqual(intended, lamp[target], f"{buffers} buffer(s), frame {index}")
                        checked += 1
                self.assertGreater(checked, 40)
            sizes = [len(f) for f in frames]
            self.assertEqual([300, 300], sizes[:2])  # both buffers in full first
            self.assertGreater(sum(1 for n in sizes if n == 3), len(sizes) // 2)  # mostly one pixel
            self.assertLess(sum(sizes), 0.5 * 300 * len(sizes))

        run(scenario())

    def test_a_full_frame_regularly_and_after_direct_mode_again(self):
        async def scenario():
            with patch.object(STUDIO, "PARTIAL_FULL_FRAME_SECONDS", 0.5):
                light = streaming_light()
                await light._activate_native_effect()
                mark = len(light._lamp_client.sent)
                await asyncio.sleep(1.6)
                fulls = sum(1 for f in sent_frames(light, mark) if len(f) == 300)
                self.assertGreaterEqual(fulls, 3)
                # The lamp out of reach for a moment: direct mode again, a full frame.
                light._lamp_client.is_unreachable = True
                await asyncio.sleep(0.3)
                light._lamp_client.is_unreachable = False
                mark = len(light._lamp_client.sent)
                await asyncio.sleep(STUDIO.STUDIO_HOLD_SECONDS + 0.3)
                self.assertEqual(300, len(sent_frames(light, mark)[0]))
                await stop(light)

        run(scenario())

    def test_other_effects_and_the_cube_matrix_get_full_frames(self):
        async def scenario():
            for light in (
                streaming_light("Lava Lamp"),
                streaming_light(profile=PROFILE.profile_for("CubeMatrix")),
            ):
                await light._activate_native_effect()
                await asyncio.sleep(0.5)
                sizes = {len(f) for f in sent_frames(light)}
                self.assertEqual(1, len(sizes))  # always the whole frame
                self.assertGreaterEqual(min(sizes), 300)
                await stop(light)

        run(scenario())



class PartialFramesOffTests(unittest.TestCase):
    def test_off_by_default(self):
        # Filmed 2026-11-16: partial frames at 25 a second make a Cube Lite
        # flash older pictures now and then.
        self.assertEqual(frozenset(), STUDIO.PARTIAL_FRAME_EFFECTS)

        async def scenario():
            light = streaming_light()
            await light._activate_native_effect()
            await asyncio.sleep(0.5)
            self.assertEqual({300}, {len(f) for f in sent_frames(light)})
            await stop(light)

        run(scenario())


if __name__ == "__main__":
    unittest.main()
