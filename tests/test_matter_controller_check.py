"""Whether a Cube Lite's LED part answers, asked over Matter
(light_matrix.matter_controller_check), after a streamed lamp left a LAN
check unanswered (light_studio._stream_probe).

2026-11-16 night: getPersistEffectList over Matter answered within ~0.25 s
on a working lamp, "Failure" within ~0.6 s on a stuck one."""

import asyncio
import types
import unittest

import fakes
from fakes import FakeEntry, FakeHass, make_light, module, run

fakes.install_stubs()
MATRIX = module("light_matrix")


class Server:
    """Home Assistant's Matter server, delivering Yeelight commands."""

    backend = "matter"

    def __init__(self, behaviour="ok"):
        self.sent = []
        self.behaviour = behaviour

    async def async_command(self, cluster, name, payload, endpoint_id=None):
        self.sent.append(name)
        if self.behaviour == "failure":
            raise RuntimeError("Failure (code 1)")
        if self.behaviour == "silent":
            await asyncio.sleep(10)
        return {"effectList": []}


def lite(server):
    light = make_light(hass=FakeHass(), entry=FakeEntry())
    light._matter = types.SimpleNamespace(linked=True, values={})
    light._matter_commands = server
    return light


class ControllerCheckTests(unittest.TestCase):
    def verdict(self, behaviour):
        light = lite(Server(behaviour))
        MATRIX.CONTROLLER_CHECK_TIMEOUT, before = 0.05, MATRIX.CONTROLLER_CHECK_TIMEOUT
        try:
            return run(light.matter_controller_check()), light._matter_commands.sent
        finally:
            MATRIX.CONTROLLER_CHECK_TIMEOUT = before

    def test_the_three_answers(self):
        self.assertEqual(("answers", ["getPersistEffectList"]), self.verdict("ok"))
        self.assertEqual("stuck", self.verdict("failure")[0])
        self.assertEqual("no answer", self.verdict("silent")[0])

    def test_none_without_matter(self):
        light = lite(Server())
        light._matter.linked = False
        self.assertIsNone(run(light.matter_controller_check()))


class LiteRouteTests(unittest.TestCase):
    """A Cube Lite draws over the LAN only, linked to Matter or not."""

    def test_a_linked_lite_does_not_stream_over_matter(self):
        light = lite(Server())
        self.assertFalse(light.draws_over_matter())
        self.assertFalse(light.matrix_streams_over_matter())
        self.assertFalse(light._retry_matrix_native(link_back=True))


if __name__ == "__main__":
    unittest.main()
