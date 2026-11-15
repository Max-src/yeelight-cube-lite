"""Every frame a lamp can be streamed draws.

A stream whose frame cannot be drawn stops sending new frames: the lamp is
kept busy meanwhile (LampClient.stream_running) and the stream tries again
(light_studio), but it shows a frozen picture. So every effect and clock
style that can be streamed (an effect a Cube Lite does not have, a color mode
or palette it cannot take, the integration's own effects, any effect on a
Cube Matrix without its own) is drawn here the way the stream draws it
(light_studio._own_effect_frame_drawn, studio_clock_frame), in every color
mode it offers, with palettes of 1, 3 and 32 colors, both ways round and on
two mounts. The lists come from the registries: an effect or style added
later is covered without touching this file.
"""
import unittest
from datetime import datetime

from fakes import make_light, module, slow

CONST = module("const")
CATALOG = module("effect_catalog")
RENDERERS = module("lamp_renderers")
STUDIO = module("lamp_studio")
OFFERS = module("native_effect_preview").effect_offers_color_mode
studio_clock_frame = module("light_studio").studio_clock_frame
PALETTES = {
    "one": [[0, 180, 255]],
    "three": [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
    "most": [[(index * 37) % 256, (index * 91) % 256, (index * 53) % 256] for index in range(32)],
}
RENDERS = (0, 1, 12)
MOUNTS = ("right", "up")


LIGHT = make_light(_mode=CONST.MODE_NATIVE_EFFECT, _native_effect_speed=128,
                   _native_effect_intensity=128, _studio_seed=7)


def lamp(effect, direction, mode, palette, mount, colour=None):
    """The light (the real one, its own methods), set to stream this."""
    LIGHT.__dict__.update(
        _native_effect=effect, _native_effect_direction=direction, _native_effect_color_mode=mode,
        _native_effect_color=colour, _text_colors=palette, _device_orientation=mount,
    )
    return LIGHT


def check_frame(test, frame, label):
    test.assertEqual(100, len(frame), label)
    for pixel in frame:
        test.assertEqual(3, len(pixel), label)
        test.assertTrue(all(isinstance(value, int) and 0 <= value <= 255 for value in pixel), label)


class EveryStreamedFrameDrawsTests(unittest.TestCase):
    @slow
    def test_every_effect_in_every_color_mode(self):
        effects = sorted(RENDERERS.LAMP_RENDERED_EFFECTS)
        self.assertGreater(len(effects), 70)
        self.assertIn("Lava Lamp", effects)
        drawn = 0
        for effect in effects:
            spec = CATALOG.ALL_NATIVE_EFFECTS[effect]
            directions = list(spec.get("directions") or ["Right"])
            cases = [("normal", None, None), ("normal", None, (180, 20, 60))]
            cases += [(mode, None, None) for mode in CATALOG.NATIVE_COLOR_MODES
                      if mode not in ("normal", "palette") and OFFERS(effect, mode)]
            cases += [("palette", palette, None) for palette in PALETTES.values()]
            for mode, palette, colour in cases:
                for direction in {directions[0], directions[-1]}:
                    for mount in MOUNTS:
                        light = lamp(effect, direction, mode, palette, mount, colour)
                        for render in RENDERS:
                            label = f"{effect} {mode} {len(palette or ())} {direction} {mount} {render}"
                            with self.subTest(label):
                                check_frame(self, light._own_effect_frame_raw(render), label)
                                drawn += 1
        self.assertGreater(drawn, 5000)

    def test_every_clock_style_in_every_color_mode(self):
        # A clock style's background, streamed through its digits (the
        # palette color mode, or one a Cube Lite does not have).
        styles = CATALOG.NATIVE_CLOCK_STYLES
        drawn = 0
        for style_id, style in sorted(styles.items()):
            effect = CATALOG.clock_style_effect(style)
            direct = CATALOG.clock_style_direct(style)
            flags = RENDERERS.clock_digit_flags(style.get("mixer", 0), direct)
            streamed = effect is not None and CATALOG.ALL_NATIVE_EFFECTS[effect].get("streamed")
            for palette in (None, *PALETTES.values()):
                runs = palette is None and effect in CATALOG.LITE_STREAMED_EFFECTS
                if palette is not None:
                    runs = STUDIO.clock_studio_runs(effect, "palette", palette)
                if not runs:
                    continue
                colours = ((0, 200, 255), "palette" if palette else "normal", palette or []) if streamed else None
                for render in RENDERS:
                    label = f"style {style_id} {style['name']} {len(palette or ())} {render}"
                    with self.subTest(label):
                        frame = studio_clock_frame(
                            effect, render, 128, 128, palette or [], direct,
                            datetime(2026, 11, 14, 21, 47, 5), "time", False, True, flags, False,
                            colours, 7,
                        )
                        check_frame(self, frame, label)
                        drawn += 1
        self.assertGreater(drawn, 100)


if __name__ == "__main__":
    unittest.main()
