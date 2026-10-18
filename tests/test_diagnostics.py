"""The downloadable diagnostics (diagnostics.py): what they hold about a lamp,
and that its address, identifiers and displayed text never appear in them."""
import ast
import asyncio
import json
import time
import types
import unittest
from types import SimpleNamespace

from tests.test_native_features import CONSTANTS, ROOT, _load_standalone_functions

REDACTED = "**REDACTED**"
IP = "192.168.4.145"
DEVICE_ID = "0x0000000012fc02"


def async_redact_data(data, to_redact):
    """Home Assistant's: the values of these keys replaced, at every depth."""
    if isinstance(data, list):
        return [async_redact_data(item, to_redact) for item in data]
    if not isinstance(data, dict):
        return data
    return {
        key: REDACTED if key in to_redact else async_redact_data(value, to_redact)
        for key, value in data.items()
    }


def _load_diagnostics() -> dict:
    """diagnostics.py's functions and constants, without Home Assistant."""
    tree = ast.parse((ROOT / "diagnostics.py").read_text(encoding="utf-8"))
    body = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Assign))
    ]
    namespace = {
        "Any": object, "REDACTED": REDACTED, "async_redact_data": async_redact_data,
        "lamp_of": lambda entry: getattr(getattr(entry, "runtime_data", None), "light", None),
        **{name: CONSTANTS[name] for name in ("CONF_IP", "CONF_DEVICE_ID", "DOMAIN")},
    }
    exec(compile(ast.Module(body=body, type_ignores=[]), "<diagnostics>", "exec",
                 flags=__import__("__future__").annotations.compiler_flag), namespace)
    return namespace


DIAGNOSTICS = _load_diagnostics()


def _lamp():
    cube_matrix = SimpleNamespace(
        device_model="Cube Lite", firmware_version="17", device_id=DEVICE_ID,
        capabilities={"id": DEVICE_ID, "model": "cubelite", "fw_ver": "17", "name": "Desk"},
        connection_state=lambda: {"transport": "udp", "consecutive_failures": 0},
    )
    attributes = {
        "light_entity_id": "light.cubelite_192_168_4_145",
        "ip_address": IP,
        "mode": "Custom Draw",
        "custom_text": "Happy birthday Alex",
        "favourites": {"clock": [{"name": "Ocean Waves"}]},
        "last_command_error": {"message": f"Lamp {IP} refused it"},
        "matrix_colors": [(255, 0, 0), (0, 0, 0), (0, 9, 0)],
        "native_effect_catalog": [{"name": "Rainbow"}],
    }
    return SimpleNamespace(
        _cube_matrix=cube_matrix, _ip=IP, extra_state_attributes=attributes,
        available=True, _is_on=True, _brightness=128,
        _last_connection_error=f"Cannot reach {IP}:55443",
        _display_retry_count=0, _hard_timeout_times=[], _hardware_operation_phase=None,
    )


def _diagnostics(light):
    entry = SimpleNamespace(
        entry_id="abc", title=f"Yeelight Cube ({IP})", unique_id=DEVICE_ID,
        data={CONSTANTS["CONF_IP"]: IP, CONSTANTS["CONF_DEVICE_ID"]: DEVICE_ID},
        options={"extended_effects_enabled": True},
        runtime_data=SimpleNamespace(active_ip=IP, light=light),
    )
    hass = SimpleNamespace(data={CONSTANTS["DOMAIN"]: {
        "pixel_arts": [{}, {}], "palettes_v2": [{}],
    }})
    return asyncio.run(DIAGNOSTICS["async_get_config_entry_diagnostics"](hass, entry))


class DiagnosticsTests(unittest.TestCase):
    def test_a_lamp_s_diagnostics(self):
        result = _diagnostics(_lamp())
        lamp = result["lamp"]
        self.assertEqual({"model": "Cube Lite", "firmware": "17", "capabilities": {
            "id": REDACTED, "model": "cubelite", "fw_ver": "17", "name": REDACTED,
        }}, lamp["device"])
        self.assertEqual((True, True, 128), (lamp["available"], lamp["is_on"], lamp["brightness"]))
        self.assertEqual("udp", lamp["connection"]["transport"])
        self.assertEqual("Custom Draw", lamp["state"]["mode"])
        # The frame as its lit pixel count; the catalog left out.
        self.assertEqual(2, lamp["state"]["matrix_lit_pixels"])
        self.assertNotIn("matrix_colors", lamp["state"])
        self.assertNotIn("native_effect_catalog", lamp["state"])
        # Style names are kept (only the lamp's own name is redacted).
        self.assertEqual("Ocean Waves", lamp["state"]["favourites"]["clock"][0]["name"])
        self.assertEqual({"palettes_v2": 1, "pixel_arts": 2, "clock_presets": 0},
                         result["collections"])
        self.assertEqual({"extended_effects_enabled": True}, result["entry"]["options"])

    def test_the_address_identifier_and_text_never_appear(self):
        text = json.dumps(_diagnostics(_lamp()))
        for secret in (IP, IP.replace(".", "_"), DEVICE_ID, "Happy birthday", "Desk"):
            self.assertNotIn(secret, text)
        # Inside texts too: the entry title, entity id and error messages.
        result = _diagnostics(_lamp())
        self.assertEqual(f"Yeelight Cube ({REDACTED})", result["entry"]["title"])
        self.assertEqual(f"light.cubelite_{REDACTED}", result["lamp"]["state"]["light_entity_id"])
        self.assertEqual(f"Cannot reach {REDACTED}:55443",
                         result["lamp"]["connection"]["last_connection_error"])

    def test_a_lamp_not_set_up_yet(self):
        result = _diagnostics(None)
        self.assertIsNone(result["lamp"])
        self.assertNotIn(IP, json.dumps(result))


class ConnectionStateTests(unittest.TestCase):
    """One source for the connection's state: the diagnostics and the logs'
    summary (cube_matrix.connection_state, state_summary)."""

    def test_the_log_summary_shows_the_connection_state(self):
        fns = _load_standalone_functions(
            (ROOT / "cube_matrix.py").read_text(encoding="utf-8"),
            {"connection_state", "state_summary"}, {"time": time},
        )
        cube = SimpleNamespace(
            _ip=IP, transport="udp", _udp=SimpleNamespace(sessions_opened=2),
            _fast_socket=None, _fast_socket_time=0.0, _consecutive_failures=1,
            _reconnect_cooldown=5.0, _device_unreachable=False, _connection_healthy=True,
            _just_reconnected=False, _last_reconnect_attempt=0, _last_success_time=time.time() - 3,
            _total_commands_sent=42, _udp_failing_since=0.0, _tcp_forced_until=0.0,
        )
        cube.connection_state = types.MethodType(fns["connection_state"], cube)
        state = cube.connection_state()
        self.assertEqual("udp", state["transport"])
        self.assertIsNone(state["tcp_socket_age"])  # no TCP socket open
        self.assertIsNone(state["since_reconnect_attempt"])  # never
        self.assertAlmostEqual(3, state["since_success"], delta=1)
        self.assertIsNone(state["udp_failing_for"])  # UDP works (issues.py)
        summary = fns["state_summary"](cube)
        self.assertTrue(summary.startswith(f"ip={IP}, transport=udp, udp_sessions_opened=2"))
        self.assertIn("commands_sent=42", summary)


if __name__ == "__main__":
    unittest.main()
