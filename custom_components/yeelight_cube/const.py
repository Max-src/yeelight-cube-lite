DOMAIN = "yeelight_cube"
CONF_IP = "Light IP Address"
CONF_DEVICE_ID = "device_id"

# Configuration for preventing conflicts with built-in yeelight integration
CONF_MANAGED_DEVICES = "managed_devices"
CONF_PREVENT_DISCOVERY = "prevent_discovery"

# Native clock definitions recovered from the Yeelight Station app.
# Each entry maps the app's clock style ID to the effect segment parameters
# used by the Cube Lite firmware.
NATIVE_CLOCK_EFFECT_ID = 40
# The Station app uses apply=2 for the clock renderer. apply=4 is reserved for
# regular preset animations and leaves mode 40 selected without activating it.
NATIVE_CLOCK_APPLY = 2
# Clock styles. Entries with ``mixer`` use a firmware gradient/palette;
# entries with ``color`` use a single ARGB integer (e.g. 0x01FFEE00).
# The user can override the color on any style by setting ``_native_clock_color``;
# when unset, the style's own color (if any) is used.
NATIVE_CLOCK_STYLES = {
    1: {"name": "Rainbow Gradient", "mixer": 39},
    2: {"name": "Aqua", "mixer": 42},
    3: {"name": "Four Color Gradient", "mixer": 17},
    4: {"name": "White", "mixer": 0, "color": 33554430},
    5: {"name": "Mint", "mixer": 0, "color": 261958},
    6: {"name": "Yellow", "mixer": 0, "color": 33553920},
    7: {"name": "Pink", "mixer": 0, "color": 33447330},
    8: {"name": "Red", "mixer": 0, "color": 33423360},
    9: {"name": "Cyan", "mixer": 0, "color": 12046834},
    10: {"name": "Purple", "mixer": 0, "color": 16263678},
    11: {"name": "Sunset", "mixer": 54},
    12: {"name": "Blue Yellow", "mixer": 57},
    13: {"name": "Blue White", "mixer": 59},
    14: {"name": "Ice Blue", "mixer": 58},
}
DEFAULT_NATIVE_CLOCK_STYLE = 6

# Clock styles whose firmware ``mixer`` is a standalone native effect. For
# these the lamp runs that effect across the whole panel and lets its colour
# through only on the lit time/date pixels (everything else stays black), so
# the characters animate with the effect. The preview reproduces this by
# rendering the effect and masking it to the glyph pixels. The remaining
# Mixers without a dedicated software renderer keep a static gradient
# approximation.
CLOCK_MIXER_EFFECTS = {
    39: "Rainbow",
    42: "Ocean Waves",
    17: "Spectrum",
    57: "Blue Yellow",
    58: "Ice Blue",
    59: "Blue White",
}
# The clock command carries no direction/speed for the mixer; "Down" gives the
# horizontal colour sweep across the characters the lamp shows, 50 is neutral.
CLOCK_MIXER_EFFECT_DIRECTION = "Down"
CLOCK_MIXER_EFFECT_SPEED = 50

# Clock content mode -> data byte 0 of the clock payload:
#   1 = time only, 2 = alternate time+date, 3 = date only
# (byte0 == 0 blanks the panel; 4+ are unused/no-op on current firmware.)
NATIVE_CLOCK_CONTENT_BYTE = {"time": 1, "time_date": 2, "date": 3}
DEFAULT_NATIVE_CLOCK_CONTENT = "time"
# Ordered options + display labels for the Clock Content select entity.
NATIVE_CLOCK_CONTENT_OPTIONS = ("time", "time_date", "date")
NATIVE_CLOCK_CONTENT_LABELS = {
    "time": "Time",
    "time_date": "Time & Date",
    "date": "Date",
}

# Native animation definitions recovered from the Yeelight Station app's
# Cube Lite device configuration. ``mode`` is the firmware renderer while
# ``effect_id`` selects the effect family. The four app-level GIF effects
# (Winter, Dream, Halloween, and Moonlight) are intentionally omitted: they
# require the Matter-only sendGifDataFragment command before activation and
# cannot be selected correctly through the private LAN protocol.
NATIVE_EFFECT_APPLY = 4
NATIVE_EFFECT_DIRECTIONS = ("Up", "Down", "Left", "Right")
NATIVE_EFFECT_DIRECTION_VALUES = {
    "Up": 0,
    "Down": 1,
    "Left": 2,
    "Right": 3,
}
# Some effects render a direction differently than the firmware's nominal
# direction value. A ``direction_remap`` translates the user-facing direction
# label to the value actually sent to the lamp, so the physical animation
# matches the on-screen arrow / preview. Verified on real hardware.
_SWAP_UP_DOWN = {"Up": "Down", "Down": "Up"}

NATIVE_EFFECTS = {
    "Streamer": {"effect_id": 3, "mode": 3, "speed": True},
    "Starry sky": {"effect_id": 5, "mode": 5, "speed": True, "color": 255},
    "Spectrum": {"effect_id": 17, "mode": 17, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Ocean Waves": {"effect_id": 42, "mode": 42, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Rainbow": {"effect_id": 39, "mode": 39, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Waterfall": {"effect_id": 32, "mode": 32, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN, "color": 255},
    "Aurora": {"effect_id": 15, "mode": 15, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "color": 16842496},
    "Bonfire": {"effect_id": 34, "mode": 34, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": {"Right": "Down", "Down": "Right", "Left": "Up", "Up": "Left"}},
    "Pinball": {"effect_id": 37, "mode": 37, "speed": True},
    "Shooting Star": {"effect_id": 47, "mode": 47, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Tide": {"effect_id": 48, "mode": 48, "speed": True},
    "Building block": {"effect_id": 49, "mode": 49, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN, "color": 16777471},
    "Hacking": {"effect_id": 46, "mode": 46, "speed": True, "directions": ("Up", "Down")},
    "Flower Sea": {"effect_id": 91, "mode": 55, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Magic": {"effect_id": 92, "mode": 75, "speed": True},
    "Wonderland": {"effect_id": 94, "mode": 77, "speed": True},
    "Kaleidoscope": {"effect_id": 95, "mode": 80, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Palette": {"effect_id": 96, "mode": 81, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
}
DEFAULT_NATIVE_EFFECT = "Streamer"

# "Extended" native effects: firmware animation ``mode`` values that exist in
# the Cube Lite hardware but were never exposed as selectable effects in the
# official Yeelight app. Reached by sending effect_id 3 with the mode, e.g.
# [3, 0, 4, {"mode": 58, "onoff": 1, "rate": 50, "direction": 2}] (the
# full-panel form of the clock gradient mixer 58). We expose every mode in the
# 1-99 range that isn't already an official effect (or the clock renderer);
# names are placeholders (the mode number) until renamed. Hidden behind the
# "Experimental Features" switch.
_OFFICIAL_EFFECT_MODES = {spec["mode"] for spec in NATIVE_EFFECTS.values()} | {
    NATIVE_CLOCK_EFFECT_ID
}
# Named extended effects; every other slot keeps its mode number as a
# placeholder name. These four are the full-panel form of the clock gradient
# mixers 54/57/58/59 and share the clock styles' names.
_EXTENDED_EFFECT_NAMES = {
    54: "Sunset",
    57: "Blue Yellow",
    58: "Ice Blue",
    59: "Blue White",
}
EXTENDED_NATIVE_EFFECTS = {
    _EXTENDED_EFFECT_NAMES.get(mode, str(mode)): {
        "effect_id": 3,
        "mode": mode,
        "speed": True,
        "directions": NATIVE_EFFECT_DIRECTIONS,
        "extended": True,
    }
    for mode in range(1, 100)
    if mode not in _OFFICIAL_EFFECT_MODES
}

# All selectable native effects (official + extended). Spec lookups (activation,
# direction, speed) use this so a selected extended effect resolves; the select
# entity decides which names are actually offered based on the switch.
ALL_NATIVE_EFFECTS = {**NATIVE_EFFECTS, **EXTENDED_NATIVE_EFFECTS}

# Device-microphone music flow definitions recovered from the Yeelight app.
# The protocol deliberately spells palette as ``palatte`` in the JSON payload.
MUSIC_FLOW_EFFECTS = {
    "Gather": 83,
    "Breathing": 84,
    "Blossom": 85,
    "Spectrum": 86,
    "Music Note": 87,
    "Impact": 88,
}
MUSIC_FLOW_EFFECT_IDS = {
    effect_id: name for name, effect_id in MUSIC_FLOW_EFFECTS.items()
}
DEFAULT_MUSIC_FLOW_EFFECT = "Breathing"
MUSIC_FLOW_DEFAULT_PALETTE = (
    0xFFFF3B30,
    0xFFFF6B35,
    0xFFFF9500,
    0xFFFFCC00,
    0xFFB7F321,
    0xFF34C759,
    0xFF00C7BE,
    0xFF32ADE6,
    0xFF0A84FF,
    0xFF5E5CE6,
    0xFF7D5FFF,
    0xFFAF52DE,
    0xFFFF2D55,
    0xFFFF375F,
    0xFFFF6B8A,
    0xFFFFFFFF,
)

# Legacy native-effect names -> current (official Yeelight app) names.  Applied
# when restoring saved state so lamps set to an old name keep working.
NATIVE_EFFECT_RENAMES = {
    "Ribbon": "Streamer",
    "Starry Sky": "Starry sky",
    "Waves": "Ocean Waves",
    "Fire": "Bonfire",
    "Bouncing Ball": "Pinball",
    "Meteor": "Shooting Star",
    "Building Blocks": "Building block",
}

POWER_ON_STATES = {"Off": 0, "On": 1, "Toggle": 2}

# Content sources and matrix render modes are intentionally separate. Clock is
# a native firmware experience; the remaining modes render the plugin's 20x5
# matrix content.
CONTENT_MODES = ("Matrix", "Clock", "Native Effect", "Music Flow")
MATRIX_DISPLAY_MODES = (
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
)
DEFAULT_MATRIX_DISPLAY_MODE = "Solid Color"

# Matrix display modes that render text/gradients (everything MATRIX_DISPLAY_MODES
# offers EXCEPT "Custom Draw", which is pixel-art with its own render branch).
# Used to normalise a stale non-text mode back to a valid text mode so the text
# renderer never falls through all branches and blanks the panel.
TEXT_RENDER_MODES = tuple(m for m in MATRIX_DISPLAY_MODES if m != "Custom Draw")

# Legacy 2-way content flip (kept for saved-state migration and the matrix/pixel
# 180° flip). The 4-way DEVICE_ORIENTATIONS map onto these two values.
ORIENTATION_NORMAL = "normal"
ORIENTATION_FLIPPED = "flipped"

# When full_panel is on, the text is replaced by this single sentinel character
# whose glyph covers the entire 5x20 display (all 100 pixels), so every render
# mode can treat it as one "giant letter" with no special-case branch.
PANEL_FULL_CHAR = "\uFFFF"

# Default device models that should be handled by this component
# NOTE: Yeelight CubeLite models use "clt" prefix in their mDNS model name
# e.g. model="yeelink.light.clt6pro", service name="yeelink-light-clt6pro-0x..."
DEFAULT_CUBE_MODELS = [
    "cubelite",
    "cube-lite",
    "yeelight-cube",
    "yeelight-cubelite",
    "cube lite",
    "clt",       # CubeLite model prefix (clt6pro, clt4, etc.)
    "matrix",
    "panel",     # In case there are panel variations
]

# Additional patterns for device name detection
CUBE_NAME_PATTERNS = [
    "cubelite",
    "cube-lite",
    "cube lite",
    "yeelight cube",
    "yeelink cube",  # mDNS uses "yeelink" not "yeelight"
    "clt",            # CubeLite model prefix in service names
    "matrix",
    "panel",
]
