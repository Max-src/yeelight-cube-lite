/**
 * Yeelight Cube Color Calibration Card (DEBUG / DEVELOPMENT ONLY)
 *
 * Provides sliders to tune all three correction/brightness systems at runtime:
 *   System 1 — Low-brightness gamma correction (per-channel inverse gamma)
 *   System 2 — Monitor-matching gain (per-channel multiplier)
 *   System 3 — Brightness curve (transition point, HW limits, darken curve)
 *
 * Changes are applied immediately via the set_color_calibration service.
 * Values are NOT persisted across HA restarts — copy the final numbers
 * into light.py when you're happy with them.
 */

const DOMAIN = "yeelight_cube";
const SERVICE = "set_color_calibration";

class YeelightCubeCalibrationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._entity = null;
    this._debounceTimers = {};
  }

  setConfig(config) {
    if (!config.entity) throw new Error("You need to define an entity");
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config.entity) {
      const newState = hass.states[this._config.entity];
      if (newState && newState !== this._entity) {
        this._entity = newState;
        this._syncSlidersFromState();
      }
    }
  }

  static getStubConfig() {
    return { entity: "" };
  }

  // ── Defaults (matching light.py) ──────────────────────────────────
  static get DEFAULTS() {
    return {
      // System 1: Gamma correction
      gamma_r: 0.85,
      gamma_g: 0.75,
      gamma_b: 0.65,
      hw_threshold: 50,
      hw_full: 10,
      channel_balance: 0.7,
      // System 2: Gain accuracy
      gain_r: 1.0,
      gain_g: 1.0,
      gain_b: 1.0,
      // System 3: Brightness curve
      brightness_transition: 25,
      min_hw_brightness: 1,
      max_hw_brightness: 100,
      max_darken: 97,
      min_darken: 0,
      dark_at_20: 85,
      dark_at_50: 70,
      dark_at_80: 40,
      low_min_darken: 95,
    };
  }

  // ── Slider definitions ────────────────────────────────────────────
  static get SLIDERS() {
    return [
      // System 1: Gamma correction
      {
        key: "gamma_r",
        label: "Gamma R",
        min: 0.1,
        max: 1.0,
        step: 0.01,
        color: "#ff4444",
        system: 1,
      },
      {
        key: "gamma_g",
        label: "Gamma G",
        min: 0.1,
        max: 1.0,
        step: 0.01,
        color: "#44cc44",
        system: 1,
      },
      {
        key: "gamma_b",
        label: "Gamma B",
        min: 0.1,
        max: 1.0,
        step: 0.01,
        color: "#4488ff",
        system: 1,
      },
      {
        key: "hw_threshold",
        label: "HW Threshold",
        min: 10,
        max: 100,
        step: 1,
        color: "#aaa",
        system: 1,
      },
      {
        key: "hw_full",
        label: "HW Full",
        min: 1,
        max: 50,
        step: 1,
        color: "#888",
        system: 1,
      },
      {
        key: "channel_balance",
        label: "Channel Balance",
        min: 0.0,
        max: 1.0,
        step: 0.05,
        color: "#cc88ff",
        system: 1,
      },
      // System 2: Gain accuracy
      {
        key: "gain_r",
        label: "Gain R",
        min: 0.5,
        max: 1.5,
        step: 0.01,
        color: "#ff4444",
        system: 2,
      },
      {
        key: "gain_g",
        label: "Gain G",
        min: 0.5,
        max: 1.5,
        step: 0.01,
        color: "#44cc44",
        system: 2,
      },
      {
        key: "gain_b",
        label: "Gain B",
        min: 0.5,
        max: 1.5,
        step: 0.01,
        color: "#4488ff",
        system: 2,
      },
      // System 3: Brightness curve
      {
        key: "brightness_transition",
        label: "Transition Pt",
        min: 5,
        max: 80,
        step: 1,
        color: "#ffaa00",
        system: 3,
      },
      {
        key: "min_hw_brightness",
        label: "Min HW Bright",
        min: 1,
        max: 50,
        step: 1,
        color: "#cc8800",
        system: 3,
      },
      {
        key: "max_hw_brightness",
        label: "Max HW Bright",
        min: 50,
        max: 100,
        step: 1,
        color: "#ffcc44",
        system: 3,
      },
      {
        key: "max_darken",
        label: "Max Darken %",
        min: 50,
        max: 100,
        step: 1,
        color: "#9966cc",
        system: 3,
      },
      {
        key: "min_darken",
        label: "Min Darken %",
        min: 0,
        max: 50,
        step: 1,
        color: "#bb88ee",
        system: 3,
      },
      {
        key: "dark_at_20",
        label: "Dark @20%",
        min: 0,
        max: 100,
        step: 1,
        color: "#7799cc",
        system: 3,
      },
      {
        key: "dark_at_50",
        label: "Dark @50%",
        min: 0,
        max: 100,
        step: 1,
        color: "#5588bb",
        system: 3,
      },
      {
        key: "dark_at_80",
        label: "Dark @80%",
        min: 0,
        max: 100,
        step: 1,
        color: "#3377aa",
        system: 3,
      },
      {
        key: "low_min_darken",
        label: "Low Min Dark",
        min: 0,
        max: 100,
        step: 1,
        color: "#dd6688",
        system: 3,
      },
    ];
  }

  _syncSlidersFromState() {
    if (!this._entity || !this.shadowRoot) return;
    const attrs = this._entity.attributes || {};
    const D = YeelightCubeCalibrationCard.DEFAULTS;
    for (const s of YeelightCubeCalibrationCard.SLIDERS) {
      const attrKey = `calib_${s.key}`;
      const val = attrs[attrKey] !== undefined ? attrs[attrKey] : D[s.key];
      const slider = this.shadowRoot.getElementById(`slider-${s.key}`);
      const display = this.shadowRoot.getElementById(`val-${s.key}`);
      if (slider && Math.abs(parseFloat(slider.value) - val) > 0.001) {
        slider.value = val;
      }
      if (display)
        display.textContent = Number.isInteger(val) ? val : val.toFixed(2);
    }
    // Update info bar
    const hwEl = this.shadowRoot.getElementById("hw-brightness");
    const brEl = this.shadowRoot.getElementById("ha-brightness");
    const dkEl = this.shadowRoot.getElementById("current-darken");
    if (hwEl) hwEl.textContent = attrs.last_hardware_brightness ?? "?";
    if (brEl) {
      const b = attrs.brightness;
      brEl.textContent =
        b !== undefined ? `${b} (${Math.round(b / 2.55)}%)` : "?";
    }
    if (dkEl) {
      const dk = attrs.preview_darken;
      dkEl.textContent = dk !== undefined ? `${dk}%` : "?";
    }
  }

  _callService(key, value) {
    if (!this._hass) return;
    this._hass.callService(DOMAIN, SERVICE, {
      [key]: value,
      entity_id: this._config.entity,
    });
  }

  _onSliderInput(key, value, step) {
    // Update display immediately
    const display = this.shadowRoot.getElementById(`val-${key}`);
    if (display) {
      const v = parseFloat(value);
      display.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    }
    // Debounce service call (150ms)
    clearTimeout(this._debounceTimers[key]);
    this._debounceTimers[key] = setTimeout(() => {
      this._callService(key, parseFloat(value));
    }, 150);
  }

  _resetAll() {
    if (!this._hass) return;
    const D = YeelightCubeCalibrationCard.DEFAULTS;
    this._hass.callService(DOMAIN, SERVICE, {
      ...D,
      entity_id: this._config.entity,
    });
    // Update all sliders locally too
    for (const s of YeelightCubeCalibrationCard.SLIDERS) {
      const slider = this.shadowRoot.getElementById(`slider-${s.key}`);
      const display = this.shadowRoot.getElementById(`val-${s.key}`);
      if (slider) slider.value = D[s.key];
      if (display)
        display.textContent =
          s.step < 1 ? D[s.key].toFixed(2) : String(D[s.key]);
    }
  }

  _resetSystem(systemNum) {
    if (!this._hass) return;
    const D = YeelightCubeCalibrationCard.DEFAULTS;
    const data = { entity_id: this._config.entity };
    for (const s of YeelightCubeCalibrationCard.SLIDERS) {
      if (s.system === systemNum) {
        data[s.key] = D[s.key];
        const slider = this.shadowRoot.getElementById(`slider-${s.key}`);
        const display = this.shadowRoot.getElementById(`val-${s.key}`);
        if (slider) slider.value = D[s.key];
        if (display)
          display.textContent =
            s.step < 1 ? D[s.key].toFixed(2) : String(D[s.key]);
      }
    }
    this._hass.callService(DOMAIN, SERVICE, data);
  }

  _copyValues() {
    const D = YeelightCubeCalibrationCard.DEFAULTS;
    const lines = [];
    const systemLabels = {
      1: "# System 1: Gamma correction",
      2: "# System 2: Gain accuracy",
      3: "# System 3: Brightness curve",
    };
    let lastSys = 0;
    for (const s of YeelightCubeCalibrationCard.SLIDERS) {
      if (s.system !== lastSys) {
        if (lastSys > 0) lines.push("");
        lines.push(systemLabels[s.system]);
        lastSys = s.system;
      }
      const slider = this.shadowRoot.getElementById(`slider-${s.key}`);
      const val = slider ? parseFloat(slider.value) : D[s.key];
      const name = s.key.toUpperCase();
      lines.push(`${name.padEnd(24)} = ${s.step < 1 ? val.toFixed(2) : val}`);
    }
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      const btn = this.shadowRoot.getElementById("copy-btn");
      if (btn) {
        btn.textContent = "\u2713 Copied!";
        setTimeout(() => (btn.textContent = "\uD83D\uDCCB Copy Values"), 2000);
      }
    });
  }

  _render() {
    const D = YeelightCubeCalibrationCard.DEFAULTS;
    const slidersDef = YeelightCubeCalibrationCard.SLIDERS;

    const makeSlider = (s) => {
      const val = D[s.key];
      const displayVal = s.step < 1 ? val.toFixed(2) : String(val);
      return `
        <div class="slider-row">
          <label class="slider-label" style="color:${s.color}">${s.label}</label>
          <input type="range" id="slider-${s.key}" class="slider"
            min="${s.min}" max="${s.max}" step="${s.step}" value="${val}"
            style="--track-color:${s.color}"
          />
          <span class="slider-value" id="val-${s.key}">${displayVal}</span>
        </div>`;
    };

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--ha-card-header-font-family, inherit);
        }
        ha-card {
          padding: 16px;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .card-title {
          font-size: 18px;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .card-subtitle {
          font-size: 11px;
          color: var(--secondary-text-color);
          opacity: 0.7;
          margin-top: 2px;
        }
        .info-bar {
          display: flex;
          gap: 16px;
          padding: 8px 12px;
          background: var(--card-background-color, #1c1c1c);
          border: 1px solid var(--divider-color, #333);
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 12px;
          color: var(--secondary-text-color);
          flex-wrap: wrap;
        }
        .info-bar span { font-weight: 500; color: var(--primary-text-color); }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 16px 0 8px 0;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--divider-color, #333);
        }
        .section-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .section-desc {
          font-size: 11px;
          color: var(--secondary-text-color);
          opacity: 0.7;
        }
        .reset-btn, .action-btn {
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 12px;
          border: 1px solid var(--divider-color, #555);
          background: transparent;
          color: var(--secondary-text-color);
          cursor: pointer;
          transition: all 0.2s;
        }
        .reset-btn:hover, .action-btn:hover {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color);
        }
        .slider-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 0;
        }
        .slider-label {
          font-size: 13px;
          font-weight: 500;
          min-width: 110px;
          text-align: right;
        }
        .slider {
          flex: 1;
          height: 6px;
          -webkit-appearance: none;
          appearance: none;
          background: var(--divider-color, #333);
          border-radius: 3px;
          outline: none;
          cursor: pointer;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--track-color, var(--primary-color));
          border: 2px solid var(--card-background-color, #1c1c1c);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--track-color, var(--primary-color));
          border: 2px solid var(--card-background-color, #1c1c1c);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
        }
        .slider-value {
          font-size: 13px;
          font-weight: 600;
          font-family: monospace;
          min-width: 42px;
          text-align: center;
          color: var(--primary-text-color);
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-top: 16px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
      </style>
      <ha-card>
        <div class="card-header">
          <div>
            <div class="card-title">\uD83D\uDD27 Color Calibration</div>
            <div class="card-subtitle">Runtime tuning \u2014 not persisted across restarts</div>
          </div>
        </div>

        <div class="info-bar">
          <div>HW Brightness: <span id="hw-brightness">?</span>%</div>
          <div>HA Brightness: <span id="ha-brightness">?</span></div>
          <div>Darken: <span id="current-darken">?</span></div>
        </div>

        <div class="section-header">
          <div>
            <div class="section-title">System 1 \u2014 Low-Brightness Gamma</div>
            <div class="section-desc">Inverse gamma correction for LED non-linearity at low PWM</div>
          </div>
          <button class="reset-btn" id="reset-sys1">Reset</button>
        </div>
        ${slidersDef
          .filter((s) => s.system === 1)
          .map(makeSlider)
          .join("")}

        <div class="section-header">
          <div>
            <div class="section-title">System 2 \u2014 Monitor-Matching Gain</div>
            <div class="section-desc">Per-channel multiplier to match sRGB monitor colors</div>
          </div>
          <button class="reset-btn" id="reset-sys2">Reset</button>
        </div>
        ${slidersDef
          .filter((s) => s.system === 2)
          .map(makeSlider)
          .join("")}

        <div class="section-header">
          <div>
            <div class="section-title">System 3 \u2014 Brightness Curve</div>
            <div class="section-desc">Dual-range brightness: HW dimming (low) + RGB darkening (high)</div>
          </div>
          <button class="reset-btn" id="reset-sys3">Reset</button>
        </div>
        ${slidersDef
          .filter((s) => s.system === 3)
          .map(makeSlider)
          .join("")}

        <div class="actions">
          <button class="action-btn" id="copy-btn">\uD83D\uDCCB Copy Values</button>
          <button class="action-btn" id="reset-all-btn">\uD83D\uDD04 Reset All</button>
        </div>
      </ha-card>
    `;

    // Wire up slider events
    for (const s of slidersDef) {
      const slider = this.shadowRoot.getElementById(`slider-${s.key}`);
      if (slider) {
        slider.addEventListener("input", (e) =>
          this._onSliderInput(s.key, e.target.value, s.step),
        );
      }
    }

    // Wire up buttons
    this.shadowRoot
      .getElementById("reset-sys1")
      ?.addEventListener("click", () => this._resetSystem(1));
    this.shadowRoot
      .getElementById("reset-sys2")
      ?.addEventListener("click", () => this._resetSystem(2));
    this.shadowRoot
      .getElementById("reset-sys3")
      ?.addEventListener("click", () => this._resetSystem(3));
    this.shadowRoot
      .getElementById("reset-all-btn")
      ?.addEventListener("click", () => this._resetAll());
    this.shadowRoot
      .getElementById("copy-btn")
      ?.addEventListener("click", () => this._copyValues());
  }

  getCardSize() {
    return 10;
  }
}

if (!customElements.get("yeelight-cube-calibration-card")) {
  customElements.define(
    "yeelight-cube-calibration-card",
    YeelightCubeCalibrationCard,
  );
}

window.customCards = window.customCards || [];
if (
  !window.customCards.some((c) => c.type === "yeelight-cube-calibration-card")
) {
  window.customCards.push({
    type: "yeelight-cube-calibration-card",
    name: "Yeelight Cube Calibration (Debug)",
    description: "Runtime color correction tuning for development",
    preview: false,
  });
}
