"""The lamp's saved mount profile (mount_profile.py, light_mount_profile.py,
light_matter.py): the firmware turns every native effect direction by it
(DIRECTION_TABLE, MCU v34), the integration's directions were calibrated on
profile 2, and the value sent is compensated for the lamp's own profile.

Where the profile comes from: Matter once confirmed (written here, or changed
in the Yeelight app, on the linked node) or when only a save gives its value,
else the user's choice (options, the Fire check), else unknown (then the
firmware's default 3, what a lamp never saved, or reset, runs)."""
import asyncio
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from tests.test_live_effect import FNS
from tests.test_matter_link import LINK, MATTER, FakeLight
from tests.test_native_features import CONSTANTS, import_pure_module

PROFILE = import_pure_module("mount_profile")
TABLE = PROFILE.DIRECTION_TABLE
compensate = PROFILE.compensate_direction
resolve = PROFILE.resolve_profile

# The DIRECTION_TABLE of the firmware analysis (ORIENTATION_AND_MOUNT_PROFILE.md).
FIRMWARE_TABLE = [[2, 3, 1, 0], [1, 0, 3, 2], [3, 2, 0, 1], [0, 1, 2, 3]]


class CompensationTests(unittest.TestCase):
    def test_the_table_is_the_firmwares_and_each_row_a_permutation(self):
        self.assertEqual(FIRMWARE_TABLE, [list(row) for row in TABLE])
        for row in TABLE:
            self.assertEqual([0, 1, 2, 3], sorted(row))
        self.assertEqual(3, PROFILE.FIRMWARE_DEFAULT_PROFILE)
        self.assertEqual((0, 1, 2, 3), TABLE[PROFILE.FIRMWARE_DEFAULT_PROFILE])  # identity
        self.assertEqual(2, PROFILE.REFERENCE_PROFILE)

    def test_every_profile_pair_and_direction_draws_the_same(self):
        for reference in range(4):
            for profile in range(4):
                for direction in range(4):
                    sent = compensate(direction, profile, reference)
                    self.assertIn(sent, range(4))
                    self.assertEqual(
                        TABLE[reference][direction], TABLE[profile][sent],
                        (reference, profile, direction),
                    )
                # A permutation: four directions stay four.
                self.assertEqual(
                    [0, 1, 2, 3], sorted(compensate(d, profile, reference) for d in range(4))
                )

    def test_the_calibrations_profile_and_an_unknown_one_change_nothing(self):
        for direction in range(4):
            self.assertEqual(direction, compensate(direction, 2))
            self.assertEqual(direction, compensate(direction, None))
            self.assertEqual(direction, compensate(direction, "garbage"))
            self.assertEqual(direction, compensate(direction, True))

    def test_the_documented_example_and_the_half_turn(self):
        # Calibrated on 2, lamp now on 3 (identity, after a reset).
        self.assertEqual([3, 2, 0, 1], [compensate(d, 3) for d in range(4)])
        # Profile 0 is a half turn from 2: the opposite direction.
        self.assertEqual([1, 0, 3, 2], [compensate(d, 0) for d in range(4)])
        # Profile 1 is a quarter turn, not a half turn.
        self.assertEqual([2, 3, 1, 0], [compensate(d, 1) for d in range(4)])

    def test_the_clock_turns_on_profiles_0_and_1(self):
        # Mixer 1 tests profile & ~1 == 2: upright on 2 and 3.
        self.assertEqual(
            [True, True, False, False, False],
            [PROFILE.clock_turned(p) for p in (0, 1, 2, 3, None)],
        )

    def test_the_star_check_as_measured_on_the_lamps(self):
        params = PROFILE.STAR_CHECK_PARAMS
        self.assertEqual((47, 47, 3), (params[0], params[3]["mode"], params[3]["direction"]))
        check = PROFILE.star_check_profile
        # 2026-10-29: the bottom lamp (180 degrees, read over Matter) flew
        # left, the top lamp (reset, 270 degrees) down.
        self.assertEqual(2, check("left"))
        self.assertEqual(3, check("down"))
        self.assertEqual({"right": 0, "up": 1, "left": 2, "down": 3},
                         {seen: check(seen) for seen in ("right", "up", "left", "down")})
        self.assertIsNone(check("unclear"))
        self.assertEqual("Arrow down (270°)", PROFILE.arrow_text(3))

    def test_the_star_check_on_every_mount(self):
        check = PROFILE.star_check_profile
        for mount in ("right", "down", "left", "up"):
            # Four ways, four profiles, on every mount.
            self.assertEqual([0, 1, 2, 3], sorted(check(seen, mount) for seen in PROFILE.MOTIONS), mount)
        # Upside down (Left): the viewer sees it turned a half turn.
        self.assertEqual(check("left"), check("right", "left"))
        # Standing (Down): the lamp's left end on top, so its "left" is "up".
        self.assertEqual(check("left"), check("up", "down"))
        self.assertEqual(check("left"), check("down", "up"))
        self.assertEqual(check("left"), check("left", None))


class ResolutionTests(unittest.TestCase):
    def test_lan_only(self):
        self.assertEqual((None, "unknown"), resolve(None, None, None, None, None))
        self.assertEqual((3, "user"), resolve(3, "user", None, None, None))
        self.assertEqual((None, "unknown"), resolve(7, "user", None, None, None))
        # The last value Matter confirmed, with Matter gone.
        self.assertEqual((1, "matter"), resolve(1, "matter", 4, None, None))

    def test_matter_is_the_truth_on_the_node_it_was_confirmed_on(self):
        self.assertEqual((2, "matter"), resolve(None, None, 4, 4, 2))
        # It follows the app: the live value, not the one kept.
        self.assertEqual((0, "matter"), resolve(2, "matter", 4, 4, 0))
        # Over the user's choice too.
        self.assertEqual((1, "matter"), resolve(3, "user", 4, 4, 1))
        # An invalid report: what is kept.
        self.assertEqual((2, "matter"), resolve(2, "matter", 4, 4, None))

    def test_an_unconfirmed_default_read_is_never_trusted(self):
        # First link, 0 with no saved topology: the Wi-Fi chip's default (a
        # lamp never saved, which runs 3), not the lamp's.
        self.assertEqual((None, "unknown"), resolve(None, None, None, 4, 0))
        self.assertEqual((None, "unknown"), resolve(None, None, None, 4, 0, [0] * 8))
        self.assertEqual((None, "unknown"), resolve(None, None, None, 4, 0, []))
        self.assertEqual((3, "user"), resolve(3, "user", None, 4, 0))

    def test_a_value_only_a_save_gives_is_the_lamps(self):
        # 1-3: written (the app's Save, or a Matter write): trusted at once,
        # over the user's choice too.
        for rotation in (1, 2, 3):
            self.assertEqual((rotation, "matter"), resolve(None, None, None, 4, rotation))
            self.assertEqual((rotation, "matter"), resolve(0, "user", None, 4, rotation))
        # 0 with the topology the app's Save writes first: a 0 degree saved in the app.
        saved = [2, 2, 2, 2, 0, 0, 0, 0]
        self.assertEqual((0, "matter"), resolve(None, None, None, 4, 0, saved))
        self.assertTrue(PROFILE.saved_on_lamp(0, saved))
        self.assertFalse(PROFILE.saved_on_lamp(0, None))
        self.assertFalse(PROFILE.saved_on_lamp(None, saved))

    def test_unknown_runs_the_firmware_default(self):
        self.assertEqual(3, PROFILE.effective_profile(None))
        self.assertEqual(1, PROFILE.effective_profile(1))
        self.assertFalse(PROFILE.clock_turned(PROFILE.effective_profile(None)))

    def test_after_a_factory_reset_the_new_node_is_not_trusted(self):
        # The lamp re-paired after a reset: a new node reads 0 while the lamp
        # runs 3. Neither its read nor the old node's value is used.
        self.assertEqual((None, "unknown"), resolve(2, "matter", 4, 9, 0))
        # A choice the user made still is.
        self.assertEqual((3, "user"), resolve(3, "user", 4, 9, 0))


def entry_and_hass(options=None):
    entry = SimpleNamespace(options=dict(options or {}))
    hass = SimpleNamespace(config_entries=SimpleNamespace(
        async_update_entry=lambda target, options: setattr(target, "options", options)
    ))
    return entry, hass


class Channel:
    """Yeelight writes over Matter (matter_commands.py)."""

    def __init__(self, backend="dev"):
        self.backend = backend
        self.error = None
        self.written = []

    async def async_write(self, path, value):
        if self.error is not None:
            raise self.error
        self.written.append((path, value))


class ProfileLight(FakeLight):
    def __init__(self, options=None):
        super().__init__()
        self._config_entry, self.hass = entry_and_hass(options)
        self._cube_matrix = SimpleNamespace(forget_running_effect=Mock())
        self._mode = "Native Effect"
        self._external_display = False
        self.pending = []

    def _create_tracked_task(self, coroutine, name=None):
        self.pending.append(coroutine)
        return coroutine

    def run_tasks(self):
        while self.pending:
            asyncio.run(self.pending.pop(0))

    def link(self, node_id, rotation, channel=None):
        self._matter = SimpleNamespace(linked=True, node_id=node_id, values={"rotation": rotation})
        self._matter_commands = channel
        self._on_matter_report("rotation", rotation, True)


class MatterProfileTests(unittest.TestCase):
    def test_a_first_link_writes_the_orientation_before_trusting_the_read(self):
        light = ProfileLight()
        light._device_orientation = "left"  # 0°
        channel = Channel()
        # Never confirmed, reads 0 (the post-reset default) while the lamp
        # runs 3: not trusted, effects keep the calibration.
        light.link(7, 0, channel)
        self.assertEqual((None, "unknown"), light.mount_profile)
        self.assertEqual(3, light.effect_profile)  # what it runs
        self.assertFalse(light.lamp_turns_clock)
        # Written once, although the read already says 0.
        light._check_mount_profile()
        light.run_tasks()
        self.assertEqual([(LINK.ROTATION, 0)], channel.written)
        self.assertEqual((0, "matter"), light.mount_profile)
        self.assertEqual(7, light._config_entry.options["mount_profile_node"])
        self.assertTrue(light.lamp_turns_clock)
        # What the lamp shows follows: the effect is sent again.
        self.assertIn("redraw", light.calls)
        light._cube_matrix.forget_running_effect.assert_called()
        # Confirmed: not written again (every minute's link refresh).
        light._check_mount_profile()
        light.run_tasks()
        self.assertEqual(1, len(channel.written))

    def test_a_value_saved_in_the_app_is_followed_never_overwritten(self):
        for rotation, topology in ((1, None), (3, [0] * 8), (0, [2, 2, 2, 2, 0, 0, 0, 0])):
            light = ProfileLight()
            light._device_orientation = "right"  # 180: not what the app saved
            channel = Channel()
            light._matter = SimpleNamespace(
                linked=True, node_id=7, values={"rotation": rotation, "topology": topology}
            )
            light._matter_commands = channel
            self.assertEqual((rotation, "matter"), light.mount_profile)
            light._check_mount_profile()
            light.run_tasks()
            self.assertEqual([], channel.written, (rotation, topology))  # not overwritten
            self.assertEqual(7, light._config_entry.options["mount_profile_node"])
            self.assertEqual(rotation, light._config_entry.options["mount_profile"])

    def test_a_never_saved_lamp_is_written_with_its_device_orientation(self):
        light = ProfileLight()
        light._device_orientation = "right"
        channel = Channel()
        light._matter = SimpleNamespace(
            linked=True, node_id=7, values={"rotation": 0, "topology": [0] * 8}
        )
        light._matter_commands = channel
        self.assertEqual(3, light.effect_profile)  # until written: the default
        light._check_mount_profile()
        light.run_tasks()
        self.assertEqual([(LINK.ROTATION, 2)], channel.written)
        self.assertEqual((2, "matter"), light.mount_profile)

    def test_after_a_factory_reset_the_new_node_is_written_again(self):
        light = ProfileLight({"mount_profile": 2, "mount_profile_source": "matter", "mount_profile_node": 7})
        light._device_orientation = "right"  # 180°
        channel = Channel()
        light.link(7, 2, channel)
        self.assertEqual((2, "matter"), light.mount_profile)
        light._check_mount_profile()
        self.assertEqual([], light.pending)  # already confirmed
        # Reset (both buttons, ~6 s), paired again: new node 9, reads 0, the
        # lamp runs 3. Not trusted; written before it is.
        light.link(9, 0, channel)
        self.assertEqual((None, "unknown"), light.mount_profile)
        light._check_mount_profile()
        light.run_tasks()
        self.assertEqual([(LINK.ROTATION, 2)], channel.written)
        self.assertEqual((2, "matter"), light.mount_profile)
        self.assertEqual(9, light._config_entry.options["mount_profile_node"])

    def test_without_a_server_for_the_write_the_read_is_not_used(self):
        light = ProfileLight({"mount_profile": 3, "mount_profile_source": "user"})
        light._device_orientation = "right"
        channel = Channel(backend=None)
        channel.error = MATTER.MatterCommandsUnavailable()
        light.link(7, 0, channel)
        light._check_mount_profile()
        light.run_tasks()
        # The user's choice stays in use, the Matter read is ignored.
        self.assertEqual((3, "user"), light.mount_profile)
        self.assertNotIn("mount_profile_node", light._config_entry.options)
        # Not tried again on every refresh with the same (node, server)...
        light._check_mount_profile()
        self.assertEqual([], light.pending)
        # ...but once a server delivers it.
        channel.error, channel.backend = None, "matter"
        light._check_mount_profile()
        light.run_tasks()
        self.assertEqual([(LINK.ROTATION, 2)], channel.written)
        self.assertEqual((2, "matter"), light.mount_profile)

    def test_a_change_in_the_app_confirms_and_is_followed(self):
        light = ProfileLight()
        light._device_orientation = "right"
        light.link(7, 0, None)  # no server for writes
        # A re-sent report of the same value is no change: still unknown.
        light._on_matter_report("rotation", 0, False)
        self.assertEqual((None, "unknown"), light.mount_profile)
        # Saved in the app (writes the lamp and the attribute alike).
        light._matter.values["rotation"] = 3
        light._on_matter_report("rotation", 3, False)
        self.assertEqual((3, "matter"), light.mount_profile)
        self.assertEqual(7, light._config_entry.options["mount_profile_node"])
        # And followed from then on.
        light._matter.values["rotation"] = 1
        light._on_matter_report("rotation", 1, False)
        self.assertEqual((1, "matter"), light.mount_profile)
        self.assertEqual(1, light._config_entry.options["mount_profile"])
        light.run_tasks()  # the Device Orientation follows (set_device_orientation)

    def test_the_echo_of_a_write_is_no_app_change(self):
        light = ProfileLight()
        light._device_orientation = "right"
        channel = Channel()
        light.link(7, 2, channel)
        self.assertTrue(asyncio.run(light._sync_lamp_rotation("left")))
        light.run_tasks()
        light._on_matter_report("rotation", 0, False)  # its echo
        self.assertEqual([], light.pending)  # nothing turned again


def native_lamp(profile=None, effect="Rainbow", direction="Up"):
    """What _native_effect_params reads, with the profile in use."""
    return SimpleNamespace(
        _native_effect=effect, _native_effect_speed=50,
        _native_effect_direction=direction, _device_orientation="none",
        _native_effect_direction_select_entity=None,
        _native_effect_color_mode="normal", _native_effect_color=None,
        effect_profile=PROFILE.effective_profile(profile),
    )


class LanOnlyTests(unittest.TestCase):
    """No Matter: never guessed, the user's choice or the calibration's."""

    def sent_direction(self, profile, effect, direction):
        return FNS["_native_effect_params"](native_lamp(profile, effect, direction))[3]["direction"]

    def test_a_180_degree_lamp_sends_what_it_always_did(self):
        value = CONSTANTS["effect_direction_value"]
        for name, spec in CONSTANTS["NATIVE_EFFECTS"].items():
            for direction in spec.get("directions") or ():
                self.assertEqual(value(spec, direction), self.sent_direction(2, name, direction), name)

    def test_an_unknown_lamp_is_compensated_for_the_firmware_default(self):
        # Never saved in the app, or reset: the lamp runs 3.
        for name, spec in CONSTANTS["NATIVE_EFFECTS"].items():
            for direction in spec.get("directions") or ():
                self.assertEqual(
                    self.sent_direction(3, name, direction),
                    self.sent_direction(None, name, direction), name,
                )

    def test_another_profile_is_compensated_on_the_value_sent(self):
        # Rainbow Up: its remap sends Down (1); on 3 (identity) the lamp must
        # draw TABLE[2][1] = Left (2), so 2 is sent.
        self.assertEqual(1, self.sent_direction(2, "Rainbow", "Up"))
        self.assertEqual(2, self.sent_direction(3, "Rainbow", "Up"))
        for profile in range(4):
            for direction in ("Up", "Down", "Left", "Right"):
                calibrated = self.sent_direction(2, "Aurora", direction)
                sent = self.sent_direction(profile, "Aurora", direction)
                self.assertEqual(TABLE[2][calibrated], TABLE[profile][sent])

    def test_the_profile_with_no_matter_and_no_choice_is_unknown(self):
        light = ProfileLight()
        self.assertEqual((None, "unknown"), light.mount_profile)
        self.assertEqual(3, light.effect_profile)
        self.assertEqual(
            {"profile": None, "source": "unknown", "in_use": 3}, light._mount_profile_summary()
        )

    def test_the_users_choice_is_kept_and_followed(self):
        light = ProfileLight()
        light.async_apply_display_mode = AsyncMock()
        asyncio.run(light.async_set_user_mount_profile(2))  # saved 180 degrees in the app
        self.assertEqual((2, "user"), light.mount_profile)
        self.assertEqual("user", light._config_entry.options["mount_profile_source"])
        light.async_apply_display_mode.assert_awaited_once()  # the effect, compensated anew
        with self.assertRaises(ValueError):
            asyncio.run(light.async_set_user_mount_profile(4))
        # The same choice again: nothing is sent.
        asyncio.run(light.async_set_user_mount_profile(2))
        light.async_apply_display_mode.assert_awaited_once()

    def test_a_choice_matching_the_default_in_use_redraws_nothing(self):
        light = ProfileLight()
        light.async_apply_display_mode = AsyncMock()
        asyncio.run(light.async_set_user_mount_profile(3))
        self.assertEqual((3, "user"), light.mount_profile)
        light.async_apply_display_mode.assert_not_awaited()

    def test_the_star_check_is_sent_as_is_and_the_content_comes_back(self):
        light = CheckLight()
        light._rotation_active = False
        sent = []

        async def send(method, params, **kwargs):
            sent.append((method, params))

        async def run(func, name):
            await func()
            return True

        light._cube_matrix = SimpleNamespace(send_raw_command=send, forget_running_effect=Mock())
        light._execute_hardware_op = run
        light._leave_direct_mode = AsyncMock()
        light.async_apply_display_mode = AsyncMock()
        # On a lamp at 3, the check is not compensated: its answer is the profile.
        light._config_entry.options.update(mount_profile=3, mount_profile_source="user")
        self.assertTrue(asyncio.run(light.async_show_mount_check()))
        self.assertEqual([("set_fx_effect", PROFILE.STAR_CHECK_PARAMS)], sent)
        # The stars flew left: 180°.
        asyncio.run(light.async_set_user_mount_profile(PROFILE.star_check_profile("left"), after_check=True))
        self.assertEqual((2, "user"), light.mount_profile)
        light.async_apply_display_mode.assert_awaited_once()

    def test_a_check_on_a_lamp_that_was_off_turns_it_off_again(self):
        light = CheckLight()
        light._rotation_active = False
        light._is_on = False
        light._cube_matrix = SimpleNamespace(send_raw_command=AsyncMock(), forget_running_effect=Mock())

        async def run(func, name):
            await func()
            return True

        light._execute_hardware_op = run
        light._leave_direct_mode = AsyncMock()
        asyncio.run(light.async_show_mount_check())
        asyncio.run(light._async_end_mount_check())
        self.assertIn("turn_off", light.calls)



def _restore_methods():
    """light_restore's snapshot helpers, as the light has them."""
    import ast
    import copy

    from tests.test_native_features import ROOT, _load_standalone_functions

    source = (ROOT / "light_restore.py").read_text(encoding="utf-8")
    names = {"_display_attributes", "_running_rotation", "_apply_display_attributes",
             "_async_resume_display_rotation"}

    class HomeAssistantError(Exception):
        pass

    functions = _load_standalone_functions(source, names, {
        "copy": copy, "ORIENTATION_FLIPPED": CONSTANTS["ORIENTATION_FLIPPED"],
        "HomeAssistantError": HomeAssistantError, "_LOGGER": Mock(),
    })
    attrs = next(
        ast.literal_eval(node.value)
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "_DISPLAY_STATE_ATTRS"
    )
    return {name: functions[name] for name in names}, attrs


RESTORE_METHODS, DISPLAY_STATE_ATTRS = _restore_methods()


class CheckLight(ProfileLight):
    """A lamp showing a clock rotation, with the real snapshot helpers."""

    _DISPLAY_STATE_ATTRS = DISPLAY_STATE_ATTRS
    locals().update(RESTORE_METHODS)

    def __init__(self, options=None):
        super().__init__(options)
        for attr in DISPLAY_STATE_ATTRS:
            setattr(self, attr, None)
        self._mode, self._native_clock_style, self._orientation = "Clock", 12, "normal"
        self._device_orientation = "right"
        self._rotation_active, self._rotation_kind = True, "clock"
        self._rotation_items, self._rotation_interval = [{"name": "Prism"}, {"name": "Pulse"}], 60
        self.sent, self.started = [], []
        self._scroll_offset, self._scroll_direction = 0, 1

        async def send(method, params, **kwargs):
            self.sent.append((method, params))

        async def run(func, name):
            await func()
            return True

        self._cube_matrix = SimpleNamespace(send_raw_command=send, forget_running_effect=Mock())
        self._execute_hardware_op = run
        self._leave_direct_mode = AsyncMock()
        self.async_apply_display_mode = AsyncMock()

    def stop_effect_rotation(self, persist=True):
        self._rotation_active = False
        self.calls.append("stop_rotation")

    async def start_effect_rotation(self, items, interval, kind):
        self.started.append((kind, [item["name"] for item in items], interval))
        self._rotation_active = True


class CheckRestoreTests(unittest.TestCase):
    """What the lamp showed comes back after the check."""

    def test_a_rotation_is_held_and_started_again(self):
        light = CheckLight()
        self.assertTrue(asyncio.run(light.async_show_mount_check()))
        self.assertFalse(light._rotation_active)  # does not draw over the stars
        asyncio.run(light.async_set_user_mount_profile(3, after_check=True))
        self.assertEqual([("clock", ["Prism", "Pulse"], 60)], light.started)
        self.assertEqual(("Clock", 12), (light._mode, light._native_clock_style))

    def test_the_checks_own_reports_are_not_followed(self):
        light = CheckLight()
        light._rotation_active = False
        light._matter = SimpleNamespace(linked=True, node_id=7, values={})
        asyncio.run(light.async_show_mount_check())
        # The lamp reports the stars (Shooting Star, 47) over Matter: not the
        # app or a button, so not followed (the clock stays the content).
        light._on_matter_report("effect", 47, False)
        light._on_matter_report("on_off", True, False)
        self.assertEqual("Clock", light._mode)
        self.assertFalse(light._external_display)
        asyncio.run(light._async_end_mount_check())
        # Deliberate, as restore_state's: after the stars (a firmware mode) a
        # text_change over a drawing is dropped (light_display).
        light.async_apply_display_mode.assert_awaited_once_with(update_type="color_change")
        # Afterwards, a report is the lamp's own again.
        self.assertFalse(light._mount_check_active)

    def test_the_apps_content_is_shown_again(self):
        light = CheckLight()
        light._rotation_active = False
        light._external_display, light._app_content = True, ("set_hsv", [120, 100])
        asyncio.run(light.async_show_mount_check())
        asyncio.run(light._async_end_mount_check())
        self.assertIn(("replay", [120, 100]), light.calls)
        light.async_apply_display_mode.assert_not_awaited()
        self.assertTrue(light._external_display)

    def test_a_check_the_lamp_refused_changes_nothing(self):
        light = CheckLight()

        async def refused(func, name):
            return False

        light._execute_hardware_op = refused
        self.assertFalse(asyncio.run(light.async_show_mount_check()))
        self.assertFalse(light._mount_check_active)
        self.assertEqual([("clock", ["Prism", "Pulse"], 60)], light.started)  # going on


if __name__ == "__main__":
    unittest.main()
