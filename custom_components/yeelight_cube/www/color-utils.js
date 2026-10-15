// Color conversions shared by the cards.

/**
 * "#rrggbb" (lowercase) for an [r, g, b] color. Channels are rounded and
 * clamped to 0-255; anything that is not such an array gives `fallback`.
 */
export function rgbToHex(rgb, fallback = "#000000") {
  if (!Array.isArray(rgb) || rgb.length < 3) return fallback;
  return (
    "#" +
    rgb
      .slice(0, 3)
      .map((value) =>
        Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** [r, g, b] for "#rgb" or "#rrggbb" (the "#" is optional), else null. */
export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!match) return null;
  const digits =
    match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  const value = parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** [r, g, b] for "#rgb" / "#rrggbb", "rgb(r, g, b)" / "rgba(...)" or an
 * [r, g, b] array, else null. */
export function parseColor(color) {
  if (Array.isArray(color)) return color.length >= 3 ? color.slice(0, 3).map(Number) : null;
  const text = String(color ?? "").trim();
  if (text.startsWith("rgb")) {
    const channels = (text.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    return channels.length === 3 ? channels : null;
  }
  return hexToRgb(text);
}

/** The WCAG relative luminance of a color (0 black .. 1 white). */
export function relativeLuminance(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = Math.max(0, Math.min(255, channel)) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether dark text contrasts more than white with `color` (WCAG: above
 * 0.179 luminance black gives the higher contrast ratio). */
export function isLightColor(color) {
  return (relativeLuminance(color) ?? 0) > 0.179;
}

/** The text color that reads best on the fill `color` (`dark` on a light
 * fill, `light` on a dark one; `dark` when it is not a color). */
export function contrastInk(color, dark = "#111", light = "#fff") {
  const luminance = relativeLuminance(color);
  return luminance == null || luminance > 0.179 ? dark : light;
}

// The theme the answers of isDarkTheme are about: Home Assistant replaces
// `hass.themes` when the theme or the dark mode changes (noteThemes).
let themeVersion = 0;
let lastThemes;
let recheck = null;
const darkCache = new WeakMap(); // host -> { version, dark }
const themeReaders = new Set(); // WeakRefs of the hosts that asked

/**
 * Home Assistant's `hass.themes` seen by a card (card-base _hassChanged).
 * When it changes, every element that asked isDarkTheme reads its colors
 * again and re-renders, one frame later (once the new theme's colors apply).
 */
export function noteThemes(themes) {
  if (!themes || themes === lastThemes) return;
  const first = lastThemes === undefined;
  lastThemes = themes;
  if (first || recheck) return;
  const next = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
  recheck = next(() => {
    recheck = null;
    themeVersion++;
    for (const ref of themeReaders) {
      const host = ref.deref();
      if (!host) themeReaders.delete(ref);
      else if (host.isConnected) host.requestUpdate?.();
    }
  });
}

/**
 * Whether `host` is shown in a dark theme: its text color is light (true of
 * any theme, also a custom one HA does not mark dark). Before the host is
 * in the page: HA's dark mode, else the system's. Read once per host and
 * theme (a style recalculation), again after a theme change (noteThemes).
 */
export function isDarkTheme(host, hass) {
  noteThemes(hass?.themes);
  const cached = host && darkCache.get(host);
  if (cached?.version === themeVersion) return cached.dark;
  const text = host?.isConnected ? parseColor(getComputedStyle(host).color) : null;
  if (text) {
    const dark = isLightColor(text);
    if (!cached && globalThis.WeakRef) themeReaders.add(new WeakRef(host));
    darkCache.set(host, { version: themeVersion, dark });
    return dark;
  }
  return (
    hass?.themes?.darkMode ??
    globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
    false
  );
}
