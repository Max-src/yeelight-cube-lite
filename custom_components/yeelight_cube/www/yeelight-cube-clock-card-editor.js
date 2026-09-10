import { LitElement, html, css } from "./lib/lit-all.js";

import {
  sharedEditorStyles,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import { createButtonGroup, buttonGroupStyles } from "./button-group-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { createYeelightCubeEntityPicker } from "./entity-selector-utils.js";
import {
  getClockStyles,
  DEFAULT_SCHEME_STYLES,
} from "./clock-preview-utils.js";
import { renderSliderSettings, sliderKeys } from "./slider-control-utils.js";

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

const SHAPE_CHOICES = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "round", label: "Round" },
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

const schemeListStyles = css`
  .scheme-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 10px 0;
  }
  .scheme-list-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 8px;
    padding: 6px 8px;
  }
  .scheme-list-row.dragging {
    opacity: 0.5;
  }
  .scheme-list-row.drag-over {
    border-color: var(--primary-color, #03a9f4);
    box-shadow: inset 0 0 0 1px var(--primary-color, #03a9f4);
  }
  .scheme-drag-handle {
    cursor: grab;
    color: var(--secondary-text-color, #999);
    font-size: 1em;
    line-height: 1;
    user-select: none;
    padding: 0 2px;
  }
  .scheme-list-name {
    flex: 1;
    font-size: 0.92em;
    color: var(--primary-text-color, #333);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scheme-list-row button {
    border: none;
    background: var(--secondary-background-color, #f0f0f0);
    color: var(--primary-text-color, #333);
    border-radius: 6px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 0.9em;
    line-height: 1;
  }
  .scheme-list-row button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .scheme-list-row button.remove {
    color: var(--error-color, #d32f2f);
  }
  .scheme-add-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .scheme-add-row select {
    flex: 1;
  }
  .scheme-reset-btn {
    background: none;
    border: 1px solid var(--divider-color, #d0d7de);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.85em;
    color: var(--primary-text-color, #333);
    cursor: pointer;
  }
`;

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
    return [sharedEditorStyles, buttonGroupStyles, schemeListStyles];
  }

  setConfig(config) {
    this.config = { ...config };
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
          "schemes",
          "Quick schemes",
          html`
            ${createToggleRow(
              "Show quick-schemes row",
              "show_scheme_row",
              config.show_scheme_row !== false,
              (e) => this._onToggle(e, "show_scheme_row"),
            )}
            <div
              class="hint"
              style="font-size:0.9em;color:var(--secondary-text-color,#666);margin-bottom:4px;"
            >
              Styles shown in the compact row, in this order.
            </div>
            ${this._renderSchemeList()}
          `,
        )}
        ${this._section(
          "style",
          "Clock style",
          html`
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
                  ${createToggleRow(
                    "Show Style Titles",
                    "preview_show_titles",
                    config.preview_show_titles !== false,
                    (e) => this._onToggle(e, "preview_show_titles"),
                  )}
                  ${this._selectorStyle(config) !== "preview-carousel"
                    ? createToggleRow(
                        "Highlight Active Style",
                        "highlight_active_mode",
                        config.highlight_active_mode !== false,
                        (e) => this._onToggle(e, "highlight_active_mode"),
                      )
                    : ""}
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
            <!-- Shared appearance axis: applies to EVERY selector style -->
            <div class="form-row">
              <label>Shape</label>
              ${createButtonGroup(
                SHAPE_CHOICES,
                config.selector_shape || "rounded",
                (e) => this._onButtonGroup("selector_shape", e),
              )}
            </div>
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
          `,
        )}
        ${this._section(
          "speed",
          "Animation Speed",
          html`
            ${createToggleRow(
              "Show animation speed slider",
              "show_animation_speed",
              config.show_animation_speed !== false,
              (e) => this._onToggle(e, "show_animation_speed"),
            )}
            ${renderSliderSettings(
              config,
              sliderKeys("speed"),
              (key, value) => {
                this.config = { ...this.config, [key]: value };
                this.requestUpdate();
                this._fire();
              },
              {
                icons: {
                  leftLabel: "Show Slow Icon (🐢)",
                  rightLabel: "Show Fast Icon (⚡)",
                },
              },
            )}
          `,
        )}
      </div>
    `;
  }

  // Current quick-schemes list, falling back to the shared default when unset.
  _schemeList() {
    const list = this.config?.scheme_row_styles;
    return Array.isArray(list) && list.length
      ? list
      : [...DEFAULT_SCHEME_STYLES];
  }

  _setSchemeList(list) {
    this.config = { ...this.config, scheme_row_styles: list };
    this.requestUpdate();
    this._fire();
  }

  _renderSchemeList() {
    const list = this._schemeList();
    const allNames = getClockStyles(true).map((s) => s.name);
    const available = allNames.filter((n) => !list.includes(n));

    const rows = list.map(
      (name, idx) => html`
        <div
          class="scheme-list-row"
          draggable="true"
          data-idx="${idx}"
          @dragstart="${(e) => this._onSchemeDragStart(e, idx)}"
          @dragover="${this._onSchemeDragOver}"
          @dragleave="${this._onSchemeDragLeave}"
          @drop="${(e) => this._onSchemeDrop(e, idx)}"
          @dragend="${this._onSchemeDragEnd}"
        >
          <span class="scheme-drag-handle" title="Drag to reorder">⋮⋮</span>
          <button
            title="Move up"
            ?disabled="${idx === 0}"
            @click="${() => this._onSchemeMove(idx, -1)}"
          >
            ▲
          </button>
          <button
            title="Move down"
            ?disabled="${idx === list.length - 1}"
            @click="${() => this._onSchemeMove(idx, 1)}"
          >
            ▼
          </button>
          <span class="scheme-list-name">${name}</span>
          <button
            class="remove"
            title="Remove"
            @click="${() => this._onSchemeRemove(idx)}"
          >
            ✕
          </button>
        </div>
      `,
    );

    return html`
      <div class="scheme-list">${rows}</div>
      <div class="scheme-add-row">
        <select @change="${this._onSchemeAdd}">
          <option value="">Add a style…</option>
          ${available.map((n) => html`<option value="${n}">${n}</option>`)}
        </select>
        <button class="scheme-reset-btn" @click="${this._onSchemeReset}">
          Reset to defaults
        </button>
      </div>
    `;
  }

  _onSchemeDragStart(e, idx) {
    this._dragIdx = idx;
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs data set for the drag to start.
    try {
      e.dataTransfer.setData("text/plain", String(idx));
    } catch (_) {}
    e.currentTarget.classList.add("dragging");
  }

  _onSchemeDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    e.currentTarget.classList.add("drag-over");
  }

  _onSchemeDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  }

  _onSchemeDrop(e, targetIdx) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const from = this._dragIdx;
    if (from == null || from === targetIdx) return;
    const list = [...this._schemeList()];
    const [moved] = list.splice(from, 1);
    list.splice(targetIdx, 0, moved);
    this._dragIdx = null;
    this._setSchemeList(list);
  }

  _onSchemeDragEnd(e) {
    this._dragIdx = null;
    this.shadowRoot
      ?.querySelectorAll(".scheme-list-row")
      .forEach((r) => r.classList.remove("dragging", "drag-over"));
  }

  _onSchemeAdd(e) {
    const value = e.target.value;
    if (!value) return;
    this._setSchemeList([...this._schemeList(), value]);
    e.target.value = "";
  }

  _onSchemeRemove(idx) {
    const list = this._schemeList().filter((_, i) => i !== idx);
    this._setSchemeList(list);
  }

  _onSchemeMove(idx, delta) {
    const list = [...this._schemeList()];
    const target = idx + delta;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    this._setSchemeList(list);
  }

  _onSchemeReset() {
    this.config = { ...this.config };
    delete this.config.scheme_row_styles;
    this.requestUpdate();
    this._fire();
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
