import { renderNativeEffectOriented } from "./native-effect-preview.js";
import { flipMatrixVertical } from "./clock-preview-utils.js";
import {
  modeCollectionKey,
  sanitizeModeNames,
} from "./mode-controls-controller.js";
export {
  nextRotationMode as nextRotationEffect,
  rotationIntervalMs,
} from "./mode-controls-controller.js";
export {
  FREEZE_COMPATIBLE_EFFECTS,
  effectSupportsFreeze,
} from "./native-effect-preview.js";

export function nativeEffectPreviewConfig(config = {}) {
  return {
    lamp_pixel_style: config.pixel_style || "square",
    effect_pixel_style: config.pixel_style || "square",
    lamp_spacing_mode: config.pixel_gap === 0 ? "none" : "normal",
    effect_spacing_mode: config.pixel_gap === 0 ? "none" : "normal",
    ...config,
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
    favourites: sanitizeModeNames(saved?.favourites),
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
