"""Cube Matrix fixes from the review of its notes (docs/CUBE_MATRIX.md):
commands it lists but must never get, the button playlist, its model when it
answers late, and a new DHCP address followed through its Matter node."""

import asyncio
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module  # noqa: E402
from test_matter_link import CUBE_ATTRIBUTES, LAMP_IP, LAMP_MAC, MATTER, FakeClient, hass_with, node  # noqa: E402
from test_native_features import (  # noqa: E402
    CONSTANTS, LIGHT_SOURCE, ROOT, _load_standalone_functions,
)
from fakes import FakeCube, FakeHass, instant_sleeps, make_light, module, run  # noqa: E402

PROFILE = import_pure_module("device_profile")
LINK = import_pure_module("matter_link")


MATRIX_MODULE = import_pure_module("light_matrix")


class RefusedCommandTests(unittest.TestCase):
    def test_listed_but_never_sent_to_a_cube_matrix(self):
        matrix = PROFILE.profile_for("CubeMatrix")
        for method, params in (
            ("set_default", []),
            ("set_segment_rgb", [0, 0]),
            ("cron_get", [0]),
            ("cron_add", [0, 5]),
            ("set_adjust", ["increase", "ct"]),
            ("set_adjust", ["decrease", "CT"]),
            ("get_prop", ["power", "def_fx"]),
            ("get_prop", ["hp_fx"]),
        ):
            self.assertIsNotNone(matrix.refusal(method, params), (method, params))
        for method, params in (
            ("set_adjust", ["increase", "bright"]),
            ("get_prop", ["power", "cube_topology"]),
            ("set_power", ["off"]),
            ("update_leds", ["AAAA"]),
        ):
            self.assertIsNone(matrix.refusal(method, params), (method, params))

    def test_a_cube_lite_is_not_concerned(self):
        self.assertIsNone(PROFILE.CUBE_LITE_PROFILE.refusal("set_default", []))

    def test_its_own_list_when_ssdp_gave_none(self):
        # No multicast: no support: list; a Cube Lite command still never
        # reaches it.
        matrix = PROFILE.profile_for("CubeMatrix")
        self.assertEqual(30, len(PROFILE.CUBEMATRIX_SUPPORT))
        self.assertEqual(PROFILE.CUBEMATRIX_SUPPORT, matrix.support)
        self.assertFalse(matrix.accepts("set_fx_effect"))
        self.assertFalse(matrix.accepts("set_ps"))
        self.assertTrue(matrix.accepts("update_leds"))

    def test_every_way_out_checks_it(self):
        # What a Cube Matrix must never be sent (set_adjust on ct restarts it)
        # is refused on every way out, before any connection: a command, a
        # debug query, and the debug action calling the library directly.
        cube = module("lamp_client")
        refused = ("set_adjust", ["increase", "ct"])
        connection = cube.LampClient("192.0.2.10", 55443)
        connection.profile = PROFILE.profile_for("CubeMatrix", (), "2,2,2,2,0,0,0,0,", "100", 0)
        no_network = AssertionError("no connection may be opened")
        with mock.patch.object(connection, "_tcp_turn", mock.AsyncMock()) as turn, \
                mock.patch.object(cube.asyncio, "to_thread", side_effect=no_network):
            for send in (connection.send_raw_command, connection.query_raw_command):
                with self.subTest(send.__name__), self.assertRaises(cube.BulbException) as error:
                    asyncio.run(send(*refused))
                self.assertIn("not sent to a Cube Matrix", str(error.exception))
            turn.assert_not_awaited()
        hass = FakeHass({CONSTANTS["DOMAIN"]: {}})
        module("light").async_setup_light_services(hass)
        handler = hass.registered[(CONSTANTS["DOMAIN"], "bulb_call")]
        light = make_light(cube=FakeCube(connection.profile, device=mock.Mock()), hass=hass, entity_id="light.matrix")
        registry = module("light")._ENTITY_REGISTRY
        self.addCleanup(registry.pop, "test-refusal", None)
        registry["test-refusal"] = light
        call = types.SimpleNamespace(
            data={"entity_id": "light.matrix", "member": "send_command", "args": list(refused)},
            hass=hass, context=types.SimpleNamespace(user_id=None),
        )
        answer = asyncio.run(handler(call))
        self.assertFalse(answer["ok"])
        self.assertIn("not sent to a Cube Matrix", answer["error"])
        self.assertEqual([], light._lamp_client.device.mock_calls)


class ButtonPlaylistTests(unittest.TestCase):
    def test_not_written_to_a_cube_matrix(self):
        methods = _load_standalone_functions(LIGHT_SOURCE, {"async_set_button_effects"}, dict(CONSTANTS))
        written = []
        light = types.SimpleNamespace(
            is_cube_matrix=True, _effect_persist_item=lambda name: written.append(name),
        )
        with self.assertRaises(ValueError):
            asyncio.run(methods["async_set_button_effects"](light, ["Rainbow", "Waves"]))
        self.assertEqual([], written)


def matrix_node(node_id, address_b64):
    attributes = {
        **CUBE_ATTRIBUTES,
        LINK.PRODUCT: 16787457,
        "0/51/0": [{"0": "WIFI_STA_DEF", "1": True, "4": "zLqXRDiY", "5": [address_b64]}],
    }
    return node(node_id, attributes)


class NewAddressTests(unittest.TestCase):
    """The Cube Matrix moved from .189 to .188 overnight (no DHCP
    reservation): its Matter node, found by its MAC, gives the new one."""

    def linked(self, address_b64):
        client = FakeClient([matrix_node(8, address_b64)])
        link = LINK.MatterLink(hass_with(client), lambda *args: None, products=(16787457,), reported={})
        self.assertTrue(link.refresh(LAMP_IP, LAMP_MAC))
        return client, link

    def test_the_node_reports_its_address(self):
        client, link = self.linked("wKgEiw==")   # 192.168.4.139
        self.assertEqual(LAMP_IP, link.address())
        client.nodes = [matrix_node(8, "wKgEjA==")]  # 192.168.4.140
        self.assertEqual("192.168.4.140", link.address())

    def test_the_entry_follows_it(self):
        client, link = self.linked("wKgEiw==")
        client.nodes = [matrix_node(8, "wKgEjA==")]
        updates, checks = [], []
        entry = types.SimpleNamespace(data={CONSTANTS["CONF_IP"]: LAMP_IP, "matter_mac": LAMP_MAC})
        light = types.SimpleNamespace(
            _matter=link, _ip=LAMP_IP, _address_check=None,
            hass=types.SimpleNamespace(
                config_entries=types.SimpleNamespace(async_update_entry=lambda entry, data: updates.append(data)),
            ),
            # Tracked: cancelled when the light is removed.
            _create_tracked_task=lambda coro, name=None: checks.append(coro) or "task",
        )
        light._async_follow_address = lambda entry, address: MATTER.MatterMixin._async_follow_address(
            light, entry, address)
        follow = MATTER.MatterMixin._follow_matter_address
        answering = set()

        async def answers(ip):
            return ip in answering

        saved, MATTER.lamp_answers = MATTER.lamp_answers, answers
        try:
            # A check is started; nothing moves before it.
            self.assertTrue(follow(light, entry, LAMP_MAC))
            self.assertEqual([], updates)
            # The lamp still answers at its address: the report is stale.
            answering.update({LAMP_IP, "192.168.4.140"})
            self.assertFalse(asyncio.run(checks.pop()))
            # Nor when it answers nowhere (a wrong report).
            answering.clear()
            follow(light, entry, LAMP_MAC)
            self.assertFalse(asyncio.run(checks.pop()))
            # Silent at its address, answering at the new one: moved.
            answering.add("192.168.4.140")
            follow(light, entry, LAMP_MAC)
            self.assertTrue(asyncio.run(checks.pop()))
            self.assertEqual("192.168.4.140", updates[0][CONSTANTS["CONF_IP"]])
        finally:
            MATTER.lamp_answers = saved
        # Not without the remembered MAC (the node may be another lamp), nor
        # when the address is the same.
        self.assertFalse(follow(light, entry, None))
        light._ip = "192.168.4.140"
        self.assertFalse(follow(light, entry, LAMP_MAC))

    def test_the_matter_discovery_moves_it_too(self):
        flow = (ROOT / "config_flow.py").read_text(encoding="utf-8")
        self.assertIn("mac and entry.data.get(CONF_MATTER_MAC) == mac and entry.data.get(CONF_IP) != ip", flow)


class LateModelTests(unittest.TestCase):
    def test_a_guess_is_never_stored(self):
        flow = (ROOT / "config_flow.py").read_text(encoding="utf-8")
        self.assertNotIn('data.get(CONF_MODEL) or "CubeLite"}', flow)


MATRIX_TESTS = import_pure_module("light_matrix")
EFFECTS = import_pure_module("matrix_effects")


class EffectFixTests(unittest.TestCase):
    def test_triangular_palette_pulses_run_on_the_lamp(self):
        # Its own (filmed: pulses on a black background), not a 5 fps stream:
        # Dark palette pulses (effect_catalog.MATRIX_VERSION_EFFECTS).
        self.assertIn(9, EFFECTS.ENGINE_MODES)
        self.assertNotIn(9, EFFECTS.STREAMED_MODES)
        self.assertNotIn("Triangular palette pulses", EFFECTS.OWN_VERSIONS)

    def test_a_speed_or_direction_change_is_live(self):
        before = EFFECTS.engine_payload(18, 100, None, (), 0)
        after = EFFECTS.engine_payload(18, 140, None, (), 2)
        self.assertEqual([("setRate", {"rate": 140}), ("setDirection", {"direction": 2})],
                         EFFECTS.live_change(("setEffect", before), ("setEffect", after)))
        # Another effect, colour or intensity: the full command.
        self.assertIsNone(EFFECTS.live_change(("setEffect", before), ("setEffect", EFFECTS.engine_payload(19, 100))))
        self.assertIsNone(EFFECTS.live_change(
            ("setEffect", before), ("setEffect", EFFECTS.engine_payload(18, 100, 30, (), 0))))
        self.assertIsNone(EFFECTS.live_change(None, ("setEffect", after)))
        # The app's effects: rate and direction of setPresetsEffect.
        old = EFFECTS.preset_payload("Waves", 100, None, 0)
        new = EFFECTS.preset_payload("Waves", 180, None, 0)
        self.assertEqual([("setRate", {"rate": 180})],
                         EFFECTS.live_change(("setPresetsEffect", old), ("setPresetsEffect", new)))
        self.assertIsNone(EFFECTS.live_change(
            ("setPresetsEffect", old), ("setPresetsEffect", EFFECTS.preset_payload("Waves", 100, (255, 0, 0), 0))))
        # Never the clock or a drawing.
        clock = EFFECTS.clock_payload((255, 255, 255), 0, 1, 8, False, True)
        self.assertIsNone(EFFECTS.live_change(("setEffect", clock), ("setEffect", clock)))

    def test_a_clock_style_over_a_background_sends_no_colour(self):
        payload = EFFECTS.clock_payload(None, 39, 1, 8, False, True)
        self.assertNotIn("color", payload["effect"]["effectParams"][0])
        plain = EFFECTS.clock_payload((255, 0, 0), 0, 1, 8, False, True)
        self.assertEqual([0xFF0000, 0, 0, 0], plain["effect"]["effectParams"][0]["color"])

    def test_the_rate_limits_of_the_renderers(self):
        self.assertEqual(254, EFFECTS.engine_payload(28, 255)["effect"]["effectParams"][0]["speed"])


class SendingTests(unittest.TestCase):
    def setUp(self):
        from test_cube_matrix_matter import FakeLight, run
        self.FakeLight, self.run = FakeLight, run

    def matter(self, light):
        return [entry[2:] for entry in light.log if isinstance(entry, tuple) and entry[0] == "matter"]

    def test_particle_glows_is_sent_twice(self):
        light = self.FakeLight()
        light._native_effect = "Particle glows"
        self.assertTrue(self.run(light._activate_matrix_content()))
        sent = self.matter(light)
        self.assertEqual(["setEffect", "setEffect"], [name for name, _ in sent])
        # Shown first, saved by the second only.
        self.assertEqual([0, 1], [payload["apply"] for _, payload in sent])

    def test_a_speed_change_does_not_restart_the_effect(self):
        light = self.FakeLight()
        light._native_effect = "Sunrise and sunset"
        self.run(light._activate_matrix_content())
        light.log.clear()
        light._native_effect_speed = 150
        self.run(light._activate_matrix_content())
        self.assertEqual([("setRate", {"rate": 150})], [entry[:2] for entry in self.matter(light)])
        self.assertNotIn("close_music", light.log)

    def test_leaving_the_clock_for_a_stream_clears_it(self):
        light = self.FakeLight()
        light._mode = "Clock"
        self.assertTrue(self.run(light._activate_matrix_content()))
        self.assertEqual(2, self.matter(light)[-1][1]["apply"])   # the priority effect
        light.log.clear()
        light._mode, light._native_effect = "Native Effect", "Magic"   # streamed
        self.assertTrue(self.run(light._activate_matrix_content()))
        self.assertEqual([("resetEffect", {})], self.matter(light))
        self.assertIsNone(light._matrix_shown)

    def test_a_clock_style_over_a_background(self):
        light = self.FakeLight()
        light._mode, light._native_clock_style = "Clock", 1   # Rainbow: background 39
        params = light.matrix_native_command()[1]["effect"]["effectParams"][0]
        self.assertEqual(39, params["mixer"])
        self.assertNotIn("color", params)


class LampErrorTests(unittest.TestCase):
    def setUp(self):
        from test_cube_transport import client_tcp, protocol
        self.CUBE, self.TCP = protocol, client_tcp

    def test_its_unquoted_error_lines_are_read(self):
        read = self.CUBE.malformed_error
        self.assertEqual({"code": 5, "message": "client quota exceeded"},
                         read(b'{"id":1,"error":{"code":5, "message":client quota exceeded}}'))
        self.assertEqual({"code": 1, "message": "invalid params"},
                         read(b'{"id":1, "error":{"code":1, "message":invalid params}}\r'))
        self.assertIsNone(read(b'{"id":2,"error":{"code":1, "message":invalid params}}'))
        self.assertIsNone(read(b'{"method":"props","params":{"power":"on"}}'))

    def test_its_quota_refusal_is_told_from_a_hardware_fault(self):
        quota = self.CUBE.is_quota_error
        self.assertTrue(quota(self.CUBE.BulbException({"code": 5, "message": "client quota exceeded"})))
        self.assertTrue(quota(self.CUBE.BulbException({"code": -1, "message": "client quota exceeded"})))
        self.assertFalse(quota(self.CUBE.BulbException({"code": 5, "message": "hardware fault"})))

    def test_its_commands_go_on_one_shot_connections_answers_read(self):
        source = (ROOT / "lamp_client_bulb.py").read_text(encoding="utf-8")
        recovery = source[source.index("    async def send_command_with_recovery"):]
        self.assertLess(
            recovery.index("await self.send_raw_command(command, list(params or []), udp=False, check_reply=True)"),
            recovery.index("async with self._command_lock:"),
        )
        self.assertEqual((1.2, 30.0), (self.TCP.MATRIX_TCP_INTERVAL, self.TCP.MATRIX_QUOTA_PAUSE))


class MusicConnectionTests(unittest.TestCase):
    def test_a_write_the_lamp_does_not_take_gives_up(self):
        MUSIC = import_pure_module("music_channel")
        self.assertEqual(2.0, MUSIC.WRITE_TIMEOUT)
        self.assertEqual(55450, MUSIC.MUSIC_PORT)

        class Stuck:
            def write(self, data):
                pass

            def is_closing(self):
                return False

            def close(self):
                pass

            async def drain(self):
                await asyncio.sleep(10)

        channel = MUSIC.MusicChannel("192.168.4.188")
        channel._writer = Stuck()
        MUSIC.WRITE_TIMEOUT, saved = 0.05, MUSIC.WRITE_TIMEOUT
        try:
            with self.assertRaises(MUSIC.UdpUnavailable):
                asyncio.run(channel._write("update_leds", ["AAAA"]))
        finally:
            MUSIC.WRITE_TIMEOUT = saved
        self.assertFalse(channel.is_open)


class ClockAndSpeedTests(unittest.TestCase):
    def setUp(self):
        from test_cube_matrix_matter import FakeLight
        self.FakeLight = FakeLight

    def test_a_half_hour_time_zone_streams_the_clock(self):
        light = self.FakeLight()
        light._mode = "Clock"
        light._native_clock_utc_offset_seconds = lambda: 8 * 3600
        self.assertIsNotNone(light.matrix_native_command())
        light._native_clock_utc_offset_seconds = lambda: int(5.5 * 3600)   # India
        self.assertIsNone(light.matrix_native_command())

    def test_its_own_clock_only_where_it_reads_as_a_cube_lite_s(self):
        # Filmed 2026-11-12: the Cube Matrix's own clock never turns its
        # digits (upside down mounted left, from the bottom up mounted up);
        # a Cube Lite's reads upright on left and from the top down on up.
        light = self.FakeLight()
        light._mode = "Clock"
        for orientation, own in (("right", True), ("down", True), ("left", False), ("up", False)):
            light._device_orientation = orientation
            self.assertEqual(not own, light.lamp_turns_clock, orientation)
            command = light.matrix_native_command()
            self.assertEqual(own, command is not None, orientation)
        # While a rotation is written the previews follow the one coming
        # (its own numbers: right 0, down 1, left 2, up 3).
        light._device_orientation = "right"
        for rotation, turned in ((0, False), (1, False), (2, True), (3, True)):
            light._mount_profile_pending = rotation
            self.assertEqual(turned, light.lamp_turns_clock, rotation)
        light._mount_profile_pending = None

    def test_its_brightness_goes_over_matter(self):
        # 2026-11-12: the lamp's LAN read no command (every connection reset)
        # while Matter went on; the slider did nothing. Level Control dims its
        # own effects as set_bright does (filmed).
        import asyncio
        light = self.FakeLight()
        asyncio.run(light.matrix_send_brightness(20))
        sent = [entry for entry in light.log if entry[0] == "matter"]
        self.assertEqual((8, "MoveToLevel"), sent[-1][1:3])
        self.assertEqual(MATRIX_MODULE.matter_level(20), sent[-1][3]["level"])
        self.assertFalse([entry for entry in light.log if entry[0] == "set_bright"])
        self.assertEqual(254, MATRIX_MODULE.matter_level(100))
        self.assertEqual(1, MATRIX_MODULE.matter_level(0))
        # Matter refused: over the LAN.
        light = self.FakeLight(refuse=True)
        asyncio.run(light.matrix_send_brightness(20))
        self.assertEqual("set_bright", [entry for entry in light.log if entry[0] == "set_bright"][-1][0])

    def test_sunrise_and_sunset_at_speed_0_is_still(self):
        params = EFFECTS.engine_payload(18, 0)["effect"]["effectParams"][0]
        self.assertEqual(0, params["speed"])
        # Another effect: 0 is the slowest, 1.
        self.assertEqual(1, EFFECTS.engine_payload(19, 0)["effect"]["effectParams"][0]["speed"])


class SecondRoundTests(unittest.TestCase):
    """The items the notes' footage or measurements confirm (2026-11-10)."""

    def setUp(self):
        from test_cube_matrix_matter import FakeLight, run
        self.FakeLight, self.run = FakeLight, run

    def test_intensity_with_the_app_effects(self):
        # setPresetsEffect's field 3; only when the effect takes it.
        self.assertEqual(40, EFFECTS.preset_payload("Waves", 100, None, 0, 1, 40)["intensity"])
        self.assertNotIn("intensity", EFFECTS.preset_payload("Waves", 100, None, 0))
        light = self.FakeLight()
        light._native_effect, light._native_effect_intensity = "Meteor", 200
        self.assertEqual(200, light.matrix_native_command()[1]["intensity"])
        light._native_effect = "Rainbow"   # takes none
        self.assertNotIn("intensity", light.matrix_native_command()[1])

    def test_solid_red_and_centre_bursts_run_on_the_lamp(self):
        self.assertTrue({52, 63} <= EFFECTS.ENGINE_MODES)
        self.assertEqual(8, len(EFFECTS.SPEEDLESS_MODES))
        light = (ROOT / "light_attributes.py").read_text(encoding="utf-8")
        self.assertIn("not (matrix and spec.get(\"mode\") in SPEEDLESS_MODES)", light)

    def test_what_the_lamp_starts_itself_is_followed(self):
        MATRIX = import_pure_module("light_matrix")
        self.assertEqual("Waves", MATRIX.matrix_effect_name(42))
        self.assertEqual("Sunrise and sunset", MATRIX.matrix_effect_name(18))
        self.assertIsNone(MATRIX.matrix_effect_name(36))
        light = self.FakeLight()
        light._mode, light._native_effect = "Clock", "Rainbow"
        light._matrix_followed(10)
        self.assertEqual(("Native Effect", "Fireworks"), (light._mode, light._native_effect))
        light._matrix_followed(40)
        self.assertEqual("Clock", light._mode)
        light._matrix_followed(0)   # a colour: left as it is
        self.assertEqual("Clock", light._mode)

    def test_the_firmware_as_the_app_shows_it(self):
        source = (ROOT / "entity.py").read_text(encoding="utf-8")
        namespace = {}
        start = source.index("def firmware_version")
        exec(source[start:source.index("\nclass ", start)], namespace)
        version = namespace["firmware_version"]
        self.assertEqual("1.12.92", version("CubeMatrix", "92"))
        self.assertEqual("1.11.57", version("CubeMatrix", "57"))
        self.assertEqual("1.0.0", version("CubeLite", "1.0.0"))
        old = PROFILE.profile_for("CubeMatrix", "get_prop set_power set_bright".split())
        self.assertTrue(old.firmware_too_old)
        self.assertFalse(PROFILE.profile_for("CubeMatrix").firmware_too_old)

    def test_power_on_behaviour_over_matter(self):
        light = self.FakeLight()
        writes = []

        async def write(path, value):
            writes.append((path, value))

        light._matter_commands.async_write = write
        self.run(light.async_set_matrix_power_on("off"))
        self.assertEqual([("1/6/16387", 0)], writes)
        self.assertEqual("off", light._matrix_power_on)
        # The Power-on behavior select hears of a change the lamp reports.
        told = []
        light.add_listener("matrix_power_on", lambda: told.append(light._matrix_power_on))
        light._on_matrix_report("start_up_on_off", 1, False)
        self.assertEqual("on", light._matrix_power_on)
        light._on_matrix_report("start_up_on_off", 1, False)  # the same: nothing new
        light._on_matrix_report("start_up_on_off", 0, True)   # read when linked
        self.assertEqual(["on", "off"], told)
        light._matter = types.SimpleNamespace(linked=False, values={})
        with self.assertRaises(MATRIX_TESTS.MatrixSettingUnavailable):
            self.run(light.async_set_matrix_power_on("on"))
        recovery = (ROOT / "light_connection.py").read_text(encoding="utf-8")
        self.assertIn('self._matrix_power_on == "off"', recovery)

    def test_the_clock_shows_the_date_4_s_of_10(self):
        from datetime import datetime, timezone
        face = import_pure_module("clock_face")
        shown = [face.clock_text(datetime(2026, 11, 10, 9, 41, s, tzinfo=timezone.utc), "time_date", False, False)[0]
                 for s in range(10)]
        self.assertEqual(["09:41"] * 6 + ["11.10"] * 4, shown)


class UnusableAddressTests(unittest.TestCase):
    """2026-11-10: after a power-on the Cube Matrix's Matter node reported its
    Wi-Fi interface as 0.0.0.0, and the entry was moved there."""

    def test_0_0_0_0_is_no_address(self):
        for address in ("0.0.0.0", "169.254.3.4", "127.0.0.1", "255.255.255.255", "224.0.0.1", "x", "1.2.3"):
            self.assertFalse(LINK.usable_address(address), address)
        self.assertTrue(LINK.usable_address("192.168.4.188"))
        self.assertTrue(LINK.usable_address("10.0.0.5"))

    def test_the_node_s_0_0_0_0_is_ignored(self):
        node_0 = matrix_node(10, "AAAAAA==")   # 0.0.0.0
        self.assertEqual([("cc:ba:97:44:38:98", [])], LINK.node_interfaces(node_0.node_data.attributes))
        client = FakeClient([node_0])
        link = LINK.MatterLink(hass_with(client), lambda *args: None, products=(16787457,), reported={})
        self.assertTrue(link.refresh(LAMP_IP, LAMP_MAC))   # found by its MAC
        self.assertIsNone(link.address())
        entry = types.SimpleNamespace(data={CONSTANTS["CONF_IP"]: LAMP_IP, "matter_mac": LAMP_MAC})
        light = types.SimpleNamespace(_matter=link, _ip=LAMP_IP, hass=None)
        self.assertFalse(MATTER.MatterMixin._follow_matter_address(light, entry, LAMP_MAC))

    def test_the_flows_refuse_it(self):
        flow = (ROOT / "config_flow.py").read_text(encoding="utf-8")
        self.assertIn('if not usable_address(ip):\n            return self.async_abort(reason="no_address")', flow)
        self.assertIn("and usable_address(ip)", flow)
        init = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("or (stored_mac and normalize_device_id(device_id) == stored_mac)", init)


class LateReportTests(unittest.TestCase):
    """2026-11-10 on the lamp: a report of the effect Home Assistant had
    started came 31 s later, while another was being started, and was taken
    for the button: the light's effect went back to the old one."""

    def test_a_late_report_of_our_own_effect_is_not_followed(self):
        from test_cube_matrix_matter import FakeLight, run
        light = FakeLight()
        light._native_effect = "Dark palette pulses"  # the lamp's own slot 9
        run(light._activate_matrix_content())
        self.assertEqual(9, light._matrix_sent_id)
        shown = light._matrix_shown
        light._matrix_command_at -= 60          # long after the command
        light._native_effect = "Sunrise and sunset"   # the user's next choice
        light._on_matrix_report("running_effect", 9, False)
        self.assertEqual("Sunrise and sunset", light._native_effect)
        self.assertIs(shown, light._matrix_shown)      # still known: live changes go on
        # Something else on the lamp is still followed.
        light._on_matrix_report("running_effect", 42, False)
        self.assertEqual("Waves", light._native_effect)


class RestartTests(unittest.TestCase):
    """2026-11-11 on the lamp: a 10 s power cut between two LAN probes went
    unseen; ~110 s after power-on the Matter server reported the lamp's
    start-up effect (its saved one) and a new reboot count together, and the
    effect was taken for its button: Home Assistant's text never came back."""

    def light(self):
        from test_cube_matrix_matter import FakeLight
        light = FakeLight()
        light.hass, light.redraws = object(), []
        light.async_write_ha_state = lambda: None
        light._refresh_linked_entities = lambda: light.log.append("refresh")

        def track(coro, name=None):
            coro.close()
            light.redraws.append(name)

        light._create_tracked_task = track
        light.async_apply_display_mode = lambda update_type=None: asyncio.sleep(0)
        light._matrix_command_at = -100.0
        light._mode, light._native_effect = "Matrix", "Rainbow"
        light._on_matrix_report("reboot_count", 5, True)
        return light

    def test_the_start_up_effect_reported_first_is_undone(self):
        light = self.light()
        light._on_matrix_report("running_effect", 21, False)
        self.assertEqual("Native Effect", light._mode)   # taken for the button, for now
        light._on_matrix_report("reboot_count", 6, False)
        self.assertEqual(("Matrix", "Rainbow"), (light._mode, light._native_effect))
        self.assertEqual(1, len(light.redraws))           # Home Assistant's content again
        self.assertIsNone(light._matrix_shown)

    def test_the_start_up_effect_reported_after_is_not_followed(self):
        light = self.light()
        light._on_matrix_report("reboot_count", 6, False)
        light._on_matrix_report("running_effect", 21, False)
        self.assertEqual("Matrix", light._mode)
        self.assertEqual(1, len(light.redraws))

    def test_a_button_long_after_is_followed(self):
        light = self.light()
        light._on_matrix_report("reboot_count", 6, False)
        light._matrix_restarted_at -= 60
        light._on_matrix_report("running_effect", 42, False)
        self.assertEqual(("Native Effect", "Waves"), (light._mode, light._native_effect))

    def test_a_link_made_again_with_a_new_count_is_a_restart(self):
        light = self.light()
        light._on_matrix_report("reboot_count", 5, True)   # the same: nothing
        self.assertEqual([], light.redraws)
        light._on_matrix_report("reboot_count", 6, True)
        self.assertEqual(1, len(light.redraws))

    def test_set_to_stay_off_or_off_it_is_not_redrawn(self):
        light = self.light()
        light._matrix_power_on = "off"
        light._on_matrix_report("reboot_count", 6, False)
        self.assertFalse(light._is_on)
        light = self.light()
        light._is_on = False
        light._on_matrix_report("reboot_count", 6, False)
        light._outage_since = 1.0                          # the health check redraws
        light._is_on = True
        light._on_matrix_report("reboot_count", 7, False)
        self.assertEqual([], light.redraws)

    def test_the_count_is_reported(self):
        from test_cube_matrix_matter import LINK
        self.assertEqual("0/51/1", LINK.MATRIX_REPORTED["reboot_count"])

    def test_back_after_an_outage_the_redraw_waits_for_the_restart_report(self):
        """2026-11-11: the health check's redraws each waited 12 s and failed
        until Home Assistant's Matter server reached the lamp (~90 s)."""
        from test_cube_matrix_matter import MATRIX as LIGHT_MATRIX
        light = self.light()
        light._mode = "Native Effect"
        light._matter = types.SimpleNamespace(linked=True, values={"effect": 0})
        light._matter_commands.backend = "matter"
        self.assertTrue(light.matrix_redraw_waits_for_restart())
        light._music_flow_enabled = True
        self.assertFalse(light.matrix_redraw_waits_for_restart())
        light._music_flow_enabled = False
        light._native_effect = "Palette"          # streamed (mode 81): redrawn at once
        self.assertFalse(light.matrix_redraw_waits_for_restart())
        light._native_effect = "Waves"
        # Waits; the restart report redraws, the fallback then does nothing.
        light.matrix_await_restart()
        self.assertTrue(light._matrix_redraw_due)
        self.assertEqual(["yeelight_cube_matrix_restart_fallback_192.168.4.189"], light.redraws)
        light._on_matrix_report("reboot_count", 6, False)
        self.assertFalse(light._matrix_redraw_due)
        self.assertEqual(2, len(light.redraws))
        # Reported while the health check still saw it away: redrawn at once.
        light = self.light()
        light._outage_since = 1.0
        light._on_matrix_report("reboot_count", 6, False)
        self.assertEqual([], light.redraws)
        light._outage_since = None
        light.matrix_await_restart()
        self.assertEqual(["yeelight_cube_matrix_restarted_192.168.4.189"], light.redraws)
        self.assertFalse(light._matrix_redraw_due)
        self.assertGreater(LIGHT_MATRIX.MATRIX_RESTART_FALLBACK, 90)

    def test_without_a_restart_report_the_fallback_sends_it_again(self):
        light = self.light()
        # The module the method runs in (light_matrix_follow imports the
        # constant): patching light_matrix's left the real 240 s wait.
        follow = light.matrix_await_restart.__func__.__globals__
        drawn = []

        async def apply(update_type=None):
            drawn.append((update_type, light._matrix_shown))

        light.async_apply_display_mode = apply
        light._matrix_shown = ("setPresetsEffect", {})
        tasks = []
        light._create_tracked_task = lambda coro, name=None: tasks.append(coro)
        real, follow["MATRIX_RESTART_FALLBACK"] = follow["MATRIX_RESTART_FALLBACK"], 0
        try:
            light.matrix_await_restart()
            asyncio.run(tasks[0])
        finally:
            follow["MATRIX_RESTART_FALLBACK"] = real
        self.assertEqual([("turn_on", None)], drawn)

    def test_the_health_check_leaves_it_to_the_report(self):
        source = (ROOT / "light_connection.py").read_text(encoding="utf-8")
        self.assertIn('waits = getattr(self, "matrix_redraw_waits_for_restart", None)', source)
        self.assertIn("if outage is not None and waits is not None and waits():", source)
        self.assertIn("self.matrix_await_restart()", source)

    def test_the_health_check_watches_a_drawing_and_redraws_in_full(self):
        """Text drawn over Matter got no probe at all (2026-11-11: no probe
        for 2.5 min), and a redraw after an outage could be an empty live
        change for a lamp that had restarted."""
        source = (ROOT / "light_connection.py").read_text(encoding="utf-8")
        self.assertIn("or matrix_shown is not None\n", source)
        self.assertIn('matrix_shown[1].get("apply") in (1, 2)', source)
        recovered = source[source.index("self._forget_hardware_brightness()\n                    # A Cube Matrix"):]
        self.assertIn("self._matrix_shown = None", recovered[:400])


class StartupRotationTests(unittest.TestCase):
    """2026-11-11: after a reload Home Assistant's Matter client gave
    rotation 0 (a write is not reported back) while the lamp answered 3
    over the LAN: the light went to Right and Lamp mounted Right wrote
    nothing (already 0)."""

    def light(self, lan="3"):
        from test_cube_matrix_matter import FakeLight
        light = FakeLight()
        light._lamp_client.capabilities = {"rotation_angle": lan} if lan is not None else {}
        light._matter = types.SimpleNamespace(linked=True, values={"rotation": 0})
        return light

    def test_the_lamp_s_own_answer_wins_at_link(self):
        light = self.light()
        light._on_matrix_report("rotation", 0, True)
        self.assertEqual(3, light.device_profile.rotation)
        self.assertEqual(3, light._matter.values["rotation"])   # a write of 0 now happens

    def test_without_a_lan_answer_matter_s_is_used(self):
        light = self.light(lan=None)
        light._on_matrix_report("rotation", 1, True)
        self.assertEqual(1, light.device_profile.rotation)

    def test_reports_and_writes_keep_it_current(self):
        light = self.light()
        light._on_matrix_report("rotation", 2, False)
        self.assertEqual("2", light._lamp_client.capabilities["rotation_angle"])
        source = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("light_matter*.py")))
        self.assertIn('if note := getattr(self, "matrix_note_rotation", None):', source)


class FilmedDirectionTests(unittest.TestCase):
    """Filmed 2026-11-10 at rotation 0 (Device Orientation Right): Waterfall
    sent 2 ran toward the base, 3 away; Palette trails sent 2 ran across the
    lamp, 1 away from the base, 0 toward it."""

    def test_each_label_s_value(self):
        from test_cube_matrix_matter import FakeLight
        light = FakeLight()
        sent = {}
        for effect in ("Waterfall", "Palette trails", "Stacking blocks"):
            light._native_effect = effect
            for label in ("Up", "Down", "Left", "Right"):
                light._native_effect_direction = label
                command = light.matrix_native_command()[1]
                sent[effect, label] = command.get("direction", (command.get("effect") or {}).get(
                    "effectParams", [{}])[0].get("direction"))
        self.assertEqual([0, 1, 2, 3], [sent["Waterfall", label] for label in ("Up", "Down", "Left", "Right")])
        self.assertEqual([3, 2, 0, 1], [sent["Palette trails", label] for label in ("Up", "Down", "Left", "Right")])
        self.assertEqual([2, 3, 1, 0], [sent["Stacking blocks", label] for label in ("Up", "Down", "Left", "Right")])
        # Not turned for the mounting: the lamp turns its own effects.
        light._device_orientation = "up"
        light._native_effect, light._native_effect_direction = "Waterfall", "Right"
        self.assertEqual(3, light.matrix_native_command()[1]["direction"])


class SweepDirectionTests(unittest.TestCase):
    """Filmed 2026-11-11, the lamp standing, at each of its rotations (the
    Device Orientation set for each): which way each value ran, on the lamp."""

    # rotation -> value -> the way Moving palette and Sine wave ran (across the lamp).
    # Filmed 2026-11-12 standing at rotation 3 (speed 128): Moving palette ran
    # Up on 0 and Down on 1, as the Cube Lite on the values it draws as 0 and 1.
    FILMED_ROTATION_3 = {0: "Up", 1: "Down"}

    def sent(self, light, effect, label):
        light._native_effect, light._native_effect_direction = effect, label
        command = light.matrix_native_command()[1]
        return command.get("direction", (command.get("effect") or {}).get("effectParams", [{}])[0].get("direction"))

    def test_building_blocks_and_flicker_sweep(self):
        from test_cube_matrix_matter import FakeLight
        light = FakeLight()
        labels = ("Up", "Down", "Left", "Right")
        # Building Blocks ran each of the app's arrows the other way.
        self.assertEqual([1, 0, 3, 2], [self.sent(light, "Building Blocks", label) for label in labels])
        # Flicker sweep takes the app's arrows, not the other built-in effects'.
        self.assertEqual([0, 1, 2, 3], [self.sent(light, "Flicker sweep", label) for label in labels])

    def test_one_axis_effects_follow_the_rotation(self):
        import dataclasses
        from test_cube_matrix_matter import FakeLight
        from yeelight_cube.mount_profile import DIRECTION_TABLE, LOW_PAIR, one_axis_direction
        light = FakeLight()
        light._device_orientation = "up"  # standing, as filmed
        for effect in ("Moving palette", "Sine wave"):
            light._lamp_client.profile = dataclasses.replace(light._lamp_client.profile, rotation=3)
            self.assertEqual("Up", self.FILMED_ROTATION_3[self.sent(light, effect, "Up")])
            self.assertEqual("Down", self.FILMED_ROTATION_3[self.sent(light, effect, "Down")])
            for rotation in range(4):
                light._lamp_client.profile = dataclasses.replace(light._lamp_client.profile, rotation=rotation)
                for orientation in ("up", "right", "down", "left"):
                    light._device_orientation = orientation
                    for label in ("Up", "Down", "Left", "Right"):
                        value = self.sent(light, effect, label)
                        # The value a Cube Lite gets at that rotation: same picture on both.
                        self.assertEqual(one_axis_direction(label, orientation, rotation, "Up", LOW_PAIR), value)
                        self.assertIn(DIRECTION_TABLE[rotation][value], LOW_PAIR)
                light._device_orientation = "up"
                # Left and Right run across the lamp's line: along it, as Up and Down.
                self.assertEqual(self.sent(light, effect, "Up"), self.sent(light, effect, "Left"))
                self.assertEqual(self.sent(light, effect, "Down"), self.sent(light, effect, "Right"))


class TurnOnAgainTests(unittest.TestCase):
    """Filmed 2026-11-10: off, then on with the same effect sent nothing (a
    live change with nothing to change) and the lamp stayed dark; a full
    Matter effect powers the lamp on."""

    def test_off_forgets_what_the_lamp_showed(self):
        # Turned off (by Home Assistant, or seen over Matter), the next turn
        # on sends the full command again (test_the_full_command_goes_again).
        from test_cube_matrix_matter import LIGHT_CLASS, FakeLight, run
        light = FakeLight()
        light._native_effect = "Waves"
        run(light._activate_matrix_content())
        self.assertIsNotNone(light._matrix_shown)
        with instant_sleeps():
            run(light._internal_turn_off())
        self.assertIn(("set_power", ["off"], True), light.log)
        self.assertIsNone(light._matrix_shown)
        light._is_on = True
        run(light._activate_matrix_content())
        self.assertIsNotNone(light._matrix_shown)
        # Seen switched off over Matter (the real handler: FakeLight records it).
        LIGHT_CLASS._lamp_switched(light, False)
        self.assertIsNone(light._matrix_shown)

    def test_the_full_command_goes_again(self):
        from test_cube_matrix_matter import FakeLight, run
        light = FakeLight()
        light._native_effect = "Waves"
        run(light._activate_matrix_content())
        light._matrix_shown = None            # switched off
        light.log.clear()
        run(light._activate_matrix_content())
        names = [entry[2] for entry in light.log if isinstance(entry, tuple) and entry[0] == "matter"]
        self.assertEqual(["setPresetsEffect"], names)


class FreezeTests(unittest.TestCase):
    """2026-11-11 on the lamp: Freeze sent the Cube Lite's set_fx_effect,
    which a Cube Matrix does not have ("not supported"): nothing froze. What
    it shows over Matter is now replaced by a still drawing of the held
    frame; a streamed effect pauses (filmed: held 60 s)."""

    def light(self, frames=None):
        from test_cube_matrix_matter import FakeLight, MATRIX
        light = FakeLight()
        frames = list(frames or [[(10, 20, 30)] * 100])
        held = []

        class Camera:
            def simulated_lamp_frame(self):
                held.append(light._display_frozen)
                return frames.pop(0) if len(frames) > 1 else frames[0]

        async def executor(func, *args):
            return func(*args)

        light.hass = types.SimpleNamespace(async_add_executor_job=executor)
        light._camera_entities, light.held = [Camera()], held
        light._display_frozen = False
        light._lamp_frame = lambda frame: frame
        light._brightness_stages = lambda frame: frame
        light.tasks = []
        light._create_tracked_task = lambda coro, name=None: light.tasks.append(coro) or types.SimpleNamespace(done=lambda: False)

        async def op(func, name):
            await func()
            return True

        light._execute_hardware_op = op
        self.MATRIX = MATRIX
        return light

    @staticmethod
    def matter(light):
        return [entry[2:] for entry in light.log if isinstance(entry, tuple) and entry[0] == "matter"]

    def test_an_effect_shown_over_matter_freezes_as_a_still_drawing(self):
        from test_cube_matrix_matter import run
        light = self.light()
        run(light._activate_matrix_content())
        self.assertTrue(light.matrix_freezes())
        light.log.clear()
        run(light.async_matrix_freeze())
        self.assertTrue(light._display_frozen)
        self.assertEqual([True], light.held)               # the frame the preview holds
        (name, payload), = self.matter(light)
        params = payload["effect"]["effectParams"][0]
        self.assertEqual(("setEffect", 36, 0, 0), (name, params["mode"], params["mixer"], payload["apply"]))
        self.assertEqual([], light.tasks)                  # an effect: nothing more
        # Resumed (the cards apply the effect again): sent in full.
        light._display_frozen = False
        light.log.clear()
        run(light._activate_matrix_content())
        self.assertEqual(["setPresetsEffect"], [name for name, _ in self.matter(light)])

    def test_a_streamed_effect_is_left_to_the_stream(self):
        light = self.light()
        light._native_effect = "Magic"                     # not on the lamp: streamed
        self.assertFalse(light.matrix_freezes())

    def test_a_frozen_clock_keeps_its_time(self):
        from test_cube_matrix_matter import run
        minute = [(1, 1, 1)] * 100
        light = self.light([minute, minute, minute, [(2, 2, 2)] * 100])
        light._mode, light._native_clock_style = "Clock", 1
        run(light._activate_matrix_content())
        run(light.async_matrix_freeze())
        self.assertEqual(1, len(light.tasks))
        light.log.clear()
        ticks = []
        sleep = self.MATRIX.asyncio.sleep

        async def tick(seconds):
            ticks.append(seconds)
            if len(ticks) == 4:
                light._display_frozen = False              # resumed
            await sleep(0)

        self.MATRIX.asyncio.sleep = tick
        try:
            run(light.tasks[0])
        finally:
            self.MATRIX.asyncio.sleep = sleep
        # The same frame is not sent again; the next minute's is, in place.
        self.assertEqual(["setData"], [name for name, _ in self.matter(light)])

    def test_the_service_uses_it_before_the_cube_lite_command(self):
        source = (ROOT / "light_actions_display.py").read_text(encoding="utf-8")
        freeze = source[source.index("async def async_freeze_display"):]
        self.assertLess(freeze.index("matrix_freezes"), freeze.index('"set_fx_effect"'))


class RefreshTests(unittest.TestCase):
    """Refresh re-applied an unchanged Cube Matrix effect as an empty live
    change: nothing was sent (the log's "Changed live: []")."""

    def test_refresh_sends_it_in_full(self):
        light = (ROOT / "light_onoff.py").read_text(encoding="utf-8")
        refresh = light[light.index("    async def _force_refresh_impl"):][:2400]
        self.assertLess(refresh.index("self._matrix_shown = None"), refresh.index("await self._apply_display_mode_internal()"))


class MatterStreamTests(unittest.TestCase):
    """2026-11-11 on the lamp: an effect in a color mode the lamp lacks
    (Retro Orange...) was streamed over the LAN, ~5 frames a second shown
    against ~30 for its own effects (choppy). Its drawing's pixels over Matter
    (setData) were answered ~45 times a second and nearly all shown."""

    def light(self, refuse=0):
        from test_cube_matrix_matter import FakeLight
        light = FakeLight()
        light._lamp_frame = lambda frame: frame
        light._brightness_stages = lambda frame: frame
        light._native_brightness_due = lambda: True
        failures = [refuse]
        command = light._matter_commands.async_command

        async def async_command(cluster, name, payload):
            if failures[0]:
                failures[0] -= 1
                raise RuntimeError("Channel is closed")
            await command(cluster, name, payload)

        light._matter_commands.async_command = async_command
        return light

    @staticmethod
    def sent(light):
        return [entry for entry in light.log if entry != "close_music"]

    def test_the_first_frame_is_the_drawing_then_its_pixels(self):
        from test_cube_matrix_matter import run
        light = self.light()
        self.assertTrue(light.matrix_streams_over_matter())
        pixels = [(1, 2, 3)] * 100
        run(light._send_matrix_stream_frame(pixels))
        # The music connection closed (the lamp drops Matter frames while it
        # is open), the brightness over TCP, then the drawing: shown, not saved.
        self.assertEqual("close_music", light.log[0])
        bright, (_, _, name, payload) = self.sent(light)
        self.assertEqual(("set_bright", False), (bright[0], bright[2]))
        params = payload["effect"]["effectParams"][0]
        self.assertEqual(("setEffect", 36, 0, 0), (name, params["mode"], params["mixer"], payload["apply"]))
        self.assertEqual(36, light._matrix_sent_id)
        light.log.clear()
        sent_at = light._matrix_command_at
        run(light._send_matrix_stream_frame([(4, 5, 6)] * 100))
        (_, _, name, payload), = self.sent(light)
        self.assertEqual("setData", name)
        self.assertEqual(EFFECTS.set_data_payload([(4, 5, 6)] * 100), payload)
        # Not an echo window of its own: a button press is still followed.
        self.assertEqual(sent_at, light._matrix_command_at)

    def test_the_drawing_is_sent_again_when_the_lamp_may_not_show_it(self):
        from test_cube_matrix_matter import run
        light = self.light()
        run(light._send_matrix_stream_frame([(1, 2, 3)] * 100))
        light._matrix_shown = None                     # a restart, a button press...
        light.log.clear()
        run(light._send_matrix_stream_frame([(1, 2, 3)] * 100))
        self.assertEqual(["setEffect"], [entry[2] for entry in self.sent(light) if entry[0] == "matter"])

    def test_failed_frames_send_the_drawing_again_then_go_to_the_lan(self):
        from test_cube_matrix_matter import run
        light = self.light(refuse=1)
        with self.assertRaises(RuntimeError):
            run(light._send_matrix_stream_frame([(1, 2, 3)] * 100))
        self.assertIsNone(light._matrix_shown)
        self.assertTrue(light.matrix_streams_over_matter())
        run(light._send_matrix_stream_frame([(1, 2, 3)] * 100))
        self.assertEqual(0, light._matrix_stream_failures)  # a frame that went resets the count
        light = self.light(refuse=MATRIX_TESTS.MATTER_STREAM_FAILURES)
        for _ in range(MATRIX_TESTS.MATTER_STREAM_FAILURES):
            with self.assertRaises(RuntimeError):
                run(light._send_matrix_stream_frame([(1, 2, 3)] * 100))
        self.assertFalse(light.matrix_streams_over_matter())  # over the LAN until applied again
        light._mode = "Native Effect"
        light._native_effect, light._native_effect_color_mode = "Rainbow", "white_orange"
        run(light._activate_matrix_content())
        self.assertTrue(light.matrix_streams_over_matter())

    def test_a_frame_that_goes_resets_the_wait_before_matter_is_tried_again(self):
        # The wait doubles with each retry; Matter working again (a stream
        # frame, as a command) starts it from the first again.
        from test_cube_matrix_matter import run
        light = self.light()
        light._matrix_retry_after = 4 * MATRIX_TESTS.MATTER_RETRY_FIRST
        run(light._send_matrix_stream_frame([(1, 2, 3)] * 100))
        self.assertEqual(MATRIX_TESTS.MATTER_RETRY_FIRST, light._matrix_retry_after)
        light._matrix_retry_after = 4 * MATRIX_TESTS.MATTER_RETRY_FIRST
        run(light._send_matrix_stream_frame([(4, 5, 6)] * 100))  # setData
        self.assertEqual(MATRIX_TESTS.MATTER_RETRY_FIRST, light._matrix_retry_after)

    def test_the_brightness_goes_over_tcp_while_streaming_over_matter(self):
        # Sent over the LAN (Matter not delivering it), the brightness goes on
        # its own TCP connection while frames go over Matter, so the music
        # connection is not opened again; otherwise in the session.
        from test_cube_matrix_matter import FakeLight
        for over_matter, udp in ((True, False), (False, True)):
            with self.subTest(over_matter=over_matter):
                light = FakeLight()
                light.matrix_brightness_over_matter = lambda: False
                light._native_brightness_due = lambda: True
                light.matrix_streams_over_matter = lambda over_matter=over_matter: over_matter
                light.studio_streaming = lambda: True
                light._brightness = 255
                with instant_sleeps():
                    run(light._set_native_mode_brightness())
                sent = [entry for entry in light.log if isinstance(entry, tuple) and entry[0] == "set_bright"]
                self.assertEqual([("set_bright", [100], udp)], sent)


if __name__ == "__main__":
    unittest.main()
