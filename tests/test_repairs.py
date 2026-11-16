"""The lamp's Repairs (issues.py): when a problem is reported, and that only
what changed is sent to Home Assistant's issue registry."""
import asyncio
import json
import time
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from tests.fakes import ROOT, FakeEntry, FakeHass, make_light, module, run

ISSUES = module("issues")
# The light's minute check and timers (light_lifecycle.py).
LIFECYCLE = module("light_lifecycle")
INIT = module("__init__")
SOURCE_UNKNOWN = module("mount_profile").SOURCE_UNKNOWN


def registry():
    """Home Assistant's issue registry, recording what it is asked."""
    return SimpleNamespace(
        async_create_issue=Mock(), async_delete_issue=Mock(),
        IssueSeverity=SimpleNamespace(WARNING="warning"),
    )


def checked(light, problems=None):
    """The light's minute check run once (_async_check_problems): the
    arguments it gave lamp_problems, nothing sent to the registry (nor the
    Matter link and the Cube Matrix's demo loop, which it also looks
    after). ``problems``: what lamp_problems answers (None: the real one)."""
    if light._added_at is None:
        light._added_at = time.monotonic()
    kwargs = {"wraps": ISSUES.lamp_problems} if problems is None else {"return_value": problems}
    with patch.object(LIFECYCLE, "lamp_problems", **kwargs) as asked, \
            patch.object(LIFECYCLE, "report_problems", return_value=set()), \
            patch.object(light, "_refresh_matter_link"), patch.object(light, "_check_matrix_demo"), \
            patch.object(light, "_retry_matrix_native"):
        light._async_check_problems()
    return asked.call_args


class LampProblemTests(unittest.TestCase):
    def setUp(self):
        self.problems = ISSUES.lamp_problems

    def test_a_lamp_that_accepts_connections_but_answers_nothing_is_stuck(self):
        after = ISSUES.NOT_RESPONDING_AFTER
        stuck = {"since_success": 3600, "silent_for": after}
        # Not "unreachable": its network part answers; a power cycle is what helps.
        self.assertEqual(self.problems(stuck, False, 3600), {"lamp_not_responding"})
        self.assertEqual(self.problems({**stuck, "silent_for": after - 1}, False, 3600), {"lamp_unreachable"})
        self.assertEqual(self.problems({"since_success": 5, "silent_for": None}, True, 3600), set())

    def test_a_lamp_out_of_reach_for_half_an_hour(self):
        state = {"since_success": 29 * 60, "udp_failing_for": None}
        self.assertEqual(set(), self.problems(state, False, 3600))  # a short outage
        state["since_success"] = 31 * 60
        self.assertEqual({"lamp_unreachable"}, self.problems(state, False, 3600))
        self.assertEqual(set(), self.problems(state, True, 3600))  # it answers again
        # Never answered a command since it was added: counted from then.
        state["since_success"] = None
        self.assertEqual(set(), self.problems(state, False, 60))
        self.assertEqual({"lamp_unreachable"}, self.problems(state, False, 31 * 60))

    def test_udp_blocked_while_tcp_works(self):
        state = {"since_success": 1, "udp_failing_for": 14 * 60}
        self.assertEqual(set(), self.problems(state, True, 3600))
        state["udp_failing_for"] = 16 * 60
        self.assertEqual({"udp_blocked"}, self.problems(state, True, 3600))
        # Out of reach: not a UDP problem.
        self.assertNotIn("udp_blocked", self.problems(state, False, 3600))

    def test_udp_sessions_opening_while_their_commands_fail_is_the_lamp(self):
        # The lamp answers each session's opening (its token): UDP passes the
        # network, the lamp answers nothing in them (seen 2026-11-13).
        state = {"since_success": 1, "udp_failing_for": 16 * 60, "udp_sessions_while_failing": 152}
        self.assertEqual({"udp_unanswered"}, self.problems(state, True, 3600))
        state["udp_sessions_while_failing"] = 0
        self.assertEqual({"udp_blocked"}, self.problems(state, True, 3600))
        state.update(udp_failing_for=14 * 60, udp_sessions_while_failing=152)
        self.assertEqual(set(), self.problems(state, True, 3600))
        # A Cube Matrix's music connection stays music_blocked.
        music = {"since_success": 1, "udp_failing_for": 16 * 60, "udp_sessions_while_failing": 3, "channel": "music"}
        self.assertEqual({"music_blocked"}, self.problems(music, True, 3600))


    def test_an_unknown_orientation_after_a_while(self):
        # Matter may read it first: only reported after ten minutes.
        state = {"since_success": 1, "udp_failing_for": None}
        self.assertEqual(set(), self.problems(state, True, 9 * 60, orientation_unknown=True))
        self.assertEqual({"orientation_unknown"}, self.problems(state, True, 11 * 60, orientation_unknown=True))
        self.assertEqual(set(), self.problems(state, True, 11 * 60, orientation_unknown=False))
        # The light tells it when nothing says which orientation the lamp
        # saved (light_mount_profile); a Cube Matrix's is always read.
        for source, cube_matrix, unknown in (
            (SOURCE_UNKNOWN, False, True), ("matter", False, False), (SOURCE_UNKNOWN, True, False),
        ):
            light = make_light(mount_profile=(None, source), is_cube_matrix=cube_matrix)
            self.assertIs(unknown, checked(light).kwargs["orientation_unknown"], (source, cube_matrix))

    def test_a_cube_matrix_in_its_demo_loop_is_reported(self):
        state = {"since_success": 0.0}
        self.assertEqual({"demo_mode"}, self.problems(state, True, 0, demo_mode=True))
        self.assertEqual(set(), self.problems(state, True, 0, demo_mode=False))
        # The light tells it what it knows of the demo loop (light_matrix).
        for demo in (True, False):
            light = make_light(matrix_demo_mode=demo)
            self.assertIs(demo, checked(light).kwargs["demo_mode"])


class ReportProblemTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()
        patcher = patch.object(ISSUES, "ir", self.registry)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.report, self.clear = ISSUES.report_problems, ISSUES.clear_problems
        self.light = SimpleNamespace(
            _config_entry=SimpleNamespace(entry_id="e1"), _lamp_name="Desk", _ip="10.0.0.5",
        )

    def test_only_changes_reach_the_registry(self):
        # First check (nothing known): every issue is set or cleared.
        reported = self.report(None, self.light, set(), None)
        self.assertEqual(len(ISSUES.ISSUES), self.registry.async_delete_issue.call_count)
        self.registry.async_delete_issue.reset_mock()
        # Unchanged: nothing sent.
        reported = self.report(None, self.light, set(), reported)
        self.registry.async_create_issue.assert_not_called()
        self.registry.async_delete_issue.assert_not_called()
        # A problem appears, then goes away.
        reported = self.report(None, self.light, {"udp_blocked"}, reported)
        self.registry.async_create_issue.assert_called_once()
        args, kwargs = self.registry.async_create_issue.call_args
        self.assertEqual(("yeelight_cube", "udp_blocked_e1"), args[1:])
        self.assertEqual("udp_blocked", kwargs["translation_key"])
        self.assertEqual({"name": "Desk", "ip": "10.0.0.5"}, kwargs["translation_placeholders"])
        self.assertFalse(kwargs["is_fixable"])
        self.report(None, self.light, set(), reported)
        self.registry.async_delete_issue.assert_called_once_with(None, "yeelight_cube", "udp_blocked_e1")

    def devices(self, **device):
        """Home Assistant's device registry, holding the lamp's device."""
        found = SimpleNamespace(**device) if device else None
        lookup = Mock(return_value=found)
        patcher = patch.object(ISSUES, "dr", SimpleNamespace(
            async_get=Mock(return_value=SimpleNamespace(async_get_device=lookup)),
        ))
        patcher.start()
        self.addCleanup(patcher.stop)
        return lookup

    def shown_name(self):
        return self.registry.async_create_issue.call_args.kwargs["translation_placeholders"]["name"]

    def test_the_issue_names_the_device_as_home_assistant_shows_it(self):
        # 2026-11-16: "CubeLite 7e78 stopped answering over UDP", for the
        # device named "Computer CubeLite Bottom": which lamp was it?
        lookup = self.devices(name_by_user="Computer CubeLite Bottom", name="CubeLite 7e78")
        self.report(None, self.light, {"udp_unanswered"}, None)
        self.assertEqual("Computer CubeLite Bottom", self.shown_name())
        lookup.assert_called_with(identifiers={("yeelight_cube", "e1")})

    def test_newer_home_assistant_looks_the_device_up_in_its_entry(self):
        # 2026.11: async_get_device is deprecated (identifiers are unique per
        # config entry only); the per-entry lookup is used when there.
        found = SimpleNamespace(name_by_user="Computer CubeLite Top", name="CubeLite 7e78")
        old, new = Mock(), Mock(return_value=found)
        patcher = patch.object(ISSUES, "dr", SimpleNamespace(async_get=Mock(return_value=SimpleNamespace(
            async_get_device=old, async_get_device_by_identifier=new,
        ))))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.report(None, self.light, {"udp_unanswered"}, None)
        self.assertEqual("Computer CubeLite Top", self.shown_name())
        new.assert_called_with(("yeelight_cube", "e1"), "e1")
        old.assert_not_called()

    def test_without_a_given_name_the_device_s_own(self):
        self.devices(name_by_user=None, name="CubeLite 7e78")
        self.report(None, self.light, {"udp_unanswered"}, None)
        self.assertEqual("CubeLite 7e78", self.shown_name())

    def test_without_a_device_the_lamp_s_name(self):
        self.devices()
        self.report(None, self.light, {"udp_unanswered"}, None)
        self.assertEqual("Desk", self.shown_name())

    def test_a_renamed_device_s_issues_are_shown_again_with_its_new_name(self):
        self.devices(name_by_user="Top", name="CubeLite 7e78")
        reported = self.report(None, self.light, {"udp_unanswered"}, None)
        self.registry.async_create_issue.reset_mock()
        reported = self.report(None, self.light, {"udp_unanswered"}, reported)
        self.registry.async_create_issue.assert_not_called()  # unchanged
        self.devices(name_by_user="Bottom", name="CubeLite 7e78")
        self.report(None, self.light, {"udp_unanswered"}, reported)
        self.registry.async_create_issue.assert_called_once()
        self.assertEqual("Bottom", self.shown_name())

    def test_a_deleted_lamp_s_issues_go_with_it(self):
        expected = {
            ("yeelight_cube", "lamp_unreachable_e1"),
            ("yeelight_cube", "lamp_not_responding_e1"),
            ("yeelight_cube", "udp_blocked_e1"),
            ("yeelight_cube", "udp_unanswered_e1"),
            ("yeelight_cube", "music_blocked_e1"),
            ("yeelight_cube", "matrix_lan_stuck_e1"),
            ("yeelight_cube", "lan_control_off_e1"),
            ("yeelight_cube", "orientation_unknown_e1"),
            ("yeelight_cube", "demo_mode_e1"),
            ("yeelight_cube", "factory_modules_e1"),
            ("yeelight_cube", "firmware_too_old_e1"),
        }
        self.clear(None, "e1")
        self.assertEqual(
            expected, {call.args[1:] for call in self.registry.async_delete_issue.call_args_list},
        )
        # Deleting the lamp's entry (__init__.async_remove_entry) does it.
        self.registry.async_delete_issue.reset_mock()
        hass = FakeHass({"yeelight_cube": {}})
        run(INIT.async_remove_entry(hass, FakeEntry("e1")))
        self.assertEqual(
            expected, {call.args[1:] for call in self.registry.async_delete_issue.call_args_list},
        )
        self.assertTrue(all(call.args[0] is hass for call in self.registry.async_delete_issue.call_args_list))

    def test_a_cube_matrix_s_music_connection_and_factory_modules(self):
        problems = ISSUES.lamp_problems
        after = ISSUES.UDP_BLOCKED_AFTER
        # Its fast channel is the music connection the lamp opens back:
        # another repair (TCP from the lamp, not UDP 55444).
        self.assertEqual({"music_blocked"}, problems({"udp_failing_for": after, "channel": "music"}, True, 3600))
        self.assertEqual({"udp_blocked"}, problems({"udp_failing_for": after, "channel": "udp_session"}, True, 3600))
        self.assertEqual({"factory_modules"}, problems({}, True, 3600, factory_modules=True))

    def test_a_cube_matrix_whose_lan_is_stuck_is_not_told_of_a_firewall(self):
        # 2026-11-12: the lamp accepted every connection and closed it at once
        # (Matter still working): it did not connect back, but did not answer
        # over TCP either. A power cycle, not the firewall, is what helps.
        problems = ISSUES.lamp_problems
        stuck = {"udp_failing_for": ISSUES.UDP_BLOCKED_AFTER, "channel": "music",
                 "silent_for": ISSUES.NOT_RESPONDING_AFTER}
        self.assertEqual({"matrix_lan_stuck"}, problems(stuck, True, 3600))
        self.assertEqual({"music_blocked"}, problems({**stuck, "silent_for": None}, True, 3600))
        # Out of reach everywhere (Matter too): the usual repair.
        self.assertEqual({"lamp_not_responding"}, problems(stuck, False, 3600))

    def test_a_cube_matrix_showing_everything_over_matter_needs_no_power_cycle(self):
        # 2026-11-16: the Power cycle sensor was on while the lamp showed its
        # stream over Matter without fault: its LAN was only a fallback.
        problems = ISSUES.lamp_problems
        stuck = {"udp_failing_for": ISSUES.UDP_BLOCKED_AFTER, "channel": "music",
                 "silent_for": ISSUES.NOT_RESPONDING_AFTER}
        self.assertEqual(set(), problems(stuck, True, 3600, lan_fallback_only=True))
        # Matter gone too: reported.
        self.assertEqual({"lamp_not_responding"}, problems(stuck, False, 3600, lan_fallback_only=True))

    def test_every_issue_has_its_text(self):
        strings = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))["issues"]
        for key in ISSUES.ISSUES:
            self.assertIn("{name}", strings[key]["title"])
            self.assertIn("{ip}", strings[key]["description"])

    def test_the_light_checks_them_every_minute(self):
        light = make_light(hass=FakeHass())
        with patch.object(LIFECYCLE, "async_track_time_change"), \
                patch.object(LIFECYCLE, "async_track_time_interval") as every, \
                patch.object(light, "async_update", AsyncMock()):
            run(light.async_added_to_hass())
            run(light.async_will_remove_from_hass())
        every.assert_any_call(light.hass, light._async_check_problems, timedelta(minutes=1))
        # From when it was added (a lamp that never answered is counted from then).
        self.assertIsNotNone(light._added_at)

    def test_the_needs_power_cycle_sensor_follows_the_issues_a_power_cycle_fixes(self):
        # binary_sensor.py, for an automation that switches the lamp's plug
        # off and on: every such issue exists and has a translated reason.
        keys = ISSUES.POWER_CYCLE_ISSUES
        self.assertTrue(set(keys) <= set(ISSUES.ISSUES))
        strings = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))
        sensor = strings["entity"]["binary_sensor"]["needs_power_cycle"]
        self.assertEqual(set(keys), set(sensor["state_attributes"]["reason"]["state"]))
        # Its states say whether a power cycle is needed (not the problem
        # class's "OK" / "Problem", which read oddly under its name).
        self.assertEqual({"on": "Needed", "off": "Not needed"}, sensor["state"])
        icons = json.loads((ROOT / "icons.json").read_text(encoding="utf-8"))
        self.assertIn("on", icons["entity"]["binary_sensor"]["needs_power_cycle"]["state"])
        # Written by the minute check when it changes, not at every check:
        # the most serious such issue the lamp has.
        light = make_light()
        told = []
        light.add_listener("power_cycle", lambda: told.append(light.power_cycle_reason))
        for problems, reason, times in (
            ({"udp_unanswered", "lamp_not_responding"}, "lamp_not_responding", 1),
            ({"lamp_not_responding"}, "lamp_not_responding", 1),  # unchanged: not told
            ({"udp_unanswered", "udp_blocked"}, "udp_unanswered", 2),
            ({"udp_blocked"}, None, 3),  # not one a power cycle fixes
            (set(), None, 3),
        ):
            checked(light, problems)
            self.assertEqual(reason, light.power_cycle_reason, problems)
            self.assertEqual(times, len(told), problems)
        self.assertEqual(["lamp_not_responding", "udp_unanswered", None], told)

    def test_the_sensors_platforms_are_set_up_and_unloaded(self):
        # The Power cycle sensor's platform (binary_sensor) with the others.
        hass = FakeHass({"yeelight_cube": {}})
        set_up, unloaded = [], []

        async def forward(entry, platforms):
            set_up.extend(platforms)

        async def unload(entry, platforms):
            unloaded.extend(platforms)
            return True

        hass.config_entries.async_forward_entry_setups = forward
        hass.config_entries.async_unload_platforms = unload
        entry = FakeEntry("e1", data={INIT.CONF_IP: "192.0.2.10"})
        entry.async_on_unload = Mock()
        entry.add_update_listener = Mock()
        with patch.object(INIT, "async_load_storage", AsyncMock()), \
                patch.object(INIT, "_resync_entry_title"), \
                patch.object(INIT, "_async_require_reachable", AsyncMock()), \
                patch.object(INIT, "_async_store_device_id", AsyncMock()), \
                patch.object(INIT, "_async_migrate_entity_unique_ids", AsyncMock()), \
                patch.object(INIT, "_schedule_dismiss_yeelight_discoveries"):
            self.assertTrue(run(INIT.async_setup_entry(hass, entry)))
            self.assertTrue(run(INIT.async_unload_entry(hass, entry)))
        for platforms in (set_up, unloaded):
            self.assertIn("light", platforms)
            self.assertIn("sensor", platforms)
            self.assertIn("binary_sensor", platforms)
        self.assertEqual(sorted(set_up), sorted(unloaded))

    def test_the_connection_attribute_follows_the_transport(self):
        # Written when the transport differs from the published one (the
        # state write records it), not at every check.
        light = make_light(hass=FakeHass())
        light._lamp_client.transport = "tcp"
        checked(light)
        checked(light)
        self.assertEqual(1, light.state_writes)
        self.assertEqual("tcp", light._published_transport)
        # Told by the connection the moment it switches (once added).
        with patch.object(LIFECYCLE, "async_track_time_change"), \
                patch.object(LIFECYCLE, "async_track_time_interval"), \
                patch.object(light, "async_update", AsyncMock()):
            run(light.async_added_to_hass())
            run(light.async_will_remove_from_hass())
        writes = light.state_writes
        light._lamp_client.transport = "udp"
        light._lamp_client.on_transport_change()
        light._lamp_client.on_transport_change()
        self.assertEqual(writes + 1, light.state_writes)
        # Removed: the connection no longer calls it.
        for undo in light.on_remove:
            undo()
        self.assertIsNone(light._lamp_client.on_transport_change)
        # Not added yet / removed: never written.
        light.hass = None
        light._lamp_client.transport = "tcp"
        checked(light)
        self.assertEqual(writes + 1, light.state_writes)

    def test_a_lamp_s_background_work_stops_with_it(self):
        # The adjustments' redraws are the light's tracked tasks (cancelled
        # when it is removed), not loose tasks.
        number = module("number")

        async def scenario():
            hass = FakeHass()
            hass.async_create_task = hass.async_create_background_task = Mock(
                side_effect=AssertionError("a loose task"))
            light = make_light(hass=hass, async_apply_display_mode=AsyncMock())
            entry = FakeEntry()
            for spec in number.PREVIEW_ADJUSTMENTS:
                slider = number.CubeSettingNumber(light, entry, spec)
                slider.hass = hass
                await slider.async_set_native_value(spec.low)
                names = {task.get_name() for task in light._background_tasks}
                self.assertEqual({"yeelight_cube_adjustments_192.0.2.10"}, names, spec.attr)
                await asyncio.gather(*light._background_tasks)
            self.assertEqual(len(number.PREVIEW_ADJUSTMENTS), light.async_apply_display_mode.await_count)

        run(scenario())
        # Kept as text: the cameras start no task at all (they render within
        # an image request, test_matrix_view), a property of the whole module
        # no single call shows.
        camera = (ROOT / "camera.py").read_text(encoding="utf-8")
        self.assertNotIn("_create_tracked_task(", camera)
        self.assertNotIn("async_create_task", camera)


if __name__ == "__main__":
    unittest.main()
