"""The integration's constants: its domain, configuration keys and settings.

Owns what is not the effect catalogue (effect_catalog.py): the domain and the
config entry's keys and options, the model probe's and the reachability
probe's timings, the LAN port, the lamp's power-on states, the content and
matrix display modes, the device orientations, and the lamp discovery's
models and name patterns. Only data, no import, so it also loads on its own
(runpy, the tools).
"""
DOMAIN = "yeelight_cube"
CONF_IP = "Light IP Address"
CONF_DEVICE_ID = "device_id"
# The lamp model ("CubeLite" / "CubeMatrix", device_profile); entries without
# one are Cube Lites (made before the Cube Matrix was supported).
CONF_MODEL = "model"
# How long the model probe waits for get_prop (a Cube Lite never answers it).
MODEL_PROBE_TIMEOUT = 1.5
# A lamp of unknown model that answers no get_prop at this many starts is
# stored as a Cube Lite (light.py: a Cube Matrix may answer late).
MODEL_PROBE_STARTS = 3
CONF_MODEL_PROBE_MISSES = "model_probe_misses"

# The lamp's LAN Control port (TCP; its UDP session: udp_session.UDP_PORT).
LAN_PORT = 55443
# How long a reachability probe waits for the lamp (adding it, setting it
# up): generous, it may still be booting.
PROBE_TIMEOUT = 3.0

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
# Keep Streaming When Off (switch.py, a Cube Lite's, off by default): turning
# off an effect or clock Home Assistant streams keeps the stream going, black,
# instead of powering the lamp off: a Cube Lite can hang when a busy stream
# stops (light_studio, the standby stream).
CONF_KEEP_STREAMING_WHEN_OFF = "keep_streaming_when_off"
# Skip Unchanged Stream Frames (switch.py, a Cube Lite's, off by default): a
# streamed frame the same as the last one sent is not sent (light_studio's
# LAN stream), not even as the stream's keep-alive repeat; the Stream frame
# rate limit still applies to the frames that change.
CONF_SKIP_UNCHANGED_FRAMES = "skip_unchanged_frames"
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

