"""Every function the integration hands to a Home Assistant timer or event
listener must run on the event loop: an ``async def`` or a ``@callback``.

Home Assistant runs any other plain function in a worker thread, where
``async_write_ha_state()`` and most ``hass`` calls are not allowed (HA logs
"calls async_write_ha_state from a thread other than the event loop").
"""
import ast
import unittest

from tests.test_native_features import ROOT

# Registration helper -> position of its callback argument.
_CALLBACK_ARG = {
    "async_track_time_interval": 1,
    "async_call_later": 2,
    "async_track_point_in_time": 1,
    "async_track_point_in_utc_time": 1,
    "async_track_state_change_event": 2,
    "async_listen": 1,
    "async_listen_once": 1,
}
_LOOP_DECORATORS = {"callback", "ha_callback"}


def _name(node):
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    return None


class EventLoopCallbackTests(unittest.TestCase):
    def test_timer_and_listener_callbacks_run_on_the_event_loop(self):
        checked = 0
        for path in sorted(ROOT.glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            functions = {}
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions.setdefault(node.name, []).append(node)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                index = _CALLBACK_ARG.get(_name(node.func))
                if index is None or len(node.args) <= index:
                    continue
                target = _name(node.args[index])
                for definition in functions.get(target, []):
                    checked += 1
                    on_loop = isinstance(definition, ast.AsyncFunctionDef) or any(
                        _name(d) in _LOOP_DECORATORS for d in definition.decorator_list
                    )
                    self.assertTrue(
                        on_loop,
                        f"{path.name}:{definition.lineno} {target}() is passed to "
                        f"{_name(node.func)} but is neither async nor @callback, "
                        "so Home Assistant runs it in a worker thread",
                    )
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main()
