import base64
import io
import unittest

from PIL import Image

from tests.test_native_features import ROOT, _load_standalone_functions, SERVICES_SOURCE
import asyncio
import importlib.util
from types import SimpleNamespace
from unittest.mock import Mock

_spec = importlib.util.spec_from_file_location("image_utils", ROOT / "image_utils.py")
image_utils = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(image_utils)


def _encode(image, fmt="PNG"):
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return base64.b64encode(buffer.getvalue()).decode()


class ImageToMatrixTests(unittest.TestCase):
    def test_valid_images_become_a_20x5_matrix(self):
        for fmt in ("PNG", "JPEG"):
            matrix = image_utils.image_to_matrix(
                _encode(Image.new("RGB", (400, 100), (250, 10, 10)), fmt)
            )
            self.assertEqual(100, len(matrix), fmt)
            self.assertTrue(all(r > 200 and g < 40 for r, g, _ in matrix), fmt)

    def test_oversized_or_invalid_data_is_refused_before_decoding(self):
        too_many_pixels = _encode(Image.new("1", (5000, 5000)))  # small file
        cases = {
            "too many pixels": too_many_pixels,
            "too long": "A" * (image_utils.MAX_IMAGE_B64_LENGTH + 1),
            "not base64": "!!not base64!!",
            "not an image": base64.b64encode(b"hello").decode(),
        }
        for label, data in cases.items():
            with self.assertRaises(ValueError, msg=label):
                image_utils.image_to_matrix(data)


class DisplayImageServiceTests(unittest.IsolatedAsyncioTestCase):
    def handler(self, targets, decode):
        async def run_in_executor(func, *args):
            return func(*args)

        return _load_standalone_functions(
            SERVICES_SOURCE,
            {"handle_display_image"},
            {
                "HomeAssistantError": RuntimeError,
                "_resolve_entities": lambda *args: targets,
                "image_to_matrix": decode,
                "hass": SimpleNamespace(async_add_executor_job=run_in_executor),
                "_fire_and_forget": lambda *coros: [c.close() for c in coros],
                "_LOGGER": Mock(),
            },
        )["handle_display_image"]

    async def test_no_matching_lamp_is_an_error_and_nothing_is_decoded(self):
        decode = Mock()
        with self.assertRaisesRegex(RuntimeError, "No matching"):
            await self.handler([], decode)(SimpleNamespace(data={"image_b64": "x"}))
        decode.assert_not_called()

    async def test_an_unusable_image_is_reported_to_the_caller(self):
        call = SimpleNamespace(data={"image_b64": "!!"})
        with self.assertRaisesRegex(RuntimeError, "not a supported image|not valid"):
            await self.handler([object()], image_utils.image_to_matrix)(call)


if __name__ == "__main__":
    unittest.main()
