"""The services' per-lamp background work (light_services_common
make_lamp_runner): one lamp's failure never stops the others, and every
failure is logged with the service and the lamp."""
import asyncio
import logging
import types
import unittest
from unittest.mock import Mock

from tests.test_native_features import ROOT, _load_standalone_functions

COMMON_SOURCE = (ROOT / "light_services_common.py").read_text(encoding="utf-8")
ERRORS_SOURCE = (ROOT / "command_errors.py").read_text(encoding="utf-8")


def _note_command_result(now):
    """command_errors.note_command_result with the clock at ``now()``."""
    return _load_standalone_functions(
        ERRORS_SOURCE, {"note_command_result"}, {"time": types.SimpleNamespace(time=now)}
    )["note_command_result"]


class LampRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_failures_are_isolated_and_labelled(self):
        logger = Mock()
        tasks = []
        connection_error = type("CubeConnectionError", (Exception,), {})
        runner = _load_standalone_functions(
            COMMON_SOURCE,
            {"make_lamp_runner"},
            {
                "asyncio": asyncio,
                "logging": logging,
                "_LOGGER": logger,
                "is_connection_error": lambda err: isinstance(err, connection_error),
                "time": types.SimpleNamespace(time=lambda: 1234.5),
                "note_command_result": _note_command_result(lambda: 1234.5),
            },
        )["make_lamp_runner"](
            types.SimpleNamespace(
                async_create_task=lambda coro, name=None: tasks.append(asyncio.ensure_future(coro))
            )
        )
        updated = []

        async def apply(lamp):
            if lamp.entity_id == "light.broken":
                raise ValueError("bad frame")
            if lamp.entity_id == "light.off":
                raise connection_error("Lamp unreachable")
            updated.append(lamp.entity_id)

        def lamp(entity_id, **extra):
            return types.SimpleNamespace(
                entity_id=entity_id, hass=object(), async_write_ha_state=Mock(), **extra
            )

        lamps = [
            lamp("light.broken"),
            # Already known unreachable: its failure is quiet (debug).
            lamp(
                "light.off",
                _cube_matrix=types.SimpleNamespace(outage_log_level=lambda: logging.DEBUG),
            ),
            lamp("light.ok"),
        ]
        runner("SET_MODE", lamps, apply)
        await asyncio.gather(*tasks)
        self.assertEqual(updated, ["light.ok"])
        # The refused change is published on its lamp for the cards; a lamp
        # not reached is not (it is shown unavailable), nor one that worked.
        self.assertEqual(
            lamps[0]._last_command_error,
            {"service": "set_mode", "message": "bad frame", "at": 1234.5},
        )
        lamps[0].async_write_ha_state.assert_called_once()
        self.assertIsNone(getattr(lamps[1], "_last_command_error", None))
        lamps[2].async_write_ha_state.assert_not_called()
        # A later change that works clears it.
        lamps[0].entity_id = "light.fixed"
        lamps[0]._last_command_error["at"] = 1000.0  # recorded before that change
        tasks.clear()
        runner("SET_ANGLE", [lamps[0]], apply)
        await asyncio.gather(*tasks)
        self.assertIsNone(lamps[0]._last_command_error)
        self.assertEqual(lamps[0].async_write_ha_state.call_count, 2)
        logger.exception.assert_called_once()
        self.assertEqual(logger.exception.call_args.args[1:3], ("SET_MODE", "light.broken"))
        logger.log.assert_called_once()
        self.assertEqual(logger.log.call_args.args[0], logging.DEBUG)
        self.assertEqual(logger.log.call_args.args[2:4], ("SET_MODE", "light.off"))

    def test_no_service_schedules_bare_coroutines(self):
        for path in sorted(ROOT.glob("light_services*.py")):
            with self.subTest(path=path.name):
                self.assertNotIn("_fire_and_forget", path.read_text(encoding="utf-8"))



class CommandErrorTests(unittest.TestCase):
    def test_an_error_recorded_during_a_change_is_kept(self):
        now = [100.0]
        note = _note_command_result(lambda: now[0])
        lamp = types.SimpleNamespace(hass=object(), async_write_ha_state=Mock())
        note(lamp, "SET_MODE")  # nothing to clear: no state write
        lamp.async_write_ha_state.assert_not_called()
        # The service started at 100; its redraw was refused at 101.
        now[0] = 101.0
        note(lamp, "display:clock", "the lamp refused it: invalid params")
        self.assertEqual(
            lamp._last_command_error,
            {"service": "display:clock", "message": "the lamp refused it: invalid params", "at": 101.0},
        )
        note(lamp, "SET_MODE", since=100.0)  # the service itself went through
        self.assertIsNotNone(lamp._last_command_error)
        note(lamp, "SET_MODE", since=102.0)  # a later change worked
        self.assertIsNone(lamp._last_command_error)
        self.assertEqual(lamp.async_write_ha_state.call_count, 2)


if __name__ == "__main__":
    unittest.main()
