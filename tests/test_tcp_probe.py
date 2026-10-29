"""The shared reachability probe (cube_matrix.check_tcp): setup and recovery."""
import asyncio
import socket
import struct
import unittest

from tests.test_native_features import ROOT, _load_standalone_functions

CUBE_MATRIX_SOURCE = (ROOT / "cube_matrix.py").read_text(encoding="utf-8")


class TcpProbeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.check_tcp = _load_standalone_functions(
            CUBE_MATRIX_SOURCE,
            {"check_tcp"},
            {
                "asyncio": asyncio,
                "socket": socket,
                "_RST_LINGER": struct.pack("ii", 1, 0),
            },
        )["check_tcp"]

    async def test_a_listening_lamp_passes(self):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        try:
            await self.check_tcp("127.0.0.1", server.getsockname()[1], 1.0)
        finally:
            server.close()

    async def test_a_closed_port_raises(self):
        # A port that was just free: nothing listens there.
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        with self.assertRaises(OSError):
            await self.check_tcp("127.0.0.1", port, 1.0)

    def test_adding_setup_and_recovery_share_it(self):
        init = (ROOT / "__init__.py").read_text(encoding="utf-8")
        flow = (ROOT / "config_flow.py").read_text(encoding="utf-8")
        self.assertIn("await check_tcp(ip_address, port, PROBE_TIMEOUT)", init)
        self.assertIn("await check_tcp(ip_address, LAN_PORT, PROBE_TIMEOUT)", flow)
        self.assertNotIn("socket.socket(", init + flow)
        self.assertIn("await check_tcp(self._ip, self._port, timeout)", CUBE_MATRIX_SOURCE)


class OutageLogLevelTests(unittest.TestCase):
    def test_the_first_failure_warns_then_the_outage_is_quiet(self):
        import logging
        from types import SimpleNamespace

        level = _load_standalone_functions(
            CUBE_MATRIX_SOURCE, {"outage_log_level"}, {"logging": logging}
        )["outage_log_level"]
        self.assertEqual(level(SimpleNamespace(_device_unreachable=False)), logging.WARNING)
        self.assertEqual(level(SimpleNamespace(_device_unreachable=True)), logging.DEBUG)


if __name__ == "__main__":
    unittest.main()


class SendOnceTests(unittest.IsolatedAsyncioTestCase):
    """One LAN command to a lamp not set up yet (the setup's Fire check)."""

    def setUp(self):
        import json

        self.send_once = _load_standalone_functions(
            CUBE_MATRIX_SOURCE,
            {"send_once"},
            {"asyncio": asyncio, "socket": socket, "json": json, "_RST_LINGER": struct.pack("ii", 1, 0)},
        )["send_once"]

    async def lamp(self, *replies):
        """A lamp that answers each command with ``replies`` (raw lines)."""
        received = []

        async def handle(reader, writer):
            received.append(await reader.readline())
            for reply in replies:
                writer.write(reply)
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        self.addAsyncCleanup(self.close, server)
        return server.sockets[0].getsockname()[1], received

    @staticmethod
    async def close(server):
        server.close()
        await server.wait_closed()

    async def test_the_answer_comes_after_a_notification(self):
        port, received = await self.lamp(
            b'{"method":"props","params":{"power":"on"}}\r\n', b'{"id":1,"result":["ok"]}\r\n'
        )
        await self.send_once("127.0.0.1", port, "set_fx_effect", [34, 0, 4, {"mode": 34}], 2.0)
        self.assertEqual(
            b'{"id":1,"method":"set_fx_effect","params":[34,0,4,{"mode":34}]}\r\n', received[0]
        )

    async def test_a_refusal_or_no_answer_raises(self):
        port, _ = await self.lamp(b'{"id":1,"error":{"code":-1,"message":"refused"}}\r\n')
        with self.assertRaises(OSError):
            await self.send_once("127.0.0.1", port, "set_fx_effect", [], 2.0)
        port, _ = await self.lamp()  # closes without answering
        with self.assertRaises(OSError):
            await self.send_once("127.0.0.1", port, "set_fx_effect", [], 2.0)
