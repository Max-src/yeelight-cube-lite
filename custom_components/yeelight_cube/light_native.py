"""Built-in mode activation for the Yeelight Cube Lite light entity.

Extracted from light.py as a mixin.  Covers the two built-in modes the
plugin cannot draw pixel-by-pixel: the built-in Clock and the built-in native
animations.  These build the ``set_fx_effect`` payloads and hand them to the
device.  Reads/writes state via ``self``; used only as a mixin.
"""
import asyncio
import base64
import json
import logging
from .native_effect_preview import effect_supports_color_mode, effect_supports_color_override
from .lamp_renderers import clock_palette_words, music_palette, palette_music_flow, palette_words
from .lamp_animations import gif_packets, lamp_gif
from .lamp_studio import studio_palette
from .matter_commands import EFFECTS_CLUSTER, MatterCommandsUnavailable
from .color_utils import rgb_to_argb
from .light_color import hardware_brightness_for
from .cube_matrix import CubeConnectionError, encode_rgb_frame
from .light_display import ACTIVATION_TIMING
from .mount_profile import compensate_direction

from homeassistant.util import dt as dt_util  # type: ignore

from .errors import failed
from .storage import async_save_data
from .color_adjustments import ADJUSTMENT_DEFAULTS, active_adjustments
from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ALL_NATIVE_EFFECTS,
    CLOCK_COLOR_MODES,
    CLOCK_MIXER_COMMAND_IDS,
    CLOCK_MIXER_EFFECTS,
    LAMP_MUSIC_SLOTS,
    clock_segment_modes,
    clock_style_direct,
    clock_style_colors,
    clock_style_default_color,
    DEFAULT_NATIVE_CLOCK_STYLE,
    DEFAULT_NATIVE_EFFECT,
    DEFAULT_NATIVE_EFFECT_INTENSITY,
    DEFAULT_NATIVE_EFFECT_SPEED,
    DEVICE_ORIENTATION_TO_FLIP,
    DOMAIN,
    ORIENTATION_FLIPPED,
    MUSIC_FLOW_DEFAULT_PALETTE,
    MUSIC_FLOW_EFFECTS,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_CONTENT_BYTE,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_APPLY,
    ANIMATION_LAYOUT_APP,
    ANIMATION_LAYOUT_UPRIGHT,
    DEFAULT_ANIMATION_LAYOUT,
    LAMP_ANIMATION_EFFECTS,
    LIVE_EFFECT_KEYS,
    STORED_GIF_EFFECT,
    PALETTE_COLOR_MODE,
    MUSIC_MODE_START_DIRECTION,
    PALETTE_MUSIC_DIRECTION_DELAY,
    effect_direction_value,
    UNDIRECTED_EFFECT_DIRECTION,
    lamp_intensity,
    lamp_rate,
    resolve_clock_mixer_direction,
)

_LOGGER = logging.getLogger(__name__)
MUSIC_FLOW_HARD_TIMEOUT = 12.0
# A GIF packet the lamp accepted (sendGifDataFragment's status): anything else
# (21 refused, 0 no answer in time) stops the upload.
GIF_PACKET_ACK = 6


def lamp_direction(light, value: int) -> int:
    """A lamp direction value, as calibrated (on a lamp at mount profile
    2), for this lamp: compensated for the profile it saved (mount_profile.py;
    unchanged when unknown)."""
    return compensate_direction(value, getattr(light, "effect_profile", None))


def effect_direction_sent(light, spec: dict) -> int:
    """The lamp direction of an effect: the direction chosen, as the viewer
    sees it, turned for how the lamp is mounted and compensated for the profile
    it saved. One an effect does not offer stays chosen for the next effect:
    this one runs its first."""
    directions = spec.get("directions")
    if not directions:
        return lamp_direction(light, UNDIRECTED_EFFECT_DIRECTION)
    direction = light._native_effect_direction
    return lamp_direction(light, effect_direction_value(
        spec,
        direction if direction in directions else directions[0],
        light._device_orientation,
    ))


def animation_look(light) -> dict:
    """What an animation's GIF is drawn with besides its frames
    (lamp_animations.lamp_gif): the effect speed, which the lamp plays a GIF
    at only through its frame delays, the color adjustments, as for the
    pixels the integration sends, and in the palette color mode the palette
    its frames are recolored in (None otherwise: its own colors)."""
    palette = None
    if getattr(light, "_native_effect_color_mode", None) == PALETTE_COLOR_MODE:
        palette = [list(colour) for colour in studio_palette(getattr(light, "_text_colors", None))] or None
    return {
        "speed": getattr(light, "_native_effect_speed", DEFAULT_NATIVE_EFFECT_SPEED),
        "adjustments": active_adjustments({
            name: getattr(light, f"_preview_{name}", default)
            for name, default in ADJUSTMENT_DEFAULTS.items()
        }),
        "palette": palette,
    }


def stored_gif_tile(light) -> int:
    """The Yeelight app's GIF tile of the animation the lamp stores
    (light._stored_gif) while the stored GIF is chosen; 0 otherwise."""
    if light._native_effect != STORED_GIF_EFFECT:
        return 0
    stored = (getattr(light, "_stored_gif", None) or {}).get("animation")
    for spec in LAMP_ANIMATION_EFFECTS.values():
        if spec["animation"] == stored:
            return spec["app_tile"]
    return 0


def _build_music_flow_payload(enabled: bool, effect_name: str, palette=None) -> str:
    """Build the private-protocol JSON used by device-microphone music flow:
    with the app's palette, or ``palette`` ([r, g, b] each) spread over its 16
    entries (lamp_renderers.music_palette)."""
    payload = {"on": 1 if enabled else 0}
    if enabled:
        if effect_name not in MUSIC_FLOW_EFFECTS:
            raise ValueError(f"Unsupported music flow effect: {effect_name}")
        payload["effect_id"] = MUSIC_FLOW_EFFECTS[effect_name]
        spread = music_palette(palette)
        # The misspelling is part of the device's private protocol.
        payload["palatte"] = (
            [0xFF000000 | rgb_to_argb(colour) & 0xFFFFFF for colour in spread]
            if spread else list(MUSIC_FLOW_DEFAULT_PALETTE)
        )
    return json.dumps(payload, separators=(",", ":"))


def palette_music(light) -> str | None:
    """The microphone music mode the selected native effect runs as: one of
    PALETTE_MUSIC_FLOWS in the palette color mode, with a palette (None
    otherwise, or in another mode)."""
    if getattr(light, "_mode", None) != MODE_NATIVE_EFFECT:
        return None
    return palette_music_flow(
        getattr(light, "_native_effect", None),
        getattr(light, "_native_effect_color_mode", None),
        getattr(light, "_text_colors", None),
    )


def runs_lamp_music(params: list) -> bool:
    """Whether set_fx_effect ``params`` run a music slot (the effect, or the
    mixer under a clock): it listens to the lamp's microphone."""
    config = params[3] if len(params) > 3 and isinstance(params[3], dict) else {}
    return bool({config.get("mode"), config.get("mixer")} & LAMP_MUSIC_SLOTS)


def live_effect_changes(running: list | None, params: list) -> dict | None:
    """The update_fx_effect settings (LIVE_EFFECT_KEYS) that turn the running
    effect (``running``, its set_fx_effect params) into ``params``. None when
    that takes a full set_fx_effect: a color set (see LIVE_EFFECT_KEYS),
    another effect, palette or setting, a live setting added or removed, or
    nothing changed (a full activation then re-asserts it, as before)."""
    if not running or len(running) != len(params):
        return None
    *old_head, old = running
    *new_head, new = params
    if old_head != new_head or not isinstance(old, dict) or not isinstance(new, dict):
        return None
    if set(old) != set(new) or "color" in new:
        return None
    if any(old[key] != new[key] for key in new if key not in LIVE_EFFECT_KEYS):
        return None
    changes = {
        key: new[key] for key in LIVE_EFFECT_KEYS if key in new and old[key] != new[key]
    }
    return changes or None


def shown_effect_spec(light) -> dict | None:
    """The effect the lamp's renderer runs in the light's mode: the selected
    native effect, or the clock's background (None for a solid clock style or
    any other mode)."""
    mode = getattr(light, "_mode", None)
    if mode == MODE_NATIVE_EFFECT:
        return ALL_NATIVE_EFFECTS.get(
            light._native_effect, ALL_NATIVE_EFFECTS[DEFAULT_NATIVE_EFFECT]
        )
    if mode == MODE_CLOCK:
        style = NATIVE_CLOCK_STYLES.get(
            light._native_clock_style, NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE]
        )
        name = CLOCK_MIXER_EFFECTS.get(style["mixer"])
        return ALL_NATIVE_EFFECTS[name] if name else None
    return None


def shown_effect_reads(light, setting: str) -> bool:
    """Whether a setting shared by every effect ("speed", "intensity", the
    effect spec's flag) changes what the lamp shows: the effect or clock
    background it runs reads it. In another mode, whether the selected effect
    reads it, for when it runs again."""
    if palette_music(light):
        # A microphone music mode takes no speed or intensity.
        return False
    if getattr(light, "_mode", None) in (MODE_NATIVE_EFFECT, MODE_CLOCK):
        spec = shown_effect_spec(light)
    else:
        spec = ALL_NATIVE_EFFECTS.get(getattr(light, "_native_effect", None))
    return bool(spec and spec.get(setting))


def write_effect_setting_entities(light) -> None:
    """Publish the shared effect settings' entities (speed, intensity): their
    value or availability follows the effect and the mode."""
    for slot in ("_native_effect_speed_entity", "_native_effect_intensity_entity"):
        entity = getattr(light, slot, None)
        if entity is not None and getattr(entity, "hass", None) is not None:
            entity.async_write_ha_state()


def intensity_config(light, spec: dict) -> dict:
    """The intensity key of a command running the effect ``spec``: the one
    chosen, within the slot's limits (lamp_intensity), or nothing for an effect
    that does not read it (its preset row's applies)."""
    if not spec.get("intensity"):
        return {}
    chosen = getattr(light, "_native_effect_intensity", DEFAULT_NATIVE_EFFECT_INTENSITY)
    return {"intensity": lamp_intensity(spec["mode"], chosen)}


class NativeModesMixin:
    """Activate and configure the built-in Clock and native animations."""

    async def _leave_direct_mode(self) -> None:
        """Prepare to hand the panel to the lamp (clock, native effect,
        Music Flow): blank the direct-mode frame and close the drawing socket.

        The lamp keeps the last direct-mode frame and shows it again the
        moment direct mode is re-activated, about 200 ms before the next frame
        can arrive (activate_fx_mode needs its settle time). Without this,
        going back from a clock or effect to a drawing briefly shows the
        previous drawing. A black frame makes that moment dark instead; over
        UDP it is sent twice (ACTIVATION_TIMING blank_repeat), as a frame
        there is not acknowledged.
        """
        if self._fx_mode_is_direct:
            blank = encode_rgb_frame([(0, 0, 0)] * len(self._layout.device_layout))
            repeat = ACTIVATION_TIMING[self._cube_matrix.transport]["blank_repeat"]
            try:
                await self._cube_matrix.draw_matrices_fast(blank)
                if repeat is not None:
                    await asyncio.sleep(repeat)
                    await self._cube_matrix.draw_matrices_fast(blank)
            except Exception as err:  # noqa: BLE001 -- best effort, the switch goes on
                _LOGGER.debug("[%s] Could not blank the direct-mode frame: %s", self._ip, err)
        self._cube_matrix.close_fast_socket()

    def _native_brightness_due(self) -> bool:
        """Whether the lamp's brightness differs from the one set (or is not
        known): only then is it sent. Switching effects or clock styles keeps
        it (an effect's settings carry no brightness), so it is not sent
        again with each one."""
        return hardware_brightness_for(self._brightness) != self._last_hardware_brightness

    async def _set_native_mode_brightness(self) -> bool:
        """Send the brightness while a built-in mode is active, when it is
        due (_native_brightness_due). Returns whether it was sent."""
        if not self._native_brightness_due():
            return False
        level = hardware_brightness_for(self._brightness)
        await self._cube_matrix.send_raw_command("set_bright", [level])
        self._last_hardware_brightness = level
        return True

    @staticmethod
    def _native_clock_timezone_hours() -> int:
        """Return the current local UTC offset in whole hours."""
        offset = dt_util.now().utcoffset()
        return int(offset.total_seconds() / 3600) if offset else 0

    def _native_clock_data_bytes(self) -> bytes:
        """Build the 4-byte clock payload sent inside the set_fx_effect data field.

        Byte 0: 1 = time only, 2 = alternate time/date, 3 = date only
        Byte 1: timezone offset in whole hours (signed, wrapped to u8)
        Byte 2: 0 = 24-hour, 1 = 12-hour
        Byte 3: 0 = blink colon, 1 = steady colon
        """
        timezone_hours = self._native_clock_timezone_hours()
        return bytes(
            (
                NATIVE_CLOCK_CONTENT_BYTE.get(self._native_clock_content, 1),
                timezone_hours & 0xFF,
                1 if self._native_clock_12_hour else 0,
                # The lamp's flag is inverted: 0 blinks, 1 keeps the colon steady.
                0 if self._native_clock_colon_blink else 1,
            )
        )

    async def async_set_native_clock_content(self, content: str) -> None:
        """Set the 3-way clock content and re-render if the clock is showing.

        ``content`` is one of "time", "time_date" (alternate) or "date".  Keeps
        the legacy ``_native_clock_show_date`` boolean and the linked switch /
        select helper entities in sync.
        """
        if content not in NATIVE_CLOCK_CONTENT_OPTIONS:
            _LOGGER.error("Invalid clock content: %s", content)
            return
        self._native_clock_content = content
        self._native_clock_show_date = content == "time_date"
        if self._is_on and self._mode == MODE_CLOCK:
            await self.async_apply_display_mode(update_type="color_change")
        if self._clock_content_select_entity:
            self._clock_content_select_entity.async_update_from_light()
        if self._clock_show_date_switch_entity:
            self._clock_show_date_switch_entity.async_update_from_light()
        if self.hass is not None:
            self.async_write_ha_state()

    def _resolve_native_clock_color(self, style: dict) -> int | None:
        """Return the ARGB color integer to send for the current clock style.

        Priority: user override (``_native_clock_color`` attribute) > style
        default (its own color, else its mixer effect's default color).
        """
        override = self._native_clock_color
        if override is not None:
            return override
        return clock_style_default_color(style)

    async def _activate_native_clock(self) -> None:
        """Activate the Cube Lite clock through Yeelight LAN control,
        always in full (no live update: it left the clock dark); in the
        palette color mode over a background the lamp cannot show in the
        whole palette, streamed (light_studio)."""
        studio = getattr(self, "studio_selected", None)  # light_studio
        if studio is not None and studio():
            await self._start_studio_stream()
            return
        timezone_hours = self._native_clock_timezone_hours()
        await self._send_native(self._native_clock_params(), clock=True)
        self._native_clock_timezone_offset = timezone_hours
        _LOGGER.debug(
            "[CLOCK] [%s] Native clock style=%s timezone=%+d",
            self._ip,
            self._native_clock_style,
            timezone_hours,
        )

    def _native_clock_params(self) -> list:
        """The set_fx_effect params of the selected clock style (mixer,
        speed, setting bytes, color or palette, mixer direction)."""
        style_id = self._native_clock_style
        style = NATIVE_CLOCK_STYLES.get(
            style_id,
            NATIVE_CLOCK_STYLES[DEFAULT_NATIVE_CLOCK_STYLE],
        )
        clock_data = self._native_clock_data_bytes()
        effect_config = {
            **clock_segment_modes(style["mixer"], clock_style_direct(style)),
            "rate": lamp_rate(style["mixer"], self._native_effect_speed),
            "data": base64.b64encode(clock_data).decode("ascii"),
        }
        # The clock hands its intensity over to the background, like its rate.
        effect_name = CLOCK_MIXER_EFFECTS.get(style["mixer"])
        if effect_name is not None:
            effect_config.update(intensity_config(self, ALL_NATIVE_EFFECTS[effect_name]))
        # The clock's color, and for a background that draws its own colours
        # (1, 8, 28, 33, 72) all of them, the clock's color first
        # (clock_style_colors).
        clock_colors = clock_style_colors(
            style, self._resolve_native_clock_color(style)
        )
        # A palette color mode (B&W, Vivid, Retro Orange, ...) remaps an
        # animated effect's colors via the outer command id below; an
        # additionally injected color would conflict with that remap, so
        # clear it for any active mode on a mixer that takes the palette -
        # mirrors camera.py's preview and the card's renderClockFrame()
        # (lamp_clock_settings). Solid styles (no mixer effect) and the
        # own-colour backgrounds have no remap to protect except B&W, which
        # the lamp renders as plain white when no color is sent.
        clock_color_mode = self._native_clock_color_mode
        if clock_color_mode == PALETTE_COLOR_MODE:
            # The lamp's palette as the clock's colors (clock_palette_words);
            # without one, or on a background that takes none, as normal.
            words = clock_palette_words(effect_name, getattr(self, "_text_colors", None))
            if words:
                clock_colors = [0x01000000 | word for word in words]
            clock_color_mode = "normal"
        # A background that draws its own colours takes no palette: it would
        # only drop them (lamp_renderers.lamp_clock_settings).
        takes_palette = effect_name is not None and not ALL_NATIVE_EFFECTS[
            effect_name
        ].get("colors")
        if clock_color_mode == "bw" or (
            clock_color_mode != "normal" and takes_palette
        ):
            clock_colors = []
        if clock_colors:
            effect_config["color"] = clock_colors

        # A direction-capable mixer is sent the selected direction, as the app
        # does. The lamp ignores it: a mode 40 record keeps the direction that
        # maps to 0 (lamp_renderers.lamp_clock_settings).
        direction = resolve_clock_mixer_direction(
            self._native_effect_direction, effect_name
        )
        if direction is not None and effect_config["mode"] == NATIVE_CLOCK_EFFECT_ID:
            effect_config["direction"] = lamp_direction(self, effect_direction_value(
                ALL_NATIVE_EFFECTS[effect_name], direction
            ))

        # A few mixers only render in full color when the outer command id
        # (first array element) is overridden; otherwise the default clock id is
        # used. The config still carries mode 40 so the clock face renders.
        command_id = CLOCK_MIXER_COMMAND_IDS.get(style["mixer"], NATIVE_CLOCK_EFFECT_ID)
        # A color-mode preset remaps the palette by forcing the outer command
        # id (B&W, Red-Blue, ...); it wins over the mixer's default command id.
        # Solid styles (mixer 0, e.g. White/Mint/Yellow/Pink/Red/Cyan/Purple)
        # have no animated renderer to remap - they already go B&W from the
        # color skip above, so leave their command id untouched.
        mode_override = CLOCK_COLOR_MODES.get(clock_color_mode)
        if mode_override is not None and takes_palette:
            command_id = mode_override
        return [
            command_id,
            style_id,
            NATIVE_CLOCK_APPLY,
            effect_config,
        ]

    async def _activate_native_effect(self) -> None:
        """Activate one of the Cube Lite's built-in animations (live
        when only its speed or direction changed: _send_native); a music
        effect in the palette color mode as its microphone music mode; one
        the lamp cannot show in the whole palette, streamed (light_studio)."""
        studio = getattr(self, "studio_selected", None)  # light_studio
        if studio is not None and studio():
            await self._start_studio_stream()
            return
        if flow := palette_music(self):
            await self._send_palette_music(flow)
            return
        animation = ALL_NATIVE_EFFECTS.get(self._native_effect, {}).get("animation")
        if animation:
            await self._store_animation(animation)
        await self._send_native(self._native_effect_params())

    async def _store_animation(self, key: str) -> None:
        """Put the animation ``key`` (lamp_animations) in the lamp's stored
        GIF, laid out for its mount, at the effect speed, with the color
        adjustments and in the Studio palette (animation_look), unless it is
        there already: over Matter
        (sendGifDataFragment), as the Yeelight app uploads its GIFs. The lamp
        writes its flash each time, so never more often than needed.

        Each packet waits for its answer, and anything but an acknowledgement
        stops the upload without its end marker (which would store the part
        sent). The lamp then stores the next upload corrupted, so the next one
        is sent twice: the second goes to its other, clean GIF area."""
        layout = getattr(self, "_animation_layout", DEFAULT_ANIMATION_LAYOUT)
        # The mount turns only an upright layout: the app's is the picture as is.
        upside_down = layout != ANIMATION_LAYOUT_APP and (
            DEVICE_ORIENTATION_TO_FLIP.get(self._device_orientation) == ORIENTATION_FLIPPED
        )
        # The pace and the colors are in the GIF (the lamp plays it at its
        # own pace whatever the rate).
        look = animation_look(self)
        stored = self._stored_gif
        if (
            stored.get("animation") == key
            and stored.get("upside_down") == upside_down
            and stored.get("layout", ANIMATION_LAYOUT_UPRIGHT) == layout
            and stored.get("speed", DEFAULT_NATIVE_EFFECT_SPEED) == look["speed"]
            and stored.get("adjustments", {}) == look["adjustments"]
            and stored.get("palette") == look["palette"]
            and not stored.get("interrupted")
        ):
            return
        channel = self.matter_commands
        if channel is None or not await channel.async_available():
            raise failed("animation_needs_matter")
        packets = gif_packets(lamp_gif(
            key, self._device_orientation, layout, look["speed"], look["adjustments"],
            look["palette"],
        ))
        copies = 2 if stored.get("interrupted") else 1
        # Until the end marker is acknowledged, the lamp's GIF is unknown.
        self._stored_gif = {
            "animation": None, "upside_down": upside_down, "layout": layout, **look,
            "interrupted": True,
        }
        for _ in range(copies):
            for packet in packets:
                try:
                    reply = await channel.async_command(
                        EFFECTS_CLUSTER, "sendGifDataFragment",
                        {"data": base64.b64encode(packet).decode("ascii")},
                    )
                except MatterCommandsUnavailable as err:
                    raise failed("animation_needs_matter") from err
                status = (reply or {}).get("status")
                if status != GIF_PACKET_ACK:
                    _LOGGER.warning(
                        "[ANIMATION] [%s] Upload of %s stopped: the lamp answered %s",
                        self._ip, key, status,
                    )
                    raise failed("animation_upload_failed", status=str(status))
        self._stored_gif = {
            "animation": key, "upside_down": upside_down, "layout": layout, **look,
            "interrupted": False,
        }
        _LOGGER.debug("[ANIMATION] [%s] %s stored (%d packets)", self._ip, key, len(packets) * copies)

    async def _send_palette_music(self, flow: str) -> None:
        """Run a native music effect as the microphone music mode ``flow``
        with the lamp's palette (palette_music). The light stays on the native
        effect: it is not the Music Flow content mode, and the next effect,
        drawing or clock replaces it like any effect. The lamp reports it as
        that music mode (light_matter._expected_effect).

        The music mode takes no direction: it starts in the lamp's own, so
        the direction chosen, as the effect sends it (effect_direction_sent),
        follows over Matter (setDirection) once the music mode runs: at the
        lamp's microphone-on report, or PALETTE_MUSIC_DIRECTION_DELAY without
        one; nothing when it is the one it starts in. Never with
        update_fx_effect: the lamp stops the microphone a few seconds later
        and shows its saved effect. Without a Matter server the music runs
        in the lamp's own direction."""
        if claim := getattr(self, "_claim_display", None):
            claim()
        await self._leave_direct_mode()
        # The microphone starts only once the fx-mode flag is clear.
        await self._clear_fx_mode_flag()
        if note_music := getattr(self, "_expect_lamp_music", None):
            note_music(True)
        if note_power := getattr(self, "_expect_lamp_power", None):
            note_power(True)
        direction = await self._music_direction_due()
        if direction is not None and (
            expect := getattr(self, "_expect_lamp_music_on", None)
        ):
            expect()
        try:
            result = await self._cube_matrix.send_command_with_recovery(
                "set_ps",
                ["mic_music_mode", _build_music_flow_payload(True, flow, self._text_colors)],
            )
            if result is None:
                raise CubeConnectionError(
                    "Music mode command was skipped during connection cooldown"
                )
            if direction is not None:
                await self._send_music_direction(direction)
        finally:
            self._cube_matrix.close_command_socket()
        # No set_fx_effect runs: the next effect is set in full.
        self._cube_matrix.forget_running_effect()
        self._native_renderer_shown()

    async def _music_direction_due(self) -> int | None:
        """The lamp direction a music mode is turned to once it runs
        (_send_palette_music): None for an effect without directions, the
        direction it starts in (MUSIC_MODE_START_DIRECTION), or without a
        Matter server."""
        spec = ALL_NATIVE_EFFECTS.get(self._native_effect, {})
        channel = getattr(self, "matter_commands", None)
        if not spec.get("directions") or channel is None:
            return None
        direction = effect_direction_sent(self, spec)
        if direction == MUSIC_MODE_START_DIRECTION:
            return None
        try:
            available = await channel.async_available()
        except Exception:  # noqa: BLE001 -- as without a server
            return None
        return direction if available else None

    async def _send_music_direction(self, direction: int) -> None:
        """Turn the running music mode to ``direction`` (Matter setDirection,
        _send_palette_music). A failure leaves the music running in the
        lamp's own direction."""
        channel = self.matter_commands
        try:
            if wait := getattr(self, "_await_lamp_music_on", None):
                await wait(PALETTE_MUSIC_DIRECTION_DELAY)
            else:
                await asyncio.sleep(PALETTE_MUSIC_DIRECTION_DELAY)
            await channel.async_command(
                EFFECTS_CLUSTER, "setDirection", {"direction": direction}
            )
        except Exception as err:  # noqa: BLE001 -- the music still runs
            _LOGGER.debug(
                "[NATIVE] [%s] Music mode direction not sent (%s)", self._ip, err,
            )

    async def _send_native(self, params: list, *, clock: bool = False) -> None:
        """Show the lamp's own renderer: a native effect, or the clock.

        When the lamp still runs the same effect and only its speed or
        direction changed, those are updated live (update_fx_effect,
        LIVE_EFFECT_KEYS): the animation goes on instead of restarting from
        its first frame. The clock, and anything else (or a refused update),
        is set in full, as before, with the brightness when it changed
        (_set_native_mode_brightness): before set_fx_effect for an effect,
        after it for the clock (Cube Lite can drop the clock activation when
        set_bright resets a socket just before it; it takes the brightness
        once the clock runs). Each brightness has its pause (0.1 s) between
        it and set_fx_effect, and the clock its pause before it."""
        # A music effect (or a clock over one) listens only once the fx-mode
        # flag is clear; clearing it replaces what ran, so it is then set in
        # full.
        if runs_lamp_music(params) and await self._clear_fx_mode_flag():
            _LOGGER.debug("[NATIVE] [%s] fx-mode flag cleared: the microphone can start", self._ip)
        elif not clock and await self._update_running_effect(params):
            return
        if claim := getattr(self, "_claim_display", None):
            claim()
        await self._leave_direct_mode()
        if clock:
            self._hardware_operation_phase = "clock:set_fx_effect"
            await asyncio.sleep(0.1)
        elif await self._set_native_mode_brightness():
            await asyncio.sleep(0.1)
        # The lamp's answer is checked: a refused activation (rate limit)
        # fails here instead of leaving HA believing it changed.
        if note_power := getattr(self, "_expect_lamp_power", None):
            note_power(True)
        await self._cube_matrix.send_raw_command(
            "set_fx_effect", params, abortive_close=not clock, check_reply=True
        )
        self._cube_matrix.note_running_effect(params)
        if clock and self._native_brightness_due():
            self._hardware_operation_phase = "clock:brightness"
            await asyncio.sleep(0.1)
            await self._set_native_mode_brightness()
        self._native_renderer_shown()

    async def _clear_fx_mode_flag(self) -> bool:
        """cube_matrix.clear_fx_mode_flag; the saved effect the lamp then
        puts back, and reports, is not someone else's (_note_fx_restore)."""
        if not await self._cube_matrix.clear_fx_mode_flag():
            return False
        if note_restore := getattr(self, "_note_fx_restore", None):
            note_restore()
        return True

    def _palette_music(self) -> str | None:
        """palette_music for this light (light_matter reads it)."""
        return palette_music(self)

    def _shows_lamp_music(self) -> bool:
        """Whether the lamp shows a music effect, or a clock over one, of
        this integration (it reports the microphone on)."""
        if not self._is_on or getattr(self, "_external_display", False):
            return False
        # Streamed (light_studio): the lamp's microphone is not used.
        studio = getattr(self, "studio_selected", None)
        if studio is not None and studio():
            return False
        if self._mode == MODE_NATIVE_EFFECT:
            return runs_lamp_music(self._native_effect_params())
        if self._mode == MODE_CLOCK:
            return runs_lamp_music(self._native_clock_params())
        return False

    async def _update_running_effect(self, params: list) -> bool:
        """Change the running effect live (live_effect_changes); False when
        that does not apply or the lamp refused it (then it is set in full)."""
        changes = live_effect_changes(self._cube_matrix.running_effect, params)
        if changes is None or not self._is_on or not self._in_native_fw_mode:
            return False
        try:
            await self._cube_matrix.send_raw_command(
                "update_fx_effect", [changes], check_reply=True
            )
        except Exception as err:  # noqa: BLE001 -- a full activation follows
            _LOGGER.debug(
                "[NATIVE] [%s] Live update %s refused (%s): activating in full",
                self._ip, changes, err,
            )
            return False
        self._cube_matrix.note_running_effect(params)
        _LOGGER.debug("[NATIVE] [%s] Running effect updated live: %s", self._ip, changes)
        self._native_renderer_shown()
        return True

    def _native_renderer_shown(self) -> None:
        """The lamp shows its own renderer (effect or clock): state and
        previews follow."""
        if claim := getattr(self, "_claim_display", None):
            claim()
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True
        self._last_fx_mode_time = 0.0
        self._notify_camera_preview()
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    def effect_setting_applies(self, setting: str) -> bool:
        """Whether a shared effect setting ("speed", "intensity") changes what
        the lamp shows now (shown_effect_reads)."""
        return shown_effect_reads(self, setting)

    def _native_effect_params(self) -> list:
        """The set_fx_effect params of the selected native effect (speed,
        direction, palette, color)."""
        spec = ALL_NATIVE_EFFECTS.get(
            self._native_effect, ALL_NATIVE_EFFECTS[DEFAULT_NATIVE_EFFECT]
        )
        effect_config = {"mode": spec["mode"], "onoff": 1}
        if spec.get("animation"):
            pass  # its speed is in the GIF (_store_animation)
        elif spec.get("speed"):
            effect_config["rate"] = lamp_rate(spec["mode"], self._native_effect_speed)
        elif spec.get("rate") is not None:
            effect_config["rate"] = spec["rate"]
        effect_config.update(intensity_config(self, spec))
        effect_config["direction"] = effect_direction_sent(self, spec)
        color_mode = self._native_effect_color_mode
        palette_id = CLOCK_COLOR_MODES.get(color_mode)
        if not effect_supports_color_mode(self._native_effect, color_mode):
            palette_id = None
        # Every colour the effect draws (const._EXTENDED_EFFECT_COLORS):
        # one left out is black, and no color key at all white.
        colors = [int(word) for word in spec.get("colors", ())]
        if spec.get("color") is not None:
            colors = [int(spec["color"])]
        if colors and palette_id is None:
            effect_config["color"] = colors
        color = self._native_effect_color
        if color is not None and color_mode == "normal" and effect_supports_color_override(self._native_effect):
            effect_config["color"] = [rgb_to_argb(color), *colors[1:]]
        if color_mode == PALETTE_COLOR_MODE and effect_supports_color_mode(self._native_effect, color_mode):
            # The palette's colors (without a palette, the effect's own).
            words = palette_words(self._native_effect, getattr(self, "_text_colors", None))
            if words:
                effect_config["color"] = [0x01000000 | word for word in words]

        return [
            spec["effect_id"] if palette_id is None else palette_id,
            # An animation: the Yeelight app's tile it stands for, which the
            # app then shows as playing (const.LAMP_ANIMATION_EFFECTS); the
            # stored GIF: the tile of the animation it holds, when known.
            spec.get("app_tile") or stored_gif_tile(self),
            NATIVE_EFFECT_APPLY,
            effect_config,
        ]

    async def async_set_music_flow(
        self,
        enabled: bool,
        restore_display: bool = True,
        *,
        persist_state: bool = True,
    ) -> None:
        """Start or stop device-microphone music flow through private LAN control.

        Remote-button restoration reapplies an unchanged desired state with
        persist_state=False, so disk I/O does not delay the following redraw.
        Normal user changes still persist immediately for restart recovery.
        """
        if enabled and (
            self._rotation_active
            or self._rotation_resume_pending
        ):
            self.stop_effect_rotation()

        async def _write_music_flow() -> None:
            if enabled and (claim := getattr(self, "_claim_display", None)):
                claim()
            was_music_flow_enabled = self._music_flow_enabled
            previous_power = self._is_on
            payload = _build_music_flow_payload(enabled, self._music_flow_effect)

            await self._leave_direct_mode()
            # Music Flow runs music slots: the microphone starts only once the
            # fx-mode flag is clear (the Yeelight app sends deactivate_fx_mode
            # first too).
            if enabled:
                await self._clear_fx_mode_flag()
            try:
                if note_music := getattr(self, "_expect_lamp_music", None):
                    note_music(enabled)
                if enabled and (note_power := getattr(self, "_expect_lamp_power", None)):
                    note_power(True)
                result = await self._cube_matrix.send_command_with_recovery(
                    "set_ps",
                    ["mic_music_mode", payload],
                )
                if result is None:
                    raise CubeConnectionError(
                        "Music flow command was skipped during connection cooldown"
                    )
            finally:
                self._cube_matrix.close_command_socket()

            self._music_flow_enabled = enabled
            try:
                if enabled:
                    if not was_music_flow_enabled:
                        self._music_flow_restore_power = previous_power
                    self._is_on = True
                    self._fx_mode_is_direct = False
                    self._in_native_fw_mode = True
                    self._last_fx_mode_time = 0.0
                    self._is_scrolling = False
                    self.stop_scroll_timer()
                elif not was_music_flow_enabled:
                    self._is_on = previous_power
                    self._music_flow_restore_power = None
                    self._in_native_fw_mode = False
                elif restore_display:
                    restore_power = self._music_flow_restore_power
                    # The device has already accepted mic_music_mode=off. Clear
                    # the marker even if restoring the prior display fails.
                    self._music_flow_restore_power = None
                    self._in_native_fw_mode = False
                    await asyncio.sleep(0.1)
                    if restore_power is False:
                        self._cube_matrix.close_fast_socket()
                        if note_power := getattr(self, "_expect_lamp_power", None):
                            note_power(False)
                        await self._cube_matrix.send_raw_command(
                            "set_power",
                            ["off"],
                        )
                        self._is_on = False
                    else:
                        self._is_on = True
                        await self._apply_display_mode_internal()
                else:
                    self._music_flow_restore_power = None
                    self._in_native_fw_mode = False
            finally:
                # Keep HA and restart recovery aligned with the command that
                # the device already accepted if the follow-up redraw fails.
                self._refresh_music_flow_entities()
                self._notify_camera_preview()
                if self.hass is not None:
                    self.async_write_ha_state()
                if persist_state:
                    await self._persist_music_flow_runtime_state()

        success = await self._execute_hardware_op(
            _write_music_flow,
            "music_flow:on" if enabled else "music_flow:off",
            timeout_override=MUSIC_FLOW_HARD_TIMEOUT,
        )
        if not success:
            raise failed("music_flow_failed")

    async def _send_music_off(self) -> None:
        """Stop the lamp's microphone music, inside a hardware operation
        (light._internal_turn_off keeping the lamp powered)."""
        if note_music := getattr(self, "_expect_lamp_music", None):
            note_music(False)
        try:
            await self._cube_matrix.send_command_with_recovery(
                "set_ps", ["mic_music_mode", _build_music_flow_payload(False, self._music_flow_effect)],
            )
        finally:
            self._cube_matrix.close_command_socket()

    async def async_set_music_flow_effect(self, option: str) -> None:
        """Select a device-microphone music flow effect."""
        if option not in MUSIC_FLOW_EFFECTS:
            raise ValueError(f"Unsupported music flow effect: {option}")
        previous_effect = self._music_flow_effect
        self._music_flow_effect = option
        try:
            if self._music_flow_enabled:
                await self.async_set_music_flow(True)
            else:
                self._refresh_music_flow_entities()
                if self.hass is not None:
                    self.async_write_ha_state()
        except Exception:
            self._music_flow_effect = previous_effect
            self._refresh_music_flow_entities()
            raise

    def _refresh_music_flow_entities(self) -> None:
        """Synchronize the content-mode and effect controls with light state."""
        for ref in (
            self._content_mode_select_entity,
            self._music_flow_effect_select_entity,
        ):
            if ref is not None and getattr(ref, "hass", None) is not None:
                ref.async_update_from_light()

    def _music_flow_runtime_storage_key(self) -> str:
        """Return a stable per-device key for runtime state."""
        if self._config_entry is not None:
            return self._config_entry.entry_id
        return self._ip

    def _restore_music_flow_runtime_state(self) -> None:
        """Restore immediately persisted music-flow state after HA restart."""
        if self.hass is None:
            return
        runtime_states = self.hass.data.get(DOMAIN, {}).get(
            "device_runtime_state", {}
        )
        if not isinstance(runtime_states, dict):
            return
        runtime_state = runtime_states.get(
            self._music_flow_runtime_storage_key()
        )
        if not isinstance(runtime_state, dict):
            return
        if runtime_state.get("music_flow_enabled") is not True:
            return

        effect = runtime_state.get("music_flow_effect")
        if effect in MUSIC_FLOW_EFFECTS:
            self._music_flow_effect = effect
        restore_power = runtime_state.get("music_flow_restore_power")
        self._music_flow_restore_power = (
            restore_power if isinstance(restore_power, bool) else None
        )
        self._music_flow_enabled = True
        self._is_on = True
        self._fx_mode_is_direct = False
        self._in_native_fw_mode = True
        _LOGGER.debug(
            "[MUSIC FLOW] [%s] Restored active runtime state from storage",
            self._ip,
        )

    async def _persist_music_flow_runtime_state(self) -> None:
        """Immediately persist active music-flow state for restart recovery."""
        if self.hass is None:
            return
        domain_data = self.hass.data.get(DOMAIN)
        if not isinstance(domain_data, dict):
            return
        runtime_states = domain_data.setdefault("device_runtime_state", {})
        if not isinstance(runtime_states, dict):
            runtime_states = {}
            domain_data["device_runtime_state"] = runtime_states

        key = self._music_flow_runtime_storage_key()
        if self._music_flow_enabled:
            runtime_states[key] = {
                "music_flow_enabled": True,
                "music_flow_effect": self._music_flow_effect,
                "music_flow_restore_power": self._music_flow_restore_power,
            }
        else:
            runtime_states.pop(key, None)
        try:
            await async_save_data(self.hass)
        except Exception as err:
            _LOGGER.warning(
                "[MUSIC FLOW] [%s] Could not persist runtime state: %s",
                self._ip,
                err,
            )
