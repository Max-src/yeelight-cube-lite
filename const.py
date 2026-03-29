DOMAIN = "yeelight_cube"
CONF_IP = "Light IP Address"

# Configuration for preventing conflicts with built-in yeelight integration
CONF_MANAGED_DEVICES = "managed_devices"
CONF_PREVENT_DISCOVERY = "prevent_discovery"

# Default device models that should be handled by this component
DEFAULT_CUBE_MODELS = [
    "cubelite",
    "cube-lite", 
    "yeelight-cube",
    "yeelight-cubelite",
    "cube lite",
    "matrix",
    "panel"  # In case there are panel variations
]

# Additional patterns for device name detection
CUBE_NAME_PATTERNS = [
    "cubelite",
    "cube-lite",
    "cube lite", 
    "yeelight cube",
    "matrix",
    "panel"
]