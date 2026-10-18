"""Validation for the shared solid-color clock library."""

from uuid import uuid4

from .input_error import InputError


def save_clock_preset(presets, name, color, builtin_names, preset_id=None, kind=None):
    existing = next((item for item in presets if item["id"] == preset_id), None)
    if kind is None:
        kind = existing.get("kind", "style") if existing else "style"
    if kind not in {"style", "color_mode"}:
        raise InputError("preset_kind")
    name = " ".join(str(name).split())
    if not name or len(name) > 40:
        raise InputError("preset_name_length")
    if any(ord(char) < 32 or char in "<>" for char in name):
        raise InputError("preset_name_characters")
    if kind == "style" and name.casefold() in {item.casefold() for item in builtin_names}:
        raise InputError("preset_name_builtin")
    if not isinstance(color, (list, tuple)) or len(color) != 3 or any(
        type(channel) is not int or not 0 <= channel <= 255 for channel in color
    ):
        raise InputError("preset_color")
    if preset_id and not any(item["id"] == preset_id for item in presets):
        raise InputError("preset_gone")
    same_kind = [item for item in presets if item.get("kind", "style") == kind]
    if any(item["id"] != preset_id and item["name"].casefold() == name.casefold() for item in same_kind):
        raise InputError("preset_name_taken")
    if not preset_id and len(presets) >= 100:
        raise InputError("preset_limit")
    item = {"id": preset_id or uuid4().hex, "name": name, "color": list(color), "kind": kind}
    if preset_id:
        return [item if existing["id"] == preset_id else existing for existing in presets]
    return [*presets, item]


def delete_clock_preset(presets, preset_id):
    if not any(item["id"] == preset_id for item in presets):
        raise InputError("preset_gone")
    return [item for item in presets if item["id"] != preset_id]