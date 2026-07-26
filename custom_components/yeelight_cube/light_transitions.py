"""Software transition animations for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin.  Renders a transition frame-by-frame between
two 100-pixel colour states and streams each frame to the lamp.  Reads/writes
state via ``self`` (the concrete :class:`YeelightCubeLight`); used only as a mixin.
"""
import asyncio
import logging
import math
import random
import time

from .color_utils import hex_to_rgb, rgb_to_hex
from .layout import TOTAL_COLUMNS, TOTAL_ROWS

_LOGGER = logging.getLogger(__name__)


class TransitionMixin:
    """Frame-by-frame software transitions between two matrix colour states."""

    async def _send_transition_frame(self, frame):
        """Write a single 100-pixel frame to modules and push to the lamp.
        
        Returns True on success, False if the send failed (connection error,
        quota exceeded, etc.).  Callers should break out of the transition
        loop on False -- the post-transition ensure_fx_ready will recover.
        """
        for i, module in enumerate(self._layout.device_layout):
            if i < len(frame):
                module.data = [rgb_to_hex(frame[i])]
        raw_rgb_data = self._layout.get_raw_rgb_data()
        try:
            await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
            return True
        except Exception as e:
            _LOGGER.warning(
                f"[TRANSITION] [{self._ip}] Frame send failed -- aborting transition early: {e}"
            )
            return False

    @staticmethod
    def _lerp_color(c1, c2, t):
        """Linearly interpolate between two RGB tuples. t in [0, 1]."""
        return (
            int(c1[0] + (c2[0] - c1[0]) * t),
            int(c1[1] + (c2[1] - c1[1]) * t),
            int(c1[2] + (c2[2] - c1[2]) * t),
        )

    async def _run_transition(self, from_colors, to_colors):
        """Animate a transition between two sets of pixel colors on the physical lamp.
        
        Opens a CLEAN TCP connection before sending any frames.  The existing
        persistent socket is closed, FX mode is re-activated via fresh TCP
        (``ensure_fx_ready``), and all transition frames are sent on a new
        persistent socket.  This mirrors the pattern used by every other state
        application path and prevents the lamp from locking up when many
        frames are pushed on a stale socket.
        
        Supported transition types:
          - fade_through_black: current -> black -> target
          - direct_crossfade:   linear blend from current -> target
          - random_dissolve:    pixels switch old -> new in random order
          - wipe_right/left/down/up: boundary sweeps in that direction
          - slide_left/right/up/down: old slides out, new enters from opposite side
          - card_from_right/left/top/bottom: new slides over old like a card
          - explode_reform:     pixels scatter outward then converge to new
          - snake:              boustrophedon reveal across rows
          - wave_wipe:          sine-wave boundary sweeps left -> right
          - iris:               circular reveal from center
          - vertical_flip:      rows compress/expand around horizontal axis
          - curtain:            old splits apart revealing new underneath
          - gravity_drop:       old falls off bottom, new drops in from top
          - pixel_migration:    lit pixels travel to new positions with color blend
        
        Args:
            from_colors: List of 100 RGB tuples currently displayed on the lamp.
            to_colors:   List of 100 RGB tuples that will be displayed after transition.
        """
        self._transition_active = True
        try:
            steps = max(1, self._transition_steps)
            duration = max(0.1, self._transition_duration)
            step_delay = duration / steps
            num_pixels = len(from_colors)
            
            # -- Clean TCP: close persistent socket, re-activate FX via fresh TCP --
            # This resets the Cube's FX-mode timer (which counts from activation,
            # not from last command) and gives us a pristine persistent socket for
            # the burst of transition frames that follows.
            _LOGGER.debug(
                f"[TRANSITION] [{self._ip}] Re-activating FX mode via clean TCP "
                f"before transition (fx_age={time.time() - self._last_fx_mode_time:.0f}s)"
            )
            await self.ensure_fx_ready()
            
            _LOGGER.debug(
                f"[TRANSITION] [{self._ip}] Starting '{self._transition_type}' "
                f"({steps} steps, {duration:.1f}s, {step_delay*1000:.0f}ms/frame)"
            )
            
            ttype = self._transition_type

            # -- Fade Through Black ----------------------------------------
            if ttype == "fade_through_black":
                half = max(1, steps // 2)
                remaining = steps - half
                for step in range(steps):
                    if step < half:
                        # Phase 1: current -> black.  Last frame in phase = black.
                        factor = 1.0 - ((step + 1) / half)
                        frame = [
                            (int(r * factor), int(g * factor), int(b * factor))
                            for r, g, b in from_colors
                        ]
                    else:
                        # Phase 2: black -> target.  Last frame = full target.
                        progress = step - half + 1
                        factor = progress / remaining
                        frame = [
                            (int(r * factor), int(g * factor), int(b * factor))
                            for r, g, b in to_colors
                        ]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Direct Crossfade ------------------------------------------
            elif ttype == "direct_crossfade":
                for step in range(steps):
                    t = (step + 1) / steps  # 1/N .. N/N (reaches 1.0)
                    frame = [
                        self._lerp_color(from_colors[i], to_colors[i], t)
                        for i in range(num_pixels)
                    ]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Random Dissolve -------------------------------------------
            elif ttype == "random_dissolve":
                # Build a random permutation of pixel indices and reveal them
                # progressively across the steps.
                order = list(range(num_pixels))
                random.shuffle(order)
                current_frame = list(from_colors)  # mutable copy
                for step in range(steps):
                    # Determine which pixels flip in this step
                    start_idx = int(step * num_pixels / steps)
                    end_idx = int((step + 1) * num_pixels / steps)
                    for idx in order[start_idx:end_idx]:
                        current_frame[idx] = to_colors[idx]
                    if not await self._send_transition_frame(current_frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Wipe (4 directions) ---------------------------------------
            elif ttype in ("wipe_right", "wipe_left", "wipe_down", "wipe_up"):
                cols = TOTAL_COLUMNS  # 20
                rows = TOTAL_ROWS     # 5
                for step in range(steps):
                    frame = []
                    if ttype == "wipe_right":
                        # Boundary sweeps left -> right
                        boundary = int((step + 1) * cols / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i % cols) < boundary else from_colors[i])
                    elif ttype == "wipe_left":
                        # Boundary sweeps right -> left
                        boundary = cols - int((step + 1) * cols / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i % cols) >= boundary else from_colors[i])
                    elif ttype == "wipe_down":
                        # Boundary sweeps top -> bottom (row 4 -> row 0)
                        boundary = rows - int((step + 1) * rows / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i // cols) >= boundary else from_colors[i])
                    else:  # wipe_up
                        # Boundary sweeps bottom -> top (row 0 -> row 4)
                        boundary = int((step + 1) * rows / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i // cols) < boundary else from_colors[i])
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Slide (4 directions) --------------------------------------
            elif ttype in ("slide_left", "slide_right", "slide_up", "slide_down"):
                # Old content slides out one side, new enters from the opposite.
                cols = TOTAL_COLUMNS  # 20
                rows = TOTAL_ROWS     # 5
                # Pre-build 2D grids for easier manipulation
                old_grid = []  # old_grid[row][col]
                new_grid = []
                for r in range(rows):
                    old_r, new_r = [], []
                    for c in range(cols):
                        idx = r * cols + c
                        old_r.append(from_colors[idx])
                        new_r.append(to_colors[idx])
                    old_grid.append(old_r)
                    new_grid.append(new_r)

                for step in range(steps):
                    frame = [(0, 0, 0)] * num_pixels
                    if ttype == "slide_left":
                        # Old slides left, new enters from right
                        shift = int((step + 1) * cols / steps)
                        for r in range(rows):
                            for c in range(cols):
                                src = c + shift
                                pixel = old_grid[r][src] if src < cols else (
                                    new_grid[r][src - cols] if src - cols < cols else (0, 0, 0))
                                frame[r * cols + c] = pixel
                    elif ttype == "slide_right":
                        # Old slides right, new enters from left
                        shift = int((step + 1) * cols / steps)
                        for r in range(rows):
                            for c in range(cols):
                                virtual = (cols - shift) + c
                                pixel = old_grid[r][virtual - cols] if virtual >= cols else new_grid[r][virtual]
                                frame[r * cols + c] = pixel
                    elif ttype == "slide_up":
                        # Old slides up, new enters from bottom
                        shift = int((step + 1) * rows / steps)
                        for r in range(rows):
                            for c in range(cols):
                                virtual = (rows - shift) + r
                                pixel = old_grid[virtual - rows][c] if virtual >= rows else new_grid[virtual][c]
                                frame[r * cols + c] = pixel
                    else:  # slide_down
                        # Old slides down, new enters from top
                        shift = int((step + 1) * rows / steps)
                        for r in range(rows):
                            for c in range(cols):
                                src = r + shift
                                pixel = old_grid[src][c] if src < rows else (
                                    new_grid[src - rows][c] if src - rows < rows else (0, 0, 0))
                                frame[r * cols + c] = pixel
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Card (4 directions) ---------------------------------------
            elif ttype in ("card_from_right", "card_from_left", "card_from_top", "card_from_bottom"):
                # New content slides in from one side ON TOP of old, which stays in place.
                cols = TOTAL_COLUMNS  # 20
                rows = TOTAL_ROWS     # 5
                old_grid = []
                new_grid = []
                for r in range(rows):
                    old_r, new_r = [], []
                    for c in range(cols):
                        idx = r * cols + c
                        old_r.append(from_colors[idx])
                        new_r.append(to_colors[idx])
                    old_grid.append(old_r)
                    new_grid.append(new_r)

                for step in range(steps):
                    frame = [(0, 0, 0)] * num_pixels
                    if ttype == "card_from_right":
                        # Card enters from right edge, slides left
                        shift = int((step + 1) * cols / steps)
                        for r in range(rows):
                            for c in range(cols):
                                if c >= cols - shift:
                                    frame[r * cols + c] = new_grid[r][c - (cols - shift)]
                                else:
                                    frame[r * cols + c] = old_grid[r][c]
                    elif ttype == "card_from_left":
                        # Card enters from left edge, slides right
                        shift = int((step + 1) * cols / steps)
                        for r in range(rows):
                            for c in range(cols):
                                if c < shift:
                                    frame[r * cols + c] = new_grid[r][(cols - shift) + c]
                                else:
                                    frame[r * cols + c] = old_grid[r][c]
                    elif ttype == "card_from_top":
                        # Card enters from top, slides down
                        shift = int((step + 1) * rows / steps)
                        for r in range(rows):
                            for c in range(cols):
                                if r >= rows - shift:
                                    frame[r * cols + c] = new_grid[r - (rows - shift)][c]
                                else:
                                    frame[r * cols + c] = old_grid[r][c]
                    else:  # card_from_bottom
                        # Card enters from bottom, slides up
                        shift = int((step + 1) * rows / steps)
                        for r in range(rows):
                            for c in range(cols):
                                if r < shift:
                                    frame[r * cols + c] = new_grid[(rows - shift) + r][c]
                                else:
                                    frame[r * cols + c] = old_grid[r][c]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Explode & Reform ------------------------------------------
            elif ttype == "explode_reform":
                # Phase 1: old pixels scatter outward from center.
                # Phase 2: new pixels converge inward to their positions.
                import math as _math
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                cx, cy = cols / 2.0, rows / 2.0  # center
                half = max(1, steps // 2)

                for step in range(steps):
                    frame = [(0, 0, 0)] * num_pixels
                    if step < half:
                        # Explode phase: push old pixels away from center
                        t = (step + 1) / half  # 0 -> 1
                        for i in range(num_pixels):
                            r, c = i // cols, i % cols
                            dx, dy = c - cx, r - cy
                            dist = max(_math.sqrt(dx * dx + dy * dy), 0.01)
                            max_push = max(cols, rows) * 0.6
                            push = t * max_push / max(dist, 1.0)
                            nr = int(round(r + dy * push))
                            nc = int(round(c + dx * push))
                            if 0 <= nr < rows and 0 <= nc < cols:
                                brightness = 1.0 - t
                                fr, fg, fb = from_colors[i]
                                frame[nr * cols + nc] = (
                                    int(fr * brightness), int(fg * brightness), int(fb * brightness))
                    else:
                        # Reform phase: new pixels converge inward
                        progress = step - half + 1
                        t = progress / (steps - half)  # 0 -> 1
                        for i in range(num_pixels):
                            r, c = i // cols, i % cols
                            dx, dy = c - cx, r - cy
                            dist = max(_math.sqrt(dx * dx + dy * dy), 0.01)
                            max_push = max(cols, rows) * 0.6
                            push = (1.0 - t) * max_push / max(dist, 1.0)
                            sr = int(round(r + dy * push))
                            sc = int(round(c + dx * push))
                            # Interpolate from scattered position to final
                            cr_ = sr + (r - sr) * t
                            cc_ = sc + (c - sc) * t
                            snap_r = max(0, min(rows - 1, int(round(cr_))))
                            snap_c = max(0, min(cols - 1, int(round(cc_))))
                            tr, tg, tb = to_colors[i]
                            frame[snap_r * cols + snap_c] = (
                                int(tr * t), int(tg * t), int(tb * t))
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Snake -----------------------------------------------------
            elif ttype == "snake":
                # Reveal new pixels in a snake (boustrophedon) pattern across
                # rows, alternating direction each row.
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                # Build snake order: row 0 L -> R, row 1 R -> L, row 2 L -> R, ...
                snake_order = []
                for r in range(rows):
                    if r % 2 == 0:
                        snake_order.extend(r * cols + c for c in range(cols))
                    else:
                        snake_order.extend(r * cols + c for c in range(cols - 1, -1, -1))
                current_frame = list(from_colors)
                for step in range(steps):
                    start_idx = int(step * num_pixels / steps)
                    end_idx = int((step + 1) * num_pixels / steps)
                    for idx in snake_order[start_idx:end_idx]:
                        current_frame[idx] = to_colors[idx]
                    if not await self._send_transition_frame(current_frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Wave Wipe -------------------------------------------------
            elif ttype == "wave_wipe":
                # Like a wipe but the boundary is a sine wave moving left -> right.
                import math as _math
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                amplitude = rows * 0.4  # wave height in rows
                for step in range(steps):
                    t = (step + 1) / steps
                    center_col = t * (cols + amplitude * 2) - amplitude
                    frame = []
                    for i in range(num_pixels):
                        r, c = i // cols, i % cols
                        wave_offset = amplitude * _math.sin(2 * _math.pi * r / rows)
                        threshold = center_col + wave_offset
                        frame.append(to_colors[i] if c < threshold else from_colors[i])
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Iris (Circle Wipe) ----------------------------------------
            elif ttype == "iris":
                # A circular reveal expanding from the center of the display.
                import math as _math
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                cx, cy = cols / 2.0, rows / 2.0
                # Aspect ratio correction: pixels are wider than tall on 20x5
                aspect = cols / rows  # ~= 4.0
                max_radius = _math.sqrt((cols / 2.0) ** 2 + ((rows / 2.0) * aspect) ** 2)
                for step in range(steps):
                    radius = ((step + 1) / steps) * max_radius
                    frame = []
                    for i in range(num_pixels):
                        r, c = i // cols, i % cols
                        dx = c - cx
                        dy = (r - cy) * aspect
                        dist = _math.sqrt(dx * dx + dy * dy)
                        frame.append(to_colors[i] if dist <= radius else from_colors[i])
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Vertical Flip ---------------------------------------------
            elif ttype == "vertical_flip":
                # The display "flips" around a horizontal axis: rows compress
                # toward the middle (old), then expand outward (new).
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                half = max(1, steps // 2)
                for step in range(steps):
                    frame = [(0, 0, 0)] * num_pixels
                    if step < half:
                        # Compress old content: rows squeeze toward center
                        t = (step + 1) / half  # 0 -> 1
                        visible_rows = max(1, int(round(rows * (1.0 - t))))
                        start_row = (rows - visible_rows) // 2
                        for vr in range(visible_rows):
                            src_row = int(round(vr * rows / visible_rows))
                            src_row = min(src_row, rows - 1)
                            dst_row = start_row + vr
                            if 0 <= dst_row < rows:
                                for c in range(cols):
                                    frame[dst_row * cols + c] = from_colors[src_row * cols + c]
                    else:
                        # Expand new content from center outward
                        t = (step - half + 1) / (steps - half)
                        visible_rows = max(1, int(round(rows * t)))
                        start_row = (rows - visible_rows) // 2
                        for vr in range(visible_rows):
                            src_row = int(round(vr * rows / visible_rows))
                            src_row = min(src_row, rows - 1)
                            dst_row = start_row + vr
                            if 0 <= dst_row < rows:
                                for c in range(cols):
                                    frame[dst_row * cols + c] = to_colors[src_row * cols + c]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Curtain ---------------------------------------------------
            elif ttype == "curtain":
                # Two halves of the old content slide apart (left/right) to
                # reveal the new content underneath.
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                half_cols = cols // 2  # 10
                for step in range(steps):
                    t = (step + 1) / steps
                    offset = int(round(t * half_cols))  # how far each half moves
                    frame = list(to_colors)  # start with new as background
                    for r in range(rows):
                        # Left curtain: columns 0..half_cols-1 shift left
                        for c in range(half_cols):
                            dst_c = c - offset
                            if 0 <= dst_c < cols:
                                frame[r * cols + dst_c] = from_colors[r * cols + c]
                        # Right curtain: columns half_cols..cols-1 shift right
                        for c in range(half_cols, cols):
                            dst_c = c + offset
                            if 0 <= dst_c < cols:
                                frame[r * cols + dst_c] = from_colors[r * cols + c]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Gravity Drop ----------------------------------------------
            elif ttype == "gravity_drop":
                # Old lit pixels "fall" off the bottom, then new pixels "drop"
                # in from the top.
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                BLACK = (0, 0, 0)
                half = max(1, steps // 2)

                for step in range(steps):
                    frame = [BLACK] * num_pixels
                    if step < half:
                        # Phase 1: old pixels fall down (shift down by increasing offset)
                        t = (step + 1) / half  # 0 -> 1
                        drop = int(round(t * rows))
                        for r in range(rows):
                            dst_r = r - drop  # shift down (row 0 = bottom)
                            for c in range(cols):
                                if 0 <= dst_r < rows:
                                    frame[dst_r * cols + c] = from_colors[r * cols + c]
                    else:
                        # Phase 2: new pixels drop in from top
                        t = (step - half + 1) / (steps - half)  # 0 -> 1
                        drop = int(round((1.0 - t) * rows))
                        for r in range(rows):
                            src_r = r + drop
                            for c in range(cols):
                                if 0 <= src_r < rows:
                                    frame[r * cols + c] = to_colors[src_r * cols + c]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # -- Pixel Migration -------------------------------------------
            elif ttype == "pixel_migration":
                # Each "lit" pixel in the old state finds the nearest lit pixel
                # in the new state and migrates towards it.  Un-matched pixels
                # fade in/out.  Background (0,0,0) pixels are not migrated.
                #
                # Matching uses GLOBAL shortest-distance-first: compute all
                # pairwise (old, new) distances, sort ascending, then greedily
                # pair the closest available pixels.  This minimises total
                # travel distance and eliminates the criss-crossing paths that
                # a sequential greedy approach produces.
                BLACK = (0, 0, 0)
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS

                def pos_to_rc(idx):
                    return (idx // cols, idx % cols)

                # Identify lit pixels in old and new states
                old_lit = [(i, from_colors[i]) for i in range(num_pixels) if from_colors[i] != BLACK]
                new_lit = [(i, to_colors[i]) for i in range(num_pixels) if to_colors[i] != BLACK]

                # Build ALL pairwise distances and sort shortest-first
                # Uses Euclidean distance for natural diagonal movement.
                # With <=100 lit pixels per side this is at most 10 000 pairs  --
                # fast enough even on a Pi.
                import math as _math
                pairs = []  # (distance, old_list_idx, new_list_idx)
                for oi_idx, (oi_pos, _) in enumerate(old_lit):
                    or_, oc_ = pos_to_rc(oi_pos)
                    for ni_idx, (ni_pos, _) in enumerate(new_lit):
                        nr_, nc_ = pos_to_rc(ni_pos)
                        d = _math.sqrt((or_ - nr_) ** 2 + (oc_ - nc_) ** 2)
                        pairs.append((d, oi_idx, ni_idx))
                pairs.sort()  # shortest distance first

                # Greedy global matching -- process closest pairs first
                matched_old = set()
                matched_new = set()
                migrations = []  # (old_pos, old_color, new_pos, new_color)
                for _, oi_idx, ni_idx in pairs:
                    if oi_idx in matched_old or ni_idx in matched_new:
                        continue
                    matched_old.add(oi_idx)
                    matched_new.add(ni_idx)
                    oi_pos, oi_col = old_lit[oi_idx]
                    ni_pos, ni_col = new_lit[ni_idx]
                    migrations.append((oi_pos, oi_col, ni_pos, ni_col))

                # Unmatched old pixels fade out, unmatched new pixels fade in
                fade_outs = [(old_lit[i][0], old_lit[i][1])
                             for i in range(len(old_lit)) if i not in matched_old]
                fade_ins  = [(new_lit[i][0], new_lit[i][1])
                             for i in range(len(new_lit)) if i not in matched_new]

                for step in range(steps):
                    t = (step + 1) / steps  # 1/N .. N/N (reaches 1.0)
                    frame = [BLACK] * num_pixels

                    # Draw migrating pixels
                    for (oi, oc, ni, nc) in migrations:
                        or_, oc_ = pos_to_rc(oi)
                        nr_, nc_ = pos_to_rc(ni)
                        # Interpolate position (smooth float -> snap to grid)
                        cur_r = or_ + (nr_ - or_) * t
                        cur_c = oc_ + (nc_ - oc_) * t
                        snap_r = max(0, min(rows - 1, int(round(cur_r))))
                        snap_c = max(0, min(cols - 1, int(round(cur_c))))
                        pixel_idx = snap_r * cols + snap_c
                        # Interpolate color
                        color = self._lerp_color(oc, nc, t)
                        frame[pixel_idx] = color

                    # Fade-out old pixels (no target)
                    for (oi, oc) in fade_outs:
                        brightness = 1.0 - t
                        frame[oi] = (int(oc[0] * brightness), int(oc[1] * brightness), int(oc[2] * brightness))

                    # Fade-in new pixels (no source)
                    for (ni, nc) in fade_ins:
                        frame[ni] = (int(nc[0] * t), int(nc[1] * t), int(nc[2] * t))

                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)
            
            _LOGGER.debug(
                f"[TRANSITION] [{self._ip}] Completed '{self._transition_type}' "
                f"({steps} steps, {duration:.1f}s)"
            )
        finally:
            self._transition_active = False
