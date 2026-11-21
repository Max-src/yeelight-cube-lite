"""The connection's checks around a stream (light_connection, lamp_client_udp,
udp_session): no health ping mid-stream, the circuit breaker on the
monotonic clock, a queued brightness that expires while disconnected, and
background checks that outlive an unexpected error."""

import asyncio
import json
import logging
import time
import unittest
from unittest.mock import AsyncMock, Mock

import fakes
from fakes import FakeEntry, FakeHass, instant_sleeps, make_light, module, run

fakes.install_stubs()
CONNECTION = module("light_connection")
UDP_SESSION = module("udp_session")


def light_in_effect():
    light = make_light(hass=FakeHass(), entry=FakeEntry())
    light._is_on = True
    light._native_effect = "Rainbow"
    light._enter_mode("Native Effect")
    return light


async def health_probes(light, cycles=3):
    """The answering flags of the probes the health check sends in
    ``cycles`` of its loop (its sleeps instant)."""
    probes = []

    async def probe(timeout=None, *, answering=False):
        probes.append(answering)
        return True

    light._lamp_client.probe = probe
    with instant_sleeps("light_connection") as fast:
        task = asyncio.ensure_future(light._periodic_health_check())
        while len(fast.slept) < cycles:
            await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    return probes


class HealthCheckTests(unittest.TestCase):
    def test_an_effect_the_lamp_runs_is_pinged(self):
        # A power cut is caught in a mode that sends no frames.
        self.assertTrue(run(health_probes(light_in_effect())))

    def test_a_running_stream_is_not_pinged(self):
        # The stream's own check covers it (light_studio._stream_watchdog).
        async def scenario():
            light = light_in_effect()
            light.studio_streaming = lambda: True
            light._studio_task = asyncio.ensure_future(asyncio.sleep(10))
            try:
                return await health_probes(light)
            finally:
                light._studio_task.cancel()

        self.assertEqual([], run(scenario()))

    def test_a_stream_paused_for_a_silent_lamp_is_pinged_and_goes_unavailable(self):
        # 2026-11-19: a streaming Cube Lite switched off at the wall stayed
        # "on" for minutes: its stream had paused (no answer) and nothing
        # else asked it. Once paused, the health check probes it again.
        async def scenario():
            light = light_in_effect()
            light.studio_streaming = lambda: True
            light._studio_task = asyncio.ensure_future(asyncio.sleep(10))
            light._lamp_client.stream_silent = True
            light.async_write_ha_state = Mock()
            probes = []

            async def probe(timeout=None, *, answering=False):
                probes.append(answering)
                return False  # no power: nothing accepts the connection

            light._lamp_client.probe = probe
            light._async_maybe_rediscover = AsyncMock()
            try:
                with instant_sleeps("light_connection") as fast:
                    task = asyncio.ensure_future(light._periodic_health_check())
                    while len(fast.slept) < 3:
                        await asyncio.sleep(0)
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
            finally:
                light._studio_task.cancel()
            return probes, light.available

        probes, available = run(scenario())
        self.assertTrue(probes)
        self.assertFalse(available)


class CircuitBreakerTests(unittest.TestCase):
    def test_hard_timeouts_are_counted_on_the_monotonic_clock(self):
        async def scenario():
            light = light_in_effect()
            operation = AsyncMock()
            light._hard_timeout_times = [time.monotonic(), time.monotonic()]
            self.assertFalse(await light._execute_hardware_op(operation, "set_brightness"))
            operation.assert_not_called()
            # Older than the window: forgotten, whatever the wall clock does.
            light._hard_timeout_times = [time.monotonic() - CONNECTION.CIRCUIT_BREAKER_WINDOW - 1] * 2
            self.assertTrue(await light._execute_hardware_op(operation, "set_brightness"))
            self.assertEqual([], light.recent_hard_timeouts())

        run(scenario())


class BrightnessRetryTests(unittest.TestCase):
    def test_an_expired_brightness_is_dropped_while_disconnected(self):
        async def scenario():
            light = light_in_effect()
            light._lamp_client.is_connected = lambda: False
            light._pending_brightness = (128, time.time() - 31)
            light.set_brightness = AsyncMock()
            await asyncio.wait_for(light._process_brightness_retries(), 1)
            self.assertIsNone(light._pending_brightness)
            light.set_brightness.assert_not_called()

        run(scenario())


class UnsolicitedErrorTests(unittest.TestCase):
    def test_refused_frames_warn_once_per_episode(self):
        session = UDP_SESSION.UdpSession("192.0.2.1")
        refused = json.dumps({"id": 7, "error": {"code": -1, "message": "refused"}}).encode()
        answer = json.dumps({"id": 8, "result": ["ok"]}).encode()
        with self.assertLogs(UDP_SESSION._LOGGER, level=logging.DEBUG) as logs:
            for _ in range(3):
                session._received(refused)
            session._received(answer)  # the lamp answers: the episode is over
            session._received(refused)
        levels = [record.levelno for record in logs.records if "Unsolicited" in record.getMessage()]
        self.assertEqual([logging.WARNING, logging.DEBUG, logging.DEBUG, logging.WARNING], levels)

    def test_the_warning_lists_the_last_datagrams(self):
        session = UDP_SESSION.UdpSession("192.0.2.1")
        session._transport = Mock()
        for message_id in range(1, 40):
            run(session._send({"id": message_id, "method": "update_leds", "params": []}))
        refused = json.dumps({"id": 39, "error": {"code": -1, "message": "refused"}}).encode()
        with self.assertLogs(UDP_SESSION._LOGGER, level=logging.WARNING) as logs:
            session._received(refused)
        message = logs.records[0].getMessage()
        trail = message.split("last datagrams: ")[1].split()
        self.assertEqual(UDP_SESSION.TRAIL_LENGTH * 2 + 1, len(trail))  # "-Nms" and what, each; "err-1"
        self.assertEqual(">update_leds#17", trail[1])  # the oldest kept
        self.assertEqual("<#39", trail[-2])  # the refusal itself, last
        self.assertEqual("err-1", trail[-1])


class BackgroundCheckTests(unittest.TestCase):
    # The UDP recovery's: test_cube_transport.
    def test_the_matter_commands_check_outlives_an_unexpected_error(self):
        async def scenario():
            light = light_in_effect()
            channel = Mock(backend=None, reason=None)
            channel.async_available = AsyncMock(side_effect=ValueError("unexpected"))
            light._matter_commands = channel
            light._matter = Mock(linked=True, stale_node_ids=())
            light._check_matter_commands()
            task = light._matter_commands_check
            await asyncio.gather(task, return_exceptions=True)
            self.assertIsNone(task.exception())
            self.assertIsNone(light._matter_commands_check)  # checked again next time

        run(scenario())


if __name__ == "__main__":
    unittest.main()
