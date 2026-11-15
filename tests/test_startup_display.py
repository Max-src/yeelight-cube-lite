"""Adding the light never waits for the lamp: its restored display is drawn
in the background (a lamp accepting connections but answering nothing held
a Cube Matrix entry's setup past Home Assistant's 60 s, and it did not load)."""

import asyncio
import types
import unittest
from unittest.mock import Mock

from tests.test_native_features import ROOT, _function_source, _load_standalone_functions

SOURCE = (ROOT / "light_lifecycle.py").read_text(encoding="utf-8")


class StartupDisplayTests(unittest.TestCase):
    def test_adding_the_light_does_not_wait_for_the_lamp(self):
        added = _function_source(SOURCE, "async_added_to_hass")
        self.assertNotIn("await self.async_apply_display_mode", added)
        self.assertNotIn("await self._async_resume_saved_rotation", added)
        self.assertIn("self._async_start_display(draw)", added)

    def run_start(self, draw, rotation, fails=False):
        order = []

        async def apply(self, update_type):
            order.append(("draw", update_type))
            if fails:
                raise TimeoutError("the lamp answers nothing")

        async def resume(self):
            order.append(("rotation",))

        start = _load_standalone_functions(SOURCE, {"_async_start_display"}, {"_LOGGER": Mock()})[
            "_async_start_display"
        ]
        light = types.SimpleNamespace(_ip="test", _rotation_restore=rotation)
        light.async_apply_display_mode = types.MethodType(apply, light)
        light._async_resume_saved_rotation = types.MethodType(resume, light)
        asyncio.run(types.MethodType(start, light)(draw))
        return order

    def test_the_display_then_the_rotation(self):
        self.assertEqual([("draw", "turn_on"), ("rotation",)], self.run_start(True, True))
        self.assertEqual([("rotation",)], self.run_start(False, True))
        self.assertEqual([("draw", "turn_on")], self.run_start(True, False))

    def test_a_lamp_that_fails_still_gets_its_rotation(self):
        self.assertEqual([("draw", "turn_on"), ("rotation",)], self.run_start(True, True, fails=True))


if __name__ == "__main__":
    unittest.main()
