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

export const AdjustmentControlsMixin = (Base) => class extends Base {
  async handleEffectChange(effectName, event) {
    const newValue = parseInt(event.target.value);
    if (!this._hass || !this.config || !this._primaryEntity() || isNaN(newValue)) {
      return;
    }

    // Optimistic update: store locally and update label only
    this._localEffects[effectName] = newValue;
    this._resetPending?.delete(effectName);

    // Auto-enable tint: changing Tint Hue without Tint Strength does nothing
    // visually, which feels broken. Auto-set Tint Strength to 50% when the
    // user starts changing Tint Hue and strength is currently 0.
    if (effectName === "tint_hue" && newValue !== 0) {
      const stateObj = this._hass?.states?.[this._primaryEntity()];
      if (!stateObj) return;
      const currentStrength =
        this._localEffects.tint_strength ??
        stateObj?.attributes?.preview_tint_strength ??
        0;
      if (currentStrength === 0) {
        const autoStrength = 50;
        // The tint_strength slider and label follow _localEffects on render.
        this._localEffects.tint_strength = autoStrength;
        this._resetPending?.delete("tint_strength");
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
        for (const name of EFFECT_NAMES) {
          effects[name] =
            this._localEffects[name] ??
            stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ??
            EFFECT_DEFAULTS[name];
        }

        await this._commands.call(
          hass,
          "yeelight_cube",
          "set_preview_adjustments",
          { entity_id: entityId, ...effects },
          // Each call carries every adjustment, so a newer one waiting in
          // the queue replaces this one.
          { coalesce: "adjustments" },
        );

        // Don't clear local state on a timer - let the entity state update handle it
        // The set hass() method will trigger a render when entity updates
        // At that point, if entity state matches local state, we can safely clear it
      } catch (error) {
        if (context !== this._effectContext) return;
        // Revert to entity state on error
        delete this._localEffects[effectName];
        this._refresh();
        console.error("Error setting effect:", error);
      }
    }, 300); // Faster response for effects
  }

  // Drop the local override of effects that were reset to their default once
  // the entity reports that value (or reports nothing, which reads as default).
  _pruneResetEffects(stateObj) {
    if (!this._resetPending?.size) return;
    for (const name of [...this._resetPending]) {
      const local = this._localEffects[name];
      const shown =
        stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ?? EFFECT_DEFAULTS[name];
      if (local === undefined || shown === local) {
        if (local !== undefined) delete this._localEffects[name];
        this._resetPending.delete(name);
      }
    }
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

    // Build the effects object: Start with current values from entity state OR local changes
    const getCurrentValue = (effectName) => {
      // Priority: 1) Local changes (if user is dragging), 2) Entity state, 3) Default
      return (
        this._localEffects[effectName] ??
        stateObj.attributes?.[EFFECT_ATTR_MAP[effectName]] ??
        EFFECT_DEFAULTS[effectName] ??
        0
      );
    };

    const allEffects = {};
    for (const name of EFFECT_NAMES) {
      allEffects[name] = getCurrentValue(name);
    }

    // Override ONLY the effects in this section with their defaults
    Object.keys(defaultValues).forEach((effectName) => {
      allEffects[effectName] = defaultValues[effectName];
      // Also update local state so sliders move immediately
      this._localEffects[effectName] = defaultValues[effectName];
    });
    this.requestUpdate();

    // Send everything to the lamp (only this section's values changed)
    if (await this._sendReset(defaultValues, allEffects)) {
      // Sliders and labels keep showing the defaults until the entity echoes
      // them; the local overrides are then dropped (see _pruneResetEffects).
      Object.keys(defaultValues).forEach((effectName) =>
        this._resetPending.add(effectName),
      );
      this._pruneResetEffects(this._hass?.states?.[this._primaryEntity()]);
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
        if (this._localEffects[name] === value) delete this._localEffects[name];
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
          this._localEffects[effect] ?? stateObj.attributes[attrName];
      }
    });

    // Update only this effect to default
    allEffects[effectName] = defaultValue;
    this._localEffects[effectName] = defaultValue;
    this.requestUpdate();

    // Send to the lamp
    if (
      await this._sendReset({ [effectName]: defaultValue }, allEffects)
    ) {
      // Keep showing the default until the entity echoes it.
      this._resetPending.add(effectName);
      this._pruneResetEffects(this._hass?.states?.[this._primaryEntity()]);
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
    const current =
      this._localEffects[effectName] ??
      stateObj.attributes[EFFECT_ATTR_MAP[effectName]] ??
      defaultValue;
    return Math.abs(current - defaultValue) > 0.1;
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
    for (const name of EFFECT_NAMES) {
      effects[name] =
        this._localEffects[name] ??
        stateObj?.attributes?.[EFFECT_ATTR_MAP[name]] ??
        EFFECT_DEFAULTS[name];
    }
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
    const dark =
      this._hass?.themes?.darkMode ??
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
      false;
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
      @click=${this._onResetSection}
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
      @mousedown=${this._startDrag}
      @touchstart=${this._startDrag}
      @mouseup=${this._endDrag}
      @touchend=${this._endDrag}
      @input=${this._onEffectInput}
      @click=${className.includes("radial-effect-slider")
        ? this._stopPropagation
        : nothing}
    />`;
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
          @click=${this._onResetEffect}
          title="Reset ${effect.label}"
          style="display: ${resetButtonVisible ? "flex" : "none"};"
        >
          🔄
        </button>
      </div>`;
    });
  }
};
