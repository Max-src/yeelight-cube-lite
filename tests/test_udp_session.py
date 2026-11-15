"""The lamp's UDP command session (udp_session.UdpSession), against a fake
lamp that answers like the Cube Lite does:
a token from udp_sess_new, every command answered by its id except
update_leds, -1 for a token it does not know."""
import sys as _sys

# Other test files import this one as tests.test_udp_session, test discovery as
# test_udp_session: one module under both names, so its setup runs once and a patch
# of it is seen by all.
for _name in ("test_udp_session", "tests.test_udp_session"):
    _sys.modules.setdefault(_name, _sys.modules[__name__])

import asyncio
import importlib.util
import json
import time
import unittest

from tests.test_native_features import ROOT

_spec = importlib.util.spec_from_file_location("udp_session", ROOT / "udp_session.py")
udp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(udp)


def shorter_waits(test, module):
    """The session's waits for an answer, a third of the lamp's, for the
    tests: the fake lamp on this computer answers within a millisecond, and
    a silent one is then given up on sooner. The tests read the waits from
    the module, so what they check is unchanged."""
    answer = module.UdpSession._answer
    saved = (answer.__defaults__, module.REPLY_TIMEOUT, module.HANDSHAKE_TIMEOUT)
    module.REPLY_TIMEOUT, module.HANDSHAKE_TIMEOUT = saved[1] / 3, saved[2] / 3
    answer.__defaults__ = (module.REPLY_TIMEOUT, module.ATTEMPTS)

    def restore():
        answer.__defaults__, module.REPLY_TIMEOUT, module.HANDSHAKE_TIMEOUT = saved

    test.addCleanup(restore)


class FakeLamp(asyncio.DatagramProtocol):
    """Answers like the lamp. ``drop`` swallows the next N datagrams;
    ``silent`` answers nothing; ``forget()`` loses the session (a restart)."""

    def __init__(self):
        self.received = []
        self.token = None
        self.sessions = 0
        self.drop = 0
        self.silent = False

    def connection_made(self, transport):
        self.transport = transport

    def forget(self):
        self.token = None

    def datagram_received(self, data, addr):
        assert data.endswith(b"\r\n"), "the lamp ignores datagrams without \\r\\n"
        message = json.loads(data)
        message["at"] = time.monotonic()  # when it arrived (silences between frames)
        self.received.append(message)
        if self.silent:
            return
        if self.drop:
            self.drop -= 1
            return
        method = message["method"]
        if method == "udp_sess_new":
            self.sessions += 1
            self.token = f"{self.sessions:032x}"
            reply = {"id": message["id"], "method": "udp_sess_token", "params": {"token": self.token}}
        elif message.get("token") != self.token or self.token is None:
            reply = {"id": message["id"], "error": {"code": -1, "message": "invalid parameter"}}
        elif method == "update_leds":
            return  # frames are never answered
        elif method == "bad_method":
            reply = {"id": message["id"], "error": {"code": 1, "message": "invalid params"}, "token": self.token}
        else:
            reply = {"id": message["id"], "result": ["ok"], "token": self.token}
        self.transport.sendto(json.dumps(reply).encode() + b"\r\n", addr)


class UdpSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        shorter_waits(self, udp)
        loop = asyncio.get_running_loop()
        self.lamp = FakeLamp()
        self.server, _ = await loop.create_datagram_endpoint(
            lambda: self.lamp, local_addr=("127.0.0.1", 0)
        )
        port = self.server.get_extra_info("sockname")[1]
        self.session = udp.UdpSession("127.0.0.1", port)

    async def asyncTearDown(self):
        self.session.close()
        self.server.close()

    def methods(self):
        return [m["method"] for m in self.lamp.received]

    async def test_a_command_waits_a_moment_after_frames(self):
        await self.session.request("set_bright", [80])
        await self.session.request("update_leds", ["AAAA"])
        started = asyncio.get_running_loop().time()
        await self.session.request("set_bright", [60])
        # The lamp's command handling can stall for good on a command right
        # after a run of frames (udp.FRAME_QUIET).
        self.assertGreaterEqual(asyncio.get_running_loop().time() - started, udp.FRAME_QUIET * 0.9)
        # The keep-alive, which the lamp's network chip answers, does not wait.
        await self.session.request("update_leds", ["BBBB"])
        started = asyncio.get_running_loop().time()
        self.assertTrue(await self.session.ping())
        self.assertLess(asyncio.get_running_loop().time() - started, udp.FRAME_QUIET / 2)
        await asyncio.sleep(udp.FRAME_QUIET)
        # Without frames before it, at once.
        started = asyncio.get_running_loop().time()
        await self.session.request("set_bright", [40])
        self.assertLess(asyncio.get_running_loop().time() - started, udp.FRAME_QUIET / 2)

    async def test_a_command_opens_the_session_and_returns_the_answer(self):
        answer = await self.session.request("set_bright", [80])
        self.assertEqual(["ok"], answer["result"])
        self.assertEqual(["udp_sess_new", "set_bright"], self.methods())
        sent = self.lamp.received[-1]
        self.assertEqual(self.lamp.token, sent["token"])
        self.assertEqual([80], sent["params"])
        # One session for every later command.
        await self.session.request("set_power", ["on"])
        self.assertEqual(1, self.lamp.sessions)

    async def test_the_stream_s_frames_and_gaps_are_counted_for_the_logs(self):
        await self.session.request("update_leds", ["AAAA"])
        await asyncio.sleep(0.2)
        self.assertEqual(1, self.session.stream_stats()["frames"])
        # The pause before the next frame is a gap of the stream.
        await self.session.request("update_leds", ["BBBB"])
        stats = self.session.stream_stats()
        self.assertEqual(2, stats["frames"])
        self.assertEqual(1, stats["gaps_over_100ms"])
        self.assertGreaterEqual(stats["longest_gap_s"], 0.19)

    async def test_an_error_answer_is_returned_not_retried(self):
        answer = await self.session.request("bad_method", [])
        self.assertEqual(1, answer["error"]["code"])
        self.assertEqual(1, self.methods().count("bad_method"))

    async def test_a_lost_datagram_is_sent_again(self):
        await self.session.request("set_bright", [80])
        self.lamp.drop = 1  # the next command does not arrive
        answer = await self.session.request("set_bright", [60])
        self.assertEqual(["ok"], answer["result"])
        self.assertEqual(2, self.methods().count("set_bright") - 1)  # 1 + resend

    async def test_a_lamp_that_lost_the_session_gets_a_new_one(self):
        await self.session.request("set_bright", [80])
        self.lamp.forget()  # e.g. it restarted
        answer = await self.session.request("set_fx_effect", [39, 0, 4, {}])
        self.assertEqual(["ok"], answer["result"])
        self.assertEqual(2, self.lamp.sessions)
        self.assertEqual(2, self.session.sessions_opened)

    async def test_a_new_session_gets_the_session_setup_first(self):
        self.session.session_setup = [("activate_fx_mode", [{"mode": "direct"}])]
        await self.session.request("set_bright", [80])
        self.lamp.forget()
        await self.session.request("set_bright", [60])
        self.assertEqual(
            ["udp_sess_new", "activate_fx_mode", "set_bright", "set_bright",
             "udp_sess_new", "activate_fx_mode", "set_bright"],
            self.methods(),
        )

    async def test_a_setup_the_new_session_refuses_makes_it_unavailable(self):
        self.session.session_setup = [("bad_method", [])]
        with self.assertRaises(udp.UdpUnavailable):
            await self.session.request("set_bright", [80])
        self.assertFalse(self.session.is_open)

    async def test_a_stream_whose_session_was_dropped_gets_a_new_one_at_once(self):
        # The lamp answers a refused frame with -1. Frames have no waiter, so
        # that refusal used to count as an answer (no keep-alive check) and
        # every later frame was refused: the lamp went without frames until
        # the next command. Now the next frame opens a new session, put in
        # direct mode again first.
        self.session.session_setup = [("activate_fx_mode", [{"mode": "direct"}])]
        await self.session.request("update_leds", ["AAAA"])
        self.lamp.forget()
        await self.session.request("update_leds", ["BBBB"])  # refused
        await asyncio.sleep(0.05)  # the refusal arrives
        self.assertFalse(self.session.is_open)
        await self.session.request("update_leds", ["CCCC"])
        await asyncio.sleep(0.05)
        self.assertEqual(2, self.lamp.sessions)
        self.assertEqual(
            ["udp_sess_new", "activate_fx_mode", "update_leds", "update_leds",
             "udp_sess_new", "activate_fx_mode", "update_leds"],
            self.methods(),
        )
        self.assertEqual(self.lamp.token, self.lamp.received[-1]["token"])

    async def test_frames_are_not_waited_for(self):
        await self.session.request("activate_fx_mode", [{"mode": "direct"}])
        self.assertIsNone(await self.session.request("update_leds", ["AAAA"]))
        await asyncio.sleep(0.05)  # delivery to the fake lamp
        self.assertEqual("update_leds", self.methods()[-1])

    async def test_a_silent_lamp_is_unavailable(self):
        self.lamp.silent = True
        with self.assertRaises(udp.UdpUnavailable):
            await self.session.request("set_bright", [80])
        self.assertFalse(self.session.is_open)
        self.assertFalse(await self.session.ping())

    async def test_a_datagram_the_lamp_would_drop_is_refused(self):
        await self.session.request("set_bright", [80])
        with self.assertRaises(udp.UdpTooLarge):
            await self.session.request("update_leds", ["A" * 800])

    async def test_ping_opens_or_confirms_the_session(self):
        self.assertTrue(await self.session.ping())
        self.assertTrue(await self.session.ping())
        self.assertEqual(["udp_sess_new", "udp_sess_keep_alive"], self.methods())
        sent = self.lamp.received[-1]
        self.assertEqual(["keeplive_interval", 10], sent["params"])

    async def test_requests_are_paced_and_in_order(self):
        loop = asyncio.get_running_loop()
        start = loop.time()
        await asyncio.gather(*(self.session.request("set_bright", [n]) for n in range(6)))
        # 7 datagrams (the handshake + 6) at most 30 a second.
        self.assertGreaterEqual(loop.time() - start, 6 * udp.MIN_SEND_INTERVAL * 0.9)
        self.assertEqual(list(range(6)), [m["params"][0] for m in self.lamp.received[1:]])


if __name__ == "__main__":
    unittest.main()
