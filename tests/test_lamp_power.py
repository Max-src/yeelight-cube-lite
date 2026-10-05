import importlib.util
import unittest
from collections import deque
from types import SimpleNamespace
from unittest.mock import Mock

from tests.test_native_features import LIGHT_SOURCE, ROOT, _load_standalone_functions

_spec = importlib.util.spec_from_file_location("lamp_power", ROOT / "lamp_power.py")
lamp_power = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lamp_power)

WHITE, BLACK = (255, 255, 255), (0, 0, 0)
RED, GREEN, BLUE = (255, 0, 0), (0, 255, 0), (0, 0, 255)


def frame(count, color):
    return [color] * count + [BLACK] * (100 - count)


# The user's "Piglet" pixel art: 94 lit pixels, mostly pale pink.
PIGLET = (
    [(255, 107, 107)] * 24 + [(255, 178, 176)] * 66
    + [(255, 255, 255)] * 2 + [(184, 66, 66)] * 2 + [BLACK] * 6
)
DOG = [(227, 157, 35)] * 45 + [(70, 43, 0)] * 7 + [(253, 213, 144)] * 3 + [BLACK] * 45

# USB power-meter readings of one lamp at 100 % brightness (W, 0.1 A steps).
MEASURED = [
    (frame(0, WHITE), 0.4),
    (frame(25, WHITE), 2.75),  # read 2.5-3.0
    (frame(50, WHITE), 4.5),
    (frame(100, WHITE), 6.1),
    (frame(50, RED), 3.0),
    (frame(50, GREEN), 3.0),
    (frame(50, BLUE), 3.0),
    (frame(100, RED), 5.0),
    (PIGLET, 6.0),
    (DOG, 4.0),
]


class LampPowerTests(unittest.TestCase):
    def test_the_model_matches_the_measurements(self):
        for pixels, watts in MEASURED:
            with self.subTest(watts=watts):
                self.assertAlmostEqual(watts, lamp_power.estimated_power(pixels), delta=0.45)

    def test_hardware_brightness_scales_the_panel_not_the_electronics(self):
        self.assertAlmostEqual(0.4, lamp_power.estimated_power(PIGLET, 0), places=6)
        self.assertLess(
            lamp_power.estimated_power(PIGLET, 50), lamp_power.estimated_power(PIGLET, 100)
        )

    def test_frames_within_the_limit_or_without_limit_are_untouched(self):
        self.assertIs(PIGLET, lamp_power.limit_frame_power(PIGLET, lamp_power.NO_LIMIT_W))
        self.assertIs(DOG, lamp_power.limit_frame_power(DOG, 5.0))
        self.assertIs(PIGLET, lamp_power.limit_frame_power(PIGLET, 3.0, 10))

    def test_a_frame_over_the_limit_is_dimmed_just_under_it(self):
        for limit in (1.0, 2.0, 3.0, 4.5):
            with self.subTest(limit=limit):
                limited = lamp_power.limit_frame_power(PIGLET, limit)
                power = lamp_power.estimated_power(limited)
                self.assertLessEqual(power, limit)
                self.assertGreater(power, limit - 0.15)
                for before, after in zip(PIGLET, limited):
                    self.assertTrue(all(a <= b for a, b in zip(after, before)))
                    if before == BLACK:
                        self.assertEqual(BLACK, after)

    def test_the_hardware_brightness_counts_towards_the_limit(self):
        limited = lamp_power.limit_frame_power(PIGLET, 2.0, 60)
        self.assertLessEqual(lamp_power.estimated_power(limited, 60), 2.0)

    def test_the_light_limits_what_it_sends_and_records_the_estimate(self):
        lamp_frame = _load_standalone_functions(
            LIGHT_SOURCE, {"_lamp_frame"}, {
                "limit_frame_power": lamp_power.limit_frame_power,
                "estimated_power": lamp_power.estimated_power,
            },
        )["_lamp_frame"]
        light = SimpleNamespace(
            _power_limit=lamp_power.NO_LIMIT_W, _last_hardware_brightness=100,
            _last_frame_power=None,
        )
        self.assertIs(PIGLET, lamp_frame(light, PIGLET))  # off by default
        self.assertAlmostEqual(6.0, light._last_frame_power, delta=0.45)
        light._power_limit = 3.0
        lamp_frame(light, PIGLET)
        self.assertLessEqual(light._last_frame_power, 3.0)
        # unknown hardware brightness (None / 0 sentinel) counts as 100 %
        for unknown in (None, 0):
            light._last_hardware_brightness = unknown
            lamp_frame(light, PIGLET)
            self.assertLessEqual(light._last_frame_power, 3.0)

    def test_the_lowest_limit_leaves_only_the_electronics(self):
        dark = lamp_power.limit_frame_power(PIGLET, lamp_power.BASE_W)
        self.assertEqual([BLACK] * 100, dark)
        self.assertAlmostEqual(lamp_power.BASE_W, lamp_power.estimated_power(dark))

    def test_the_sensor_value_follows_the_lamp(self):
        estimated = _load_standalone_functions(
            LIGHT_SOURCE, {"estimated_power"}, {"BASE_W": lamp_power.BASE_W},
        )["estimated_power"].fget
        light = SimpleNamespace(
            available=True, _is_on=True, firmware_draws_matrix=False,
            _last_frame_power=5.987, _firmware_power_samples=[],
        )
        self.assertEqual(6.0, estimated(light))  # 0.1 W, about the meter's resolution
        light.firmware_draws_matrix = True  # clock / native effect, no sample yet
        self.assertIsNone(estimated(light))
        light._firmware_power_samples = [2.0, 3.0]  # simulated preview, averaged
        self.assertEqual(2.5, estimated(light))
        light._is_on = False
        self.assertEqual(lamp_power.BASE_W, estimated(light))
        light.available = False  # not reachable, most often unplugged
        self.assertEqual(0.0, estimated(light))

    def test_firmware_modes_average_the_simulated_preview(self):
        sample = _load_standalone_functions(
            LIGHT_SOURCE, {"_sample_firmware_power"},
            {"estimated_power": lamp_power.estimated_power, "callback": lambda f: f},
        )["_sample_firmware_power"]
        frames = iter([frame(50, WHITE), frame(0, WHITE), frame(50, RED)])
        camera = SimpleNamespace(hass=object(), simulated_firmware_frame=lambda: next(frames))
        state = ["Streamer"]
        light = SimpleNamespace(
            available=True, _is_on=True, firmware_draws_matrix=True, _brightness=255,
            _camera_entities=[camera], _firmware_power_samples=deque(maxlen=6),
            _firmware_power_key=None, _publish_power=Mock(),
            _firmware_power_state=lambda: tuple(state),
        )
        sample(light)
        sample(light)
        self.assertEqual(2, len(light._firmware_power_samples))
        self.assertAlmostEqual(
            (lamp_power.estimated_power(frame(50, WHITE)) + lamp_power.BASE_W) / 2,
            sum(light._firmware_power_samples) / 2,
        )
        state[0] = "Rainbow"  # another effect: a new average
        sample(light)
        self.assertEqual(
            [lamp_power.estimated_power(frame(50, RED))], list(light._firmware_power_samples)
        )
        light._publish_power.assert_called()
        light.firmware_draws_matrix = False  # back to frames sent: samples dropped
        sample(light)
        self.assertEqual(0, len(light._firmware_power_samples))

    def test_firmware_samples_use_the_native_mode_brightness(self):
        sample = _load_standalone_functions(
            LIGHT_SOURCE, {"_sample_firmware_power"},
            {"estimated_power": lamp_power.estimated_power, "callback": lambda f: f},
        )["_sample_firmware_power"]
        camera = SimpleNamespace(hass=object(), simulated_firmware_frame=lambda: frame(100, WHITE))
        light = SimpleNamespace(
            available=True, _is_on=True, firmware_draws_matrix=True, _brightness=128,
            _camera_entities=[camera], _firmware_power_samples=deque(maxlen=6),
            _firmware_power_key=None, _publish_power=Mock(), _firmware_power_state=lambda: (),
        )
        sample(light)
        self.assertAlmostEqual(
            lamp_power.estimated_power(frame(100, WHITE), 50), light._firmware_power_samples[0]
        )


if __name__ == "__main__":
    unittest.main()


class EnergyMeterTests(unittest.TestCase):
    def test_each_power_reading_holds_until_the_next(self):
        meter = lamp_power.EnergyMeter()
        meter.update(0, 6.0)            # 6 W for 30 minutes
        meter.update(1800, 0.4)         # then 0.4 W for 30 minutes
        total = meter.update(3600, 0.4)
        self.assertAlmostEqual(total, (6.0 * 0.5 + 0.4 * 0.5) / 1000, places=9)

    def test_unknown_power_adds_nothing_and_the_total_never_drops(self):
        meter = lamp_power.EnergyMeter(total_kwh=1.5)  # restored after a restart
        meter.update(0, None)           # firmware mode, no estimate yet
        self.assertEqual(meter.update(600, 3.0), 1.5)
        self.assertAlmostEqual(meter.update(1200, 3.0), 1.5 + 3.0 * 600 / 3_600_000)
        # A clock that did not advance (or went back) counts nothing.
        before = meter.total_kwh
        self.assertEqual(meter.update(1100, 3.0), before)
