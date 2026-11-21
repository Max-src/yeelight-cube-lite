"""Display actions: text, colors, gradient mode and angle, brightness,
orientation, font, image, preview adjustments, freeze and save/restore of
the display state.

Registered by :func:`light_services.async_setup_light_services`.
"""
import asyncio
import logging

import voluptuous as vol  # type: ignore
from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.exceptions import HomeAssistantError  # type: ignore
from homeassistant.helpers import config_validation as cv  # type: ignore

from .color_utils import hex_to_rgb
from .const import (
    DEVICE_ORIENTATIONS,
    MODE_CLOCK,
    MODE_NATIVE_EFFECT,
    DOMAIN,
)
from .errors import failed, invalid, invalid_input
from .image_utils import MAX_IMAGE_B64_LENGTH, image_pixels, image_to_matrix
from .input_error import InputError
from .layout import FONT_MAPS
from .light import _entity_id_or_list
from .light_display import MAX_TEXT_LENGTH
from .light_services_common import (
    COLOR_LIST_SCHEMA,
    _resolve_entity,
    _resolve_entities,
    make_lamp_runner,
)

_LOGGER = logging.getLogger(__name__)


def async_register_display_services(hass: HomeAssistant) -> None:
    """Register the display actions."""
    run_on_lamps = make_lamp_runner(hass)

    async def handle_preview_gradient_modes(service_call):
        """Generate full preview matrices (5 rows, the lamp's frame width:
        device_profile.width) for all gradient modes using entity's current state."""

        target_entity = _resolve_entity(service_call, "PREVIEW_GRADIENT_MODES")
        
        # Every text mode's preview from the lamp's actual state.
        previews = target_entity.gradient_previews()

        # Fire event with preview data
        hass.bus.async_fire(
            f"{DOMAIN}_gradient_preview_response",
            {
                "entity_id": target_entity.entity_id,
                "previews": previews,
                "rows": 5,
                "cols": target_entity.frame_width,
                **target_entity.preview_details(),
            }
        )
        
        return previews

    hass.services.async_register(
        DOMAIN,
        "preview_gradient_modes",
        handle_preview_gradient_modes,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_set_brightness(service_call):
        """Set brightness using Home Assistant's light.turn_on service (1-100%)."""
        brightness_pct = service_call.data.get("brightness", 100)
        bypass_lock = bool(service_call.data.get("bypass_lock", False))
        
        # Clamp to 1-100 range
        brightness_pct = max(1, min(100, brightness_pct))
        
        target_entity = _resolve_entity(service_call, "SET_BRIGHTNESS")
        
        # Map 1-100 slider to Home Assistant brightness (1-255)
        # Formula: map 1-100 to 3-255 (same as lamp preview card)
        ha_brightness = round(3 + ((brightness_pct - 1) * 252) / 99)
        ha_brightness = max(3, min(255, ha_brightness))
        
        _LOGGER.debug("[SET_BRIGHTNESS] Setting brightness to %s%% (HA value: %s) for %s", brightness_pct, ha_brightness, target_entity.entity_id)
        
        try:
            if bypass_lock:
                # Wizard path: call the entity method directly so it bypasses the
                # calibration lock (light.turn_on is blocked while locked).
                await target_entity.set_brightness(ha_brightness, bypass_lock=True)
            else:
                # Use standard Home Assistant light.turn_on service
                await hass.services.async_call(
                    "light",
                    "turn_on",
                    {
                        "entity_id": target_entity.entity_id,
                        "brightness": ha_brightness,
                    },
                    blocking=True
                )
            _LOGGER.debug("[SET_BRIGHTNESS] Successfully set brightness to %s%%", brightness_pct)
        except HomeAssistantError:
            raise
        except Exception as err:  # noqa: BLE001 -- the lamp's own errors, told to the service call
            raise failed("command_failed", error=err) from err

    hass.services.async_register(
        DOMAIN,
        "set_brightness",
        handle_set_brightness,
        schema=vol.Schema({
            vol.Required("brightness", description="Brightness percentage (1-100)"): vol.All(vol.Coerce(int), vol.Range(min=1, max=100)),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        }, extra=vol.ALLOW_EXTRA)
    )

    # The rest of the service handlers (palette, etc.) should also be registered after light_entity is created
    async def handle_set_orientation(service_call):
        orientation = service_call.data.get("orientation")
        
        target_entity = _resolve_entity(service_call, "SET_ORIENTATION")

        await target_entity.set_orientation(orientation)

    hass.services.async_register(
        DOMAIN,
        "set_orientation",
        handle_set_orientation,
        schema=vol.Schema({
            vol.Required("orientation"): vol.In(["normal", "flipped"]),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_device_orientation(service_call):
        orientation = service_call.data.get("orientation")

        targets = _resolve_entities(service_call, "SET_DEVICE_ORIENTATION")
        for target in targets:
            if not target.can_take_commands():
                raise invalid("lamp_off")
        await asyncio.gather(*(target.set_device_orientation(orientation) for target in targets))

    hass.services.async_register(
        DOMAIN,
        "set_device_orientation",
        handle_set_device_orientation,
        schema=vol.Schema({
            vol.Required("orientation"): vol.In(list(DEVICE_ORIENTATIONS)),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_font(service_call):
        font = service_call.data.get("font")
        target_entity = _resolve_entity(service_call, "SET_FONT")

        await target_entity.set_font(font)

    hass.services.async_register(
        DOMAIN,
        "set_font",
        handle_set_font,
        schema=vol.Schema({
            vol.Required("font"): vol.In(list(FONT_MAPS.keys())),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_alignment(service_call):
        alignment = service_call.data.get("alignment")
        target_entity = _resolve_entity(service_call, "SET_ALIGNMENT")

        await target_entity.set_alignment(alignment)

    hass.services.async_register(
        DOMAIN,
        "set_alignment",
        handle_set_alignment,
        schema=vol.Schema({
            vol.Required("alignment"): vol.In(["left", "center", "right"]),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_custom_text(service_call):
        # Supports multi-entity parallel dispatch
        text = service_call.data.get("text")
        # Prevent empty text -- the lamp misbehaves when given
        # an empty string.  Use a single space instead (renders as blank).
        if text == "":
            text = " "

        targets = _resolve_entities(service_call, "SET_CUSTOM_TEXT")

        async def _apply_one(target_entity):
            await target_entity.async_show_custom_text(text)

        run_on_lamps("SET_CUSTOM_TEXT", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_custom_text",
        handle_set_custom_text,
        schema=vol.Schema({
            vol.Required("text", description="Text to display on the cube matrix"): vol.All(
                cv.string, vol.Length(max=MAX_TEXT_LENGTH)
            ),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_angle(service_call):
        # Supports multi-entity parallel dispatch
        angle = service_call.data.get("angle")

        targets = _resolve_entities(service_call, "SET_ANGLE")

        async def _apply_one(target_entity):
            await target_entity.async_set_gradient_angle(angle)

        run_on_lamps("SET_ANGLE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_angle",
        handle_set_angle,
        schema=vol.Schema({
            vol.Required("angle", description="Gradient angle in degrees (0-360). Used for angle-based gradient modes."): vol.Coerce(float),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_text_colors(service_call):
        # Supports multi-entity parallel dispatch
        text_colors = service_call.data.get("text_colors")
        save_as_palette = service_call.data.get("save_as_palette", False)

        converted_colors = [tuple(c) for c in text_colors]

        targets = _resolve_entities(service_call, "SET_TEXT_COLORS")

        if save_as_palette:
            # The documented option: also keep these colors as a saved
            # palette, through save_palette (its limit and naming apply).
            await hass.services.async_call(
                DOMAIN,
                "save_palette",
                {
                    "palette": [list(color) for color in converted_colors],
                    "entity_id": targets[0].entity_id,
                },
                blocking=True,
            )

        async def _apply_one(target_entity):
            # Published at once, like load_palette's: the previews drawing
            # the palette follow without waiting for the lamp.
            await target_entity.async_set_text_colors(converted_colors)

        # The colors are kept with the lamp's state (restored by Home
        # Assistant), not in the integration's storage.
        run_on_lamps("SET_TEXT_COLORS", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_text_colors",
        handle_set_text_colors,
        schema=vol.Schema({
            vol.Required("text_colors", description="Array of RGB color arrays, e.g. [[255,0,0], [0,255,0]] for red to green gradient"): COLOR_LIST_SCHEMA,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
            vol.Optional("save_as_palette", default=False, description="Save these colors as a palette for later use"): bool,
        })
    )

    # Note: rename_pixel_art and apply_pixel_art services are already registered above in the main service registration block
    # Note: set_brightness service is registered above in the main service registration block
    
    async def handle_display_image(service_call):
        """Accepts a base64-encoded image, resizes/crops it to each lamp's
        frame (20 x 5, or a Cube Matrix of more than 4 modules: 5 columns a
        module, device_profile.width), and displays it on the lamp(s).
        Supports multi-entity parallel dispatch."""
        image_b64 = service_call.data.get("image_b64")
        # Resolved before decoding: no work for a call that targets no lamp.
        targets = _resolve_entities(service_call, "DISPLAY_IMAGE")

        # Process the image once per frame width (shared by the lamps of
        # that width). PIL decode/resize is CPU-bound, so run it off the
        # event loop.
        pictures = {}
        for target_entity in targets:
            width = target_entity.frame_width
            if width in pictures:
                continue
            try:
                matrix = await hass.async_add_executor_job(
                    image_to_matrix, image_b64, width, 5
                )
            except InputError as err:
                # Too large, not base64 or not an image: say so in the service call.
                raise invalid_input(err) from err
            except Exception as err:  # noqa: BLE001 -- unexpected decoder failure
                _LOGGER.exception("Error processing image")
                raise failed("image_failed", error=err) from err
            pictures[width] = image_pixels(matrix, width)

        async def _apply_one(target_entity):
            await target_entity.async_show_drawing(pictures[target_entity.frame_width])

        run_on_lamps("DISPLAY_IMAGE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "display_image",
        handle_display_image,
        schema=vol.Schema({
            vol.Required("image_b64"): vol.All(
                cv.string, vol.Length(min=1, max=MAX_IMAGE_B64_LENGTH)
            ),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_mode(service_call):
        # Supports multi-entity parallel dispatch
        mode = service_call.data.get("mode")
        full_panel = service_call.data.get("full_panel")
        

        targets = _resolve_entities(service_call, "SET_MODE")

        async def _apply_one(target_entity):
            await target_entity.async_set_display_mode(mode, full_panel)

        run_on_lamps("SET_MODE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_mode",
        handle_set_mode,
        schema=vol.Schema({
            vol.Required("mode", description="Display mode for text/gradients"): vol.In([
                MODE_CLOCK,
                MODE_NATIVE_EFFECT,
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
            ]),
            vol.Optional("full_panel", description="Whether to apply gradients to entire panel (true) or just text areas (false). If provided, sets full_panel and mode in one call."): cv.boolean,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_solid_color(service_call):
        # Supports multi-entity parallel dispatch
        rgb_color = service_call.data.get("rgb_color")
        if isinstance(rgb_color, str):
            rgb_color = hex_to_rgb(rgb_color)
        rgb_color = tuple(rgb_color)

        targets = _resolve_entities(service_call, "SET_SOLID_COLOR")

        async def _apply_one(target_entity):
            await target_entity.async_set_solid_color(rgb_color)

        run_on_lamps("SET_SOLID_COLOR", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_solid_color",
        handle_set_solid_color,
        schema=vol.Schema({
            vol.Required("rgb_color"): vol.Any(
                vol.All(vol.ExactSequence((cv.byte, cv.byte, cv.byte)), vol.Coerce(tuple)),
                cv.string
            ),
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_full_panel(service_call):
        # Supports multi-entity parallel dispatch
        full_panel = service_call.data.get("full_panel", False)

        targets = _resolve_entities(service_call, "SET_FULL_PANEL")

        async def _apply_one(target_entity):
            await target_entity.async_set_full_panel(full_panel)

        run_on_lamps("SET_FULL_PANEL", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_full_panel",
        handle_set_full_panel,
        schema=vol.Schema({
            vol.Required("full_panel", description="Whether to apply gradients to entire panel (true) or just text areas (false)"): cv.boolean,
            vol.Required("entity_id", description="Target lamp entity (e.g. light.cubelite_192_168_4_102)"): _entity_id_or_list,
        })
    )

    async def handle_set_preview_adjustments(service_call):
        """Set color adjustment values for the lamp (all effects). Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SET_PREVIEW_ADJUSTMENTS")

        # Only the adjustments given change; the others stay as each lamp has them.
        data = service_call.data

        async def _apply_one(target_entity):
            target_entity.set_preview_adjustments(data)

        run_on_lamps("SET_PREVIEW_ADJUSTMENTS", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "set_preview_adjustments",
        handle_set_preview_adjustments,
        schema=vol.Schema({
            vol.Optional("saturation"): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("hue_shift"): vol.All(vol.Coerce(int), vol.Range(min=-180, max=180)),
            vol.Optional("contrast"): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("temperature"): vol.All(vol.Coerce(int), vol.Range(min=-100, max=100)),
            vol.Optional("vibrance"): vol.All(vol.Coerce(int), vol.Range(min=0, max=200)),
            vol.Optional("grayscale"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("invert"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("glow"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional("tint_hue"): vol.All(vol.Coerce(int), vol.Range(min=0, max=360)),
            vol.Optional("tint_strength"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_force_refresh(service_call):
        """Force refresh using raw TCP connections (bypasses persistent socket).
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "FORCE_REFRESH")

        run_on_lamps("FORCE_REFRESH", targets, lambda lamp: lamp.async_force_refresh())

    hass.services.async_register(
        DOMAIN,
        "force_refresh",
        handle_force_refresh,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_freeze_display(service_call):
        """Freeze the panel on its current frame so it holds what is shown.

        Native effects freeze via the renderer's freeze-frame command
        ([64, 0, 4, {mode: 64}]). The lamp's clock instead re-sends its
        current command with the freeze mixer (64) -- sending mode 64 to the
        clock shows a full-panel effect, not the frozen clock face. A Cube
        Matrix has neither: what it shows itself over Matter is replaced by a
        still drawing of the held frame (light_matrix.async_matrix_freeze),
        and a streamed effect stops being sent. Resume is client-driven: the cards re-apply the current effect / clock mode (i.e.
        resend the last command). Supports multi-entity parallel dispatch.
        """
        targets = _resolve_entities(service_call, "FREEZE_DISPLAY")

        run_on_lamps("FREEZE_DISPLAY", targets, lambda target: target.async_freeze_display())

    hass.services.async_register(
        DOMAIN,
        "freeze_display",
        handle_freeze_display,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_save_state(service_call):
        """Snapshot the current display state (text/colors/mode/gradient/drawing/
        effects/brightness) so it can be restored later with restore_state.
        Only ONE snapshot is kept per entity -- calling again overwrites it.
        Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "SAVE_STATE")

        async def _apply_one(target_entity):
            target_entity.save_display_state()
            _LOGGER.debug("[SAVE_STATE] Saved display state for %s", target_entity.entity_id)

        run_on_lamps("SAVE_STATE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "save_state",
        handle_save_state,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )

    async def handle_restore_state(service_call):
        """Restore the display state previously captured by save_state and
        re-render it on the lamp.  Does nothing (logs a warning) if no state
        was saved.  Supports multi-entity parallel dispatch."""
        targets = _resolve_entities(service_call, "RESTORE_STATE")

        async def _apply_one(target_entity):
            if not await target_entity.async_restore_saved_state():
                _LOGGER.warning(
                    "[RESTORE_STATE] No saved state for %s -- "
                    "call save_state first",
                    target_entity.entity_id
                )
                return
            _LOGGER.debug("[RESTORE_STATE] Restored display state for %s", target_entity.entity_id)

        run_on_lamps("RESTORE_STATE", targets, _apply_one)

    hass.services.async_register(
        DOMAIN,
        "restore_state",
        handle_restore_state,
        schema=vol.Schema({
            vol.Required("entity_id"): _entity_id_or_list,
        })
    )
