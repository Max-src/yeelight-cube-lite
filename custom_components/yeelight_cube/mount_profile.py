"""The lamp's saved mount profile (the Yeelight app's orientation setting) and
how native effect directions are compensated for it.

The Cube Lite firmware turns every native effect's ``direction`` (0 Up,
1 Down, 2 Left, 3 Right) by the profile the lamp saved, ``rotation_angle``
0-3: it draws ``DIRECTION_TABLE[profile][direction]`` (MCU v34, table
0x01e40a60). Direct pixel streaming is not turned. The profile is the app's
orientation page (0°, 90°, 180°, 270° = 0, 1, 2, 3), saved by its Save button
or by a write of the Matter attribute FC02 rotationAngle; nothing reads or
writes it over LAN, and a factory reset puts the lamp on 3 while Matter then
reads 0 until it is saved again.

Every direction here (const.py ``direction_remap``, effect_orientation.py,
light_native.mount_effect_direction) was calibrated on a lamp at profile 2
(REFERENCE_PROFILE). The lamp's actual profile is compensated at the very end,
on the value sent: ``compensate_direction`` finds the direction that draws the
same on that lamp as the calibrated one did on profile 2.

What the lamp runs, when nothing says otherwise, is the firmware's default:
3, the profile of a lamp never saved in the app, or factory reset. Over
Matter a value is the lamp's when it was confirmed on that node (written by
the integration, or changed in the app since), or when it can only come from
a save (``saved_on_lamp``): the Wi-Fi chip starts at 0, so 1-3 were saved,
and the app's Save also writes the module topology, so 0 with it was saved
too. A 0 without it is a lamp never saved: it runs 3.
"""
from __future__ import annotations

# Row = profile, column = the direction sent, value = the direction drawn.
DIRECTION_TABLE = (
    (2, 3, 1, 0),  # profile 0 (0°)
    (1, 0, 3, 2),  # profile 1 (90°)
    (3, 2, 0, 1),  # profile 2 (180°): the calibration's
    (0, 1, 2, 3),  # profile 3 (270°): the firmware's default, after a reset
)
PROFILES = (0, 1, 2, 3)
REFERENCE_PROFILE = 2
# What the lamp boots with when no profile was saved (after a factory reset).
FIRMWARE_DEFAULT_PROFILE = 3

# Where the profile in use comes from: read over Matter (confirmed, or one
# only a save gives), set by the user (options, the check on the lamp), or not known
# (then FIRMWARE_DEFAULT_PROFILE, what a lamp never saved runs).
SOURCE_MATTER = "matter"
SOURCE_USER = "user"
SOURCE_UNKNOWN = "unknown"

# The app's orientation buttons, by profile.
PROFILE_DEGREES = {0: 0, 1: 90, 2: 180, 3: 270}

# The app's arrow for each profile (its rotationAngle, matter_link).
PROFILE_ARROWS = {0: "left", 1: "up", 2: "right", 3: "down"}

# The guided check: Shooting Star (mode 47) at direction 3, sent as is (not
# compensated): the way its stars fly tells the profile, a different way on
# each. Measured on the user's lamps (2026-10-29, both mounted Right, the
# default): with the lamp drawing direction 0 / 1 / 2 / 3 (DIRECTION_TABLE)
# the stars fly right / left / up / down. No effect flies the way the app's
# arrow points on every profile (the table turns a flat lamp's effects
# lengthwise), so the answer is translated into the arrow (star_check_profile).
STAR_CHECK_PARAMS = [47, 0, 4, {"mode": 47, "onoff": 1, "rate": 50, "direction": 3}]
STAR_DRAWN_MOTION = ("right", "left", "up", "down")
# The four ways, clockwise, and how many quarter turns clockwise a Device
# Orientation turns what the viewer sees (the previews' rule, matrix_view.py:
# left / up upside down, down / up standing with the lamp's left end on top).
MOTIONS = ("up", "right", "down", "left")
MOUNT_QUARTER_TURNS = {"right": 0, "down": 1, "left": 2, "up": 3}

# The module type the app's Save writes into the topology ([2, 2, 2, 2]:
# the Cube Lite's four 5 x 5 matrix tiles, kTypeMatrix).
SAVED_TOPOLOGY_MODULE = 2


def valid_profile(value) -> int | None:
    """The profile 0-3 as an int, or None (anything else, bool included)."""
    if isinstance(value, bool):
        return None
    try:
        profile = int(value)
    except (TypeError, ValueError):
        return None
    return profile if profile in PROFILES else None


def compensate_direction(direction: int, profile: int | None,
                         reference: int = REFERENCE_PROFILE) -> int:
    """The direction to send to a lamp on ``profile`` so it draws what
    ``direction`` drew on ``reference``: d' with
    DIRECTION_TABLE[profile][d'] == DIRECTION_TABLE[reference][d]. An invalid
    profile changes nothing (callers pass effective_profile's)."""
    profile = valid_profile(profile)
    if profile is None or profile == reference or direction not in PROFILES:
        return direction
    return DIRECTION_TABLE[profile].index(DIRECTION_TABLE[reference][direction])


def saved_on_lamp(rotation, topology) -> bool:
    """Whether a rotationAngle read over Matter can only be a saved one: the
    Wi-Fi chip starts at 0 (a lamp never saved, or reset, which runs 3), so
    1-3 were written (the app's Save, or a Matter write, which reaches the
    lamp at once); and the app's Save writes the topology before the angle,
    so 0 with a saved topology is a 0° saved in the app."""
    profile = valid_profile(rotation)
    if profile is None:
        return False
    if profile != 0:
        return True
    return isinstance(topology, (list, tuple)) and SAVED_TOPOLOGY_MODULE in topology


def resolve_profile(
    stored_profile,
    stored_source,
    confirmed_node,
    matter_node,
    matter_profile,
    matter_topology=None,
) -> tuple[int | None, str]:
    """The lamp's profile and where it comes from (None, "unknown": not
    known, see effective_profile).

    ``stored_*`` is what the entry keeps (the user's choice, or the last value
    Matter confirmed); ``confirmed_node`` the Matter node whose attribute is
    trusted; ``matter_node`` / ``matter_profile`` / ``matter_topology`` the
    live node linked now and what it reports. Its value is the truth when it
    was confirmed on that node, or when only a save gives it
    (saved_on_lamp). Otherwise it reads the Wi-Fi chip's default: on a new
    node (a lamp paired again after a factory reset) the old node's value is
    not the lamp's either; a choice the user made still is.
    """
    live = valid_profile(matter_profile)
    if matter_node is not None and live is not None and (
        matter_node == confirmed_node or saved_on_lamp(live, matter_topology)
    ):
        return live, SOURCE_MATTER
    stored = valid_profile(stored_profile)
    if stored is None:
        return None, SOURCE_UNKNOWN
    if stored_source != SOURCE_MATTER:
        return stored, SOURCE_USER
    # The last value Matter confirmed: still the lamp's while no other node
    # is linked; a new node is the lamp paired again, most likely after a
    # factory reset that erased it.
    if matter_node is not None and matter_node != confirmed_node:
        return None, SOURCE_UNKNOWN
    return stored, SOURCE_MATTER


def effective_profile(profile: int | None) -> int:
    """The profile directions are compensated for. Unknown: the firmware's
    default, what a lamp runs until its orientation is saved."""
    valid = valid_profile(profile)
    return FIRMWARE_DEFAULT_PROFILE if valid is None else valid


def clock_turned(profile: int | None) -> bool:
    """Whether the firmware's clock (mixer 1, which takes no direction) is
    drawn a half turn from the calibration's: it tests ``profile & ~1 == 2``,
    upright on 2 and 3, turned on 0 and 1. Unknown: the default 3, upright."""
    return valid_profile(profile) in (0, 1)


def star_check_profile(seen: str, device_orientation: str | None = None) -> int | None:
    """The profile of a lamp whose check stars fly ``seen`` (up / right /
    down / left) for someone facing it, mounted as ``device_orientation``
    says (default: Right); None for anything else."""
    if seen not in MOTIONS:
        return None
    turns = MOUNT_QUARTER_TURNS.get(device_orientation or "right", 0)
    on_lamp = MOTIONS[(MOTIONS.index(seen) - turns) % 4]
    drawn = STAR_DRAWN_MOTION.index(on_lamp)
    sent = STAR_CHECK_PARAMS[3]["direction"]
    return next(profile for profile in PROFILES if DIRECTION_TABLE[profile][sent] == drawn)


def arrow_text(profile: int) -> str:
    """The app's arrow for a profile, as the dialogs name it."""
    return f"Arrow {PROFILE_ARROWS[profile]} ({PROFILE_DEGREES[profile]}°)"
