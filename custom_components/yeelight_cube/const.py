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
    11: {"name": "Sunset Gradient", "mixer": 54},
    12: {"name": "Blue Yellow", "mixer": 57},
    13: {"name": "Blue White Fade", "mixer": 59},
    14: {"name": "Ice Blue Gradient", "mixer": 58},
}
DEFAULT_NATIVE_CLOCK_STYLE = 6

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
NATIVE_EFFECTS = {
    "Streamer": {"effect_id": 3, "mode": 3, "speed": True},
    "Starry sky": {"effect_id": 5, "mode": 5, "speed": True, "color": 255},
    "Spectrum": {"effect_id": 17, "mode": 17, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Ocean Waves": {"effect_id": 42, "mode": 42, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Rainbow": {"effect_id": 39, "mode": 39, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Waterfall": {"effect_id": 32, "mode": 32, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "color": 255},
    "Aurora": {"effect_id": 15, "mode": 15, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "color": 16842496},
    "Bonfire": {"effect_id": 34, "mode": 34, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Pinball": {"effect_id": 37, "mode": 37, "speed": True},
    "Shooting Star": {"effect_id": 47, "mode": 47, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Tide": {"effect_id": 48, "mode": 48, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Building block": {"effect_id": 49, "mode": 49, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "color": 16777471},
    "Hacking": {"effect_id": 46, "mode": 46, "speed": True, "directions": ("Up", "Down")},
    "Flower Sea": {"effect_id": 91, "mode": 55, "speed": False, "rate": 100, "direction_fixed": 2},
    "Magic": {"effect_id": 92, "mode": 75, "speed": False, "rate": 50, "direction_fixed": 2},
    "Wonderland": {"effect_id": 94, "mode": 77, "speed": False, "rate": 50, "direction_fixed": 2},
    "Kaleidoscope": {"effect_id": 95, "mode": 80, "speed": False, "rate": 50, "direction_fixed": 2},
    "Palette": {"effect_id": 96, "mode": 81, "speed": False, "rate": 50, "direction_fixed": 2},
}
DEFAULT_NATIVE_EFFECT = "Streamer"

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
CONTENT_MODES = ("Matrix", "Clock", "Native Effect")
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
