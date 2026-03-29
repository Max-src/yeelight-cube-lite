import re
from typing import Tuple

def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    match = re.match(r'^#?([A-Fa-f0-9]{6})$', hex_color)
    if not match:
        raise ValueError(f"Invalid hex color: {hex_color}")
    hex_digits = match.group(1)
    return tuple(int(hex_digits[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    return '#{:02X}{:02X}{:02X}'.format(*rgb)