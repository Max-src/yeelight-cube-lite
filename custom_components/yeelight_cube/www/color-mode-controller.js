import { createPendingValue } from "./pending-value.js";
import { closeColorPicker } from "./color-picker-utils.js";
import { shareShownPalette } from "./service-call-utils.js";
import {
  clockColorModeOptions,
  clockPresetLibrary,
  clockPresetsByKind,
  watchClockPresets,
} from "./clock-preset-utils.js";
import { NATIVE_COLOR_MODES } from "./clock-preview-utils.js";

/** The Clock card's color modes: its set_clock_style command. */
export const CLOCK_CARD_COLORS = Object.freeze({
  service: "set_clock_style",
  attribute: "clock_color_mode",
  label: "Clock",
});

/** The Native Effects card's color modes: its set_native_effect command. */
export const NATIVE_CARD_COLORS = Object.freeze({
  service: "set_native_effect",
  attribute: "native_effect_color_mode",
  label: "NativeEffects",
});

/**
 * The Color Modes row the Clock and Native Effects cards share
 * (color-mode-ui.js), the way mode-controls-controller.js shares their
 * selection: the choices (built-in modes and the saved colors), the pick
 * shown at once until the lamp reports it, the picker at the row's Add and
 * the card's commands, which first give every lamp the shown palette in the
 * Palette color mode. What a pick sends and how the lamp's state reads as a
 * mode stay with each card. `kind`: CLOCK_CARD_COLORS or
 * NATIVE_CARD_COLORS.
 */
export class ColorModeController {
  constructor(card, kind) {
    this.card = card;
    this.kind = kind;
    this._click = 0;
    // A clicked color mode or saved color (pending-value.js): shown at once,
    // kept until the lamp reports it (or another mode: another dashboard
    // wins), or for 5 s; dropped if the request fails.
    this.pending = createPendingValue({
      onExpire: () => card.isConnected && card.requestUpdate(),
      yieldToLamp: true,
    });
  }

  /** The card is on the page: it renders again when the shared preset
   * library changes here (clock-preset-utils.js watchClockPresets). */
  connect() {
    this._presetsOff = watchClockPresets(this.card);
  }

  /** The card left the page: its picker closes. */
  disconnect() {
    this._presetsOff?.();
    closeColorPicker(this.card);
  }

  /** The saved colors (the shared preset library's color modes). */
  presets() {
    return clockPresetsByKind(clockPresetLibrary(this.card._hass), "color_mode");
  }

  /** The saved color a choice names ("custom:<id>"), or undefined. */
  preset(value) {
    return this.presets().find((preset) => `custom:${preset.id}` === value);
  }

  /** The row's choices: Normal, Custom (with `custom`, the saved colors and
   * Add too), then the palettes, in the card's order. */
  options(custom = true) {
    const options = clockColorModeOptions(
      NATIVE_COLOR_MODES,
      custom ? clockPresetLibrary(this.card._hass) : [],
      this.card.config,
    );
    return custom ? options : options.filter((option) => option.value !== "__pick__");
  }

  /** The choice shown: a pick the lamp does not report yet, else `lamp`. */
  selection(lamp) {
    this.pending.settle(lamp);
    return this.pending.value ?? lamp;
  }

  /** Another color command replaces a pending pick (its echo is not
   * awaited). */
  drop() {
    this._click += 1;
    this.pending.clear();
  }

  /** Show `value` at once for the request `sent` (a promise of success):
   * kept once sent, dropped if it fails, unless a newer click owns the
   * highlight (compared by click, not value: A, B, A must not clear on the
   * first A). Resolves to the request's success; the card renders the
   * held pick. */
  show(value, sent) {
    const click = (this._click += 1);
    this.pending.hold(value);
    const settle = (ok) => {
      if (this._click !== click) return;
      if (ok) this.pending.set(value);
      else this.pending.clear();
      this.card.requestUpdate();
    };
    return Promise.resolve(sent).then(
      (ok) => {
        settle(ok);
        return ok;
      },
      (error) => {
        settle(false);
        throw error;
      },
    );
  }

  /** The color picker at the row's Add (color-mode-ui), from `initial`. */
  openPicker(initial, onPick) {
    this.card.shadowRoot
      ?.querySelector("yeelight-color-mode")
      ?.openAddPicker(this.card, initial, onPick);
  }

  /** The color mode and color a favourite's command sends: a custom color
   * as Normal with that color, else its mode, with `color` ("clear": none). */
  favouriteColor(favourite, color = "clear") {
    const custom = favourite.colorMode === "custom";
    return {
      color_mode: custom ? "normal" : favourite.colorMode,
      color: custom ? favourite.color : color,
    };
  }

  /**
   * One of the card's commands, rotation-aware (mode controller send). In
   * the Palette color mode (sent, or the lamp's) every lamp first gets the
   * palette the card shows (shareShownPalette): each lamp otherwise draws
   * its own. The command is sent even when that fails.
   */
  async send(service, data, { domain = "yeelight_cube", managed = false, ...options } = {}) {
    const card = this.card;
    if (
      service === this.kind.service &&
      (data.color_mode ?? card._attrs()[this.kind.attribute]) === "palette"
    ) {
      try {
        await shareShownPalette(card._hass, card.config, card._primaryEntity());
      } catch (error) {
        console.error(`[${this.kind.label}] Could not share the palette:`, error);
      }
    }
    return card._controls.send(service, data, { domain, managed, ...options });
  }
}
