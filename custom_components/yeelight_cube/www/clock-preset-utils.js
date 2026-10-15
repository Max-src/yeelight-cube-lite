import { CollectionState } from "./collection-state.js";
import {
  VISIBILITY_KEYS,
  visibleItems,
  withVisibleItems,
} from "./visible-items.js";

export function clockColorToRgb(intColor) {
  if (typeof intColor !== "number") return null;
  return [(intColor >> 16) & 0xff, (intColor >> 8) & 0xff, intColor & 0xff];
}

// Home Assistant replaces `hass.states` with a new object on every state
// change, so its identity is a cheap cache key. The preset sensor's entity id
// is remembered once found, so later lookups read it directly and only fall
// back to a full scan when that entity disappears or stops carrying presets.
const EMPTY_PRESETS = Object.freeze([]);
const presetLibraryCache = new WeakMap();
let presetEntityId = null;

// The library as Home Assistant publishes it (cached per states object).
function publishedClockPresets(hass) {
  const states = hass?.states;
  if (!states || typeof states !== "object") return EMPTY_PRESETS;
  const cached = presetLibraryCache.get(states);
  if (cached) return cached;
  let presets = presetEntityId
    ? states[presetEntityId]?.attributes?.clock_presets
    : undefined;
  if (!Array.isArray(presets)) {
    presets = EMPTY_PRESETS;
    presetEntityId = null;
    for (const id in states) {
      const candidate = states[id]?.attributes?.clock_presets;
      if (Array.isArray(candidate)) {
        presetEntityId = id;
        presets = candidate;
        break;
      }
    }
  }
  presetLibraryCache.set(states, presets);
  return presets;
}

// The library just changed here (a rename, a new color, a delete): shown at
// once by every card that reads it (Clock, Native Effects, the preset
// manager), kept until Home Assistant publishes it, put back if the call is
// refused (collection-state.js, like the palettes and pixel arts). Every
// preset call goes through its one queue, in order.
const presetListeners = new Set();
const notifyPresets = () => presetListeners.forEach((listener) => listener());
const presetEdits = new CollectionState(undefined, { onExpire: notifyPresets });

/** The shared clock preset library: the one just changed here, else the
 * published one. */
export function clockPresetLibrary(hass) {
  const published = publishedClockPresets(hass);
  return presetEdits.pending ? presetEdits.observe(published) : published;
}

/** Re-render `host` (requestUpdate) when the library shown changes without a
 * state update (refused or expired); returns the unsubscribe function. */
export function watchClockPresets(host) {
  const listener = () => host.requestUpdate?.();
  presetListeners.add(listener);
  return () => presetListeners.delete(listener);
}

/**
 * Save (`save_clock_preset`) or delete (`delete_clock_preset`) a clock
 * preset. An existing one changes at once on every card; a new one appears
 * once Home Assistant publishes it (its id comes from there). Resolves once
 * sent, rejects with the refusal (the library is then put back).
 */
export async function editClockPreset(hass, service, data) {
  const current = presetEdits.pending?.items ?? publishedClockPresets(hass);
  let operation = null;
  if (service === "delete_clock_preset")
    operation = presetEdits.record(current.filter((preset) => preset.id !== data.preset_id));
  else if (data.preset_id)
    // As the backend stores it (clock_presets.py save_clock_preset).
    operation = presetEdits.record(
      current.map((preset) =>
        preset.id === data.preset_id
          ? {
              id: preset.id,
              name: String(data.name).trim().replace(/\s+/g, " "),
              color: [...data.color],
              kind: data.kind ?? preset.kind ?? "style",
            }
          : preset,
      ),
    );
  if (operation) notifyPresets();
  try {
    if (!(await presetEdits.execute(hass, service, data)))
      throw new Error("The clock presets changed. Please retry.");
    return true;
  } catch (error) {
    if (presetEdits.rollback(operation)) notifyPresets();
    throw error;
  }
}

export function clockPresetKey(style) {
  if (!style) return null;
  return style.presetId ? `custom:${style.presetId}` : style.name;
}

export function clockColorModeOptions(builtins, presets, config = {}) {
  const all = [
    ...builtins,
    ...clockPresetsByKind(presets, "color_mode").map((preset) => ({
      value: `custom:${preset.id}`,
      label: preset.name,
      color: preset.color,
    })),
    { value: "__pick__", label: "Add", icon: "mdi:plus" },
  ];
  // A color mode added since the list was saved (a new preset) shows.
  return visibleItems(
    all,
    (mode) => mode.value,
    config,
    VISIBILITY_KEYS.colorModes,
    () => true,
  );
}

export function clockColorModeVisibilityConfig(config, all, visible) {
  return withVisibleItems(
    config,
    VISIBILITY_KEYS.colorModes,
    all.map((mode) => mode.value),
    visible,
  );
}

export function clockPresetsByKind(presets, kind = "style") {
  return presets.filter((preset) => (preset.kind || "style") === kind);
}

export function clockColorPresetAction(preset) {
  return { color_mode: "normal", color: [...preset.color] };
}

export function matchingClockColorPreset(presets, attrs) {
  if (
    (attrs.clock_color_mode || "normal") !== "normal" ||
    typeof attrs.clock_color !== "number"
  )
    return null;
  return (
    clockPresetsByKind(presets, "color_mode").find((preset) =>
      preset.color.every(
        (channel, index) =>
          channel === ((attrs.clock_color >> (16 - index * 8)) & 255),
      ),
    ) || null
  );
}

export function clockStylesWithPresets(builtins, presets) {
  return [
    ...builtins,
    ...clockPresetsByKind(presets).map((preset) => ({
      id: 4,
      name: preset.name,
      presetId: preset.id,
      color: preset.color,
      mixer: 0,
      solid: true,
      experimental: false,
    })),
  ];
}

export function visibleClockStyles(styles, config) {
  // A style preset saved since the list was saved shows (built-in styles
  // only when listed).
  return visibleItems(
    styles,
    clockPresetKey,
    config,
    VISIBILITY_KEYS.clockStyles,
    (style) => !!style.presetId,
  );
}

export function clockStyleVisibilityConfig(config, styles, visible) {
  return withVisibleItems(
    config,
    VISIBILITY_KEYS.clockStyles,
    styles.map(clockPresetKey),
    visible,
  );
}

export function matchingClockPreset(styles, attrs, preferredId) {
  if (
    attrs.clock_style_id != null
      ? attrs.clock_style_id !== 4
      : attrs.clock_style !== "White"
  )
    return null;
  if (typeof attrs.clock_color !== "number") return null;
  const color = [
    (attrs.clock_color >> 16) & 255,
    (attrs.clock_color >> 8) & 255,
    attrs.clock_color & 255,
  ];
  const matches = styles.filter(
    (style) =>
      style.presetId &&
      style.color.every((channel, index) => channel === color[index]),
  );
  return (
    matches.find((style) => style.presetId === preferredId) ||
    matches[0] ||
    null
  );
}

export function clockStyleAction(style) {
  // A preset IS a color choice, so it sets one explicitly. Any other style
  // switch omits `color` entirely so an active custom override (or "clear")
  // persists across style changes instead of resetting to the style default.
  return style.presetId
    ? { style: "White", color: style.color, activate: true }
    : { style: style.name, activate: true };
}
