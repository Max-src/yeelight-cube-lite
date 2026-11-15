"""Built-in actions: native effects, clock styles, the physical button
presets, and the effect/clock rotation with its favourites and intervals.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import logging

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .native_effect_preview import (
    effect_offers_color_mode,
    effect_supports_color_override,
)
from .color_utils import rgb_to_argb
from .lamp_renderers import LAMP_MUSIC_EFFECTS
from .const import (
    DOMAIN,
)
from .effect_catalog import (
    ALL_NATIVE_EFFECTS,
    NATIVE_COLOR_MODES,
    INTENSITY_RANGE,
    SPEED_RANGE,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTIONS,
    NATIVE_EFFECTS,
    BUTTON_CLOCK_PREFIX,
    canonical_button_effect_name,
    canonical_clock_style_name,
    canonical_effect_name,
)
from .light import _entity_id_or_list
from .light_rotation import (
    FAVOURITE_KINDS,
    MAX_ROTATION_INTERVAL,
    MIN_ROTATION_INTERVAL,
)
from .errors import failed, invalid, invalid_input
from .input_error import InputError
from .light_services_common import (
    FAVOURITE_LIST_SCHEMA,
    _resolve_entities,
    make_lamp_runner,
)

_LOGGER = logging.getLogger(__name__)
# The intensity shared by every effect and clock background (effect_catalog.INTENSITY_RANGE).
_INTENSITY_SCHEMA = vol.All(
    vol.Coerce(int), vol.Range(min=INTENSITY_RANGE[0], max=INTENSITY_RANGE[1])
)


def async_register_native_services(hass: HomeAssistant) -> None:
    """Register the native actions."""
    run_on_lamps = make_lamp_runner(hass)

    async def handle_start_effect_rotation(service_call):
        """Start a server-side effect/clock rotation on the target lamps.

        The mode list comes from the card's favourites. Once started, the light
        entity advances through it on its own timer, so the rotation keeps
        running even if the dashboard tab is closed or refreshed.

        Start is FIRE-AND-FORGET: every lamp's loop is scheduled concurrently
        and the service returns immediately. Blocking on the first display
        operation here would hold the service response and stagger the lamps;
        each lamp advances on its own timer instead.
        """
        targets = _resolve_entities(service_call, "START_EFFECT_ROTATION")
        items = service_call.data.get("items") or []
        interval = service_call.data.get("interval", 60)
        kind = service_call.data.get("kind", "native")
        if not isinstance(items, (list, tuple)) or len(items) < 2:
            raise invalid("rotation_too_few")

        # Lamps started by one call share a schedule; the group is saved so a
        # restart resumes them together. A lamp started alone (the card's
        # Retry, an automation) joins the lamps already running this rotation
        # (start_effect_rotation with no timeline).
        timeline = {} if len(targets) > 1 else None
        # The lamps by their unique id (an entity id can be renamed).
        group = sorted(
            member
            for member in (
                getattr(target, "unique_id", None) or getattr(target, "entity_id", None)
                for target in targets
            )
            if member
        )

        async def _start_one(target):
            try:
                await target.start_effect_rotation(
                    items, interval, kind, timeline=timeline,
                    group=group if len(group) > 1 else None,
                )
            except Exception as exc:  # noqa: BLE001 — isolate per-lamp failures
                if target.rotation_active:
                    target.stop_effect_rotation()
                _LOGGER.warning(
                    "[START_EFFECT_ROTATION] Failed to start %s: %s",
                    getattr(target, "entity_id", target),
                    exc,
                )

        run_on_lamps("START_EFFECT_ROTATION", targets, _start_one)

    async def handle_stop_effect_rotation(service_call):
        """Stop the server-side rotation on the target lamps."""
        for target in _resolve_entities(service_call, "STOP_EFFECT_ROTATION"):
            target.stop_effect_rotation()

    async def handle_skip_effect_rotation(service_call):
        """Advance the running rotation to its next mode immediately."""
        for target in _resolve_entities(service_call, "SKIP_EFFECT_ROTATION"):
            target.skip_effect_rotation()

    hass.services.async_register(
        DOMAIN, "start_effect_rotation", handle_start_effect_rotation,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Required("items"): [
                vol.Any(
                    cv.string,
                    vol.Schema(
                        {
                            vol.Required("name"): cv.string,
                            vol.Optional(
                                "color_mode", default="normal"
                            ): cv.string,
                            vol.Optional("color"): [cv.byte],
                        },
                        extra=vol.PREVENT_EXTRA,
                    ),
                )
            ],
            vol.Optional("interval", default=60): vol.All(
                vol.Coerce(int), vol.Range(min=MIN_ROTATION_INTERVAL, max=MAX_ROTATION_INTERVAL)
            ),
            vol.Optional("kind", default="native"): vol.In(["native", "clock"]),
        }),
    )

    async def handle_set_favourites(service_call):
        """Replace a lamp's favourite effects or clock styles (all dashboards
        show them; rotation plays them in this order)."""
        targets = _resolve_entities(service_call, "SET_FAVOURITES")
        kind = service_call.data["kind"]
        items = service_call.data["favourites"]
        for target in targets:
            await target.async_set_favourites(kind, items)

    async def handle_set_rotation_interval(service_call):
        """Set the rotation interval every dashboard uses (applied at once to
        a running rotation of that kind)."""
        targets = _resolve_entities(service_call, "SET_ROTATION_INTERVAL")
        for target in targets:
            target.set_rotation_interval(
                service_call.data["kind"], service_call.data["interval"]
            )

    hass.services.async_register(
        DOMAIN, "set_rotation_interval", handle_set_rotation_interval,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Required("kind"): vol.In(list(FAVOURITE_KINDS)),
            vol.Required("interval"): vol.All(
                vol.Coerce(int), vol.Range(min=MIN_ROTATION_INTERVAL, max=MAX_ROTATION_INTERVAL)
            ),
        }),
    )

    hass.services.async_register(
        DOMAIN, "set_favourites", handle_set_favourites,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Required("kind"): vol.In(list(FAVOURITE_KINDS)),
            vol.Required("favourites"): FAVOURITE_LIST_SCHEMA,
        }),
    )

    async def handle_set_matrix_modules(service_call):
        """A Cube Matrix's module list (light_matrix.async_set_matrix_modules),
        on each lamp in turn: its errors reach the caller."""
        modules = list(service_call.data["modules"])
        for lamp in _resolve_entities(service_call, "SET_MATRIX_MODULES"):
            try:
                await lamp.async_set_matrix_modules(modules)
            except InputError as err:
                raise invalid_input(err) from err

    hass.services.async_register(
        DOMAIN, "set_matrix_modules", handle_set_matrix_modules,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Required("modules"): vol.All(
                cv.ensure_list, [vol.In(("matrix", "spot", "panel"))], vol.Length(min=1, max=6),
            ),
        }),
    )

    hass.services.async_register(
        DOMAIN, "stop_effect_rotation", handle_stop_effect_rotation,
        schema=vol.Schema({vol.Required("entity_id"): _entity_id_or_list}),
    )

    hass.services.async_register(
        DOMAIN, "skip_effect_rotation", handle_skip_effect_rotation,
        schema=vol.Schema({vol.Required("entity_id"): _entity_id_or_list}),
    )

    async def handle_set_native_effect(service_call):
        targets = _resolve_entities(service_call, "SET_NATIVE_EFFECT")
        # A former name (e.g. "Ocean Waves") is today's ("Waves").
        effect = canonical_effect_name(service_call.data.get("effect"))
        speed = service_call.data.get("speed")
        intensity = service_call.data.get("intensity")
        direction = service_call.data.get("direction")
        color_mode = service_call.data.get("color_mode")
        has_color = "color" in service_call.data
        color = service_call.data.get("color")
        clear_color = color is None or color == "clear"
        if has_color and not clear_color and (
            not isinstance(color, (list, tuple)) or len(color) != 3
            or any(type(channel) is not int or not 0 <= channel <= 255 for channel in color)
        ):
            raise invalid("color_invalid")
        activate = service_call.data.get("activate", True)
        for target in targets:
            name = effect if effect is not None else target.native_effect
            spec = ALL_NATIVE_EFFECTS.get(name)
            if spec is None:
                raise invalid("unknown_effect", effect=name)
            # Uploaded to the lamp first, over Matter (light_native._store_animation).
            if activate and spec.get("animation") and not getattr(target, "animations_available", False):
                raise invalid("animation_needs_matter")
            # A lamp without a microphone (Cube Matrix) has nothing to hear.
            profile = getattr(target, "device_profile", None)
            if profile is not None and not profile.microphone and name in LAMP_MUSIC_EFFECTS:
                raise invalid("needs_microphone", effect=name)
            if speed is not None and not spec.get("speed"):
                raise invalid("no_speed", effect=name)
            if intensity is not None and not spec.get("intensity"):
                raise invalid("no_intensity", effect=name)
            # Not to run now, it is a choice shared by all effects, like the speed.
            if activate and direction is not None and direction not in spec.get("directions", ()):
                raise invalid("no_direction", effect=name, direction=direction)
            if has_color and not clear_color and not effect_supports_color_override(name):
                raise invalid("no_custom_color", effect=name)
            if color_mode is not None and (
                color_mode not in NATIVE_COLOR_MODES
                # Palette: also what is streamed or recolored (lamp_studio).
                or (color_mode != "normal" and not effect_offers_color_mode(name, color_mode))
            ):
                raise invalid("color_mode_unsupported", effect=name, color_mode=color_mode)
            if not target.can_take_commands():
                raise invalid("lamp_off")

        def update_one(target):
            """Record the requested settings and publish them immediately
            (light_actions_native.request_native_effect)."""
            return target.request_native_effect(
                effect=effect, speed=speed, intensity=intensity, direction=direction,
                color_mode=color_mode, has_color=has_color,
                color=None if clear_color else color, activate=activate,
            )

        # Like set_clock_style: validation errors are raised above, then the
        # new settings are published at once and the lamp is updated in the
        # background, so cards are not held up by the hardware round trip.
        # A change the lamp refused is logged and the previous settings
        # republished, rather than returned to the service call; a lamp not reached
        # keeps them, like every other service.
        undo = {id(target): update_one(target) for target in targets}
        run_on_lamps(
            "SET_NATIVE_EFFECT",
            targets,
            lambda target: target.async_send_native_effect(*undo[id(target)]),
        )

    hass.services.async_register(
        DOMAIN, "set_native_effect", handle_set_native_effect,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("effect"): cv.string,
            vol.Optional("speed"): vol.All(vol.Coerce(int), vol.Range(min=SPEED_RANGE[0], max=SPEED_RANGE[1])),
            vol.Optional("intensity"): _INTENSITY_SCHEMA,
            vol.Optional("direction"): vol.In(list(NATIVE_EFFECT_DIRECTIONS)),
            vol.Optional("color_mode"): vol.In(list(NATIVE_COLOR_MODES)),
            vol.Optional("color"): vol.Any(None, "clear", vol.All(
                [vol.All(vol.Coerce(int), vol.Range(min=0, max=255))],
                vol.Length(min=3, max=3),
            )),
            vol.Optional("activate", default=True): cv.boolean,
        }),
    )

    async def handle_set_clock_style(service_call):
        """Configure the lamp's clock (style, color, content, format).

        A single clean action the Clock card drives: any subset of the fields
        may be provided. ``style`` accepts a style name or numeric id; ``color``
        is an ``[r, g, b]`` override (or ``"clear"`` / null to drop it back to
        the style's own color). By default the lamp is switched to Clock mode
        (``activate``) so the change is visible immediately.
        """
        targets = _resolve_entities(service_call, "SET_CLOCK_STYLE")
        data = service_call.data
        style = data.get("style")
        has_color = "color" in data
        color = data.get("color")
        content = data.get("content")
        twelve_hour = data.get("twelve_hour")
        colon_blink = data.get("colon_blink")
        speed = data.get("speed")
        intensity = data.get("intensity")
        color_mode = data.get("color_mode")
        activate = data.get("activate", True)

        # Resolve a style name or numeric id to a NATIVE_CLOCK_STYLES key.
        style_id = None
        if style is not None:
            if isinstance(style, int) or (
                isinstance(style, str) and str(style).lstrip("-").isdigit()
            ):
                sid = int(style)
                if sid in NATIVE_CLOCK_STYLES:
                    style_id = sid
            else:
                # By name: a former one (e.g. "Blue White") is today's. A
                # number was read as a style id above, never as a name.
                name = canonical_clock_style_name(style)
                style_id = next(
                    (
                        sid
                        for sid, spec in NATIVE_CLOCK_STYLES.items()
                        if spec["name"] == name
                    ),
                    None,
                )
            if style_id is None:
                raise invalid("unknown_clock_style", style=style)

        # Encode an [r, g, b] override into the lamp's 0x01RRGGBB clock
        # color integer (high byte 0x01 = custom color, matching the built-in
        # style presets like Yellow = 0x01FFFE00).
        clock_color = None
        clear_color = False
        if has_color:
            if color in (None, "clear") or color == []:
                clear_color = True
            elif isinstance(color, (list, tuple)) and len(color) >= 3:
                clock_color = rgb_to_argb(color)
            else:
                raise invalid("color_invalid")

        async def _apply_one(target):
            await target.async_set_clock_settings(
                style_id=style_id, has_color=has_color,
                clock_color=None if clear_color else clock_color, content=content,
                twelve_hour=twelve_hour, colon_blink=colon_blink, color_mode=color_mode,
                speed=speed, intensity=intensity, activate=activate,
            )

        run_on_lamps("SET_CLOCK_STYLE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_clock_style",
        handle_set_clock_style,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("style"): vol.Any(cv.string, vol.Coerce(int)),
            vol.Optional("color"): vol.Any(
                None,
                "clear",
                vol.All(
                    [vol.All(vol.Coerce(int), vol.Range(min=0, max=255))],
                    vol.Length(min=3, max=3),
                ),
            ),
            vol.Optional("content"): vol.In(NATIVE_CLOCK_CONTENT_OPTIONS),
            vol.Optional("twelve_hour"): cv.boolean,
            vol.Optional("colon_blink"): cv.boolean,
            vol.Optional("color_mode"): vol.In(list(NATIVE_COLOR_MODES)),
            vol.Optional("speed"): vol.All(vol.Coerce(int), vol.Range(min=SPEED_RANGE[0], max=SPEED_RANGE[1])),
            vol.Optional("intensity"): _INTENSITY_SCHEMA,
            vol.Optional("activate"): cv.boolean,
        }),
    )

    async def handle_set_button_effects(service_call):
        """Set the ordered native-effect list cycled by the physical button."""
        targets = _resolve_entities(service_call, "SET_BUTTON_EFFECTS")
        effect_names = service_call.data["effects"]
        # Right as Remote keeps the playlist black (its backup is written
        # back when the switch is turned off): it must not be overwritten.
        if any(getattr(target, "remote_playlist_active", False) for target in targets):
            raise invalid("button_effects_remote_on")
        results = await asyncio.gather(
            *(
                target.async_run_exclusive(
                    lambda target=target: target.async_set_button_effects(
                        effect_names
                    ),
                    "set_button_effects",
                )
                for target in targets
            )
        )
        if not all(results):
            raise failed("button_effects_refused")

    button_effect_options = list(NATIVE_EFFECTS) + [
        f"{BUTTON_CLOCK_PREFIX}{style['name']}" for style in NATIVE_CLOCK_STYLES.values()
    ]

    hass.services.async_register(
        DOMAIN,
        "set_button_effects",
        handle_set_button_effects,
        schema=vol.Schema({
            vol.Required("effects"): vol.All(
                # Former names are read as today's.
                [vol.All(cv.string, canonical_button_effect_name, vol.In(button_effect_options))],
                vol.Length(min=1, max=8),
            ),
            vol.Required("entity_id"): _entity_id_or_list,
        }),
    )
