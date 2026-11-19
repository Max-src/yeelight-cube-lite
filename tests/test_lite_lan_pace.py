"""A Cube Lite's stream over the LAN, paced (light_studio.LITE_LAN_GAP, its
Stream frame rate limit, stream_routes.LanPacer): a new picture at most
every 0.2 s at the default 5 a second, the last one again after
LITE_LAN_RESEND without a new one (unless Skip Unchanged Stream Frames).

LAN streams that ended abruptly left a lamp stuck 1 time in 5 at a frame
every 40 ms, 0 times in 50 at one every 200 ms (2026-11-17)."""

import asyncio
import base64
import unittest
import unittest.mock

import fakes
from fakes import FakeCube, FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
CONST = module("const")
PROFILE = module("device_profile")
STUDIO = module("light_studio")
ROUTES = module("stream_routes")


def lite(effect="Knight Rider", profile=None):
    light = make_light(hass=FakeHass(), entry=FakeEntry(), cube=FakeCube(profile) if profile else None)
    light._is_on = True
    light._brightness = 255
    light._native_effect = effect
    light._native_effect_speed = 128
    light._enter_mode("Native Effect")
    return light


class PacerTests(unittest.TestCase):
    """stream_routes.LanPacer on its own (times in seconds, exact in binary)."""

    def pacer(self, resend=0.25):
        pacer = ROUTES.LanPacer(resend)
        pacer.sent(0.0)
        return pacer

    def test_a_new_picture_waits_for_the_gap(self):
        pacer = self.pacer()
        self.assertEqual("wait", pacer.decide(0.125, True, 0.25, False, True))
        self.assertEqual("send", pacer.decide(0.25, True, 0.25, False, True))

    def test_the_same_picture_goes_again_after_the_resend(self):
        pacer = self.pacer()
        self.assertEqual("wait", pacer.decide(0.125, False, 0.25, False, True))
        self.assertEqual("send", pacer.decide(0.25, False, 0.25, False, True))

    def test_a_low_limit_repeats_the_last_picture_between_new_ones(self):
        # A gap of 0.5 s (2 a second), the last picture again every 0.25 s.
        pacer = self.pacer()
        self.assertEqual("repeat", pacer.decide(0.25, True, 0.5, False, True))
        pacer.repeated(0.25)
        self.assertEqual("wait", pacer.decide(0.375, True, 0.5, False, True))
        self.assertEqual("send", pacer.decide(0.5, True, 0.5, False, True))
        pacer.sent(0.5)
        self.assertEqual("wait", pacer.decide(0.625, True, 0.5, False, True))

    def test_no_repeat_with_skip_unchanged_frames_or_without_a_lan_frame(self):
        pacer = self.pacer()
        self.assertEqual("wait", pacer.decide(0.25, True, 0.5, True, True))
        self.assertEqual("wait", pacer.decide(0.25, True, 0.5, False, False))

    def test_a_high_limit_is_not_held_by_the_resend(self):
        # A gap of 0.125 s (8 a second), sooner than the resend.
        pacer = self.pacer()
        self.assertEqual("wait", pacer.decide(0.0625, True, 0.125, False, True))
        self.assertEqual("send", pacer.decide(0.125, True, 0.125, False, True))

    def test_nothing_waits_without_a_gap(self):
        pacer = self.pacer(0.0)
        self.assertEqual("send", pacer.decide(0.0, True, 0.0, False, True))
        self.assertEqual("send", pacer.decide(0.0, False, 0.0, False, True))


class StreamDiagTests(unittest.TestCase):
    def test_a_failure_warns_once_per_outage_and_its_end_is_logged(self):
        logger = unittest.mock.Mock()
        diag = ROUTES.StreamDiag("lamp", logger, lambda: "report")
        for _ in range(3):
            diag.failed("LAN", "udp", OSError("unreachable"))
        self.assertEqual(1, logger.warning.call_count)
        self.assertEqual(2, logger.debug.call_count)
        diag.submitted(0.01)
        diag.submitted(0.01)
        self.assertEqual(1, logger.info.call_count)  # frames go through again, once
        diag.failed("LAN", "udp", OSError("unreachable"))
        self.assertEqual(2, logger.warning.call_count)  # a new outage
        self.assertEqual(4, diag.counts["errors"])

    def test_the_status_line_is_debug_when_it_changes_or_is_due(self):
        logger = unittest.mock.Mock()
        diag = ROUTES.StreamDiag("lamp", logger, lambda: "report")
        status = ("LAN", "udp", True, False, False, None)
        diag.status(0.0, status)
        diag.status(1.0, status)
        self.assertEqual(1, logger.debug.call_count)
        diag.status(2.0, ("LAN", "tcp", True, False, False, None))
        diag.status(2.0 + diag.REPORT_SECONDS, ("LAN", "tcp", True, False, False, None))
        self.assertEqual(3, logger.debug.call_count)
        logger.info.assert_not_called()


def stamped_frames(light):
    """Record each update_leds as (loop time, frame)."""
    sent = []
    client = light._lamp_client
    send = client.send_command_fast

    async def stamped(method, params):
        if method == "update_leds":
            sent.append((asyncio.get_running_loop().time(), params[0]))
        return await send(method, params)

    client.send_command_fast = stamped
    return sent


class LanPaceTests(unittest.TestCase):
    def test_a_lite_s_lan_frames_are_never_closer_than_the_gap(self):
        async def scenario():
            light = lite("Lava Lamp")
            sent = stamped_frames(light)
            with unittest.mock.patch.object(STUDIO, "STUDIO_FRAME_SECONDS", 0.01), \
                    unittest.mock.patch.object(STUDIO, "LITE_LAN_GAP", 0.1), \
                    unittest.mock.patch.object(STUDIO, "LITE_LAN_RESEND", 0.15):
                await light._start_studio_stream()
                await asyncio.sleep(0.8)
                light._is_on = False
                await asyncio.sleep(0.05)
            stamps = [at for at, _ in sent]
            gaps = [b - a for a, b in zip(stamps, stamps[1:])]
            self.assertGreater(len(stamps), 3)
            self.assertGreaterEqual(min(gaps), 0.1 - 0.005)
            self.assertTrue(light._lamp_client.stream_changes_only or not light.studio_streaming())

        run(scenario())

    @staticmethod
    def _stream_at(fps, resend, skip_unchanged=False):
        """The LAN frames (time, frame) of 1.2 s of Knight Rider (a new picture
        every render) at ``fps``; LITE_LAN_GAP 0.1 at the default 5.
        ``skip_unchanged``: the Skip Unchanged Stream Frames switch."""
        async def scenario():
            light = lite("Knight Rider")
            entry = light._config_entry
            entry.options = {**entry.options, CONST.CONF_SKIP_UNCHANGED_FRAMES: skip_unchanged}
            light._native_effect_speed = 255
            light._lite_stream_fps = fps
            sent = stamped_frames(light)
            with unittest.mock.patch.object(STUDIO, "STUDIO_FRAME_SECONDS", 0.01), \
                    unittest.mock.patch.object(STUDIO, "LITE_LAN_GAP", 0.1), \
                    unittest.mock.patch.object(STUDIO, "LITE_LAN_RESEND", resend):
                await light._start_studio_stream()
                await asyncio.sleep(1.2)
                light._is_on = False
                await asyncio.sleep(0.05)
            return sent

        sent = run(scenario())
        times = [at for at, _ in sent]
        new = [at for i, (at, frame) in enumerate(sent) if i and frame != sent[i - 1][1]]
        return times, new

    def test_a_low_limit_spaces_new_pictures_never_the_lamp_quiet(self):
        # 2 a second: a new picture every 0.25 s, the last one again every
        # LITE_LAN_RESEND between them.
        times, new = self._stream_at(2, 0.05)
        self.assertLess(max(b - a for a, b in zip(times, times[1:])), 0.05 + 0.03)
        self.assertGreater(len(new), 2)
        self.assertGreaterEqual(min(b - a for a, b in zip(new, new[1:])), 0.25 - 0.01)

    def test_a_high_limit_is_not_held_by_the_repeat(self):
        # 10 a second: a new picture every 0.05 s, sooner than LITE_LAN_RESEND.
        times, new = self._stream_at(10, 0.1)
        self.assertGreaterEqual(min(b - a for a, b in zip(times, times[1:])), 0.05 - 0.01)
        self.assertGreater(len(new), 12)

    def test_skip_unchanged_frames_sends_new_pictures_only_within_the_limit(self):
        # The switch on, 2 a second: no repeat of the last picture between
        # new ones (every frame sent differs from the one before), and the
        # limit still spaces the new ones.
        times, new = self._stream_at(2, 0.05, skip_unchanged=True)
        self.assertGreater(len(new), 2)
        self.assertEqual(len(times) - 1, len(new))  # the first, then new pictures only
        self.assertGreaterEqual(min(b - a for a, b in zip(new, new[1:])), 0.25 - 0.01)


class FullFrameTests(unittest.TestCase):
    def test_every_lan_frame_is_the_whole_picture(self):
        # Both models over the LAN: update_leds always carries all 100 pixels.
        async def scenario():
            with unittest.mock.patch.multiple(STUDIO, LITE_LAN_GAP=0.0, LITE_LAN_RESEND=0.0):
                for light in (lite("Falling Blocks"), lite(profile=PROFILE.profile_for("CubeMatrix"))):
                    light._native_effect_speed = 0
                    await light._activate_native_effect()
                    await asyncio.sleep(0.5)
                    sizes = {
                        len(base64.b64decode(params[0]))
                        for _, method, params in light._lamp_client.sent if method == "update_leds"
                    }
                    self.assertEqual(1, len(sizes))
                    self.assertGreaterEqual(min(sizes), 300)
                    light._is_on = False
                    task = light._studio_task
                    if task is not None:
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)

        run(scenario())


if __name__ == "__main__":
    unittest.main()
