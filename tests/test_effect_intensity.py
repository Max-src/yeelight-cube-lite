"""The intensity shared by the effects (const.py LAMP_INTENSITY_SLOTS): which
effects take it, the limits it is sent within, and that the list stays what
the renderers draw. Sending it: tests/test_live_effect.py."""
import unittest
from types import SimpleNamespace

from tests.test_control_entities import NATIVE_HELPERS, NUMBER, make_light
from tests.test_lamp_effects import CONST, LAMP

ALL = CONST["ALL_NATIVE_EFFECTS"]
SLOTS = CONST["LAMP_INTENSITY_SLOTS"]
# They read it as a switch, not an amount (below 128 another colour source):
# no slider for them.
SWITCH_SLOTS = {1, 3}


def frames(name, intensity):
    """Some renders of ``name`` at ``intensity``, as the lamp draws them."""
    settings = dict(LAMP["lamp_settings"](name, "Right", 128), intensity=intensity)
    timeline = LAMP["Timeline"](LAMP["REGISTRY"][settings["mode"]], settings)
    return b"".join(timeline.frame_at(render) for render in range(0, 300, 7))


class IntensitySlotsTests(unittest.TestCase):
    def test_every_effect_flag_is_the_slot_list(self):
        for name, spec in ALL.items():
            self.assertEqual(spec["mode"] in SLOTS, bool(spec.get("intensity")), name)

    def test_the_list_is_what_the_renderers_draw(self):
        # An effect in the list draws differently at another intensity; any
        # other draws the same, but the two that read it as a switch.
        for name, spec in ALL.items():
            if spec["mode"] not in LAMP["REGISTRY"] or spec["mode"] in SWITCH_SLOTS:
                continue
            with self.subTest(effect=name):
                differs = frames(name, 32) != frames(name, 224)
                self.assertEqual(spec["mode"] in SLOTS, differs)

    def test_it_is_sent_within_the_lamps_limits(self):
        intensity = CONST["lamp_intensity"]
        self.assertEqual(13, intensity(15, 1))  # Aurora hangs the lamp below
        self.assertEqual(200, intensity(15, 200))
        self.assertEqual(1, intensity(70, 0))  # Palette stripes restarts at 0
        self.assertEqual(0, intensity(42, 0))
        self.assertEqual(0, intensity(42, -3))
        self.assertEqual(255, intensity(42, 300))
        self.assertEqual(13, LAMP["lamp_settings"]("Aurora", "Right", 50, intensity=1)["intensity"])

    def test_an_effect_that_does_not_read_it_keeps_its_row(self):
        settings = LAMP["lamp_settings"]
        self.assertEqual(settings("Rainbow", "Up", 50), settings("Rainbow", "Up", 50, intensity=9))
        self.assertEqual(9, settings("Waves", "Up", 50, intensity=9)["intensity"])
        clock = LAMP["lamp_clock_settings"]
        self.assertEqual(clock("Rainbow", 50), clock("Rainbow", 50, intensity=9))
        self.assertEqual(9, clock("Waves", 50, intensity=9)["intensity"])


class ZeroTests(unittest.TestCase):
    """Speed 0 and intensity 0: every effect takes them (sent within the
    slot's limits) and draws without failing."""

    def test_every_effect_draws_at_speed_and_intensity_0(self):
        for name, spec in ALL.items():
            if spec["mode"] not in LAMP["REGISTRY"]:
                continue
            with self.subTest(effect=name):
                settings = LAMP["lamp_settings"](name, "Right", 0, intensity=0)
                if spec.get("speed"):  # the others keep their preset's
                    self.assertEqual(0, settings["rate"])
                if spec.get("intensity"):
                    self.assertEqual(
                        CONST["LAMP_INTENSITY_MINIMUMS"].get(spec["mode"], 0),
                        settings["intensity"],
                    )
                timeline = LAMP["Timeline"](LAMP["REGISTRY"][settings["mode"]], settings)
                for render in range(0, 120, 7):
                    timeline.frame_at(render)

    def test_the_speed_entity_and_services_take_0(self):
        self.assertEqual((0, 255), CONST["SPEED_RANGE"])
        self.assertEqual((0, 255), CONST["INTENSITY_RANGE"])


class AppliesTests(unittest.TestCase):
    """light_native.shown_effect_reads: what the sliders follow."""

    applies = staticmethod(NATIVE_HELPERS["shown_effect_reads"])

    def lamp(self, **state):
        return SimpleNamespace(**{
            "_mode": "Native Effect", "_native_effect": "Waves", "_native_clock_style": 1,
            **state,
        })

    def test_an_effect(self):
        self.assertTrue(self.applies(self.lamp(), "intensity"))
        self.assertFalse(self.applies(self.lamp(_native_effect="Rainbow"), "intensity"))
        self.assertFalse(self.applies(self.lamp(_native_effect="Spectrum"), "speed"))

    def test_the_clock_follows_its_background(self):
        waves, rainbow, white = (self.lamp(_mode="Clock", _native_clock_style=s) for s in (2, 1, 4))
        self.assertTrue(self.applies(waves, "intensity"))
        self.assertFalse(self.applies(rainbow, "intensity"))
        self.assertTrue(self.applies(rainbow, "speed"))
        self.assertFalse(self.applies(white, "speed"))
        self.assertFalse(self.applies(white, "intensity"))

    def test_another_mode_follows_the_selected_effect(self):
        self.assertTrue(self.applies(self.lamp(_mode="Solid Color"), "intensity"))


class IntensityNumberTests(unittest.TestCase):
    def test_it_is_available_only_for_an_effect_that_reads_it(self):
        light = make_light(_native_effect_intensity=128, available=True)
        light._native_effect = "Waves"
        light.effect_setting_applies = lambda setting: NATIVE_HELPERS["shown_effect_reads"](
            light, setting
        )
        number = NUMBER["YeelightCubeNativeEffectIntensityNumber"](light, None)
        self.assertEqual(
            (0.0, 255.0), (number._attr_native_min_value, number._attr_native_max_value)
        )
        self.assertEqual(128.0, number.native_value)
        light._mode = "Native Effect"
        self.assertTrue(number.available)
        light._native_effect = "Rainbow"
        self.assertFalse(number.available)


if __name__ == "__main__":
    unittest.main()
