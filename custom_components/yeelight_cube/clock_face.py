"""Where the lamp's clock draws its digits, for a moment and a light's clock
settings: shared by the camera's clock preview (camera.py) and the palette
clock streamed to the lamp (light_studio), so both show the same face.

Mirrored by renderClockFrame in www/clock-preview-utils.js.
"""

from __future__ import annotations

from .lamp_core import COLS, ROWS, clock_digit_targets
from .layout import FONT_MAPS, char_advance


def clock_content(light) -> str:
    """The clock's content: "time", "time_date" (alternating) or "date"; the
    legacy show_date boolean for older state."""
    content = getattr(light, "_native_clock_content", None)
    if content in ("time", "time_date", "date"):
        return content
    return "time_date" if getattr(light, "_native_clock_show_date", False) else "time"


def clock_text(now, content: str, twelve_hour: bool, colon_blink: bool) -> tuple[str, bool]:
    """What the clock shows at ``now`` (an aware datetime, local time): its
    text and whether its colon is lit. The date alternates with the time
    every 5 s in "time_date"; a blinking colon is off on odd seconds."""
    if content == "date":
        date_phase = True
    elif content == "time_date":
        date_phase = int(now.timestamp() // 5) % 2 == 1
    else:
        date_phase = False
    if date_phase:
        return now.strftime("%m.%d"), True
    text = now.strftime("%I:%M" if twelve_hour else "%H:%M")
    return text, not (colon_blink and now.second % 2 == 1)


def clock_digit_pixels(text: str, colon_visible: bool, digit_flags: int, turned: bool):
    """The lamp-order pixels the clock's digits light, each with the index of
    its character and its column: (pixel, char_index, col). The lamp's
    bundled "native" font (monospace digits, narrow colon and period),
    centred; ``digit_flags`` (lamp_renderers.clock_digit_flags): how a
    background started directly turns or mirrors them; ``turned`` (the
    mount's profile turns the clock, light_mount_profile.lamp_turns_clock):
    laid out a half turn round."""
    font_key = "native"
    font = FONT_MAPS[font_key]
    glyphs = [font.get(char, []) for char in text]
    advances = [char_advance(font_key, char, glyph) for char, glyph in zip(text, glyphs)]
    total_width = (sum(advances) - 1) if advances else 0
    offset = max(0, (COLS - total_width) // 2)
    pixels = []
    for char_index, (char, glyph, advance) in enumerate(zip(text, glyphs, advances)):
        if char == ":" and not colon_visible:
            offset += advance
            continue
        for position in glyph:
            col = position % COLS + offset
            row = position // COLS
            if 0 <= col < COLS and 0 <= row < ROWS:
                at = row * COLS + col
                for index in clock_digit_targets(99 - at if turned else at, digit_flags):
                    pixels.append((index, char_index, col))
        offset += advance
    return pixels
