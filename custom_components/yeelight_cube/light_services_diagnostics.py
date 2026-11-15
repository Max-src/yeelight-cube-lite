"""Diagnostic and calibration actions (mostly admin-only): raw lamp
commands, capabilities, python-yeelight calls, color calibration and the
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
    DOMAIN,
)
from .effect_catalog import (
    NATIVE_CLOCK_APPLY,
    NATIVE_CLOCK_EFFECT_ID,
    NATIVE_CLOCK_STYLES,
    NATIVE_EFFECTS,
)
from .fx_guard import command_refusal, running_after
from .light import _entity_id_or_list
from .light_services_common import (
    _resolve_entity,
    _resolve_entities,
    make_admin_only,
    make_lamp_runner,
)

_LOGGER = logging.getLogger(__name__)


def _fx_params(data, target) -> list:
    """The raw ``set_fx_effect`` params [effect id, style, apply, config] of
    a send_fx_effect call: its own ``params``, else built from its fields."""
    if data.get("params") is not None:
        return data["params"]
    mode = int(data.get("mode", NATIVE_CLOCK_EFFECT_ID))
    style_id = int(data.get("style_id", 0))
    apply = int(data.get("apply", NATIVE_CLOCK_APPLY))
    mixer = int(data.get("mixer", 0))
    config = {"mode": mode, "mixer": mixer}
    data_b64 = data.get("data")
    data_bytes = data.get("data_bytes")
    if data_b64 is not None:
        config["data"] = data_b64
    elif data_bytes is not None:
        config["data"] = base64.b64encode(
            bytes(int(b) & 0xFF for b in data_bytes)
        ).decode("ascii")
    # The lamp's clock effect (mode 40) REQUIRES a data payload
    # (date/timezone/12h/colon). If none was supplied explicitly, build it
    # from the lamp's current clock settings -- exactly like
    # _activate_native_clock -- otherwise the clock renders blank.
    if mode == NATIVE_CLOCK_EFFECT_ID and "data" not in config:
        config["data"] = base64.b64encode(
            target.native_clock_data_bytes()
        ).decode("ascii")
    color = data.get("color")
    if color is not None:
        config["color"] = color if isinstance(color, list) else [int(color)]
    # Optional animation speed. The lamp's clock effect (mode 40) accepts a
    # `rate` field just like native effects.
    rate = data.get("rate")
    if rate is not None:
        try:
            config["rate"] = int(rate)
        except (TypeError, ValueError):
            pass
    # The first array element (command/effect id) usually equals the config
    # mode, but some renderers only unlock their full output under a different
    # command id (e.g. Fireworks needs 71 while the clock config keeps mode
    # 40). Allow overriding it independently.
    command_id = data.get("effect_id")
    command_id = int(command_id) if command_id is not None else mode
    return [command_id, style_id, apply, config]


def _fx_effect_parts(params):
    """(effect mode, style, config) of raw fx params [mode, style_id, apply,
    config]; None for a part that is missing or invalid."""
    effect_mode = effect_style = effect_config = None
    try:
        if isinstance(params, list) and len(params) >= 2:
            effect_mode = int(params[0])
            effect_style = int(params[1])
        if isinstance(params, list) and len(params) >= 4 and isinstance(params[3], dict):
            effect_config = params[3]
    except (TypeError, ValueError):
        pass
    return effect_mode, effect_style, effect_config


def async_register_diagnostics_services(hass: HomeAssistant) -> None:
    """Register the diagnostics actions."""
    _admin_only = make_admin_only(hass)
    run_on_lamps = make_lamp_runner(hass)

    async def handle_send_fx_effect(service_call):
        """DEBUG: send a raw LAN command (default ``set_fx_effect``).

        Local debug tool for sending raw commands to the lamp. NOT part of
        the stable API -- do not rely on it in automations.

        Either supply ``params`` directly (a raw JSON array sent verbatim), or
        supply the structured fields (mode/style_id/apply/mixer/color/data*)
        and this handler assembles the standard 4-element params list:
            [mode, style_id, apply, {mode, mixer, [color], [data]}]
        """
        method = service_call.data.get("method") or "set_fx_effect"
        close_socket = bool(service_call.data.get("close_socket", True))
        persist = bool(service_call.data.get("persist", False))

        target = _resolve_entity(service_call, "SEND_FX_EFFECT")

        params = _fx_params(service_call.data, target)
        effect_mode, effect_style, effect_config = _fx_effect_parts(params)
        # The guard's own record of raw effects: one never reaches
        # _lamp_client.running_effect, whose live updates need the lamp's
        # answer, which a raw send does not read.
        running = target.raw_fx_effect
        if refusal := command_refusal(method, params, running, target.effect_profile):
            _LOGGER.warning("[RAW-SEND] refused: %s", refusal)
            return {"ok": False, "error": refusal, "method": method, "params": params}

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

        # Is this a built-in fx command (clock or native effect)? Both need the
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
                    await target.async_leave_direct_mode()
                # The lamp's clock (mode 40) is order-sensitive: sending
                # set_bright BEFORE set_fx_effect can CANCEL the clock
                # activation (see _activate_native_clock). So for clock we send
                # the fx command first, then brightness. Native effects are the
                # opposite -- they want the set_bright prelude first so they
                # render immediately. Detect the clock from the CONFIG mode so an
                # overridden command id (e.g. Fireworks 71) still counts.
                is_clock = is_clock_command
                if is_fx and is_clock:
                    await asyncio.sleep(0.1)
                    await target.lamp_client.send_raw_command(
                        method, params, abortive_close=False
                    )
                    await asyncio.sleep(0.1)
                    await target.async_send_native_mode_brightness()
                    return
                if is_fx:
                    await target.async_send_native_mode_brightness()
                    await asyncio.sleep(0.1)
                # Color flow (start_cf) renders only while the panel is powered
                # on, and runs entirely on the lamp afterwards. Power on first so
                # the flow is visible even if the panel was off/idle.
                if method == "start_cf":
                    await target.lamp_client.send_raw_command("set_power", ["on"])
                    await asyncio.sleep(0.1)
                await target.lamp_client.send_raw_command(method, params)

            # Run under the device hardware lock so the send is serialized with
            # the persistent socket / background loop (prevents the command from
            # being clobbered mid-flight).
            sent = await target.async_run_exclusive(_do_send, "raw_send")
            if method in ("set_fx_effect", "update_fx_effect"):
                target.raw_fx_effect = (
                    None if sent is False else running_after(method, params, running)
                )
            _LOGGER.info(
                "[RAW-SEND] %s -> %s params=%s", target.entity_id, method, params
            )

            # Keep entity bookkeeping consistent with a native activation so the
            # camera preview and later refreshes behave correctly.
            if is_fx:
                # The lamp is on, in a built-in mode; a raw command may have
                # set its brightness: sent again with direct mode, before any
                # frame.
                target.note_raw_builtin_command()
                target.notify_camera_preview()
                # Always reflect the current lamp command in the entity
                # state so the lamp-preview card matches exactly what selecting
                # the same clock style / effect from the device settings page
                # would show (also when persist is unchecked).
                target.reflect_lamp_command(
                    is_clock_command, effect_style, effect_config, native_effect_name,
                )
                if target.hass is not None:
                    if (
                        is_clock_command
                        or native_effect_name is not None
                    ):
                        target.refresh_controls()
                    target.async_write_ha_state()
            elif method == "start_cf":
                # Color flow leaves the panel on but not in direct FX mode.
                # It is live-only (not persistable through the state model).
                target.note_raw_builtin_command()

            persisted = False
            # Persist for the native clock effect (known style ID) OR a native
            # animation effect, so a Force Refresh / state update re-applies it
            # instead of reverting. Arbitrary/unknown raw values can't be
            # persisted through the state model and are left as live-only.
            persist_clock = is_clock_command and effect_style in NATIVE_CLOCK_STYLES
            if persist and (persist_clock or native_effect_name is not None):
                target.reflect_lamp_command(
                    persist_clock, effect_style, effect_config, native_effect_name,
                )
                target.note_lamp_on()
                if persist_clock:
                    # Record the current UTC offset so the hourly
                    # ``async_update`` timezone check does not fire
                    # a SECOND clock activation (which races this one for the
                    # hardware lock and visibly resets the panel).
                    # ``_activate_native_clock`` sets this on the normal path;
                    # the raw FX path must do the same.
                    target.note_clock_timezone()
                if target.hass is not None:
                    target.async_schedule_update_ha_state()
                    target.refresh_controls()
                persisted = True
                _LOGGER.info(
                    "[RAW-SEND] persisted %s on %s",
                    f"clock style={effect_style}"
                    if persist_clock
                    else f"native effect={native_effect_name}",
                    target.entity_id,
                )
            return {
                "ok": True,
                "method": method,
                "params": params,
                "persisted": persisted,
            }
        except Exception as e:  # noqa: BLE001 -- debug tool, surface any error
            _LOGGER.error("[RAW-SEND] send failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e), "method": method, "params": params}

    async def handle_query_raw(service_call):
        """DEBUG: send a raw command and RETURN the lamp's reply.

        Companion to send_fx_effect: a local debug tool that reads the
        device's replies (e.g. get_prop) and how it responds to
        experimental commands. Not a stable API.
        """
        method = service_call.data.get("method") or "get_prop"
        params = service_call.data.get("params")
        if params is None:
            params = []
        target = _resolve_entity(service_call, "QUERY_RAW")
        running = target.raw_fx_effect
        if refusal := command_refusal(method, params, running, target.effect_profile):
            _LOGGER.warning("[FX-QUERY] refused: %s", refusal)
            return {"ok": False, "error": refusal, "method": method, "params": params}
        try:
            reply = await target.lamp_client.query_raw_command(method, params)
            if method in ("set_fx_effect", "update_fx_effect"):
                target.raw_fx_effect = running_after(method, params, running)
            _LOGGER.info(
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
        try:
            caps = await hass.async_add_executor_job(
                target.lamp_client.device.get_capabilities
            )
            _LOGGER.info(
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

    # Read-only yeelight Bulb members exposed to the debug introspection
    # action. Methods are invoked with no args; properties are read. Members
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
        is_action = member in _BULB_ACTION_MEMBERS
        if member not in _BULB_INFO_MEMBERS and not is_action:
            return {
                "ok": False,
                "error": f"member not allowed: {member!r}",
                "allowed": list(_BULB_INFO_MEMBERS + _BULB_ACTION_MEMBERS),
            }
        bulb = target.lamp_client.device
        # The library goes straight to the lamp: a Cube Matrix's refusals
        # (DeviceProfile.refusal) are checked here.
        sent = (
            (str(args[0]), args[1] if len(args) > 1 else [])
            if member == "send_command" and args
            else (member, list(args))
        )
        if is_action and (refusal := target.lamp_client.profile.refusal(*sent)):
            return {"ok": False, "member": member, "error": refusal}
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
                    target.lamp_client.close_command_socket()
                except OSError as err:
                    _LOGGER.debug("[BULB_CALL] Closing the command socket failed: %s", err)
            return value

        try:
            value = await hass.async_add_executor_job(_call)
            # Normalize enums/sets/other non-JSON types to strings.
            safe = json.loads(json.dumps(value, default=str))
            safe_args = json.loads(json.dumps(args, default=str))
            _LOGGER.info(
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
        try:
            target.lamp_client.close_fast_socket()
            await target.lamp_client.send_raw_command("set_default", [])
            _LOGGER.info("[SET-DEFAULT] %s saved current state as default", target.entity_id)
            return {"ok": True}
        except Exception as e:  # noqa: BLE001 -- debug tool
            _LOGGER.error("[SET-DEFAULT] failed: %s", e, exc_info=True)
            return {"ok": False, "error": str(e)}

    async def handle_force_tcp(service_call):
        """DEBUG: send the lamps' commands over TCP for some minutes (0: UDP
        again), to test the TCP fallback on demand."""
        seconds = service_call.data["minutes"] * 60
        targets = _resolve_entities(service_call, "FORCE_TCP")
        for target in targets:
            target.lamp_client.force_tcp(seconds)
            target.async_write_ha_state()  # its connection attribute
            _LOGGER.info("[FORCE-TCP] %s over %s for %ss", target.entity_id, target.lamp_client.transport, seconds)
        return {target.entity_id: target.lamp_client.transport for target in targets}

    hass.services.async_register(
        DOMAIN,
        "force_tcp",
        _admin_only(handle_force_tcp),
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
            vol.Required("minutes"): vol.All(vol.Coerce(float), vol.Range(min=0, max=60)),
        }),
        supports_response=SupportsResponse.OPTIONAL,
    )

    # DEBUG: send a raw command to the lamp.
    # Local debug tool -- not a stable API.
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

    # DEBUG: raw query (send + read the lamp's reply).
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
        
        _LOGGER.debug("[TEST] handle_test_display called")
        _LOGGER.debug("[TEST] Testing entity: %s", target_entity.lamp_name)
        _LOGGER.debug("[TEST] Current state - text: '%s', mode: '%s', is_on: %s", target_entity.custom_text, target_entity.mode, target_entity.is_on)
        _LOGGER.debug("[TEST] Text colors: %s", target_entity.text_colors)
        _LOGGER.debug("[TEST] Brightness: %s", target_entity.brightness)
        _LOGGER.debug("[TEST] Alignment: %s", target_entity.alignment)
        _LOGGER.debug("[TEST] Font: %s", target_entity.font)
        _LOGGER.debug("[TEST] Connection status - last_error: %s", target_entity.connection_diagnostics()["last_connection_error"])
        
        # Force the light to be on and apply display mode.
        # Reset _fx_mode_is_direct so apply() calls ensure_fx_ready()
        # to re-establish FX mode via raw TCP.
        target_entity.note_lamp_on()
        target_entity.forget_direct_mode()
        _LOGGER.debug("[TEST] About to call async_apply_display_mode...")
        await target_entity.async_apply_display_mode(update_type='color_change')
        _LOGGER.debug("[TEST] Display mode applied")
        
        # Report final connection status
        _LOGGER.debug("[TEST] After apply - last connection error: %s", target_entity.connection_diagnostics()["last_connection_error"])

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
        """Toggle hardware color accuracy correction (per-channel gain).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_COLOR_ACCURACY")

        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity.set_setting("_color_accuracy_enabled", enabled)
            _LOGGER.debug(
                "[COLOR_ACCURACY] [%s] "
                "Color accuracy %s",
                target_entity.ip, 'enabled' if enabled else 'disabled'
            )
            if target_entity.hass is not None:
                target_entity.async_schedule_update_ha_state()
            # Re-render the display with correction applied/removed
            target_entity.redraw_in_background("yeelight_cube_apply_color_accuracy")

        run_on_lamps("SET_COLOR_ACCURACY", targets, _apply_one)

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
                    "[CALIBRATION] [%s] Updated: %s", target_entity.ip, ', '.join(changed)
                )
                if target_entity.hass is not None:
                    target_entity.async_schedule_update_ha_state()
                # Re-render so new calibration takes effect immediately
                target_entity.redraw_in_background("yeelight_cube_apply_calibration")

        run_on_lamps("SET_COLOR_CALIBRATION", targets, _apply_one)

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
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_calibration_lock(service_call):
        """Take/release exclusive control of the lamp for the calibration wizard.
        While locked, the lamp ignores display/brightness/turn_on commands that
        don't carry bypass_lock=True (i.e. everything except the wizard itself),
        so automations can't disturb the calibration session."""
        targets = _resolve_entities(service_call, "SET_CALIBRATION_LOCK")
        enabled = bool(service_call.data.get("enabled", False))

        async def _apply_one(target_entity):
            target_entity.set_calibration_lock(enabled)

        run_on_lamps("SET_CALIBRATION_LOCK", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_calibration_lock",
        _admin_only(handle_set_calibration_lock),
        schema=vol.Schema({
            vol.Required("enabled"): vol.Coerce(bool),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )
