// Color adjustment controls of the lamp preview card: applying and resetting
// effects, change tracking, the compact layout and the adjustment categories
// in the shared section layouts (<yc-sections>, section-layouts.js). Mixed
// into YeelightCubeLampPreviewCard.
import "./section-layouts.js";
import {
  EFFECT_NAMES,
  EFFECT_ATTR_MAP,
  EFFECT_DEFAULTS,
  SECTIONS_REGISTRY,
  EFFECTS_REGISTRY,
} from "./lamp-preview-effects.js";
import { html, nothing } from "./lib/lit-all.js";
import { createPendingMap } from "./pending-value.js";
import { isDarkTheme } from "./color-utils.js";

export const AdjustmentControlsMixin = (Base) => class extends Base {
  // The adjustments shown before the lamp reports them (a moved slider, a
  // reset), one pending value each (pending-value.js): held while a slider
  // moves, then dropped once the lamp reports it -- or reports another value
  // (another dashboard wins) -- or after 5 s.
  get _pendingEffects() {
    return (this.__pendingEffects ||= createPendingMap({
      matches: (actual, value) => Math.abs(Number(actual) - value) < 0.5,
      yieldToLamp: true,
      onExpire: () => this.isConnected && this._refresh(),
    }));
  }

  // An adjustment's value: shown before the lamp has it, else the lamp's,
  // else its default.
  _effectValue(name, stateObj) {
    return (
      this._pendingEffects.value(name) ??
      stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ??
      EFFECT_DEFAULTS[name] ??
      0
    );
  }

  // Each value just sent is kept until the lamp reports it (a newer move
  // keeps its own).
  _sentEffects(effects) {
    for (const [name, value] of Object.entries(effects))
      if (this._pendingEffects.value(name) === value)
        this._pendingEffects.set(name, value);
  }

  async handleEffectChange(effectName, event) {
    const newValue = parseInt(event.target.value);
    if (!this._hass || !this.config || !this._primaryEntity() || isNaN(newValue)) {
      return;
    }

    // Shown at once (the label and the change dot follow on render).
    this._pendingEffects.hold(effectName, newValue);

    // Auto-enable tint: changing Tint Hue without Tint Strength does nothing
    // visually, which feels broken. Auto-set Tint Strength to 50% when the
    // user starts changing Tint Hue and strength is currently 0.
    if (effectName === "tint_hue" && newValue !== 0) {
      const stateObj = this._hass?.states?.[this._primaryEntity()];
      if (!stateObj) return;
      if (this._effectValue("tint_strength", stateObj) === 0) {
        // The tint_strength slider and label follow on render.
        this._pendingEffects.hold("tint_strength", 50);
      }
    }

    // The change dots and "changed"-mode reset buttons follow on render.
    this.requestUpdate();

    // Debounce the service call
    if (this._effectDebounceTimer) {
      clearTimeout(this._effectDebounceTimer);
    }

    const context = this._effectContext;
    const entityId = this._primaryEntity();
    const hass = this._hass;
    this._effectDebounceTimer = setTimeout(async () => {
      if (context !== this._effectContext) return;
      this._effectDebounceTimer = null;

      try {
        // Get all current effect values
        const stateObj = hass.states?.[entityId];
        if (!stateObj) return;
        const _tSvc = performance.now();
        const effects = {};
        for (const name of EFFECT_NAMES)
          effects[name] = this._effectValue(name, stateObj);

        const sent = await this._commands.call(
          hass,
          "yeelight_cube",
          "set_preview_adjustments",
          { entity_id: entityId, ...effects },
          // Each call carries every adjustment, so a newer one waiting in
          // the queue replaces this one.
          { coalesce: "adjustments" },
        );

        // Kept until the lamp reports them (_settleEffects).
        if (sent === true && context === this._effectContext)
          this._sentEffects(effects);
      } catch (error) {
        if (context !== this._effectContext) return;
        // Revert to entity state on error
        this._pendingEffects.clear(effectName);
        this._refresh();
        console.error("Error setting effect:", error);
      }
    }, 300); // Faster response for effects
  }

  // The lamp's state arrived: drop the values it now reports (no value
  // reported reads as the default).
  _settleEffects(stateObj) {
    for (const name of this._pendingEffects.keys())
      this._pendingEffects.settle(
        name,
        stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ?? EFFECT_DEFAULTS[name],
      );
  }

  async resetSection(sectionId) {
    // Derive section defaults from SECTIONS_REGISTRY + EFFECT_DEFAULTS
    const section = SECTIONS_REGISTRY.find((s) => s.id === sectionId);
    if (!section) {
      console.error("? Unknown section ID:", sectionId);
      return;
    }
    const defaultValues = {};
    for (const name of section.effects) {
      defaultValues[name] = EFFECT_DEFAULTS[name];
    }

    // Get current state from entity
    const stateObj = this._hass?.states?.[this._primaryEntity()];
    if (!stateObj) return;

    // Every effect as shown, this section's at their defaults (the sliders
    // move at once).
    const allEffects = {};
    for (const name of EFFECT_NAMES) allEffects[name] = this._effectValue(name, stateObj);
    for (const [effectName, value] of Object.entries(defaultValues)) {
      allEffects[effectName] = value;
      this._pendingEffects.hold(effectName, value);
    }
    this.requestUpdate();

    // Send everything to the lamp (only this section's values changed); the
    // defaults show until the lamp reports them (_settleEffects).
    if (await this._sendReset(defaultValues, allEffects)) {
      this._sentEffects(defaultValues);
      this._settleEffects(this._hass?.states?.[this._primaryEntity()]);
    }

    // The change dots and reset buttons follow on render.
    this.requestUpdate();
  }

  // Send a reset whose defaults are already shown. If the lamp refuses it,
  // drop those defaults again (unless the user moved a slider meanwhile) so
  // the controls show what the lamp really has. True once sent.
  async _sendReset(defaults, allEffects) {
    const context = this._effectContext;
    try {
      const sent = await this._commands.call(
        this._hass,
        "yeelight_cube",
        "set_preview_adjustments",
        { entity_id: this._primaryEntity(), ...allEffects },
      );
      return sent === true && context === this._effectContext;
    } catch (error) {
      if (context !== this._effectContext) return false;
      for (const [name, value] of Object.entries(defaults))
        if (this._pendingEffects.value(name) === value) this._pendingEffects.clear(name);
      this._refresh();
      console.error("[lamp-preview] Reset failed:", error);
      return false;
    }
  }

  async resetEffect(effectName) {
    // Reset a single effect to its default value (for compact layout)
    const defaultValue = EFFECT_DEFAULTS[effectName] ?? 0;

    // Get current state from entity
    const stateObj = this._hass?.states?.[this._primaryEntity()];
    if (!stateObj) return;

    // Build the effects object with all current values
    const allEffects = {};
    Object.keys(EFFECT_ATTR_MAP).forEach((effect) => {
      const attrName = EFFECT_ATTR_MAP[effect];
      if (attrName && stateObj.attributes[attrName] !== undefined) {
        allEffects[effect] =
          this._pendingEffects.value(effect) ?? stateObj.attributes[attrName];
      }
    });

    // Update only this effect to default
    allEffects[effectName] = defaultValue;
    this._pendingEffects.hold(effectName, defaultValue);
    this.requestUpdate();

    // Send to the lamp
    if (
      await this._sendReset({ [effectName]: defaultValue }, allEffects)
    ) {
      // Keep showing the default until the entity echoes it.
      this._sentEffects({ [effectName]: defaultValue });
      this._settleEffects(this._hass?.states?.[this._primaryEntity()]);
    }

    // The change dots and reset buttons follow on render.
    this.requestUpdate();
  }

  // Whether an effect differs from its default: its pending local value,
  // else the lamp's.
  _checkEffectChanged(effectName) {
    const stateObj = this._hass?.states?.[this._primaryEntity()];
    if (!stateObj) return false;
    const defaultValue = EFFECT_DEFAULTS[effectName] ?? 0;
    return Math.abs(this._effectValue(effectName, stateObj) - defaultValue) > 0.1;
  }

  // Whether any effect of the category changed.
  _checkSectionChanges(sectionId) {
    const section = SECTIONS_REGISTRY.find((item) => item.id === sectionId);
    return !!section?.effects.some((name) => this._checkEffectChanged(name));
  }

  // Current value of every effect: local (optimistic) value, then entity
  // attribute, then the registry default.
  _currentEffects(stateObj) {
    const effects = {};
    for (const name of EFFECT_NAMES) effects[name] = this._effectValue(name, stateObj);
    return effects;
  }

  // Section / effect view data derived from SECTIONS_REGISTRY + EFFECTS_REGISTRY.
  _adjustmentSections(effects) {
    return SECTIONS_REGISTRY.map((section) => ({
      id: section.id,
      title: section.title,
      icon: section.icon,
      description: section.description,
      effects: section.effects.map((name) => {
        const def = EFFECTS_REGISTRY[name];
        return {
          name,
          label: def.label,
          icon: def.icon,
          min: def.min,
          max: def.max,
          value: effects[name],
          unit: def.unit,
          default: def.default,
          ...(def.hint && { hint: def.hint }),
        };
      }),
    }));
  }

  _adjustmentControlsTemplate(effects) {
    const cfg = this.config;
    const sections = this._adjustmentSections(effects);
    const layout = cfg.adjustments_layout || "grouped";
    const showIndicators = cfg.show_change_indicators ?? true;
    const border = cfg.adjustments_card_border || "none";
    const dark = isDarkTheme(this, this._hass);
    return html`<yc-sections
      layout=${layout}
      .sections=${sections.map((section) => ({
        key: section.id,
        title: section.title,
        icon: section.icon,
        description: section.description,
        marked: showIndicators && this._checkSectionChanges(section.id),
        action: (shown) => this._sectionReset(section, shown),
        content: (shown) => this._sectionRows(section, shown),
      }))}
      .options=${{
        style: this._sectionStyle(),
        bordered: border === "always" || (border === "auto" && dark),
        width: cfg.adjustments_side_width || 100,
        zoom: cfg.adjustments_click_zoom === "on",
        radius: cfg.adjustments_item_radius,
        buttonShape: cfg.adjustments_button_shape || "rounded",
        wrap: cfg.adjustments_wrap_navigation === true,
        overlay: cfg.adjustments_preview_overlay === true,
        contentStyles: this.constructor.styles,
        tabIcons: cfg.adjustments_tab_icons !== false,
        headers: cfg.adjustments_compact_headers === true,
        label: "Adjustments",
      }}
    ></yc-sections>`;
  }

  // A category's sliders as `layout` shows them: the compact, tabs, radial
  // and categories layouts have their own rows, every other one the grouped
  // rows.
  _sectionRows(section, layout) {
    if (layout === "compact") return this._compactRows(section);
    if (layout === "tabs")
      return section.effects.map(
        (effect) => html`<div class="tabbed-slider-row">
          <div class="tabbed-label-row">
            <label class="tabbed-label" data-effect=${effect.name}
              >${`${effect.label}: ${this._effectValueText(effect)}`}</label
            >
            ${effect.hint
              ? html`<span class="tabbed-hint">${effect.hint}</span>`
              : nothing}
          </div>
          ${this._effectSlider(effect, "tabbed-slider effect-slider")}
        </div>`,
      );
    if (layout === "radial")
      return section.effects.map(
        (effect) => html`<div class="radial-effect-row" data-effect=${effect.name}>
          <div class="radial-effect-row-header">
            <span class="radial-effect-row-label">${effect.label}</span>
            <span class="radial-effect-row-value"
              >${this._effectValueText(effect)}</span
            >
          </div>
          ${this._effectSlider(effect, "radial-effect-slider effect-slider")}
        </div>`,
      );
    if (layout === "categories")
      return section.effects.map(
        (effect) => html`<div class="categories-effect-row">
          <div class="categories-effect-row-header">
            <span class="categories-effect-row-label">${effect.label}</span>
            <span class="categories-effect-row-value" data-effect=${effect.name}
              >${this._effectValueText(effect)}</span
            >
          </div>
          ${this._effectSlider(effect, "categories-effect-slider", effect.step || 1)}
        </div>`,
      );
    return html`<div class="adjustment-rows">
      ${section.effects.map(
        (effect) => html`<div class="grouped-slider-row">
          <div class="grouped-label-row">
            <label class="grouped-label">${effect.label}</label>
            <span class="grouped-value" data-effect=${effect.name}
              >${this._effectValueText(effect)}</span
            >
          </div>
          ${this._effectSlider(effect, "grouped-slider effect-slider")}
          ${effect.hint
            ? html`<span class="grouped-hint">${effect.hint}</span>`
            : nothing}
        </div>`,
      )}
    </div>`;
  }

  // A category's reset button in `layout`, or nothing when it is hidden
  // (reset_button_mode: always, changed, never).
  _sectionReset(section, layout) {
    if (this._sectionResetDisplay(section.id) === "none") return nothing;
    const button = (className, label, display = "block") => html`<button
      class=${className}
      data-section-id=${section.id}
      @click=${this._on.resetSection}
      title="Reset ${section.title}"
      style="display: ${display};"
    >
      ${label}
    </button>`;
    if (layout === "tabs") return button("tabbed-reset-button", "🔄 Reset", "flex");
    if (layout === "radial") return button("radial-reset-button", "🔄 Reset");
    if (layout === "categories") return button("categories-reset-button", "🔄 Reset");
    return button("grouped-reset", "🔄");
  }

  _sectionStyle() {
    return (
      this.config.section_style ||
      "subtle"
    );
  }

  // Section reset button display for "always" / "changed" / "never".
  _sectionResetDisplay(sectionId, visible = "block") {
    const mode = this.config.reset_button_mode || "always";
    if (mode === "always") return visible;
    if (mode === "changed")
      return this._checkSectionChanges(sectionId) ? visible : "none";
    return "none";
  }

  _effectDisplayValue(effect) {
    return effect.value !== undefined ? effect.value : effect.default;
  }

  // "value + unit" as one text node (e.g. "30°").
  _effectValueText(effect) {
    return `${this._effectDisplayValue(effect)}${effect.unit}`;
  }

  // One effect range input (all layouts share the drag guard and handler).
  _effectSlider(effect, className, step) {
    return html`<input
      type="range"
      min=${effect.min}
      max=${effect.max}
      step=${step ?? nothing}
      .value=${String(this._effectDisplayValue(effect))}
      class=${className}
      data-effect=${effect.name}
      data-default=${effect.default}
      @mousedown=${this._on.startDrag}
      @touchstart=${this._on.startDrag}
      @mouseup=${this._on.endDrag}
      @touchend=${this._on.endDrag}
      @input=${this._on.effectInput}
      @click=${className.includes("radial-effect-slider")
        ? this._stopPropagation
        : nothing}
    />`;
  }

  // The handlers of the adjustment rows and their resets. Those are rendered
  // by <yc-sections> (section-layouts.js), and Lit calls a template's event
  // handler with the element that renders it as `this`: a card method given
  // as is would run on <yc-sections>. Bound to the card once (stable, so Lit
  // keeps its listeners across renders).
  get _on() {
    return (this.__on ||= {
      startDrag: () => this._startDrag(),
      endDrag: () => this._endDrag(),
      effectInput: (event) => this._onEffectInput(event),
      resetSection: (event) => this._onResetSection(event),
      resetEffect: (event) => this._onResetEffect(event),
    });
  }

  _onEffectInput(event) {
    this.handleEffectChange(event.currentTarget.dataset.effect, event);
  }

  _stopPropagation(event) {
    event.stopPropagation();
  }

  _onResetSection(event) {
    event.stopPropagation();
    this.resetSection(event.currentTarget.dataset.sectionId);
  }

  _onResetEffect(event) {
    this.resetEffect(event.currentTarget.dataset.effect);
  }

  // Compact rows: one line per slider (icon, label and its change dot,
  // slider, value, its own reset).
  _compactRows(section) {
    const showIndicators = this.config.show_change_indicators ?? true;
    const resetButtonMode = this.config.reset_button_mode || "always";
    return section.effects.map((effect) => {
      const hasChanged = this._checkEffectChanged(effect.name);
      const resetButtonVisible =
        resetButtonMode === "always" ||
        (resetButtonMode === "changed" && hasChanged);
      return html`<div
        class="compact-slider-row${resetButtonMode === "never" ? " no-reset" : ""}"
      >
        <span class="compact-icon">${effect.icon || section.icon}</span>
        <span class="compact-label">
          ${effect.label}
          ${showIndicators
            ? html`<span
                class="change-indicator compact-indicator ${hasChanged
                  ? "visible"
                  : ""}"
                data-effect=${effect.name}
              ></span>`
            : nothing}
        </span>
        ${this._effectSlider(effect, "compact-slider effect-slider")}
        <span class="compact-value" data-effect=${effect.name}
          >${this._effectValueText(effect)}</span
        >
        <button
          class="compact-reset-button"
          data-effect=${effect.name}
          @click=${this._on.resetEffect}
          title="Reset ${effect.label}"
          style="display: ${resetButtonVisible ? "flex" : "none"};"
        >
          🔄
        </button>
      </div>`;
    });
  }
};
