"""How previews show the matrix for the lamp's orientation (matrix_view.py,
www/matrix-view.js): the viewer's frame, the vertical view, the cameras'
option and the pixel arts' orientation."""

from datetime import datetime
import io
import runpy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import types
import unittest
from unittest.mock import patch

from PIL import Image


ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
ORIENTATIONS = ("right", "down", "left", "up")


sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module, load_camera_module  # noqa: E402
from tests.fakes import light_state

VIEW = import_pure_module("matrix_view")
STORAGE = import_pure_module("pixel_art_storage")


_CAMERA = []


def camera_module():
    """camera.py (load_camera_module), loaded once for these tests."""
    if not _CAMERA:
        _CAMERA.append(load_camera_module())
    return _CAMERA[0]


def camera_of(light, options=None, square=False):
    """A preview camera of ``light`` (a light_state), built by its own
    __init__, with the config entry ``options``."""
    camera_class = camera_module().YeelightCubeMatrixCameraSquare if square else (
        camera_module().YeelightCubeMatrixCameraRound)
    light._attr_unique_id = "cube"
    camera = object.__new__(camera_class)
    camera.__init__(light, types.SimpleNamespace(options=dict(options or {}), entry_id="e1"))
    return camera


def lit(frame) -> set:
    """The indices of a frame's lit pixels."""
    return {index for index, pixel in enumerate(frame) if any(pixel)}


class ViewerFrameTests(unittest.TestCase):
    def test_lamp_order_is_shown_top_first_and_turned_for_upside_down_mounts(self):
        frame = list(range(100))  # lamp order: 0-19 is the bottom row
        top_first = VIEW.viewer_frame(frame, "right")
        self.assertEqual(top_first[:20], list(range(80, 100)))
        self.assertEqual(top_first[80:], list(range(20)))
        self.assertEqual(VIEW.viewer_frame(frame, "down"), top_first)
        for upside_down in ("left", "up"):
            self.assertEqual(VIEW.viewer_frame(frame, upside_down), top_first[::-1])

    def test_vertical_view_puts_the_left_end_on_top(self):
        self.assertEqual(VIEW.view_size(False), (20, 5))
        self.assertEqual(VIEW.view_size(True), (5, 20))
        # Top-first: index 80 is the bottom row's left end.
        self.assertEqual(VIEW.display_cell(80, True), (0, 0))
        self.assertEqual(VIEW.display_cell(0, True), (0, 4))
        self.assertEqual(VIEW.display_cell(19, True), (19, 4))
        cells = {VIEW.display_cell(index, True) for index in range(100)}
        self.assertEqual(len(cells), 100)
        self.assertEqual(VIEW.display_cell(23, False), (1, 3))

    def test_mounts(self):
        self.assertEqual([VIEW.is_vertical_mount(o) for o in ORIENTATIONS], [False, True, False, True])
        self.assertEqual([VIEW.is_upside_down_mount(o) for o in ORIENTATIONS], [False, False, True, True])
        self.assertFalse(VIEW.is_vertical_mount(None))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS parity")
    def test_cards_and_cameras_share_the_rule(self):
        module_uri = (ROOT / "www" / "matrix-view.js").as_uri()
        script = (
            f"import {{matrixView, viewerFrame}} from {json.dumps(module_uri)};"
            "const frame = [...Array(100).keys()];"
            f"const orientations = {json.dumps(ORIENTATIONS)};"
            "process.stdout.write(JSON.stringify({"
            "frames: Object.fromEntries(orientations.map((o) => [o, viewerFrame(frame, o)])),"
            "views: [false, true].map((v) => { const view = matrixView(v);"
            " return { cols: view.cols, source: view.source }; }),"
            "}));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        js = json.loads(result.stdout)
        for orientation in ORIENTATIONS:
            self.assertEqual(js["frames"][orientation], VIEW.viewer_frame(list(range(100)), orientation))
        for vertical, view in zip((False, True), js["views"]):
            cols, _rows = VIEW.view_size(vertical)
            self.assertEqual(view["cols"], cols)
            for display, index in enumerate(view["source"]):
                self.assertEqual(VIEW.display_cell(index, vertical), divmod(display, cols))


class CameraOrientationTests(unittest.TestCase):
    def test_cameras_turn_every_mode_once_and_stand_up_on_option(self):
        follows = import_pure_module("const").CONF_CAMERA_FOLLOWS_ORIENTATION
        lamp_order = [(index, 1, 1) for index in range(100)]
        for orientation in ORIENTATIONS:
            for options, vertical in (({}, False), ({follows: False}, False),
                                      ({follows: True}, VIEW.is_vertical_mount(orientation))):
                camera = camera_of(light_state(_device_orientation=orientation), options)
                camera._get_matrix_colors = lambda: lamp_order
                camera._shows_lamp_renderer = lambda: False
                # The lamp's frame as the viewer sees it (the rule of every
                # card preview); vertical only with the option on (off by default).
                self.assertEqual(
                    (VIEW.viewer_frame(lamp_order, orientation), vertical, False),
                    camera._view_frame(), (orientation, options),
                )
        # No mode turns its own frame for the mount: what a mode draws is the
        # same whatever the orientation (turned once, above). A native effect
        # is drawn compensated for the mount, as the lamp runs it.
        drawing = [(index, 0, 0) for index in range(100)]
        with patch.object(camera_module(), "dt_util", types.SimpleNamespace(
                now=lambda: datetime(2026, 11, 8, 12, 34, 56))):
            for mode, attrs in (
                ("Solid Color", {"_base_matrix_colors": drawing}),
                ("Clock", {}),
                ("Native Effect", {"_music_flow_enabled": True}),
            ):
                frames = [
                    camera_of(light_state(_mode=mode, _device_orientation=orientation, **attrs))._get_matrix_colors()
                    for orientation in ORIENTATIONS
                ]
                self.assertTrue(lit(frames[0]), mode)
                self.assertEqual([frames[0]] * 4, frames, mode)

    def test_the_camera_clock_turns_with_the_lamps_mount_profile(self):
        # Each mode is drawn by its own preview, from the frame's one
        # snapshot of the light (preview_state).
        clock, native = [(1, 2, 3)] * 100, [(4, 5, 6)] * 100
        for mode, shown in (("Clock", clock), ("Native Effect", native)):
            camera = camera_of(light_state(_mode=mode, _native_effect="77"))  # no LED drive to convert
            states = []
            camera._get_clock_preview = lambda state=None: states.append(state) or clock
            camera._get_native_effect_preview = lambda state=None: states.append(state) or native
            self.assertEqual(shown, camera._get_matrix_colors(), mode)
            self.assertEqual(1, len(states), mode)
            self.assertIsInstance(states[0], import_pure_module("light_actions").PreviewState)
        # Only the digits turn, a half turn round, when the mount's profile
        # turns the clock (light_mount_profile.lamp_turns_clock;
        # test_clock_presets checks the frames).
        with patch.object(camera_module(), "dt_util", types.SimpleNamespace(
                now=lambda: datetime(2026, 11, 8, 12, 34, 56))):
            for turns in (False, True):
                light = light_state(_mode="Clock", lamp_turns_clock=turns)
                upright = camera_of(light_state(_mode="Clock"))._get_clock_preview()
                drawn = camera_of(light)._get_clock_preview()
                self.assertTrue(lit(upright))
                expected = {99 - index for index in lit(upright)} if turns else lit(upright)
                self.assertEqual(expected, lit(drawn), turns)

    def test_the_clock_restarts_only_when_the_lamps_direction_was_set(self):
        import asyncio
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, Mock

        from tests.test_native_features import _load_standalone_functions

        source = (ROOT / "light_settings.py").read_text(encoding="utf-8")
        consts = {**runpy.run_path(str(ROOT / "const.py")), **runpy.run_path(str(ROOT / "effect_catalog.py"))}
        fns = _load_standalone_functions(
            source, {"set_device_orientation", "_follow_lamp_rotation"},
            {**consts, "asyncio": asyncio, "_LOGGER": Mock()},
        )

        async def scenario():
            writes = []
            release = asyncio.Event()

            async def sync(orientation):  # a write that waits for the lamp
                writes.append(orientation)
                await release.wait()
                return True

            tasks = []
            light = light_state(
                _mode="Clock", _device_orientation="right", _orientation="normal", hass=None,
                _device_orientation_select_entity=None, _ip="1.2.3.4",
                _turn_published_picture=Mock(), _notify_camera_preview=Mock(),
                _expect_lamp_rotation=Mock(), _sync_lamp_rotation=sync,
                _mount_profile_pending=None,
                _lamp_client=SimpleNamespace(forget_running_effect=Mock()),
                async_apply_display_mode=AsyncMock(),
                _create_tracked_task=lambda coro, name=None: tasks.append(asyncio.ensure_future(coro)),
            )
            for name in ("set_device_orientation", "_follow_lamp_rotation"):
                setattr(light, name, fns[name].__get__(light))
            # The choice returns at once, the lamp's write still running.
            await asyncio.wait_for(light.set_device_orientation("left"), 0.5)
            self.assertEqual("left", light._device_orientation)
            light._expect_lamp_rotation.assert_called_once_with("left")
            light.async_apply_display_mode.assert_not_called()  # the clock waits for the lamp
            # Another choice while the first write runs: it ends, nothing
            # follows it; the newer one is written and applied.
            await asyncio.sleep(0)
            self.assertEqual(["left"], writes)
            await light.set_device_orientation("down")
            release.set()
            await asyncio.gather(*tasks)
            self.assertEqual(["left", "down"], writes)
            light.async_apply_display_mode.assert_awaited_once_with(update_type="text_change")
            light._lamp_client.forget_running_effect.assert_called()
            # A choice superseded before its write started is never written.
            release.clear()
            await light.set_device_orientation("up")
            await light.set_device_orientation("right")
            release.set()
            await asyncio.gather(*tasks)
            self.assertEqual(["left", "down", "right"], writes)

        asyncio.run(scenario())

    def test_a_cube_matrix_effect_is_sent_again_in_full_for_its_new_rotation(self):
        """Filmed 2026-11-11: the lamp turns an effect for its rotation when
        it starts it; Lamp mounted wrote rotation 3 and the redraw was an
        empty live change, so the running effect never turned."""
        import asyncio
        from types import SimpleNamespace
        from unittest.mock import Mock

        from tests.test_native_features import _load_standalone_functions

        source = (ROOT / "light_settings.py").read_text(encoding="utf-8")
        consts = {**runpy.run_path(str(ROOT / "const.py")), **runpy.run_path(str(ROOT / "effect_catalog.py"))}
        fns = _load_standalone_functions(
            source, {"_follow_lamp_rotation"}, {**consts, "asyncio": asyncio, "_LOGGER": Mock()},
        )
        shown_when_redrawn = []

        async def redraw(update_type=None):
            shown_when_redrawn.append(light._matrix_shown)

        async def sync(orientation):
            return True

        light = light_state(
            _mode="Native Effect", _device_orientation="up", hass=None, is_cube_matrix=True,
            _matrix_shown=("setPresetsEffect", {"effectId": 32}), _sync_lamp_rotation=sync,
            _mount_profile_pending=None, _notify_camera_preview=Mock(),
            _lamp_client=SimpleNamespace(forget_running_effect=Mock()),
            async_apply_display_mode=redraw,
        )
        light._follow_lamp_rotation = fns["_follow_lamp_rotation"].__get__(light)
        asyncio.run(light._follow_lamp_rotation("up"))
        self.assertEqual([None], shown_when_redrawn)

    def test_cameras_render_sharp_anti_aliased_images(self):
        module = camera_module()
        # Three times the design size (a 16 px pixel), for a sharp picture.
        self.assertEqual(3, module.RENDER_SCALE)
        self.assertEqual(16 * 3, module.PIXEL_SIZE)
        frame = [(255, 0, 0)] + [(0, 0, 0)] * 99
        for square in (False, True):
            image = Image.open(io.BytesIO(
                camera_of(light_state(), square=square)._render_matrix(frame, False, False))).convert("RGB")
            self.assertEqual((1227, 372), image.size)
            left, top, right, bottom = module._VIEWS[False][1][0]
            self.assertEqual((module.PIXEL_SIZE,) * 2, (right - left, bottom - top))
            reds = [image.getpixel((x, y))[0] for x in range(left, right) for y in range(top, bottom)]
            self.assertEqual((255, 0, 0), image.getpixel(((left + right) // 2, (top + bottom) // 2)))
            if square:
                continue
            # A round dot (its square's corners stay the frame's black), its
            # edge anti-aliased (colors between the dot's and the frame's).
            for corner in ((left, top), (right - 1, top), (left, bottom - 1), (right - 1, bottom - 1)):
                self.assertEqual((0, 0, 0), image.getpixel(corner))
            self.assertGreater(sum(1 for red in reds if 0 < red < 255), 100)

    def test_option_switch_is_described(self):
        strings = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))
        icons = json.loads((ROOT / "icons.json").read_text(encoding="utf-8"))
        key = import_pure_module("const").CONF_CAMERA_FOLLOWS_ORIENTATION
        self.assertEqual("camera_follows_orientation", key)
        self.assertIn("camera_follows_orientation", strings["entity"]["switch"])
        self.assertIn("camera_follows_orientation", icons["entity"]["switch"])
        # Every lamp gets the switch; turned on, it is stored in the entry's
        # options and the cameras draw again.
        import asyncio
        from unittest.mock import Mock

        from tests.fakes import FakeEntry, FakeHass, make_light, module

        switch = module("switch")
        for profile in ("Cube Lite", "CubeMatrix"):
            light = make_light(device_profile=module("device_profile").profile_for(profile),
                               notify_camera_preview=Mock())
            hass = FakeHass()
            entry = FakeEntry()
            entry.runtime_data = types.SimpleNamespace(light=light)
            added = []
            asyncio.run(switch.async_setup_entry(hass, entry, added.extend))
            chosen, = [each for each in added if getattr(each, "option_key", None) == key]
            self.assertIs(light, chosen._light_entity, profile)
            self.assertFalse(chosen._attr_is_on)
            chosen.hass = hass
            asyncio.run(chosen.async_turn_on())
            self.assertTrue(entry.options[key])
            light.notify_camera_preview.assert_called_once_with()


class NarrowClockTests(unittest.TestCase):
    """A Cube Matrix with 3 blocks shows 15 columns (device_profile.columns):
    its streamed clock fits them, centred, the separator's gaps closed."""

    def test_the_time_fits_15_columns_and_the_turned_one_too(self):
        from tests.test_native_features import import_pure_module

        face = import_pure_module("clock_face")
        for turned in (False, True):
            wide = face.clock_digit_pixels("12:34", True, 0, turned)
            narrow = face.clock_digit_pixels("12:34", True, 0, turned, 15)
            self.assertEqual(len(wide), len(narrow))  # every digit pixel kept
            self.assertTrue(all(index % 20 < 15 for index, _char, _col in narrow), turned)
            # Each character is still its own: the same pixels per character.
            for char in range(5):
                self.assertEqual(
                    sum(1 for _i, c, _col in wide if c == char), sum(1 for _i, c, _col in narrow if c == char),
                )
            # Turned: a half turn within the columns shown.
            if turned:
                upright = face.clock_digit_pixels("12:34", True, 0, False, 15)
                self.assertEqual(
                    {(4 - index // 20) * 20 + 14 - index % 20 for index, _char, _col in upright},
                    {index for index, _char, _col in narrow},
                )
        # 20 columns: unchanged (the Cube Lite, a Cube Matrix with 4 blocks).
        self.assertEqual(face.clock_digit_pixels("12:34", True, 0, False),
                         face.clock_digit_pixels("12:34", True, 0, False, 20))


class PixelArtOrientationTests(unittest.TestCase):
    def test_vertical_arts_keep_their_orientation(self):
        pixels = [{"position": 3, "color": [1, 2, 3]}, {"position": 4, "color": [0, 0, 0]}]
        art = STORAGE.stored_pixel_art("Tower", pixels, "vertical")
        self.assertEqual(art, {"name": "Tower", "pixels": [{"color": [1, 2, 3], "position": [3]}], "orientation": "vertical"})
        # Horizontal (or none): stored as every older art.
        for orientation in (None, "horizontal"):
            self.assertNotIn("orientation", STORAGE.stored_pixel_art("Flat", pixels, orientation))
        self.assertEqual(STORAGE.PIXEL_ART_ORIENTATIONS, ("horizontal", "vertical"))

    def test_storage_migration_keeps_orientation(self):
        from tests.fakes import module

        flat = [{"position": 3, "color": [1, 2, 3]}]
        migrated, changed = module("storage").migrate_pixel_arts([
            {"name": "Tower", "pixels": flat, "orientation": "vertical"},
            {"name": "Flat", "pixels": flat},
        ])
        self.assertTrue(changed)
        self.assertEqual("vertical", migrated[0]["orientation"])
        self.assertNotIn("orientation", migrated[1])

    def test_services_accept_orientation(self):
        import asyncio

        from tests.fakes import FakeHass, module

        common, services = module("light_services_common"), module("light_services_pixel_art")
        hass = FakeHass({"yeelight_cube": {"pixel_arts": []}})
        schemas = {}

        def register(domain, name, handler, schema=None, **kwargs):
            hass.registered[(domain, name)] = handler
            schemas[name] = schema

        hass.services.async_register = register
        services.async_register_pixel_art_services(hass)

        def field(schema, name):
            """The validator of an optional key of a voluptuous schema (the
            test's voluptuous records what each was built with)."""
            fields = schema._stub_args[0]
            return next(value for key, value in fields.items()
                        if type(key).__name__ == "Optional" and key._stub_args == (name,))

        # Both a saved art and each one of a collection update take one of
        # the orientations.
        self.assertEqual((STORAGE.PIXEL_ART_ORIENTATIONS,), common.PIXEL_ART_ORIENTATION_SCHEMA._stub_args)
        self.assertIs(common.PIXEL_ART_ORIENTATION_SCHEMA, field(common.PIXEL_ART_SCHEMA, "orientation"))
        self.assertIs(common.PIXEL_ART_ORIENTATION_SCHEMA, field(schemas["save_pixel_art"], "orientation"))
        # And keep it; an art stored without one reads as horizontal.
        call = lambda **data: types.SimpleNamespace(data=data, hass=hass)  # noqa: E731
        pixels = [{"position": 3, "color": [1, 2, 3]}]
        asyncio.run(hass.registered[("yeelight_cube", "save_pixel_art")](
            call(name="Tower", pixels=pixels, orientation="vertical")))
        asyncio.run(hass.registered[("yeelight_cube", "update_pixel_arts")](call(pixel_arts=[
            {"name": "Mast", "pixels": pixels, "orientation": "vertical"}, {"name": "Flat", "pixels": pixels},
        ])))
        get = hass.registered[("yeelight_cube", "get_pixel_art")]
        self.assertEqual(
            ["vertical", "vertical", "horizontal"],
            [asyncio.run(get(call(idx=idx)))["orientation"] for idx in range(3)],
        )


class CameraRenderOnDemandTests(unittest.TestCase):
    def setUp(self):
        import asyncio

        camera_module = load_camera_module()
        self.module = camera_module
        self.renders = 0
        self.in_executor = [False]
        test = self

        class Hass:
            async def async_add_executor_job(self, function, *args):
                test.renders += 1
                test.in_executor[0] = True
                try:
                    return function(*args)
                finally:
                    test.in_executor[0] = False

        camera = object.__new__(camera_module.YeelightCubeMatrixCameraRound)
        camera.hass = Hass()
        camera._cached_image = None
        camera._cached_frame = None
        camera._next_frame_at = 0.0
        camera._live_streams = 0
        camera._image_generation = 0
        camera._TRANSLATION_KEY = "matrix_preview_round"
        camera._light_entity = light_state(_mode="matrix", _device_orientation="right")
        camera._config_entry = types.SimpleNamespace(options={})
        camera._get_matrix_colors = lambda: [(255, 255, 255)] * 100
        camera._is_native_preview_mode = lambda: False
        camera._shows_lamp_renderer = lambda: False
        camera.async_update_token = lambda: None
        camera.async_write_ha_state = lambda: None
        self.camera = camera
        self.run = asyncio.run

    def test_a_new_frame_renders_nothing_until_requested(self):
        camera = self.camera
        for _ in range(5):  # e.g. scrolling text
            camera.async_refresh_preview()
        self.assertEqual(self.renders, 0)
        first = self.run(camera.async_camera_image())
        self.assertTrue(first.startswith(b"\x89PNG"))
        self.assertEqual(self.run(camera.async_camera_image()), first)
        self.assertEqual(self.renders, 1)  # cached until the next frame
        camera.async_refresh_preview()
        self.run(camera.async_camera_image())
        self.assertEqual(self.renders, 2)

    def test_the_screen_shows_the_leds_and_the_power_keeps_their_drive(self):
        camera = self.camera
        del camera._get_matrix_colors
        del camera._shows_lamp_renderer
        camera._native_preview_key = None
        camera._native_preview_started_at = None
        camera._frozen_background_seconds = None
        camera._preview_lock = threading.Lock()
        light = camera._light_entity
        light._mode, light._native_effect = "Native Effect", "Fireworks"
        light._is_on, light._brightness = True, 255
        light._native_effect_speed = 50
        light._native_effect_direction = "Up"
        now = [100.0]
        with patch.object(self.module._time, "monotonic", lambda: now[0]):
            camera._get_native_effect_preview()
            now[0] += 4.36  # the shot's burst
            drive = camera.simulated_lamp_frame()
            shown = camera._get_matrix_colors()
        self.assertTrue(any(any(pixel) for pixel in drive))
        self.assertEqual([self.module.led_appearance(pixel) for pixel in drive], shown)
        self.assertNotEqual(drive, shown)
        # Every named effect is LED drive, a bare number has none to convert.
        light._native_effect = "Ribbon"
        with patch.object(self.module._time, "monotonic", lambda: now[0]):
            drive = camera.simulated_lamp_frame()
            self.assertEqual(
                [self.module.led_appearance(pixel) for pixel in drive],
                camera._get_matrix_colors(),
            )
        light._native_effect = "77"
        with patch.object(self.module._time, "monotonic", lambda: now[0]):
            self.assertEqual(camera.simulated_lamp_frame(), camera._get_matrix_colors())

    def test_only_a_live_stream_of_a_lamp_renderer_is_small(self):
        camera = self.camera
        camera._is_native_preview_mode = lambda: True
        camera._shows_lamp_renderer = lambda: True
        size = lambda data: Image.open(io.BytesIO(data)).size
        self.assertEqual((1227, 372), size(self.run(camera.async_camera_image())))
        seen = []

        async def stream(_camera, request):
            camera._next_frame_at = 0.0
            seen.append(size(await camera.async_camera_image()))
            return "response"

        with patch.object(self.module.Camera, "handle_async_mjpeg_stream", stream, create=True):
            self.assertEqual("response", self.run(camera.handle_async_mjpeg_stream(None)))
        self.assertEqual([(409, 124)], seen)
        self.assertEqual(0, camera._live_streams)
        camera._next_frame_at = 0.0
        self.assertEqual((1227, 372), size(self.run(camera.async_camera_image())))
        # A stream of anything else stays full size, and a stream that fails
        # is no longer counted.
        camera._shows_lamp_renderer = lambda: False

        async def broken(_camera, request):
            camera._next_frame_at = 0.0
            seen.append(size(await camera.async_camera_image()))
            raise ConnectionResetError

        with patch.object(self.module.Camera, "handle_async_mjpeg_stream", broken, create=True):
            with self.assertRaises(ConnectionResetError):
                self.run(camera.handle_async_mjpeg_stream(None))
        self.assertEqual((1227, 372), seen[-1])
        self.assertEqual(0, camera._live_streams)

    def test_the_small_view_is_the_full_one_reduced(self):
        for vertical in (False, True):
            base, rects = self.module._VIEWS[vertical]
            small, small_rects = self.module._LIVE_VIEWS[vertical]
            self.assertEqual((base.width // 3, base.height // 3), small.size)
            for rect, small_rect in zip(rects, small_rects):
                self.assertEqual(rect, tuple(edge * 3 for edge in small_rect))
        self.assertEqual((409, 124), self.module._LIVE_VIEWS[False][0].size)
        round_camera = self.camera
        image = round_camera._render_matrix([(255, 0, 0)] * 100, False, True)
        self.assertEqual((409, 124), Image.open(io.BytesIO(image)).size)

    def test_a_live_view_polls_at_the_lamps_render(self):
        self.assertEqual(0.04, self.module.RENDER_SECONDS)

    def test_a_lamp_rendered_effect_encodes_only_what_changed(self):
        camera = self.camera
        camera._is_native_preview_mode = lambda: True
        camera._shows_lamp_renderer = lambda: True
        encoded = []
        render = camera._render_matrix
        camera._render_matrix = lambda *args: (encoded.append(args), render(*args))[1]
        first = self.run(camera.async_camera_image())
        camera._next_frame_at = 0.0
        self.assertIs(self.run(camera.async_camera_image()), first)
        self.assertEqual(1, len(encoded))  # the same pixels: the stream skips it
        camera._get_matrix_colors = lambda: [(255, 0, 0)] * 100
        camera._next_frame_at = 0.0
        self.assertNotEqual(self.run(camera.async_camera_image()), first)
        self.assertEqual(2, len(encoded))  # the next render, at once

    def test_a_frame_is_computed_off_the_event_loop(self):
        camera = self.camera
        camera._is_native_preview_mode = lambda: True
        computed = []
        colors = camera._get_matrix_colors
        camera._get_matrix_colors = lambda: (computed.append(self.in_executor[0]), colors())[1]
        self.run(camera.async_camera_image())
        self.assertEqual([True], computed)

    def test_a_slow_host_gets_fewer_frames_not_a_busy_core(self):
        camera = self.camera
        camera._is_native_preview_mode = lambda: True
        camera._shows_lamp_renderer = lambda: True
        now = [100.0]
        frame = [0]
        render = camera._render_matrix

        def colors():
            frame[0] += 1
            return [(frame[0], 0, 0)] * 100

        def slow_render(*args):
            now[0] += 0.1  # 100 ms to encode
            return render(*args)

        camera._get_matrix_colors = colors
        camera._render_matrix = slow_render
        with patch.object(self.module._time, "monotonic", lambda: now[0]):
            first = self.run(camera.async_camera_image())
            for _ in range(2):  # polled every 40 ms, 0.18 s after it started
                now[0] += 0.04
                self.assertIs(self.run(camera.async_camera_image()), first)
            now[0] += 0.04
            self.assertNotEqual(self.run(camera.async_camera_image()), first)
        self.assertEqual(self.renders, 2)

    def test_what_no_renderer_draws_is_paced_the_same(self):
        # Music Flow, a bare number, a solid clock: only the images that changed
        # are encoded, within the same share of a core.
        camera = self.camera
        camera._is_native_preview_mode = lambda: True
        camera._shows_lamp_renderer = lambda: False
        now = [100.0]
        render = camera._render_matrix

        def slow_render(*args):
            now[0] += 0.1
            return render(*args)

        camera._render_matrix = slow_render
        with patch.object(self.module._time, "monotonic", lambda: now[0]):
            first = self.run(camera.async_camera_image())
            self.assertEqual(100.2, round(camera._next_frame_at, 6))
            self.assertIs(self.run(camera.async_camera_image()), first)

    def test_only_lamp_rendered_effects_are_followed(self):
        camera = self.camera
        del camera._shows_lamp_renderer
        light = camera._light_entity
        light._mode, light._native_effect = "Native Effect", "Fireworks"
        self.assertTrue(camera._shows_lamp_renderer())
        light._native_effect = "Ribbon"
        self.assertTrue(camera._shows_lamp_renderer())
        light._native_effect = "77"  # no renderer draws it
        self.assertFalse(camera._shows_lamp_renderer())
        light._mode = "matrix"
        self.assertFalse(camera._shows_lamp_renderer())
        light._mode = "Clock"
        for style_id, style in self.module.NATIVE_CLOCK_STYLES.items():
            light._native_clock_style = style_id
            effect = self.module.clock_style_effect(style)
            self.assertEqual(effect is not None, camera._shows_lamp_renderer())
        light._mode, light._native_effect = "Native Effect", "Fireworks"
        light._music_flow_enabled = True
        self.assertFalse(camera._shows_lamp_renderer())

    def test_a_new_frame_during_an_unchanged_job_is_drawn(self):
        camera = self.camera
        camera._is_native_preview_mode = lambda: True
        first = self.run(camera.async_camera_image())
        camera._next_frame_at = 0.0
        job = camera._render_job

        def refreshed_meanwhile():
            result = job()
            camera._get_matrix_colors = lambda: [(9, 9, 9)] * 100
            camera._render_job = job
            camera.async_refresh_preview()
            return result

        camera._render_job = refreshed_meanwhile
        image = self.run(camera.async_camera_image())
        self.assertTrue(image.startswith(b"\x89PNG"))
        self.assertNotEqual(first, image)

    def test_a_render_overtaken_by_a_new_frame_is_not_kept(self):
        camera = self.camera
        render = camera._render_matrix

        def slow_render(*args):
            camera.async_refresh_preview()  # a new frame while encoding
            return render(*args)

        camera._render_matrix = slow_render
        self.assertTrue(self.run(camera.async_camera_image()))
        self.assertIsNone(camera._cached_image)


if __name__ == "__main__":
    unittest.main()
