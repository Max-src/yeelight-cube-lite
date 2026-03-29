import {
  applyBrightness,
  rgbToCss,
  renderDotMatrix,
} from "./yeelight-cube-dotmatrix.js";

// Minimal config editor for Lovelace UI
class YeelightCubeLetterMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this.innerHTML = `
      <div>
        <label>Lettermap Sensor Entity: <input id="lettermap_sensor" value="${
          config.lettermap_sensor || "sensor.yeelight_cube_letter_map"
        }" style="width: 320px;"></label>
      </div>
      <div style="font-size:12px;color:#888;margin-top:4px;">Example: sensor.yeelight_cube_letter_map</div>
    `;
    this.querySelector("#lettermap_sensor").addEventListener("input", (e) => {
      this._config.lettermap_sensor = e.target.value;
      this._updateConfig();
    });
  }
  _updateConfig() {
    const event = new Event("config-changed", {
      bubbles: true,
      composed: true,
    });
    event.detail = { config: this._config };
    this.dispatchEvent(event);
  }
  get config() {
    return this._config;
  }
}
customElements.define(
  "yeelight-cube-lettermap-card-editor",
  YeelightCubeLetterMapCardEditor,
);

class YeelightCubeLetterMapCard extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this.text = "A";
    this.previewStyle = false;
    this.selectedFont = "default";
    this._renderScheduled = false;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        .cube-input-label {
          font-size: 1.1em;
          font-weight: 500;
          margin-right: 12px;
          letter-spacing: 0.5px;
        }
        .cube-input {
          font-size: 1.2em;
          padding: 8px 14px;
          border-radius: 20px;
          border: 1px solid var(--primary-color, #03a9f4);
          outline: none;
          background: var(--card-background-color, #fafbfc);
          margin-right: 12px;
          transition: border-color 0.2s;
        }
        .cube-input:focus {
          border-color: var(--primary-color, #03a9f4);
          background: #fff;
        }
        .cube-btn {
          font-size: 1.1em;
          padding: 8px 22px;
          border-radius: 20px;
          border: none;
          background: var(--primary-color, #03a9f4);
          color: #fff;
          font-weight: 500;
          box-shadow: 0 1px 4px rgba(33,150,243,0.08);
          cursor: pointer;
          margin-left: 16px;
          transition: background 0.2s, box-shadow 0.2s;
        }
        .cube-btn:disabled {
          background: #bdbdbd;
          color: #eee;
          cursor: not-allowed;
          box-shadow: none;
        }
        .cube-btn:not(:disabled):hover {
          background: var(--primary-color, #2196f3);
          box-shadow: 0 2px 8px rgba(33,150,243,0.16);
        }
        .cube-checkbox-label {
          font-size: 1em;
          user-select: none;
          cursor: pointer;
          vertical-align: middle;
          display: flex;
          align-items: center;
          margin-left: 0;
        }
        .cube-checkbox {
          accent-color: var(--primary-color, #03a9f4);
          width: 18px;
          height: 18px;
          vertical-align: middle;
          margin-right: 6px;
        }
        .cube-controls {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .cube-actions {
          display: flex;
          align-items: center;
          margin-top: 18px;
          gap: 24px;
        }
        .cube-font-select {
          font-size: 1.1em;
          margin-left: 12px;
          padding: 6px 12px;
          border-radius: 12px;
          border: 1px solid var(--primary-color, #03a9f4);
          background: var(--card-background-color, #fafbfc);
        }
      </style>
      <ha-card header="Yeelight Cube Lite LetterMap">
        <div style="padding:16px;">
          <div class="cube-controls">
            <label class="cube-input-label" for="textinput">Text:</label>
            <input id="textinput" class="cube-input" type="text" maxlength="20" autocomplete="off" />
            <label class="cube-input-label" for="fontselect">Font:</label>
            <select id="fontselect" class="cube-font-select"></select>
          </div>
          <div id="svg-container" style="overflow-x:auto; margin-top:16px;"></div>
          <div class="cube-actions">
            <label class="cube-checkbox-label">
              <input type="checkbox" class="cube-checkbox" id="previewstyle" />
              Preview style
            </label>
            <button id="applybtn" class="cube-btn" title="Apply">Apply</button>
          </div>
        </div>
      </ha-card>
    `;
    this._bindEvents();
  }

  static async getConfigElement() {
    return document.createElement("yeelight-cube-lettermap-card-editor");
  }
  static getStubConfig() {
    return { type: "custom:yeelight-cube-lettermap-card" };
  }

  set hass(hass) {
    this._hass = hass;
    // Force palette sensor update on first render, fallback gracefully
    let paletteSensor =
      this.config.palette_sensor || "sensor.yeelight_cube_palettes_v2";
    const states = hass && hass.states ? hass.states : {};
    if (!this._paletteRefreshed) {
      // Try the configured sensor first
      if (paletteSensor in states) {
        hass.callService("homeassistant", "update_entity", {
          entity_id: paletteSensor,
        });
      } else if ("sensor.yeelight_cube_palettes_v2" in states) {
        // Fallback to v2 sensor if available
        paletteSensor = "sensor.yeelight_cube_palettes_v2";
        hass.callService("homeassistant", "update_entity", {
          entity_id: paletteSensor,
        });
      } // else: neither exists, do nothing (no warning)
      this._paletteRefreshed = true;
    }

    // --- Prevent auto-apply on palette/color change ---
    // Track palette sensor's relevant attributes, but do NOT auto-apply text
    if (!this._lastPaletteAttrs) this._lastPaletteAttrs = {};
    const paletteState = states[paletteSensor];
    if (paletteState && paletteState.attributes) {
      const attrs = paletteState.attributes;
      // Only track relevant color/gradient attributes
      const paletteAttrs = {
        rgb_color: JSON.stringify(attrs.rgb_color || []),
        background_color: JSON.stringify(attrs.background_color || []),
        text_colors: JSON.stringify(attrs.text_colors || []),
        gradient_start: JSON.stringify(attrs.gradient_start || []),
        gradient_end: JSON.stringify(attrs.gradient_end || []),
        mode: attrs.mode || "",
        // Add more if needed
      };
      this._lastPaletteAttrs = paletteAttrs;
    }

    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    }
  }

  _bindEvents() {
    this.shadowRoot
      .getElementById("textinput")
      .addEventListener("input", (e) => {
        this.text = e.target.value;
        this.render();
      });
    this.shadowRoot
      .getElementById("previewstyle")
      .addEventListener("change", (e) => {
        this.previewStyle = e.target.checked;
        this.render();
      });
    this.shadowRoot.getElementById("applybtn").addEventListener("click", () => {
      if (!this.text) return;
      if (!this._hass) return;
      this.shadowRoot.getElementById("applybtn").disabled = true;
      this._hass
        .callService("yeelight_cube", "set_custom_text", {
          text: this.text,
        })
        .finally(() => {
          this.shadowRoot.getElementById("applybtn").disabled = false;
        });
    });
    this.shadowRoot
      .getElementById("fontselect")
      .addEventListener("change", (e) => {
        this.selectedFont = e.target.value;
        this.render();
      });
  }

  render() {
    // --- Fix: Declare defaults for all style variables at the very top ---
    let brightness = 255;
    let dotColor = [0, 170, 255];
    let backgroundColor = [0, 0, 0];
    let mode = "Solid Color";
    let textColors = [];
    let alignment = "left";
    // ---
    if (!this._hass) return;
    const letterMapSensor =
      (this.config && this.config.lettermap_sensor) ||
      "sensor.yeelight_cube_letter_map";
    const hass = this._hass;
    if (!hass.states[letterMapSensor]) {
      this.shadowRoot.innerHTML = `<ha-card header="Letter Map"><div style="padding:16px;color:red;">Letter map sensor not found: <b>${letterMapSensor}</b><br>Example: <code>lettermap_sensor: sensor.yeelight_cube_letter_map</code></div></ha-card>`;
      return;
    }
    const stateObj = hass.states[letterMapSensor];
    let fontMaps = {};
    let fontKeys = ["default"];
    let letterMap = {};
    let selectedFont = this.selectedFont || "default";
    if (stateObj && stateObj.attributes.font_maps) {
      fontMaps = stateObj.attributes.font_maps;
      fontKeys = Object.keys(fontMaps);
      if (!fontKeys.includes(selectedFont)) selectedFont = fontKeys[0];
      letterMap = fontMaps[selectedFont] || {};
    } else if (stateObj && stateObj.attributes.letter_map) {
      letterMap = stateObj.attributes.letter_map;
      fontMaps = { default: letterMap };
      fontKeys = ["default"];
      selectedFont = "default";
    }

    // Update font dropdown
    let fontSelect = this.shadowRoot.getElementById("fontselect");
    if (fontSelect) {
      fontSelect.innerHTML = fontKeys
        .map(
          (k) =>
            `<option value="${k}"${
              k === selectedFont ? " selected" : ""
            }>${k}</option>`,
        )
        .join("");
      fontSelect.value = selectedFont;
    }
    this.selectedFont = selectedFont;

    if (stateObj) {
      brightness = stateObj.attributes.brightness ?? 255;
      dotColor = stateObj.attributes.rgb_color || [0, 170, 255];
      backgroundColor = stateObj.attributes.background_color || [0, 0, 0];
      mode = stateObj.attributes.mode || "Solid Color";
      textColors = stateObj.attributes.text_colors || textColors;
      alignment = stateObj.attributes.alignment || "left";
    }
    // Fallback for legacy gradient_start/gradient_end if text_colors not present
    if ((!textColors || textColors.length < 2) && stateObj) {
      const gradient_start = stateObj.attributes.gradient_start || [255, 0, 0];
      const gradient_end = stateObj.attributes.gradient_end || [0, 0, 255];
      textColors = [gradient_start, gradient_end];
    }

    const totalRows = 5;
    const totalCols = 20;
    const dotRadius = 7;
    const dotSpacing = 18;

    const text = this.text || "A";
    let gridColors = Array(totalRows * totalCols).fill(
      rgbToCss(applyBrightness(backgroundColor, brightness)),
    );

    if (this.previewStyle) {
      function interpolateColor(start, end, factor) {
        return [
          Math.round(start[0] + (end[0] - start[0]) * factor),
          Math.round(start[1] + (end[1] - start[1]) * factor),
          Math.round(start[2] + (end[2] - start[2]) * factor),
        ];
      }

      const rgb_color_b = applyBrightness(dotColor, brightness);
      const gradient_start_b = applyBrightness(textColors[0], brightness);
      const gradient_end_b = applyBrightness(
        textColors[textColors.length - 1],
        brightness,
      );

      let offset = 0;
      let totalTextWidth = 0;
      for (let i = 0; i < text.length; i++) {
        const letter = text[i];
        const letterPositions = letterMap[letter] || [];
        const cols = new Set(letterPositions.map((pos) => pos % totalCols));
        totalTextWidth += cols.size + 1;
      }
      totalTextWidth = Math.max(0, totalTextWidth - 1);

      if (alignment === "center") {
        offset = Math.floor((totalCols - totalTextWidth) / 2);
      } else if (alignment === "right") {
        offset = totalCols - totalTextWidth;
      }

      let currentOffset = offset;
      for (let i = 0; i < text.length; i++) {
        const letter = text[i];
        const letterPositions = letterMap[letter] || [];
        const cols = Array.from(
          new Set(letterPositions.map((pos) => pos % totalCols)),
        );
        const letterWidth = cols.length;

        let color = rgb_color_b;
        if (mode === "Solid Color") {
          color = rgb_color_b;
        } else if (mode === "Letter Gradient") {
          // Use all textColors for multi-stop gradient
          if (textColors.length > 2) {
            // Multi-stop: interpolate between stops
            const t = text.length > 1 ? i / (text.length - 1) : 0;
            const seg = 1 / (textColors.length - 1);
            const idx = Math.min(Math.floor(t / seg), textColors.length - 2);
            const localT = (t - idx * seg) / seg;
            const cStart = applyBrightness(textColors[idx], brightness);
            const cEnd = applyBrightness(textColors[idx + 1], brightness);
            color = interpolateColor(cStart, cEnd, localT);
          } else {
            color = interpolateColor(
              gradient_start_b,
              gradient_end_b,
              text.length > 1 ? i / (text.length - 1) : 0,
            );
          }
        }

        // --- Letter Angle Gradient ---
        if (mode === "Letter Angle Gradient") {
          let minCol = Math.min(
            ...letterPositions.map((pos) => (pos % totalCols) + currentOffset),
          );
          let angle = stateObj?.attributes?.angle || 0;
          let angleRad = (angle * Math.PI) / 180;
          let dx = Math.cos(angleRad);
          let dy = Math.sin(angleRad);
          let projections = [];
          for (let r = 0; r < totalRows; r++) {
            projections.push(0 * dx + r * dy);
            projections.push((letterWidth - 1) * dx + r * dy);
          }
          let minProj = Math.min(...projections);
          let maxProj = Math.max(...projections);
          for (const pos of letterPositions) {
            let row = Math.floor(pos / totalCols);
            let col = (pos % totalCols) + currentOffset;
            let localCol = col - minCol;
            let projection = localCol * dx + row * dy;
            let norm =
              Math.abs(maxProj - minProj) < 1e-6
                ? 0
                : (projection - minProj) / (maxProj - minProj);
            // Multi-stop support for angle gradient
            let gradIdx = 0;
            let gradNorm = norm;
            if (textColors.length > 2) {
              const seg = 1 / (textColors.length - 1);
              gradIdx = Math.min(Math.floor(norm / seg), textColors.length - 2);
              gradNorm = (norm - gradIdx * seg) / seg;
            }
            const cStart = applyBrightness(textColors[gradIdx], brightness);
            const cEnd = applyBrightness(
              textColors[Math.min(gradIdx + 1, textColors.length - 1)],
              brightness,
            );
            color = interpolateColor(cStart, cEnd, gradNorm);
            if (col >= 0 && col < totalCols && row >= 0 && row < totalRows) {
              let idx = row * totalCols + col;
              gridColors[idx] = rgbToCss(color);
            }
          }
        } else if (mode === "Letter Vertical Gradient") {
          // For each column in the letter, compute gradient color and apply to all pixels in that column
          const sortedCols = [...cols].sort((a, b) => a - b);
          for (let colIdx = 0; colIdx < letterWidth; colIdx++) {
            let factor = letterWidth > 1 ? colIdx / (letterWidth - 1) : 0;
            let colColor = interpolateColor(
              gradient_start_b,
              gradient_end_b,
              factor,
            );
            // Find all positions in this column
            for (const pos of letterPositions) {
              let row = Math.floor(pos / totalCols);
              let col = (pos % totalCols) + currentOffset;
              // Which column of the letter is this?
              let localCol = pos % totalCols;
              if (
                sortedCols[colIdx] === localCol &&
                col >= 0 &&
                col < totalCols &&
                row >= 0 &&
                row < totalRows
              ) {
                let idx = row * totalCols + col;
                gridColors[idx] = rgbToCss(colColor);
              }
            }
          }
        } else {
          for (const pos of letterPositions) {
            let row = Math.floor(pos / totalCols);
            let col = (pos % totalCols) + currentOffset;
            if (col >= 0 && col < totalCols && row >= 0 && row < totalRows) {
              let idx = row * totalCols + col;
              if (mode === "Column Gradient") {
                let factor = col / (totalCols - 1);
                color = interpolateColor(
                  gradient_start_b,
                  gradient_end_b,
                  factor,
                );
              } else if (mode === "Row Gradient") {
                let factor = row / (totalRows - 1);
                color = interpolateColor(
                  gradient_start_b,
                  gradient_end_b,
                  factor,
                );
              } else if (mode === "Angle Gradient") {
                let angle = stateObj?.attributes?.angle || 0;
                let angleRad = (angle * Math.PI) / 180;
                let dx = Math.cos(angleRad);
                let dy = Math.sin(angleRad);
                let gridDiag = Math.sqrt(
                  (totalCols - 1) ** 2 + (totalRows - 1) ** 2,
                );
                let projection = col * dx + row * dy;
                let normalized = (projection + gridDiag / 2) / gridDiag;
                color = interpolateColor(
                  gradient_start_b,
                  gradient_end_b,
                  normalized,
                );
              }
              gridColors[idx] = rgbToCss(color);
            }
          }
        }
        currentOffset += letterWidth + 1;
      }
    } else {
      let positions = [];
      let offset = 0;
      for (let i = 0; i < text.length; i++) {
        const letter = text[i];
        const letterPositions = letterMap[letter] || [];
        const cols = new Set(letterPositions.map((pos) => pos % totalCols));
        for (const pos of letterPositions) {
          let row = Math.floor(pos / totalCols);
          let col = (pos % totalCols) + offset;
          if (col < totalCols) positions.push(row * totalCols + col);
        }
        offset += cols.size + 1;
        if (offset >= totalCols) break;
      }
      const activeColor = rgbToCss(applyBrightness(dotColor, brightness));
      for (const pos of positions) {
        if (pos >= 0 && pos < gridColors.length) gridColors[pos] = activeColor;
      }
    }

    // Only update values and SVG, not the whole DOM
    const inputElem = this.shadowRoot.getElementById("textinput");
    if (inputElem) {
      inputElem.value = text;
    }
    const previewCheckbox = this.shadowRoot.getElementById("previewstyle");
    if (previewCheckbox) {
      previewCheckbox.checked = this.previewStyle;
    }
    const applyBtn = this.shadowRoot.getElementById("applybtn");
    if (applyBtn) {
      applyBtn.disabled = !text;
    }
    fontSelect = this.shadowRoot.getElementById("fontselect");
    if (fontSelect) {
      fontSelect.value = selectedFont;
    }
    const svgContainer = this.shadowRoot.getElementById("svg-container");
    if (svgContainer) {
      // Flip Y axis for correct orientation
      const flippedColors = [];
      for (let row = 0; row < totalRows; row++) {
        for (let col = 0; col < totalCols; col++) {
          const flippedRow = totalRows - 1 - row;
          flippedColors.push(gridColors[flippedRow * totalCols + col]);
        }
      }
      svgContainer.innerHTML = renderDotMatrix({
        totalRows,
        totalCols,
        dotRadius,
        dotSpacing,
        gridColors: flippedColors,
        background: "black",
      });
    }
  }

  getCardSize() {
    return 6;
  }
}

customElements.define(
  "yeelight-cube-lettermap-card",
  YeelightCubeLetterMapCard,
);

// Register for Lovelace "Add Card" UI
window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-lettermap-card",
  name: "Yeelight Cube Lite Letter Map",
  description: "Show a letter map for your Yeelight Cube Lite.",
});
