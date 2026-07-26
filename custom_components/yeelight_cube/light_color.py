"""Colour pipeline for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin to keep the entity class focused.  These
methods are pure colour math plus hardware colour-correction/accuracy: they only
read per-instance state via ``self`` (initialised in ``YeelightCubeLight.__init__``
and the calibration attributes) and the matrix geometry constants imported below.
Mixed into ``YeelightCubeLight``; not usable on its own.
"""
import colorsys
import logging
import math
from typing import Tuple

from .layout import TOTAL_COLUMNS, TOTAL_ROWS

_LOGGER = logging.getLogger(__name__)


class ColorPipelineMixin:
    """Colour adjustment, LED correction/accuracy and the brightness curve.

    All state is read from ``self`` (the concrete :class:`YeelightCubeLight`),
    e.g. ``self._preview_*`` adjustment values and ``self._calib_*`` calibration
    knobs, so this class is only ever used as a mixin.
    """

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
            # Use floor() to avoid rounding up, then ensure non-zero channels stay alive.
            # Each channel has its own minimum lit value (calibrated): a channel that
            # is intended to be on never drops below its floor, so dim colours keep
            # their hue instead of crushing channels that the LED can't render low.
            floor_r = max(1, int(getattr(self, '_calib_floor_r', 1)))
            floor_g = max(1, int(getattr(self, '_calib_floor_g', 1)))
            floor_b = max(1, int(getattr(self, '_calib_floor_b', 1)))
            r = max(floor_r, math.floor(r * darken_factor)) if r > 0 else 0
            g = max(floor_g, math.floor(g * darken_factor)) if g > 0 else 0
            b = max(floor_b, math.floor(b * darken_factor)) if b > 0 else 0
            
            # Log darken effect for debugging (reduced to debug level to avoid spam)
            _LOGGER.debug(f"[FINAL BRIGHTNESS] RGB{original_rgb} -> darken {self._preview_darken}% -> RGB({r}, {g}, {b})")
        
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
        
        TUNING PARAMETERS - adjust these if colours still look off:
        -------------------------------------------------------------------

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

        GAMMA_B           (default 0.62)
            Blue channel gamma.  Lowest value because blue LEDs need the
            most help.  If blues are still too dark, try 0.50-0.55.
            If blues are over-boosted, try 0.70-0.80.
        """
        r, g, b = rgb_color
        if r == 0 and g == 0 and b == 0:
            return (0, 0, 0)

        # Tuning knobs (read from instance for runtime calibration)
        HW_BRIGHT_THRESHOLD = self._calib_hw_threshold
        HW_BRIGHT_FULL      = self._calib_hw_full
        GAMMA_R             = self._calib_gamma_r
        GAMMA_G             = self._calib_gamma_g
        GAMMA_B             = self._calib_gamma_b

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
        #    (ramps 0->1 as effective drops from threshold->full)
        #
        # 2. hw_damping: keeps VISUAL IMPACT of correction constant across
        #    brightness levels.  A pixel boost of delta produces visible change
        #    proportional to delta x hw/100.  At hw=4% (1% user), even a large delta
        #    is invisible.  At hw=96% (24% user), even small delta washes colors.
        #
        #    hw_damping = HW_FULL / hw  (capped at 1.0)
        #    This ensures:  delta x hw x (HW_FULL/hw) = delta x HW_FULL = constant.
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

        # HYBRID LUMINANCE + CHANNEL-BALANCE scaling
        # Pure per-channel gamma (R=0.85, G=0.75, B=0.62) destroys hue:
        #   pink (10,3,6) -> (16,9,22) = massive shift pink->purple!
        #   white (10,10,10) -> (16,19,22) = blue tint
        #
        # Pure uniform luminance scaling preserves hue perfectly but
        # CANNOT compensate for physical per-channel LED non-linearity
        # (blue LEDs have higher forward voltage -> less output at low duty).
        # Result: whites look brown/orange, blues look grayish.
        #
        # HYBRID approach: blend between uniform and per-channel.
        #   channel_balance = 0.0 -> pure uniform (perfect hue, no blue fix)
        #   channel_balance = 1.0 -> pure per-channel (blue fixed, hue shifts)
        #   channel_balance = 0.5 -> 50/50 blend (moderate blue boost, mild shift)
        #
        # At 0.5 default:
        #   white (10,10,10) -> ~(17,18,20): subtle blue boost -> neutral on LED
        #   pink  (10,3,6)  -> keeps pink character with modest blue nudge
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

          - Yellow (#ffff00) shifts greenish   -> green LED is too efficient
          - Cyan   (#00ffff) shifts greenish   -> green dominates blue in mixes
          - White  (#ffffff) not perfectly neutral -> green tint
          - Blues / purples / oranges appear "lighter" / washed -> G & B LEDs
            contribute more perceived brightness than expected
          - Pure red and magenta look correct  -> red channel is accurate

        HOW IT WORKS:
        Per-channel gain multiplier blended toward 1.0 (neutral) at low
        brightness.  The blend factor is derived from self._brightness
        (1--255, HA brightness).

        Pipeline order:  colour effects -> brightness darken ->
                         _apply_color_correction (low-brightness gamma) ->
                         * _apply_color_accuracy (this, channel gain) * ->
                         encode & send to lamp

        The preview card is NOT affected -- it always shows the original
        intended colours.

        TUNING PARAMETERS - adjust these to match YOUR lamp:
        -------------------------------------------------------------------

        GAIN_R  (default 1.00)
            Red channel multiplier.  1.0 = unchanged.
            Red looks correct on this lamp, so leave at 1.0.
            If reds look too bright, try 0.95.  Too dim, try 1.05.

        GAIN_G  (default 0.87)
            Green channel multiplier.  Reduced because the green LED is
            over-efficient, causing yellows/cyans/whites to shift green.
            If still too green, try 0.80--0.85.
            If colours look too pink/magenta, raise to 0.90--0.94.

        GAIN_B  (default 0.72)
            Blue channel multiplier.  Reduced for deeper blues
            and to prevent mid-range colours from looking washed out.
            If blues are too dark, raise to 0.80--0.90.
            If blues still look washed, lower to 0.65-0.70.
        """
        if not self._color_accuracy_enabled:
            return rgb_color

        r, g, b = rgb_color
        if r == 0 and g == 0 and b == 0:
            return (0, 0, 0)

        # Tuning knobs (read from instance for runtime calibration)
        GAIN_R = self._calib_gain_r
        GAIN_G = self._calib_gain_g
        GAIN_B = self._calib_gain_b

        # Brightness-based fade
        # Blend gains toward 1.0 (neutral) as brightness decreases.
        # At brightness 255 -> factor = 1.0 (full correction)
        # At brightness   1 -> factor ~= 0.0 (no correction)
        brightness = max(1, min(255, getattr(self, '_brightness', 255)))
        factor = (brightness - 1) / 254  # 0.0 .. 1.0

        GAIN_R = 1.0 + (GAIN_R - 1.0) * factor
        GAIN_G = 1.0 + (GAIN_G - 1.0) * factor
        GAIN_B = 1.0 + (GAIN_B - 1.0) * factor

        r_out = min(255, round(r * GAIN_R))
        g_out = min(255, round(g * GAIN_G))
        b_out = min(255, round(b * GAIN_B))

        return (r_out, g_out, b_out)

    def _calculate_brightness_values(self, user_brightness: int) -> Tuple[int, int]:
        """
        Calculate hardware brightness and darkness percentage from user brightness.

        UNIFIED CURVE MODEL (no transition / breaking point):
        Both hardware dimming and per-pixel RGB darkening move together across the
        whole slider. With p = user% / 100:

            hardware_keep = hw_floor + (1 - hw_floor) * p ** hw_curve
            rgb_keep      = (1 - darken_floor) + darken_floor * p ** darken_curve
            darken_percent = 100 * (1 - rgb_keep) = darken_floor*100 * (1 - p**darken_curve)

        At p=0 the lamp sits at (hw_floor, darken_floor) -> dimmest night level;
        at p=1 it reaches (100%, 0% darken) -> full output. The product of the two
        smooth monotonic curves gives a regular brightness ramp with no mid-range
        irregularity.

        Args:
            user_brightness: Home Assistant brightness value (1-255)

        Returns:
            tuple: (hardware_brightness_percent, darken_percent)
                - hardware_brightness_percent: 1-100 (Yeelight hardware brightness)
                - darken_percent: 0-100 (RGB darkening amount)
        """
        # Clamp to valid range, convert HA brightness (1-255) to fraction p (0-1)
        user_brightness = max(1, min(255, user_brightness))
        p = user_brightness / 255.0

        # Tuning knobs (runtime-tunable). Convert percents to 0-1 fractions.
        hw_floor = max(0.0, min(1.0, self._calib_hw_floor / 100.0))
        darken_floor = max(0.0, min(1.0, self._calib_darken_floor / 100.0))
        hw_curve = max(0.05, self._calib_hw_curve)
        darken_curve = max(0.05, self._calib_darken_curve)

        # Hardware brightness: floor -> 100%, shaped so it rises fast then flattens.
        hardware_keep = hw_floor + (1.0 - hw_floor) * (p ** hw_curve)
        hardware_brightness = int(round(max(1, min(100, hardware_keep * 100.0))))

        # RGB darkening: darken_floor at p=0 down to 0 at p=1.
        darken_percent = darken_floor * 100.0 * (1.0 - (p ** darken_curve))
        darken_percent = int(round(max(0, min(100, darken_percent))))

        _LOGGER.debug(
            f"[BRIGHTNESS] unified: user={p*100:.1f}% -> "
            f"hardware={hardware_brightness}%, darkness={darken_percent}%"
        )

        return (hardware_brightness, darken_percent)
