import base64
import binascii
import io
from PIL import Image

from .input_error import InputError

# display_image limits. The image is decoded in full before being shrunk to
# the lamp's frame (20x5, up to 40x5 for a long Cube Matrix), so an oversized (or deliberately crafted) image could use a lot of
# memory and CPU: refuse it before decoding.
MAX_IMAGE_B64_LENGTH = 4_000_000  # base64 characters, about a 3 MB file
# 2048x2048 is far more than a 40x5 target needs and keeps one decode to
# about 16 MB (RGBA), even with several calls at once.
MAX_IMAGE_PIXELS = 2048 * 2048


def image_to_matrix(image_b64: str, width: int = 20, height: int = 5):
    """
    Convert a base64-encoded image to a list of RGB tuples for a ``width`` x
    ``height`` matrix, row by row from the top.

    Raises InputError (a ValueError) when the data is not a usable image: too long, not
    base64, an unknown format, or more than MAX_IMAGE_PIXELS pixels.
    """
    if len(image_b64) > MAX_IMAGE_B64_LENGTH:
        raise InputError("image_too_long", limit=MAX_IMAGE_B64_LENGTH)
    try:
        image_data = base64.b64decode(image_b64)
    except (binascii.Error, ValueError) as err:
        raise InputError("image_not_base64") from err
    try:
        # Only reads the header: the size is known before any pixel is decoded.
        image = Image.open(io.BytesIO(image_data))
    except Image.DecompressionBombError as err:
        raise InputError("image_too_many_pixels") from err
    except OSError as err:
        raise InputError("image_not_supported") from err
    image_width, image_height = image.size
    if image_width * image_height > MAX_IMAGE_PIXELS:
        raise InputError(
            "image_too_large", width=image_width, height=image_height, limit=MAX_IMAGE_PIXELS
        )
    # JPEG: let the decoder downscale while decoding (no-op for other formats).
    image.draft("RGB", (width, height))
    image = image.convert("RGB")
    # Use LANCZOS for Pillow >= 10, fallback for older versions
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    image = image.resize((width, height), resample)
    # Row by row, 3 bytes (R, G, B) per pixel. tobytes() is in every Pillow
    # (getdata() is deprecated: removed in Pillow 14).
    data = image.tobytes()
    return [tuple(data[pos : pos + 3]) for pos in range(0, width * height * 3, 3)]


def image_pixels(matrix, width: int = 20) -> list:
    """image_to_matrix's rows (from the top, ``width`` each) as a drawing's
    pixels in lamp order (row 0 at the bottom: ``row * width + column``)."""
    rows = [matrix[start:start + width] for start in range(0, len(matrix), width)]
    flipped = [color for row in reversed(rows) for color in row]
    return [{"position": pos, "color": color} for pos, color in enumerate(flipped)]
