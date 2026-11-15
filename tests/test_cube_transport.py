"""How LampClient reaches the lamp: over its UDP command session when it
works, else over TCP as before (lamp_client*.py, udp_session.py), against the
fake lamp of test_udp_session. TCP is the python-yeelight stand-in below,
which records what it was asked to send."""
import asyncio
import importlib
import sys
import types
import unittest
from unittest.mock import patch

from tests.test_native_features import ROOT
from tests.fakes import lamp_client_source
from tests.test_udp_session import FakeLamp, shorter_waits


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


def _load_lamp_client():
    # The integration's folder as a package of its own, without running its
    # __init__ (Home Assistant): lamp_client only needs its parts and
    # udp_session next to it, and gets the recording python-yeelight above
    # while it is imported (the other tests keep the stand-in of
    # tests/fakes.py).
    saved = sys.modules.get("yeelight")
    sys.modules["yeelight"] = types.SimpleNamespace(Bulb=_Bulb, BulbException=_BulbException)
    package = types.ModuleType("yeelight_cube_transport")
    package.__path__ = [str(ROOT)]
    sys.modules.setdefault("yeelight_cube_transport", package)
    try:
        return importlib.import_module("yeelight_cube_transport.lamp_client")
    finally:
        if saved is None:
            sys.modules.pop("yeelight", None)
        else:
            sys.modules["yeelight"] = saved


lamp_client = _load_lamp_client()
# Its parts, whose module-level timings and helpers the tests replace.
client_udp = sys.modules["yeelight_cube_transport.lamp_client_udp"]
client_tcp = sys.modules["yeelight_cube_transport.lamp_client_tcp"]
client_health = sys.modules["yeelight_cube_transport.lamp_client_health"]
protocol = sys.modules["yeelight_cube_transport.lamp_protocol"]


class CubeTransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        _Bulb.sent.clear()
        shorter_waits(self, sys.modules[lamp_client.UdpSession.__module__])
        # The TCP gate's pace (the lamp's quota, about 1 s), short here; its
        # own tests below set it.
        self.interval = client_tcp.TCP_COMMAND_INTERVAL
        client_tcp.TCP_COMMAND_INTERVAL = 0.0
        self.addCleanup(setattr, client_tcp, "TCP_COMMAND_INTERVAL", self.interval)
        loop = asyncio.get_running_loop()
        self.lamp = FakeLamp()
        self.server, _ = await loop.create_datagram_endpoint(
            lambda: self.lamp, local_addr=("127.0.0.1", 0)
        )
        port = self.server.get_extra_info("sockname")[1]
        self.cube = lamp_client.LampClient("127.0.0.1", 55443)
        # The lamp's session, on the fake lamp's port.
        self.cube._udp = lamp_client.UdpSession("127.0.0.1", port)

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

    async def test_a_cube_matrix_command_waits_for_its_answer_before_closing(self):
        """2026-11-11 on a Cube Matrix: set_bright sent on a connection reset
        at once was lost 2 times in 6 (the lamp stayed at 25 % while Home
        Assistant showed 100 %); waiting for its answer (~7 ms) took 6 of 6.
        A Cube Lite's connection is still closed at once."""
        steps = []
        answer = [b'{"id":1,"result":["ok"]}\r\n']

        class LampSocket:
            def __init__(self, *args):
                pass

            def settimeout(self, value):
                pass

            def connect(self, address):
                steps.append("connect")

            def sendall(self, data):
                steps.append("send")

            def recv(self, size):
                steps.append("recv")
                return answer.pop(0) if answer else b""

            def setsockopt(self, *args):
                pass

            def close(self):
                steps.append("close")

        with patch.object(client_tcp.socket, "socket", LampSocket):
            await self.cube.send_raw_command("set_bright", [50], udp=False)
            self.assertEqual(["connect", "send", "close"], steps)      # a Cube Lite
            steps.clear()
            self.cube._udp = lamp_client.MusicChannel("127.0.0.1", 55443)
            await self.cube.send_raw_command("set_bright", [50], udp=False)
            self.assertEqual(["connect", "send", "recv", "close"], steps)
            # A refusal it answers is logged, not raised, unless checked.
            answer.append(b'{"id":1,"error":{"code":-1,"message":"invalid params"}}\r\n')
            await self.cube.send_raw_command("set_bright", [50], udp=False)

    async def test_a_cube_matrix_whose_lan_is_stuck_is_found_while_its_music_connection_fails(self):
        """2026-11-12: the Cube Matrix accepted every TCP connection and closed
        it at once (Matter still working), so it never connected back: asked a
        command over TCP while that fails, it is found silent (the
        matrix_lan_stuck repair), and no longer once it answers."""
        answering = []

        async def lamp(reader, writer):
            try:
                if answering and await reader.readline():
                    writer.write(b'{"id":1,"result":["on"]}\r\n')
                    await writer.drain()
            except ConnectionError:
                pass  # the connection check only connects
            writer.close()

        server = await asyncio.start_server(lamp, "127.0.0.1", 0)
        self.addAsyncCleanup(server.wait_closed)
        self.addCleanup(server.close)
        cube = lamp_client.LampClient("127.0.0.1", server.sockets[0].getsockname()[1])
        self.addCleanup(cube.close)
        cube._udp = lamp_client.MusicChannel("127.0.0.1", 1)
        with patch.object(client_udp, "UDP_RECOVERY_PING", 0.01), patch.object(client_udp, "MUSIC_LAN_CHECK", 0.0):
            cube._udp_retry_at = client_udp.time.monotonic() + 0.3
            await cube._recover_udp()
            self.assertGreater(cube.silent_for, 0)
            self.assertGreater(cube.connection_state()["silent_for"], 0)
            answering.append(True)
            cube._udp_retry_at = client_udp.time.monotonic() + 0.3
            await cube._recover_udp()
            self.assertEqual(0, cube.silent_for)

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

    async def test_the_fx_mode_flag_is_cleared_over_tcp_unanswered(self):
        # deactivate_fx_mode (LampClient.clear_fx_mode_flag): over TCP, not
        # waited for -- with the flag already clear the lamp does not answer,
        # which the session would take for a lost lamp. Only while the flag
        # may be set: unknown at first, set by every activate_fx_mode.
        received = []

        class SilentLampSocket:
            """A TCP connection to a lamp that never answers: what was sent
            is recorded (a listener would lose it to the reset close)."""

            def __init__(self, *args):
                pass

            def settimeout(self, timeout):
                pass

            def connect(self, address):
                pass

            def sendall(self, data):
                received.append(data)

            def recv(self, size):
                raise TimeoutError

            def setsockopt(self, *args):
                pass

            def close(self):
                pass

        # Only the TCP command's socket: the session's are real.
        tcp = lambda: patch.object(client_tcp.socket, "socket", SilentLampSocket)
        settle = client_tcp.FX_MODE_RESTORE_SETTLE
        client_tcp.FX_MODE_RESTORE_SETTLE = 0.0
        self.addCleanup(setattr, client_tcp, "FX_MODE_RESTORE_SETTLE", settle)
        await self.cube.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        self.assertTrue(self.cube.fx_mode_flag_maybe_set)
        with tcp():
            self.assertTrue(await self.cube.clear_fx_mode_flag())
        self.assertEqual([b'{"id":1,"method":"deactivate_fx_mode","params":[]}\r\n'], received)
        self.assertNotIn("deactivate_fx_mode", self.udp_methods())
        self.assertEqual("udp", self.cube.transport)  # the session is still fine
        # Direct mode ended: a new session is not put back in it.
        self.assertEqual([], self.cube._udp.session_setup)
        self.assertIsNone(self.cube.running_effect)
        # Clear: not sent again, until direct mode sets it again.
        with tcp():
            self.assertFalse(await self.cube.clear_fx_mode_flag())
        await self.cube.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        with tcp():
            self.assertTrue(await self.cube.clear_fx_mode_flag())
        self.assertEqual(2, len(received))

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
        await asyncio.sleep(client_udp.FRAME_SETTLE_DELAY + 0.15)

    async def test_the_last_frame_of_a_burst_is_sent_again(self):
        # Frames are never answered: the last one is sent again (a burst is a
        # stream: steadily, STREAM_KEEP_BUSY), and nothing else with it (a
        # set_bright after frames can make the lamp show an older picture again).
        await self.cube.send_command_fast("set_bright", [80])
        for frame in ("AAAA", "BBBB", "CCCC"):
            await self.cube.send_command_fast("update_leds", [frame])
        await self.settled()
        frames = self.frames()
        self.assertEqual(["AAAA", "BBBB", "CCCC", "CCCC"], frames[:4])
        self.assertEqual({"CCCC"}, set(frames[3:]))
        self.assertEqual(1, self.udp_methods().count("set_bright"))  # only ours
        # Brightness leaves the picture as it is: the re-sends go on.
        await self.cube.send_command_fast("update_leds", ["DDDD"])
        await self.cube.send_command_fast("set_bright", [40])
        await self.settled()
        self.assertEqual(["DDDD", "DDDD"], self.frames()[-2:])

    async def test_a_lone_frame_is_sent_again_once(self):
        # A picture (no frame just before it): the usual settle, no stream.
        self.cube._last_frame_at = 0.0
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await self.settled()
        self.assertEqual(["AAAA", "AAAA"], self.frames())

    def short_stream_timings(self):
        for name, value in (("FRAME_SETTLE_DELAY", 0.02), ("STREAM_KEEP_BUSY", 0.05), ("STREAM_HOLD", 0.4)):
            self.addCleanup(setattr, client_udp, name, getattr(client_udp, name))
            setattr(client_udp, name, value)

    async def test_a_stream_is_kept_busy_until_its_frames_stop(self):
        # A Cube Lite saves its state ~0.8 s after its last command; during a
        # stream that save can hang it: while frames keep coming, the last one
        # is sent again every STREAM_KEEP_BUSY, for STREAM_HOLD after it.
        self.short_stream_timings()
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await self.cube.send_command_fast("update_leds", ["BBBB"])
        await asyncio.sleep(0.3)
        busy = self.frames()
        self.assertEqual(["AAAA", "BBBB"], busy[:2])
        self.assertGreaterEqual(len(busy), 2 + 4)
        self.assertEqual({"BBBB"}, set(busy[2:]))
        await asyncio.sleep(0.35)  # past STREAM_HOLD: the stream is over
        done = len(self.frames())
        await asyncio.sleep(0.2)
        self.assertEqual(done, len(self.frames()))

    async def test_the_stream_stats_come_from_the_udp_session(self):
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        self.assertEqual(1, self.cube.stream_stats()["frames"])
        self.cube._udp = lamp_client.MusicChannel("127.0.0.1", 1)
        self.assertEqual({}, self.cube.stream_stats())

    async def test_a_single_frame_gets_one_resend_only(self):
        # A picture (no frame just before it): the usual settle, no repeats.
        self.short_stream_timings()
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await asyncio.sleep(0.3)
        self.assertEqual(["AAAA", "AAAA"], self.frames())

    async def test_another_command_stops_a_busy_stream(self):
        self.short_stream_timings()
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await self.cube.send_command_fast("update_leds", ["BBBB"])
        await asyncio.sleep(0.15)
        await self.cube.send_raw_command("set_fx_effect", [39, 0, 4, {}])
        stopped = len(self.frames())
        await asyncio.sleep(0.3)
        self.assertEqual(stopped, len(self.frames()))  # never over the effect

    def gaps(self, since: int = 0):
        """The longest silence (s) between the frames the lamp received from
        the ``since``-th on (the fake lamp stamps each)."""
        times = [m["at"] for m in self.lamp.received if m["method"] == "update_leds"][since:]
        return max((b - a for a, b in zip(times, times[1:])), default=0.0)

    async def test_while_a_producer_runs_every_pause_is_kept_busy(self):
        # The effect stream (a slow or failed render) or the text scroll (its
        # pauses at both ends) stopping for longer than STREAM_HOLD: the lamp
        # is never left silent mid-stream while its producer runs.
        self.short_stream_timings()
        self.cube.stream_running("studio", True)
        await self.cube.send_command_fast("update_leds", ["AAAA"])
        await asyncio.sleep(1.0)  # 2.5 x STREAM_HOLD without a new frame
        busy = self.frames()
        self.assertGreaterEqual(len(busy), 12)  # timers on Windows run a little late
        self.assertEqual({"AAAA"}, set(busy))
        self.assertLess(self.gaps(), 0.05 * 3)
        # The producer stopped: the re-sends end STREAM_HOLD after its last frame.
        self.cube.stream_running("studio", False)
        await self.cube.send_command_fast("update_leds", ["BBBB"])
        await asyncio.sleep(0.6)
        done = len(self.frames())
        await asyncio.sleep(0.2)
        self.assertEqual(done, len(self.frames()))

    async def test_the_light_hears_when_streaming_starts_and_ends(self):
        # on_stream_change: the light checks the lamp while anything streams
        # to it (light_studio._stream_watchdog), the scroll as the effects.
        calls = []
        self.cube.on_stream_change = lambda: calls.append(self.cube.streams_running)
        self.cube.stream_running("studio", True)
        self.cube.stream_running("scroll", True)  # already streaming: no news
        self.cube.stream_running("studio", False)
        self.cube.stream_running("scroll", False)
        self.assertEqual([True, False], calls)
        self.assertFalse(self.cube.stream_silent)

    async def test_a_stalled_producer_is_kept_busy_up_to_the_limit_then_logged(self):
        self.short_stream_timings()
        self.addCleanup(setattr, client_udp, "STREAM_STALL_LIMIT", client_udp.STREAM_STALL_LIMIT)
        client_udp.STREAM_STALL_LIMIT = 0.5
        self.cube.stream_running("scroll", True)
        self.addCleanup(self.cube.stream_running, "scroll", False)
        with self.assertLogs(client_udp._LOGGER, "WARNING") as logged:
            await self.cube.send_command_fast("update_leds", ["AAAA"])
            await asyncio.sleep(0.8)
        self.assertIn("No new frame", logged.output[0])
        self.assertIn("scroll", logged.output[0])
        stopped = len(self.frames())
        await asyncio.sleep(0.2)
        self.assertEqual(stopped, len(self.frames()))  # no longer sent again
        # A new frame starts it all over.
        await self.cube.send_command_fast("update_leds", ["BBBB"])
        await asyncio.sleep(0.2)
        self.assertGreater(len(self.frames()), stopped + 2)

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
        self.assertEqual(self.cube.silent_for, 0)
        # Recovering: a command the lamp itself answers, which changes nothing.
        self.assertTrue(await self.cube.probe(0.2, answering=True))
        self.assertEqual(["udp_sess_new", "set_scene"], self.udp_methods())
        self.assertEqual(["keep"], self.lamp.received[-1]["params"])

    async def test_an_error_to_the_probe_is_no_answer(self):
        # An error can come from the lamp's network chip alone (a quota), the
        # lamp itself stuck: no answer, asked over TCP, still silent.
        async def refused(method, params=None):
            return {"id": 1, "error": {"code": -1, "message": "client quota exceeded"}}

        async def accepts(*args):
            return None

        async def no_answer(*args):
            raise OSError("timed out")

        self.cube._silent_since = 1.0  # silent already
        with patch.object(self.cube._udp, "request", refused), \
                patch.object(client_health, "check_tcp", accepts), patch.object(client_health, "send_once", no_answer):
            self.assertFalse(await self.cube.probe(0.2, answering=True))
        self.assertGreater(self.cube.silent_for, 0)  # not reset by the error

    async def test_a_lamp_accepting_connections_but_answering_nothing_is_stuck(self):
        # Its network part accepts TCP, the lamp answers no command (UDP or
        # TCP): not back online, and reported as stuck (silent_for).
        self.lamp.silent = True
        self.cube._udp_retry_at = float("inf")

        async def accepts(*args):
            return None

        async def no_answer(*args):
            raise OSError("timed out")

        with patch.object(client_health, "check_tcp", accepts), patch.object(client_health, "send_once", no_answer):
            # Its network part accepts: enough for a healthy lamp's probe...
            self.assertTrue(await self.cube.probe(0.2))
            # ...not for one recovering: the lamp itself must answer.
            self.assertFalse(await self.cube.probe(0.2, answering=True))
            self.assertGreaterEqual(self.cube.silent_for, 0)
            self.assertIsNotNone(self.cube.connection_state()["silent_for"])
        # It answers again (after a power cycle): no longer stuck.
        with patch.object(client_health, "check_tcp", accepts), patch.object(client_health, "send_once", accepts):
            self.assertTrue(await self.cube.probe(0.2, answering=True))
        self.assertEqual(self.cube.silent_for, 0)
        self.assertIsNone(self.cube.connection_state()["silent_for"])

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
        client_tcp.TCP_COMMAND_INTERVAL = 0.2
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
        client_tcp.TCP_COMMAND_INTERVAL = 0.0
        original = client_tcp.TCP_QUOTA_PAUSE
        client_tcp.TCP_QUOTA_PAUSE = 0.3
        self.addCleanup(setattr, client_tcp, "TCP_QUOTA_PAUSE", original)
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

        source = lamp_client_source()
        classes = [n for n in ast.parse(source).body if isinstance(n, ast.ClassDef)]
        methods = {
            n.name: ast.unparse(n) for cls in classes for n in cls.body if isinstance(n, ast.AsyncFunctionDef)
        }
        for method in ("send_raw_command", "query_raw_command", "send_command_fast", "send_command_with_recovery"):
            self.assertIn("self._tcp_turn(command)", methods[method], method)
        for gone in ("FAST_SEQUENTIAL_INTERVAL", "SAFE_SUSTAINED_INTERVAL", "_min_command_interval"):
            self.assertNotIn(gone, source)

    async def test_the_light_hears_of_each_switch(self):
        # UDP failing and answering again change the connection without a
        # state change: on_transport_change lets the light publish it.
        original = client_udp.UDP_RECOVERY_PING
        client_udp.UDP_RECOVERY_PING = 0.05
        self.addCleanup(setattr, client_udp, "UDP_RECOVERY_PING", original)
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
        original = client_udp.UDP_RECOVERY_PING
        client_udp.UDP_RECOVERY_PING = 0.05
        self.addCleanup(setattr, client_udp, "UDP_RECOVERY_PING", original)
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
