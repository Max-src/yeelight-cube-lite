"""Discovery support for Yeelight Cube devices."""
import logging
from .const import DOMAIN, DEFAULT_CUBE_MODELS, CUBE_NAME_PATTERNS

_LOGGER = logging.getLogger(__name__)

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
        "yeelight" in name_lower and any(cube_word in name_lower for cube_word in ["cube", "matrix", "panel"]),
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
        _LOGGER.info(f"Device identified as cube/matrix device - Model: '{device_model}', Name: '{device_name}', ID: '{device_id}'")
    
    return is_cube