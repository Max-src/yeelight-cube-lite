"""The Lamp Preview card's color adjustments (hue shift, temperature,
saturation, vibrance, contrast, glow, grayscale, tint, invert) as pure color
math: what the integration applies to the pixels it sends, and to the
animations it uploads (lamp_animations). www/color-adjustments.js is the same
math for the cards' previews.

``adjustments`` maps a name of ADJUSTMENT_DEFAULTS to its value; a name left
out keeps its default (no change).
"""
from __future__ import annotations

import colorsys

# The light's _preview_<name> values, in the order they apply.
ADJUSTMENT_DEFAULTS = {
    "hue_shift": 0,       # -180 to +180: rotate hue
    "temperature": 0,     # -100 to +100: cool to warm
    "saturation": 100,    # 0-200: 0 = gray, 100 = normal, 200 = hyper
    "vibrance": 100,      # 0-200: smart saturation
    "contrast": 100,      # 0-200: 0 = flat, 100 = normal, 200 = high
    "glow": 0,            # 0-100: boost bright pixels
    "grayscale": 0,       # 0-100: to black and white
    "tint_hue": 0,        # 0-360: tint color hue
    "tint_strength": 0,   # 0-100: tint blend amount
    "invert": 0,          # 0-100: blend with the inverted color
}


def active_adjustments(values: dict) -> dict:
    """The adjustments of ``values`` that change a color: the others left out
    (the tint's hue without its strength too), so that equal looks compare
    equal."""
    active = {
        name: int(values[name])
        for name, default in ADJUSTMENT_DEFAULTS.items()
        if name in values and int(values[name]) != default
    }
    if not active.get("tint_strength"):
        active.pop("tint_hue", None)
    return active


def adjust_color(rgb, adjustments: dict) -> tuple[int, int, int]:
    """``rgb`` with ``adjustments`` applied. Black stays black: it is the
    background, off pixels."""
    r, g, b = rgb
    if r == 0 and g == 0 and b == 0:
        return (0, 0, 0)
    get = adjustments.get

    # Color: hue shift, temperature.
    if hue_shift := get("hue_shift", 0):
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        r, g, b = _rgb(colorsys.hsv_to_rgb((h + hue_shift / 360) % 1.0, s, v))
    if temperature := get("temperature", 0):
        factor = abs(temperature) / 100
        if temperature > 0:  # warm
            r = round(r + (255 - r) * factor * 0.3)
            g = round(g + (255 - g) * factor * 0.1)
            b = round(b * (1 - factor * 0.3))
        else:  # cool
            r = round(r * (1 - factor * 0.3))
            g = round(g * (1 - factor * 0.1))
            b = round(b + (255 - b) * factor * 0.3)

    # Saturation and vibrance.
    if (saturation := get("saturation", 100)) != 100:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        s = max(0, min(1, s * (saturation / 100)))
        r, g, b = _rgb(colorsys.hsv_to_rgb(h, s, v))
    if (vibrance := get("vibrance", 100)) != 100:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s > 0:
            # The less saturated a color, the more vibrance changes it.
            weight = (1 - s) ** 0.5
            s = max(0, min(1, s * (1 + (vibrance / 100 - 1) * weight)))
        r, g, b = _rgb(colorsys.hsv_to_rgb(h, s, v))

    # Tone: contrast, glow.
    if (contrast := get("contrast", 100)) != 100:
        factor = contrast / 100
        r, g, b = (
            max(0, min(255, round(((channel / 255 - 0.5) * factor + 0.5) * 255)))
            for channel in (r, g, b)
        )
    if (glow := get("glow", 0)) > 0:
        luminosity = (r + g + b) / 3
        if luminosity > 127:
            factor = (luminosity / 255) * (glow / 100)
            r = round(r + (255 - r) * factor)
            g = round(g + (255 - g) * factor)
            b = round(b + (255 - b) * factor)

    # Effects: grayscale, tint, invert.
    if (grayscale := get("grayscale", 0)) > 0:
        factor = grayscale / 100
        gray = round(0.299 * r + 0.587 * g + 0.114 * b)
        r, g, b = (
            max(0, min(255, round(channel * (1 - factor) + gray * factor)))
            for channel in (r, g, b)
        )
    if (strength := get("tint_strength", 0)) > 0:
        tint = _rgb(colorsys.hsv_to_rgb(get("tint_hue", 0) / 360, 1.0, 1.0))
        factor = strength / 100
        r, g, b = (
            round(channel * (1 - factor) + tinted * factor)
            for channel, tinted in zip((r, g, b), tint)
        )
    if (invert := get("invert", 0)) > 0:
        factor = invert / 100
        r, g, b = (
            round(channel * (1 - factor) + (255 - channel) * factor)
            for channel in (r, g, b)
        )

    return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))


def _rgb(unit) -> tuple[int, int, int]:
    """A 0-1 color as 0-255 channels."""
    return tuple(round(channel * 255) for channel in unit)
