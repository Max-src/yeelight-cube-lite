import { clockColorToRgb } from "./clock-preset-utils.js";

import { clockPresetKey } from "./clock-preset-utils.js";
import { getTargetEntities } from "./service-call-utils.js";
import { rotationTargets, retryFailedRotations } from "./rotation-status.js";
import { renderClockFrame, flipMatrixVertical } from "./clock-preview-utils.js";
import { effectSupportsFreeze } from "./native-effect-preview.js";

/** Clock domain bridge. Preset-owned RGB stays distinct from free overrides.
 * No DOM bindings or queue state belong here; callbacks use the card's domain
 * operations and the shared command transport.
 */
export function createClockCardAdapter(card) {
  return {
    kind: "clock",
    items: () =>
      card._controlStyles().map((style) => ({
        key: clockPresetKey(style),
        title: style.name,
      })),
    navigationItems: () =>
      card._shownStyles().map((style) => ({
        key: clockPresetKey(style),
        title: style.name,
      })),
    current: () => clockPresetKey(card._currentStyle()),
    available: (name) =>
      getTargetEntities(card.config).every((entity) => {
        const state = card._hass?.states[entity];
        return (
          state &&
          !["unknown", "unavailable"].includes(state.state) &&
          card
            ._controlStyles(state.attributes)
            .some((style) => clockPresetKey(style) === name)
        );
      }),
    ready: () =>
      getTargetEntities(card.config).every(
        (entity) => card._hass?.states[entity]?.state === "on",
      ),
    disabled: () =>
      card._commands.busy ||
      getTargetEntities(card.config).some(
        (entity) =>
          !card._hass?.states[entity] ||
          ["unknown", "unavailable"].includes(card._hass.states[entity].state),
      ),
    on: () => card._stateObj()?.state === "on",
    orientation: () => card._attrs().device_orientation || "right",
    apply: (name) => card._applyStyle(name, true),
    applyFavourite: (favourite) => card._applyFavourite(favourite),
    currentColorMode: () => card._currentColorMode(card._attrs()),
    currentColor: () => {
      const a = card._attrs();
      if (card._currentColorMode(a) !== "custom") return null;
      return (
        card._customDraft ||
        card._customPresetColor ||
        clockColorToRgb(a.clock_color)
      );
    },
    command: (service, data, domain = "yeelight_cube") =>
      card._command(service, data, domain, true),
    freeze: () => card._command("freeze_display", {}, "yeelight_cube", true),
    refresh: () =>
      card._commands.execute(card._hass, card.config, "force_refresh"),
    freezable: () => effectSupportsFreeze(card._currentStyle()?.name),
    startRotation: (items, intervalSeconds) =>
      card._command(
        "start_effect_rotation",
        { items, interval: intervalSeconds, kind: "clock" },
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
            "clock",
      ),
    rotationTargets: () => rotationTargets(card._hass, card.config, "clock"),
    retryRotation: () => retryFailedRotations(card, "clock"),
    rotationError: () =>
      getTargetEntities(card.config)
        .map((entity) => {
          const rotation =
            card._hass?.states[entity]?.attributes?.effect_rotation;
          return rotation?.kind === "clock" ? rotation.error : null;
        })
        .find(Boolean),
    // The `effect_rotation` attribute only exists in the backend version that
    // ships the rotation services; its presence is our capability probe.
    rotationSupported: () =>
      getTargetEntities(card.config).every(
        (entity) =>
          card._hass?.states[entity]?.attributes?.effect_rotation !== undefined,
      ),
    frame: (name, phase, colorMode, color) => {
      const style = card
        ._controlStyles()
        .find((style) => clockPresetKey(style) === name);
      if (!style) return null;
      const { fontMap, metrics } = card._getNativeClockFont();
      const attrs =
        colorMode != null
          ? card._previewAttrsFor(style, colorMode, color)
          : card._previewAttrs(style);
      return flipMatrixVertical(
        renderClockFrame(attrs, fontMap, metrics, phase),
      );
    },
  };
}
