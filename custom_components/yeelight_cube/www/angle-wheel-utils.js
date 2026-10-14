/**
 * angle-wheel-utils.js
 * Shared utility functions for angle wheel / rotary controls.
 * Used by both yeelight-cube-gradient-card.js and yeelight-cube-color-list-editor-card.js
 */

// Debounce time for angle updates (ms)
import {
  callServiceOnTargetEntities,
  getTargetEntities,
} from "./service-call-utils.js";
import { rgbToHex } from "./color-utils.js";

export const ANGLE_UPDATE_DEBOUNCE_MS = 150;

export class AngleCommandController {
  constructor(onApplied = () => {}, onError = () => {}) {
    this.onApplied = onApplied;
    this.onError = onError;
    this.context = 0;
    this.timer = null;
    this.pending = null;
    this.sending = false;
  }

  schedule(hass, config, value, immediate = false) {
    const angle = Number.parseFloat(value);
    const targets = getTargetEntities(config);
    if (!hass || !targets.length || !Number.isFinite(angle)) return false;
    this.pending = {
      hass,
      config: { target_entities: [...targets] },
      angle: ((angle % 360) + 360) % 360,
      context: this.context,
    };
    clearTimeout(this.timer);
    this.timer = null;
    if (immediate) this.flush();
    else this.timer = setTimeout(() => this.flush(), ANGLE_UPDATE_DEBOUNCE_MS);
    return true;
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending && this.timer === null) {
        const command = this.pending;
        this.pending = null;
        if (command.context !== this.context) continue;
        try {
          await callServiceOnTargetEntities(
            command.hass,
            command.config,
            "set_angle",
            { angle: command.angle },
          );
          if (command.context === this.context) this.onApplied(command.angle);
        } catch (error) {
          if (command.context === this.context) this.onError(error);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  reset() {
    this.context++;
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

/**
 * Create SVG pie-slice segments for a color wheel.
 * @param {Array<Array<number>>} colors - Array of [r,g,b] arrays
 * @param {number} radius - Radius of the wheel
 * @returns {string} SVG markup string
 */
export function createColorWheelSegments(colors, radius) {
  if (!colors || colors.length === 0) {
    return `<circle cx="50" cy="50" r="${radius}" fill="#ff0000"/>`;
  }

  if (colors.length === 1) {
    const hex = rgbToHex(colors[0]);
    return `<circle cx="50" cy="50" r="${radius}" fill="${hex}"/>`;
  }

  const segments = [];
  const anglePerSegment = 360 / colors.length;

  for (let i = 0; i < colors.length; i++) {
    const startAngle = (i * anglePerSegment - 90) * (Math.PI / 180);
    const endAngle = ((i + 1) * anglePerSegment - 90) * (Math.PI / 180);

    const x1 = 50 + radius * Math.cos(startAngle);
    const y1 = 50 + radius * Math.sin(startAngle);
    const x2 = 50 + radius * Math.cos(endAngle);
    const y2 = 50 + radius * Math.sin(endAngle);

    const largeArcFlag = anglePerSegment > 180 ? 1 : 0;
    const hex = rgbToHex(colors[i]);

    const pathData = [
      `M 50 50`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      `Z`,
    ].join(" ");

    segments.push(`<path d="${pathData}" fill="${hex}"/>`);
  }

  return segments.join("\n                ");
}

/**
 * Create SVG linear gradient stops for a wheel-style display.
 * @param {Array<Array<number>>} colors - Array of [r,g,b] arrays
 * @returns {string} SVG stop elements markup
 */
export function createWheelGradientStops(colors) {
  if (!colors || colors.length === 0) {
    return '<stop offset="0%" style="stop-color:#ff0000"/><stop offset="100%" style="stop-color:#ff0000"/>';
  }

  if (colors.length === 1) {
    const hex = rgbToHex(colors[0]);
    return `<stop offset="0%" style="stop-color:${hex}"/><stop offset="100%" style="stop-color:${hex}"/>`;
  }

  const stops = [];

  for (let i = 0; i < colors.length; i++) {
    const offset = (i / (colors.length - 1)) * 100;
    const hex = rgbToHex(colors[i]);
    stops.push(`<stop offset="${offset}%" style="stop-color:${hex}"/>`);
  }

  return stops.join("\n                  ");
}

