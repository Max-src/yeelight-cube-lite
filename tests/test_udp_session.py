"""The lamp's UDP command session (udp_session.UdpSession), against a fake
lamp that answers like the Cube Lite does (research notes, PROTOCOL.md §3-4):
a token from udp_sess_new, every command answered by its id except
update_leds, -1 for a token it does not know."""
import asyncio
import importlib.util
import json
import unittest

from tests.test_native_features import ROOT

_spec = importlib.util.spec_from_file_location("udp_session", ROOT / "udp_session.py")
udp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(udp)


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
