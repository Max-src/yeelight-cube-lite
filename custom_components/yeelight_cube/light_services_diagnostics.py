"""Diagnostic and calibration actions (mostly admin-only): raw firmware
commands, capabilities, python-yeelight calls, colour calibration and the
test display.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import base64
import json
import logging

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant, SupportsResponse  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .const import (
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    DOMAIN,
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECT_DIRECTION_VALUES,
    NATIVE_EFFECTS,
)
from .light import _entity_id_or_list
from .light_services_common import (
    _resolve_entity,
    _resolve_entities,
    make_admin_only,
    make_fire_and_forget,
)

_LOGGER = logging.getLogger(__name__)


def async_register_diagnostics_services(hass: HomeAssistant) -> None:
    """Register the diagnostics actions."""
    _admin_only = make_admin_only(hass)
    _fire_and_forget = make_fire_and_forget(hass)

    async def handle_send_fx_effect(service_call):
        """DEBUG: send a raw LAN command (default ``set_fx_effect``).

        Local exploration/reverse-engineering tool used by the FX Explorer
        card. NOT part of the stable API -- do not rely on it in automations.

        Either supply ``params`` directly (a raw JSON array sent verbatim), or
        supply the structured fields (mode/style_id/apply/mixer/color/data*)
        and this handler assembles the standard 4-element params list:
            [mode, style_id, apply, {mode, mixer, [color], [data]}]
        """
        method = service_call.data.get("method") or "set_fx_effect"
        raw_params = service_call.data.get("params")
        close_socket = bool(service_call.data.get("close_socket", True))
        persist = bool(service_call.data.get("persist", False))

        target = _resolve_entity(service_call, "SEND_FX_EFFECT")
        if target is None:
            return {"ok": False, "error": "entity not found"}

        if raw_params is not None:
            params = raw_params
        else:
            mode = int(service_call.data.get("mode", NATIVE_CLOCK_EFFECT_ID))
            style_id = int(service_call.data.get("style_id", 0))
            apply = int(service_call.data.get("apply", NATIVE_CLOCK_APPLY))
            mixer = int(service_call.data.get("mixer", 0))
            config = {"mode": mode, "mixer": mixer}
            data_b64 = service_call.data.get("data")
            data_bytes = service_call.data.get("data_bytes")
            if data_b64 is not None:
                config["data"] = data_b64
            elif data_bytes is not None:
                config["data"] = base64.b64encode(
                    bytes(int(b) & 0xFF for b in data_bytes)
                ).decode("ascii")
            # The firmware clock effect (mode 40) REQUIRES a data payload
            # (date/timezone/12h/colon). If none was supplied explicitly, build
            # it from the lamp's current clock settings -- exactly like
            # _activate_native_clock -- otherwise the clock renders blank.
            if mode == NATIVE_CLOCK_EFFECT_ID and "data" not in config:
                config["data"] = base64.b64encode(
                    target._native_clock_data_bytes()
                ).decode("ascii")
            color = service_call.data.get("color")
            if color is not None:
                config["color"] = color if isinstance(color, list) else [int(color)]
            # Optional animation speed. The firmware clock effect (mode 40)
            # accepts a `rate` field just like native effects.
            rate = service_call.data.get("rate")
            if rate is not None:
                try:
                    config["rate"] = int(rate)
                except (TypeError, ValueError):
                    pass
            # The first array element (command/effect id) usually equals the
            # config mode, but some renderers only unlock their full output
            # under a different command id (e.g. Fireworks needs 71 while the
            # clock config keeps mode 40). Allow overriding it independently.
            command_id = service_call.data.get("effect_id")
            command_id = int(command_id) if command_id is not None else mode
            params = [command_id, style_id, apply, config]

        # Derive effect mode/style for optional persistence (from whichever
        # branch built params). params = [mode, style_id, apply, config].
        effect_mode = None
        effect_style = None
        effect_config = None
        try:
            if isinstance(params, list) and len(params) >= 2:
                effect_mode = int(params[0])
                effect_style = int(params[1])
            if isinstance(params, list) and len(params) >= 4 and isinstance(
                params[3], dict
            ):
                effect_config = params[3]
        except (TypeError, ValueError):
            pass

        # Treat as a clock command when the effect CONFIG selects the clock
        # renderer (mode 40), even if the outer command id was overridden (e.g.
        # Fireworks uses command id 71 with a clock config).
        config_mode = (
            effect_config.get("mode") if isinstance(effect_config, dict) else None
        )
        is_clock_command = (
            config_mode == NATIVE_CLOCK_EFFECT_ID
            or effect_mode == NATIVE_CLOCK_EFFECT_ID
        )

        # Is this a firmware fx command (clock or native effect)? Both need the
        # set_bright prelude + settle, otherwise the raw command often doesn't
        # render until a Force Refresh replays it.
        is_fx = method == "set_fx_effect"
        # Map a native-effect id -> name for persistence, if it matches.
        native_effect_name = None
        for _name, _spec in NATIVE_EFFECTS.items():
            if _spec.get("effect_id") == effect_mode and effect_mode is not None:
                native_effect_name = _name
                break

        try:
            async def _do_send():
                if close_socket:
                    target._cube_matrix.close_fast_socket()
                # The firmware clock (mode 40) is order-sensitive: sending
                # set_bright BEFORE set_fx_effect can CANCEL the clock
                # activation (see _activate_native_clock). So for clock we send
                # the fx command first, then brightness. Native effects are the
                # opposite -- they want the set_bright prelude first so they
                # render immediately. Detect the clock from the CONFIG mode so an
                # overridden command id (e.g. Fireworks 71) still counts.
                is_clock = is_clock_command
                if is_fx and is_clock:
                    await asyncio.sleep(0.1)
                    await target._cube_matrix.send_raw_command(
                        method, params, abortive_close=False
                    )
                    await asyncio.sleep(0.1)
                    await target._set_native_mode_brightness()
                    return
                if is_fx:
                    await target._set_native_mode_brightness()
                    await asyncio.sleep(0.1)
                # Color flow (start_cf) renders only while the panel is powered
                # on, and runs entirely in firmware afterwards. Power on first so
                # the flow is visible even if the panel was off/idle.
                if method == "start_cf":
                    await target._cube_matrix.send_raw_command("set_power", ["on"])
                    await asyncio.sleep(0.1)
                await target._cube_matrix.send_raw_command(method, params)

            # Run under the device hardware lock so the send is serialized with
            # the persistent socket / background loop (prevents the command from
            # being clobbered mid-flight).
            await target._execute_hardware_op(_do_send, "fx_explorer_send")
            _LOGGER.warning(
                "[FX-EXPLORER] %s -> %s params=%s", target.entity_id, method, params
            )

            # Keep entity bookkeeping consistent with a native activation so the
            # camera preview and later refreshes behave correctly.
            if is_fx:
                target._is_on = True
                target._fx_mode_is_direct = False
                target._in_native_fw_mode = True   # Lamp in firmware-native mode (FX Explorer)
                target._last_fx_mode_time = 0.0
                notify = getattr(target, "_notify_camera_preview", None)
                if notify:
                    notify()
                # Always reflect the current firmware command in the entity
                # state so the lamp-preview card matches exactly what selecting
                # the same clock style / effect from the device settings page
                # would show -- not just the mode, but the specific style,
                # colour and options (so clock_style_id, and thus the masked
                # effect / colour the card renders, are correct even when
                # persist is unchecked).
                if is_clock_command:
                    target._mode = MODE_CLOCK
                    if effect_style in NATIVE_CLOCK_STYLES:
                        target._native_clock_style = effect_style
                    if isinstance(effect_config, dict):
                        if "color" in effect_config:
                            _color = effect_config["color"]
                            target._native_clock_color = (
                                int(_color[0])
                                if isinstance(_color, list) and _color
                                else int(_color)
                            )
                        else:
                            target._native_clock_color = None
                        if "data" in effect_config:
                            try:
                                _cb = base64.b64decode(effect_config["data"])
                                if len(_cb) >= 1:
                                    target._native_clock_content = {
                                        1: "time",
                                        2: "time_date",
                                        3: "date",
                                    }.get(_cb[0], target._native_clock_content)
                                    target._native_clock_show_date = _cb[0] == 2
                                if len(_cb) >= 3:
                                    target._native_clock_12_hour = _cb[2] == 1
                                if len(_cb) >= 4:
                                    # Firmware byte is inverted: 0 blinks, 1 steady.
                                    target._native_clock_colon_blink = _cb[3] == 0
                            except Exception:
                                pass
                        # Reflect the mixer flow direction so the preview matches
                        # the direction applied to the clock on the lamp.
                        if "direction" in effect_config:
                            for _dn, _dv in NATIVE_EFFECT_DIRECTION_VALUES.items():
                                if _dv == effect_config["direction"]:
                                    target._native_effect_direction = _dn
                                    break
                elif native_effect_name is not None:
                    target._mode = MODE_NATIVE_EFFECT
                    target._native_effect = native_effect_name
                    if isinstance(effect_config, dict):
                        if "rate" in effect_config:
                            try:
                                target._native_effect_speed = max(
                                    1, min(255, int(effect_config["rate"]))
                                )
                            except (TypeError, ValueError):
                                pass
                        if "direction" in effect_config:
                            for _dn, _dv in NATIVE_EFFECT_DIRECTION_VALUES.items():
                                if _dv == effect_config["direction"]:
                                    target._native_effect_direction = _dn
                                    break
                if target.hass is not None:
                    if (
                        is_clock_command
                        or native_effect_name is not None
                    ):
                        target._refresh_linked_entities()
                    target.async_write_ha_state()
            elif method == "start_cf":
                # Color flow leaves the panel on but not in direct FX mode.
                # It is live-only (not persistable through the state model).
                target._is_on = True
                target._fx_mode_is_direct = False
                target._in_native_fw_mode = True   # Lamp in color-flow mode (FX Explorer)
                target._last_fx_mode_time = 0.0

            persisted = False
            # Persist for the native clock effect (known style ID) OR a native
            # animation effect, so a Force Refresh / state update re-applies it
            # instead of reverting. Arbitrary/unknown raw values can't be
            # persisted through the state model and are left as live-only.
            if (
                persist
                and is_clock_command
                and effect_style in NATIVE_CLOCK_STYLES
            ):
                target._native_clock_style = effect_style
                target._mode = MODE_CLOCK
                target._is_on = True
                # Persist the color if the raw call supplied one, so subsequent
                # activations keep the same custom color.
                if isinstance(effect_config, dict) and "color" in effect_config:
                    color_value = effect_config["color"]
                    if isinstance(color_value, list) and color_value:
                        target._native_clock_color = int(color_value[0])
                    else:
                        target._native_clock_color = int(color_value)
                elif isinstance(effect_config, dict) and "color" not in effect_config:
                    target._native_clock_color = None
                # Decode the 4-byte data payload to persist clock settings so
                # subsequent activations (brightness change, refresh, etc.) use
                # the values the caller explicitly sent rather than reverting to
                # the old entity state.  Format (matches _native_clock_data_bytes):
                #   [show_date(1/2), tz_offset, 12h(0/1), colon_steady(0=blink)]
                if isinstance(effect_config, dict) and "data" in effect_config:
                    try:
                        clock_bytes = base64.b64decode(effect_config["data"])
                        if len(clock_bytes) >= 1:
                            target._native_clock_show_date = clock_bytes[0] == 2
                        if len(clock_bytes) >= 3:
                            target._native_clock_12_hour = clock_bytes[2] == 1
                        if len(clock_bytes) >= 4:
                            # Firmware byte is inverted: 0 = blink, 1 = steady
                            target._native_clock_colon_blink = clock_bytes[3] == 0
                    except Exception:
                        pass
                # Record the current UTC offset so the periodic ``async_update``
                # timezone check does not immediately fire a SECOND clock
                # activation (which races this one for the hardware lock and
                # visibly resets the panel). ``_activate_native_clock`` sets this
                # on the normal path; the raw FX path must do the same.
                target._native_clock_timezone_offset = (
                    target._native_clock_timezone_hours()
                )
                if target.hass is not None:
                    target.async_schedule_update_ha_state()
                    target._refresh_linked_entities()
                persisted = True
                _LOGGER.warning(
                    "[FX-EXPLORER] persisted clock style=%s on %s",
                    effect_style,
                    target.entity_id,
                )
            elif persist and native_effect_name is not None:
                target._native_effect = native_effect_name
                target._mode = MODE_NATIVE_EFFECT
                target._is_on = True
                if isinstance(effect_config, dict):
                    if "rate" in effect_config:
                        try:
                            target._native_effect_speed = max(
                                1, min(255, int(effect_config["rate"]))
                            )
                        except (TypeError, ValueError):
                            pass
                    if "direction" in effect_config:
                        # Reverse-map the numeric direction to its name.
                        for _dname, _dval in NATIVE_EFFECT_DIRECTION_VALUES.items():
                            if _dval == effect_config["direction"]:
                                target._native_effect_direction = _dname
                                break
                if target.hass is not None:
                    target.async_schedule_update_ha_state()
                    target._refresh_linked_entities()
                persisted = True
                _LOGGER.warning(
                    "[FX-EXPLORER] persisted native effect=%s on %s",
                    native_effect_name,
                    target.entity_id,
                )
            return {
                "ok": True,
                "method": method,
                "params": params,
                "persisted": persisted,
            }
        except Exception as e:  # noqa: BLE001 -- debug tool, surface any error
            _LOGGER.error("[FX-EXPLORER] send failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e), "method": method, "params": params}

    async def handle_query_raw(service_call):
        """DEBUG: send a raw command and RETURN the lamp's reply.

        Companion to send_fx_effect for the decoder/capture card. Lets you
        probe the device (e.g. get_prop) and observe how it responds to
        experimental commands. Not a stable API.
        """
        method = service_call.data.get("method") or "get_prop"
        params = service_call.data.get("params")
        if params is None:
            params = []
        target = _resolve_entity(service_call, "QUERY_RAW")
        if target is None:
            return {"ok": False, "error": "entity not found"}
        try:
            reply = await target._cube_matrix.query_raw_command(method, params)
            _LOGGER.warning(
                "[FX-QUERY] %s -> %s params=%s reply=%r",
                target.entity_id,
                method,
                params,
                reply,
            )
            parsed = None
            try:
                parsed = json.loads(reply) if reply else None
            except (ValueError, TypeError):
                parsed = None
            return {
                "ok": True,
                "method": method,
                "params": params,
                "reply": reply,
                "parsed": parsed,
            }
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error("[FX-QUERY] query failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e), "method": method, "params": params}

    async def handle_get_capabilities(service_call):
        """DEBUG: fetch the lamp's SSDP capabilities (yeelight get_capabilities).

        Mirrors ``Bulb.get_capabilities()`` from the yeelight library: sends an
        SSDP M-SEARCH to the device and returns the advertised capability
        headers (id, model, fw_ver, power, bright, rgb, support, ...). This is a
        UDP discovery query, NOT a LAN JSON-RPC call, so it works regardless of
        the active content mode. Not a stable API.
        """
        target = _resolve_entity(service_call, "GET_CAPABILITIES")
        if target is None:
            return {"ok": False, "error": "entity not found"}
        try:
            caps = await hass.async_add_executor_job(
                target._cube_matrix.device.get_capabilities
            )
            _LOGGER.warning(
                "[FX-CAPS] %s -> %r", target.entity_id, caps
            )
            if not caps:
                return {
                    "ok": True,
                    "capabilities": {},
                    "note": "lamp sent no SSDP reply (check IP / same subnet)",
                }
            return {"ok": True, "capabilities": dict(caps)}
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error("[FX-CAPS] get_capabilities failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e)}

    # Read-only yeelight Bulb members exposed to the FX Explorer introspection
    # buttons. Methods are invoked with no args; properties are read. Members
    # that change device state (turn_*/set_*/start_flow/...) are excluded.
    _BULB_INFO_MEMBERS = (
        "get_capabilities",
        "get_model_specs",
        "get_properties",
        "bulb_type",
        "capabilities",
        "model",
        "music_mode",
        "music_mode_state",
        "last_properties",
    )

    # Write methods callable with positional ``args`` (and optional ``kwargs``),
    # e.g. set_rgb(r, g, b). These DO change the lamp. Enum-typed leading args
    # (PowerMode/SceneClass/CronType) and the light_type kwarg are coerced from
    # ints below. start_music/listen are omitted (they block or can freeze the
    # library if the bulb can't connect back); start_flow/set_capabilities need
    # Python objects and are handled via the raw start_cf sender instead.
    _BULB_ACTION_MEMBERS = (
        "set_rgb",
        "set_hsv",
        "set_color_temp",
        "set_brightness",
        "turn_on",
        "turn_off",
        "toggle",
        "dev_toggle",
        "ensure_on",
        "set_default",
        "set_name",
        "set_power_mode",
        "set_adjust",
        "set_scene",
        "cron_add",
        "cron_del",
        "cron_get",
        "stop_flow",
        "stop_music",
        "send_command",
    )

    def _coerce_bulb_call(member, args, kwargs):
        """Convert enum-typed args/kwargs (ints from JSON) to yeelight enums."""
        try:
            from yeelight import CronType, LightType, PowerMode, SceneClass
        except Exception:  # noqa: BLE001 -- library always present at runtime
            return args, kwargs
        if "light_type" in kwargs:
            try:
                kwargs["light_type"] = LightType(int(kwargs["light_type"]))
            except (ValueError, TypeError):
                pass
        if args:
            enum_for = {
                "set_power_mode": PowerMode,
                "set_scene": SceneClass,
                "cron_add": CronType,
                "cron_del": CronType,
                "cron_get": CronType,
            }.get(member)
            if enum_for is not None:
                try:
                    args[0] = enum_for(int(args[0]))
                except (ValueError, TypeError):
                    pass
        return args, kwargs

    async def handle_bulb_call(service_call):
        """DEBUG: read or invoke an allowlisted member of the yeelight Bulb.

        ``member`` must be in the read-only introspection allowlist (invoked with
        no args / read as a property) or the write-action allowlist (invoked with
        the positional ``args`` list and optional ``kwargs`` dict, e.g. ``set_rgb``
        with ``[255, 0, 0]``). Enum params (light_type/PowerMode/SceneClass/
        CronType) may be given as ints. Anything else is rejected. Not a stable API.
        """
        member = service_call.data.get("member")
        raw_args = service_call.data.get("args")
        args = list(raw_args) if isinstance(raw_args, (list, tuple)) else []
        raw_kwargs = service_call.data.get("kwargs")
        kwargs = dict(raw_kwargs) if isinstance(raw_kwargs, dict) else {}
        target = _resolve_entity(service_call, "BULB_CALL")
        if target is None:
            return {"ok": False, "error": "entity not found"}
        is_action = member in _BULB_ACTION_MEMBERS
        if member not in _BULB_INFO_MEMBERS and not is_action:
            return {
                "ok": False,
                "error": f"member not allowed: {member!r}",
                "allowed": list(_BULB_INFO_MEMBERS + _BULB_ACTION_MEMBERS),
            }
        bulb = target._cube_matrix.device
        if is_action:
            args, kwargs = _coerce_bulb_call(member, args, kwargs)
        # Write actions and the read members that open the control socket use the
        # library socket; close it afterwards so no connection lingers.
        uses_control_socket = is_action or member in ("get_properties", "bulb_type")

        def _call():
            attr = getattr(bulb, member)
            if callable(attr):
                value = attr(*args, **kwargs) if is_action else attr()
            else:
                value = attr
            if uses_control_socket:
                try:
                    target._cube_matrix.close_command_socket()
                except Exception:  # noqa: BLE001
                    pass
            return value

        try:
            value = await hass.async_add_executor_job(_call)
            # Normalize enums/sets/other non-JSON types to strings.
            safe = json.loads(json.dumps(value, default=str))
            safe_args = json.loads(json.dumps(args, default=str))
            _LOGGER.warning(
                "[FX-BULB] %s .%s(args=%s kwargs=%s) -> %r",
                target.entity_id,
                member,
                args if is_action else "",
                kwargs if is_action else "",
                value,
            )
            return {
                "ok": True,
                "member": member,
                "args": safe_args if is_action else [],
                "value": safe,
            }
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error(
                "[FX-BULB] %s.%s failed: %s",
                target.entity_id,
                member,
                e,
                exc_info=True,
            )
            return {"ok": False, "member": member, "error": str(e)}

    async def handle_set_default(service_call):
        """DEBUG: Snapshot the lamp's CURRENT state as its power-on default.

        Sends the documented ``set_default`` command so that after a power cut
        the Cube restores whatever it is showing right now. Not a stable API.
        """
        target = _resolve_entity(service_call, "SET_DEFAULT")
        if target is None:
            return {"ok": False, "error": "entity not found"}
        try:
            target._cube_matrix.close_fast_socket()
            await target._cube_matrix.send_raw_command("set_default", [])
            _LOGGER.warning("[SET-DEFAULT] %s saved current state as default", target.entity_id)
            return {"ok": True}
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error("[SET-DEFAULT] failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e)}

    # DEBUG: raw firmware command explorer (used by the FX Explorer card).
    # Local reverse-engineering tool -- not a stable API.
    hass.services.async_register(
        DOMAIN,
        "send_fx_effect",
        _admin_only(handle_send_fx_effect),
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("method"): cv.string,
            vol.Optional("params"): list,
            vol.Optional("mode"): int,
            vol.Optional("effect_id"): int,
            vol.Optional("style_id"): int,
            vol.Optional("apply"): int,
            vol.Optional("mixer"): int,
            vol.Optional("rate"): int,
            vol.Optional("data"): cv.string,
            vol.Optional("data_bytes"): list,
            vol.Optional("color"): vol.Any(int, [int]),
            vol.Optional("close_socket"): bool,
            vol.Optional("persist"): bool,
        }, extra=vol.ALLOW_EXTRA),        supports_response=SupportsResponse.OPTIONAL,
    )

    # DEBUG: raw query (send + capture the lamp's reply) for the decoder card.
    hass.services.async_register(
        DOMAIN,
        "query_raw",
        _admin_only(handle_query_raw),
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Optional("method"): cv.string,
            vol.Optional("params"): list,
        }, extra=vol.ALLOW_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )

    # DEBUG: SSDP capabilities probe (yeelight Bulb.get_capabilities) for the card.
    hass.services.async_register(
        DOMAIN,
        "get_capabilities",
        _admin_only(handle_get_capabilities),
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )

    # DEBUG: read-only yeelight Bulb introspection (get_model_specs, bulb_type, ...).
    hass.services.async_register(
        DOMAIN,
        "bulb_call",
        _admin_only(handle_bulb_call),
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Required("member"): cv.string,
            vol.Optional("args"): list,
            vol.Optional("kwargs"): dict,
        }, extra=vol.ALLOW_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )

    # DEBUG: spec-lab experiments (music mode benchmark, set_default, notify).
    hass.services.async_register(
        DOMAIN,
        "set_default",
        _admin_only(handle_set_default),
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def handle_test_display(service_call):
        """Test service to manually trigger display mode application for debugging."""
        target_entity = _resolve_entity(service_call, "TEST_DISPLAY")
        if not target_entity:
            return
        
        _LOGGER.debug("[TEST] handle_test_display called")
        _LOGGER.debug(f"[TEST] Testing entity: {target_entity._attr_name}")
        _LOGGER.debug(f"[TEST] Current state - text: '{target_entity._custom_text}', mode: '{target_entity._mode}', is_on: {target_entity._is_on}")
        _LOGGER.debug(f"[TEST] Text colors: {target_entity._text_colors}")
        _LOGGER.debug(f"[TEST] Background color: {target_entity._background_color}")
        _LOGGER.debug(f"[TEST] Brightness: {target_entity._brightness}")
        _LOGGER.debug(f"[TEST] Alignment: {target_entity._alignment}")
        _LOGGER.debug(f"[TEST] Font: {target_entity._font}")
        _LOGGER.debug(f"[TEST] Connection status - has_error: {getattr(target_entity, '_connection_error', False)}, last_error: {getattr(target_entity, '_last_connection_error', 'None')}")
        
        # Force the light to be on and apply display mode.
        # Reset _fx_mode_is_direct so apply() calls ensure_fx_ready()
        # to re-establish FX mode via raw TCP.
        target_entity._is_on = True
        target_entity._fx_mode_is_direct = False
        _LOGGER.debug("[TEST] About to call async_apply_display_mode...")
        await target_entity.async_apply_display_mode(update_type='color_change')
        _LOGGER.debug("[TEST] Display mode applied")
        
        # Report final connection status
        _LOGGER.debug(f"[TEST] After apply - connection_error: {getattr(target_entity, '_connection_error', False)}")

    hass.services.async_register(
        DOMAIN,
        "test_display",
        handle_test_display,
        schema=vol.Schema({
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        }),
        supports_response=False
    )

    async def handle_set_color_accuracy(service_call):
        """Toggle hardware colour accuracy correction (per-channel gain).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_COLOR_ACCURACY")
        if not targets:
            return

        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity._color_accuracy_enabled = enabled
            _LOGGER.debug(
                f"[COLOR_ACCURACY] [{target_entity._ip}] "
                f"Color accuracy {'enabled' if enabled else 'disabled'}"
            )
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            # Re-render the display with correction applied/removed
            target_entity._create_tracked_task(
                target_entity.async_apply_display_mode(),
                name=f"yeelight_cube_apply_color_accuracy_{target_entity._ip}"
            )

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_color_accuracy",
        handle_set_color_accuracy,
        schema=vol.Schema({
            vol.Required("enabled"): vol.Coerce(bool),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    # DEBUG: Color calibration service
    async def handle_set_color_calibration(service_call):
        """Set color correction / accuracy calibration values at runtime.
        All fields are optional -- only provided values are updated."""
        targets = _resolve_entities(service_call, "SET_COLOR_CALIBRATION")
        if not targets:
            return

        data = service_call.data
        mapping = {
            "gamma_r": "_calib_gamma_r",
            "gamma_g": "_calib_gamma_g",
            "gamma_b": "_calib_gamma_b",
            "hw_threshold": "_calib_hw_threshold",
            "hw_full": "_calib_hw_full",
            "channel_balance": "_calib_channel_balance",
            "gain_r": "_calib_gain_r",
            "gain_g": "_calib_gain_g",
            "gain_b": "_calib_gain_b",
            # System 3: Unified brightness curve
            "hw_floor": "_calib_hw_floor",
            "darken_floor": "_calib_darken_floor",
            "hw_curve": "_calib_hw_curve",
            "darken_curve": "_calib_darken_curve",
            "floor_r": "_calib_floor_r",
            "floor_g": "_calib_floor_g",
            "floor_b": "_calib_floor_b",
        }

        async def _apply_one(target_entity):
            changed = []
            for key, attr in mapping.items():
                if key in data:
                    old_val = getattr(target_entity, attr)
                    new_val = data[key]
                    setattr(target_entity, attr, new_val)
                    changed.append(f"{key}: {old_val} -> {new_val}")
            if changed:
                _LOGGER.info(
                    f"[CALIBRATION] [{target_entity._ip}] Updated: {', '.join(changed)}"
                )
                if target_entity.hass is not None:
                    target_entity.async_schedule_update_ha_state()
                # Re-render so new calibration takes effect immediately
                target_entity._create_tracked_task(
                    target_entity.async_apply_display_mode(),
                    name=f"yeelight_cube_apply_calibration_{target_entity._ip}"
                )

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_color_calibration",
        _admin_only(handle_set_color_calibration),
        schema=vol.Schema({
            vol.Optional("gamma_r"): vol.Coerce(float),
            vol.Optional("gamma_g"): vol.Coerce(float),
            vol.Optional("gamma_b"): vol.Coerce(float),
            vol.Optional("hw_threshold"): vol.Coerce(int),
            vol.Optional("hw_full"): vol.Coerce(int),
            vol.Optional("channel_balance"): vol.Coerce(float),
            vol.Optional("gain_r"): vol.Coerce(float),
            vol.Optional("gain_g"): vol.Coerce(float),
            vol.Optional("gain_b"): vol.Coerce(float),
            # System 3: Unified brightness curve
            vol.Optional("hw_floor"): vol.Coerce(int),
            vol.Optional("darken_floor"): vol.Coerce(int),
            vol.Optional("hw_curve"): vol.Coerce(float),
            vol.Optional("darken_curve"): vol.Coerce(float),
            vol.Optional("floor_r"): vol.Coerce(int),
            vol.Optional("floor_g"): vol.Coerce(int),
            vol.Optional("floor_b"): vol.Coerce(int),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_calibration_lock(service_call):
        """Take/release exclusive control of the lamp for the calibration wizard.
        While locked, the lamp ignores display/brightness/turn_on commands that
        don't carry bypass_lock=True (i.e. everything except the wizard itself),
        so automations can't disturb the calibration session."""
        targets = _resolve_entities(service_call, "SET_CALIBRATION_LOCK")
        if not targets:
            return
        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity._set_calibration_lock(enabled)

        _fire_and_forget(*[_apply_one(t) for t in targets])

    hass.services.async_register(
        DOMAIN,
        "set_calibration_lock",
        _admin_only(handle_set_calibration_lock),
        schema=vol.Schema({
            vol.Required("enabled"): vol.Coerce(bool),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )
