import "./preview-appearance-editor.js";
import { LitElement, html, nothing } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
  buttonGroupStyles,
} from "./button-group-utils.js";
import { entitySelectorStyles } from "./entity-selector-utils.js";
import {
  fireEvent,
  sharedEditorStyles,
  YeelightEditorMixin,
  renderModeSettingsSection,
} from "./editor_ui_utils.js";
import { normalizeCardOptions } from "./card-config.js";
import { renderStyleSelectorSettings } from "./style-selector-ui.js";
import {
  createToggleRow,
  createSliderRow,
  createButtonGroupRow,
} from "./form-row-utils.js";
import {
  orderableListStyles,
} from "./orderable-list-utils.js";
import { GRADIENT_MODES } from "./yeelight-cube-gradient-card.js";
import { defineOnce } from "./card-registration.js";

const ALIGNMENTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const PANEL_TOGGLE_STYLES = [
  { value: "minimal", label: "Minimal" },
  { value: "switch", label: "Switch" },
  { value: "card", label: "Card" },
  { value: "tabs", label: "Tabs" },
  { value: "chip", label: "Chip" },
];
const SHAPES = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "round", label: "Round" },
];
const ANGLE_VALUE_DISPLAYS = [
  { value: "none", label: "None" },
  { value: "text", label: "Text" },
  { value: "input", label: "Input" },
];
const ANGLE_STYLES = [
  { value: "rectangle", label: "Rectangle", title: "Gradient Bar (Rectangle or Square)" },
  { value: "wheel", label: "Wheel", title: "Gradient wheel with optional arrow mask" },
  { value: "compass", label: "Compass", title: "Circular dial with configurable overlay shape" },
  { value: "matrix_preview", label: "Matrix", title: "Mini Matrix — pixel grid preview of gradient" },
  { value: "capsule", label: "Capsule", title: "Horizontal pill slider for angle" },
];
const RECTANGLE_SHAPES = [
  { value: "rectangle", label: "Rectangle", title: "Wide gradient bar (4:1)" },
  { value: "square", label: "Square", title: "Square shape (1:1)" },
];
const COMPASS_SHAPES = [
  { value: "none", label: "None", title: "No overlay shape, just selector dot" },
  { value: "needle", label: "Needle", title: "Tapered diamond needle" },
  { value: "beam", label: "Beam", title: "Spotlight wedge beam" },
  { value: "arrow", label: "Arrow", title: "Arrow shape overlay" },
  { value: "star", label: "Star", title: "Five-pointed star overlay" },
  { value: "rectangle", label: "Rectangle", title: "Turning rectangle overlay" },
];
const COMPASS_LABELS = [
  { value: "none", label: "None", title: "No coordinate labels" },
  { value: "under", label: "Under", title: "Coordinates behind shape/colors" },
  { value: "over", label: "Over", title: "Coordinates always visible over shape" },
];
const CAPSULE_THEMES = [
  { value: "flat", label: "Flat", title: "No background, blends with card" },
  { value: "subtle", label: "Subtle", title: "Light tinted background" },
  { value: "filled", label: "Filled", title: "Deeper background, strong contrast" },
];
const VALUE_SIDES = [
  { value: "left", label: "Left" },
  { value: "under", label: "Under" },
  { value: "right", label: "Right" },
];

class YeelightCubeGradientCardEditor extends YeelightEditorMixin(LitElement) {
  static get properties() {
    return {
      _config: { type: Object },
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this._config = {};
    this._open = {};
  }

  // Older configs arrive in today's names (normalizeCardOptions); unset
  // options keep their defaults: only what the user changes is saved.
  setConfig(config) {
    this._config = { ...normalizeCardOptions(config, "gradient") };
    this.requestUpdate();
  }

  // The modes the card shows, in order (the card's own rule, see
  // YeelightCubeGradientCard._orderedModes: its list only when customised).
  _visibleModeList() {
    const list = this._config?.visible_modes;
    return this._config?.custom_visible_modes === true &&
      Array.isArray(list) &&
      list.length
      ? list.filter((mode) => GRADIENT_MODES.includes(mode))
      : [...GRADIENT_MODES];
  }

  _renderVisibleModeList() {
    return this._galleryItemsSettings({
      noun: "mode",
      items: this._visibleModeList(),
      all: [...GRADIENT_MODES],
      labelFor: (mode) => mode,
      onList: (modes) => {
        this._config = {
          ...this._config,
          custom_visible_modes: true,
          visible_modes: modes,
        };
      },
      onReset: () => {
        this._config = { ...this._config };
        delete this._config.custom_visible_modes;
        delete this._config.visible_modes;
      },
    });
  }

  getConfig() {
    return this._config;
  }

  _fireConfigChanged() {
    const config = {
      type: "custom:yeelight-cube-gradient-card",
      ...this._config,
    };
    fireEvent(this, "config-changed", { config });
  }

  // The angle control's style (the oldest configs named it
  // angle_rotary_style: wheel / rect, else a compass).
  _angleStyle() {
    const cfg = this._config;
    return (
      cfg.rotary_unified_style ||
      { wheel: "wheel", rect: "rectangle" }[cfg.angle_rotary_style] ||
      "compass"
    );
  }

  static get styles() {
    return [
      sharedEditorStyles,
      buttonGroupStyles,
      entitySelectorStyles,
      orderableListStyles,
    ];
  }

  // The rows of this editor, on the shared editor rows.
  _toggle(label, key, checked) {
    return createToggleRow(label, key, checked, (event) =>
      this._onSwitchChange(event, key),
    );
  }

  _choice(label, key, options, fallback) {
    return createButtonGroupRow(
      label,
      createButtonGroup(
        options,
        this._config[key] || fallback,
        createButtonGroupChangeHandler(key, (value) =>
          this._setOption(key, value),
        ),
      ),
    );
  }

  _range(label, key, fallback, range, unit) {
    return createSliderRow(
      label,
      this._config[key] ?? fallback,
      range,
      (event) => this._setOption(key, Number(event.target.value)),
      unit,
    );
  }

  _renderAppearance(section) {
    return html`<yeelight-preview-appearance-editor
      profile="gradient"
      section=${section}
      .owner=${this}
      .config=${this._config}
      @appearance-changed=${(event) => {
        this._config = event.detail.config;
        this._fireConfigChanged();
      }}
    ></yeelight-preview-appearance-editor>`;
  }

  render() {
    const cfg = this._config || {};
    const panelStyle = cfg.panel_toggle_style || "minimal";
    return html`
      <div class="editor-root">
        ${this._section(
          "preview_appearance",
          "Preview Appearance",
          this._renderAppearance("shared"),
        )}
        ${this._section("global", "Global Settings", html`
          ${this._cardFrameSettings({
            placeholder: "Gradient",
            lamps: "multiple",
          })}
        `)}
        ${this._section("label", "Active Mode Label", html`
          ${this._toggle(
            "Show Active Mode Label",
            "show_active_mode_label",
            cfg.show_active_mode_label === true,
          )}
          ${cfg.show_active_mode_label === true
            ? this._choice("Alignment", "active_mode_label_align", ALIGNMENTS, "left")
            : nothing}
        `)}
        ${this._section("mode", "Mode Selector", html`
          ${this._toggle(
            "Show Mode Selector",
            "show_mode_selector",
            cfg.show_mode_selector !== false,
          )}
          ${this._renderVisibleModeList()}
          <!-- The shared gallery settings (the same as the Clock and
               Native Effects editors). -->
          ${renderStyleSelectorSettings(cfg, (key, value) => this._setOption(key, value), {
            allowChips: true,
            noun: "Mode",
            memory: (this._galleryMemory ||= {}),
            defaultSize: 50,
            renderAppearance: () => this._renderAppearance("gallery"),
          })}
        `)}
        ${this._section("panel", "Apply to Whole Panel", html`
          ${this._toggle(
            'Show "Apply to Whole Panel"',
            "show_panel_toggle",
            cfg.show_panel_toggle !== false,
          )}
          ${cfg.show_panel_toggle !== false
            ? html`
                ${this._choice("Panel Toggle Style", "panel_toggle_style", PANEL_TOGGLE_STYLES, "minimal")}
                ${this._choice("Toggle Shape", "panel_toggle_shape", SHAPES, "round")}
                ${panelStyle !== "card" && panelStyle !== "tabs"
                  ? this._choice("Alignment", "panel_toggle_align", ALIGNMENTS, "left")
                  : nothing}
              `
            : nothing}
        `)}
        ${this._section("angle", "Angle Selector", html`
          ${this._toggle(
            "Show Angle Selector",
            "show_angle_section",
            cfg.show_angle_section !== false,
          )}
          ${this._choice("Show Angle Value", "angle_value_display", ANGLE_VALUE_DISPLAYS, "none")}
          ${createButtonGroupRow(
            "Angle Selector Style",
            createButtonGroup(
              ANGLE_STYLES,
              this._angleStyle(),
              createButtonGroupChangeHandler("rotary_unified_style", (value) =>
                this._setOption("rotary_unified_style", value),
              ),
            ),
          )}
          ${this._angleStyleSettings(this._angleStyle())}
        `)}
      </div>
    `;
  }

  // The settings of the chosen angle style.
  _angleStyleSettings(style) {
    const cfg = this._config;
    const size = () =>
      this._range("Element Size", "rotary_size", 80, { min: 30, max: 100, step: 5 }, "%");
    const dot = () =>
      this._toggle("Show Selector Dot", "show_selector_dot", cfg.show_selector_dot !== false);
    const snap = () =>
      this._toggle(
        "Snap to Coordinates",
        "compass_snap_to_coordinates",
        cfg.compass_snap_to_coordinates === true,
      );
    switch (style) {
      case "rectangle":
        return renderModeSettingsSection("Rectangle Settings", html`
          ${size()} ${dot()}
          ${this._choice("Shape", "rectangle_shape", RECTANGLE_SHAPES, "rectangle")}
          ${snap()}
        `);
      case "wheel":
        return renderModeSettingsSection("Wheel Settings", html`
          ${size()} ${dot()}
          ${this._toggle("Show Arrow Mask", "wheel_show_mask", cfg.wheel_show_mask === true)}
          ${snap()}
        `);
      case "compass":
        return renderModeSettingsSection("Compass Settings", html`
          ${size()} ${dot()}
          ${this._choice("Overlay Shape", "compass_shape", COMPASS_SHAPES, "none")}
          ${this._choice("Coordinates", "compass_labels_mode", COMPASS_LABELS, "under")}
          ${snap()}
        `);
      case "matrix_preview":
        return renderModeSettingsSection("Matrix Preview Settings", html`
          ${size()} ${this._renderAppearance("rotary")}
          ${this._toggle(
            "Show Text Preview",
            "matrix_rotary_text_preview",
            cfg.matrix_rotary_text_preview === true,
          )}
        `);
      case "capsule":
        return renderModeSettingsSection("Capsule Settings", html`
          ${this._choice("Theme", "capsule_theme", CAPSULE_THEMES, "subtle")}
          ${this._range("Thickness", "capsule_thickness", 6, { min: 2, max: 10, step: 1 }, "px")}
          ${snap()}
          ${(cfg.angle_value_display || "none") !== "none"
            ? this._choice("Angle Value Side", "capsule_angle_value_side", VALUE_SIDES, "right")
            : nothing}
        `);
      default:
        return nothing;
    }
  }
}

defineOnce("yeelight-cube-gradient-card-editor", YeelightCubeGradientCardEditor);
