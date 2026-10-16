"""How CubeMatrix reaches the lamp: over its UDP command session when it
works, else over TCP as before (cube_matrix.py, udp_session.py), against the
fake lamp of test_udp_session. TCP is the python-yeelight stand-in below,
which records what it was asked to send."""
import asyncio
import importlib
import sys
import types
import unittest

from tests.test_native_features import ROOT
from tests.test_udp_session import FakeLamp


class _BulbException(Exception):
    pass


class _Bulb:
    """python-yeelight's Bulb, recording its (TCP) commands."""

    sent = []

    def __init__(self, ip, port):
        self._Bulb__socket = None
        self._timeout = 1

    def send_command(self, method, params):
        _Bulb.sent.append((method, params))
        return {"id": 1, "result": ["ok"]}


def _load_cube_matrix():
    sys.modules.setdefault(
        "yeelight", types.SimpleNamespace(Bulb=_Bulb, BulbException=_BulbException)
    )
    # The integration's folder as a package, without running its __init__
    # (Home Assistant): cube_matrix only needs udp_session next to it.
    package = types.ModuleType("yeelight_cube_transport")
    package.__path__ = [str(ROOT)]
    sys.modules.setdefault("yeelight_cube_transport", package)
    return importlib.import_module("yeelight_cube_transport.cube_matrix")


cube_matrix = _load_cube_matrix()


class CubeTransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        _Bulb.sent.clear()
        loop = asyncio.get_running_loop()
        self.lamp = FakeLamp()
        self.server, _ = await loop.create_datagram_endpoint(
            lambda: self.lamp, local_addr=("127.0.0.1", 0)
        )
        port = self.server.get_extra_info("sockname")[1]
        self.cube = cube_matrix.CubeMatrix("127.0.0.1", 55443)
        # The lamp's session, on the fake lamp's port.
        self.cube._udp = cube_matrix.UdpSession("127.0.0.1", port)

    async def asyncTearDown(self):
        self.cube.close()
        self.server.close()

    def udp_methods(self):
        return [m["method"] for m in self.lamp.received]

    async def test_commands_and_frames_go_over_udp(self):
        answer = await self.cube.send_command_with_recovery("set_bright", [50])
        self.assertEqual(["ok"], answer["result"])
        await self.cube.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        self.assertTrue(await self.cube.send_command_fast("update_leds", ["AAAA"]))
        await asyncio.sleep(0.05)
        self.assertEqual(
            ["udp_sess_new", "set_bright", "activate_fx_mode", "update_leds"], self.udp_methods()
        )
        self.assertEqual([], _Bulb.sent)  # nothing over TCP
        self.assertEqual("udp", self.cube.transport)
        self.assertEqual(3, self.cube._total_commands_sent)

    async def test_a_refusal_is_the_libraries_exception(self):
        with self.assertRaises(_BulbException):
            await self.cube.send_command_with_recovery("bad_method", [])
        with self.assertRaises(_BulbException):
            await self.cube.send_raw_command("bad_method", [], check_reply=True)
        # Unchecked, like on TCP: logged, not raised.
        await self.cube.send_raw_command("bad_method", [])

    async def test_without_a_session_commands_go_over_tcp_and_udp_is_retried_later(self):
        self.lamp.silent = True
        answer = await self.cube.send_command_with_recovery("set_bright", [50])
        self.assertEqual(["ok"], answer["result"])
        self.assertEqual([("set_bright", [50])], _Bulb.sent)
        self.assertEqual("tcp", self.cube.transport)
        # Direct mode activated in the session does not carry over to TCP.
        self.assertTrue(self.cube.consume_reconnected_flag())
        # Not tried again at once...
        received = len(self.lamp.received)
        await self.cube.send_command_with_recovery("set_bright", [60])
        self.assertEqual(received, len(self.lamp.received))
        # ...but once the lamp is back online.
        self.lamp.silent = False
        self.cube.mark_recovered()
        await self.cube.send_command_with_recovery("set_bright", [70])
        self.assertEqual("set_bright", self.udp_methods()[-1])
        self.assertEqual("udp", self.cube.transport)

    async def test_a_new_session_is_put_in_direct_mode_before_the_next_frame(self):
        # The lamp dropped the session: the new one gets direct mode first,
        # and nothing has to recover (no re-activation, no brightness sent).
        await self.cube.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        self.assertFalse(self.cube.consume_reconnected_flag())
        self.lamp.forget()
        self.cube._udp._last_answer = 0  # quiet long enough: confirmed first
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await asyncio.sleep(0.05)
        self.assertEqual(
            ["udp_sess_new", "activate_fx_mode", "udp_sess_keep_alive",
             "udp_sess_new", "activate_fx_mode", "update_leds"],
            self.udp_methods(),
        )
        self.assertEqual(self.lamp.token, self.lamp.received[-1]["token"])
        self.assertFalse(self.cube.consume_reconnected_flag())

    async def test_after_another_mode_a_new_session_is_not_put_in_direct_mode(self):
        await self.cube.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        await self.cube.send_raw_command("set_fx_effect", [39, 0, 4, {}])
        self.lamp.forget()
        await self.cube.send_command_fast("set_bright", [80])
        self.assertEqual(1, self.udp_methods().count("activate_fx_mode"))
        # Reported as before: direct mode is not on in the new session.
        self.assertTrue(self.cube.consume_reconnected_flag())

    async def test_direct_mode_activated_over_tcp_is_not_in_a_new_session(self):
        await self.cube.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        self.cube._udp_retry_at = float("inf")  # UDP failed: TCP took over
        await self.cube.send_command_with_recovery("activate_fx_mode", [{"mode": "direct"}])
        self.assertEqual([("activate_fx_mode", [{"mode": "direct"}])], _Bulb.sent)
        self.cube._udp_retry_at = 0.0  # UDP back, in a new session
        self.lamp.forget()
        await self.cube.send_command_fast("set_bright", [80])
        self.assertEqual(1, self.udp_methods().count("activate_fx_mode"))
        self.assertTrue(self.cube.consume_reconnected_flag())

    async def test_the_running_effect_is_forgotten_by_any_other_command(self):
        effect = [39, 0, 4, {"mode": 39, "onoff": 1, "rate": 50}]
        await self.cube.send_raw_command("set_fx_effect", effect, check_reply=True)
        self.cube.note_running_effect(effect)
        # Brightness and live updates leave it running.
        await self.cube.send_command_fast("set_bright", [40])
        await self.cube.send_raw_command("update_fx_effect", [{"rate": 80}], check_reply=True)
        self.assertEqual(effect, self.cube.running_effect)
        # Anything else may replace or stop it.
        await self.cube.send_raw_command("set_power", ["off"])
        self.assertIsNone(self.cube.running_effect)
        # So may a lamp restart (a new session) or an outage.
        self.cube.note_running_effect(effect)
        self.lamp.forget()
        await self.cube.send_command_fast("set_bright", [40])
        self.assertIsNone(self.cube.running_effect)
        for mark in (self.cube.mark_unreachable, self.cube.mark_recovered):
            self.cube.note_running_effect(effect)
            mark()
            self.assertIsNone(self.cube.running_effect)

    def frames(self):
        return [m["params"][0] for m in self.lamp.received if m["method"] == "update_leds"]

    async def settled(self):
        await asyncio.sleep(cube_matrix.FRAME_SETTLE_DELAY + 0.15)

    async def test_the_last_frame_of_a_burst_is_sent_again(self):
        # Frames are never answered: the last one is sent again once, and
        # nothing else with it (a set_bright after frames can make the lamp
        # show an older picture again).
        await self.cube.send_command_fast("set_bright", [80])
        for frame in ("AAAA", "BBBB", "CCCC"):
            await self.cube.send_command_fast("update_leds", [frame])
        await self.settled()
        self.assertEqual(["AAAA", "BBBB", "CCCC", "CCCC"], self.frames())
        self.assertEqual(1, self.udp_methods().count("set_bright"))  # only ours
        # Brightness leaves the picture as it is: the re-send still comes.
        await self.cube.send_command_fast("update_leds", ["DDDD"])
        await self.cube.send_command_fast("set_bright", [40])
        await self.settled()
        self.assertEqual(["DDDD", "DDDD"], self.frames()[-2:])

    async def test_another_command_cancels_the_resend(self):
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await self.cube.send_raw_command("set_fx_effect", [39, 0, 4, {}])
        await self.settled()
        self.assertEqual(["AAAA"], self.frames())  # never over the effect


    async def test_a_command_over_tcp_cancels_the_resend_too(self):
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        # UDP failed meanwhile: the next command goes over TCP.
        self.cube._udp_retry_at = float("inf")
        await self.cube.send_command_with_recovery("set_fx_effect", [39, 0, 4, {}])
        self.assertEqual([("set_fx_effect", [39, 0, 4, {}])], _Bulb.sent)
        await self.settled()
        self.assertEqual(["AAAA"], self.frames())  # no stale frame after it

    async def test_the_probe_asks_the_session(self):
        self.assertTrue(await self.cube.probe(0.2))
        self.assertEqual(["udp_sess_new"], self.udp_methods())


if __name__ == "__main__":
    unittest.main()
