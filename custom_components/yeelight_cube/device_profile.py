"""Which lamp model an entry drives, and what that model can take.

Two models answer this integration on the LAN, each with its own software:

- **Cube Lite** (SSDP ``model: CubeLite``, ``fw_ver 1.0.0``, empty ``support:``):
  Matter + an ESP32 that forwards LAN commands to an LED chip. It has its own
  effects, clock and stored GIF (``set_fx_effect`` / ``update_fx_effect`` /
  ``reset_fx_effect``), settings over ``set_ps``, a microphone, and never
  answers ``get_prop``. ``update_leds`` takes 100 pixels, row by row from the
  bottom (``row * 20 + column``): "lamp order", the order every frame here is
  drawn in.
- **Cube Matrix** (SSDP ``model: CubeMatrix``, ``fw_ver 92`` = version
  1.12.92, the original Yeelight Cube / "Cube Smart Lamp": a base and a chain
  of 5 x 5 modules): one ESP32-C3 with Matter (where its own effects, clock
  and drawings live: Yeelight cluster FC05, sent through Home Assistant's
  Matter server when the lamp is shared to it, light_matrix) and a classic
  Yeelight LAN JSON server. Over the LAN, its ``support:`` list is the whole
  command set: ``get_prop``
  (answered, with ``cube_topology``, ``rotation_angle``, ``strip_lenth``),
  ``set_rgb``/``set_hsv``/``set_ct_abx``/``set_bright``/``set_power``,
  ``start_cf``, ``set_scene`` (incl. ``auto_delay_off``), ``set_segment_rgb``
  (one colour per column, held about 3 s), ``activate_fx_mode`` (``direct`` and
  four music modes fed with ``update_music_data``), ``update_leds`` and the
  classic music mode (``set_music``: the lamp connects back, no quota; the
  channel used for its frames, music_channel). **No
  effect, clock or GIF command over the LAN, no ``set_ps``, no
  microphone**: this integration draws effects, clocks and animations itself
  and streams them (light_studio). ``update_leds`` takes the modules one after
  the other from the base, each 25 pixels **column by column from the bottom**
  (filmed 2026-11-08 with 4 modules in a row, rotation_angle 3; see
  docs/CUBE_MATRIX.md). Over TCP it takes 30 commands a minute per client
  (54 shared), then refuses ("client quota exceeded"): frames go over the
  music-mode connection. It converts every pixel of a frame with its own
  colour converter, as it does its own effects' colours: it is sent the
  colours before conversion (``raw_colours``), never the Cube Lite's LED
  drive (filmed 2026-11-09: white turned orange). It never turns a frame for
  its ``rotation_angle``: the mounting it names (MATRIX_ROTATION_ORIENTATIONS,
  filmed lying base-left at 0 and standing on the base at 3) is the light's
  Device Orientation, which lays every picture out for it.

Frames are drawn in lamp order on a panel ``width`` columns wide and 5 high:
20 for a Cube Lite and for a Cube Matrix of up to 4 modules, 5 a module for a
longer Cube Matrix (up to TOPOLOGY_SLOTS modules). ``to_wire`` turns one into
what the model's ``update_leds`` takes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

CUBELITE = "cubelite"
CUBEMATRIX = "cubematrix"

# The panel frames are drawn on (lamp order: index = row * width + column,
# row 0 at the bottom, column 0 at the base / power side): COLS wide for a
# Cube Lite and a Cube Matrix of up to 4 modules (DeviceProfile.width).
COLS, ROWS = 20, 5
MODULE_SIZE = 5  # a Cube Matrix module is 5 x 5 pixels

# cube_topology: the module types in chain order from the base, up to
# TOPOLOGY_SLOTS, then zeros (CubeControlCubeType in the Yeelight app: 0 none,
# 1 panel, 2 matrix, 3 spot). The lamp (1.12.92, set_segment_rgb and
# update_leds) gives a type-3 slot 5 LEDs and any other non-zero slot 25 (a
# 5 x 5 block); strip_lenth is their sum. The lamp filmed 2026-11-08 reports
# "1,1,1,1,3,3,0,0," and 110: 4 blocks of 25, then two 5-LED slots that are
# configured but not fitted (LEDs 100-109 light nothing).
TOPOLOGY_NONE = 0
TOPOLOGY_PANEL = 1
TOPOLOGY_MATRIX = 2
TOPOLOGY_SPOT = 3
# Each type's name (the light's matrix_modules attribute, the
# set_matrix_modules action).
TOPOLOGY_NAMES = {TOPOLOGY_PANEL: "panel", TOPOLOGY_MATRIX: "matrix", TOPOLOGY_SPOT: "spot"}
BLOCK_LEDS = MODULE_SIZE * MODULE_SIZE
SPOT_LEDS = 5
# Modules a Cube Matrix takes: the Yeelight app offers 6, the lamp keeps 8
# (its list has 8 slots, read back at every start; 7 and 8 written over
# Matter and read back, 2026-11-21).
TOPOLOGY_SLOTS = 8
# The widest panel: 5 columns a module.
MAX_COLS = MODULE_SIZE * TOPOLOGY_SLOTS
# The module list a Cube Matrix leaves the factory with (4 panels, 2 spots),
# before its modules are set in the Yeelight app: its rotation then is the
# factory's too (3), whatever way it is mounted.
FACTORY_TOPOLOGY = (1, 1, 1, 1, 3, 3)

# Methods a Cube Matrix accepts that are not in its support: list (the UDP
# session's own messages).
_SESSION_METHODS = frozenset({"udp_sess_new", "udp_sess_keep_alive", "udp_chroma_sess_new"})

# The 30 methods a Cube Matrix takes over the LAN (1.12.92: exactly its SSDP
# support: list). Used when SSDP gave none (no multicast), so a Cube Lite
# command never reaches it.
CUBEMATRIX_SUPPORT = frozenset((
    "get_prop set_default set_power toggle set_bright set_scene cron_add cron_get cron_del "
    "start_cf stop_cf set_name set_adjust adjust_bright set_ct_abx adjust_ct adjust_color "
    "set_rgb set_hsv set_music set_segment_rgb set_music_data udp_sess_new "
    "udp_sess_keep_alive udp_chroma_sess_new get_supported_fx_mode activate_fx_mode "
    "deactivate_fx_mode update_music_data update_leds"
).split())

# Listed, but never sent to a Cube Matrix (DeviceProfile.refusal), debug
# services included: set_default writes its power-on state; set_adjust on
# ct reads past a table (the lamp restarts); set_segment_rgb holds a 3 s
# timer that then blocks streamed frames; cron_* never answer.
_MATRIX_REFUSED = {
    "set_default": "it would overwrite the lamp's saved power-on state",
    "set_segment_rgb": "it blocks streamed frames for 3 s",
    "cron_add": "the lamp never answers it",
    "cron_get": "the lamp never answers it",
    "cron_del": "the lamp never answers it",
}
# get_prop names that overflow the lamp's reply (its stored effects).
_MATRIX_UNREADABLE = frozenset({"def_fx", "tmp_fx", "hp_fx"})

# Frames a second a Cube Matrix shows, every one (filmed 2026-11-08 over its
# music-mode connection: 4 and 6 all shown, 8 and more partly skipped).
CUBEMATRIX_MAX_FPS = 6

# The Yeelight product ids (Matter vendor cluster FC00).
CUBE_LITE_PRODUCT = 4
CUBE_MATRIX_PRODUCT = 16787457

# The mounting each rotation_angle is for, as the light's Device Orientation
# (const.DEVICE_ORIENTATIONS). Filmed 2026-11-09: 0 = lying, the base on the
# left (the frame as drawn: "right"); 3 = standing on the base (the lamp's
# own effects run upright, and the frame's first column is at the bottom,
# its first row on the right: "up", the preview cards' standing view). 1 and
# 2 are the other two quarter turns: standing with the base on top ("down")
# and lying with the base on the right ("left").
MATRIX_ROTATION_ORIENTATIONS = {0: "right", 1: "down", 2: "left", 3: "up"}

# The music modes the Cube Matrix renders itself from update_music_data
# (get_supported_fx_mode; music_note / music_impact: invalid params).
CUBEMATRIX_MUSIC_MODES = ("music_spectrum", "music_breathing", "music_gather", "music_blossom")


@dataclass(frozen=True)
class DeviceProfile:
    """What one lamp model takes (see the module docstring)."""

    key: str
    name: str
    # The lamp's own effects, clock and stored GIF (set_fx_effect ...).
    native_effects: bool
    # set_ps settings (power-on behaviour, microphone music, adapter side).
    lamp_settings: bool
    # Matter (buttons, mount profile, GIF upload, music direction).
    matter: bool
    # A microphone the lamp's music effects listen to.
    microphone: bool
    # Answers get_prop over the LAN.
    answers_get_prop: bool
    # Modules in the chain (Cube Matrix): how many 5 x 5 blocks update_leds fills.
    modules: int = 4
    # The LEDs of each topology slot in chain order (Cube Matrix: 25 a block,
    # 5 a spot slot); empty: ``modules`` blocks.
    slots: tuple = ()
    # LEDs update_leds takes (strip_lenth); extra ones are sent black.
    wire_length: int = COLS * ROWS
    # Commands the lamp lists in its SSDP support: (empty: not known).
    support: frozenset = field(default_factory=frozenset)
    # Frames a second the lamp shows (None: as many as the stream sends). The
    # Cube Matrix shows every frame up to 6 a second (filmed), skips some
    # beyond: its streams send at most that many.
    max_fps: int | None = None
    # Its Matter product id (FC00): which nodes the Matter link takes.
    matter_product: int = CUBE_LITE_PRODUCT
    # The lamp converts streamed pixels itself: streamed effects are drawn in
    # raw colours (lamp_core.raw_colours), not LED drive.
    raw_colours: bool = False
    # rotation_angle (Cube Matrix): how it is mounted (orientation).
    rotation: int = 0
    # cube_topology's module types (Cube Matrix: 1 panel, 2 matrix, 3 spot).
    module_types: tuple = ()

    @property
    def streams_effects(self) -> bool:
        """Effects and clocks are drawn here and streamed (no lamp effects)."""
        return not self.native_effects

    def accepts(self, method: str) -> bool:
        """Whether the lamp takes ``method`` (its support: list; a lamp
        without one, the Cube Lite, is not checked here)."""
        if not self.support or method in _SESSION_METHODS:
            return True
        return method in self.support

    def refusal(self, method: str, params=None) -> str | None:
        """Why ``method`` must never be sent to this lamp, even though it
        lists it (a Cube Matrix: _MATRIX_REFUSED), else None."""
        if self.key != CUBEMATRIX:
            return None
        if reason := _MATRIX_REFUSED.get(method):
            return f"{method} is not sent to a Cube Matrix: {reason}"
        values = [str(value).lower() for value in (params or [])]
        if method == "set_adjust" and "ct" in values:
            return "set_adjust on ct is not sent to a Cube Matrix: it restarts the lamp"
        if method == "get_prop" and _MATRIX_UNREADABLE.intersection(values):
            return "get_prop of a stored effect is not sent to a Cube Matrix: its reply overflows"
        return None

    @property
    def firmware_too_old(self) -> bool:
        """A Cube Matrix whose firmware takes no frames (update_leds came with
        1.11.57): nothing Home Assistant draws can be shown."""
        return self.key == CUBEMATRIX and bool(self.support) and "update_leds" not in self.support

    @property
    def chain(self) -> tuple:
        """The LEDs of each module in chain order (25 a block, 5 a spot);
        a Cube Lite: none."""
        if self.key != CUBEMATRIX:
            return ()
        return self.slots or (BLOCK_LEDS,) * self.modules

    @property
    def columns(self) -> int:
        """The frame's columns the lamp covers: 5 a module, whatever its kind
        (a spot takes a block's place in the chain and lights for its 5
        columns); a Cube Lite: 20. A Cube Matrix still on the factory list
        (4 blocks, then 2 spot slots not fitted): its 4 blocks' 20. Effects,
        text and the streamed clock fit them (lamp_renderers.lamp_settings'
        columns, light_render, clock_face)."""
        if self.key != CUBEMATRIX or self.factory_modules:
            return COLS
        return min(MAX_COLS, MODULE_SIZE * len(self.chain))

    @property
    def width(self) -> int:
        """The columns of the panel this lamp's frames are drawn on (the
        stride of lamp order): 20, or a longer Cube Matrix's columns."""
        return max(COLS, self.columns)

    @property
    def pixels(self) -> int:
        """A frame's pixels (width x 5)."""
        return self.width * ROWS

    @property
    def layout(self) -> list[dict]:
        """The lamp's modules in chain order from the base, for the previews
        (the light's matrix_modules attribute): each its type and the
        frame's first column of the 5 it covers (a spot: one light, the
        colour of those 5 columns, to_wire). Those past the columns shown (a
        factory list's spot slots) are left out. Empty for a Cube Lite."""
        chain = self.chain
        kinds = self.module_types or (TOPOLOGY_MATRIX,) * len(chain)
        out = []
        for index, kind in enumerate(kinds[:len(chain)]):
            column = index * MODULE_SIZE
            if column >= self.columns:
                break
            out.append({"type": TOPOLOGY_NAMES.get(kind, "matrix"), "column": column})
        return out

    @property
    def module_names(self) -> list[str]:
        """Every module the lamp lists, in chain order from the base, by name
        (the set_matrix_modules names; the light's matrix_module_list
        attribute, the cards' Modules section): those layout leaves out
        (spot slots past the frame's last column) too. Empty for a Cube Lite."""
        if self.key != CUBEMATRIX:
            return []
        return [TOPOLOGY_NAMES.get(kind, "matrix")
                for kind in self.module_types or (TOPOLOGY_MATRIX,) * self.modules]

    @property
    def factory_modules(self) -> bool:
        """A Cube Matrix still on FACTORY_TOPOLOGY (never set in the app)."""
        return self.key == CUBEMATRIX and tuple(self.module_types) == FACTORY_TOPOLOGY

    @property
    def orientation(self) -> str | None:
        """The Device Orientation the lamp's rotation_angle names (Cube
        Matrix), None for a Cube Lite (its own: Matter, the user)."""
        if self.key != CUBEMATRIX:
            return None
        return MATRIX_ROTATION_ORIENTATIONS.get(self.rotation)

    def to_wire(self, frame):
        """A lamp-order frame (COLS x ROWS) as this model's update_leds takes it
        (also the order of a Cube Matrix drawing's data, light_matrix)."""
        if self.key != CUBEMATRIX:
            return frame
        black = (0, 0, 0)
        width, shown = self.width, self.columns
        wire = []
        column = 0
        for leds in self.chain:
            if column >= shown:
                # A module past the columns shown (a factory list's spot
                # slots, not fitted): dark.
                wire.extend([black] * leds)
                continue
            if leds != BLOCK_LEDS:
                # A spot: one light (its first LED; filmed 2026-11-14, the
                # other four light nothing) in a block's place: the colour of
                # its 5 columns, so what moves along the lamp passes through
                # it.
                wire.append(_spot_colour(frame, column, width))
                wire.extend([black] * (leds - 1))
                column += MODULE_SIZE
                continue
            # A block: its 5 columns, each bottom to top (the wiring).
            for _ in range(MODULE_SIZE):
                for row in range(ROWS):
                    index = row * width + column
                    wire.append(frame[index] if index < len(frame) else black)
                column += 1
        wire.extend([black] * max(0, self.wire_length - len(wire)))
        return wire


    def drawing_pixels(self, wire):
        """A frame in wire order (to_wire's) as the lamp's drawing's pixels
        (Matter, matrix_effects.drawing_data). A Cube Matrix: 25 pixels a
        block and one a spot slot (the Yeelight app's layout). A Cube Lite:
        its 100 pixels column by column from the base, each column from the
        bottom (``column * 5 + row``), whereas update_leds takes them row by
        row (filmed 2026-11-16: the same pixels, both ways, gave the same
        picture and the same colours)."""
        if self.key != CUBEMATRIX:
            black = (0, 0, 0)
            return [
                wire[row * COLS + column] if row * COLS + column < len(wire) else black
                for column in range(COLS) for row in range(ROWS)
            ]
        pixels, start = [], 0
        for leds in self.chain:
            pixels.extend(wire[start:start + leds] if leds == BLOCK_LEDS else wire[start:start + 1])
            start += leds
        return pixels


CUBE_LITE_PROFILE = DeviceProfile(
    key=CUBELITE, name="Cube Lite",
    native_effects=True, lamp_settings=True, matter=True, microphone=True,
    answers_get_prop=False,
)


def _spot_colour(frame, column: int, width: int = COLS) -> tuple:
    """A spot's colour: the 5 columns it covers from ``column`` (of a panel
    ``width`` wide) as one light, their average colour as bright as their
    brightest pixel, so a dot passing through lights it fully and a field
    shows its blend; black when they are."""
    pixels = [frame[row * width + side] for side in range(column, min(width, column + MODULE_SIZE))
              for row in range(ROWS) if row * width + side < len(frame)]
    peak = max((max(pixel[:3]) for pixel in pixels), default=0)
    if not peak:
        return (0, 0, 0)
    total = [sum(pixel[channel] for pixel in pixels) for channel in range(3)]
    top = max(total)
    return tuple(min(255, (value * peak + top // 2) // top) for value in total)


def model_key(model: str | None) -> str | None:
    """The profile key of an SSDP / get_capabilities model string."""
    text = (model or "").strip().lower().replace("_", "").replace("-", "")
    if "cubematrix" in text:
        return CUBEMATRIX
    if "cubelite" in text or text == "clt" or text.startswith("clt"):
        return CUBELITE
    return None


def parse_topology(value) -> list[int]:
    """cube_topology as module types: the leading non-zero entries (as
    Yeelight Station reads it: YeeDaemonConnectLib, the list stops at the
    first 0)."""
    modules = []
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            kind = int(part)
        except ValueError:
            break
        if kind == TOPOLOGY_NONE:
            break
        modules.append(kind)
    return modules


def _rotation(value) -> int:
    try:
        rotation = int(value)
    except (TypeError, ValueError):
        return 0
    return rotation if 0 <= rotation <= 3 else 0


def cube_matrix_profile(support=(), topology=None, strip_length=None, rotation=None) -> DeviceProfile:
    """A Cube Matrix's profile from its support: list and get_prop answers.

    The slots follow cube_topology (25 LEDs a block, 5 a type-3 slot, as the
    lamp counts them), up to TOPOLOGY_SLOTS. Without a topology: strip_lenth's
    25-LED blocks, else 4. The lamp
    filmed 2026-11-08 reports "1,1,1,1,3,3" and 110: 4 blocks, then two
    5-LED slots not fitted (docs/CUBE_MATRIX.md)."""
    entries = parse_topology(topology)[:TOPOLOGY_SLOTS]
    try:
        length = int(strip_length) if strip_length not in (None, "") else None
    except (TypeError, ValueError):
        length = None
    if entries:
        slots = tuple(SPOT_LEDS if kind == TOPOLOGY_SPOT else BLOCK_LEDS for kind in entries)
    else:
        blocks = min(TOPOLOGY_SLOTS, max(1, length // BLOCK_LEDS)) if length else COLS // MODULE_SIZE
        slots = (BLOCK_LEDS,) * blocks
    # The blocks (5 x 5 pixels) among them.
    modules = sum(1 for leds in slots if leds == BLOCK_LEDS)
    return DeviceProfile(
        key=CUBEMATRIX, name="Cube Matrix",
        native_effects=False, lamp_settings=False, matter=False, microphone=False,
        answers_get_prop=True,
        modules=modules,
        slots=slots,
        wire_length=max(length or 0, sum(slots)),
        support=frozenset(support or ()) or CUBEMATRIX_SUPPORT,
        max_fps=CUBEMATRIX_MAX_FPS,
        matter_product=CUBE_MATRIX_PRODUCT,
        raw_colours=True,
        rotation=_rotation(rotation),
        module_types=tuple(entries),
    )


def profile_for(
    model: str | None, support=(), topology=None, strip_length=None, rotation=None,
) -> DeviceProfile:
    """The profile of a lamp reporting ``model`` (the Cube Lite when unknown:
    every entry made before models were told apart is one)."""
    if model_key(model) == CUBEMATRIX:
        return cube_matrix_profile(support, topology, strip_length, rotation)
    return CUBE_LITE_PROFILE
