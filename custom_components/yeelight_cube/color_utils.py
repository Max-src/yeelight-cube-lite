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


# The firmware takes a custom clock/effect colour as one integer 0x01RRGGBB
# (the 0x01 flag byte marks it as an explicit colour).
def rgb_to_argb(rgb) -> int:
    red, green, blue = (int(channel) & 0xFF for channel in rgb[:3])
    return 0x01000000 | (red << 16) | (green << 8) | blue


def argb_to_rgb(value: int) -> Tuple[int, int, int]:
    return ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)
