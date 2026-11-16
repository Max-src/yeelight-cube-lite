"""A failure the integration explains itself (errors.failed: the lamp stopped
an animation upload, 2026-11-15 20:55) is logged once, as a warning without a
traceback; a real bug still gets ERROR and its traceback."""

import logging
import unittest

import fakes
from fakes import FakeHass, make_light, module, run

fakes.install_stubs()
ERRORS = module("errors")
CONNECTION = "custom_components.yeelight_cube.light_connection"


def records(func, op_name="display:color_change"):
    light = make_light(hass=FakeHass())
    with unittest.TestCase().assertLogs(level=logging.DEBUG) as logs:
        logging.getLogger("probe").debug("start")  # assertLogs needs one record
        ok = run(light._execute_hardware_op(func, op_name))
    return ok, light, [r for r in logs.records if r.name != "probe"]


class ExplainedFailureTests(unittest.TestCase):
    def test_an_explained_failure_is_a_plain_warning(self):
        async def upload():
            raise ERRORS.failed("animation_upload_failed", status="0")

        ok, light, logged = records(upload)
        self.assertFalse(ok)
        self.assertFalse([r for r in logged if r.levelno >= logging.ERROR])
        warnings = [r for r in logged if r.levelno == logging.WARNING]
        self.assertEqual(1, len(warnings))
        self.assertIsNone(warnings[0].exc_info)
        # Still named on the cards as the change that failed.
        self.assertIsNotNone(light._last_command_error)

    def test_a_real_bug_keeps_its_error_and_traceback(self):
        async def broken():
            raise KeyError("bug")

        ok, _light, logged = records(broken)
        self.assertFalse(ok)
        errors = [r for r in logged if r.levelno >= logging.ERROR]
        self.assertEqual(1, len(errors))
        self.assertIsNotNone(errors[0].exc_info)


if __name__ == "__main__":
    unittest.main()
