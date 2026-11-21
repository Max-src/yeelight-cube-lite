"""The Matrix Preview camera images of the documentation screenshots
(card-docs.cjs serves them to Home Assistant's picture card): official pixel
arts rendered by the integration's own camera code (camera.py, its Home
Assistant imports stubbed), on a lamp lying flat and one standing on its end,
and a Cube Matrix of six modules (Matrix, Panel and Spot faces) lying flat.

Prints {entity_id: base64 PNG} as JSON.
"""

import base64
import colorsys
import json
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module, load_camera_module  # noqa: E402

camera = load_camera_module()
view = import_pure_module("matrix_view")
arts = import_pure_module("builtin_pixel_art").get_builtin_pixel_art_map()


def lamp_frame(name):
    """An official pixel art as the lamp shows it (lamp order, off black)."""
    frame = [(0, 0, 0)] * 100
    for pixel in arts[name]["pixels"]:
        frame[pixel["position"]] = tuple(pixel["color"])
    return frame


# entity -> (camera class, pixel art, device orientation)
IMAGES = {
    "camera.documentation_round_landscape": (
        camera.YeelightCubeMatrixCameraRound, "Built-in: Horizontal 01", "right"),
    "camera.documentation_round_vertical": (
        camera.YeelightCubeMatrixCameraRound, "Built-in: Vertical 01", "down"),
    "camera.documentation_square_landscape": (
        camera.YeelightCubeMatrixCameraSquare, "Built-in: Horizontal 01", "right"),
}

# The Cube Matrix: matrix, matrix, panel, spot, matrix, matrix from the base
# (30 columns), lying flat with its base on the left.
MATRIX_MODULES = "2,2,1,3,2,2,0,0,"
profile = import_pure_module("device_profile").profile_for("CubeMatrix", (), MATRIX_MODULES, "130")


def matrix_frame():
    """A rainbow along the lamp, brighter towards the top (lamp order)."""
    width = profile.width
    frame = []
    for row in range(5):
        for column in range(width):
            red, green, blue = colorsys.hsv_to_rgb(column / width, 1, 0.45 + 0.55 * row / 4)
            frame.append((round(red * 255), round(green * 255), round(blue * 255)))
    return frame


images = {}
lite = import_pure_module("device_profile").CUBE_LITE_PROFILE


def renderer_for(camera_class, lamp_profile, orientation):
    """A camera drawing for a lamp of ``lamp_profile`` mounted ``orientation``
    (the light entity's profile and state, as camera.py reads them)."""
    renderer = object.__new__(camera_class)
    renderer._light_entity = SimpleNamespace(
        device_profile=lamp_profile, preview_state=lambda: SimpleNamespace(orientation=orientation),
    )
    return renderer


for entity, (camera_class, art, orientation) in IMAGES.items():
    renderer = renderer_for(camera_class, lite, orientation)
    png = renderer._render_matrix(
        view.viewer_frame(lamp_frame(art), orientation),
        view.is_vertical_mount(orientation),
    )
    images[entity] = base64.b64encode(png).decode("ascii")
renderer = renderer_for(camera.YeelightCubeMatrixCameraRound, profile, "right")
png = renderer._render_matrix(view.viewer_frame(matrix_frame(), "right"), False)
images["camera.documentation_cube_matrix"] = base64.b64encode(png).decode("ascii")
print(json.dumps(images))
