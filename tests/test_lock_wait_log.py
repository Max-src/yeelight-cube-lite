import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from tests.test_native_features import LIGHT_SOURCE, _load_standalone_functions


class LockWaitLogTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.logger = Mock()
        self.namespace = {
            "asyncio": asyncio,
            "time": time,
            "_LOGGER": self.logger,
            "APPLY_HARD_TIMEOUT": 5.0,
            "CIRCUIT_BREAKER_WINDOW": 30.0,
            "LOCK_WAIT_WARNING_MS": 3000,
            "BulbException": type("BulbException", (Exception,), {}),
            "_DEVICE_LOCKS": {},
            "_DEVICE_LOCK_HOLDERS": {},
        }
        fns = _load_standalone_functions(
            LIGHT_SOURCE,
            {"_execute_hardware_op", "_get_device_lock"},
            self.namespace,
        )
        # The loaded functions share one globals dict: tests tweak that one.
        self.namespace = fns["_execute_hardware_op"].__globals__

        class Lamp:
            _execute_hardware_op = fns["_execute_hardware_op"]

        self.lamp = Lamp()
        self.lamp.__dict__.update(
            _ip="192.168.4.104", _is_on=True, _fx_mode_is_direct=True,
            _hard_timeout_times=[], _hardware_failure_retryable=False,
            _connection_error=False, _display_retry_count=0,
            _retry_display_task=None,
            _cube_matrix=SimpleNamespace(
                _state_summary=lambda: "", _consecutive_failures=0
            ),
        )

    async def _run_two(self, hold):
        async def slow():
            await asyncio.sleep(hold)

        async def quick():
            return None

        first = asyncio.ensure_future(
            self.lamp._execute_hardware_op(slow, "display:pixel_art")
        )
        await asyncio.sleep(0)  # the first operation now holds the lamp
        await self.lamp._execute_hardware_op(quick, "display:clock")
        await first

    async def test_normal_queueing_is_debug_and_names_both_operations(self):
        await self._run_two(0.05)
        self.logger.warning.assert_not_called()
        waits = [c for c in self.logger.debug.call_args_list if "waited" in c.args[0]]
        self.assertEqual(1, len(waits))
        message = waits[0].args[0] % waits[0].args[1:]
        self.assertIn("display:clock waited", message)
        self.assertIn("(queued behind display:pixel_art)", message)
        self.assertEqual({}, self.namespace["_DEVICE_LOCK_HOLDERS"])

    async def test_a_long_wait_is_a_warning(self):
        self.namespace["LOCK_WAIT_WARNING_MS"] = 20
        await self._run_two(0.05)
        self.logger.warning.assert_called_once()
        self.assertIn("waited", self.logger.warning.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
