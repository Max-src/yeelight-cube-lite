"""A stuck Cube Lite brought back over the LAN (link_recovery, light_link_recovery).

2026-11-16: the stuck top Cube Lite answered a command only when its size on
the lamp's internal link equalled the link's offset (346, 117, 462, 345 and
229 bytes, measured in turn); req_ota at 229 bytes brought it back (normal
commands answered 10 s later, a restart at 18 s)."""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

import fakes
from fakes import FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
LINK = module("link_recovery")
RECOVERY = module("light_link_recovery")
PROFILE = module("device_profile")


class StuckLamp:
    """A stuck lamp's LAN port: it answers a command only when its link size
    is the offset (and a quota error, from its network part, now and then)."""

    def __init__(self, offset):
        self.offset = offset
        self.received = []

    async def start(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0)
        return self.server.sockets[0].getsockname()[1]

    async def handle(self, reader, writer):
        while line := await reader.readline():
            text = line.decode("latin-1").rstrip("\r\n")
            self.received.append(LINK.link_size(text))
            command = json.loads(text)
            if LINK.link_size(text) == self.offset:
                writer.write(json.dumps({"id": command["id"], "result": ["ok"]}).encode() + b"\r\n")
            elif len(self.received) == 3:
                writer.write(b'{"id":1, "error":{"code":-1, "message":"client quota exceeded"}}\r\n')
            await writer.drain()

    def stop(self):
        self.server.close()


class SweepTests(unittest.TestCase):
    def test_every_measured_offset_is_found(self):
        async def scenario():
            for offset in (117, 229, 345, 346, 462):
                lamp = StuckLamp(offset)
                port = await lamp.start()
                try:
                    found = await LINK.realign("127.0.0.1", port, answer_wait=0.05)
                finally:
                    lamp.stop()
                self.assertEqual(offset, found)
                self.assertEqual(offset, lamp.received[-1])  # stopped at the answer

        run(scenario())

    def test_the_network_part_s_quota_is_respected(self):
        # 2026-11-16 18:39: past ~30 commands on one connection the network
        # part refuses them itself ("client quota exceeded"): a sweep on one
        # connection never reached the later sizes.
        class QuotaLamp(StuckLamp):
            async def handle(self, reader, writer):
                count = 0
                while line := await reader.readline():
                    count += 1
                    text = line.decode("latin-1").rstrip("\r\n")
                    self.received.append(LINK.link_size(text))
                    command = json.loads(text)
                    if count > 25:
                        writer.write(b'{"id":1, "error":{"code":-1, "message":"client quota exceeded"}}\r\n')
                    elif LINK.link_size(text) == self.offset:
                        writer.write(json.dumps({"id": command["id"], "result": ["ok"]}).encode() + b"\r\n")
                    await writer.drain()

        async def scenario():
            last = LINK.candidate_sizes()[-1]
            lamp = QuotaLamp(last)
            port = await lamp.start()
            try:
                self.assertEqual(last, await LINK.realign("127.0.0.1", port, answer_wait=0.02))
            finally:
                lamp.stop()

        run(scenario())

    def test_a_dropped_connection_goes_on_with_a_new_one(self):
        # 2026-11-16 18:47: the lamp reset the sweep's connection mid-way;
        # the sweep ended there instead of going on.
        class DroppingLamp(StuckLamp):
            dropped = False

            async def handle(self, reader, writer):
                while line := await reader.readline():
                    text = line.decode("latin-1").rstrip("\r\n")
                    self.received.append(LINK.link_size(text))
                    if len(self.received) == 7 and not DroppingLamp.dropped:
                        DroppingLamp.dropped = True
                        writer.transport.abort()  # a reset, mid-sweep
                        return
                    if LINK.link_size(text) == self.offset:
                        command = json.loads(text)
                        writer.write(json.dumps({"id": command["id"], "result": ["ok"]}).encode() + b"\r\n")
                    await writer.drain()

        async def scenario():
            target = LINK.candidate_sizes()[30]
            lamp = DroppingLamp(target)
            port = await lamp.start()
            try:
                self.assertEqual(target, await LINK.realign("127.0.0.1", port, answer_wait=0.05))
            finally:
                lamp.stop()
            self.assertTrue(DroppingLamp.dropped)

        run(scenario())

    def test_no_answer_and_an_error_are_not_a_hit(self):
        async def scenario():
            lamp = StuckLamp(50)  # below any command's size: never answered
            port = await lamp.start()
            try:
                self.assertIsNone(await LINK.realign("127.0.0.1", port, answer_wait=0.02))
            finally:
                lamp.stop()
            self.assertEqual(LINK.candidate_sizes(), lamp.received)

        run(scenario())

    def test_sizes_are_exact(self):
        for size in LINK.candidate_sizes():
            line = LINK.padded_line(LINK.FIRST_ID, size)
            self.assertEqual(size, LINK.link_size(line))
            self.assertEqual({"id": 5, "method": "req_ota", "params": [1, 1]}, json.loads(line))
        # The measured unpadded size of req_ota [1, 1] (lab: 88 bytes).
        self.assertEqual(88, LINK._shortest())


def stuck_light(profile=None):
    light = make_light(hass=FakeHass(), entry=FakeEntry(), profile=profile)
    light._create_tracked_task = lambda coro, name=None: asyncio.get_running_loop().create_task(coro)
    return light


class DecisionTests(unittest.TestCase):
    def test_a_stuck_cube_lite_is_tried_a_few_times_then_left(self):
        async def scenario():
            light = stuck_light()
            started = []

            async def recover():
                started.append(1)
                return False

            light._async_recover_link = recover
            for _ in range(4):
                light._link_recovery_due({"lamp_not_responding"})
                await asyncio.sleep(0)
                light._link_recovery_due({"lamp_not_responding"})  # too soon: not again
                await asyncio.sleep(0)
                light._link_recovery_at -= RECOVERY.LINK_RECOVERY_RETRY  # the wait is over
            self.assertEqual(3, len(started))  # LINK_RECOVERY_TRIES, LINK_RECOVERY_RETRY apart
            light._link_recovery_due(set())  # it answers again: a new episode later
            self.assertEqual(0, light._link_recovery_tries)

        run(scenario())

    def test_not_for_other_problems_nor_a_cube_matrix(self):
        async def scenario():
            light = stuck_light()
            light._async_recover_link = AsyncMock()
            light._link_recovery_due({"udp_unanswered"})  # TCP still answers: the link is fine
            matrix = stuck_light(PROFILE.profile_for("CubeMatrix"))
            matrix._async_recover_link = AsyncMock()
            matrix._link_recovery_due({"lamp_not_responding"})
            await asyncio.sleep(0)
            light._async_recover_link.assert_not_called()
            matrix._async_recover_link.assert_not_called()

        run(scenario())

    def test_an_answered_sweep_draws_the_content_again(self):
        async def scenario():
            light = stuck_light()
            light._link_recovery_tries = 1
            light._lamp_client.probe = AsyncMock(return_value=True)
            light._lamp_client.mark_recovered = Mock()
            light.async_apply_display_mode = AsyncMock()
            light._async_check_problems = Mock()
            with patch.object(RECOVERY, "realign", AsyncMock(return_value=229)), \
                    patch.object(RECOVERY, "LINK_RECOVERY_RESTART_WAIT", 0):
                self.assertTrue(await light._async_recover_link())
            light._lamp_client.mark_recovered.assert_called_once()
            light.async_apply_display_mode.assert_awaited_once_with(update_type="turn_on")
            self.assertFalse(light._fx_mode_is_direct)

        run(scenario())

    def test_a_lamp_off_the_network_spends_no_try(self):
        # 2026-11-16 18:27: the top lamp dropped off Wi-Fi for a minute; the
        # sweep could not connect. That try is given back, and the next comes
        # a minute later, not ten.
        async def scenario():
            light = stuck_light()
            light._link_recovery_tries = 1
            with patch.object(RECOVERY, "realign", AsyncMock(side_effect=TimeoutError())):
                self.assertFalse(await light._async_recover_link())
            self.assertEqual(0, light._link_recovery_tries)
            waited = RECOVERY.time.monotonic() - light._link_recovery_at
            self.assertAlmostEqual(
                RECOVERY.LINK_RECOVERY_RETRY - RECOVERY.LINK_RECOVERY_UNREACHABLE_RETRY, waited, delta=1,
            )

        run(scenario())

    def test_an_unanswered_sweep_leaves_the_power_cycle_to_the_user(self):
        async def scenario():
            light = stuck_light()
            light._link_recovery_tries = 1
            light.async_apply_display_mode = AsyncMock()
            with patch.object(RECOVERY, "realign", AsyncMock(return_value=None)):
                self.assertFalse(await light._async_recover_link())
            light.async_apply_display_mode.assert_not_called()

        run(scenario())


if __name__ == "__main__":
    unittest.main()
