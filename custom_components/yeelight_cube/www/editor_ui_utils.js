// Shared UI utilities for Home Assistant card editors
// Provides consistent form elements and styles

import {
  getTargetEntities,
  withTargetEntities,
} from "./service-call-utils.js";
import {
  createYeelightCubeEntityPicker,
  entitySelectorStyles,
} from "./entity-selector-utils.js";
import { html, css } from "./lib/lit-all.js";
import {
  createButtonGroup,
  createButtonGroupChangeHandler,
} from "./button-group-utils.js";
import {
  createToggleRow,
  createSliderRow,
  formRowStyles,
} from "./form-row-utils.js";
import { renderOrderableList } from "./orderable-list-utils.js";
import { notifyUnreported } from "./notify-utils.js";
import {
  USER_COLLECTIONS,
  CollectionStore,
  collectionThumbnail,
  singleMove,
} from "./user-collections.js";
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
      ? renderSettingsBox(
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
// Item Shape (and Button Shape for layouts with arrows) of the shared
// gallery; "Custom" sets the item corner radius in px (item_radius).
export function renderSelectorShapeRows(cfg, onChange, options = {}) {
  const { showButtonShape = false } = options;
  const shape = cfg.selector_shape || "rounded";
  return html`
    <div class="form-row">
      <label>Item Shape</label>
      ${createButtonGroup(
        [...SHAPE_OPTIONS, { value: "custom", label: "Custom" }],
        shape,
        createButtonGroupChangeHandler("selector_shape", (value) =>
          onChange("selector_shape", value),
        ),
      )}
    </div>
    ${shape === "custom"
      ? createSliderRow(
          "Item Radius",
          cfg.item_radius ?? 12,
          { min: 0, max: 28, step: 1 },
          (event) => onChange("item_radius", Number(event.target.value)),
          "px",
        )
      : ""}
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
        <div class="editor-card-body">${content}</div>
      </div>
    </div>
  `;
}

/**
 * Collapsible sections for the card editors. The editor keeps which sections
 * are open in `this._open` ({sectionId: boolean}). An editor opens on its
 * first section, Global Settings (the lamp, title and card frame: what a new
 * card needs first); its id is the editor's static `openSection`.
 */
export const EditorSectionsMixin = (Base) =>
  class extends Base {
    static openSection = "global";

    constructor() {
      super();
      this._open = { [this.constructor.openSection]: true };
    }

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

    /** The edited config is now `config`: shown and reported. */
    _commitConfig(config) {
      this._config = config;
      this.requestUpdate();
      this._fireConfigChanged();
    }

    /** The lamp picker changed: the card now controls `value`. */
    _setTargets(value) {
      this._commitConfig(withTargetEntities(this._config, value));
    }

    /** Set one option (undefined removes it) and report the config. */
    _setOption(key, value) {
      this._setOptions({ [key]: value });
    }

    /** Set several options at once (undefined removes one): one report. */
    _setOptions(changes) {
      const config = { ...this._config };
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete config[key];
        else config[key] = value;
      }
      this._commitConfig(config);
    }

    /** The card's preview appearance rows of `section` (its profile is the
     * editor's static appearanceProfile). */
    _renderAppearance(section) {
      return html`<yeelight-preview-appearance-editor
        profile=${this.constructor.appearanceProfile}
        section=${section}
        .owner=${this}
        .config=${this._config}
        @appearance-changed=${(event) => this._commitConfig(event.detail.config)}
      ></yeelight-preview-appearance-editor>`;
    }

    /** A toggle row's change: `key` takes the switch's state. */
    _onSwitchChange(event, key) {
      this._setOption(key, event.target.checked);
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
     * @param {Function} options.onList - (keys) => the config with the card's
     *   own list
     * @param {Function} options.onReset - () => the config showing every item
     *   (or the default ones: `resetLabel`)
     * @param {string} [options.title] - the box's title (default: the noun's plural)
     * @param {string} [options.resetLabel] - what Reset shows (default:
     *   every item)
     */
    _galleryItemsSettings({
      noun,
      items,
      all,
      labelFor,
      onList,
      onReset,
      title,
      resetLabel = `Show all ${noun}s`,
    }) {
      return renderSettingsBox(
        title || `${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`,
        html`<div class="hint">
            Shown in this order. Edit a name to rename it on this card;
            "${resetLabel}" brings the list back.
          </div>
          ${renderOrderableList({
            items,
            available: all.filter((key) => !items.includes(key)),
            labelFor,
            labels: this._config?.item_labels || {},
            onRename: (key, label) =>
              this._commitConfig(withItemLabel(this._config, key, label)),
            onUpdate: (keys) => this._commitConfig(onList(keys)),
            onReset: () => this._commitConfig(onReset()),
            addPlaceholder: `Add a ${noun}…`,
            resetLabel,
          })}`,
      );
    }

    /**
     * Arrange: the order of one of the user's collections (`kind`:
     * "palettes", "pixel_arts"; user-collections.js), the same block in
     * every editor of a card showing it. The order is the backend's, shared
     * by every card and lamp: dragging a row or ▲ / ▼ moves one item
     * (move_palette / move_pixel_art, with the name expected at its index,
     * so a list another client changed is refused, never scrambled). The new
     * order shows at once and holds until the sensor confirms it.
     * Nothing is added or removed here: palettes and pixel arts are created,
     * renamed and deleted on the cards.
     */
    _arrangeSettings(kind) {
      const { noun } = USER_COLLECTIONS[kind];
      // The cards' collection store: the freshest array, a move shown at
      // once until the backend confirms it.
      const store = ((this._arrangeStores ||= {})[kind] ||= new CollectionStore(
        kind,
        { onChange: () => this.requestUpdate() },
      ));
      store.update(this._hass, this._config);
      const items = store.items(this._hass, this._config);
      return renderSettingsBox(
        `Arrange ${noun}s`,
        html`<div class="hint">
            The order of your ${noun}s on every card and lamp. Drag a ${noun},
            or use ▲ ▼ (one step) and ⤒ ⤓ (to the top or the bottom): each
            move is saved at once.
          </div>
          ${items.length
            ? renderOrderableList({
                items: items.map((_, index) => String(index)),
                available: [],
                addable: false,
                removable: false,
                labelFor: (key) => items[key]?.name || `${noun} ${+key + 1}`,
                thumbFor: (key) => collectionThumbnail(kind, items[key]),
                onUpdate: (keys) =>
                  this._moveCollectionItem(kind, keys.map(Number), items),
              })
            : html`<div class="hint">No ${noun}s yet.</div>`}`,
      );
    }

    // One move of the Arrange block: shown at once, then saved; rolled back
    // (and reported) when refused.
    async _moveCollectionItem(kind, newOrder, items) {
      const move = singleMove(newOrder, items);
      if (!move) return false;
      return this._arrangeStores[kind].edit(
        this._hass,
        newOrder.map((index) => items[index]),
        USER_COLLECTIONS[kind].moveService,
        move,
        { onError: (error) => notifyUnreported(this, error) },
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
  ${entitySelectorStyles}
  /* A framed group of settings (renderSettingsBox). */
  .yc-settings-box {
    margin: 16px 0;
    padding: 16px;
    background: color-mix(in srgb, var(--primary-color, #1976d2) 10%, var(--card-background-color, #fff));
    border-radius: 8px;
    border-left: 4px solid var(--primary-color, #0077cc);
  }
  .yc-settings-box-title {
    font-weight: 600;
    font-size: 1.05em;
    margin-bottom: 12px;
    color: var(--primary-color, #0077cc);
  }
  /* Inside another box: a titled group, without a second frame. */
  .yc-settings-box .yc-settings-box {
    margin: 12px 0 0;
    padding: 0;
    background: none;
    border-radius: 0;
    border-left: none;
  }
  .yc-settings-box .yc-settings-box > .yc-settings-box-title {
    font-size: 0.95em;
    margin-bottom: 8px;
  }
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
  /* Opening / closing animates the content's grid row (0fr <-> 1fr): any
     height, never cut (a max-height cap clipped long sections). */
  .editor-card-content {
    display: grid;
    grid-template-rows: 1fr;
    transition:
      grid-template-rows 0.3s,
      opacity 0.3s;
  }
  .editor-card-body {
    min-height: 0;
    overflow: hidden;
  }
  .editor-card-collapsed .editor-card-content {
    grid-template-rows: 0fr;
    opacity: 0;
    pointer-events: none;
  }
  .editor-card:not(.editor-card-collapsed) .editor-card-content {
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

  /* Toggle switches (createToggleRow): formRowStyles */
  ${formRowStyles}

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
 * A framed box of settings (.yc-settings-box): the settings of a chosen
 * mode, layout or option. Inside another box it shows as a titled group
 * without a second frame.
 *
 * CONVENTION (read before adding any editor setting):
 * Any setting that is only meaningful when a parent toggle/mode is enabled MUST
 * be BOTH (1) gated by that condition (so it is hidden when inactive) AND
 * (2) wrapped in this box, so its dependency on the parent is visually
 * obvious. Never render a dependent setting as a bare form-row next to its
 * parent toggle. This prevents the recurring "orphaned conditional setting" bug.
 *
 * @param {string} title - Section title (e.g., "Carousel Mode Settings")
 * @param {TemplateResult} content - LitElement html template with settings controls
 * @returns {TemplateResult} The settings box
 */
export function renderSettingsBox(title, content) {
  return html`<div class="yc-settings-box">
    <div class="yc-settings-box-title">${title}</div>
    ${content}
  </div>`;
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
      ? renderSettingsBox(
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
