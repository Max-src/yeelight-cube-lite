"""The lamp's Repairs (issues.py): when a problem is reported, and that only
what changed is sent to Home Assistant's issue registry."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from tests.test_native_features import CONSTANTS, LIGHT_SOURCE, ROOT, _load_standalone_functions

SOURCE = (ROOT / "issues.py").read_text(encoding="utf-8")
CONSTANT_NAMES = ("UNREACHABLE_AFTER", "UDP_BLOCKED_AFTER", "ORIENTATION_UNKNOWN_AFTER", "ISSUES")
NAMESPACE = {
    name: value for name, value in (
        line.split(" = ", 1) for line in SOURCE.splitlines()
        if line.split(" = ", 1)[0] in CONSTANT_NAMES
    )
}
NAMESPACE = {name: eval(value) for name, value in NAMESPACE.items()}  # noqa: S307 -- our constants


def load(registry):
    return _load_standalone_functions(
        SOURCE, {"lamp_problems", "report_problems", "clear_problems", "_issue_id"},
        {**NAMESPACE, "DOMAIN": CONSTANTS["DOMAIN"], "ir": registry},
    )


class LampProblemTests(unittest.TestCase):
    def setUp(self):
        self.problems = load(Mock())["lamp_problems"]

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


    def test_an_unknown_orientation_after_a_while(self):
        # Matter may read it first: only reported after ten minutes.
        state = {"since_success": 1, "udp_failing_for": None}
        self.assertEqual(set(), self.problems(state, True, 9 * 60, orientation_unknown=True))
        self.assertEqual({"orientation_unknown"}, self.problems(state, True, 11 * 60, orientation_unknown=True))
        self.assertEqual(set(), self.problems(state, True, 11 * 60, orientation_unknown=False))
        self.assertIn("orientation_unknown=self.mount_profile[1] == SOURCE_UNKNOWN", LIGHT_SOURCE)


class ReportProblemTests(unittest.TestCase):
    def setUp(self):
        self.registry = SimpleNamespace(
            async_create_issue=Mock(), async_delete_issue=Mock(),
            IssueSeverity=SimpleNamespace(WARNING="warning"),
        )
        functions = load(self.registry)
        self.report, self.clear = functions["report_problems"], functions["clear_problems"]
        self.light = SimpleNamespace(
            _config_entry=SimpleNamespace(entry_id="e1"), _lamp_name="Desk", _ip="10.0.0.5",
        )

    def test_only_changes_reach_the_registry(self):
        # First check (nothing known): every issue is set or cleared.
        reported = self.report(None, self.light, set(), None)
        self.assertEqual(4, self.registry.async_delete_issue.call_count)
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

    def test_a_deleted_lamp_s_issues_go_with_it(self):
        self.clear(None, "e1")
        self.assertEqual(
            {
                ("yeelight_cube", "lamp_unreachable_e1"),
                ("yeelight_cube", "udp_blocked_e1"),
                ("yeelight_cube", "lan_control_off_e1"),
                ("yeelight_cube", "orientation_unknown_e1"),
            },
            {call.args[1:] for call in self.registry.async_delete_issue.call_args_list},
        )
        init = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("clear_problems(hass, entry.entry_id)", init)

    def test_every_issue_has_its_text(self):
        import json

        strings = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))["issues"]
        for key in NAMESPACE["ISSUES"]:
            self.assertIn("{name}", strings[key]["title"])
            self.assertIn("{ip}", strings[key]["description"])

    def test_the_light_checks_them_every_minute(self):
        self.assertIn("self._async_check_problems, timedelta(minutes=1)", LIGHT_SOURCE)

    def test_the_connection_attribute_follows_the_transport(self):
        # Written when the transport differs from the published one (the
        # override records it at every write), not at every check.
        publish = _load_standalone_functions(
            LIGHT_SOURCE, {"_async_publish_transport"}, {"callback": lambda function: function}
        )["_async_publish_transport"]
        lamp = SimpleNamespace(hass=object(), _cube_matrix=SimpleNamespace(transport="tcp"), _published_transport="udp")
        lamp.async_write_ha_state = Mock(side_effect=lambda: setattr(lamp, "_published_transport", lamp._cube_matrix.transport))
        publish(lamp)
        publish(lamp)
        lamp.async_write_ha_state.assert_called_once()
        lamp.hass = None  # not added yet / removed: never written
        lamp._cube_matrix.transport = "udp"
        publish(lamp)
        lamp.async_write_ha_state.assert_called_once()
        self.assertIn("self._published_transport = self._cube_matrix.transport", LIGHT_SOURCE)
        self.assertIn("self._cube_matrix.on_transport_change = self._async_publish_transport", LIGHT_SOURCE)
        check = LIGHT_SOURCE.split("def _async_check_problems", 1)[1].split("def ", 1)[0]
        self.assertIn("self._async_publish_transport()", check)

    def test_a_lamp_s_background_work_stops_with_it(self):
        # The adjustments' redraws are the light's tracked tasks (cancelled
        # when it is removed), not loose tasks; the cameras start none (they
        # render within an image request, test_matrix_view).
        camera = (ROOT / "camera.py").read_text(encoding="utf-8")
        number = (ROOT / "number.py").read_text(encoding="utf-8")
        self.assertNotIn("_create_tracked_task(", camera)
        self.assertIn("light._create_tracked_task(", number)
        self.assertNotIn("async_create_task", camera + number)


if __name__ == "__main__":
    unittest.main()
