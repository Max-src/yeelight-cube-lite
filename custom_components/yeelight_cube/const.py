DOMAIN = "yeelight_cube"
CONF_IP = "Light IP Address"
CONF_DEVICE_ID = "device_id"

# The lamp's LAN Control port (TCP; its UDP session: udp_session.UDP_PORT).
LAN_PORT = 55443
# How long a reachability probe waits for the lamp (adding it, setting it
# up): generous, it may still be booting.
PROBE_TIMEOUT = 3.0

# Native clock definitions from the Yeelight app (formerly Yeelight
# Station).
# Each entry maps the app's clock style ID to the effect segment parameters
# the Cube Lite lamp runs.
NATIVE_CLOCK_EFFECT_ID = 40
# The Yeelight app uses apply=2 for the clock renderer. apply=4 is reserved for
# regular preset animations and leaves mode 40 selected without activating it.
NATIVE_CLOCK_APPLY = 2
# Clock styles. Entries with ``mixer`` use one of the lamp's gradients/palettes;
# entries with ``color`` use a single ARGB integer (e.g. 0x01FFEE00).
# The user can override the color on any style by setting ``_native_clock_color``;
# when unset, the style's own color (if any) is used.
NATIVE_CLOCK_STYLES = {
    1: {"name": "Rainbow", "mixer": 39},
    2: {"name": "Waves", "mixer": 42},
    3: {"name": "Spectrum", "mixer": 17},
    4: {"name": "White", "mixer": 0, "color": 33554430},
    5: {"name": "Mint", "mixer": 0, "color": 261958},
    6: {"name": "Yellow", "mixer": 0, "color": 33553920},
    7: {"name": "Pink", "mixer": 0, "color": 33447330},
    8: {"name": "Red", "mixer": 0, "color": 33423360},
    9: {"name": "Cyan", "mixer": 0, "color": 12046834},
    10: {"name": "Purple", "mixer": 0, "color": 16263678},
    11: {"name": "Rainbow noise", "mixer": 54},
    12: {"name": "Night-amber waves", "mixer": 57},
    13: {"name": "Night-sky waves", "mixer": 59},
    14: {"name": "Navy-white noise", "mixer": 58},
    15: {"name": "Violet interference", "mixer": 56},
}
DEFAULT_NATIVE_CLOCK_STYLE = 6

# Clock styles whose ``mixer`` is a standalone native effect are
# handled by CLOCK_MIXER_EFFECTS, derived after the native-effect tables are
# built (see below). The direction sent when the selected one does not apply;
# the lamp keeps the same background whatever is sent (lamp_clock_settings).
CLOCK_MIXER_EFFECT_DIRECTION = "Down"

# Clock content mode -> data byte 0 of the clock payload:
#   1 = time only, 2 = alternate time+date, 3 = date only
# (byte0 == 0 blanks the panel; 4+ do nothing on the lamp.)
NATIVE_CLOCK_CONTENT_BYTE = {"time": 1, "time_date": 2, "date": 3}
DEFAULT_NATIVE_CLOCK_CONTENT = "time"
# Ordered options + display labels for the Clock Content select entity.
NATIVE_CLOCK_CONTENT_OPTIONS = ("time", "time_date", "date")
NATIVE_CLOCK_CONTENT_LABELS = {
    "time": "Time",
    "time_date": "Time & Date",
    "date": "Date",
}

# Native animation definitions from the Yeelight app's
# Cube Lite device configuration. ``mode`` is the lamp's renderer while
# ``effect_id`` selects the effect family. The four app-level GIF effects
# (Winter, Dream, Halloween, and Moonlight) are intentionally omitted: they
# require the Matter-only sendGifDataFragment command before activation and
# cannot be selected correctly through the private LAN protocol.
NATIVE_EFFECT_APPLY = 4
NATIVE_EFFECT_DIRECTIONS = ("Up", "Down", "Left", "Right")
NATIVE_EFFECT_DIRECTION_VALUES = {
    "Up": 0,
    "Down": 1,
    "Left": 2,
    "Right": 3,
}
# Some effects render a direction differently than the lamp's nominal
# direction value. A ``direction_remap`` translates the user-facing direction
# label to the value actually sent to the lamp, so the physical animation
# matches the on-screen arrow / preview. Verified on real hardware.
_SWAP_UP_DOWN = {"Up": "Down", "Down": "Up"}
# Tide has no flow: the direction lays its box on the panel. Lamp direction
# 0 is the picture it always showed here (sent no direction, and Right is the
# default mount), 1 that picture turned 180 degrees, 2 and 3 the box turned 90
# degrees (the lamp's pixel mapping; not yet checked by eye on a lamp).
_TIDE_DIRECTIONS = {"Right": "Up", "Left": "Down", "Up": "Left", "Down": "Right"}

NATIVE_EFFECTS = {
    "Ribbon": {"effect_id": 3, "mode": 3, "speed": True},
    "Starry Sky": {"effect_id": 5, "mode": 5, "speed": True, "intensity": True, "color": 255},
    "Spectrum": {"effect_id": 17, "mode": 17, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Waves": {"effect_id": 42, "mode": 42, "speed": True, "intensity": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Rainbow": {"effect_id": 39, "mode": 39, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Waterfall": {"effect_id": 32, "mode": 32, "speed": True, "intensity": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN, "color": 255},
    "Aurora": {"effect_id": 15, "mode": 15, "speed": True, "intensity": True, "directions": NATIVE_EFFECT_DIRECTIONS, "color": 16842496},
    "Fire": {"effect_id": 34, "mode": 34, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": {"Right": "Down", "Down": "Right", "Left": "Up", "Up": "Left"}},
    "Bouncing Ball": {"effect_id": 37, "mode": 37, "speed": True, "intensity": True},
    "Meteor": {"effect_id": 47, "mode": 47, "speed": True, "intensity": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Tide": {"effect_id": 48, "mode": 48, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _TIDE_DIRECTIONS},
    "Building Blocks": {"effect_id": 49, "mode": 49, "speed": True, "intensity": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN, "color": 16777471},
    "Hacking": {"effect_id": 46, "mode": 46, "speed": True, "directions": ("Up", "Down")},
    "Flower Sea": {"effect_id": 91, "mode": 55, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
    "Magic": {"effect_id": 92, "mode": 76, "speed": True},
    "Wonderland": {"effect_id": 94, "mode": 77, "speed": True},
    "Kaleidoscope": {"effect_id": 95, "mode": 80, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS, "direction_remap": _SWAP_UP_DOWN},
    "Palette": {"effect_id": 96, "mode": 81, "speed": True, "directions": NATIVE_EFFECT_DIRECTIONS},
}
DEFAULT_NATIVE_EFFECT = "Ribbon"
# The direction effects run until another is chosen, for the viewer, on any
# mount: one setting shared by all of them, like the speed. An effect that does
# not offer it runs its first direction.
DEFAULT_NATIVE_EFFECT_DIRECTION = "Right"
# The speed before one is chosen: the rate of every preset row, what an effect
# runs at when the app starts it. Speed is one setting shared by all effects,
# 0-255 (every effect takes 0; a slot's highest is LAMP_RATE_LIMITS).
DEFAULT_NATIVE_EFFECT_SPEED = 128
SPEED_RANGE = (0, 255)
# The direction an effect offered none is sent: its preset row's. Sent, not left
# out, so that like any other it is compensated for the lamp's mount profile
# (light_native.lamp_direction) and draws what its preview shows on every lamp.
UNDIRECTED_EFFECT_DIRECTION = 0

# The lamp's animation slots: it has 82 of them (0-81) and does not check a
# mode against that count, so a higher mode runs something undefined: never
# send one. Slots 12, 13, 29 and 78 are empty: nothing is drawn.
LAMP_ANIMATION_SLOTS = 82
LAMP_EMPTY_SLOTS = frozenset({12, 13, 29, 78})
# Slots that show nothing worth offering as an effect or a clock style: the
# empty ones; 36, 64 and 67, pictures that need a data block these commands do
# not carry (and a clock would read its own settings as one); 50, the pixel
# stream behind direct mode; 53, which draws nothing and leaves the last frame.
# freeze_display relies on that last case of slot 64: not offering it here does
# not change that command.
LAMP_DEAD_END_SLOTS = LAMP_EMPTY_SLOTS | {36, 50, 53, 64, 67}
# Plays the GIF kept in the lamp's storage, which nothing can read back: the one
# slot no preview can draw.
LAMP_STORED_GIF_SLOT = 71
# The highest rate these slots can take: a higher one divides by zero on their
# first frame. Mode 40 hands over to its mixer with the same rate, so a clock
# background is limited too.
LAMP_RATE_LIMITS = {28: 254, 51: 239}


def lamp_rate(mode: int, rate: int) -> int:
    """The rate to send for the lamp's slot ``mode``. Speed is shared by every
    effect, so a slot's limit applies when sending, not to the saved value."""
    return min(rate, LAMP_RATE_LIMITS.get(mode, rate))


# Intensity: the second setting of an effect, beside its speed. What it sets
# depends on the slot (below). One setting shared by all effects, like the
# speed, 0-255; an effect that does not read it is sent none, so its preset
# row's applies (128 for every effect the integration sends).
DEFAULT_NATIVE_EFFECT_INTENSITY = 128
INTENSITY_RANGE = (0, 255)
# The slots whose renderer reads the intensity as an amount, and what it sets:
#   4 pattern scale              5 how often stars appear   6 trail length
#   7 bar length                 9 pulse width              11 wavelength and blur
#   14, 23 trail length          15 number of glows         18 colour spread
#   28 blur                      32 how often drops start   37 vertical speed
#   42 wave size                 47 number of meteors       49 trail fade
#   60 flicker                   61 number of glows, blur   70 stripe width
#   25, 26, 30, 43, 45, 51, 73   how strongly the bars follow the music
# Not 1 and 3: they read it as a switch (below 128 another colour source), not
# an amount. Effects not listed draw the same at any intensity.
LAMP_INTENSITY_SLOTS = frozenset({
    4, 5, 6, 7, 9, 11, 14, 15, 18, 23, 25, 26, 28, 30, 32, 37, 42, 43, 45, 47,
    49, 51, 60, 61, 70, 73,
})
# The lowest intensity these slots can take: below, Aurora (15) draws no glow
# and the lamp hangs, and Palette stripes (70) divides by zero and restarts.
# Under the clock the background's own limit applies.
LAMP_INTENSITY_MINIMUMS = {15: 13, 70: 1}


def lamp_intensity(mode: int, intensity: int) -> int:
    """The intensity to send for the lamp's slot ``mode``: shared by every
    effect, so a slot's limit applies when sending, not to the saved value."""
    low, high = INTENSITY_RANGE
    intensity = max(low, min(high, int(intensity)))
    return max(intensity, LAMP_INTENSITY_MINIMUMS.get(mode, intensity))


# "Extended" native effects: built-in animation ``mode`` values that exist in
# the Cube Lite hardware but were never exposed as selectable effects in the
# official Yeelight app. Reached by sending effect_id 3 with the mode, e.g.
# [3, 0, 4, {"mode": 58, "onoff": 1, "rate": 50, "direction": 2}] (the
# full-panel form of the clock gradient mixer 58). We expose every slot that
# isn't a dead end, already an official effect, or the clock renderer. Hidden
# behind the "Experimental Features" switch.
_OFFICIAL_EFFECT_MODES = {spec["mode"] for spec in NATIVE_EFFECTS.values()} | {
    NATIVE_CLOCK_EFFECT_ID
}
# The extended effects' names: the lamp's own (an effect the app sends as a
# preset has its preset name, any other its slot name).
# A clock style backed by one of these slots shares its name.
_EXTENDED_EFFECT_NAMES = {
    1: "Two-colour alternation",
    2: "Breathing",
    4: "Moving palette",
    6: "Particle path",
    7: "Dual scan",
    8: "Rotating colour bands",
    9: "Triangular palette pulses",
    10: "Fireworks",
    11: "Sine wave",
    14: "Palette trails",
    16: "Drop and bounce",
    18: "Sunrise and sunset",
    19: "Heat fire",
    20: "Music level glow",
    21: "Stacking blocks",
    22: "Mirrored comets",
    23: "Aqua-lime trails",
    24: "Palette sparks",
    25: "Music bars from both ends",
    26: "Music bars from the centre",
    27: "Music bass-mid-treble colour",
    28: "Scrolling bands",
    30: "Music bar from one end",
    31: "Palette cross-fade",
    33: "Rising wisps",
    35: "Tide (slot 35)",
    38: "Sine plotter",
    41: "Music Spectrum",
    43: "Music Gather",
    44: "Music Breathing",
    45: "Music Blossom",
    51: "Music noise equalizer",
    52: "Solid red",
    54: "Rainbow noise",
    56: "Violet interference",
    57: "Night-amber waves",
    58: "Navy-white noise",
    59: "Night-sky waves",
    60: "Flicker sweep",
    61: "Particle glows",
    62: "Dot with fading trail",
    63: "Centre bursts",
    65: "Rainbow fill-in (one-shot)",
    66: "Rainbow wipe-out (one-shot)",
    68: "White fill-in (one-shot)",
    69: "White wipe-out (one-shot)",
    70: "Palette stripes",
    71: "Stored GIF",
    72: "Random scatter",
    73: "Music Note",
    74: "Music Impact",
    75: "Neon sine bands",
    79: "Violet twinkles",
}
# The slots named by their bare number until 1.4.0 (no curated name before the
# lamp's): that number is still read as their name (NATIVE_EFFECT_ALIASES).
# Otherwise they are effects like the others.
FORMERLY_NUMBERED_SLOTS = frozenset({
    1, 2, 7, 8, 14, 16, 20, 21, 23, 25, 26, 27, 28, 30, 31, 33, 38, 41, 43, 44,
    45, 51, 52, 62, 63, 65, 66, 68, 69, 71, 72, 73, 74,
})
# Slots whose renderer takes no rate: no speed is offered or sent, the preset row's applies.
# The stored GIF (71) plays at the GIF's own pace.
_EXTENDED_EFFECT_NO_SPEED = {
    20, 24, 27, 33, 38, 44, 52, 54, 56, 58, 59, 65, 66, 68, 69, 70, 71, 72, 73,
}
_EXTENDED_EFFECT_SPEED = {mode: False for mode in _EXTENDED_EFFECT_NO_SPEED}
# Slots offered no direction (UNDIRECTED_EFFECT_DIRECTION): their renderer
# reads none (1, 2, 20, 27, 44, 52, 59, 63), reads it only to route the
# pixels of a partial segment, which a full panel cancels (31, 57), or only
# moves where a random scatter falls, which stays a random scatter (72). Neon's
# preview is drawn on that box; 1 and 3 would turn the picture on a default
# mount.
_EXTENDED_EFFECT_NO_DIRECTION = {1, 2, 20, 27, 31, 44, 52, 57, 59, 63, 72, 75}
# Slots that draw their colours (up to 4) and show white without them:
# the lamp's defaults, sent as the color list (light_native), with a
# clock over them too (clock_style_colors). Two
# colours alternate (1); four bands, never fewer colours, or the rest are black
# (8, 28); wisps over black (33); a scatter of four colours (72).
_EXTENDED_EFFECT_COLORS = {
    1: (0x01FF563D, 0x01427BF4),
    8: (0x01FF563D, 0x01FFD044, 0x0126CD94, 0x01427BF4),
    28: (0x01FF563D, 0x01FFD044, 0x0126CD94, 0x01427BF4),
    33: (0x01FF563D,),
    72: (0x01FF3010, 0x0110FF40, 0x012050FF, 0x01E0C0A0),
}
# Some lamp modes only unlock their full (colored) renderer when the outer
# set_fx_effect command id (the first array element) is a specific value rather
# than the default. Fireworks (mode 10) shows white-only particles under the
# clock command id 40; command id 71 enables the colored confetti burst. Keyed
# by the lamp's mode (which equals a clock style's ``mixer``).
_EXTENDED_EFFECT_IDS = {10: 71}
# The outer id of every other effect the Yeelight app does not offer. The
# lamp reports it as the effect playing, and the app highlights the effect of
# that id: 3 showed Ribbon. 63 is no effect of the app's, and its preset gives
# a command that sends its own mode the same defaults as 3 (colour selector 0,
# intensity and rate 128, direction 0).
EXTENDED_EFFECT_COMMAND_ID = 63
# Public view used by the clock builder to override the command id per mixer.
CLOCK_MIXER_COMMAND_IDS = dict(_EXTENDED_EFFECT_IDS)

# The lamp's "color mode" palette presets for the clock (and compatible native
# effects). Forcing the outer set_fx_effect command id (first array element) to
# one of these ids remaps the effect's palette; ``None`` = normal (each effect
# keeps its own colors). Which effects
# actually respond varies per effect and is verified on hardware.
CLOCK_COLOR_MODES = {
    "normal": None,
    "bw": 15,
    "red_blue": 64,
    "white_orange": 65,
    "blue_yellow": 66,
    "purple_orange": 67,
}
DEFAULT_CLOCK_COLOR_MODE = "normal"
# The native effects' own color mode: the lamp's palette (its text colors,
# chosen with load_palette or set_text_colors), followed when it changes. It
# is no lamp preset: the colors are sent (lamp_renderers.palette_words).
PALETTE_COLOR_MODE = "palette"
NATIVE_COLOR_MODES = (*CLOCK_COLOR_MODES, PALETTE_COLOR_MODE)
EXTENDED_NATIVE_EFFECTS = {
    _EXTENDED_EFFECT_NAMES[mode]: {
        "effect_id": _EXTENDED_EFFECT_IDS.get(mode, EXTENDED_EFFECT_COMMAND_ID),
        "mode": mode,
        "speed": _EXTENDED_EFFECT_SPEED.get(mode, True),
        **({"intensity": True} if mode in LAMP_INTENSITY_SLOTS else {}),
        **({} if mode in _EXTENDED_EFFECT_NO_DIRECTION else {"directions": NATIVE_EFFECT_DIRECTIONS}),
        **({"colors": _EXTENDED_EFFECT_COLORS[mode]} if mode in _EXTENDED_EFFECT_COLORS else {}),
        "extended": True,
    }
    for mode in range(1, LAMP_ANIMATION_SLOTS)
    if mode not in _OFFICIAL_EFFECT_MODES and mode not in LAMP_DEAD_END_SLOTS
}

# The families the effects gallery filters by (www/effect-families.js), by what
# an effect looks like, per lamp slot so a renamed effect keeps its family.
EFFECT_FAMILIES = {
    "waves": (1, 2, 3, 4, 8, 9, 11, 18, 28, 31, 39, 42, 56, 57, 59, 75),
    "glow": (15, 19, 33, 34, 54, 55, 58, 76, 77, 80, 81),
    "sparkles": (5, 6, 10, 24, 60, 61, 63, 79),
    "motion": (7, 14, 16, 21, 22, 23, 32, 35, 37, 38, 46, 47, 48, 49, 62, 65, 66, 68, 69),
    "music": (20, 25, 26, 27, 30, 41, 43, 44, 45, 51, 73, 74),
    "still": (17, 52, 70, 71, 72),
}
# The slots the lamp treats as music (but slot 29, which is empty): their first frame
# starts the lamp's microphone, unless the fx-mode flag is set
# (cube_matrix.clear_fx_mode_flag). Music Flow runs some of them too.
LAMP_MUSIC_SLOTS = frozenset({20, 25, 26, 27, 30, 41, 43, 44, 45, 51, 73, 74})
EFFECT_FAMILY_OF_SLOT = {
    mode: family for family, modes in EFFECT_FAMILIES.items() for mode in modes
}

# All selectable native effects (official + extended). Spec lookups (activation,
# direction, speed) use this so a selected extended effect resolves; the select
# entity decides which names are actually offered based on the switch.
ALL_NATIVE_EFFECTS = {**NATIVE_EFFECTS, **EXTENDED_NATIVE_EFFECTS}

# Extended clock styles: expose every native-effect mode that isn't already a
# clock mixer as a selectable clock background, so any built-in animation can
# back the clock when Experimental Features is on. Named like the effect.
# style_id continues the built-in sequence; the lamp drives the background
# from the ``mixer`` field.
_MODE_TO_EFFECT_NAME = {
    spec["mode"]: name for name, spec in ALL_NATIVE_EFFECTS.items()
}
# Effect modes that must not back the clock: some (mode 60, Flicker sweep)
# go fully dark for long stretches each cycle, so the masked characters would
# vanish; others (Hacking, Meteor, Building Blocks, Palette) are
# combinations the hardware rejects outright when sent as the clock's mixer.
_NON_CLOCK_EFFECT_MODES = {60, 46, 47, 49, 81}
# Backgrounds set up in their own first frame. Mode 40 spends that frame handing
# over to its mixer, so under it these never run it, and each activation starts
# them on a new, empty animation buffer: Palette sparks (24) keeps its spark
# count in a global only that frame resets, so it comes back with as few sparks
# as 50 minus the last count (none to about 4, after it or any clock over it
# ran), and 66, 69, 72 stay black. 33, 46, 47, 49, 60 and 81 set up their
# state in that frame, so
# under mode 40 they run without it and can upset the lamp (49 is harmless), and
# 71 hangs. Sent as themselves under mixer 1, the clock overlay
# that mode 40 would set, they run that frame and the clock looks the same. The
# lamp keeps a mode 40 record's direction at 0: these are sent none. Listing a
# mode here does not offer it: ``_NON_CLOCK_EFFECT_MODES`` still applies.
CLOCK_DIRECT_BACKGROUNDS = frozenset({24, 33, 46, 47, 49, 60, 66, 69, 71, 72, 81})


def clock_segment_modes(background: int) -> dict:
    """The mode and mixer bytes that run the clock over ``background``."""
    if background in CLOCK_DIRECT_BACKGROUNDS:
        return {"mode": background, "mixer": 1}
    return {"mode": NATIVE_CLOCK_EFFECT_ID, "mixer": background}


# Clock styles whose ``mixer`` is a standalone native effect: the lamp
# runs that effect across the whole panel and lets its color through only on
# the lit time/date pixels, so the characters animate with the effect. The
# preview reproduces this by running the lamp's renderer and masking it to
# the glyph pixels. Every effect qualifies; direction-less effects simply omit
# the sweep. Excluded: effects that go mostly black or that the hardware rejects
# (``_NON_CLOCK_EFFECT_MODES``, Hacking among them), and the stored GIF, which
# no preview can draw: a clock over it is sent its color and no palette, as a
# solid style is.
CLOCK_MIXER_EFFECTS = {
    spec["mode"]: name
    for name, spec in ALL_NATIVE_EFFECTS.items()
    if spec.get("directions") in (None, NATIVE_EFFECT_DIRECTIONS)
    and spec["mode"] not in _NON_CLOCK_EFFECT_MODES
    and spec["mode"] != LAMP_STORED_GIF_SLOT
}
_BASE_CLOCK_MIXERS = {style["mixer"] for style in NATIVE_CLOCK_STYLES.values()}
_next_clock_style_id = max(NATIVE_CLOCK_STYLES) + 1
for _clock_mode in range(1, LAMP_ANIMATION_SLOTS):
    if (
        _clock_mode in _BASE_CLOCK_MIXERS
        or _clock_mode == NATIVE_CLOCK_EFFECT_ID
        or _clock_mode in _NON_CLOCK_EFFECT_MODES
    ):
        continue
    # A dead end takes its id all the same: saved styles are ids, the others
    # keep theirs (clock-preview-utils.js counts them the same way).
    if _clock_mode not in LAMP_DEAD_END_SLOTS:
        NATIVE_CLOCK_STYLES[_next_clock_style_id] = {
            "name": _MODE_TO_EFFECT_NAME[_clock_mode],
            "mixer": _clock_mode,
        }
    _next_clock_style_id += 1

# Every clock style beyond the lamp's 10 built-ins is experimental.
EXPERIMENTAL_CLOCK_STYLE_IDS = frozenset(
    style_id for style_id in NATIVE_CLOCK_STYLES if style_id > 10
)

# The lamp's stored GIF, as an effect: its name, offered like the official
# effects (it plays over LAN whatever the lamp holds: an animation of ours, or
# the Yeelight app's last one). Sent as effect 71, as the Yeelight app plays
# it: the lamp then reports 71, the one id for which the app reads the custom
# id to show which of its GIFs plays (sent as 3 with slot 71, the lamp shows
# the same GIF but reports 3).
STORED_GIF_EFFECT = _MODE_TO_EFFECT_NAME[LAMP_STORED_GIF_SLOT]
ALL_NATIVE_EFFECTS[STORED_GIF_EFFECT] = EXTENDED_NATIVE_EFFECTS[STORED_GIF_EFFECT] = {
    **EXTENDED_NATIVE_EFFECTS[STORED_GIF_EFFECT], "extended": False,
    "effect_id": LAMP_STORED_GIF_SLOT,
}
# The animations this integration made (lamp_animations.py; their frames are
# www/lamp-animations.js, the names there too): each plays as the stored GIF
# once it is uploaded over Matter (light_native._store_animation), so they are
# offered only while a server delivers the Yeelight commands. The lamp keeps
# one GIF; switching between them uploads again. Added after the tables keyed
# by slot above: they share slot 71 with the stored GIF. Each stands for one
# of the Yeelight app's four GIF tiles (Winter, Dream, Halloween, Moonlight)
# and is played with its id (app_tile, the command's custom id), so the app
# shows that tile as the one playing; the id does not choose the GIF, the
# lamp plays the one it stores.
# How an animation is laid out in the GIF the lamp stores: upright (turned so
# the viewer sees it as drawn, for the lamp's mount), or as the Yeelight app
# sends its own GIFs (the picture as it is, which the lamp shows rearranged,
# like the app's). The Animation layout select (light._animation_layout).
ANIMATION_LAYOUT_UPRIGHT = "upright"
ANIMATION_LAYOUT_APP = "app"
ANIMATION_LAYOUTS = {
    ANIMATION_LAYOUT_UPRIGHT: "Upright",
    ANIMATION_LAYOUT_APP: "As the Yeelight app",
}
DEFAULT_ANIMATION_LAYOUT = ANIMATION_LAYOUT_UPRIGHT
LAMP_ANIMATION_EFFECTS = {
    # Drawn upright for the lamp's mount: no direction.
    name: {
        "effect_id": ALL_NATIVE_EFFECTS[STORED_GIF_EFFECT]["effect_id"],
        "mode": LAMP_STORED_GIF_SLOT, "speed": False, "extended": False,
        "animation": key, "family": family, "app_tile": app_tile,
    }
    for name, key, family, app_tile in (
        ("Snowfall", "snowfall", "sparkles", 77),
        ("Daydream", "daydream", "waves", 79),
        ("Halloween glow", "halloween_glow", "glow", 72),
        ("Moonlit clouds", "moonlit_clouds", "glow", 93),
    )
}
ALL_NATIVE_EFFECTS.update(LAMP_ANIMATION_EFFECTS)


def effect_family(spec: dict) -> str:
    """An effect's family (EFFECT_FAMILIES): its slot's, or its own."""
    return spec.get("family") or EFFECT_FAMILY_OF_SLOT[spec["mode"]]

# What keeps an effect flowing the same way for the viewer once the lamp is
# turned: mount -> the lamp direction to send for each one a lamp on the
# default mount is sent. The lamp's own turn: on its panel direction 0 flows
# down, 1 up, 2 right and 3 left, and a mount turns what
# the viewer sees by a quarter turn a step clockwise (MOUNT_QUARTER_TURNS). It
# works on lamp values, not labels: a label names a different value on each
# effect (direction_remap), and they do not all turn the same way round.
MOUNT_DIRECTION_VALUES = {
    "right": (0, 1, 2, 3),
    "down": (2, 3, 1, 0),
    "left": (1, 0, 3, 2),
    "up": (3, 2, 0, 1),
}

# Clock-mixer effects whose built-in clock always renders the background in a
# fixed orientation, ignoring the selected native-effect direction.
CLOCK_MIXER_FIXED_DIRECTION = {
    "Tide": "Right",
    "Particle path": "Up",
    "Triangular palette pulses": "Up",
    "Sine wave": "Left",
    "Heat fire": "Up",
    "Mirrored comets": "Right",
    "Sunrise and sunset": "Up",
    "Tide (slot 35)": "Right",
    "Palette stripes": "Right",
    "Particle glows": "Right",
}


def effect_direction_value(spec, direction, orientation=None):
    """The lamp's ``direction`` value (0-3) for a direction label on a native
    effect, through its ``direction_remap`` (some effects render a direction
    differently than the lamp's nominal value; verified on the lamp), turned
    for a lamp mounted ``orientation`` so the viewer sees the same direction. An
    effect that does not offer the turned value (Hacking runs along one axis)
    keeps its own."""
    remap = spec.get("direction_remap") or {}
    value = NATIVE_EFFECT_DIRECTION_VALUES[remap.get(direction, direction)]
    turned = MOUNT_DIRECTION_VALUES.get(orientation, MOUNT_DIRECTION_VALUES["right"])[value]
    offered = {
        NATIVE_EFFECT_DIRECTION_VALUES[remap.get(label, label)]
        for label in spec.get("directions", ())
    }
    return turned if turned in offered else value


# What update_fx_effect changes on a running native effect, live and without
# restarting it: its rate and direction, exactly as the lamp shows it frame by
# frame (an effect without a color). Everything else takes a
# full set_fx_effect (light_native.live_effect_changes):
# - the clock: any live update (its speed alone too) left it dark on the lamp;
# - an effect with a color: the update is not a single-field edit, the lamp
#   reads the whole segment again (a missing color is reset to its default),
#   and a custom color sent live (0x01RRGGBB)
#   left the clock dark: not verified on an effect either;
# - a color change, another effect or palette;
# - the intensity: several effects only read it when they start (how many
#   glows or meteors), so it is set in full and the effect starts again.
LIVE_EFFECT_KEYS = ("rate", "direction")


def resolve_clock_mixer_direction(direction, effect_name):
    """Return the direction label for a clock style's mixer effect, or None.

    A clock style whose mixer is a standalone native effect flows in the
    selected native-effect ``direction``. Returns None when the mixer has no
    direction-capable effect, so the ``direction`` byte can be left out
    and previews can fall back to the neutral default.
    """
    spec = ALL_NATIVE_EFFECTS.get(effect_name) if effect_name else None
    if not spec:
        return None
    directions = spec.get("directions")
    if not directions:
        return None
    fixed = CLOCK_MIXER_FIXED_DIRECTION.get(effect_name)
    if fixed in directions:
        return fixed
    if direction in directions:
        return direction
    if CLOCK_MIXER_EFFECT_DIRECTION in directions:
        return CLOCK_MIXER_EFFECT_DIRECTION
    return directions[0]


def clock_style_default_color(style):
    """Return the ARGB color a clock style sends by default, or None.

    A style's own ``color`` wins; otherwise, when its ``mixer`` is a native
    effect that carries a default color (e.g. Waterfall = 255), that color is
    used so the clock sends the same color the standalone effect does.
    """
    if style.get("color") is not None:
        return style["color"]
    mixer = style.get("mixer")
    mixer_effect = next(
        (spec for spec in ALL_NATIVE_EFFECTS.values() if spec.get("mode") == mixer),
        None,
    )
    return mixer_effect.get("color") if mixer_effect else None


def clock_style_colors(style, color=None):
    """Return the ARGB color list a clock style sends (empty: no color key).

    ``color`` is the clock's color (the user's custom one), else the style's
    default (clock_style_default_color). A mixer slot that draws its own
    colours (1, 8, 28, 33, 72: _EXTENDED_EFFECT_COLORS) is sent all of them, as
    its effect is (light_native._native_effect_params): the mode 40 hand-over,
    or the direct form of 33 and 72, runs that slot on them under the clock
    overlay, whose digits show the slot's picture. Without them it is white,
    and 8 and 28 draw a black band for each colour left out. The clock's color
    replaces the first colour. Any other style sends its color alone, or none.
    """
    if color is None:
        color = clock_style_default_color(style)
    mixer = style.get("mixer")
    mixer_effect = None if style.get("color") is not None else next(
        (spec for spec in ALL_NATIVE_EFFECTS.values() if spec.get("mode") == mixer),
        None,
    )
    words = tuple(mixer_effect.get("colors", ())) if mixer_effect else ()
    if color is not None:
        words = (color, *words[1:])
    return [int(word) for word in words]

# Device-microphone music flow definitions, as in the Yeelight app.
# The protocol deliberately spells palette as ``palatte`` in the JSON payload.
MUSIC_FLOW_EFFECTS = {
    "Gather": 83,
    "Breathing": 84,
    "Blossom": 85,
    "Spectrum": 86,
    "Music Note": 87,
    "Impact": 88,
}
MUSIC_FLOW_EFFECT_IDS = {
    effect_id: name for name, effect_id in MUSIC_FLOW_EFFECTS.items()
}
# The native music effects the microphone's music modes run (the same
# renderer: Gather is slot 43, Breathing 44, Blossom 45, Spectrum 41, Note 73,
# Impact 74). In the palette color mode they are started as that music mode,
# which takes a whole palette, instead of one color (light_native).
PALETTE_MUSIC_FLOWS = {
    "Music Gather": "Gather",
    "Music Breathing": "Breathing",
    "Music Blossom": "Blossom",
    "Music Spectrum": "Spectrum",
    "Music Note": "Music Note",
    "Music Impact": "Impact",
}
# A music mode's palette has 16 entries; the lamp fills a shorter one with
# black, which leaves Spectrum and Impact dark and Breathing dark most of the
# time, so a palette is spread over all 16 (lamp_renderers.music_palette).
MUSIC_PALETTE_SIZE = 16
# A music mode takes its direction over Matter (setDirection) once it runs,
# at the lamp's microphone-on report, or after this long without one: sent
# at once, some modes (Impact) stop and the lamp shows its saved effect.
PALETTE_MUSIC_DIRECTION_DELAY = 1.5
# The lamp direction a music mode starts in: then nothing follows.
MUSIC_MODE_START_DIRECTION = 0
DEFAULT_MUSIC_FLOW_EFFECT = "Breathing"
MUSIC_FLOW_DEFAULT_PALETTE = (
    0xFFFF3B30,
    0xFFFF6B35,
    0xFFFF9500,
    0xFFFFCC00,
    0xFFB7F321,
    0xFF34C759,
    0xFF00C7BE,
    0xFF32ADE6,
    0xFF0A84FF,
    0xFF5E5CE6,
    0xFF7D5FFF,
    0xFFAF52DE,
    0xFFFF2D55,
    0xFFFF375F,
    0xFFFF6B8A,
    0xFFFFFFFF,
)

# Every name a native effect had before (legacy names, and the names used
# until 1.4.0) -> its name today, flattened: no chains, and no current name is a
# key. Applied wherever an effect name comes in (services, select entities,
# saved state and storage, cards: www/effect-names.js keeps the same table).
# The bare slot numbers are names only where an effect name is expected: never
# where a number is a clock style id. Music Flow has its own names
# (MUSIC_FLOW_EFFECTS): this table never applies to them.
NATIVE_EFFECT_ALIASES = {
    # Official effects (the names until 1.4.0).
    "Streamer": "Ribbon",
    "Starry sky": "Starry Sky",
    "Ocean Waves": "Waves",
    "Bonfire": "Fire",
    "Pinball": "Bouncing Ball",
    "Shooting Star": "Meteor",
    "Building block": "Building Blocks",
    # Extended effects with a name until 1.4.0.
    "Rainbow Flow": "Moving palette",
    "Spectrum Chase": "Particle path",
    "Pastel Pulse": "Triangular palette pulses",
    "Monochrome Waves": "Sine wave",
    "Pulse": "Sunrise and sunset",
    "Solar Flare": "Heat fire",
    "Prism": "Mirrored comets",
    "Ember": "Palette sparks",
    "Color Trails": "Tide (slot 35)",
    "Sunset": "Rainbow noise",
    "Carousel": "Violet interference",
    "Blue Yellow": "Night-amber waves",
    "Ice Blue": "Navy-white noise",
    "Blue White": "Night-sky waves",
    "Spectrum Crumble": "Flicker sweep",
    "Drift": "Particle glows",
    "Spectrum Bands": "Palette stripes",
    "Neon": "Neon sine bands",
    "Twinkle": "Violet twinkles",
    # Older names.
    "Color Snakes": "Tide (slot 35)",
    # Slots named by their number until 1.4.0 (76 before Magic took it).
    **{str(mode): _EXTENDED_EFFECT_NAMES[mode] for mode in sorted(FORMERLY_NUMBERED_SLOTS)},
    "76": "Magic",
}


def canonical_effect_name(name):
    """A native effect's name today, from any name it ever had (an unknown
    name, or anything but a string, is returned as it is)."""
    return NATIVE_EFFECT_ALIASES.get(name, name) if isinstance(name, str) else name


# A clock style is named after the effect behind it (NATIVE_CLOCK_STYLES), so
# it was renamed with it: every former name of such a style -> its name today.
# Its bare number (an unnamed slot's style) included: never use this table
# where a number is a style id (set_clock_style reads a number as an id first).
CLOCK_STYLE_ALIASES = {
    alias: name
    for alias, name in NATIVE_EFFECT_ALIASES.items()
    if name in {style["name"] for style in NATIVE_CLOCK_STYLES.values()}
}


def canonical_clock_style_name(name):
    """A clock style's name today, from any name it ever had."""
    return CLOCK_STYLE_ALIASES.get(name, name) if isinstance(name, str) else name


# Clock style names that meant another style in data saved by 1.4.0 or
# earlier: there "Magic" was the style over slot 75 (style 77, Magic's slot
# then), which is Neon sine bands now; Magic is the style over slot 76. A style
# saved by id kept its picture; one saved by name keeps it through this, once:
# storage.py (favourites, rotation) and light_restore.py (button list).
CLOCK_STYLE_NAMES_IN_1_4 = {"Magic": "Neon sine bands"}


def clock_style_name_saved_by_1_4(name):
    """Today's name of a clock style named ``name`` in 1.4.0 or earlier: the
    saved name itself is looked up ("76" then was today's Magic, not the
    Magic of then)."""
    if not isinstance(name, str):
        return name
    if name in CLOCK_STYLE_NAMES_IN_1_4:
        return CLOCK_STYLE_NAMES_IN_1_4[name]
    return canonical_clock_style_name(name)


# A physical-button entry: a native effect's name, or "Clock: " and a clock
# style's name.
BUTTON_CLOCK_PREFIX = "Clock: "


def canonical_button_effect_name(name):
    """A physical-button entry (set_button_effects) in today's names."""
    if not isinstance(name, str):
        return name
    if name.startswith(BUTTON_CLOCK_PREFIX):
        return BUTTON_CLOCK_PREFIX + canonical_clock_style_name(
            name.removeprefix(BUTTON_CLOCK_PREFIX)
        )
    return canonical_effect_name(name)


# What the lamp does when its power comes back (set_ps cfg_init_power): the
# lamp reads 0 as "restore the previous state", 1 as "always on" and 2 as
# "always off" (verified after a power cut).
POWER_ON_STATES = {"Restore": 0, "Always on": 1, "Always off": 2}
DEFAULT_POWER_ON_STATE = "Always on"
# Labels saved by 1.3.5 and earlier, which named these values wrongly ("Off"
# sent 0, "Toggle" sent 2): read by the value the lamp actually received, so
# a lamp keeps doing what it did.
LEGACY_POWER_ON_STATES = {"Off": "Restore", "On": "Always on", "Toggle": "Always off"}

# Content sources and matrix render modes are intentionally separate. Clock is
# a built-in lamp experience; the remaining modes render the plugin's 20x5
# matrix content.
# Display modes the lamp renders itself (no frames from the plugin).
MODE_CLOCK = "Clock"
MODE_NATIVE_EFFECT = "Native Effect"
LAMP_MODES = (MODE_CLOCK, MODE_NATIVE_EFFECT)
# Display mode a clock / native-effect rotation runs in, by rotation kind.
ROTATION_KIND_MODES = {"clock": MODE_CLOCK, "native": MODE_NATIVE_EFFECT}

CONTENT_MODES = ("Matrix", MODE_CLOCK, MODE_NATIVE_EFFECT, "Music Flow")
MATRIX_DISPLAY_MODES = (
    "Solid Color",
    "Letter Gradient",
    "Column Gradient",
    "Row Gradient",
    "Angle Gradient",
    "Radial Gradient",
    "Letter Vertical Gradient",
    "Letter Angle Gradient",
    "Text Color Sequence",
    "Panel Color Sequence",
    "Custom Draw",
)
DEFAULT_MATRIX_DISPLAY_MODE = "Solid Color"

# Matrix display modes that render text/gradients (everything MATRIX_DISPLAY_MODES
# offers EXCEPT "Custom Draw", which is pixel-art with its own render branch).
# Used to normalise a stale non-text mode back to a valid text mode so the text
# renderer never falls through all branches and blanks the panel.
TEXT_RENDER_MODES = tuple(m for m in MATRIX_DISPLAY_MODES if m != "Custom Draw")

# Legacy 2-way content flip (kept for saved-state migration and the matrix/pixel
# 180° flip). The 4-way DEVICE_ORIENTATIONS map onto these two values.
ORIENTATION_NORMAL = "normal"
ORIENTATION_FLIPPED = "flipped"

# 4-way physical device orientation (matches the official app's mount picker).
# The lamp has no single command for this, so we translate it to the
# mechanisms that actually work:
#   - matrix / text / pixel art: normal vs flipped (180 deg) pixel flip
#   - native effects: the effect's own `direction` field, turned for the mount
#     (MOUNT_DIRECTION_VALUES): the direction chosen is what the viewer sees
#   - clock: no reorientation available (fixed by the lamp)
DEVICE_ORIENTATIONS = ("right", "down", "left", "up")
DEFAULT_DEVICE_ORIENTATION = "right"
# The lamp stands on one end: previews may show it vertical (matrix_view.py).
VERTICAL_DEVICE_ORIENTATIONS = ("down", "up")
# Config entry option: the preview cameras draw a lamp standing on one end
# vertical (off: always landscape). The "Camera Follows Orientation" switch.
CONF_CAMERA_FOLLOWS_ORIENTATION = "camera_follows_orientation"
# Right as Remote (switch.py): the lamp's buttons only fire the Lamp buttons
# events, what they changed on the lamp is put back (light_matter.py).
CONF_BUTTONS_AS_REMOTE = "buttons_as_remote"
CONF_RESTORE_MUSIC_CHANGES = "restore_after_music_changes"
# Wake Lamp When Off (switch.py, on by default): with Right or Left as
# Remote, a press on a lamp that is off turns it on with its content; off:
# presses only fire events and "off" keeps the lamp powered, black, so the
# presses still reach the integration (light_matter.py, light.py turn_off).
CONF_BUTTONS_WAKE_LAMP = "buttons_wake_lamp"
# The lamp's own playlist (effect id, custom id per slot), saved while Buttons
# as remote keeps an all-black one on the lamp (light_matter.py); written back
# when it is turned off.
CONF_REMOTE_SAVED_PLAYLIST = "remote_saved_playlist"
CONF_REMOTE_PLAYLIST_INSTALLED = "remote_playlist_installed"
# Config entry data: the MAC address of the lamp's Matter node, remembered once
# linked so the link survives an IP change (matter_link.py).
CONF_MATTER_MAC = "matter_mac"
# Config entry options: the lamp's saved mount profile 0-3 (mount_profile.py),
# who set it ("user": the options' choice or the Fire check; "matter": the
# last value Matter confirmed), and the Matter node whose rotationAngle is
# trusted (written by the integration, or changed in the app, since linked).
CONF_MOUNT_PROFILE = "mount_profile"
CONF_MOUNT_PROFILE_SOURCE = "mount_profile_source"
CONF_MOUNT_PROFILE_NODE = "mount_profile_node"
# Physical mount -> matrix/text/pixel flip. right/down keep content upright;
# left/up are 180 deg from them (verified against hardware for custom pixel art).
DEVICE_ORIENTATION_TO_FLIP = {
    "right": ORIENTATION_NORMAL,
    "down": ORIENTATION_NORMAL,
    "left": ORIENTATION_FLIPPED,
    "up": ORIENTATION_FLIPPED,
}

# When full_panel is on, the text is replaced by this single sentinel character
# whose glyph covers the entire 5x20 display (all 100 pixels), so every render
# mode can treat it as one "giant letter" with no special-case branch.
PANEL_FULL_CHAR = "\uFFFF"

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

