"""The integration's camera.py without Home Assistant: its imports stubbed,
for the tests (test_matrix_view) and the documentation screenshots
(card-docs-camera.py), which render images with the real camera code."""

import importlib
from pathlib import Path
import sys
import types

ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"


def import_pure_module(name: str) -> types.ModuleType:
    """An integration module, its relative imports working (the package is
    registered without running its __init__)."""
    if "yeelight_cube" not in sys.modules:
        package = types.ModuleType("yeelight_cube")
        package.__path__ = [str(ROOT)]
        sys.modules["yeelight_cube"] = package
    return importlib.import_module(f"yeelight_cube.{name}")


def load_camera_module():
    """camera.py with the Home Assistant modules it imports stubbed."""
    stubs = {}

    class Anything:
        def __init__(self, *args, **kwargs):
            pass

        def __call__(self, *args, **kwargs):
            return self

        def __getattr__(self, name):
            return Anything()

    for name in (
        "homeassistant", "homeassistant.components", "homeassistant.components.camera",
        "homeassistant.config_entries", "homeassistant.core", "homeassistant.helpers",
        "homeassistant.helpers.entity_platform", "homeassistant.util",
    ):
        if name not in sys.modules:
            stubs[name] = sys.modules[name] = types.ModuleType(name)
    sys.modules["homeassistant.components.camera"].Camera = getattr(
        sys.modules["homeassistant.components.camera"], "Camera", type("Camera", (), {})
    )
    sys.modules["homeassistant.config_entries"].ConfigEntry = object
    core = sys.modules["homeassistant.core"]
    core.HomeAssistant = getattr(core, "HomeAssistant", object)
    core.callback = getattr(core, "callback", lambda function: function)
    sys.modules["homeassistant.helpers.entity_platform"].AddEntitiesCallback = object
    sys.modules["homeassistant.util"].dt = getattr(sys.modules["homeassistant.util"], "dt", Anything())
    for name, attrs in (
        ("runtime_data", {"lamp_of": lambda entry: None}),
        ("entity", {"CubeDeviceEntity": type("CubeDeviceEntity", (), {})}),
    ):
        full = f"yeelight_cube.{name}"
        if full not in sys.modules:
            module = types.ModuleType(full)
            module.__dict__.update(attrs)
            stubs[full] = sys.modules[full] = module
    try:
        return import_pure_module("camera")
    finally:
        for name in stubs:
            sys.modules.pop(name, None)
        sys.modules.pop("yeelight_cube.camera", None)
