import { LitElement, html } from "./lib/lit-all.js";

import {
  sharedEditorStyles,
  renderModeSettingsSection,
  renderSelectorShapeRows,
} from "./editor_ui_utils.js";
import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { createYeelightCubeEntityPicker } from "./entity-selector-utils.js";
import { getClockStyles } from "./clock-preview-utils.js";
import { renderSliderSettings, sliderKeys } from "./slider-control-utils.js";
import {
  colorPickerStyleChoices,
  resolveColorPickerStyle,
} from "./color-picker-utils.js";
import {
  renderOrderableList,
  orderableListStyles,
} from "./orderable-list-utils.js";

const TEXT_STYLE_CHOICES = [
  { value: "filled", label: "Filled" },
  { value: "dropdown", label: "Dropdown" },
  {
    value: "chips",
    label: "Chips",
    title: "Chips with a colour swatch per clock style",
  },
];

const PREVIEW_STYLE_CHOICES = [
  {
    value: "preview-list",
    label: "List",
    title: "Responsive list of live clock previews",
  },
  {
    value: "preview-grid",
    label: "Grid",
    title: "Fixed two-column grid of live clock previews",
  },
  {
    value: "preview-strip",
    label: "Strip",
    title: "Horizontal scrollable strip of mini previews",
  },
  {
    value: "preview-carousel",
    label: "Carousel",
    title: "One preview at a time with arrows, dots and swipe navigation",
  },
  {
    value: "preview-wheel",
    label: "Wheel",
    title: "iOS-style rotating picker with live previews",
  },
];

const PIXEL_STYLE_CHOICES = [
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
];

const BG_COLOR_CHOICES = [
  { value: "transparent", label: "Transparent" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
];

const SPACING_CHOICES = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "normal", label: "Normal" },
];

class YeelightCubeClockCardEditor extends LitElement {
  static get properties() {
    return {
      localTitle: { type: String },
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this.config = {};
    this.localTitle = "";
    this._hass = null;
    // Foldable sections follow the card's top→bottom element order.
    this._open = { general: true };
  }

  static get styles() {
    return [sharedEditorStyles, buttonGroupStyles, orderableListStyles];
  }

  setConfig(config) {
    const cfg = { ...config };
    // Mirror the card's legacy speed_* → shared slider_* migration so existing
    // customizations show up in the editor controls.
    const K = sliderKeys("slider");
    const oldK = sliderKeys("speed");
    for (const f of Object.keys(K)) {
      if (cfg[K[f]] === undefined && cfg[oldK[f]] !== undefined) {
        cfg[K[f]] = cfg[oldK[f]];
      }
    }
    this.config = cfg;
    this.localTitle = config.title || "";
    this.requestUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (hass && hass.states) this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  shouldUpdate() {
    return !!this._hass;
  }

  _toggleSection(id) {
    this._open = { ...this._open, [id]: !this._open[id] };
  }

  // ── Unified selector helpers (same UX as the gradient editor) ─────────────
  _selectorStyle(config) {
    const v = config.style_selector_style;
    const all = [
      "filled",
      "dropdown",
      "chips",
      "preview-list",
      "preview-grid",
      "preview-strip",
      "preview-carousel",
      "preview-wheel",
    ];
    return all.includes(v) ? v : "preview-grid";
  }

  _selectorFamily(config) {
    return this._selectorStyle(config).startsWith("preview-")
      ? "preview"
      : "text";
  }

  _onSelectorFamily(e) {
    const value = e?.target?.dataset?.value;
    if (!value) return;
    const current = this._selectorStyle(this.config);
    const isPreview = current.startsWith("preview-");
    // Only switch when crossing families; remember the last style per family.
    if (value === "preview" && !isPreview) {
      this._lastTextStyle = current;
      this.config = {
        ...this.config,
        style_selector_style: this._lastPreviewStyle || "preview-grid",
      };
    } else if (value === "text" && isPreview) {
      this._lastPreviewStyle = current;
      this.config = {
        ...this.config,
        style_selector_style: this._lastTextStyle || "filled",
      };
    } else {
      return;
    }
    this.requestUpdate();
    this._fire();
  }

  _onSelectorStyle(e) {
    const value = e?.target?.dataset?.value;
    if (!value) return;
    if (value.startsWith("preview-")) this._lastPreviewStyle = value;
    else this._lastTextStyle = value;
    this.config = { ...this.config, style_selector_style: value };
    this.requestUpdate();
    this._fire();
  }

  _chevron(open) {
    return html`<ha-icon
      icon="mdi:chevron-up"
      style="transition:transform .3s;transform:rotate(${open ? 0 : 180}deg);"
    ></ha-icon>`;
  }

  _section(id, title, content) {
    const open = !!this._open[id];
    return html`
      <div class="editor-card${open ? "" : " editor-card-collapsed"}">
        <div
          class="editor-card-header"
          @click="${() => this._toggleSection(id)}"
        >
          ${title} ${this._chevron(open)}
        </div>
        <div class="editor-card-content">${content}</div>
      </div>
    `;
  }

  render() {
    if (!this._hass || !this._hass.states) {
      return html`<div
        style="padding: 20px; color: var(--secondary-text-color, #666);"
      >
        Loading…
      </div>`;
    }
    const config = this.config || {};
    const selectedEntities =
      config.target_entities || (config.entity ? [config.entity] : []);

    // Sections are ordered to match how the elements appear on the card:
    // Global Settings → Lamp Preview → Quick schemes → Clock style →
    // Content & Controls (content, format, colour override) → Animation Speed.
    return html`
      <div class="editor-root">
        ${this._section(
          "general",
          "Global Settings",
          html`
            <div class="form-row">
              <label>Card Title (optional)</label>
              <input
                type="text"
                id="title"
                .value="${this.localTitle}"
                placeholder="Clock"
                @input="${this._onTitleInput}"
              />
            </div>
            <div class="form-row">
              <label>Target Entities</label>
              <div
                class="hint"
                style="font-size:0.9em;color:var(--secondary-text-color,#666);margin-bottom:8px;"
              >
                Choose the Yeelight Cube Lite light(s) this card controls.
              </div>
              ${createYeelightCubeEntityPicker(
                this._hass,
                selectedEntities,
                (e) => this._onEntityChange(e),
                "multiple",
              )}
            </div>
            ${createToggleRow(
              "Show active-style label",
              "show_active_label",
              config.show_active_label !== false,
              (e) => this._onToggle(e, "show_active_label"),
            )}
            ${createToggleRow(
              "Show card background",
              "show_card_background",
              config.show_card_background !== false,
              (e) => this._onToggle(e, "show_card_background"),
            )}
          `,
        )}
        ${this._section(
          "previews",
          "Lamp Preview",
          html`
            ${createToggleRow(
              "Show Lamp Preview",
              "show_current_preview",
              config.show_current_preview !== false,
              (e) => this._onToggle(e, "show_current_preview"),
            )}
            ${createSliderRow(
              "Matrix Size",
              config.lamp_preview_size ?? 55,
              { min: 30, max: 100, step: 5 },
              (e) => this._onSlider("lamp_preview_size", e),
              "%",
            )}
            <div class="form-row">
              <label>Matrix Background Color</label>
              ${createButtonGroup(
                BG_COLOR_CHOICES,
                config.lamp_matrix_background || "black",
                (e) => this._onButtonGroup("lamp_matrix_background", e),
              )}
            </div>
            ${(config.lamp_matrix_background || "black") !== "black"
              ? createToggleRow(
                  "Ignore Black Pixels",
                  "lamp_ignore_black_pixels",
                  config.lamp_ignore_black_pixels === true,
                  (e) => this._onToggle(e, "lamp_ignore_black_pixels"),
                )
              : ""}
            <div class="form-row">
              <label>Matrix Pixel Style</label>
              ${createButtonGroup(
                PIXEL_STYLE_CHOICES,
                config.lamp_pixel_style || "rounded",
                (e) => this._onButtonGroup("lamp_pixel_style", e),
              )}
            </div>
            <div class="form-row">
              <label>Pixel Spacing</label>
              ${createButtonGroup(
                SPACING_CHOICES,
                config.lamp_spacing_mode || "normal",
                (e) => this._onButtonGroup("lamp_spacing_mode", e),
              )}
            </div>
            ${createToggleRow(
              "Matrix Box Shadow",
              "lamp_matrix_box_shadow",
              config.lamp_matrix_box_shadow === true,
              (e) => this._onToggle(e, "lamp_matrix_box_shadow"),
            )}
          `,
        )}
        ${this._section(
          "style",
          "Clock style",
          html`
            ${createToggleRow(
              "Customize visible styles",
              "custom_visible_styles",
              config.custom_visible_styles === true,
              (e) => this._onToggle(e, "custom_visible_styles"),
            )}
            ${config.custom_visible_styles === true
              ? renderModeSettingsSection(
                  "Visible Styles",
                  html`
                    <div
                      class="hint"
                      style="font-size:0.9em;color:var(--secondary-text-color,#666);margin-bottom:4px;"
                    >
                      Styles shown in the selector, in this order.
                    </div>
                    ${this._renderVisibleStyleList()}
                  `,
                )
              : ""}
            <!-- Same two-level selector UI as the gradient card: family
                 first, then that family's style picker + settings. -->
            <div class="form-row">
              <label>Selector Type</label>
              ${createButtonGroup(
                [
                  {
                    value: "text",
                    label: "Text",
                    title: "Lightweight buttons — no preview animation",
                  },
                  {
                    value: "preview",
                    label: "Live Preview",
                    title: "Animated clock preview of every style",
                  },
                ],
                this._selectorFamily(config),
                (e) => this._onSelectorFamily(e),
              )}
            </div>
            ${this._selectorFamily(config) === "text"
              ? html`
                  <div class="form-row">
                    <label>Text Style</label>
                    ${createButtonGroup(
                      TEXT_STYLE_CHOICES,
                      this._selectorStyle(config),
                      (e) => this._onSelectorStyle(e),
                    )}
                  </div>
                `
              : html`
                  <div class="form-row">
                    <label>Preview Style</label>
                    ${createButtonGroup(
                      PREVIEW_STYLE_CHOICES,
                      this._selectorStyle(config),
                      (e) => this._onSelectorStyle(e),
                    )}
                  </div>
                  ${this._selectorStyle(config) === "preview-wheel"
                    ? renderModeSettingsSection(
                        "Wheel Mode Settings",
                        html`
                          <div class="form-row">
                            <label>Wheel Navigation Position</label>
                            ${createButtonGroup(
                              [
                                { value: "none", label: "None" },
                                { value: "bottom", label: "Bottom" },
                                { value: "sides", label: "Sides" },
                              ],
                              config.wheel_nav_position || "bottom",
                              (e) =>
                                this._onButtonGroup("wheel_nav_position", e),
                            )}
                          </div>
                          ${createSliderRow(
                            "Wheel Height",
                            config.wheel_height ?? 300,
                            { min: 65, max: 400, step: 10 },
                            (e) => this._onSlider("wheel_height", e),
                            "px",
                          )}
                          ${createToggleRow(
                            "Highlight Active Style",
                            "highlight_active_mode",
                            config.highlight_active_mode !== false,
                            (e) => this._onToggle(e, "highlight_active_mode"),
                          )}
                        `,
                      )
                    : ""}
                  ${this._selectorStyle(config) === "preview-carousel"
                    ? renderModeSettingsSection(
                        "Carousel Mode Settings",
                        createToggleRow(
                          "Wrap Navigation (Infinite Loop)",
                          "gallery_wrap_navigation",
                          config.gallery_wrap_navigation === true,
                          (e) => this._onToggle(e, "gallery_wrap_navigation"),
                        ),
                      )
                    : ""}
                  ${this._selectorStyle(config) === "preview-strip"
                    ? renderModeSettingsSection(
                        "Strip Mode Settings",
                        createToggleRow(
                          "Highlight Active Style",
                          "highlight_active_mode",
                          config.highlight_active_mode !== false,
                          (e) => this._onToggle(e, "highlight_active_mode"),
                        ),
                      )
                    : ""}
                  ${this._selectorStyle(config) === "preview-list" ||
                  this._selectorStyle(config) === "preview-grid"
                    ? renderModeSettingsSection(
                        this._selectorStyle(config) === "preview-grid"
                          ? "Grid Mode Settings"
                          : "List Mode Settings",
                        html`
                          ${createToggleRow(
                            "Highlight Active Style",
                            "highlight_active_mode",
                            config.highlight_active_mode !== false,
                            (e) => this._onToggle(e, "highlight_active_mode"),
                          )}
                          ${createSliderRow(
                            "Items Per Page (0 = no pagination)",
                            config.items_per_page || 0,
                            { min: 0, max: 9, step: 1 },
                            (e) => this._onSlider("items_per_page", e),
                          )}
                        `,
                      )
                    : ""}
                  ${createToggleRow(
                    "Show Style Titles",
                    "preview_show_titles",
                    config.preview_show_titles !== false,
                    (e) => this._onToggle(e, "preview_show_titles"),
                  )}
                  ${createSliderRow(
                    "Size",
                    config.preview_size ?? 55,
                    { min: 30, max: 100, step: 5 },
                    (e) => this._onSlider("preview_size", e),
                    "%",
                  )}
                  <div class="form-row">
                    <label>Preview Background Color</label>
                    ${createButtonGroup(
                      BG_COLOR_CHOICES,
                      config.gallery_background_color || "black",
                      (e) => this._onButtonGroup("gallery_background_color", e),
                    )}
                  </div>
                  ${(config.gallery_background_color || "black") !== "black"
                    ? createToggleRow(
                        "Ignore Black Pixels",
                        "gallery_ignore_black_pixels",
                        config.gallery_ignore_black_pixels === true,
                        (e) => this._onToggle(e, "gallery_ignore_black_pixels"),
                      )
                    : ""}
                  <div class="form-row">
                    <label>Preview Pixel Style</label>
                    ${createButtonGroup(
                      [
                        { value: "square", label: "Square" },
                        { value: "rounded", label: "Rounded" },
                        { value: "circle", label: "Circle" },
                      ],
                      config.gallery_pixel_style || "square",
                      (e) => this._onButtonGroup("gallery_pixel_style", e),
                    )}
                  </div>
                  <div class="form-row">
                    <label>Pixel Spacing</label>
                    ${createButtonGroup(
                      SPACING_CHOICES,
                      config.gallery_spacing_mode || "normal",
                      (e) => this._onButtonGroup("gallery_spacing_mode", e),
                    )}
                  </div>
                  ${createToggleRow(
                    "Matrix Box Shadow",
                    "gallery_matrix_box_shadow",
                    config.gallery_matrix_box_shadow === true,
                    (e) => this._onToggle(e, "gallery_matrix_box_shadow"),
                  )}
                `}
            <!-- Shared appearance axes: apply to EVERY selector style -->
            ${renderSelectorShapeRows(
              config,
              (key, value) => {
                this.config = { ...this.config, [key]: value };
                this.requestUpdate();
                this._fire();
              },
              {
                showButtonShape:
                  this._selectorStyle(config) === "preview-carousel" ||
                  this._selectorStyle(config) === "preview-wheel",
              },
            )}
          `,
        )}
        ${this._section(
          "display",
          "Content & Controls",
          html`
            ${createToggleRow(
              "Show content toggle",
              "show_content_toggle",
              config.show_content_toggle !== false,
              (e) => this._onToggle(e, "show_content_toggle"),
            )}
            ${createToggleRow(
              "Show format toggles",
              "show_format_toggles",
              config.show_format_toggles !== false,
              (e) => this._onToggle(e, "show_format_toggles"),
            )}
            ${createToggleRow(
              "Show colour override",
              "show_color_override",
              !!config.show_color_override,
              (e) => this._onToggle(e, "show_color_override"),
            )}
            ${config.show_color_override
              ? html`
                  <div class="form-row">
                    <label>Colour override style</label>
                    ${createButtonGroup(
                      colorPickerStyleChoices,
                      resolveColorPickerStyle(config.color_override_style),
                      (event) => {
                        const value = event.currentTarget.dataset.value;
                        this.config = {
                          ...this.config,
                          color_override_style: value,
                        };
                        this.requestUpdate();
                        this._fire();
                      },
                    )}
                  </div>
                `
              : ""}
          `,
        )}
        ${this._section(
          "speed",
          "Sliders",
          html`
            ${createToggleRow(
              "Show brightness slider",
              "show_brightness",
              config.show_brightness === true,
              (e) => this._onToggle(e, "show_brightness"),
            )}
            ${createToggleRow(
              "Show animation speed slider",
              "show_animation_speed",
              config.show_animation_speed !== false,
              (e) => this._onToggle(e, "show_animation_speed"),
            )}
            ${renderSliderSettings(
              config,
              sliderKeys("slider"),
              (key, value) => {
                this.config = { ...this.config, [key]: value };
                this.requestUpdate();
                this._fire();
              },
              {
                icons: {
                  leftLabel: "Show lower icon (🐢 / 🌙)",
                  rightLabel: "Show upper icon (⚡ / ☀️)",
                },
              },
            )}
          `,
        )}
      </div>
    `;
  }

  // Ordered list of styles shown in the selector (all styles when unset).
  _visibleStyleList() {
    const list = this.config?.visible_styles;
    return Array.isArray(list) && list.length
      ? list
      : getClockStyles(true).map((s) => s.name);
  }

  _renderVisibleStyleList() {
    const list = this._visibleStyleList();
    const allNames = getClockStyles(true).map((s) => s.name);
    return renderOrderableList({
      items: list,
      available: allNames.filter((n) => !list.includes(n)),
      onUpdate: (l) => {
        this.config = { ...this.config, visible_styles: l };
        this.requestUpdate();
        this._fire();
      },
      onReset: () => {
        this.config = { ...this.config };
        delete this.config.visible_styles;
        this.requestUpdate();
        this._fire();
      },
      addPlaceholder: "Add a style…",
      resetLabel: "Reset to all styles",
    });
  }

  _onTitleInput(e) {
    this.localTitle = e.target.value;
    this.config = { ...this.config, title: this.localTitle || undefined };
    this._fire();
  }

  _onEntityChange(e) {
    const value = Array.isArray(e.target.value)
      ? e.target.value
      : [e.target.value];
    this.config = { ...this.config, target_entities: value };
    // Keep a single `entity` in sync for stub/simple configs.
    this.config.entity = value[0] || undefined;
    this.requestUpdate();
    this._fire();
  }

  _onButtonGroup(key, e) {
    const value = e?.target?.dataset?.value;
    if (!value) return;
    this.config = { ...this.config, [key]: value };
    this.requestUpdate();
    this._fire();
  }

  _onToggle(e, key) {
    this.config = { ...this.config, [key]: e.target.checked };
    this.requestUpdate();
    this._fire();
  }

  _onSlider(key, e) {
    this.config = { ...this.config, [key]: parseInt(e.target.value, 10) };
    this.requestUpdate();
    this._fire();
  }

  _fire() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this.config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("yeelight-cube-clock-card-editor")) {
  customElements.define(
    "yeelight-cube-clock-card-editor",
    YeelightCubeClockCardEditor,
  );
}
