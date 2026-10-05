import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from tests.test_native_features import ROOT, LIGHT_SOURCE, _load_standalone_functions

CUBE_MATRIX_SOURCE = (ROOT / "cube_matrix.py").read_text(encoding="utf-8")


class LampTestCase(unittest.IsolatedAsyncioTestCase):
    """A lamp with the real _execute_hardware_op and a fake connection."""

    def setUp(self):
        self.logger = Mock()
        bulb_exception = type("BulbException", (Exception,), {})
        self.namespace = {
            "asyncio": asyncio,
            "time": time,
            "_LOGGER": self.logger,
            "APPLY_HARD_TIMEOUT": 5.0,
            "CIRCUIT_BREAKER_WINDOW": 30.0,
            "LOCK_WAIT_WARNING_MS": 3000,
            "BulbException": bulb_exception,
            "CubeConnectionError": type("CubeConnectionError", (bulb_exception,), {}),
            "_DEVICE_LOCKS": {},
            "_DEVICE_LOCK_HOLDERS": {},
        }
        self.namespace.update(
            _load_standalone_functions(
                CUBE_MATRIX_SOURCE, {"is_quota_error"}, {"BulbException": bulb_exception}
            )
        )
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
            _retry_display_task=None, _coalesced_op_generation=0,
            _cube_matrix=SimpleNamespace(
                state_summary=lambda: "", summary="", record_success=Mock(), record_failure=Mock(),
                close_fast_socket=Mock(),
            ),
        )
        self.lamp._maybe_schedule_retry = Mock()


class LockWaitLogTests(LampTestCase):
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


class CoalescedRedrawTests(LampTestCase):
    """Queued full redraws: only the newest waiting one reaches the lamp."""

    async def _queue_behind_running(self, ops):
        """Start a running redraw, then queue ``ops`` (name, coalesce) behind it.
        Returns the names that ran, in order, and each queued op's result."""
        ran = []

        def record(name, hold=0.0):
            async def run():
                ran.append(name)
                await asyncio.sleep(hold)
            return run

        running = asyncio.ensure_future(self.lamp._execute_hardware_op(
            record("running", 0.05), "display:running", coalesce=True))
        await asyncio.sleep(0)  # it now holds the lamp
        queued = []
        for name, coalesce in ops:
            queued.append(asyncio.ensure_future(self.lamp._execute_hardware_op(
                record(name), f"display:{name}", coalesce=coalesce)))
            await asyncio.sleep(0)
        results = await asyncio.gather(*queued)
        self.assertTrue(await running)
        return ran, results

    async def test_only_the_newest_queued_redraw_runs(self):
        ran, results = await self._queue_behind_running(
            [("first", True), ("second", True), ("third", True)])
        self.assertEqual(["running", "third"], ran)
        # skipped redraws report success: the newest one draws the same state
        self.assertEqual([True, True, True], results)
        self.assertEqual({}, self.namespace["_DEVICE_LOCK_HOLDERS"])
        self.lamp._cube_matrix.record_success.assert_called()

    async def test_other_operations_are_never_skipped(self):
        ran, _ = await self._queue_behind_running(
            [("brightness", False), ("redraw", True), ("turn_off", False)])
        self.assertEqual(["running", "brightness", "redraw", "turn_off"], ran)

    async def test_a_rejected_newer_redraw_does_not_drop_the_waiting_one(self):
        ran = []

        async def hold():
            await asyncio.sleep(0.05)

        async def waiting():
            ran.append("waiting")

        running = asyncio.ensure_future(
            self.lamp._execute_hardware_op(hold, "display:running", coalesce=True))
        await asyncio.sleep(0)
        queued = asyncio.ensure_future(
            self.lamp._execute_hardware_op(waiting, "display:waiting", coalesce=True))
        await asyncio.sleep(0)
        # The circuit breaker rejects the next redraw before it is queued.
        self.lamp._hard_timeout_times = [time.time(), time.time()]
        self.assertFalse(await self.lamp._execute_hardware_op(
            Mock(), "display:rejected", coalesce=True))
        self.lamp._hard_timeout_times = []
        await asyncio.gather(running, queued)
        self.assertEqual(["waiting"], ran)


class HardTimeoutTests(LampTestCase):
    """Only the operation guard's own timeout is a hard timeout."""

    async def test_a_socket_timeout_is_a_connection_failure(self):
        async def refused():
            raise TimeoutError("timed out")  # socket.timeout is TimeoutError

        self.assertFalse(await self.lamp._execute_hardware_op(refused, "display:pixel_art"))
        self.assertEqual([], self.lamp._hard_timeout_times)
        self.lamp._cube_matrix.close_fast_socket.assert_not_called()
        self.lamp._cube_matrix.record_failure.assert_called_once()
        self.lamp._maybe_schedule_retry.assert_called_once()
        self.logger.error.assert_not_called()

    async def test_an_operation_overrunning_the_guard_is_a_hard_timeout(self):
        async def hangs():
            await asyncio.sleep(1)

        self.assertFalse(await self.lamp._execute_hardware_op(
            hangs, "display:pixel_art", timeout_override=0.02))
        self.assertEqual(1, len(self.lamp._hard_timeout_times))
        self.lamp._cube_matrix.close_fast_socket.assert_called_once()
        self.assertIn("HARD TIMEOUT", self.logger.error.call_args.args[0])
        self.assertEqual({}, self.namespace["_DEVICE_LOCK_HOLDERS"])


if __name__ == "__main__":
    unittest.main()


class RefusedCommandTests(LampTestCase):
    async def test_a_rate_limited_command_is_retryable_with_a_readable_reason(self):
        refused = self.namespace["BulbException"](
            {"code": -1, "message": "client quota exceeded"}
        )

        async def send():
            raise refused

        self.assertFalse(await self.lamp._execute_hardware_op(send, "rotation:clock"))
        self.assertTrue(self.lamp._hardware_failure_retryable)
        self.assertIn("too many commands", self.lamp._last_connection_error)

    async def test_another_refusal_is_not_retried(self):
        refused = self.namespace["BulbException"](
            {"code": -5000, "message": "general error"}
        )

        async def send():
            raise refused

        self.assertFalse(await self.lamp._execute_hardware_op(send, "rotation:clock"))
        self.assertFalse(self.lamp._hardware_failure_retryable)
        self.assertEqual("BulbException: general error", self.lamp._last_connection_error)


class RawReplyTests(unittest.TestCase):
    """The lamp's answer to a checked raw command, over a real local socket."""

    def setUp(self):
        import json
        import socket

        self.socket = socket
        self.reply_error = _load_standalone_functions(
            CUBE_MATRIX_SOURCE,
            {"_raw_reply_error"},
            {"socket": socket, "json": json, "time": time, "RAW_REPLY_TIMEOUT": 0.3},
        )["_raw_reply_error"]

    def answer(self, payload, close=True):
        """The error read from a lamp that sends ``payload`` (then closes)."""
        server = self.socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        client = self.socket.create_connection(server.getsockname())
        lamp, _ = server.accept()
        try:
            if payload:
                lamp.sendall(payload)
            if close:
                lamp.close()
            return self.reply_error(client)
        finally:
            client.close()
            lamp.close()
            server.close()

    def test_an_error_answer_is_reported(self):
        self.assertEqual(
            {"code": -1, "message": "client quota exceeded"},
            self.answer(
                b'{"method":"props","params":{"power":"on"}}\r\n'
                b'{"id":1,"error":{"code":-1,"message":"client quota exceeded"}}\r\n'
            ),
        )

    def test_ok_silence_and_a_closed_connection_count_as_sent(self):
        self.assertIsNone(self.answer(b'{"id":1,"result":["ok"]}\r\n'))
        self.assertIsNone(self.answer(b""))  # closed without answering
        self.assertIsNone(self.answer(b"", close=False))  # no answer in time
