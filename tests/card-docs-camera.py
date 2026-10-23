"""The Matrix Preview camera images of the documentation screenshots
(card-docs.cjs serves them to Home Assistant's picture card): official pixel
arts rendered by the integration's own camera code (camera.py, its Home
Assistant imports stubbed), on a lamp lying flat and one standing on its end.

Prints {entity_id: base64 PNG} as JSON.
"""

import base64
import json
from pathlib import Path
import sys

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

images = {}
for entity, (camera_class, art, orientation) in IMAGES.items():
    renderer = object.__new__(camera_class)
    png = renderer._render_matrix(
        view.viewer_frame(lamp_frame(art), orientation),
        view.is_vertical_mount(orientation),
    )
    images[entity] = base64.b64encode(png).decode("ascii")
print(json.dumps(images))
