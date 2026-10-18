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
        # The TCP gate's pace (the lamp's quota, about 1 s), short here; its
        # own tests below set it.
        self.interval = cube_matrix.TCP_COMMAND_INTERVAL
        cube_matrix.TCP_COMMAND_INTERVAL = 0.0
        self.addCleanup(setattr, cube_matrix, "TCP_COMMAND_INTERVAL", self.interval)
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

    async def test_tcp_on_demand_then_udp_again(self):
        # diagnostics force_tcp: every command over TCP for a while, as when
        # UDP fails (direct mode activated again over TCP), then UDP again.
        await self.cube.send_command_with_recovery("set_bright", [50])
        self.cube.force_tcp(60)
        self.assertEqual("tcp", self.cube.transport)
        self.assertTrue(self.cube.consume_reconnected_flag())
        self.assertAlmostEqual(60, self.cube.connection_state()["tcp_forced_for"], delta=1)
        received = len(self.lamp.received)
        await self.cube.send_command_with_recovery("set_bright", [60])
        self.assertEqual([("set_bright", [60])], _Bulb.sent)
        self.assertEqual(received, len(self.lamp.received))  # nothing over UDP
        # A lamp coming back online does not end it early.
        self.cube.mark_recovered()
        self.assertEqual("tcp", self.cube.transport)
        self.cube.force_tcp(0)
        self.assertEqual("udp", self.cube.transport)
        self.assertIsNone(self.cube.connection_state()["tcp_forced_for"])
        await self.cube.send_command_with_recovery("set_bright", [70])
        self.assertEqual("set_bright", self.udp_methods()[-1])
        self.assertEqual(1, len(_Bulb.sent))

    async def test_tcp_commands_wait_their_turn_and_only_the_latest_frame_goes(self):
        # Over TCP the lamp takes about one command a second (watched tests:
        # faster, it refused them, "client quota exceeded"). A frame still
        # waiting when a newer one comes is dropped: only the latest is drawn.
        cube_matrix.TCP_COMMAND_INTERVAL = 0.2
        loop = asyncio.get_running_loop()
        turns = []

        async def turn(command, label):
            ok = await self.cube._tcp_turn(command)
            turns.append((label, ok, round(loop.time() - started, 1)))

        started = loop.time()
        await asyncio.gather(
            turn("set_bright", "brightness"),
            turn("update_leds", "frame 1"),
            turn("update_leds", "frame 2"),
            turn("update_leds", "frame 3"),
            turn("set_fx_effect", "effect"),
        )
        self.assertEqual([
            ("brightness", True, 0.0),
            ("frame 1", False, 0.2),  # replaced while waiting
            ("frame 2", False, 0.2),
            ("frame 3", True, 0.2),   # the latest
            ("effect", True, 0.4),
        ], turns)

    async def test_a_quota_refusal_pauses_the_tcp_commands(self):
        cube_matrix.TCP_COMMAND_INTERVAL = 0.0
        original = cube_matrix.TCP_QUOTA_PAUSE
        cube_matrix.TCP_QUOTA_PAUSE = 0.3
        self.addCleanup(setattr, cube_matrix, "TCP_QUOTA_PAUSE", original)
        loop = asyncio.get_running_loop()
        self.cube._note_quota_refusal({"code": -1, "message": "client quota exceeded"})
        self.cube._note_quota_refusal({"code": 6, "message": "illegal request"})  # not the quota
        started = loop.time()
        self.assertTrue(await self.cube._tcp_turn("set_bright"))
        self.assertAlmostEqual(0.3, loop.time() - started, delta=0.1)
        started = loop.time()
        self.assertTrue(await self.cube._tcp_turn("set_bright"))
        self.assertLess(loop.time() - started, 0.1)  # once

    async def test_every_tcp_send_goes_through_the_gate(self):
        import ast

        source = (ROOT / "cube_matrix.py").read_text(encoding="utf-8")
        cube = next(n for n in ast.parse(source).body if getattr(n, "name", "") == "CubeMatrix")
        methods = {n.name: ast.unparse(n) for n in cube.body if isinstance(n, ast.AsyncFunctionDef)}
        for method in ("send_raw_command", "query_raw_command", "send_command_fast", "send_command_with_recovery"):
            self.assertIn("self._tcp_turn(command)", methods[method], method)
        for gone in ("FAST_SEQUENTIAL_INTERVAL", "SAFE_SUSTAINED_INTERVAL", "_min_command_interval"):
            self.assertNotIn(gone, source)

    async def test_the_light_hears_of_each_switch(self):
        # UDP failing and answering again change the connection without a
        # state change: on_transport_change lets the light publish it.
        original = cube_matrix.UDP_RECOVERY_PING
        cube_matrix.UDP_RECOVERY_PING = 0.05
        self.addCleanup(setattr, cube_matrix, "UDP_RECOVERY_PING", original)
        seen = []
        self.cube.on_transport_change = lambda: seen.append(self.cube.transport)
        await self.cube.send_command_with_recovery("set_bright", [50])
        self.assertEqual([], seen)  # UDP works: nothing switched
        self.lamp.silent = True
        await self.cube.send_command_with_recovery("set_bright", [60])
        self.assertEqual(["tcp"], seen)
        self.lamp.silent = False
        for _ in range(40):
            if len(seen) > 1:
                break
            await asyncio.sleep(0.05)
        self.assertEqual(["tcp", "udp"], seen)

    async def test_udp_comes_back_as_soon_as_the_lamp_answers(self):
        # A lamp silent for a moment: TCP meanwhile, then UDP again within a
        # ping (not after UDP_RETRY_AFTER), without a command waiting for it.
        original = cube_matrix.UDP_RECOVERY_PING
        cube_matrix.UDP_RECOVERY_PING = 0.05
        self.addCleanup(setattr, cube_matrix, "UDP_RECOVERY_PING", original)
        self.lamp.silent = True
        await self.cube.send_command_with_recovery("set_bright", [50])
        self.assertEqual("tcp", self.cube.transport)
        tcp = types.SimpleNamespace(setsockopt=lambda *args: None, closed=False)
        tcp.close = lambda: setattr(tcp, "closed", True)
        self.cube._fast_socket, self.cube._fast_socket_time = tcp, 1.0  # the TCP connection meanwhile
        await asyncio.sleep(0.15)  # still silent: still TCP
        self.assertEqual("tcp", self.cube.transport)
        self.lamp.silent = False
        for _ in range(40):
            if self.cube.transport == "udp":
                break
            await asyncio.sleep(0.05)
        self.assertEqual("udp", self.cube.transport)
        # No longer failing, even before a command (no Repair for a quiet lamp).
        self.assertIsNone(self.cube.connection_state()["udp_failing_for"])
        self.assertTrue(tcp.closed)
        await self.cube.send_command_with_recovery("set_bright", [60])
        self.assertEqual("set_bright", self.udp_methods()[-1])
        self.assertEqual([("set_bright", [50])], _Bulb.sent)  # only the one during the silence

    async def test_the_recovery_stops_with_the_lamp(self):
        self.lamp.silent = True
        await self.cube.send_command_with_recovery("set_bright", [50])
        recovery = self.cube._udp_recovery
        self.assertFalse(recovery.done())
        self.cube.close()
        await asyncio.sleep(0)
        self.assertTrue(recovery.cancelled() or recovery.done())

    async def test_an_idle_closed_session_is_still_udp(self):
        # The lamp drops an idle session; the next command opens a new one.
        # The connection label is not "tcp" meanwhile (it means UDP failed).
        await self.cube.send_command_with_recovery("set_bright", [50])
        self.cube._udp.close()
        self.assertEqual("udp", self.cube.transport)
        await self.cube.send_command_with_recovery("set_bright", [60])
        self.assertEqual("udp", self.cube.transport)
        self.assertEqual([], _Bulb.sent)

    async def test_the_tcp_connection_is_closed_once_udp_works_again(self):
        # UDP failed while the lamp answered over TCP; once UDP works again
        # (its retry), the TCP connection opened meanwhile is closed.
        self.lamp.silent = True
        await self.cube.send_command_with_recovery("set_bright", [50])
        self.assertEqual("tcp", self.cube.transport)
        tcp = types.SimpleNamespace(setsockopt=lambda *args: None, closed=False)
        tcp.close = lambda: setattr(tcp, "closed", True)
        self.cube._fast_socket, self.cube._fast_socket_time = tcp, 1.0
        self.lamp.silent = False
        self.cube._udp_retry_at = 0.0  # UDP_RETRY_AFTER has passed
        await self.cube.send_command_with_recovery("set_bright", [60])
        self.assertEqual("udp", self.cube.transport)
        self.assertTrue(tcp.closed)
        self.assertIsNone(self.cube._fast_socket)


if __name__ == "__main__":
    unittest.main()
