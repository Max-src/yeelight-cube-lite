// Mode selector of the gradient card, through the shared gallery
// (collection-gallery.js, used the same way as the Clock and Native Effects
// cards): this mixin only supplies the gradient modes as gallery items, with
// their live previews (computed by the backend, cached and shared by every
// card in gradient-preview-store.js) or their chip swatches. Mixed into
// YeelightCubeGradientCard.
import { gradientPreviewStore } from "./gradient-preview-store.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { PREVIEW_SELECTOR_STYLES } from "./selector-shared-styles.js";
import { html } from "./lib/lit-all.js";
import "./collection-gallery.js";

// Short button labels (filled, chips) of the modes.
const MODE_LABELS = {
  "Solid Color": "Solid",
  "Letter Gradient": "Letter Grad",
  "Column Gradient": "Column Grad",
  "Row Gradient": "Row Grad",
  "Angle Gradient": "Angle Grad",
  "Radial Gradient": "Radial Grad",
  "Letter Vertical Gradient": "Letter Vert",
  "Letter Angle Gradient": "Letter Angle",
  "Text Color Sequence": "Color Seq",
};

export const ModeSelectorMixin = (Base) => class extends Base {
  /** The shared gallery, declared like on the Clock and Native cards. */
  _galleryTemplate() {
    return html`<yc-collection-gallery
      .config=${this.config}
      .items=${this._galleryItems()}
      .active=${this._getCurrentMode()}
      .disabled=${this._processingModeChange}
      searchLabel="Search modes"
      actionLabel="Show on the lamp"
      .onSelect=${(mode) => this._selectMode(mode)}
    ></yc-collection-gallery>`;
  }

  /**
   * Hand the gallery the current items and active mode. This card renders
   * its skeleton once per structure and syncs state in place
   * (_syncDynamicUI), so state changes reach the gallery here rather than
   * through a template re-render. `angle`: the angle being dragged (chip
   * swatches follow it live).
   */
  _refreshGallery(angle) {
    const gallery = this.shadowRoot?.querySelector("yc-collection-gallery");
    if (!gallery) return;
    gallery.config = this.config;
    gallery.items = this._galleryItems(angle);
    gallery.active = this._getCurrentMode();
    gallery.disabled = this._processingModeChange;
  }

  /**
   * The visible modes as gallery items. Text styles list every mode (chips
   * with a swatch of its gradient); preview styles list the modes whose
   * preview has arrived, flipped to the lamp's orientation.
   */
  _galleryItems(angle) {
    const modes = this._orderedModes();
    const item = (mode) => ({
      dataMode: mode,
      name: mode,
      title: mode.replace(" Gradient", ""),
      label: MODE_LABELS[mode] || mode,
    });
    const style = this._getModeSelectorStyle();
    if (!PREVIEW_SELECTOR_STYLES.includes(style)) {
      if (style !== "chips") return modes.map(item);
      const colors = this._getCurrentTextColors();
      const stateObj = this._hass?.states?.[this._getPrimaryEntity()];
      const current = angle ?? (stateObj ? this._displayAngle(stateObj) : 0);
      return modes.map((mode) => ({
        ...item(mode),
        swatch: this._modeSwatch(mode, colors, current),
      }));
    }
    const data = this._previewCache().data;
    if (!data) return [];
    const rows = data.rows || 5;
    const cols = data.cols || 20;
    return modes
      .filter((mode) => data.previews[mode])
      .map((mode) => {
        const colors = data.previews[mode];
        // The backend sends the rows bottom-up.
        const colorData = [];
        for (let row = rows - 1; row >= 0; row--)
          for (let col = 0; col < cols; col++)
            colorData.push(colors[row * cols + col]);
        return { ...item(mode), colorData };
      });
  }

  // A chip's swatch: Text Color Sequence as a pie of up to 4 colors (its
  // randomness), every other mode as its gradient.
  _modeSwatch(mode, colors, angle) {
    if (mode !== "Text Color Sequence")
      return this.getModeGradientColors(mode, colors, angle);
    const stops = colors.slice(0, 4);
    while (stops.length < 4) stops.push(stops[stops.length - 1] || [200, 200, 200]);
    const pct = 100 / stops.length;
    return `conic-gradient(${stops
      .map((color, i) => `${rgbToCss(color)} ${i * pct}% ${(i + 1) * pct}%`)
      .join(", ")})`;
  }

  /** Previews are needed: subscribe, and load them unless recent. */
  _ensurePreviews() {
    if (!this._isPreviewSelectorActive()) return;
    if (!this._previewEventListenerRegistered) this._setupPreviewEventListener();
    const cache = this._previewCache();
    if (!(cache.data && Date.now() - cache.timestamp < 5000)) this._loadPreviews();
  }

  async _loadPreviews() {
    if (!this.isConnected) return;
    // Preview data is only needed when the mode selector uses a preview style.
    // Text-style selectors skip the backend preview service entirely.
    if (!this._isPreviewSelectorActive()) return;

    // Ensure event subscription is active before requesting preview data
    if (!this._previewEventListenerRegistered && this._hass) {
      this._setupPreviewEventListener();
    }

    const entityId = this._getPrimaryEntity();
    if (!this._hass || !entityId) return;
    const context = this._previewContext;

    try {
      await gradientPreviewStore(this._hass.connection).request(
        this._hass,
        entityId,
      );
      if (context !== this._previewContext || !this.isConnected) return;

      // Reset retry counter on success
      this._previewRetryCount = 0;
    } catch (error) {
      if (context !== this._previewContext || !this.isConnected) return;
      // During HA startup, the light platform services may not be registered yet.
      // Also handle transient connection-lost errors.
      const errorCode = error?.code || error?.error?.code;
      const isTransient =
        errorCode === "not_found" ||
        errorCode === 3 ||
        errorCode === "connection-lost";
      if (isTransient) {
        const retryCount = (this._previewRetryCount || 0) + 1;
        this._previewRetryCount = retryCount;
        if (retryCount <= 5) {
          const delay = Math.min(retryCount * 2000, 10000); // 2s, 4s, 6s, 8s, 10s
          // Tracked + isConnected-guarded so a removed card stops retrying.
          if (this._previewRetryTimer) clearTimeout(this._previewRetryTimer);
          this._previewRetryTimer = setTimeout(() => {
            this._previewRetryTimer = null;
            if (!this.isConnected) return;
            this._loadPreviews();
          }, delay);
        } else {
          console.warn(
            "[Gradient Card] Preview load still failing after 5 retries. " +
              "Check device connectivity.",
          );
        }
        return;
      }
      console.error("[Gradient Card] Error loading previews:", error);
    }
  }

  _previewCache() {
    if (!this._hass?.connection) {
      return (this._emptyPreviewCache ||= {
        data: null,
        timestamp: 0,
        responseHash: null,
      });
    }
    return gradientPreviewStore(this._hass.connection).cache(
      this._getPrimaryEntity(),
    );
  }

  _setupPreviewEventListener() {
    if (
      this._previewEventListenerRegistered ||
      !this._hass?.connection ||
      !this.isConnected
    )
      return;
    // No subscription needed when the selector doesn't render previews
    if (!this._isPreviewSelectorActive()) return;

    this._previewEventListenerRegistered = true;

    this._unsubscribePreviewEvents = gradientPreviewStore(
      this._hass.connection,
    ).subscribe(this._getPrimaryEntity(), () => {
      if (!this.isConnected) return;

      // New previews: the gallery repaints them in place.
      this._refreshGallery();

      // Fresh preview data arrived — if text preview mode is active and we are
      // NOT mid-drag, force the exact same path as toggling the "Show Text
      // Preview" switch: a synchronous this._renderCard() that rebuilds the full DOM
      // from the now-fresh cache.  Previous attempts using requestAnimationFrame
      // were silently blocked by the _renderScheduled guard when a set-hass
      // render was already queued.
      if (
        this.config?.matrix_rotary_text_preview === true &&
        !this._draggingRotary
      ) {
        this._renderScheduled = false; // clear any pending guard
        this._renderCard(); // full DOM rebuild from fresh cache
      }
    });
  }

  getModeGradientColors(mode, textColors, currentAngle) {
    // Use default colors if none provided
    const colors =
      textColors && textColors.length > 0
        ? textColors
        : [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
          ];

    // Helper function to replicate Python's calculate_multi_gradient_color
    const calculateMultiGradientColor = (colors, position, totalPositions) => {
      if (!colors || colors.length === 0) return [255, 0, 0];
      if (colors.length === 1 || totalPositions <= 1) return colors[0];

      position = Math.max(0, Math.min(position, totalPositions - 1));
      const nSegments = colors.length - 1;
      const segmentLength =
        nSegments > 0 ? (totalPositions - 1) / nSegments : 1;
      const segment = Math.min(
        Math.floor(position / segmentLength),
        nSegments - 1,
      );

      const startColor = colors[segment];
      const endColor = colors[Math.min(segment + 1, colors.length - 1)];

      const localStart = segment * segmentLength;
      const localFactor =
        segmentLength > 0 ? (position - localStart) / segmentLength : 0;

      return [
        Math.round(startColor[0] + (endColor[0] - startColor[0]) * localFactor),
        Math.round(startColor[1] + (endColor[1] - startColor[1]) * localFactor),
        Math.round(startColor[2] + (endColor[2] - startColor[2]) * localFactor),
      ];
    };

    // RGB arrays are converted with the hardened shared rgbToCss
    // (./yeelight-cube-dotmatrix.js), which clamps every channel.

    // Create deterministic "random" based on colors array to avoid constant changes
    const colorHash = colors.map((c) => c.join(",")).join("|");
    let seed = 0;
    for (let i = 0; i < colorHash.length; i++) {
      seed = ((seed << 5) - seed + colorHash.charCodeAt(i)) & 0xffffffff;
    }

    // Simple deterministic random function
    const deterministicRandom = (index) => {
      const x = Math.sin(seed + index * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Create mini-preview gradients that replicate the actual mode calculations
    switch (mode) {
      case "Solid Color":
        // Use first color only
        return rgbToCss(colors[0]);

      case "Letter Gradient":
        // Each letter gets a different color - show discrete steps, not smooth gradient
        if (colors.length === 1) return rgbToCss(colors[0]);
        const letterSteps = colors
          .map((color, i) => {
            const startPercent = (i / colors.length) * 100;
            const endPercent = ((i + 1) / colors.length) * 100;
            return `${rgbToCss(color)} ${startPercent}% ${endPercent}%`;
          })
          .join(", ");
        return `linear-gradient(90deg, ${letterSteps})`;

      case "Column Gradient":
        // Vertical columns get gradient - show vertical gradient
        const colGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 columns
          const color = calculateMultiGradientColor(colors, i, 10);
          colGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(90deg, ${colGradient.join(", ")})`;

      case "Row Gradient":
        // Horizontal rows get gradient - show horizontal gradient
        const rowGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 rows
          const color = calculateMultiGradientColor(colors, i, 10);
          rowGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(0deg, ${rowGradient.join(", ")})`;

      case "Angle Gradient":
        // Directional gradient based on current angle setting
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const angleDeg = -(currentAngle || 0) + 90;
        const angleGradient = [];
        for (let i = 0; i < colors.length; i++) {
          angleGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(${angleDeg}deg, ${angleGradient.join(", ")})`;

      case "Radial Gradient":
        // Radial from center outward
        const radialGradient = [];
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          const distance = i / (steps - 1);
          const color = calculateMultiGradientColor(
            colors,
            distance * (colors.length - 1),
            colors.length,
          );
          radialGradient.push(`${rgbToCss(color)} ${(i / (steps - 1)) * 100}%`);
        }
        return `radial-gradient(circle, ${radialGradient.join(", ")})`;

      case "Letter Vertical Gradient":
        // Vertical gradient within each letter - columns get different colors (left to right)
        const letterVertGradient = [];
        for (let i = 0; i < colors.length; i++) {
          letterVertGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(90deg, ${letterVertGradient.join(", ")})`;

      case "Letter Angle Gradient":
        // Angle gradient within each letter using current angle setting
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const letterAngleGrad = [];
        for (let i = 0; i < colors.length; i++) {
          letterAngleGrad.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        const letterAngle = -(currentAngle || 0) + 90;
        return `linear-gradient(${letterAngle}deg, ${letterAngleGrad.join(
          ", ",
        )})`;

      case "Text Color Sequence":
        // Random/shuffled colors - create discrete color blocks that fill the button
        if (colors.length === 1) return rgbToCss(colors[0]);

        // Create a checkerboard pattern of color squares using CSS patterns
        // Simple approach: create alternating color stripes in both directions

        // Pick 4 random colors for a 2x2 repeating pattern
        const patternColors = [];
        for (let i = 0; i < 4; i++) {
          const randomValue = deterministicRandom(i);
          const randomColorIndex = Math.floor(randomValue * colors.length);
          patternColors.push(colors[randomColorIndex]);
        }

        // Create horizontal stripes (rows)
        const verticalStripes = `repeating-linear-gradient(90deg, 
          ${rgbToCss(patternColors[2])} 0%, ${rgbToCss(patternColors[2])} 25%, 
          ${rgbToCss(patternColors[3])} 25%, ${rgbToCss(patternColors[3])} 50%,
          ${rgbToCss(patternColors[0])} 50%, ${rgbToCss(patternColors[0])} 75%,
          ${rgbToCss(patternColors[1])} 75%, ${rgbToCss(
            patternColors[1],
          )} 100%)`;

        // Combine both to create a grid effect
        return verticalStripes;

      default:
        return rgbToCss(colors[0]);
    }
  }
};
