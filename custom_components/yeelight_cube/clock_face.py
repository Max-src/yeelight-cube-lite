"""Where the lamp's clock draws its digits, for a moment and a light's clock
settings: shared by the camera's clock preview (camera.py) and the palette
clock streamed to the lamp (light_studio), so both show the same face.

Mirrored by renderClockFrame in www/clock-preview-utils.js.
"""

from __future__ import annotations

from .device_profile import MODULE_SIZE
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


def clock_geometry(profile) -> dict:
    """Where a lamp (its device_profile) shows the clock, as
    clock_digit_pixels' keyword arguments: ``columns`` (the columns it
    shows), ``width`` (the frame's stride) and ``blocks`` (the frame columns
    the digits may take: those of its 5 x 5 blocks, Matrix and Panel modules,
    in chain order; a Spot's 5 columns are left to the background). A Cube
    Lite, or a Cube Matrix without a Spot: every column shown."""
    columns = getattr(profile, "columns", COLS) or COLS
    width = getattr(profile, "width", max(COLS, columns)) or COLS
    layout = getattr(profile, "layout", None) or []
    blocks = None
    if any(module.get("type") == "spot" for module in layout):
        blocks = [
            module["column"] + step
            for module in layout if module.get("type") != "spot"
            for step in range(MODULE_SIZE)
            if module["column"] + step < columns
        ]
    return {"columns": columns, "width": width, "blocks": blocks}


def clock_digit_pixels(
    text: str, colon_visible: bool, digit_flags: int, turned: bool, columns: int = COLS,
    width: int | None = None, blocks=None,
):
    """The lamp-order pixels the clock's digits light, each with the index of
    its character and its column: (pixel, char_index, col). The lamp's
    bundled "native" font (monospace digits, narrow colon and period),
    centred; ``digit_flags`` (lamp_renderers.clock_digit_flags): how a
    background started directly turns or mirrors them; ``turned`` (the
    mount's profile turns the clock, light_mount_profile.lamp_turns_clock):
    laid out a half turn round. ``columns``: the columns the lamp shows (a
    Cube Matrix with 3 blocks: 15, device_profile.columns); ``width``: the
    frame's stride (device_profile.width, at least 20); ``blocks``: the frame
    columns the digits take, in order (clock_geometry: a Cube Matrix's
    blocks, its Spots left out; None: every column shown). The text is
    centred across them, the gaps on either side of the separator closed
    when the time (17 columns) is wider. ``col``: the frame column."""
    width = width or max(COLS, columns)
    lanes = list(blocks) if blocks is not None else list(range(min(columns, width)))
    span = len(lanes)
    font_key = "native"
    font = FONT_MAPS[font_key]
    glyphs = [font.get(char, []) for char in text]
    advances = [char_advance(font_key, char, glyph) for char, glyph in zip(text, glyphs)]
    total_width = (sum(advances) - 1) if advances else 0
    for index, char in enumerate(text):
        if total_width <= span:
            break
        if char in ":." and index > 0 and advances[index - 1] > 1:
            # The digit before it, then the separator itself, lose their gap.
            advances[index - 1] -= 1
            total_width -= 1
            if total_width > span and advances[index] > 1:
                advances[index] -= 1
                total_width -= 1
    offset = max(0, (span - total_width) // 2)
    pixels = []
    for char_index, (char, glyph, advance) in enumerate(zip(text, glyphs, advances)):
        if char == ":" and not colon_visible:
            offset += advance
            continue
        for position in glyph:
            # The glyph's cell (the font is kept 20 columns wide).
            row, glyph_col = divmod(position, COLS)
            lane = glyph_col + offset
            if 0 <= lane < span and 0 <= row < ROWS:
                col = lanes[lane]
                at = row * width + col
                # Turned: a half turn across the digits' columns.
                if turned:
                    at = (ROWS - 1 - row) * width + lanes[span - 1 - lane]
                targets = (
                    clock_digit_targets(at, digit_flags, columns * ROWS) if width == COLS
                    else clock_digit_targets(at, digit_flags, columns * ROWS, width=width)
                )
                for index in targets:
                    pixels.append((index, char_index, col))
        offset += advance
    return pixels
