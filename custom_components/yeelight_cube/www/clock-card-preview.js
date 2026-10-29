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
  renderClockFrame,
} from "./clock-preview-utils.js";
import {
  MATRIX_SIZE,
  firmwareClockFrame,
  isVerticalMount,
  viewerFrame,
} from "./matrix-view.js";
import {
  matrixPixelShadow,
  matrixPreviewCells,
  renderMatrixPreview,
} from "./gallery-display-utils.js";

// The blank frame a current-style preview is built with (then painted).
const BLANK_FRAME = Array.from({ length: MATRIX_SIZE }, () => [0, 0, 0]);
import { PreviewVisibility } from "./preview-visibility.js";
import { clockPresetKey } from "./clock-preset-utils.js";

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
    // Standing up while the lamp does (the shared renderer's vertical view).
    const vertical = isVerticalMount(this._previewOrientation());
    const appearanceSignature = JSON.stringify([
      this.config.lamp_pixel_style,
      this.config.lamp_matrix_background,
      this.config.lamp_spacing_mode,
      this.config.lamp_matrix_box_shadow,
      this.config.lamp_ignore_black_pixels,
      vertical,
    ]);
    if (el._cells && el._appearanceSignature === appearanceSignature)
      return el._cells;
    el._appearanceSignature = appearanceSignature;
    const spacing = this.config.lamp_spacing_mode || "normal";
    const gap = this._spacingGap(spacing);
    const options = {
      forceAspectRatio: true,
      vertical,
      pixelStyle: this.config.lamp_pixel_style || "rounded",
      bgColor: this._bgCss(this.config.lamp_matrix_background || "black"),
      pixelGap: gap,
      padding: Math.max(2, gap * 2),
      pixelBoxShadow: this._spacingShadow(spacing),
      matrixBoxShadow: this.config.lamp_matrix_box_shadow === true,
      ignoreBlackPixels: this._lampIgnoreBlack(),
    };
    // The shared preview markup (blank), its cells painted in place by
    // _paintPreview, which keeps the shadow in sync as pixels turn on/off.
    el._ignoreBlack = options.ignoreBlackPixels;
    el._pixelShadow = matrixPixelShadow(options);
    el.innerHTML = renderMatrixPreview(BLANK_FRAME, options);
    el._cells = matrixPreviewCells(el.querySelector(".gallery-matrix-preview"));
    return el._cells;
  }

  _paintPreview(el, phase) {
    let styleName;
    let isCurrent = false;
    let cells;
    if (el.hasAttribute("data-clock-preview")) {
      styleName = el.dataset.styleName;
      isCurrent = el.dataset.current === "1";
      cells = this._ensureGrid(el);
    } else {
      // A gallery item (Original tile or preview layout), repainted with the
      // gallery_* appearance. Its cells are read again when the gallery
      // re-rendered it (a new grid, or turned for the lamp's orientation).
      styleName = el.dataset.mode;
      // The grid found last time while it is still this tile's (a gallery
      // re-render may replace it, or turn it for the lamp's orientation).
      let matrix = el._cellsGrid;
      if (!matrix?.isConnected || !el.contains(matrix))
        matrix = el.querySelector(".gallery-matrix-preview");
      if (!matrix || matrix.children.length !== 100) return;
      const vertical = matrix.dataset.vertical === "true";
      if (el._cellsGrid !== matrix || el._cellsVertical !== vertical) {
        el._cellsGrid = matrix;
        el._cellsVertical = vertical;
        el._cells = matrixPreviewCells(matrix);
        el._ignoreBlack = this._galleryIgnoreBlack();
        el._pixelShadow = matrixPixelShadow({
          vertical,
          pixelBoxShadow: this._spacingShadow(
            this.config.gallery_spacing_mode || "normal",
          ),
        });
      }
      cells = el._cells;
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
    // renderClockFrame is bottom-origin (row 0 = physical bottom): shown as
    // the viewer sees the lamp, top row first (matrix-view.js).
    const frame = viewerFrame(
      // As the lamp draws it: its direction setting may turn it (Matter).
      firmwareClockFrame(renderClockFrame(attrs, fontMap, metrics, phase), this._attrs()),
      this._previewOrientation(),
    );
    const brightnessScale = isCurrent
      ? this._lampSliders.previewScale(this._attrs())
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
