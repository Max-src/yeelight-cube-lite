"""The lamp's optional Matter link (matter_link.py) and the reports the light
follows (light_matter.py), with node data captured from a Cube Lite
commissioned in Home Assistant's Matter server (2026-10-22)."""

from pathlib import Path
import asyncio
import sys
import types
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module  # noqa: E402

LINK = import_pure_module("matter_link")

# The real node's identifying attributes (base64 octet strings, as the
# Matter client keeps them).
CUBE_ATTRIBUTES = {
    "0/40/2": 0x1312,
    LINK.PRODUCT: 4,
    "0/51/0": [
        {"0": "WIFI_AP_DEF", "1": True, "4": "AAAAAAAA", "5": ["wKgEAQ=="]},
        {"0": "WIFI_STA_DEF", "1": True, "4": "zLqXRDiY", "5": ["wKgEiw=="]},
    ],
    LINK.LAN_CONTROL: True,
    LINK.MIC_MUSIC_ON: False,
    LINK.MIC_MUSIC_MODE: 0,
    LINK.ROTATION: 2,
    LINK.EFFECT: 71,
    LINK.EFFECT_SUB: 72,
}
LAMP_IP, LAMP_MAC = "192.168.4.139", "cc:ba:97:44:38:98"


def node(node_id, attributes):
    return types.SimpleNamespace(node_id=node_id, node_data=types.SimpleNamespace(attributes=attributes))


class FakeClient:
    def __init__(self, nodes):
        self.nodes = nodes
        self.subscriptions = {}

    def get_nodes(self):
        return self.nodes

    def subscribe_events(self, callback, event_filter=None, node_filter=None, attr_path_filter=None):
        key = (node_filter, attr_path_filter)
        self.subscriptions[key] = callback
        return lambda: self.subscriptions.pop(key, None)

    def push(self, node_id, path, value):
        self.subscriptions[(node_id, path)](types.SimpleNamespace(value="attribute_updated"), value)


def hass_with(client):
    entry = types.SimpleNamespace(
        runtime_data=types.SimpleNamespace(adapter=types.SimpleNamespace(matter_client=client))
    )
    return types.SimpleNamespace(
        config_entries=types.SimpleNamespace(async_loaded_entries=lambda domain: [entry] if client else [])
    )


class NodeMatchingTests(unittest.TestCase):
    def test_interfaces_from_the_real_node(self):
        self.assertEqual(
            [(None, ["192.168.4.1"]), (LAMP_MAC, [LAMP_IP])],
            LINK.node_interfaces(CUBE_ATTRIBUTES),
        )
        # Bytes and integer keys work too.
        raw = {"0/51/0": [{4: bytes.fromhex("ccba97443898"), 5: [bytes([10, 0, 0, 5])]}]}
        self.assertEqual([(LAMP_MAC, ["10.0.0.5"])], LINK.node_interfaces(raw))

    def test_the_lamp_is_its_cube_lite_node_by_ip_or_remembered_mac(self):
        self.assertEqual(LAMP_MAC, LINK.node_matches(CUBE_ATTRIBUTES, LAMP_IP, None))
        self.assertEqual(LAMP_MAC, LINK.node_matches(CUBE_ATTRIBUTES, "192.168.4.200", LAMP_MAC))
        self.assertIsNone(LINK.node_matches(CUBE_ATTRIBUTES, "192.168.4.200", None))
        # Another vendor or product with the same address: not the lamp.
        self.assertIsNone(LINK.node_matches({**CUBE_ATTRIBUTES, "0/40/2": 0x1234}, LAMP_IP, None))
        self.assertIsNone(LINK.node_matches({**CUBE_ATTRIBUTES, LINK.PRODUCT: 9}, LAMP_IP, None))

    def test_vendor_paths(self):
        self.assertEqual("2/320011269/319946752", LINK.EFFECT)
        self.assertEqual("2/320011266/319946753", LINK.ROTATION)
        self.assertEqual({0: "left", 1: "up", 2: "right", 3: "down"}, LINK.ROTATION_ORIENTATIONS)


class MatterLinkTests(unittest.TestCase):
    def setUp(self):
        self.reports = []
        self.client = FakeClient([node(1, {"0/40/2": 0x117C}), node(2, dict(CUBE_ATTRIBUTES))])
        self.link = LINK.MatterLink(hass_with(self.client), lambda *report: self.reports.append(report))

    def test_links_follows_and_releases(self):
        self.assertTrue(self.link.refresh(LAMP_IP, None))
        self.assertEqual((2, LAMP_MAC), (self.link.node_id, self.link.mac))
        # The state when linked: reported as initial.
        self.assertIn(("effect", 71, True), self.reports)
        self.assertEqual(len(LINK.REPORTED), len(self.client.subscriptions))
        self.assertFalse(self.link.refresh(LAMP_IP, None))  # unchanged
        self.client.push(2, LINK.EFFECT, 34)
        self.assertEqual(("effect", 34, False), self.reports[-1])
        self.assertEqual(34, self.link.summary()["effect"])
        # The node goes: released, unsubscribed.
        self.client.nodes = []
        self.assertTrue(self.link.refresh(LAMP_IP, LAMP_MAC))
        self.assertFalse(self.link.linked)
        self.assertEqual({}, self.client.subscriptions)
        self.assertIsNone(self.link.summary())

    def test_without_matter_nothing_happens(self):
        link = LINK.MatterLink(hass_with(None), Mock())
        self.assertFalse(link.refresh(LAMP_IP, None))
        self.assertFalse(link.linked)


def load_light_matter():
    """light_matter.py with homeassistant.core stubbed."""
    added = []
    for name in ("homeassistant", "homeassistant.core"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            added.append(name)
    core = sys.modules["homeassistant.core"]
    core.callback = getattr(core, "callback", lambda function: function)
    try:
        return import_pure_module("light_matter")
    finally:
        for name in added:
            sys.modules.pop(name, None)


MATTER = load_light_matter()


class FakeLight(MATTER.MatterMixin):
    """The light's state the mixin reads and writes."""

    def __init__(self):
        self._init_matter_state()
        self._ip = LAMP_IP
        self._is_on = True
        self._mode = "Clock"
        self._native_effect = "Rainbow"
        self._music_flow_enabled = False
        self._music_flow_effect = "Breathing"
        self._music_flow_restore_power = None
        self._device_orientation = "up"
        self._rotation_active = True
        self._rotation_resume_pending = False
        self._is_scrolling = False
        self._fx_mode_is_direct = True
        self._brightness = 255
        self._last_hardware_brightness = 100
        self.hass = object()
        self.calls = []
        self.tasks = []

    def stop_effect_rotation(self):
        self._rotation_active = False
        self.calls.append("stop_rotation")

    def stop_scroll_timer(self):
        pass

    def _refresh_linked_entities(self):
        self.calls.append("refresh")

    def _notify_camera_preview(self):
        pass

    def async_write_ha_state(self):
        pass

    def _async_check_problems(self):
        self.calls.append("problems")

    async def _persist_music_flow_runtime_state(self):
        pass

    async def set_device_orientation(self, orientation):
        pass

    def _create_tracked_task(self, coroutine, name=None):
        self.tasks.append(name)
        coroutine.close()


class FollowedReportTests(unittest.TestCase):
    def setUp(self):
        self.light = FakeLight()
        self.light._lamp_command_at = -1000.0  # no recent command

    def report(self, name, value, initial=False):
        self.light._on_matter_report(name, value, initial)

    def test_a_button_effect_is_followed(self):
        self.report("effect", 34)  # the playlist's Bonfire
        self.assertEqual(("Native Effect", "Bonfire"), (self.light._mode, self.light._native_effect))
        # The integration's own rotation gives way to the lamp.
        self.assertIn("stop_rotation", self.light.calls)
        self.assertTrue(self.light._in_native_fw_mode)

    def test_the_microphone_modes_and_their_long_press(self):
        self.report("effect", 85)
        self.assertEqual((True, "Blossom"), (self.light._music_flow_enabled, self.light._music_flow_effect))
        self.report("mic_music_on", False)
        self.assertFalse(self.light._music_flow_enabled)

    def test_echoes_initial_values_and_unknown_effects_change_nothing(self):
        self.report("effect", 34, initial=True)
        # The integration just started Rainbow (39) over Streamer (3): the
        # lamp reporting either is that command's echo.
        self.light._mode, self.light._native_effect = "Native Effect", "Streamer"
        self.light._note_lamp_command()
        self.light._native_effect = "Rainbow"
        self.report("effect", 39)
        self.report("effect", 3)
        self.light._mode = "Clock"
        self.light._lamp_command_at = -1000.0
        self.report("effect", 71)  # the GIF player: not an effect we know
        self.assertEqual(("Clock", []), (self.light._mode, self.light.calls))

    def test_the_app_resetting_the_lamp_right_after_a_command_is_followed(self):
        # The integration just drew text (the lamp reports 50 while it
        # draws), then the app reset the lamp to Streamer (leaving its
        # Direction page): not an echo. The next frame re-enters drawing.
        self.light._mode = "Solid Color"
        self.light._note_lamp_command()
        self.report("effect", 50)
        self.assertTrue(self.light._fx_mode_is_direct)
        self.report("effect", 3)
        self.assertEqual(("Native Effect", "Streamer"), (self.light._mode, self.light._native_effect))
        self.assertFalse(self.light._fx_mode_is_direct)
        # An effect we do not follow still ends the drawing mode.
        self.light._fx_mode_is_direct = True
        self.report("effect", 36)  # the app's Direction line
        self.assertFalse(self.light._fx_mode_is_direct)

    def test_the_app_direction_and_lan_control(self):
        self.report("rotation", 2)
        self.assertIn("yeelight_cube_matter_orientation_192.168.4.139", self.light.tasks)
        self.light.tasks.clear()
        self.light._device_orientation = "right"
        self.report("rotation", 2)  # already
        self.assertEqual([], self.light.tasks)
        self.report("lan_control", False)
        self.assertIn("problems", self.light.calls)

    def test_power_and_brightness_from_the_button_and_the_app(self):
        self.report("on_off", False)  # the right button's long press
        self.assertFalse(self.light._is_on)
        self.assertIn("stop_rotation", self.light.calls)
        self.report("on_off", True)  # on from the app
        self.assertTrue(self.light._is_on)
        self.assertFalse(self.light._fx_mode_is_direct)
        self.report("level", 82)  # about 32% in the app
        self.assertEqual((82, None), (self.light._brightness, self.light._last_hardware_brightness))
        self.light._last_hardware_brightness = 40
        self.report("level", 81)  # rounding: unchanged
        self.assertEqual((82, 40), (self.light._brightness, self.light._last_hardware_brightness))
        # The integration's own power command: its echo.
        self.light._note_lamp_command()
        self.report("on_off", False)
        self.assertTrue(self.light._is_on)

    def test_the_lamp_turns_its_clock_with_its_direction_setting(self):
        self.assertFalse(self.light.lamp_turns_content)  # no Matter: unknown
        self.light._matter = types.SimpleNamespace(linked=True, values={"rotation": 0})
        self.assertTrue(self.light.lamp_turns_content)  # Left
        self.light._matter.values["rotation"] = 2
        self.assertFalse(self.light.lamp_turns_content)  # Right

    def test_the_matter_attribute_names_the_server_for_yeelight_commands(self):
        self.assertIsNone(self.light._matter_summary())  # no node
        self.light._matter = types.SimpleNamespace(summary=lambda: {"node_id": 2})
        self.light._matter_commands = types.SimpleNamespace(backend="dev", reason=None)
        self.assertEqual({"node_id": 2, "commands": "dev"}, self.light._matter_summary())
        self.light._matter_commands = types.SimpleNamespace(backend=None, reason="why")
        self.assertEqual(
            {"node_id": 2, "commands": None, "commands_unavailable": "why"},
            self.light._matter_summary(),
        )
        self.assertIs(self.light._matter_commands, self.light.matter_commands)

    def test_the_device_orientation_sets_the_lamps_own_direction(self):
        written = []

        class Channel:
            error = None

            async def async_write(self, path, value):
                if self.error is not None:
                    raise self.error
                written.append((path, value))

        channel = Channel()
        self.light._matter = types.SimpleNamespace(linked=True, values={"rotation": 2})
        self.light._matter_commands = channel
        sync = lambda orientation: asyncio.run(self.light._sync_lamp_rotation(orientation))
        self.assertTrue(sync("left"))  # written: the lamp turns its clock
        self.assertEqual([(LINK.ROTATION, 0)], written)
        self.assertTrue(self.light.lamp_turns_content)  # previews turn now
        self.assertFalse(sync("left"))  # already: nothing to restart
        self.assertEqual(1, len(written))
        # No server delivers it (the official one today): as before.
        channel.error = MATTER.MatterCommandsUnavailable()
        self.assertFalse(sync("right"))
        channel.error = TimeoutError("no answer")
        self.assertFalse(sync("right"))
        self.assertEqual(0, self.light._matter.values["rotation"])
        self.light._matter_commands = None
        self.assertFalse(sync("right"))

    def test_the_matter_link_sensor_states(self):
        self.assertEqual(("not_linked", {}), (self.light.matter_link_state, self.light.matter_link_details))
        self.light._matter = types.SimpleNamespace(linked=True, node_id=2, values={})
        self.light._matter_commands = types.SimpleNamespace(backend=None, reason="why")
        self.assertEqual("linked", self.light.matter_link_state)
        self.assertEqual(
            {"node_id": 2, "settings_server": None, "settings_unavailable": "why"},
            self.light.matter_link_details,
        )
        self.light._matter_commands = types.SimpleNamespace(backend="matter", reason=None)
        self.assertEqual("settings_available", self.light.matter_link_state)
        # A state change reaches the sensor once it is added.
        written = []
        self.light._matter_link_sensor = types.SimpleNamespace(hass=object(), async_write_ha_state=lambda: written.append(1))
        self.light._matter_status_changed()
        self.assertEqual([1], written)

    def test_lan_control_off_is_a_problem_only_when_linked(self):
        self.assertFalse(self.light.matter_lan_control_off)
        self.light._matter = types.SimpleNamespace(linked=True, values={"lan_control": False})
        self.assertTrue(self.light.matter_lan_control_off)

    def test_effect_ids_and_firmware_modes(self):
        self.assertEqual("Streamer", MATTER.NATIVE_EFFECT_IDS[3])
        self.assertEqual("Flower Sea", MATTER.NATIVE_EFFECT_IDS[91])


if __name__ == "__main__":
    unittest.main()
