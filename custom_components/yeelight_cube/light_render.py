"""Matrix rendering for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin.  Turns the current mode/text/colours into a
100-pixel matrix: the mode router (:meth:`_apply_display_mode_internal`), letter
and pixel placement, gradient/offset maths and orientation flips.  Reads/writes
state via ``self``; used only as a mixin.
"""
import copy
import logging
import math
import random
import traceback

from .color_utils import hex_to_rgb, rgb_to_hex
from .const import (
    DEFAULT_MATRIX_DISPLAY_MODE,
    MATRIX_DISPLAY_MODES,
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
            _LOGGER.debug(f"[SCROLL] Scrolling mode: width={total_text_width}, max_offset={self._max_scroll_offset}, current_offset={self._scroll_offset}, returning={offset}")
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
            _LOGGER.debug(f"[NORMAL] Normal positioning: width={total_text_width}, alignment={self._alignment}, returning={offset}")
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

    async def _apply_display_mode_internal(self, skip_post_delay: bool = False):
        """Internal method that actually applies the display mode - called by queue processor"""
        try:
            if self._mode == "Clock":
                self._is_scrolling = False
                self.stop_scroll_timer()
                await self._activate_native_clock()
                return
            if self._mode == "Native Effect":
                self._is_scrolling = False
                self.stop_scroll_timer()
                await self._activate_native_effect()
                return

            background_color_hex = rgb_to_hex(self._background_color)
            _LOGGER.debug(f"Setting background color: {background_color_hex}")
            for module in self._layout.device_layout:
                module.set_colors([background_color_hex])
            # Priority: custom drawing if present and custom_draw_active, else text
            if getattr(self, '_custom_draw_active', False) and self._custom_pixels:
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
                await self.apply(skip_post_delay=skip_post_delay)
                return
            # If not in custom draw mode, clear custom pixels so text/other modes work as expected
            if not getattr(self, '_custom_draw_active', False):
                self._custom_pixels = None
            if self._custom_text or self._full_panel:
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
                        f"[DISPLAY] [{self._ip}] Panel mode: rendering virtual full-panel character "
                        f"(mode='{self._mode}', colors={len(self._text_colors) if self._text_colors else 0} stops)"
                    )
                else:
                    effective_text = self._custom_text
                    total_columns = TOTAL_COLUMNS
                    total_text_width = sum(self._char_advance(letter) for letter in self._custom_text) - 1
                    current_offset = self.calculate_text_offset(total_text_width, total_columns)
                _LOGGER.debug(f"[DISPLAY] Rendering text: '{effective_text}' with mode: '{self._mode}' and colors: {self._text_colors}")
                _LOGGER.debug(f"[DISPLAY] Text layout - total_width: {total_text_width}, offset: {current_offset}")
                
                # Debug: Check if we have proper text colors
                _LOGGER.debug(f"[DISPLAY] Text colors check - _text_colors: {self._text_colors}, type: {type(self._text_colors)}")
                if not self._text_colors:
                    _LOGGER.warning(f"[DISPLAY] No text colors set! Using default red.")
                
                def get_color(idx=None, factor=None, position=None, total=None):
                    if self._mode == "Solid Color":
                        return [self._text_colors[0]] if self._text_colors else [(255,0,0)]
                    elif self._mode == "Letter Gradient":
                        n = len(effective_text)
                        return [self.calculate_multi_gradient_color(self._text_colors, idx, n)]
                    elif self._mode in ["Column Gradient", "Row Gradient", "Angle Gradient", "Radial Gradient", "Letter Angle Gradient", "Letter Vertical Gradient"]:
                        return self._text_colors if self._text_colors else [(255,0,0), (0,0,255)]
                    elif self._mode == "Text Color Sequence":
                        return self._text_colors if self._text_colors else [(255,0,0)]
                    else:
                        return [self._text_colors[0]] if self._text_colors else [(255,0,0)]

                if self._mode == "Solid Color":
                    color = get_color()
                    if isinstance(color, list):
                        color = color[0]
                    text_color_hex = rgb_to_hex(tuple(color))
                    _LOGGER.debug(f"[DISPLAY] Solid color mode - color: {color}, hex: {text_color_hex}")
                    self.place_letters(text_color_hex, effective_text, current_offset, flip=True)
                elif self._mode == "Text Color Sequence":
                    # Fully randomize: shuffle both color list and pixel positions for each letter
                    colors = get_color()
                    if not colors:
                        colors = [(255,0,0)]
                    shuffled_colors = colors[:]
                    random.shuffle(shuffled_colors)
                    
                    pixel_index = 0
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        positions = letter_positions[:]
                        random.shuffle(positions)
                        for pos in positions:
                            adjusted_pos = pos + current_offset
                            
                            # Apply same bounds checking as in place_letters
                            if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                # Calculate the virtual column this pixel would be in
                                orig_col = pos % TOTAL_COLUMNS
                                virtual_col = orig_col + current_offset
                                
                                # Only show pixels that are in the visible window (columns 0-19 of the virtual text)
                                if 0 <= virtual_col < TOTAL_COLUMNS:
                                    color = shuffled_colors[pixel_index % len(shuffled_colors)]
                                    color_hex = rgb_to_hex(color)
                                    self.place_pixels(color_hex, self._flip_positions([adjusted_pos]))
                            pixel_index += 1
                        current_offset += self._char_advance(letter)
                elif self._mode == "Letter Gradient":
                    for i, letter in enumerate(effective_text):
                        gradient_color = get_color(i)
                        if isinstance(gradient_color, list):
                            gradient_color = gradient_color[0]
                        color_hex = rgb_to_hex(tuple(gradient_color))
                        self.place_letters_for_single_letter(color_hex, letter, i, current_offset, flip=True)
                elif self._mode == "Column Gradient":
                    colors = get_color()
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        letter_width = self.letter_size(letter_positions)
                        for col_index in range(letter_width):
                            grid_col = (col_index + current_offset) % total_columns
                            overall_col = col_index + current_offset
                            col_color = self.calculate_multi_gradient_color(
                                colors, overall_col, total_text_width
                            )
                            if isinstance(col_color, list):
                                col_color = col_color[0]
                            col_color_hex = rgb_to_hex(tuple(col_color))
                            # Filter positions with bounds checking
                            colored_positions = []
                            for pos in letter_positions:
                                adjusted_pos = pos + current_offset
                                if (0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS) and
                                    adjusted_pos % total_columns == grid_col):
                                    # Calculate the virtual column this pixel would be in
                                    orig_col = pos % TOTAL_COLUMNS
                                    virtual_col = orig_col + current_offset
                                    # Only show pixels that are in the visible window (columns 0-19 of the virtual text)
                                    if 0 <= virtual_col < TOTAL_COLUMNS:
                                        colored_positions.append(adjusted_pos)
                            
                            if colored_positions:
                                self.place_pixels(col_color_hex, self._flip_positions(colored_positions))
                        current_offset += self._char_advance(letter)
                elif self._mode == "Row Gradient":
                    colors = get_color()
                    total_rows = TOTAL_ROWS
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        letter_width = self.letter_size(letter_positions)
                        for row_index in range(total_rows):
                            row_color = self.calculate_multi_gradient_color(
                                colors, row_index, total_rows
                            )
                            if isinstance(row_color, list):
                                row_color = row_color[0]
                            row_color_hex = rgb_to_hex(tuple(row_color))
                            # Filter positions with bounds checking
                            row_positions = []
                            for pos in letter_positions:
                                if pos // total_columns == row_index:
                                    adjusted_pos = pos + current_offset
                                    if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                        # Calculate the virtual column this pixel would be in
                                        orig_col = pos % TOTAL_COLUMNS
                                        virtual_col = orig_col + current_offset
                                        # Only show pixels that are in the visible window (columns 0-19 of the virtual text)
                                        if 0 <= virtual_col < TOTAL_COLUMNS:
                                            row_positions.append(adjusted_pos)
                            
                            if row_positions:
                                self.place_pixels(row_color_hex, self._flip_positions(row_positions))
                        current_offset += self._char_advance(letter)
                elif self._mode == "Angle Gradient":
                    colors = get_color()
                    angle_radians = math.radians(self._angle)
                    dx = math.cos(angle_radians)
                    dy = math.sin(angle_radians)
                    # Center of the display
                    center_col = (total_columns - 1) / 2
                    center_row = (TOTAL_ROWS - 1) / 2
                    # Compute min/max projection for normalization
                    corners = [(-(center_col), -(center_row)), (center_col, -(center_row)), (-(center_col), center_row), (center_col, center_row)]
                    projections = [col * dx + row * dy for col, row in corners]
                    min_proj = min(projections)
                    max_proj = max(projections)
                    proj_range = max_proj - min_proj if max_proj != min_proj else 1
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        for pos in letter_positions:
                            adjusted_pos = pos + current_offset
                            
                            if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                orig_col = pos % TOTAL_COLUMNS
                                virtual_col = orig_col + current_offset
                                
                                if 0 <= virtual_col < TOTAL_COLUMNS:
                                    row, col = divmod(adjusted_pos, total_columns)
                                    centered_col = col - center_col
                                    centered_row = row - center_row
                                    projection = centered_col * dx + centered_row * dy
                                    normalized_projection = (projection - min_proj) / proj_range
                                    gradient_color = self.calculate_multi_gradient_color(
                                        colors,
                                        normalized_projection * (len(colors) - 1), len(colors)
                                    )
                                    gradient_color_hex = rgb_to_hex(tuple(min(255, max(0, v)) for v in gradient_color))
                                    self.place_pixels(gradient_color_hex, self._flip_positions([adjusted_pos]))
                        current_offset += self._char_advance(letter)
                elif self._mode == "Radial Gradient":
                    colors = get_color()
                    # Center of the display
                    center_col = (total_columns - 1) / 2
                    center_row = (TOTAL_ROWS - 1) / 2
                    # Max distance from center to a corner
                    max_dist = math.sqrt(center_col ** 2 + center_row ** 2)
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        for pos in letter_positions:
                            adjusted_pos = pos + current_offset
                            
                            if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                orig_col = pos % TOTAL_COLUMNS
                                virtual_col = orig_col + current_offset
                                
                                if 0 <= virtual_col < TOTAL_COLUMNS:
                                    row, col = divmod(adjusted_pos, total_columns)
                                    dx_ = col - center_col
                                    dy_ = row - center_row
                                    dist = math.sqrt(dx_ ** 2 + dy_ ** 2)
                                    norm = dist / max_dist if max_dist > 0 else 0
                                    gradient_color = self.calculate_multi_gradient_color(
                                        colors,
                                        norm * (len(colors) - 1), len(colors)
                                    )
                                    gradient_color_hex = rgb_to_hex(tuple(min(255, max(0, v)) for v in gradient_color))
                                    self.place_pixels(gradient_color_hex, self._flip_positions([adjusted_pos]))
                        current_offset += self._char_advance(letter)
                elif self._mode == "Letter Angle Gradient":
                    colors = get_color()
                    angle_radians = math.radians(self._angle)
                    dx = math.cos(angle_radians)
                    dy = math.sin(angle_radians)
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        if not letter_positions:
                            current_offset += self._char_advance(letter)
                            continue
                        rows = []
                        cols = []
                        for pos in letter_positions:
                            row, col = divmod(pos + current_offset, total_columns)
                            rows.append(row)
                            cols.append(col)
                        # For single-column letters, use a virtual 3-column, full-height box centered on the letter's column
                        if len(set(cols)) == 1:
                            col = cols[0]
                            min_row, max_row = 0, TOTAL_ROWS - 1
                            min_col = max(0, col - 1)
                            max_col = min(TOTAL_COLUMNS - 1, col + 1)
                            center_row = (min_row + max_row) / 2
                            center_col = (min_col + max_col) / 2
                        else:
                            min_row, max_row = min(rows), max(rows)
                            min_col, max_col = min(cols), max(cols)
                            center_row = (min_row + max_row) / 2
                            center_col = (min_col + max_col) / 2
                        # Compute min/max projection for normalization (corners of bounding box)
                        corners = [
                            (min_col, min_row),
                            (max_col, min_row),
                            (min_col, max_row),
                            (max_col, max_row)
                        ]
                        projections = [(col_ - center_col) * dx + (row_ - center_row) * dy for col_, row_ in corners]
                        min_proj = min(projections)
                        max_proj = max(projections)
                        proj_range = max_proj - min_proj if max_proj != min_proj else 1
                        for pos in letter_positions:
                            adjusted_pos = pos + current_offset
                            
                            if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                orig_col = pos % TOTAL_COLUMNS
                                virtual_col = orig_col + current_offset
                                
                                if 0 <= virtual_col < TOTAL_COLUMNS:
                                    row, col = divmod(adjusted_pos, total_columns)
                                    centered_col = col - center_col
                                    centered_row = row - center_row
                                    projection = centered_col * dx + centered_row * dy
                                    normalized_projection = (projection - min_proj) / proj_range
                                    gradient_color = self.calculate_multi_gradient_color(
                                        colors,
                                        normalized_projection * (len(colors) - 1), len(colors)
                                    )
                                    gradient_color_hex = rgb_to_hex(tuple(min(255, max(0, v)) for v in gradient_color))
                                    self.place_pixels(gradient_color_hex, self._flip_positions([adjusted_pos]))
                        current_offset += self._char_advance(letter)
                elif self._mode == "Letter Vertical Gradient":
                    colors = get_color()
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        letter_width = self.letter_size(letter_positions)
                        if letter_width <= 0:
                            continue
                        if letter_width == 1:
                            # Use the center of the gradient for single-column letters
                            center_index = (len(colors) - 1) / 2
                            gradient_color = self.calculate_multi_gradient_color(
                                colors, center_index, len(colors)
                            )
                            gradient_color_hex = rgb_to_hex(tuple(min(255, max(0, val)) for val in gradient_color))
                            # Filter positions before placing pixels
                            valid_positions = []
                            for pos in letter_positions:
                                adjusted_pos = pos + current_offset
                                if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                    orig_col = pos % TOTAL_COLUMNS
                                    virtual_col = orig_col + current_offset
                                    if 0 <= virtual_col < TOTAL_COLUMNS:
                                        valid_positions.append(adjusted_pos)
                            
                            if valid_positions:
                                self.place_pixels(
                                    gradient_color_hex,
                                    self._flip_positions(valid_positions)
                                )
                        else:
                            for col_index in range(letter_width):
                                gradient_color = self.calculate_multi_gradient_color(
                                    colors, col_index, letter_width
                                )
                                gradient_color_hex = rgb_to_hex(tuple(min(255, max(0, val)) for val in gradient_color))
                                column_positions = [
                                    pos for pos in letter_positions
                                    if (pos % total_columns) == col_index
                                ]
                                # Filter positions before placing pixels
                                valid_positions = []
                                for pos in column_positions:
                                    adjusted_pos = pos + current_offset
                                    if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                                        orig_col = pos % TOTAL_COLUMNS
                                        virtual_col = orig_col + current_offset
                                        if 0 <= virtual_col < TOTAL_COLUMNS:
                                            valid_positions.append(adjusted_pos)
                                
                                if valid_positions:
                                    self.place_pixels(
                                        gradient_color_hex,
                                        self._flip_positions(valid_positions)
                                    )
                        current_offset += self._char_advance(letter)
                
                # Apply changes for text modes
                _LOGGER.debug(f"[DISPLAY] Text rendering complete, about to apply() to lamp")
                _LOGGER.debug(f"[DISPLAY] Current lamp state before apply - modules with colors:")
                for i, module in enumerate(self._layout.device_layout):
                    colors = getattr(module, '_colors', None)
                    _LOGGER.debug(f"[DISPLAY] Module {i}: colors={colors}")
                
                # Skip post-delay when scrolling to maintain smooth animation timing
                await self.apply(skip_post_delay=skip_post_delay or self._is_scrolling)
                _LOGGER.debug(f"[DISPLAY] Text apply() completed successfully")
                
                # Start scroll timer if text is longer than display and scrolling is enabled
                if self._max_scroll_offset > 0 and self._scroll_enabled:
                    _LOGGER.debug(f"[SCROLL] Starting scroll timer for long text (max_offset: {self._max_scroll_offset})")
                    self._is_scrolling = True
                    self.start_scroll_timer()
                else:
                    # Stop scrolling if text fits or scrolling is disabled
                    self._is_scrolling = False
                    self.stop_scroll_timer()
            # Handle Panel Color Sequence mode (applies colors to all modules, not just text)
            elif self._mode == "Panel Color Sequence":
                _LOGGER.debug(f"[Panel Color Sequence] Applying mode with {len(self._text_colors) if self._text_colors else 0} colors")
                if self._text_colors:
                    colors = self._text_colors
                    for i, module in enumerate(self._layout.device_layout):
                        color = colors[i % len(colors)]
                        if isinstance(color, (list, tuple)) and len(color) == 3:
                            color = tuple(max(0, min(255, int(c))) for c in color)
                            hex_color = rgb_to_hex(color)
                        else:
                            _LOGGER.warning(f"[Panel Color Sequence] Invalid color format at index {i}: {color}, using red fallback")
                            hex_color = '#ff0000'
                        module.set_colors([hex_color])
                        _LOGGER.debug(f"[Panel Color Sequence] Module {i}: {hex_color}")
                else:
                    # If no colors are set, use a default red color for all modules
                    _LOGGER.warning("[Panel Color Sequence] No colors set, using red for all modules")
                    default_color = '#ff0000'
                    for module in self._layout.device_layout:
                        module.set_colors([default_color])
                _LOGGER.debug("[Panel Color Sequence] About to apply changes to lamp")
                await self.apply(skip_post_delay=skip_post_delay)
                _LOGGER.debug("[Panel Color Sequence] Changes applied successfully")
            else:
                # No text, no panel mode, no pixel art, no special mode.
                # All modules were already set to background color above.
                # Push that background-only display to the Cube so the lamp
                # actually shows it (e.g., when panel mode is turned OFF with
                # no text set -- without this, the lamp stays on the old display).
                _LOGGER.debug(
                    f"[DISPLAY] [{self._ip}] No content to render "
                    f"(text='{self._custom_text}', panel={self._full_panel}, "
                    f"draw_active={getattr(self, '_custom_draw_active', False)}, "
                    f"mode='{self._mode}') -- pushing background-only display"
                )
                await self.apply(skip_post_delay=skip_post_delay)
        except Exception as e:
            # Connection-related errors are expected and handled by the queue processor
            # which schedules retries. Only log at DEBUG to avoid duplicate noise.
            # The queue processor already logs the same error with full context.
            error_msg = str(e).lower()
            if any(kw in error_msg for kw in ['socket', 'closed', 'connection', 'cooldown', 'timeout', 'none']):
                _LOGGER.debug(f"[DISPLAY] [{self._ip}] Connection error in apply_display_mode (re-raising for retry): {e}")
            else:
                _LOGGER.error(f"[DISPLAY] [{self._ip}] Unexpected error during apply_display_mode: {e}")
            # Re-raise so the queue processor sees the failure and schedules
            # a display retry. Previously this was swallowed here, which meant
            # socket errors from apply() never reached the queue processor.
            raise

    def _filter_visible_positions(self, positions: list, offset: int) -> list:
        """Filter pixel positions to only those visible in the display window.
        
        Applies bounds checking and virtual-column filtering to ensure only
        pixels within the visible 5x20 matrix are included.
        
        Args:
            positions: List of base pixel positions (from font map)
            offset: Horizontal offset to apply to each position
            
        Returns:
            List of adjusted positions that are within the visible window
        """
        max_pos = TOTAL_COLUMNS * TOTAL_ROWS
        visible = []
        for pos in positions:
            adjusted = pos + offset
            if 0 <= adjusted < max_pos:
                virtual_col = (pos % TOTAL_COLUMNS) + offset
                if 0 <= virtual_col < TOTAL_COLUMNS:
                    visible.append(adjusted)
        return visible

    def place_letters_for_single_letter(self, color: str, letter: str, letter_index: int, current_offset: int, flip=False):
        space_to_add = current_offset
        if letter_index > 0:
            for i in range(letter_index):
                space_to_add += self._char_advance(self._custom_text[i])
        letter_positions = self.get_positions_for_letter(letter)
        valid_positions = self._filter_visible_positions(letter_positions, space_to_add)
        
        if valid_positions:
            if flip:
                valid_positions = self._flip_positions(valid_positions)
            self.place_pixels(color, valid_positions)

    def place_letters(self, color: str, letters: str, current_offset: int, flip=False):
        _LOGGER.debug(f"[PLACE_LETTERS] Starting with color: {color}, letters: '{letters}', offset: {current_offset}, flip: {flip}")
        
        # Calculate total text width for debugging
        total_width = sum(self._char_advance(letter) for letter in letters) - 1
        _LOGGER.debug(f"[PLACE_LETTERS] Total text width: {total_width} columns, display width: {TOTAL_COLUMNS}")
        
        space_to_add = current_offset
        total_pixels_placed = 0
        for i in range(len(letters)):
            if i > 0:
                prev_advance = self._char_advance(letters[i - 1])
                space_to_add += prev_advance
                _LOGGER.debug(f"[PLACE_LETTERS] Letter {i}: added {prev_advance} to offset (prev letter '{letters[i - 1]}')")
            
            letter_positions = self.get_positions_for_letter(letters[i])
            _LOGGER.debug(f"[PLACE_LETTERS] Letter '{letters[i]}' at index {i}: base_positions={letter_positions}, space_to_add={space_to_add}")
            
            # Calculate adjusted positions for this letter
            adjusted_positions = [pos + space_to_add for pos in letter_positions]
            _LOGGER.debug(f"[PLACE_LETTERS] Letter '{letters[i]}': adjusted_positions={adjusted_positions[:5]}{'...' if len(adjusted_positions) > 5 else ''}")
            
            visible_positions = []
            
            for orig_pos in letter_positions:
                adjusted_pos = orig_pos + space_to_add
                
                # Check bounds and visible window
                if 0 <= adjusted_pos < (TOTAL_COLUMNS * TOTAL_ROWS):
                    virtual_col = (orig_pos % TOTAL_COLUMNS) + space_to_add
                    if 0 <= virtual_col < TOTAL_COLUMNS:
                        visible_positions.append(adjusted_pos)
            
            # Only place pixels that are visible
            if visible_positions:
                if flip:
                    visible_positions = self._flip_positions(visible_positions)
                _LOGGER.debug(f"[PLACE_LETTERS] Letter '{letters[i]}': visible_pixels={len(visible_positions)}/{len(adjusted_positions)} (offset: {space_to_add})")
                self.place_pixels(color, visible_positions)
                total_pixels_placed += len(visible_positions)
            else:
                _LOGGER.debug(f"[PLACE_LETTERS] Letter '{letters[i]}': no visible pixels (fully scrolled off, offset: {space_to_add})")
                
        _LOGGER.debug(f"[PLACE_LETTERS] Completed placing {total_pixels_placed} total pixels")

    def place_pixels(self, color: str, positions):
        _LOGGER.debug(f"[PLACE_PIXELS] Placing {len(positions)} pixels with color: {color}")
        _LOGGER.debug(f"[PLACE_PIXELS] Positions: {positions}")
        
        # Track bad positions and log stack trace
        bad_positions = [pos for pos in positions if pos < 0 or pos >= len(self._layout.device_layout)]
        if bad_positions:
            _LOGGER.error(f"[PLACE_PIXELS] BAD POSITIONS DETECTED: {bad_positions}")
            _LOGGER.error(f"[PLACE_PIXELS] Stack trace:\n{''.join(traceback.format_stack())}")
        
        current_colors = [color]
        pixels_placed = 0
        for pos in positions:
            if 0 <= pos < len(self._layout.device_layout):
                if isinstance(self._layout.device_layout[pos], Module):
                    self._layout.device_layout[pos].set_colors(current_colors)
                    pixels_placed += 1
                else:
                    _LOGGER.warning(f"[PLACE_PIXELS] Position {pos} is not a Module: {type(self._layout.device_layout[pos])}")
            else:
                _LOGGER.warning(f"[PLACE_PIXELS] Position {pos} is out of bounds (0-{len(self._layout.device_layout)-1})")
        _LOGGER.debug(f"[PLACE_PIXELS] Successfully placed {pixels_placed}/{len(positions)} pixels")

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
        _LOGGER.debug(f"[GET_POSITIONS] Letter '{letter}' in font '{self._font}': {len(positions)} positions = {positions}")
        if not positions:
            _LOGGER.warning(f"[GET_POSITIONS] No positions found for letter '{letter}' in font '{self._font}'")
        return positions
