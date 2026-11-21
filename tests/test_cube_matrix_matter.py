"""The Cube Matrix beyond its LAN stream: raw colours and the direct-mode
re-send of the stream, its Matter node (product 16787457), the payloads of
its own effects, clock and drawings (matrix_effects.py), when the light
sends them (light_matrix.py), the demo loop, and the migration of an entry
made before models were told apart.

The facts are the lamp's (2026-11-09: node 7 on Home Assistant's Matter
server, 4 Matrix modules, rotation 0, filmed): see docs/CUBE_MATRIX.md.
"""

import asyncio
import base64
import dataclasses
import runpy
import sys
import time
import types
from unittest import mock
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module  # noqa: E402
from test_matter_link import CUBE_ATTRIBUTES, LAMP_IP, LAMP_MAC, FakeClient, hass_with, node  # noqa: E402
from test_music_channel import MUSIC, FakeLamp  # noqa: E402
from test_native_features import ROOT  # noqa: E402
from fakes import FakeCube, FakeEntry, lamp_client_source, make_light, module  # noqa: E402

EFFECTS = import_pure_module("matrix_effects")
PROFILE = import_pure_module("device_profile")
LINK = import_pure_module("matter_link")
DISCOVERY = import_pure_module("matter_discovery")
MATRIX = import_pure_module("light_matrix")
MATRIX_SETTINGS = import_pure_module("light_matrix_settings")
MATRIX_FOLLOW = import_pure_module("light_matrix_follow")
CORE = import_pure_module("lamp_core")
RENDERERS = import_pure_module("lamp_renderers")
COMMANDS = import_pure_module("matter_commands")
MOUNT = import_pure_module("light_mount_profile")
LIGHT_CLASS = module("light").YeelightCubeLight

MATRIX_ATTRIBUTES = {**CUBE_ATTRIBUTES, LINK.PRODUCT: 16787457, LINK.RUNNING_EFFECT: 15, LINK.EFFECT: 0}


def matrix_profile(topology="2,2,2,2,0,0,0,0,", rotation=0, strip="100"):
    return PROFILE.profile_for("CubeMatrix", (), topology, strip, rotation)


class PayloadTests(unittest.TestCase):
    """What the Yeelight app sends for this lamp, exactly."""

    def test_an_effect_tap_saves_it_with_what_it_takes(self):
        self.assertEqual(
            {"apply": 1, "effectId": 39, "rate": 200, "color": [0xFF8000, 0, 0, 0], "direction": 3},
            EFFECTS.preset_payload("Rainbow", 200, (255, 128, 0), "Right"),
        )
        # Nothing chosen: the lamp's preset (speed 128, blue).
        self.assertEqual({"apply": 1, "effectId": 42, "direction": 0},
                         EFFECTS.preset_payload("Waves", None, None, None))
        # Spectrum takes no speed, Ribbon no colour and no direction,
        # Hacking only up and down.
        # Spectrum takes a direction (filmed 2026-11-12), though the app offers none.
        self.assertEqual({"apply": 0, "effectId": 17, "color": [0x0000FF, 0, 0, 0], "direction": 0},
                         EFFECTS.preset_payload("Spectrum", 90, (0, 0, 255), "Up", EFFECTS.APPLY_SHOW))
        self.assertEqual({"apply": 1, "effectId": 3, "rate": 1},
                         EFFECTS.preset_payload("Ribbon", 0, (1, 2, 3), "Left"))
        self.assertEqual({"apply": 1, "effectId": 46, "rate": 255, "direction": 0},
                         EFFECTS.preset_payload("Hacking", 300, None, "Left"))

    def test_the_thirteen_app_effects(self):
        self.assertEqual(
            {3, 5, 15, 17, 32, 34, 37, 39, 42, 46, 47, 48, 49},
            {spec[0] for spec in EFFECTS.MATRIX_EFFECTS.values()},
        )

    def test_the_lamp_s_other_built_in_effects(self):
        # Fireworks: one warm-white word, so its sparks take the colour wheel
        # (no list: black sparks), saved as the lamp's effect.
        self.assertEqual(
            {"apply": 1, "effect": {"effectId": 10, "customId": 0, "effectParams": [{
                "onoff": 1, "mode": 10, "intensity": 128, "speed": 128, "color": [0xFFFFFF, 0, 0, 0],
                "mixer": 0, "direction": 0, "data": ""}]}},
            EFFECTS.engine_payload(10),
        )
        payload = EFFECTS.engine_payload(8, 40, 200, [0x01FF5A3D, 0x00FF00], "Left", EFFECTS.APPLY_SHOW)
        params = payload["effect"]["effectParams"][0]
        # Mode 8 draws colour words: the ones not given are the Cube Lite's
        # white (black on a Cube Matrix).
        self.assertEqual((0, 8, 40, 200, [0xFF5A3D, 0x00FF00, 0xFFFFFF, 0xFFFFFF], 2),
                         (payload["apply"], params["mode"], params["speed"], params["intensity"],
                          params["color"], params["direction"]))
        self.assertEqual(37, len(EFFECTS.ENGINE_MODES))
        # Music (no microphone), blanks and 70-81 (streamed), and what is no
        # effect or crashes the lamp are never started this way.
        for mode in (12, 13, 20, 29, 36, 40, 41, 50, 53, 64, 67, *range(70, 82)):
            with self.assertRaises(EFFECTS.UnsafeMatrixCommand, msg=mode):
                EFFECTS.engine_payload(mode)
        self.assertFalse(EFFECTS.ENGINE_MODES & {spec[0] for spec in EFFECTS.MATRIX_EFFECTS.values()})
        self.assertFalse(EFFECTS.ENGINE_MODES & EFFECTS.STREAMED_MODES)

    def test_the_colour_rule(self):
        """CUBE_MATRIX_VS_LITE_EFFECTS §2: an unsent colour is black, any list
        replaces the palette with a ramp of its first colour."""
        params = lambda payload: payload["effect"]["effectParams"][0]
        # A palette mode with no colour chosen: no list, its own palette.
        for mode in (4, 6, 7, 14, 16, 18, 19, 21, 22, 23, 24, 31, 35, 38, 54, 55, 56, 57, 58, 59, 60, 65, 66, 68, 69):
            self.assertNotIn("color", params(EFFECTS.engine_payload(mode)), mode)
        self.assertEqual(
            {"onoff": 1, "mode": 4, "intensity": 128, "speed": 128, "mixer": 0, "direction": 0, "data": ""},
            params(EFFECTS.engine_payload(4)),
        )
        # A mode that draws colour words: white in all four, as a Cube Lite
        # installs (not its LED white 0xfcd564, which the lamp turned amber).
        for mode in (1, 2, 8, 11, 28, 33, 61, 62):
            self.assertEqual([0xFFFFFF] * 4, params(EFFECTS.engine_payload(mode))["color"], mode)
        self.assertEqual([0xFFFFFF] * 4, params(EFFECTS.engine_payload(11, 90))["color"])  # Sine wave
        # A chosen colour, padded to 4: with the Cube Lite's white on a
        # mode drawing colour words (Particle glows: half its glows were
        # black), with black on a palette mode (a ramp of the first).
        self.assertEqual([0x123456, 0xFFFFFF, 0xFFFFFF, 0xFFFFFF],
                         params(EFFECTS.engine_payload(11, chosen=[0x123456]))["color"])
        self.assertEqual([0xFF0000, 0xFFFFFF, 0xFFFFFF, 0xFFFFFF],
                         params(EFFECTS.engine_payload(61, chosen=[0xFF0000]))["color"])
        self.assertEqual([0x00FF00, 0, 0, 0], params(EFFECTS.engine_payload(4, chosen=[0x00FF00]))["color"])
        # The effect's own words, the 0x01 flag byte masked off.
        self.assertEqual([0xFF563D, 0xFFFFFF, 0xFFFFFF, 0xFFFFFF],
                         params(EFFECTS.engine_payload(33, own=[0x01FF563D]))["color"])
        # Fireworks with a chosen colour: that list.
        self.assertEqual([0xFF0000, 0, 0, 0], params(EFFECTS.engine_payload(10, chosen=[0xFF0000]))["color"])
        # Never an all-black list, never 1-3 colours unpadded, never more than 4.
        for mode in sorted(EFFECTS.ENGINE_MODES):
            for chosen in ((), [0], [0, 0, 0, 0], [0x0A0B0C], [1, 2], [1, 2, 3]):
                colours = params(EFFECTS.engine_payload(mode, chosen=chosen)).get("color")
                if colours is not None:
                    self.assertEqual(4, len(colours), (mode, chosen))
                    self.assertTrue(any(colours), (mode, chosen))
        with self.assertRaises(EFFECTS.UnsafeMatrixCommand):
            EFFECTS.engine_payload(8, chosen=[1, 2, 3, 4, 5])

    def test_the_clock_and_app_effects_never_send_black(self):
        self.assertNotIn("color", EFFECTS.preset_payload("Rainbow", 100, (0, 0, 0)))
        self.assertEqual([0xFF0000, 0, 0, 0], EFFECTS.preset_payload("Rainbow", 100, (255, 0, 0))["color"])

    def test_the_cube_matrix_s_own_versions_are_labelled(self):
        # Those that look like another effect are effects of their own
        # (MatrixVersionTests); Flicker sweep looks as on a Cube Lite.
        self.assertEqual({"Fire", "Night-amber waves"}, set(EFFECTS.OWN_VERSIONS))
        light = (ROOT / "light_attributes.py").read_text(encoding="utf-8")
        self.assertIn('"matrix_own_versions": dict(MATRIX_OWN_VERSIONS)} if self.is_cube_matrix', light)

    def test_four_colours_padded_never_more(self):
        self.assertEqual([0x123456, 0, 0, 0], EFFECTS.padded_colours([0x123456]))
        self.assertEqual([1, 2, 3, 4], EFFECTS.padded_colours([1, 2, 3, 4]))
        with self.assertRaises(EFFECTS.UnsafeMatrixCommand):
            EFFECTS.padded_colours([1, 2, 3, 4, 5])

    def test_clock_bytes(self):
        # content, the UTC offset as a signed byte, 12-hour, 0 = colon blinks.
        self.assertEqual(bytes((1, 1, 0, 0)), EFFECTS.clock_data(1, 1, False, True))
        self.assertEqual(bytes((2, 253, 1, 1)), EFFECTS.clock_data(2, -3, True, False))
        self.assertEqual(bytes((3, 14, 0, 0)), EFFECTS.clock_data(3, 14, False, True))
        self.assertEqual(bytes((1, 0xF4, 0, 0)), EFFECTS.clock_data(1, -12, False, True))
        with self.assertRaises(EFFECTS.UnsafeMatrixCommand):
            EFFECTS.clock_data(4, 0, False, True)  # 0 and 4 show nothing

    def test_the_clock_command(self):
        self.assertEqual(
            {
                "apply": 2,
                "effect": {
                    "effectId": 40,
                    "customId": 4,
                    "effectParams": [{
                        "onoff": 1, "mode": 40, "intensity": 128, "speed": 128,
                        "color": [0xFFFFFF, 0, 0, 0], "mixer": 0, "direction": 0,
                        "data": base64.b64encode(bytes((2, 251, 0, 0))).decode(),
                    }],
                },
            },
            EFFECTS.clock_payload((255, 255, 255), 0, 2, -5, False, True, style_id=4),
        )
        with self.assertRaises(EFFECTS.UnsafeMatrixCommand):
            EFFECTS.clock_payload((255, 255, 255), 34, 1, 0, False, True)  # not a clock background

    def test_a_drawing_in_the_lamp_s_wire_order(self):
        profile = matrix_profile()
        frame = [(0, 0, 0)] * 100
        frame[0] = (1, 2, 3)          # row 0 (bottom), column 0 (the base)
        frame[4 * 20 + 6] = (9, 8, 7)  # row 4 (top), column 6: module 1, its column 1
        pixels = profile.drawing_pixels(profile.to_wire(frame))
        self.assertEqual(100, len(pixels))
        data = EFFECTS.drawing_data(pixels)
        self.assertEqual(400, len(data))
        self.assertEqual(bytes((0xFF, 1, 2, 3)), data[0:4])
        # Module m, pixel j (column j // 5, row j % 5) at m * 100 + 4 * j.
        at = 1 * 100 + 4 * (1 * 5 + 4)
        self.assertEqual(bytes((0xFF, 9, 8, 7)), data[at:at + 4])
        payload = EFFECTS.drawing_payload(pixels)
        params = payload["effect"]["effectParams"][0]
        # No colour list (the app sends none).
        self.assertNotIn("color", params)
        # Always still (mixer 0).
        self.assertEqual((0, 36, 36, 0, 128),
                         (payload["apply"], payload["effect"]["effectId"], params["mode"],
                          params["mixer"], params["speed"]))
        self.assertEqual(base64.b64decode(params["data"]), data)
        self.assertEqual({"data": params["data"]}, EFFECTS.set_data_payload(pixels))

    def test_a_spot_slot_is_one_drawing_pixel(self):
        profile = matrix_profile("2,2,3,0,0,0,0,0,", strip="55")
        pixels = profile.drawing_pixels(profile.to_wire([(5, 5, 5)] * 100))
        self.assertEqual(51, len(pixels))

    def test_crashing_modes_are_never_built(self):
        for mode in (53, 64, 67):
            with self.assertRaises(EFFECTS.UnsafeMatrixCommand):
                EFFECTS._effect(mode, 0, 0, {"mode": mode})


class RotationTests(unittest.TestCase):
    """The lamp never turns frames; its rotation names how it is mounted, the
    light's Device Orientation (filmed 2026-11-09: 0 lying base-left, 3
    standing on the base)."""

    def test_frames_are_never_turned(self):
        frame = [(index, 0, 0) for index in range(100)]
        for rotation in range(4):
            self.assertEqual(matrix_profile(rotation=rotation).to_wire(frame)[0], (0, 0, 0))

    def test_each_rotation_is_a_mounting(self):
        self.assertEqual(["right", "down", "left", "up"], [matrix_profile(rotation=r).orientation for r in range(4)])
        self.assertIsNone(PROFILE.CUBE_LITE_PROFILE.orientation)

    def test_the_orientation_writes_the_cube_matrix_s_own_rotation(self):
        # Each lamp's own numbering: a Cube Matrix's rotation is the mounting
        # it is for (MATRIX_ROTATION_ORIENTATIONS), a Cube Lite's its arrows.
        light = FakeLight()
        for rotation, orientation in PROFILE.MATRIX_ROTATION_ORIENTATIONS.items():
            self.assertEqual(rotation, LIGHT_CLASS._rotation_for(light, orientation), orientation)
        lite = make_light()
        for orientation, rotation in module("light_matter").ORIENTATION_ROTATIONS.items():
            self.assertEqual(rotation, lite._rotation_for(orientation), orientation)
        # Both ways it is written use it (the Device Orientation, and the
        # mount profile's check); at setup the lamp's own rotation is read.
        matter = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_matter*.py")))
        self.assertEqual(2, matter.count("rotation = self._rotation_for(orientation)"))
        source = (ROOT / "light_lifecycle.py").read_text(encoding="utf-8")
        self.assertIn("self._matrix_rotated(self._lamp_client.profile.rotation, start=True)", source)

    def test_the_clock_is_never_turned_again_in_home_assistant(self):
        # A lamp without effects of its own (its clock streamed) is never
        # taken for one that turns its clock, whatever profile it reports;
        # a Cube Lite on profile 0 turns it.
        no_effects = types.SimpleNamespace(key="other", native_effects=False)
        for profile in (0, 1, 2, 3):
            light = make_light(device_profile=no_effects, effect_profile=profile)
            self.assertFalse(light.lamp_turns_clock, profile)
        self.assertTrue(make_light(effect_profile=0).lamp_turns_clock)


class RawColourTests(unittest.TestCase):
    """The Cube Matrix converts every streamed pixel itself (filmed: the
    Cube Lite's LED drive turned white orange)."""

    def test_the_renderers_draw_raw_colours_inside_raw_colours(self):
        settings = RENDERERS.lamp_settings("Waterfall", "Up", 128)
        drive = RENDERERS.renderer_frame(settings, 30)
        with CORE.raw_colours():
            raw = RENDERERS.renderer_frame(settings, 30)
            self.assertEqual((10, 20, 30), CORE.convert_colour((10, 20, 30)))
        self.assertIn((0, 0, 255), raw)
        self.assertNotIn((0, 0, 255), drive)
        # The caches keep them apart: the previews still get LED drive.
        self.assertEqual(drive, RENDERERS.renderer_frame(settings, 30))
        self.assertFalse(CORE.colours_raw())

    def test_white_is_white(self):
        self.assertNotEqual((255, 255, 255), CORE.convert_colour((255, 255, 255)))
        with CORE.raw_colours():
            self.assertEqual((255, 255, 255), CORE.convert_colour((255, 255, 255)))

    def test_only_the_cube_matrix_streams_raw_colours(self):
        self.assertTrue(matrix_profile().raw_colours)
        self.assertFalse(PROFILE.CUBE_LITE_PROFILE.raw_colours)


class DirectRefreshTests(unittest.TestCase):
    """Direct mode again every DIRECT_REFRESH seconds while frames go: sent
    once, a stream froze after 10 to 20 s (filmed)."""

    def setUp(self):
        self._address, self._refresh = MUSIC.local_address_for, MUSIC.DIRECT_REFRESH
        MUSIC.local_address_for = lambda ip: "127.0.0.1"
        MUSIC.DIRECT_REFRESH = 0.2

    def tearDown(self):
        MUSIC.local_address_for, MUSIC.DIRECT_REFRESH = self._address, self._refresh

    def test_direct_mode_is_sent_again_before_a_frame_that_is_due(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            await channel.request("activate_fx_mode", [{"mode": "direct"}])
            channel.session_setup = [("activate_fx_mode", [{"mode": "direct"}])]
            await channel.request("update_leds", ["f1"])
            await channel.request("update_leds", ["f2"])
            await asyncio.sleep(0.25)
            await channel.request("update_leds", ["f3"])
            await channel.request("update_leds", ["f4"])
            await asyncio.sleep(0.1)
            channel.close(); lamp.server.close()
            return lamp
        lamp = asyncio.run(scenario())
        self.assertEqual(
            ["activate_fx_mode", "f1", "f2", "activate_fx_mode", "f3", "f4"],
            [line["method"] if line["method"] != "update_leds" else line["params"][0]
             for line in lamp.music_lines],
        )

    def test_not_when_direct_mode_is_over(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            await channel.request("update_leds", ["f1"])
            await asyncio.sleep(0.25)
            await channel.request("update_leds", ["f2"])
            await asyncio.sleep(0.1)
            channel.close(); lamp.server.close()
            return lamp
        lamp = asyncio.run(scenario())
        self.assertEqual(["update_leds", "update_leds"], [line["method"] for line in lamp.music_lines])

    def test_the_real_cadence(self):
        self.assertEqual(2.0, self._refresh)


class MusicModeOnlyForFramesTests(unittest.TestCase):
    """Opening music mode shows the last frame over the lamp's own effect
    (seen live: an effect started over Matter froze when a connection check
    opened it): it is opened for frames only."""

    def setUp(self):
        self._address = MUSIC.local_address_for
        MUSIC.local_address_for = lambda ip: "127.0.0.1"

    def tearDown(self):
        MUSIC.local_address_for = self._address

    def test_a_command_or_a_check_does_not_open_it(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            with self.assertRaises(MUSIC.NotOpen):  # sent over TCP instead
                await channel.request("set_bright", [50])
            self.assertFalse(await channel.ping())
            self.assertFalse(channel.is_open)
            lamp.server.close()
            return lamp
        lamp = asyncio.run(scenario())
        self.assertEqual([], lamp.tcp_methods)  # no set_music
        self.assertTrue(issubclass(MUSIC.NotOpen, MUSIC.UdpTooLarge))  # lamp_client: TCP, not a failure

    def test_while_direct_mode_is_on_it_opens_for_anything(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            channel.session_setup = [("activate_fx_mode", [{"mode": "direct"}])]
            self.assertTrue(await channel.ping())
            channel.close(); lamp.server.close()
            return lamp
        self.assertEqual(["set_music"], asyncio.run(scenario()).tcp_methods)

    def test_the_health_check_asks_a_cube_matrix_over_tcp(self):
        # A Cube Matrix (its session the music connection) is asked over TCP,
        # with its own probe (a Cube Lite: the power-on command in its session).
        cube, health = module("lamp_client"), module("lamp_client_health")
        self.assertEqual(("get_prop", ["power"]), health.MATRIX_PROBE_COMMAND)
        connection = cube.LampClient("192.0.2.10", 55443)
        connection._udp = module("music_channel").MusicChannel("192.0.2.10", 55443)
        sent = []

        async def send_once(ip, port, method, params, timeout):
            sent.append((method, params))

        with mock.patch.object(connection, "_udp_usable", return_value=True), \
                mock.patch.object(connection._udp, "request", mock.AsyncMock()) as session, \
                mock.patch.object(health, "check_tcp", mock.AsyncMock()), \
                mock.patch.object(health, "send_once", send_once):
            self.assertTrue(asyncio.run(connection.probe(answering=True)))
        session.assert_not_awaited()
        self.assertEqual([health.MATRIX_PROBE_COMMAND], sent)
        # A Cube Lite answers in its UDP session: nothing goes over TCP.
        lite = cube.LampClient("192.0.2.10", 55443)
        sent.clear()
        with mock.patch.object(lite, "_udp_usable", return_value=True),                 mock.patch.object(lite._udp, "request", mock.AsyncMock(return_value={"result": ["ok"]})) as session,                 mock.patch.object(health, "check_tcp", mock.AsyncMock()) as connect,                 mock.patch.object(health, "send_once", send_once):
            self.assertTrue(asyncio.run(lite.probe(answering=True)))
        session.assert_awaited_once_with(*health.PROBE_COMMAND)
        connect.assert_not_awaited()
        self.assertEqual([], sent)


class MatterNodeTests(unittest.TestCase):
    def test_product_16787457_is_a_cube_matrix(self):
        self.assertIsNone(LINK.node_matches(MATRIX_ATTRIBUTES, LAMP_IP, None))  # not a Cube Lite
        self.assertEqual(LAMP_MAC, LINK.node_matches(MATRIX_ATTRIBUTES, LAMP_IP, None, (16787457,)))
        self.assertIsNone(LINK.node_matches(CUBE_ATTRIBUTES, LAMP_IP, None, (16787457,)))
        self.assertEqual("CubeMatrix", LINK.product_model(16787457))
        self.assertEqual(16787457, matrix_profile().matter_product)

    def test_the_link_follows_what_the_cube_matrix_runs(self):
        client = FakeClient([node(7, dict(MATRIX_ATTRIBUTES))])
        reports = []
        link = LINK.MatterLink(
            hass_with(client), lambda *report: reports.append(report),
            products=(16787457,), reported=LINK.MATRIX_REPORTED,
        )
        self.assertTrue(link.refresh(LAMP_IP, None))
        self.assertEqual(7, link.node_id)
        self.assertIn(("running_effect", 15, True), reports)
        self.assertNotIn("mic_music_on", link.values)
        client.push(7, LINK.RUNNING_EFFECT, 34)
        self.assertEqual(("running_effect", 34, False), reports[-1])
        self.assertEqual("2/320011267/319946752", LINK.RUNNING_EFFECT)

    def test_a_cube_lite_link_does_not_take_it(self):
        link = LINK.MatterLink(hass_with(FakeClient([node(7, dict(MATRIX_ATTRIBUTES))])), lambda *r: None)
        self.assertFalse(link.refresh(LAMP_IP, None))

    def test_its_entry_is_recognised_and_a_new_one_offered_as_a_cube_matrix(self):
        entry = {"Light IP Address": LAMP_IP, "model": "CubeMatrix"}
        self.assertEqual([], DISCOVERY.matter_only_lamp_models([MATRIX_ATTRIBUTES], [entry]))
        self.assertEqual([(LAMP_IP, LAMP_MAC, "CubeMatrix")],
                         DISCOVERY.matter_only_lamp_models([MATRIX_ATTRIBUTES], []))


class FakeLight(LIGHT_CLASS):
    """The real light (light.YeelightCubeLight: every method of its mixins)
    on a Cube Matrix, with the neighbours of light_matrix that reach the
    lamp or other parts replaced, recording the order of what it does."""

    def __init__(self, topology="2,2,2,2,0,0,0,0,", demo=None, refuse=False):
        self.log = []
        log = self.log
        capabilities = {} if demo is None else {"show_off_mode": demo}

        class Lamp(FakeCube):
            def __init__(self):
                super().__init__(matrix_profile(topology), capabilities=capabilities)

            def close_music_session(self):
                log.append("close_music")
                return True

            async def send_raw_command(self, method, params, udp=True):
                log.append((method, params, udp))

        class Channel:
            backend = "matter"

            async def async_command(self, cluster, name, payload, endpoint_id=None):
                if refuse:
                    raise COMMANDS.MatterCommandsUnavailable("refused")
                log.append(("matter", cluster, name, payload))

        super().__init__(Lamp(), "192.168.4.189", FakeEntry())
        self._matter = types.SimpleNamespace(linked=True, values={"effect": 0})
        self._matter_commands = Channel()
        self._ip, self.hass = "192.168.4.189", None
        self._music_flow_enabled = False
        self._mode = "Native Effect"
        self._native_effect, self._native_effect_color_mode = "Rainbow", "normal"
        self._native_effect_color, self._native_effect_speed = None, 200
        self._native_effect_direction, self._text_colors = "Up", []
        self._device_orientation = "right"  # rotation 0: lying, the base on the left
        self._native_clock_style, self._native_clock_color_mode = 4, "normal"
        self._native_clock_color, self._native_clock_content = None, "time"
        self._native_clock_12_hour, self._native_clock_colon_blink = False, True
        self._native_clock_timezone_offset = None
        self._is_on, self._fx_mode_is_direct, self._in_native_fw_mode = True, True, False
        self._brightness, self._last_hardware_brightness = 255, 100
        self.switched = []

    def _clock_style(self):
        return {4: {"mixer": 0}, 1: {"mixer": 39}, 15: {"mixer": 56}}[self._native_clock_style]

    def _native_clock_timezone_hours(self):
        return -3

    def _native_brightness_due(self):
        return False

    def stop_studio_stream(self):
        self.log.append("stop_stream")

    def studio_selected(self):
        return True

    async def _start_studio_stream(self):
        self.log.append("stream")

    def _native_renderer_shown(self):
        self.log.append("shown")

    def _power_echo(self, on):
        return False

    def _lamp_switched(self, on):
        self.switched.append(on)

    def _matter_echo(self):
        return False

    def _async_check_problems(self):
        self.log.append("check_problems")

    def _matrix_matter_changed(self):
        self.log.append("matter_changed")

    async def set_device_orientation(self, orientation):
        self.log.append(("orientation", orientation))

    def _rotation_for(self, orientation):
        # light_matter's; RestartRotationTests gives it the Cube Matrix's.
        return None

    def async_write_ha_state(self):
        pass


def run(coro):
    return asyncio.run(coro)


class NativeTests(unittest.TestCase):
    def setUp(self):
        self._settle = MATRIX.MUSIC_CLOSE_SETTLE
        MATRIX.MUSIC_CLOSE_SETTLE = 0

    def tearDown(self):
        MATRIX.MUSIC_CLOSE_SETTLE = self._settle

    def test_the_music_session_is_closed_before_the_lamp_s_own_effect(self):
        light = FakeLight()
        self.assertTrue(run(light._activate_matrix_content()))
        self.assertEqual(
            ["stop_stream", "close_music",
             ("matter", COMMANDS.EFFECTS_CLUSTER, "setPresetsEffect",
              {"apply": 1, "effectId": 39, "rate": 200, "direction": 0}),
             "shown"],
            light.log,
        )
        self.assertFalse(light._fx_mode_is_direct)

    def test_its_colour_or_a_one_colour_palette(self):
        light = FakeLight()
        light._native_effect_color = (255, 0, 0)
        self.assertEqual([0xFF0000, 0, 0, 0], light.matrix_native_command()[1]["color"])
        light._native_effect_color_mode, light._text_colors = "palette", [[0, 255, 0]]
        self.assertEqual([0x00FF00, 0, 0, 0], light.matrix_native_command()[1]["color"])

    def test_its_other_built_in_effects_are_its_own_too(self):
        light = FakeLight()
        light._native_effect, light._native_effect_direction = "Fireworks", "Down"
        name, payload = light.matrix_native_command()
        params = payload["effect"]["effectParams"][0]
        self.assertEqual(("setEffect", 10, 10, 200, [0xFFFFFF, 0, 0, 0]),
                         (name, payload["effect"]["effectId"], params["mode"], params["speed"],
                          params["color"]))
        # "Down" on Particle path, lying (rotation 0): 2 (filmed 2026-11-10 and 12).
        light._native_effect = "Particle path"
        self.assertEqual(2, light.matrix_native_command()[1]["effect"]["effectParams"][0]["direction"])
        light._native_effect = "Fireworks"
        # Its colour words; a palette of no more colours than it draws.
        light._native_effect = "Rotating colour bands"
        self.assertEqual([0xFF563D, 0xFFD044, 0x26CD94, 0x427BF4],
                         light.matrix_native_command()[1]["effect"]["effectParams"][0]["color"])
        light._native_effect_color_mode = "palette"
        light._text_colors = [[255, 0, 0], [0, 0, 255]]
        self.assertEqual([0xFF0000, 0x0000FF, 0xFF0000, 0x0000FF],
                         light.matrix_native_command()[1]["effect"]["effectParams"][0]["color"])
        light._text_colors = [[i, i, i] for i in range(5)]
        self.assertIsNone(light.matrix_native_command())  # more than it draws: streamed
        # Sine wave with no colour: the Cube Lite's white, not black.
        light._native_effect_color_mode, light._native_effect = "normal", "Sine wave"
        self.assertEqual([0xFFFFFF] * 4, light.matrix_native_command()[1]["effect"]["effectParams"][0]["color"])
        # Its own palette for a palette mode; the user's colour as a ramp.
        light._native_effect = "Palette trails"
        self.assertNotIn("color", light.matrix_native_command()[1]["effect"]["effectParams"][0])
        light._native_effect_color = (0, 255, 0)
        self.assertEqual([0x00FF00, 0, 0, 0], light.matrix_native_command()[1]["effect"]["effectParams"][0]["color"])

    def test_a_built_in_effect_draws_what_a_cube_lite_draws(self):
        # Both models lay a renderer's strip on the panel the same way
        # (filmed 2026-11-12): for the same Device Orientation the Cube Matrix
        # is sent the value that draws what a Cube Lite (and the preview)
        # draws. Every effect confirmed on both lamps already did.
        import dataclasses
        CONST = import_pure_module("effect_catalog")
        MOUNT_PROFILE = import_pure_module("mount_profile")
        table, reference = MOUNT_PROFILE.DIRECTION_TABLE, MOUNT_PROFILE.REFERENCE_PROFILE
        rotations = {"right": 0, "down": 1, "left": 2, "up": 3}
        light = FakeLight()
        checked = 0
        for name, spec in CONST.ALL_NATIVE_EFFECTS.items():
            if (name in EFFECTS.MATRIX_EFFECTS or spec.get("one_axis") or not spec.get("directions")
                    or spec["mode"] not in EFFECTS.ENGINE_MODES or spec["mode"] in EFFECTS.APP_DIRECTION_MODES):
                continue
            light._native_effect = name
            for orientation, rotation in rotations.items():
                light._device_orientation = orientation
                light._lamp_client.profile = dataclasses.replace(light._lamp_client.profile, rotation=rotation)
                for label in spec["directions"]:
                    light._native_effect_direction = label
                    command = light.matrix_native_command()
                    if command is None or command[0] != "setEffect":
                        continue
                    sent = command[1]["effect"]["effectParams"][0]["direction"]
                    lite = table[reference][CONST.effect_direction_value(spec, label, orientation)]
                    self.assertEqual(lite, table[rotation][sent], (name, orientation, label))
                    checked += 1
        self.assertGreater(checked, 300)

    def test_no_streamed_or_forbidden_mode_goes_over_matter(self):
        CONST = import_pure_module("effect_catalog")
        for name, spec in CONST.ALL_NATIVE_EFFECTS.items():
            light = FakeLight()
            light._native_effect = name
            command = light.matrix_native_command()
            if command is None or command[0] != "setEffect":
                continue
            mode = command[1]["effect"]["effectParams"][0]["mode"]
            self.assertNotIn(mode, {12, 13, 29, 53, 64, 67, *range(70, 82)}, name)
            self.assertNotIn(mode, {20, 25, 26, 27, 30, 41, 43, 44, 45, 51}, name)   # music: no microphone

    def test_what_the_lamp_cannot_show_is_streamed(self):
        for change in (
            {"_native_effect_color_mode": "palette", "_text_colors": [[1, 1, 1], [2, 2, 2]]},
            {"_native_effect_color_mode": "bw"},
            {"_native_effect": "Magic"},  # not one of the lamp's effects
            {"_native_effect": "Fireworks", "_native_effect_color_mode": "bw"},
            # The Cube Lite's own 70-81: streamed.
            {"_native_effect": "Palette stripes"}, {"_native_effect": "Random scatter"},
            {"_native_effect": "Kaleidoscope"}, {"_native_effect": "Neon sine bands"},
        ):
            light = FakeLight()
            light.__dict__.update(change)
            self.assertIsNone(light.matrix_native_command(), change)
            self.assertTrue(run(light._activate_matrix_content()))
            self.assertEqual(["stream"], light.log)

    def test_without_matter_it_is_streamed(self):
        light = FakeLight()
        light._matter = types.SimpleNamespace(linked=False, values={})
        self.assertIsNone(light.matrix_native_command())
        light = FakeLight()
        light._matter_commands.backend = None
        self.assertIsNone(light.matrix_native_command())

    def test_a_refused_command_falls_back_to_the_stream(self):
        light = FakeLight(refuse=True)
        self.assertTrue(run(light._activate_matrix_content()))
        self.assertEqual(["stop_stream", "close_music", "stream"], light.log)
        self.assertIsNone(light.matrix_native_command())  # until the next activation

    def test_the_clock(self):
        light = FakeLight()
        light._mode = "Clock"
        name, payload = light.matrix_native_command()
        self.assertEqual("setEffect", name)
        self.assertEqual(EFFECTS.clock_payload((255, 255, 255), 0, 1, -3, False, True, 2, 4), payload)
        run(light._activate_matrix_content())
        self.assertEqual(-3, light._native_clock_timezone_offset)  # sent again when it changes
        # Its background; one it has not is streamed.
        light._native_clock_style = 1
        self.assertEqual(39, light.matrix_native_command()[1]["effect"]["effectParams"][0]["mixer"])
        light._native_clock_style = 15
        self.assertIsNone(light.matrix_native_command())

    def test_the_clock_needs_four_matrix_modules(self):
        light = FakeLight("1,1,1,1,3,3,0,0,")
        light._mode = "Clock"
        self.assertIsNone(light.matrix_native_command())

    def test_a_drawing_then_its_pixels(self):
        light = FakeLight()
        wire = light.device_profile.to_wire([(3, 2, 1)] * 100)
        run(light._draw_matrix_frame(wire))
        run(light._draw_matrix_frame(wire))
        sent = [entry for entry in light.log if isinstance(entry, tuple) and entry[0] == "matter"]
        self.assertEqual(["setEffect", "setData"], [entry[2] for entry in sent])
        self.assertEqual(36, sent[0][3]["effect"]["effectId"])
        self.assertLess(light.log.index("close_music"), light.log.index(sent[0]))

    def test_its_text_changes_and_scrolls_over_its_own_drawing(self):
        # The drawing over Matter is the lamp's drawing effect, but shows
        # Home Assistant's picture: a new text and the scroll steps replace
        # it (they were held back as competing with the lamp's own content,
        # so a long text never scrolled on a Cube Matrix).
        light = FakeLight()
        light._mode = "Text Color Sequence"
        run(light._draw_matrix_frame(light.device_profile.to_wire([(3, 2, 1)] * 100)))
        light._execute_hardware_op = mock.AsyncMock()
        run(light.async_apply_display_mode("text_change"))
        run(light.async_apply_display_mode())  # a scroll step
        self.assertEqual(2, light._execute_hardware_op.await_count)
        # The lamp's own content (its effect, the Yeelight app) still keeps them out.
        light._entered_builtin_mode()
        light._execute_hardware_op.reset_mock()
        run(light.async_apply_display_mode("text_change"))
        run(light.async_apply_display_mode())
        light._execute_hardware_op.assert_not_awaited()
        # Back in direct mode: nothing is held back.
        light._entered_direct_mode()
        run(light.async_apply_display_mode("text_change"))
        light._execute_hardware_op.assert_awaited_once()


class MatterChangeTests(unittest.TestCase):
    def test_matter_becoming_available_shows_it_the_lamp_s_way(self):
        light = FakeLight()
        light.hass = object()
        tasks = []

        def track(coro, name=None):
            tasks.append(name)
            coro.close()

        light._create_tracked_task = track
        light.async_apply_display_mode = lambda update_type: asyncio.sleep(0)
        # Streamed so far, the lamp can show it now: shown again.
        MATRIX_SETTINGS.MatrixSettingsMixin._matrix_matter_changed(light)
        self.assertEqual(1, len(tasks))
        # Already the lamp's: nothing to do.
        light._matrix_shown = ("setPresetsEffect", {})
        MATRIX_SETTINGS.MatrixSettingsMixin._matrix_matter_changed(light)
        self.assertEqual(1, len(tasks))
        # The lamp's, and Matter went away: streamed again.
        light._matter = types.SimpleNamespace(linked=False, values={})
        MATRIX_SETTINGS.MatrixSettingsMixin._matrix_matter_changed(light)
        self.assertEqual(2, len(tasks))
        self.assertIsNone(light._matrix_shown)

    def test_after_matter_failed_it_is_tried_again(self):
        # 2026-11-14: the lamp reloaded while the router restarted; Waves
        # failed over Matter and stayed streamed over the LAN (5 fps) after
        # Matter came back. Now Matter is tried again.
        light = FakeLight()
        light.hass = object()

        def shown_again():  # FakeLight's _matrix_matter_changed: what is selected, shown again
            return light.log.count("matter_changed")

        light._matrix_refused_at, light._matrix_retry_after = 0.0, MATRIX.MATTER_RETRY_FIRST
        light._matrix_stream_failures = 0
        clock = [1000.0]
        retry = MATRIX_SETTINGS.MatrixSettingsMixin._retry_matrix_native
        with mock.patch.object(MATRIX.time, "monotonic", lambda: clock[0]):
            MATRIX_SETTINGS.MatrixSettingsMixin._refuse_matrix_native(light)
            self.assertTrue(light._matrix_native_refused)
            self.assertIsNone(MATRIX.MatrixMixin.matrix_native_command(light))
            # Not at once from the minute check, nor straight after the failure.
            clock[0] += 30
            self.assertFalse(retry(light))
            clock[0] -= 25
            self.assertFalse(retry(light, link_back=True))
            # The link coming back tries it after a few seconds...
            clock[0] += 10
            self.assertTrue(retry(light, link_back=True))
            self.assertFalse(light._matrix_native_refused)
            self.assertEqual(1, shown_again())  # shown again, the lamp's way
            self.assertEqual(2 * MATRIX.MATTER_RETRY_FIRST, light._matrix_retry_after)
            # ...failing again, the minute check waits twice as long.
            MATRIX_SETTINGS.MatrixSettingsMixin._refuse_matrix_native(light)
            clock[0] += MATRIX.MATTER_RETRY_FIRST
            self.assertFalse(retry(light))
            clock[0] += MATRIX.MATTER_RETRY_FIRST
            self.assertTrue(retry(light))
            self.assertEqual(2, shown_again())
            # Never past the most.
            for _ in range(20):
                MATRIX_SETTINGS.MatrixSettingsMixin._refuse_matrix_native(light)
                clock[0] += MATRIX.MATTER_RETRY_MOST
                retry(light)
            self.assertEqual(MATRIX.MATTER_RETRY_MOST, light._matrix_retry_after)
            # Nothing to retry without Matter, or when it never failed.
            MATRIX_SETTINGS.MatrixSettingsMixin._refuse_matrix_native(light)
            light._matter = types.SimpleNamespace(linked=False, values={})
            clock[0] += MATRIX.MATTER_RETRY_MOST
            self.assertFalse(retry(light))
        light._matrix_native_refused = False
        self.assertFalse(retry(light))
        light_source = (ROOT / "light_lifecycle.py").read_text(encoding="utf-8")
        check = light_source.split("def _async_check_problems", 1)[1].split("    def ", 1)[0]
        self.assertIn("self._retry_matrix_native()", check)
        matter_source = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_matter*.py")))
        self.assertIn("retry(link_back=True)", matter_source)


class ModuleListTests(unittest.TestCase):
    """2026-11-14: the owner fitted a Spot module third (the Yeelight app's
    module splicing wrote 2,2,3,2). The modules can be set from Home
    Assistant too (set_matrix_modules: FC02 updateTopology over Matter, as
    the app's own Save), and the layout follows."""

    def test_the_list_is_written_over_matter_and_the_layout_follows(self):
        light = FakeLight()
        run(light.async_set_matrix_modules(["matrix", "matrix", "spot", "matrix"]))
        self.assertLess(light.log.index("close_music"), light.log.index(
            ("matter", COMMANDS.CUBE_CONTROL_CLUSTER, "updateTopology", {"topology": [2, 2, 3, 2]})))
        profile = light.device_profile
        self.assertEqual((2, 2, 3, 2), profile.module_types)
        self.assertEqual((25, 25, 5, 25), profile.slots)
        # The spot takes a module's place: 20 columns, the spot 10-14.
        self.assertEqual(20, profile.columns)
        self.assertEqual({"type": "spot", "column": 10}, profile.layout[2])

    def test_blocks_taken_off_the_list_are_left_black(self):
        # Filmed 2026-11-20: a block the lamp no longer lists keeps its last
        # picture. Switched off while still listed, then the shorter list:
        # black. Switched on again afterwards, its content drawn again.
        light = FakeLight()
        light._is_on = True
        with mock.patch.object(MATRIX_SETTINGS, "MODULES_BLANK_SETTLE", 0):
            run(light.async_set_matrix_modules(["matrix", "matrix", "spot", "matrix"]))
            light.log.clear()
            run(light.async_set_matrix_modules(["matrix", "panel", "spot"]))
        matter = [entry[1:3] for entry in light.log if entry and entry[0] == "matter"]
        self.assertEqual([(6, "Off"), (COMMANDS.CUBE_CONTROL_CLUSTER, "updateTopology"), (6, "On")], matter[:3])
        self.assertEqual((2, 1, 3), light.device_profile.module_types)
        # As many blocks and Spots or more: nothing switched.
        light.log.clear()
        with mock.patch.object(MATRIX_SETTINGS, "MODULES_BLANK_SETTLE", 0):
            run(light.async_set_matrix_modules(["matrix", "matrix", "spot", "matrix"]))
        self.assertNotIn(6, [entry[1] for entry in light.log if entry and entry[0] == "matter"])
        # Off in Home Assistant: blacked, and left off.
        light._is_on = False
        light.log.clear()
        with mock.patch.object(MATRIX_SETTINGS, "MODULES_BLANK_SETTLE", 0):
            run(light.async_set_matrix_modules(["matrix"]))
        matter = [entry[1:3] for entry in light.log if entry and entry[0] == "matter"]
        self.assertEqual([(6, "Off"), (COMMANDS.CUBE_CONTROL_CLUSTER, "updateTopology")], matter)

    def test_a_spot_taken_off_the_list_is_left_dark(self):
        # 2026-11-21: matrix, panel, spot -> matrix, panel left the Spot lit:
        # the lamp drops the Spots' output when none is listed, and the
        # blocks' count had not changed, so nothing was switched off first.
        light = FakeLight()
        light._is_on = True
        with mock.patch.object(MATRIX_SETTINGS, "MODULES_BLANK_SETTLE", 0):
            run(light.async_set_matrix_modules(["matrix", "panel", "spot"]))
            light.log.clear()
            run(light.async_set_matrix_modules(["matrix", "panel"]))
        matter = [entry[1:3] for entry in light.log if entry and entry[0] == "matter"]
        self.assertEqual([(6, "Off"), (COMMANDS.CUBE_CONTROL_CLUSTER, "updateTopology"), (6, "On")], matter[:3])
        # A Spot moved, none taken off: nothing switched.
        light.log.clear()
        with mock.patch.object(MATRIX_SETTINGS, "MODULES_BLANK_SETTLE", 0):
            run(light.async_set_matrix_modules(["matrix", "spot"]))
            light.log.clear()
            run(light.async_set_matrix_modules(["spot", "matrix"]))
        self.assertNotIn(6, [entry[1] for entry in light.log if entry and entry[0] == "matter"])

    def test_matter_s_list_is_taken_at_link_when_the_lan_could_not_be_read(self):
        # 2026-11-14: HA restarted while the lamp's LAN was stuck: setup read
        # no layout and the default 4 Matrix modules stayed, though Matter
        # reported 2,2,3,2.
        light = FakeLight()
        light._on_matrix_report("topology", [2, 2, 3, 2, 0, 0, 0, 0], True)
        self.assertEqual((2, 2, 3, 2), light.device_profile.module_types)
        # Read over the LAN at setup: the lamp's own answer stays.
        light = FakeLight()
        light._lamp_client.capabilities = {"cube_topology": "2,2,2,2,0,0,0,0,"}
        light._on_matrix_report("topology", [2, 2, 3, 2, 0, 0, 0, 0], True)
        self.assertEqual((2, 2, 2, 2), light.device_profile.module_types)

    def test_the_lamp_s_own_list_wins_over_the_server_s_copy(self):
        # 2026-11-21: the server's copy (2,1,3) was a list of the night before;
        # the lamp, read over Matter, had 2,2,1,3,2.
        light = FakeLight()

        class Link:
            values = {"topology": [2, 1, 3, 0, 0, 0, 0, 0]}

            async def async_read_live(self, name):
                return [2, 2, 1, 3, 2, 0, 0, 0] if name == "topology" else None

        light._matter = Link()
        light._on_matrix_report("topology", [2, 1, 3, 0, 0, 0, 0, 0], True)
        self.assertEqual((2, 1, 3), light.device_profile.module_types)
        run(light._matrix_read_modules())
        self.assertEqual((2, 2, 1, 3, 2), light.device_profile.module_types)

    def test_a_list_it_cannot_take_is_refused_before_anything_is_sent(self):
        light = FakeLight()
        for modules in ([], ["matrix"] * 9, ["matrix", "lamp"]):
            with self.subTest(modules=modules), self.assertRaises(Exception):
                run(light.async_set_matrix_modules(modules))
        light._matter = types.SimpleNamespace(linked=False, values={})
        with self.assertRaises(Exception):
            run(light.async_set_matrix_modules(["matrix"]))
        self.assertFalse([entry for entry in light.log if entry and entry[0] == "matter"])


class RestartRotationTests(unittest.TestCase):
    """The Cube Matrix saves a written rotation only with a later request,
    and never while its music mode is on (2026-11-12: written with a music
    connection open, it came back with the one before after a power cut).
    A rotation it reports as it restarts is that older one: written again,
    never followed."""

    ROTATIONS = {"right": 0, "down": 1, "left": 2, "up": 3}

    def light(self):
        light = FakeLight()
        light.hass = object()
        light._device_orientation = "up"
        light._lamp_client.profile = dataclasses.replace(light._lamp_client.profile, rotation=3)
        light._rotation_for = self.ROTATIONS.get
        light.async_apply_display_mode = lambda update_type: asyncio.sleep(0)

        async def sync(orientation, force=False):
            light.log.append(("write", orientation, force))
            return True

        light._sync_lamp_rotation = sync
        light._create_tracked_task = lambda coro, name=None: run(coro)
        return light

    def test_reported_after_the_restart_it_is_written_again(self):
        light = self.light()
        MATRIX_FOLLOW.MatrixFollowMixin._matrix_lamp_restarted(light)
        MATRIX_FOLLOW.MatrixFollowMixin._matrix_rotated(light, 0)
        self.assertIn(("write", "up", True), light.log)
        self.assertNotIn(("orientation", "right"), light.log)
        self.assertEqual(3, light._lamp_client.profile.rotation)

    def test_reported_just_before_the_restart_it_is_undone(self):
        light = self.light()
        MATRIX_FOLLOW.MatrixFollowMixin._matrix_rotated(light, 0)       # taken for the app's at first
        self.assertIn(("orientation", "right"), light.log)
        light._device_orientation = "right"
        MATRIX_FOLLOW.MatrixFollowMixin._matrix_lamp_restarted(light)
        self.assertEqual(("orientation", "up"), light.log[-1])

    def test_a_change_in_the_app_is_still_followed(self):
        light = self.light()
        MATRIX_FOLLOW.MatrixFollowMixin._matrix_rotated(light, 2)
        self.assertEqual([("orientation", "left")], [e for e in light.log if e[0] in ("orientation", "write")])
        # A restart long after does not undo it.
        light._device_orientation = "left"
        light._matrix_turned_from = (light._matrix_turned_from[0] - MATRIX.MATRIX_RESTART_WINDOW, "up")
        MATRIX_FOLLOW.MatrixFollowMixin._matrix_lamp_restarted(light)
        self.assertNotIn(("orientation", "up"), light.log)

    def lan_unread(self, live):
        """A Home Assistant start with the lamp's LAN stuck: the server's
        copy is 0 (right), from before Home Assistant wrote 3 (up)."""
        light = self.light()
        light._lamp_client.capabilities = {}
        light._lamp_client.profile = dataclasses.replace(light._lamp_client.profile, rotation=None)

        class Link:
            values = {"rotation": 0}

            async def async_read_live(self, name):
                return live if name == "rotation" else None

        light._matter = Link()
        light.async_write_ha_state = lambda: None
        light._on_matrix_report("rotation", 0, True)
        return light

    def test_after_a_restart_the_lamp_s_own_rotation_is_followed(self):
        light = self.lan_unread(3)
        self.assertEqual(3, light._lamp_client.profile.rotation)
        self.assertFalse([e for e in light.log if e[0] in ("orientation", "write")])

    def test_unread_the_server_s_old_copy_is_never_written_to_the_lamp(self):
        light = self.lan_unread(None)
        self.assertFalse([e for e in light.log if e[0] in ("orientation", "write")])
        self.assertEqual("up", light._device_orientation)

    def test_our_music_connection_is_closed_before_the_rotation_is_written(self):
        source = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_matter*.py")))
        write = source.split("async def _sync_lamp_rotation", 1)[1]
        self.assertLess(write.index("cube.close_music_session()"), write.index("channel.async_write(ROTATION, rotation)"))


class DemoLoopTests(unittest.TestCase):
    def test_the_loop_is_seen_in_the_reports(self):
        watch = EFFECTS.DemoLoopWatch()
        seen = [watch.running_changed(t, 0) for t in (0.0, 30.1, 59.9, 120.2)]  # one tick unseen
        self.assertEqual([False, False, False, True], seen)

    def test_not_from_requested_effects_or_other_rhythms(self):
        watch = EFFECTS.DemoLoopWatch()
        self.assertFalse(any(watch.running_changed(t, 0) for t in (0.0, 12.0, 30.0, 61.0, 75.0)))
        watch = EFFECTS.DemoLoopWatch()
        for t in (0.0, 30.0, 60.0):
            watch.running_changed(t, 0)
        self.assertFalse(watch.running_changed(90.0, 39))  # someone asked for one

    def test_read_over_the_lan_it_keeps_everything_streamed(self):
        light = FakeLight(demo="1")
        self.assertTrue(light.matrix_demo_mode)
        self.assertIsNone(light.matrix_native_command())
        self.assertFalse(light.matrix_draws_over_matter())
        self.assertFalse(FakeLight(demo="0").matrix_demo_mode)

    def test_seen_over_matter_it_is_reported(self):
        clock = [1000.0]
        real, MATRIX_FOLLOW.time = MATRIX_FOLLOW.time, types.SimpleNamespace(monotonic=lambda: clock[0])
        try:
            light = FakeLight()
            light.hass = object()
            light._matrix_command_at = 0.0
            for effect in (15, 34, 42):  # FC05's effect stays 0
                light._on_matrix_report("running_effect", effect, False)
                self.assertFalse(light.matrix_demo_mode)
                clock[0] += 30.0
            light._on_matrix_report("running_effect", 17, False)  # the third 30 s
        finally:
            MATRIX_FOLLOW.time = real
        self.assertTrue(light.matrix_demo_mode)
        self.assertIn("check_problems", light.log)  # the Repair
        self.assertIn("matter_changed", light.log)  # streamed from now on
        # A lamp read out of it (a factory reset) is out of it.
        light._set_matrix_demo(lan=False)
        self.assertFalse(light.matrix_demo_mode)

    def test_reports_of_someone_else_s_effect(self):
        light = FakeLight()
        light._matrix_shown = ("setPresetsEffect", {})
        light._matrix_command_at = -100.0
        light._on_matrix_report("running_effect", 42, False)
        self.assertIsNone(light._matrix_shown)
        light._on_matrix_report("on_off", False, False)
        self.assertEqual([False], light.switched)
        light.hass, light._device_orientation, tasks = object(), "right", []

        def track(coro, name=None):
            asyncio.run(coro)
            tasks.append(name)

        light._create_tracked_task = track
        light._on_matrix_report("rotation", 3, False)   # stood on its base in the app
        self.assertEqual(3, light.device_profile.rotation)
        self.assertIn(("orientation", "up"), light.log)
        self.assertEqual(1, len(tasks))

    def test_its_own_echo_is_not_someone_else(self):
        light = FakeLight()
        light._matrix_shown = ("setPresetsEffect", {})
        light._matrix_command_at = time.monotonic()
        light._on_matrix_report("running_effect", 39, False)
        self.assertIsNotNone(light._matrix_shown)


class SetModelTests(unittest.TestCase):
    """LampClient.set_model on a Cube Matrix, run for real (the setup path
    a broken attribute once took down)."""

    def test_a_cube_matrix_is_set_up(self):
        import logging
        from test_cube_transport import lamp_client as CUBE
        lamp = CUBE.LampClient.__new__(CUBE.LampClient)
        lamp._ip, lamp._port, lamp.capabilities = "192.168.4.189", 55443, {}
        lamp.device_model, lamp.profile = "CubeMatrix", PROFILE.CUBE_LITE_PROFILE
        lamp._udp = types.SimpleNamespace(close=lambda: None)
        lamp.device = types.SimpleNamespace(send_command=lambda method, params: {
            "result": ["2,2,2,2,0,0,0,0,", "3", "100", "0"]})
        logging.getLogger(CUBE.__name__).setLevel(logging.DEBUG)
        try:
            lamp.set_model("CubeMatrix")
        finally:
            logging.getLogger(CUBE.__name__).setLevel(logging.WARNING)
        self.assertEqual((4, 3, "up", "0"), (lamp.profile.modules, lamp.profile.rotation, lamp.profile.orientation,
                                             lamp.capabilities["show_off_mode"]))
        self.assertIsInstance(lamp._udp, CUBE.MusicChannel)


class TcpSlotTests(unittest.TestCase):
    """A Cube Matrix has 3 TCP client slots; its music connection (which it
    opens back to Home Assistant) needs one. Filmed 2026-11-09: with the
    integration's fallback and library sockets open, the lamp dropped the
    music connection at once, streams stopped, the TCP fallback used up its
    quota and its LAN side stalled until a power cycle."""

    def lamp(self):
        from test_cube_transport import lamp_client as CUBE
        lamp = CUBE.LampClient.__new__(CUBE.LampClient)
        lamp._ip, lamp._port = "192.168.4.189", 55443
        log = []

        class Music(CUBE.MusicChannel):
            opened = False

            @property
            def is_open(self):
                return self.opened

            async def request(self, method, params=None):
                log.append(("music", method))
                self.opened = True
                return None

        lamp._udp = Music("192.168.4.189")
        lamp.close_fast_socket = lambda: log.append("close_fast")
        lamp._drop_library_socket = lambda abortive=False: log.append("drop_library")
        lamp._settle_frame = lambda command, params: None
        lamp._udp_usable = lambda: True
        lamp._running_effect = None
        return CUBE, lamp, log

    def test_our_sockets_close_before_the_music_connection_opens(self):
        CUBE, lamp, log = self.lamp()
        try:
            asyncio.run(lamp._udp_request("activate_fx_mode", [{"mode": "direct"}]))
        except Exception:  # noqa: BLE001 -- the bookkeeping after the request is not under test
            pass
        self.assertEqual(["close_fast", "drop_library", ("music", "activate_fx_mode")], log[:3])
        # Open: not again.
        log.clear()
        try:
            asyncio.run(lamp._udp_request("update_leds", ["AAAA"]))
        except Exception:  # noqa: BLE001
            pass
        self.assertNotIn("close_fast", log)

    def test_no_frame_or_direct_mode_over_tcp_and_no_kept_connection(self):
        from test_cube_transport import protocol
        CUBE, lamp, log = self.lamp()
        lamp._udp_usable = lambda: False   # the music connection failed: TCP fallback
        lamp._udp_retry_at = 0.0
        lamp._check_supported = lambda command, params=None: None
        for command, params in (("update_leds", ["AAAA"]), ("activate_fx_mode", [{"mode": "direct"}])):
            with self.assertRaises(protocol.CubeConnectionError, msg=command):
                asyncio.run(lamp.send_command_fast(command, params))
        self.assertIn("close_fast", log)
        sent = []

        async def raw(command, params=None, udp=True, **kwargs):
            sent.append((command, udp))

        lamp.send_raw_command = raw
        lamp._check_supported = lambda command, params=None: None
        self.assertTrue(asyncio.run(lamp.send_command_fast("set_bright", [50])))
        self.assertEqual([("set_bright", False)], sent)   # one-shot, not the kept socket

    def test_a_failed_music_connection_is_tried_again_soon(self):
        from test_cube_transport import client_udp
        CUBE, lamp, log = self.lamp()
        self.assertEqual(30.0, client_udp.MUSIC_RETRY_AFTER)
        source = lamp_client_source()
        # 30 s, then later while it keeps failing (each try stalls the lamp).
        self.assertEqual((30.0, 300.0, 1800.0), client_udp.MUSIC_RETRY_STEPS)
        self.assertIn("retry = MUSIC_RETRY_STEPS[min(self._music_failures, len(MUSIC_RETRY_STEPS) - 1)]", source)
        # The library's socket is never kept open on a Cube Matrix.
        self.assertIn("if isinstance(self._udp, MusicChannel):\n                    # A Cube Matrix: no library connection kept open", source)


class SetupTests(unittest.TestCase):
    """The light setup and the old entry ("CubeMatrix 6a80": no stored
    model, made when every lamp was a Cube Lite)."""

    def setUp(self):
        self.light = (ROOT / "light.py").read_text(encoding="utf-8")
        self.lamp = lamp_client_source()

    def test_an_entry_without_a_model_learns_it(self):
        # From SSDP (the running Home Assistant gets "CubeMatrix"), else by
        # asking the lamp: a Cube Matrix answers get_prop, a Cube Lite never.
        self.assertIn('entry, data={**entry.data, CONF_MODEL: lamp_client.capabilities["model"]}', self.light)
        # No answer is asked again at the next start; a Cube Lite only after
        # MODEL_PROBE_STARTS starts without one.
        self.assertIn("model = await timed(\"Asking its model\", lamp_client.probe_model)\n", self.light)
        self.assertIn("if not model and misses >= MODEL_PROBE_STARTS:\n                model = \"CubeLite\"", self.light)
        self.assertIn('if not (values and str(values[0]).strip(", 0")):', self.lamp)

    def test_the_probe(self):
        cube = runpy.run_path(str(ROOT / "device_profile.py"))
        del cube
        namespace = {}
        client = (ROOT / "lamp_client.py").read_text(encoding="utf-8")
        source = client[client.index("    def _read_props"):client.index("    def _check_supported")]
        exec("import logging\n_LOGGER = logging.getLogger('t')\nCONNECT_TIMEOUT = 0.5\n"
             "MATRIX_READ_TIMEOUT = 2.0\nclass C:\n" + source, namespace)
        lamp = namespace["C"]()
        lamp._ip, lamp.models = "x", []
        lamp.set_model = lamp.models.append
        lamp._drop_library_socket = lambda: None
        lamp.device = types.SimpleNamespace(send_command=lambda method, params: {"result": ["2,2,2,2,0,0,0,0,"]})
        self.assertEqual("CubeMatrix", lamp.probe_model())
        self.assertEqual(["CubeMatrix"], lamp.models)

        calls = []

        def silent(method, params):
            calls.append(lamp.device._timeout)
            raise OSError("no answer")
        lamp.device = types.SimpleNamespace(send_command=silent, _timeout=0.5)
        # No answer: not stored as a Cube Lite (a Cube Matrix can answer
        # late); asked twice with the longer wait, which is then put back.
        self.assertIsNone(lamp.probe_model())
        self.assertEqual([2.0, 2.0], calls)
        self.assertEqual(0.5, lamp.device._timeout)
        self.assertEqual(["CubeMatrix"], lamp.models)

    def test_its_demo_loop_is_read_with_its_layout(self):
        self.assertIn('self._read_props(["cube_topology", "rotation_angle", "strip_lenth", "show_off_mode"])', self.lamp)

    def test_cube_lite_only_entities_of_an_old_entry_are_removed(self):
        for name, marker in (("switch.py", "[switch.unique_id for switch in cube_lite_only]"),
                             ("select.py", "for suffix in sorted(CUBE_LITE_ONLY_SELECTS)"),
                             ("event.py", '_lamp_buttons"])')):
            self.assertIn(marker, (ROOT / name).read_text(encoding="utf-8"), name)

    def test_the_cube_matrix_link_is_its_own(self):
        matter = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_matter*.py")))
        self.assertIn("products=(self.device_profile.matter_product,), reported=MATRIX_REPORTED", matter)
        # The Cube Lite's button playlist and orientation check are not run.
        self.assertIn("if self.device_profile.matter:\n            self.sync_remote_playlist()", matter)

    def test_stale_nodes_go_only_once_the_new_node_answers(self):
        matter = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_matter*.py")))
        check = matter[matter.index("        async def check() -> None:"):]
        self.assertLess(check.index("await channel.async_available()"),
                        check.index("await self._matter.remove_stale_nodes()"))
        self.assertIn("if channel.backend and self._matter is not None and self._matter.stale_node_ids:", check)

    def test_the_display_draws_over_matter_first(self):
        display = (ROOT / "light_display.py").read_text(encoding="utf-8")
        self.assertLess(display.index("await self._apply_matrix_drawing(off_frame)"),
                        display.index("await self.ensure_fx_ready()\n            # The lamp's hardware brightness"))


class MatrixVersionTests(unittest.TestCase):
    """Three slots a Cube Matrix draws as another effect (2026-11-12, both
    lamps side by side): effects of their own (effect_catalog.MATRIX_VERSION_EFFECTS),
    shown by the Cube Matrix itself, the Cube Lite's streamed to it."""

    CONST = import_pure_module("effect_catalog")

    def test_each_version_and_the_effect_it_comes_from(self):
        self.assertEqual(
            {"Northern Lights": "Aurora", "Rose Sea": "Flower Sea",
             "Dark palette pulses": "Triangular palette pulses"},
            self.CONST.MATRIX_VERSIONS,
        )
        for name, lite in self.CONST.MATRIX_VERSIONS.items():
            self.assertEqual(self.CONST.ALL_NATIVE_EFFECTS[lite]["mode"], self.CONST.ALL_NATIVE_EFFECTS[name]["mode"])
        # A Cube Lite has no renderer for two of them: streamed.
        self.assertEqual(
            {"Rose Sea", "Dark palette pulses", *self.CONST.STREAMED_EFFECTS},
            set(self.CONST.LITE_STREAMED_EFFECTS),
        )
        # Northern Lights runs on a Cube Lite sent no colour (its own aurora
        # palette), where Aurora is sent green.
        self.assertNotIn("color", self.CONST.ALL_NATIVE_EFFECTS["Northern Lights"])
        self.assertIsNotNone(self.CONST.ALL_NATIVE_EFFECTS["Aurora"]["color"])

    def test_the_cube_matrix_shows_its_versions_and_streams_the_cube_lite_s(self):
        light = FakeLight()
        light._native_effect = "Northern Lights"
        name, payload = light.matrix_native_command()
        self.assertEqual(("setPresetsEffect", 15), (name, payload["effectId"]))
        self.assertNotIn("color", payload)
        for effect, mode in (("Rose Sea", 55), ("Dark palette pulses", 9)):
            light._native_effect = effect
            name, payload = light.matrix_native_command()
            params = payload["effect"]["effectParams"][0]
            self.assertEqual(("setEffect", mode), (name, params["mode"]), effect)
            self.assertNotIn("color", params, effect)  # its own palette, black words
        for effect in ("Aurora", "Flower Sea", "Triangular palette pulses"):
            light._native_effect = effect
            self.assertIsNone(light.matrix_native_command(), effect)

    def test_what_the_lamp_runs_is_named_as_its_version(self):
        self.assertEqual("Northern Lights", MATRIX.matrix_effect_name(15))
        self.assertEqual("Rose Sea", MATRIX.matrix_effect_name(55))
        self.assertEqual("Dark palette pulses", MATRIX.matrix_effect_name(9))

    def test_its_clock_over_them_is_streamed(self):
        light = FakeLight()
        light._mode = "Clock"
        for style_id, style in self.CONST.NATIVE_CLOCK_STYLES.items():
            if style.get("background") or self.CONST.clock_style_effect(style) in self.CONST.LITE_VERSIONS:
                light._native_clock_style = style_id
                light._clock_style = lambda style=style: style
                self.assertIsNone(light.matrix_native_command(), style["name"])

    def test_a_clock_style_over_each(self):
        styles = {style["name"]: style for style in self.CONST.NATIVE_CLOCK_STYLES.values()}
        for name in self.CONST.MATRIX_VERSIONS:
            self.assertEqual(name, self.CONST.clock_style_effect(styles[name]))
        self.assertEqual("Flower Sea", self.CONST.clock_style_effect(styles["Flower Sea"]))
        self.assertEqual([], self.CONST.clock_style_colors(styles["Northern Lights"]))

    def test_the_renderers_draw_the_cube_matrix_s_look(self):
        rose = RENDERERS.lamp_settings("Rose Sea", "Right", 128)
        flower = RENDERERS.lamp_settings("Flower Sea", "Right", 128)
        self.assertEqual(("matrix", None), (rose.get("variant"), flower.get("variant")))
        self.assertNotEqual(RENDERERS.renderer_frame(rose, 50), RENDERERS.renderer_frame(flower, 50))
        # Rose Sea: the far rows dimmer than the first (its gain per row).
        dark = RENDERERS.lamp_settings("Dark palette pulses", "Right", 128)
        light = RENDERERS.lamp_settings("Triangular palette pulses", "Right", 128)
        self.assertEqual([(0, 0, 0)] * 4, CORE.effect_colours(dark)["words"])
        self.assertNotEqual([(0, 0, 0)] * 4, CORE.effect_colours(light)["words"])
        frames = [RENDERERS.renderer_frame(dark, render) for render in range(0, 200, 10)]
        lit = [sum(1 for pixel in frame if any(pixel)) for frame in frames]
        self.assertTrue(any(lit) and min(lit) < 100)  # pulses on black

    def test_a_cube_lite_streams_what_it_can_t_run(self):
        # An effect, or a clock over a background, that a Cube Lite does not
        # have (a Cube Matrix's version, the integration's own) is streamed;
        # and never put on its physical button.
        for effect in self.CONST.LITE_STREAMED_EFFECTS:
            light = make_light(_mode="Native Effect", _native_effect=effect, _native_effect_color_mode="normal")
            self.assertTrue(light.studio_selected(), effect)
        for style_id, style in self.CONST.NATIVE_CLOCK_STYLES.items():
            if style.get("background") in self.CONST.LITE_STREAMED_EFFECTS:
                light = make_light(_mode="Clock", _native_clock_style=style_id)
                self.assertTrue(light.studio_selected(), style["name"])
                with self.assertRaises(ValueError):
                    light._effect_persist_item(self.CONST.BUTTON_CLOCK_PREFIX + style["name"])
        self.assertFalse(make_light(_mode="Native Effect", _native_effect="Rainbow").studio_selected())


if __name__ == "__main__":
    unittest.main()
