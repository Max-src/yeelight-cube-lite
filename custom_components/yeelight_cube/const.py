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
NATIVE_CLOCK_APPLY = 4
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

# Content sources and matrix render modes are intentionally separate. Clock is
# a native firmware experience; the remaining modes render the plugin's 20x5
# matrix content.
CONTENT_MODES = ("Matrix", "Clock")
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
