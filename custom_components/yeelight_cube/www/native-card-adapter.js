import {
  nativeEffectItems,
  nativeEffectFrame,
  effectSupportsFreeze,
} from "./native-effect-card-utils.js";
import { getTargetEntities } from "./service-call-utils.js";

/** Native-effect domain bridge, including manual Apply and capability gates.
 * Shared controllers own commands/selection; this module maps catalogues,
 * colours and preview frames without owning interactive DOM.
 */
export function createNativeCardAdapter(card) {
  return {
    kind: "native",
    items: () =>
      nativeEffectItems(card._attrs(), {
        show_experimental: !!card._attrs().extended_effects_enabled,
      }).map((item) => ({ key: item.name, title: item.name })),
    navigationItems: () =>
      card._items().map((item) => ({ key: item.name, title: item.name })),
    current: () => card._effect()?.name,
    available: (name) => card._effectAvailable(name),
    ready: () => card._rotationTargetsReady(),
    disabled: () => card._disabled() || card._busy,
    on: () => card._state?.state === "on",
    orientation: () => card._attrs().device_orientation || "right",
    apply: (name) => card._apply(name, true),
    applyFavourite: (favourite) => card._applyFavourite(favourite),
    currentColorMode: () => card._colorModeKey(),
    currentColor: () => card._currentCustomColor(),
    select: (name) => {
      card._selected = name;
      return card.config.auto_apply !== false ? card._apply(name, true) : true;
    },
    command: (service, data, domain) =>
      card._command(service, data, domain, true),
    freeze: () => card._command("freeze_display", {}, "yeelight_cube", true),
    freezable: () => effectSupportsFreeze(card._effect()?.name),
    startRotation: (items, intervalSeconds) =>
      card._command(
        "start_effect_rotation",
        { items, interval: intervalSeconds, kind: "native" },
        "yeelight_cube",
        true,
      ),
    stopRotation: () =>
      card._command("stop_effect_rotation", {}, "yeelight_cube", true),
    skipRotation: () =>
      card._command("skip_effect_rotation", {}, "yeelight_cube", true),
    rotationActive: () =>
      getTargetEntities(card.config).every(
        (entity) =>
          card._hass?.states[entity]?.attributes?.effect_rotation?.active ===
            true &&
          card._hass?.states[entity]?.attributes?.effect_rotation?.kind ===
            "native",
      ),
    rotationError: () =>
      getTargetEntities(card.config)
        .map((entity) => {
          const rotation =
            card._hass?.states[entity]?.attributes?.effect_rotation;
          return rotation?.kind === "native" ? rotation.error : null;
        })
        .find(Boolean) || card._error,
    // The `effect_rotation` attribute only exists in the backend version that
    // ships the rotation services; its presence is our capability probe.
    rotationSupported: () =>
      getTargetEntities(card.config).every(
        (entity) =>
          card._hass?.states[entity]?.attributes?.effect_rotation !== undefined,
      ),
    pause: (paused) => {
      card._paused = paused;
    },
    frame: (name, elapsed, colorMode, color) => {
      const item = card
        ._attrs()
        .native_effect_catalog?.find((item) => item.name === name);
      if (!item || item.preview === false) return null;
      if (colorMode == null)
        return nativeEffectFrame(item, card._attrs(), elapsed);
      const attrs = {
        ...card._attrs(),
        native_effect_color_mode:
          colorMode === "custom" ? "normal" : colorMode || "normal",
        native_effect_color: null,
      };
      if (colorMode === "custom" && Array.isArray(color))
        attrs.native_effect_color = color;
      return nativeEffectFrame(item, attrs, elapsed);
    },
  };
}
