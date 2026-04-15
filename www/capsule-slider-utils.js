/**
 * Shared Capsule/Pill slider utility.
 *
 * Used by:
 *  - yeelight-cube-lamp-preview-card  (brightness 1-100)
 *  - yeelight-cube-gradient-card       (angle 0-359°)
 *
 * Keeps HTML structure, CSS theming and visual-update logic in one place.
 */

// ─── Theme resolution ──────────────────────────────────────────────
/**
 * Resolve a theme value, migrating legacy names.
 * @param {string|undefined} theme
 * @param {string|undefined} fallback – legacy key (e.g. capsule_theme)
 * @returns {"flat"|"subtle"|"filled"}
 */
export function resolveCapsuleTheme(theme, fallback) {
  let t = theme || fallback || "subtle";
  if (t === "light") return "subtle";
  if (t === "dark") return "filled";
  if (t === "transparent") return "flat";
  return t;
}

// ─── Thickness resolution ──────────────────────────────────────────
/**
 * Resolve thickness, with legacy appearance fallback.
 * @param {number|undefined} thickness - explicit numeric thickness
 * @param {string|undefined} legacyAppearance - old "thick"/"thin" value
 * @param {number} [defaultVal=6]
 * @returns {number}
 */
export function resolveCapsuleThickness(
  thickness,
  legacyAppearance,
  defaultVal = 6,
) {
  if (thickness != null) return thickness;
  return { thick: 12, thin: 3 }[legacyAppearance] || defaultVal;
}

// ─── HTML rendering ────────────────────────────────────────────────
/**
 * Render capsule HTML string.
 *
 * @param {Object} opts
 * @param {"flat"|"subtle"|"filled"} opts.theme
 * @param {number}  opts.thickness     – track thickness in px
 * @param {number}  opts.value         – current value
 * @param {number}  opts.min           – range min
 * @param {number}  opts.max           – range max
 * @param {string|null} opts.iconLeft  – emoji / text for left icon, or null
 * @param {string|null} opts.iconRight – emoji / text for right icon, or null
 * @param {string}  opts.hostInputHandler  – JS expression for oninput (called on host)
 * @param {string}  opts.hostDragStart     – JS expression for onmousedown/touchstart
 * @param {string}  opts.hostDragEnd       – JS expression for onmouseup/touchend
 * @param {string|null} opts.label         – label text above the capsule (or null)
 * @param {boolean} opts.showValue         – show value text below
 * @param {string}  opts.valueText         – formatted value text (e.g. "72%" or "180°")
 * @param {string}  opts.wheelHandler      – JS expression for onwheel (optional)
 * @returns {string} HTML string
 */
export function renderCapsuleHTML(opts) {
  const {
    theme = "subtle",
    thickness = 6,
    value = 0,
    min = 0,
    max = 100,
    iconLeft = null,
    iconRight = null,
    leftSlotHtml = null,
    rightSlotHtml = null,
    hostInputHandler = "",
    hostDragStart = "",
    hostDragEnd = "",
    label = null,
    showValue = true,
    valueText = "",
    underHtml = null,
    wheelHandler = "",
    trackExtraHtml = "",
  } = opts;

  const labelHtml = label ? `<div class="capsule-label">${label}</div>` : "";

  const leftContentHtml = leftSlotHtml
    ? leftSlotHtml
    : iconLeft
      ? `<div class="capsule-icon capsule-icon-left">${iconLeft}</div>`
      : "";

  const rightContentHtml = rightSlotHtml
    ? rightSlotHtml
    : iconRight
      ? `<div class="capsule-icon capsule-icon-right">${iconRight}</div>`
      : "";

  // underHtml overrides showValue/valueText when provided
  const valueHtml = underHtml
    ? underHtml
    : showValue
      ? `<div class="capsule-value-text">${valueText}</div>`
      : "";

  // Compute initial percent so the capsule renders at the correct
  // position on first paint (avoids the visual blink from 0 → value
  // that occurs when --capsule-percent is set later via JS).
  const range = max - min || 1;
  const initialPercent = ((value - min) / range) * 100;

  return `
    <div class="capsule-container capsule-theme-${theme}" style="--capsule-thickness: ${thickness}px;"${wheelHandler ? ` onwheel="${wheelHandler}"` : ""}>
      ${labelHtml}
      <div class="capsule-wrapper">
        <div class="capsule-pill capsule-pill-${theme}">
          ${leftContentHtml}
          <div class="capsule-track">
            ${trackExtraHtml}
            <div class="capsule-fill" style="--capsule-percent: ${initialPercent};"></div>
            <div class="capsule-thumb" style="--capsule-percent: ${initialPercent};"></div>
            <input
              type="range"
              min="${min}"
              max="${max}"
              value="${value}"
              class="capsule-input"
              ${hostDragStart ? `onmousedown="${hostDragStart}" ontouchstart="${hostDragStart}"` : ""}
              ${hostDragEnd ? `onmouseup="${hostDragEnd}" ontouchend="${hostDragEnd}"` : ""}
              ${hostInputHandler ? `oninput="${hostInputHandler}"` : ""}
            />
          </div>
          ${rightContentHtml}
        </div>
        ${valueHtml}
      </div>
    </div>
  `;
}

// ─── Visual updates ────────────────────────────────────────────────
/**
 * Update capsule fill / thumb / value text from a percentage (0-100).
 *
 * @param {ShadowRoot} root
 * @param {number} percent – 0-100
 * @param {string|null} [valueText] – new text for the value display, or null to skip
 * @param {string} [scope] – optional parent selector to scope queries (e.g. ".angle-capsule-host")
 */
export function updateCapsuleVisuals(
  root,
  percent,
  valueText = null,
  scope = "",
) {
  const prefix = scope ? `${scope} ` : "";
  const fill = root.querySelector(`${prefix}.capsule-fill`);
  const thumb = root.querySelector(`${prefix}.capsule-thumb`);
  if (fill) fill.style.setProperty("--capsule-percent", percent);
  if (thumb) thumb.style.setProperty("--capsule-percent", percent);
  if (valueText !== null) {
    const valEl = root.querySelector(`${prefix}.capsule-value-text`);
    if (valEl) valEl.textContent = valueText;
  }
}

// ─── CSS ───────────────────────────────────────────────────────────
/**
 * Returns the full CSS string for the capsule slider component.
 * Include this once inside the shadow root's <style> block.
 */
export function getCapsuleCSS() {
  return `
    /* ===== Capsule Slider (shared) ===== */
    .capsule-container {
      margin: 0;
      padding: 5px 0;
      text-align: center;
    }
    .capsule-label {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 10px;
      color: var(--primary-text-color);
      text-align: left;
    }
    .capsule-value-text {
      font-size: 16px;
      font-weight: 600;
      color: var(--primary-text-color);
      text-align: center;
      padding: 8px 0;
    }
    .capsule-wrapper {
      padding: 0;
    }
    .capsule-pill {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 12px;
      border-radius: 50px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .capsule-pill-subtle {
      background: var(--card-background-color, #fff);
    }
    .capsule-pill-filled {
      background: var(--secondary-background-color, #2c2c2c);
    }
    .capsule-pill-flat {
      background: transparent;
      box-shadow: none;
    }
    .capsule-icon {
      font-size: 22px;
      flex-shrink: 0;
      width: 28px;
      text-align: center;
      user-select: none;
    }
    .capsule-track {
      position: relative;
      flex: 1;
      height: calc(var(--capsule-thickness, 6px) * 1.33);
      border-radius: calc(var(--capsule-thickness, 6px) * 1.67);
      overflow: visible;
    }
    .capsule-pill-subtle .capsule-track {
      background: var(--divider-color, #d0d0d0);
    }
    .capsule-pill-filled .capsule-track {
      background: var(--primary-background-color, #1a1a1a);
    }
    .capsule-pill-flat .capsule-track {
      background: var(--divider-color, #d0d0d0);
    }
    .capsule-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: calc(var(--capsule-percent, 0) * 1%);
      background: var(--primary-color, #03a9f4);
      border-radius: 10px;
      transition: width 0.1s ease;
      pointer-events: none;
    }
    .capsule-thumb {
      position: absolute;
      top: 50%;
      left: calc(var(--capsule-percent, 0) * 1%);
      transform: translate(-50%, -50%);
      width: calc(var(--capsule-thickness, 6px) * 4);
      height: calc(var(--capsule-thickness, 6px) * 4);
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      transition: left 0.1s ease;
      pointer-events: none;
      z-index: 2;
      border: 2px solid var(--divider-color, rgba(0, 0, 0, 0.1));
    }
    .capsule-pill-subtle .capsule-thumb {
      background: var(--card-background-color, white);
      border-color: var(--divider-color, rgba(0, 0, 0, 0.1));
    }
    .capsule-pill-filled .capsule-thumb {
      background: var(--primary-background-color, #1a1a1a);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .capsule-pill-flat .capsule-thumb {
      background: var(--card-background-color, white);
      border-color: var(--divider-color, rgba(0, 0, 0, 0.1));
    }
    .capsule-input {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }

    /* ===== Capsule container theme overrides ===== */
    .capsule-theme-flat {
      background: transparent;
      padding: 5px 0;
    }
    .capsule-theme-subtle {
      background: color-mix(in srgb, var(--secondary-background-color, #f5f5f5) 40%, var(--card-background-color, #fff) 60%);
      border-radius: 12px;
      padding: 8px 14px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
    }
    .capsule-theme-filled {
      background: var(--secondary-background-color, #2c2c2c);
      border-radius: 12px;
      padding: 8px 14px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
    }
    /* Capsule pill has its own chrome → reset outer container for subtle/filled */
    .capsule-theme-subtle,
    .capsule-theme-filled {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 5px 0;
    }
  `;
}
