/**
 * The plumbing every Yeelight Cube card shares, so a card only describes what
 * it shows. Cards extend `YeelightCardMixin(LitElement)` (alongside their own
 * mixins) and keep their own `hass` accessors and lifecycle extras.
 *
 * Provided:
 * - getConfigElement(): loads the card's editor on demand (`static editor`).
 * - this._commands: the card's ordered service queue (card-command-controller);
 *   override _commandsChanged() to follow its busy/error state.
 * - callServiceOnTargetEntities(service, data, options): one call of a
 *   yeelight_cube service for all the card's lamps, through that queue.
 * - this._targets: the lamps the card controls (target_entities, else entity);
 *   _primaryEntity(): its main lamp: the first available one, else the
 *   first Home Assistant knows (lampAvailable, service-call-utils.js).
 * - this._gate: holds the card's renders while the user interacts
 *   (render-gate.js); a held render is made by _renderHeld() (default: a Lit
 *   update).
 * - this._showCardBackground: the shared `show_card_background` option.
 * - _hassChanged(hass): whether a `hass` push changes anything the card
 *   shows (Home Assistant hands out a new hass object on every state push
 *   anywhere). What the card reads is its _hassInputs(hass) (default: its
 *   config and its lamps' states; a card reading less or more overrides
 *   it), plus the header's lamp status when shown. Every card's `set hass`
 *   starts with it.
 * - _autoResolveSensor(key, kind, hass): fills a collection-sensor option
 *   (palette_sensor, pixelart_sensor) left unset, or naming a sensor that no
 *   longer exists (renamed), with the one found (sensor-lookup.js).
 * - connectedCallback(): binds delegated data-on-* handlers when the card
 *   declares `static hostEvents` (host-events.js).
 */
import { CardCommandController } from "./card-command-controller.js";
import { getTargetEntities, lampAvailable } from "./service-call-utils.js";
import { noteThemes } from "./color-utils.js";
import { bindHostEvents } from "./host-events.js";
import { findCollectionSensor } from "./sensor-lookup.js";
import { RenderGate } from "./render-gate.js";

/** The Yeelight Cube lamps of this Home Assistant, in entity order: lights
 * this integration registered (the entity registry: renamed or unavailable
 * lamps too), carrying its marker attribute, or (older states) with a Cube
 * entity id. The stub config of a new card and the editors' lamp picker. */
export function cubeLampEntities(hass) {
  return Object.entries(hass?.states || {})
    .filter(
      ([id, state]) =>
        id.startsWith("light.") &&
        (hass.entities?.[id]?.platform === "yeelight_cube" ||
          state?.attributes?._yeelight_cube_component ||
          id.startsWith("light.yeelight_cube") ||
          id.startsWith("light.cubelite_")),
    )
    .map(([id]) => id);
}

const VALUE_KEYS = new WeakMap();

/**
 * A value to compare by content: its JSON, computed once per object. Home
 * Assistant hands out new arrays (text_colors, matrix_colors...) with every
 * attribute change of a lamp, so equal lists get equal keys while each array
 * is stringified only once.
 */
export function valueKey(value) {
  if (value === null || typeof value !== "object") return value;
  let key = VALUE_KEYS.get(value);
  if (key === undefined) {
    key = JSON.stringify(value);
    VALUE_KEYS.set(value, key);
  }
  return key;
}

/**
 * Masonry height (50 px rows) of a card whose main part is a gallery, by its
 * layout: the list and grid stack the most, the carousel the least.
 */
export function galleryCardSize(style) {
  if (["preview-list", "preview-grid", "preview-mosaic"].includes(style)) return 8;
  if (style === "preview-wheel") return 5;
  return 4;
}

export const YeelightCardMixin = (Base) =>
  class extends Base {
    /** [tag, module] of the card's editor, loaded on demand. */
    static editor = null;

    /** A predicate over handler names for bindHostEvents, or null. */
    static hostEvents = null;

    static async getConfigElement() {
      const [tag, module] = this.editor;
      if (!customElements.get(tag)) await import(module);
      return document.createElement(tag);
    }

    constructor() {
      super();
      this._commands = new CardCommandController(() => this._commandsChanged());
    }

    /** Called when the command queue's busy/error state changes. */
    _commandsChanged() {}

    /** One call of `service` for all the card's lamps (the backend runs
     * them in parallel), through the command queue. Rejects on failure
     * (Home Assistant has shown it). */
    callServiceOnTargetEntities(service, data = {}, options = {}) {
      return this._commands.request(this._hass, this.config, service, data, options);
    }

    get _targets() {
      return getTargetEntities(this.config || {});
    }

    /** The card's render gate (created on first use). */
    get _gate() {
      return (this.__gate ||= new RenderGate(() => this._renderHeld()));
    }

    /** Make a render the gate held. */
    _renderHeld() {
      this.requestUpdate();
    }

    /** The card's main lamp: the first configured lamp Home Assistant
     * knows, else the first configured (the card then says it is missing),
     * else "". */
    _primaryEntity(hass = this._hass) {
      const targets = this._targets;
      return (
        targets.find((id) => lampAvailable(hass?.states?.[id])) ??
        targets.find((id) => hass?.states?.[id]) ??
        targets[0] ??
        ""
      );
    }

    /** Height in masonry dashboards, in 50 px rows (static cardSize). */
    getCardSize() {
      return this.constructor.cardSize ?? 4;
    }

    /**
     * Size in Sections dashboards: Home Assistant's default (full width,
     * the content's height), never narrower than the card's minColumns of
     * the 12 (static minColumns).
     */
    getGridOptions() {
      return {
        columns: 12,
        rows: "auto",
        min_columns: this.constructor.minColumns ?? 6,
      };
    }

    get _showCardBackground() {
      return this.config?.show_card_background !== false;
    }

    /**
     * What the card shows from `hass`, compared value by value (=== : Home
     * Assistant keeps unchanged state objects and attribute values by
     * reference) with the previous push. Narrower inputs mean fewer renders.
     */
    _hassInputs(hass) {
      return [this.config, ...this._targets.map((id) => hass?.states?.[id])];
    }

    /** Which of the card's lamps exist and are available, as one string
     * (per lamp: 0 missing, 1 unavailable, 2 available, then the time of its
     * last failed change if any): the frame names the missing and offline
     * ones and those failed changes, and the card shows the first available. */
    _lampsKey(hass = this._hass) {
      return this._targets
        .map((id) => {
          const state = hass?.states?.[id];
          const failed = state?.attributes?.last_command_error?.at;
          return (state ? (lampAvailable(state) ? 2 : 1) : 0) + (failed ? `@${failed}` : "");
        })
        .join("");
    }

    /**
     * Whether this `hass` changes anything the card shows: its _hassInputs,
     * and the frame's (card-shell.js): the header's lamp status when shown,
     * and which of the card's lamps exist and are available (_lampsKey). It
     * records the inputs: call it once per `set hass`.
     */
    _hassChanged(hass) {
      noteThemes(hass?.themes); // the dark-theme answers follow it
      const lamp =
        this.config?.show_lamp_status === true
          ? hass?.states?.[this._primaryEntity(hass)]
          : undefined;
      const inputs = [
        ...this._hassInputs(hass),
        lamp?.state,
        lamp?.attributes?.content_mode,
        this._lampsKey(hass),
      ];
      const last = this._lastHassInputs;
      this._lastHassInputs = inputs;
      return (
        !last ||
        last.length !== inputs.length ||
        inputs.some((value, index) => value !== last[index])
      );
    }

    /** Fill config[key] with the `kind` collection's sensor ("palettes",
     * "pixel_arts"; sensor-lookup.js) when the user left it unset or it
     * names a sensor that no longer exists (renamed). Pass the card as memo
     * owner from `set hass` (throttles retries), omit it from setConfig. */
    _autoResolveSensor(key, kind, hass, memoOwner = null) {
      if (!this.config || !hass?.states) return;
      const current = this.config[key];
      if (current && hass.states[current]) return;
      const sensor = findCollectionSensor(hass, kind, memoOwner);
      if (sensor && sensor !== current)
        this.config = { ...this.config, [key]: sensor };
    }

    connectedCallback() {
      super.connectedCallback();
      const handlers = this.constructor.hostEvents;
      if (handlers) bindHostEvents(this, handlers);
    }
  };
