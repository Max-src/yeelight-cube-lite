"""What a Cube Matrix shows itself, sent over Matter: its own effects, its
clock and drawings (Yeelight cluster FC05, endpoint 2).

A Cube Matrix (device_profile) has no effect, clock or drawing command on
the LAN: they are Matter commands, sent through Home Assistant's Matter
server once the lamp is shared to it (matter_commands; light_matrix decides
when). This module builds their payloads, as the Yeelight app sends them for
this lamp, and refuses what is known to crash it. No Home Assistant import.

- **Effects**: the 13 the Yeelight app offers for this lamp, by
  ``setPresetsEffect`` (``apply``, ``effectId``, ``rate`` 1-255,
  ``color`` [0x00RRGGBB, 0, 0, 0], ``direction`` 0 up, 1 down, 2 left
  (towards the base), 3 right). The lamp turns them for its own
  ``rotation_angle``. Which take a speed, a colour or directions: as the app
  offers them.
- **Its other built-in effects** (ENGINE_MODES), by ``setEffect`` with the
  renderer's id as ``effectId`` and ``mode`` (the lamp picks the renderer
  from ``mode``), speed, intensity and the colours engine_colours picks: the
  same numbering and renderers as the integration's effects (Fireworks is
  10). The colour list matters more than on a Cube Lite: an unsent colour is
  black (the Cube Lite installs white), and any list, even all
  zero, replaces the mode's own palette with a ramp from black to its first
  colour. So a mode that draws colour words is sent the Cube Lite's
  white, and a palette mode with no colour chosen is sent none (its own
  palette shows). Home Assistant's Matter server takes no list or exactly 4
  colours.
- **Clock** (effect 40): ``setEffect`` with ``apply`` 2 (the app's: the
  clock is the priority effect), the digits' colour, a background effect
  (``mixer``: 0 plain, 17, 39, 42, 54, 57, 58, 59) and 4 data bytes:
  content (1 time, 2 time then date, 3 date), the UTC offset in whole hours
  (a signed byte: the lamp has no DST, so it is sent again when the offset
  changes), 1 for 12-hour, 0 for a blinking colon. Filmed 2026-11-09.
- **Drawing** (effect 36): ``setEffect`` with 4 bytes a pixel [0xFF, R, G,
  B] in the order of the lamp's LAN frames (device_profile.drawing_pixels:
  module by module from the base, each column by column from the bottom; a
  spot slot one pixel), then
  ``setData`` to change the pixels without restarting; the lamp never turns
  them. Its mixers animate it on the lamp: 0 static, 2 translation, 3
  breath, 4 flashing, 5 accumulation.

Never sent: more than 4 colours (the lamp copies them into a 4-word buffer),
modes 53 (needs checked data), 64 and 67 (crash the lamp).
"""

from __future__ import annotations

import base64

from .effect_catalog import lamp_rate

# setEffect / setPresetsEffect apply: show only, show and save as the
# lamp's default, show and save as its priority effect (the clock).
APPLY_SHOW = 0
APPLY_SAVE = 1
APPLY_PRIORITY = 2

CLOCK_EFFECT = 40
DRAWING_EFFECT = 36
# The clock's backgrounds (its mixer): 0 is the plain colour.
CLOCK_BACKGROUNDS = frozenset({0, 17, 39, 42, 54, 57, 58, 59})
MAX_COLOURS = 4
# Renderers that crash the lamp (64, 67) or need data checked first (53).
FORBIDDEN_MODES = frozenset({53, 64, 67})

DEFAULT_SPEED = 128
# The direction value of each label, as the light's Device Orientation shows
# the lamp (it follows the lamp's rotation, and the lamp turns its own
# effects for its rotation: no turn here). Filmed 2026-11-10 at rotation 0,
# lying with the base on the left: Left = toward the base, Right = away.
# The Yeelight app's 13 effects (its arrows: up 0, down 1, left 2, right 3):
DIRECTION_VALUES = {"Up": 0, "Down": 1, "Left": 2, "Right": 3}
# The other built-in effects are sent the value that draws what a Cube Lite
# draws (light_matrix._matrix_direction), except those below.
# Filmed 2026-11-11 (standing, every rotation): Flicker sweep (60) takes the
# app's arrows, and Building Blocks runs each of them the other way.
APP_DIRECTION_MODES = frozenset({60, 33})
# 2026-11-12, every rotation: Rising wisps (33) takes the app's arrows too,
# Waves runs each of them the other way, and Spectrum (offered no direction in
# the app, takes one: its gradient, red where it starts) swaps left and right.
REVERSED_APP_EFFECTS = {
    "Building Blocks": {"Up": 1, "Down": 0, "Left": 3, "Right": 2},
    "Waves": {"Up": 1, "Down": 0, "Left": 3, "Right": 2},
    "Spectrum": {"Up": 0, "Down": 1, "Left": 3, "Right": 2},
}
# Built-in effects that run along the lamp's long side only, whatever its
# rotation, forward on the value it draws as 0, back on 1
# (mount_profile.one_axis_direction with LOW_PAIR, as on a Cube Lite and in
# the preview: the two models lay a strip on the panel the same way, filmed
# 2026-11-12). Moving palette and Sine wave (effect_catalog.ONE_AXIS_LOW_PAIR_SLOTS).
ONE_AXIS_MODES = frozenset({4, 11})
# The app's effects that do the same: Hacking runs 2 and 3 as 0 (filmed
# 2026-11-12: lying, both the values the app's arrows give ran the same way).
ONE_AXIS_APP_EFFECTS = frozenset({"Hacking"})


def matrix_direction(effect: str, mode, label: str) -> int:
    """The direction value to send for ``label`` (a DIRECTION_VALUES key) on
    ``effect``, one of MATRIX_EFFECTS or a built-in ``mode`` that takes the
    app's arrows (APP_DIRECTION_MODES)."""
    if effect in MATRIX_EFFECTS:
        return REVERSED_APP_EFFECTS.get(effect, DIRECTION_VALUES).get(label, 0)
    return DIRECTION_VALUES.get(label, 0)

_ALL = ("Up", "Down", "Left", "Right")
# The app's effects for this lamp: id, takes a speed, takes a colour, the
# directions it offers there, by the integration's names.
MATRIX_EFFECTS: dict[str, tuple[int, bool, bool, tuple[str, ...]]] = {
    "Ribbon": (3, True, False, ()),
    "Starry Sky": (5, True, True, ()),
    "Spectrum": (17, False, True, _ALL),
    "Waves": (42, True, True, _ALL),
    "Rainbow": (39, True, True, _ALL),
    "Waterfall": (32, True, True, _ALL),
    # Its Aurora: Northern Lights here (effect_catalog.MATRIX_VERSION_EFFECTS).
    "Northern Lights": (15, True, True, _ALL),
    "Fire": (34, True, True, _ALL),
    "Bouncing Ball": (37, True, True, ()),
    "Meteor": (47, True, True, _ALL),
    "Tide": (48, True, True, _ALL),
    "Building Blocks": (49, True, True, _ALL),
    "Hacking": (46, True, False, ("Up", "Down")),
}
# The lamp's other built-in renderers the integration starts by id: the safe
# ones of 0-69 (52 steady red and 63's bursts filmed as the Cube Lite's),
# leaving out the music ones (no microphone), 12, 13 and 29 (blank) and those
# that are no effect (36 drawing, 40 clock, 50 frames, 53 counter, 64 and 67
# raw data).
ENGINE_MODES = frozenset({
    1, 2, 4, 6, 7, 8, 9, 10, 11, 14, 16, 18, 19, 21, 22, 23, 24, 28, 31, 33, 35, 38,
    52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 65, 66, 68, 69,
})
# Built-in effects whose speed was filmed doing nothing on a Cube Matrix
# (their renderers read none): offered without a speed there.
SPEEDLESS_MODES = frozenset({24, 33, 54, 55, 56, 57, 58, 59})

# What a mode needs when no colour is chosen (engine_colours):
# - it draws colour words: white in all four, what the Cube Lite installs
#   when none is sent, and each lamp turns into its own LED white (the
#   Cube Lite's LED white, 0xfcd564, sent as a colour, the Cube Matrix
#   turns into amber); without it they are black;
WORD_MODES = frozenset({0, 1, 2, 8, 11, 28, 33, 61, 62, 63})
# - Fireworks: one colour sets the palette flag, so its sparks take the
#   colour wheel (the Cube Lite's coloured confetti); without one they are black;
FIREWORKS = 10
LITE_WHITE = 0xFFFFFF
# - every other one (its own palette, or no colour at all): no list, so its
#   palette is the mode's own.
# Never started over Matter on a Cube Matrix, streamed instead: 70-81 (the
# Cube Lite's only: the Cube Matrix turns any mode over 69 into 69, a white
# wipe that ends black).
STREAMED_MODES = frozenset(range(70, 82))
# Effects the Cube Matrix draws its own way (same name, other look): native,
# labelled (light_matrix, the light's matrix_own_versions attribute). Those
# that look like another effect altogether are effects of their own instead
# (effect_catalog.MATRIX_VERSION_EFFECTS), and the Cube Lite's are streamed.
OWN_VERSIONS = {
    "Fire": "turned 180 degrees, other constants: burns from the other end",
    "Night-amber waves": "other constants and gradient; speed does nothing",
}
# Effects whose particles take their colour once, when they appear: started
# inside the lamp's 50 ms colour transition from the previous effect, they
# keep a half-blended (dim) colour for their whole life (15-45 s). Sent a
# second time RESEND_AFTER later, they start in the right colour.
RESEND_MODES = frozenset({61})
RESEND_AFTER = 0.15


class UnsafeMatrixCommand(ValueError):
    """A payload the lamp is known not to survive (FORBIDDEN_MODES, more
    than MAX_COLOURS colours, bad drawing data)."""


def colour_word(rgb) -> int:
    """(r, g, b) as the lamp's colour word, 0x00RRGGBB."""
    red, green, blue = (max(0, min(255, int(channel))) for channel in tuple(rgb)[:3])
    return (red << 16) | (green << 8) | blue


def padded_colours(words) -> list[int]:
    """Exactly MAX_COLOURS colour words, 0 after the given ones (the lamp
    reads 4; Home Assistant's server sends 4). More is refused."""
    words = [int(word) & 0xFFFFFFFF for word in words]
    if len(words) > MAX_COLOURS:
        raise UnsafeMatrixCommand(f"{len(words)} colours: the lamp takes at most {MAX_COLOURS}")
    return words + [0] * (MAX_COLOURS - len(words))


def _rate(speed, lowest: int = 1) -> int:
    return max(lowest, min(255, int(speed)))


# Modes whose speed 0 means something (not "slowest"): Sunrise and sunset
# shows its whole picture, still, at 0 (1-60 a sunrise over that many
# minutes, 61-120 a sunset, from 121 a cycle), as on a Cube Lite.
ZERO_SPEED_MODES = frozenset({18})


def _direction_value(direction, default: int = 0) -> int:
    """A lamp direction value (0-3), or a DIRECTION_VALUES label."""
    if isinstance(direction, int) and 0 <= direction <= 3:
        return direction
    return DIRECTION_VALUES.get(direction, default)


def preset_payload(
    effect: str, speed=None, rgb=None, direction=None, apply: int = APPLY_SAVE, intensity=None,
) -> dict:
    """setPresetsEffect for one of MATRIX_EFFECTS: only what the effect
    takes (the lamp keeps its preset for the rest: speed 128, blue).
    ``direction``: the lamp value to send (light_matrix turns the chosen one
    for the mounting), or a label."""
    effect_id, takes_speed, takes_colour, directions = MATRIX_EFFECTS[effect]
    payload = {"apply": int(apply), "effectId": effect_id}
    if takes_speed and speed is not None:
        payload["rate"] = _rate(speed)
    # setPresetsEffect's field 3 (the app leaves it out: the preset's 128).
    if intensity is not None:
        payload["intensity"] = max(0, min(255, int(intensity)))
    # A colour only when one is chosen (none: the lamp's preset colour);
    # never black, which would make the effect dark.
    if takes_colour and rgb is not None and colour_word(rgb):
        payload["color"] = padded_colours([colour_word(rgb)])
    if directions:
        if isinstance(direction, int):
            payload["direction"] = _direction_value(direction)
        else:
            label = direction if direction in directions else directions[0]
            payload["direction"] = DIRECTION_VALUES[label]
    return payload


def _effect(effect_id: int, custom_id: int, apply: int, params: dict) -> dict:
    """A setEffect payload. ``params["color"]``: the colour words, padded to
    4; None leaves the key out (the mode keeps its own palette)."""
    mode = params["mode"]
    if mode in FORBIDDEN_MODES or effect_id in FORBIDDEN_MODES:
        raise UnsafeMatrixCommand(f"effect {effect_id} / mode {mode} is never sent")
    config = {
        "onoff": 1,
        "mode": mode,
        "intensity": max(0, min(255, int(params.get("intensity", 128)))),
        "speed": _rate(params.get("speed", DEFAULT_SPEED), 0 if mode in ZERO_SPEED_MODES else 1),
    }
    colours = params.get("color", ())
    if colours is not None:
        config["color"] = padded_colours(colours)
    config.update({
        "mixer": int(params.get("mixer", 0)),
        "direction": int(params.get("direction", 0)),
        "data": params.get("data", ""),
    })
    return {
        "apply": int(apply),
        "effect": {"effectId": effect_id, "customId": int(custom_id), "effectParams": [config]},
    }


def engine_colours(mode: int, chosen=(), own=()) -> list[int] | None:
    """The colour words a built-in effect is sent (None: no list). The
    chosen colours (the user's colour, or the palette's for the palette
    colour mode), else the effect's own (the 0x01 flag byte of the
    integration's words masked off), else what the mode needs to look as on a
    Cube Lite (WORD_MODES, FIREWORKS; the rest: none). Never an all-black
    list: that would make every colour and palette black."""
    for words in (chosen, own):
        words = [int(word) & 0xFFFFFF for word in words or ()]
        if any(words):
            if len(words) > MAX_COLOURS:
                raise UnsafeMatrixCommand(f"{len(words)} colours: the lamp takes at most {MAX_COLOURS}")
            if mode in WORD_MODES:
                # The words not given: the Cube Lite's white, as it
                # fills them (black here: Particle glows half dark, the
                # second colour of an alternation black).
                words += [LITE_WHITE] * (MAX_COLOURS - len(words))
            return words
    if mode == FIREWORKS:
        return [LITE_WHITE]
    if mode in WORD_MODES:
        return [LITE_WHITE] * MAX_COLOURS
    return None


def engine_payload(
    mode: int, speed=None, intensity=None, chosen=(), direction=None, apply: int = APPLY_SAVE,
    own=(),
) -> dict:
    """setEffect for one of the lamp's other built-in effects (ENGINE_MODES):
    its colours from ``chosen`` and ``own`` (engine_colours), ``direction``
    the lamp value or a DIRECTION_VALUES label (None: 0)."""
    if mode not in ENGINE_MODES or mode in STREAMED_MODES:
        raise UnsafeMatrixCommand(f"mode {mode} is not one of the lamp's effects started here")
    return _effect(mode, 0, apply, {
        "mode": mode,
        "speed": lamp_rate(mode, _rate(DEFAULT_SPEED if speed is None else speed, 0 if mode in ZERO_SPEED_MODES else 1)),
        "intensity": 128 if intensity is None else intensity,
        "color": engine_colours(mode, chosen, own),
        "direction": _direction_value(direction),
    })


def live_change(shown, command) -> list | None:
    """The live commands (setRate, setDirection) that turn what the lamp
    shows (``shown``: the last command sent, name and payload) into
    ``command``, when only the speed and the direction differ; None when it
    takes the full command. A live change neither restarts the effect nor is
    saved (the Yeelight app's sliders do the same)."""
    if shown is None or shown[0] != command[0]:
        return None
    name, before, after = command[0], shown[1], command[1]
    if name == "setPresetsEffect":
        old, new, speed_key = before, after, "rate"
        if old.get("effectId") != new.get("effectId"):
            return None
    elif name == "setEffect":
        try:
            if before["effect"]["effectId"] != after["effect"]["effectId"]:
                return None
            old = before["effect"]["effectParams"][0]
            new = after["effect"]["effectParams"][0]
        except (KeyError, IndexError, TypeError):
            return None
        if new.get("mode") in (CLOCK_EFFECT, DRAWING_EFFECT):
            return None
        speed_key = "speed"
    else:
        return None
    ignored = {"apply", speed_key, "direction"}
    if {k: v for k, v in old.items() if k not in ignored} != {k: v for k, v in new.items() if k not in ignored}:
        return None
    changes = []
    if new.get(speed_key) is not None and new.get(speed_key) != old.get(speed_key):
        changes.append(("setRate", {"rate": int(new[speed_key])}))
    if new.get("direction") is not None and new.get("direction") != old.get("direction"):
        changes.append(("setDirection", {"direction": int(new["direction"])}))
    return changes


def clock_data(content: int, utc_offset_hours: int, twelve_hour: bool, colon_blink: bool) -> bytes:
    """The clock's 4 data bytes (see the module docstring)."""
    if content not in (1, 2, 3):
        raise UnsafeMatrixCommand(f"clock content {content}: 1, 2 or 3")
    offset = max(-12, min(14, int(utc_offset_hours)))
    return bytes((content, offset & 0xFF, 1 if twelve_hour else 0, 0 if colon_blink else 1))


def clock_payload(
    rgb, background: int, content: int, utc_offset_hours: int, twelve_hour: bool,
    colon_blink: bool, apply: int = APPLY_PRIORITY, style_id: int = 0,
) -> dict:
    """setEffect for the clock: the digits in ``rgb`` over ``background``
    (CLOCK_BACKGROUNDS). ``rgb`` None: no colour, as the Yeelight app sends
    the styles over a background (1-3, 11-14): a colour would replace the
    background's palette. ``style_id`` is the app's custom id, which changes
    nothing on the lamp."""
    if background not in CLOCK_BACKGROUNDS:
        raise UnsafeMatrixCommand(f"clock background {background}")
    data = clock_data(content, utc_offset_hours, twelve_hour, colon_blink)
    return _effect(CLOCK_EFFECT, style_id, apply, {
        "mode": CLOCK_EFFECT,
        "color": None if rgb is None else [colour_word(rgb)],
        "mixer": background,
        "data": base64.b64encode(data).decode("ascii"),
    })


# A drawing's pixels at most: 6 modules of 25.
MAX_DRAWING_PIXELS = 150


def drawing_data(pixels) -> bytes:
    """A drawing's pixels (device_profile.drawing_pixels: the wire order, 25
    a module, 1 a spot) as its data: [0xFF, R, G, B] a pixel."""
    frame = list(pixels)
    if not 0 < len(frame) <= MAX_DRAWING_PIXELS:
        raise UnsafeMatrixCommand(f"a drawing of {len(frame)} pixels")
    data = bytearray()
    for pixel in frame:
        data += bytes((0xFF, *(max(0, min(255, int(channel))) for channel in tuple(pixel)[:3])))
    return bytes(data)


def drawing_payload(pixels, apply: int = APPLY_SHOW, custom_id: int = 0) -> dict:
    """setEffect for a still drawing (mixer 0: the lamp does not animate
    it); ``custom_id``: the id the lamp reports for it."""
    return _effect(DRAWING_EFFECT, custom_id, apply, {
        "mode": DRAWING_EFFECT,
        "color": None,  # the app sends none
        "speed": DEFAULT_SPEED,
        "mixer": 0,
        "direction": 0,
        "data": base64.b64encode(drawing_data(pixels)).decode("ascii"),
    })


def set_data_payload(pixels) -> dict:
    """setData: a running drawing's new pixels (same length, not saved)."""
    return {"data": base64.b64encode(drawing_data(pixels)).decode("ascii")}


# ── The demo (show-off) loop ────────────────────────────────────────────
# Ten quick presses of the button put a Cube Matrix in a demo loop that only a
# factory reset ends: every 30 s it shows (and saves) its next effect, so
# anything else shown lasts until the next tick. Over Matter, the effect it
# runs (FC03) changes every 30 s while FC05's, which echoes requests, stays
# 0. A LAN stream is not interrupted by the ticks (filmed 2026-11-09).
DEMO_TICK = 30.0
DEMO_TOLERANCE = 2.5
# Consecutive tick intervals seen before the loop is taken as on.
DEMO_TICKS = 3
# Clock style colours as the Yeelight app sends them for this lamp (styles 4
# to 10: the plain ones), by the integration's style id.
CLOCK_STYLE_COLOURS = {
    4: (0xFF, 0xFF, 0xFF), 5: (0x01, 0xFF, 0xA3), 6: (0xFF, 0xFF, 0x00), 7: (0xFF, 0x2E, 0xD1),
    8: (0xFF, 0x00, 0x00), 9: (0x5B, 0xE8, 0xF9), 10: (0x7C, 0x14, 0xFF),
}


class DemoLoopWatch:
    """Tells the demo loop from the lamp's Matter reports: its running
    effect changing every DEMO_TICK seconds (or two: a tick may show the
    same effect again, which is not reported) while nothing was requested
    (FC05's effect 0)."""

    def __init__(self) -> None:
        self._changes: list[float] = []

    def reset(self) -> None:
        self._changes = []

    def running_changed(self, now: float, requested) -> bool:
        """The running effect changed at ``now`` (monotonic seconds), with
        FC05's effect ``requested``: whether the loop is seen."""
        if requested not in (0, None):
            self._changes = []
            return False
        self._changes = [*self._changes, now][-(DEMO_TICKS + 1):]
        if len(self._changes) <= DEMO_TICKS:
            return False
        for before, after in zip(self._changes, self._changes[1:]):
            gap = after - before
            ticks = round(gap / DEMO_TICK)
            if ticks not in (1, 2) or abs(gap - ticks * DEMO_TICK) > DEMO_TOLERANCE:
                return False
        return True
