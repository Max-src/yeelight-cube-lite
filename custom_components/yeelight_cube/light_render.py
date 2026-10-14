"""Matrix rendering for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin.  Turns the current mode/text/colors into a
100-pixel matrix: the mode router (:meth:`_apply_display_mode_internal`), letter
and pixel placement, gradient/offset maths and orientation flips.  Reads/writes
state via ``self``; used only as a mixin.
"""
import logging
import math
import random
import traceback

from .color_utils import rgb_to_hex
from .cube_matrix import is_connection_error, is_quota_error
from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ORIENTATION_NORMAL,
    PANEL_FULL_CHAR,
    TEXT_RENDER_MODES,
)
from .layout import FONT_MAPS, Module, TOTAL_COLUMNS, TOTAL_ROWS, char_advance

_LOGGER = logging.getLogger(__name__)


class MatrixRenderMixin:
    """Render text / gradients / pixel-art into the 5x20 matrix."""

    def calculate_gradient_color(self, start_color, end_color, position, total_positions):
        def interpolate(start, end, factor):
            factor = max(0, min(1, factor))
            return min(255, max(0, round(start + (end - start) * factor)))
        if total_positions <= 1:
            return start_color
        factor = position / (total_positions - 1)
        return tuple(
            interpolate(start, end, factor)
            for start, end in zip(start_color, end_color)
        )

    def calculate_text_offset(self, total_text_width: int, total_columns: int = TOTAL_COLUMNS) -> int:
        # Check if text needs scrolling - always scroll when text is too long
        if total_text_width > total_columns:
            # Text is too long, use scroll offset - always start from left edge for scrolling text
            self._max_scroll_offset = total_text_width - total_columns
            # Clamp scroll offset to valid range
            self._scroll_offset = max(0, min(self._scroll_offset, self._max_scroll_offset))
            offset = -self._scroll_offset  # Negative offset to move text left (0 at start)
            _LOGGER.debug("[SCROLL] Scrolling mode: width=%s, max_offset=%s, current_offset=%s, returning=%s", total_text_width, self._max_scroll_offset, self._scroll_offset, offset)
            return offset
        else:
            # Text fits or scrolling disabled, use normal alignment
            self._max_scroll_offset = 0
            self._scroll_offset = 0
            if self._alignment == "center":
                offset = (total_columns - total_text_width) // 2
            elif self._alignment == "right":
                offset = total_columns - total_text_width
            else:
                offset = 0
            return offset

    def _flip_position(self, pos, total_columns=TOTAL_COLUMNS, total_rows=TOTAL_ROWS):
        """
        Flip a linear position index for the matrix if orientation is flipped.
        """
        if self._orientation == ORIENTATION_NORMAL:
            return pos
        # Flip both row and column (180 deg rotation)
        row, col = divmod(pos, total_columns)
        flipped_row = total_rows - 1 - row
        flipped_col = total_columns - 1 - col
        return flipped_row * total_columns + flipped_col

    def _flip_positions(self, positions, total_columns=TOTAL_COLUMNS, total_rows=TOTAL_ROWS):
        return [self._flip_position(pos, total_columns, total_rows) for pos in positions]

    async def _apply_display_mode_internal(self):
        """Internal method that actually applies the display mode - called by queue processor"""
        # Re-applying anything resumes the display after a freeze_display.
        self._display_frozen = False
        self._display_frozen_at = None
        try:
            if self._mode == MODE_CLOCK:
                self._is_scrolling = False
                self.stop_scroll_timer()
                await self._activate_native_clock()
                return
            if self._mode == MODE_NATIVE_EFFECT:
                self._is_scrolling = False
                self.stop_scroll_timer()
                await self._activate_native_effect()
                return

            background_color_hex = rgb_to_hex(self._background_color)
            for module in self._layout.device_layout:
                module.set_colors([background_color_hex])
            # Priority: custom drawing if present and custom_draw_active, else text
            if self._custom_draw_active and self._custom_pixels:
                # Pixel art always uses a black background — missing positions = black
                for module in self._layout.device_layout:
                    module.set_colors(["#000000"])
                # Normalize to exactly 100 positions:
                #   - positions >= 100 are ignored
                #   - last definition of a position wins (later entries override earlier)
                #   - missing positions default to black
                pixel_map = {}
                for px in self._custom_pixels:
                    if not isinstance(px, dict):
                        continue
                    pos = px.get("position")
                    color = px.get("color")
                    if not isinstance(pos, int) or pos < 0 or pos >= 100:
                        continue
                    # Validate and normalize color — must be list/tuple of 3 ints
                    if not isinstance(color, (list, tuple)) or len(color) < 3:
                        pixel_map[pos] = None  # explicitly black
                        continue
                    try:
                        r, g, b = int(color[0]), int(color[1]), int(color[2])
                    except (TypeError, ValueError, IndexError):
                        pixel_map[pos] = None
                        continue
                    pixel_map[pos] = (r, g, b)
                color_groups = {}
                for pos, rgb in pixel_map.items():
                    if rgb is None or (rgb[0] == 0 and rgb[1] == 0 and rgb[2] == 0):
                        continue  # background (black) already set
                    color_hex = rgb_to_hex(rgb)
                    color_groups.setdefault(color_hex, []).append(pos)
                for color_hex, positions in color_groups.items():
                    self.place_pixels(color_hex, self._flip_positions(positions))
                self._remember_drawing()
                await self.apply()
                return
            # If not in custom draw mode, clear custom pixels so text/other modes work as expected
            if not self._custom_draw_active:
                self._custom_pixels = None
            if self._mode == "Panel Color Sequence":
                # The colors fill the panel one module after another; any text
                # or full-panel setting is kept for the text modes.
                self._is_scrolling = False
                self.stop_scroll_timer()
                self._place_frame(self._panel_sequence_frame(self._text_colors))
                await self.apply()
            elif self._custom_text or self._full_panel:
                # SAFETY NET: the text/gradient renderer below only handles the
                # text render modes.  If we reach here with a non-text mode
                # left over -- e.g. "Custom Draw" after a pixel art was cleared
                # by a text call (set_custom_text sets _custom_draw_active=False
                # but the mode string lingers) -- NONE of the mode branches match
                # and the panel renders all-black.  Normalise any unrecognised
                # mode to "Solid Color" so text is ALWAYS rendered.  This keeps
                # every pixel-art -> text (and similar) transition reliable.
                if self._mode not in TEXT_RENDER_MODES:
                    _LOGGER.debug(
                        "[DISPLAY] [%s] Normalising non-text mode '%s' -> 'Solid Color' for text render",
                        self._ip, self._mode,
                    )
                    self._mode = "Solid Color"
                    if self._matrix_mode not in TEXT_RENDER_MODES:
                        self._matrix_mode = "Solid Color"
                # --- Panel mode override -----------------------------------
                # When full_panel is on, replace the actual text with a single
                # virtual character (PANEL_FULL_CHAR) that covers every pixel
                # on the 5x20 display.  All rendering modes then see one
                # "giant letter" filling the whole panel and work through the
                # normal text rendering path -- no special branches needed.
                if self._full_panel:
                    effective_text = PANEL_FULL_CHAR  # single char whose positions = all 100 pixels
                    total_columns = TOTAL_COLUMNS
                    total_text_width = TOTAL_COLUMNS  # fills the full width
                    current_offset = 0  # no alignment shift -- it already covers everything
                    _LOGGER.debug(
                        "[DISPLAY] [%s] Panel mode: rendering virtual full-panel character "
                        "(mode='%s', colors=%s stops)",
                        self._ip, self._mode,
                        len(self._text_colors) if self._text_colors else 0
                    )
                else:
                    effective_text = self._custom_text
                    total_columns = TOTAL_COLUMNS
                    total_text_width = sum(self._char_advance(letter) for letter in self._custom_text) - 1
                    current_offset = self.calculate_text_offset(total_text_width, total_columns)
                _LOGGER.debug("[DISPLAY] Rendering text: '%s' with mode: '%s' and colors: %s", effective_text, self._mode, self._text_colors)
                _LOGGER.debug("[DISPLAY] Text layout - total_width: %s, offset: %s", total_text_width, current_offset)
                
                # Debug: Check if we have proper text colors
                _LOGGER.debug("[DISPLAY] Text colors check - _text_colors: %s, type: %s", self._text_colors, type(self._text_colors))
                if not self._text_colors:
                    _LOGGER.warning("[DISPLAY] No text colors set! Using default red.")
                
                self._place_frame(self._text_mode_frame(
                    self._mode, effective_text, self._text_colors,
                    self._angle, current_offset, total_text_width,
                ))

                # Apply changes for text modes
                _LOGGER.debug("[DISPLAY] Text rendering complete, about to apply() to lamp")
                _LOGGER.debug("[DISPLAY] Current lamp state before apply - modules with colors:")
                for i, module in enumerate(self._layout.device_layout):
                    colors = getattr(module, '_colors', None)
                    _LOGGER.debug("[DISPLAY] Module %s: colors=%s", i, colors)
                
                # Skip post-delay when scrolling to maintain smooth animation timing
                await self.apply()
                _LOGGER.debug("[DISPLAY] Text apply() completed successfully")
                
                # Start scroll timer if text is longer than display and scrolling is enabled
                if self._max_scroll_offset > 0 and self._scroll_enabled:
                    _LOGGER.debug("[SCROLL] Starting scroll timer for long text (max_offset: %s)", self._max_scroll_offset)
                    self._is_scrolling = True
                    self.start_scroll_timer()
                else:
                    # Stop scrolling if text fits or scrolling is disabled
                    self._is_scrolling = False
                    self.stop_scroll_timer()
            else:
                # No text, no panel mode, no pixel art, no special mode.
                # All modules were already set to background color above.
                # Push that background-only display to the Cube so the lamp
                # actually shows it (e.g., when panel mode is turned OFF with
                # no text set -- without this, the lamp stays on the old display).
                _LOGGER.debug(
                    "[DISPLAY] [%s] No content to render "
                    "(text='%s', panel=%s, "
                    "draw_active=%s, "
                    "mode='%s') -- pushing background-only display",
                    self._ip, self._custom_text, self._full_panel,
                    self._custom_draw_active, self._mode
                )
                await self.apply()
        except Exception as e:
            # Connection-related errors are expected and handled by the queue processor
            # which schedules retries. Only log at DEBUG to avoid duplicate noise.
            # The queue processor already logs the same error with full context.
            if is_connection_error(e) or is_quota_error(e):
                _LOGGER.debug("[DISPLAY] [%s] Connection error in apply_display_mode (re-raising for retry): %s", self._ip, e)
            else:
                _LOGGER.error("[DISPLAY] [%s] Unexpected error during apply_display_mode: %s", self._ip, e)
            # Re-raise so the queue processor sees the failure and schedules
            # a display retry. Previously this was swallowed here, which meant
            # socket errors from apply() never reached the queue processor.
            raise

    # The gradient modes' colors when none are set (the others: red).
    _GRADIENT_TEXT_MODES = (
        "Column Gradient", "Row Gradient", "Angle Gradient", "Radial Gradient",
        "Letter Angle Gradient", "Letter Vertical Gradient",
    )

    def _place_frame(self, frame):
        """Light a frame's pixels (100 colors in panel order, None: the
        background), turned round on a flipped lamp."""
        by_color = {}
        for pos, color in enumerate(frame):
            if color is not None:
                by_color.setdefault(rgb_to_hex(tuple(color)), []).append(pos)
        for color_hex, positions in by_color.items():
            self.place_pixels(color_hex, self._flip_positions(positions))

    @staticmethod
    def _panel_sequence_frame(colors):
        """Panel Color Sequence: the colors one module after another over the
        whole panel (red when none is set; an invalid color: red)."""
        sequence = [
            tuple(max(0, min(255, int(c))) for c in color)
            if isinstance(color, (list, tuple)) and len(color) == 3
            else (255, 0, 0)
            for color in (colors or [(255, 0, 0)])
        ]
        return [
            sequence[pos % len(sequence)]
            for pos in range(TOTAL_COLUMNS * TOTAL_ROWS)
        ]

    def _text_mode_frame(self, mode, text, colors, angle, offset, text_width):
        """The 100 pixels of ``text`` in a text mode, before the orientation
        flip: an RGB tuple where the text lights, else None (the background).
        ``offset`` is the text's first column (alignment or scroll) and
        ``text_width`` its width in columns. The lamp
        (_apply_display_mode_internal) and the gallery previews
        (preview_gradient_modes) both draw from it."""
        frame = [None] * (TOTAL_COLUMNS * TOTAL_ROWS)
        if not colors:
            colors = (
                [(255, 0, 0), (0, 0, 255)]
                if mode in self._GRADIENT_TEXT_MODES
                else [(255, 0, 0)]
            )
        gradient = self.calculate_multi_gradient_color

        def clamp(color):
            return tuple(min(255, max(0, value)) for value in color)

        def shown(pos, letter_offset):
            # On the panel, and inside the visible 20 columns of the text.
            return (
                0 <= pos + letter_offset < len(frame)
                and 0 <= pos % TOTAL_COLUMNS + letter_offset < TOTAL_COLUMNS
            )

        # Each letter: its glyph and the column it starts at.
        letters = []
        for letter in text:
            letters.append((self.get_positions_for_letter(letter), offset))
            offset += self._char_advance(letter)

        if mode == "Text Color Sequence":
            # The colors and each letter's pixels in a random order.
            shuffled = colors[:]
            random.shuffle(shuffled)
            index = 0
            for glyph, letter_offset in letters:
                positions = glyph[:]
                random.shuffle(positions)
                for pos in positions:
                    if shown(pos, letter_offset):
                        frame[pos + letter_offset] = shuffled[index % len(shuffled)]
                    index += 1
            return frame

        if mode in ("Angle Gradient", "Radial Gradient"):
            center_col = (TOTAL_COLUMNS - 1) / 2
            center_row = (TOTAL_ROWS - 1) / 2
            if mode == "Angle Gradient":
                dx = math.cos(math.radians(angle))
                dy = math.sin(math.radians(angle))
                projections = [
                    col * dx + row * dy
                    for col in (-center_col, center_col)
                    for row in (-center_row, center_row)
                ]
                low = min(projections)
                span = (max(projections) - low) or 1

                def place(row, col):
                    return ((col - center_col) * dx + (row - center_row) * dy - low) / span
            else:
                farthest = math.sqrt(center_col ** 2 + center_row ** 2)

                def place(row, col):
                    distance = math.sqrt((col - center_col) ** 2 + (row - center_row) ** 2)
                    return distance / farthest if farthest > 0 else 0

            for glyph, letter_offset in letters:
                for pos in glyph:
                    if shown(pos, letter_offset):
                        row, col = divmod(pos + letter_offset, TOTAL_COLUMNS)
                        frame[pos + letter_offset] = clamp(
                            gradient(colors, place(row, col) * (len(colors) - 1), len(colors))
                        )
            return frame

        for index, (glyph, letter_offset) in enumerate(letters):
            if mode == "Letter Angle Gradient":
                if not glyph:
                    continue
                dx = math.cos(math.radians(angle))
                dy = math.sin(math.radians(angle))
                cells = [divmod(pos + letter_offset, TOTAL_COLUMNS) for pos in glyph]
                rows = [row for row, _ in cells]
                cols = [col for _, col in cells]
                if len(set(cols)) == 1:
                    # A one-column letter: a 3-column, full-height box.
                    min_row, max_row = 0, TOTAL_ROWS - 1
                    min_col = max(0, cols[0] - 1)
                    max_col = min(TOTAL_COLUMNS - 1, cols[0] + 1)
                else:
                    min_row, max_row = min(rows), max(rows)
                    min_col, max_col = min(cols), max(cols)
                center_row = (min_row + max_row) / 2
                center_col = (min_col + max_col) / 2
                projections = [
                    (col - center_col) * dx + (row - center_row) * dy
                    for col in (min_col, max_col)
                    for row in (min_row, max_row)
                ]
                low = min(projections)
                span = (max(projections) - low) or 1
                for pos in glyph:
                    if shown(pos, letter_offset):
                        row, col = divmod(pos + letter_offset, TOTAL_COLUMNS)
                        position = ((col - center_col) * dx + (row - center_row) * dy - low) / span
                        frame[pos + letter_offset] = clamp(
                            gradient(colors, position * (len(colors) - 1), len(colors))
                        )
                continue

            width = self.letter_size(glyph)
            for pos in glyph:
                if not shown(pos, letter_offset):
                    continue
                column = pos % TOTAL_COLUMNS
                if mode == "Letter Gradient":
                    color = gradient(colors, index, len(text))
                elif mode == "Column Gradient":
                    color = gradient(colors, column + letter_offset, text_width)
                elif mode == "Row Gradient":
                    color = gradient(colors, pos // TOTAL_COLUMNS, TOTAL_ROWS)
                elif mode == "Letter Vertical Gradient":
                    # Across the letter's columns (a one-column letter: the
                    # middle of the gradient).
                    color = clamp(
                        gradient(colors, (len(colors) - 1) / 2, len(colors))
                        if width == 1
                        else gradient(colors, column, width)
                    )
                elif mode == "Solid Color":
                    color = colors[0]
                else:
                    # Not a text mode (Panel Color Sequence): nothing drawn.
                    return frame
                frame[pos + letter_offset] = color
        return frame

    def place_pixels(self, color: str, positions):
        
        # Track bad positions and log stack trace
        bad_positions = [pos for pos in positions if pos < 0 or pos >= len(self._layout.device_layout)]
        if bad_positions:
            _LOGGER.error("[PLACE_PIXELS] BAD POSITIONS DETECTED: %s", bad_positions)
            _LOGGER.error("[PLACE_PIXELS] Stack trace:\n%s", ''.join(traceback.format_stack()))
        
        current_colors = [color]
        pixels_placed = 0
        for pos in positions:
            if 0 <= pos < len(self._layout.device_layout):
                if isinstance(self._layout.device_layout[pos], Module):
                    self._layout.device_layout[pos].set_colors(current_colors)
                    pixels_placed += 1
                else:
                    _LOGGER.warning("[PLACE_PIXELS] Position %s is not a Module: %s", pos, type(self._layout.device_layout[pos]))
            else:
                _LOGGER.warning("[PLACE_PIXELS] Position %s is out of bounds (0-%s)", pos, len(self._layout.device_layout)-1)

    def letter_size(self, led_positions):
        unique_columns = set()
        for position in led_positions:
            column_index = position % TOTAL_COLUMNS
            unique_columns.add(column_index)
        return len(unique_columns)

    def _char_advance(self, letter: str) -> int:
        """Columns to advance the cursor after ``letter`` in the current font.

        Delegates to layout.char_advance so the light renderer, the preview
        service and the camera clock preview all share ONE spacing rule.  For a
        proportional font this is the glyph column-span + 1 gap; for a monospace
        font (e.g. "native") it is the font's fixed advance (with per-char
        overrides for narrow glyphs like the colon).
        """
        return char_advance(self._font, letter, self.get_positions_for_letter(letter))

    def get_positions_for_letter(self, letter: str):
        # Panel mode virtual character: covers the entire 5x20 display
        if letter == PANEL_FULL_CHAR:
            return list(range(TOTAL_COLUMNS * TOTAL_ROWS))
        font_map = FONT_MAPS.get(self._font, FONT_MAPS.get("basic", {}))
        positions = font_map.get(letter, [])
        if not positions:
            _LOGGER.warning("[GET_POSITIONS] No positions found for letter '%s' in font '%s'", letter, self._font)
        return positions
