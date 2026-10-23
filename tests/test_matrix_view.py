"""How previews show the matrix for the lamp's orientation (matrix_view.py,
www/matrix-view.js): the viewer's frame, the vertical view, the cameras'
option and the pixel arts' orientation."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import types
import unittest


ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
ORIENTATIONS = ("right", "down", "left", "up")


sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module, load_camera_module  # noqa: E402

VIEW = import_pure_module("matrix_view")
STORAGE = import_pure_module("pixel_art_storage")


def function_source(source: str, name: str) -> str:
    start = source.index(f"def {name}(")
    following = source.find("\n    def ", start + 1)
    return source[start:following if following != -1 else None]


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
        source = (ROOT / "camera.py").read_text(encoding="utf-8")
        view = function_source(source, "_view_frame")
        self.assertIn("viewer_frame(self._get_matrix_colors(), orientation)", view)
        self.assertIn("CONF_CAMERA_FOLLOWS_ORIENTATION, False", view)
        # No mode turns its own frame any more.
        self.assertNotIn('("left", "up")', source)
        self.assertNotIn("_RECTS_FLIPPED", source)

    def test_the_camera_firmware_content_turns_with_the_lamp(self):
        source = (ROOT / "camera.py").read_text(encoding="utf-8")
        colors = function_source(source, "_get_matrix_colors")
        self.assertIn("self._firmware_lamp_frame(self._get_clock_preview())", colors)
        self.assertIn("self._firmware_lamp_frame(self._get_native_effect_preview())", colors)
        turn = function_source(source, "_firmware_lamp_frame")
        self.assertIn('getattr(self._light_entity, "lamp_turns_content", False)', turn)
        self.assertIn("return frame[::-1]", turn)

    def test_effects_flow_the_same_way_when_the_lamp_turns_them(self):
        source = (ROOT / "light_native.py").read_text(encoding="utf-8")
        namespace = {"DEVICE_ORIENTATION_TO_EFFECT_DIR": {"left": "Left", "up": "Up", "right": "Right"}}
        exec(compile(function_source(source, "mount_effect_direction"), "light_native", "exec"), namespace)
        direction = namespace["mount_effect_direction"]
        self.assertEqual("Left", direction("left"))
        self.assertEqual("Right", direction("left", True))  # the firmware turns it too
        self.assertEqual("Down", direction("up", True))
        self.assertEqual("Right", direction("right"))

    def test_the_clock_restarts_only_when_the_lamps_direction_was_set(self):
        source = (ROOT / "light.py").read_text(encoding="utf-8")
        orientation = function_source(source, "set_device_orientation")
        self.assertIn("lamp_direction_set = await self._sync_lamp_rotation(orientation)", orientation)
        self.assertIn("reapply = lamp_direction_set", orientation)
        self.assertIn("self._cube_matrix.forget_running_effect()", orientation)

    def test_cameras_render_sharp_anti_aliased_images(self):
        source = (ROOT / "camera.py").read_text(encoding="utf-8")
        self.assertIn("RENDER_SCALE = 3", source)
        self.assertIn("PIXEL_SIZE = 16 * RENDER_SCALE", source)
        # Round dots: one anti-aliased mask pasted with each pixel's color.
        self.assertIn("img.paste(fill, rect[:2], _DOT_MASK)", source)
        self.assertIn("Image.LANCZOS", source)

    def test_option_switch_is_described(self):
        strings = json.loads((ROOT / "strings.json").read_text(encoding="utf-8"))
        icons = json.loads((ROOT / "icons.json").read_text(encoding="utf-8"))
        const = (ROOT / "const.py").read_text(encoding="utf-8")
        self.assertIn('CONF_CAMERA_FOLLOWS_ORIENTATION = "camera_follows_orientation"', const)
        self.assertIn("camera_follows_orientation", strings["entity"]["switch"])
        self.assertIn("camera_follows_orientation", icons["entity"]["switch"])
        switch = (ROOT / "switch.py").read_text(encoding="utf-8")
        self.assertIn("YeelightCubeCameraOrientationSwitch(config_entry, light_entity)", switch)
        self.assertIn("_notify_camera_preview()", switch)


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
        source = (ROOT / "storage.py").read_text(encoding="utf-8")
        self.assertIn('stored_pixel_art(safe_name, art["pixels"], art.get("orientation"))', source)

    def test_services_accept_orientation(self):
        common = (ROOT / "light_services_common.py").read_text(encoding="utf-8")
        services = (ROOT / "light_services_pixel_art.py").read_text(encoding="utf-8")
        self.assertIn('vol.Optional("orientation"): PIXEL_ART_ORIENTATION_SCHEMA', common)
        self.assertIn('vol.Optional("orientation"): PIXEL_ART_ORIENTATION_SCHEMA', services)
        self.assertIn('"orientation": art.get("orientation", PIXEL_ART_HORIZONTAL)', services)


if __name__ == "__main__":
    unittest.main()


class CameraRenderOnDemandTests(unittest.TestCase):
    def setUp(self):
        import asyncio

        camera_module = load_camera_module()
        self.renders = 0
        test = self

        class Hass:
            async def async_add_executor_job(self, function, *args):
                test.renders += 1
                return function(*args)

        camera = object.__new__(camera_module.YeelightCubeMatrixCameraRound)
        camera.hass = Hass()
        camera._cached_image = None
        camera._image_generation = 0
        camera._TRANSLATION_KEY = "matrix_preview_round"
        camera._light_entity = types.SimpleNamespace(_mode="matrix", _device_orientation="right")
        camera._config_entry = types.SimpleNamespace(options={})
        camera._get_matrix_colors = lambda: [(255, 255, 255)] * 100
        camera._is_native_preview_mode = lambda: False
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

    def test_a_render_overtaken_by_a_new_frame_is_not_kept(self):
        camera = self.camera
        render = camera._render_matrix

        def slow_render(*args):
            camera.async_refresh_preview()  # a new frame while encoding
            return render(*args)

        camera._render_matrix = slow_render
        self.assertTrue(self.run(camera.async_camera_image()))
        self.assertIsNone(camera._cached_image)
