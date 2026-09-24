import { renderNativeEffectOriented } from "./native-effect-preview.js";
import { flipMatrixVertical } from "./clock-preview-utils.js";
import { modeCollectionKey } from "./mode-controls-controller.js";
import { sanitizeFavourites } from "./mode-selection.js";
export {
  nextRotationMode as nextRotationEffect,
  rotationIntervalMs,
} from "./mode-controls-controller.js";
export {
  FREEZE_COMPATIBLE_EFFECTS,
  effectSupportsFreeze,
} from "./native-effect-preview.js";

export function nativeEffectPreviewConfig(config = {}) {
  const legacySpacing = config.pixel_gap === 0 ? "none" : "normal";
  return {
    lamp_pixel_style: config.pixel_style || "square",
    effect_pixel_style: config.pixel_style || "square",
    lamp_spacing_mode: legacySpacing,
    effect_spacing_mode: legacySpacing,
    ...config,
    // An explicit Original/Lamp spacing choice wins over the legacy pixel_gap
    // fallback. The spread above would otherwise put that fallback back.
    ...(config.effect_spacing_mode
      ? { effect_spacing_mode: config.effect_spacing_mode }
      : {}),
    ...(config.lamp_spacing_mode
      ? { lamp_spacing_mode: config.lamp_spacing_mode }
      : {}),
  };
}

export function nativeEffectItems(attrs = {}, config = {}) {
  const catalogue = Array.isArray(attrs.native_effect_catalog)
    ? attrs.native_effect_catalog
    : [];
  const items = catalogue.filter(
    (item) =>
      item &&
      typeof item.name === "string" &&
      item.name.trim() !== "" &&
      !/^\d+$/.test(item.name.trim()) &&
      (!item.extended ||
        config.show_experimental === true ||
        item.name === attrs.native_effect),
  );
  if (!Array.isArray(config.visible_effects)) return items;
  return [...new Set(config.visible_effects)]
    .map((name) => items.find((item) => item.name === name))
    .filter(Boolean);
}

export function nativeEffectDirection(effect, attrs = {}) {
  const directions = effect?.directions || [];
  const mount = attrs.device_orientation || "right";
  const desired = mount[0].toUpperCase() + mount.slice(1);
  return directions.includes(desired)
    ? desired
    : directions.includes(attrs.native_effect_direction)
      ? attrs.native_effect_direction
      : directions[0] || "Up";
}

export function nativeEffectFrame(effect, attrs = {}, elapsed = 0) {
  const speed = Math.max(
    1,
    Math.min(255, Number(attrs.native_effect_speed) || 50),
  );
  return flipMatrixVertical(
    renderNativeEffectOriented(
      effect.name,
      elapsed * (0.25 + speed / 55),
      nativeEffectDirection(effect, attrs),
      attrs.native_effect_color || null,
      attrs.native_effect_color_mode || "normal",
    ),
  );
}

export function nativeEffectAction(name) {
  if (typeof name !== "string" || !name.trim())
    throw new Error("Select a native effect.");
  return { effect: name, activate: true };
}

export function effectCollectionKey(targets) {
  return modeCollectionKey("native", targets);
}

export function sanitizeEffectCollections(saved) {
  return {
    favourites: sanitizeFavourites(saved?.favourites),
  };
}

export function readEffectCollections(storage, key) {
  try {
    const saved = JSON.parse(
      (storage ?? globalThis.localStorage).getItem(key) || "{}",
    );
    return sanitizeEffectCollections(saved);
  } catch {
    return sanitizeEffectCollections({});
  }
}
