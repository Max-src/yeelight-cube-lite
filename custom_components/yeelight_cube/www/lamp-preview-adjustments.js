// Colour adjustment controls of the lamp preview card: applying and resetting
// effects, change tracking, and the compact / tabbed / grouped / radial /
// categories layouts. Mixed into YeelightCubeLampPreviewCard.
import {
  EFFECT_NAMES,
  EFFECT_ATTR_MAP,
  EFFECT_DEFAULTS,
  SECTIONS_REGISTRY,
  EFFECTS_REGISTRY,
} from "./lamp-preview-effects.js";
import { html } from "./lib/lit-all.js";
import { nothing, svg } from "./lit-extras.js";

export const AdjustmentControlsMixin = (Base) => class extends Base {
  async handleEffectChange(effectName, event) {
    const newValue = parseInt(event.target.value);
    if (!this._hass || !this.config || !this.config.entity || isNaN(newValue)) {
      return;
    }

    // Mark as dragging to prevent re-render from hass updates
    this._isDragging = true;

    // Optimistic update: store locally and update label only
    this._localEffects[effectName] = newValue;
    this._resetPending?.delete(effectName);
    this._updateEffectLabel(effectName, newValue);

    // Auto-enable tint: changing Tint Hue without Tint Strength does nothing
    // visually, which feels broken. Auto-set Tint Strength to 50% when the
    // user starts changing Tint Hue and strength is currently 0.
    if (effectName === "tint_hue" && newValue !== 0) {
      const stateObj = this._hass?.states?.[this.config.entity];
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
        this._updateEffectLabel("tint_strength", autoStrength);
      }
    }

    // Update change indicators
    this._updateChangeIndicators();

    // Update compact layout reset button visibility if in "changed" mode
    this._updateCompactResetButtons();

    // Update section-level reset button visibility (for Tabbed, Grouped, Radial, Categories)
    this._updateSectionResetButtons();

    // Debounce the service call
    if (this._effectDebounceTimer) {
      clearTimeout(this._effectDebounceTimer);
    }

    const context = this._effectContext;
    const entityId = this.config.entity;
    const hass = this._hass;
    this._effectDebounceTimer = setTimeout(async () => {
      if (context !== this._effectContext) return;
      this._effectDebounceTimer = null;
      // User stopped dragging
      this._isDragging = false;

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

        // Track when we make the service call
        this._lastServiceCallTime = Date.now();

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

  // Layout interactions only change view state; the Lit template derives the
  // expanded / active / hidden classes from it on the next update.
  toggleSection(sectionId) {
    this._expandedSections[sectionId] = !this._expandedSections[sectionId];
    this.requestUpdate();
  }

  switchTab(tabId) {
    this._activeTab = tabId;
    this.requestUpdate();
  }

  selectRadialCategory(categoryId) {
    this._activeRadialCategory = categoryId;

    // Get the first effect of this category as the selected effect
    const effectsData = this._getEffectsData();
    const section = effectsData.find((s) => s.id === categoryId);
    if (section && section.effects.length > 0) {
      this._selectedRadialEffect = section.effects[0].name;
    }
    this.requestUpdate();
  }

  selectCircularCategory(categoryId) {
    this._activeRadialSection = categoryId;

    const layoutMode = this.config.adjustments_layout || "grouped";

    if (layoutMode === "categories") {
      this._updateCategoriesPanel(categoryId);
    } else if (layoutMode === "radial") {
      this.requestUpdate();
    }
  }

  _updateCategoriesPanel(categoryId) {
    // The icon column and slider panel both derive from _activeRadialSection;
    // Lit only patches what changed, so indicators never blink.
    this._activeRadialSection = categoryId;
    this.requestUpdate();
  }

  selectRadialEffect(effectName) {
    this._selectedRadialEffect = effectName;
    this.requestUpdate();
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
    const stateObj = this._hass?.states?.[this.config.entity];
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
      this._pruneResetEffects(this._hass?.states?.[this.config.entity]);
    }

    // Update change indicators and section reset button visibility
    this._updateChangeIndicators();
    this._updateSectionResetButtons();
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
        { entity_id: this.config.entity, ...allEffects },
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
    const defaultValue = this._getDefaultValue(effectName);

    // Get current state from entity
    const stateObj = this._hass?.states?.[this.config.entity];
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
      this._pruneResetEffects(this._hass?.states?.[this.config.entity]);
    }

    // Update change indicators and reset button visibility
    this._updateChangeIndicators();
    this._updateCompactResetButtons();
  }

  _sectionHasChanges(section) {
    // Check if any effect in the section has been changed from default
    // Prioritize _localEffects (for immediate feedback during dragging)
    // Then check entityValue (which comes from actual entity state)
    const changedEffects = [];

    const hasChanges = section.effects.some((effect) => {
      // First check if there's a pending local change
      if (this._localEffects[effect.name] !== undefined) {
        const isDifferent = this._localEffects[effect.name] !== effect.default;
        if (isDifferent) {
          changedEffects.push(
            `${effect.name}:local=${this._localEffects[effect.name]}`,
          );
        }
        return isDifferent;
      }

      // Otherwise check the actual entity state value
      // If entityValue is undefined, it means the entity hasn't set this value yet, so treat it as default
      const entityValue =
        effect.entityValue !== undefined ? effect.entityValue : effect.default;
      const isDifferent = entityValue !== effect.default;
      if (isDifferent) {
        changedEffects.push(`${effect.name}:entity=${entityValue}`);
      }
      return isDifferent;
    });

    return hasChanges;
  }

  // Change indicators (orange dots) and "changed"-mode reset buttons are
  // derived from _checkSectionChanges / _checkEffectChanged inside the Lit
  // template, so refreshing them is just a (batched) re-render.
  _updateChangeIndicators() {
    this.requestUpdate();
  }

  _updateCompactResetButtons() {
    this.requestUpdate();
  }

  _updateSectionResetButtons() {
    this.requestUpdate();
  }

  _checkSectionChanges(sectionId) {
    // Check if a section has any changes from defaults
    // Works even if sliders aren't currently rendered (e.g., in Categories/Radial layouts)

    // Get the section definition with its effects
    const effectsData = this._getEffectsDataForAllLayouts();
    const section = effectsData.find((s) => s.id === sectionId);

    if (!section) {
      return false;
    }

    // Get entity state
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return false;
    }

    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return false;
    }

    // Check each effect in this section
    let hasChanges = false;

    for (const effect of section.effects) {
      const effectName = effect.name;
      const defaultValue = EFFECT_DEFAULTS[effectName] ?? 0;
      const attrName = EFFECT_ATTR_MAP[effectName];

      // Check _localEffects first (for pending changes), then entity attribute
      let currentValue;
      if (this._localEffects[effectName] !== undefined) {
        currentValue = this._localEffects[effectName];
      } else if (attrName && stateObj.attributes[attrName] !== undefined) {
        currentValue = stateObj.attributes[attrName];
      } else {
        currentValue = defaultValue;
      }

      if (Math.abs(currentValue - defaultValue) > 0.1) {
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  _checkEffectChanged(effectName) {
    // Check if a single effect has changed from its default value
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return false;
    }

    const stateObj = hass.states[entityId];
    if (!stateObj) {
      return false;
    }

    const defaultValue = EFFECT_DEFAULTS[effectName] ?? 0;
    const attrName = EFFECT_ATTR_MAP[effectName];

    // Check _localEffects first (for pending changes), then entity attribute
    let currentValue;
    let source;
    if (this._localEffects[effectName] !== undefined) {
      currentValue = this._localEffects[effectName];
      source = "_localEffects";
    } else if (attrName && stateObj.attributes[attrName] !== undefined) {
      currentValue = stateObj.attributes[attrName];
      source = "entity";
    } else {
      currentValue = defaultValue;
      source = "default";
    }

    const hasChanged = Math.abs(currentValue - defaultValue) > 0.1;

    // Compare with tolerance for floating point
    return hasChanged;
  }

  _shouldShowResetButton(sectionId) {
    // Determines if reset button should be visible based on config (for section-level)
    const mode = this.config.reset_button_mode || "always";

    if (mode === "never") {
      return false;
    }

    if (mode === "always") {
      return true;
    }

    // mode === "changed"
    return this._checkSectionChanges(sectionId);
  }

  _shouldShowEffectResetButton(effectName) {
    // Determines if reset button should be visible for individual effect (compact layout)
    const mode = this.config.reset_button_mode || "always";

    if (mode === "never") {
      return false;
    }

    if (mode === "always") {
      return true;
    }

    // mode === "changed"
    return this._checkEffectChanged(effectName);
  }

  _getEffectsDataForAllLayouts() {
    // Returns section definitions that work across all layouts.
    // Derives from SECTIONS_REGISTRY plus legacy aliases for backward compatibility.
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return [];

    const stateObj = hass.states[entityId];
    if (!stateObj) return [];

    // Build from registry
    const sections = SECTIONS_REGISTRY.map((s) => ({
      id: s.id,
      effects: s.effects.map((name) => ({ name })),
    }));

    // Legacy aliases (old layouts may use these section IDs)
    const SECTION_ALIASES = {
      color_shift: "color_adjustments",
      tone_adjustments: ["saturation_intensity", "tone_contrast"],
    };

    for (const [alias, targets] of Object.entries(SECTION_ALIASES)) {
      const targetIds = Array.isArray(targets) ? targets : [targets];
      const combinedEffects = targetIds.flatMap(
        (tid) => SECTIONS_REGISTRY.find((s) => s.id === tid)?.effects || [],
      );
      sections.push({
        id: alias,
        effects: combinedEffects.map((name) => ({ name })),
      });
    }

    return sections;
  }

  _getDefaultValue(effectName) {
    return EFFECT_DEFAULTS[effectName] ?? 0;
  }

  _getEffectsData() {
    // Derives section data from EFFECTS_REGISTRY + SECTIONS_REGISTRY
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return [];

    const stateObj = hass.states[entityId];
    if (!stateObj) return [];

    // Helper to get value: prioritize _localEffects over entity state FOR DISPLAY
    const getValue = (name) =>
      this._localEffects[name] !== undefined
        ? this._localEffects[name]
        : stateObj.attributes?.[EFFECT_ATTR_MAP[name]];

    // Helper to get ENTITY value (not local effects) for change detection
    const getEntityValue = (name) =>
      stateObj.attributes?.[EFFECT_ATTR_MAP[name]];

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
          value: getValue(name),
          entityValue: getEntityValue(name),
          unit: def.unit,
          default: def.default,
          ...(def.hint && { hint: def.hint }),
        };
      }),
    }));
  }

  _updateEffectLabel(effectName, value) {
    // Every layout's value label reads _localEffects / the entity on render.
    this.requestUpdate();
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
    const layoutMode = this.config.adjustments_layout || "grouped";
    const sections = this._adjustmentSections(effects);
    if (layoutMode === "compact") return this._compactLayout(sections);
    if (layoutMode === "tabbed") return this._tabbedLayout(sections);
    if (layoutMode === "radial") return this._radialLayout(sections);
    if (layoutMode === "categories") return this._categoriesLayout(sections);
    // Default to "grouped" layout
    return this._groupedLayout(sections);
  }

  _sectionStyle() {
    return (
      this.config.section_style ||
      this.config.grouped_section_style ||
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

  _sectionIndicatorClass(sectionId) {
    const showIndicators = this.config?.show_change_indicators ?? true;
    return showIndicators && this._checkSectionChanges(sectionId)
      ? "change-indicator visible"
      : "change-indicator";
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

  // Compact Layout: All controls in a single clean panel with minimal spacing
  _compactLayout(sections) {
    const showIndicators = this.config?.show_change_indicators ?? true;
    const resetButtonMode = this.config.reset_button_mode || "always";
    const rows = sections.flatMap((section) =>
      section.effects.map((effect) => {
        const displayValue = this._effectDisplayValue(effect);
        const hasChanged = this._checkEffectChanged(effect.name);
        const resetButtonVisible =
          resetButtonMode === "always" ||
          (resetButtonMode === "changed" && hasChanged);
        return html`<div class="compact-slider-row">
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
      }),
    );
    return html`<div
      class="effects-compact-container reset-mode-${resetButtonMode} style-${this._sectionStyle()}"
    >
      ${rows}
    </div>`;
  }

  // Tabbed Layout: Effects organized in tabs with smooth transitions
  _tabbedLayout(sections) {
    const activeTab = this._activeTab || sections[0].id;
    return html`<div
      class="effects-tabbed-container yc-stack yc-controls style-${this._sectionStyle()}"
    >
      <div class="tab-headers">
        ${sections.map(
          (section) =>
            html`<button
              class="tab-header ${section.id === activeTab ? "active" : ""}"
              title=${section.title}
              @click=${() => this.switchTab(section.id)}
            >
              <span class="tab-icon">${section.icon}</span>
              <span class="tab-title">${section.title}</span>
              <span
                class=${this._sectionIndicatorClass(section.id)}
                data-section-id=${section.id}
              ></span>
            </button>`,
        )}
      </div>
      <div class="tab-content-container">
        ${sections.map(
          (section) =>
            html`<div
              class="tab-content ${section.id === activeTab ? "active" : ""}"
              data-tab=${section.id}
              data-section-id=${section.id}
            >
              ${section.effects.map((effect) => {
                // Plain "Label: value" text: the steady-state output of the
                // former label updates (which replaced the initial <strong>).
                return html`<div class="tabbed-slider-row">
                  <div class="tabbed-label-row">
                    <label class="tabbed-label" data-effect=${effect.name}
                      >${`${effect.label}: ${this._effectValueText(effect)}`}</label
                    >
                    ${effect.hint
                      ? html`<span class="tabbed-hint">${effect.hint}</span>`
                      : nothing}
                  </div>
                  ${this._effectSlider(effect, "tabbed-slider effect-slider")}
                </div>`;
              })}
              <button
                class="tabbed-reset-button"
                data-section-id=${section.id}
                @click=${this._onResetSection}
                title="Reset ${section.title}"
                style="display: ${this._sectionResetDisplay(
                  section.id,
                  "flex",
                )};"
              >
                🔄 Reset
              </button>
            </div>`,
        )}
      </div>
    </div>`;
  }

  // Grouped Layout: Modern collapsible cards with better spacing (default)
  _groupedLayout(sections) {
    const sectionStyle = this._sectionStyle();
    const anyExpanded = Object.values(this._expandedSections).some(
      (value) => value === true,
    );
    return html`<div class="effects-grouped-container yc-stack yc-controls">
      ${sections.map((section, index) => {
        const isExpanded = this._expandedSections[section.id] === true;
        const state = isExpanded
          ? "expanded"
          : anyExpanded
            ? "collapsed hidden"
            : "collapsed";
        return html`<div
          class="grouped-section style-${sectionStyle} ${state}"
          data-section-id=${section.id}
          style="z-index: ${isExpanded ? 100 : 10 - index};"
        >
          <div
            class="grouped-header"
            @click=${() => this.toggleSection(section.id)}
          >
            <div class="grouped-header-left">
              <span class="grouped-icon"
                >${section.icon}<span
                  class=${this._sectionIndicatorClass(section.id)}
                  data-section-id=${section.id}
                ></span
              ></span>
              <div class="grouped-title-area">
                <span class="grouped-title">${section.title}</span>
                <span class="grouped-description">${section.description}</span>
              </div>
            </div>
            <div class="grouped-header-right">
              <button
                class="grouped-reset"
                data-section-id=${section.id}
                @click=${this._onResetSection}
                title="Reset ${section.title}"
                style="display: ${this._sectionResetDisplay(section.id)};"
              >
                🔄
              </button>
            </div>
          </div>
          <div class="grouped-content" data-section=${section.id}>
            ${section.effects.map(
              (effect) =>
                html`<div class="grouped-slider-row">
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
          </div>
        </div>`;
      })}
    </div>`;
  }

  // Radial Layout: Color wheel selector with dynamic slider panel
  _radialLayout(sections) {
    // Select active category (default to first section)
    if (!this._activeRadialCategory && sections[0]?.id) {
      this._activeRadialCategory = sections[0].id;
    }

    const activeCategory =
      this._activeRadialCategory || sections[0]?.id || null;
    const activeSection =
      sections.find((s) => s.id === activeCategory) || sections[0];

    // Select active effect within the category
    const selectedEffect =
      this._selectedRadialEffect || activeSection?.effects[0]?.name || null;

    const centerX = 0; // At the left edge
    const centerY = 80; // Vertically centered
    const outerRadius = 70;
    const innerRadius = 36;

    // Draw CATEGORY segments only (not individual effects)
    const numCategories = sections.length;
    const angleStep = 180 / numCategories; // Divide half-circle by number of categories
    const showIndicators = this.config?.show_change_indicators ?? true;

    const segments = sections.map((section, index) => {
      // Change to -90° to 90° to draw on the RIGHT side
      const startAngle = (-90 + index * angleStep) * (Math.PI / 180);
      const endAngle = (-90 + (index + 1) * angleStep) * (Math.PI / 180);

      // Segment path
      const x1 = centerX + innerRadius * Math.cos(startAngle);
      const y1 = centerY + innerRadius * Math.sin(startAngle);
      const x2 = centerX + outerRadius * Math.cos(startAngle);
      const y2 = centerY + outerRadius * Math.sin(startAngle);
      const x3 = centerX + outerRadius * Math.cos(endAngle);
      const y3 = centerY + outerRadius * Math.sin(endAngle);
      const x4 = centerX + innerRadius * Math.cos(endAngle);
      const y4 = centerY + innerRadius * Math.sin(endAngle);

      const isActive = section.id === activeCategory;
      const hasChanges =
        showIndicators && this._checkSectionChanges(section.id);

      let segmentClass = "radial-segment";
      if (isActive) segmentClass += " active-category";
      if (hasChanges) segmentClass += " has-changes";

      // Category icon in the ring
      const midAngle = (startAngle + endAngle) / 2;
      const iconRadius = (innerRadius + outerRadius) / 2;
      const iconX = centerX + iconRadius * Math.cos(midAngle);
      const iconY = centerY + iconRadius * Math.sin(midAngle);

      return svg`<path
          class=${segmentClass}
          d="M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z"
          data-category=${section.id}
          data-section-id=${section.id}
          @click=${() => this.selectRadialCategory(section.id)}
        ><title>${section.title}</title></path>
        <text
          x=${iconX}
          y=${iconY}
          class="radial-icon ${isActive ? "active-category" : ""}"
          text-anchor="middle"
          dominant-baseline="middle"
          pointer-events="none"
        >${section.icon}</text>`;
    });

    // Separator lines between categories (drawn after the center)
    const separators = [];
    for (let i = 1; i < numCategories; i++) {
      const angle = (-90 + i * angleStep) * (Math.PI / 180);
      separators.push(svg`<line
          x1=${centerX + innerRadius * Math.cos(angle)}
          y1=${centerY + innerRadius * Math.sin(angle)}
          x2=${centerX + outerRadius * Math.cos(angle)}
          y2=${centerY + outerRadius * Math.sin(angle)}
          class="radial-separator"
          pointer-events="none"
        />`);
    }

    // Center half-circle (only draw the right half) and outer border arc
    const innerArcPath = `M ${centerX} ${centerY - innerRadius} A ${innerRadius} ${innerRadius} 0 0 1 ${centerX} ${centerY + innerRadius}`;
    const outerArcPath = `M ${centerX} ${centerY - outerRadius} A ${outerRadius} ${outerRadius} 0 0 1 ${centerX} ${centerY + outerRadius}`;

    return html`<div class="effects-radial-container style-${this._sectionStyle()}">
      <div class="radial-wheel-container">
        <svg class="radial-wheel" viewBox="-5 0 80 160">
          ${segments}
          <path
            d="${innerArcPath} L ${centerX} ${centerY + innerRadius} L ${centerX} ${centerY - innerRadius} Z"
            class="radial-center"
          />
          ${separators}
          <path
            d=${outerArcPath}
            class="radial-outer-border"
            pointer-events="none"
          />
          ${activeSection
            ? svg`<text
                x=${innerRadius / 2}
                y=${centerY}
                class="radial-center-icon"
                text-anchor="middle"
                dominant-baseline="middle"
              ><title>${activeSection.title}</title>${activeSection.icon}</text>`
            : nothing}
        </svg>
      </div>
      <div class="radial-slider-panel" data-section-id=${activeSection.id}>
        ${activeSection
          ? html`<div class="radial-category-header">
                <div class="radial-category-title">
                  ${activeSection.title}<span
                    class=${this._sectionIndicatorClass(activeSection.id)}
                    data-section-id=${activeSection.id}
                  ></span>
                </div>
                <button
                  class="radial-reset-button"
                  data-section-id=${activeSection.id}
                  @click=${this._onResetSection}
                  title="Reset ${activeSection.title}"
                  style="display: ${this._sectionResetDisplay(
                    activeSection.id,
                  )};"
                >
                  🔄 Reset
                </button>
              </div>
              ${activeSection.effects.map(
                (effect) =>
                  html`<div
                    class="radial-effect-row${effect.name === selectedEffect
                      ? " selected"
                      : ""}"
                    data-effect=${effect.name}
                  >
                    <div class="radial-effect-row-header">
                      <span class="radial-effect-row-label"
                        >${effect.label}</span
                      >
                      <span class="radial-effect-row-value"
                        >${this._effectValueText(effect)}</span
                      >
                    </div>
                    ${this._effectSlider(
                      effect,
                      "radial-effect-slider effect-slider",
                    )}
                  </div>`,
              )}`
          : nothing}
      </div>
    </div>`;
  }

  // Categories Layout: Icon column on left with category-based slider panel
  _categoriesLayout(sections) {
    const activeSection =
      sections.find((s) => s.id === this._activeRadialSection) || sections[0];
    this._activeRadialSection = activeSection.id;

    return html`<div
      class="effects-categories-container style-${this._sectionStyle()}"
    >
      <div class="categories-icon-column">
        ${sections.map(
          (section) =>
            html`<div
              class="categories-icon-button ${section.id === activeSection.id
                ? "active"
                : ""}"
              @click=${() => this.selectCircularCategory(section.id)}
              title=${section.title}
            >
              <span class="categories-icon-emoji">${section.icon}</span>
              <span
                class=${this._sectionIndicatorClass(section.id)}
                data-section-id=${section.id}
              ></span>
            </div>`,
        )}
      </div>
      <div class="categories-slider-panel" data-section-id=${activeSection.id}>
        <div class="categories-category-header">
          <div class="categories-category-title">${activeSection.title}</div>
          <button
            class="categories-reset-button"
            data-section-id=${activeSection.id}
            title="Reset ${activeSection.title}"
            @click=${this._onResetSection}
            style="display: ${this._shouldShowResetButton(activeSection.id)
              ? "block"
              : "none"};"
          >
            🔄 Reset
          </button>
        </div>
        ${activeSection.effects.map(
          (effect) =>
            html`<div class="categories-effect-row">
              <div class="categories-effect-row-header">
                <span class="categories-effect-row-label">${effect.label}</span>
                <span
                  class="categories-effect-row-value"
                  data-effect=${effect.name}
                  >${this._effectValueText(effect)}</span
                >
              </div>
              ${this._effectSlider(
                effect,
                "categories-effect-slider",
                effect.step || 1,
              )}
            </div>`,
        )}
      </div>
    </div>`;
  }
};
