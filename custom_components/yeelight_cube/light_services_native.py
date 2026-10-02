"""Firmware-native actions: native effects, clock styles, the physical button
presets, and the effect/clock rotation with its favourites and intervals.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import logging

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .native_effect_preview import (
    effect_supports_color_mode,
    effect_supports_color_override,
)
from .color_utils import rgb_to_argb
from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    ALL_NATIVE_EFFECTS,
    CLOCK_COLOR_MODES,
    DOMAIN,
    EXPERIMENTAL_CLOCK_STYLE_IDS,
    NATIVE_CLOCK_CONTENT_OPTIONS,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECTS,
)
from .light import _entity_id_or_list
from .light_rotation import (
    FAVOURITE_KINDS,
    MAX_ROTATION_INTERVAL,
    MIN_ROTATION_INTERVAL,
)
from .light_services_common import (
    FAVOURITE_LIST_SCHEMA,
    _resolve_entities,
    make_fire_and_forget,
)

_LOGGER = logging.getLogger(__name__)


def async_register_native_services(hass: HomeAssistant) -> None:
    """Register the native actions."""
    _fire_and_forget = make_fire_and_forget(hass)

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
        if not targets:
            raise HomeAssistantError("No matching Yeelight Cube lamps")
        items = service_call.data.get("items") or []
        interval = service_call.data.get("interval", 60)
        kind = service_call.data.get("kind", "native")
        if not isinstance(items, (list, tuple)) or len(items) < 2:
            raise HomeAssistantError("Provide at least two modes in 'items'")

        timeline = {}
        # Lamps started by one call share a schedule; the group is saved so a
        # restart resumes them together.
        group = sorted(
            entity_id
            for entity_id in (getattr(target, "entity_id", None) for target in targets)
            if entity_id
        )

        async def _start_one(target):
            try:
                await target.start_effect_rotation(
                    items, interval, kind, timeline=timeline,
                    group=group if len(group) > 1 else None,
                )
            except Exception as exc:  # noqa: BLE001 — isolate per-lamp failures
                if getattr(target, "_rotation_active", False):
                    target.stop_effect_rotation()
                _LOGGER.warning(
                    "[START_EFFECT_ROTATION] Failed to start %s: %s",
                    getattr(target, "entity_id", target),
                    exc,
                )

        _fire_and_forget(*[_start_one(target) for target in targets])

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
        if not targets:
            raise HomeAssistantError("No matching Yeelight Cube lamps")
        kind = service_call.data["kind"]
        items = service_call.data["favourites"]
        for target in targets:
            await target.async_set_favourites(kind, items)

    async def handle_set_rotation_interval(service_call):
        """Set the rotation interval every dashboard uses (applied at once to
        a running rotation of that kind)."""
        targets = _resolve_entities(service_call, "SET_ROTATION_INTERVAL")
        if not targets:
            raise HomeAssistantError("No matching Yeelight Cube lamps")
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
        if not targets:
            raise HomeAssistantError("No matching Yeelight Cube lamps")
        effect = service_call.data.get("effect")
        speed = service_call.data.get("speed")
        color_mode = service_call.data.get("color_mode")
        has_color = "color" in service_call.data
        color = service_call.data.get("color")
        clear_color = color is None or color == "clear"
        if has_color and not clear_color and (
            not isinstance(color, (list, tuple)) or len(color) != 3
            or any(type(channel) is not int or not 0 <= channel <= 255 for channel in color)
        ):
            raise HomeAssistantError("color must be [r, g, b] or 'clear'")
        activate = service_call.data.get("activate", True)
        for target in targets:
            name = effect if effect is not None else target._native_effect
            spec = ALL_NATIVE_EFFECTS.get(name)
            if spec is None:
                raise HomeAssistantError(f"Unknown native effect: {name}")
            if spec.get("extended") and not target._extended_effects_enabled:
                raise HomeAssistantError("Enable Experimental Features before applying this effect")
            if speed is not None and not spec.get("speed"):
                raise HomeAssistantError(f"{name} does not support animation speed")
            if has_color and not clear_color and not effect_supports_color_override(name):
                raise HomeAssistantError(f"{name} does not support custom colors")
            if color_mode is not None and (
                color_mode not in CLOCK_COLOR_MODES
                or (color_mode != "normal" and not effect_supports_color_mode(name, color_mode))
            ):
                raise HomeAssistantError(f"{name} does not support color mode {color_mode}")
            if not target._is_on and not target._should_auto_turn_on():
                raise HomeAssistantError("Lamp is off and auto-turn-on is disabled")

        def update_one(target):
            """Record the requested settings and publish them immediately.

            Returns what is needed to undo them if the lamp rejects the change:
            the previous values and this call's generation.
            """
            # The rollback target is what the lamp last accepted. While an
            # earlier call is still unconfirmed (in flight, or skipped because
            # this one replaced it) its values never reached the lamp, so this
            # call inherits that call's baseline instead of snapshotting them.
            snapshot = getattr(target, "_native_effect_baseline", None) or {
                attr: getattr(target, attr, None)
                for attr in (
                    "_native_effect",
                    "_native_effect_speed",
                    "_native_effect_color_mode",
                    "_native_effect_color",
                    "_mode",
                    "_custom_draw_active",
                )
            }
            target._native_effect_baseline = snapshot
            generation = getattr(target, "_native_effect_generation", 0) + 1
            target._native_effect_generation = generation
            if effect is not None:
                target._native_effect = effect
            if speed is not None:
                target._native_effect_speed = speed
            if color_mode is not None:
                target._native_effect_color_mode = color_mode
            if has_color:
                target._native_effect_color = None if clear_color else list(color)
                if color_mode is None:
                    target._native_effect_color_mode = "normal"
            if activate:
                target._mode = MODE_NATIVE_EFFECT
                target._custom_draw_active = False
            target._refresh_linked_entities()
            if target._native_effect_speed_entity:
                target._native_effect_speed_entity.async_write_ha_state()
            target.async_write_ha_state()
            applied = {attr: getattr(target, attr, None) for attr in snapshot}
            return snapshot, applied, generation

        async def apply_one(target, snapshot, applied, generation):
            """Send the effect to the lamp (runs after the service returned)."""
            if target._mode != MODE_NATIVE_EFFECT:
                # Nothing to send (e.g. a speed change while the clock runs):
                # the settings stand as published.
                if getattr(target, "_native_effect_generation", generation) == generation:
                    target._native_effect_baseline = None
                return
            # A newer set_native_effect call already replaced these settings and
            # will apply the latest ones itself: skip this redundant update.
            if getattr(target, "_native_effect_generation", generation) != generation:
                return
            try:
                # The hardware wrapper reports failures by returning False
                # (timeouts, offline lamp, circuit breaker) rather than raising.
                ok = await target.async_apply_display_mode(update_type="color_change")
            except Exception:  # noqa: BLE001 -- background task, nobody awaits it
                _LOGGER.exception(
                    "[SET_NATIVE_EFFECT] Failed to apply %s on %s",
                    target._native_effect,
                    getattr(target, "entity_id", target),
                )
                ok = False
            else:
                if ok is False:
                    _LOGGER.warning(
                        "[SET_NATIVE_EFFECT] Lamp did not accept %s on %s",
                        target._native_effect,
                        getattr(target, "entity_id", target),
                    )
            latest = (
                getattr(target, "_native_effect_generation", generation) == generation
            )
            if ok is False and latest:
                # The lamp did not take the change: publish what it last
                # accepted (an older call may have succeeded since this one
                # started). Only fields still holding this call's values are
                # restored, so a newer change from another path (rotation,
                # set_mode, the select entities) is never overwritten.
                baseline = getattr(target, "_native_effect_baseline", None) or snapshot
                for attr, value in baseline.items():
                    if getattr(target, attr, None) == applied[attr]:
                        setattr(target, attr, value)
                target._refresh_linked_entities()
                if target._native_effect_speed_entity:
                    target._native_effect_speed_entity.async_write_ha_state()
            if latest:
                target._native_effect_baseline = None
            elif ok is not False and getattr(target, "_native_effect_baseline", None):
                # The lamp now shows this call's values: the baseline for the
                # newer call that is still pending. If that call already
                # finished (it cleared the baseline), the lamp shows its values
                # instead and there is nothing to record.
                target._native_effect_baseline = applied
            target.async_write_ha_state()

        # Like set_clock_style: validation errors are raised above, then the
        # new settings are published at once and the lamp is updated in the
        # background, so cards are not held up by the hardware round trip.
        # Hardware failures are logged and the previous settings republished,
        # rather than returned to the caller.
        undo = [update_one(target) for target in targets]
        _fire_and_forget(
            *(
                apply_one(target, snapshot, applied, generation)
                for target, (snapshot, applied, generation) in zip(targets, undo)
            )
        )

    hass.services.async_register(
        DOMAIN, "set_native_effect", handle_set_native_effect,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("effect"): cv.string,
            vol.Optional("speed"): vol.All(vol.Coerce(int), vol.Range(min=1, max=255)),
            vol.Optional("color_mode"): vol.In(list(CLOCK_COLOR_MODES)),
            vol.Optional("color"): vol.Any(None, "clear", vol.All(
                [vol.All(vol.Coerce(int), vol.Range(min=0, max=255))],
                vol.Length(min=3, max=3),
            )),
            vol.Optional("activate", default=True): cv.boolean,
        }),
    )

    async def handle_set_clock_style(service_call):
        """Configure the firmware clock (style, color, content, format).

        A single clean action the Clock card drives: any subset of the fields
        may be provided. ``style`` accepts a style name or numeric id; ``color``
        is an ``[r, g, b]`` override (or ``"clear"`` / null to drop it back to
        the style's own color). By default the lamp is switched to Clock mode
        (``activate``) so the change is visible immediately.
        """
        targets = _resolve_entities(service_call, "SET_CLOCK_STYLE")
        if not targets:
            return
        data = service_call.data
        style = data.get("style")
        has_color = "color" in data
        color = data.get("color")
        content = data.get("content")
        twelve_hour = data.get("twelve_hour")
        colon_blink = data.get("colon_blink")
        speed = data.get("speed")
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
                style_id = next(
                    (
                        sid
                        for sid, spec in NATIVE_CLOCK_STYLES.items()
                        if spec["name"] == style
                    ),
                    None,
                )
            if style_id is None:
                raise HomeAssistantError(f"Unknown clock style: {style}")

        # Encode an [r, g, b] override into the firmware's 0x01RRGGBB clock
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
                raise HomeAssistantError("color must be [r, g, b] or 'clear'")

        async def _apply_one(target):
            if not target._is_on and not target._should_auto_turn_on():
                return
            if style_id is not None:
                # Experimental styles need the extended catalogue on; enabling
                # it here keeps the select entity and this action consistent.
                if (
                    style_id in EXPERIMENTAL_CLOCK_STYLE_IDS
                    and not target._extended_effects_enabled
                ):
                    target.set_extended_effects_enabled(True)
                target._native_clock_style = style_id
            if has_color:
                target._native_clock_color = None if clear_color else clock_color
            if content is not None:
                target._native_clock_content = content
                target._native_clock_show_date = content == "time_date"
            if twelve_hour is not None:
                target._native_clock_12_hour = bool(twelve_hour)
            if colon_blink is not None:
                target._native_clock_colon_blink = bool(colon_blink)
            if color_mode is not None:
                target._native_clock_color_mode = color_mode
            if speed is not None:
                target._native_effect_speed = max(1, min(255, int(speed)))
            if activate:
                target._mode = MODE_CLOCK
                target._custom_draw_active = False
            if target._mode == MODE_CLOCK and (
                target._is_on or target._should_auto_turn_on()
            ):
                await target.async_apply_display_mode(update_type="color_change")
            target._refresh_linked_entities()
            if speed is not None and target._native_effect_speed_entity:
                target._native_effect_speed_entity.async_write_ha_state()
            target.async_write_ha_state()

        _fire_and_forget(*[_apply_one(t) for t in targets])

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
            vol.Optional("color_mode"): vol.In(list(CLOCK_COLOR_MODES)),
            vol.Optional("speed"): vol.All(vol.Coerce(int), vol.Range(min=1, max=255)),
            vol.Optional("activate"): cv.boolean,
        }),
    )

    async def handle_set_button_effects(service_call):
        """Set the ordered native-effect list cycled by the physical button."""
        targets = _resolve_entities(service_call, "SET_BUTTON_EFFECTS")
        if not targets:
            return
        effect_names = service_call.data["effects"]
        results = await asyncio.gather(
            *(
                target._execute_hardware_op(
                    lambda target=target: target.async_set_button_effects(
                        effect_names
                    ),
                    "set_button_effects",
                )
                for target in targets
            )
        )
        if not all(results):
            raise HomeAssistantError(
                "One or more Cube Lite devices did not accept the button presets"
            )

    button_effect_options = list(NATIVE_EFFECTS) + [
        f"Clock: {style['name']}" for style in NATIVE_CLOCK_STYLES.values()
    ]

    hass.services.async_register(
        DOMAIN,
        "set_button_effects",
        handle_set_button_effects,
        schema=vol.Schema({
            vol.Required("effects"): vol.All(
                [vol.In(button_effect_options)],
                vol.Length(min=1, max=8),
            ),
            vol.Required("entity_id"): _entity_id_or_list,
        }),
    )
