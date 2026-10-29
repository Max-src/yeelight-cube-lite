"""The lamp's optional Matter link (matter_link.py) and the reports the light
follows (light_matter.py), with node data captured from a Cube Lite
commissioned in Home Assistant's Matter server (2026-10-22)."""

from pathlib import Path
import asyncio
import base64
import json
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
PRESETS = Path(__file__).parent.parent / "custom_components" / "yeelight_cube" / "presets"


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

    def test_a_node_left_behind_by_a_factory_reset_is_not_linked(self):
        # The reset erased the lamp's pairing: its old node stays listed with
        # its old attributes (IP, MAC, rotation), unavailable.
        dead = node(2, dict(CUBE_ATTRIBUTES))
        dead.available = False
        self.client.nodes = [dead]
        self.assertFalse(self.link.refresh(LAMP_IP, LAMP_MAC))
        self.assertFalse(self.link.linked)
        # Paired again: a new node, available.
        self.client.nodes = [dead, node(5, dict(CUBE_ATTRIBUTES))]
        self.assertTrue(self.link.refresh(LAMP_IP, LAMP_MAC))
        self.assertEqual(5, self.link.node_id)
        # The saved topology is read with the rotation (mount_profile).
        self.assertEqual(2, self.link.values["rotation"])
        self.assertIn("topology", self.link.values)

    def test_another_server_is_read_when_home_assistants_has_no_live_node(self):
        dead = node(2, dict(CUBE_ATTRIBUTES))
        dead.available = False
        self.client.nodes = [dead]
        dev = FakeClient([node(1, dict(CUBE_ATTRIBUTES))])
        link = LINK.MatterLink(hass_with(self.client), lambda *report: None, lambda: [dev])
        self.assertTrue(link.refresh(LAMP_IP, None))
        self.assertEqual((1, dev), (link.node_id, link.client))
        # Home Assistant's own, once it has a live node, comes first.
        self.client.nodes = [node(6, dict(CUBE_ATTRIBUTES))]
        self.assertTrue(link.refresh(LAMP_IP, None))
        self.assertEqual((6, self.client), (link.node_id, link.client))

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
MOUNT = import_pure_module("light_mount_profile")


class FakeLight(MATTER.MatterMixin, MOUNT.MountProfileMixin):
    """The light's state the mixin reads and writes."""

    def __init__(self):
        self._init_matter_state()
        self._config_entry = None
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
        if name and name.startswith(("yeelight_cube_lamp_restore", "yeelight_cube_remote_playlist")):
            asyncio.run(coroutine)  # what buttons as remote puts back
        else:
            coroutine.close()

    # What a restore sends (light_native, light.py).
    async def async_set_music_flow(self, enabled, restore_display=True, *, persist_state=True):
        if self._restoring_after_lamp:
            assert not persist_state, "remote restoration should not wait for storage"
        self.calls.append(("music_flow", enabled))

    async def async_turn_on(self):
        self.calls.append("turn_on")

    async def async_turn_off(self):
        self.calls.append("turn_off")

    async def async_apply_display_mode(self, update_type=None):
        self.calls.append("redraw")

    def _native_clock_params(self):
        return [40, 1, 2, {"mode": 40}]

    async def _replay_app_content(self, content):
        method, params = content
        self.calls.append(("replay", params))


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
        self.report("effect", 64)  # an experimental mode: not an effect we know
        self.assertEqual(("Clock", ["stop_rotation"]), (self.light._mode, self.light.calls))
        self.assertTrue(self.light._external_display)

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
        self.light._expect_lamp_power(True)
        self.report("on_off", True)
        self.assertTrue(self.light._is_on)
        self.report("on_off", False)  # a genuine long press inside the echo window
        self.assertFalse(self.light._is_on)
        self.report("on_off", True)  # and its reversal is also genuine
        self.assertTrue(self.light._is_on)

    def test_the_lamp_turns_its_clock_with_its_confirmed_direction_setting(self):
        self.assertFalse(self.light.lamp_turns_clock)  # no Matter: unknown
        self.light._matter = types.SimpleNamespace(linked=True, node_id=2, values={"rotation": 0})
        self.assertFalse(self.light.lamp_turns_clock)  # read, not confirmed: not trusted
        self.light._config_entry = types.SimpleNamespace(options={"mount_profile_node": 2})
        self.assertTrue(self.light.lamp_turns_clock)  # Left (0°)
        self.light._matter.values["rotation"] = 2
        self.assertFalse(self.light.lamp_turns_clock)  # Right (180°)

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
        self.light._matter = types.SimpleNamespace(linked=True, node_id=2, values={"rotation": 2})
        self.light._matter_commands = channel
        self.light._config_entry = types.SimpleNamespace(options={})
        self.light.hass = types.SimpleNamespace(config_entries=types.SimpleNamespace(
            async_update_entry=lambda entry, options: setattr(entry, "options", options)
        ))
        sync = lambda orientation: asyncio.run(self.light._sync_lamp_rotation(orientation))
        self.assertTrue(sync("left"))  # written: the lamp turns its clock
        self.assertEqual([(LINK.ROTATION, 0)], written)
        self.assertEqual((0, "matter"), self.light.mount_profile)  # confirmed by the write
        self.assertTrue(self.light.lamp_turns_clock)  # previews turn now
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

    def lamp_events(self):
        events = []
        self.light._lamp_buttons_event = types.SimpleNamespace(
            hass=object(), lamp_event=lambda kind, data: events.append((kind, data)),
            async_write_ha_state=lambda: None,
        )
        return events

    def test_what_the_lamp_changes_fires_lamp_buttons_events(self):
        events = self.lamp_events()
        self.light._cube_matrix = types.SimpleNamespace(forget_running_effect=lambda: None)
        self.report("effect", 34)  # the right button
        self.report("effect", 85)  # the left button
        self.report("mic_music_on", False)  # its long press
        self.report("on_off", False)  # the right button's long press
        self.assertEqual(
            [
                ("effect_changed", {"effect": "Bonfire", "effect_id": 34}),
                ("music_mode_changed", {"mode": "Blossom"}),
                ("music_off", {}),
                ("turned_off", {}),
            ],
            events,
        )
        # Not the integration's own commands, the state when linked, or its
        # drawing mode.
        events.clear()
        self.light._is_on, self.light._mode = True, "Solid Color"
        self.report("effect", 39, initial=True)
        self.report("effect", 50)
        self.light._note_lamp_command()
        self.light._expect_lamp_power(True)
        self.report("on_off", True)
        self.assertEqual([], events)

    def test_music_restoration_is_separate_opt_in_and_keeps_power_controls(self):
        events = self.lamp_events()
        self.light._cube_matrix = types.SimpleNamespace(forget_running_effect=lambda: None)
        self.light._config_entry = types.SimpleNamespace(options={"restore_after_music_changes": True})
        self.report("effect", 85)
        self.assertEqual([("music_flow", False), "redraw"], self.light.calls)
        self.assertEqual("Clock", self.light._mode)
        self.light.calls.clear()
        self.report("mic_music_on", True)
        self.assertEqual([("music_flow", False), "redraw"], self.light.calls)
        self.report("on_off", False)
        self.assertFalse(self.light._is_on)
        self.report("on_off", True)
        self.assertTrue(self.light._is_on)
        self.assertEqual(3, len(events))

    def remote_lamp(self, playlist):
        """A lamp linked over Matter with settings available, Buttons as
        remote on; what is sent to its effects cluster is recorded."""
        sent = []

        class Channel:
            available = True
            backend = "matter"

            async def async_available(self):
                return self.available

            async def async_command(self, cluster, name, payload=None):
                sent.append((name, payload))
                return {"effectList": [{"effectId": e, "customId": c} for e, c in playlist]} if name == "getPersistEffectList" else None

        entry = types.SimpleNamespace(options={"buttons_as_remote": True})

        def update_entry(target, options):
            target.options = options

        self.light.hass = types.SimpleNamespace(config_entries=types.SimpleNamespace(async_update_entry=update_entry))
        self.light._config_entry = entry
        self.light._matter = types.SimpleNamespace(linked=True, node_id=2, values={})
        self.light._matter_commands = Channel()
        self.light._cube_matrix = types.SimpleNamespace(forget_running_effect=lambda: None)
        return entry, sent

    def test_buttons_as_remote_makes_the_playlist_black_and_puts_it_back(self):
        entry, sent = self.remote_lamp([(39, 39), (42, 42)])
        self.light._sync_remote_playlist()
        self.assertEqual([[39, 39], [42, 42]], entry.options["remote_saved_playlist"])
        writes = [payload for name, payload in sent if name == "updatePersistEffectList"]
        self.assertEqual([0, 1], [w["index"] for w in writes])
        self.assertEqual([1000, 1001], [w["effect"]["customId"] for w in writes])
        black = base64.b64decode(writes[0]["effect"]["effectParams"][0]["data"])
        self.assertEqual(bytes((0xFF, 0, 0, 0)) * 100, black)
        self.assertTrue(self.light.remote_playlist_active)
        self.assertIn("redraw", self.light.calls)  # the lamp may have switched to a slot
        self.light._sync_remote_playlist()  # already black: nothing more
        self.assertEqual(3, len(sent))

        # A press: the lamp shows a black slot and reports its custom id.
        events = self.lamp_events()
        self.light.calls.clear()
        self.report("effect_sub", 1001)  # the write's own report: ignored
        self.assertEqual([], events)
        self.light._remote_playlist_written_at = -100.0
        self.report("effect", 36)
        self.report("effect_sub", 1000)
        self.assertEqual([("right_button", {"slot": 0})], events)
        self.assertEqual(["redraw"], self.light.calls)

        # Turned off: the saved playlist is written back.
        sent.clear()
        entry.options = {**entry.options, "buttons_as_remote": False}
        self.light._sync_remote_playlist()
        self.assertEqual(
            [
                {"index": 0, "effect": {"effectId": 39, "customId": 39, "effectParams": [{"onoff": 1, "mode": 39}]}},
                {"index": 1, "effect": {"effectId": 42, "customId": 42, "effectParams": [{"onoff": 1, "mode": 42}]}},
            ],
            [payload for _name, payload in sent],
        )
        self.assertNotIn("remote_saved_playlist", entry.options)

    def test_external_effect_does_not_restore_or_rewrite_playlist(self):
        entry, sent = self.remote_lamp([(39, 39), (42, 42)])
        self.light._sync_remote_playlist()
        sent.clear()
        self.light.calls.clear()
        self.light._remote_playlist_written_at = -100.0
        self.report("effect", 34)
        self.assertEqual([], sent)
        self.assertNotIn("redraw", self.light.calls)
        self.assertEqual([[39, 39], [42, 42]], entry.options["remote_saved_playlist"])
        self.assertEqual("external_display", self.light.buttons_remote_status)
        self.assertFalse(self.light._rotation_active)
        # A remote press still shows it again (as the app starts it): the
        # lamp would otherwise stay black on every press.
        self.report("effect_sub", 1000)
        self.assertIn(("replay", [34, 0, 4]), self.light.calls)
        self.assertEqual("external_display", self.light.buttons_remote_status)

    def test_external_music_is_followed_by_default_even_with_remote_enabled(self):
        self.remote_lamp([(39, 39)])
        self.report("mic_music_on", True)
        self.report("effect", 85)
        self.assertTrue(self.light._music_flow_enabled)
        self.assertEqual("Blossom", self.light._music_flow_effect)
        self.assertNotIn("redraw", self.light.calls)
        self.assertNotIn(("music_flow", False), self.light.calls)
        self.report("effect", 64)  # an unknown external effect must also stop our music recovery
        self.assertFalse(self.light._music_flow_enabled)
        self.assertTrue(self.light._external_display)

    def test_unknown_external_effect_cancels_scroll_rotation_and_retry(self):
        self.remote_lamp([(39, 39)])
        retry = types.SimpleNamespace(done=lambda: False, cancel=Mock())
        self.light._retry_display_task = retry
        self.light._is_scrolling = True
        self.report("effect", 64)
        retry.cancel.assert_called_once()
        self.assertFalse(self.light._is_scrolling)
        self.assertFalse(self.light._rotation_active)
        self.assertTrue(self.light._external_display)

    def test_set_button_effects_goes_over_matter(self):
        # The lamp refuses update_persist_effect_list over LAN.
        _entry, sent = self.remote_lamp([])
        items = [
            {"effect_id": 39, "custom_id": 0, "effect_params": [{"mode": 39, "onoff": 1, "rate": 50, "direction": 1}]},
            {"effect_id": 40, "custom_id": 6, "effect_params": [{"mode": 40, "mixer": 0, "color": [33553920], "data": "AQAAAA=="}]},
        ]
        self.assertTrue(asyncio.run(self.light._write_button_playlist(items)))
        self.assertEqual([
            ("updatePersistEffectList", {"index": 0, "effect": {
                "effectId": 39, "customId": 0, "effectParams": [{"mode": 39, "onoff": 1, "direction": 1}]}}),
            ("updatePersistEffectList", {"index": 1, "effect": {
                "effectId": 40, "customId": 6, "effectParams": [
                    {"mode": 40, "mixer": 0, "color": [33553920, 0, 0, 0], "data": "AQAAAA=="}]}}),
        ], sent)
        # No server delivers Yeelight's commands: the light tries LAN.
        sent.clear()
        self.light._matter_commands.available = False
        self.assertFalse(asyncio.run(self.light._write_button_playlist(items)))
        self.assertEqual([], sent)

    def test_without_matter_settings_the_playlist_is_left_alone(self):
        entry, sent = self.remote_lamp([(39, 39)])
        self.light._matter_commands.available = False
        self.light._sync_remote_playlist()
        self.assertEqual(([], False), (sent, self.light.remote_playlist_active))
        self.light._matter = types.SimpleNamespace(linked=False, node_id=None, values={})
        self.light._matter_commands.available = True
        self.light._sync_remote_playlist()
        self.assertEqual([], sent)

    def test_restored_clock_report_does_not_rewrite_black_playlist(self):
        entry, sent = self.remote_lamp([(39, 39), (42, 42)])
        entry.options["remote_saved_playlist"] = [[39, 39], [42, 42]]
        events = self.lamp_events()
        # Include clock mixer/palette overrides of the outer effect id.
        for effect_id in (40, 71, 15, 64):
            with self.subTest(effect_id=effect_id):
                self.light._native_clock_params = lambda: [effect_id, 1, 2, {"mode": 40}]
                self.light._remote_playlist_written_at = -100.0
                self.report("effect_sub", 1000)
                self.light._note_lamp_command()
                sent.clear()
                events.clear()
                self.light.calls.clear()
                self.report("effect", effect_id)
                self.assertEqual([], sent)
                self.assertEqual([], events)
                self.assertEqual([], self.light.calls)

    def test_failed_playlist_install_retries_after_restart_without_replacing_backup(self):
        entry, sent = self.remote_lamp([(39, 39), (42, 42)])
        channel = self.light._matter_commands
        command = channel.async_command

        async def interrupted(cluster, name, payload=None):
            if name == "updatePersistEffectList" and payload["index"] == 1:
                raise RuntimeError("connection lost")
            return await command(cluster, name, payload)

        channel.async_command = interrupted
        self.light._sync_remote_playlist()
        self.assertFalse(entry.options["remote_playlist_installed"])
        self.assertEqual([[39, 39], [42, 42]], entry.options["remote_saved_playlist"])
        self.assertEqual("setup_pending", self.light.buttons_remote_status)
        # After a restart the persisted backup and incomplete marker survive.
        self.light._init_matter_state()
        self.light._matter = types.SimpleNamespace(linked=True, values={})
        self.light._matter_commands = channel

        async def partially_written(cluster, name, payload=None):
            if name == "getPersistEffectList":
                return {"effectList": [{"effectId": 36, "customId": 1000}, {"effectId": 42, "customId": 42}]}
            return await command(cluster, name, payload)

        channel.async_command = partially_written
        sent.clear()
        self.light._sync_remote_playlist()
        self.assertEqual(2, len(sent))
        self.assertTrue(entry.options["remote_playlist_installed"])
        self.assertEqual([[39, 39], [42, 42]], entry.options["remote_saved_playlist"])
        self.assertEqual("active", self.light.buttons_remote_status)

    def test_remote_status_and_pending_restoration_without_matter(self):
        entry, sent = self.remote_lamp([(39, 39)])
        published = []
        self.light._buttons_as_remote_switch = types.SimpleNamespace(
            hass=self.light.hass,
            async_write_ha_state=lambda: published.append(self.light.buttons_remote_status),
        )
        self.assertEqual("setup_pending", self.light.buttons_remote_status)
        self.light._matter_commands.backend = None
        self.light._matter_commands.available = False
        self.assertEqual("settings_unavailable", self.light.buttons_remote_status)
        self.light._matter.linked = False
        self.assertEqual("matter_unavailable", self.light.buttons_remote_status)
        entry.options["remote_saved_playlist"] = [[39, 39]]
        entry.options["buttons_as_remote"] = False
        self.light._sync_remote_playlist()
        self.assertEqual([], sent)
        self.assertEqual("restoration_pending", self.light.buttons_remote_status)
        self.light._matter.linked = True
        self.light._matter_commands.available = True
        self.light._sync_remote_playlist()
        self.assertEqual("disabled", self.light.buttons_remote_status)
        self.assertEqual("disabled", published[-1])
        self.assertNotIn("remote_saved_playlist", entry.options)

    def test_interrupted_restoration_then_reenable_reinstalls_black_slots(self):
        entry, sent = self.remote_lamp([(39, 39), (42, 42)])
        self.light._sync_remote_playlist()
        command = self.light._matter_commands.async_command

        async def interrupted(cluster, name, payload=None):
            if name == "updatePersistEffectList" and payload["index"] == 1:
                raise RuntimeError("connection lost")
            return await command(cluster, name, payload)

        self.light._matter_commands.async_command = interrupted
        entry.options["buttons_as_remote"] = False
        self.light._sync_remote_playlist()
        self.assertEqual("restoration_pending", self.light.buttons_remote_status)
        self.assertFalse(entry.options["remote_playlist_installed"])
        self.light._matter_commands.async_command = command
        entry.options["buttons_as_remote"] = True
        sent.clear()
        self.light._sync_remote_playlist()
        self.assertEqual([36, 36], [p["effect"]["effectId"] for name, p in sent if name == "updatePersistEffectList"])
        self.assertEqual([[39, 39], [42, 42]], entry.options["remote_saved_playlist"])

    def test_black_slots_without_a_backup_are_never_saved_as_the_backup(self):
        # Removed without turning the switch off: the lamp still holds black
        # slots, and the backup went with the old config entry.
        entry, sent = self.remote_lamp([(36, 1000), (36, 1001)])
        self.light._sync_remote_playlist()
        self.assertNotIn("remote_saved_playlist", entry.options)
        self.assertEqual([], [p for name, p in sent if name == "updatePersistEffectList"])
        self.assertEqual("backup_missing", self.light.buttons_remote_status)

    def test_an_empty_playlist_is_reported_not_left_pending(self):
        entry, sent = self.remote_lamp([])
        self.light._sync_remote_playlist()
        self.assertEqual("no_playlist", self.light.buttons_remote_status)
        self.assertNotIn("remote_saved_playlist", entry.options)

    def test_a_black_slot_is_restored_while_the_backup_waits_to_be_written(self):
        # Switch off, but Matter settings are gone: the black playlist stays
        # on the lamp until restoration, and a press still shows black.
        entry, _ = self.remote_lamp([(39, 39)])
        entry.options.update(buttons_as_remote=False, remote_saved_playlist=[[39, 39]])
        self.assertEqual("restoration_pending", self.light.buttons_remote_status)
        events = self.lamp_events()
        self.report("effect_sub", 1000)
        self.assertEqual([("right_button", {"slot": 0})], events)
        self.assertEqual(["redraw"], self.light.calls)

    def test_right_button_goes_back_to_the_content_before_left_button_music(self):
        # Seen on a Cube Lite: an effect, a left press (music), then right
        # presses stayed black. Remote mode stays active, and a black slot
        # undoes the lamp's music: the effect shown before it comes back.
        entry, _ = self.remote_lamp([(39, 39)])
        entry.options["remote_saved_playlist"] = [[39, 39]]
        entry.options["remote_playlist_installed"] = True
        self.light._matter_commands.backend = "matter"
        self.light._mode, self.light._native_effect = "Native Effect", "Bonfire"
        events = self.lamp_events()
        self.report("mic_music_on", True)
        self.report("effect", 83)
        self.assertTrue(self.light._music_flow_enabled)
        self.assertEqual("active", self.light.buttons_remote_status)
        self.light.calls.clear()
        self.report("effect_sub", 1000)
        self.assertEqual([("music_flow", False), "redraw"], self.light.calls)
        self.assertFalse(self.light._music_flow_enabled)
        self.assertEqual(("Native Effect", "Bonfire"), (self.light._mode, self.light._native_effect))
        # The black slot stopped the microphone, reported about 0.8 s later:
        # no music_off event for it.
        self.report("mic_music_on", False)
        self.assertEqual(
            ["music_mode_changed", "right_button"], [event for event, _data in events],
        )
        # A long press later is the left button again.
        self.light._remote_press_at = -100.0
        self.report("mic_music_on", False)
        self.assertEqual("music_off", events[-1][0])

    def test_right_button_brings_back_music_the_integration_started(self):
        entry, _ = self.remote_lamp([(39, 39)])
        entry.options["remote_saved_playlist"] = [[39, 39]]
        self.light._music_flow_enabled = True  # chosen in Home Assistant
        self.light._claim_display()
        self.report("mic_music_on", True)  # the left button changes its mode
        self.report("effect", 84)
        self.light.calls.clear()
        self.report("effect_sub", 1000)
        self.assertEqual([("music_flow", True)], self.light.calls)
        self.assertTrue(self.light._music_flow_enabled)

    def test_music_flow_is_reapplied_after_right_button(self):
        entry, _ = self.remote_lamp([(39, 39)])
        entry.options["remote_saved_playlist"] = [[39, 39]]
        self.light._music_flow_enabled = True
        self.report("effect_sub", 1000)
        self.assertEqual([("music_flow", True)], self.light.calls)

    def test_left_press_is_restored_on_first_report_after_unrelated_command(self):
        self.light._config_entry = types.SimpleNamespace(options={"restore_after_music_changes": True})
        self.light._cube_matrix = types.SimpleNamespace(forget_running_effect=lambda: None)
        self.light._note_lamp_command()  # clock/drawing just refreshed
        self.report("mic_music_on", True)
        self.assertEqual([("music_flow", False), "redraw"], self.light.calls)
        self.light.calls.clear()
        # Its own stop report must not fire a spurious music_off automation.
        events = self.lamp_events()
        self.light._expect_lamp_music(False)
        self.report("mic_music_on", False)
        self.assertEqual([], events)
        # A new press is opposite to the stop, even inside its echo window.
        self.report("mic_music_on", True)
        self.assertEqual([("music_flow", False), "redraw"], self.light.calls)

    def test_own_music_start_report_is_not_undone_before_state_update(self):
        self.light._config_entry = types.SimpleNamespace(options={"buttons_as_remote": True})
        self.light._expect_lamp_music(True)
        self.report("mic_music_on", True)
        self.assertEqual([], self.light.calls)
        events = self.lamp_events()
        self.report("mic_music_on", False)  # real long press, not our start
        self.assertEqual([("music_off", {})], events)

    def test_black_frame_power_echo_does_not_turn_logically_off_lamp_on(self):
        self.light._is_on = False
        self.light._expect_lamp_power(True)
        events = self.lamp_events()
        self.report("on_off", True)
        self.assertFalse(self.light._is_on)
        self.assertEqual([], events)
        self.light._lamp_power_command_at = -1000.0
        self.report("on_off", True)
        self.assertTrue(self.light._is_on)
        self.assertEqual([("turned_on", {})], events)

    def test_clock_echo_is_ignored_but_another_effect_is_still_followed(self):
        # The command bookkeeping also runs for LAN-only lamps. It needs no
        # Matter channel or query to identify the clock being sent.
        self.assertIsNone(self.light.matter_commands)
        self.light._note_lamp_command()
        self.report("effect", 40)
        self.assertEqual([], self.light.calls)
        self.report("effect", 34)
        self.assertEqual(("Native Effect", "Bonfire"), (self.light._mode, self.light._native_effect))
        # A late clock report after leaving it is the previous command's echo.
        self.report("effect", 40)
        self.assertEqual(("Native Effect", "Bonfire"), (self.light._mode, self.light._native_effect))

    def test_each_black_slot_invalidates_drawing_mode_without_effect_report(self):
        entry, _ = self.remote_lamp([(39, 39), (42, 42)])
        entry.options["remote_saved_playlist"] = [[39, 39], [42, 42]]
        self.light._mode = "Solid Color"
        events = self.lamp_events()
        for slot in (1000, 1001, 1000):
            # Matter can report the slot before effect=36, or only the slot
            # when the effect id has not changed. A previous redraw entered
            # direct mode again; each press must invalidate that cached state.
            self.light._fx_mode_is_direct = True
            self.report("effect_sub", slot)
            self.assertFalse(self.light._fx_mode_is_direct)
        self.assertEqual(3, len(events))
        self.assertEqual(["redraw"] * 3, self.light.calls)

    def test_the_lamp_buttons_entity_needs_the_matter_link(self):
        self.assertEqual("not_linked", self.light.matter_link_state)
        self.light._matter = types.SimpleNamespace(linked=True, node_id=2, values={})
        self.assertNotEqual("not_linked", self.light.matter_link_state)

    def test_lan_control_off_is_a_problem_only_when_linked(self):
        self.assertFalse(self.light.matter_lan_control_off)
        self.light._matter = types.SimpleNamespace(linked=True, values={"lan_control": False})
        self.assertTrue(self.light.matter_lan_control_off)

    def test_effect_ids_and_firmware_modes(self):
        self.assertEqual("Streamer", MATTER.NATIVE_EFFECT_IDS[3])
        self.assertEqual("Flower Sea", MATTER.NATIVE_EFFECT_IDS[91])


class ButtonCombinationTests(unittest.TestCase):
    """Every switch combination (Right / Left as Remote) and press sequence
    of docs/MATTER.md's table; the lamp shows the Native Effect Bonfire
    (34), chosen in Home Assistant."""

    def lamp(self, right, left):
        case = FollowedReportTests()
        case.setUp()
        entry, _ = case.remote_lamp([(39, 39), (42, 42)])
        entry.options.update(buttons_as_remote=right, restore_after_music_changes=left)
        if right:
            entry.options.update(remote_saved_playlist=[[39, 39], [42, 42]], remote_playlist_installed=True)
        light = case.light
        light._remote_playlist_written_at = -100.0
        light._mode, light._native_effect = "Native Effect", "Bonfire"
        self.case, self.light = case, light
        return light

    def right(self):
        self.light._remote_press_at = -100.0
        if self.light.remote_playlist_active:
            self.case.report("effect", 36)
            self.case.report("effect_sub", 1000)
        else:
            self.case.report("effect", 39)  # the lamp's own playlist: Rainbow

    def left(self, preset=83):
        self.case.report("mic_music_on", True)
        self.case.report("effect", preset)

    def left_hold(self, back=34):
        # reset_fx_effect: the lamp stops what runs and shows another effect.
        self.light._remote_press_at = -100.0
        self.case.report("mic_music_on", False)
        self.case.report("effect", back)

    def shows_own_content(self, mode=("Native Effect", "Bonfire")):
        light = self.light
        self.assertIn("redraw", light.calls)
        self.assertFalse(light._music_flow_enabled)
        self.assertFalse(light._external_display)
        self.assertEqual(mode, (light._mode, light._native_effect))

    def shows_followed_effect(self, effect_id, name):
        """An effect the lamp switched to by itself: followed, and shown
        again as the app starts it."""
        light = self.light
        self.assertIn(("replay", [effect_id, 0, 4]), light.calls)
        self.assertNotIn("redraw", light.calls)
        self.assertFalse(light._music_flow_enabled)
        self.assertEqual(("Native Effect", name), (light._mode, light._native_effect))

    def test_right_press(self):
        for left in (False, True):
            with self.subTest(left=left):
                self.lamp(True, left)
                self.right()
                self.shows_own_content()
                self.lamp(False, left)
                self.right()
                self.assertEqual("Rainbow", self.light._native_effect)  # followed
                self.assertNotIn("redraw", self.light.calls)

    def test_left_press(self):
        for right in (False, True):
            with self.subTest(right=right):
                self.lamp(right, True)
                self.left()
                self.shows_own_content()
                self.lamp(right, False)
                self.left()
                self.assertTrue(self.light._music_flow_enabled)  # followed on top
                self.assertNotIn("redraw", self.light.calls)

    def test_left_then_right_brings_back_what_was_shown_before_the_music(self):
        for left in (False, True):
            with self.subTest(left=left):
                self.lamp(True, left)
                self.left()
                self.light.calls.clear()
                self.right()
                self.shows_own_content()

    def test_left_as_remote_after_a_followed_playlist_effect(self):
        # Right as Remote off: the playlist's Rainbow is followed (another
        # app's effect, as far as the reports tell); the left press is still
        # undone, back to that followed effect.
        self.lamp(False, True)
        self.right()
        self.light.calls.clear()
        self.left()
        self.shows_followed_effect(39, "Rainbow")

    def test_right_press_after_a_left_hold_is_never_stuck_black(self):
        for left in (False, True):
            for start_with_music in (False, True):
                with self.subTest(left=left, music=start_with_music):
                    self.lamp(True, left)
                    if start_with_music:
                        self.left()
                    self.left_hold()  # the lamp shows Bonfire again, followed
                    self.light.calls.clear()
                    self.right()
                    self.shows_followed_effect(34, "Bonfire")
                    self.right()  # and on every press after it
                    self.assertEqual(2, self.light.calls.count(("replay", [34, 0, 4])))

    def test_right_press_after_a_left_hold_on_text(self):
        light = self.lamp(True, False)
        light._mode = "Solid Color"
        self.left_hold(back=50)
        light.calls.clear()
        self.right()
        self.shows_own_content(("Solid Color", "Bonfire"))

    def test_right_press_after_another_apps_effect(self):
        self.lamp(True, False)
        self.case.report("effect", 42)  # an app's Ocean Waves: followed
        self.assertTrue(self.light._external_display)
        self.light.calls.clear()
        self.right()
        self.shows_followed_effect(42, "Ocean Waves")

    def test_left_press_keeps_another_apps_display_external_until_a_press(self):
        light = self.lamp(True, False)
        self.case.report("effect", 42)
        self.left()
        self.assertTrue(light._external_display)  # music doesn't end it
        light.calls.clear()
        self.right()
        self.shows_followed_effect(42, "Ocean Waves")

    def test_a_press_on_a_lamp_that_is_off(self):
        # Off in Home Assistant, the lamp powered and black (a drawing's off,
        # or any off without Wake Lamp When Off).
        for wake in (True, False):
            for press in ("right", "left"):
                with self.subTest(wake=wake, press=press):
                    light = self.lamp(True, True)
                    self.case.light._config_entry.options["buttons_wake_lamp"] = wake
                    light._is_on = False
                    light.calls.clear()
                    self.right() if press == "right" else self.left()
                    self.assertEqual(wake, light._is_on)
                    self.assertIn("redraw" if wake else "turn_off", light.calls)
                    self.assertNotIn("turn_off" if wake else "redraw", light.calls)
                    self.assertFalse(light._music_flow_enabled)

    def test_off_keeps_the_lamp_powered_only_for_a_remote_that_must_not_wake_it(self):
        for right, left, wake, kept in (
            (True, False, False, True), (False, True, False, True),
            (True, True, True, False), (False, False, False, False),
        ):
            with self.subTest(right=right, left=left, wake=wake):
                light = self.lamp(right, left)
                self.case.light._config_entry.options["buttons_wake_lamp"] = wake
                self.assertEqual(kept, light.remote_keeps_lamp_powered)

    def test_the_black_picture_of_off_is_its_echo(self):
        light = self.lamp(True, False)
        light._is_on = False
        light._note_lamp_command()  # turn_off: black, the lamp left Bonfire
        self.case.report("effect", 50)
        self.assertFalse(light._external_display)
        self.assertFalse(light._is_on)

    def test_another_apps_content_on_a_lamp_that_is_off_turns_it_on(self):
        light = self.lamp(True, False)
        light._is_on = False
        self.case.report("effect", 42)
        self.assertTrue(light._is_on)

    def test_right_press_brings_back_the_integrations_own_music_mode(self):
        light = self.lamp(True, False)
        light._music_flow_enabled, light._music_flow_effect = True, "Breathing"
        self.left(preset=83)  # the lamp's next preset: Gather
        self.assertEqual("Gather", light._music_flow_effect)
        light.calls.clear()
        self.right()
        self.assertEqual(["refresh", ("music_flow", True)], light.calls)  # its select shows it
        self.assertEqual("Breathing", light._music_flow_effect)


class AppContentTests(unittest.IsolatedAsyncioTestCase):
    """With Right as Remote on, a press shows the Yeelight app's content
    again when its reports tell what it is: its clock, an animation, a
    built-in pixel art. Its own drawings cannot be rebuilt: the press brings
    back the integration's content (Bonfire, chosen in Home Assistant)."""

    def setUp(self):
        wait = MATTER.EXTERNAL_DRAWING_WAIT
        MATTER.EXTERNAL_DRAWING_WAIT = 0
        self.addCleanup(setattr, MATTER, "EXTERNAL_DRAWING_WAIT", wait)

    def lamp(self, left=False):
        case = FollowedReportTests()
        case.setUp()
        entry, _ = case.remote_lamp([(39, 39), (42, 42)])
        entry.options.update(
            remote_saved_playlist=[[39, 39], [42, 42]], remote_playlist_installed=True,
            restore_after_music_changes=left,
        )
        light = case.light
        light._remote_playlist_written_at = -100.0
        light._mode, light._native_effect = "Native Effect", "Bonfire"
        light._matter.values.update(rotation=2, effect=34, effect_sub=0, hue=150, saturation=254)
        self.sent, self.methods, self.tasks = [], [], []

        async def send_raw_command(command, params, **kwargs):
            self.sent.append(params)
            self.methods.append(command)
            # The lamp reports what it shows now, before the press's content
            # check (EXTERNAL_DRAWING_WAIT) reads the reports.
            effect = params[0] if command == "set_fx_effect" else 0
            light._matter.values["effect"] = effect
            light._on_matter_report("effect", effect, False)

        self.events = []
        light._lamp_buttons_event = types.SimpleNamespace(
            hass=object(), lamp_event=lambda kind, data: self.events.append(kind),
            async_write_ha_state=lambda: None,
        )

        async def execute(func, op_name, **kwargs):
            light._note_lamp_command()
            await func()

        async def leave_direct_mode():
            pass

        def create_task(coroutine, name=None):
            task = asyncio.create_task(coroutine)
            self.tasks.append(task)
            return task

        light._cube_matrix = types.SimpleNamespace(
            forget_running_effect=lambda: None, note_running_effect=lambda params: None,
            send_raw_command=send_raw_command,
        )
        light._execute_hardware_op = execute
        light._leave_direct_mode = leave_direct_mode
        # The real replay, not FakeLight's record of it.
        light._replay_app_content = types.MethodType(MATTER.MatterMixin._replay_app_content, light)
        light._native_clock_data_bytes = lambda: bytes((1, 0, 0, 0))
        light._create_tracked_task = create_task
        self.light = light
        return light

    async def report(self, *reports):
        for name, value in reports:
            self.light._matter.values[name] = value
            self.light._on_matter_report(name, value, False)
        while self.tasks:
            await self.tasks.pop(0)

    async def right(self):
        self.light._remote_press_at = -100.0
        await self.report(("effect", 36), ("effect_sub", 1000))

    def shows_app_content(self, params, method="set_fx_effect"):
        light = self.light
        self.assertEqual([params], self.sent)
        self.assertEqual([method], self.methods)
        self.assertNotIn("redraw", light.calls)
        self.assertTrue(light._external_display)  # still the app's
        self.assertEqual(("Native Effect", "Bonfire"), (light._mode, light._native_effect))

    def shows_own_content(self):
        self.assertEqual([], self.sent)
        self.assertIn("redraw", self.light.calls)
        self.assertFalse(self.light._external_display)

    @staticmethod
    def pixel_art_data(filename, group, item):
        argb = json.loads(json.loads(
            (PRESETS / filename).read_text(encoding="utf-8"))[group][item])
        return base64.b64encode(b"".join(p.to_bytes(4, "big") for p in argb)).decode("ascii")

    async def test_an_animation_comes_back(self):
        for reports in ((("effect", 71), ("effect_sub", 77)), (("effect_sub", 77), ("effect", 71))):
            with self.subTest(order=[name for name, _ in reports]):
                self.lamp()
                await self.report(*reports)
                await self.right()
                self.shows_app_content([71, 77, 4, {"onoff": 1}])

    async def test_a_clock_comes_back_with_its_style(self):
        self.lamp()
        await self.report(("effect", 40), ("effect_sub", 6))
        await self.report(("effect_sub", 9))  # the app's next style: only the id changes
        self.light._matter.summary = lambda: {"node_id": 2}
        self.light._matter_commands.reason = None
        self.assertEqual(["set_fx_effect", 40, 9], self.light._matter_summary()["app_content"])
        await self.right()
        self.shows_app_content([40, 9, 2, {
            "mode": 40, "mixer": 0, "data": base64.b64encode(bytes((1, 0, 0, 0))).decode("ascii"),
            "color": [12046834],
        }])

    async def test_a_plain_colour_comes_back(self):
        # Live test 2026-10-27: a colour from the app is effect 0, its colour
        # Color Control's hue and saturation (light red: 2, 197).
        for reports in ((("hue", 2), ("saturation", 197), ("effect", 0)),
                        (("effect", 0), ("hue", 2), ("saturation", 197))):
            with self.subTest(order=[name for name, _ in reports]):
                self.lamp()
                await self.report(*reports)
                await self.right()
                self.shows_app_content([3, 78, "sudden", 30], "set_hsv")

    async def test_the_replay_is_not_taken_for_a_new_app_change(self):
        # Live test 2026-10-27: the black slot's effect 36 started the content
        # check; it then read the replayed colour (effect 0) as the app's.
        self.lamp()
        await self.report(("hue", 2), ("saturation", 197), ("effect", 0))
        self.events.clear()
        await self.right()
        self.assertEqual(["right_button"], self.events)
        self.assertEqual(1, len(self.sent))

    async def test_the_apps_next_colour_is_told_by_the_colour_alone(self):
        self.lamp()
        await self.report(("effect", 0))
        await self.report(("hue", 100))  # another colour: the effect stays 0
        await self.right()
        self.shows_app_content([142, 100, "sudden", 30], "set_hsv")
        await self.report(("effect", 0), ("hue", 100))  # the replay's own reports
        self.assertEqual(1, len(self.sent))

    async def test_a_built_in_pixel_art_comes_back_from_the_gallery_of_the_lamps_direction(self):
        for rotation, filename in ((2, "horizontal.json"), (1, "vertical.json")):
            with self.subTest(rotation=rotation):
                light = self.lamp()
                light._matter.values["rotation"] = rotation
                await self.report(("effect", 36), ("effect_sub", 0x40000000 + 200 + 3))
                await self.right()
                self.shows_app_content([36, 0x40000000 + 203, 4, {
                    "onoff": 1, "mode": 36, "mixer": 0,
                    "data": self.pixel_art_data(filename, "1", "3"),
                }])

    async def test_a_built_in_pixel_art_after_a_press_is_told_by_its_id_alone(self):
        self.lamp()
        await self.right()  # black slot: effect 36 already
        self.light.calls.clear()
        await self.report(("effect_sub", 0x40000000 + 100))
        self.assertTrue(self.light._external_display)
        await self.right()
        self.assertEqual(36, self.sent[0][0])

    async def test_an_old_id_is_not_trusted_for_a_drawing(self):
        light = self.lamp()
        # A built-in picture's id left from before; the app now sends a
        # drawing without an id: only the effect is reported.
        light._matter.values["effect_sub"] = 0x40000000 + 100
        await self.report(("effect", 36))
        self.assertTrue(light._external_display)
        await self.right()
        self.shows_own_content()

    async def test_the_apps_own_drawings_cannot_come_back(self):
        self.lamp()
        await self.report(("effect", 36), ("effect_sub", 123456))  # a Yeelight cloud id
        await self.right()
        self.shows_own_content()

    async def test_left_as_remote_undoes_the_music_back_to_the_apps_content(self):
        light = self.lamp(left=True)
        await self.report(("effect", 71), ("effect_sub", 72))
        await self.report(("mic_music_on", True), ("effect", 83))
        self.assertIn(("music_flow", False), light.calls)
        self.shows_app_content([71, 72, 4, {"onoff": 1}])

    async def test_its_own_reports_are_echoes(self):
        light = self.lamp()
        await self.report(("effect", 40), ("effect_sub", 6))
        await self.right()
        await self.report(("effect", 40), ("effect_sub", 6))  # the lamp shows it again
        self.assertEqual(1, len(self.sent))
        self.assertTrue(light._external_display)

    async def test_a_home_assistant_command_forgets_it(self):
        light = self.lamp()
        await self.report(("effect", 71), ("effect_sub", 77))
        light._claim_display()  # what every display command does
        await self.right()
        self.shows_own_content()


class RemoteConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_external_change_cancels_queued_remote_restoration(self):
        light = FakeLight()
        tasks = []
        light._create_tracked_task = lambda coro, name=None: tasks.append(asyncio.create_task(coro))
        light._restore_after_lamp_change()
        light._lamp_changed_effect(71)
        await asyncio.gather(*tasks)
        self.assertNotIn("redraw", light.calls)
        self.assertTrue(light._external_display)

    async def test_external_drawing_shares_effect_id_but_not_remote_tag(self):
        for order in (("effect", "effect_sub"), ("effect_sub", "effect")):
            light = FakeLight()
            light._config_entry = types.SimpleNamespace(options={
                "buttons_as_remote": True, "remote_saved_playlist": [[39, 39]],
            })
            light._matter = types.SimpleNamespace(values={"effect": 40, "effect_sub": 1000})
            tasks = []
            def create_task(coro, name=None):
                task = asyncio.create_task(coro)
                tasks.append(task)
                return task
            light._create_tracked_task = create_task
            for name in order:
                value = 36 if name == "effect" else 0
                light._matter.values[name] = value
                light._on_matter_report(name, value, False)
            await asyncio.gather(*tasks)
            self.assertTrue(light._external_display)
            self.assertNotIn("redraw", light.calls)

    async def test_presses_during_restore_are_coalesced_and_music_request_kept(self):
        light = FakeLight()
        light._cube_matrix = types.SimpleNamespace(forget_running_effect=lambda: None)
        started, finish = asyncio.Event(), asyncio.Event()
        tasks = []

        def create_task(coroutine, name=None):
            task = asyncio.create_task(coroutine, name=name)
            tasks.append(task)
            return task

        light._create_tracked_task = create_task

        async def redraw(update_type=None):
            light.calls.append("redraw")
            if len(light.calls) == 1:
                started.set()
                await finish.wait()

        light.async_apply_display_mode = redraw
        light._restore_after_lamp_change()
        light._restore_after_lamp_change()  # before the worker even starts
        self.assertEqual(1, len(tasks))
        await started.wait()
        light._restore_after_lamp_change()
        light._restore_after_lamp_change(music=True)
        light._restore_after_lamp_change()
        finish.set()
        await asyncio.gather(*tasks)
        self.assertEqual(["redraw", ("music_flow", False), "redraw"], light.calls)
        self.assertFalse(light._restoring_after_lamp)

    async def test_pending_restore_uses_latest_power_state(self):
        light = FakeLight()
        light._cube_matrix = types.SimpleNamespace(forget_running_effect=lambda: None)

        async def redraw(update_type=None):
            light.calls.append("redraw")
            light._restore_after_lamp_change(music=True)
            light._is_on = False  # power changed while the redraw was in flight

        light.async_apply_display_mode = redraw
        await light._async_put_content_back()
        self.assertEqual(["redraw", ("music_flow", False), "turn_off"], light.calls)

    async def test_playlist_sync_reserves_worker_and_handles_toggle_during_write(self):
        case = FollowedReportTests()
        case.setUp()
        entry, sent = case.remote_lamp([(39, 39), (42, 42)])
        light = case.light
        tasks = []

        def create_task(coroutine, name=None):
            task = asyncio.create_task(coroutine, name=name)
            tasks.append(task)
            return task

        light._create_tracked_task = create_task
        command = light._matter_commands.async_command
        events = case.lamp_events()

        async def toggle_during_write(cluster, name, payload=None):
            if name == "updatePersistEffectList" and payload["effect"]["effectId"] == 36:
                # The write's reports must not be mistaken for button presses.
                light._on_matter_report("effect_sub", 1000, False)
                entry.options["buttons_as_remote"] = False
                light._sync_remote_playlist()
            return await command(cluster, name, payload)

        light._matter_commands.async_command = toggle_during_write
        light._sync_remote_playlist()
        light._sync_remote_playlist()
        self.assertEqual(1, len(tasks))
        await tasks[0]
        await asyncio.gather(*tasks)
        self.assertEqual([], events)
        self.assertNotIn("remote_saved_playlist", entry.options)
        self.assertEqual("disabled", light.buttons_remote_status)
        writes = [payload["effect"]["effectId"] for name, payload in sent if name == "updatePersistEffectList"]
        self.assertEqual([36, 36, 39, 42], writes)


if __name__ == "__main__":
    unittest.main()
