"""Native-effect orientation table (calibration source of truth).

Per-effect, per-firmware-direction correction so the SOFTWARE previews (camera
+ JS cards) match the physical lamp. Mirrors www/effect-orientation.js exactly.

Model (display space, flags identical in raw space): for firmware direction T,
render the RAW frame for ``source`` then reverse rows iff ``flip_v`` and reverse
columns iff ``flip_h``. ``clock`` is the fixed firmware direction the effect's
clock-style background uses.

Only non-default effects are listed; anything absent is identity (source = the
requested direction, no flips) with clock direction "Down".

CRITICAL — the firmware direction_remap is the ground truth (do NOT remove it):
This table was calibrated against the lamp AS DRIVEN BY THE EXISTING send path,
which applies const.py ``direction_remap`` / ``resolve_clock_mixer_direction``
so the lamp's physical flow matches the arrow. These previews correct on TOP of
that. If you ever delete the send-side remap, the lamp's up/down flips for the
_SWAP_UP_DOWN effects (Ocean Waves, Rainbow, Spectrum, Waterfall, Shooting Star,
Building block, Kaleidoscope) and EVERY calibrated preview here becomes inverted.
Correct previews by editing THIS table, never by changing what is sent to the lamp.
"""

COLS = 20
ROWS = 5

# effect -> {"clock": dir, "dirs": {firmware_dir: (source_dir, flip_h, flip_v)}}
# Shared rotation maps (no flips), reused by several effects.
_ROT_B = {
    "Up": ("Right", False, False),
    "Down": ("Left", False, False),
    "Left": ("Up", False, False),
    "Right": ("Down", False, False),
}
_ROT_C = {
    "Up": ("Left", False, False),
    "Down": ("Right", False, False),
    "Left": ("Down", False, False),
    "Right": ("Up", False, False),
}
_ROT_D = {
    "Up": ("Left", False, False),
    "Down": ("Right", False, False),
    "Left": ("Up", False, False),
    "Right": ("Down", False, False),
}
EFFECT_ORIENTATION = {
    "Spectrum": {
        "clock": "Left",
        "dirs": {
            "Up": ("Right", True, True),
            "Down": ("Left", True, True),
            "Left": ("Down", False, False),
            "Right": ("Up", False, False),
        },
    },
    "Ocean Waves": {
        "clock": "Left",
        "dirs": {
            "Up": ("Up", False, True),
            "Down": ("Down", False, True),
            "Left": ("Left", True, False),
            "Right": ("Right", True, False),
        },
    },
    "Rainbow": {
        "clock": "Left",
        "dirs": {
            "Up": ("Right", False, True),
            "Down": ("Left", False, True),
            "Left": ("Down", False, False),
            "Right": ("Up", False, False),
        },
    },
    "Waterfall": {
        "clock": "Left",
        "dirs": {
            "Up": ("Right", False, True),
            "Down": ("Left", False, True),
            "Left": ("Down", False, False),
            "Right": ("Up", False, False),
        },
    },
    "Aurora": {
        "clock": "Left",
        "dirs": {
            "Up": ("Up", False, False),
            "Down": ("Down", True, False),
            "Left": ("Left", False, False),
            "Right": ("Right", True, False),
        },
    },
    "Bonfire": {"clock": "Up", "dirs": dict(_ROT_D)},
    "Shooting Star": {"clock": "Down", "dirs": dict(_ROT_C)},
    "Building block": {"clock": "Down", "dirs": dict(_ROT_C)},
    "Hacking": {
        "clock": "Down",
        "dirs": {
            "Up": ("Up", False, False),
            "Down": ("Up", False, False),
            "Left": ("Up", False, False),
            "Right": ("Down", False, False),
        },
    },
    "Flower Sea": {"clock": "Right", "dirs": dict(_ROT_D)},
    "Kaleidoscope": {"clock": "Left", "dirs": {}},
    "Palette": {"clock": "Down", "dirs": dict(_ROT_B)},
    "Carousel": {"clock": "Left", "dirs": dict(_ROT_B)},
    "Blue Yellow": {
        "clock": "Up",
        "dirs": {
            "Up": ("Up", True, True),
            "Down": ("Down", False, False),
            "Left": ("Left", False, False),
            "Right": ("Right", False, False),
        },
    },
    "Blue White": {
        "clock": "Down",
        "dirs": {
            "Up": ("Up", True, True),
            "Down": ("Down", False, False),
            "Left": ("Left", False, False),
            "Right": ("Right", False, False),
        },
    },
    "Rainbow Flow": {"clock": "Left", "dirs": dict(_ROT_B)},
    "Spectrum Chase": {"clock": "Left", "dirs": dict(_ROT_B)},
    "Pastel Pulse": {"clock": "Left", "dirs": dict(_ROT_B)},
    "Fireworks": {
        "clock": "Left",
        "dirs": {
            "Up": ("Up", False, False),
            "Down": ("Down", False, False),
            "Left": ("Left", True, False),
            "Right": ("Right", True, False),
        },
    },
    "Monochrome Waves": {"clock": "Left", "dirs": {}},
    "Pulse": {"clock": "Left", "dirs": dict(_ROT_D)},
    "Solar Flare": {"clock": "Left", "dirs": dict(_ROT_B)},
    "Prism": {
        "clock": "Left",
        "dirs": {
            "Up": ("Up", False, False),
            "Down": ("Down", False, True),
            "Left": ("Right", False, True),
            "Right": ("Right", False, True),
        },
    },
    "Color Trails": {"clock": "Left", "dirs": {}},
    "Spectrum Crumble": {"clock": "Down", "dirs": dict(_ROT_B)},
    "Drift": {"clock": "Left", "dirs": {}},
    "Spectrum Bands": {
        "clock": "Left",
        "dirs": {
            "Up": ("Down", False, False),
            "Down": ("Down", False, False),
            "Left": ("Right", False, False),
            "Right": ("Right", False, False),
        },
    },
}


def effect_orientation(effect: str, direction: str):
    """Return (source, flip_h, flip_v) for an effect + firmware direction."""
    entry = EFFECT_ORIENTATION.get(effect)
    dirs = entry.get("dirs") if entry else None
    d = dirs.get(direction) if dirs else None
    if not d:
        return direction, False, False
    return d[0], bool(d[1]), bool(d[2])


def clock_effect_direction(effect: str) -> str:
    """The fixed firmware direction an effect's clock-style background uses."""
    entry = EFFECT_ORIENTATION.get(effect)
    return entry.get("clock", "Down") if entry else "Down"


def orient_frame(pixels, flip_h: bool, flip_v: bool):
    """Reverse rows (flip_v) and/or columns (flip_h) of a raw 20x5 frame."""
    if not flip_h and not flip_v:
        return pixels
    out = [None] * len(pixels)
    for r in range(ROWS):
        sr = ROWS - 1 - r if flip_v else r
        for c in range(COLS):
            sc = COLS - 1 - c if flip_h else c
            out[r * COLS + c] = pixels[sr * COLS + sc]
    return out
