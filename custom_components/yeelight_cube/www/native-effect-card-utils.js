import { renderNativeEffect } from "./native-effect-preview.js";
import { LAMP_EFFECTS, effectDisplayFrame } from "./lamp-renderers.js";
import { withSpotColours } from "./matrix-modules.js";
import { previewContext } from "./preview-context.js";
import { effectFamilyOfName } from "./effect-families.js";
import { FORMERLY_NUMBERED_EFFECT_NAMES, effectSlotRank } from "./effect-names.js";
import { VISIBILITY_KEYS, visibleItems } from "./visible-items.js";
import { viewerFrame } from "./matrix-view.js";
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

/** Whether `name` names an effect the cards list: text, not a bare number. */
export function isEffectName(name) {
  return typeof name === "string" && name.trim() !== "" && !/^\d+$/.test(name.trim());
}

export function nativeEffectItems(attrs = {}, config = {}) {
  const catalogue = Array.isArray(attrs.native_effect_catalog)
    ? attrs.native_effect_catalog
    : [];
  const items = catalogue.filter((item) => item && isEffectName(item.name));
  return visibleItems(
    items,
    (item) => item.name,
    config,
    VISIBILITY_KEYS.effects,
  );
}

const previewDirections = ["Up", "Down", "Left", "Right"];
// The Yeelight app's music modes (effect_catalog.py APP_MUSIC_SLOTS): official.
const APP_MUSIC_EFFECTS = new Set([
  "Music Spectrum",
  "Music Gather",
  "Music Breathing",
  "Music Blossom",
  "Music Note",
  "Music Impact",
]);
// Without a lamp, in the lamp's order (effect-names.js effectSlotRank).
export const nativePreviewCatalogue = [
  ...[
    "Ribbon",
    "Starry Sky",
    "Spectrum",
    "Waves",
    "Rainbow",
    "Waterfall",
    "Aurora",
    "Fire",
    "Bouncing Ball",
    "Meteor",
    "Tide",
    "Building Blocks",
    "Hacking",
    "Flower Sea",
    "Magic",
    "Wonderland",
    "Kaleidoscope",
    "Palette",
  ].map((name) => ({
    name,
    family: effectFamilyOfName(name),
    speed: name !== "Spectrum",
    intensity: !!LAMP_EFFECTS[name].intensity,
    extended: false,
    preview: true,
    directions:
      name === "Hacking"
        ? ["Up", "Down"]
        : [
              "Ribbon",
              "Starry Sky",
              "Bouncing Ball",
              "Magic",
              "Wonderland",
            ].includes(name)
          ? []
          : previewDirections,
  })),
  ...[
    "Neon sine bands",
    "Moving palette",
    "Particle path",
    "Triangular palette pulses",
    "Fireworks",
    "Sine wave",
    "Sunrise and sunset",
    "Heat fire",
    "Mirrored comets",
    "Palette sparks",
    "Tide (slot 35)",
    "Rainbow noise",
    "Violet interference",
    "Night-amber waves",
    "Navy-white noise",
    "Night-sky waves",
    "Flicker sweep",
    "Particle glows",
    "Palette stripes",
    "Violet twinkles",
  ].map((name) => ({
    name,
    family: effectFamilyOfName(name),
    // effect_catalog.py _EXTENDED_EFFECT_NO_SPEED / _NO_DIRECTION: what the lamp ignores.
    speed: ![
      "Palette sparks",
      "Rainbow noise",
      "Violet interference",
      "Navy-white noise",
      "Night-sky waves",
      "Palette stripes",
    ].includes(name),
    intensity: !!LAMP_EFFECTS[name].intensity,
    extended: true,
    preview: true,
    directions: ["Neon sine bands", "Night-amber waves", "Night-sky waves"].includes(name)
      ? []
      : previewDirections,
  })),
  // The slots named by number until 1.4.0, as the integration sends them. Not
  // the stored GIF for now (light._native_effect_catalog): it has no row there.
  ...Object.values(FORMERLY_NUMBERED_EFFECT_NAMES)
    .filter((name) => LAMP_EFFECTS[name])
    .map((name) => {
      const spec = LAMP_EFFECTS[name];
      return {
        name,
        family: effectFamilyOfName(name),
        speed: !!spec.speed,
        intensity: !!spec.intensity,
        // The Yeelight app's music modes are official (effect_catalog.py APP_MUSIC_SLOTS).
        extended: !APP_MUSIC_EFFECTS.has(name),
        preview: true,
        directions: spec.directions ? [...spec.directions] : [],
      };
    }),
  // effect_catalog.py MATRIX_VERSION_EFFECTS: the Cube Matrix's own versions, and
  // STREAMED_EFFECTS: the integration's own effects.
  ...["Northern Lights", "Rose Sea", "Dark palette pulses", "Knight Rider", "Lava Lamp", "Falling Blocks"].map((name) => {
    const spec = LAMP_EFFECTS[name];
    return {
      name,
      family: effectFamilyOfName(name),
      speed: !!spec.speed,
      intensity: !!spec.intensity,
      extended: true,
      preview: true,
      directions: [...spec.directions],
    };
  }),
].sort(
  (first, second) =>
    effectSlotRank(LAMP_EFFECTS[first.name].mode) -
    effectSlotRank(LAMP_EFFECTS[second.name].mode),
);

// The direction chosen, shared by all effects: one that does not offer it runs
// its first (light_native.effect_direction_sent).
export function nativeEffectDirection(effect, attrs = {}) {
  const directions = effect?.directions || [];
  return directions.includes(attrs.native_effect_direction)
    ? attrs.native_effect_direction
    : directions[0] || "Up";
}

// A still picture's moment: some effects start dark.
export const STILL_PREVIEW_SECONDS = 5;

// One viewer's order per frame and orientation: a frame is the same array for
// as long as its render lasts (lampEffectFrame), so a tile can tell.
const viewed = new WeakMap();

function viewedFrame(frame, orientation) {
  let views = viewed.get(frame);
  if (!views) viewed.set(frame, (views = new Map()));
  if (!views.has(orientation)) views.set(orientation, viewerFrame(frame, orientation));
  return views.get(orientation);
}

/**
 * `effect` (a catalogue item: {name, directions}) `elapsed` seconds in, as
 * the lamp shows it: lamp order (row 0 the bottom), screen colors
 * (effectDisplayFrame). `context`: the lamp's preview context
 * (preview-context.js), whose settings it runs with: its speed (0-255, as
 * the lamp's), direction, color and color mode, mount, intensity, palette,
 * stored GIF and animation settings, on the columns it shows.
 */
export function nativeEffectLampFrame(effect, context, elapsed = 0) {
  const { speed } = context;
  return effectDisplayFrame(
    effect.name,
    renderNativeEffect(
      effect.name,
      elapsed * (0.25 + speed / 55),
      nativeEffectDirection(effect, context.attrs),
      context.color,
      context.colorMode,
      speed,
      context.orientation,
      context.intensity,
      context.palette,
      context.stored,
      context.layout,
      context.adjustments,
      context.columns,
    ),
  );
}

/** nativeEffectLampFrame for the lamp of `attrs` as the viewer sees it
 * (matrix-view.js): top row first, turned for an upside-down mount like every
 * preview. The lamp's own direction setting does not turn it: the
 * integration compensates the direction it sends for it
 * (light_native.lamp_direction). A Cube Matrix's spots shown as the lamp
 * lights them (matrix-modules.js). */
export function nativeEffectFrame(effect, attrs = {}, elapsed = 0) {
  const context = previewContext(attrs);
  return withSpotColours(
    viewedFrame(nativeEffectLampFrame(effect, context, elapsed), context.orientation),
    context.lamp,
    "viewer",
  );
}

export function nativeEffectAction(name) {
  if (typeof name !== "string" || !name.trim())
    throw new Error("Select a native effect.");
  return { effect: name, activate: true };
}

