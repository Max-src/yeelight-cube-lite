"""The animations a lamp stores as its GIF (lamp_animations.py): their frames,
the GIF the lamp is sent, laid out its way, the upload over Matter and what
it may never do (an end marker after a refusal, more uploads than needed)."""

import base64
import importlib.util
import io
import json
import shutil
import subprocess
import unittest
from types import SimpleNamespace

from tests import test_live_effect as live
from tests.test_matter_link import MATTER, FakeLight
from tests.test_native_features import CONSTANTS, ROOT, TranslatedError, _load_standalone_functions

import runpy

ANIMATIONS = runpy.run_path(str(ROOT / "lamp_animations.py"))
ADJUSTMENTS = runpy.run_path(str(ROOT / "color_adjustments.py"))
EFFECTS = CONSTANTS["LAMP_ANIMATION_EFFECTS"]
TOOL = ROOT.parents[1] / "tools" / "generate_lamp_animations.py"

try:
    from PIL import Image, ImageSequence
except ImportError:  # pragma: no cover
    Image = None


class AnimationDataTests(unittest.TestCase):
    def test_the_effects_are_the_animations(self):
        self.assertEqual(
            {name: spec["animation"] for name, spec in EFFECTS.items()},
            {name: key for key, name in ANIMATIONS["animation_names"]().items()},
        )
        for spec in EFFECTS.values():
            self.assertEqual(spec["mode"], CONSTANTS["LAMP_STORED_GIF_SLOT"])
            # The speed is in the GIF (its delays): the speed slider applies.
            self.assertTrue(spec.get("speed"))
            self.assertFalse(spec.get("intensity") or spec.get("directions"))

    def test_each_stands_for_one_of_the_app_s_gif_tiles(self):
        # Winter, Dream, Halloween, Moonlight (light_matter.APP_GIF_TILES).
        self.assertEqual(
            {"Snowfall": 77, "Daydream": 79, "Halloween glow": 72, "Moonlit clouds": 93},
            {name: spec["app_tile"] for name, spec in EFFECTS.items()},
        )
        self.assertEqual(
            {spec["app_tile"] for spec in EFFECTS.values()},
            set(MATTER.APP_GIF_TILES),
        )

    def test_each_is_48_frames_of_the_panel_in_one_colour_table(self):
        data = ANIMATIONS["_animations"]()
        for key, entry in data.items():
            self.assertEqual(48, len(entry["frames"]), key)
            self.assertTrue(all(len(frame) == 100 for frame in entry["frames"]), key)
            self.assertLessEqual(len({pixel for frame in entry["frames"] for pixel in frame}), 256, key)
            self.assertEqual(6000, sum(entry["delays"]), key)
            # Not all dark: each shows something.
            self.assertTrue(any(max(pixel) > 128 for frame in entry["frames"] for pixel in frame), key)

    @unittest.skipIf(Image is None, "Pillow makes the shared colour table")
    def test_the_file_is_what_the_tool_draws(self):
        spec = importlib.util.spec_from_file_location("generate_lamp_animations", TOOL)
        tool = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        written = ANIMATIONS["DATA_FILE"].read_text(encoding="utf-8").replace("\r\n", "\n")
        self.assertEqual(tool.render(), written)

    def test_a_preview_frame_is_in_lamp_order(self):
        frame = ANIMATIONS["animation_frame_at"]("snowfall", 0.0)
        lamp = ANIMATIONS["animation_frame"]("snowfall", 0.0)
        # Top-first row 0 is the lamp's top row (lamp order row 4).
        self.assertEqual(list(frame[:20]), lamp[80:100])
        self.assertEqual(list(frame[80:100]), lamp[0:20])
        # Upside down: turned a half turn, as matrix_view shows it back.
        self.assertEqual(list(frame[::-1][:20]), ANIMATIONS["animation_frame"]("snowfall", 0.0, "up")[80:])
        # Frames follow the delays: the second starts after 130 ms.
        entry = ANIMATIONS["_animations"]()["snowfall"]
        self.assertIs(entry["frames"][1], ANIMATIONS["animation_frame_at"]("snowfall", 0.131))
        self.assertIs(entry["frames"][0], ANIMATIONS["animation_frame_at"]("snowfall", 6.0))


@unittest.skipIf(Image is None, "Pillow decodes the GIF")
class GifTests(unittest.TestCase):
    def decode(self, data):
        image = Image.open(io.BytesIO(data))
        frames = [list(frame.convert("RGB").getdata()) for frame in ImageSequence.Iterator(image)]
        return image, frames

    def test_the_lamp_shows_the_frames_as_drawn(self):
        for key in ANIMATIONS["animation_names"]():
            data = ANIMATIONS["lamp_gif"](key)
            self.assertLessEqual(len(data), 32768, key)  # the lamp's GIF area
            image, frames = self.decode(data)
            self.assertEqual((20, 5), image.size)
            self.assertEqual(0, image.info.get("loop"))
            # A 256-colour global table (the lamp shows a 4-colour one as red).
            self.assertEqual(0xF7, data[10])
            entry = ANIMATIONS["_animations"]()[key]
            self.assertEqual(48, len(frames))
            for drawn, sent in zip(entry["frames"], frames):
                # The lamp shows file pixel n at column n // 5, row n % 5
                # from the top.
                for index, pixel in enumerate(sent):
                    column, row = divmod(index, 5)
                    self.assertEqual(drawn[row * 20 + column], pixel, (key, index))

    def test_the_app_s_layout_sends_the_picture_as_it_is(self):
        app = CONSTANTS["ANIMATION_LAYOUT_APP"]
        entry = ANIMATIONS["_animations"]()["snowfall"]
        for mount in ("right", "up"):
            _, frames = self.decode(ANIMATIONS["lamp_gif"]("snowfall", mount, app))
            # As the Yeelight app sends its GIFs: the 20 x 5 picture, row
            # after row, whatever the mount.
            self.assertEqual([list(frame) for frame in entry["frames"]], frames)
        # What the lamp shows of it (file pixel n at column n // 5, row n % 5
        # from the top) is what the previews draw.
        shown = ANIMATIONS["animation_frame"]("snowfall", 0.0, "up", app)
        self.assertEqual(list(entry["frames"][0]), ANIMATIONS["gif_order"](shown))
        self.assertNotEqual(shown, ANIMATIONS["animation_frame"]("snowfall", 0.0, "right"))

    def test_an_upside_down_lamp_is_sent_it_turned(self):
        drawn = ANIMATIONS["_animations"]()["daydream"]["frames"][5]
        _, frames = self.decode(ANIMATIONS["lamp_gif"]("daydream", "left"))
        turned = drawn[::-1]
        for index, pixel in enumerate(frames[5]):
            column, row = divmod(index, 5)
            self.assertEqual(turned[row * 20 + column], pixel)

    def test_no_upload_block_ends_in_the_padding_byte(self):
        # The lamp drops the 0x1a bytes that end a block. The first boundary
        # is in the colour table: one channel goes 0x1a -> 0x1b. A later one
        # is moved with comment blocks, the picture unchanged.
        frames = [[(index * 37 % 256, index, 255 - index) for index in range(100)]] * 12
        data = ANIMATIONS["encode_gif"](frames, [100] * 12)
        end = ANIMATIONS["GIF_CHUNK"]
        self.assertGreater(len(data), 2 * end)
        safe_of = ANIMATIONS["lamp_safe"]
        ends_clean = lambda gif: all(gif[stop - 1] != 0x1A for stop in range(end, len(gif) + 1, end))
        in_table = data[:end - 1] + b"\x1a" + data[end:]
        safe = safe_of(in_table)
        self.assertTrue(ends_clean(safe))
        self.assertEqual(0x1B, safe[end - 1])
        later = data[:2 * end - 1] + b"\x1a" + data[2 * end:]
        safe = safe_of(later)
        self.assertTrue(ends_clean(safe))
        self.assertGreater(len(safe), len(later))  # comment blocks added
        _, decoded = self.decode(safe_of(data))
        self.assertEqual([list(frame) for frame in frames], decoded)
        _, moved = self.decode(safe)
        self.assertEqual(len(frames), len(moved))
        for key in ANIMATIONS["animation_names"]():
            for layout in (None, "app"):
                gif = ANIMATIONS["lamp_gif"](key, "up", layout)
                self.assertTrue(all(gif[stop - 1] != 0x1A for stop in range(end, len(gif) + 1, end)), (key, layout))

    def test_the_speed_is_in_the_frame_delays(self):
        delays = ANIMATIONS["animation_delays"]
        drawn = ANIMATIONS["_animations"]()["snowfall"]["delays"]
        default = CONSTANTS["DEFAULT_NATIVE_EFFECT_SPEED"]
        self.assertEqual(drawn, delays("snowfall", default))
        self.assertEqual(drawn, delays("snowfall", None))
        # Twice as fast a doubling above, half as fast one below; whole
        # hundredths, never under two.
        self.assertEqual([70, 60], list(delays("snowfall", default + 64)[:2]))
        self.assertEqual([260, 240], list(delays("snowfall", default - 64)[:2]))
        self.assertEqual({30}, set(delays("snowfall", 255)))
        self.assertTrue(all(delay % 10 == 0 for delay in delays("daydream", 0)))
        image = Image.open(io.BytesIO(ANIMATIONS["lamp_gif"]("snowfall", speed=0)))
        shown = []
        for frame in ImageSequence.Iterator(image):
            shown.append(frame.info["duration"])
        self.assertEqual(list(delays("snowfall", 0)), shown)
        # The preview's frame at a time follows the same delays.
        frame_at = ANIMATIONS["animation_frame_at"]
        frames = ANIMATIONS["_animations"]()["snowfall"]["frames"]
        self.assertEqual(frames[1], frame_at("snowfall", 0.13, 128))
        self.assertEqual(frames[0], frame_at("snowfall", 0.13, 0))
        self.assertEqual(frames[4], frame_at("snowfall", 0.13, 255))

    def test_the_color_adjustments_are_in_the_gif(self):
        look = {"hue_shift": 120, "saturation": 60, "tint_strength": 20, "tint_hue": 300}
        drawn = ANIMATIONS["_animations"]()["halloween_glow"]["frames"]
        _, frames = self.decode(ANIMATIONS["lamp_gif"]("halloween_glow", None, "app", None, look))
        adjust = ADJUSTMENTS["adjust_color"]
        self.assertEqual([[adjust(pixel, look) for pixel in frame] for frame in drawn], [
            [tuple(pixel) for pixel in frame] for frame in frames
        ])
        self.assertNotEqual([list(frame) for frame in drawn], frames)
        # The previews draw them too.
        self.assertEqual(
            [adjust(pixel, look) for pixel in ANIMATIONS["animation_frame_at"]("halloween_glow", 0.37)],
            list(ANIMATIONS["animation_frame_at"]("halloween_glow", 0.37, None, look)),
        )

    def test_the_encoder_round_trips_long_runs(self):
        frames = [[(index * 37 % 256, index, 255 - index) for index in range(100)]] * 2
        _, decoded = self.decode(ANIMATIONS["encode_gif"](frames, [100, 100]))
        self.assertEqual([list(frame) for frame in frames], decoded)
        with self.assertRaises(ValueError):
            ANIMATIONS["encode_gif"]([[(index, frame, 0) for index in range(100)] for frame in range(3)], [100] * 3)


class PacketTests(unittest.TestCase):
    def test_packets_are_the_app_s(self):
        self.assertEqual(0x29B1, ANIMATIONS["_crc16"](b"123456789"))
        data = bytes(range(256)) * 3  # 768 bytes: two packets
        packets = ANIMATIONS["gif_packets"](data)
        self.assertEqual([509, 509, 1], [len(packet) for packet in packets])
        self.assertEqual(b"\x04", packets[-1])
        for number, packet in enumerate(packets[:-1], start=1):
            self.assertEqual((1, number, 255 - number), tuple(packet[:3]))
            body = packet[3:507]
            self.assertEqual(ANIMATIONS["_crc16"](body), packet[507] << 8 | packet[508])
        self.assertEqual(data, (packets[0][3:507] + packets[1][3:507])[:768])
        self.assertEqual({0x1A}, set(packets[1][3 + 264:507]))


class FakeChannel:
    def __init__(self, refuse_at=None):
        self.sent = []
        self.refuse_at = refuse_at
        self.backend = "matter"

    async def async_available(self):
        return True

    async def async_command(self, cluster, name, payload):
        self.sent.append(base64.b64decode(payload["data"]))
        if self.refuse_at is not None and len(self.sent) == self.refuse_at:
            return {"status": 21}
        return {"status": 6}


class UploadTests(unittest.IsolatedAsyncioTestCase):
    setUp_live = live.ActivationTests.setUp
    commands = live.ActivationTests.commands

    def setUp(self):
        self.setUp_live()
        self.lamp._mode = CONSTANTS["MODE_NATIVE_EFFECT"]
        self.lamp._native_effect = "Snowfall"
        self.lamp._stored_gif = {"animation": None, "upside_down": False, "interrupted": False}
        self.channel = FakeChannel()
        self.lamp.matter_commands = self.channel
        self.lamp._device_orientation = "right"
        self.lamp._store_animation = live.FNS["_store_animation"].__get__(self.lamp)
        self.packets = len(ANIMATIONS["gif_packets"](ANIMATIONS["lamp_gif"]("snowfall")))

    def look(self, **adjustments):
        return {"speed": self.lamp._native_effect_speed, "adjustments": adjustments, "palette": None}

    async def test_a_new_speed_or_color_adjustment_uploads_it_again(self):
        await self.lamp._activate_native_effect()
        uploads = self.channel.sent.count(b"")
        # Another speed: its delays are in the GIF, no rate is sent (the lamp
        # plays a GIF at its own pace whatever the rate).
        self.sent.clear()
        self.lamp._native_effect_speed = 200
        await self.lamp._activate_native_effect()
        self.assertEqual(uploads + 1, self.channel.sent.count(b""))
        (_, params), = [sent for sent in self.sent if sent[0] == "set_fx_effect"]
        self.assertNotIn("rate", params[3])
        self.assertEqual(200, self.lamp._stored_gif["speed"])
        # A color adjustment: uploaded with it.
        self.lamp._preview_hue_shift = 45
        await self.lamp._activate_native_effect()
        self.assertEqual(uploads + 2, self.channel.sent.count(b""))
        self.assertEqual({"hue_shift": 45}, self.lamp._stored_gif["adjustments"])
        sent_gif = ANIMATIONS["lamp_gif"]("snowfall", "right", "upright", 200, {"hue_shift": 45})
        self.assertIn(ANIMATIONS["gif_packets"](sent_gif)[0], self.channel.sent)
        # One that changes nothing (a tint hue without its strength): no upload.
        self.lamp._preview_tint_hue = 200
        await self.lamp._activate_native_effect()
        self.assertEqual(uploads + 2, self.channel.sent.count(b""))

    async def test_an_animation_is_uploaded_once_then_played(self):
        await self.lamp._activate_native_effect()
        self.assertEqual(self.packets, len(self.channel.sent))
        self.assertEqual(b"\x04", self.channel.sent[-1])
        self.assertEqual({"animation": "snowfall", "upside_down": False, "layout": "upright", **self.look(), "interrupted": False}, self.lamp._stored_gif)
        (command, params), = [sent for sent in self.sent if sent[0] == "set_fx_effect"]
        self.assertEqual(params[0], EFFECTS["Snowfall"]["effect_id"])
        # Effect 71, as the Yeelight app plays a GIF: only then does the app
        # read the tile from the custom id (sent as 3, the lamp reports 3).
        self.assertEqual(params[0], 71)
        # Played as the app's Winter tile: the app shows it as playing.
        self.assertEqual(params[1], 77)
        self.assertEqual(params[3]["mode"], 71)
        self.assertNotIn("rate", params[3])
        # Already there: played without an upload (no flash write).
        await self.lamp._activate_native_effect()
        self.assertEqual(self.packets, len(self.channel.sent))
        # Another mount: laid out again.
        self.lamp._device_orientation = "up"
        await self.lamp._activate_native_effect()
        turned = len(ANIMATIONS["gif_packets"](ANIMATIONS["lamp_gif"]("snowfall", "up")))
        self.assertEqual(self.packets + turned, len(self.channel.sent))
        self.assertTrue(self.lamp._stored_gif["upside_down"])

    async def test_the_stored_gif_is_played_as_the_animation_it_holds(self):
        await self.lamp._activate_native_effect()
        self.sent.clear()
        self.lamp._native_effect = "Stored GIF"
        await self.lamp._activate_native_effect()
        (_, params), = [sent for sent in self.sent if sent[0] == "set_fx_effect"]
        self.assertEqual(params[:2], [71, 77])
        # The app's own GIF (or none known): no tile.
        self.lamp._stored_gif = {"animation": None, "upside_down": False, "interrupted": False}
        self.assertEqual(0, live.FNS["stored_gif_tile"](self.lamp))

    async def test_the_app_s_layout_is_uploaded_once_whatever_the_mount(self):
        self.lamp._animation_layout = CONSTANTS["ANIMATION_LAYOUT_APP"]
        await self.lamp._activate_native_effect()
        app = len(ANIMATIONS["gif_packets"](ANIMATIONS["lamp_gif"]("snowfall", None, "app")))
        self.assertEqual(app, len(self.channel.sent))
        self.assertEqual({"animation": "snowfall", "upside_down": False, "layout": "app", **self.look(), "interrupted": False}, self.lamp._stored_gif)
        # Another mount: the same file, not uploaded again.
        self.lamp._device_orientation = "up"
        await self.lamp._activate_native_effect()
        self.assertEqual(app, len(self.channel.sent))
        # Back upright: uploaded again, laid out for the mount.
        self.lamp._animation_layout = CONSTANTS["ANIMATION_LAYOUT_UPRIGHT"]
        await self.lamp._activate_native_effect()
        turned = len(ANIMATIONS["gif_packets"](ANIMATIONS["lamp_gif"]("snowfall", "up")))
        self.assertEqual(app + turned, len(self.channel.sent))
        self.assertEqual("upright", self.lamp._stored_gif["layout"])

    async def test_a_refusal_stops_without_the_end_marker_and_the_next_goes_twice(self):
        self.channel.refuse_at = 3
        with self.assertRaises(TranslatedError) as raised:
            await self.lamp._activate_native_effect()
        self.assertIn("21", str(raised.exception))
        self.assertEqual(3, len(self.channel.sent))
        self.assertNotIn(b"\x04", self.channel.sent)
        self.assertNotIn("set_fx_effect", [command for command, _ in self.sent])
        self.assertEqual({"animation": None, "upside_down": False, "layout": "upright", **self.look(), "interrupted": True}, self.lamp._stored_gif)
        self.channel.refuse_at = None
        self.channel.sent.clear()
        await self.lamp._activate_native_effect()
        self.assertEqual(2 * self.packets, len(self.channel.sent))
        self.assertEqual(2, self.channel.sent.count(b"\x04"))
        self.assertFalse(self.lamp._stored_gif["interrupted"])

    async def test_without_matter_nothing_is_sent(self):
        self.lamp.matter_commands = None
        with self.assertRaises(TranslatedError) as raised:
            await self.lamp._activate_native_effect()
        self.assertIn("Matter", str(raised.exception))
        self.assertEqual([], self.sent)
        # The stored GIF plays over LAN, without Matter.
        self.lamp._native_effect = "Stored GIF"
        await self.lamp._activate_native_effect()
        self.assertEqual(["set_fx_effect"], self.commands())


class RestoreTests(unittest.TestCase):
    def test_the_stored_gif_keeps_its_speed_and_colors_over_a_restart(self):
        invalid = object()
        stored_gif = _load_standalone_functions(
            (ROOT / "light_restore.py").read_text(encoding="utf-8"), {"_stored_gif"},
            {
                **{name: CONSTANTS[name] for name in ("LAMP_ANIMATION_EFFECTS", "ANIMATION_LAYOUTS", "SPEED_RANGE")},
                "active_adjustments": ADJUSTMENTS["active_adjustments"], "_INVALID": invalid,
            },
        )["_stored_gif"]
        saved = {
            "animation": "daydream", "upside_down": False, "layout": "app", "speed": 40,
            "adjustments": {"hue_shift": 30, "saturation": 100}, "interrupted": False,
        }
        self.assertEqual(
            {**saved, "adjustments": {"hue_shift": 30}}, stored_gif(saved),
        )
        # Saved before they were in it, or wrong: the default speed and no
        # adjustment (_store_animation reads them so).
        restored = stored_gif({**saved, "speed": 999, "adjustments": {"hue_shift": "x"}})
        self.assertNotIn("speed", restored)
        self.assertNotIn("adjustments", restored)


class AppGifTests(unittest.TestCase):
    def test_the_app_s_gif_replaces_ours(self):
        light = FakeLight()
        light._stored_gif = {"animation": "snowfall", "upside_down": False, "interrupted": False}
        light._matter = SimpleNamespace(values={"effect": 71, "effect_sub": 77}, linked=True)
        light._lamp_command_at = 0.0
        light._note_app_gif()
        self.assertIsNone(light._stored_gif["animation"])
        # Our own command's echo is not the app.
        light._stored_gif = {"animation": "snowfall", "upside_down": False, "interrupted": False}
        light._lamp_command_at = __import__("time").monotonic()
        light._note_app_gif()
        self.assertEqual("snowfall", light._stored_gif["animation"])


class AnimationParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards")
    def test_the_cards_draw_the_camera_s_frames(self):
        frames_js = (ROOT / "www" / "lamp-animation-frames.js").as_uri()
        looks = (
            (None, None), (0, {"hue_shift": -90, "contrast": 160}),
            (255, {"saturation": 30, "tint_strength": 40, "tint_hue": 120, "invert": 25}),
        )
        cases = [
            [key, seconds, mount, layout, speed, look]
            for key in ANIMATIONS["animation_names"]()
            for seconds, mount in ((0.0, "right"), (2.7, "up"), (5.95, "down"))
            for layout in (None, "app")
            for speed, look in looks
        ]
        script = (
            "globalThis.atob ??= (b) => Buffer.from(b, 'base64').toString('binary');"
            f"const m = await import({json.dumps(frames_js)});"
            f"process.stdout.write(JSON.stringify({{ names: m.ANIMATION_EFFECTS, frames: {json.dumps(cases)}"
            ".map((args) => m.animationFrame(...args)) }));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        self.assertEqual({name: spec["animation"] for name, spec in EFFECTS.items()}, out["names"])
        self.assertEqual(
            [[list(pixel) for pixel in ANIMATIONS["animation_frame"](*case)] for case in cases],
            out["frames"],
        )


class ColorAdjustmentParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required for the cards")
    def test_the_cards_adjust_colors_as_the_integration_does(self):
        import random

        rng = random.Random(7)
        ranges = {
            "hue_shift": (-180, 180), "temperature": (-100, 100), "saturation": (0, 200),
            "vibrance": (0, 200), "contrast": (0, 200), "glow": (0, 100), "grayscale": (0, 100),
            "tint_hue": (0, 360), "tint_strength": (0, 100), "invert": (0, 100),
        }
        cases = []
        for _ in range(1500):
            values = {name: rng.randint(*ranges[name]) for name in rng.sample(list(ranges), rng.randint(1, 5))}
            rgb = [rng.choice((0, 1, 127, 128, 255, rng.randint(0, 255))) for _ in range(3)]
            cases.append([rgb, values])
        script_js = (ROOT / "www" / "color-adjustments.js").as_uri()
        # The cases go in on stdin: too long for a command line.
        script = (
            f"const m = await import({json.dumps(script_js)});"
            "let text = ''; for await (const chunk of process.stdin) text += chunk;"
            "process.stdout.write(JSON.stringify(JSON.parse(text)"
            ".map(([rgb, values]) => m.adjustColor(rgb, m.activeAdjustments(values)))));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            input=json.dumps(cases), text=True, capture_output=True, check=True,
        )
        adjust, active = ADJUSTMENTS["adjust_color"], ADJUSTMENTS["active_adjustments"]
        self.assertEqual(
            [list(adjust(rgb, active(values))) for rgb, values in cases],
            json.loads(result.stdout),
        )

    def test_only_adjustments_that_change_a_color_count(self):
        active = ADJUSTMENTS["active_adjustments"]
        self.assertEqual({}, active(ADJUSTMENTS["ADJUSTMENT_DEFAULTS"]))
        self.assertEqual({}, active({"tint_hue": 200, "saturation": 100}))
        self.assertEqual({"tint_hue": 200, "tint_strength": 10}, active({"tint_hue": 200, "tint_strength": 10}))
        self.assertEqual((0, 0, 0), ADJUSTMENTS["adjust_color"]((0, 0, 0), {"invert": 100}))


if __name__ == "__main__":
    unittest.main()
