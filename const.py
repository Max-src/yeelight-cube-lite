DOMAIN = "yeelight_cube"
CONF_IP = "Light IP Address"
CONF_DEVICE_ID = "device_id"

# Configuration for preventing conflicts with built-in yeelight integration
CONF_MANAGED_DEVICES = "managed_devices"
CONF_PREVENT_DISCOVERY = "prevent_discovery"

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