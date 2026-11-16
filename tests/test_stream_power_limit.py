"""The Power limit on streamed frames: every frame light_studio sends (the
integration's own effects, Palette mode's effects and clocks, a Cube
Matrix's stream over the LAN or Matter, the standby's black) stays under it."""

import base64
import unittest

import fakes
from fakes import FakeCube, FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
CONST = module("const")
POWER = module("lamp_power")
PROFILE = module("device_profile")
STUDIO = module("lamp_studio")

LIMIT = 1.5
# Ten bright colours: more than the Cube Lite takes, so Palette mode streams.
PALETTE = [
    (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255),
    (255, 0, 255), (255, 255, 255), (255, 128, 0), (128, 0, 255), (0, 128, 255),
]


def bright_light(mode, profile=None, **settings):
    light = make_light(hass=FakeHass(), entry=FakeEntry(), cube=FakeCube(profile) if profile else None)
    light._is_on = True
    light._brightness = 255
    light._last_hardware_brightness = 100
    for name, value in settings.items():
        setattr(light, name, value)
    light._enter_mode(mode)
    return light


def pixels(payload):
    raw = base64.b64decode(payload)
    return [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]


async def peak_watts(light, frame_at, limit):
    light._power_limit = limit
    return max([POWER.estimated_power(await frame_at(light, render)) for render in range(0, 300, 7)])


async def lan_frame(light, render):
    return pixels(await light._studio_payload(render))


async def matter_frame(light, render):
    return [tuple(p) for p in await light._matrix_stream_pixels(render)]


class StreamPowerLimitTests(unittest.TestCase):
    def assert_limited(self, light, frame_at=lan_frame):
        async def scenario():
            unlimited = await peak_watts(light, frame_at, POWER.NO_LIMIT_W)
            self.assertGreater(unlimited, LIMIT)  # the case is a real one
            self.assertLessEqual(await peak_watts(light, frame_at, LIMIT), LIMIT)

        run(scenario())

    def test_the_integrations_own_effects(self):
        for effect in ("Knight Rider", "Lava Lamp"):
            with self.subTest(effect):
                self.assert_limited(bright_light("Native Effect", _native_effect=effect))

    def test_an_effect_streamed_in_the_palette(self):
        for effect in ("Rainbow", "Fire"):
            with self.subTest(effect):
                self.assertTrue(STUDIO.studio_runs(effect, STUDIO.PALETTE_COLOR_MODE, PALETTE))
                self.assert_limited(bright_light(
                    "Native Effect", _native_effect=effect,
                    _native_effect_color_mode=STUDIO.PALETTE_COLOR_MODE, _text_colors=PALETTE,
                ))

    def test_a_clock_streamed_in_the_palette(self):
        light = bright_light(
            CONST.MODE_CLOCK, _native_clock_style=11,
            _native_clock_color_mode=STUDIO.PALETTE_COLOR_MODE, _text_colors=PALETTE,
        )
        self.assertTrue(light.studio_selected())
        self.assert_limited(light)

    def test_a_cube_matrix_over_the_lan_and_over_matter(self):
        matrix = PROFILE.profile_for("CubeMatrix")
        self.assert_limited(bright_light("Native Effect", matrix, _native_effect="Lava Lamp"))
        self.assert_limited(bright_light("Native Effect", matrix, _native_effect="Lava Lamp"), matter_frame)

    def test_the_standby_frame_is_black(self):
        light = bright_light("Native Effect", _native_effect="Lava Lamp", _power_limit=LIMIT)
        self.assertEqual({(0, 0, 0)}, set(pixels(light._standby_payload())))


if __name__ == "__main__":
    unittest.main()
