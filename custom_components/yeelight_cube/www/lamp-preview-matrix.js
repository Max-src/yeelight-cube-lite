// Matrix preview of the lamp preview card: lamp colours, clock and native
// effect animations, painting the dots and the oriented matrix geometry.
// Mixed into YeelightCubeLampPreviewCard.
import { previewBrightnessScale, BLACK_THRESHOLD } from "./matrix-const.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { createVisibilityTracker, createRafLoop } from "./matrix-animator.js";
import {
  clockStyleMixer,
  CLOCK_MIXER_EFFECTS,
  CLOCK_MIXER_EFFECT_SPEED,
  renderClockFrame,
  lookupNativeClockFont,
} from "./clock-preview-utils.js";
import { renderNativeEffectOriented } from "./native-effect-preview.js";
import { previewLength } from "./preview-appearance.js";
import { html, repeat } from "./lib/lit-all.js";

export const MatrixPreviewMixin = (Base) => class extends Base {
  // Convert a 100-entry matrix_colors array (RGB tuples) to CSS colors using
  // the same brightness-boost pipeline as the static preview. Extracted so the
  // native-effect animation loop renders identically to the normal path.
  _matrixColorsToGridColors(matrixColors, stateObj) {
    const entityBrightness = stateObj?.attributes?.brightness ?? 255;
    const darkenPercent = stateObj?.attributes?.preview_darken ?? 0;
    const previewBoost = previewBrightnessScale(
      entityBrightness,
      darkenPercent,
    );
    return matrixColors.map((c) => {
      let px = c;
      if (!Array.isArray(px) || px.length !== 3) px = [0, 0, 0];
      if (px[0] === 0 && px[1] === 0 && px[2] === 0) return rgbToCss([0, 0, 0]);
      return rgbToCss(
        px.map((v) => Math.min(255, Math.round(v * previewBoost))),
      );
    });
  }

  // Lazily cache the .lamp-dot NodeList so animation frames don't re-query the
  // DOM every tick. Invalidated (set null) whenever the matrix DOM is rebuilt;
  // a cache whose nodes Lit has since removed is re-queried as well.
  _getLampDots() {
    if (
      !this._lampDots ||
      this._lampDots.length === 0 ||
      (this.isConnected && !this._lampDots[0].isConnected)
    ) {
      this._lampDots = this.shadowRoot?.querySelectorAll(".lamp-dot") || [];
    }
    return this._lampDots;
  }

  // Observe the card so animations idle while it is scrolled off screen. Paired
  // with the tab-hidden pause inside createRafLoop.
  _ensureVisibilityTracker() {
    if (this._visTracker) return;
    this._visTracker = createVisibilityTracker(this, {
      onChange: (onScreen) => {
        this._onScreen = onScreen;
      },
    });
    this._onScreen = this._visTracker.onScreen;
    this._visTracker.connect();
  }

  // Begin the client-side approximation animation for Native Effect mode.
  _startNativeAnimation() {
    this._ensureVisibilityTracker();
    if (!this._nativeLoop) {
      this._nativeLoop = createRafLoop(() => this._nativeAnimFrame(), {
        minIntervalMs: 100, // ~10 fps
      });
    }
    if (this._nativeLoop.running) return;
    this._nativeAnimFrame(); // draw the first frame immediately
    this._nativeLoop.start();
  }

  _stopNativeAnimation() {
    if (this._nativeLoop) this._nativeLoop.stop();
    this._nativeAnimKey = null;
    this._nativeAnimStartedAt = null;
    this._nativeFrozenPhase = null;
  }

  // Begin the client-side clock animation. Solid/gradient styles only need a
  // slow tick for the colon blink and minute changes (500 ms); styles whose
  // mixer is a native effect animate that effect, so they tick at 100 ms. The
  // interval is re-evaluated each frame, so a style change adapts the rate.
  _startClockAnimation() {
    this._ensureVisibilityTracker();
    if (!this._clockLoop) {
      this._clockLoop = createRafLoop(() => this._clockAnimFrame(), {
        minIntervalMs: () => this._clockAnimInterval(),
      });
    }
    if (this._clockLoop.running) return;
    this._clockAnimFrame(); // draw the first frame immediately
    this._clockLoop.start();
  }

  _clockAnimInterval() {
    const attrs = this._hass?.states?.[this.config?.entity]?.attributes;
    const mixer = attrs ? clockStyleMixer(attrs) : 0;
    return CLOCK_MIXER_EFFECTS[mixer] ? 100 : 500;
  }

  _stopClockAnimation() {
    if (this._clockLoop) this._clockLoop.stop();
    this._clockAnimStartedAt = null;
    this._frozenBackgroundPhase = null;
  }

  _clockAnimFrame() {
    if (!this._onScreen) return;
    const st = this._hass?.states?.[this.config?.entity];
    if (!st || st.state !== "on" || st.attributes.content_mode !== "Clock") {
      this._stopClockAnimation();
      return;
    }
    const dots = this._getLampDots();
    if (!dots || dots.length !== 100) return; // matrix not rendered yet

    const now = performance.now();
    if (this._clockAnimStartedAt == null) this._clockAnimStartedAt = now;
    const rate = 0.25 + CLOCK_MIXER_EFFECT_SPEED / 55.0;
    // While frozen, hold the background effect on the frame the lamp holds;
    // the digits/colon (rendered from real time in renderClockFrame) still
    // advance. Resume seamlessly from the held phase.
    const frozen = st.attributes.display_frozen === true;
    if (frozen) {
      if (this._frozenBackgroundPhase == null)
        this._frozenBackgroundPhase =
          ((now - this._clockAnimStartedAt) / 1000) * rate;
    } else if (this._frozenBackgroundPhase != null) {
      this._clockAnimStartedAt =
        now - (this._frozenBackgroundPhase / rate) * 1000;
      this._frozenBackgroundPhase = null;
    }
    const phase =
      this._frozenBackgroundPhase ??
      ((now - this._clockAnimStartedAt) / 1000) * rate;
    const { fontMap, metrics } = this._getNativeClockFont();
    const pix = renderClockFrame(st.attributes, fontMap, metrics, phase);
    const grid = this._matrixColorsToGridColors(pix, st);
    this._updateMatrixColors(grid, st);
  }

  // The bundled "native" clock font + its monospace metrics from the
  // component's "Font Characters" sensor, so the preview matches the font the
  // lamp renders (the sensor is remembered: no scan of every entity per frame).
  _getNativeClockFont() {
    const states = this._hass?.states;
    if (!states) return { fontMap: null, metrics: null };
    this._nativeFontCache = lookupNativeClockFont(states, this._nativeFontCache);
    return this._nativeFontCache.font;
  }

  _nativeAnimFrame() {
    if (!this._onScreen) return;
    const st = this._hass?.states?.[this.config?.entity];
    if (
      !st ||
      st.state !== "on" ||
      st.attributes.content_mode !== "Native Effect"
    ) {
      this._stopNativeAnimation();
      return;
    }
    const dots = this._getLampDots();
    if (!dots || dots.length !== 100) return; // matrix not rendered yet

    const effect = st.attributes.native_effect || "Streamer";
    const dir = st.attributes.native_effect_direction || "Up";
    const speed = Math.max(
      1,
      Math.min(100, Number(st.attributes.native_effect_speed ?? 50)),
    );
    const now = performance.now();
    const animationKey = `${effect}\u0000${dir}`;
    if (animationKey !== this._nativeAnimKey) {
      this._nativeAnimKey = animationKey;
      this._nativeAnimStartedAt = now;
      this._nativeFrozenPhase = null;
    }
    // Match the camera's phase mapping (native_effect_preview usage).
    const rate = 0.25 + speed / 55.0;
    // While frozen, hold the frame the lamp is holding; resume seamlessly.
    const frozen = st.attributes.display_frozen === true;
    if (frozen) {
      if (this._nativeFrozenPhase == null)
        this._nativeFrozenPhase =
          ((now - this._nativeAnimStartedAt) / 1000) * rate;
    } else if (this._nativeFrozenPhase != null) {
      this._nativeAnimStartedAt = now - (this._nativeFrozenPhase / rate) * 1000;
      this._nativeFrozenPhase = null;
    }
    const phase =
      this._nativeFrozenPhase ??
      ((now - this._nativeAnimStartedAt) / 1000) * rate;
    // Bottom-origin frame (row 0 = physical bottom), like the clock path: hand
    // it straight to _updateMatrixColors, whose layout indexFn provides the one
    // display flip. (A prior extra flip here double-flipped native effects, so
    // they showed upside-down vs the calibration card / lamp.)
    const raw = renderNativeEffectOriented(
      effect,
      phase,
      dir,
      st.attributes.native_effect_color || null,
      st.attributes.native_effect_color_mode || "normal",
    );
    const grid = this._matrixColorsToGridColors(raw, st);
    this._updateMatrixColors(grid, st);
  }

  // Update only matrix dot colors without rebuilding DOM
  _updateMatrixColors(gridColors, stateObj) {
    const dots = this._getLampDots();
    if (dots.length !== gridColors.length) {
      // Mismatch - need full render
      this._isInitialRenderComplete = false;
      this._refresh();
      return;
    }

    // If the device orientation changed, the grid geometry (rows/cols, tall vs
    // wide) changed too — a color-only update can't fix that, so full re-render.
    const orientation = stateObj?.attributes?.device_orientation || "right";
    if (this._lastPreviewOrientation !== orientation) {
      this._lastPreviewOrientation = orientation;
      this._isInitialRenderComplete = false;
      this._refresh();
      return;
    }

    this._paintDots(gridColors, orientation, dots);
  }

  // Paint the .lamp-dot nodes directly. The dots have no reactive bindings, so
  // Lit never rewrites what the static preview or the animation loops paint.
  _paintDots(gridColors, orientation, dots = this._getLampDots()) {
    const layout = this._orientedLayout(orientation);
    const totalCols = layout.cols;

    dots.forEach((dot, idx) => {
      const row = Math.floor(idx / totalCols);
      const col = idx % totalCols;
      const colorIndex = layout.indexFn(row, col);

      const color = gridColors[colorIndex] || "#000000";

      // Change-only: the raw color fully determines the black/empty/display
      // state, so skip the parse and DOM writes when it hasn't changed.
      if (dot._rawColor === color) return;
      dot._rawColor = color;

      const { isEmpty, displayColor } = this._dotAppearance(color);

      // Update background and class
      dot.style.background = displayColor;
      if (isEmpty) {
        dot.classList.add("lamp-dot-empty");
      } else {
        dot.classList.remove("lamp-dot-empty");
      }
    });
  }

  // Black detection (shared BLACK_THRESHOLD from matrix-const.js) and the
  // hide_black_dots display rule for one CSS color.
  _dotAppearance(color) {
    let isBlack = false;
    if (color.startsWith("#")) {
      // Hex color format
      const hex = color.replace(/^#/, "");
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      isBlack =
        r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD;
    } else if (color.startsWith("rgb")) {
      // RGB color format
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        isBlack =
          r <= BLACK_THRESHOLD &&
          g <= BLACK_THRESHOLD &&
          b <= BLACK_THRESHOLD;
      }
    }
    const isEmpty = this.config.hide_black_dots ? isBlack : false;
    const displayColor =
      this.config.hide_black_dots && isBlack ? "transparent" : color;
    return { isEmpty, displayColor };
  }

  // Map the physical device orientation to a preview grid geometry + a
  // function returning the gridColors index for each display cell (r,c).
  //   right / left : 20x5 landscape (identical preview; left only flips the lamp)
  //   up / down    : 5x20 tall. Both use the SAME 90deg rotation mapping — the
  //                  180deg difference between them comes from the lamp content
  //                  itself (up => _orientation normal, down => flipped). Using
  //                  different mappings here would cancel that content flip and
  //                  make up and down look identical.
  // gridColors is stored bottom-to-top, so the base landscape read is
  // (rows-1 - r)*20 + c (the historical vertical flip).
  _orientedLayout(orientation) {
    if (orientation === "up" || orientation === "down") {
      return {
        cols: 5,
        rows: 20,
        tall: true,
        indexFn: (r, c) => c * 20 + r,
      };
    }
    return {
      cols: 20,
      rows: 5,
      tall: false,
      indexFn: (r, c) => (4 - r) * 20 + c,
    };
  }

  // Container geometry of the matrix preview (shared by the Lit template and
  // the string renderer below).
  _matrixGeometry(stateObj) {
    const matrixBackground = this.config.matrix_background || "black";
    const matrixBoxShadow = this.config.matrix_box_shadow !== false;
    // Resolve pixel spacing mode (new tri-state) with backward compat for old booleans
    const spacingMode =
      this.config.matrix_spacing_mode ||
      (this.config.matrix_pixel_spacing === false ? "none" : "normal");
    const pixelGap = spacingMode === "normal" ? 4 : 0;
    const pixelStyle = this.config.matrix_pixel_style || "square";
    const alignClass =
      this.config.align === "left"
        ? "align-left"
        : this.config.align === "right"
          ? "align-right"
          : "align-center";

    // Preview geometry follows the physical device orientation.
    const orientation = stateObj?.attributes?.device_orientation || "right";
    const layout = this._orientedLayout(orientation);
    const sizePct = this.config.size_pct || 100;
    return {
      layout,
      alignClass,
      outerStyle: `container-type:inline-size;max-width:100%;width:${layout.tall ? `${(85 * sizePct) / 100}px` : `${sizePct}%`};margin-inline:${this.config.align === "left" ? "0 auto" : this.config.align === "right" ? "auto 0" : "auto"};`,
      gridStyle:
        // Pixel shape and dot shadow, read by .lamp-dot (lamp-preview-styles.js).
        `--lamp-dot-radius:${pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0px"};` +
        `--lamp-dot-shadow:${spacingMode === "subtle" || spacingMode === "normal" ? `0 0 ${previewLength(2)} #0008` : "none"};` +
        `width:100%;aspect-ratio:auto;padding:${previewLength(8)};border-radius:${previewLength(12)};` +
        `background: ${matrixBackground}; ` +
        `gap: ${previewLength(pixelGap)}; ` +
        `box-shadow: ${matrixBoxShadow ? `0 ${previewLength(2)} ${previewLength(8)} #0008` : "none"}; ` +
        `grid-template-columns: repeat(${layout.cols}, 1fr); ` +
        `grid-template-rows: repeat(${layout.rows}, 1fr);`,
    };
  }

  // Lit matrix preview. The dots are keyed by the full-update generation (so
  // every full update gets fresh nodes, like the former rebuild) and carry no
  // bindings: _paintDots and the animation loops own their colors.
  _matrixTemplate(stateObj) {
    const { layout, alignClass, outerStyle, gridStyle } =
      this._matrixGeometry(stateObj);
    const generation = this._dotGeneration;
    const indices = Array.from(
      { length: layout.rows * layout.cols },
      (_, index) => index,
    );
    return html`<div class=${alignClass} style=${outerStyle}>
      <div class="lamp-preview-css" style=${gridStyle}>
        ${repeat(
          indices,
          (index) => `${generation}:${index}`,
          () => html`<div class="lamp-dot"></div>`,
        )}
      </div>
    </div>`;
  }
};
