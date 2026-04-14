

import logging
import asyncio
import math
import random
import time
import traceback
import colorsys
from typing import Tuple
import voluptuous as vol # type: ignore
from homeassistant.components import websocket_api # type: ignore
from homeassistant.components.light import LightEntity, ColorMode # type: ignore
from homeassistant.helpers.entity import Entity # type: ignore
from homeassistant.components.sensor import SensorEntity # type: ignore
from homeassistant.helpers.restore_state import RestoreEntity # type: ignore
from homeassistant.core import HomeAssistant # type: ignore
from homeassistant.helpers.entity_platform import AddEntitiesCallback # type: ignore
from homeassistant.config_entries import ConfigEntry # type: ignore
from homeassistant.helpers.event import async_track_state_change_event # type: ignore
from homeassistant.helpers import config_validation as cv # type: ignore
from homeassistant.helpers import entity_registry as er # type: ignore
from yeelight import BulbException # type: ignore
from .const import DOMAIN, CONF_IP
from .cube_matrix import CubeMatrix, RECONNECT_COOLDOWN_INITIAL, CONNECT_TIMEOUT, RECOVERY_CONNECT_TIMEOUT
from .layout import Layout, Module, FONT_MAPS, TOTAL_COLUMNS, TOTAL_ROWS
from . import async_save_data

from .color_utils import hex_to_rgb, rgb_to_hex
from .image_utils import image_to_matrix

_LOGGER = logging.getLogger(__name__)
_LOGGER.debug("Yeelight Cube Lite light.py module loaded")

# Timing constants
APPLY_POST_DELAY = 0.0        # No post-delay needed â€” send_command_fast doesn't wait for responses
APPLY_HARD_TIMEOUT = 5.0      # Seconds â€” absolute safety timeout for a single apply() call under
                              # the global lock.  If an apply() exceeds this (e.g., socket hangs
                              # beyond the per-op 0.5s timeout), asyncio.wait_for cancels it and
                              # releases the lock so other entities can proceed.
                              # Reduced from 8s to 5s â€” inner timeouts are now tighter:
                              #   probe 0.5s + raw_cmd 1.5sÃ—2 + draw 0.5s = 4s worst case.
CIRCUIT_BREAKER_WINDOW = 30.0 # Seconds â€” if 2+ hard timeouts occur within this window,
                              # reject new operations immediately instead of queueing them
                              # behind the lock for another 8s timeout each.
FX_MODE_STALENESS_TIMEOUT = 20.0  # Seconds â€” re-send activate_fx_mode when fx_age exceeds this
                                  # The Cube silently exits direct FX mode ~25s after ACTIVATION
                                  # (not after last command!).  It keeps the TCP connection open
                                  # and silently ignores update_leds â€” no error, no socket close.
                                  # 20s gives ~5s safety margin.  Must check time since
                                  # activate_fx_mode was sent, NOT time since last command.

# NOTE: Per-entity and global pixel art throttle REMOVED.
# The gradient card sends identical update_leds commands rapidly without
# any throttle and works perfectly.  The throttle was actually causing
# sticking: multi-second delays let sockets go stale â†’ RST + reconnect
# timeout â†’ retry storm â†’ lamp stuck for 20-30s.
# JS 300ms debounce provides sufficient rate limiting.

# Global registry to store entity instances for service calls
_ENTITY_REGISTRY = {}


def _entity_id_or_list(value):
    """Voluptuous validator: accept a single entity_id string OR a list of entity_ids.
    
    This allows the JS frontend to send all target entity_ids in ONE service
    call so the backend can dispatch them in parallel via asyncio.gather,
    avoiding the HA WebSocket serialisation that otherwise forces sequential
    execution when multiple callService messages are sent.
    """
    if isinstance(value, str):
        return cv.entity_id(value)
    if isinstance(value, list):
        return [cv.entity_id(v) for v in value]
    raise vol.Invalid(f"Expected entity_id string or list, got {type(value)}")


# Per-device locks to serialize hardware commands to the SAME physical lamp.
# Each IP gets its own asyncio.Lock, so operations to different lamps run
# concurrently without cross-device cascade.  When one lamp is unreachable,
# only that lamp's operations block â€” the other lamp continues normally.
# Within a single lamp, the lock ensures command chains (activate_fx_mode â†’
# set_bright â†’ update_leds) complete atomically without interleaving.
_DEVICE_LOCKS: dict[str, asyncio.Lock] = {}

def _get_device_lock(ip: str) -> asyncio.Lock:
    """Get or create the per-device lock for a given IP."""
    if ip not in _DEVICE_LOCKS:
        _DEVICE_LOCKS[ip] = asyncio.Lock()
    return _DEVICE_LOCKS[ip]


def cleanup_module_state(ip: str) -> None:
    """Remove module-level state for a device being unloaded.

    Called from __init__.async_unload_entry to prevent stale references
    from persisting across integration reloads.
    """
    # Remove IP-keyed entry (set during initial setup)
    _ENTITY_REGISTRY.pop(ip, None)
    # Remove entity_id-keyed entries whose entity references this IP
    stale_keys = [
        key for key, entity in _ENTITY_REGISTRY.items()
        if hasattr(entity, "_ip") and entity._ip == ip
    ]
    for key in stale_keys:
        del _ENTITY_REGISTRY[key]
    # Remove per-device lock
    _DEVICE_LOCKS.pop(ip, None)

ORIENTATION_NORMAL = "normal"
ORIENTATION_FLIPPED = "flipped"

# Virtual character sentinel for panel mode.
# When panel_mode is on, the text is replaced by this single character
# whose positions cover the entire 5Ã—20 display (all 100 pixels).
# All rendering modes see one "giant letter" filling the whole panel
# and work via the normal text rendering path â€” no special branches needed.
PANEL_FULL_CHAR = "\uFFFF"

class YeelightCubeLight(LightEntity, RestoreEntity):

    def _angle_gradient_projection_for_bottom_center(self, col, dx, dy):
        # Always use a 3-column, full-height box centered at col
        min_row, max_row = 0, TOTAL_ROWS - 1
        min_col = max(0, col - 1)
        max_col = min(TOTAL_COLUMNS - 1, col + 1)
        center_col = (min_col + max_col) / 2
        center_row = (min_row + max_row) / 2
        # Projection for the bottom-center dot
        dot_col = center_col
        dot_row = max_row
        projection = (dot_col - center_col) * dx + (dot_row - center_row) * dy
        # Projections for normalization (corners of the box)
        corners = [
            (min_col, min_row),
            (max_col, min_row),
            (min_col, max_row),
            (max_col, max_row)
        ]
        projections = [(c - center_col) * dx + (r - center_row) * dy for c, r in corners]
        min_proj = min(projections)
        max_proj = max(projections)
        proj_range = max_proj - min_proj if max_proj != min_proj else 1
        normalized_projection = (projection - min_proj) / proj_range
        return normalized_projection
    @property
    def font(self):
        return self._font

    async def set_font(self, font: str):
        from .layout import FONT_MAPS
        if font not in FONT_MAPS:
            _LOGGER.error(f"Invalid font: {font}. Available: {list(FONT_MAPS.keys())}")
            return
        self._font = font
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()
    def _safeguard_entity_id(self, entity_id):
    # Allow any entity name for palettes
        return entity_id
    @property
    def device_info(self):
        # Use config_entry.entry_id as the unique identifier for grouping (matches switch)
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": self._attr_name,
            "manufacturer": "Yeelight",
            "model": "Cube Matrix",
        }
    # Store custom pixel data for Custom Draw mode
    _custom_pixels = None

    def calculate_multi_gradient_color(self, colors, position, total_positions):
        """
        Interpolates between multiple colors for a given position in a gradient.
        colors: list of RGB tuples
        position: current position (float or int)
        total_positions: total number of positions (int)
        """
        if not colors:
            return (255, 0, 0)
        if len(colors) == 1 or total_positions <= 1:
            return colors[0]
        # Clamp position
        position = max(0, min(position, total_positions - 1))
        n_segments = len(colors) - 1
        segment_length = (total_positions - 1) / n_segments if n_segments > 0 else 1
        segment = int(position // segment_length)
        segment = min(segment, n_segments - 1) if n_segments > 1 else 0
        start_color = colors[segment]
        end_color = colors[segment + 1]
        # Local factor within this segment
        local_start = segment * segment_length
        local_end = (segment + 1) * segment_length
        if local_end == local_start:
            factor = 0
        else:
            factor = (position - local_start) / (local_end - local_start)
        def interpolate(start, end, f):
            return min(255, max(0, round(start + (end - start) * f)))
        return tuple(interpolate(s, e, factor) for s, e in zip(start_color, end_color))
    
    def apply_color_adjustments(self, rgb_color):
        """
        Apply all color effects to an RGB color tuple.
        Effects are applied in a specific order for best visual results.
        
        IMPORTANT: Black pixels (0,0,0) are treated as background/off pixels
        and should NOT have effects applied.
        
        NOTE: Brightness/darkness is NO LONGER applied in this function!
        It's now applied as the FINAL step in apply() before encoding to hardware.
        This preserves color precision and prevents rounding errors in gradients.
        
        Effect Application Order:
        1. Color Adjustments (Hue Shift, Temperature)
        2. Saturation & Intensity (Saturation, Vibrance)
        3. Tone & Contrast (Contrast, Glow)
        4. Special Effects (Grayscale, Tint, Invert)
        5. Brightness/Darkness - Applied separately in apply() as final step
        """
        r, g, b = rgb_color
        original_rgb = (r, g, b)  # Store original for logging
        is_black = r == 0 and g == 0 and b == 0
        
        # If the pixel is black (background/off), don't apply any effects
        # Black pixels should remain black regardless of tint, grayscale, etc.
        if is_black:
            return (0, 0, 0)
        
        # === COLOR ADJUSTMENTS ===
        # 1. Hue Shift (-180 to +180 degrees)
        if self._preview_hue_shift != 0:
            r, g, b = self._apply_hue_shift(r, g, b, self._preview_hue_shift)
        
        # 2. Temperature (-100 to +100: cool to warm)
        if self._preview_temperature != 0:
            r, g, b = self._apply_temperature(r, g, b, self._preview_temperature)
        
        # === SATURATION & INTENSITY ===
        # 3. Saturation (0-200: 0=grayscale, 100=normal, 200=hyper-saturated)
        if self._preview_saturation != 100:
            r, g, b = self._apply_saturation(r, g, b, self._preview_saturation)
        
        # 4. Vibrance (0-200: smart saturation)
        if self._preview_vibrance != 100:
            r, g, b = self._apply_vibrance(r, g, b, self._preview_vibrance)
        
        # === TONE & CONTRAST ===
        # 5. Contrast (0-200: 0=flat gray, 100=normal, 200=high contrast)
        if self._preview_contrast != 100:
            r, g, b = self._apply_contrast(r, g, b, self._preview_contrast)
        
        # 6. Glow (0-100: boost bright pixels)
        if self._preview_glow > 0:
            r, g, b = self._apply_glow(r, g, b, self._preview_glow)
        
        # === SPECIAL EFFECTS ===
        # 7. Grayscale (0-100: convert to black & white)
        if self._preview_grayscale > 0:
            r, g, b = self._apply_grayscale(r, g, b, self._preview_grayscale)
        
        # 8. Tint (hue 0-360, strength 0-100)
        if self._preview_tint_strength > 0:
            r, g, b = self._apply_tint(r, g, b, self._preview_tint_hue, self._preview_tint_strength)
        
        # 9. Invert (0-100: blend with inverted color)
        if self._preview_invert > 0:
            invert_factor = self._preview_invert / 100
            r = round(r * (1 - invert_factor) + (255 - r) * invert_factor)
            g = round(g * (1 - invert_factor) + (255 - g) * invert_factor)
            b = round(b * (1 - invert_factor) + (255 - b) * invert_factor)
        
        # Clamp to valid range
        r = max(0, min(255, r))
        g = max(0, min(255, g))
        b = max(0, min(255, b))
        
        return (r, g, b)
    
    def _apply_hue_shift(self, r, g, b, shift_degrees):
        """Shift hue by degrees (-180 to +180)"""
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        h = (h + shift_degrees / 360) % 1.0
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        return round(r * 255), round(g * 255), round(b * 255)
    
    def _apply_temperature(self, r, g, b, temp):
        """Apply color temperature (-100=cool/blue, +100=warm/orange)"""
        if temp > 0:  # Warm
            factor = temp / 100
            r = round(r + (255 - r) * factor * 0.3)
            g = round(g + (255 - g) * factor * 0.1)
            b = round(b * (1 - factor * 0.3))
        else:  # Cool
            factor = abs(temp) / 100
            r = round(r * (1 - factor * 0.3))
            g = round(g * (1 - factor * 0.1))
            b = round(b + (255 - b) * factor * 0.3)
        return r, g, b
    
    def _apply_saturation(self, r, g, b, saturation):
        """Adjust saturation (0=grayscale, 100=normal, 200=hyper)"""
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        s = s * (saturation / 100)
        s = max(0, min(1, s))
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        return round(r * 255), round(g * 255), round(b * 255)
    
    def _apply_vibrance(self, r, g, b, vibrance):
        """Smart saturation that protects already-saturated colors"""
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        # Vibrance affects low-saturation colors more than high-saturation
        # Uses a non-linear curve: the less saturated a color, the more vibrance affects it
        if s > 0:
            factor = vibrance / 100
            # Weight the adjustment inversely by current saturation
            # Low saturation (s=0.2) gets big boost, high saturation (s=0.9) gets small boost
            weight = (1 - s) ** 0.5  # Square root for smoother curve
            s = s * (1 + (factor - 1) * weight)
            s = max(0, min(1, s))
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        return round(r * 255), round(g * 255), round(b * 255)
    
    def _apply_contrast(self, r, g, b, contrast):
        """Adjust contrast (0=flat, 100=normal, 200=high)"""
        factor = contrast / 100
        r = round(((r / 255 - 0.5) * factor + 0.5) * 255)
        g = round(((g / 255 - 0.5) * factor + 0.5) * 255)
        b = round(((b / 255 - 0.5) * factor + 0.5) * 255)
        return max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))
    
    def _apply_glow(self, r, g, b, glow):
        """Boost luminosity of bright pixels"""
        luminosity = (r + g + b) / 3
        if luminosity > 127:
            factor = (luminosity / 255) * (glow / 100)
            r = round(r + (255 - r) * factor)
            g = round(g + (255 - g) * factor)
            b = round(b + (255 - b) * factor)
        return r, g, b
    
    def _apply_grayscale(self, r, g, b, grayscale):
        """Convert to grayscale (desaturate to black & white)
        Uses luminosity method for perceptually accurate grayscale"""
        factor = grayscale / 100
        # Luminosity method: weighted average based on human perception
        gray = round(0.299 * r + 0.587 * g + 0.114 * b)
        # Blend between original and grayscale
        r = round(r * (1 - factor) + gray * factor)
        g = round(g * (1 - factor) + gray * factor)
        b = round(b * (1 - factor) + gray * factor)
        return max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))
    
    def _apply_tint(self, r, g, b, tint_hue, strength):
        """Apply a colored tint overlay"""
        # Create tint color from hue
        tint_r, tint_g, tint_b = colorsys.hsv_to_rgb(tint_hue / 360, 1.0, 1.0)
        tint_r, tint_g, tint_b = round(tint_r * 255), round(tint_g * 255), round(tint_b * 255)
        # Blend with tint
        factor = strength / 100
        r = round(r * (1 - factor) + tint_r * factor)
        g = round(g * (1 - factor) + tint_g * factor)
        b = round(b * (1 - factor) + tint_b * factor)
        return r, g, b
    
    def _apply_final_brightness(self, rgb_color):
        """
        Apply brightness/darkness as the FINAL step before encoding.
        This is separated from apply_color_adjustments() to preserve color precision.
        
        WHY THIS IS LAST:
        - Gradients are calculated at full color precision
        - Color effects work with accurate color values
        - No rounding errors accumulate during effect processing
        - Darkness is applied only to the final output values
        
        This approach prevents color shifts and precision loss that would occur
        if darkness was applied earlier in the pipeline.
        """
        r, g, b = rgb_color
        original_rgb = (r, g, b)  # Store for logging
        
        # Skip brightness adjustment for black pixels (background)
        if r == 0 and g == 0 and b == 0:
            return (0, 0, 0)
        
        # === BRIGHTNESS CONTROL ===
        # Darken (0-100: interpolate towards black) - Used by brightness system for 0-50% range
        # Uses floor() + max(1) to preserve color ratios and prevent channel loss
        if self._preview_darken > 0:
            darken_factor = 1 - (self._preview_darken / 100)
            # Use floor() to avoid rounding up, then ensure non-zero channels stay alive
            # This prevents color shifts (e.g., purple â†’ red) when green channel would round to 0
            r = max(1, math.floor(r * darken_factor)) if r > 0 else 0
            g = max(1, math.floor(g * darken_factor)) if g > 0 else 0
            b = max(1, math.floor(b * darken_factor)) if b > 0 else 0
            
            # Log darken effect for debugging (reduced to debug level to avoid spam)
            _LOGGER.debug(f"[FINAL BRIGHTNESS] RGB{original_rgb} â†’ darken {self._preview_darken}% â†’ RGB({r}, {g}, {b})")
        
        # Brighten (0-100: interpolate towards white) - Kept for future use
        if self._preview_brighten > 0:
            brighten_factor = self._preview_brighten / 100
            r = round(r + (255 - r) * brighten_factor)
            g = round(g + (255 - g) * brighten_factor)
            b = round(b + (255 - b) * brighten_factor)
        
        # Clamp to valid range
        r = max(0, min(255, r))
        g = max(0, min(255, g))
        b = max(0, min(255, b))
        
        return (r, g, b)

    def _apply_color_correction(self, rgb_color):
        """
        Apply per-channel LED color correction to compensate for hardware
        non-linearity at low brightness.  Always active.

        WHY THIS IS NEEDED:
        At low PWM duty cycles, RGB LEDs exhibit non-linear behaviour:
        - Blue LEDs have a higher forward voltage (~3.0 V) and effectively
          drop out first at low duty cycles.
        - Green LEDs (~2.2 V) and Red LEDs (~1.8 V) have lower thresholds
          but still lose accuracy.
        - Visible symptoms: white->yellow, magenta->red, cyan->green.

        HOW IT WORKS:
        1. Per-channel inverse gamma (gamma < 1 => boosts low values).
        2. Correction strength ramps with HARDWARE brightness: zero when the
           LEDs run at high duty cycle, full at very low duty cycle.
        3. Only affects hardware-bound values; the preview card always shows
           the original intended colours.

        IMPORTANT: The strength must be driven by the actual hardware
        brightness (PWM duty cycle), NOT the software darken%.  In the
        dual-brightness system, mid-range user brightness (e.g. 59%) has
        hardware=100% but darken=72%: the LEDs are at full power so there
        is NO non-linearity to compensate for.  Using darken% here would
        over-correct and desaturate colours ("faded / merged with white").
        
        ═══════════════════════════════════════════════════════════════════
        TUNING PARAMETERS - adjust these if colours still look off:
        ═══════════════════════════════════════════════════════════════════

        HW_BRIGHT_THRESHOLD  (default 50)
            Hardware brightness % ABOVE which correction is skipped.
            At these levels, LEDs behave linearly - no correction needed.

        HW_BRIGHT_FULL       (default 10)
            Hardware brightness % at or below which correction is at 100%.
            Below this, LEDs are deeply non-linear and need full boost.

        GAMMA_R           (default 0.85)
            Red channel gamma.  Lower = more boost for dim reds.
            Typical range: 0.60 - 1.00.  1.0 = no change.

        GAMMA_G           (default 0.75)
            Green channel gamma.  Same logic as red.

        GAMMA_B           (default 0.65)
            Blue channel gamma.  Lowest value because blue LEDs need the
            most help.  If blues are still too dark, try 0.50-0.55.
            If blues are over-boosted, try 0.70-0.80.
        ═══════════════════════════════════════════════════════════════════
        """
        r, g, b = rgb_color
        if r == 0 and g == 0 and b == 0:
            return (0, 0, 0)

        # ── Tuning knobs (read from instance for runtime calibration) ──
        HW_BRIGHT_THRESHOLD = self._calib_hw_threshold
        HW_BRIGHT_FULL      = self._calib_hw_full
        GAMMA_R             = self._calib_gamma_r
        GAMMA_G             = self._calib_gamma_g
        GAMMA_B             = self._calib_gamma_b
        # ────────────────────────────────────────────────────────────────

        # Compute EFFECTIVE brightness that accounts for both dimming mechanisms:
        #   1. Hardware brightness (global LED current/PWM)
        #   2. RGB darkening (per-pixel value crushing via _preview_darken)
        #
        # The LED sees: pixel_value/255 * hw_bright/100 as its actual duty cycle.
        # Both low pixel values AND low hw contribute to non-linearity.
        hw_bright = getattr(self, '_last_hardware_brightness', 100)
        darken = getattr(self, '_preview_darken', 0)
        effective_bright = hw_bright * (100 - darken) / 100

        if effective_bright >= HW_BRIGHT_THRESHOLD:
            return rgb_color  # Pixels at sufficient brightness, no non-linearity

        # Correction strength has TWO components:
        #
        # 1. eff_strength: how much correction the effective brightness demands
        #    (ramps 0→1 as effective drops from threshold→full)
        #
        # 2. hw_damping: keeps VISUAL IMPACT of correction constant across
        #    brightness levels.  A pixel boost of Δ produces visible change
        #    proportional to Δ × hw/100.  At hw=4% (1% user), even a large Δ
        #    is invisible.  At hw=96% (24% user), even small Δ washes colors.
        #
        #    hw_damping = HW_FULL / hw  (capped at 1.0)
        #    This ensures:  Δ × hw × (HW_FULL/hw) = Δ × HW_FULL = constant.
        #
        #    Result: correction is strongest at very low hw (where it's needed
        #    AND invisible), and scales down proportionally at higher hw.
        #
        # Combined: strength = eff_strength * hw_damping
        eff_strength = min(1.0, (HW_BRIGHT_THRESHOLD - effective_bright) / max(1, HW_BRIGHT_THRESHOLD - HW_BRIGHT_FULL))
        hw_damping = min(1.0, HW_BRIGHT_FULL / max(1.0, hw_bright))
        strength = eff_strength * hw_damping

        def gamma_correct(val, gamma):
            """Apply inverse gamma to a single 0-255 channel value."""
            if val <= 0:
                return 0
            normalized = val / 255.0
            corrected = normalized ** gamma   # gamma < 1 boosts low values
            return max(1, min(255, round(corrected * 255)))

        r_corr = gamma_correct(r, GAMMA_R)
        g_corr = gamma_correct(g, GAMMA_G)
        b_corr = gamma_correct(b, GAMMA_B)

        # ── HYBRID LUMINANCE + CHANNEL-BALANCE scaling ──────────────────
        # Pure per-channel gamma (R=0.85, G=0.75, B=0.65) destroys hue:
        #   pink (10,3,6) → (16,9,22) = massive shift pink→purple!
        #   white (10,10,10) → (16,19,22) = blue tint
        #
        # Pure uniform luminance scaling preserves hue perfectly but
        # CANNOT compensate for physical per-channel LED non-linearity
        # (blue LEDs have higher forward voltage → less output at low duty).
        # Result: whites look brown/orange, blues look grayish.
        #
        # HYBRID approach: blend between uniform and per-channel.
        #   channel_balance = 0.0 → pure uniform (perfect hue, no blue fix)
        #   channel_balance = 1.0 → pure per-channel (blue fixed, hue shifts)
        #   channel_balance = 0.5 → 50/50 blend (moderate blue boost, mild shift)
        #
        # At 0.5 default:
        #   white (10,10,10) → ~(17,18,20): subtle blue boost → neutral on LED
        #   pink  (10,3,6)  → keeps pink character with modest blue nudge
        # ──────────────────────────────────────────────────────────────────
        CHANNEL_BALANCE = getattr(self, '_calib_channel_balance', 0.7)

        orig_lum = 0.299 * r + 0.587 * g + 0.114 * b
        corr_lum = 0.299 * r_corr + 0.587 * g_corr + 0.114 * b_corr

        if orig_lum <= 0:
            return rgb_color

        lum_scale = corr_lum / orig_lum
        # Blend between 1.0 (no correction) and lum_scale based on strength
        final_scale = 1.0 + (lum_scale - 1.0) * strength

        # Uniform result (hue-preserving)
        r_uni = r * final_scale
        g_uni = g * final_scale
        b_uni = b * final_scale

        # Per-channel result (physically accurate but hue-shifting)
        r_pc = r + (r_corr - r) * strength
        g_pc = g + (g_corr - g) * strength
        b_pc = b + (b_corr - b) * strength

        # Blend: 0 = pure uniform, 1 = pure per-channel
        bal = max(0.0, min(1.0, CHANNEL_BALANCE))
        r_out = min(255, max(0, round(r_uni + (r_pc - r_uni) * bal)))
        g_out = min(255, max(0, round(g_uni + (g_pc - g_uni) * bal)))
        b_out = min(255, max(0, round(b_uni + (b_pc - b_uni) * bal)))

        return (r_out, g_out, b_out)

    def _apply_color_accuracy(self, rgb_color):
        """
        Apply per-channel gain correction to compensate for LED colour rendering
        differences vs. a computer monitor.  Toggled via a button on the
        preview card (service: set_color_accuracy).

        The correction strength fades with brightness: full effect at 100%,
        zero effect at 0-1%.  This avoids over-correcting at low brightness
        where _apply_color_correction (gamma) already adjusts the colour.

        WHY THIS IS NEEDED:
        LED strips / matrices rarely match sRGB.  Each LED colour has its own
        efficiency and wavelength, so the *same* RGB values look different on
        a monitor versus the physical lamp.  Typical symptoms on this lamp:

          - Yellow (#ffff00) shifts greenish   → green LED is too efficient
          - Cyan   (#00ffff) shifts greenish   → green dominates blue in mixes
          - White  (#ffffff) not perfectly neutral → green tint
          - Blues / purples / oranges appear "lighter" / washed → G & B LEDs
            contribute more perceived brightness than expected
          - Pure red and magenta look correct  → red channel is accurate

        HOW IT WORKS:
        Per-channel gain multiplier blended toward 1.0 (neutral) at low
        brightness.  The blend factor is derived from self._brightness
        (1–255, HA brightness).

        Pipeline order:  colour effects → brightness darken →
                         _apply_color_correction (low-brightness gamma) →
                         ★ _apply_color_accuracy (this, channel gain) ★ →
                         encode & send to lamp

        The preview card is NOT affected — it always shows the original
        intended colours.

        ═══════════════════════════════════════════════════════════════════
        TUNING PARAMETERS — adjust these to match YOUR lamp:
        ═══════════════════════════════════════════════════════════════════

        GAIN_R  (default 1.00)
            Red channel multiplier.  1.0 = unchanged.
            Red looks correct on this lamp, so leave at 1.0.
            If reds look too bright, try 0.95.  Too dim, try 1.05.

        GAIN_G  (default 0.87)
            Green channel multiplier.  Reduced because the green LED is
            over-efficient, causing yellows/cyans/whites to shift green.
            If still too green, try 0.80–0.85.
            If colours look too pink/magenta, raise to 0.90–0.94.

        GAIN_B  (default 0.72)
            Blue channel multiplier.  Reduced for deeper blues
            and to prevent mid-range colours from looking washed out.
            If blues are too dark, raise to 0.80–0.90.
            If blues still look washed, lower to 0.65–0.70.
        ═══════════════════════════════════════════════════════════════════
        """
        if not self._color_accuracy_enabled:
            return rgb_color

        r, g, b = rgb_color
        if r == 0 and g == 0 and b == 0:
            return (0, 0, 0)

        # ── Tuning knobs (read from instance for runtime calibration) ──
        GAIN_R = self._calib_gain_r
        GAIN_G = self._calib_gain_g
        GAIN_B = self._calib_gain_b
        # ────────────────────────────────────────────────────────────────

        # ── Brightness-based fade ───────────────────────────────────────
        # Blend gains toward 1.0 (neutral) as brightness decreases.
        # At brightness 255 → factor = 1.0 (full correction)
        # At brightness   1 → factor ≈ 0.0 (no correction)
        brightness = max(1, min(255, getattr(self, '_brightness', 255)))
        factor = (brightness - 1) / 254  # 0.0 .. 1.0

        GAIN_R = 1.0 + (GAIN_R - 1.0) * factor
        GAIN_G = 1.0 + (GAIN_G - 1.0) * factor
        GAIN_B = 1.0 + (GAIN_B - 1.0) * factor
        # ────────────────────────────────────────────────────────────────

        r_out = min(255, round(r * GAIN_R))
        g_out = min(255, round(g * GAIN_G))
        b_out = min(255, round(b * GAIN_B))

        return (r_out, g_out, b_out)

    """Home Assistant LightEntity for the Yeelight Cube Lite."""
    
    # UNIFIED BRIGHTNESS CONTROL CONFIGURATION
    # This system combines TWO brightness mechanisms for extended range:
    #
    # 1. RGB DARKENING (high brightness range):
    #    - Reduces RGB values mathematically (e.g., RGB(255,0,0) â†’ RGB(128,0,0) at 50% darken)
    #    - Used when hardware brightness is at maximum
    #    - Preserves color accuracy at higher brightness levels
    #
    # 2. HARDWARE BRIGHTNESS (low brightness range):
    #    - Reduces physical LED brightness via Yeelight lamp's built-in dimming
    #    - Used when RGB darkening reaches its maximum safe limit
    #    - Allows going MUCH dimmer for night/ambient lighting
    #
    # HOW IT WORKS:
    # - User sees ONE brightness slider (0-100%)
    # - High brightness (e.g., 50-100%): hardware=100%, darkness varies (0-94%)
    # - Low brightness (e.g., 0-50%): hardware varies (10-100%), darkness=94% (max)
    # - Transition point is configurable below
    #
    
    # TRANSITION POINT: When to switch between hardware and darkness control
    # At what user brightness % does the system switch modes?
    # - Above this: hardware=100%, darkness decreases (brighter via less darkening)
    # - Below this: hardware decreases, darkness=MAX_DARKEN_PERCENT (dimmer via hardware)
    BRIGHTNESS_TRANSITION_POINT = 25  # User brightness % (1-100) where mode switches
    
    # HARDWARE BRIGHTNESS LIMITS (low brightness range)
    # When user brightness is BELOW transition point:
    # - Darkness is fixed at MAX_DARKEN_PERCENT
    # - Hardware brightness scales from MIN to MAX based on user brightness
    MIN_HARDWARE_BRIGHTNESS = 1 # 25  # Minimum hardware brightness % (1-100) - very dim!
    MAX_HARDWARE_BRIGHTNESS = 100  # Hardware brightness % at transition point (usually 100)
    
    # DARKNESS LIMITS (high brightness range)
    # When user brightness is ABOVE transition point:
    # - Hardware brightness is fixed at 100%
    # - Darkness scales from MAX to MIN based on user brightness
    MAX_DARKEN_PERCENT = 97  # Maximum darkness % at transition point (safe limit: 91-97%)
    MIN_DARKEN_PERCENT = 0   # Minimum darkness % at 100% brightness (0 = no darkening)
    LOW_MIN_DARKEN_PERCENT = 95  # Darken % at the very bottom of the low range (0% brightness)
                                  # Lower = more pixel headroom & color precision at very dim levels
                                  # Darken ramps from LOW_MIN_DARKEN (bottom) to MAX_DARKEN (transition)
    
    # DARKNESS CURVE CONTROL POINTS (high brightness range only)
    # Fine-tune the darkness curve for brightness values ABOVE transition point
    # These define how darkness decreases as brightness increases from transition to 100%
    #
    # Control points are automatically scaled based on BRIGHTNESS_TRANSITION_POINT:
    # - CP1: 20% into high range (e.g., 60% if transition=50, 44% if transition=30)
    # - CP2: 50% into high range (e.g., 75% if transition=50, 65% if transition=30)
    # - CP3: 80% into high range (e.g., 90% if transition=50, 86% if transition=30)
    #
    # Example with BRIGHTNESS_TRANSITION_POINT=50:
    # - At 50% brightness: MAX_DARKEN_PERCENT (e.g., 94%)
    # - At 60% brightness: DARKEN_AT_60_PERCENT (e.g., 75%)
    # - At 75% brightness: DARKEN_AT_75_PERCENT (e.g., 45%)
    # - At 90% brightness: DARKEN_AT_90_PERCENT (e.g., 20%)
    # - At 100% brightness: MIN_DARKEN_PERCENT (e.g., 0%)
    #
    # Adjust these to control how quickly brightness increases in the high range:
    DARKNESS_AT_20_PCT_HIGH = 85   # Darkness % at 20% into high range
    DARKNESS_AT_50_PCT_HIGH = 70   # Darkness % at 50% into high range
    DARKNESS_AT_80_PCT_HIGH = 40   # Darkness % at 80% into high range
    
    # EXAMPLE CONFIGURATIONS:
    #
    # CONFIGURATION 1: Maximum dim range (current settings)
    # - Transition at 50%
    # - Low range (0-50%): hardware 10-100%, darkness fixed at 94%
    # - High range (50-100%): hardware 100%, darkness 94-0%
    # - Result: VERY dim minimum, smooth brightness curve
    #
    # CONFIGURATION 2: More linear response
    # - BRIGHTNESS_TRANSITION_POINT = 30
    # - MIN_HARDWARE_BRIGHTNESS = 20
    # - MAX_DARKEN_PERCENT = 85
    # - Result: Less extreme dimming, more predictable brightness changes
    #
    # CONFIGURATION 3: Prioritize color accuracy
    # - BRIGHTNESS_TRANSITION_POINT = 20
    # - MIN_HARDWARE_BRIGHTNESS = 30
    # - MAX_DARKEN_PERCENT = 80
    # - Result: Uses hardware dimming less, better color at low brightness
    #
    
    def _calculate_brightness_values(self, user_brightness: int) -> Tuple[int, int]:
        """
        Calculate hardware brightness and darkness percentage from user brightness.
        
        This implements a unified brightness system with two ranges:
        
        LOW RANGE (0 to BRIGHTNESS_TRANSITION_POINT):
        - Hardware brightness varies: MIN_HARDWARE_BRIGHTNESS to MAX_HARDWARE_BRIGHTNESS
        - Darkness fixed at: MAX_DARKEN_PERCENT
        - Example: 0-50% user â†’ hardware 10-100%, darkness 94%
        
        HIGH RANGE (BRIGHTNESS_TRANSITION_POINT to 100):
        - Hardware brightness fixed at: 100%
        - Darkness varies: MAX_DARKEN_PERCENT to MIN_DARKEN_PERCENT (with curve)
        - Example: 50-100% user â†’ hardware 100%, darkness 94-0%
        
        Args:
            user_brightness: Home Assistant brightness value (1-255)
        
        Returns:
            tuple: (hardware_brightness_percent, darken_percent)
                - hardware_brightness_percent: 1-100 (Yeelight hardware brightness)
                - darken_percent: 0-100 (RGB darkening amount)
        """
        # Clamp to valid range
        user_brightness = max(1, min(255, user_brightness))
        
        # Convert to percentage (1-255 â†’ 1-100%)
        user_brightness_pct = (user_brightness / 255) * 100
        
        transition_point = self._calib_brightness_transition
        min_hw = self._calib_min_hw_brightness
        max_hw = self._calib_max_hw_brightness
        max_dark = self._calib_max_darken
        min_dark = self._calib_min_darken
        dark_20 = self._calib_dark_at_20
        dark_50 = self._calib_dark_at_50
        dark_80 = self._calib_dark_at_80
        low_min_dark = self._calib_low_min_darken
        
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # LOW BRIGHTNESS RANGE: Use hardware dimming + maximum darkness
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if user_brightness_pct <= transition_point:
            # Darken ramps from low_min_dark (at 0%) to max_dark (at transition)
            # This preserves pixel precision at low brightness instead of crushing values
            if transition_point > 0:
                position = user_brightness_pct / transition_point  # 0.0 to 1.0
                darken_percent = low_min_dark + (max_dark - low_min_dark) * position
                hw_range = max_hw - min_hw
                hardware_brightness = min_hw + (hw_range * position)
            else:
                hardware_brightness = max_hw
                darken_percent = max_dark
            
            hardware_brightness = int(round(max(1, min(100, hardware_brightness))))
            darken_percent = int(round(max(0, min(100, darken_percent))))
            
            _LOGGER.debug(
                f"[BRIGHTNESS] LOW range: user={user_brightness_pct:.1f}% â†’ "
                f"hardware={hardware_brightness}%, darkness={darken_percent}%"
            )
            
            return (hardware_brightness, darken_percent)
        
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # HIGH BRIGHTNESS RANGE: Use maximum hardware + darkness curve
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else:
            # Hardware brightness is fixed at maximum
            hardware_brightness = 100
            
            # Darkness decreases as brightness increases (with curve control points)
            # Define control points for smooth interpolation
            # Control points adapt to transition point:
            # - If transition=50: use 60, 75, 90 (above transition)
            # - If transition=30: use 45, 65, 85 (scaled proportionally)
            high_range = 100 - transition_point
            cp1 = transition_point + (high_range * 0.2)  # 20% into high range
            cp2 = transition_point + (high_range * 0.5)  # 50% into high range
            cp3 = transition_point + (high_range * 0.8)  # 80% into high range
            
            control_points = [
                (transition_point, max_dark),  # At transition: max darkness
                (cp1, dark_20),         # 20% into high range
                (cp2, dark_50),         # 50% into high range
                (cp3, dark_80),         # 80% into high range
                (100, min_dark),               # At 100%: no darkness
            ]
            
            # Find the two control points to interpolate between
            darken_percent = min_dark  # Default fallback
            
            for i in range(len(control_points) - 1):
                brightness_low, darken_low = control_points[i]
                brightness_high, darken_high = control_points[i + 1]
                
                if user_brightness_pct <= brightness_high:
                    # Linear interpolation between the two points
                    if brightness_high == brightness_low:
                        darken_percent = darken_low
                    else:
                        position = (user_brightness_pct - brightness_low) / (brightness_high - brightness_low)
                        darken_percent = darken_low + (darken_high - darken_low) * position
                    
                    break
            
            darken_percent = int(round(max(0, min(100, darken_percent))))
            
            _LOGGER.debug(
                f"[BRIGHTNESS] HIGH range: user={user_brightness_pct:.1f}% â†’ "
                f"hardware={hardware_brightness}%, darkness={darken_percent}%"
            )
            
            return (hardware_brightness, darken_percent)

    
    def __init__(self, cube_matrix: CubeMatrix, ip: str, config_entry: ConfigEntry):
        # _palettes and _pixel_arts are now @property methods accessing global storage
        self._cube_matrix = cube_matrix
        self._ip = ip
        self._config_entry = config_entry  # Always set during initialization
        self._attr_name = f"{cube_matrix.device_name} ({ip})"
        # Use IP as primary unique identifier to ensure uniqueness across multiple devices
        # Format: yeelight_cube_192_168_4_139
        self._attr_unique_id = f'yeelight_cube_{ip.replace(".", "_")}'
        # Safeguard: check that the generated name does not end with _palettes (without _v2)
        self._safeguard_entity_id(self._attr_name.lower().replace(' ', '_'))
        self._is_on = True
        self._layout = Layout("vertical", "bottom", [Module("1x1") for _ in range(100)])
        self._custom_text = "HELLO"
        self._brightness = 255  # Store brightness as 0-255 internally
        self._text_colors = [(255, 0, 0), (0, 0, 255)]  # [solid/gradient start, gradient end]
        self._mode = "Solid Color"
        self._panel_mode = False  # Whether to apply gradients to whole panel instead of just text
        self._angle = 0.0
        self._background_color = (0, 0, 0)
        self._alignment = "center"  # Default alignment is center
        self._font = "basic"  # Font key for FONT_MAPS (use "basic" as default)
        self._orientation = ORIENTATION_NORMAL  # "normal" or "flipped"
        self._rgb_color = (255, 0, 0)  # Default red color for Home Assistant color picker
        
        # Text scrolling functionality
        self._scroll_speed = 0.2  # Scroll speed in seconds per step
        self._scroll_enabled = True  # Whether to enable auto-scroll for long text
        self._scroll_offset = 0  # Current scroll position
        self._scroll_direction = 1  # 1 for right, -1 for left
        self._scroll_timer = None  # Timer for auto-scrolling
        self._max_scroll_offset = 0  # Maximum scroll offset for current text
        self._is_scrolling = False  # Flag to indicate if currently in scroll animation
        
        # Connection error tracking for reconnect button
        self._connection_error = False
        self._last_connection_error = None
        
        # FX mode tracking to avoid redundant mode changes
        self._fx_mode_is_direct = False  # Track if we're already in direct/music mode
        self._last_fx_mode_time = 0.0    # When activate_fx_mode last succeeded
        
        # Apply timing (for queue processor stats, not cooldown-gating)
        self._last_apply_time = 0
        
        # Hardware brightness tracking to avoid redundant brightness commands
        self._last_hardware_brightness = None  # Track last hardware brightness sent to lamp
        self._last_applied_darken = None       # Track last darken% actually rendered to lamp pixels
        
        # Color effect settings (organized by category)
        # Note: _preview_darken and _preview_brighten kept internally for brightness control logic
        # but removed from UI - use light brightness slider instead
        self._preview_darken = 0        # 0-100: used internally by brightness control
        self._preview_brighten = 0      # 0-100: reserved for future use
        # Color Adjustments
        self._preview_hue_shift = 0     # -180 to +180: rotate hue
        self._preview_temperature = 0   # -100 to +100: cool to warm
        # Saturation & Intensity
        self._preview_saturation = 100  # 0-200: 0=gray, 100=normal, 200=hyper
        self._preview_vibrance = 100    # 0-200: smart saturation
        # Tone & Contrast
        self._preview_contrast = 100    # 0-200: 0=flat, 100=normal, 200=high
        self._preview_glow = 0          # 0-100: boost bright pixels
        # Special Effects
        self._preview_grayscale = 0     # 0-100: convert to black & white
        self._preview_invert = 0        # 0-100: blend with inverted
        self._preview_tint_hue = 0      # 0-360: tint color hue
        self._preview_tint_strength = 0 # 0-100: tint blend amount
        # Hardware color correction is always active (see _apply_color_correction)
        # Hardware color accuracy — always-on by default (see _apply_color_accuracy).
        # Compensates for LED colour rendering differences vs. a computer monitor
        # by applying per-channel gain that fades with brightness.  The service
        # set_color_accuracy still exists to toggle at runtime but the default is ON.
        self._color_accuracy_enabled = True  # Per-channel gain to match monitor colours
        
        # ── Calibration overrides (runtime-tunable via set_color_calibration) ──
        # System 1: Low-brightness gamma correction
        self._calib_gamma_r = 0.85
        self._calib_gamma_g = 0.75
        self._calib_gamma_b = 0.65
        self._calib_hw_threshold = 50  # hw% above which correction is OFF
        self._calib_hw_full = 10       # hw% at/below which correction is 100%
        self._calib_channel_balance = 0.7  # 0=pure uniform (hue-safe), 1=per-channel (blue fix)
        # System 2: Monitor-matching per-channel gain
        self._calib_gain_r = 1.00
        self._calib_gain_g = 1.00
        self._calib_gain_b = 1.00
        # System 3: Brightness curve parameters (override class-level constants)
        self._calib_brightness_transition = self.BRIGHTNESS_TRANSITION_POINT
        self._calib_min_hw_brightness = self.MIN_HARDWARE_BRIGHTNESS
        self._calib_max_hw_brightness = self.MAX_HARDWARE_BRIGHTNESS
        self._calib_max_darken = self.MAX_DARKEN_PERCENT
        self._calib_min_darken = self.MIN_DARKEN_PERCENT
        self._calib_dark_at_20 = self.DARKNESS_AT_20_PCT_HIGH
        self._calib_dark_at_50 = self.DARKNESS_AT_50_PCT_HIGH
        self._calib_dark_at_80 = self.DARKNESS_AT_80_PCT_HIGH
        self._calib_low_min_darken = self.LOW_MIN_DARKEN_PERCENT
        
        # Retry task: schedules a display retry after connection errors
        # so the lamp eventually recovers when the device becomes reachable.
        self._retry_display_task = None
        self._display_retry_count = 0  # Track consecutive retries for logging
        
        # Circuit breaker: tracks recent hard timeouts to reject new ops early
        # instead of queueing them behind the lock for 8s each.
        self._hard_timeout_times = []  # List of timestamps of recent hard timeouts
        
        # Track background tasks (fire-and-forget brightness commands)
        self._background_tasks = set()
        
        # Track last successful brightness change (timestamp, user_brightness)
        # Used to prevent retry queue from overwriting newer brightness values
        # This is CRITICAL for unified brightness system (hardware + darkness)
        self._last_successful_brightness = None  # (timestamp, user_brightness_0_255)
        
        # Brightness retry queue - stores failed brightness values to retry when connection recovers
        # Unlike generic retry queue, this stores COMPLETE user brightness (not hardware commands)
        self._pending_brightness = None  # (user_brightness_0_255, timestamp) or None
        self._brightness_retry_task = None  # Background task for brightness retries
        
        # Reference to text input entity for bidirectional updates
        self._text_input_entity = None
        
        # Reference to pixel art select entity for bidirectional updates
        self._pixel_art_select_entity = None
        
        # Reference to display mode select entity for bidirectional updates
        self._mode_select_entity = None
        
        # Reference to alignment select entity for bidirectional updates
        self._alignment_select_entity = None
        
        # Reference to font select entity for bidirectional updates
        self._font_select_entity = None
        
        # Reference to gradient angle number entity for bidirectional updates
        self._angle_number_entity = None
        
        # Dict of preview adjustment number entities keyed by spec key (e.g. "hue_shift")
        self._preview_number_entities = {}
        
        # Track the name of the currently active pixel art (for dropdown preselection)
        self._active_pixel_art_name = None
        
        # Periodic health check: detects when an unreachable device comes back online.
        # Runs in parallel with the retry system, probing at 10s intervals during
        # active failures.  After MAX_DISPLAY_RETRIES (6), retries stop but the
        # health check continues probing until the device recovers.
        self._health_check_task = None
        # Health check interval is adaptive (computed dynamically):
        # 10s during active failures, 15s when recently online, 60s when long-dead
        
        # Base (un-darkened) matrix colors for immediate brightness preview.
        # Snapshotted in apply() right before brightness darkening.  Used by
        # extra_state_attributes to return correctly brightness-adjusted colors
        # without double-darkening (module.data may already be darkened after apply).
        self._base_matrix_colors = None
        
        # â”€â”€ Transition settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        self._transition_type = "none"           # Transition effect key (see select.py _TRANSITION_TYPES)
        self._transition_steps = 5               # Number of intermediate frames (1-10)
        self._transition_duration = 1.0          # Total transition time in seconds (0.2-10.0)
        self._transition_active = False          # Re-entrancy guard
        self._last_sent_colors = None            # List of 100 RGB tuples last sent to lamp
        self._current_update_type = 'display_update'  # Tracks current operation type for transition logic
        
        # Entity references for transition controls
        self._transition_select_entity = None
        self._transition_steps_entity = None
        self._transition_duration_entity = None
        
        # Camera entity references â€” set by camera.py async_setup_entry.
        # Used for direct push notifications (bypass state-change-event delay).
        self._camera_entities: list = []
    
    def _notify_camera_preview(self) -> None:
        """Re-render all camera entities and push their state SYNCHRONOUSLY.

        Must be called BEFORE ``async_schedule_update_ha_state()`` on the
        light entity so the camera image is already cached when the frontend
        makes the HTTP fetch triggered by the light state change.
        This avoids the double-request problem (stale image â†’ re-fetch).
        """
        cams = getattr(self, '_camera_entities', None)
        if cams:
            for cam in cams:
                try:
                    cam.async_refresh_preview()
                except Exception:
                    pass  # camera not yet ready â€” ignore

    @property
    def _palettes(self):
        """Access global palette storage - all lights share the same palette list"""
        if DOMAIN not in self.hass.data:
            self.hass.data[DOMAIN] = {}
        if "palettes_v2" not in self.hass.data[DOMAIN]:
            self.hass.data[DOMAIN]["palettes_v2"] = []
        return self.hass.data[DOMAIN]["palettes_v2"]
    
    @property
    def _pixel_arts(self):
        """Access global pixel art storage - all lights share the same pixel art list"""
        if DOMAIN not in self.hass.data:
            self.hass.data[DOMAIN] = {}
        if "pixel_arts" not in self.hass.data[DOMAIN]:
            self.hass.data[DOMAIN]["pixel_arts"] = []
        return self.hass.data[DOMAIN]["pixel_arts"]
    
    def _sync_rgb_color(self):
        """Synchronize _rgb_color with the first color in _text_colors"""
        if self._text_colors and len(self._text_colors) > 0:
            self._rgb_color = self._text_colors[0]
            _LOGGER.debug(f"[SYNC] Synchronized _rgb_color to {self._rgb_color} from text_colors")
    
    async def _execute_hardware_op(self, func, op_name: str, timeout_override: float = None):
        """Execute a hardware operation under the global lock with timeout and error handling.
        
        Replaces the old queue processor.  Operations are serialized across all
        entity instances via per-device locks.  A hard timeout prevents hung
        socket operations from blocking the lock indefinitely.
        
        Args:
            timeout_override: Optional custom timeout (seconds).  Used when a
                              display transition needs more time than the default
                              APPLY_HARD_TIMEOUT.
        """
        op_id = int(time.time() * 1000) % 100000
        effective_timeout = timeout_override or APPLY_HARD_TIMEOUT
        
        # CIRCUIT BREAKER: If 2+ hard timeouts occurred in the last N seconds,
        # reject immediately instead of queueing behind the lock for 8s each.
        # This prevents the cascade where 5+ operations pile up, each waiting
        # 8s to timeout, creating 40s+ of stuck state.
        now = time.time()
        self._hard_timeout_times = [t for t in self._hard_timeout_times if now - t < CIRCUIT_BREAKER_WINDOW]
        if len(self._hard_timeout_times) >= 2:
            _LOGGER.warning(
                f"[OP #{op_id}] [{self._ip}] âš¡ CIRCUIT BREAKER â€” rejecting {op_name} "
                f"({len(self._hard_timeout_times)} timeouts in last {CIRCUIT_BREAKER_WINDOW:.0f}s). "
                f"Device appears unreachable, will recover via health check."
            )
            self._connection_error = True
            # Only schedule display retries for display operations
            if op_name.startswith('display:'):
                self._maybe_schedule_retry()
            return
        
        _LOGGER.debug(
            f"[OP #{op_id}] [{self._ip}] â–¶ {op_name} "
            f"(is_on={self._is_on}, fx_direct={self._fx_mode_is_direct}) "
            f"[{self._cube_matrix._state_summary()}]"
        )
        is_display_op = op_name.startswith('display:')
        try:
            lock_wait_start = time.time()
            async with _get_device_lock(self._ip):
                lock_wait_ms = (time.time() - lock_wait_start) * 1000
                if lock_wait_ms > 5:
                    _LOGGER.warning(
                        f"[OP #{op_id}] [{self._ip}] Lock waited {lock_wait_ms:.0f}ms"
                    )
                try:
                    await asyncio.wait_for(func(), timeout=effective_timeout)
                except asyncio.TimeoutError:
                    _LOGGER.error(
                        f"[OP #{op_id}] [{self._ip}] âš  HARD TIMEOUT â€” "
                        f"{op_name} exceeded {effective_timeout:.0f}s, releasing lock"
                    )
                    self._fx_mode_is_direct = False
                    self._cube_matrix._close_fast_socket()
                    self._connection_error = True
                    self._last_connection_error = f"Hard timeout: {op_name}"
                    self._hard_timeout_times.append(time.time())
                    self._cube_matrix._consecutive_failures += 1
                    # Only schedule display retries for display operations
                    if is_display_op:
                        self._maybe_schedule_retry()
                    return
            # Success
            _LOGGER.debug(f"[OP #{op_id}] [{self._ip}] âœ“ {op_name} complete")
            # Only reset display retry state on display op success
            if is_display_op:
                self._display_retry_count = 0
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
            self._connection_error = False
            self._cube_matrix._consecutive_failures = 0
            # Clear circuit breaker on any success
            self._hard_timeout_times.clear()
        except AttributeError as e:
            if "'NoneType'" in str(e):
                _LOGGER.debug(
                    f"[OP #{op_id}] [{self._ip}] Socket gone â€” resetting FX mode"
                )
                self._connection_error = True
                self._last_connection_error = "Connection lost"
                self._fx_mode_is_direct = False
                if is_display_op:
                    self._maybe_schedule_retry()
            else:
                _LOGGER.error(f"[OP #{op_id}] [{self._ip}] AttributeError: {e}")
        except BulbException as e:
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_message = error_dict.get('message', str(e))
            self._connection_error = True
            self._last_connection_error = f"BulbException: {error_message}"
            if any(kw in error_message.lower() for kw in ['socket', 'closed', 'connection']):
                _LOGGER.warning(
                    f"[OP #{op_id}] [{self._ip}] Connection error: {error_message}"
                )
                if is_display_op:
                    self._maybe_schedule_retry()
            else:
                _LOGGER.warning(
                    f"[OP #{op_id}] [{self._ip}] BulbException: {error_message}"
                )
        except TimeoutError:
            _LOGGER.debug(
                f"[OP #{op_id}] [{self._ip}] Timeout â€” device unreachable"
            )
            self._connection_error = True
            self._last_connection_error = "Device timeout"
            self._cube_matrix._consecutive_failures += 1
            if is_display_op:
                self._maybe_schedule_retry()
        except Exception as e:
            error_msg = str(e).lower()
            if any(kw in error_msg for kw in ['socket', 'connection', 'cooldown', 'closed', 'timeout', 'unreachable']):
                self._connection_error = True
                self._last_connection_error = str(e)
                _LOGGER.warning(
                    f"[OP #{op_id}] [{self._ip}] Connection error: {e}"
                )
                self._cube_matrix._consecutive_failures += 1
                if is_display_op:
                    self._maybe_schedule_retry()
            else:
                _LOGGER.error(
                    f"[OP #{op_id}] [{self._ip}] Unexpected error in {op_name}: {e}"
                )

    MAX_DISPLAY_RETRIES = 3  # 3 retries â‰ˆ 20s total, then health check takes over

    def _maybe_schedule_retry(self):
        """Schedule a display retry if the retry limit hasn't been reached.
        
        Thin wrapper that avoids log-spam: only logs 'stopping' ONCE when the
        limit is first hit, then stays silent on subsequent calls.
        """
        if self._display_retry_count >= self.MAX_DISPLAY_RETRIES:
            _LOGGER.debug(
                f"[RETRY] [{self._ip}] Skipping retry â€” already at limit "
                f"({self._display_retry_count}/{self.MAX_DISPLAY_RETRIES})"
            )
            return
        self._schedule_display_retry()

    def _schedule_display_retry(self):
        """Schedule a delayed retry of the display update after a connection error.
        
        This is the critical piece that prevents the lamp from staying dark forever
        after a boot failure. When the queue processor fails (e.g., device unreachable
        after HA reboot), this schedules a future async_apply_display_mode() call
        that respects the exponential backoff:
        
          boot â†’ apply fails â†’ retry in 2s â†’ fails â†’ retry in 2s â†’ fails â†’ backoff â†’ 4s â†’ ...
        
        Only ONE retry task runs at a time. A successful display update clears the retry.
        User-initiated actions (turn_on, set_color, etc.) also naturally re-queue,
        so this retry only matters when nothing else is driving updates.
        
        After MAX_DISPLAY_RETRIES (6 retries â‰ˆ 50s), stops retrying â€” health check
        at 10s intervals takes over for longer outages. User actions will still
        trigger a fresh display update, resetting the counter.
        """
        self._display_retry_count += 1
        
        if self._display_retry_count > self.MAX_DISPLAY_RETRIES:
            _LOGGER.warning(
                f"[RETRY] [{self._ip}] Stopping auto-retry after {self.MAX_DISPLAY_RETRIES} consecutive failures. "
                f"The lamp appears to be offline. Display will resume on next user action or HA restart. "
                f"[{self._cube_matrix._state_summary()}]"
            )
            return
        
        # Cancel any existing retry task (avoid stacking retries)
        if self._retry_display_task and not self._retry_display_task.done():
            _LOGGER.debug(f"[RETRY] [{self._ip}] Cancelling existing display retry task")
            self._retry_display_task.cancel()
        
        # Calculate delay: first retry is quick (2.5s) to catch transient network
        # hiccups before engaging exponential backoff.  Subsequent retries use
        # the device's current cooldown + buffer.
        QUICK_RETRY_DELAY = 1.5  # seconds â€” fast enough to recover from a 1-2s WiFi hiccup
                                 # Reduced from 2.5s since inner timeouts are now tighter
        cooldown = self._cube_matrix._reconnect_cooldown
        if self._display_retry_count == 1:
            delay = QUICK_RETRY_DELAY
        else:
            delay = cooldown + 0.5
        
        # Add random jitter (0-1.5s) to desynchronize retries across lamps.
        # When two lamps fail at the same moment, they get identical cooldown
        # schedules and retry simultaneously â€” each round has both lamps
        # hitting the network at once, prolonging the failure.  Jitter breaks
        # this synchronization so they stagger naturally.
        import random as _rng
        delay += _rng.uniform(0, 1.5)
        
        async def _delayed_retry():
            try:
                _LOGGER.debug(
                    f"[RETRY] [{self._ip}] Attempt {self._display_retry_count}/{self.MAX_DISPLAY_RETRIES} â€” "
                    f"waiting {delay:.1f}s before retry "
                    f"[{self._cube_matrix._state_summary()}]"
                )
                await asyncio.sleep(delay)
                
                _LOGGER.debug(
                    f"[RETRY] [{self._ip}] Retrying display update now (attempt {self._display_retry_count}) "
                    f"[{self._cube_matrix._state_summary()}]"
                )
                await self.async_apply_display_mode(update_type='display_retry')
                _LOGGER.debug(f"[RETRY] [{self._ip}] Display retry sent")
            except asyncio.CancelledError:
                _LOGGER.debug(f"[RETRY] [{self._ip}] Display retry CANCELLED")
            except Exception as e:
                _LOGGER.warning(f"[RETRY] [{self._ip}] Unexpected error in display retry: {e}")
        
        self._retry_display_task = asyncio.create_task(_delayed_retry())
        _LOGGER.debug(
            f"[RETRY] [{self._ip}] Scheduled retry {self._display_retry_count}/{self.MAX_DISPLAY_RETRIES} "
            f"in {delay:.1f}s (cooldown={cooldown:.0f}s, failures={self._cube_matrix._consecutive_failures})"
        )

    async def _periodic_health_check(self):
        """Periodically probe devices with active issues and reconnect when they come back.
        
        This runs in parallel with the retry system, providing a secondary
        recovery path.  It probes whenever there are ANY active issues:
        - consecutive failures > 0 (early detection, before retry exhaustion)
        - device marked unreachable (exponential backoff triggered)
        - display retries in progress (parallel recovery alongside retries)
        - retry limit reached (sole recovery mechanism after retries exhausted)
        
        Uses adaptive intervals: 10s during active failures (matches max retry
        backoff), 15s monitor mode, 60s when long-dead.
        
        Flow:
          1. Sleep for adaptive interval (10s during failures, 15s when recently online, 60s when long-dead)
          2. If device has no active issues â†’ skip
          3. TCP probe the device (CONNECT_TIMEOUT timeout)
          4. If reachable â†’ reset all failure counters and trigger a fresh display update
          5. If still unreachable â†’ log at debug level, try again next cycle
        """
        _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check started (adaptive interval)")
        while True:
            try:
                # ADAPTIVE INTERVAL:
                #  - 10s when there are active failures (fastest recovery)
                #  - 15s when device was online recently (monitor mode)
                #  - 60s when device has been down a while (reduce noise)
                has_active_issues = (
                    self._cube_matrix._device_unreachable or
                    self._cube_matrix._consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                last_success = self._cube_matrix._last_success_time
                time_since_success = time.time() - last_success if last_success > 0 else 999
                if has_active_issues:
                    interval = 10  # Aggressive probing during failures
                elif time_since_success < 300:  # online within last 5 minutes
                    interval = 15
                else:
                    interval = 60
                
                # PERIODIC BRIGHTNESS STATE SNAPSHOT â€” logs every cycle so we can
                # see the stored brightness values even when nothing is changing.
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] SNAPSHOT â€” "
                    f"user={self._brightness}/255, "
                    f"last_hw={self._last_hardware_brightness}, "
                    f"darken={self._preview_darken}%, "
                    f"last_applied_darken={self._last_applied_darken}, "
                    f"is_on={self._is_on}, fx_direct={self._fx_mode_is_direct}, "
                    f"unreachable={self._cube_matrix._device_unreachable}, "
                    f"failures={self._cube_matrix._consecutive_failures}, "
                    f"interval={interval}s"
                )
                await asyncio.sleep(interval)
                
                # Probe when the device has ANY active issue:
                # - unreachable flag is set (exponential backoff triggered)
                # - retry counter hit the limit (retries exhausted)
                # - consecutive failures > 0 (early detection before unreachable)
                # - display retries in progress (parallel recovery path)
                is_stuck = (
                    self._cube_matrix._device_unreachable or
                    self._display_retry_count >= self.MAX_DISPLAY_RETRIES or
                    self._cube_matrix._consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                if not is_stuck:
                    continue
                
                _LOGGER.debug(
                    f"[HEALTH] [{self._ip}] Probing device (unreachable={self._cube_matrix._device_unreachable}, "
                    f"retries={self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}, "
                    f"failures={self._cube_matrix._consecutive_failures}, "
                    f"interval={interval}s)"
                )
                
                # Quick TCP probe â€” use longer timeout for recovery.
                # Normal commands use 0.5s, but a lamp rebooting may have
                # slow TCP handshakes.  3s gives reliable detection.
                import socket as _socket
                probe_timeout = RECOVERY_CONNECT_TIMEOUT
                sock = None
                try:
                    sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
                    sock.settimeout(probe_timeout)
                    # SO_LINGER RST close â€” avoids TIME_WAIT on probe sockets
                    import struct as _struct
                    sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_LINGER, _struct.pack('ii', 1, 0))
                    await asyncio.to_thread(sock.connect, (self._ip, self._cube_matrix._port))
                    sock.close()
                    sock = None
                except (OSError, ConnectionRefusedError, TimeoutError):
                    # Log at WARNING so the user can see probes are happening
                    _LOGGER.warning(
                        f"[HEALTH] [{self._ip}] Probe failed â€” still unreachable "
                        f"(retries={self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}, "
                        f"failures={self._cube_matrix._consecutive_failures}, "
                        f"timeout={probe_timeout}s)"
                    )
                    if sock is not None:
                        try:
                            sock.close()
                        except Exception:
                            pass
                    continue
                
                # Device is back! Reset everything and trigger a fresh display.
                _LOGGER.warning(
                    f"[HEALTH] [{self._ip}] âœ“ Device is BACK ONLINE! "
                    f"Resetting failures ({self._cube_matrix._consecutive_failures}â†’0), "
                    f"retries ({self._display_retry_count}â†’0), "
                    f"cooldown ({self._cube_matrix._reconnect_cooldown:.0f}sâ†’{RECONNECT_COOLDOWN_INITIAL}s)"
                )
                self._cube_matrix._close_fast_socket()  # Ensure fresh socket after recovery
                self._cube_matrix._consecutive_failures = 0
                self._cube_matrix._device_unreachable = False
                self._cube_matrix._connection_healthy = True
                self._cube_matrix._reconnect_cooldown = RECONNECT_COOLDOWN_INITIAL
                self._cube_matrix._last_reconnect_attempt = 0
                self._display_retry_count = 0
                self._fx_mode_is_direct = False  # Force FX mode re-send
                self._connection_error = False
                self._hard_timeout_times.clear()  # Clear circuit breaker
                
                # Trigger a full display update (turn_on type so it isn't blocked)
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] HEALTH RECOVERY â€” will apply display mode. "
                    f"user={self._brightness}/255, last_hw={self._last_hardware_brightness}, "
                    f"darken={self._preview_darken}%, fx_direct={self._fx_mode_is_direct}"
                )
                await self.async_apply_display_mode(update_type='turn_on')
                
            except asyncio.CancelledError:
                _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check cancelled")
                break
            except Exception as e:
                _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check error: {e}")
        
        _LOGGER.debug(f"[HEALTH] [{self._ip}] Health check stopped")

        
    # Removed duplicate/empty __init__ definition
    @property
    def orientation(self):
        return self._orientation

    async def set_orientation(self, orientation: str):
        if orientation not in (ORIENTATION_NORMAL, ORIENTATION_FLIPPED):
            _LOGGER.error(f"Invalid orientation value: {orientation}")
            return
        self._orientation = orientation
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @property
    def alignment(self):
        return self._alignment

    async def set_alignment(self, alignment: str):
        if alignment not in ("left", "center", "right"):
            _LOGGER.error(f"Invalid alignment value: {alignment}")
            return
        self._alignment = alignment
        await self.async_apply_display_mode(update_type='text_change')
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @property
    def text_colors(self):
        return self._text_colors


    @property
    def supported_color_modes(self):
        return {ColorMode.RGB}

    @property
    def color_mode(self):
        # Current active color mode
        return ColorMode.RGB

    @property
    def brightness(self):
        # Home Assistant expects 1-255 for lights that are ON
        # We return None when OFF (standard HA behavior)
        # When ON, return stored brightness, ensuring it's at least 1
        if not self._is_on:
            return None
        # Ensure brightness is at least 1 (minimum valid brightness for ON lights)
        return max(1, self._brightness)

    @property
    def rgb_color(self):
        # Home Assistant expects RGB tuple for color picker
        # Always return the first text color to stay in sync with the actual lamp state
        if self._text_colors and len(self._text_colors) > 0:
            return self._text_colors[0]
        return self._rgb_color  # Fallback to stored rgb_color if no text colors

    @property 
    def rgb_color_list(self):
        # Extended property that could be used by custom cards for gradient display
        # Returns all text colors for gradient representation
        return self._text_colors if self._text_colors else [self._rgb_color]

    @property
    def custom_text(self):
        return self._custom_text
    
    def _should_auto_turn_on(self) -> bool:
        """Check if lamp should auto-turn-on when receiving commands while off."""
        if not self._config_entry:
            # Default to True (current behavior) if no config entry
            return True
        # Get from options, default to True
        return self._config_entry.options.get("auto_turn_on", True)

    # Use self._attr_name and self._attr_unique_id (set in __init__) for Home Assistant entity name and unique_id

    @property
    def is_on(self):
        return self._is_on

    @property
    def extra_state_attributes(self):
        attrs = {
            # Internal component identifier - DO NOT MODIFY
            "_yeelight_cube_component": "yeelight-cube-component-v1.0",
            # Entity identification - useful for service calls and automations
            "light_entity_id": self.entity_id if hasattr(self, 'entity_id') else "not_yet_initialized",
            "ip_address": self._ip,
            # Epoch timestamp for end-to-end latency measurement
            # JS card reads this and compares to Date.now() to detect pipeline delays
            "_update_epoch": time.time(),
            # Display configuration
            "mode": self._mode,
            "text_colors": self._text_colors,
            "custom_text": self._custom_text,
            "background_color": self._background_color,
            "alignment": self._alignment,
            "angle": self._angle,
            "font": self._font,
            "orientation": self._orientation,
            "rgb_color": self._rgb_color,
            "panel_mode": self._panel_mode,
            # Color effects (used by lamp preview card)
            "preview_hue_shift": self._preview_hue_shift,
            "preview_temperature": self._preview_temperature,
            "preview_saturation": self._preview_saturation,
            "preview_vibrance": self._preview_vibrance,
            "preview_contrast": self._preview_contrast,
            "preview_glow": self._preview_glow,
            "preview_grayscale": self._preview_grayscale,
            "preview_invert": self._preview_invert,
            "preview_tint_hue": self._preview_tint_hue,
            "preview_tint_strength": self._preview_tint_strength,
            "preview_darken": self._preview_darken,
            "color_accuracy_enabled": self._color_accuracy_enabled,
            # Calibration values (for debug calibration card)
            "calib_gamma_r": self._calib_gamma_r,
            "calib_gamma_g": self._calib_gamma_g,
            "calib_gamma_b": self._calib_gamma_b,
            "calib_hw_threshold": self._calib_hw_threshold,
            "calib_hw_full": self._calib_hw_full,
            "calib_channel_balance": self._calib_channel_balance,
            "calib_gain_r": self._calib_gain_r,
            "calib_gain_g": self._calib_gain_g,
            "calib_gain_b": self._calib_gain_b,
            # Brightness curve calibration
            "calib_brightness_transition": self._calib_brightness_transition,
            "calib_min_hw_brightness": self._calib_min_hw_brightness,
            "calib_max_hw_brightness": self._calib_max_hw_brightness,
            "calib_max_darken": self._calib_max_darken,
            "calib_min_darken": self._calib_min_darken,
            "calib_dark_at_20": self._calib_dark_at_20,
            "calib_dark_at_50": self._calib_dark_at_50,
            "calib_dark_at_80": self._calib_dark_at_80,
            "calib_low_min_darken": self._calib_low_min_darken,
            "last_hardware_brightness": self._last_hardware_brightness,
            # Transition settings
            "transition_type": self._transition_type,
            "transition_steps": self._transition_steps,
            "transition_duration": self._transition_duration,
        }
        # Add current matrix state: list of 100 RGB tuples (or hex), and brightness.
        # CRITICAL: Apply _apply_final_brightness here so the JS card gets
        # brightness-adjusted colors IMMEDIATELY when the user drags the slider,
        # without waiting for the lamp roundtrip.  set_brightness() updates
        # _preview_darken and calls async_schedule_update_ha_state() before
        # queuing the actual lamp command â€” so this property is read with the
        # new darken value and the card preview updates instantly.
        #
        # We read from _base_matrix_colors (snapshot of un-darkened layout colors
        # taken right before apply()) and apply _apply_final_brightness() which
        # uses the full two-range brightness system (darken + brighten, floor()
        # math, channel preservation).  This avoids double-darkening: module.data
        # may already be darkened after apply(), but _base_matrix_colors is always
        # un-darkened.
        try:
            base_colors = getattr(self, '_base_matrix_colors', None)
            if base_colors and len(base_colors) == len(self._layout.device_layout):
                matrix_colors = [self._apply_final_brightness(rgb) for rgb in base_colors]
                attrs["matrix_colors"] = matrix_colors
            else:
                # Fallback: read directly from module data (may be darkened or not)
                matrix_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        hex_color = module.data[0].lstrip('#')
                        rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                        matrix_colors.append(rgb)
                    else:
                        matrix_colors.append((0, 0, 0))
                attrs["matrix_colors"] = matrix_colors
        except Exception as e:
            attrs["matrix_colors"] = []
        return attrs

    async def async_added_to_hass(self):
        _LOGGER.debug(f"[INIT] async_added_to_hass called for {self._attr_name}")
        await super().async_added_to_hass()
        self.async_on_remove(async_track_state_change_event(self.hass, self.entity_id, self.async_update))
        
        # Store config entry reference for accessing options
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.data.get(CONF_IP) == self._ip:
                self._config_entry = entry
                break
        
        # Start periodic health check to detect devices coming back online
        self._health_check_task = asyncio.create_task(self._periodic_health_check())
        
        # Register entity by entity_id now that it's available
        # Remove the temporary IP-based registration first to avoid duplicates
        if self._ip in _ENTITY_REGISTRY:
            del _ENTITY_REGISTRY[self._ip]
        _ENTITY_REGISTRY[self.entity_id] = self
        _LOGGER.debug(f"[SETUP] Registered entity {self.entity_id} in registry. Registry now contains: {list(_ENTITY_REGISTRY.keys())}")
        
        _LOGGER.debug(f"[INIT] Initial state - custom_text: '{self._custom_text}', mode: '{self._mode}', is_on: {self._is_on}, brightness: {self._brightness}")
        old_state = await self.async_get_last_state()
        _LOGGER.debug(f"[RESTORE] old_state exists: {old_state is not None}")
        if old_state:
            _LOGGER.debug(f"[RESTORE] old_state.state: {old_state.state}")
            _LOGGER.debug(f"[RESTORE] old_state.attributes keys: {list(old_state.attributes.keys())}")
            _LOGGER.debug(f"[RESTORE] Brightness in attributes: {old_state.attributes.get('brightness')}")
            _LOGGER.debug(f"[RESTORE] Full attributes: {old_state.attributes}")
            
            # Restore effect values (preview adjustments)
            # Note: preview_darken is no longer saved in state attributes (removed from UI)
            # We'll recalculate it from brightness below
            if old_state.attributes.get("preview_brighten") is not None:
                self._preview_brighten = int(old_state.attributes["preview_brighten"])
            # Color Adjustments
            if old_state.attributes.get("preview_hue_shift") is not None:
                self._preview_hue_shift = int(old_state.attributes["preview_hue_shift"])
            if old_state.attributes.get("preview_temperature") is not None:
                self._preview_temperature = int(old_state.attributes["preview_temperature"])
            # Saturation & Intensity
            if old_state.attributes.get("preview_saturation") is not None:
                self._preview_saturation = int(old_state.attributes["preview_saturation"])
            if old_state.attributes.get("preview_vibrance") is not None:
                self._preview_vibrance = int(old_state.attributes["preview_vibrance"])
            # Tone & Contrast
            if old_state.attributes.get("preview_contrast") is not None:
                self._preview_contrast = int(old_state.attributes["preview_contrast"])
            if old_state.attributes.get("preview_glow") is not None:
                self._preview_glow = int(old_state.attributes["preview_glow"])
            # Special Effects
            if old_state.attributes.get("preview_grayscale") is not None:
                self._preview_grayscale = int(old_state.attributes["preview_grayscale"])
            if old_state.attributes.get("preview_invert") is not None:
                self._preview_invert = int(old_state.attributes["preview_invert"])
            if old_state.attributes.get("preview_tint_hue") is not None:
                self._preview_tint_hue = int(old_state.attributes["preview_tint_hue"])
            if old_state.attributes.get("preview_tint_strength") is not None:
                self._preview_tint_strength = int(old_state.attributes["preview_tint_strength"])
            # color_accuracy_enabled: no longer restored from old state.
            # It defaults to True and there's no UI toggle anymore.
            # The set_color_accuracy service still exists for advanced/automation use.
            _LOGGER.debug(f"[RESTORE] Restored effect values - hue_shift={self._preview_hue_shift}, temperature={self._preview_temperature}, saturation={self._preview_saturation}")
            
            if old_state.attributes.get("brightness") is not None:
                restored_brightness = int(old_state.attributes["brightness"])
                # Ensure brightness is at least 1 (Home Assistant minimum for ON lights)
                self._brightness = max(1, min(255, restored_brightness))
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] RESTORE â€” raw={restored_brightness}, "
                    f"clamped={self._brightness}, was_on={old_state.state}"
                )
                
                # CRITICAL: Recalculate hardware brightness and darken from user brightness
                hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
                self._preview_darken = darken_percent
                self._last_hardware_brightness = hardware_brightness
                self._last_applied_darken = darken_percent
                _LOGGER.debug(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] RESTORE CALC â€” user={self._brightness}/255 â†’ "
                    f"hardware={hardware_brightness}%, darken={darken_percent}%, "
                    f"preview_darken={self._preview_darken}, last_hw={self._last_hardware_brightness}"
                )
            if old_state.attributes.get("text_colors") is not None:
                self._text_colors = [tuple(c) for c in old_state.attributes["text_colors"]]
                _LOGGER.debug(f"[RESTORE] Restored text_colors: {self._text_colors}")
                # Synchronize _rgb_color with the first text color
                self._sync_rgb_color()
            else:
                _LOGGER.warning(f"[RESTORE] No text_colors found, checking fallback...")
                rgb = old_state.attributes.get("rgb_color")
                grad_start = old_state.attributes.get("gradient_start")
                grad_end = old_state.attributes.get("gradient_end")
                _LOGGER.debug(f"[RESTORE] Fallback values - rgb: {rgb}, grad_start: {grad_start}, grad_end: {grad_end}")
                if rgb and grad_start and grad_end:
                    self._text_colors = [tuple(rgb), tuple(grad_end)]
                    self._sync_rgb_color()
                    _LOGGER.debug(f"[RESTORE] Used gradient fallback: {self._text_colors}")
                elif rgb:
                    self._text_colors = [tuple(rgb)]
                    self._sync_rgb_color()
                    _LOGGER.debug(f"[RESTORE] Used rgb fallback: {self._text_colors}")
                else:
                    _LOGGER.warning(f"[RESTORE] No fallback values available, keeping defaults: {self._text_colors}")
            # Restore mode and custom_draw_active
            if old_state.attributes.get("custom_draw_active") is not None:
                self._custom_draw_active = bool(old_state.attributes["custom_draw_active"])
            else:
                # Fallback for old state: if mode == 'Custom Draw', treat as custom_draw_active
                self._custom_draw_active = old_state.attributes.get("mode") == "Custom Draw"
            if old_state.attributes.get("mode") is not None and old_state.attributes["mode"] != "Custom Draw":
                self._mode = old_state.attributes["mode"]
            elif not hasattr(self, "_mode") or not getattr(self, "_mode", None):
                # Always set a default mode if not present
                self._mode = "Solid Color"
            if old_state.attributes.get("custom_text") is not None:
                self._custom_text = old_state.attributes["custom_text"]
            if old_state.attributes.get("background_color") is not None:
                self._background_color = tuple(old_state.attributes["background_color"])
            if old_state.attributes.get("alignment") is not None:
                alignment_val = old_state.attributes["alignment"]
                if alignment_val in ("left", "center", "right"):
                    self._alignment = alignment_val
            if old_state.attributes.get("font") is not None:
                from .layout import FONT_MAPS
                font_val = old_state.attributes["font"]
                if font_val in FONT_MAPS:
                    self._font = font_val
            if old_state.attributes.get("angle") is not None:
                self._angle = float(old_state.attributes["angle"])
            # Restore transition settings
            if old_state.attributes.get("transition_type") is not None:
                t_type = old_state.attributes["transition_type"]
                _VALID_TRANSITIONS = {
                    "none", "fade_through_black", "direct_crossfade",
                    "random_dissolve", "pixel_migration",
                    "wipe_right", "wipe_left", "wipe_down", "wipe_up",
                    "slide_left", "slide_right", "slide_up", "slide_down",
                    "card_from_right", "card_from_left", "card_from_top", "card_from_bottom",
                    "explode_reform", "snake", "wave_wipe", "iris",
                    "vertical_flip", "curtain", "gravity_drop",
                }
                if t_type in _VALID_TRANSITIONS:
                    self._transition_type = t_type
            if old_state.attributes.get("transition_steps") is not None:
                self._transition_steps = max(1, min(10, int(old_state.attributes["transition_steps"])))
            if old_state.attributes.get("transition_duration") is not None:
                self._transition_duration = max(0.2, min(10.0, float(old_state.attributes["transition_duration"])))
            # Restore scroll settings
            if old_state.attributes.get("scroll_speed") is not None:
                self._scroll_speed = float(old_state.attributes["scroll_speed"])
            if old_state.attributes.get("scroll_enabled") is not None:
                self._scroll_enabled = bool(old_state.attributes["scroll_enabled"])
        # Palettes and pixel arts are accessed via @property from global storage
        # No restoration needed - __init__.py loads from Store into hass.data[DOMAIN]
        _LOGGER.debug(f"[RESTORE] Entity initialized. Palettes: {len(self._palettes)}, Pixel Arts: {len(self._pixel_arts)}")
            # Note: No need to copy back to hass.data - we're using shared references now
        self.async_schedule_update_ha_state()
        
        _LOGGER.debug(f"[INIT] After state restoration - custom_text: '{self._custom_text}', mode: '{self._mode}', is_on: {self._is_on}")
        _LOGGER.debug(f"[INIT] Calling initial async_apply_display_mode to display HELLO...")
        
        # Apply initial display mode to show HELLO
        # Use 'turn_on' type so this isn't blocked by the retry limit after HA restart
        if self._is_on:
            await self.async_apply_display_mode(update_type='turn_on')
        else:
            _LOGGER.debug(f"[INIT] Light is off, not applying display mode")

    async def async_will_remove_from_hass(self):
        """Clean up when entity is removed"""
        self.stop_scroll_timer()
        
        # Cancel display retry task
        if self._retry_display_task and not self._retry_display_task.done():
            self._retry_display_task.cancel()
        
        # Cancel health check task
        if self._health_check_task and not self._health_check_task.done():
            self._health_check_task.cancel()
        
        # Cancel all background tasks (fire-and-forget brightness commands)
        if self._background_tasks:
            _LOGGER.debug(f"[CLEANUP] Cancelling {len(self._background_tasks)} background tasks")
            for task in self._background_tasks:
                if not task.done():
                    task.cancel()
            # Wait for cancellation with timeout
            try:
                await asyncio.wait(self._background_tasks, timeout=1.0)
            except asyncio.TimeoutError:
                pass
            self._background_tasks.clear()
        
        _LOGGER.debug("[CLEANUP] Stopped scroll timer and background tasks on entity removal")

    # Pixel Art service handlers are now registered in async_setup_entry

    async def ensure_fx_ready(self):
        """Ensure FX mode is active using raw TCP (fresh connection per command).
        
        This is the proven-reliable approach: the Yeelight Cube Lite firmware
        always processes activate_fx_mode correctly on a FRESH TCP connection,
        but sometimes silently ignores it on a reused/persistent socket.
        
        Called automatically by _apply_impl before sending pixel data.
        Also available as the force_refresh service for manual recovery.
        
        Steps:
          0. Quick TCP probe â€” fail fast if device is unreachable
          1. Close any existing persistent socket (clean slate)
          2. Send activate_fx_mode on a fresh TCP connection (RST-closed after)
          3. Send set_bright on a fresh TCP connection (RST-closed after)
          4. Reset internal state flags
        
        After this, the next send_command_fast call will open a fresh
        persistent socket for update_leds â€” the Cube accepts pixel data
        on any connection once FX mode is device-level active.
        """
        cm = self._cube_matrix
        
        _LOGGER.debug(
            f"[ENSURE_FX] [{self._ip}] Activating FX mode via raw TCP "
            f"[{cm._state_summary()}]"
        )
        
        # Step 0: Quick TCP probe â€” fail immediately if device is unreachable.
        # Without this, we'd burn up to 3s on send_raw_command(activate_fx_mode)
        # + 1.5s on send_raw_command(set_bright) = 4.5s total for a dead device.
        # The probe uses a 0.5s connect + RST close, so we fail in <1s instead.
        import socket as _socket
        import struct as _struct
        probe_ok = False
        try:
            sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
            sock.settimeout(0.5)
            sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_LINGER, _struct.pack('ii', 1, 0))
            await asyncio.to_thread(sock.connect, (self._ip, cm._port))
            sock.close()
            probe_ok = True
        except Exception:
            try:
                sock.close()
            except Exception:
                pass
        
        if not probe_ok:
            _LOGGER.warning(
                f"[ENSURE_FX] [{self._ip}] âš¡ Fast probe FAILED â€” device unreachable, "
                f"skipping FX activation to avoid {1.5*2:.0f}s timeout"
            )
            raise TimeoutError(f"Device {self._ip} unreachable (fast probe failed)")
        
        # Step 1: Kill persistent socket
        cm._close_fast_socket()
        
        # Step 2: activate_fx_mode on fresh TCP
        await cm.send_raw_command("activate_fx_mode", [{"mode": "direct"}])
        
        await asyncio.sleep(0.05)  # Firmware settle (50ms is sufficient on LAN)
        
        # Step 3: set_bright on fresh TCP
        hardware_brightness, _ = self._calculate_brightness_values(self._brightness)
        await cm.send_raw_command("set_bright", [hardware_brightness])
        
        # Step 4: Update state
        self._fx_mode_is_direct = True
        self._last_fx_mode_time = time.time()
        self._last_hardware_brightness = hardware_brightness
        
        _LOGGER.debug(
            f"[ENSURE_FX] [{self._ip}] âœ“ FX ready â€” brightness={hardware_brightness}%"
        )

    async def _force_refresh_impl(self):
        """Force refresh implementation - runs inside _execute_hardware_op lock.
        
        Closes persistent socket, re-activates FX mode via raw TCP,
        and re-renders the display through the full pipeline.
        
        IMPORTANT: We must NOT read raw pixel data from self._layout and
        send it directly, because _apply_impl() applies software brightness
        darkening IN PLACE to module.data.  Sending those already-darkened
        pixels while also setting hardware brightness via set_bright would
        result in double-darkening (dimmer than intended).
        
        Instead, we re-render through _apply_display_mode_internal() which:
          1. Fills the layout with fresh un-darkened colours (text/drawing)
          2. Calls _apply_impl() which applies colour effects + brightness
             darkening correctly, then sends the final pixel data.
        Since ensure_fx_ready() already set _fx_mode_is_direct=True,
        _apply_impl() will skip redundant FX activation.
        """
        # Steps 1-3: Close persistent socket, activate FX via raw TCP, set brightness
        await self.ensure_fx_ready()
        _LOGGER.warning(f"[FORCE REFRESH] [{self._ip}] ensure_fx_ready complete")
        
        # Step 4: Re-render through the full display pipeline so brightness
        # darkening is applied once (not double-applied on stale pixel data).
        await self._apply_display_mode_internal(skip_post_delay=True)
        _LOGGER.warning(
            f"[FORCE REFRESH] [{self._ip}] Complete - "
            f"FX mode active, brightness={self._last_hardware_brightness}%, "
            f"display re-rendered"
        )

    async def async_force_refresh(self):
        """Force refresh via _execute_hardware_op (properly serialized with device lock)."""
        _LOGGER.warning(
            f"[FORCE REFRESH] [{self._ip}] Starting â€” "
            f"closing persistent socket and using raw TCP"
        )
        await self._execute_hardware_op(
            lambda: self._force_refresh_impl(),
            "force_refresh"
        )

    async def async_turn_on(self, **kwargs):
        """Turn on the light."""
        _LOGGER.debug(f"[TURN_ON] async_turn_on called with kwargs: {kwargs}")
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = True
        if "brightness" in kwargs:
            self._brightness = max(1, min(255, kwargs["brightness"]))
        if "rgb_color" in kwargs:
            self._rgb_color = tuple(kwargs["rgb_color"])
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_turn_on(**kwargs),
            "turn_on"
        )
    
    async def _internal_turn_on(self, **kwargs):
        """Internal turn_on implementation â€” runs under the global lock."""
        _LOGGER.debug(f"[TURN_ON] Executing - is_on: {self._is_on}, custom_text: '{self._custom_text}', mode: '{self._mode}'")
        
        # Ensure FX mode is active using raw TCP (proven reliable).
        # ensure_fx_ready() handles activate_fx_mode + set_bright atomically.
        if not self._fx_mode_is_direct:
            _LOGGER.debug(f"[TURN_ON] Activating FX mode via raw TCP")
            await self.ensure_fx_ready()
        
        self._is_on = True
        
        # Handle colors from kwargs
        if "text_colors" in kwargs:
            _LOGGER.debug(f"[TURN_ON] Setting text_colors from kwargs: {kwargs['text_colors']}")
            self._text_colors = [tuple(c) for c in kwargs["text_colors"]]
            self._sync_rgb_color()
        
        if "rgb_color" in kwargs:
            rgb_color = kwargs["rgb_color"]
            _LOGGER.debug(f"[TURN_ON] RGB color selected: {rgb_color}")
            self._text_colors = [tuple(rgb_color)]
            self._sync_rgb_color()
        
        _LOGGER.debug(f"[TURN_ON] Current state - text_colors: {self._text_colors}, background: {self._background_color}")
        
        try:
            if "brightness" in kwargs:
                new_brightness = kwargs["brightness"]
                _LOGGER.debug(f"[TURN_ON] Setting brightness to {new_brightness}")
                # Call internal directly â€” we're already under the global lock
                call_id = int(time.time() * 1000) % 100000
                await self._internal_set_brightness(new_brightness, call_id)
            else:
                # Ensure brightness is at least 1
                if self._brightness < 1:
                    self._brightness = 1
                
                # Apply display with current brightness
                # _apply_display_mode_internal handles FX staleness, set_bright if needed,
                # and sends pixel data all in one pass.
                await self._apply_display_mode_internal()
        except Exception as e:
            msg = str(e)
            if "quota exceeded" in msg.lower():
                _LOGGER.debug("Rate limit exceeded during turn_on")
            elif isinstance(e, TimeoutError):
                _LOGGER.warning("Timeout during turn_on - device may be unreachable")
            else:
                _LOGGER.error(f"Unexpected error during turn_on: {e}")
        
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug(f"[TURN_ON] Turn on complete")
        
        _LOGGER.debug(f"[TURN_ON] Turn on complete")

    async def async_turn_off(self, **kwargs):
        """Turn off the light."""
        _LOGGER.debug(f"[TURN_OFF] async_turn_off called")
        
        # Update HA state IMMEDIATELY for responsive UI
        self._is_on = False
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_turn_off(**kwargs),
            "turn_off"
        )
    
    async def _internal_turn_off(self, **kwargs):
        """Internal turn_off implementation that executes in the queue."""
        _LOGGER.debug(f"[TURN_OFF] Executing turn_off")
        await self.erase_all()
        await self.apply()
        self._is_on = False
        # NOTE: Do NOT reset _fx_mode_is_direct here!
        # The FX socket is still alive after sending blank pixel data.
        # On turn_on we just reuse the existing socket â€” no activate_fx_mode
        # needed.  If the socket dies while off (Cube idle timeout), the
        # natural error-detection in send_command_fast / apply() will detect
        # it and re-activate FX mode automatically.
        # Previously this was set to False, which forced EVERY turn_on to
        # close the socket, wait 300ms, and open a new one for
        # activate_fx_mode â€” a cycle that timed out ~50% of the time.
        self._last_hardware_brightness = None  # Reset hardware brightness tracking
        self._last_applied_darken = None        # Reset darken tracking
        self._last_apply_time = 0  # Reset cooldown timer to ensure turn_on will work immediately
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        _LOGGER.debug(f"[TURN_OFF] Turn off complete")

    async def set_brightness(self, brightness: int, **kwargs):
        """
        Unified brightness control using BOTH hardware brightness and RGB darkening.
        
        The system automatically chooses the best mechanism based on brightness level:
        
        LOW RANGE (e.g., 0-30%):
        - Uses hardware dimming (25-100%) + maximum RGB darkening (94%)
        - Allows VERY low brightness for night/ambient use
        
        HIGH RANGE (e.g., 30-100%):
        - Uses maximum hardware (100%) + variable RGB darkening (94-0%)
        - Preserves color accuracy at higher brightness levels
        
        HA Brightness Range:
        - 0: Light OFF (handled by turn_off, not brightness adjustment)
        - 1 (0.4%): Minimum brightness - hardware at MIN, darkness at MAX
        - 255 (100%): Maximum brightness - hardware at 100%, darkness at 0%
        
        User sees ONE smooth slider controlling both mechanisms automatically.
        
        PERFORMANCE OPTIMIZATIONS:
        - Fire-and-forget hardware brightness (no waiting for lamp response)
        - Queue dropping: obsolete brightness calls are automatically dropped
        - Parallel execution: hardware + display updates run simultaneously when both change
        """
        call_id = int(time.time() * 1000) % 100000
        _LOGGER.debug(
            f"[BRIGHTNESS_DIAG] [{self._ip}] SET_BRIGHTNESS called: "
            f"requested={brightness}, current={self._brightness}, is_on={self._is_on}"
        )
        
        # Update internal state and HA IMMEDIATELY so the UI reflects the
        # user's intent without waiting for the lamp command to complete.
        # The actual hardware command still goes through the queue.
        if self._is_on:
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))
            # CRITICAL: Calculate and apply _preview_darken BEFORE the state push.
            # extra_state_attributes uses _preview_darken to compute brightness-
            # adjusted matrix_colors.  Without this, the JS card would get the
            # updated brightness but STALE matrix_colors (old darken level),
            # making the preview lag behind the slider by the full lamp roundtrip.
            _, darken_percent = self._calculate_brightness_values(self._brightness)
            self._preview_darken = darken_percent
            _LOGGER.debug(
                f"[BRIGHTNESS_DIAG] [{self._ip}] SET_BRIGHTNESS state update: "
                f"{old_brightness} â†’ {self._brightness}, darken={darken_percent}%"
            )
            if self.hass is not None:
                _LOGGER.warning(
                    f"[TIMING] [{self._ip}] brightness state_push epoch={time.time():.3f}")
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
        
        await self._execute_hardware_op(
            lambda: self._internal_set_brightness(brightness, call_id, **kwargs),
            f"brightness:{brightness}"
        )
    
    async def _internal_set_brightness(self, brightness: int, call_id: int, **kwargs):
        """Internal brightness implementation â€” runs under the global lock."""
        _LOGGER.debug(
            f"[BRIGHTNESS_DIAG] [{self._ip}] INTERNAL_SET #{call_id} â€” "
            f"requested={brightness}, current={self._brightness}, "
            f"last_hw={self._last_hardware_brightness}, last_darken={self._last_applied_darken}"
        )
        
        if self._is_on:
            # Store the raw HA brightness value (1-255 for ON lights, 0 means OFF)
            old_brightness = self._brightness
            self._brightness = max(1, min(255, brightness))  # Clamp to 1-255 for ON state
            _LOGGER.debug(f"[BRIGHTNESS #{call_id}] Brightness changed: {old_brightness} â†’ {self._brightness}")
            
            # Calculate BOTH hardware brightness and darkness percentage
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            
            _LOGGER.debug(
                f"[BRIGHTNESS #{call_id}] User brightness {self._brightness} (1-255) â†’ "
                f"hardware={hardware_brightness}%, darkness={darken_percent}%"
            )
            
            try:
                # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                # BRIGHTNESS UPDATE OPTIMIZATION:
                # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                # 1. Hardware brightness command is FIRE-AND-FORGET (lamp doesn't respond)
                # 2. Display update requires re-rendering all 100 LEDs with new darkness
                # 3. When BOTH change: Execute in parallel for maximum speed
                # 4. When only ONE changes: Execute only that operation
                # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                
                # Track what changed to avoid redundant updates
                # CRITICAL: Compare darken against _last_applied_darken (what was actually
                # rendered to the lamp), NOT _preview_darken.  set_brightness() updates
                # _preview_darken early for the JS card preview, so by the time this
                # queued function runs, _preview_darken already equals darken_percent
                # and the comparison would ALWAYS be False â€” skipping the display
                # update that bakes RGB darkening into the actual lamp pixels.
                darken_changed = (self._last_applied_darken != darken_percent)
                hardware_changed = (self._last_hardware_brightness != hardware_brightness)
                
                # Update the darken value (affects next display render)
                old_darken = self._last_applied_darken
                old_hardware = self._last_hardware_brightness
                self._preview_darken = darken_percent
                
                # CRITICAL: Update _last_hardware_brightness BEFORE any branch
                # that calls _apply_brightness_only() or _apply_color_correction().
                # _apply_color_correction() reads this to determine correction
                # strength — if updated AFTER _apply_brightness_only(), the
                # correction uses the OLD hardware brightness → wrong colors.
                # (In non-hardware_changed branches, this is a no-op since the
                # value hasn't changed.)
                self._last_hardware_brightness = hardware_brightness
                
                # OPTIMIZATION: Execute hardware and display updates optimally
                if hardware_changed and darken_changed:
                    _LOGGER.debug(
                        f"[BRIGHTNESS #{call_id}] BOTH changed - "
                        f"hardware: {old_hardware}% â†’ {hardware_brightness}%, "
                        f"darkness: {old_darken}% â†’ {darken_percent}% - sequential hw then display"
                    )
                    # IMPORTANT: Send hardware brightness FIRST, then update display.
                    # If we fire-and-forget the hardware command while sending the display
                    # update, the lamp may receive the new darkened RGB values while still
                    # at the OLD hardware brightness, causing a brief brightness dip.
                    # By awaiting the hardware command first, we ensure the lamp's hardware
                    # brightness is updated BEFORE it receives the new RGB pixel data.
                    
                    # Pre-flight check: skip if connection is down
                    if not self._cube_matrix.is_connected():
                        _LOGGER.debug(f"[BRIGHTNESS] Skipping hardware command - connection down")
                        self._pending_brightness = (self._brightness, time.time())
                        _LOGGER.debug(f"[BRIGHTNESS] Queued brightness {self._brightness} for retry")
                        self._start_brightness_retry_task()
                    else:
                        try:
                            # Fire-and-forget: send-only, no recv() wait.
                            # The Cube always closes TCP after each command â€”
                            # waiting for the response just wastes time on a
                            # "Bulb closed the connection" exception.
                            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                            # NOTE: We do NOT reset _fx_mode_is_direct here.
                            # Testing shows set_bright does not knock the Cube out of
                            # direct mode, and resetting this flag would force apply()
                            # to re-send activate_fx_mode + set_bright AGAIN â€” adding
                            # ~300ms of unnecessary TCP commands on every brightness
                            # change.  The FX_MODE_STALENESS_TIMEOUT check in
                            # _apply_impl() is the safety net if the Cube does
                            # silently exit direct mode after an idle period.
                        except Exception as e:
                            error_msg = str(e).lower()
                            is_known_error = (
                                "quota" in error_msg or 
                                "timeout" in error_msg or 
                                "socket" in error_msg or 
                                "nonetype" in error_msg or
                                isinstance(e, AttributeError)
                            )
                            if not is_known_error:
                                _LOGGER.warning(f"[BRIGHTNESS] Unexpected error sending hardware brightness: {e}")
                    
                    # PERFORMANCE: Use _apply_brightness_only() which re-darkens
                    # the existing _base_matrix_colors and sends draw_matrices_fast
                    # (fire-and-forget).  This avoids the full re-render of text/
                    # pixels in _apply_display_mode_internal() and the recv() wait.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change for anti-overwrite protection
                    # CRITICAL: Track AFTER both hardware and display complete
                    # This prevents retry queue from applying stale brightness (hardware + darkness)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    _LOGGER.debug(
                        f"[BRIGHTNESS #{call_id}] Tracked successful brightness: "
                        f"{self._brightness} (hardware={hardware_brightness}%, darkness={darken_percent}%)"
                    )
                    
                    # _last_hardware_brightness already set above (before branches)
                    self._last_applied_darken = darken_percent
                    
                elif hardware_changed:
                    # Only hardware changed - send command and await it
                    _LOGGER.debug(
                        f"[BRIGHTNESS #{call_id}] Hardware brightness changed: "
                        f"{old_hardware}% â†’ {hardware_brightness}%, sending..."
                    )
                    # Pre-flight check: skip if connection is down
                    if not self._cube_matrix.is_connected():
                        _LOGGER.debug(f"[BRIGHTNESS] Skipping hardware command - connection down")
                        self._pending_brightness = (self._brightness, time.time())
                        _LOGGER.debug(f"[BRIGHTNESS] Queued brightness {self._brightness} for retry")
                        self._start_brightness_retry_task()
                    else:
                        try:
                            # Fire-and-forget: send-only, no recv() wait.
                            await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                            # NOTE: Do NOT reset _fx_mode_is_direct here â€” see
                            # comment in 'both changed' branch above.
                        except Exception as e:
                            error_msg = str(e).lower()
                            is_known_error = (
                                "quota" in error_msg or 
                                "timeout" in error_msg or 
                                "socket" in error_msg or 
                                "nonetype" in error_msg or
                                isinstance(e, AttributeError)
                            )
                            if not is_known_error:
                                _LOGGER.warning(f"[BRIGHTNESS] Unexpected error sending hardware brightness: {e}")
                    
                    # _last_hardware_brightness already set above (before branches)
                    
                    # IMPORTANT: Re-render pixels with updated color correction.
                    # _apply_color_correction() uses _last_hardware_brightness which
                    # just changed — existing pixels have stale correction baked in.
                    # Without this, low-brightness color correction would be wrong
                    # until the next full re-render.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change (hardware only, darkness unchanged)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    
                elif darken_changed:
                    # Only darkness changed - use FAST PATH (no full re-render)
                    _LOGGER.debug(
                        f"[BRIGHTNESS #{call_id}] Darkness changed: {old_darken}% â†’ {darken_percent}%, "
                        f"using fast brightness path..."
                    )
                    # PERFORMANCE: _apply_brightness_only() re-darkens existing
                    # _base_matrix_colors and sends fire-and-forget draw_matrices.
                    # Skips the full text/pixel re-render + recv() wait.
                    await self._apply_brightness_only()
                    
                    # Track successful brightness change (darkness only, hardware unchanged)
                    self._last_successful_brightness = (time.time(), self._brightness)
                    self._last_applied_darken = darken_percent
                    
                else:
                    # Nothing changed numerically.  But if color effects are active,
                    # we STILL need to re-render: _apply_display_mode_internal
                    # re-places pixels from scratch and then apply() bakes in the
                    # effects.  Without this display update the lamp would show the
                    # raw (un-effected) pixels from the last _internal_turn_on.
                    has_active_effects = (
                        self._preview_hue_shift != 0 or self._preview_saturation != 100 or
                        self._preview_temperature != 0 or self._preview_contrast != 100 or
                        self._preview_vibrance != 100 or self._preview_glow != 0 or
                        self._preview_grayscale != 0 or self._preview_invert != 0 or
                        self._preview_tint_strength != 0
                    )
                    if has_active_effects:
                        _LOGGER.debug(
                            f"[BRIGHTNESS #{call_id}] Values unchanged but effects active "
                            f"â€” forcing display update to preserve effects"
                        )
                        # PERFORMANCE: Direct call â€” see comment in 'both changed' branch.
                        await self._apply_display_mode_internal(skip_post_delay=True)
                    else:
                        _LOGGER.debug(f"[BRIGHTNESS #{call_id}] No changes needed, brightness already at target")
                    
            except Exception as e:
                # Most errors are already handled gracefully in cube_matrix.send_command_with_recovery
                # Only truly unexpected errors reach here
                msg = str(e)
                if "quota exceeded" in msg.lower():
                    _LOGGER.warning(f"[BRIGHTNESS #{call_id}] Rate limit exceeded - backing off")
                elif isinstance(e, TimeoutError):
                    _LOGGER.warning(f"[BRIGHTNESS #{call_id}] Timeout - device may be unreachable")
                else:
                    _LOGGER.error(f"[BRIGHTNESS #{call_id}] Unexpected error: {e}")
        else:
            _LOGGER.debug(f"[BRIGHTNESS #{call_id}] Light is off, not applying brightness")

    def _start_brightness_retry_task(self):
        """Start background task to retry failed brightness when connection recovers"""
        if self._brightness_retry_task is None or self._brightness_retry_task.done():
            self._brightness_retry_task = asyncio.create_task(self._process_brightness_retries())
    
    async def _process_brightness_retries(self):
        """
        Background task to retry failed brightness when connection recovers.
        
        ANTI-OVERWRITE PROTECTION:
        - Only retries if no newer brightness has been successfully applied
        - Drops stale queued brightness if user changed brightness since failure
        - Example: Brightness 20% queued â†’ User sets 60% successfully â†’ Drop queued 20%
        """
        _LOGGER.debug("[BRIGHTNESS RETRY] Retry processor started")
        
        while self._pending_brightness is not None:
            # Wait for connection to be available
            if not self._cube_matrix.is_connected():
                await asyncio.sleep(0.5)  # Check every 500ms
                continue
            
            # Get pending brightness
            pending_value, queued_timestamp = self._pending_brightness
            
            # Check if brightness expired (30s TTL)
            if time.time() - queued_timestamp > 30.0:
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Dropping expired brightness: {pending_value}")
                self._pending_brightness = None
                continue
            
            # ANTI-OVERWRITE CHECK: Has a newer brightness already succeeded?
            if self._last_successful_brightness is not None:
                last_success_time, last_success_value = self._last_successful_brightness
                
                # If a newer brightness succeeded AFTER this one was queued, drop it
                if last_success_time > queued_timestamp:
                    _LOGGER.debug(
                        f"[BRIGHTNESS RETRY] Dropping stale brightness {pending_value} - "
                        f"newer brightness {last_success_value} already applied "
                        f"(queued at {queued_timestamp:.2f}, superseded at {last_success_time:.2f})"
                    )
                    self._pending_brightness = None
                    continue
            
            # Try to re-apply the complete brightness through the queue
            try:
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Retrying brightness {pending_value} via queue")
                # Queue through the proper channel so it's serialized with other operations
                await self.set_brightness(pending_value)
                # Success - clear pending
                self._pending_brightness = None
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Successfully queued brightness retry {pending_value}")
            except Exception as e:
                # Failed again - will retry later
                _LOGGER.debug(f"[BRIGHTNESS RETRY] Retry failed for brightness {pending_value}: {e}")
                # If connection is down again, wait longer
                if not self._cube_matrix.is_connected():
                    await asyncio.sleep(1)
                else:
                    # Other error - clear pending to avoid infinite retry
                    _LOGGER.warning(f"[BRIGHTNESS RETRY] Clearing pending brightness due to error: {e}")
                    self._pending_brightness = None
            
            # Small delay between retry attempts
            await asyncio.sleep(0.1)
        
        _LOGGER.debug("[BRIGHTNESS RETRY] Retry processor finished (no pending brightness)")

    async def async_update(self, *args, **kwargs):
        # No-op: do not call async_schedule_update_ha_state here to avoid NoEntitySpecifiedError
        pass

    async def erase_all(self):
        background_color_hex = rgb_to_hex(self._background_color)
        for module in self._layout.device_layout:
            module.set_colors([background_color_hex])

    async def set_custom_text(self, text_chars: str):
        if not isinstance(text_chars, str):
            _LOGGER.error("set_custom_text received non-string character: %s", text_chars)
            return
        # Prevent empty text â€” the Yeelight firmware misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text_chars == "":
            text_chars = " "
        self._custom_text = text_chars
        
        # Notify text input entity of the change (only if it's been added to hass)
        if self._text_input_entity and hasattr(self._text_input_entity, 'hass') and self._text_input_entity.hass is not None:
            self._text_input_entity.async_update_from_light()
        
        # Push HA state eagerly so automations see the new custom_text
        # immediately (see handle_set_custom_text for detailed rationale).
        if self.hass is not None:
            self.async_schedule_update_ha_state()
        
        if self._is_on:
            await self.async_apply_display_mode(update_type='text_change')

    async def async_apply_display_mode(self, update_type: str = 'display_update'):
        """Queue a display mode update to be processed sequentially"""
        # NOTE: _apply_cooldown removed. It was silently DROPPING updates
        # when they arrived within 100ms of each other (e.g., rapid pixel
        # drawing or fast slider changes). The queue's coalescing logic
        # already handles deduplication properly â€” if two identical updates
        # are queued, the queue processor coalesces them. Dropping here
        # caused lost pixel art frames and missed state changes.
        is_retry = update_type == 'display_retry'
        
        # Only reset the retry counter when it has actually HIT the limit
        # AND the caller is a genuine user action (not a periodic display_update).
        #
        # User actions: turn_on, brightness_change, text_change, color_change,
        #               pixel_art (used by service calls)
        # Periodic:     display_update (from HA state polling, clock, sensors)
        #
        # Previously ANY non-retry call reset the counter.  This meant periodic
        # display_update calls arriving every ~30s would restart the 20-retry
        # cycle for a device that's genuinely offline â€” retrying forever.
        # Now only explicit user actions restart retries.
        user_action_types = {
            'turn_on', 'turn_off', 'brightness_change', 'text_change',
            'color_change', 'pixel_art',
        }
        is_user_action = update_type in user_action_types
        if not is_retry and self._display_retry_count >= self.MAX_DISPLAY_RETRIES:
            if is_user_action:
                _LOGGER.debug(
                    f"[DISPLAY] [{self._ip}] User action '{update_type}' reset retry counter "
                    f"({self._display_retry_count} â†’ 0) â€” retries will resume"
                )
                self._display_retry_count = 0
                # Cancel any pending retry task â€” without this, the old
                # retry fires immediately and pushes the counter back to 6
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
                    _LOGGER.debug(f"[DISPLAY] [{self._ip}] Cancelled stale retry task")
            else:
                _LOGGER.debug(
                    f"[DISPLAY] [{self._ip}] Periodic '{update_type}' skipped â€” device offline, "
                    f"retry limit reached ({self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}). "
                    f"A user action will restart retries."
                )
                return  # Don't queue â€” device is offline and no user is actively requesting
        
        log_level = _LOGGER.info if is_retry else _LOGGER.debug
        log_level(f"[DISPLAY] async_apply_display_mode called - mode: '{self._mode}', text: '{self._custom_text}', type: '{update_type}', is_on: {self._is_on}")
        
        # Track which type of update is running so the transition block in
        # _apply_impl() can skip animations on retries / recovery / periodic
        # refreshes.  Only genuine user-initiated content changes animate.
        self._current_update_type = update_type

        # Compute dynamic timeout: when a transition is enabled, the operation
        # needs transition_duration + overhead for FX activation + final send.
        # Without transition, use the default APPLY_HARD_TIMEOUT.
        op_timeout = None
        if (self._transition_type != "none"
                and self._last_sent_colors is not None
                and not self._transition_active):
            op_timeout = self._transition_duration + APPLY_HARD_TIMEOUT
        
        # Execute the display update under the global lock with error handling
        await self._execute_hardware_op(
            lambda: self._apply_display_mode_internal(),
            f"display:{update_type}",
            timeout_override=op_timeout
        )


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
        # Flip both row and column (180Â° rotation)
        row, col = divmod(pos, total_columns)
        flipped_row = total_rows - 1 - row
        flipped_col = total_columns - 1 - col
        return flipped_row * total_columns + flipped_col

    def _flip_positions(self, positions, total_columns=TOTAL_COLUMNS, total_rows=TOTAL_ROWS):
        return [self._flip_position(pos, total_columns, total_rows) for pos in positions]

    async def _apply_brightness_only(self):
        """
        FAST PATH for brightness-only changes.
        
        Instead of the full _apply_display_mode_internal() which:
        1. Clears all modules to background color
        2. Re-places all text/pixels from scratch  (CPU work)
        3. Calls apply() which may re-send FX mode + set_bright  (2 TCP commands)
        4. Loops over 100 modules for effects + darkening  (CPU work)
        5. Sends draw_matrices  (1 TCP command)
        
        This method:
        1. Takes the existing _base_matrix_colors snapshot (already computed)
        2. Re-applies color effects + new brightness darkening to each pixel
        3. Encodes and sends draw_matrices_fast  (1 TCP command, fire-and-forget)
        
        Savings: ~200-400ms of TCP round-trips + full re-render avoided.
        Only valid when the underlying pixel art/text hasn't changed â€” just the
        brightness level (darken_percent).
        """
        await self._apply_brightness_only_impl()

    async def _apply_brightness_only_impl(self):
        try:
            if not self._cube_matrix.is_connected():
                _LOGGER.warning(f"[BRIGHTNESS_FAST] [{self._ip}] SKIP â€” cooldown active")
                raise Exception("Cooldown active â€” device not yet reachable")
            
            # If we don't have base colors yet, fall back to the full path
            base_colors = getattr(self, '_base_matrix_colors', None)
            if not base_colors or len(base_colors) != len(self._layout.device_layout):
                _LOGGER.debug(f"[BRIGHTNESS_FAST] No base colors â€” falling back to full apply")
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # STALENESS CHECK: Same as in _apply_impl â€” check fx_age, not idle.
            # Falls through to full apply path which uses ensure_fx_ready() (raw TCP).
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    _LOGGER.warning(
                        f"[BRIGHTNESS_FAST] [{self._ip}] FX mode stale â€” fx_age={fx_age:.0f}s > "
                        f"{FX_MODE_STALENESS_TIMEOUT:.0f}s, falling back to full apply (raw TCP recovery)"
                    )
                    self._fx_mode_is_direct = False

            # If FX mode isn't set, fall back to the full path which handles activation
            if not self._fx_mode_is_direct:
                _LOGGER.debug(f"[BRIGHTNESS_FAST] FX mode not set â€” falling back to full apply")
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Check if reconnection happened
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.debug(f"[BRIGHTNESS_FAST] Reconnection detected â€” falling back to full apply")
                self._fx_mode_is_direct = False
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Re-apply brightness + accuracy to the base colors.
            #
            # IMPORTANT: _base_matrix_colors already has color effects baked in
            # (hue_shift, saturation, contrast, temperature, vibrance, glow,
            #  grayscale, invert, tint).  They were applied during the full
            # render in _apply_impl and snapshotted AFTER apply_color_adjustments.
            # Do NOT call apply_color_adjustments() again here -- that would
            # double-apply every color effect (e.g., hue shift applied twice).
            #
            # What we DO re-apply each time brightness changes:
            #   1. _apply_final_brightness  -- RGB darkening for brightness
            #   2. _apply_color_correction  -- low-brightness gamma correction
            #   3. _apply_color_accuracy    -- per-channel gain (fades with brightness)
            
            # Write darkened colors directly into modules
            _LOGGER.debug(
                f"[BRIGHTNESS_DIAG] [{self._ip}] BRIGHTNESS_FAST â€” "
                f"user={self._brightness}/255, darken={self._preview_darken}%, "
                f"brighten={self._preview_brighten}%, "
                f"last_hw={self._last_hardware_brightness}, last_darken={self._last_applied_darken}, "
                f"base_colors_count={len(base_colors)}"
            )
            for i, module in enumerate(self._layout.device_layout):
                if i < len(base_colors):
                    rgb = base_colors[i]
                    # base_colors already includes color effects -- only apply
                    # brightness pipeline (darkening, gamma, accuracy)
                    rgb = self._apply_final_brightness(rgb)
                    rgb = self._apply_color_correction(rgb)
                    rgb = self._apply_color_accuracy(rgb)
                    module.data = [rgb_to_hex(rgb)]
            
            # Send pixel data using fire-and-forget (no recv wait)
            raw_rgb_data = self._layout.get_raw_rgb_data()
            await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
            
            # POST-SEND RECONNECTION CHECK: Same as in _apply_impl â€” if the
            # socket reconnected during send, pixels were silently ignored.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.warning(
                    f"[BRIGHTNESS_FAST] [{self._ip}] Socket reconnected during update_leds â€” "
                    f"falling back to full apply for FX re-activation"
                )
                await self._apply_display_mode_internal(skip_post_delay=True)
                return
            
            # Track successful rendering
            self._last_applied_darken = self._preview_darken
            self._connection_error = False
            
            # Update _last_sent_colors for future transitions
            try:
                self._last_sent_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        self._last_sent_colors.append(hex_to_rgb(module.data[0]))
                    else:
                        self._last_sent_colors.append((0, 0, 0))
            except Exception:
                self._last_sent_colors = None
            
            if self.hass is not None:
                self._notify_camera_preview()
                self.async_schedule_update_ha_state()
                
            _LOGGER.debug(f"[BRIGHTNESS_FAST] âœ“ Done (darken={self._preview_darken}%)")
            
        except Exception as e:
            msg = str(e)
            if any(kw in msg.lower() for kw in ['socket', 'closed', 'connection', 'cooldown', 'timeout']):
                self._fx_mode_is_direct = False
                self._connection_error = True
                self._last_connection_error = msg
                _LOGGER.debug(f"[BRIGHTNESS_FAST] Connection issue: {e} â€” re-raising for retry")
            else:
                _LOGGER.warning(f"[BRIGHTNESS_FAST] Error: {e}")
            raise

    async def _send_transition_frame(self, frame):
        """Write a single 100-pixel frame to modules and push to the lamp.
        
        Returns True on success, False if the send failed (connection error,
        quota exceeded, etc.).  Callers should break out of the transition
        loop on False â€” the post-transition ensure_fx_ready will recover.
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
                f"[TRANSITION] [{self._ip}] Frame send failed â€” aborting transition early: {e}"
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
          - fade_through_black: current â†’ black â†’ target
          - direct_crossfade:   linear blend from current â†’ target
          - random_dissolve:    pixels switch oldâ†’new in random order
          - wipe_right/left/down/up: boundary sweeps in that direction
          - slide_left/right/up/down: old slides out, new enters from opposite side
          - card_from_right/left/top/bottom: new slides over old like a card
          - explode_reform:     pixels scatter outward then converge to new
          - snake:              boustrophedon reveal across rows
          - wave_wipe:          sine-wave boundary sweeps leftâ†’right
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
            
            # â”€â”€ Clean TCP: close persistent socket, re-activate FX via fresh TCP â”€â”€
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

            # â”€â”€ Fade Through Black â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            if ttype == "fade_through_black":
                half = max(1, steps // 2)
                remaining = steps - half
                for step in range(steps):
                    if step < half:
                        # Phase 1: current â†’ black.  Last frame in phase = black.
                        factor = 1.0 - ((step + 1) / half)
                        frame = [
                            (int(r * factor), int(g * factor), int(b * factor))
                            for r, g, b in from_colors
                        ]
                    else:
                        # Phase 2: black â†’ target.  Last frame = full target.
                        progress = step - half + 1
                        factor = progress / remaining
                        frame = [
                            (int(r * factor), int(g * factor), int(b * factor))
                            for r, g, b in to_colors
                        ]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # â”€â”€ Direct Crossfade â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

            # â”€â”€ Random Dissolve â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

            # â”€â”€ Wipe (4 directions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            elif ttype in ("wipe_right", "wipe_left", "wipe_down", "wipe_up"):
                cols = TOTAL_COLUMNS  # 20
                rows = TOTAL_ROWS     # 5
                for step in range(steps):
                    frame = []
                    if ttype == "wipe_right":
                        # Boundary sweeps left â†’ right
                        boundary = int((step + 1) * cols / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i % cols) < boundary else from_colors[i])
                    elif ttype == "wipe_left":
                        # Boundary sweeps right â†’ left
                        boundary = cols - int((step + 1) * cols / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i % cols) >= boundary else from_colors[i])
                    elif ttype == "wipe_down":
                        # Boundary sweeps top â†’ bottom (row 4 â†’ row 0)
                        boundary = rows - int((step + 1) * rows / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i // cols) >= boundary else from_colors[i])
                    else:  # wipe_up
                        # Boundary sweeps bottom â†’ top (row 0 â†’ row 4)
                        boundary = int((step + 1) * rows / steps)
                        for i in range(num_pixels):
                            frame.append(to_colors[i] if (i // cols) < boundary else from_colors[i])
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # â”€â”€ Slide (4 directions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

            # â”€â”€ Card (4 directions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

            # â”€â”€ Explode & Reform â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                        t = (step + 1) / half  # 0â†’1
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
                        t = progress / (steps - half)  # 0â†’1
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

            # â”€â”€ Snake â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            elif ttype == "snake":
                # Reveal new pixels in a snake (boustrophedon) pattern across
                # rows, alternating direction each row.
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                # Build snake order: row 0 Lâ†’R, row 1 Râ†’L, row 2 Lâ†’R, ...
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

            # â”€â”€ Wave Wipe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            elif ttype == "wave_wipe":
                # Like a wipe but the boundary is a sine wave moving leftâ†’right.
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

            # â”€â”€ Iris (Circle Wipe) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            elif ttype == "iris":
                # A circular reveal expanding from the center of the display.
                import math as _math
                cols = TOTAL_COLUMNS
                rows = TOTAL_ROWS
                cx, cy = cols / 2.0, rows / 2.0
                # Aspect ratio correction: pixels are wider than tall on 20Ã—5
                aspect = cols / rows  # â‰ˆ 4.0
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

            # â”€â”€ Vertical Flip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                        t = (step + 1) / half  # 0â†’1
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

            # â”€â”€ Curtain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

            # â”€â”€ Gravity Drop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                        t = (step + 1) / half  # 0â†’1
                        drop = int(round(t * rows))
                        for r in range(rows):
                            dst_r = r - drop  # shift down (row 0 = bottom)
                            for c in range(cols):
                                if 0 <= dst_r < rows:
                                    frame[dst_r * cols + c] = from_colors[r * cols + c]
                    else:
                        # Phase 2: new pixels drop in from top
                        t = (step - half + 1) / (steps - half)  # 0â†’1
                        drop = int(round((1.0 - t) * rows))
                        for r in range(rows):
                            src_r = r + drop
                            for c in range(cols):
                                if 0 <= src_r < rows:
                                    frame[r * cols + c] = to_colors[src_r * cols + c]
                    if not await self._send_transition_frame(frame):
                        break
                    await asyncio.sleep(step_delay)

            # â”€â”€ Pixel Migration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                # With â‰¤100 lit pixels per side this is at most 10 000 pairs â€”
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

                # Greedy global matching â€” process closest pairs first
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
                        # Interpolate position (smooth float â†’ snap to grid)
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

    async def _apply_display_mode_internal(self, skip_post_delay: bool = False):
        """Internal method that actually applies the display mode - called by queue processor"""
        try:
            background_color_hex = rgb_to_hex(self._background_color)
            _LOGGER.debug(f"Setting background color: {background_color_hex}")
            for module in self._layout.device_layout:
                module.set_colors([background_color_hex])
            # Priority: custom drawing if present and custom_draw_active, else text
            if getattr(self, '_custom_draw_active', False) and self._custom_pixels:
                # Group pixels by color for batched placement
                color_groups = {}
                for px in self._custom_pixels:
                    pos = px.get("position")
                    color = px.get("color")
                    if pos is not None and color is not None:
                        color_hex = rgb_to_hex(tuple(color))
                        color_groups.setdefault(color_hex, []).append(pos)
                for color_hex, positions in color_groups.items():
                    self.place_pixels(color_hex, self._flip_positions(positions))
                await self.apply(skip_post_delay=skip_post_delay)
                return
            # If not in custom draw mode, clear custom pixels so text/other modes work as expected
            if not getattr(self, '_custom_draw_active', False):
                self._custom_pixels = None
            if self._custom_text or self._panel_mode:
                # â”€â”€â”€ Panel mode override â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                # When panel_mode is on, replace the actual text with a single
                # virtual character (PANEL_FULL_CHAR) that covers every pixel
                # on the 5Ã—20 display.  All rendering modes then see one
                # "giant letter" filling the whole panel and work through the
                # normal text rendering path â€” no special branches needed.
                if self._panel_mode:
                    effective_text = PANEL_FULL_CHAR  # single char whose positions = all 100 pixels
                    total_columns = TOTAL_COLUMNS
                    total_text_width = TOTAL_COLUMNS  # fills the full width
                    current_offset = 0  # no alignment shift â€” it already covers everything
                    _LOGGER.debug(
                        f"[DISPLAY] [{self._ip}] Panel mode: rendering virtual full-panel character "
                        f"(mode='{self._mode}', colors={len(self._text_colors) if self._text_colors else 0} stops)"
                    )
                else:
                    effective_text = self._custom_text
                    total_columns = TOTAL_COLUMNS
                    total_text_width = sum(self.letter_size(self.get_positions_for_letter(letter)) + 1 for letter in self._custom_text) - 1
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
                        current_offset += self.letter_size(letter_positions) + 1
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
                        current_offset += letter_width + 1
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
                        current_offset += letter_width + 1
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
                        current_offset += self.letter_size(letter_positions) + 1
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
                        current_offset += self.letter_size(letter_positions) + 1
                elif self._mode == "Letter Angle Gradient":
                    colors = get_color()
                    angle_radians = math.radians(self._angle)
                    dx = math.cos(angle_radians)
                    dy = math.sin(angle_radians)
                    
                    for letter in effective_text:
                        letter_positions = self.get_positions_for_letter(letter)
                        if not letter_positions:
                            current_offset += 1
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
                        current_offset += self.letter_size(letter_positions) + 1
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
                        current_offset += letter_width + 1
                
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
                # no text set â€” without this, the lamp stays on the old display).
                _LOGGER.debug(
                    f"[DISPLAY] [{self._ip}] No content to render "
                    f"(text='{self._custom_text}', panel={self._panel_mode}, "
                    f"draw_active={getattr(self, '_custom_draw_active', False)}, "
                    f"mode='{self._mode}') â€” pushing background-only display"
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
        pixels within the visible 5Ã—20 matrix are included.
        
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
                space_to_add += 1 + self.letter_size(self.get_positions_for_letter(self._custom_text[i]))
        letter_positions = self.get_positions_for_letter(letter)
        valid_positions = self._filter_visible_positions(letter_positions, space_to_add)
        
        if valid_positions:
            if flip:
                valid_positions = self._flip_positions(valid_positions)
            self.place_pixels(color, valid_positions)

    def place_letters(self, color: str, letters: str, current_offset: int, flip=False):
        _LOGGER.debug(f"[PLACE_LETTERS] Starting with color: {color}, letters: '{letters}', offset: {current_offset}, flip: {flip}")
        
        # Calculate total text width for debugging
        total_width = sum(self.letter_size(self.get_positions_for_letter(letter)) + 1 for letter in letters) - 1
        _LOGGER.debug(f"[PLACE_LETTERS] Total text width: {total_width} columns, display width: {TOTAL_COLUMNS}")
        
        space_to_add = current_offset
        total_pixels_placed = 0
        for i in range(len(letters)):
            if i > 0:
                prev_letter_size = self.letter_size(self.get_positions_for_letter(letters[i - 1]))
                space_to_add += 1 + prev_letter_size
                _LOGGER.debug(f"[PLACE_LETTERS] Letter {i}: added {1 + prev_letter_size} to offset (prev letter '{letters[i - 1]}' size={prev_letter_size})")
            
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

    def get_positions_for_letter(self, letter: str):
        # Panel mode virtual character: covers the entire 5Ã—20 display
        if letter == PANEL_FULL_CHAR:
            return list(range(TOTAL_COLUMNS * TOTAL_ROWS))
        font_map = FONT_MAPS.get(self._font, FONT_MAPS.get("basic", {}))
        positions = font_map.get(letter, [])
        _LOGGER.debug(f"[GET_POSITIONS] Letter '{letter}' in font '{self._font}': {len(positions)} positions = {positions}")
        if not positions:
            _LOGGER.warning(f"[GET_POSITIONS] No positions found for letter '{letter}' in font '{self._font}'")
        return positions

    async def apply(self, skip_post_delay: bool = False):
        await self._apply_impl(skip_post_delay)

    async def _apply_impl(self, skip_post_delay: bool = False):
        try:
            # Fast-fail: if we're in cooldown after a failed connection attempt,
            # RAISE so the queue processor sees this as a failure and schedules
            # a retry. Previously this returned silently, which the queue processor
            # treated as success â€” cancelling the retry chain and leaving the lamp
            # dark forever.
            if not self._cube_matrix.is_connected():
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] SKIP â€” cooldown active, raising to trigger retry "
                    f"(fx_direct={self._fx_mode_is_direct}, is_on={self._is_on}, "
                    f"retry_count={self._display_retry_count}/{self.MAX_DISPLAY_RETRIES}) "
                    f"[{self._cube_matrix._state_summary()}]"
                )
                raise Exception("Cooldown active â€” device not yet reachable")
            
            # Check if the lamp just reconnected (socket was reset).
            # If so, we need to re-send FX mode and brightness before pixel data.
            if self._cube_matrix.consume_reconnected_flag():
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] Reconnection detected â€” will restore FX mode + brightness "
                    f"(fx_direct was {self._fx_mode_is_direct}, forcing to False)"
                )
                self._fx_mode_is_direct = False  # Force re-send
            
            # STALENESS CHECK: The Cube silently exits direct FX mode ~25s
            # after ACTIVATION (not after last command!).  Check fx_age.
            if self._fx_mode_is_direct and self._last_fx_mode_time > 0:
                fx_age = time.time() - self._last_fx_mode_time
                if fx_age > FX_MODE_STALENESS_TIMEOUT:
                    idle_seconds = time.time() - self._cube_matrix._last_command_time if self._cube_matrix._last_command_time > 0 else 999
                    _LOGGER.warning(
                        f"[APPLY] [{self._ip}] FX mode stale â€” fx_age={fx_age:.0f}s > "
                        f"{FX_MODE_STALENESS_TIMEOUT:.0f}s threshold (idle={idle_seconds:.1f}s), "
                        f"forcing re-activation via raw TCP"
                    )
                    self._fx_mode_is_direct = False

            # Ensure lamp is in direct FX mode before sending pixel data.
            # Uses raw TCP (fresh connection per command) â€” the proven-reliable
            # approach.  The Cube always processes activate_fx_mode correctly
            # on a fresh TCP connection but sometimes silently ignores it on
            # a reused persistent socket.
            hardware_brightness, darken_percent = self._calculate_brightness_values(self._brightness)
            if not self._fx_mode_is_direct:
                await self.ensure_fx_ready()
                hardware_brightness = self._last_hardware_brightness  # ensure_fx_ready sets this
            else:
                # FX mode already active â€” only send set_bright when value changed.
                if hardware_brightness != self._last_hardware_brightness:
                    _LOGGER.debug(
                        f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY â€” sending set_bright: "
                        f"user={self._brightness}/255, hardware={hardware_brightness}%, "
                        f"darken={darken_percent}%, prev_hw={self._last_hardware_brightness}, "
                        f"fx_direct={self._fx_mode_is_direct}, mode='{self._mode}'"
                    )
                    try:
                        await self._cube_matrix.send_command_fast("set_bright", [hardware_brightness])
                        self._last_hardware_brightness = hardware_brightness
                        _LOGGER.debug(
                            f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY â€” set_bright SUCCESS: "
                            f"hardware={hardware_brightness}%"
                        )
                    except Exception as e:
                        _LOGGER.debug(
                            f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY â€” set_bright FAILED: {e}"
                        )
                else:
                    _LOGGER.debug(
                        f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY â€” set_bright SKIPPED "
                        f"(unchanged at {hardware_brightness}%)"
                    )

            # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            # SINGLE-PASS: Apply color effects + brightness in one loop
            # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            # Previously this was two separate loops (color then brightness), each
            # doing hexâ†’RGBâ†’processâ†’RGBâ†’hex. Now merged into one pass to halve
            # the conversion overhead (100 pixels Ã— 2 conversions saved per frame).
            
            # CRITICAL: Sync _preview_darken from the authoritative _brightness value.
            # _preview_darken can become stale (e.g., stuck at 94% while user=255/255)
            # when certain code paths (health recovery, reconnection) update _brightness
            # but don't recalculate _preview_darken.  By always deriving it here from
            # _brightness, we guarantee the rendered pixels match the user's intent.
            old_darken = self._preview_darken
            self._preview_darken = darken_percent
            self._last_applied_darken = darken_percent
            if old_darken != darken_percent:
                _LOGGER.warning(
                    f"[BRIGHTNESS_DIAG] [{self._ip}] APPLY â€” fixed stale _preview_darken: "
                    f"{old_darken}% â†’ {darken_percent}% (user={self._brightness}/255)"
                )

            has_color_effect = (
                self._preview_saturation != 100 or self._preview_hue_shift != 0 or
                self._preview_contrast != 100 or self._preview_temperature != 0 or
                self._preview_vibrance != 100 or self._preview_glow != 0 or
                self._preview_grayscale != 0 or self._preview_invert != 0 or
                self._preview_tint_strength != 0
            )
            has_brightness_effect = (self._preview_darken != 0 or self._preview_brighten != 0)
            
            # SNAPSHOT: Capture base colors for _apply_brightness_only (fast path).
            # The JS card also uses these (with _preview_darken applied on-the-fly)
            # for instant brightness preview without lamp roundtrip.
            #
            # The snapshot is taken AFTER color effects but BEFORE brightness
            # darkening, so _base_matrix_colors always contains:
            #   ✓ Original pixel colors (text/drawing)
            #   ✓ Color adjustments (hue_shift, saturation, etc.) already baked in
            #   ✗ No brightness darkening
            #   ✗ No color correction (gamma)
            #   ✗ No color accuracy (per-channel gain)
            #
            # The brightness fast path (_apply_brightness_only_impl) therefore
            # must NOT re-apply color adjustments — only brightness pipeline.
            snapshot_in_loop = has_color_effect or has_brightness_effect
            if not snapshot_in_loop:
                try:
                    self._base_matrix_colors = []
                    for module in self._layout.device_layout:
                        if hasattr(module, 'data') and module.data:
                            hex_color = module.data[0].lstrip('#')
                            rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                            self._base_matrix_colors.append(rgb)
                        else:
                            self._base_matrix_colors.append((0, 0, 0))
                except Exception:
                    pass
            
            has_color_accuracy = self._color_accuracy_enabled
            needs_pixel_processing = has_color_effect or has_brightness_effect or has_color_accuracy
            if needs_pixel_processing:
                if snapshot_in_loop:
                    self._base_matrix_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        final_colors = []
                        for hex_color in module.data:
                            rgb = hex_to_rgb(hex_color)
                            if has_color_effect:
                                rgb = self.apply_color_adjustments(rgb)
                            # Snapshot AFTER color effects, BEFORE brightness darkening.
                            # Each module has exactly 1 pixel (1x1 grid = 100 modules).
                            if snapshot_in_loop:
                                self._base_matrix_colors.append(rgb)
                            if has_brightness_effect:
                                rgb = self._apply_final_brightness(rgb)
                                rgb = self._apply_color_correction(rgb)
                            # Color accuracy is applied ALWAYS (independent of brightness)
                            rgb = self._apply_color_accuracy(rgb)
                            final_colors.append(rgb_to_hex(rgb))
                        module.data = final_colors
                    elif snapshot_in_loop:
                        self._base_matrix_colors.append((0, 0, 0))
            
            # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            # TRANSITION ANIMATION: If enabled, animate from previous â†’ new state
            # before sending the final frame.  Runs intermediate frames through
            # draw_matrices_fast directly (FX mode already active above).
            # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            # Only animate transitions for user-initiated content changes.
            # Retries, periodic refreshes, and health-recovery turn_on calls
            # skip the animation to avoid re-triggering long transitions that
            # previously caused hard-timeout cascades.
            _TRANSITION_ANIMATE_TYPES = {
                'text_change', 'color_change', 'pixel_art',
            }
            if (self._transition_type != "none"
                    and self._last_sent_colors is not None
                    and not self._transition_active
                    and self._current_update_type in _TRANSITION_ANIMATE_TYPES):
                # Extract target colors from current (post-effects) module data
                target_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        target_colors.append(hex_to_rgb(module.data[0]))
                    else:
                        target_colors.append((0, 0, 0))
                # Only animate when content actually changed
                if target_colors != self._last_sent_colors:
                    try:
                        await self._run_transition(self._last_sent_colors, target_colors)
                    except Exception as e:
                        _LOGGER.warning(f"[TRANSITION] [{self._ip}] Transition aborted: {e}")
                    # Restore target colors to modules for the final send below
                    for i, module in enumerate(self._layout.device_layout):
                        if i < len(target_colors):
                            module.data = [rgb_to_hex(target_colors[i])]
                    # Clean TCP for final frame: close the persistent socket used
                    # for transition frames and re-activate FX on fresh TCP so the
                    # final authoritative frame goes on a pristine connection.
                    try:
                        await self.ensure_fx_ready()
                    except Exception as e:
                        _LOGGER.warning(
                            f"[TRANSITION] [{self._ip}] Post-transition FX re-activation failed: {e}"
                        )
            
            raw_rgb_data = self._layout.get_raw_rgb_data()
            
            _apply_t0 = time.time()
            
            # Count lit pixels for diagnostic logging
            lit = sum(1 for m in self._layout.device_layout
                      if hasattr(m, 'data') and m.data and m.data[0] != '#000000')
            idle_since_last_cmd = time.time() - self._cube_matrix._last_command_time if self._cube_matrix._last_command_time > 0 else -1
            
            _LOGGER.warning(
                f"[APPLY] [{self._ip}] Sending update_leds: "
                f"{lit} lit / {100 - lit} dark pixels, "
                f"text='{self._custom_text[:10]}' mode='{self._mode}' "
                f"idle={idle_since_last_cmd:.1f}s fx_age={time.time() - self._last_fx_mode_time:.0f}s "
                f"bright={self._brightness}/255 hw={hardware_brightness}% darken={darken_percent}%"
            )
            
            _t_before_send = time.time()
            await self._cube_matrix.draw_matrices_fast(raw_rgb_data)
            _t_after_send = time.time()
            _LOGGER.warning(
                f"[TIMING] [{self._ip}] TCP draw_matrices_fast: {(_t_after_send - _t_before_send)*1000:.1f}ms")
            
            # POST-SEND RECONNECTION CHECK: If the socket reconnected during
            # draw_matrices, pixels were sent on a non-FX socket â€” silently
            # ignored.  Mark FX as not active so the next update re-activates.
            if self._cube_matrix.consume_reconnected_flag():
                self._fx_mode_is_direct = False
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] Socket reconnected during update_leds â€” "
                    f"FX mode lost, will re-activate on next update"
                )
                raise Exception("Socket reconnected during pixel send â€” FX re-activation needed")
            
            # Track that this darken% was successfully rendered to lamp pixels.
            # This keeps _last_applied_darken accurate even when apply() is called
            # by display-mode changes (draw pixel, text update, etc.) rather than
            # by _internal_set_brightness.  Without this, the next brightness
            # slider drag could see a stale _last_applied_darken and trigger a
            # redundant display update for a darken that was already rendered.
            self._last_applied_darken = self._preview_darken
            
            # Store the final colors that were sent to the lamp for future transitions
            try:
                self._last_sent_colors = []
                for module in self._layout.device_layout:
                    if hasattr(module, 'data') and module.data:
                        self._last_sent_colors.append(hex_to_rgb(module.data[0]))
                    else:
                        self._last_sent_colors.append((0, 0, 0))
            except Exception:
                self._last_sent_colors = None
            
            # Skip post-delay for scroll animations to maintain smooth timing
            if not skip_post_delay:
                await asyncio.sleep(APPLY_POST_DELAY)
            
            # IMPORTANT: When we send pixel data, the lamp automatically turns on
            # So we must update our internal state to match the hardware state
            if not self._is_on:
                _LOGGER.debug(f"[APPLY] Lamp auto-turned on by pixel data, updating state")
                self._is_on = True
            
            # Render camera images + push camera state FIRST so the image
            # is already cached when the light state change triggers the
            # frontendâ€™s HTTP fetch.  This eliminates the double-request.
            if self.hass is not None:
                _t_state_push = time.time()
                self._notify_camera_preview()
                _t_after_cam = time.time()
                self.async_schedule_update_ha_state()
                _t_done = time.time()
                _LOGGER.warning(
                    f"[TIMING] [{self._ip}] apply pipeline: "
                    f"send={(_t_after_send - _t_before_send)*1000:.1f}ms "
                    f"post_delay={(_t_state_push - _t_after_send)*1000:.1f}ms "
                    f"camera_render={(_t_after_cam - _t_state_push)*1000:.1f}ms "
                    f"state_push={(_t_done - _t_after_cam)*1000:.1f}ms "
                    f"total={(_t_done - _apply_t0)*1000:.1f}ms "
                    f"epoch={_t_done:.3f}"
                )
            
            # Clear any previous connection error flag
            self._connection_error = False
        except BulbException as e:
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_code = error_dict.get('code', 0)
            error_message = error_dict.get('message', str(e))
            
            self._connection_error = True
            self._last_connection_error = f"BulbException: {error_message}"
            if "socket error" in error_message.lower() or "closed" in error_message.lower():
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if "socket error" in error_message.lower() or "closed" in error_message.lower():
                _LOGGER.debug(
                    f"[APPLY] [{self._ip}] BulbException (connection): code={error_code}, "
                    f"msg='{error_message}' â€” re-raising for retry"
                )
            else:
                _LOGGER.warning(
                    f"[APPLY] [{self._ip}] BulbException: code={error_code}, "
                    f"msg='{error_message}' â€” re-raising for retry"
                )
            raise
            
        except Exception as e:
            msg = str(e)
            self._connection_error = True
            self._last_connection_error = msg
            if any(kw in msg.lower() for kw in ['socket', 'closed', 'connection', 'cooldown', 'timeout']):
                self._fx_mode_is_direct = False
            self._last_apply_time = 0
            
            if any(kw in msg.lower() for kw in ['socket', 'closed', 'connection', 'cooldown', 'none', 'quota', 'timeout']):
                _LOGGER.debug(
                    f"[APPLY] [{self._ip}] Connection issue: {type(e).__name__}: {msg} â€” re-raising for retry"
                )
            else:
                _LOGGER.error(f"[APPLY] [{self._ip}] Unexpected error: {type(e).__name__}: {e}")
            raise
        finally:
                if self.hass is not None:
                    self.async_schedule_update_ha_state()

    # Text scrolling functionality
    def start_scroll_timer(self, delay=None):
        """Start the auto-scroll timer for long text"""
        if self._scroll_timer is not None:
            self._scroll_timer.cancel()
        
        if self._max_scroll_offset <= 0:
            return
            
        # Use custom delay or default scroll speed
        scroll_delay = delay if delay is not None else self._scroll_speed
            
        # Schedule the next scroll step
        self._scroll_timer = self.hass.loop.call_later(
            scroll_delay,
            self._handle_scroll_step
        )
        _LOGGER.debug(f"[SCROLL] Timer started, next step in {scroll_delay}s")

    def _handle_scroll_step(self):
        """Handle a single scroll step"""
        _LOGGER.debug(f"[SCROLL_DEBUG] _handle_scroll_step called - text: '{self._custom_text}'")
        if self._max_scroll_offset <= 0:
            return
            
        # Update scroll position
        self._scroll_offset += self._scroll_direction
        
        # Check for direction change at boundaries
        if self._scroll_offset >= self._max_scroll_offset:
            self._scroll_offset = self._max_scroll_offset
            self._scroll_direction = -1  # Start scrolling back
        elif self._scroll_offset <= 0:
            self._scroll_offset = 0
            self._scroll_direction = 1  # Start scrolling forward
        
        _LOGGER.debug(f"[SCROLL_DEBUG] Scroll step: offset={self._scroll_offset}, direction={self._scroll_direction}, max={self._max_scroll_offset}")
        
        # Update display and continue scrolling (fire-and-forget to avoid blocking scroll timer)
        # Don't await here - let the queue handle it asynchronously
        # This prevents queue processing delays from slowing down the scroll animation
        self.hass.async_create_task(self.async_apply_display_mode())
        
        # Determine timer delay - first and last positions pause longer
        if self._scroll_offset == 0 or self._scroll_offset == self._max_scroll_offset:
            # First or last position: pause for double time (3.0s)
            delay = self._scroll_speed * 2
            _LOGGER.debug(f"[SCROLL_DEBUG] Pausing at boundary position for {delay}s")
        else:
            # Normal position: use standard speed (1.5s)
            delay = self._scroll_speed
        
        self.start_scroll_timer(delay)

    def stop_scroll_timer(self):
        """Stop the auto-scroll timer"""
        if self._scroll_timer is not None:
            self._scroll_timer.cancel()
            self._scroll_timer = None
        _LOGGER.debug("[SCROLL] Timer stopped")

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> bool:
    # Create and register the light entity FIRST (this happens for EVERY device)
    ip = entry.data[CONF_IP]
    port = entry.data.get('port', 55443)
    
    # Diagnostic: log all config entries to detect duplicates
    all_entries = hass.config_entries.async_entries(DOMAIN)
    same_ip_entries = [e for e in all_entries if e.data.get(CONF_IP) == ip]
    _LOGGER.debug(
        f"[SETUP] Setting up entry {entry.entry_id} for IP {ip} "
        f"(total entries: {len(all_entries)}, entries for this IP: {len(same_ip_entries)})"
    )
    if len(same_ip_entries) > 1:
        _LOGGER.warning(
            f"[SETUP] âš  DUPLICATE CONFIG ENTRIES for IP {ip}! "
            f"Entry IDs: {[e.entry_id for e in same_ip_entries]}. "
            f"This causes two CubeMatrix instances fighting each other â€” "
            f"remove the duplicate in Settings â†’ Integrations."
        )
    
    # TCP reachability has already been verified in __init__.py's
    # async_setup_entry (which is where ConfigEntryNotReady is effective).
    _LOGGER.debug(f"[SETUP] Creating CubeMatrix for {ip}:{port}")
    cube_matrix = CubeMatrix(ip, port)
    
    # Fetch capabilities in executor to avoid blocking the event loop
    _LOGGER.debug(f"[SETUP] Fetching capabilities for {ip} in executor")
    await hass.async_add_executor_job(cube_matrix.fetch_capabilities)
    _LOGGER.debug(f"[SETUP] Capabilities fetched for {ip}, creating light entity")
    
    light_entity = YeelightCubeLight(cube_matrix, ip, entry)
    
    # Register the entity in our global registry using IP as key
    _ENTITY_REGISTRY[ip] = light_entity
    _LOGGER.debug(f"[SETUP] Registered entity by IP {ip} in registry. Registry now contains: {list(_ENTITY_REGISTRY.keys())}")
    
    async_add_entities([light_entity], update_before_add=True)
    
    # Store reference for instant update and for switch platform
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    
    # Store light entity reference for the switch platform to access
    if entry.entry_id not in hass.data[DOMAIN]:
        hass.data[DOMAIN][entry.entry_id] = {}
    
    hass.data[DOMAIN][entry.entry_id]["light"] = light_entity

    # Services should only be registered ONCE (not per device)
    # Skip ALL service registration if already registered to avoid duplicate handlers
    if hass.services.has_service(DOMAIN, "save_pixel_art"):
        _LOGGER.debug(f"[SERVICES] Services already registered, skipping service registration for device {ip}")
        return True
    
    _LOGGER.debug(f"[SERVICES] First device ({ip}) - registering all Yeelight Cube Lite services")
    
    # Deduplication tracker for palette/pixel art deletions
    # Since cards can have multiple target entities, the same deletion service can be called multiple times
    # Track recent deletions to prevent double-deletion errors
    _deletion_tracker = {"last_palette_deletion": None, "last_pixelart_deletion": None, "last_palette_save": None}
    
    def _resolve_entity(service_call, service_name: str):
        """Resolve the target entity from a service call's entity_id.
        
        Looks up entity_id in _ENTITY_REGISTRY (keyed by entity_id after
        async_added_to_hass runs).  Falls back to searching by entity_id
        attribute if the direct lookup fails.
        
        Returns None and logs an error if entity_id is not provided or
        not found â€” callers must handle the None case and abort.
        Never silently falls back to light_entity.
        """
        entity_id = service_call.data.get("entity_id")
        if not entity_id:
            _LOGGER.warning(f"[{service_name}] No entity_id provided â€” cannot determine target")
            return None
        
        # If a list was provided, return only the first one (legacy compat)
        if isinstance(entity_id, list):
            entity_id = entity_id[0] if entity_id else None
            if not entity_id:
                return None
        
        # Direct lookup (fast path â€” registry is keyed by entity_id)
        target = _ENTITY_REGISTRY.get(entity_id)
        if target:
            return target
        
        # Fallback: search by entity_id attribute (handles edge cases)
        for key, entity_obj in _ENTITY_REGISTRY.items():
            if hasattr(entity_obj, 'entity_id') and entity_obj.entity_id == entity_id:
                return entity_obj
        
        _LOGGER.warning(f"[{service_name}] Entity {entity_id} not found in registry (keys: {list(_ENTITY_REGISTRY.keys())})")
        return None

    def _resolve_entities(service_call, service_name: str):
        """Resolve ALL target entities from a service call's entity_id.
        
        Handles both a single entity_id string and a list of entity_ids.
        Returns a list of resolved entity objects (may be empty).
        Used by handlers that support parallel multi-entity dispatch.
        """
        entity_id = service_call.data.get("entity_id")
        if not entity_id:
            _LOGGER.warning(f"[{service_name}] No entity_id provided â€” cannot determine target")
            return []
        
        ids = entity_id if isinstance(entity_id, list) else [entity_id]
        results = []
        for eid in ids:
            target = _ENTITY_REGISTRY.get(eid)
            if not target:
                # Fallback: search by entity_id attribute
                for key, entity_obj in _ENTITY_REGISTRY.items():
                    if hasattr(entity_obj, 'entity_id') and entity_obj.entity_id == eid:
                        target = entity_obj
                        break
            if target:
                results.append(target)
            else:
                _LOGGER.warning(f"[{service_name}] Entity {eid} not found in registry")
        return results

    def _fire_and_forget(*coros):
        """Schedule coroutines to run concurrently in the background.

        hass.async_create_task requires a coroutine, but asyncio.gather
        returns a Future.  This helper wraps the gather in a coroutine so
        the service handler can return immediately while the heavy work
        (transitions, TCP commands) runs in the background.
        """
        async def _run():
            await asyncio.gather(*coros)
        hass.async_create_task(_run())

    async def handle_load_palette(service_call):
        try:
            if service_call is None:
                _LOGGER.error("[LOAD_PALETTE] service_call is None!")
                return
            
            if not hasattr(service_call, 'data'):
                _LOGGER.error(f"[LOAD_PALETTE] service_call has no 'data' attribute! Type: {type(service_call)}")
                return
            
            idx = service_call.data.get("idx")
            entity_id = service_call.data.get("entity_id")
            
            _LOGGER.debug(f"[LOAD_PALETTE] Called: idx={idx}, entity_id={entity_id}")
        except Exception as e:
            _LOGGER.error(f"[LOAD_PALETTE] Error at start: {e}", exc_info=True)
            return
        
        # Access palettes from global storage (not entity property) to avoid hass.data issues
        if DOMAIN not in hass.data or "palettes_v2" not in hass.data[DOMAIN]:
            _LOGGER.error("[LOAD_PALETTE] No palettes storage found in hass.data")
            return
        
        palettes = hass.data[DOMAIN]["palettes_v2"]
        
        if not (isinstance(idx, int) and 0 <= idx < len(palettes)):
            _LOGGER.error(f"[LOAD_PALETTE] Invalid idx {idx} (valid range: 0-{len(palettes)-1})")
            return
            
        palette = palettes[idx]
        
        if not (isinstance(palette, dict) and "colors" in palette and isinstance(palette["colors"], list)):
            _LOGGER.error(f"[LOAD_PALETTE] No valid colors for idx {idx}")
            return

        targets = _resolve_entities(service_call, "LOAD_PALETTE")
        if not targets:
            return

        async def _apply_one(target_entity):
            target_entity._text_colors = palette["colors"]
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            if getattr(target_entity, '_mode', None) == "Panel Color Sequence":
                colors = palette["colors"]
                for i, module in enumerate(target_entity._layout.device_layout):
                    color = colors[i % len(colors)]
                    hex_color = rgb_to_hex(tuple(color))
                    module.set_colors([hex_color])
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            _LOGGER.debug(f"[palette-backend] Applied palette idx {idx} to {target_entity._ip}")

        _fire_and_forget(*[_apply_one(t) for t in targets])

    def generate_preview_for_mode(light_entity, mode: str, apply_brightness: bool = True):
        """
        Generate a full 5x20 preview matrix for a given gradient mode.
        Uses the entity's ACTUAL current state (text, colors, angle, background)
        and renders EXACTLY as it would appear on the lamp.
        
        Args:
            light_entity: The YeelightCubeLight entity instance
            mode: Gradient mode name to preview
            apply_brightness: If True, apply _apply_final_brightness (darken).
                              If False, return raw full-brightness colors.
        
        Returns:
            List of 100 RGB tuples (5 rows x 20 cols = 100 pixels)
        """
        # Create a 100-element array initialized with background color
        preview_matrix = [light_entity._background_color] * 100
        
        # Get entity's current state
        text = light_entity._custom_text or ""
        colors = light_entity._text_colors or [(255, 0, 0)]
        angle = light_entity._angle
        
        if not text:
            # No text - just show background
            if apply_brightness:
                return [light_entity._apply_final_brightness(color) for color in preview_matrix]
            return list(preview_matrix)
        
        # Calculate text layout (same as actual rendering)
        total_columns = TOTAL_COLUMNS
        total_text_width = sum(light_entity.letter_size(light_entity.get_positions_for_letter(letter)) + 1 for letter in text) - 1
        current_offset = light_entity.calculate_text_offset(total_text_width, total_columns)
        
        # Render based on mode (simplified version of _apply_display_mode_internal)
        if mode == "Solid Color":
            color = colors[0]
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            preview_matrix[adjusted_pos] = color
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        elif mode == "Letter Gradient":
            for i, letter in enumerate(text):
                gradient_color = light_entity.calculate_multi_gradient_color(colors, i, len(text))
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            preview_matrix[adjusted_pos] = gradient_color
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        elif mode == "Column Gradient":
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                letter_width = light_entity.letter_size(letter_positions)
                for col_index in range(letter_width):
                    overall_col = col_index + current_offset
                    col_color = light_entity.calculate_multi_gradient_color(colors, overall_col, total_text_width)
                    for pos in letter_positions:
                        adjusted_pos = pos + current_offset
                        if 0 <= adjusted_pos < 100:
                            orig_col = pos % TOTAL_COLUMNS
                            virtual_col = orig_col + current_offset
                            if 0 <= virtual_col < TOTAL_COLUMNS and (pos % TOTAL_COLUMNS) == col_index:
                                preview_matrix[adjusted_pos] = col_color
                current_offset += letter_width + 1
        
        elif mode == "Row Gradient":
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for row_index in range(TOTAL_ROWS):
                    row_color = light_entity.calculate_multi_gradient_color(colors, row_index, TOTAL_ROWS)
                    for pos in letter_positions:
                        if pos // TOTAL_COLUMNS == row_index:
                            adjusted_pos = pos + current_offset
                            if 0 <= adjusted_pos < 100:
                                orig_col = pos % TOTAL_COLUMNS
                                virtual_col = orig_col + current_offset
                                if 0 <= virtual_col < TOTAL_COLUMNS:
                                    preview_matrix[adjusted_pos] = row_color
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        elif mode == "Angle Gradient":
            angle_radians = math.radians(angle)
            dx = math.cos(angle_radians)
            dy = math.sin(angle_radians)
            center_col = (total_columns - 1) / 2
            center_row = (TOTAL_ROWS - 1) / 2
            corners = [(-(center_col), -(center_row)), (center_col, -(center_row)), (-(center_col), center_row), (center_col, center_row)]
            projections = [col * dx + row * dy for col, row in corners]
            min_proj = min(projections)
            max_proj = max(projections)
            proj_range = max_proj - min_proj if max_proj != min_proj else 1
            
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            row, col = divmod(adjusted_pos, total_columns)
                            centered_col = col - center_col
                            centered_row = row - center_row
                            projection = centered_col * dx + centered_row * dy
                            normalized_projection = (projection - min_proj) / proj_range
                            gradient_color = light_entity.calculate_multi_gradient_color(colors, normalized_projection * (len(colors) - 1), len(colors))
                            preview_matrix[adjusted_pos] = tuple(min(255, max(0, v)) for v in gradient_color)
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        elif mode == "Radial Gradient":
            center_col = (total_columns - 1) / 2
            center_row = (TOTAL_ROWS - 1) / 2
            max_dist = math.sqrt(center_col ** 2 + center_row ** 2)
            
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            row, col = divmod(adjusted_pos, total_columns)
                            dx_ = col - center_col
                            dy_ = row - center_row
                            dist = math.sqrt(dx_ ** 2 + dy_ ** 2)
                            norm = dist / max_dist if max_dist > 0 else 0
                            gradient_color = light_entity.calculate_multi_gradient_color(colors, norm * (len(colors) - 1), len(colors))
                            preview_matrix[adjusted_pos] = tuple(min(255, max(0, v)) for v in gradient_color)
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        elif mode == "Letter Angle Gradient":
            angle_radians = math.radians(angle)
            dx = math.cos(angle_radians)
            dy = math.sin(angle_radians)
            
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                if not letter_positions:
                    current_offset += 1
                    continue
                
                # Calculate letter bounding box
                rows = []
                cols = []
                for pos in letter_positions:
                    row, col = divmod(pos + current_offset, total_columns)
                    rows.append(row)
                    cols.append(col)
                
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
                
                corners = [(min_col, min_row), (max_col, min_row), (min_col, max_row), (max_col, max_row)]
                projections = [(col_ - center_col) * dx + (row_ - center_row) * dy for col_, row_ in corners]
                min_proj = min(projections)
                max_proj = max(projections)
                proj_range = max_proj - min_proj if max_proj != min_proj else 1
                
                for pos in letter_positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            row, col = divmod(adjusted_pos, total_columns)
                            centered_col = col - center_col
                            centered_row = row - center_row
                            projection = centered_col * dx + centered_row * dy
                            normalized_projection = (projection - min_proj) / proj_range
                            gradient_color = light_entity.calculate_multi_gradient_color(colors, normalized_projection * (len(colors) - 1), len(colors))
                            preview_matrix[adjusted_pos] = tuple(min(255, max(0, v)) for v in gradient_color)
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        elif mode == "Letter Vertical Gradient":
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                letter_width = light_entity.letter_size(letter_positions)
                if letter_width <= 0:
                    continue
                
                if letter_width == 1:
                    center_index = (len(colors) - 1) / 2
                    gradient_color = light_entity.calculate_multi_gradient_color(colors, center_index, len(colors))
                    for pos in letter_positions:
                        adjusted_pos = pos + current_offset
                        if 0 <= adjusted_pos < 100:
                            orig_col = pos % TOTAL_COLUMNS
                            virtual_col = orig_col + current_offset
                            if 0 <= virtual_col < TOTAL_COLUMNS:
                                preview_matrix[adjusted_pos] = tuple(min(255, max(0, val)) for val in gradient_color)
                else:
                    for col_index in range(letter_width):
                        gradient_color = light_entity.calculate_multi_gradient_color(colors, col_index, letter_width)
                        for pos in letter_positions:
                            if (pos % total_columns) == col_index:
                                adjusted_pos = pos + current_offset
                                if 0 <= adjusted_pos < 100:
                                    orig_col = pos % TOTAL_COLUMNS
                                    virtual_col = orig_col + current_offset
                                    if 0 <= virtual_col < TOTAL_COLUMNS:
                                        preview_matrix[adjusted_pos] = tuple(min(255, max(0, val)) for val in gradient_color)
                current_offset += letter_width + 1
        
        elif mode == "Text Color Sequence":
            # Random color sequence
            shuffled_colors = colors[:]
            random.shuffle(shuffled_colors)
            pixel_index = 0
            for letter in text:
                letter_positions = light_entity.get_positions_for_letter(letter)
                positions = letter_positions[:]
                random.shuffle(positions)
                for pos in positions:
                    adjusted_pos = pos + current_offset
                    if 0 <= adjusted_pos < 100:
                        orig_col = pos % TOTAL_COLUMNS
                        virtual_col = orig_col + current_offset
                        if 0 <= virtual_col < TOTAL_COLUMNS:
                            color = shuffled_colors[pixel_index % len(shuffled_colors)]
                            preview_matrix[adjusted_pos] = color
                    pixel_index += 1
                current_offset += light_entity.letter_size(letter_positions) + 1
        
        # Apply final brightness/darkness adjustments (same as matrix_colors in extra_state_attributes)
        if apply_brightness:
            return [light_entity._apply_final_brightness(color) for color in preview_matrix]
        return list(preview_matrix)

    async def handle_preview_gradient_modes(service_call):
        """Generate full 5x20 preview matrices for all gradient modes using entity's current state."""
        apply_brightness = service_call.data.get("apply_brightness", False)
        
        target_entity = _resolve_entity(service_call, "PREVIEW_GRADIENT_MODES")
        if not target_entity:
            return {}
        
        # Log current entity state for debugging
        _LOGGER.debug(f"[PREVIEW] Generating previews for entity with text='{target_entity._custom_text}', angle={target_entity._angle}, colors={len(target_entity._text_colors or [])} colors")
        
        # Generate previews for all modes using entity's actual state
        modes = [
            "Solid Color",
            "Letter Gradient",
            "Column Gradient",
            "Row Gradient",
            "Angle Gradient",
            "Radial Gradient",
            "Letter Angle Gradient",
            "Letter Vertical Gradient",
            "Text Color Sequence"
        ]
        
        previews = {}
        for mode in modes:
            preview_colors = generate_preview_for_mode(target_entity, mode, apply_brightness)
            # Convert to list of lists for JSON serialization
            previews[mode] = [list(color) for color in preview_colors]
        
        _LOGGER.debug(f"[PREVIEW] Generated {len(modes)} previews, each with 100 pixels (5x20)")
        
        # Fire event with preview data
        hass.bus.async_fire(
            f"{DOMAIN}_gradient_preview_response",
            {
                "entity_id": target_entity.entity_id,
                "previews": previews,
                "rows": 5,
                "cols": 20,
                "text": target_entity._custom_text,
                "angle": target_entity._angle,
                "brightness": target_entity._brightness,
                "darken_percent": target_entity._preview_darken,
                "apply_brightness": apply_brightness
            }
        )
        
        return previews

    hass.services.async_register(
        DOMAIN,
        "preview_gradient_modes",
        handle_preview_gradient_modes,
        schema=vol.Schema({
            vol.Optional("entity_id"): _entity_id_or_list,
            vol.Optional("apply_brightness"): bool
        })
    )

    hass.services.async_register(
        DOMAIN,
        "load_palette",
        handle_load_palette,
        schema=vol.Schema({
            vol.Required("idx"): cv.positive_int,
            vol.Optional("entity_id"): _entity_id_or_list
        })
    )

    async def handle_import_pixel_arts(service_call):
        """Import and overwrite the full list of pixel arts."""
        pixel_arts = service_call.data.get("pixel_arts")
        if not isinstance(pixel_arts, list):
            _LOGGER.error("import_pixel_arts expects a list of pixel art dicts")
            return
        # Validate structure: each item should be a dict with 'name' and 'pixels' (list)
        valid_pixel_arts = []
        for art in pixel_arts:
            if (
                isinstance(art, dict)
                and "name" in art
                and "pixels" in art
                and isinstance(art["pixels"], list)
            ):
                valid_pixel_arts.append({
                    "name": str(art["name"]),
                    "pixels": art["pixels"],
                })
        
        # Update global storage for decoupled sensor
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        hass.data[DOMAIN]["pixel_arts"] = valid_pixel_arts
        
        # Trigger state update for all entities (they access global storage via @property)
        for entity_id, entity in _ENTITY_REGISTRY.items():
            entity.async_write_ha_state()
        
        # Force sensor update by firing event
        hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(valid_pixel_arts)})
        
        # Save to persistent storage
        await async_save_data(hass)
        
        _LOGGER.debug(f"[pixelart-backend] Imported {len(valid_pixel_arts)} pixel arts via import_pixel_arts service.")

    async def handle_update_pixel_arts(service_call):
        """Update the full list of pixel arts (for reordering or bulk updates)."""
        pixel_arts = service_call.data.get("pixel_arts")
        if not isinstance(pixel_arts, list):
            _LOGGER.error("update_pixel_arts expects a list of pixel art dicts")
            return
        
        # Validate structure: each item should be a dict with 'name' and 'pixels' (list)
        valid_pixel_arts = []
        for art in pixel_arts:
            if (
                isinstance(art, dict)
                and "name" in art
                and "pixels" in art
                and isinstance(art["pixels"], list)
            ):
                valid_pixel_arts.append({
                    "name": str(art["name"]),
                    "pixels": art["pixels"],
                })
        
        # Update global storage
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        hass.data[DOMAIN]["pixel_arts"] = valid_pixel_arts
        
        # Force sensor update by firing event
        hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(valid_pixel_arts)})
        
        # Save to persistent storage
        await async_save_data(hass)
        
        _LOGGER.debug(f"[pixelart-backend] Updated pixel arts list with {len(valid_pixel_arts)} items via update_pixel_arts service.")



        # Register a new websocket command to avoid schema cache issues
        ws_schema_v2 = vol.Schema({vol.Optional("idx"): object}, extra=vol.ALLOW_EXTRA)
        @websocket_api.websocket_command({
            "type": "yeelight_cube/ws_get_pixel_art_v2",
            "schema": ws_schema_v2,
        })
        @websocket_api.async_response
        async def ws_get_pixel_art_v2(hass, connection, msg):
            _LOGGER = logging.getLogger(__name__)
            try:
                idx = msg.get("idx")
                pixel_arts = hass.data.get(DOMAIN, {}).get("pixel_arts", [])
                if not (isinstance(idx, int) and 0 <= idx < len(pixel_arts)):
                    connection.send_error(msg["id"], "invalid_index", f"Invalid idx {idx}")
                    return
                art = pixel_arts[idx]
                if not (isinstance(art, dict) and "pixels" in art and isinstance(art["pixels"], list) and len(art["pixels"]) > 0):
                    connection.send_error(msg["id"], "no_pixels", f"No valid pixels for idx {idx}")
                    return
                connection.send_result(msg["id"], {"name": art.get("name", "Unnamed"), "pixels": art.get("pixels", [])})
            except Exception as e:
                _LOGGER.error(f"[pixelart-debug] Exception in ws_get_pixel_art_v2: {e}")

        websocket_api.async_register_command(hass, ws_get_pixel_art_v2)
    
    # NOTE: Entity is already created and registered at the top of this function.
    # Do NOT create a second CubeMatrix/YeelightCubeLight here.

    # --- Pixel Art Service Handlers ---
    async def handle_save_pixel_art(service_call):
        import datetime
        name = service_call.data.get("name")
        pixels = service_call.data.get("pixels")
        if not isinstance(pixels, list):
            _LOGGER.error("save_pixel_art expects a list of pixels")
            return
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        if "pixel_arts" not in hass.data[DOMAIN]:
            hass.data[DOMAIN]["pixel_arts"] = []
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        if not name:
            name = f"Pixel Art {len(pixel_arts) + 1}"
        
        # Add to global storage
        pixel_arts.append({"name": name, "pixels": pixels})
        
        # Pixel arts are global - just fire event for sensor and save
        hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
        
        # Save to persistent storage
        await async_save_data(hass)
        
        _LOGGER.debug(f"[PIXELART-SAVE] Saved '{name}' with {len(pixels)} pixels, new count: {len(pixel_arts)}")

    async def handle_remove_pixel_art(service_call):
        idx = service_call.data.get("idx")
        _LOGGER.debug(f"[PIXELART-DELETE] Service called with idx={idx}")
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different pixel arts)
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data or "pixel_arts" not in hass.data[DOMAIN]:
            _LOGGER.error("[PIXELART-DELETE] No pixel arts storage found in hass.data")
            return
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        _LOGGER.debug(f"[PIXELART-DELETE] Current pixel art count={len(pixel_arts)}")
        
        if isinstance(idx, int) and 0 <= idx < len(pixel_arts):
            removed = pixel_arts.pop(idx)
            _LOGGER.debug(f"[PIXELART-DELETE] Deleted pixel art at idx {idx}: {removed.get('name', 'Unnamed')}")
            
            # Pixel arts are global (not per-light), only need to:
            # 1. Fire event for sensor to pick up
            # 2. Save to persistent storage
            # No need to update light entities - pixel arts are independent
            
            hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
            _LOGGER.debug(f"[PIXELART-DELETE] Fired event, new count: {len(pixel_arts)}")
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug(f"[PIXELART-DELETE] Saved to storage. New pixel art count: {len(pixel_arts)}")
        else:
            _LOGGER.error(f"[PIXELART-DELETE] Invalid idx {idx} (pixel art count: {len(pixel_arts)})")

    async def handle_rename_pixel_art(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        
        # Get current pixel arts from global storage
        if DOMAIN not in hass.data or "pixel_arts" not in hass.data[DOMAIN]:
            _LOGGER.error("[pixelart-backend] No pixel arts to rename")
            return
        
        pixel_arts = hass.data[DOMAIN]["pixel_arts"]
        if (
            isinstance(idx, int)
            and 0 <= idx < len(pixel_arts)
            and isinstance(new_name, str)
        ):
            pixel_arts[idx]["name"] = new_name
            
            # Pixel arts are global - just fire event for sensor and save
            hass.bus.async_fire(f"{DOMAIN}_pixel_arts_updated", {"count": len(pixel_arts)})
            
            # Save to persistent storage
            await async_save_data(hass)
            
            _LOGGER.debug(f"[PIXELART-RENAME] Renamed idx {idx} to '{new_name}'")




    async def handle_apply_pixel_art(service_call):
        # Only accept idx, apply saved pixel art â€” supports multi-entity parallel dispatch
        idx = service_call.data.get("idx")
        targets = _resolve_entities(service_call, "APPLY_PIXEL_ART")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not (isinstance(idx, int) and 0 <= idx < len(target_entity._pixel_arts)):
                _LOGGER.error(f"[pixelart-backend] apply_pixel_art: Invalid idx {idx}.")
                return
            art = target_entity._pixel_arts[idx]
            if not (isinstance(art, dict) and "pixels" in art and isinstance(art["pixels"], list) and len(art["pixels"]) > 0):
                _LOGGER.error(f"[pixelart-backend] apply_pixel_art: No valid pixels for idx {idx}.")
                return
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] apply_pixel_art command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = art["pixels"]
            target_entity._custom_draw_active = True
            target_entity._active_pixel_art_name = art.get("name", f"Pixel Art {idx + 1}")
            target_entity.stop_scroll_timer()
            target_entity._is_scrolling = False
            await target_entity.async_apply_display_mode(update_type='pixel_art')
            if target_entity._pixel_art_select_entity:
                target_entity._pixel_art_select_entity.async_update_from_light()
            _LOGGER.debug(f"[pixelart-backend] Applied pixel art idx {idx} to {target_entity._ip}.")

        _fire_and_forget(*[_apply_one(t) for t in targets])

    async def handle_apply_custom_pixels(service_call):
        pixels = service_call.data.get("pixels")
        _LOGGER.debug(f"[pixelart-backend] apply_custom_pixels: pixels={len(pixels) if pixels else 0}")
        if not pixels or not isinstance(pixels, list):
            _LOGGER.error(f"[pixelart-backend] apply_custom_pixels: No valid pixels provided.")
            return

        targets = _resolve_entities(service_call, "APPLY_CUSTOM_PIXELS")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] apply_custom_pixels command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = pixels
            target_entity._custom_draw_active = True
            target_entity.stop_scroll_timer()
            target_entity._is_scrolling = False
            await target_entity.async_apply_display_mode(update_type='pixel_art')

        _fire_and_forget(*[_apply_one(t) for t in targets])

    async def handle_get_pixel_art(service_call):
        idx = service_call.data.get("idx")
        pixel_arts = hass.data.get(DOMAIN, {}).get("pixel_arts", [])
        if not (isinstance(idx, int) and 0 <= idx < len(pixel_arts)):
            _LOGGER.error(f"[pixelart-backend] get_pixel_art: Invalid idx {idx}")
            return {"error": "Invalid index"}
        art = pixel_arts[idx]
        # Only return name and pixels
        return {"name": art.get("name", "Unnamed"), "pixels": art.get("pixels", [])}

    hass.services.async_register(
    DOMAIN,
    "get_pixel_art",
    handle_get_pixel_art,
    schema=vol.Schema({vol.Required("idx", default=0): vol.All(int, vol.Range(min=0))}),
    )

    hass.services.async_register(
        DOMAIN,
        "save_pixel_art",
        handle_save_pixel_art,
        schema=vol.Schema({
            vol.Required("pixels"): [
                {
                    vol.Required("position"): cv.positive_int,
                    vol.Required("color"): vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)),
                }
            ],
            vol.Optional("name"): cv.string,
        }, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "remove_pixel_art",
        handle_remove_pixel_art,
        schema=vol.Schema({vol.Required("idx"): vol.All(int, vol.Range(min=0))}, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "rename_pixel_art",
        handle_rename_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Required("name"): cv.string,
        }, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "apply_pixel_art",
        handle_apply_pixel_art,
        schema=vol.Schema({
            vol.Required("idx"): vol.All(int, vol.Range(min=0)),
            vol.Optional("entity_id"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )
    hass.services.async_register(
        DOMAIN,
        "apply_custom_pixels",
        handle_apply_custom_pixels,
        schema=vol.Schema({
            vol.Required("pixels", description="Array of 100 RGB color arrays representing the 10x10 matrix pixels, e.g. [[255,0,0], [0,255,0], ...]"): list,
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )
    
    hass.services.async_register(
        DOMAIN,
        "import_pixel_arts",
        handle_import_pixel_arts,
        schema=vol.Schema({
            vol.Required("pixel_arts"): list,
        }, extra=vol.ALLOW_EXTRA)
    )
    
    hass.services.async_register(
        DOMAIN,
        "update_pixel_arts",
        handle_update_pixel_arts,
        schema=vol.Schema({
            vol.Required("pixel_arts"): list,
        }, extra=vol.ALLOW_EXTRA)
    )
    
    async def handle_set_brightness(service_call):
        """Set brightness using Home Assistant's light.turn_on service (1-100%)."""
        brightness_pct = service_call.data.get("brightness", 100)
        
        # Clamp to 1-100 range
        brightness_pct = max(1, min(100, brightness_pct))
        
        target_entity = _resolve_entity(service_call, "SET_BRIGHTNESS")
        if not target_entity:
            return
        
        # Map 1-100 slider to Home Assistant brightness (1-255)
        # Formula: map 1-100 to 3-255 (same as lamp preview card)
        ha_brightness = round(3 + ((brightness_pct - 1) * 252) / 99)
        ha_brightness = max(3, min(255, ha_brightness))
        
        _LOGGER.debug(f"[SET_BRIGHTNESS] Setting brightness to {brightness_pct}% (HA value: {ha_brightness}) for {target_entity.entity_id}")
        
        try:
            # Use standard Home Assistant light.turn_on service
            await hass.services.async_call(
                "light",
                "turn_on",
                {
                    "entity_id": target_entity.entity_id,
                    "brightness": ha_brightness,
                },
                blocking=True
            )
            _LOGGER.debug(f"[SET_BRIGHTNESS] Successfully set brightness to {brightness_pct}%")
        except Exception as e:
            _LOGGER.error(f"[SET_BRIGHTNESS] Failed to set brightness: {e}")
    
    hass.services.async_register(
        DOMAIN,
        "set_brightness",
        handle_set_brightness,
        schema=vol.Schema({
            vol.Required("brightness", description="Brightness percentage (1-100)"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )
    
    # The rest of the service handlers (palette, etc.) should also be registered after light_entity is created
    async def handle_set_orientation(service_call):
        orientation = service_call.data.get("orientation")
        entity_id = service_call.data.get("entity_id")
        
        target_entity = _resolve_entity(service_call, "SET_ORIENTATION")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug(f"[AUTO-TURN-ON] set_orientation command ignored - lamp is off and auto-turn-on is disabled")
            return
        
        await target_entity.set_orientation(orientation)

    hass.services.async_register(
        DOMAIN,
        "set_orientation",
        handle_set_orientation,
        schema=vol.Schema({
            vol.Required("orientation"): vol.In(["normal", "flipped"]),
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    async def handle_set_font(service_call):
        font = service_call.data.get("font")
        entity_id = service_call.data.get("entity_id")
        from .layout import FONT_MAPS
        if font not in FONT_MAPS:
            _LOGGER.error(f"Invalid font for set_font: {font}")
            return
        
        target_entity = _resolve_entity(service_call, "SET_FONT")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug(f"[AUTO-TURN-ON] set_font command ignored - lamp is off and auto-turn-on is disabled")
            return
        
        await target_entity.set_font(font)
        if target_entity._font_select_entity:
            target_entity._font_select_entity.async_update_from_light()

    hass.services.async_register(
        DOMAIN,
        "set_font",
        handle_set_font,
        schema=vol.Schema({
            vol.Required("font"): vol.In(list(FONT_MAPS.keys())),
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    async def handle_set_alignment(service_call):
        alignment = service_call.data.get("alignment")
        entity_id = service_call.data.get("entity_id")
        if alignment not in ("left", "center", "right"):
            _LOGGER.error(f"Invalid alignment value for set_alignment: {alignment}")
            return
        
        target_entity = _resolve_entity(service_call, "SET_ALIGNMENT")
        if not target_entity:
            return
        
        # Check auto-turn-on setting
        if not target_entity._is_on and not target_entity._should_auto_turn_on():
            _LOGGER.debug(f"[AUTO-TURN-ON] set_alignment command ignored - lamp is off and auto-turn-on is disabled")
            return
        
        await target_entity.set_alignment(alignment)
        # Notify alignment select entity of the change
        if target_entity._alignment_select_entity:
            target_entity._alignment_select_entity.async_update_from_light()

    hass.services.async_register(
        DOMAIN,
        "set_alignment",
        handle_set_alignment,
        schema=vol.Schema({
            vol.Required("alignment"): vol.In(["left", "center", "right"]),
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    # Note: handle_remove_palette is defined later in the file (after handle_set_panel_mode)
    # to avoid duplicate service registration
    
    async def handle_set_palettes(service_call):
        palettes = service_call.data.get("palettes_v2") or service_call.data.get("palettes")
        if palettes and isinstance(palettes, list):
            # Validate palettes: list of dicts with name and colors
            valid_palettes = []
            for pal in palettes:
                if (
                    isinstance(pal, dict)
                    and "name" in pal
                    and "colors" in pal
                    and isinstance(pal["colors"], list)
                    and all(isinstance(c, (list, tuple)) and len(c) == 3 for c in pal["colors"])
                ):
                    valid_palettes.append({"name": str(pal["name"]), "colors": [tuple(c) for c in pal["colors"]]})
            # Store palettes globally
            if DOMAIN not in hass.data:
                hass.data[DOMAIN] = {}
            hass.data[DOMAIN]["palettes_v2"] = valid_palettes
            # Trigger state update on ALL entities (palettes are exposed as state attributes)
            for entity_obj in _ENTITY_REGISTRY.values():
                if hasattr(entity_obj, 'hass') and entity_obj.hass is not None:
                    entity_obj.async_schedule_update_ha_state()
            # Save to persistent storage
            await async_save_data(hass)

    hass.services.async_register(
        DOMAIN,
        "set_palettes",
        handle_set_palettes,
        schema=vol.Schema({
            vol.Required("palettes"): [
                {"name": cv.string, "colors": [vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple))]}
            ],
        })
    )
    async def handle_save_palette(service_call):
        palette = service_call.data.get("palette")
        entity_id = service_call.data.get("entity_id")
        name = service_call.data.get("name")
        
        # Access palettes from global storage directly (not through entity property)
        # to avoid issues if entity.hass is not yet initialized
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        if "palettes_v2" not in hass.data[DOMAIN]:
            hass.data[DOMAIN]["palettes_v2"] = []
        palettes = hass.data[DOMAIN]["palettes_v2"]
        
        # Generate default name if not provided
        if not name:
            name = f"Palette {len(palettes)+1}"
        
        # Create a deduplication key based on palette colors and name
        palette_key = f"save_{name}_{len(palette) if palette else 0}"
        if _deletion_tracker["last_palette_save"] == palette_key:
            _LOGGER.debug(f"[SAVE_PALETTE] DUPLICATE CALL DETECTED - skipping save of '{name}' (already saved)")
            return
        
        _LOGGER.debug(f"[SAVE_PALETTE] Received entity_id: {entity_id}, palette length: {len(palette) if palette else 0}, name: {name}")
        
        target_entity = _resolve_entity(service_call, "SAVE_PALETTE")
        if not target_entity:
            return
            
        if palette and isinstance(palette, list):
            # Track this save to prevent duplicates
            _deletion_tracker["last_palette_save"] = palette_key
            
            # Clear tracker after 2 seconds to allow future operations with same name
            async def clear_tracker():
                await asyncio.sleep(2)
                if _deletion_tracker["last_palette_save"] == palette_key:
                    _deletion_tracker["last_palette_save"] = None
            hass.async_create_task(clear_tracker())
            
            # Allow saving palettes with duplicate color lists (different names)
            palettes.append({"name": name, "colors": [tuple(c) for c in palette]})
            _LOGGER.debug(f"[SAVE_PALETTE] Palette appended to storage. New count: {len(palettes)}")
            _LOGGER.debug(f"[SAVE_PALETTE] Last 3 palette names in storage: {[p.get('name', 'unnamed') for p in palettes[-3:]]}")
            
            # Trigger state update for all entities that are ready
            for ip, entity in _ENTITY_REGISTRY.items():
                if entity.hass is not None:  # Only update entities that are fully initialized
                    entity.async_write_ha_state()
            
            # Fire event for sensor updates
            _LOGGER.debug(f"[SAVE_PALETTE] Firing palettes_updated event with count={len(palettes)}")
            hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug(f"[SAVE_PALETTE] Palette '{name}' saved. Total palettes: {len(palettes)}")

    hass.services.async_register(
        DOMAIN,
        "save_palette",
        handle_save_palette,
        schema=vol.Schema({
            vol.Required("palette"): vol.All(
                [vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple))]
            ),
            vol.Optional("name"): cv.string,
            vol.Optional("entity_id"): _entity_id_or_list,
        })
    )
    async def handle_rename_palette(service_call):
        idx = service_call.data.get("idx")
        new_name = service_call.data.get("name")
        # Access global palette storage directly
        palettes = hass.data.get(DOMAIN, {}).get("palettes_v2", [])
        if (
            isinstance(idx, int)
            and 0 <= idx < len(palettes)
            and isinstance(new_name, str)
        ):
            palettes[idx]["name"] = new_name
            # Update ALL entities' HA state (palettes are exposed as state attributes)
            for entity_obj in _ENTITY_REGISTRY.values():
                if hasattr(entity_obj, 'hass') and entity_obj.hass is not None:
                    entity_obj.async_schedule_update_ha_state()
            # Note: No need to update hass.data - palettes list is already a shared reference
            # Save to persistent storage
            await async_save_data(hass)
            # Force PaletteSensor to update its state for instant frontend refresh
            palette_sensor = hass.data.get(DOMAIN, {}).get("palette_sensor_entity")
            if palette_sensor:
                write_state = getattr(palette_sensor, "async_write_ha_state", None)
                if write_state:
                    result = write_state()
                    if asyncio.iscoroutine(result):
                        await result

    hass.services.async_register(
        DOMAIN,
        "rename_palette",
        handle_rename_palette,
        schema=vol.Schema({
            vol.Required("idx"): cv.positive_int,
            vol.Required("name"): cv.string,
        })
    )
    async def handle_set_custom_pixels(service_call):
        # Expects: list of {"position": int, "color": [r,g,b]} â€” supports multi-entity parallel dispatch
        pixels = service_call.data.get("pixels")
        if not isinstance(pixels, list):
            _LOGGER.error("set_custom_pixels expects a list of dicts with 'position' and 'color'")
            return

        # Validate and convert colors to tuple (shared across all targets)
        valid_pixels = []
        for px in pixels:
            pos = px.get("position")
            color = px.get("color")
            if (
                isinstance(pos, int)
                and isinstance(color, (list, tuple))
                and len(color) == 3
            ):
                valid_pixels.append({"position": pos, "color": tuple(color)})

        targets = _resolve_entities(service_call, "SET_CUSTOM_PIXELS")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] set_custom_pixels command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = valid_pixels
            target_entity._custom_draw_active = True
            target_entity._custom_text = None
            _LOGGER.debug(f"[SET_CUSTOM_PIXELS] Set {len(valid_pixels)} pixels, custom_draw_active: True")
            await target_entity.async_apply_display_mode(update_type='pixel_art')

        _fire_and_forget(*[_apply_one(t) for t in targets])
        
    hass.services.async_register(
        DOMAIN,
        "set_custom_pixels",
        handle_set_custom_pixels,
        schema=vol.Schema({
            vol.Required("pixels"): [
                {
                    vol.Required("position"): cv.positive_int,
                    vol.Required("color"): vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)),
                }
            ],
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    async def handle_set_custom_text(service_call):
        # Supports multi-entity parallel dispatch
        text = service_call.data.get("text")
        
        if not isinstance(text, str):
            _LOGGER.error("set_custom_text received non-string: %s", text)
            return
        
        # Prevent empty text â€” the Yeelight firmware misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text == "":
            text = " "

        targets = _resolve_entities(service_call, "SET_CUSTOM_TEXT")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] set_custom_text command ignored - lamp is off and auto-turn-on is disabled")
                return
            _LOGGER.debug(f"[SET_TEXT] Setting custom text to: '{text}' for entity {target_entity.entity_id}")
            target_entity._custom_text = text
            target_entity._custom_pixels = None
            target_entity._custom_draw_active = False
            target_entity._active_pixel_art_name = None
            if target_entity._text_input_entity and hasattr(target_entity._text_input_entity, 'hass') and target_entity._text_input_entity.hass is not None:
                target_entity._text_input_entity.async_update_from_light()
            if target_entity._pixel_art_select_entity:
                target_entity._pixel_art_select_entity.async_update_from_light()
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            target_entity._scroll_offset = 0
            target_entity._scroll_direction = 1
            target_entity.stop_scroll_timer()
            await target_entity.async_apply_display_mode(update_type='text_change')
            _LOGGER.debug(f"[SET_TEXT] Display mode applied successfully for entity {target_entity.entity_id}")

        _fire_and_forget(*[_apply_one(t) for t in targets])
        
    hass.services.async_register(
        DOMAIN,
        "set_custom_text",
        handle_set_custom_text,
        schema=vol.Schema({
            vol.Required("text", description="Text to display on the cube matrix"): cv.string,
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    async def handle_set_angle(service_call):
        # Supports multi-entity parallel dispatch
        angle = service_call.data.get("angle")
        
        try:
            angle = float(angle)
        except (TypeError, ValueError):
            _LOGGER.error("Invalid angle value for set_angle: %s", angle)
            return

        targets = _resolve_entities(service_call, "SET_ANGLE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] set_angle command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._angle = angle
            # Push angle to HA state immediately so the frontend card's set hass()
            # detects the change and can reload previews without waiting for the
            # next polling cycle (~30s).  Must happen BEFORE the slow hardware
            # command so the JS card sees the new angle right away.
            target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity._angle_number_entity:
                target_entity._angle_number_entity.async_update_from_light()

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_angle",
        handle_set_angle,
        schema=vol.Schema({
            vol.Required("angle", description="Gradient angle in degrees (0-360). Used for angle-based gradient modes."): vol.Coerce(float),
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    async def handle_set_text_colors(service_call):
        # Supports multi-entity parallel dispatch
        text_colors = service_call.data.get("text_colors")
        save_as_palette = service_call.data.get("save_as_palette", False)

        if not text_colors or not isinstance(text_colors, list):
            return

        converted_colors = [tuple(c) for c in text_colors]

        targets = _resolve_entities(service_call, "SET_TEXT_COLORS")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] Command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._text_colors = converted_colors
            if target_entity._text_colors:
                target_entity._rgb_color = target_entity._text_colors[0]
            await target_entity.async_apply_display_mode(update_type='color_change')
            target_entity.async_schedule_update_ha_state()

        async def _apply_all():
            await asyncio.gather(*[_apply_one(t) for t in targets])
            await async_save_data(hass)
        hass.async_create_task(_apply_all())

    hass.services.async_register(
        DOMAIN,
        "set_text_colors",
        handle_set_text_colors,
        schema=vol.Schema({
            vol.Required("text_colors", description="Array of RGB color arrays, e.g. [[255,0,0], [0,255,0]] for red to green gradient"): vol.All(list, [vol.All(list, [cv.positive_int])]),
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
            vol.Optional("save_as_palette", default=False, description="Save these colors as a palette for later use"): bool,
        })
    )
    
    # Note: rename_pixel_art and apply_pixel_art services are already registered above in the main service registration block
    # Note: set_brightness service is registered above in the main service registration block
    
    async def handle_display_image(service_call):
        """Accepts a base64-encoded image, resizes/crops to 20x5, and displays it on the lamp(s).
        Supports multi-entity parallel dispatch."""
        image_b64 = service_call.data.get("image_b64")
        if not image_b64:
            _LOGGER.error("No image_b64 provided to display_image service.")
            return

        # Process image once (shared across all targets)
        try:
            matrix = image_to_matrix(image_b64, width=20, height=5)
            flipped_matrix = []
            for row in range(5):
                start = row * 20
                end = start + 20
                flipped_matrix[0:0] = matrix[start:end]
            custom_pixels = [
                {"position": pos, "color": color}
                for pos, color in enumerate(flipped_matrix)
            ]
        except Exception as e:
            _LOGGER.error(f"Error processing image: {e}")
            return

        targets = _resolve_entities(service_call, "DISPLAY_IMAGE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] display_image command ignored - lamp is off and auto-turn-on is disabled")
                return
            target_entity._custom_pixels = custom_pixels
            target_entity._custom_draw_active = True
            await target_entity.async_apply_display_mode(update_type='pixel_art')

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "display_image",
        handle_display_image,
        schema=vol.Schema({
            vol.Required("image_b64"): cv.string,
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        })
    )
    # Store the light entity and palettes in hass.data for palette sensor registration and frontend use
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    hass.data[DOMAIN]["light_entity"] = light_entity
    # light_entity._palettes is already a shared reference to hass.data[DOMAIN]["palettes_v2"] from __init__
    # No need to copy - they're the same object

    async def handle_set_mode(service_call):
        # Supports multi-entity parallel dispatch
        mode = service_call.data.get("mode")
        panel_mode = service_call.data.get("panel_mode")
        
        text_modes = [
            "Solid Color",
            "Letter Gradient",
            "Column Gradient",
            "Row Gradient",
            "Angle Gradient",
            "Radial Gradient",
            "Letter Vertical Gradient",
            "Letter Angle Gradient",
            "Text Color Sequence",
            "Panel Color Sequence",
        ]

        if mode not in text_modes + ["Custom Draw"]:
            _LOGGER.error(f"[set_mode] Invalid mode: {mode}")
            return

        targets = _resolve_entities(service_call, "SET_MODE")
        if not targets:
            return

        async def _apply_one(target_entity):
            if not target_entity._is_on and not target_entity._should_auto_turn_on():
                _LOGGER.debug(f"[AUTO-TURN-ON] set_mode command ignored - lamp is off and auto-turn-on is disabled")
                return
            if panel_mode is not None:
                target_entity._panel_mode = panel_mode
                _LOGGER.debug(f"[set_mode] Also setting panel_mode to {panel_mode}")
            if mode == "Custom Draw":
                target_entity._custom_draw_active = True
            else:
                target_entity._mode = mode
                target_entity._custom_draw_active = False
                target_entity._custom_pixels = None
            await target_entity.async_apply_display_mode(update_type='color_change')
            if target_entity._mode_select_entity:
                target_entity._mode_select_entity.async_update_from_light()

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_mode",
        handle_set_mode,
        schema=vol.Schema({
            vol.Required("mode", description="Display mode for text/gradients"): vol.In([
                "Solid Color",
                "Letter Gradient", 
                "Column Gradient",
                "Row Gradient",
                "Angle Gradient",
                "Radial Gradient",
                "Letter Vertical Gradient",
                "Letter Angle Gradient",
                "Text Color Sequence",
                "Panel Color Sequence",
                "Custom Draw",
            ]),
            vol.Optional("panel_mode", description="Whether to apply gradients to entire panel (true) or just text areas (false). If provided, sets panel_mode and mode in one call."): cv.boolean,
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
        })
    )

    async def handle_set_solid_color(service_call):
        # Supports multi-entity parallel dispatch
        rgb_color = service_call.data.get("rgb_color")
        if isinstance(rgb_color, str):
            rgb_color = hex_to_rgb(rgb_color)
        rgb_color = tuple(rgb_color)

        targets = _resolve_entities(service_call, "SET_SOLID_COLOR")
        if not targets:
            return

        async def _apply_one(target_entity):
            target_entity._rgb_color = rgb_color
            await target_entity.async_apply_display_mode(update_type='color_change')

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_solid_color",
        handle_set_solid_color,
        schema=vol.Schema({
            vol.Required("rgb_color"): vol.Any(
                vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)),
                cv.string
            ),
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        })
    )

    async def handle_set_panel_mode(service_call):
        # Supports multi-entity parallel dispatch
        panel_mode = service_call.data.get("panel_mode", False)

        targets = _resolve_entities(service_call, "SET_PANEL_MODE")
        if not targets:
            return

        async def _apply_one(target_entity):
            _LOGGER.warning(
                f"[PANEL] [{getattr(target_entity, '_ip', '?')}] "
                f"Setting panel_mode={panel_mode} (was {target_entity._panel_mode})"
            )
            target_entity._panel_mode = panel_mode
            target_entity.async_schedule_update_ha_state()
            await target_entity.async_apply_display_mode(update_type='color_change')

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_panel_mode",
        handle_set_panel_mode,
        schema=vol.Schema({
            vol.Required("panel_mode", description="Whether to apply gradients to entire panel (true) or just text areas (false)"): cv.boolean,
            vol.Optional("entity_id", description="Target specific cube entity (light.cubelite_x_x_x_x). If not provided, uses default entity."): _entity_id_or_list,
        })
    )

    async def handle_set_gradient_colors(service_call):
        start_color = service_call.data.get("start_color")
                # (Removed duplicate/old per-mode logic block; only new multi-stop gradient logic remains above)

    async def handle_remove_palette(service_call):
        try:
            if service_call is None:
                _LOGGER.error("[PALETTE-DELETE] service_call is None!")
                return
            
            if not hasattr(service_call, 'data'):
                _LOGGER.error(f"[PALETTE-DELETE] service_call has no 'data' attribute! Type: {type(service_call)}")
                return
            
            idx = service_call.data.get("idx")
        except Exception as e:
            _LOGGER.error(f"[PALETTE-DELETE] Error accessing service_call data: {e}", exc_info=True)
            return
        
        # Access palettes from global storage directly (not through entity property)
        if DOMAIN not in hass.data or "palettes_v2" not in hass.data[DOMAIN]:
            _LOGGER.error("[PALETTE-DELETE] No palettes storage found in hass.data")
            return
        
        palettes = hass.data[DOMAIN]["palettes_v2"]
        _LOGGER.debug(f"[PALETTE-DELETE] idx={idx} (type: {type(idx)}), palette count={len(palettes)}")
        
        # No duplicate detection - rapid successive deletions are valid
        # (indices shift after each deletion, so same idx can refer to different palettes)
        
        if isinstance(idx, int) and 0 <= idx < len(palettes):
            removed = palettes.pop(idx)
            _LOGGER.debug(f"[PALETTE-DELETE] Removed palette at idx {idx}: '{removed.get('name', 'Unnamed')}'")
            
            # Trigger state update for all entities that are ready
            for entity_id, entity in _ENTITY_REGISTRY.items():
                if entity.hass is not None:
                    entity.async_write_ha_state()
            
            # Fire event for sensor updates
            hass.bus.async_fire(f"{DOMAIN}_palettes_updated", {"count": len(palettes)})
            
            # Save to persistent storage
            await async_save_data(hass)
            _LOGGER.debug(f"[PALETTE-DELETE] Palette '{removed.get('name', 'Unnamed')}' deleted. Remaining: {len(palettes)}")
        else:
            _LOGGER.error(f"[PALETTE-DELETE] Invalid idx {idx} (palette count: {len(palettes)}, valid range: 0-{len(palettes)-1})")

    hass.services.async_register(
        DOMAIN,
        "remove_palette",
        handle_remove_palette,
        schema=vol.Schema({vol.Required("idx"): cv.positive_int})
    )
    
    async def handle_test_display(service_call):
        """Test service to manually trigger display mode application for debugging."""
        target_entity = _resolve_entity(service_call, "TEST_DISPLAY")
        if not target_entity:
            return
        
        _LOGGER.debug("[TEST] handle_test_display called")
        _LOGGER.debug(f"[TEST] Testing entity: {target_entity._attr_name}")
        _LOGGER.debug(f"[TEST] Current state - text: '{target_entity._custom_text}', mode: '{target_entity._mode}', is_on: {target_entity._is_on}")
        _LOGGER.debug(f"[TEST] Text colors: {target_entity._text_colors}")
        _LOGGER.debug(f"[TEST] Background color: {target_entity._background_color}")
        _LOGGER.debug(f"[TEST] Brightness: {target_entity._brightness}")
        _LOGGER.debug(f"[TEST] Alignment: {target_entity._alignment}")
        _LOGGER.debug(f"[TEST] Font: {target_entity._font}")
        _LOGGER.debug(f"[TEST] Connection status - has_error: {getattr(target_entity, '_connection_error', False)}, last_error: {getattr(target_entity, '_last_connection_error', 'None')}")
        
        # Force the light to be on and apply display mode.
        # Reset _fx_mode_is_direct so _apply_impl calls ensure_fx_ready()
        # to re-establish FX mode via raw TCP.
        target_entity._is_on = True
        target_entity._fx_mode_is_direct = False
        _LOGGER.debug("[TEST] About to call async_apply_display_mode...")
        await target_entity.async_apply_display_mode(update_type='color_change')
        _LOGGER.debug("[TEST] Display mode applied")
        
        # Report final connection status
        _LOGGER.debug(f"[TEST] After apply - connection_error: {getattr(target_entity, '_connection_error', False)}")

    hass.services.async_register(
        DOMAIN,
        "test_display",
        handle_test_display,
        schema=vol.Schema({
            vol.Optional("entity_id", description="Target specific cube entity. If not provided, uses default entity."): _entity_id_or_list,
        }),
        supports_response=False
    )
    
    async def handle_set_preview_adjustments(service_call):
        """Set color adjustment values for the lamp (all effects). Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_PREVIEW_ADJUSTMENTS")
        if not targets:
            return

        # Extract raw data once (defaults are per-entity, applied inside _apply_one)
        data = service_call.data

        async def _apply_one(target_entity):
            hue_shift = data.get("hue_shift", target_entity._preview_hue_shift)
            temperature = data.get("temperature", target_entity._preview_temperature)
            saturation = data.get("saturation", target_entity._preview_saturation)
            vibrance = data.get("vibrance", target_entity._preview_vibrance)
            contrast = data.get("contrast", target_entity._preview_contrast)
            glow = data.get("glow", target_entity._preview_glow)
            grayscale = data.get("grayscale", target_entity._preview_grayscale)
            invert = data.get("invert", target_entity._preview_invert)
            tint_hue = data.get("tint_hue", target_entity._preview_tint_hue)
            tint_strength = data.get("tint_strength", target_entity._preview_tint_strength)
            # Validate ranges
            hue_shift = max(-180, min(180, int(hue_shift)))
            temperature = max(-100, min(100, int(temperature)))
            saturation = max(0, min(200, int(saturation)))
            vibrance = max(0, min(200, int(vibrance)))
            contrast = max(0, min(200, int(contrast)))
            glow = max(0, min(100, int(glow)))
            grayscale = max(0, min(100, int(grayscale)))
            invert = max(0, min(100, int(invert)))
            tint_hue = max(0, min(360, int(tint_hue)))
            tint_strength = max(0, min(100, int(tint_strength)))
            # Update entity values
            target_entity._preview_hue_shift = hue_shift
            target_entity._preview_temperature = temperature
            target_entity._preview_saturation = saturation
            target_entity._preview_vibrance = vibrance
            target_entity._preview_contrast = contrast
            target_entity._preview_glow = glow
            target_entity._preview_grayscale = grayscale
            target_entity._preview_invert = invert
            target_entity._preview_tint_hue = tint_hue
            target_entity._preview_tint_strength = tint_strength
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            for entity in target_entity._preview_number_entities.values():
                entity.async_update_from_light()
            hass.async_create_task(target_entity.async_apply_display_mode())

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_preview_adjustments",
        handle_set_preview_adjustments,
        schema=vol.Schema({
            vol.Optional("darken", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("brighten", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("saturation", default=100): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("hue_shift", default=0): vol.All(vol.Coerce(int), vol.Range(min=-180, max=180)),
            vol.Optional("contrast", default=100): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("temperature", default=0): vol.All(vol.Coerce(int), vol.Range(min=-100, max=100)),
            vol.Optional("vibrance", default=100): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("grayscale", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("invert", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("glow", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("tint_hue", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=360)),
            vol.Optional("tint_strength", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("entity_id"): _entity_id_or_list,
        })
    )
    
    async def handle_force_refresh(service_call):
        """Force refresh using raw TCP connections (bypasses persistent socket).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "FORCE_REFRESH")
        if not targets:
            return

        _fire_and_forget(*[t.async_force_refresh() for t in targets])
            
    hass.services.async_register(
        DOMAIN,
        "force_refresh",
        handle_force_refresh,
        schema=vol.Schema({
            vol.Optional("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_color_accuracy(service_call):
        """Toggle hardware colour accuracy correction (per-channel gain).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_COLOR_ACCURACY")
        if not targets:
            return

        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity._color_accuracy_enabled = enabled
            _LOGGER.debug(
                f"[COLOR_ACCURACY] [{target_entity._ip}] "
                f"Color accuracy {'enabled' if enabled else 'disabled'}"
            )
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            # Re-render the display with correction applied/removed
            hass.async_create_task(target_entity.async_apply_display_mode())

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_color_accuracy",
        handle_set_color_accuracy,
        schema=vol.Schema({
            vol.Required("enabled"): vol.Coerce(bool),
            vol.Optional("entity_id"): _entity_id_or_list,
        })
    )

    # ── DEBUG: Color calibration service ─────────────────────────────
    async def handle_set_color_calibration(service_call):
        """Set color correction / accuracy calibration values at runtime.
        All fields are optional — only provided values are updated."""
        targets = _resolve_entities(service_call, "SET_COLOR_CALIBRATION")
        if not targets:
            return

        data = service_call.data
        mapping = {
            "gamma_r": "_calib_gamma_r",
            "gamma_g": "_calib_gamma_g",
            "gamma_b": "_calib_gamma_b",
            "hw_threshold": "_calib_hw_threshold",
            "hw_full": "_calib_hw_full",
            "channel_balance": "_calib_channel_balance",
            "gain_r": "_calib_gain_r",
            "gain_g": "_calib_gain_g",
            "gain_b": "_calib_gain_b",
            # System 3: Brightness curve
            "brightness_transition": "_calib_brightness_transition",
            "min_hw_brightness": "_calib_min_hw_brightness",
            "max_hw_brightness": "_calib_max_hw_brightness",
            "max_darken": "_calib_max_darken",
            "min_darken": "_calib_min_darken",
            "dark_at_20": "_calib_dark_at_20",
            "dark_at_50": "_calib_dark_at_50",
            "dark_at_80": "_calib_dark_at_80",
            "low_min_darken": "_calib_low_min_darken",
        }

        async def _apply_one(target_entity):
            changed = []
            for key, attr in mapping.items():
                if key in data:
                    old_val = getattr(target_entity, attr)
                    new_val = data[key]
                    setattr(target_entity, attr, new_val)
                    changed.append(f"{key}: {old_val} → {new_val}")
            if changed:
                _LOGGER.info(
                    f"[CALIBRATION] [{target_entity._ip}] Updated: {', '.join(changed)}"
                )
                if target_entity.hass is not None:
                    target_entity.async_schedule_update_ha_state()
                # Re-render so new calibration takes effect immediately
                hass.async_create_task(target_entity.async_apply_display_mode())

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_color_calibration",
        handle_set_color_calibration,
        schema=vol.Schema({
            vol.Optional("gamma_r"): vol.Coerce(float),
            vol.Optional("gamma_g"): vol.Coerce(float),
            vol.Optional("gamma_b"): vol.Coerce(float),
            vol.Optional("hw_threshold"): vol.Coerce(int),
            vol.Optional("hw_full"): vol.Coerce(int),
            vol.Optional("channel_balance"): vol.Coerce(float),
            vol.Optional("gain_r"): vol.Coerce(float),
            vol.Optional("gain_g"): vol.Coerce(float),
            vol.Optional("gain_b"): vol.Coerce(float),
            # System 3: Brightness curve
            vol.Optional("brightness_transition"): vol.Coerce(int),
            vol.Optional("min_hw_brightness"): vol.Coerce(int),
            vol.Optional("max_hw_brightness"): vol.Coerce(int),
            vol.Optional("max_darken"): vol.Coerce(int),
            vol.Optional("min_darken"): vol.Coerce(int),
            vol.Optional("dark_at_20"): vol.Coerce(int),
            vol.Optional("dark_at_50"): vol.Coerce(int),
            vol.Optional("dark_at_80"): vol.Coerce(int),
            vol.Optional("low_min_darken"): vol.Coerce(int),
            vol.Optional("entity_id"): _entity_id_or_list,
        })
    )
    # ─────────────────────────────────────────────────────────────────
    
    return True
