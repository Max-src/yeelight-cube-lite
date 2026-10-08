// Clock face previews of the clock card: the animation loop, the visibility
// observer and painting the lamp and style previews. Mixed into
// YeelightCubeClockCard.
import {
  createRafLoop,
  paintCellBackground,
  paintCellBoxShadow,
} from "./matrix-animator.js";
import {
  CLOCK_MIXER_EFFECT_SPEED,
  flipMatrixVertical,
  renderClockFrame,
} from "./clock-preview-utils.js";
import { PreviewVisibility } from "./preview-visibility.js";
import { previewLength } from "./preview-appearance.js";
import { clockPresetKey } from "./clock-preset-utils.js";
import { brightnessPctToRaw } from "./slider-control-utils.js";
import { previewBrightnessScale } from "./matrix-const.js";

export const ClockPreviewMixin = (Base) => class extends Base {
  // ── Animation ─────────────────────────────────────────────────────────────
  // A single rAF loop repaints ONLY the on-screen previews, in place (updating
  // each dot's background rather than rebuilding HTML), throttled to ~11 fps and
  // paused while the tab is hidden (shared createRafLoop). This keeps a long
  // gallery of animated previews smooth instead of full-innerHTML rebuilds.
  _startAnimation() {
    if (!this._animLoop) {
      this._animLoop = createRafLoop(() => this._paintVisible(), {
        minIntervalMs: 90, // ~11 fps
      });
    }
    this._animLoop.start();
  }

  _stopAnimation() {
    if (this._animLoop) this._animLoop.stop();
    this._visibility?.disconnect();
    this._visible = new Set();
  }

  // Current clock animation speed (1-255), read from the lamp so the preview
  // matches the rate the slider applies. While dragging, the live slider value
  // takes over so the preview responds immediately.
  _animationSpeed() {
    if (this._speedPreview != null) return this._speedPreview;
    const v = Number(this._attrs().native_effect_speed);
    return Math.max(1, Math.min(255, v || CLOCK_MIXER_EFFECT_SPEED));
  }

  // Accumulated phase (peek). Advanced once per paint tick by _advancePhase so
  // changing the speed re-scales future motion without a visual jump.
  _phase() {
    return this._phaseAccum;
  }

  _advancePhase() {
    const now = Date.now();
    if (this._lastPhaseTs == null) this._lastPhaseTs = now;
    const dt = (now - this._lastPhaseTs) / 1000;
    this._lastPhaseTs = now;
    this._phaseAccum += dt * (0.25 + this._animationSpeed() / 55.0);
  }

  // Track which preview tiles are actually on screen so the loop never wastes
  // work animating tiles scrolled out of view. Covers both the card's own
  // tiles (data-clock-preview) and the shared-renderer items ([data-mode]
  // inside the preview shell).
  _setupObserver() {
    // A render can land after the card left the page (disconnectedCallback
    // already ran): never keep an observer nothing would clean up.
    if (!this.isConnected) {
      this._visibility?.disconnect();
      this._visible = new Set();
      return;
    }
    const tiles = this.shadowRoot
      ? [
          ...this.shadowRoot.querySelectorAll("[data-clock-preview]"),
          // Every item preview of the gallery: preview layouts and chip
          // swatches (items without a matrix are skipped when painted).
          ...this.shadowRoot.querySelectorAll(
            "yc-collection-gallery .reference-selector [data-mode]",
          ),
          ...this.shadowRoot.querySelectorAll(
            ".original-gallery .original-item",
          ),
        ]
      : [];
    // One observer for the card's lifetime: a re-render only observes the
    // tiles it added and releases the ones it removed.
    this._visibility ||= new PreviewVisibility({
      rootMargin: "120px",
      Observer:
        typeof IntersectionObserver === "undefined"
          ? null
          : IntersectionObserver,
    });
    // The observer reports a new tile asynchronously (next frame at best), so
    // a re-render (new style/color selected) would leave freshly built
    // gallery tiles on their static first frame until then -- a visible blink.
    // Seed new tiles synchronously with the same 120px margin so the
    // following _paintVisible() repaints them before the browser shows them.
    const margin = 120;
    const viewHeight = globalThis.innerHeight || 0;
    const viewWidth = globalThis.innerWidth || 0;
    this._visibility.track(tiles, (el) => {
      if (el.hasAttribute("data-clock-preview")) return true;
      const rect = el.getBoundingClientRect?.();
      return (
        !!rect &&
        rect.width > 0 &&
        rect.bottom >= -margin &&
        rect.top <= viewHeight + margin &&
        rect.right >= -margin &&
        rect.left <= viewWidth + margin
      );
    });
    this._visible = this._visibility.visible;
    // The card's own previews (lamp/current) are always repainted after a
    // render, whatever the observer last reported: a re-render (e.g. an
    // appearance change) must show on them at once.
    tiles.forEach((el) => {
      if (el.hasAttribute("data-clock-preview")) this._visible.add(el);
    });
  }

  _paintVisible() {
    if (!this._hass) return;
    // Freezing holds the background animation on its current frame, but the
    // clock digits/colon keep evolving -- so skip advancing the phase yet keep
    // repainting, exactly like the frozen lamp.
    if (!this._controls?.frozen) this._advancePhase();
    else this._lastPhaseTs = Date.now();
    const phase = this._phase();
    this._visible.forEach((el) => this._paintPreview(el, phase));
  }

  // Build a tile's dot grid exactly once, caching the cell nodes on the element.
  // Card-owned tiles (current preview) use the Lamp Preview
  // appearance settings.
  _ensureGrid(el) {
    const appearanceSignature = JSON.stringify([
      this.config.lamp_pixel_style,
      this.config.lamp_matrix_background,
      this.config.lamp_spacing_mode,
      this.config.lamp_matrix_box_shadow,
      this.config.lamp_ignore_black_pixels,
    ]);
    if (el._cells && el._appearanceSignature === appearanceSignature)
      return el._cells;
    el._appearanceSignature = appearanceSignature;
    const cols = 20;
    const rows = 5;
    const pixelStyle = this.config.lamp_pixel_style || "rounded";
    const radius =
      pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0";
    const bg = this._bgCss(this.config.lamp_matrix_background || "black");
    const spacing = this.config.lamp_spacing_mode || "normal";
    const gap = this._spacingGap(spacing);
    const pad = Math.max(2, gap * 2);
    // Shadow is state-dependent (ignored-black pixels get none) — stored on the
    // element so _paintPreview keeps it in sync as pixels turn on/off.
    el._pixelShadow = this._spacingShadow(spacing)
      ? `0 0 ${previewLength(2)} #0008`
      : "";
    const matrixShadow =
      this.config.lamp_matrix_box_shadow === true
        ? `box-shadow:0 ${previewLength(2)} ${previewLength(8)} rgba(0,0,0,0.5);`
        : "";
    el._ignoreBlack = this._lampIgnoreBlack();
    el.style.containerType = "inline-size";
    el.innerHTML = "";
    const grid = document.createElement("div");
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:${previewLength(gap)};background:${bg};padding:${previewLength(pad)};border-radius:${previewLength(4)};width:100%;box-sizing:border-box;${matrixShadow}`;
    const emptyBg = el._ignoreBlack ? "transparent" : "#000";
    // Empty cells: no shadow when ignore-black hides them (matches the shared
    // renderMatrixPreview rule), shadow otherwise (visible black pixel).
    const emptyShadow = el._ignoreBlack ? "" : el._pixelShadow;
    const cells = [];
    for (let i = 0; i < cols * rows; i++) {
      const d = document.createElement("div");
      d.style.cssText = `aspect-ratio:1/1;border-radius:${radius};background:${emptyBg};${emptyShadow ? `box-shadow:${emptyShadow};` : ""}`;
      grid.appendChild(d);
      cells.push(d);
    }
    el.appendChild(grid);
    el._cells = cells;
    return cells;
  }

  _paintPreview(el, phase) {
    let styleName;
    let isCurrent = false;
    let cells;
    if (el.hasAttribute("data-clock-preview")) {
      styleName = el.dataset.styleName;
      isCurrent = el.dataset.current === "1";
      cells = this._ensureGrid(el);
    } else if (el.classList.contains("original-item")) {
      // Original uses the same gallery_* appearance as Live Preview. The key
      // is read from the escaped data-mode attribute, never from raw HTML.
      styleName = el.dataset.mode;
      cells = el._cells;
      if (!cells) {
        const matrix = el.querySelector(".gallery-matrix-preview");
        if (!matrix || matrix.children.length !== 100) return;
        cells = Array.from(matrix.children);
        el._cells = cells;
        el._ignoreBlack = this._galleryIgnoreBlack();
        el._pixelShadow = this._spacingShadow(
          this.config.gallery_spacing_mode || "normal",
        )
          ? `0 0 ${previewLength(2)} #0008`
          : "";
      }
    } else {
      // Preview selector item: repaint using the gallery_* appearance.
      styleName = el.dataset.mode;
      cells = el._cells;
      if (!cells) {
        const matrix = el.querySelector(".gallery-matrix-preview");
        if (!matrix || matrix.children.length !== 100) return;
        cells = Array.from(matrix.children);
        el._cells = cells;
        el._ignoreBlack = this._galleryIgnoreBlack();
        el._pixelShadow = this._spacingShadow(
          this.config.gallery_spacing_mode || "normal",
        )
          ? `0 0 ${previewLength(2)} #0008`
          : "";
      }
    }
    const style =
      this._styleList().find((item) => clockPresetKey(item) === styleName) ||
      this._currentStyle();
    if (!style) return;
    // A powered-off lamp shows a blank screen: black out the current preview.
    if (isCurrent && this._stateObj()?.state === "off") {
      for (let i = 0; i < cells.length; i++) {
        paintCellBackground(cells[i], "#000");
        paintCellBoxShadow(cells[i], "");
      }
      return;
    }
    const emptyBg = el._ignoreBlack ? "transparent" : "#000";
    const attrs = this._previewAttrs(style);
    const { fontMap, metrics } = this._getNativeClockFont();
    // renderClockFrame is bottom-origin (row 0 = physical bottom); the CSS grid
    // fills top→bottom, so flip vertically or the clock renders upside-down.
    const frame = flipMatrixVertical(
      renderClockFrame(attrs, fontMap, metrics, phase),
    );
    const brightnessRaw =
      this._brightnessPreview != null
        ? brightnessPctToRaw(this._brightnessPreview)
        : Number(this._attrs().brightness) || 255;
    const brightnessScale = isCurrent
      ? previewBrightnessScale(brightnessRaw, this._attrs().preview_darken)
      : 1;
    for (let i = 0; i < cells.length; i++) {
      const source = frame[i] || [0, 0, 0];
      const p =
        brightnessScale === 1
          ? source
          : source.map((channel) => Math.round(channel * brightnessScale));
      const isOff = (p[0] | p[1] | p[2]) === 0;
      const bg = isOff ? emptyBg : `rgb(${p[0]},${p[1]},${p[2]})`;
      // The initial render bakes box-shadow only on lit pixels (shared
      // renderMatrixPreview rule); keep it in sync as pixels turn on/off or
      // ghost outlines linger where digits/colons used to be.
      const sh = isOff && el._ignoreBlack ? "" : el._pixelShadow || "";
      const cell = cells[i];
      paintCellBackground(cell, bg);
      paintCellBoxShadow(cell, sh);
    }
  }
};
