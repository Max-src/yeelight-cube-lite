"""Shared test doubles: the integration's real modules without Home Assistant.

The tests run without Home Assistant, voluptuous or python-yeelight
installed. `install_stubs()` registers stand-ins for them (idempotent), so
the integration's own modules import as they are, light.py included:

- `module(name)`: an integration module (`module("light_matrix")`), the same
  module object for every test (patching its globals reaches the light).
- `make_light(**overrides)`: a real `YeelightCubeLight`, built by its own
  `__init__` on a `FakeCube` and a `FakeEntry`, every mixin method bound;
  keyword arguments set attributes afterwards (`make_light(_mode="Clock")`;
  `make_light(device_profile=...)` replaces a property on this light only).
- `FakeCube`: the LampClient the light drives, recording what it is asked.
- `FakeEntry`, `FakeHass`: a config entry and the hass object.
- `light_state(**attrs)`: a stand-in light (a namespace) with the light's
  state transitions and public API, for code run on its own.
- `functions(source, names, namespace)`: chosen functions of a source text
  run on their own, for code the real modules cannot reach.
- `lamp_client_source()`: the lamp client's modules' source, joined.

Quick runs: the environment variable YC_QUICK=1 skips the exhaustive tests
marked `@slow` (every effect in every mode and the like); the full suite
(and CI) runs them.
"""

from __future__ import annotations

import __future__ as _future
import ast
import asyncio
import atexit
import contextlib
import functools
import importlib
import json
import os
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
# The lamp client (lamp_client.LampClient, its mixins and what they share).
LAMP_CLIENT_FILES = (
    "lamp_protocol.py", "lamp_client.py", "lamp_client_udp.py", "lamp_client_tcp.py",
    "lamp_client_bulb.py", "lamp_client_health.py",
)
QUICK = os.environ.get("YC_QUICK") == "1"


def slow(test):
    """Skips an exhaustive test (or test class) when YC_QUICK=1."""
    return unittest.skipIf(QUICK, "YC_QUICK=1: exhaustive test skipped")(test)


# ── Home Assistant, voluptuous and python-yeelight stand-ins ────────────────


class _StubMeta(type):
    """A stand-in class: its unknown class attributes are named stand-ins
    (ColorMode.RGB is "ColorMode.RGB"), so module-level code runs."""

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return f"{cls.__name__}.{name}"


class _Stub(metaclass=_StubMeta):
    """Any Home Assistant class or helper: built with any arguments, its
    unknown attributes are callables returning another stand-in; used as a
    decorator, it returns the function decorated."""

    def __init__(self, *args, **kwargs):
        self._stub_args = args

    def __call__(self, *args, **kwargs):
        if len(args) == 1 and callable(args[0]) and not kwargs:
            return args[0]
        return _Stub()

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _Stub()


class _StubModule(types.ModuleType):
    """A Home Assistant module: each unknown name is its own stand-in class
    (so `class X(SelectEntity, RestoreEntity)` has two distinct bases)."""

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        stub = _StubMeta(name, (_Stub,), {"__module__": self.__name__})
        setattr(self, name, stub)
        return stub


class HomeAssistantError(Exception):
    """homeassistant.exceptions.HomeAssistantError, with its translation."""

    def __init__(self, *args, translation_domain=None, translation_key=None,
                 translation_placeholders=None, **kwargs):
        super().__init__(*args)
        self.translation_domain = translation_domain
        self.translation_key = translation_key
        self.translation_placeholders = translation_placeholders or {}


class ServiceValidationError(HomeAssistantError):
    pass


class ConfigEntryNotReady(HomeAssistantError):
    pass


class BulbException(Exception):
    """python-yeelight's BulbException."""


class _Bulb:
    """python-yeelight's Bulb: never connects (the tests give LampClient a
    lamp of their own)."""

    def __init__(self, *args, **kwargs):
        self._timeout = 1

    def send_command(self, method, params):
        raise BulbException("no lamp in the tests")


class _ExtraStoredData:
    """homeassistant.helpers.restore_state.ExtraStoredData."""


class Entity:
    """homeassistant.helpers.entity.Entity (LightEntity, RestoreEntity): the
    state writes are counted, nothing is published."""

    hass = None
    entity_id = None
    platform = None
    state_writes = 0

    def async_write_ha_state(self):
        self.state_writes += 1

    def async_schedule_update_ha_state(self, force_refresh=False):
        self.state_writes += 1

    def async_on_remove(self, func):
        self.__dict__.setdefault("on_remove", []).append(func)

    async def async_added_to_hass(self):
        pass

    async def async_will_remove_from_hass(self):
        pass

    async def async_get_last_state(self):
        return None

    async def async_get_last_extra_data(self):
        return None


class LightEntity(Entity):
    pass


class RestoreEntity(Entity):
    pass


def _now():
    return datetime.now(timezone.utc).astimezone()


_DT = types.SimpleNamespace(
    now=_now, utcnow=lambda: datetime.now(timezone.utc), as_local=lambda value: value.astimezone(),
    get_default_time_zone=lambda: _now().tzinfo, DEFAULT_TIME_ZONE=_now().tzinfo,
)

_STUB_MODULES = (
    "homeassistant", "homeassistant.components", "homeassistant.components.binary_sensor",
    "homeassistant.components.button", "homeassistant.components.camera",
    "homeassistant.components.diagnostics", "homeassistant.components.event",
    "homeassistant.components.frontend", "homeassistant.components.light",
    "homeassistant.components.number", "homeassistant.components.select",
    "homeassistant.components.sensor", "homeassistant.components.switch",
    "homeassistant.components.text", "homeassistant.components.websocket_api",
    "homeassistant.config_entries", "homeassistant.const", "homeassistant.core",
    "homeassistant.exceptions", "homeassistant.helpers",
    "homeassistant.helpers.config_validation", "homeassistant.helpers.device_registry",
    "homeassistant.helpers.discovery_flow", "homeassistant.helpers.entity",
    "homeassistant.helpers.entity_platform", "homeassistant.helpers.entity_registry",
    "homeassistant.helpers.event", "homeassistant.helpers.issue_registry",
    "homeassistant.helpers.restore_state", "homeassistant.helpers.selector",
    "homeassistant.helpers.service_info", "homeassistant.helpers.service_info.zeroconf",
    "homeassistant.helpers.storage", "homeassistant.helpers.typing", "homeassistant.util",
    "voluptuous",
)


def install_stubs() -> None:
    """Registers the stand-ins (idempotent; modules already there are kept)."""
    for name in _STUB_MODULES:
        if name not in sys.modules:
            sys.modules[name] = _StubModule(name)
        parent, _, child = name.rpartition(".")
        if parent:
            setattr(sys.modules[parent], child, sys.modules[name])
    sys.modules["homeassistant.core"].__dict__.setdefault("callback", lambda function: function)
    exceptions = sys.modules["homeassistant.exceptions"].__dict__
    for error in (HomeAssistantError, ServiceValidationError, ConfigEntryNotReady):
        exceptions.setdefault(error.__name__, error)
    for name in ("Unauthorized", "UnknownUser"):
        exceptions.setdefault(name, type(name, (HomeAssistantError,), {}))
    restore = sys.modules["homeassistant.helpers.restore_state"].__dict__
    restore.setdefault("ExtraStoredData", _ExtraStoredData)
    restore.setdefault("RestoreEntity", RestoreEntity)
    sys.modules["homeassistant.helpers.entity"].__dict__.setdefault("Entity", Entity)
    sys.modules["homeassistant.components.light"].__dict__.setdefault("LightEntity", LightEntity)
    sys.modules["homeassistant.util"].__dict__.setdefault("dt", _DT)
    if "yeelight" not in sys.modules:
        sys.modules["yeelight"] = types.SimpleNamespace(Bulb=_Bulb, BulbException=BulbException)


def lamp_client_source() -> str:
    """The lamp client's source (LAMP_CLIENT_FILES) joined, for the checks
    that read it or take functions from it."""
    return "\n\n".join((ROOT / name).read_text(encoding="utf-8") for name in LAMP_CLIENT_FILES)


def module(name: str) -> types.ModuleType:
    """An integration module, its relative imports working (the package is
    registered without running its __init__), Home Assistant stubbed."""
    install_stubs()
    if "yeelight_cube" not in sys.modules:
        package = types.ModuleType("yeelight_cube")
        package.__path__ = [str(ROOT)]
        sys.modules["yeelight_cube"] = package
    if name.startswith("light_services") or name == "__init__":
        importlib.import_module("yeelight_cube.light")  # they import each other: the light first
    return importlib.import_module(f"yeelight_cube.{name}")


# ── The light and what it drives ────────────────────────────────────────────


class FakeCube:
    """The LampClient connection the light drives (lamp_client.LampClient):
    a reachable lamp's state, every command recorded in `sent` as (how,
    method, params) and never sent. `reply` is what query_raw_command and
    send_command_with_recovery answer."""

    def __init__(self, profile=None, **attributes):
        self.profile = profile or module("device_profile").CUBE_LITE_PROFILE
        self.device_name = "Yeelight Cube Lite"
        self.device_model = "Cube Lite"
        self.software_version = None
        self.device_id = None
        self.capabilities = {}
        self.transport = "udp"
        self.is_unreachable = False
        self.consecutive_failures = 0
        self.reconnect_cooldown = 30
        self.last_success_time = 0.0
        self.last_command_time = 0.0
        self.silent_for = 0.0
        self.summary = ""
        self.running_effect = None
        self.streams_running = False
        self.fx_mode_flag_maybe_set = False
        self.on_transport_change = None
        self.on_stream_change = None
        self.stream_silent = False
        self.reconnected = False
        self.reply = {"id": 1, "result": ["ok"]}
        self.sent = []
        self.__dict__.update(attributes)

    def methods(self, how=None):
        """The methods sent, in order (only those sent `how`, if given)."""
        return [method for kind, method, _ in self.sent if how in (None, kind)]

    def params(self, method):
        """The parameters of the last `method` sent."""
        return next(params for _, sent, params in reversed(self.sent) if sent == method)

    async def send_raw_command(self, method, params, *args, **kwargs):
        self.sent.append(("raw", method, params))

    async def send_command_fast(self, method, params=None):
        self.sent.append(("fast", method, params))
        return True

    async def draw_matrices_fast(self, rgb_data):
        self.sent.append(("fast", "update_leds", [rgb_data]))
        return True

    async def send_command_with_recovery(self, method, params=None):
        self.sent.append(("recovery", method, params))
        return self.reply

    async def query_raw_command(self, method, params, *args, **kwargs):
        self.sent.append(("query", method, params))
        return self.reply

    async def clear_fx_mode_flag(self):
        return False

    async def probe(self, timeout=None, *, answering=False):
        return not self.is_unreachable

    def note_running_effect(self, params):
        self.running_effect = params

    def forget_running_effect(self):
        self.running_effect = None

    def stream_running(self, owner, running):
        self.streams_running = running

    def close_music_session(self):
        return False

    def close_fast_socket(self):
        pass

    def close_command_socket(self):
        pass

    def close(self):
        pass

    def force_tcp(self, seconds):
        self.transport = "tcp"

    def is_connected(self):
        return not self.is_unreachable

    def record_success(self):
        self.consecutive_failures = 0

    def record_failure(self):
        self.consecutive_failures += 1

    def mark_unreachable(self):
        was_reachable = not self.is_unreachable
        self.is_unreachable = True
        return was_reachable

    def mark_recovered(self):
        self.is_unreachable = False
        self.consecutive_failures = 0

    def consume_reconnected_flag(self):
        reconnected, self.reconnected = self.reconnected, False
        return reconnected

    def outage_log_level(self):
        return 30

    def connection_state(self):
        return {"transport": self.transport, "unreachable": self.is_unreachable}

    def state_summary(self):
        return ""

    def set_model(self, model, support=None):
        self.device_model = model


class FakeEntry:
    """A config entry: its id, data and options."""

    def __init__(self, entry_id="entry-1", data=None, options=None, title="Cube"):
        self.entry_id = entry_id
        self.data = {"ip": "192.0.2.10", **(data or {})}
        self.options = dict(options or {})
        self.title = title
        self.unique_id = entry_id
        self.runtime_data = None


class FakeHass:
    """Home Assistant: its data; the actions registered and called, the
    events fired and the config entry updates recorded; executor jobs run in
    line; tasks created on the running loop."""

    def __init__(self, data=None, entries=()):
        self.data = data if data is not None else {}
        self.registered = {}
        self.calls = []
        self.events = []
        self.updates = []
        self.entries = list(entries)
        hass = self
        self.services = types.SimpleNamespace(
            async_register=lambda domain, name, handler, *a, **k: hass.registered.__setitem__(
                (domain, name), handler),
            async_call=self._async_call,
            has_service=lambda domain, name: (domain, name) in hass.registered,
        )
        self.bus = types.SimpleNamespace(
            async_fire=lambda event, data=None, **k: hass.events.append((event, data)),
            async_listen=lambda *a, **k: (lambda: None),
            async_listen_once=lambda *a, **k: (lambda: None),
        )
        self.config_entries = types.SimpleNamespace(
            async_update_entry=self._async_update_entry,
            async_entries=lambda domain=None: list(hass.entries),
            async_get_entry=lambda entry_id: next(
                (entry for entry in hass.entries if entry.entry_id == entry_id), None),
            async_reload=self._async_reload,
            async_loaded_entries=lambda domain=None: [],
        )
        self.states = types.SimpleNamespace(get=lambda entity_id: None, async_all=lambda *a: [])
        self.config = types.SimpleNamespace(time_zone="UTC", path=lambda *parts: "/".join(parts))

    @property
    def loop(self):
        return asyncio.get_running_loop()

    async def _async_call(self, domain, service, data=None, blocking=False, **kwargs):
        self.calls.append((domain, service, data))

    async def _async_reload(self, entry_id):
        self.calls.append(("config_entries", "reload", entry_id))
        return True

    def _async_update_entry(self, entry, **changes):
        self.updates.append((entry, changes))
        for name, value in changes.items():
            setattr(entry, name, value)
        return True

    async def async_add_executor_job(self, function, *args):
        return function(*args)

    def async_create_task(self, coro, name=None, eager_start=False):
        return asyncio.get_running_loop().create_task(coro, name=name)

    def async_create_background_task(self, coro, name=None, eager_start=False):
        return asyncio.get_running_loop().create_task(coro, name=name)


def make_light(*, cube=None, entry=None, hass=None, profile=None, **overrides):
    """A real light (light.YeelightCubeLight), built by its own __init__.

    `cube` (a FakeCube of `profile` by default), `entry` (a FakeEntry) and
    `hass` (None: not added to Home Assistant) are what it is built on;
    every other keyword sets an attribute afterwards. A keyword naming one
    of the class's properties (`device_profile=...`) replaces it on this
    light only; a method given this way replaces the real one."""
    light_class = module("light").YeelightCubeLight
    properties = {
        name: value for name, value in overrides.items()
        if isinstance(getattr(light_class, name, None), property)
    }
    if properties:
        light_class = type("FakeLight", (light_class,), {
            name: property(lambda self, _value=value: _value) for name, value in properties.items()
        })
    light = light_class(cube or FakeCube(profile), "192.0.2.10", entry or FakeEntry())
    light.hass = hass
    for name, value in overrides.items():
        if name not in properties:
            setattr(light, name, value)
    return light


_RUNNER = None


def light_state(**attrs):
    """A stand-in light for code run on its own (``functions``): the state
    every mixin starts the light with (its _init_*_state), then the
    attributes given, with the light's state transitions, listeners and
    public API (light_state.LightStateMixin, light_actions.ActionsMixin)
    working on them."""
    state, actions = module("light_state"), module("light_actions")

    class LightState(types.SimpleNamespace, state.LightStateMixin, actions.ActionsMixin):
        is_on = property(lambda self: self._is_on)
        brightness = property(lambda self: self._brightness)
        # As the light reads them (light.py, light_mount_profile): a Cube
        # Lite's geometry, the clock not turned (set on the instance to change).
        device_profile = property(
            lambda self: vars(self).get("_given_profile")
            or getattr(self._lamp_client, "profile", None) or profiles.CUBE_LITE_PROFILE,
            lambda self, profile: setattr(self, "_given_profile", profile),
        )
        lamp_turns_clock = False

        def keeps_streaming_when_off(self):
            """Nothing streams from a stand-in (light_studio's standby)."""
            return False

    profiles = module("device_profile")
    light = LightState()
    # As YeelightCubeLight.__init__ starts it.
    light._is_on, light._brightness = True, 255
    # Every attribute the real light starts with (each mixin's
    # _init_*_state), then the ones given.
    lamp_class = module("light").YeelightCubeLight
    light._lamp_client = attrs.get("_lamp_client") or FakeCube()
    for name in sorted(dir(lamp_class)):
        if name.startswith("_init_") and name.endswith("_state"):
            getattr(lamp_class, name)(light)
    light.entity_id = "light.cube"
    for key, value in attrs.items():
        setattr(light, key, value)
    return light


def run(coro):
    """Runs a coroutine to its end on one event loop kept for the tests (on
    Windows each new loop opens a socket pair: thousands of asyncio.run
    calls cost seconds). Tasks it leaves running stay on that loop."""
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = asyncio.Runner()
        atexit.register(_RUNNER.close)
    return _RUNNER.run(coro)


_REAL_SLEEP = asyncio.sleep


def instant_asyncio() -> types.ModuleType:
    """asyncio whose sleeps do not wait: each yields to the loop once and
    records the delay asked for in `slept`. Given as the `asyncio` of code
    under test (a functions() namespace, or patch.object(module, "asyncio",
    ...)) where the waits are pacing for a lamp, not what is tested."""
    fast = types.ModuleType("asyncio_instant")
    fast.__dict__.update(vars(asyncio))
    fast.slept = []

    async def sleep(delay, result=None):
        fast.slept.append(delay)
        await _REAL_SLEEP(0)
        return result

    fast.sleep = sleep
    return fast


@contextlib.contextmanager
def instant_sleeps(*names):
    """The light's modules (or those named) with instant_asyncio() as their
    asyncio while the block runs; yields it (its `slept` lists the delays)."""
    fast = instant_asyncio()
    modules = [module(name) for name in (names or _LIGHT_MODULES)]
    saved = [(each, each.asyncio) for each in modules if hasattr(each, "asyncio")]
    for each, _ in saved:
        each.asyncio = fast
    try:
        yield fast
    finally:
        for each, original in saved:
            each.asyncio = original


_LIGHT_MODULES = (
    "light", "light_display", "light_brightness", "light_color", "light_native", "light_studio",
    "light_render", "light_connection", "light_restore", "light_rotation", "light_matter",
    "light_matrix", "light_mount_profile",
    # their parts (split by concern)
    "light_matter_remote", "light_matter_restore", "light_matter_rotation",
    "light_matrix_follow", "light_matrix_settings", "light_music_flow", "light_link_recovery",
    # light.py's own concerns (its mixins since the split)
    "light_attributes", "light_lifecycle", "light_onoff", "light_power", "light_settings",
)


class QuietLogger:
    """A logger that drops everything, cheaper than a Mock where nothing
    logged is checked."""

    def _drop(self, *args, **kwargs):
        pass

    debug = info = warning = error = exception = critical = log = _drop

    def isEnabledFor(self, level):
        return False


class NodeRun:
    """A Node script started now and read later (`result()`: its stdout as
    JSON), so the Python side of a comparison is computed while it runs."""

    def __init__(self, script, data=None, module_type=True, cwd=None):
        import shutil
        import subprocess

        command = [shutil.which("node")]
        command += ["--input-type=module", "-e", script] if module_type else [script]
        self._process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", cwd=cwd,
        )
        self._data = None if data is None else json.dumps(data)
        self._output = None

    def result(self):
        if self._output is None:
            out, err = self._process.communicate(self._data)
            if self._process.returncode:
                raise AssertionError(f"node exited {self._process.returncode}: {err[-4000:]}")
            self._output = json.loads(out)
        return self._output


# ── Functions taken from a source text ──────────────────────────────────────


@functools.lru_cache(maxsize=64)
def parsed(source: str) -> ast.Module:
    """A source text's syntax tree, parsed once (the joined light source is
    long). Not to be changed by the caller."""
    return ast.parse(source)


@functools.lru_cache(maxsize=64)
def _function_nodes(source: str) -> tuple:
    """Every function definition of a source text, in ast.walk order (which
    decides which of two same-named methods wins)."""
    return tuple(
        node for node in ast.walk(parsed(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    )


@functools.lru_cache(maxsize=512)
def _compiled(source: str, names: frozenset):
    chosen = [node for node in _function_nodes(source) if node.name in names]
    return compile(
        ast.Module(body=chosen, type_ignores=[]), "<helpers>", "exec",
        flags=_future.annotations.compiler_flag,
    )


def functions(source, names, namespace=None) -> dict:
    """The functions (or methods) called `names` in `source` (a text or a
    path), run on their own in `namespace`: returns the namespace, with them
    in it. For code the importable modules cannot reach; prefer module().
    The parse and the compiled code are cached; each call makes new
    function objects in a new namespace."""
    if isinstance(source, Path):
        source = source.read_text(encoding="utf-8")
    namespace = {"json": json, **(namespace or {})}
    exec(_compiled(source, frozenset(names)), namespace)
    return namespace
