/**
 * The plumbing every Yeelight Cube card shares, so a card only describes what
 * it shows. Cards extend `YeelightCardMixin(LitElement)` (alongside their own
 * mixins) and keep their own `hass` accessors and lifecycle extras.
 *
 * Provided:
 * - getConfigElement(): loads the card's editor on demand (`static editor`).
 * - this._commands: the card's ordered service queue (card-command-controller);
 *   override _commandsChanged() to follow its busy/error state.
 * - this._targets: the lamps the card controls (target_entities, else entity).
 * - this._showCardBackground: the shared `show_card_background` option.
 * - _inputsChanged(inputs): whether anything the card reads from `hass` was
 *   replaced since the last call (Home Assistant hands out a new hass object
 *   on every state push anywhere).
 * - _autoResolveSensor(key, fragment, hass): fills a missing collection-sensor
 *   option (palette_sensor, pixelart_sensor) from the entities.
 * - connectedCallback(): binds delegated data-on-* handlers when the card
 *   declares `static hostEvents` (host-events.js).
 */
import { CardCommandController } from "./card-command-controller.js";
import { getTargetEntities } from "./service-call-utils.js";
import { bindHostEvents } from "./host-events.js";
import { findCollectionSensor } from "./sensor-lookup.js";

/** The Yeelight Cube lamps of this Home Assistant, in entity order: lights
 * carrying the integration's marker attribute, or (older states) a Cube
 * entity id. Used for the stub config of a newly added card. */
export function cubeLampEntities(hass) {
  return Object.entries(hass?.states || {})
    .filter(
      ([id, state]) =>
        id.startsWith("light.") &&
        (state?.attributes?._yeelight_cube_component ||
          id.startsWith("light.yeelight_cube") ||
          id.startsWith("light.cubelite_")),
    )
    .map(([id]) => id);
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

    get _targets() {
      return getTargetEntities(this.config || {});
    }

    get _showCardBackground() {
      return this.config?.show_card_background !== false;
    }

    _inputsChanged(inputs) {
      const last = this._lastHassInputs;
      this._lastHassInputs = inputs;
      return (
        !last ||
        last.length !== inputs.length ||
        inputs.some((value, index) => value !== last[index])
      );
    }

    /** Fill config[key] from the first sensor whose id contains `fragment`
     * when the user left it unset. Pass the card as memo owner from `set
     * hass` (throttles retries), omit it from setConfig. */
    _autoResolveSensor(key, fragment, hass, memoOwner = null) {
      if (!this.config || this.config[key] || !hass) return;
      const sensor = findCollectionSensor(hass, fragment, memoOwner);
      if (sensor) this.config = { ...this.config, [key]: sensor };
    }

    connectedCallback() {
      super.connectedCallback();
      const handlers = this.constructor.hostEvents;
      if (handlers) bindHostEvents(this, handlers);
    }
  };
