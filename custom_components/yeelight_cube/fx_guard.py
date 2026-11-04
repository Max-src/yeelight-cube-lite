"""What the raw debug actions (send_fx_effect, query_raw) must not send: the
inputs that hang or restart a lamp, whatever is asked. The component's own
commands do not pass here: this is only the debug tools' guard, and they still send anything else.

Nothing here reads a lamp. The lamp starts from the preset row of the command
id, then only the sent keys change, so that merged record is what is judged.
What cannot be judged is refused: a value the lamp would store as another (a
byte wraps), and a live update that is not safe whatever runs. What
runs is never relied on: the lamp's app and buttons change it unseen.
"""
from __future__ import annotations

import base64
import binascii

from .const import LAMP_ANIMATION_SLOTS, NATIVE_CLOCK_EFFECT_ID, lamp_rate
from .lamp_core import LENGTH, segment_geometry
from .mount_profile import DIRECTION_TABLE, REFERENCE_PROFILE, valid_profile

# What the lamp starts from: a preset's row. Its slot is its id, at intensity
# and rate 128, direction 0, but for these. An id with no row is judged as that slot too.
_PRESET_SLOTS = {
    41: 36, 43: 40, 63: 70, 64: 70, 65: 70, 66: 70, 67: 70, 83: 43, 84: 44, 85: 45,
    86: 41, 87: 73, 88: 74, 89: 0, 90: 75, 91: 55, 92: 76, 93: 57, 94: 77, 95: 80, 96: 81,
}
_PRESET_KEYS = {34: {"direction": 3}, 43: {"mixer": 39}, 71: {"intensity": 0}}
# What only set_fx_effect may change: a live update takes the slot from the lamp.
_SET_ONLY_KEYS = ("mode", "mixer", "start", "end", "data")
# The keys the rules read, and the most the lamp takes of each: a byte above
# wraps; a direction indexes a table of 4, unchecked.
_FIELD_LIMITS = {
    "mode": 255, "mixer": 255, "rate": 255, "intensity": 255, "direction": 3,
    "start": LENGTH, "end": LENGTH,
}
# Presets the lamp hangs on at the next command or stop, sent as is or edited.
STATIC_DATA_PRESETS = (41, 43)
# Slots that read the data block as a picture: a clock's 4 bytes would be one.
_DRAWING_SLOTS = (36, 64, 67)
DRAWING_BYTES = 400  # mode 36: 100 ARGB colors on the full panel
_FADE_DRAWING_MAX_BYTES = 300  # mode 67: past 100 colors it overwrites the drawing buffer
_AURORA_MIN_INTENSITY = 13  # below, 0 waves: the lamp hangs
_MAX_COLORS = 4  # more spill over the effect's settings; from 6 the lamp can crash
_MIN_PIXELS = {47: 2, 60: 2, 59: 16, 74: 16}  # 1 pixel divides by zero; fewer than 16 are unsafe
# Effects that read past their buffer on a partial segment, Tide dividing by
# its box height - 1 first.
_TIDE_SLOTS = (35, 48)
_READ_BACK_SLOTS = frozenset({
    32, 33, 34, 35, 37, 38, 39, 41, 42, 43, 45, 46, 47, 48, 49, 51, 54, 55, 56, 57, 58,
    59, 73, 74, 75, 76, 77, 81,
})
_CLOCK_MIXER = 1
_INSTALL_FLAGS = (0x05, 0x45, 0x55, 0x15)  # by mapped direction


def _read_back_flags(slot: int, mapped: int, mixer: int) -> int:
    """The flags a read-back pass runs with: Hacking has its own, a clock's
    record 0x05 whatever the direction, and slot 51 adds 0x42."""
    if slot == 46:
        return 0x45 if mapped == 1 else 0x05
    flags = 0x05 if mixer == _CLOCK_MIXER else _INSTALL_FLAGS[mapped]
    return flags | 0x42 if slot == 51 else flags


def _flags_index(pixel: int, length: int, flags: int) -> int:
    """The pixel mapper on those flags (0x57 maps as 0x55)."""
    if flags == 0x47:
        width, height = segment_geometry(length, 0)
        return ((height - 1 - pixel // width) * 5 + pixel % width) & 0xFFFF
    mapped = _INSTALL_FLAGS.index(0x55 if flags == 0x57 else flags)
    width, height = segment_geometry(length, mapped)
    row, column = divmod(pixel, width)
    x, y = (
        (column, row) if mapped == 0
        else (width - 1 - column, height - 1 - row) if mapped == 1
        else (height - 1 - row, column) if mapped == 3
        else (row, width - 1 - column)
    )
    return (y * 5 + x) & 0xFFFF


def _reads_past_buffer(length: int, flags: int) -> bool:
    return any(_flags_index(pixel, length, flags) >= LENGTH for pixel in range(length))


def _preset_row(preset: int) -> dict:
    return {
        "mode": _PRESET_SLOTS.get(preset, preset), "mixer": 0, "direction": 0,
        "intensity": 128, "rate": 128, **_PRESET_KEYS.get(preset, {}),
    }


def _data_bytes(config) -> int | None:
    """The exact size of a config's data block, None without a clean one."""
    try:
        return len(base64.b64decode(config.get("data"), validate=True))
    except (TypeError, binascii.Error, ValueError):
        return None


def _segment_refusal(slot, mixer, clock, length, direction, profile) -> str | None:
    """A partial segment's limits: full panels never reach them."""
    if not 1 <= length <= LENGTH:
        return None
    # The clock hands its mixer over with no direction flags.
    mapped_of = lambda raw: 0 if clock else DIRECTION_TABLE[profile][raw]
    for raw in range(4) if direction is None else (direction,):
        mapped = mapped_of(raw)
        if slot in _TIDE_SLOTS and segment_geometry(length, mapped)[1] == 1:
            return f"Tide divides by zero on {length} pixels with direction {raw}"
        overlay = _CLOCK_MIXER if clock else mixer
        if slot in _READ_BACK_SLOTS and _reads_past_buffer(
            length, _read_back_flags(slot, mapped, overlay)
        ):
            return f"Slot {slot} reads past its buffer on {length} pixels with direction {raw}"
        if overlay == _CLOCK_MIXER and _reads_past_buffer(
            length, _read_back_flags(slot, mapped, _CLOCK_MIXER)
        ):
            return f"The clock overlay reads past its buffer on {length} pixels"
    return None


def fx_refusal(config, profile=None, preset=None) -> str | None:
    """Why this effect config must not reach a lamp on mount ``profile`` (the
    direction it sends goes through it) when sent over ``preset``, or None. With
    no preset a direction not sent may be any. The clock hands everything over to
    its mixer: slot, rate, intensity and length are the mixer's."""
    if not isinstance(config, dict):
        return None
    for key, limit in _FIELD_LIMITS.items():
        if key in config and (type(config[key]) is not int or not 0 <= config[key] <= limit):
            return f"{key} must be a whole number from 0 to {limit}"
    if "data" in config and not isinstance(config["data"], str):
        return "data must be base64 text"
    colors = config.get("color")
    if isinstance(colors, (list, tuple)) and len(colors) > _MAX_COLORS:
        return f"An effect takes at most {_MAX_COLORS} colors"
    profile = valid_profile(profile)
    profile = REFERENCE_PROFILE if profile is None else profile
    record = {} if preset is None else _preset_row(preset)
    record.update(config)
    mode, mixer = record.get("mode", 0), record.get("mixer", 0)
    clock = mode == NATIVE_CLOCK_EFFECT_ID
    slot = mixer if clock else mode
    if not 0 <= slot < LAMP_ANIMATION_SLOTS:
        return f"Slot {slot} is past the lamp's slots (0-{LAMP_ANIMATION_SLOTS - 1})"
    rate = record.get("rate")
    if rate is not None and lamp_rate(slot, rate) != rate:
        return f"Rate {rate} crashes slot {slot} (at most {lamp_rate(slot, rate)})"
    intensity = record.get("intensity")
    if intensity is not None:
        if slot == 15 and intensity < _AURORA_MIN_INTENSITY:
            return f"Aurora needs intensity {_AURORA_MIN_INTENSITY} or more: lower hangs the lamp"
        if slot == 70 and intensity == 0:
            return "Slot 70 divides by zero at intensity 0"
    if clock and slot in _DRAWING_SLOTS:
        return f"The clock cannot run slot {slot}: it would read the clock's settings as a drawing"
    size = _data_bytes(record)
    length = record.get("end", LENGTH) - record.get("start", 0)
    if length < 1:
        return "A segment ends after it starts"
    if slot == 36 and (size != DRAWING_BYTES or length != LENGTH or mixer == _CLOCK_MIXER):
        return f"Slot 36 needs a {DRAWING_BYTES}-byte drawing on the full panel, without the clock"
    # The most a text turns into, however the lamp reads a stray character.
    if slot == 67 and len(record.get("data", "")) * 3 // 4 > _FADE_DRAWING_MAX_BYTES:
        return f"Slot 67 takes at most {_FADE_DRAWING_MAX_BYTES} bytes: more overwrites the drawing buffer"
    if length < _MIN_PIXELS.get(slot, 0):
        return f"Slot {slot} needs at least {_MIN_PIXELS[slot]} pixels"
    return _segment_refusal(slot, mixer, clock, length, record.get("direction"), profile)


def _update_refusal(update, profile) -> str | None:
    """A live update must be safe on every slot: what runs may not be what the
    guard last saw. Anything finer takes a set_fx_effect."""
    for key in _SET_ONLY_KEYS:
        if key in update:
            return f"A live update cannot change {key}: use set_fx_effect"
    for slot in range(LAMP_ANIMATION_SLOTS):
        if slot != 36 and (refusal := fx_refusal({**update, "mode": slot}, profile)):
            return f"A live update must be safe on any effect: {refusal}"
    return None


def _left_running(params, running) -> list | None:
    """The segment configs a live update leaves on the lamp: the running effect's,
    each with its update. None when that effect is not known."""
    if not isinstance(running, list) or len(running) <= 3 or not isinstance(params, list):
        return None
    configs = running[3:]
    for at, update in enumerate(params[:len(configs)]):
        if isinstance(update, dict) and isinstance(configs[at], dict):
            configs[at] = {**configs[at], **update}
    return configs


def _objects(configs) -> list:
    """Segment configs as the lamp takes them: it skips what is not an object."""
    return [config if isinstance(config, dict) else {} for config in configs]


def command_refusal(method, params, running, profile=None) -> str | None:
    """Why a raw command must not reach the lamp, or None. ``running``: the
    set_fx_effect params last sent raw, when any: an update is also judged on
    them, for the segment they ran on."""
    if method == "update_fx_effect":
        if not isinstance(params, list):
            return "update_fx_effect takes a list"
        for update in _objects(params):
            if refusal := _update_refusal(update, profile):
                return refusal
        configs = _left_running(params, running)
        if configs is None:
            return None
        preset = running[0] if type(running[0]) is int else None
        return next(filter(None, (fx_refusal(c, profile, preset) for c in _objects(configs))), None)
    if method == "set_fx_effect":
        if not isinstance(params, list) or not params:
            return "set_fx_effect takes a list"
        preset, configs = params[0], params[3:] or [{}]
    elif method == "update_persist_effect_list":  # played later, by the lamp's button
        item = params[1] if isinstance(params, list) and len(params) > 1 else None
        if not isinstance(item, dict):
            return None
        preset, configs = item.get("effect_id"), item.get("effect_params") or [{}]
        if not isinstance(configs, list):
            return "effect_params must be a list"
    else:
        return None
    if type(preset) is not int:
        return "The effect id must be a whole number"
    if preset in STATIC_DATA_PRESETS:
        return f"Preset {preset} hangs the lamp at the next command: use another effect_id for its slot"
    return next(filter(None, (fx_refusal(c, profile, preset) for c in _objects(configs))), None)


def running_after(method, params, running) -> list | None:
    """What the lamp runs after a raw command it took, so that a raw update after
    a raw effect is judged too; None when that is not known."""
    if method == "set_fx_effect":
        return params if isinstance(params, list) else None
    configs = _left_running(params, running)
    return None if configs is None else [*running[:3], *configs]
