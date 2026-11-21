// Clock face previews of the clock card: the animation loop, the visibility
// observer and painting the lamp and style previews. Mixed into
// YeelightCubeClockCard.
import {
  matrixSurface,
  paintCellBackground,
  paintCellBoxShadow,
} from "./matrix-animator.js";
import { AnimatedPreview, PreviewClock } from "./preview-animation.js";
import { RENDER_SECONDS } from "./lamp-timing.js";
import {
  clockPhase,
  clockSpeed,
  renderClockFrame,
  clockUsesLampRenderer,
} from "./clock-preview-utils.js";
import { chosenIntensity } from "./lamp-renderers.js";
import {
  MATRIX_SIZE,
  isVerticalMount,
  viewerFrame,
} from "./matrix-view.js";
import {
  matrixPixelShadow,
  matrixPreviewCells,
  renderMatrixPreview,
} from "./gallery-display-utils.js";

// The blank frame a current-style preview is built with (then painted;
// fitted to a longer Cube Matrix's width by renderMatrixPreview's context).
const BLANK_FRAME = Array.from({ length: MATRIX_SIZE }, () => [0, 0, 0]);
import { PreviewVisibility } from "./preview-visibility.js";
import { moduleCells, paintModuleCells } from "./matrix-modules.js";
import { previewContext } from "./preview-context.js";
import { clockPresetKey } from "./clock-preset-utils.js";

export const ClockPreviewMixin = (Base) => class extends Base {
  // ── Animation ─────────────────────────────────────────────────────────────
  // The page's one rAF loop repaints ONLY the on-screen previews, in place
  // (updating each dot's background rather than rebuilding HTML), throttled
  // to ~11 fps, idle while the tab is hidden or the card scrolled away
  // (preview-animation.js). This keeps a long gallery of animated previews
  // smooth instead of full-innerHTML rebuilds.
  _startAnimation() {
    this._animation ||= new AnimatedPreview(this, {
      onFrame: (due) => this._paintVisible(due, false),
      minIntervalMs: 90, // ~11 fps
      smoothWhen: () => this._smoothTiles,
      // Back on screen: the previews as they are now, at once.
      onShown: () => this._paintVisible(),
    });
    this._animation.start();
  }

  _stopAnimation() {
    this._animation?.disconnect();
    this._visibility?.disconnect();
    this._visible = new Set();
  }

  // The animation's seconds (preview-animation.js PreviewClock, on the wall
  // clock): held while the lamp's display is frozen.
  _previewTime() {
    return (this.__previewTime ||= new PreviewClock({ now: () => Date.now() }));
  }
  get _elapsed() {
    return this._previewTime().elapsed;
  }
  set _elapsed(seconds) {
    this._previewTime().elapsed = seconds;
  }
  get _lastPhaseTs() {
    return this._previewTime().last;
  }
  set _lastPhaseTs(time) {
    this._previewTime().last = time;
  }

  // Current clock animation speed (1-255), read from the lamp so the preview
  // matches the rate the slider applies. While dragging, the live slider value
  // takes over so the preview responds immediately.
  _animationSpeed() {
    return this._speedPreview ?? clockSpeed(this._attrs());
  }

  // The intensity the previews draw at (1-255): the dragged one, else the
  // lamp's. Only a background that reads it changes.
  _animationIntensity() {
    return this._intensityPreview ?? chosenIntensity(this._attrs());
  }

  // The animation's phase at the current speed (peek). The seconds advance
  // once per paint tick (_advanceElapsed), so changing the speed changes the
  // motion from here on, without a jump.
  _phase() {
    return clockPhase(this._elapsed, this._animationSpeed());
  }

  _advanceElapsed(frozen = false) {
    this._previewTime().advance(frozen);
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
    // A render: what the previews show is worked out again (_tileAttrs).
    this._previewGeneration = (this._previewGeneration || 0) + 1;
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

  // all = false: only the tiles with a background the lamp draws, on the
  // frames between the others' (createRafLoop's smoothWhen). The loop passes
  // fresh = false: a tile showing this render at this second stays as it is (the
  // display refreshes faster than the lamp renders, and the digits change on
  // the second).
  _paintVisible(all = true, fresh = true) {
    if (!this._hass) return;
    // Freezing holds the background animation on its current frame, but the
    // clock digits/colon keep evolving -- so skip advancing the phase yet keep
    // repainting, exactly like the frozen lamp.
    this._advanceElapsed(!!this._controls?.frozen);
    const phase = this._phase();
    const moment = `${Math.floor(this._elapsed / RENDER_SECONDS)}:${Math.floor(Date.now() / 1000)}`;
    this._visible.forEach((el) => {
      if (!all && !el._smooth) return;
      if (!fresh && el._smooth) {
        if (el._paintedMoment === moment) return;
        el._paintedMoment = moment;
      }
      this._paintPreview(el, phase);
    });
    if (all) this._smoothTiles = [...this._visible].some((el) => el._smooth);
  }

  // The card's own tiles' look (their grid is built again when it changes):
  // worked out when what it reads changes, not on every frame.
  _gridSignature() {
    const attrs = this._attrs();
    const orientation = this._previewOrientation();
    const memo = this.__gridSignature;
    if (memo?.config === this.config && memo.attrs === attrs && memo.orientation === orientation)
      return memo.value;
    // Standing up while the lamp does (the shared renderer's vertical view).
    const vertical = isVerticalMount(orientation);
    const value = JSON.stringify([
      this.config.lamp_pixel_style,
      this.config.lamp_matrix_background,
      this.config.lamp_spacing_mode,
      this.config.lamp_matrix_box_shadow,
      this.config.lamp_ignore_black_pixels,
      vertical,
      // A Cube Matrix's modules (a new layout: a new grid).
      attrs.matrix_modules,
      attrs.matrix_columns,
    ]);
    this.__gridSignature = { config: this.config, attrs, orientation, value };
    return value;
  }

  // Build a tile's dot grid exactly once, caching the cell nodes on the element.
  // Card-owned tiles (current preview) use the Lamp Preview
  // appearance settings.
  _ensureGrid(el) {
    const appearanceSignature = this._gridSignature();
    if (el._cells && el._appearanceSignature === appearanceSignature)
      return el._cells;
    const vertical = isVerticalMount(this._previewOrientation());
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
      // A Cube Matrix's modules only (preview-context.js).
      context: previewContext(this._attrs(), { pendingOrientation: this._previewOrientation() }),
    };
    // The shared preview markup (blank), painted in place by _paintPreview:
    // its cells, which keep the shadow in sync as pixels turn on/off, or for
    // an animated background its matrixSurface, which does the same.
    el._ignoreBlack = options.ignoreBlackPixels;
    el._pixelShadow = matrixPixelShadow(options);
    el.innerHTML = renderMatrixPreview(BLANK_FRAME, options);
    el._cells = matrixPreviewCells(el.querySelector(".gallery-matrix-preview"));
    // A Cube Matrix's spots and panels: one face each (matrix-modules.js).
    el._faces = moduleCells(el._cells);
    return el._cells;
  }

  // The styles shown, by key (once per list).
  _stylesByKey() {
    const list = this._styleList();
    if (this.__stylesByKey?.list !== list)
      this.__stylesByKey = {
        list,
        byKey: new Map(list.map((item) => [clockPresetKey(item), item])),
      };
    return this.__stylesByKey.byKey;
  }

  // A style's preview attributes (_previewAttrs), worked out once per render,
  // lamp update and dragged speed or intensity rather than on every frame.
  _tileAttrs(style) {
    const inputs = [
      this._previewGeneration,
      this._attrs(),
      this._animationSpeed(),
      this._animationIntensity(),
    ];
    let memo = this.__tileAttrs;
    if (!memo?.inputs.every((value, index) => value === inputs[index]))
      memo = this.__tileAttrs = { inputs, byStyle: new Map() };
    let attrs = memo.byStyle.get(style);
    if (!attrs) memo.byStyle.set(style, (attrs = this._previewAttrs(style)));
    return attrs;
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
      if (!matrix) return;
      const vertical = matrix.dataset.vertical === "true";
      // Its cells read again only for a new grid or layout.
      if (el._cellsGrid !== matrix || el._cellsVertical !== vertical) {
        const found = matrixPreviewCells(matrix);
        // A frame's cells: 100, or a longer Cube Matrix's width x 5.
        if (found.length < MATRIX_SIZE || found.length % 5) return;
        el._cellsGrid = matrix;
        el._cellsVertical = vertical;
        el._cells = found;
        el._faces = moduleCells(found);
      }
      // Each time: the card's settings change on the same grid.
      el._ignoreBlack = this._galleryIgnoreBlack();
      el._pixelShadow = matrixPixelShadow({
        vertical,
        pixelBoxShadow: this._spacingShadow(
          this.config.gallery_spacing_mode || "normal",
        ),
      });
      cells = el._cells;
    }
    const style = this._stylesByKey().get(styleName) || this._currentStyle();
    if (!style) return;
    // A powered-off lamp shows a blank screen: black out the current preview.
    const grid = el._cellsGrid || el.querySelector(".gallery-matrix-preview");
    if (isCurrent && this._stateObj()?.state === "off") {
      if (grid?.classList.contains("matrix-surface"))
        matrixSurface(grid).paint(BLANK_FRAME);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i]._module) continue;
        paintCellBackground(cells[i], "#000");
        paintCellBoxShadow(cells[i], "");
      }
      paintModuleCells(el._faces || [], [], { shadow: el._pixelShadow || "" });
      return;
    }
    const emptyBg = el._ignoreBlack ? "transparent" : "#000";
    const attrs = this._tileAttrs(style);
    el._smooth = clockUsesLampRenderer(attrs);
    const { fontMap, metrics } = this._getNativeClockFont();
    // renderClockFrame is bottom-origin (row 0 = physical bottom): shown as
    // the viewer sees the lamp, top row first (matrix-view.js).
    const frame = viewerFrame(
      // As the lamp draws it: its mount profile may turn the digits
      // (renderClockFrame).
      renderClockFrame(attrs, fontMap, metrics, phase),
      this._previewOrientation(),
    );
    const brightnessScale = isCurrent
      ? this._lampSliders.previewScale(this._attrs())
      : 1;
    // A background the lamp draws changes 25 times a second: on a canvas,
    // which stays when the same preview goes on to a solid style.
    if (grid && (el._smooth || grid.classList.contains("matrix-surface"))) {
      matrixSurface(grid).paint(
        frame,
        brightnessScale,
        el._ignoreBlack ? 0 : null,
        el._pixelShadow,
      );
      return;
    }
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
      if (cell._module) continue;
      paintCellBackground(cell, bg);
      paintCellBoxShadow(cell, sh);
    }
    paintModuleCells(el._faces || [], frame, {
      scale: brightnessScale,
      shadow: el._pixelShadow || "",
    });
  }
};
