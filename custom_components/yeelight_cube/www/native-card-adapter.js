import {
  nativeEffectItems,
  nativeEffectFrame,
  effectSupportsFreeze,
} from "./native-effect-card-utils.js";
import { getTargetEntities } from "./service-call-utils.js";
import { previewOnly } from "./offline-preview-state.js";
import { rotationTargets, retryFailedRotations } from "./rotation-status.js";
import {
  sharedFavourites,
  saveSharedFavourites,
  sharedRotationInterval,
  saveSharedRotationInterval,
} from "./shared-lamp-settings.js";
import { itemLabel, itemMatchesQuery, sortGalleryItems } from "./card-config.js";

/** Native-effect domain bridge, including manual Apply and capability gates.
 * Shared controllers own commands/selection; this module maps catalogues,
 * colors and preview frames without owning interactive DOM.
 */
export function createNativeCardAdapter(card) {
  const rotationSnapshots = new Map();
  return {
    kind: "native",
    previewOnly: () => previewOnly(card),
    items: () =>
      nativeEffectItems(card._attrs(), {
        show_experimental: !!card._attrs().extended_effects_enabled,
      }).map((item) => ({
        key: item.name,
        title: itemLabel(card.config, item.name, item.name),
      })),
    // Previous / Next step through what the gallery shows (its search),
    // in the order shown (gallery_sort).
    navigationItems: () =>
      sortGalleryItems(
        card.config,
        card
          ._items()
          .filter((item) =>
            itemMatchesQuery(
              card.config,
              item.name,
              item.name,
              card.config.show_search === false ? "" : card._searchQuery,
            ),
          )
          .map((item) => ({
            key: item.name,
            title: itemLabel(card.config, item.name, item.name),
          })),
        (item) => item.title,
      ),
    current: () => card._effect()?.name,
    available: (name) => card._effectAvailable(name),
    ready: () => card._rotationTargetsReady(),
    // Only lamp availability: a running card request must not disable the
    // shared controls (requests are queued by the card's command controller).
    disabled: () => card._disabled(),
    on: () => card._state?.state === "on",
    orientation: () => card._attrs().device_orientation || "right",
    apply: (name) => card._apply(name, true),
    applyFavourite: (favourite) => card._applyFavourite(favourite),
    currentColorMode: () => card._colorModeKey(),
    currentColor: () => card._currentCustomColor(),
    select: (name) => {
      card._selected = name;
      return card._apply(name, true);
    },
    command: (service, data, domain) =>
      card._command(service, data, domain, true),
    freeze: () => card._command("freeze_display", {}, "yeelight_cube", true),
    // The lamp's frozen state, shared by every dashboard.
    frozen: () => card._attrs().display_frozen,
    // Favourites and rotation interval stored on the lamp (see
    // shared-lamp-settings.js).
    favourites: () => sharedFavourites(card._hass, card.config, "native"),
    saveFavourites: (favourites) =>
      saveSharedFavourites(card, "native", favourites),
    rotationInterval: () =>
      sharedRotationInterval(card._hass, card.config, "native"),
    setRotationInterval: (seconds) =>
      saveSharedRotationInterval(card, "native", seconds),
    refresh: () =>
      card._commands.execute(card._hass, card.config, "force_refresh"),
    freezable: () => effectSupportsFreeze(card._effect()?.name),
    startRotation: (items, intervalSeconds) =>
      card._command(
        "start_effect_rotation",
        { items, interval: intervalSeconds, kind: "native" },
        "yeelight_cube",
        true,
      ),
    stopRotation: () =>
      card._commands.execute(card._hass, card.config, "stop_effect_rotation"),
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
    rotationTargets: () =>
      rotationTargets(card._hass, card.config, "native", rotationSnapshots),
    retryRotation: () => retryFailedRotations(card, "native"),
    // The `effect_rotation` attribute only exists in the backend version that
    // ships the rotation services; its presence is our capability probe.
    rotationSupported: () =>
      getTargetEntities(card.config).every(
        (entity) =>
          card._hass?.states[entity]?.attributes?.effect_rotation !== undefined,
      ),
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
