import base64
import io
from PIL import Image

def image_to_matrix(image_b64: str, width: int = 20, height: int = 5):
    """
    Convert a base64-encoded image to a list of RGB tuples for a 20x5 matrix.
    """
    image_data = base64.b64decode(image_b64)
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
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
