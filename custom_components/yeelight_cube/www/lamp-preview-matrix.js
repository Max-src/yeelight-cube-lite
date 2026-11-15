// Matrix preview of the lamp preview card: lamp colors, clock and native
// effect animations, painting the dots and the oriented matrix geometry.
// Mixed into YeelightCubeLampPreviewCard.
import { BLACK_THRESHOLD } from "./matrix-const.js";
import { rgbToCss } from "./color-utils.js";
import { createVisibilityTracker, createRafLoop } from "./matrix-animator.js";
import {
  LAMP_EFFECTS,
  RENDER_SECONDS,
  isLampRendered,
} from "./lamp-renderers.js";
import {
  clockStyleEffect,
  clockPhase,
  clockSpeed,
  clockUsesLampRenderer,
  renderClockFrame,
  lookupNativeClockFont,
} from "./clock-preview-utils.js";
import { nativeEffectLampFrame } from "./native-effect-card-utils.js";
import { matrixFrame } from "./matrix-frame.js";
import { withSpotColours } from "./matrix-modules.js";
import { contextGrid, previewContext } from "./preview-context.js";
import {
  isVerticalMount,
  matrixView,
  toDisplayOrder,
  viewerFrame,
} from "./matrix-view.js";
import { html, repeat } from "./lib/lit-all.js";

// One layout per orientation, made once (painted every animation frame).
const orientedLayouts = new Map();
function orientedLayout(orientation) {
  let layout = orientedLayouts.get(orientation);
  if (!layout) {
    const view = matrixView(isVerticalMount(orientation));
    layout = Object.freeze({
      cols: view.cols,
      rows: view.rows,
      tall: view.vertical,
      display: (frame) =>
        toDisplayOrder(viewerFrame(frame, orientation), view.vertical),
    });
    orientedLayouts.set(orientation, layout);
  }
  return layout;
}

// The lamp's effect as the Native Effects card lists it (its catalogue item:
// the directions it offers), else as the renderers know it.
function lampEffectItem(attributes, name) {
  const listed = Array.isArray(attributes?.native_effect_catalog)
    ? attributes.native_effect_catalog.find((item) => item?.name === name)
    : null;
  return listed ?? { name, directions: LAMP_EFFECTS[name]?.directions ?? [] };
}

export const MatrixPreviewMixin = (Base) => class extends Base {
  // Convert a 100-entry matrix_colors array (RGB tuples) to CSS colors using
  // the same brightness-boost pipeline as the static preview. Extracted so the
  // native-effect animation loop renders identically to the normal path.
  // A brightness slider being dragged (or not yet confirmed by the lamp)
  // wins over the lamp's reported value, so the preview follows the slider.
  _matrixColorsToGridColors(matrixColors, stateObj) {
    const previewBoost = this._lampSliders.previewScale(stateObj?.attributes);
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

  // Begin the client-side animation for Native Effect mode.
  _startNativeAnimation() {
    this._ensureVisibilityTracker();
    if (!this._nativeLoop) {
      this._nativeLoop = createRafLoop((now, due) => this._nativeAnimFrame(due), {
        minIntervalMs: 100, // ~10 fps
        smoothWhen: () =>
          isLampRendered(
            this._hass?.states?.[this._primaryEntity()]?.attributes
              ?.native_effect,
          ),
      });
    }
    if (this._nativeLoop.running) return;
    this._nativeAnimFrame(); // draw the first frame immediately
    this._nativeLoop.start();
  }

  // The dots fade to a new color over 0.2 s, which suits a picture changing.
  // An effect the lamp draws changes every 40 ms: a fading dot would never
  // reach its color and would show partly see-through, so it paints at once.
  _setInstantDots(instant) {
    this._getLampDots()[0]?.parentElement?.classList.toggle(
      "lamp-dots-instant",
      instant,
    );
  }

  _stopNativeAnimation() {
    if (this._nativeLoop) this._nativeLoop.stop();
    this._setInstantDots(false);
    this._nativeAnimKey = null;
    this._nativeAnimStartedAt = null;
    this._nativeFrozenSeconds = null;
    this._paintedRender = null;
  }

  // Begin the client-side clock animation. Solid/gradient styles only need a
  // slow tick for the colon blink and minute changes (500 ms); styles whose
  // mixer is a native effect animate that effect, so they tick at 100 ms. The
  // interval is re-evaluated each frame, so a style change adapts the rate.
  _startClockAnimation() {
    this._ensureVisibilityTracker();
    if (!this._clockLoop) {
      this._clockLoop = createRafLoop((now, due) => this._clockAnimFrame(due), {
        minIntervalMs: () => this._clockAnimInterval(),
        smoothWhen: () => {
          const attrs = this._hass?.states?.[this._primaryEntity()]?.attributes;
          return !!attrs && clockUsesLampRenderer(attrs);
        },
      });
    }
    if (this._clockLoop.running) return;
    this._clockAnimFrame(); // draw the first frame immediately
    this._clockLoop.start();
  }

  _clockAnimInterval() {
    const attrs = this._hass?.states?.[this._primaryEntity()]?.attributes;
    return attrs && clockStyleEffect(attrs) ? 100 : 500;
  }

  _stopClockAnimation() {
    if (this._clockLoop) this._clockLoop.stop();
    this._setInstantDots(false);
    this._clockAnimStartedAt = null;
    this._frozenBackgroundSeconds = null;
    this._paintedRender = null;
  }

  // due = false: a tick between the interval's. A preview's clock crosses a
  // render every 40 ms and the display refreshes more often: the frame already
  // painted stays.
  _sameRender(seconds, due) {
    const render = Math.floor(seconds / RENDER_SECONDS);
    if (!due && render === this._paintedRender) return true;
    this._paintedRender = render;
    return false;
  }

  _clockAnimFrame(due = true) {
    if (!this._onScreen) return;
    const st = this._hass?.states?.[this._primaryEntity()];
    if (!st || st.state !== "on" || st.attributes.content_mode !== "Clock") {
      this._stopClockAnimation();
      return;
    }
    const dots = this._getLampDots();
    if (!dots || dots.length !== 100) return; // matrix not rendered yet
    this._setInstantDots(clockUsesLampRenderer(st.attributes));

    const now = performance.now();
    if (this._clockAnimStartedAt == null) this._clockAnimStartedAt = now;
    // While frozen, hold the background effect on the frame the lamp holds;
    // the digits/colon (rendered from real time in renderClockFrame) still
    // advance. Resume seamlessly from the held frame.
    const frozen = st.attributes.display_frozen === true;
    if (frozen) {
      if (this._frozenBackgroundSeconds == null)
        this._frozenBackgroundSeconds = (now - this._clockAnimStartedAt) / 1000;
    } else if (this._frozenBackgroundSeconds != null) {
      this._clockAnimStartedAt = now - this._frozenBackgroundSeconds * 1000;
      this._frozenBackgroundSeconds = null;
    }
    const seconds =
      this._frozenBackgroundSeconds ?? (now - this._clockAnimStartedAt) / 1000;
    if (this._sameRender(seconds, due)) return;
    const speed = clockSpeed(st.attributes);
    const { fontMap, metrics } = this._getNativeClockFont();
    // As the lamp draws it: its mount profile may turn the digits
    // (renderClockFrame).
    const pix = renderClockFrame(
      st.attributes, fontMap, metrics, clockPhase(seconds, speed), speed,
    );
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

  _nativeAnimFrame(due = true) {
    if (!this._onScreen) return;
    const st = this._hass?.states?.[this._primaryEntity()];
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

    const effect = st.attributes.native_effect || "Ribbon";
    this._setInstantDots(isLampRendered(effect));
    const dir = st.attributes.native_effect_direction || "Right";
    // The lamp's settings (speed 0-255 as the lamp's, its mount, its
    // modules...), as every effect preview reads them.
    const context = previewContext(st.attributes);
    const { orientation } = context;
    const now = performance.now();
    const animationKey = `${effect}\u0000${dir}\u0000${orientation}`;
    if (animationKey !== this._nativeAnimKey) {
      this._nativeAnimKey = animationKey;
      this._nativeAnimStartedAt = now;
      this._nativeFrozenSeconds = null;
    }
    // While frozen, hold the frame the lamp is holding; resume seamlessly.
    const frozen = st.attributes.display_frozen === true;
    if (frozen) {
      if (this._nativeFrozenSeconds == null)
        this._nativeFrozenSeconds = (now - this._nativeAnimStartedAt) / 1000;
    } else if (this._nativeFrozenSeconds != null) {
      this._nativeAnimStartedAt = now - this._nativeFrozenSeconds * 1000;
      this._nativeFrozenSeconds = null;
    }
    const seconds =
      this._nativeFrozenSeconds ?? (now - this._nativeAnimStartedAt) / 1000;
    if (this._sameRender(seconds, due)) return;
    // The frame the Native Effects card draws (nativeEffectLampFrame), in
    // lamp order (row 0 = physical bottom), like every frame painted here:
    // _paintDots turns it the way the viewer sees it, once. The lamp's
    // mount profile does not turn it (the sent direction is compensated).
    // On the columns the lamp shows (a Cube Matrix with fewer blocks), as
    // its stream is drawn.
    const raw = nativeEffectLampFrame(lampEffectItem(st.attributes, effect), context, seconds);
    const grid = this._matrixColorsToGridColors(raw, st);
    this._updateMatrixColors(grid, st);
  }

  // Update only matrix dot colors without rebuilding DOM
  _updateMatrixColors(gridColors, stateObj) {
    const dots = this._getLampDots();
    if (dots.length !== gridColors.length) {
      // The matrix is not rendered as expected yet: update the card.
      this._refresh();
      return;
    }

    // If the device orientation changed, the grid geometry (rows/cols, tall vs
    // wide) changed too — a color-only update can't fix that, so full re-render.
    const { orientation } = previewContext(stateObj?.attributes);
    if (this._lastPreviewOrientation !== orientation) {
      this._lastPreviewOrientation = orientation;
      this._refresh();
      return;
    }

    this._paintDots(gridColors, orientation, dots);
  }

  // Paint the .lamp-dot nodes directly. The dots have no reactive bindings, so
  // Lit never rewrites what the static preview or the animation loops paint.
  _paintDots(gridColors, orientation, dots = this._getLampDots()) {
    // A Cube Matrix's spots in the colour the lamp lights them.
    const colors = this._orientedLayout(orientation).display(
      withSpotColours(gridColors, previewContext(this._lampAttributes()).lamp, "lamp"),
    );

    dots.forEach((dot, idx) => {
      const color = colors[idx] || "#000000";

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
    this._paintModules(gridColors, orientation, dots);
  }

  // A Cube Matrix's modules (matrix-modules.js moduleGrid): each dot
  // placed on the grid of its modules, those it has not left out, a spot one
  // round light over its area (its colour: _paintDots, withSpotColours).
  _paintModules(gridColors, orientation, dots) {
    const context = previewContext(this._lampAttributes());
    const layout = this._orientedLayout(orientation);
    const key = `${orientation}:${context.moduleKey}:${dots.length}`;
    if (!dots.length || this._modulesKey === key) return;
    this._modulesKey = key;
    const grid = contextGrid(context, layout.tall);
    const places = grid ? toDisplayOrder(grid.place, layout.tall) : [];
    dots.forEach((dot, index) => {
      const place = places[index];
      dot.style.display = place === null ? "none" : "";
      dot.style.gridColumn = place ? `${place.column}${place.span > 1 ? ` / span ${place.span}` : ""}` : "";
      dot.style.gridRow = place ? `${place.row}${place.span > 1 ? ` / span ${place.span}` : ""}` : "";
      dot.classList.toggle("lamp-dot-spot", !!place?.spot);
    });
  }

  // The card's lamp's attributes (its modules, its orientation).
  _lampAttributes() {
    const hass = this._hass ?? this.hass;
    return hass?.states?.[this._primaryEntity?.(hass)]?.attributes;
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

  // The preview's geometry for the lamp's device orientation: landscape, or
  // vertical when it stands on one end (Down / Up), and `display`, which turns
  // a lamp-order frame (matrix_colors, the clock and effect frames) the way
  // the viewer sees it, in the dots' order (matrix-view.js: the rule of every
  // preview and the cameras).
  _orientedLayout(orientation) {
    return orientedLayout(orientation);
  }

  // Container geometry of the matrix preview (shared by the Lit template and
  // the string renderer below).
  _matrixGeometry(stateObj) {
    const matrixBackground = this.config.matrix_background || "black";
    const matrixBoxShadow = this.config.matrix_box_shadow !== false;
    // The resolved appearance (preview-appearance.js; older settings included).
    const spacingMode = this.config.matrix_spacing_mode;
    const pixelGap = spacingMode === "normal" ? 4 : 0;
    const pixelStyle = this.config.matrix_pixel_style || "square";

    // Preview geometry follows the physical device orientation; the frame
    // is every preview's (matrix-frame.js), vertical at the same pixel size.
    const context = previewContext(stateObj?.attributes);
    const layout = this._orientedLayout(context.orientation);
    // A Cube Matrix's modules (matrix-modules.js): their columns at the same
    // dot size, a narrower frame.
    const modules = contextGrid(context, layout.tall);
    const size = this.config.size_pct || 100;
    const frame = matrixFrame({
      width: modules && !layout.tall ? `${(size * modules.columns) / 20}%` : `${size}%`,
      cols: modules?.cols,
      vertical: layout.tall,
      gap: pixelGap,
      padding: 8,
      radius: 12,
      background: matrixBackground,
      shadow: matrixBoxShadow,
    });
    const margin =
      this.config.align === "left" ? "0 auto" : this.config.align === "right" ? "auto 0" : "auto";
    return {
      layout,
      outerStyle: `${frame.wrapperStyle}margin-inline:${margin};`,
      gridStyle:
        // Pixel shape and dot shadow, read by .lamp-dot (lamp-preview-styles.js).
        `--lamp-dot-radius:${pixelStyle === "circle" ? "50%" : pixelStyle === "rounded" ? "20%" : "0px"};` +
        `--lamp-dot-shadow:${spacingMode === "subtle" || spacingMode === "normal" ? `0 0 ${frame.length(2)} #0008` : "none"};` +
        `aspect-ratio:auto;${frame.gridStyle}grid-template-rows: repeat(${modules ? modules.rows : layout.rows}, 1fr);`,
    };
  }

  // Lit matrix preview. The dots are keyed by the configuration generation
  // and the lamp's orientation (fresh nodes for a new look: _paintDots skips
  // colors a dot already has) and carry no bindings: _paintDots and the
  // animation loops own their colors. A dot fades to a new color (0.2 s):
  // kept across an orientation change, each would fade from what it showed
  // in the old layout, the picture seen a moment in the wrong place; fresh
  // dots are painted in place at once.
  _matrixTemplate(stateObj) {
    const { layout, outerStyle, gridStyle } =
      this._matrixGeometry(stateObj);
    // New dots for a new orientation or module list (_paintModules places them).
    const context = previewContext(stateObj?.attributes);
    const generation = (this._dotsKey =
      `${this._dotGeneration}:${context.orientation}:${context.moduleKey}`);
    const indices = Array.from(
      { length: layout.rows * layout.cols },
      (_, index) => index,
    );
    return html`<div style=${outerStyle}>
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
