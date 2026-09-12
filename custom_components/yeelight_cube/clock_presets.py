"""Validation for the shared solid-colour clock library."""

from uuid import uuid4


def save_clock_preset(presets, name, color, builtin_names, preset_id=None):
    name = " ".join(str(name).split())
    if not name or len(name) > 40:
        raise ValueError("Name must contain 1 to 40 characters")
    if any(ord(char) < 32 or char in "<>" for char in name):
        raise ValueError("Name contains unsupported characters")
    if name.casefold() in {item.casefold() for item in builtin_names}:
        raise ValueError("Choose a name different from a built-in clock style")
    if not isinstance(color, (list, tuple)) or len(color) != 3 or any(
        type(channel) is not int or not 0 <= channel <= 255 for channel in color
    ):
        raise ValueError("Colour must contain three integers between 0 and 255")
    if preset_id and not any(item["id"] == preset_id for item in presets):
        raise ValueError("This preset no longer exists")
    if any(item["id"] != preset_id and item["name"].casefold() == name.casefold() for item in presets):
        raise ValueError("A clock preset already uses this name")
    if any(item["id"] != preset_id and item["color"] == list(color) for item in presets):
        raise ValueError("A clock preset already uses this colour")
    if not preset_id and len(presets) >= 100:
        raise ValueError("The clock library is limited to 100 presets")
    item = {"id": preset_id or uuid4().hex, "name": name, "color": list(color)}
    if preset_id:
        return [item if existing["id"] == preset_id else existing for existing in presets]
    return [*presets, item]


def delete_clock_preset(presets, preset_id):
    if not any(item["id"] == preset_id for item in presets):
        raise ValueError("This preset no longer exists")
    return [item for item in presets if item["id"] != preset_id]