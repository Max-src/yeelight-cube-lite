"""The Cube Matrix's music-mode channel (music_channel.py), against a fake
lamp on this host: set_music makes it connect back, then what is written
there arrives; reads go over TCP and get the lamp's answer."""

import asyncio
import json
import sys
import types
import unittest

from tests.test_native_features import ROOT


def _load():
    package = types.ModuleType("yeelight_cube_music_test")
    package.__path__ = [str(ROOT)]
    sys.modules.setdefault(package.__name__, package)
    import importlib
    return importlib.import_module(f"{package.__name__}.music_channel")


MUSIC = _load()


class FakeLamp:
    """Answers TCP commands; on set_music connects back and records lines."""

    def __init__(self, connect_back=True):
        self.connect_back = connect_back
        self.music_lines = []
        self.tcp_methods = []
        self.server = None
        self.port = None

    async def start(self):
        self.server = await asyncio.start_server(self._client, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def _client(self, reader, writer):
        line = await reader.readline()
        message = json.loads(line)
        self.tcp_methods.append(message["method"])
        if message["method"] == "set_music":
            writer.write(b'{"id":1,"result":["ok"]}\r\n')
            await writer.drain()
            if self.connect_back:
                _, host, port = message["params"]
                asyncio.get_running_loop().create_task(self._music(host, port))
        elif message["method"] == "get_prop":
            writer.write(b'{"method":"props","params":{"power":"on"}}\r\n')
            writer.write(b'{"id":1,"result":["on"]}\r\n')
            await writer.drain()
        else:  # the lamp's malformed error line
            writer.write(b'{"id":1,"error":{"code":1, "message":invalid params}}\r\n')
            await writer.drain()
        writer.close()

    async def _music(self, host, port):
        reader, writer = await asyncio.open_connection(host, port)
        while line := await reader.readline():
            self.music_lines.append(json.loads(line))
        writer.close()


def run(coro):
    return asyncio.run(coro)


class MusicChannelTests(unittest.TestCase):
    def setUp(self):
        self._address = MUSIC.local_address_for
        MUSIC.local_address_for = lambda ip: "127.0.0.1"

    def tearDown(self):
        MUSIC.local_address_for = self._address

    def test_commands_and_frames_go_on_the_connection_the_lamp_opens(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            channel.session_setup = [("activate_fx_mode", [{"mode": "direct"}])]
            self.assertEqual(await channel.request("set_bright", [50]), {"result": ["ok"]})
            self.assertIsNone(await channel.request("update_leds", ["AAAA"]))
            await asyncio.sleep(0.1)
            self.assertTrue(channel.is_open)
            self.assertEqual(channel.sessions_opened, 1)
            channel.close(); lamp.server.close()
            return lamp
        lamp = run(scenario())
        self.assertEqual(lamp.tcp_methods, ["set_music"])
        # What every new connection holds first (direct mode), then the commands.
        self.assertEqual([line["method"] for line in lamp.music_lines],
                         ["activate_fx_mode", "set_bright", "update_leds"])

    def test_reads_get_the_lamps_answer_over_tcp(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            answer = await channel.request("get_prop", ["power"])
            lamp.server.close()
            return answer, lamp
        answer, lamp = run(scenario())
        self.assertEqual(answer, {"id": 1, "result": ["on"]})  # past the "props" notification
        self.assertEqual(lamp.tcp_methods, ["get_prop"])

    def test_a_malformed_error_line_is_an_error(self):
        async def scenario():
            lamp = FakeLamp(); await lamp.start()
            answer = await MUSIC.tcp_request("127.0.0.1", "set_ps", [], lamp.port)
            lamp.server.close()
            return answer
        self.assertIn("error", run(scenario()))

    def test_a_lamp_that_does_not_connect_back_is_unavailable(self):
        async def scenario():
            lamp = FakeLamp(connect_back=False); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            MUSIC.CONNECT_BACK_TIMEOUT, saved = 0.2, MUSIC.CONNECT_BACK_TIMEOUT
            try:
                with self.assertRaises(MUSIC.UdpUnavailable):
                    await channel.request("update_leds", ["AAAA"])
                self.assertFalse(await channel.ping())
            finally:
                MUSIC.CONNECT_BACK_TIMEOUT = saved
                lamp.server.close()
        run(scenario())

    def test_closed_while_opening_is_a_failure_not_a_cancellation(self):
        # Closed (close_music_session) while a frame waits for the lamp to
        # connect back: the frame's sender gets UdpUnavailable, as for any
        # failure. A cancellation ended the stream for good.
        async def scenario():
            lamp = FakeLamp(connect_back=False); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            try:
                frame = asyncio.get_running_loop().create_task(channel.request("update_leds", ["AAAA"]))
                await asyncio.sleep(0.2)  # set_music sent, waiting for the connect-back
                channel.close()
                with self.assertRaises(MUSIC.UdpUnavailable):
                    await frame
                self.assertIsNone(channel._server)
            finally:
                lamp.server.close()
        run(scenario())

    def test_a_cancelled_opening_stops_listening(self):
        async def scenario():
            lamp = FakeLamp(connect_back=False); await lamp.start()
            channel = MUSIC.MusicChannel("127.0.0.1", lamp.port)
            try:
                frame = asyncio.get_running_loop().create_task(channel.request("update_leds", ["AAAA"]))
                await asyncio.sleep(0.2)
                frame.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await frame
                self.assertIsNone(channel._server)  # a late connect-back finds nobody listening
            finally:
                lamp.server.close()
        run(scenario())


class StrideTests(unittest.TestCase):
    def test_a_slow_lamp_gets_every_nth_render(self):
        source = (ROOT / "light_studio.py").read_text(encoding="utf-8")
        self.assertIn("def studio_stride(max_fps)", source)
        namespace = {"STUDIO_FPS": 25}
        start = source.index("def studio_stride(max_fps)")
        exec(source[start:source.index("\ndef ", start + 1)], namespace)
        stride = namespace["studio_stride"]
        self.assertEqual(stride(None), 1)   # Cube Lite: every render
        self.assertEqual(stride(6), 5)      # Cube Matrix: 5 frames a second
        self.assertEqual(stride(25), 1)


if __name__ == "__main__":
    unittest.main()
