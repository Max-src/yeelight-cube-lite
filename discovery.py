"""Discovery support for Yeelight Cube Lite devices."""
import logging
import re
from .const import DOMAIN, DEFAULT_CUBE_MODELS, CUBE_NAME_PATTERNS

_LOGGER = logging.getLogger(__name__)

# Regex to parse a miio zeroconf service name:
#   yeelink-light-<model>-<id>._miio._udp.local.
_SERVICE_NAME_RE = re.compile(
    r"^(?P<brand>yeelink)-(?P<type>\w+)-(?P<model>[\w]+)-(?P<devid>0x[0-9a-fA-F]+)"
)


def parse_service_name(name: str) -> dict:
    """Extract brand, type, model, and device ID from a miio service name."""
    m = _SERVICE_NAME_RE.match(name)
    if m:
        return m.groupdict()
    return {}


def is_cube_device(device_model: str, device_name: str, device_id: str = "") -> bool:
    """Check if a device should be handled by this component based on various criteria."""
    
    # Convert to lowercase for case-insensitive matching
    model_lower = device_model.lower()
    name_lower = device_name.lower()
    id_lower = device_id.lower()
    
    # Check model name patterns
    model_match = any(pattern in model_lower for pattern in DEFAULT_CUBE_MODELS)
    
    # Check device name patterns
    name_match = any(pattern in name_lower for pattern in CUBE_NAME_PATTERNS)
    
    # Check for specific Yeelight cube indicators
    yeelight_cube_indicators = [
        # mDNS uses "yeelink" (not "yeelight")
        ("yeelight" in name_lower or "yeelink" in name_lower)
        and any(cube_word in name_lower for cube_word in ["cube", "clt", "matrix", "panel"]),
        name_lower.startswith("cubelite"),
        "ylxd" in id_lower,  # Common Yeelight device ID prefix for cube models
    ]
    
    # Additional heuristics for matrix/panel devices
    matrix_indicators = [
        "matrix" in model_lower or "matrix" in name_lower,
        "panel" in model_lower or "panel" in name_lower,
        # Check for grid-like dimensions that suggest a matrix device
        any(dim in name_lower for dim in ["16x16", "8x8", "32x32", "64x64"]),
    ]
    
    is_cube = model_match or name_match or any(yeelight_cube_indicators) or any(matrix_indicators)
    
    if is_cube:
        _LOGGER.debug(
            "Device identified as cube/matrix device - Model: '%s', Name: '%s', ID: '%s'",
            device_model, device_name, device_id,
        )
    else:
        _LOGGER.debug(
            "Device NOT identified as cube - Model: '%s', Name: '%s', ID: '%s'",
            device_model, device_name, device_id,
        )
    
    return is_cube