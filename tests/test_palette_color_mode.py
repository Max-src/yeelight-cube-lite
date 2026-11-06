"""The Palette color mode: an effect, or the clock, takes the lamp's palette
(its text colors) instead of its own colors, and the six music effects run as
the microphone's music mode with the whole palette."""

import json
import shutil
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tests import test_live_effect as live
from tests.test_matter_link import FakeLight
from tests.test_native_features import CONSTANTS, LAMP_RENDERERS, NATIVE_PREVIEW, ROOT

palette_words = LAMP_RENDERERS["palette_words"]
music_palette = LAMP_RENDERERS["music_palette"]
lamp_settings = LAMP_RENDERERS["lamp_settings"]
supports = NATIVE_PREVIEW["effect_supports_color_mode"]
EFFECTS = CONSTANTS["ALL_NATIVE_EFFECTS"]
RED, GREEN, BLUE = (255, 0, 0), (0, 255, 0), (0, 0, 255)
# The asyncio the activation code runs with (its sleeps).
ASYNCIO = live.FNS["_send_palette_music"].__globals__["asyncio"]


class PaletteRuleTests(unittest.TestCase):
    def test_every_effect_that_takes_a_color_takes_the_palette(self):
        offered = {name for name in EFFECTS if supports(name, "palette")}
        self.assertEqual(
            offered,
            {name for name in EFFECTS if NATIVE_PREVIEW["effect_supports_color_override"](name)},
        )
        self.assertIn("Rainbow", offered)
        # Hacking draws its own green: not offered, like a custom color.
        self.assertNotIn("Hacking", offered)

    def test_an_effect_gets_as_many_colors_as_it_draws(self):
        self.assertEqual(palette_words("Starry Sky", [RED, GREEN]), [0xFF0000])
        # Four bands: the palette repeated, never a black band.
        self.assertEqual(
            palette_words("Rotating colour bands", [RED, GREEN]),
            [0xFF0000, 0x00FF00, 0xFF0000, 0x00FF00],
        )
        self.assertEqual(palette_words("Two-colour alternation", [RED, GREEN, BLUE]), [0xFF0000, 0x00FF00])
        self.assertEqual(palette_words("Starry Sky", []), [])

    def test_a_music_palette_has_16_entries_in_the_palette_order(self):
        spread = music_palette([RED, GREEN, BLUE])
        self.assertEqual(len(spread), 16)
        self.assertEqual(spread[:6], [RED] * 6)
        self.assertEqual(spread[-5:], [BLUE] * 5)
        self.assertEqual(music_palette([RED] * 16), [RED] * 16)
        # A longer palette never exceeds the lamp's 16 entries.
        self.assertEqual(len(music_palette([RED, GREEN] * 15)), 16)
        self.assertEqual(music_palette(None), [])

    def test_previews_draw_the_palette(self):
        settings = lamp_settings("Starry Sky", "Up", 128, None, "palette", None, None, [GREEN, BLUE])
        self.assertEqual(settings["primary"], list(GREEN))
        # Without a palette, the effect's own colors.
        self.assertEqual(
            lamp_settings("Starry Sky", "Up", 128, None, "palette", None, None, []),
            lamp_settings("Starry Sky", "Up", 128),
        )
        music = lamp_settings("Music Spectrum", "Up", 128, None, "palette", None, None, [RED, BLUE])
        self.assertEqual(music["palette"], [list(RED)] * 8 + [list(BLUE)] * 8)
        self.assertNotIn("palette", lamp_settings("Music Spectrum", "Up", 128, None, "normal"))
        # The frames follow the palette.
        frame = LAMP_RENDERERS["lamp_effect_frame"]
        self.assertNotEqual(
            frame(music, 3.0),
            frame(lamp_settings("Music Spectrum", "Up", 128, None, "palette", None, None, [GREEN]), 3.0),
        )


class MatterChannel:
    """matter_commands: records its commands; ``refuse`` makes them fail."""

    def __init__(self, available=True, refuse=False):
        self.available = available
        self.refuse = refuse
        self.sent = []

    async def async_available(self):
        return self.available

    async def async_command(self, cluster, name, payload):
        self.sent.append((cluster, name, payload))
        if self.refuse:
            raise RuntimeError("refused")


class PaletteActivationTests(unittest.IsolatedAsyncioTestCase):
    setUp = live.ActivationTests.setUp

    def palette(self, effect, colours=(RED, GREEN)):
        self.lamp._mode = CONSTANTS["MODE_NATIVE_EFFECT"]
        self.lamp._native_effect = effect
        self.lamp._native_effect_color_mode = "palette"
        self.lamp._text_colors = list(colours)

    async def test_an_effect_is_sent_the_palette(self):
        self.palette("Rotating colour bands")
        await self.lamp._activate_native_effect()
        (command, params), = [sent for sent in self.sent if sent[0] == "set_fx_effect"]
        self.assertEqual(params[0], EFFECTS["Rotating colour bands"]["effect_id"])
        self.assertEqual(
            params[3]["color"],
            [0x01FF0000, 0x0100FF00, 0x01FF0000, 0x0100FF00],
        )

    async def test_without_a_palette_the_effect_keeps_its_colors(self):
        self.palette("Starry Sky", ())
        await self.lamp._activate_native_effect()
        (_, params), = [sent for sent in self.sent if sent[0] == "set_fx_effect"]
        self.assertEqual(params[3]["color"], [EFFECTS["Starry Sky"]["color"]])

    def music_lamp(self, channel=None):
        """The lamp's music command (set_ps) recorded in ``self.music``, its
        Matter commands in ``channel``, its waits in ``self.waits``."""
        self.music = []
        self.waits = []

        async def send_with_recovery(command, params):
            self.music.append((command, params))
            self.sent.append((command, params))
            return "ok"

        cube = self.lamp._cube_matrix
        cube.send_command_with_recovery = send_with_recovery
        cube.close_command_socket = Mock()
        cube.forget_running_effect = Mock()
        self.lamp.matter_commands = channel
        for name in ("_send_music_direction", "_music_direction_due"):
            setattr(self.lamp, name, live.FNS[name].__get__(self.lamp))

    async def sleep(self, seconds):
        self.waits.append((seconds, len(self.music)))

    async def test_a_music_effect_runs_as_the_music_mode_with_16_colors(self):
        channel = MatterChannel()
        self.music_lamp(channel)
        self.palette("Music Spectrum", (RED, BLUE))
        self.lamp._native_effect_direction = "Left"
        with patch.object(ASYNCIO, "sleep", self.sleep):
            await self.lamp._activate_native_effect()
        # The microphone needs the fx-mode flag clear first; nothing else
        # goes over LAN: update_fx_effect stops the microphone.
        self.assertEqual(["deactivate_fx_mode", "set_ps"], [command for command, _ in self.sent])
        (command, (key, payload)), = self.music
        self.assertEqual((command, key), ("set_ps", "mic_music_mode"))
        payload = json.loads(payload)
        self.assertEqual(payload["on"], 1)
        self.assertEqual(payload["effect_id"], CONSTANTS["MUSIC_FLOW_EFFECTS"]["Spectrum"])
        self.assertEqual(payload["palatte"], [0xFFFF0000] * 8 + [0xFF0000FF] * 8)
        # The music mode takes no direction: the chosen one follows over
        # Matter, once it runs (sent at once, some modes stop).
        (cluster, name, direction), = channel.sent
        self.assertEqual((cluster, name), (live.FNS["_send_music_direction"].__globals__["EFFECTS_CLUSTER"], "setDirection"))
        delay = CONSTANTS["PALETTE_MUSIC_DIRECTION_DELAY"]
        self.assertGreaterEqual(delay, 1.0)
        self.assertIn((delay, 1), self.waits)
        self.lamp._cube_matrix.forget_running_effect.assert_called_once()
        self.assertTrue(self.lamp._in_native_fw_mode)
        # In its normal color mode it is a native effect as before.
        self.sent.clear()
        self.music.clear()
        self.lamp._native_effect_color_mode = "normal"
        await self.lamp._activate_native_effect()
        self.assertEqual(self.music, [])
        (_, params), = [sent for sent in self.sent if sent[0] == "set_fx_effect"]
        # The same direction as the effect run from a favourite.
        self.assertEqual(direction, {"direction": params[3]["direction"]})

    async def test_without_matter_the_music_runs_in_the_lamp_s_direction(self):
        for channel in (None, MatterChannel(available=False)):
            self.sent.clear()
            self.music_lamp(channel)
            self.palette("Music Gather")
            with patch.object(ASYNCIO, "sleep", self.sleep):
                await self.lamp._activate_native_effect()
            self.assertEqual(len(self.music), 1)
            self.assertNotIn("update_fx_effect", [command for command, _ in self.sent])
            # Not waited for either.
            self.assertNotIn(CONSTANTS["PALETTE_MUSIC_DIRECTION_DELAY"], [w for w, _ in self.waits])
            self.assertTrue(self.lamp._in_native_fw_mode)
            if channel is not None:
                self.assertEqual(channel.sent, [])

    async def test_a_refused_music_direction_leaves_the_music_running(self):
        channel = MatterChannel(refuse=True)
        self.music_lamp(channel)
        with patch.object(ASYNCIO, "sleep", self.sleep):
            self.palette("Music Gather")
            self.lamp._native_effect_direction = "Left"
            await self.lamp._activate_native_effect()
            self.assertTrue(self.lamp._in_native_fw_mode)
            self.assertEqual(len(channel.sent), 1)
            # Breathing offers no direction: none is sent, nor waited for.
            channel.sent.clear()
            self.waits.clear()
            self.palette("Music Breathing")
            await self.lamp._activate_native_effect()
        self.assertEqual(channel.sent, [])
        self.assertEqual(self.waits, [])

    async def test_the_direction_a_music_mode_starts_in_is_not_sent(self):
        channel = MatterChannel()
        self.music_lamp(channel)
        self.palette("Music Gather")
        sent = live.FNS["effect_direction_sent"]
        spec = EFFECTS["Music Gather"]
        start = CONSTANTS["MUSIC_MODE_START_DIRECTION"]
        for name in spec["directions"]:
            self.lamp._native_effect_direction = name
            if sent(self.lamp, spec) == start:
                break
        else:
            self.fail("no direction the music mode starts in")
        with patch.object(ASYNCIO, "sleep", self.sleep):
            await self.lamp._activate_native_effect()
        # Nothing to turn: nothing sent nor waited for.
        self.assertEqual(["deactivate_fx_mode", "set_ps"], [command for command, _ in self.sent])
        self.assertEqual(channel.sent, [])
        self.assertEqual(self.waits, [])

    async def test_the_direction_follows_the_microphone_on_report(self):
        channel = MatterChannel()
        self.music_lamp(channel)
        self.palette("Music Impact")
        self.lamp._native_effect_direction = "Left"
        steps = []
        self.lamp._expect_lamp_music_on = lambda: steps.append(("expect", len(self.music)))

        async def await_music_on(timeout):
            steps.append(("await", timeout, len(self.music)))
            return True

        self.lamp._await_lamp_music_on = await_music_on
        with patch.object(ASYNCIO, "sleep", self.sleep):
            await self.lamp._activate_native_effect()
        # Expected before set_ps (the report can come at once), waited for
        # after it, at most the delay; then the direction, without a sleep.
        delay = CONSTANTS["PALETTE_MUSIC_DIRECTION_DELAY"]
        self.assertEqual([("expect", 0), ("await", delay, 1)], steps)
        self.assertEqual(len(channel.sent), 1)
        self.assertNotIn(delay, [w for w, _ in self.waits])

    def test_music_flow_keeps_the_app_palette(self):
        build = live.FNS["_build_music_flow_payload"]
        self.assertEqual(
            json.loads(build(True, "Gather"))["palatte"],
            list(CONSTANTS["MUSIC_FLOW_DEFAULT_PALETTE"]),
        )
        self.assertEqual(json.loads(build(False, "Gather")), {"on": 0})

    def test_the_music_mode_takes_no_speed_or_intensity(self):
        reads = live.FNS.get("shown_effect_reads")
        if reads is None:
            from tests.test_control_entities import NATIVE_HELPERS
            reads = NATIVE_HELPERS["shown_effect_reads"]
        light = SimpleNamespace(
            _mode=CONSTANTS["MODE_NATIVE_EFFECT"], _native_effect="Music Spectrum",
            _native_effect_color_mode="palette", _text_colors=[RED],
        )
        self.assertFalse(reads(light, "speed"))
        self.assertFalse(reads(light, "intensity"))
        light._native_effect_color_mode = "normal"
        self.assertTrue(reads(light, "speed"))


class ClockPaletteTests(unittest.IsolatedAsyncioTestCase):
    setUp = live.ActivationTests.setUp

    def clock(self, style, mode="palette", colours=(GREEN, BLUE)):
        self.lamp._native_clock_style = style
        self.lamp._native_clock_color = None
        self.lamp._native_clock_color_mode = mode
        self.lamp._text_colors = list(colours)
        return self.lamp._native_clock_params()

    async def test_a_plain_style_takes_the_first_color(self):
        params = self.clock(4)  # White
        self.assertEqual([0x0100FF00], params[3]["color"])
        self.assertEqual(self.clock(4, "normal")[0], params[0])

    async def test_a_background_takes_as_many_colors_as_it_draws(self):
        params = self.clock(23)  # Rotating colour bands: four
        self.assertEqual([0x0100FF00, 0x010000FF] * 2, params[3]["color"])
        self.assertEqual(self.clock(23, "normal")[0], params[0])
        self.assertEqual([0x0100FF00], self.clock(2)[3]["color"])  # Waves

    async def test_otherwise_the_clock_runs_as_in_the_normal_mode(self):
        # A background that takes no color, or no palette.
        self.assertEqual(self.clock(11, "normal"), self.clock(11))
        self.assertEqual(self.clock(2, "normal"), self.clock(2, colours=()))

    def test_the_previews_draw_it(self):
        clock_settings = LAMP_RENDERERS["lamp_clock_settings"]
        words = LAMP_RENDERERS["clock_palette_words"]
        palette = [GREEN, BLUE]
        self.assertEqual([0x00FF00], words(None, palette))
        self.assertEqual([], words("Rainbow noise", palette))
        settings = clock_settings("Rotating colour bands", 128, None, "palette", None, palette)
        self.assertEqual([[0, 255, 0], [0, 0, 255]] * 2, settings["colours"])
        self.assertEqual(
            clock_settings("Rainbow noise", 128, None, "normal"),
            clock_settings("Rainbow noise", 128, None, "palette", None, palette),
        )

    def test_the_clock_validates_and_restores_the_mode(self):
        self.assertIn("palette", CONSTANTS["NATIVE_COLOR_MODES"])
        services = (ROOT / "light_services_native.py").read_text(encoding="utf-8")
        self.assertNotIn("vol.In(list(CLOCK_COLOR_MODES))", services)
        restore = (ROOT / "light_restore.py").read_text(encoding="utf-8")
        self.assertIn('"_native_clock_color_mode", _member_of(NATIVE_COLOR_MODES)', restore)


class PaletteMatterTests(unittest.TestCase):
    def test_the_music_mode_report_is_this_lamp_s_own(self):
        light = FakeLight()
        light._mode = CONSTANTS["MODE_NATIVE_EFFECT"]
        light._native_effect = "Music Spectrum"
        light._palette_music = lambda: "Spectrum"
        self.assertEqual(light._expected_effect(), CONSTANTS["MUSIC_FLOW_EFFECTS"]["Spectrum"])
        light._palette_music = lambda: None
        self.assertNotEqual(light._expected_effect(), CONSTANTS["MUSIC_FLOW_EFFECTS"]["Spectrum"])


if __name__ == "__main__":
    unittest.main()


class PaletteParityTests(unittest.TestCase):
    """The cards (JS) and the camera (Python) draw the same palette frames."""

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_previews_are_the_same(self):
        preview_js = (ROOT / "www" / "native-effect-preview.js").as_uri()
        renderers_js = (ROOT / "www" / "lamp-renderers.js").as_uri()
        palette = [list(RED), list(GREEN), list(BLUE)]
        cases = [
            [name, phase]
            for name in ("Starry Sky", "Rotating colour bands", "Random scatter", "Music Spectrum", "Music Breathing", "Rainbow")
            for phase in (0.7, 4.2)
        ]
        script = (
            f"const p = await import({json.dumps(preview_js)});"
            f"const r = await import({json.dumps(renderers_js)});"
            f"const palette = {json.dumps(palette)};"
            f"process.stdout.write(JSON.stringify({{"
            f"frames: {json.dumps(cases)}.map(([name, phase]) =>"
            " p.renderNativeEffect(name, phase, 'Up', null, 'palette', 128, null, null, palette)),"
            " words: r.paletteWords('Rotating colour bands', palette),"
            " music: r.musicPalette(palette),"
            " offered: Object.keys(r.LAMP_EFFECTS).filter((n) => r.effectSupportsColorMode(n, 'palette')).sort(),"
            " clock: ['Rotating colour bands', 'Waves', 'Rainbow noise', 'Two-colour alternation'].map((name) =>"
            "   r.lampClockSettings(name, 128, null, 'palette', null, palette)),"
            " plain: r.clockPaletteWords(null, palette),"
            "}));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        render = NATIVE_PREVIEW["render_native_effect"]
        self.assertEqual(
            [
                [list(pixel) for pixel in render(name, phase, "Up", None, "palette", 128, None, None, palette)]
                for name, phase in cases
            ],
            out["frames"],
        )
        self.assertEqual(palette_words("Rotating colour bands", palette), out["words"])
        self.assertEqual([list(colour) for colour in music_palette(palette)], out["music"])
        self.assertEqual(
            sorted(name for name in out["offered"] if supports(name, "palette")),
            out["offered"],
        )
        clock_settings = LAMP_RENDERERS["lamp_clock_settings"]
        self.assertEqual(
            [
                clock_settings(name, 128, None, "palette", None, palette)
                for name in ("Rotating colour bands", "Waves", "Rainbow noise", "Two-colour alternation")
            ],
            out["clock"],
        )
        self.assertEqual(LAMP_RENDERERS["clock_palette_words"](None, palette), out["plain"])
