// Generic palette rendering for Yeelight Cube Lite Draw Card
import { html } from "./lib/lit-all.js";

// Helper: parse a CSS color string to [r, g, b] (0-255)
function _parseColor(c) {
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3)
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const m = c.match(/(\d+)/g);
  return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
}

// Helper: RGB to HSL
function _rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

// Sort colors for a smooth progressive gradient.
// Uses a nearest-neighbor chain starting from the darkest color
// to avoid jarring jumps in hue/lightness.
function _sortColorsForGradient(palette) {
  if (palette.length <= 2) return [...palette];
  const parsed = palette.map((c) => {
    const [r, g, b] = _parseColor(c);
    const [h, s, l] = _rgbToHsl(r, g, b);
    return { color: c, h, s, l };
  });
  // Nearest-neighbor walk in HSL space for smooth transitions
  const remaining = new Set(parsed.map((_, i) => i));
  // Start from the darkest color
  let startIdx = 0;
  let minL = Infinity;
  for (const i of remaining) {
    if (parsed[i].l < minL) {
      minL = parsed[i].l;
      startIdx = i;
    }
  }
  const sorted = [parsed[startIdx]];
  remaining.delete(startIdx);
  while (remaining.size > 0) {
    const cur = sorted[sorted.length - 1];
    let bestIdx = -1,
      bestDist = Infinity;
    for (const i of remaining) {
      const p = parsed[i];
      // Circular hue distance
      let dh = Math.abs(cur.h - p.h);
      if (dh > 0.5) dh = 1 - dh;
      const dist = dh * dh * 4 + (cur.s - p.s) ** 2 + (cur.l - p.l) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    sorted.push(parsed[bestIdx]);
    remaining.delete(bestIdx);
  }
  return sorted.map((p) => p.color);
}

// Helper: resolve swatch shape class
function _shapeClass(swatchShape) {
  return swatchShape === "square"
    ? "square"
    : swatchShape === "rounded"
      ? "rounded"
      : "round";
}

// CSS named colors for closest-name lookup
const _CSS_COLORS = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
};

/**
 * Get closest CSS color name for an [r,g,b] tuple.
 */
function _getClosestColorName(rgb) {
  let best = "unknown",
    minD = Infinity;
  for (const [name, c] of Object.entries(_CSS_COLORS)) {
    const d =
      (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < minD) {
      minD = d;
      best = name;
    }
  }
  return best;
}

/**
 * Format a color label based on display mode.
 * @param {string} hexColor  e.g. "#ff0000"
 * @param {string} mode  "none"|"hex"|"name"  (default "none")
 * @returns {string}
 */
function _formatColorLabel(hexColor, mode) {
  if (!mode || mode === "none") return "";
  if (mode === "name") {
    const rgb = _parseColor(hexColor);
    return _getClosestColorName(rgb);
  }
  return hexColor; // "hex"
}

export function renderPaletteSection(
  palette,
  type,
  onSelect,
  mode = "row",
  swatchShape = "round",
  expandBtnStyle = "pill",
  buttonShape = "rect",
  blindsDirection = "rows",
  colorWeights = null,
  colorInfoDisplay = "none",
) {
  if (!palette || !palette.length) return "";
  const shapeClass = _shapeClass(swatchShape);
  let hoveredColor = null;
  const handleMouseOver = (color) => {
    hoveredColor = color;
  };
  const handleMouseLeave = () => {
    hoveredColor = null;
  };
  const handleClick = (color, e) => {
    e.stopPropagation();
    if (hoveredColor === color) onSelect(color);
  };

  // Tooltip text based on color info display setting
  const _tip = (color) => {
    const label = _formatColorLabel(color, colorInfoDisplay);
    return label || color;
  };

  const swatch = (color) =>
    html`<div
      class="color-swatch ${shapeClass}"
      style="background:${color}"
      title="${_tip(color)}"
      @mouseover=${() => handleMouseOver(color)}
      @mouseleave=${handleMouseLeave}
      @click=${(e) => handleClick(color, e)}
      @touchend=${(e) => {
        e.preventDefault();
        onSelect(color);
      }}
    ></div>`;

  if (mode === "grid") {
    const rowCount = 2;
    const colCount = Math.ceil(palette.length / rowCount);
    const rows = Array.from({ length: rowCount }, (_, r) =>
      palette.slice(r * colCount, (r + 1) * colCount),
    );
    return html`<div class="palette-grid">
      ${rows.map(
        (row) =>
          html`<div class="palette-grid-row">
            ${row.map((c) => swatch(c))}
          </div>`,
      )}
    </div>`;
  }

  if (mode === "expand") {
    return html`<palette-expandable
      .palette=${palette}
      .onSelect=${onSelect}
      .swatchShape=${swatchShape}
      .expandStyle=${expandBtnStyle || "pill"}
      .buttonShape=${buttonShape}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-expandable>`;
  }

  if (mode === "scroll") {
    return html`<palette-scroll
      .palette=${palette}
      .onSelect=${onSelect}
      .swatchShape=${swatchShape}
      .buttonShape=${buttonShape}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-scroll>`;
  }

  if (mode === "gradient") {
    const sortedPalette = _sortColorsForGradient(palette);
    return html`<palette-gradient-bar
      .palette=${sortedPalette}
      .onSelect=${onSelect}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-gradient-bar>`;
  }

  if (mode === "fan") {
    return html`<palette-fan
      .palette=${palette}
      .onSelect=${onSelect}
      .swatchShape=${swatchShape}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-fan>`;
  }

  if (mode === "wave") {
    return html`<palette-wave
      .palette=${palette}
      .onSelect=${onSelect}
      .swatchShape=${swatchShape}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-wave>`;
  }

  if (mode === "spiral") {
    return html`<palette-spiral
      .palette=${palette}
      .onSelect=${onSelect}
      .swatchShape=${swatchShape}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-spiral>`;
  }

  if (mode === "honeycomb") {
    return html`<palette-honeycomb
      .palette=${palette}
      .onSelect=${onSelect}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-honeycomb>`;
  }

  if (mode === "blinds") {
    return html`<palette-blinds
      .palette=${palette}
      .onSelect=${onSelect}
      .direction=${blindsDirection || "rows"}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-blinds>`;
  }

  if (mode === "treemap") {
    return html`<palette-treemap
      .palette=${palette}
      .onSelect=${onSelect}
      .colorWeights=${colorWeights}
      .colorInfoDisplay=${colorInfoDisplay}
    ></palette-treemap>`;
  }

  // Default: ROW (wrapping flex)
  return html`<div class="palette-expandable">
    ${palette.map((c) => swatch(c))}
  </div>`;
}

// -----------------------------------------------------------------------
// Base class for palette custom elements — handles deferred rendering
// -----------------------------------------------------------------------
class PaletteBase extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.style.width = "100%";
    this._ready = true;
    this._scheduleRender();
  }
  disconnectedCallback() {
    if (this._renderRAF) {
      cancelAnimationFrame(this._renderRAF);
      this._renderRAF = null;
    }
  }
  _scheduleRender() {
    if (!this._ready) return;
    if (this._renderRAF) cancelAnimationFrame(this._renderRAF);
    this._renderRAF = requestAnimationFrame(() => {
      this._renderRAF = null;
      this._doRender();
    });
  }
  _doRender() {
    /* override in subclass */
  }
  /**
   * Legacy no-op — kept for backwards compat. Modes now use
   * percentage-based layouts with width:100% + max-width + aspect-ratio,
   * so the browser handles scaling and centering natively.
   */
  _applyFitScale() {}
  /**
   * Attach click + touchend select handlers to all matching swatch elements.
   * Touchend is separate because mobile doesn't always fire mouseover→click properly.
   */
  _attachSwatchSelect(selector, onSelect, attrName = "data-color") {
    this.querySelectorAll(selector).forEach((el) => {
      el.addEventListener("click", () => onSelect(el.getAttribute(attrName)));
      el.addEventListener("touchend", (e) => {
        e.preventDefault();
        onSelect(el.getAttribute(attrName));
      });
    });
  }
  // Generic property helpers
  _prop(key, val) {
    const propKey = "_" + key;
    const prev = this[propKey];

    // Callback identity can change on every parent render; it should not
    // force a visual rerender/rebuild of the palette DOM.
    if (key === "onSelect") {
      this[propKey] = val;
      return;
    }

    // Parent render may pass a new array instance with identical values.
    // Skip rerender when arrays are shallow-equal.
    if (Array.isArray(prev) && Array.isArray(val)) {
      if (
        prev.length === val.length &&
        prev.every((item, idx) => item === val[idx])
      ) {
        return;
      }
    } else if (prev === val) {
      return;
    }

    this[propKey] = val;
    this._scheduleRender();
  }
  _getProp(key, def) {
    return this["_" + key] !== undefined ? this["_" + key] : def;
  }
}

// -----------------------------------------------------------------------
// Expandable palette
// -----------------------------------------------------------------------
class PaletteExpandable extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    const expanded = this._expanded || false;
    const shapeClass = _shapeClass(this._getProp("swatchShape", "round"));
    const style = this._getProp("expandStyle", "pill");
    const buttonShape = this._getProp("buttonShape", "rect");
    const infoMode = this._getProp("colorInfoDisplay", "none");

    const collapsedCount = 5;
    const hasMore = palette.length > collapsedCount;
    const hiddenCount = palette.length - collapsedCount;
    const shown = expanded ? palette : palette.slice(0, collapsedCount);
    const tip = (c) => _formatColorLabel(c, infoMode) || c;

    let btnHtml = "";
    if (hasMore && !expanded) {
      if (style === "pill") {
        btnHtml = `<button class="expand-btn expand-pill nav-btn-${buttonShape}" title="Show ${hiddenCount} more colors">+${hiddenCount}</button>`;
      } else if (style === "chevron") {
        btnHtml = `<button class="expand-btn expand-chevron nav-btn-${buttonShape}" title="Show more colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
      } else if (style === "dots") {
        btnHtml = `<button class="expand-btn expand-dots nav-btn-${buttonShape}" title="Show ${hiddenCount} more colors">&#x22EF;</button>`;
      }
    } else if (hasMore && expanded) {
      if (style === "chevron") {
        btnHtml = `<button class="expand-btn expand-chevron expanded nav-btn-${buttonShape}" title="Show less colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>`;
      } else {
        btnHtml = `<button class="expand-btn expand-pill expanded nav-btn-${buttonShape}" title="Show less colors">&minus;</button>`;
      }
    }

    this.innerHTML = `<div class="palette-expandable">${shown.map((c) => `<div class="color-swatch ${shapeClass}" style="background:${c}" data-color="${c}" title="${tip(c)}"></div>`).join("")}${btnHtml}</div>`;
    this._attachSwatchSelect(".color-swatch", onSelect);
    const btn = this.querySelector(".expand-btn");
    if (btn)
      btn.onclick = () => {
        this._expanded = !this._expanded;
        this._doRender();
      };
  }
  set expandStyle(v) {
    this._prop("expandStyle", v);
  }
  get expandStyle() {
    return this._getProp("expandStyle", "pill");
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set buttonShape(v) {
    this._prop("buttonShape", v);
  }
  get buttonShape() {
    return this._getProp("buttonShape", "rect");
  }
  set swatchShape(v) {
    this._prop("swatchShape", v);
  }
  get swatchShape() {
    return this._getProp("swatchShape", "round");
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-expandable"))
  customElements.define("palette-expandable", PaletteExpandable);

// -----------------------------------------------------------------------
// Scroll mode — horizontal draggable ribbon with carousel-style nav arrows
// -----------------------------------------------------------------------
class PaletteScroll extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const shapeClass = _shapeClass(this._getProp("swatchShape", "round"));
    const btnShape = this._getProp("buttonShape", "rect");
    const infoMode = this._getProp("colorInfoDisplay", "none");
    const tip = (c) => _formatColorLabel(c, infoMode) || c;
    this.innerHTML = `
      <div class="palette-scroll-wrapper">
        <button class="palette-scroll-arrow palette-scroll-left nav-btn-${btnShape}" title="Scroll left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="palette-scroll-track">${palette.map((c) => `<div class="color-swatch ${shapeClass}" style="background:${c}" data-color="${c}" title="${tip(c)}"></div>`).join("")}</div>
        <button class="palette-scroll-arrow palette-scroll-right nav-btn-${btnShape}" title="Scroll right"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>`;
    const onSelect = this._getProp("onSelect", () => {});
    this._attachSwatchSelect(".color-swatch", onSelect);
    const track = this.querySelector(".palette-scroll-track");
    this.querySelector(".palette-scroll-left")?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        track?.scrollBy({ left: -120, behavior: "smooth" });
      },
    );
    this.querySelector(".palette-scroll-right")?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        track?.scrollBy({ left: 120, behavior: "smooth" });
      },
    );
    // Drag to scroll
    if (track) {
      let isDown = false,
        startX,
        sl;
      track.onmousedown = (e) => {
        isDown = true;
        track.classList.add("dragging");
        startX = e.pageX;
        sl = track.scrollLeft;
      };
      track.onmouseleave = track.onmouseup = () => {
        isDown = false;
        track.classList.remove("dragging");
      };
      track.onmousemove = (e) => {
        if (!isDown) return;
        e.preventDefault();
        track.scrollLeft = sl - (e.pageX - startX);
      };
      track.ontouchstart = (e) => {
        isDown = true;
        startX = e.touches[0].pageX;
        sl = track.scrollLeft;
      };
      track.ontouchend = () => {
        isDown = false;
      };
      track.ontouchmove = (e) => {
        if (!isDown) return;
        track.scrollLeft = sl - (e.touches[0].pageX - startX);
      };
    }
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set swatchShape(v) {
    this._prop("swatchShape", v);
  }
  get swatchShape() {
    return this._getProp("swatchShape", "round");
  }
  set buttonShape(v) {
    this._prop("buttonShape", v);
  }
  get buttonShape() {
    return this._getProp("buttonShape", "rect");
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-scroll"))
  customElements.define("palette-scroll", PaletteScroll);

// -----------------------------------------------------------------------
// Gradient bar — smooth gradient with click-to-pick + tick marks
// -----------------------------------------------------------------------
class PaletteGradientBar extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    const infoMode = this._getProp("colorInfoDisplay", "none");
    const tip = (c) => _formatColorLabel(c, infoMode) || c;
    const n = palette.length;
    const pct = (i) => ((i / Math.max(n - 1, 1)) * 100).toFixed(1);
    const stops = palette.map((c, i) => `${c} ${pct(i)}%`).join(", ");
    this.innerHTML = `
      <div class="palette-gradient-bar-wrapper">
        <div class="palette-gradient-bar" style="background:linear-gradient(to right, ${stops});"></div>
        <div class="palette-gradient-ticks">${palette.map((c, i) => `<div class="palette-gradient-tick" style="left:${pct(i)}%;background:${c};" data-color="${c}" title="${tip(c)}"></div>`).join("")}</div>
      </div>`;
    const onSelect = this._getProp("onSelect", () => {});
    const bar = this.querySelector(".palette-gradient-bar");
    if (bar) {
      const pickColor = (clientX) => {
        const rect = bar.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        onSelect(palette[Math.round(p * (n - 1))]);
      };
      bar.addEventListener("click", (e) => pickColor(e.clientX));
      bar.addEventListener("touchend", (e) => {
        if (e.changedTouches && e.changedTouches.length) {
          e.preventDefault();
          pickColor(e.changedTouches[0].clientX);
        }
      });
    }
    this.querySelectorAll(".palette-gradient-tick").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(el.getAttribute("data-color"));
      });
    });
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-gradient-bar"))
  customElements.define("palette-gradient-bar", PaletteGradientBar);

// -----------------------------------------------------------------------
// Fan mode — semi-circular arc of color swatches
// -----------------------------------------------------------------------
class PaletteFan extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    const shapeClass = _shapeClass(this._getProp("swatchShape", "round"));
    const infoMode = this._getProp("colorInfoDisplay", "none");
    const tip = (c) => _formatColorLabel(c, infoMode) || c;
    const total = palette.length;
    const arcStart = -70,
      arcEnd = 70,
      radius = 90,
      sz = 26;
    // Keep rotated/scaled swatches fully inside the fan container with
    // equal padding on all sides.
    const pad = 12;
    const maxSin = Math.sin((arcEnd * Math.PI) / 180);
    const innerW = Math.ceil(2 * (maxSin * radius + sz / 2));
    const innerH = Math.ceil(radius + sz + 12);
    const naturalW = innerW + pad * 2;
    const naturalH = innerH + pad * 2;
    const cx = pad + innerW / 2;
    // Percentage-based sizing — browser handles scale + centering
    const wPct = ((sz / naturalW) * 100).toFixed(2);
    const hPct = ((sz / naturalH) * 100).toFixed(2);
    let s = "";
    palette.forEach((color, i) => {
      const angle =
        total === 1 ? 0 : arcStart + (arcEnd - arcStart) * (i / (total - 1));
      const rad = (angle * Math.PI) / 180;
      const x = Math.sin(rad) * radius;
      const y = pad + (-Math.cos(rad) * radius + radius);
      const left = cx + x - sz / 2;
      const edge = 1 - Math.abs(angle) / 90;
      const sc = 0.7 + 0.3 * edge;
      const op = 0.6 + 0.4 * edge;
      const leftPct = ((left / naturalW) * 100).toFixed(2);
      const topPct = ((y / naturalH) * 100).toFixed(2);
      s += `<div class="color-swatch palette-fan-swatch ${shapeClass}" style="background:${color};left:${leftPct}%;top:${topPct}%;width:${wPct}%;height:${hPct}%;--fan-angle:${angle.toFixed(1)}deg;transform:rotate(var(--fan-angle)) scale(${sc.toFixed(2)});opacity:${op.toFixed(2)};" data-color="${color}" title="${tip(color)}"></div>`;
    });
    this.innerHTML = `<div class="palette-fan-container" style="width:100%;max-width:${naturalW}px;margin:0 auto;aspect-ratio:${naturalW}/${naturalH};position:relative;overflow:hidden;">${s}</div>`;
    this._attachSwatchSelect(".color-swatch", onSelect);
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set swatchShape(v) {
    this._prop("swatchShape", v);
  }
  get swatchShape() {
    return this._getProp("swatchShape", "round");
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-fan"))
  customElements.define("palette-fan", PaletteFan);

// -----------------------------------------------------------------------
// Wave mode — sinusoidal wave of colors
// -----------------------------------------------------------------------
class PaletteWave extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    const shapeClass = _shapeClass(this._getProp("swatchShape", "round"));
    const infoMode = this._getProp("colorInfoDisplay", "none");
    const tip = (c) => _formatColorLabel(c, infoMode) || c;
    const total = palette.length;
    const amplitude = 22;
    const sz = 26;
    const spacing = Math.max(sz + 4, 32);
    const naturalW = spacing * (total - 1) + sz;
    const naturalH = amplitude * 2 + sz + 12;
    const midY = amplitude + 4;
    const wPct = ((sz / naturalW) * 100).toFixed(2);
    const hPct = ((sz / naturalH) * 100).toFixed(2);
    let s = "";
    palette.forEach((color, i) => {
      const t = total === 1 ? 0.5 : i / (total - 1);
      const x = t * (naturalW - sz);
      const y = midY + Math.sin(t * Math.PI * 2.5) * amplitude;
      const peak = (Math.sin(t * Math.PI * 2.5) + 1) / 2;
      const sc = 0.8 + 0.25 * peak;
      const leftPct = ((x / naturalW) * 100).toFixed(2);
      const topPct = ((y / naturalH) * 100).toFixed(2);
      s += `<div class="color-swatch palette-wave-swatch ${shapeClass}" style="background:${color};left:${leftPct}%;top:${topPct}%;width:${wPct}%;height:${hPct}%;transform:scale(${sc.toFixed(2)});" data-color="${color}" title="${tip(color)}"></div>`;
    });
    this.innerHTML = `<div class="palette-wave-container" style="width:100%;max-width:${naturalW}px;margin:0 auto;aspect-ratio:${naturalW}/${naturalH};position:relative;">${s}</div>`;
    this._attachSwatchSelect(".color-swatch", onSelect);
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set swatchShape(v) {
    this._prop("swatchShape", v);
  }
  get swatchShape() {
    return this._getProp("swatchShape", "round");
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-wave"))
  customElements.define("palette-wave", PaletteWave);

// -----------------------------------------------------------------------
// Spiral mode — logarithmic spiral outward from center
// Adapts turns & radius to color count so it looks great with 3 or 80 colors
// -----------------------------------------------------------------------
class PaletteSpiral extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    const shapeClass = _shapeClass(this._getProp("swatchShape", "round"));
    const infoMode = this._getProp("colorInfoDisplay", "none");
    const tip = (c) => _formatColorLabel(c, infoMode) || c;
    const total = palette.length;
    const sz = 24;
    // Adapt parameters to count: small palettes stay compact, large palettes expand
    const turns =
      total <= 3
        ? 0.5
        : total <= 8
          ? 0.8
          : total <= 16
            ? 1.2
            : total <= 30
              ? 1.6
              : 2.2;
    const maxR =
      total <= 3
        ? 30
        : total <= 8
          ? 50
          : total <= 16
            ? 70
            : total <= 30
              ? 85
              : 100;
    const cSize = maxR * 2 + sz + 16;
    const cx = cSize / 2,
      cy = cSize / 2;
    const swPct = ((sz / cSize) * 100).toFixed(2);
    let s = "";
    palette.forEach((color, i) => {
      const t = total === 1 ? 0 : i / (total - 1);
      const angle = t * turns * Math.PI * 2;
      const r = total === 1 ? 0 : 8 + t * (maxR - 8);
      const x = cx + Math.cos(angle) * r - sz / 2;
      const y = cy + Math.sin(angle) * r - sz / 2;
      const sc = 0.7 + t * 0.35;
      const rot = ((angle * 180) / Math.PI).toFixed(0);
      const leftPct = ((x / cSize) * 100).toFixed(2);
      const topPct = ((y / cSize) * 100).toFixed(2);
      s += `<div class="color-swatch palette-spiral-swatch ${shapeClass}" style="background:${color};left:${leftPct}%;top:${topPct}%;width:${swPct}%;height:${swPct}%;transform:rotate(${rot}deg) scale(${sc.toFixed(2)});" data-color="${color}" title="${tip(color)}"></div>`;
    });
    this.innerHTML = `<div class="palette-spiral-container" style="width:100%;max-width:${cSize}px;margin:0 auto;aspect-ratio:1;position:relative;">${s}</div>`;
    this._attachSwatchSelect(".color-swatch", onSelect);
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set swatchShape(v) {
    this._prop("swatchShape", v);
  }
  get swatchShape() {
    return this._getProp("swatchShape", "round");
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-spiral"))
  customElements.define("palette-spiral", PaletteSpiral);

// -----------------------------------------------------------------------
// Honeycomb mode — hexagonal tiling grid like a beehive
// -----------------------------------------------------------------------
class PaletteHoneycomb extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    const infoMode = this._getProp("colorInfoDisplay", "none");
    const tip = (c) => _formatColorLabel(c, infoMode) || c;
    const label = (c) => _formatColorLabel(c, infoMode);
    const total = palette.length;
    const hexW = total <= 8 ? 40 : total <= 20 ? 34 : 28;
    const hexH = Math.round(hexW * 1.1547); // 2/sqrt(3)
    const cols = Math.max(2, Math.ceil(Math.sqrt(total * 1.4)));
    const rows = Math.ceil(total / cols);
    const rowH = hexH * 0.75;
    const naturalW = cols * hexW + hexW / 2 + 16;
    const naturalH = rows * rowH + hexH * 0.25 + 16;
    const hwPct = ((hexW / naturalW) * 100).toFixed(2);
    const hhPct = ((hexH / naturalH) * 100).toFixed(2);
    let s = "";
    palette.forEach((color, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const offset = row % 2 === 1 ? hexW / 2 : 0;
      const x = col * hexW + offset + 8;
      const y = row * rowH + 8;
      const lbl = label(color);
      const [r, g, b] = _parseColor(color);
      const textColor =
        r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
      const leftPct = ((x / naturalW) * 100).toFixed(2);
      const topPct = ((y / naturalH) * 100).toFixed(2);
      const fontSize = hexW <= 28 ? 6 : 7;
      s += `<div class="palette-hex-swatch" style="background:${color};left:${leftPct}%;top:${topPct}%;width:${hwPct}%;height:${hhPct}%;" data-color="${color}" title="${tip(color)}">${lbl ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;color:${textColor};pointer-events:none;text-align:center;line-height:1.1;padding:2px;overflow:hidden;">${lbl}</span>` : ""}</div>`;
    });
    this.innerHTML = `<div class="palette-honeycomb-container" style="width:100%;max-width:${naturalW}px;margin:0 auto;aspect-ratio:${naturalW}/${naturalH};position:relative;">${s}</div>`;
    this._attachSwatchSelect(".palette-hex-swatch", onSelect);
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-honeycomb"))
  customElements.define("palette-honeycomb", PaletteHoneycomb);

// -----------------------------------------------------------------------
// Blinds — venetian blind strips: hover to peek/expand a color
// Full-width strips that expand on hover, compressing neighbors
// -----------------------------------------------------------------------
class PaletteBlinds extends PaletteBase {
  _doRender() {
    // If a click-lock is active, skip re-render to prevent the
    // collapse-reopen-select-wrong-color issue.
    if (this._clickLocked) return;

    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    const direction = this._getProp("direction", "rows");
    const infoMode = this._getProp("colorInfoDisplay", "none");
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    const total = palette.length;
    const label = (c) => _formatColorLabel(c, infoMode);
    const tip = (c) => _formatColorLabel(c, infoMode) || c;

    // Direction class applied to the container
    const dirClass = `palette-blinds-${direction}`;

    if (direction === "columns") {
      // Vertical strips side by side
      const totalW = "100%";
      const containerH = 110;
      let s = "";
      palette.forEach((color) => {
        const [r, g, b] = _parseColor(color);
        const textColor =
          r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
        s += `<div class="palette-blind-strip" style="background:${color};flex:1;" data-color="${color}" title="${tip(color)}"><span class="palette-blind-label" style="color:${textColor};">${label(color)}</span></div>`;
      });
      this.innerHTML = `<div class="palette-blinds-container ${dirClass}" style="width:${totalW};height:${containerH}px;">${s}</div>`;
    } else if (
      direction === "diagonal-right" ||
      direction === "diagonal-left"
    ) {
      // Diagonal strips using a rotated inner flex container
      // Compute exact scale so the rotated rectangle fully covers
      // the visible container regardless of its aspect ratio.
      const containerH = 130;
      const rotDeg = direction === "diagonal-right" ? 18 : -18;
      const rad = (Math.abs(rotDeg) * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      // For a rectangle W×H rotated by θ, its axis-aligned bounding box is:
      //   bbW = W·cos + H·sin,   bbH = W·sin + H·cos
      // We need bbW ≥ containerW and bbH ≥ containerH.
      // Since containerW is unknown (responsive), we use percentages:
      //   scale = 1 / cos(θ)  covers width when aspect isn't extreme,
      //   but we must also cover height.  Use a generous factor.
      // For θ=18°: cos=0.951, sin=0.309 → worst-case (wide card ~3:1)
      //   height factor ≈ 3·sin + cos ≈ 1.88
      // Use 260% / -80% for generous coverage at all aspect ratios.
      const scalePct = 260;
      const offsetPct = -(scalePct - 100) / 2;
      let s = "";
      palette.forEach((color) => {
        const [r, g, b] = _parseColor(color);
        const textColor =
          r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
        s += `<div class="palette-blind-strip" style="background:${color};flex:1;" data-color="${color}" title="${tip(color)}"><span class="palette-blind-label" style="color:${textColor};transform:rotate(${-rotDeg}deg);">${label(color)}</span></div>`;
      });
      this.innerHTML = `<div class="palette-blinds-container palette-blinds-diagonal" style="width:100%;height:${containerH}px;"><div class="palette-blinds-rotate-wrap" style="transform:rotate(${rotDeg}deg);width:${scalePct}%;height:${scalePct}%;top:${offsetPct}%;left:${offsetPct}%;">${s}</div></div>`;
    } else {
      // Default: rows (horizontal strips stacked top to bottom)
      const minStripH = Math.max(4, Math.min(12, Math.floor(120 / total)));
      const totalH = Math.max(60, Math.min(130, total * minStripH + 10));
      let s = "";
      palette.forEach((color) => {
        const [r, g, b] = _parseColor(color);
        const textColor =
          r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
        s += `<div class="palette-blind-strip" style="background:${color};flex:1;" data-color="${color}" title="${tip(color)}"><span class="palette-blind-label" style="color:${textColor};">${label(color)}</span></div>`;
      });
      this.innerHTML = `<div class="palette-blinds-container ${dirClass}" style="width:100%;height:${totalH}px;">${s}</div>`;
    }

    // Attach click/touch handlers
    this.querySelectorAll(".palette-blind-strip").forEach((el) => {
      el.onclick = () => {
        this._clickLocked = true;
        onSelect(el.getAttribute("data-color"));
      };
      el.onmouseleave = () => {
        this._clickLocked = false;
      };
      // Touch: expand strip on touch, select on tap
      el.addEventListener(
        "touchstart",
        (e) => {
          el.classList.add("touch-active");
        },
        { passive: true },
      );
      el.addEventListener("touchend", (e) => {
        el.classList.remove("touch-active");
        this._clickLocked = true;
        onSelect(el.getAttribute("data-color"));
      });
      el.addEventListener("touchcancel", () => {
        el.classList.remove("touch-active");
      });
    });
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set direction(v) {
    this._prop("direction", v);
  }
  get direction() {
    return this._getProp("direction", "rows");
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-blinds"))
  customElements.define("palette-blinds", PaletteBlinds);

// -----------------------------------------------------------------------
// Treemap — squarified treemap: colors as proportional rectangles
// Each color's area is weighted by saturation, filling the full space
// -----------------------------------------------------------------------
class PaletteTreemap extends PaletteBase {
  _doRender() {
    const palette = this._getProp("palette", []);
    const onSelect = this._getProp("onSelect", () => {});
    const colorWeights = this._getProp("colorWeights", null);
    const infoMode = this._getProp("colorInfoDisplay", "none");
    if (!palette.length) {
      this.innerHTML = "";
      return;
    }
    // Weight by pixel count if available, otherwise equal weight
    const items = palette.map((c) => {
      const w =
        colorWeights && colorWeights instanceof Map && colorWeights.has(c)
          ? colorWeights.get(c)
          : 1;
      return { color: c, weight: Math.max(w, 0.1) };
    });
    const totalH = 110; // px
    const refW = 350; // approx container width for aspect-ratio calc
    const totalWeight = items.reduce((a, b) => a + b.weight, 0);
    const totalArea = refW * totalH;

    // Prepare items sorted by weight descending, with proportional areas
    const sorted = [...items]
      .sort((a, b) => b.weight - a.weight)
      .map((it) => ({
        color: it.color,
        area: (it.weight / totalWeight) * totalArea,
      }));

    // Proper squarify: at each step, lay a row along the shorter side
    // of the remaining rectangle, greedily adding items while aspect
    // ratio improves
    const rects = [];
    const squarify = (list, rx, ry, rw, rh) => {
      if (!list.length) return;
      if (list.length === 1) {
        rects.push({ color: list[0].color, x: rx, y: ry, w: rw, h: rh });
        return;
      }
      const isWide = rw >= rh;
      const side = isWide ? rh : rw; // shorter side
      let bestSplit = 1,
        bestWorst = Infinity,
        cumArea = 0;
      for (let i = 0; i < list.length; i++) {
        cumArea += list[i].area;
        const thickness = cumArea / side;
        let worst = 0;
        for (let j = 0; j <= i; j++) {
          const len = list[j].area / thickness;
          const ar = Math.max(thickness / len, len / thickness);
          if (ar > worst) worst = ar;
        }
        if (worst <= bestWorst) {
          bestWorst = worst;
          bestSplit = i + 1;
        } else {
          break;
        }
      }
      const row = list.slice(0, bestSplit);
      const rest = list.slice(bestSplit);
      const rowArea = row.reduce((s, it) => s + it.area, 0);
      // Last group fills all remaining space (avoids fp gaps)
      const thickness = rest.length > 0 ? rowArea / side : isWide ? rw : rh;
      let pos = 0;
      if (isWide) {
        // Vertical strip on the left, items stacked top-to-bottom
        for (const item of row) {
          const len =
            rest.length > 0
              ? item.area / thickness
              : (item.area / rowArea) * rh;
          rects.push({
            color: item.color,
            x: rx,
            y: ry + pos,
            w: thickness,
            h: len,
          });
          pos += len;
        }
        squarify(rest, rx + thickness, ry, rw - thickness, rh);
      } else {
        // Horizontal strip on top, items laid left-to-right
        for (const item of row) {
          const len =
            rest.length > 0
              ? item.area / thickness
              : (item.area / rowArea) * rw;
          rects.push({
            color: item.color,
            x: rx + pos,
            y: ry,
            w: len,
            h: thickness,
          });
          pos += len;
        }
        squarify(rest, rx, ry + thickness, rw, rh - thickness);
      }
    };

    squarify(sorted, 0, 0, refW, totalH);

    // Convert ALL coordinates to percentages so the treemap scales with container width
    let s = "";
    rects.forEach((r) => {
      const xPct = (r.x / refW) * 100;
      const yPct = (r.y / totalH) * 100;
      const wPct = (r.w / refW) * 100;
      const hPct = (r.h / totalH) * 100;
      const [rr, gg, bb] = _parseColor(r.color);
      const txtC =
        rr * 0.299 + gg * 0.587 + bb * 0.114 > 150 ? "#0008" : "#fff8";
      const cellLabel = _formatColorLabel(r.color, infoMode);
      const cellTip = cellLabel || r.color;
      const showLabel = hPct > 16 && wPct > 12 ? cellLabel : "";
      s += `<div class="palette-treemap-cell" style="background:${r.color};left:${xPct.toFixed(2)}%;top:${yPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;height:${hPct.toFixed(2)}%;" data-color="${r.color}" title="${cellTip}"><span style="color:${txtC};">${showLabel}</span></div>`;
    });
    this.innerHTML = `<div class="palette-treemap-container" style="aspect-ratio:${refW}/${totalH};position:relative;width:100%;border-radius:10px;overflow:hidden;">${s}</div>`;
    this._attachSwatchSelect(".palette-treemap-cell", onSelect);
  }
  set palette(v) {
    this._prop("palette", v);
  }
  get palette() {
    return this._getProp("palette", []);
  }
  set onSelect(v) {
    this._prop("onSelect", v);
  }
  get onSelect() {
    return this._getProp("onSelect", null);
  }
  set colorWeights(v) {
    this._prop("colorWeights", v);
  }
  get colorWeights() {
    return this._getProp("colorWeights", null);
  }
  set colorInfoDisplay(v) {
    this._prop("colorInfoDisplay", v);
  }
  get colorInfoDisplay() {
    return this._getProp("colorInfoDisplay", "none");
  }
}
if (!customElements.get("palette-treemap"))
  customElements.define("palette-treemap", PaletteTreemap);
