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

    def test_setup_and_recovery_share_it(self):
        init = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("await check_tcp(ip_address, port, probe_timeout)", init)
        self.assertNotIn("socket.socket(", init)
        self.assertIn("await check_tcp(self._ip, self._port, timeout)", CUBE_MATRIX_SOURCE)


if __name__ == "__main__":
    unittest.main()
