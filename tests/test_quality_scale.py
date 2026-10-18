"""The quality scale self-assessment (scripts/quality_scale.py): the rule file
is complete and valid, and every rule marked done that a script can verify
holds. A change that breaks one fails here (npm run check, CI)."""
import pathlib
import runpy
import shutil
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
QS = runpy.run_path(str(ROOT / "scripts" / "quality_scale.py"))
RULE_FILE = QS["INTEGRATION"] / "quality_scale.yaml"


class QualityScaleTests(unittest.TestCase):
    def test_every_rule_has_a_status_and_the_done_ones_hold(self):
        rules = QS["load_rules"](RULE_FILE)
        self.assertEqual(54, len(rules))
        self.assertEqual([], QS["verify"](rules))

    def test_the_file_format_is_core_s(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "quality_scale.yaml"
            text = RULE_FILE.read_text(encoding="utf-8")
            # An exemption needs its reason.
            path.write_text(text.replace(
                "  docs-conditions:\n    status: exempt\n    comment: The integration provides no conditions.\n",
                "  docs-conditions: exempt\n",
            ), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "docs-conditions"):
                QS["load_rules"](path)
            # Every rule is listed.
            path.write_text(text.replace("  diagnostics: done\n", ""), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "missing rule: diagnostics"):
                QS["load_rules"](path)

    def test_a_rule_that_stops_holding_is_reported(self):
        rules = QS["load_rules"](RULE_FILE)
        with tempfile.TemporaryDirectory() as folder:
            copy = pathlib.Path(folder) / "yeelight_cube"
            shutil.copytree(QS["INTEGRATION"], copy, ignore=shutil.ignore_patterns("www", "__pycache__"))
            sensor = copy / "sensor.py"
            sensor.write_text(
                sensor.read_text(encoding="utf-8").replace("PARALLEL_UPDATES = 0", ""),
                encoding="utf-8",
            )
            flow = copy / "config_flow.py"
            flow.write_text(
                flow.read_text(encoding="utf-8").replace(
                    "await check_tcp(ip_address, LAN_PORT, PROBE_TIMEOUT)", "pass"
                ),
                encoding="utf-8",
            )
            # The probe is shared: adding and moving a lamp both lose it.
            self.assertEqual([
                "parallel-updates: sensor.py does not set PARALLEL_UPDATES",
                "reconfiguration-flow: the config flow has no async_step_reconfigure that tries the lamp",
                "test-before-configure: async_step_user does not try the lamp before creating the entry",
            ], QS["verify"](rules, copy))

    def test_the_entity_rules_are_checked(self):
        rules = QS["load_rules"](RULE_FILE)
        with tempfile.TemporaryDirectory() as folder:
            copy = pathlib.Path(folder) / "yeelight_cube"
            shutil.copytree(QS["INTEGRATION"], copy, ignore=shutil.ignore_patterns("www", "__pycache__"))

            def edit(name, old, new):
                path = copy / name
                text = path.read_text(encoding="utf-8")
                self.assertIn(old, text)
                path.write_text(text.replace(old, new, 1), encoding="utf-8")

            # The shared flag gone, a name set by hand, a registration that
            # never unregisters, a translation key without its name.
            edit("entity.py", "    _attr_has_entity_name = True\n", "")
            edit("button.py", 'self._attr_translation_key = "force_refresh"',
                 'self._attr_translation_key = "force_refresh_gone"\n        self._attr_name = "Refresh"')
            edit("text.py", 'self._register_on_light("_text_input_entity")',
                 "self._light_entity._text_input_entity = self")
            problems = QS["verify"](rules, copy)
        joined = "\n".join(problems)
        self.assertIn("has-entity-name: button.py: YeelightCubeForceRefreshButton has no _attr_has_entity_name", joined)
        self.assertIn("has-entity-name: button.py: a name set by hand", joined)
        self.assertIn("entity-event-setup: text.py: registers on the light without unregistering", joined)
        self.assertIn("entity-translations: button.py: translation key force_refresh_gone has no name", joined)

    def test_the_error_icon_repair_and_reconfigure_rules_are_checked(self):
        rules = QS["load_rules"](RULE_FILE)
        with tempfile.TemporaryDirectory() as folder:
            copy = pathlib.Path(folder) / "yeelight_cube"
            shutil.copytree(QS["INTEGRATION"], copy, ignore=shutil.ignore_patterns("www", "__pycache__"))

            def edit(name, old, new):
                path = copy / name
                text = path.read_text(encoding="utf-8")
                self.assertIn(old, text)
                path.write_text(text.replace(old, new, 1), encoding="utf-8")

            # A plain error text, an unknown error key, an icon in the code,
            # an issue without its text, a reconfigure step that skips the lamp.
            edit("select.py", 'raise invalid("lamp_off")', 'raise HomeAssistantError("Off")')
            edit("light_services_native.py", 'raise invalid("rotation_too_few")', 'raise invalid("no_such_message")')
            edit("button.py", 'self._attr_translation_key = "force_refresh"',
                 'self._attr_translation_key = "force_refresh"\n        self._attr_icon = "mdi:refresh"')
            edit("issues.py", 'ISSUES = ("lamp_unreachable", "udp_blocked")', 'ISSUES = ("lamp_unreachable", "udp_gone")')
            edit("config_flow.py", "elif not await _lamp_answers(ip_address):\n                errors[\"base\"] = \"cannot_connect\"\n            else:\n                # A manually",
                 "elif False:\n                pass\n            else:\n                # A manually")
            joined = "\n".join(QS["verify"](rules, copy))
        self.assertIn("exception-translations: select.py: an untranslated error", joined)
        self.assertIn("exception-translations: light_services_native.py: error no_such_message has no message", joined)
        self.assertIn("icon-translations: button.py sets an icon in the code", joined)
        self.assertIn("repair-issues: issue udp_gone has no title and description", joined)
        self.assertIn("reconfiguration-flow: the config flow has no async_step_reconfigure that tries the lamp", joined)

    def test_the_tier_reached(self):
        rules = {rule: ("done", "") for rule in QS["ALL_RULES"]}
        self.assertEqual("platinum", QS["tier_reached"](rules))
        rules["strict-typing"] = ("todo", "")
        rules["repair-issues"] = ("exempt", "none")
        self.assertEqual("gold", QS["tier_reached"](rules))
        rules["runtime-data"] = ("todo", "")
        self.assertIsNone(QS["tier_reached"](rules))


if __name__ == "__main__":
    unittest.main()
