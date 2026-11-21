"""A Cube Lite's stream over the LAN, paced (light_studio.LITE_LAN_GAP, its
Stream frame rate limit, stream_routes.LanPacer): a new picture at most
every 0.2 s at 5 a second (LITE_LAN_GAP_FPS), the last one again after
LITE_LAN_RESEND without a new one (unless Skip Unchanged Stream Frames):
at 5 a second and under, one frame every 0.2 s.

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

    def pacer(self, resend=0.25, gap=0.25, step=0.0):
        pacer = ROUTES.LanPacer(resend, step)
        self.assertEqual("send", pacer.decide(0.0, True, gap, False, True))
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

    def test_a_low_limit_sends_one_frame_a_gap(self):
        # A gap of 0.5 s (2 a second): nothing in between (a 0.25 s repeat
        # made every limit 5 frames a second on the lamp, 2026-11-20), the
        # same picture again when no new one came.
        pacer = self.pacer(gap=0.5)
        self.assertEqual("wait", pacer.decide(0.25, True, 0.5, False, True))
        self.assertEqual("wait", pacer.decide(0.25, False, 0.5, False, True))
        self.assertEqual("send", pacer.decide(0.5, False, 0.5, False, True))
        pacer.sent(0.5)
        self.assertEqual("wait", pacer.decide(0.75, True, 0.5, False, True))
        self.assertEqual("send", pacer.decide(1.0, True, 0.5, False, True))

    def test_a_new_picture_never_follows_a_frame_closely(self):
        # Renders every 0.125 s, a new picture every 0.375 s: frames go
        # 0.375 s apart, never a new picture just after another frame.
        # 2026-11-19: a new picture 120 ms after a repeat hung a Cube Lite
        # within minutes, four times in a row.
        pacer = self.pacer(gap=0.375, step=0.125)
        self.assertEqual("wait", pacer.decide(0.25, True, 0.375, False, True))
        self.assertEqual("send", pacer.decide(0.375, True, 0.375, False, True))

    def test_no_frame_between_beats_with_skip_unchanged_frames_or_without_a_lan_frame(self):
        pacer = self.pacer(gap=0.5)
        self.assertEqual("wait", pacer.decide(0.25, True, 0.5, True, True))
        self.assertEqual("wait", pacer.decide(0.25, True, 0.5, False, False))

    def test_a_high_limit_is_not_held_by_the_resend(self):
        # A gap of 0.125 s (8 a second), sooner than the resend.
        pacer = self.pacer(gap=0.125)
        self.assertEqual("wait", pacer.decide(0.0625, True, 0.125, False, True))
        self.assertEqual("send", pacer.decide(0.125, True, 0.125, False, True))

    def test_nothing_waits_without_a_gap(self):
        pacer = self.pacer(0.0, gap=0.0)
        self.assertEqual("send", pacer.decide(0.0, True, 0.0, False, True))
        self.assertEqual("send", pacer.decide(0.0, False, 0.0, False, True))

    @staticmethod
    def sends(fps, seconds=60.0, step=0.04, jitter=0.0, frames=None):
        """Every render (``step`` apart, a new picture each, woken ``jitter``
        late) for ``seconds``: the times the pacer sent a new picture
        (``frames``: every frame's time, the repeats too)."""
        pacer = ROUTES.LanPacer(0.2, step)
        sent = []
        for tick in range(int(seconds / step)):
            now = tick * step + (jitter * ((tick * 7) % 5) / 4)
            decision = pacer.decide(now, True, 1 / fps, False, True)
            if decision == "send":
                pacer.sent(now)
                sent.append(now)
            elif decision == "repeat":
                pacer.repeated(now)
            if frames is not None and decision != "wait":
                frames.append(now)
        return sent

    def test_the_limit_is_met_over_time_not_rounded_down_to_the_renders(self):
        # Renders every 40 ms: 12 a second used to give 8.3 (every third
        # render), 10 gave 8.3, 3 gave 2.8.
        for fps in (1, 3, 5, 7, 10, 12, 20, 25):
            for jitter in (0.0, 0.004):
                sent = self.sends(fps, jitter=jitter)
                rate = (len(sent) - 1) / (sent[-1] - sent[0])
                self.assertAlmostEqual(fps, rate, delta=fps * 0.01, msg=f"{fps} fps, jitter {jitter}")
                if fps <= 5:
                    continue  # test_five_a_second_and_under_is_one_steady_rhythm
                gaps = [b - a for a, b in zip(sent, sent[1:])]
                # At most one render closer than the gap, and one render
                # apart at the least (give or take the renders' jitter).
                least = max(1 / fps - 0.04, 0.04) - jitter - 1e-9
                self.assertGreaterEqual(min(gaps), least, msg=f"{fps} fps, jitter {jitter}")

    def test_five_a_second_and_under_is_one_steady_rhythm(self):
        # Every frame one gap after the one before (a render sooner or
        # later at worst, never under 0.2 s): exactly the limit on the lamp.
        for fps in (1, 2, 3, 4, 5):
            for jitter in (0.0, 0.004):
                frames = []
                self.sends(fps, jitter=jitter, frames=frames)
                gaps = [b - a for a, b in zip(frames, frames[1:])]
                self.assertGreaterEqual(min(gaps), max(1 / fps - 0.04, 0.2 - 0.01) - jitter, msg=f"{fps} fps, jitter {jitter}")
                self.assertLessEqual(max(gaps), 1 / fps + 0.04 + jitter, msg=f"{fps} fps, jitter {jitter}")
                rate = (len(frames) - 1) / (frames[-1] - frames[0])
                self.assertAlmostEqual(fps, rate, delta=fps * 0.01, msg=f"{fps} fps, jitter {jitter}")

    def test_a_late_picture_starts_the_schedule_again_without_a_burst(self):
        # A picture held 1 s (the lock, a hold) goes at once, the next one a
        # gap later (one render sooner at most), not at once to catch up.
        pacer = self.pacer(resend=0.125, gap=0.25, step=0.0625)
        self.assertEqual("send", pacer.decide(1.25, True, 0.25, False, True))
        pacer.sent(1.25)
        self.assertEqual("wait", pacer.decide(1.3125, True, 0.25, False, True))
        self.assertEqual("wait", pacer.decide(1.375, True, 0.25, False, True))
        self.assertEqual("send", pacer.decide(1.4375, True, 0.25, False, True))


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
            # At most one render (0.01 s here) closer than the gap.
            self.assertGreaterEqual(min(gaps), 0.1 - 0.01 - 0.005)
            self.assertTrue(light._lamp_client.stream_changes_only or not light.studio_streaming())

        run(scenario())

    @staticmethod
    def _stream_at(fps, resend, skip_unchanged=False):
        """The LAN frames (time, frame) of 1.2 s of Knight Rider (a new picture
        every render) at ``fps``; LITE_LAN_GAP 0.1 at 5 a second.
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

    def test_a_low_limit_is_that_many_frames_on_the_lamp(self):
        # 2 a second (a gap of 0.25 s here): one frame every 0.25 s, nothing
        # in between (2026-11-20: a repeat every LITE_LAN_RESEND made "1 a
        # second" 5 frames a second on the lamp).
        times, new = self._stream_at(2, 0.05)
        gaps = [b - a for a, b in zip(times, times[1:])]
        self.assertGreater(len(new), 2)
        self.assertGreaterEqual(min(gaps), 0.25 - 0.01 - 0.01)
        self.assertLess(max(gaps), 0.25 + 0.03)

    def test_a_lamp_left_at_its_default_gets_a_rate_tested_safe(self):
        # 2026-11-20 night: 5 a second hung both Cube Lites within 100 min;
        # 2 and 3 a second never in 12 lamp-hours. A new lamp gets 2: one
        # frame every 0.5 s, and the setting shows the same default.
        light = lite()
        self.assertEqual(2, CONST.LITE_STREAM_FPS_DEFAULT)
        self.assertEqual(CONST.LITE_STREAM_FPS_DEFAULT, light._lite_stream_fps)
        self.assertAlmostEqual(0.5, light._lite_lan_gap())
        spec = next(n for n in module("number").LITE_NUMBERS if n.attr == "_lite_stream_fps")
        self.assertEqual(CONST.LITE_STREAM_FPS_DEFAULT, spec.default)

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
        # One frame every 0.05 s: a new picture at worst one of those sooner.
        self.assertGreaterEqual(min(b - a for a, b in zip(new, new[1:])), 0.25 - 0.05 - 0.01)


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
