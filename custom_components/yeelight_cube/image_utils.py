import base64
import binascii
import io
from PIL import Image

# display_image limits. The image is decoded in full before being shrunk to
# 20x5, so an oversized (or deliberately crafted) image could use a lot of
# memory and CPU: refuse it before decoding.
MAX_IMAGE_B64_LENGTH = 4_000_000  # base64 characters, about a 3 MB file
# 2048x2048 is far more than a 20x5 target needs and keeps one decode to
# about 16 MB (RGBA), even with several calls at once.
MAX_IMAGE_PIXELS = 2048 * 2048


def image_to_matrix(image_b64: str, width: int = 20, height: int = 5):
    """
    Convert a base64-encoded image to a list of RGB tuples for a 20x5 matrix.

    Raises ValueError when the data is not a usable image: too long, not
    base64, an unknown format, or more than MAX_IMAGE_PIXELS pixels.
    """
    if len(image_b64) > MAX_IMAGE_B64_LENGTH:
        raise ValueError(
            f"The image is too large (limit {MAX_IMAGE_B64_LENGTH} base64 characters)"
        )
    try:
        image_data = base64.b64decode(image_b64)
    except (binascii.Error, ValueError) as err:
        raise ValueError("image_b64 is not valid base64") from err
    try:
        # Only reads the header: the size is known before any pixel is decoded.
        image = Image.open(io.BytesIO(image_data))
    except Image.DecompressionBombError as err:
        raise ValueError("The image has too many pixels") from err
    except OSError as err:
        raise ValueError("image_b64 is not a supported image") from err
    image_width, image_height = image.size
    if image_width * image_height > MAX_IMAGE_PIXELS:
        raise ValueError(
            f"The image is too large ({image_width}x{image_height}; "
            f"limit {MAX_IMAGE_PIXELS} pixels)"
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
    pixels = list(image.getdata())
    matrix = []
    for row in range(height):
        for col in range(width):
            pos = row * width + col
            r, g, b = pixels[pos]
            matrix.append((r, g, b))
    return matrix
