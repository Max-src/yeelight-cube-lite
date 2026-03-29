import {
  applyBrightness,
  rgbToCss,
  renderDotMatrix,
} from "./yeelight-cube-dotmatrix.js";

// Debounce time for angle updates (ms)
let ANGLE_UPDATE_DEBOUNCE_MS = 50;

class YeelightCubeAngleGradientCard extends HTMLElement {
  constructor() {
    super();
    this._pendingAngle = null;
    this._angleDebounceTimer = null;
    this._lastAngleSent = null;
    this._renderScheduled = false;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("You need to define an entity");
    }
    this.config = config;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        if (!this.shadowRoot) {
          this._createCard();
        } else {
          this._updateCard();
        }
      });
    }
  }

  get hass() {
    return this._hass;
  }

  _createCard() {
    this.attachShadow({ mode: "open" });
    this._updateCard();
  }

  _updateCard() {
    if (!this.config || !this._hass) return;
    const entityId = this.config.entity;
    const stateObj = this._hass.states[entityId];
    if (!stateObj) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;">Entity not found: ${entityId}</div></ha-card>`;
      return;
    }

    // Get text colors from entity attributes
    const textColors = this._getCurrentTextColors();

    // Get angle from entity or config
    let angle = parseInt(stateObj.attributes.angle) || this.config.angle || 0;

    this._renderCard(angle, textColors);
  }

  _renderCard(angle, textColors) {
    const entityId = this.config.entity;
    const stateObj = this._hass.states[entityId];
    const brightness = parseInt(stateObj.attributes.brightness) || 100;

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .angle-control {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
          width: 100%;
          max-width: 400px;
        }
        #angleslider {
          flex: 1;
        }
        #angleinput {
          width: 60px;
          text-align: center;
        }
        .preview-canvas {
          cursor: pointer;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
      </style>
      <ha-card>
        <div class="angle-control">
          <label>Angle:</label>
          <input type="range" id="angleslider" min="0" max="359" value="${angle}" />
          <input type="number" id="angleinput" min="0" max="359" value="${angle}" />
        </div>
        <canvas class="preview-canvas" id="preview" width="400" height="100"></canvas>
      </ha-card>
    `;

    // Add event listeners
    const angleInput = this.shadowRoot.getElementById("angleinput");
    const angleSlider = this.shadowRoot.getElementById("angleslider");
    const canvas = this.shadowRoot.getElementById("preview");

    angleInput?.addEventListener("input", (e) => {
      let val = parseInt(e.target.value) || 0;
      if (val < 0) val = 0;
      if (val > 359) val = 359;
      e.target.value = val;
      if (angleSlider) angleSlider.value = val;
      this._drawAnglePreviewMulti(val, textColors);
      this._debouncedApplyAngle(val);
    });

    angleSlider?.addEventListener("input", (e) => {
      const val = parseInt(e.target.value) || 0;
      if (angleInput) angleInput.value = val;
      this._drawAnglePreviewMulti(val, textColors);
      this._debouncedApplyAngle(val);
    });

    canvas?.addEventListener("mousedown", (e) => this._startRotaryDrag(e));
    canvas?.addEventListener("mousemove", (e) => this._rotaryDrag(e));
    canvas?.addEventListener("mouseup", () => this._endRotaryDrag());
    canvas?.addEventListener("mouseleave", () => this._endRotaryDrag());

    // Initial preview draw
    this._drawAnglePreviewMulti(angle, textColors);
  }

  // Always get the current textColors from the entity state
  _getCurrentTextColors() {
    const entityId = this.config?.entity;
    const hass = this._hass;
    if (hass && entityId && hass.states[entityId]) {
      const stateObj = hass.states[entityId];
      return (
        stateObj.attributes.text_colors || [
          [255, 0, 0],
          [0, 0, 255],
        ]
      );
    }
    return [
      [255, 0, 0],
      [0, 0, 255],
    ];
  }

  // Draw angle preview on canvas with multi-stop gradient
  _drawAnglePreviewMulti(angle, stops) {
    const canvas = this.shadowRoot.getElementById("preview");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    // Clear canvas
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, w, h);

    // Draw the 20x5 matrix preview with the angle gradient applied
    const cols = 20,
      rows = 5;
    const cellW = w / cols;
    const cellH = h / rows;
    const gap = 2;
    const theta = (angle * Math.PI) / 180;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);

    // Compute projection range
    let minProj = Infinity,
      maxProj = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const proj = c * dx + r * dy;
        if (proj < minProj) minProj = proj;
        if (proj > maxProj) maxProj = proj;
      }
    }
    const projRange = maxProj - minProj || 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const proj = c * dx + r * dy;
        const norm = (proj - minProj) / projRange;

        // Interpolate between gradient stops
        let color;
        if (!stops || stops.length === 0) {
          color = [255, 0, 0];
        } else if (stops.length === 1) {
          color = stops[0];
        } else {
          const seg = 1 / (stops.length - 1);
          const idx = Math.min(Math.floor(norm / seg), stops.length - 2);
          const localT = (norm - idx * seg) / seg;
          const s = stops[idx];
          const e = stops[Math.min(idx + 1, stops.length - 1)];
          color = [
            Math.round(s[0] + (e[0] - s[0]) * localT),
            Math.round(s[1] + (e[1] - s[1]) * localT),
            Math.round(s[2] + (e[2] - s[2]) * localT),
          ];
        }

        ctx.fillStyle = this._rgbToHex(color);
        ctx.beginPath();
        ctx.arc(
          c * cellW + cellW / 2,
          r * cellH + cellH / 2,
          Math.min(cellW, cellH) / 2 - gap,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Draw angle indicator arrow
    const cx = w / 2,
      cy = h / 2;
    const arrowLen = Math.min(w, h) * 0.35;
    const x2 = cx + arrowLen * Math.cos(theta);
    const y2 = cy - arrowLen * Math.sin(theta);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead
    const headLen = 8;
    const headAngle = Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(-theta + headAngle),
      y2 + headLen * Math.sin(-theta + headAngle),
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(-theta - headAngle),
      y2 + headLen * Math.sin(-theta - headAngle),
    );
    ctx.stroke();
  }

  _startRotaryDrag(e) {
    this._isDragging = true;
    this._handleRotaryDrag(e);
  }

  _rotaryDrag(e) {
    if (!this._isDragging) return;
    this._handleRotaryDrag(e);
  }

  _endRotaryDrag() {
    this._isDragging = false;
  }

  _debouncedApplyAngle(angle) {
    this._pendingAngle = Math.round(angle);
    if (this._angleDebounceTimer) clearTimeout(this._angleDebounceTimer);
    this._angleDebounceTimer = setTimeout(() => {
      if (
        this._pendingAngle !== null &&
        this._pendingAngle !== this._lastAngleSent
      ) {
        this._applyAngle(this._pendingAngle);
        this._lastAngleSent = this._pendingAngle;
      }
    }, ANGLE_UPDATE_DEBOUNCE_MS);
  }

  _applyAngle(angle) {
    const entityId = this.config.entity;
    if (!entityId || !this._hass) return;
    this._hass.callService("yeelight_cube", "set_angle", {
      entity_id: entityId,
      angle: Math.round(angle),
    });
  }

  _hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length !== 6) return [255, 255, 255];
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16),
    ];
  }
  _rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? "0" + hex : hex;
        })
        .join("")
    );
  }

  _handleRotaryDrag(e) {
    const canvas = this.shadowRoot.getElementById("preview");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const x = e.clientX - cx;
    const y = cy - e.clientY; // <-- invert Y axis for interaction
    let angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    // Update both input and slider, and preview
    const angleInput = this.shadowRoot.getElementById("angleinput");
    const angleSlider = this.shadowRoot.getElementById("angleslider");
    if (angleInput) angleInput.value = Math.round(angle);
    if (angleSlider) angleSlider.value = Math.round(angle);
    // Always use the current textColors from the entity for preview
    this._drawAnglePreviewMulti(angle, this._getCurrentTextColors());
    this._debouncedApplyAngle(angle);
  }

  getCardSize() {
    return 6;
  }
}

customElements.define(
  "yeelight-cube-angle-gradient-card",
  YeelightCubeAngleGradientCard,
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-angle-gradient-card",
  name: "Yeelight Cube Lite Angle Gradient",
  description:
    "Visualize and set the angle and colors for your angle gradient.",
});
