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
    text and whether its colon is lit. In "time_date" the time shows 6 s,
    then the date 4 s (while the seconds end in 6 to 9), as the lamps' own
    clocks do (filmed on a Cube Matrix); a blinking colon is off on odd
    seconds."""
    if content == "date":
        date_phase = True
    elif content == "time_date":
        date_phase = now.second % 10 >= 6
    else:
        date_phase = False
    if date_phase:
        return now.strftime("%m.%d"), True
    text = now.strftime("%I:%M" if twelve_hour else "%H:%M")
    return text, not (colon_blink and now.second % 2 == 1)


def clock_digit_pixels(text: str, colon_visible: bool, digit_flags: int, turned: bool, columns: int = COLS):
    """The lamp-order pixels the clock's digits light, each with the index of
    its character and its column: (pixel, char_index, col). The lamp's
    bundled "native" font (monospace digits, narrow colon and period),
    centred; ``digit_flags`` (lamp_renderers.clock_digit_flags): how a
    background started directly turns or mirrors them; ``turned`` (the
    mount's profile turns the clock, light_mount_profile.lamp_turns_clock):
    laid out a half turn round. ``columns``: the columns the lamp shows (a
    Cube Matrix with 3 blocks: 15, device_profile.columns): centred in them,
    the gaps on either side of the separator closed when the time (17
    columns) is wider."""
    font_key = "native"
    font = FONT_MAPS[font_key]
    glyphs = [font.get(char, []) for char in text]
    advances = [char_advance(font_key, char, glyph) for char, glyph in zip(text, glyphs)]
    total_width = (sum(advances) - 1) if advances else 0
    for index, char in enumerate(text):
        if total_width <= columns:
            break
        if char in ":." and index > 0 and advances[index - 1] > 1:
            # The digit before it, then the separator itself, lose their gap.
            advances[index - 1] -= 1
            total_width -= 1
            if total_width > columns and advances[index] > 1:
                advances[index] -= 1
                total_width -= 1
    offset = max(0, (columns - total_width) // 2)
    pixels = []
    for char_index, (char, glyph, advance) in enumerate(zip(text, glyphs, advances)):
        if char == ":" and not colon_visible:
            offset += advance
            continue
        for position in glyph:
            col = position % COLS + offset
            row = position // COLS
            if 0 <= col < columns and 0 <= row < ROWS:
                at = row * COLS + col
                # Turned: a half turn within the columns shown.
                if turned:
                    at = (ROWS - 1 - row) * COLS + (columns - 1 - col)
                for index in clock_digit_targets(at, digit_flags, columns * ROWS):
                    pixels.append((index, char_index, col))
        offset += advance
    return pixels
