"""The waits around direct mode (light_display.ACTIVATION_TIMING), by the
connection in use: the values from the watched tests (18 Oct 2026), and
the only place they are written."""
import ast
import re
import unittest

from tests.test_native_features import ROOT

DISPLAY = (ROOT / "light_display.py").read_text(encoding="utf-8")


def _table():
    tree = ast.parse(DISPLAY)
    node = next(n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "ACTIVATION_TIMING")
    return ast.literal_eval(node.value)


class ActivationTimingTests(unittest.TestCase):
    def test_the_waits_by_connection(self):
        # UDP: tested with the lamps watched (no flash, no lost first frame;
        # a drawing shown at once after 150 s idle). TCP: as tuned before.
        self.assertEqual({
            "udp": {"native_exit_settle": 0.0, "direct_mode_settle": 0.05, "native_exit_resend": 0.03,
                    "staleness": None, "blank_repeat": 0.05},
            "tcp": {"native_exit_settle": 0.3, "direct_mode_settle": 0.15, "native_exit_resend": 0.12,
                    "staleness": 90.0, "blank_repeat": None},
        }, _table())

    def test_every_wait_is_read_from_the_table_for_the_connection(self):
        light = (ROOT / "light.py").read_text(encoding="utf-8")
        self.assertIn('await asyncio.sleep(ACTIVATION_TIMING[cm.transport]["native_exit_settle"])', light)
        self.assertIn('await asyncio.sleep(ACTIVATION_TIMING[cm.transport]["direct_mode_settle"])', light)
        self.assertIn('ACTIVATION_TIMING[self._cube_matrix.transport]["native_exit_resend"]', DISPLAY)
        self.assertIn('staleness = ACTIVATION_TIMING[self._cube_matrix.transport]["staleness"]', DISPLAY)
        self.assertIn("if staleness is not None and fx_age > staleness:", DISPLAY)
        for source in (light, DISPLAY):
            self.assertEqual([], re.findall(r"asyncio\.sleep\(0\.(?:3|15|12)\)", source))

    def test_the_temporary_tuning_action_is_gone(self):
        diagnostics = (ROOT / "light_services_diagnostics.py").read_text(encoding="utf-8")
        services = (ROOT / "services.yaml").read_text(encoding="utf-8")
        self.assertNotIn("set_activation_timing", diagnostics + services)
        self.assertIn('"force_tcp"', diagnostics)  # the TCP test tool stays


if __name__ == "__main__":
    unittest.main()
