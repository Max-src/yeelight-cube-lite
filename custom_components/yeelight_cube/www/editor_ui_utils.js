// Shared UI utilities for Home Assistant card editors
// Provides consistent form elements and styles

import {
  getTargetEntities,
  withTargetEntities,
} from "./service-call-utils.js";
import { createYeelightCubeEntityPicker } from "./entity-selector-utils.js";
import { html, css } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
} from "./button-group-utils.js";
import { createToggleRow, createSliderRow } from "./form-row-utils.js";
import { renderOrderableList } from "./orderable-list-utils.js";
import { withItemLabel } from "./card-config.js";
import { normalizeButtonShape } from "./carousel-utils.js";

/**
 * Canonical shape option triad shared by every shape selector in the editors
 * (carousel nav buttons, delete buttons, swatches, selectors). Defining it once
 * prevents the value/label drift that previously caused "Rounded" to map to
 * different stored values across cards.
 */
export const SHAPE_OPTIONS = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "round", label: "Round" },
];

export const PIXEL_STYLE_CHOICES = [
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
];
export const BG_COLOR_CHOICES = [
  { value: "transparent", label: "Transparent" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
];
export const SPACING_CHOICES = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "normal", label: "Normal" },
];

export function renderExperimentalAvailability(
  hass,
  targets,
  config,
  native = false,
) {
  if (!targets.length) return "";
  const disabled = [];
  const unknown = [];
  for (const entityId of targets) {
    const state = hass?.states?.[entityId];
    const name = state?.attributes?.friendly_name || entityId;
    const enabled = state?.attributes?.extended_effects_enabled;
    if (
      !state ||
      ["unavailable", "unknown"].includes(state.state) ||
      typeof enabled !== "boolean"
    ) {
      unknown.push(name);
    } else if (!enabled) {
      disabled.push(name);
    }
  }
  return html`<div class="experimental-availability" role="status">
    <strong>Experimental Features</strong>
    ${disabled.length
      ? html`<p>
          Off: ${disabled.join(", ")}. Experimental styles and effects are
          unavailable for these lamps. Enable Experimental Features in each
          lamp's device controls.
        </p>`
      : ""}
    ${unknown.length
      ? html`<p>
          Status unavailable: ${unknown.join(", ")}. Availability cannot be
          verified until these entities report their settings.
        </p>`
      : ""}
    ${!disabled.length && !unknown.length
      ? html`<p>On for all selected lamps.</p>`
      : ""}
    <p>
      Saved visibility and order are retained when experimental items are
      unavailable.
    </p>
  </div>`;
}

export function renderMatrixAppearanceSettings(
  config,
  onChange,
  { prefix = "lamp", defaultSize = 55, pixelFallback = "rounded" } = {},
) {
  const key = (name) => `${prefix}_${name}`;
  const choices = (label, name, items, fallback) =>
    html` <div class="form-row">
      <label>${label}</label>
      ${createButtonGroup(items, config[key(name)] || fallback, (event) =>
        onChange(key(name), event.currentTarget.dataset.value),
      )}
    </div>`;
  return html`
    ${createSliderRow(
      "Matrix Size",
      config[key("preview_size")] ?? defaultSize,
      { min: 30, max: 100, step: 5 },
      (event) => onChange(key("preview_size"), Number(event.target.value)),
      "%",
    )}
    ${choices(
      "Matrix Background Color",
      "matrix_background",
      BG_COLOR_CHOICES,
      "black",
    )}
    ${(config[key("matrix_background")] || "black") !== "black"
      ? renderModeSettingsSection(
          "Background Settings",
          createToggleRow(
            "Ignore Black Pixels",
            key("ignore_black_pixels"),
            config[key("ignore_black_pixels")] === true,
            (event) =>
              onChange(key("ignore_black_pixels"), event.target.checked),
          ),
        )
      : ""}
    ${choices(
      "Matrix Pixel Style",
      "pixel_style",
      PIXEL_STYLE_CHOICES,
      pixelFallback,
    )}
    ${choices("Pixel Spacing", "spacing_mode", SPACING_CHOICES, "normal")}
    ${createToggleRow(
      "Matrix Box Shadow",
      key("matrix_box_shadow"),
      config[key("matrix_box_shadow")] === true,
      (event) => onChange(key("matrix_box_shadow"), event.target.checked),
    )}
  `;
}

/**
 * Shared selector appearance rows (gradient + clock card editors):
 *  - "Item Shape"   → `selector_shape`        (cards / list items / chips)
 *  - "Button Shape" → `selector_button_shape` (carousel / wheel nav arrows,
 *    shown only when `showButtonShape` — i.e. the active style has buttons)
 * One definition so both editors stay identical in naming, order and keys.
 */
export function renderSelectorShapeRows(cfg, onChange, options = {}) {
  const { showButtonShape = false } = options;
  return html`
    <div class="form-row">
      <label>Item Shape</label>
      ${createButtonGroup(
        SHAPE_OPTIONS,
        cfg.selector_shape || "rounded",
        createButtonGroupChangeHandler("selector_shape", (value) =>
          onChange("selector_shape", value),
        ),
      )}
    </div>
    ${showButtonShape
      ? html`
          <div class="form-row">
            <label>Button Shape</label>
            ${createButtonGroup(
              SHAPE_OPTIONS,
              cfg.selector_button_shape || cfg.selector_shape || "rounded",
              createButtonGroupChangeHandler("selector_button_shape", (value) =>
                onChange("selector_button_shape", value),
              ),
            )}
          </div>
        `
      : ""}
  `;
}

/**
 * Dispatch a custom event, compatible with Home Assistant's event system.
 * Shared across all editor cards to avoid duplicating this helper.
 */
export function fireEvent(node, type, detail, options) {
  options = options || {};
  detail = detail === null || detail === undefined ? {} : detail;
  const event = new CustomEvent(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
    detail,
  });
  node.dispatchEvent(event);
}

export function renderEditorSection(id, title, open, onToggle, content) {
  return html`
    <div
      class="editor-card${open ? "" : " editor-card-collapsed"}"
      data-section=${id}
    >
      <div
        class="editor-card-header"
        role="button"
        tabindex="0"
        aria-expanded=${String(open)}
        aria-controls=${`section-${id}`}
        @click=${onToggle}
        @keydown=${(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        ${title}
        <ha-icon
          icon="mdi:chevron-up"
          style="transition:transform .3s;transform:rotate(${open
            ? 0
            : 180}deg);"
        ></ha-icon>
      </div>
      <div class="editor-card-content" id=${`section-${id}`} ?inert=${!open}>
        ${content}
      </div>
    </div>
  `;
}

/**
 * Collapsible sections for the card editors. The editor keeps which sections
 * are open in `this._open` ({sectionId: boolean}).
 */
export const EditorSectionsMixin = (Base) =>
  class extends Base {
    _section(id, title, content) {
      return renderEditorSection(
        id,
        title,
        !!this._open[id],
        () => this._toggleSection(id),
        content,
      );
    }

    _toggleSection(id) {
      this._open = { ...this._open, [id]: !this._open[id] };
    }
  };

/**
 * The shared base of the card editors: collapsible sections
 * (EditorSectionsMixin), the edited config in `this._config`, and the Home
 * Assistant editor contract. Editors may override _fireConfigChanged() to
 * add to the config they report (e.g. its `type`).
 */
export const YeelightEditorMixin = (Base) =>
  class extends EditorSectionsMixin(Base) {
    getConfig() {
      return this._config;
    }

    /** Report the edited config: a bubbling, composed config-changed from
     * this element, after which Home Assistant calls setConfig() on the
     * edited card's preview only. */
    _fireConfigChanged(config = this._config) {
      fireEvent(this, "config-changed", { config });
    }

    /** The lamp picker changed: the card now controls `value`. */
    _setTargets(value) {
      this._config = withTargetEntities(this._config, value);
      this.requestUpdate();
      this._fireConfigChanged();
    }

    /** Set one option (undefined removes it) and report the config. */
    _setOption(key, value) {
      const config = { ...this._config };
      if (value === undefined) delete config[key];
      else config[key] = value;
      this._config = config;
      this.requestUpdate();
      this._fireConfigChanged();
    }

    /**
     * The items of the card's gallery: which ones, in which order, and their
     * names on this card (item_labels). The same in every editor with a
     * gallery: every item is listed (names can always be edited); reordering,
     * adding or removing makes the list the card's own, and Reset shows every
     * item again (names are kept).
     *
     * @param {Object} options
     * @param {string} options.noun - what the items are ("style", "mode", ...)
     * @param {string[]} options.items - the keys the card shows, in order
     * @param {string[]} options.all - every key the card could show
     * @param {Function} options.labelFor - (key) => its built-in label
     * @param {Function} options.onList - (keys) => store the card's own list
     * @param {Function} options.onReset - () => back to every item
     * @param {Function} [options.indicatorsFor] - (key) => row badges
     */
    _galleryItemsSettings({
      noun,
      items,
      all,
      labelFor,
      onList,
      onReset,
      indicatorsFor,
    }) {
      return renderModeSettingsSection(
        `${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`,
        html`<div class="hint">
            Shown in this order. Edit a name to rename it on this card; Reset
            shows every ${noun} again.
          </div>
          ${renderOrderableList({
            items,
            available: all.filter((key) => !items.includes(key)),
            labelFor,
            indicatorsFor,
            labels: this._config?.item_labels || {},
            onRename: (key, label) => {
              this._config = withItemLabel(this._config, key, label);
              this.requestUpdate();
              this._fireConfigChanged();
            },
            onUpdate: (keys) => {
              onList(keys);
              this.requestUpdate();
              this._fireConfigChanged();
            },
            onReset: () => {
              onReset();
              this.requestUpdate();
              this._fireConfigChanged();
            },
            addPlaceholder: `Add a ${noun}…`,
            resetLabel: `Show all ${noun}s`,
          })}`,
      );
    }

    /**
     * The settings of the shared card frame (card-shell.js), first in every
     * card editor's Global Settings and in this order: title, lamps, card
     * background, lamp status (offered when the card controls lamps).
     *
     * @param {Object} options
     * @param {string} options.placeholder - the title field's placeholder
     * @param {"multiple"|"single"} [options.lamps] - the lamp picker's mode;
     *   omitted for a card without lamps
     * @param {string} [options.lampsHint] - what the chosen lamps are for
     */
    _cardFrameSettings({ placeholder, lamps, lampsHint = "" }) {
      const config = this._config || {};
      return html`
        <div class="form-row">
          <label for="title">Card Title (optional)</label>
          <input
            type="text"
            id="title"
            .value=${config.title ?? ""}
            placeholder=${placeholder}
            @input=${(event) =>
              this._setOption("title", event.target.value || undefined)}
          />
        </div>
        ${lamps
          ? html`<div class="form-row">
              <label>${lamps === "single" ? "Lamp" : "Lamps"}</label>
              ${lampsHint
                ? html`<div class="hint">${lampsHint}</div>`
                : ""}
              ${createYeelightCubeEntityPicker(
                this._hass ?? this.hass,
                getTargetEntities(config),
                (event) => this._setTargets(event.target.value),
                lamps,
              )}
            </div>`
          : ""}
        ${createToggleRow(
          "Show card background",
          "show_card_background",
          config.show_card_background !== false,
          (event) =>
            this._setOption("show_card_background", event.target.checked),
        )}
        ${lamps
          ? createToggleRow(
              "Show lamp status",
              "show_lamp_status",
              config.show_lamp_status === true,
              (event) =>
                this._setOption("show_lamp_status", event.target.checked),
            )
          : ""}
      `;
    }
  };

/**
 * Unified CSS styles for all editor cards.
 * Matches the color list editor card editor (the reference).
 * All editors should import this for consistent appearance.
 */
export const sharedEditorStyles = css`
  .experimental-availability {
    border-left: 3px solid var(--primary-color, #03a9f4);
    padding: 8px 12px;
    margin-bottom: 12px;
    color: var(--secondary-text-color, #666);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .experimental-availability strong {
    color: var(--primary-text-color, #333);
  }
  .experimental-availability p {
    margin: 6px 0 0;
  }
  /* What a setting is for, under its label (e.g. the lamp picker's). */
  .hint {
    font-size: 0.9em;
    color: var(--secondary-text-color, #666);
    margin-bottom: 8px;
  }
  /* Base editor layout */
  .editor-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px 8px 8px 8px;
  }

  /* Foldable card sections */
  .editor-card {
    background: var(--secondary-background-color, #f7fafd);
    border-radius: 14px;
    box-shadow: 0 2px 8px #0001;
    padding: 16px 18px 12px 18px;
    margin-bottom: 10px;
    position: relative;
  }
  .editor-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 1.15em;
    font-weight: 600;
    margin-bottom: 8px;
    cursor: pointer;
    user-select: none;
  }
  .editor-card-content {
    transition:
      max-height 0.3s,
      opacity 0.3s;
    overflow: hidden;
  }
  .editor-card-collapsed .editor-card-content {
    max-height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .editor-card:not(.editor-card-collapsed) .editor-card-content {
    max-height: 2000px;
    opacity: 1;
    pointer-events: auto;
  }

  /* Form rows — column layout: label above, control below (full-width) */
  .form-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    margin-bottom: 16px;
  }

  /* Labels */
  label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
  }

  /* Text inputs and selects */
  input[type="text"],
  input[type="number"],
  select {
    width: 100%;
    padding: 8px 12px;
    font-size: 1em;
    border-radius: 8px;
    border: 1px solid var(--divider-color, #cfd8dc);
    margin-top: 2px;
    box-sizing: border-box;
    background: var(--secondary-background-color, #f7f8fa);
  }

  /* Toggle switches — horizontal row: label left, toggle right */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .toggle-label {
    font-weight: 500;
    color: var(--primary-text-color, #333);
    font-size: 1em;
  }
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }
  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--divider-color, #cfd8dc);
    transition: 0.2s;
    border-radius: 24px;
  }
  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: var(--card-background-color, white);
    transition: 0.2s;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }
  input:checked + .toggle-slider {
    background-color: var(--primary-color, #1976d2);
  }
  input:checked + .toggle-slider:before {
    transform: translateX(20px);
  }

  /* Range slider styles */
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 2px;
    background: var(--divider-color, #e0e0e0);
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: var(--primary-color, #1976d2);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    border: none;
    transition: all 0.2s ease;
  }
  input[type="range"]::-moz-range-thumb {
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background: var(--primary-color, #1976d2);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    border: none;
    transition: all 0.2s ease;
  }

  /* Slider value display */
  .slider-value {
    font-weight: 600;
    color: var(--primary-text-color, #333);
    text-align: center;
    min-width: 45px;
    font-size: 0.9em;
  }
`;

/**
 * Renders a mode-specific settings section with consistent styling
 * Used for conditional settings that appear based on selected mode
 *
 * CONVENTION (read before adding any editor setting):
 * Any setting that is only meaningful when a parent toggle/mode is enabled MUST
 * be BOTH (1) gated by that condition (so it is hidden when inactive) AND
 * (2) wrapped in this blue section, so its dependency on the parent is visually
 * obvious. Never render a dependent setting as a bare form-row next to its
 * parent toggle. This prevents the recurring "orphaned conditional setting" bug.
 *
 * @param {string} title - Section title (e.g., "Carousel Mode Settings")
 * @param {TemplateResult} content - LitElement html template with settings controls
 * @returns {TemplateResult} Styled settings section
 */
export function renderModeSettingsSection(title, content) {
  return html`
    <div
      style="margin-top: 16px; margin-bottom: 16px; padding: 16px; background: color-mix(in srgb, var(--primary-color, #1976d2) 10%, var(--card-background-color, #fff)); border-radius: 8px; border-left: 4px solid var(--primary-color, #0077cc);"
    >
      <div
        style="font-weight: 600; font-size: 1.05em; margin-bottom: 12px; color: var(--primary-color, #0077cc);"
      >
        ${title}
      </div>
      ${content}
    </div>
  `;
}

/**
 * Renders a simple info message in a mode settings section
 * Used when a mode has no additional settings to configure
 *
 * @param {string} message - Message to display
 * @returns {TemplateResult} Styled info message
 */
export function renderModeInfoMessage(message) {
  return html`
    <div
      style="padding: 12px; background: var(--secondary-background-color, #f0f8ff); border-radius: 6px; color: var(--secondary-text-color, #666);"
    >
      ${message}
    </div>
  `;
}

/**
 * Convert the legacy `rounded_cards` config value into a 0-28 px slider value.
 * Shared across all editors so the "Card Roundness" slider behaves identically
 * everywhere and legacy values (true/false/"round"/"rounded"/"square") keep
 * working.
 *
 * @param {number|boolean|string|undefined} v - Raw rounded_cards config value
 * @returns {number} Slider value in pixels (0-28)
 */
export function roundedCardsToSliderValue(v) {
  if (v === undefined || v === true || v === "round") return 16;
  if (v === false || v === "square") return 0;
  if (v === "rounded") return 4;
  return typeof v === "number" ? v : parseInt(v, 10) || 16;
}

/**
 * Render the shared carousel navigation settings (button shape + wrap toggle)
 * used inside the "Carousel Mode Settings" block of the palette and draw
 * editors. Centralizes the canonical shape options so all carousels stay in
 * sync, while each editor keeps its own persistence via the provided callbacks.
 *
 * @param {Object} config - The editor's current config object
 * @param {Object} options
 * @param {string} options.shapeKey - Config key for the nav button shape
 * @param {string} [options.shapeDefault="rounded"] - Default shape when unset
 * @param {(value: string) => void} options.onShapeChange - Persists a new shape
 * @param {string} options.wrapKey - Config key for the wrap-navigation toggle
 * @param {(e: Event) => void} options.onWrapChange - Change handler for the toggle
 * @param {TemplateResult|string} [options.extra=""] - Optional extra rows appended
 * @returns {TemplateResult}
 */
export function renderCarouselNavSettings(config, options) {
  const {
    shapeKey,
    shapeDefault = "rounded",
    onShapeChange,
    wrapKey,
    onWrapChange,
    extra = "",
  } = options;
  return html`
    <div class="form-row">
      <label>Navigation Button Shape</label>
      ${createButtonGroup(
        SHAPE_OPTIONS,
        normalizeButtonShape(config[shapeKey] || shapeDefault),
        createButtonGroupChangeHandler(shapeKey, (value) =>
          onShapeChange(value),
        ),
      )}
    </div>
    ${createToggleRow(
      "Wrap Navigation (Infinite Loop)",
      wrapKey,
      config[wrapKey] === true,
      onWrapChange,
    )}
    ${extra}
  `;
}

/**
 * Render the shared "Delete Button" settings block used by the palette, draw
 * and color-list editors. Centralizes the markup and the boolean conversions
 * for the inside/left positions so every editor stays visually and behaviorally
 * identical.
 *
 * @param {Object} config - The editor's current config object
 * @param {Object} options
 * @param {string} [options.styleKey="remove_button_style"] - Config key that
 *   stores the delete-button style (remove_button_style)
 * @param {(key: string, value: *) => void} options.commit - Persists a config
 *   change using the host editor's own update mechanism. Values are already
 *   converted (booleans for inside/left) so the callback only needs to store
 *   and re-render.
 * @returns {TemplateResult}
 */
export function renderDeleteButtonSettings(config, options) {
  const { styleKey = "remove_button_style", commit } = options;
  const style = config[styleKey] || "default";
  return html`
    <div class="form-row">
      <label>Delete Button Style</label>
      ${createButtonGroup(
        [
          { value: "none", label: "None" },
          { value: "default", label: "Default" },
          { value: "glass", label: "Glass" },
          { value: "red", label: "Red" },
          { value: "black", label: "Black" },
          { value: "dot", label: "Dot" },
        ],
        style,
        createButtonGroupChangeHandler(styleKey, (value) =>
          commit(styleKey, value),
        ),
      )}
    </div>
    ${style !== "none"
      ? renderModeSettingsSection(
          "Delete Button Settings",
          html`
            <div class="form-row">
              <label>Button Shape</label>
              ${createButtonGroup(
                [
                  { value: "round", label: "Round" },
                  { value: "rounded", label: "Rounded" },
                  { value: "square", label: "Square" },
                ],
                config.delete_button_shape || "round",
                createButtonGroupChangeHandler("delete_button_shape", (value) =>
                  commit("delete_button_shape", value),
                ),
              )}
            </div>
            <div class="form-row">
              <label>Button Position</label>
              ${createButtonGroup(
                [
                  { value: "inside", label: "Inside" },
                  { value: "outside", label: "Outside" },
                ],
                config.delete_button_inside === true ? "inside" : "outside",
                createButtonGroupChangeHandler(
                  "delete_button_inside",
                  (value) => commit("delete_button_inside", value === "inside"),
                ),
              )}
            </div>
            <div class="form-row">
              <label>Delete Button Position</label>
              ${createButtonGroup(
                [
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ],
                config.delete_button_left === true ? "left" : "right",
                createButtonGroupChangeHandler("delete_button_left", (value) =>
                  commit("delete_button_left", value === "left"),
                ),
              )}
            </div>
          `,
        )
      : ""}
  `;
}
