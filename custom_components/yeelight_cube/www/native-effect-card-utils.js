import { renderNativeEffectOriented } from "./native-effect-preview.js";
import { flipMatrixVertical } from "./clock-preview-utils.js";

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
    ),
  );
}

export function nativeEffectAction(name) {
  if (typeof name !== "string" || !name.trim())
    throw new Error("Select a native effect.");
  return { effect: name, activate: true };
}

export function effectCollectionKey(targets) {
  return `yeelight-native-collections:${[...new Set(targets)].sort().join(",")}`;
}

function cleanEffectNames(values, limit) {
  return Array.isArray(values)
    ? [
        ...new Set(
          values
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value && !/^\d+$/.test(value)),
        ),
      ].slice(0, limit)
    : [];
}

export function sanitizeEffectCollections(saved) {
  return {
    favourites: cleanEffectNames(saved?.favourites, 100),
  };
}

export function nextRotationEffect(
  names,
  current,
  shuffle = false,
  random = Math.random(),
) {
  const unique = cleanEffectNames(names, 100);
  if (!unique.length) return undefined;
  if (!shuffle) return unique[(unique.indexOf(current) + 1) % unique.length];
  const candidates = unique.filter((name) => name !== current);
  return (
    candidates[
      Math.min(
        candidates.length - 1,
        Math.max(0, Math.floor(random * candidates.length)),
      )
    ] || unique[0]
  );
}

export function rotationIntervalMs(config) {
  return (
    Math.max(10, Math.min(3600, Number(config.rotation_interval) || 60)) * 1000
  );
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
