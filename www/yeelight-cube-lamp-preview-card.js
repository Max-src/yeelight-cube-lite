import { renderDotMatrix, rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { getInitialMatrix } from "./draw_card_state.js";
import {
  BLACK_THRESHOLD,
  PREVIEW_MIN_BRIGHTNESS_BOOST,
  PREVIEW_MAX_DARKEN_PERCENT,
  PREVIEW_BRIGHTNESS_GAMMA,
} from "./draw_card_const.js";
import {
  exportImportButtonStyles,
  getExportImportButtonClass,
  renderButtonContent,
} from "./export-import-button-utils.js?v=4";

class YeelightCubeLampPreviewCard extends HTMLElement {
  static async getConfigElement() {
    if (!customElements.get("yeelight-cube-lamp-preview-card-editor")) {
      await import("./yeelight-cube-lamp-preview-card-editor.js");
    }
    return document.createElement("yeelight-cube-lamp-preview-card-editor");
  }
  constructor() {
    super();
    this.config = {};
    this._hass = null;
    this._brightnessDebounceTimer = null;
    this._realBrightnessDebounceTimer = null;
    this._effectDebounceTimer = null;
    this._renderDebounceTimer = null; // Debounce rendering to avoid flicker
    this._renderScheduled = false;

    // Local state for optimistic UI updates
    this._localBrightness = null;
    this._localEffects = {}; // Store all effect values locally

    // Track if user is actively dragging to prevent re-render
    this._isDragging = false;
    this._anySliderDragging = false; // Track if ANY slider is being dragged
    this._userSetBrightness = null; // Cache user-set brightness during drag/update cycle
    this._userBrightnessTimeout = null; // Timer to clear cached brightness
    this._lastRenderedBrightness = null; // Track last rendered brightness to detect oscillations
    this._brightnessOscillationCount = 0; // Count rapid brightness changes
    this._oscillationResetTimeout = null; // Timer to reset oscillation counter

    // Track the last service call timestamp to avoid clearing local state too early
    this._lastServiceCallTime = 0;

    // Track expanded sections
    this._expandedSections = {
      tone: false,
      color: false,
      effects: false,
    };

    // Track lamp on/off state to detect changes
    this._lastKnownState = null;

    // Track last brightness to detect brightness changes
    this._lastBrightness = null;

    // Track last matrix_colors to detect effect changes
    this._lastMatrixColors = null;

    // Track if initial render is complete
    this._isInitialRenderComplete = false;

    // Cache for comparing if full re-render is needed
    this._lastRenderedConfig = null;

    // Track active tab for tabbed layout
    this._activeTab = null;

    // Track selected category and effect for radial layout
    this._activeRadialCategory = null;
    this._selectedRadialEffect = null;
  }
  setConfig(config) {
    this.config = {
      show_card_background: true,
      size: "medium",
      size_pct: 100, // Default matrix size to 100%
      align: "center",
      matrix_pixel_gap: 4, // Default pixel gap to 4px
      matrix_background: "black", // Black background by default
      matrix_box_shadow: true, // Keep matrix box shadow enabled
      matrix_pixel_style: "round", // Keep round pixel style
      lamp_dot_shadow: true, // Keep pixel box shadow enabled
      buttons_style: "classic", // Style for all buttons (power toggle, force refresh)
      show_brightness_slider: true, // NEW: Show brightness slider by default
      show_brightness_percentage: true, // NEW: Show brightness percentage value
      brightness_slider_style: "slider", // NEW: Style for brightness slider (slider, bar, rotary)
      brightness_slider_appearance: "default", // NEW: Appearance for slider mode (default, thick, thin)
      brightness_label_mode: "text", // NEW: Brightness label mode (none, text, icon, icon_text)
      brightness_max: 500, // NEW: Maximum brightness value (default 500 to test beyond 255)
      show_power_toggle: true, // NEW: Show on/off toggle button by default
      show_force_refresh_button: true, // Show force refresh button (raw TCP bypass)

      hide_black_dots: true, // NEW: Treat black dots as transparent on preview (default: true to match real device behavior)
      show_lamp_preview: true, // NEW: Show lamp matrix preview by default
      show_adjustment_controls: false, // Deprecated: Use light brightness control instead
      ...config,
    };
    // Support legacy config migrations
    if (config.reconnect_button_style && !config.buttons_style) {
      this.config.buttons_style = config.reconnect_button_style;
    }

    // Force full re-render when config changes
    this._isInitialRenderComplete = false;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    }
  }

  set hass(hass) {
    const _t0 = performance.now();
    this._hass = hass;

    // Clean up local effects that match the entity state
    // This prevents flickering when entity state updates after a service call
    // Reduced to 50ms since Python now returns state updates immediately
    const timeSinceLastServiceCall = Date.now() - this._lastServiceCallTime;
    const canClearLocalEffects = timeSinceLastServiceCall > 50;

    if (
      canClearLocalEffects &&
      this.config &&
      this.config.entity &&
      hass.states[this.config.entity]
    ) {
      const stateObj = hass.states[this.config.entity];
      const effectMappings = {
        hue_shift: "preview_hue_shift",
        temperature: "preview_temperature",
        saturation: "preview_saturation",
        vibrance: "preview_vibrance",
        contrast: "preview_contrast",
        glow: "preview_glow",
        grayscale: "preview_grayscale",
        invert: "preview_invert",
        tint_hue: "preview_tint_hue",
        tint_strength: "preview_tint_strength",
      };

      // Don't clear _localEffects when entity state matches!
      // We need to keep tracking values that differ from defaults
      // for the change indicator system to work properly.
      // _localEffects should only be cleared by explicit reset actions.
    }

    // Check if the lamp on/off state has changed
    const oldState = this._lastKnownState;
    const newState = this.config?.entity
      ? hass.states[this.config.entity]?.state
      : null;
    const stateChanged = oldState !== newState;

    // TEMPORARY DEBUG: Log state changes
    // (removed for performance)

    if (newState) {
      this._lastKnownState = newState;
    }

    // Don't re-render while user is actively dragging ANY slider OR if we have pending local effects
    // UNLESS the lamp on/off state changed (always show correct power button state)
    const hasPendingLocalEffects = Object.keys(this._localEffects).length > 0;

    // Detect brightness changes to debounce rendering
    const currentBrightness = this.config?.entity
      ? hass.states[this.config.entity]?.attributes?.brightness
      : null;
    const brightnessChanged = currentBrightness !== this._lastBrightness;

    // Detect matrix_colors changes to trigger re-render (for effect updates)
    const currentMatrixColors = this.config?.entity
      ? hass.states[this.config.entity]?.attributes?.matrix_colors
      : null;
    const matrixColorsChanged =
      JSON.stringify(currentMatrixColors) !==
      JSON.stringify(this._lastMatrixColors);

    if (matrixColorsChanged) {
      const updateEpoch = this.config?.entity
        ? hass.states[this.config.entity]?.attributes?._update_epoch
        : null;
      const latencyStr = updateEpoch
        ? ` latency=${(Date.now() / 1000 - updateEpoch).toFixed(2)}s`
        : "";
    }

    if (brightnessChanged && currentBrightness !== null) {
      this._lastBrightness = currentBrightness;

      // Debounce rendering when brightness changes to avoid flicker
      // Wait for both brightness AND matrix_colors updates to arrive
      if (this._renderDebounceTimer) {
        clearTimeout(this._renderDebounceTimer);
      }
      this._renderDebounceTimer = setTimeout(() => {
        this._renderDebounceTimer = null;
        // Always render to update matrix colors, even if dragging
        this.render();
      }, 250); // Increased from 150ms to 250ms for better performance
    } else if (!hasPendingLocalEffects || stateChanged || matrixColorsChanged) {
      // Normal rendering for non-brightness changes
      // Always render to update matrix - slider protection is inside _updateSliderValues
      // Also render when matrix_colors change (effect updates from backend)
      if (matrixColorsChanged && currentMatrixColors !== null) {
        this._lastMatrixColors = currentMatrixColors;
      }
      this.render();
    }
  }

  async forceRefreshLamp() {
    if (!this._hass || !this.config || !this.config.entity) {
      return;
    }

    this._forceRefreshLoading = true;
    this.render();

    try {
      await this._hass.callService("yeelight_cube", "force_refresh", {
        entity_id: this.config.entity,
      });
      // Brief delay so the user sees visual feedback
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error("[FORCE REFRESH] Service call failed:", error);
    } finally {
      this._forceRefreshLoading = false;
      this.render();
    }
  }

  async handlePowerToggle() {
    if (!this._hass || !this.config || !this.config.entity) {
      return;
    }

    const stateObj = this._hass.states[this.config.entity];
    if (!stateObj) return;

    const currentState = stateObj.state === "on";
    const expectedState = !currentState; // We're toggling

    // Show loading state immediately and track expected state
    this._powerToggling = true;
    this._expectedPowerState = expectedState;
    this._updatePowerButtonLoadingState(true);


    try {
      // Toggle the light (same as clicking toggle in HA light card)
      await this._hass.callService("light", "toggle", {
        entity_id: this.config.entity,
      });

      // Safety timeout: clear loading after 5 seconds if state doesn't update
      setTimeout(() => {
        if (this._powerToggling) {
          console.warn("[POWER BUTTON] Timeout - clearing loading state");
          this._powerToggling = false;
          this._expectedPowerState = null;
          this._updatePowerButtonLoadingState(false);
        }
      }, 5000);
    } catch (error) {
      console.error("Error toggling light:", error);
      this._powerToggling = false;
      this._expectedPowerState = null;
      this._updatePowerButtonLoadingState(false);
    }
  }

  handleBrightnessWheel(event) {
    event.preventDefault();
    const container = event.currentTarget;

    // Check if it's a rotary container
    if (container.classList.contains("brightness-rotary-wrapper")) {
      const slider = container.querySelector(".brightness-slider-rotary");
      if (slider) {
        const currentValue = parseInt(slider.value);
        const delta = event.deltaY < 0 ? 5 : -5;
        const newValue = Math.max(1, Math.min(100, currentValue + delta));
        slider.value = newValue;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else {
      // Regular slider modes
      const slider = container.querySelector(".brightness-slider");
      if (slider) {
        const currentValue = parseInt(slider.value);
        const delta = event.deltaY < 0 ? 5 : -5;
        const newValue = Math.max(1, Math.min(100, currentValue + delta));
        slider.value = newValue;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  handleRotaryClick(event) {
    const container = event.currentTarget;

    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate angle from center
    let angle =
      Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
    // Normalize to 0-360
    angle = (angle + 360) % 360;

    // The gauge starts at 135° (bottom-left) and goes 270° clockwise
    // Adjust angle relative to start position
    let adjustedAngle = angle - 135;
    if (adjustedAngle < 0) adjustedAngle += 360;

    // Map to 0-270 range, clamping values outside the arc
    if (adjustedAngle > 270) {
      // Click is in the dead zone (between end and start of arc)
      // Snap to nearest end
      adjustedAngle = adjustedAngle > 315 ? 0 : 270;
    }

    // Convert angle to brightness (1-100)
    const brightness = Math.round((adjustedAngle / 270) * 99) + 1;

    // Update the hidden slider and trigger change
    const slider = container.querySelector(".brightness-slider-rotary");

    if (slider) {
      slider.value = brightness;

      // Directly call handleBrightnessChange instead of relying on event dispatch
      const changeEvent = { target: slider };
      this.handleBrightnessChange(changeEvent);
    } else {
      console.error("[Rotary Click] ERROR: Slider not found!");
    }
  }

  handleRotaryDragStart(event) {
    this._rotaryDragging = true;
    this._startDrag();
    this.handleRotaryClick(event);

    const container = event.currentTarget;

    const handleMove = (e) => {
      if (!this._rotaryDragging) return;
      e.preventDefault();
      const clientX = e.clientX || e.touches?.[0]?.clientX;
      const clientY = e.clientY || e.touches?.[0]?.clientY;
      if (clientX !== undefined && clientY !== undefined) {
        const rect = container.getBoundingClientRect();
        const moveEvent = {
          currentTarget: container,
          clientX,
          clientY,
        };
        this.handleRotaryClick(moveEvent);
      }
    };

    const handleEnd = () => {
      this._rotaryDragging = false;
      this._endDrag();
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove);
    document.addEventListener("touchend", handleEnd);
  }

  async handleBrightnessChange(event) {
    let newBrightness = parseInt(event.target.value);

    // Cache the user-set brightness to use during render storms
    this._userSetBrightness = newBrightness;

    if (this._userBrightnessTimeout) {
      clearTimeout(this._userBrightnessTimeout);
    }
    // Clear cached value after 3 seconds (extended to cover longer render storms)
    this._userBrightnessTimeout = setTimeout(() => {
      this._userSetBrightness = null;
    }, 3000);

    if (
      !this._hass ||
      !this.config ||
      !this.config.entity ||
      isNaN(newBrightness)
    ) {
      return;
    }

    // Mark as dragging to prevent re-render from hass updates
    this._isDragging = true;

    // Clamp to 1-100 FIRST to ensure we never work with 0
    newBrightness = Math.max(1, Math.min(100, newBrightness));

    // Update visual elements immediately for responsive feedback
    const sliderStyle = this.config.brightness_slider_style || "minimal";
    const showPercentage = this.config.show_brightness_percentage !== false;

    if (sliderStyle === "bar") {
      const barFill = this.shadowRoot?.querySelector(".brightness-bar-fill");
      if (barFill) barFill.style.width = `${newBrightness}%`;

      if (showPercentage) {
        const valueRight = this.shadowRoot?.querySelector(
          ".brightness-value-right",
        );
        if (valueRight) valueRight.textContent = `${newBrightness}%`;
      }
    } else if (sliderStyle === "rotary") {
      const angle = ((newBrightness - 1) / 99) * 270; // Map 1-100 to 0-270 degrees
      const radius = 40;
      const circumference = 2 * Math.PI * radius; // ~251.33
      const arcLength = (circumference * 270) / 360; // Exact 270 degree arc
      const progressArcLength = (angle / 270) * arcLength;
      const rotaryProgress = this.shadowRoot?.querySelector(".rotary-progress");
      if (rotaryProgress) {
        rotaryProgress.style.strokeDasharray = `${progressArcLength} ${circumference}`;
      }

      if (showPercentage) {
        const rotaryValue = this.shadowRoot?.querySelector(".rotary-value");
        if (rotaryValue) rotaryValue.textContent = `${newBrightness}%`;
      }
    } else if (sliderStyle === "capsule") {
      const capsuleFill = this.shadowRoot?.querySelector(".capsule-fill");
      const capsuleThumb = this.shadowRoot?.querySelector(".capsule-thumb");
      if (capsuleFill) {
        capsuleFill.style.setProperty("--brightness-percent", newBrightness);
      }
      if (capsuleThumb) {
        capsuleThumb.style.setProperty("--brightness-percent", newBrightness);
      }

      if (showPercentage) {
        const percentageStandalone = this.shadowRoot?.querySelector(
          ".brightness-percentage-standalone",
        );
        if (percentageStandalone)
          percentageStandalone.textContent = `${newBrightness}%`;
      }
    } else {
      // Slider mode (default)
      if (showPercentage) {
        const valueSlider = this.shadowRoot?.querySelector(
          ".brightness-value-slider",
        );
        if (valueSlider) valueSlider.textContent = `${newBrightness}%`;
      }
    }

    // Map 1-100 slider to Home Assistant brightness (displayed as 1%-100%)
    // HA shows brightness as (value/255)*100, so we need:
    // - Slider 1% ? HA brightness 3 (shows as 1.18% ≈ 1%)
    // - Slider 100% ? HA brightness 255 (shows as 100%)
    // Formula: map 1-100 to 3-255 (252 steps across 99 slider positions)
    const haBrightness = Math.round(3 + ((newBrightness - 1) * 252) / 99);

    // Final safety check: clamp to valid range
    const safeBrightness = Math.max(3, Math.min(255, haBrightness));

    // Debounce the actual service call to avoid overwhelming the device
    if (this._brightnessDebounceTimer) {
      clearTimeout(this._brightnessDebounceTimer);
    }

    this._brightnessDebounceTimer = setTimeout(async () => {
      // User stopped dragging
      this._isDragging = false;

      try {
        // Call light.turn_on with brightness (Home Assistant expects 1-255)
        await this._hass.callService("light", "turn_on", {
          entity_id: this.config.entity,
          brightness: safeBrightness,
        });

        // No need to clear local state - we're not using optimistic updates
      } catch (error) {
        console.error(`[Brightness] Service call failed:`, error);
        // Just render on error
        this.render();

        // Only log errors that aren't connection-related
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("NoneType") || errorMsg.includes("close")) {
          console.warn("Lamp connection temporarily unavailable");
        } else if (errorMsg.includes("quota exceeded")) {
          console.warn("Device rate limit - brightness update queued");
        } else {
          console.error("Error setting brightness:", error);
        }
      }
    }, 500);
  }

  // Track when user starts dragging any slider
  _startDrag() {
    this._anySliderDragging = true;
  }

  // Track when user stops dragging any slider
  _endDrag() {
    // Use setTimeout to ensure the final value is processed before allowing re-render
    setTimeout(() => {
      this._anySliderDragging = false;
      // Don't force render here - let the hass setter handle it naturally
    }, 50);
  }

  async handleEffectChange(effectName, event) {
    const newValue = parseInt(event.target.value);
    if (!this._hass || !this.config || !this.config.entity || isNaN(newValue)) {
      return;
    }

    // Mark as dragging to prevent re-render from hass updates
    this._isDragging = true;

    // Optimistic update: store locally and update label only
    this._localEffects[effectName] = newValue;
    this._updateEffectLabel(effectName, newValue);

    // Auto-enable tint: changing Tint Hue without Tint Strength does nothing
    // visually, which feels broken. Auto-set Tint Strength to 50% when the
    // user starts changing Tint Hue and strength is currently 0.
    if (effectName === "tint_hue" && newValue !== 0) {
      const stateObj = this._hass.states[this.config.entity];
      const currentStrength =
        this._localEffects.tint_strength ??
        stateObj?.attributes?.preview_tint_strength ??
        0;
      if (currentStrength === 0) {
        const autoStrength = 50;
        this._localEffects.tint_strength = autoStrength;
        this._updateEffectLabel("tint_strength", autoStrength);
        // Update the tint_strength slider element position
        const strengthSliders = this.shadowRoot.querySelectorAll(
          'input[data-effect="tint_strength"]',
        );
        strengthSliders.forEach((s) => (s.value = autoStrength));
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

    this._effectDebounceTimer = setTimeout(async () => {
      // User stopped dragging
      this._isDragging = false;

      try {
        // Get all current effect values
        const stateObj = this._hass.states[this.config.entity];
        const _tSvc = performance.now();
        const effects = {
          hue_shift:
            this._localEffects.hue_shift ??
            stateObj?.attributes?.preview_hue_shift ??
            0,
          temperature:
            this._localEffects.temperature ??
            stateObj?.attributes?.preview_temperature ??
            0,
          saturation:
            this._localEffects.saturation ??
            stateObj?.attributes?.preview_saturation ??
            100,
          vibrance:
            this._localEffects.vibrance ??
            stateObj?.attributes?.preview_vibrance ??
            100,
          contrast:
            this._localEffects.contrast ??
            stateObj?.attributes?.preview_contrast ??
            100,
          glow:
            this._localEffects.glow ?? stateObj?.attributes?.preview_glow ?? 0,
          grayscale:
            this._localEffects.grayscale ??
            stateObj?.attributes?.preview_grayscale ??
            0,
          invert:
            this._localEffects.invert ??
            stateObj?.attributes?.preview_invert ??
            0,
          tint_hue:
            this._localEffects.tint_hue ??
            stateObj?.attributes?.preview_tint_hue ??
            0,
          tint_strength:
            this._localEffects.tint_strength ??
            stateObj?.attributes?.preview_tint_strength ??
            0,
        };

        // Track when we make the service call
        this._lastServiceCallTime = Date.now();

        await this._hass.callService(
          "yeelight_cube",
          "set_preview_adjustments",
          {
            entity_id: this.config.entity,
            ...effects,
          },
        );

        // Don't clear local state on a timer - let the entity state update handle it
        // The set hass() method will trigger a render when entity updates
        // At that point, if entity state matches local state, we can safely clear it
      } catch (error) {
        // Revert to entity state on error
        delete this._localEffects[effectName];
        this.render();
        console.error("Error setting effect:", error);
      }
    }, 300); // Faster response for effects
  }

  toggleSection(sectionId) {
    this._expandedSections[sectionId] = !this._expandedSections[sectionId];
    const isExpanded = this._expandedSections[sectionId];

    // Get all grouped sections
    const allGroupedSections =
      this.shadowRoot.querySelectorAll(".grouped-section");

    // Check if any section is expanded
    const anyExpanded = Object.values(this._expandedSections).some(
      (val) => val === true,
    );

    allGroupedSections.forEach((groupedSection) => {
      const sectionContent = groupedSection.querySelector(".grouped-content");
      const thisSectionId = sectionContent?.getAttribute("data-section");
      const isThisExpanded = this._expandedSections[thisSectionId] === true;

      if (isThisExpanded) {
        // This section is expanded
        groupedSection.classList.add("expanded");
        groupedSection.classList.remove("collapsed", "hidden");
      } else {
        // This section is collapsed
        groupedSection.classList.remove("expanded");
        groupedSection.classList.add("collapsed");

        // Hide with transition if any section is expanded, otherwise show
        if (anyExpanded) {
          groupedSection.classList.add("hidden");
        } else {
          groupedSection.classList.remove("hidden");
        }
      }
    });

    // Update the UI for old effect section layout (legacy support)
    const section = this.shadowRoot.querySelector(
      `.effect-section-content[data-section="${sectionId}"]`,
    );

    if (section) {
      // Update the icon for the old effect section header (legacy support)
      const header = section.previousElementSibling;
      if (header && header.classList.contains("effect-section-header")) {
        const iconElement = header.querySelector(".expand-icon");
        if (iconElement) {
          iconElement.textContent = isExpanded ? "?" : "?";
        }
      }
    }

    // Don't call render() - we already updated the DOM directly
  }

  switchTab(tabId) {
    this._activeTab = tabId;

    // Update UI
    const allTabs = this.shadowRoot.querySelectorAll(".tab-content");
    const allHeaders = this.shadowRoot.querySelectorAll(".tab-header");

    allTabs.forEach((tab) => {
      if (tab.dataset.tab === tabId) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    allHeaders.forEach((header) => {
      const onclick = header.getAttribute("onclick");
      if (onclick && onclick.includes(tabId)) {
        header.classList.add("active");
      } else {
        header.classList.remove("active");
      }
    });

    // Don't call render() - we already updated the DOM directly
  }

  selectRadialCategory(categoryId) {
    this._activeRadialCategory = categoryId;

    // Get the first effect of this category as the selected effect
    const effectsData = this._getEffectsData();
    const section = effectsData.find((s) => s.id === categoryId);
    if (section && section.effects.length > 0) {
      this._selectedRadialEffect = section.effects[0].name;
    }

    // Force a re-render to update the wheel and slider panel
    this._isInitialRenderComplete = false;
    this.render();

    // Update change indicators after render
    requestAnimationFrame(() => {
      this._updateChangeIndicators();
    });
  }
  selectCircularCategory(categoryId) {
    this._activeRadialSection = categoryId;

    const layoutMode = this.config.adjustments_layout || "grouped";

    if (layoutMode === "categories") {
      // For categories layout, update only the slider panel and active states
      // This prevents rebuilding the icon column and causing indicator blink
      this._updateCategoriesPanel(categoryId);
    } else if (layoutMode === "radial") {
      // For radial layout, we need full re-render
      this._isInitialRenderComplete = false;
      this.render();

      // Update change indicators immediately after render completes
      requestAnimationFrame(() => {
        this._updateChangeIndicators();
      });
    }
  }

  _updateCategoriesPanel(categoryId) {
    // Update categories layout without full re-render to prevent indicator blinking
    if (!this.shadowRoot) return;

    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return;

    const stateObj = hass.states[entityId];
    if (!stateObj) return;

    const effects = stateObj.attributes.effects || {};
    const effectsData = this._generateAdjustmentControlsHtml(effects).match(
      /effects-categories-container/,
    );

    // Just get the sections data
    const sections = [
      {
        id: "color_adjustments",
        title: "Color",
        icon: "🎨",
        effects: [
          {
            name: "hue_shift",
            label: "Hue Shift",
            min: -180,
            max: 180,
            value: stateObj.attributes.preview_hue_shift || 0,
            unit: "°",
            default: 0,
          },
          {
            name: "temperature",
            label: "Temperature",
            min: -100,
            max: 100,
            value: stateObj.attributes.preview_temperature || 0,
            unit: "",
            default: 0,
          },
        ],
      },
      {
        id: "saturation_intensity",
        title: "Intensity",
        icon: "💎",
        effects: [
          {
            name: "saturation",
            label: "Saturation",
            min: 0,
            max: 200,
            value: stateObj.attributes.preview_saturation || 100,
            unit: "",
            default: 100,
          },
          {
            name: "vibrance",
            label: "Vibrance",
            min: 0,
            max: 200,
            value: stateObj.attributes.preview_vibrance || 100,
            unit: "",
            default: 100,
          },
        ],
      },
      {
        id: "tone_contrast",
        title: "Tone",
        icon: "🌓",
        effects: [
          {
            name: "contrast",
            label: "Contrast",
            min: 0,
            max: 200,
            value: stateObj.attributes.preview_contrast || 100,
            unit: "",
            default: 100,
          },
          {
            name: "glow",
            label: "Glow",
            min: 0,
            max: 100,
            value: stateObj.attributes.preview_glow || 0,
            unit: "%",
            default: 0,
          },
        ],
      },
      {
        id: "special_effects",
        title: "Effects",
        icon: "✨",
        effects: [
          {
            name: "grayscale",
            label: "Grayscale",
            min: 0,
            max: 100,
            value: stateObj.attributes.preview_grayscale || 0,
            unit: "%",
            default: 0,
          },
          {
            name: "invert",
            label: "Invert",
            min: 0,
            max: 100,
            value: stateObj.attributes.preview_invert || 0,
            unit: "%",
            default: 0,
          },
          {
            name: "tint_hue",
            label: "Tint Hue",
            min: 0,
            max: 360,
            value: stateObj.attributes.preview_tint_hue || 0,
            unit: "°",
            default: 0,
          },
          {
            name: "tint_strength",
            label: "Tint Strength",
            min: 0,
            max: 100,
            value: stateObj.attributes.preview_tint_strength || 0,
            unit: "%",
            default: 0,
          },
        ],
      },
    ];

    const activeSection =
      sections.find((s) => s.id === categoryId) || sections[0];

    // Update active class on icon buttons
    const iconButtons = this.shadowRoot.querySelectorAll(
      ".categories-icon-button",
    );
    iconButtons.forEach((button) => {
      const sectionId = button.getAttribute("onclick").match(/'([^']+)'/)?.[1];
      if (sectionId === categoryId) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });

    // Update slider panel content
    const sliderPanel = this.shadowRoot.querySelector(
      ".categories-slider-panel",
    );
    if (!sliderPanel) return;

    sliderPanel.setAttribute("data-section-id", activeSection.id);

    // Determine button visibility based on mode
    const resetButtonMode = this.config.reset_button_mode || "always";
    let resetButtonVisible = "none";
    if (resetButtonMode === "always") {
      resetButtonVisible = "block";
    } else if (resetButtonMode === "changed") {
      const hasChanges = this._checkSectionChanges(activeSection.id);
      resetButtonVisible = hasChanges ? "block" : "none";
    }
    // resetButtonMode === "never" ? stays "none"

    let panelHtml = `
      <div class="categories-category-header">
        <div class="categories-category-title">${activeSection.title}</div>
        <button 
          class="categories-reset-button" 
          data-section-id="${activeSection.id}"
          title="Reset ${activeSection.title}"
          onclick="this.getRootNode().host.resetSection('${activeSection.id}')"
          style="display: ${resetButtonVisible};"
        >
          🔄 Reset
        </button>
      </div>
    `;

    activeSection.effects.forEach((effect) => {
      const displayValue =
        effect.value !== undefined ? effect.value : effect.default;
      panelHtml += `
        <div class="categories-effect-row">
          <div class="categories-effect-row-header">
            <span class="categories-effect-row-label">${effect.label}</span>
            <span class="categories-effect-row-value" data-effect="${
              effect.name
            }">${displayValue}${effect.unit}</span>
          </div>
          <input
            type="range"
            class="categories-effect-slider"
            min="${effect.min}"
            max="${effect.max}"
            step="${effect.step || 1}"
            value="${displayValue}"
            data-effect="${effect.name}"
            data-default="${effect.default}"
            onmousedown="this.getRootNode().host._startDrag()"
            ontouchstart="this.getRootNode().host._startDrag()"
            onmouseup="this.getRootNode().host._endDrag()"
            ontouchend="this.getRootNode().host._endDrag()"
            oninput="this.getRootNode().host.handleEffectChange('${
              effect.name
            }', event)"
          />
        </div>
      `;
    });

    sliderPanel.innerHTML = panelHtml;
  }

  selectRadialEffect(effectName) {
    this._selectedRadialEffect = effectName;

    // Update UI - highlight the selected effect row only
    const allEffectRows =
      this.shadowRoot.querySelectorAll(".radial-effect-row");

    allEffectRows.forEach((row) => {
      if (row.dataset.effect === effectName) {
        row.classList.add("selected");
      } else {
        row.classList.remove("selected");
      }
    });

    // Don't call render() - we already updated the DOM directly
  }

  async resetSection(sectionId) {
    // Simple, clean reset: Define default values for each section
    const sectionDefaults = {
      color_adjustments: {
        hue_shift: 0,
        temperature: 0,
      },
      saturation_intensity: {
        saturation: 100,
        vibrance: 100,
      },
      tone_contrast: {
        contrast: 100,
        glow: 0,
      },
      special_effects: {
        grayscale: 0,
        invert: 0,
        tint_hue: 0,
        tint_strength: 0,
      },
    };

    const defaultValues = sectionDefaults[sectionId];
    if (!defaultValues) {
      console.error("? Unknown section ID:", sectionId);
      return;
    }

    // Get current state from entity
    const stateObj = this._hass?.states?.[this.config.entity];
    if (!stateObj) return;

    // Build the effects object: Start with current values from entity state OR local changes
    const getCurrentValue = (effectName) => {
      // Priority: 1) Local changes (if user is dragging), 2) Entity state, 3) Default
      const attrName = `preview_${effectName}`;
      return (
        this._localEffects[effectName] ??
        stateObj.attributes?.[attrName] ??
        (defaultValues[effectName] !== undefined
          ? defaultValues[effectName]
          : 100)
      );
    };

    const allEffects = {
      hue_shift: getCurrentValue("hue_shift"),
      temperature: getCurrentValue("temperature"),
      saturation: getCurrentValue("saturation"),
      vibrance: getCurrentValue("vibrance"),
      contrast: getCurrentValue("contrast"),
      glow: getCurrentValue("glow"),
      grayscale: getCurrentValue("grayscale"),
      invert: getCurrentValue("invert"),
      tint_hue: getCurrentValue("tint_hue"),
      tint_strength: getCurrentValue("tint_strength"),
    };

    // Override ONLY the effects in this section with their defaults
    Object.keys(defaultValues).forEach((effectName) => {
      allEffects[effectName] = defaultValues[effectName];
      // Also update local state so sliders move immediately
      this._localEffects[effectName] = defaultValues[effectName];
    });

    // Send everything to the lamp (only this section's values changed)
    await this._hass.callService("yeelight_cube", "set_preview_adjustments", {
      entity_id: this.config.entity,
      ...allEffects,
    });

    // Update sliders in DOM immediately (for categories layout)
    Object.keys(defaultValues).forEach((effectName) => {
      const slider = this.shadowRoot.querySelector(
        `.categories-effect-slider[data-effect="${effectName}"]`,
      );
      if (slider) {
        slider.value = defaultValues[effectName];
      }

      // Update the value display
      const valueDisplay = this.shadowRoot.querySelector(
        `.categories-effect-row-value[data-effect="${effectName}"]`,
      );
      if (valueDisplay) {
        const effectData = this._getEffectsData()
          .flatMap((s) => s.effects)
          .find((e) => e.name === effectName);
        const unit = effectData?.unit || "";
        valueDisplay.textContent = `${defaultValues[effectName]}${unit}`;
      }
    });

    // Clear local effects for this section immediately
    Object.keys(defaultValues).forEach((effectName) => {
      delete this._localEffects[effectName];
    });

    // Update change indicators immediately
    this._updateChangeIndicators();

    // Update section reset button visibility
    this._updateSectionResetButtons();

    // Also update after a brief delay to ensure DOM is ready
    setTimeout(() => {
      this._updateChangeIndicators();
      this._updateSectionResetButtons();
    }, 50);
  }

  async resetEffect(effectName) {
    // Reset a single effect to its default value (for compact layout)
    const defaultValue = this._getDefaultValue(effectName);

    // Get current state from entity
    const stateObj = this._hass?.states?.[this.config.entity];
    if (!stateObj) return;

    const effectMappings = {
      hue_shift: "preview_hue_shift",
      temperature: "preview_temperature",
      saturation: "preview_saturation",
      vibrance: "preview_vibrance",
      contrast: "preview_contrast",
      glow: "preview_glow",
      grayscale: "preview_grayscale",
      invert: "preview_invert",
      tint_hue: "preview_tint_hue",
      tint_strength: "preview_tint_strength",
    };

    // Build the effects object with all current values
    const allEffects = {};
    Object.keys(effectMappings).forEach((effect) => {
      const attrName = effectMappings[effect];
      if (attrName && stateObj.attributes[attrName] !== undefined) {
        allEffects[effect] =
          this._localEffects[effect] ?? stateObj.attributes[attrName];
      }
    });

    // Update only this effect to default
    allEffects[effectName] = defaultValue;
    this._localEffects[effectName] = defaultValue;

    // Send to the lamp
    await this._hass.callService("yeelight_cube", "set_preview_adjustments", {
      entity_id: this.config.entity,
      ...allEffects,
    });

    // Update slider in DOM
    const slider = this.shadowRoot.querySelector(
      `input.effect-slider[data-effect="${effectName}"]`,
    );
    if (slider) {
      slider.value = defaultValue;
    }

    // Update value display
    const valueDisplay = this.shadowRoot.querySelector(
      `.compact-value[data-effect="${effectName}"]`,
    );
    if (valueDisplay) {
      const effectData = this._getEffectsData()
        .flatMap((s) => s.effects)
        .find((e) => e.name === effectName);
      const unit = effectData?.unit || "";
      valueDisplay.textContent = `${defaultValue}${unit}`;
    }

    // Clear from local effects
    delete this._localEffects[effectName];

    // Update change indicators and reset button visibility
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      this._updateChangeIndicators();
      this._updateCompactResetButtons();
    }, 10);
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

  _updateChangeIndicators() {
    // Update visual change indicators (orange dots) for all sections
    if (!this.shadowRoot) return;

    // Check if change indicators are enabled in config
    const showIndicators = this.config.show_change_indicators ?? true;

    // CLEANUP: When indicators are disabled, remove any lingering has-changes classes
    // This handles the case where the setting was just toggled OFF but HTML still has old classes
    if (!showIndicators) {
      const radialSegments = this.shadowRoot.querySelectorAll(
        ".radial-segment.has-changes",
      );
      radialSegments.forEach((segment) => {
        segment.classList.remove("has-changes");
      });
      return;
    }

    // Find all indicators in the DOM and update them based on actual rendered content
    const allIndicators = this.shadowRoot.querySelectorAll(
      ".change-indicator[data-section-id]",
    );

    // If no section indicators found, skip section updates (likely in compact mode)
    if (allIndicators.length > 0) {
      // Get all sections that actually exist in the current layout
      const allSections = this.shadowRoot.querySelectorAll("[data-section-id]");
      const sectionIds = new Set();
      allSections.forEach((el) => {
        const id = el.getAttribute("data-section-id");
        if (id) sectionIds.add(id);
      });

      sectionIds.forEach((sectionId) => {
        // Check if this section has any non-default values
        const hasChanges = this._checkSectionChanges(sectionId);

        // Find all indicators for this section
        const indicators = this.shadowRoot.querySelectorAll(
          `.change-indicator[data-section-id="${sectionId}"]`,
        );

        indicators.forEach((indicator) => {
          if (hasChanges) {
            indicator.classList.add("visible");
          } else {
            indicator.classList.remove("visible");
          }
        });
      });
    }

    // Also update compact layout indicators (effect-level, not section-level)
    const compactIndicators = this.shadowRoot.querySelectorAll(
      ".compact-indicator[data-effect]",
    );
    compactIndicators.forEach((indicator) => {
      const effectName = indicator.getAttribute("data-effect");
      const hasChanged = this._checkEffectChanged(effectName);
      if (hasChanged) {
        indicator.classList.add("visible");
      } else {
        indicator.classList.remove("visible");
      }
    });
  }

  _updateCompactResetButtons() {
    // Update visibility of reset buttons in compact layout based on changed state
    // Only needed when reset_button_mode is "changed"
    const mode = this.config.reset_button_mode || "always";
    if (mode !== "changed") return; // Skip if not in "changed" mode

    if (!this.shadowRoot) return;

    // Find all compact reset buttons
    const resetButtons = this.shadowRoot.querySelectorAll(
      ".compact-reset-button[data-effect]",
    );
    resetButtons.forEach((button) => {
      const effectName = button.getAttribute("data-effect");
      const hasChanged = this._checkEffectChanged(effectName);

      // Show/hide button based on changed state
      if (hasChanged) {
        button.style.display = "flex";
      } else {
        button.style.display = "none";
      }
    });
  }

  _updateSectionResetButtons() {
    // Update visibility of section-level reset buttons (for Tabbed, Grouped, Radial, Categories layouts)
    // Only needed when reset_button_mode is "changed"
    const mode = this.config.reset_button_mode || "always";

    if (!this.shadowRoot) return;

    // Only update if mode is "changed" - otherwise buttons are always visible/hidden via initial render
    if (mode !== "changed") return;

    // Find all section-level reset buttons (multiple classes for different layouts)
    const resetButtons = this.shadowRoot.querySelectorAll(
      "[data-section-id].tabbed-reset-button, [data-section-id].grouped-reset, [data-section-id].radial-reset-button, [data-section-id].categories-reset-button",
    );
    resetButtons.forEach((button) => {
      const sectionId = button.getAttribute("data-section-id");
      const hasChanges = this._checkSectionChanges(sectionId);

      // Show/hide button based on changed state
      // Tabbed buttons use "flex", others use "block"
      const visibleDisplay = button.classList.contains("tabbed-reset-button")
        ? "flex"
        : "block";
      if (hasChanges) {
        button.style.display = visibleDisplay;
      } else {
        button.style.display = "none";
      }
    });
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

    // Effect name to attribute name mapping (effects are stored as individual attributes)
    const effectMappings = {
      hue_shift: "preview_hue_shift",
      temperature: "preview_temperature",
      saturation: "preview_saturation",
      vibrance: "preview_vibrance",
      contrast: "preview_contrast",
      glow: "preview_glow",
      grayscale: "preview_grayscale",
      invert: "preview_invert",
      tint_hue: "preview_tint_hue",
      tint_strength: "preview_tint_strength",
    };

    // Check each effect in this section
    let hasChanges = false;

    for (const effect of section.effects) {
      const effectName = effect.name;
      const defaultValue = this._getDefaultValue(effectName);
      const attrName = effectMappings[effectName];

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

    const effectMappings = {
      hue_shift: "preview_hue_shift",
      temperature: "preview_temperature",
      saturation: "preview_saturation",
      vibrance: "preview_vibrance",
      contrast: "preview_contrast",
      glow: "preview_glow",
      grayscale: "preview_grayscale",
      invert: "preview_invert",
      tint_hue: "preview_tint_hue",
      tint_strength: "preview_tint_strength",
    };

    const defaultValue = this._getDefaultValue(effectName);
    const attrName = effectMappings[effectName];

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
    // Returns section definitions that work across all layouts
    // This maps section IDs to their effects
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return [];

    const stateObj = hass.states[entityId];
    if (!stateObj) return [];

    const effects = stateObj.attributes.effects || {};

    // Map all possible section IDs to their effects
    // This works for both categories layout and other layouts
    return [
      {
        id: "color_adjustments",
        effects: [{ name: "hue_shift" }, { name: "temperature" }],
      },
      {
        id: "color_shift", // Categories layout uses this
        effects: [{ name: "hue_shift" }, { name: "temperature" }],
      },
      {
        id: "tone_adjustments",
        effects: [
          { name: "contrast" },
          { name: "vibrance" },
          { name: "saturation" },
          { name: "glow" },
        ],
      },
      {
        id: "saturation_intensity", // Categories layout uses this
        effects: [{ name: "saturation" }, { name: "vibrance" }],
      },
      {
        id: "tone_contrast", // Categories layout uses this
        effects: [{ name: "contrast" }, { name: "glow" }],
      },
      {
        id: "special_effects",
        effects: [
          { name: "grayscale" },
          { name: "invert" },
          { name: "tint_hue" },
          { name: "tint_strength" },
        ],
      },
    ];
  }

  _getDefaultValue(effectName) {
    // Returns the default value for an effect based on its name
    const defaults = {
      hue_shift: 0,
      temperature: 0,
      saturation: 100,
      vibrance: 100,
      contrast: 100,
      glow: 0,
      grayscale: 0,
      invert: 0,
      tint_hue: 0,
      tint_strength: 0,
    };

    return defaults[effectName] !== undefined ? defaults[effectName] : 0;
  }

  _getEffectsData() {
    // Helper to get current effects data structure
    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) return [];

    const stateObj = hass.states[entityId];
    if (!stateObj) return [];

    const effects = stateObj.attributes.effects || {};

    // Helper to get value: prioritize _localEffects over entity state FOR DISPLAY
    const getValue = (effectName) => {
      return this._localEffects[effectName] !== undefined
        ? this._localEffects[effectName]
        : effects[effectName];
    };

    // Helper to get ENTITY value (not local effects) for change detection
    // Returns the actual entity value or undefined if not set
    const getEntityValue = (effectName) => {
      return effects[effectName];
    };

    return [
      {
        id: "color_adjustments",
        title: "Color",
        icon: "🎨",
        description: "Hue and tone",
        effects: [
          {
            name: "hue_shift",
            label: "Hue Shift",
            icon: "🔄",
            min: -180,
            max: 180,
            value: getValue("hue_shift"),
            entityValue: getEntityValue("hue_shift"),
            unit: "°",
            default: 0,
          },
          {
            name: "temperature",
            label: "Temperature",
            icon: "🌡️",
            min: -100,
            max: 100,
            value: getValue("temperature"),
            entityValue: getEntityValue("temperature"),
            unit: "",
            default: 0,
          },
          {
            name: "tint_hue",
            label: "Tint Hue",
            icon: "🎯",
            min: 0,
            max: 360,
            value: getValue("tint_hue"),
            entityValue: getEntityValue("tint_hue"),
            unit: "°",
            default: 0,
            hint: "Color for tint",
          },
          {
            name: "tint_strength",
            label: "Tint Strength",
            icon: "💧",
            min: 0,
            max: 100,
            value: getValue("tint_strength"),
            entityValue: getEntityValue("tint_strength"),
            unit: "%",
            default: 0,
            hint: "Tint intensity",
          },
        ],
      },
      {
        id: "tone_adjustments",
        title: "Tone",
        icon: "🌓",
        description: "Light and contrast",
        effects: [
          {
            name: "contrast",
            label: "Contrast",
            icon: "◐",
            min: -100,
            max: 100,
            value: getValue("contrast"),
            entityValue: getEntityValue("contrast"),
            unit: "",
            default: 0,
          },
          {
            name: "vibrance",
            label: "Vibrance",
            icon: "💥",
            min: -100,
            max: 100,
            value: getValue("vibrance"),
            entityValue: getEntityValue("vibrance"),
            unit: "",
            default: 0,
          },
          {
            name: "saturation",
            label: "Saturation",
            icon: "🎨",
            min: -100,
            max: 100,
            value: getValue("saturation"),
            entityValue: getEntityValue("saturation"),
            unit: "",
            default: 0,
          },
          {
            name: "glow",
            label: "Glow",
            icon: "✨",
            min: 0,
            max: 100,
            value: getValue("glow"),
            entityValue: getEntityValue("glow"),
            unit: "%",
            default: 0,
          },
        ],
      },
      {
        id: "special_effects",
        title: "Effects",
        icon: "✨",
        description: "Special filters",
        effects: [
          {
            name: "grayscale",
            label: "Grayscale",
            icon: "⬜",
            min: 0,
            max: 100,
            value: getValue("grayscale"),
            entityValue: getEntityValue("grayscale"),
            unit: "%",
            default: 0,
          },
          {
            name: "invert",
            label: "Invert",
            icon: "🔃",
            min: 0,
            max: 100,
            value: getValue("invert"),
            entityValue: getEntityValue("invert"),
            unit: "%",
            default: 0,
          },
        ],
      },
    ];
  }

  _updateEffectLabel(effectName, value) {
    // Get the unit for this effect
    const units = {
      contrast: "",
      glow: "%",
      saturation: "",
      vibrance: "",
      hue_shift: "°",
      temperature: "",
      grayscale: "%",
      invert: "%",
      tint_hue: "°",
      tint_strength: "%",
    };
    const unit = units[effectName] || "";

    // Get the label text
    const labelNames = {
      contrast: "Contrast",
      glow: "Glow",
      saturation: "Saturation",
      vibrance: "Vibrance",
      hue_shift: "Hue Shift",
      temperature: "Temperature",
      grayscale: "Grayscale",
      invert: "Invert",
      tint_hue: "Tint Hue",
      tint_strength: "Tint Strength",
    };
    const labelText = labelNames[effectName] || effectName;

    // Update labels for all layout modes using direct data-effect selectors

    // Compact layout - update the value span directly
    const compactValue = this.shadowRoot.querySelector(
      `.compact-value[data-effect="${effectName}"]`,
    );
    if (compactValue) {
      compactValue.textContent = `${value}${unit}`;
    }

    // Tabbed layout - update the label with the full text directly
    const tabbedLabel = this.shadowRoot.querySelector(
      `.tabbed-label[data-effect="${effectName}"]`,
    );
    if (tabbedLabel) {
      tabbedLabel.innerHTML = `${labelText}: <strong>${value}${unit}</strong>`;
    }

    // Grouped layout - update the value span directly
    const groupedValue = this.shadowRoot.querySelector(
      `.grouped-value[data-effect="${effectName}"]`,
    );
    if (groupedValue) {
      groupedValue.textContent = `${value}${unit}`;
    }

    // Radial layout - update the effect row value
    const radialRowValue = this.shadowRoot.querySelector(
      `.radial-effect-row-value[data-effect="${effectName}"]`,
    );
    if (radialRowValue) {
      radialRowValue.textContent = `${value}${unit}`;
    }

    // Also update if it's in an effect row (for the main display)
    const radialEffectRow = this.shadowRoot.querySelector(
      `.radial-effect-row[data-effect="${effectName}"] .radial-effect-row-value`,
    );
    if (radialEffectRow) {
      radialEffectRow.textContent = `${value}${unit}`;
    }

    // Categories layout - update the value span directly
    const categoriesValue = this.shadowRoot.querySelector(
      `.categories-effect-row-value[data-effect="${effectName}"]`,
    );
    if (categoriesValue) {
      categoriesValue.textContent = `${value}${unit}`;
    }

    // Legacy support (old effect-section layout)
    const legacyLabel = this.shadowRoot.querySelector(
      `label[data-effect="${effectName}"]`,
    );
    if (legacyLabel) {
      legacyLabel.textContent = `${labelText}: ${value}${unit}`;
    }
  }

  render() {
    const _tRender = performance.now();
    // Skip re-rendering if user is dragging a slider
    if (this._anySliderDragging) {
      return;
    }

    const entityId = this.config.entity;
    const hass = this._hass;
    if (!hass || !entityId) {
      return;
    }
    const stateObj = hass.states[entityId];

    if (!stateObj) {
      this.shadowRoot.innerHTML = `<ha-card>
        <div style="padding: 16px;">
          <h3>Entity not found: ${entityId}</h3>
          <p>Please check your configuration and ensure the entity exists.</p>
        </div>
      </ha-card>`;
      return;
    }
    let usingFallbackMatrix = false;
    let matrixColors = stateObj.attributes.matrix_colors;

    if (!matrixColors) {
      // Use a blank matrix as fallback instead of showing an error
      matrixColors = getInitialMatrix(5, 20); // 5 rows x 20 cols
      usingFallbackMatrix = true;
    }

    // Use entity state for brightness (no optimistic updates to prevent flash)
    const entityBrightness = stateObj.attributes.brightness ?? 255;

    // Convert entity brightness (3-255) to slider scale (1-100) for display
    // This matches the forward conversion: slider 1-100 ? HA 3-255
    let sliderBrightness;
    if (entityBrightness <= 3) {
      sliderBrightness = 1;
    } else if (entityBrightness >= 255) {
      sliderBrightness = 100;
    } else {
      // Reverse the forward formula: ((brightness-3) / 252) * 99 + 1
      sliderBrightness = Math.round(((entityBrightness - 3) / 252) * 99) + 1;
    }

    // Get all effect values (local or entity state)
    const effects = {
      hue_shift:
        this._localEffects.hue_shift ??
        stateObj?.attributes?.preview_hue_shift ??
        0,
      temperature:
        this._localEffects.temperature ??
        stateObj?.attributes?.preview_temperature ??
        0,
      saturation:
        this._localEffects.saturation ??
        stateObj?.attributes?.preview_saturation ??
        100,
      vibrance:
        this._localEffects.vibrance ??
        stateObj?.attributes?.preview_vibrance ??
        100,
      contrast:
        this._localEffects.contrast ??
        stateObj?.attributes?.preview_contrast ??
        100,
      glow: this._localEffects.glow ?? stateObj?.attributes?.preview_glow ?? 0,
      grayscale:
        this._localEffects.grayscale ??
        stateObj?.attributes?.preview_grayscale ??
        0,
      invert:
        this._localEffects.invert ?? stateObj?.attributes?.preview_invert ?? 0,
      tint_hue:
        this._localEffects.tint_hue ??
        stateObj?.attributes?.preview_tint_hue ??
        0,
      tint_strength:
        this._localEffects.tint_strength ??
        stateObj?.attributes?.preview_tint_strength ??
        0,
    };

    // Render the card (pass entity brightness for color calculations, slider brightness for slider display)
    this._renderCard(
      stateObj,
      matrixColors,
      entityBrightness,
      sliderBrightness,
      effects,
    );
  }

  _renderCard(
    stateObj,
    matrixColors,
    entityBrightness,
    sliderBrightness,
    effects,
  ) {
    // Helper to apply ALL color adjustments (matching backend logic)
    const applyColorAdjustments = (rgbArray, originalRgb, brightness) => {
      let [r, g, b] = rgbArray;

      // If the original pixel was black, keep it black (don't apply effects to background)
      const isOriginalBlack =
        originalRgb[0] === 0 && originalRgb[1] === 0 && originalRgb[2] === 0;

      if (isOriginalBlack) {
        return [0, 0, 0];
      }

      // Note: Darken/brighten effects removed - use light brightness control instead
      // The preview now only shows actual color effects, not brightness adjustments

      return [r, g, b];
    };

    // Apply brightness and color adjustments to all pixels
    //
    // Perceptual boost: LCD screens look dimmer than LEDs at the same RGB.
    // We compute a target "effective" brightness from the lamp brightness
    // slider, then divide by the darken factor to get the boost multiplier.
    //
    //   effective = FLOOR + (1 - FLOOR) * t^GAMMA   (smooth power curve)
    //   boost     = effective / darkenFactor
    //
    // This is guaranteed monotonic (power + constant floor), never flat,
    // and controlled by just GAMMA (curve shape) and BOOST (floor height).
    const darkenPercent = stateObj.attributes.preview_darken ?? 0;
    const _minFactor = 1 - PREVIEW_MAX_DARKEN_PERCENT / 100; // 0.06
    const _darkenFactor = Math.max(_minFactor, 1 - darkenPercent / 100);
    const _floor = PREVIEW_MIN_BRIGHTNESS_BOOST * _minFactor; // ≈ 0.48
    const _t = entityBrightness / 255; // normalised lamp brightness 0..1
    const _effective =
      _floor + (1 - _floor) * Math.pow(_t, PREVIEW_BRIGHTNESS_GAMMA);
    const previewBoost = _effective / _darkenFactor;

    const gridColors = matrixColors.map((rgb) => {
      if (!Array.isArray(rgb) || rgb.length !== 3) rgb = [0, 0, 0];

      const originalRgb = [...rgb]; // Keep original for black check

      const brightAdjusted = rgb.map((v) =>
        Math.min(255, Math.round(v * previewBoost)),
      );

      // Then apply color effects (pass original RGB for black check)
      const finalColor = applyColorAdjustments(
        brightAdjusted,
        originalRgb,
        entityBrightness,
      );

      return rgbToCss(finalColor);
    });

    // Generate matrix HTML (pass stateObj for orientation info)
    const matrixHtml =
      this.config.show_lamp_preview !== false
        ? this._generateMatrixHtml(gridColors, stateObj)
        : "";

    // Use user-set brightness if available (prevents jumping during render storms)
    const displayBrightness =
      this._userSetBrightness !== null
        ? this._userSetBrightness
        : sliderBrightness;

    // Detect brightness oscillation (HA sending alternating old/new values)
    if (
      this._lastRenderedBrightness !== null &&
      this._lastRenderedBrightness !== sliderBrightness &&
      this._userSetBrightness === null
    ) {
      this._brightnessOscillationCount++;

      // If we detect rapid oscillations (>2 changes), skip this render entirely
      if (this._brightnessOscillationCount > 2) {
        // Reset counter after 500ms of no oscillations
        clearTimeout(this._oscillationResetTimeout);
        this._oscillationResetTimeout = setTimeout(() => {
          this._brightnessOscillationCount = 0;
        }, 500);
        return; // Skip this render completely
      }
    } else if (this._lastRenderedBrightness === sliderBrightness) {
      // Same value - reset oscillation counter
      this._brightnessOscillationCount = 0;
    }

    this._lastRenderedBrightness = displayBrightness;

    // Generate lamp controls HTML (buttons and brightness slider)
    const lampControlsHtml =
      this.config.show_lamp_control !== false
        ? this._generateLampControlsHtml(stateObj, displayBrightness)
        : "";

    // Generate adjustment controls HTML (color effects)
    const adjustmentControlsHtml =
      this.config.show_adjustment_controls === true
        ? this._generateAdjustmentControlsHtml(effects)
        : "";

    // Generate final template
    const showCard = this.config.show_card_background !== false;
    const cardTitle = this.config.card_title || "";
    const usingFallbackMatrix = !stateObj.attributes.matrix_colors;

    // Smart update: Only rebuild DOM if not initialized or if dragging just ended
    const needsFullRender =
      !this._isInitialRenderComplete ||
      !this.shadowRoot.querySelector(".lamp-preview-css");

    if (needsFullRender) {
      // Full render on first load or structural changes
      this.shadowRoot.innerHTML = `
        ${this._getStyles()}
        ${
          showCard
            ? `<ha-card${
                cardTitle
                  ? ` header="${cardTitle}${
                      usingFallbackMatrix ? " (No Matrix Data)" : ""
                    }"`
                  : ""
              }>
               <div style="display: flex; width: 100%;">
                 <div class="yeelight-cube-lamp-preview-container">
                   ${matrixHtml}
                   ${lampControlsHtml}
                   ${adjustmentControlsHtml}
                 </div>
               </div>
             </ha-card>`
            : `<div style="display: flex; width: 100%;">
               <div class="yeelight-cube-lamp-preview-container">
                 ${
                   cardTitle
                     ? `<div style="font-weight:600;font-size:1.1em;margin-bottom:8px;">${cardTitle}</div>`
                     : ""
                 }
                 ${matrixHtml}
                 ${lampControlsHtml}
                 ${adjustmentControlsHtml}
               </div>
             </div>`
        }
      `;
      this._isInitialRenderComplete = true;

      // Update change indicators after initial render
      requestAnimationFrame(() => {
        this._updateChangeIndicators();

        // Double-check indicators after a short delay to ensure everything is ready
        setTimeout(() => {
          this._updateChangeIndicators();
        }, 100);
      });
    } else {
      // Smart update: Only update matrix colors and slider values
      const _tSmart = performance.now();
      this._updateMatrixColors(gridColors, stateObj);
      this._updateSliderValues(displayBrightness, effects); // Use cached value to prevent jumping
      this._updatePowerButton(stateObj);

      // Update change indicators on smart updates too, but defer to next frame
      // to avoid querying DOM while it's being updated
      requestAnimationFrame(() => {
        this._updateChangeIndicators();
      });
    }
  }

  // Update only matrix dot colors without rebuilding DOM
  _updateMatrixColors(gridColors, stateObj) {
    const dots = this.shadowRoot.querySelectorAll(".lamp-dot");
    if (dots.length !== gridColors.length) {
      // Mismatch - need full render
      this._isInitialRenderComplete = false;
      this.render();
      return;
    }

    const totalRows = 5;
    const totalCols = 20;
    // Automatically flip preview if lamp entity orientation is "flipped"
    const flipPreview = stateObj?.attributes?.orientation === "flipped";

    dots.forEach((dot, idx) => {
      // Apply the same row-flipping logic as _generateMatrixHtml
      const row = Math.floor(idx / totalCols);
      const col = idx % totalCols;
      const flippedRow = totalRows - 1 - row;

      // Get base color index
      let colorIndex = flippedRow * totalCols + col;

      // Apply preview flip if enabled
      if (flipPreview) {
        const previewFlippedRow = totalRows - 1 - flippedRow;
        const previewFlippedCol = totalCols - 1 - col;
        colorIndex = previewFlippedRow * totalCols + previewFlippedCol;
      }

      const color = gridColors[colorIndex] || "#000000";

      // Check if pixel is black using RGB values (same logic as _generateMatrixHtml)
      let isBlack = false;
      if (color.startsWith("#")) {
        const hex = color.replace(/^#/, "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        isBlack =
          r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD;
      } else if (color.startsWith("rgb")) {
        const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const r = parseInt(match[1]);
          const g = parseInt(match[2]);
          const b = parseInt(match[3]);
          isBlack =
            r <= BLACK_THRESHOLD &&
            g <= BLACK_THRESHOLD &&
            b <= BLACK_THRESHOLD;
        }
      }

      const isEmpty = this.config.hide_black_dots ? isBlack : false;
      const displayColor =
        this.config.hide_black_dots && isBlack ? "transparent" : color;

      // Update background and class
      dot.style.background = displayColor;
      if (isEmpty) {
        dot.classList.add("lamp-dot-empty");
      } else {
        dot.classList.remove("lamp-dot-empty");
      }
    });
  }

  // Update only slider values without rebuilding DOM
  _updateSliderValues(brightness, effects) {
    // Update brightness slider and visual indicators
    const brightnessSlider =
      this.shadowRoot.querySelector(".brightness-slider");
    if (brightnessSlider && !this._anySliderDragging) {
      brightnessSlider.value = brightness;

      // Also update visual brightness indicators (bar fill, percentage, rotary progress)
      const sliderStyle = this.config.brightness_slider_style || "minimal";
      const showPercentage = this.config.show_brightness_percentage !== false;

      if (sliderStyle === "bar") {
        const barFill = this.shadowRoot?.querySelector(".brightness-bar-fill");
        if (barFill) barFill.style.width = `${brightness}%`;

        if (showPercentage) {
          const valueRight = this.shadowRoot?.querySelector(
            ".brightness-value-right",
          );
          if (valueRight) valueRight.textContent = `${brightness}%`;
        }
      } else if (sliderStyle === "rotary") {
        const angle = ((brightness - 1) / 99) * 270; // Map 1-100 to 0-270 degrees
        const radius = 40;
        const circumference = 2 * Math.PI * radius; // ~251.33
        const arcLength = (circumference * 270) / 360; // Exact 270 degree arc
        const progressArcLength = (angle / 270) * arcLength;
        const rotaryProgress =
          this.shadowRoot?.querySelector(".rotary-progress");
        if (rotaryProgress) {
          rotaryProgress.style.strokeDasharray = `${progressArcLength} ${circumference}`;
        }

        if (showPercentage) {
          const rotaryValue = this.shadowRoot?.querySelector(".rotary-value");
          if (rotaryValue) rotaryValue.textContent = `${brightness}%`;
        }
      } else if (sliderStyle === "capsule") {
        const capsuleFill = this.shadowRoot?.querySelector(".capsule-fill");
        const capsuleThumb = this.shadowRoot?.querySelector(".capsule-thumb");
        if (capsuleFill) {
          capsuleFill.style.setProperty("--brightness-percent", brightness);
        }
        if (capsuleThumb) {
          capsuleThumb.style.setProperty("--brightness-percent", brightness);
        }

        if (showPercentage) {
          const percentageStandalone = this.shadowRoot?.querySelector(
            ".brightness-percentage-standalone",
          );
          if (percentageStandalone)
            percentageStandalone.textContent = `${brightness}%`;
        }
      } else {
        // Slider mode (default)
        if (showPercentage) {
          const valueSlider = this.shadowRoot?.querySelector(
            ".brightness-value-slider",
          );
          if (valueSlider) valueSlider.textContent = `${brightness}%`;
        }
      }
    }

    // Update effect sliders
    Object.entries(effects).forEach(([effectName, value]) => {
      const slider = this.shadowRoot.querySelector(
        `.effect-slider[data-effect="${effectName}"]`,
      );
      if (slider && !this._anySliderDragging) {
        slider.value = value;
        // Update the displayed value text
        this._updateEffectLabel(effectName, value);
      }
    });
  }

  _updatePowerButton(stateObj) {
    const powerButton = this.shadowRoot.querySelector(
      ".power-toggle-container button",
    );
    if (!powerButton) {
      return;
    }

    const style = this.config.buttons_style || "classic";
    const isOn = stateObj.state === "on";
    const stateClass = isOn ? "on" : "off";
    const label = isOn ? "Turn Off" : "Turn On";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    // Update button state class (add/remove "on" or "off")
    powerButton.classList.remove("on", "off");
    powerButton.classList.add(stateClass);

    // Clear loading state only when we reach the expected state
    if (this._powerToggling && this._expectedPowerState !== null) {
      if (isOn === this._expectedPowerState) {
        this._powerToggling = false;
        this._expectedPowerState = null;
        powerButton.disabled = false;
      } else {
        // Keep loading state - we haven't reached expected state yet
        return;
      }
    }

    // Update button content
    powerButton.innerHTML = renderButtonContent(
      "mdi:power",
      label,
      contentMode,
    );
    powerButton.title = label;
  }

  _updatePowerButtonLoadingState(isLoading) {
    const powerButton = this.shadowRoot.querySelector(
      ".power-toggle-container button",
    );
    if (!powerButton) return;

    const style = this.config.buttons_style || "classic";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    powerButton.disabled = isLoading;

    if (isLoading) {
      // Show loading spinner
      powerButton.innerHTML = renderButtonContent(
        "mdi:loading",
        "Loading...",
        contentMode,
      );
      powerButton.title = "Loading...";
      // Add spinning class to the icon
      const icon = powerButton.querySelector("ha-icon");
      if (icon) icon.classList.add("spinning");
    }
  }

  _generateMatrixHtml(gridColors, stateObj) {
    const totalRows = 5;
    const totalCols = 20;
    const pixelGap =
      typeof this.config.matrix_pixel_gap === "number"
        ? this.config.matrix_pixel_gap
        : 0;
    const matrixBackground = this.config.matrix_background || "black";
    const matrixBoxShadow = this.config.matrix_box_shadow !== false;
    const pixelStyle = this.config.matrix_pixel_style || "round";
    const lampDotShadow = this.config.lamp_dot_shadow !== false;
    const alignClass =
      this.config.align === "left"
        ? "align-left"
        : this.config.align === "right"
          ? "align-right"
          : "align-center";

    // Automatically flip preview if lamp entity orientation is "flipped"
    // This keeps the preview readable regardless of physical lamp orientation
    const flipPreview = stateObj?.attributes?.orientation === "flipped";

    const pixels = Array.from({ length: totalRows * totalCols })
      .map((_, idx) => {
        const row = Math.floor(idx / totalCols);
        const col = idx % totalCols;
        const flippedRow = totalRows - 1 - row;

        // Get base color index (already vertically flipped from data)
        let colorIndex = flippedRow * totalCols + col;

        // Apply preview flip (180° rotation = flip both row AND column)
        if (flipPreview) {
          const previewFlippedRow = totalRows - 1 - flippedRow;
          const previewFlippedCol = totalCols - 1 - col;
          colorIndex = previewFlippedRow * totalCols + previewFlippedCol;
        }

        const color = gridColors[colorIndex] || "#000000";

        // Check if pixel is black using RGB values (more robust than string matching)
        // Uses shared BLACK_THRESHOLD from draw_card_const.js
        let isBlack = false;
        if (color.startsWith("#")) {
          // Hex color format
          const hex = color.replace(/^#/, "");
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          isBlack =
            r <= BLACK_THRESHOLD &&
            g <= BLACK_THRESHOLD &&
            b <= BLACK_THRESHOLD;
        } else if (color.startsWith("rgb")) {
          // RGB color format
          const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            isBlack =
              r <= BLACK_THRESHOLD &&
              g <= BLACK_THRESHOLD &&
              b <= BLACK_THRESHOLD;
          }
        }

        const isEmpty = this.config.hide_black_dots ? isBlack : false;
        const displayColor =
          this.config.hide_black_dots && isBlack ? "transparent" : color;

        // For empty dots, use inline style background: transparent
        return `<div class="lamp-dot${
          isEmpty ? " lamp-dot-empty" : ""
        }" style="background: ${displayColor};"></div>`;
      })
      .join("");

    return `
      <div class="lamp-preview-css ${alignClass}" 
           style="width:${this.config.size_pct || 100}%; 
                  background: ${matrixBackground}; 
                  gap: ${pixelGap}px; 
                  box-shadow: ${matrixBoxShadow ? "0 2px 8px #0008" : "none"};
                  grid-template-columns: repeat(${totalCols}, 1fr);
                  grid-template-rows: repeat(${totalRows}, 1fr);">
        ${pixels}
      </div>
    `;
  }

  _generateLampControlsHtml(stateObj, brightness) {
    let html = "";

    // Power toggle and force refresh buttons on same line
    const showPowerToggle = this.config.show_power_toggle === true;
    const showForceRefresh = this.config.show_force_refresh_button !== false;

    if (showPowerToggle || showForceRefresh) {
      const buttonCount = [showPowerToggle, showForceRefresh].filter(
        Boolean,
      ).length;
      const multiClass = buttonCount >= 2 ? " two-buttons" : "";
      html += `<div class="button-row${multiClass}">`;
      if (showForceRefresh) {
        html += this._generateForceRefreshButtonHtml();
      }
      if (showPowerToggle) {
        html += this._generatePowerToggleHtml(stateObj);
      }
      html += "</div>";
    }

    // Brightness slider (brightness parameter is already converted to 1-100 scale)
    if (this.config.show_brightness_slider === true) {
      const sliderStyle = this.config.brightness_slider_style || "slider";
      const sliderAppearance =
        this.config.brightness_slider_appearance || "default";
      const labelMode = this.config.brightness_label_mode || "text";
      const brightnessPercent = brightness;

      // Generate label content based on mode
      let labelContent = "";
      if (labelMode === "text") {
        labelContent = "Brightness";
      } else if (labelMode === "icon") {
        labelContent = "💡";
      } else if (labelMode === "icon_text") {
        labelContent = "💡 Brightness";
      }

      html += `<div class="brightness-slider-container brightness-style-${sliderStyle}" onwheel="this.getRootNode().host.handleBrightnessWheel(event)">`;

      if (sliderStyle === "bar") {
        // Mushroom-style bar with different label layouts
        if (labelMode === "text" || labelMode === "icon_text") {
          // Text or icon+text: show above, bar takes full width
          html += `
            ${
              labelMode === "text"
                ? `<div class="brightness-label">${labelContent}</div>`
                : `<div class="brightness-label-with-icon">${labelContent}</div>`
            }
            <div class="brightness-bar-wrapper brightness-bar-full">
              <div class="brightness-bar-track">
                <div class="brightness-bar-fill" style="width: ${brightnessPercent}%"></div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value="${brightness}" 
                  class="brightness-slider brightness-slider-bar"
                  onmousedown="this.getRootNode().host._startDrag()"
                  ontouchstart="this.getRootNode().host._startDrag()"
                  onmouseup="this.getRootNode().host._endDrag()"
                  ontouchend="this.getRootNode().host._endDrag()"
                  oninput="this.getRootNode().host.handleBrightnessChange(event)"
                />
              </div>
              ${
                this.config.show_brightness_percentage !== false
                  ? `<div class="brightness-value-right">${brightnessPercent}%</div>`
                  : ""
              }
            </div>
          `;
        } else if (labelMode === "icon") {
          // Icon only: show large icon on left
          html += `
            <div class="brightness-bar-wrapper">
              <span class="brightness-icon-large">${labelContent}</span>
              <div class="brightness-bar-track">
                <div class="brightness-bar-fill" style="width: ${brightnessPercent}%"></div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value="${brightness}" 
                  class="brightness-slider brightness-slider-bar"
                  onmousedown="this.getRootNode().host._startDrag()"
                  ontouchstart="this.getRootNode().host._startDrag()"
                  onmouseup="this.getRootNode().host._endDrag()"
                  ontouchend="this.getRootNode().host._endDrag()"
                  oninput="this.getRootNode().host.handleBrightnessChange(event)"
                />
              </div>
              ${
                this.config.show_brightness_percentage !== false
                  ? `<div class="brightness-value-right">${brightnessPercent}%</div>`
                  : ""
              }
            </div>
          `;
        } else {
          // None: just bar with percentage
          html += `
            <div class="brightness-bar-wrapper brightness-bar-full">
              <div class="brightness-bar-track">
                <div class="brightness-bar-fill" style="width: ${brightnessPercent}%"></div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value="${brightness}" 
                  class="brightness-slider brightness-slider-bar"
                  onmousedown="this.getRootNode().host._startDrag()"
                  ontouchstart="this.getRootNode().host._startDrag()"
                  onmouseup="this.getRootNode().host._endDrag()"
                  ontouchend="this.getRootNode().host._endDrag()"
                  oninput="this.getRootNode().host.handleBrightnessChange(event)"
                />
              </div>
              ${
                this.config.show_brightness_percentage !== false
                  ? `<div class="brightness-value-right">${brightnessPercent}%</div>`
                  : ""
              }
            </div>
          `;
        }
      } else if (sliderStyle === "rotary") {
        // Rotary/circular dial style - 270 degree arc
        const angle = ((brightnessPercent - 1) / 99) * 270; // Map 1-100% to 0-270 degrees
        const radius = 40;
        const circumference = 2 * Math.PI * radius; // ~251.33
        const arcLength = (circumference * 270) / 360; // Exact 270 degree arc
        const progressArcLength = (angle / 270) * arcLength;
        html += `
          <div class="brightness-rotary-wrapper" onwheel="this.getRootNode().host.handleBrightnessWheel(event)">
            <div class="brightness-rotary-container" 
                 onmousedown="this.getRootNode().host.handleRotaryDragStart(event)"
                 ontouchstart="this.getRootNode().host.handleRotaryDragStart(event)"
                 style="position: relative; z-index: 10;">
              <svg class="brightness-rotary-svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="${radius}" class="rotary-bg"
                  style="stroke-dasharray: ${arcLength} ${circumference};" />
                <circle cx="50" cy="50" r="${radius}" class="rotary-progress" 
                  style="stroke-dasharray: ${progressArcLength} ${circumference};" />
              </svg>
              <div class="rotary-center-content">
                ${
                  labelMode !== "none"
                    ? `<div class="rotary-label">${labelContent}</div>`
                    : ""
                }
                ${
                  this.config.show_brightness_percentage !== false
                    ? `<div class="rotary-value">${brightnessPercent}%</div>`
                    : ""
                }
              </div>
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider brightness-slider-rotary"
                style="display: none;"
              />
            </div>
          </div>
        `;
      } else if (sliderStyle === "capsule") {
        // Capsule/pill style with moon and sun icons - label always above
        if (labelMode === "text") {
          html += `<div class="brightness-label">${labelContent}</div>`;
        } else if (labelMode === "icon") {
          html += `<div class="brightness-label">${labelContent}</div>`;
        } else if (labelMode === "icon_text") {
          html += `<div class="brightness-label-with-icon">${labelContent}</div>`;
        }

        const capsuleTheme = this.config.capsule_theme || "light";
        const showMoonIcon = this.config.show_capsule_moon_icon !== false;
        const showSunIcon = this.config.show_capsule_sun_icon !== false;

        html += `
          <div class="brightness-capsule-wrapper">
            <div class="brightness-capsule brightness-capsule-${capsuleTheme}">
              ${
                showMoonIcon
                  ? '<div class="capsule-icon capsule-icon-left">🌙</div>'
                  : ""
              }
              <div class="capsule-track">
                <div class="capsule-fill"></div>
                <div class="capsule-thumb"></div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value="${brightness}" 
                  class="brightness-slider brightness-slider-capsule"
                  onmousedown="this.getRootNode().host._startDrag()"
                  ontouchstart="this.getRootNode().host._startDrag()"
                  onmouseup="this.getRootNode().host._endDrag()"
                  ontouchend="this.getRootNode().host._endDrag()"
                  oninput="this.getRootNode().host.handleBrightnessChange(event)"
                />
              </div>
              ${
                showSunIcon
                  ? '<div class="capsule-icon capsule-icon-right">☀️</div>'
                  : ""
              }
            </div>
            ${
              this.config.show_brightness_percentage !== false
                ? `<div class="brightness-percentage-standalone">${brightnessPercent}%</div>`
                : ""
            }
          </div>
        `;
      } else {
        // Slider (default) style - unified minimal/compact with appearance options
        const sliderClass = `brightness-slider-${sliderAppearance}`;

        if (labelMode === "icon") {
          // Icon only - show large icon on left
          html += `
            <div class="brightness-slider-wrapper">
              <span class="brightness-icon-large">${labelContent}</span>
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider ${sliderClass}"
                onmousedown="this.getRootNode().host._startDrag()"
                ontouchstart="this.getRootNode().host._startDrag()"
                onmouseup="this.getRootNode().host._endDrag()"
                ontouchend="this.getRootNode().host._endDrag()"
                oninput="this.getRootNode().host.handleBrightnessChange(event)"
              />
              ${
                this.config.show_brightness_percentage !== false
                  ? `<span class="brightness-value-slider">${brightnessPercent}%</span>`
                  : ""
              }
            </div>
          `;
        } else if (labelMode === "icon_text") {
          // Icon + text - show larger icon and text above slider
          html += `
            <div class="brightness-label-with-icon">${labelContent}</div>
            <div class="brightness-slider-wrapper${
              this.config.show_brightness_percentage !== false
                ? ""
                : " brightness-slider-full"
            }">
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider ${sliderClass}"
                onmousedown="this.getRootNode().host._startDrag()"
                ontouchstart="this.getRootNode().host._startDrag()"
                onmouseup="this.getRootNode().host._endDrag()"
                ontouchend="this.getRootNode().host._endDrag()"
                oninput="this.getRootNode().host.handleBrightnessChange(event)"
              />
              ${
                this.config.show_brightness_percentage !== false
                  ? `<span class="brightness-value-slider">${brightnessPercent}%</span>`
                  : ""
              }
            </div>
          `;
        } else if (labelMode === "text") {
          // Text only - show above slider
          html += `
            <div class="brightness-label">${labelContent}</div>
            <div class="brightness-slider-wrapper${
              this.config.show_brightness_percentage !== false
                ? ""
                : " brightness-slider-full"
            }">
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider ${sliderClass}"
                onmousedown="this.getRootNode().host._startDrag()"
                ontouchstart="this.getRootNode().host._startDrag()"
                onmouseup="this.getRootNode().host._endDrag()"
                ontouchend="this.getRootNode().host._endDrag()"
                oninput="this.getRootNode().host.handleBrightnessChange(event)"
              />
              ${
                this.config.show_brightness_percentage !== false
                  ? `<span class="brightness-value-slider">${brightnessPercent}%</span>`
                  : ""
              }
            </div>
          `;
        } else {
          // None - just slider
          html += `
            <div class="brightness-slider-wrapper${
              this.config.show_brightness_percentage !== false
                ? ""
                : " brightness-slider-full"
            }">
              <input 
                type="range" 
                min="1" 
                max="100" 
                value="${brightness}" 
                class="brightness-slider ${sliderClass}"
                onmousedown="this.getRootNode().host._startDrag()"
                ontouchstart="this.getRootNode().host._startDrag()"
                onmouseup="this.getRootNode().host._endDrag()"
                ontouchend="this.getRootNode().host._endDrag()"
                oninput="this.getRootNode().host.handleBrightnessChange(event)"
              />
              ${
                this.config.show_brightness_percentage !== false
                  ? `<span class="brightness-value-slider">${brightnessPercent}%</span>`
                  : ""
              }
            </div>
          `;
        }
      }

      html += `</div>`;
    } else if (this.config.show_brightness_percentage !== false) {
      // Slider is hidden but percentage should be shown
      const labelMode = this.config.brightness_label_mode || "text";
      let labelContent = "";
      if (labelMode === "text") {
        labelContent = "Brightness";
      } else if (labelMode === "icon") {
        labelContent = `<ha-icon icon="mdi:brightness-6"></ha-icon>`;
      } else if (labelMode === "icon_text") {
        labelContent = `<ha-icon icon="mdi:brightness-6"></ha-icon> Brightness`;
      }

      html += `<div class="brightness-controls">`;
      if (labelMode !== "none") {
        if (labelMode === "icon_text") {
          html += `<div class="brightness-label-with-icon">${labelContent}</div>`;
        } else if (labelMode === "text") {
          html += `<div class="brightness-label">${labelContent}</div>`;
        } else if (labelMode === "icon") {
          html += `<span class="brightness-icon-large">${labelContent}</span>`;
        }
      }
      html += `<div class="brightness-percentage-standalone">${brightness}%</div>`;
      html += `</div>`;
    }

    return html;
  }

  _generateAdjustmentControlsHtml(effects) {
    let html = "";

    const layoutMode = this.config.adjustments_layout || "grouped";

    const effectsData = [
      {
        id: "color_adjustments",
        title: "Color",
        icon: "🎨",
        description: "Hue and tone",
        effects: [
          {
            name: "hue_shift",
            label: "Hue Shift",
            icon: "🔄",
            min: -180,
            max: 180,
            value: effects.hue_shift,
            unit: "°",
            default: 0,
          },
          {
            name: "temperature",
            label: "Temperature",
            icon: "🌡️",
            min: -100,
            max: 100,
            value: effects.temperature,
            unit: "",
            default: 0,
            hint: "Cool ❄ → Warm",
          },
        ],
      },
      {
        id: "saturation_intensity",
        title: "Intensity",
        icon: "💎",
        description: "Color richness",
        effects: [
          {
            name: "saturation",
            label: "Saturation",
            icon: "🎨",
            min: 0,
            max: 200,
            value: effects.saturation,
            unit: "",
            default: 100,
          },
          {
            name: "vibrance",
            label: "Vibrance",
            icon: "💥",
            min: 0,
            max: 200,
            value: effects.vibrance,
            unit: "",
            default: 100,
            hint: "Smart saturation",
          },
        ],
      },
      {
        id: "tone_contrast",
        title: "Tone",
        icon: "🌓",
        description: "Light/dark balance",
        effects: [
          {
            name: "contrast",
            label: "Contrast",
            icon: "◐",
            min: 0,
            max: 200,
            value: effects.contrast,
            unit: "",
            default: 100,
          },
          {
            name: "glow",
            label: "Glow",
            icon: "✨",
            min: 0,
            max: 100,
            value: effects.glow,
            unit: "%",
            default: 0,
            hint: "Boost bright pixels",
          },
        ],
      },
      {
        id: "special_effects",
        title: "Effects",
        icon: "✨",
        description: "Creative transforms",
        effects: [
          {
            name: "grayscale",
            label: "Grayscale",
            icon: "⬜",
            min: 0,
            max: 100,
            value: effects.grayscale,
            unit: "%",
            default: 0,
          },
          {
            name: "invert",
            label: "Invert",
            icon: "🔃",
            min: 0,
            max: 100,
            value: effects.invert,
            unit: "%",
            default: 0,
          },
          {
            name: "tint_hue",
            label: "Tint Hue",
            icon: "🎯",
            min: 0,
            max: 360,
            value: effects.tint_hue,
            unit: "°",
            default: 0,
            hint: "Color for tint",
          },
          {
            name: "tint_strength",
            label: "Tint Strength",
            icon: "💧",
            min: 0,
            max: 100,
            value: effects.tint_strength,
            unit: "%",
            default: 0,
            hint: "Tint intensity",
          },
        ],
      },
    ];

    // Generate HTML based on layout mode
    if (layoutMode === "compact") {
      html += this._generateCompactLayout(effectsData);
    } else if (layoutMode === "tabbed") {
      html += this._generateTabbedLayout(effectsData);
    } else if (layoutMode === "radial") {
      html += this._generateRadialLayout(effectsData);
    } else if (layoutMode === "categories") {
      html += this._generateCategoriesLayout(effectsData);
    } else {
      // Default to "grouped" layout
      html += this._generateGroupedLayout(effectsData);
    }

    return html;
  }

  _generatePowerToggleHtml(stateObj) {
    const style = this.config.buttons_style || "classic";
    const isOn = stateObj.state === "on";
    const stateClass = isOn ? "on" : "off";
    const label = isOn ? "Turn Off" : "Turn On";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";

    // Use centralized utility for button class
    const buttonClass = getExportImportButtonClass("power", style);

    return `
      <div class="power-toggle-container">
        <button 
          class="${buttonClass} ${stateClass}"
          onclick="this.getRootNode().host.handlePowerToggle()"
          title="${label}"
        >
          ${renderButtonContent("mdi:power", label, contentMode)}
        </button>
      </div>
    `;
  }

  _generateForceRefreshButtonHtml() {
    const style = this.config.buttons_style || "classic";
    const isLoading = this._forceRefreshLoading;
    const icon = isLoading ? "mdi:loading" : "mdi:flash";
    const label = isLoading ? "Refreshing..." : "Force Refresh";
    const contentMode =
      style === "icon"
        ? "icon"
        : this.config.buttons_content_mode || "icon_text";
    const buttonClass = getExportImportButtonClass("force-refresh", style);
    const disabledAttr = isLoading ? " disabled" : "";

    return `
      <div class="force-refresh-container">
        <button 
          class="${buttonClass}${isLoading ? " loading" : ""}" 
          onclick="this.getRootNode().host.forceRefreshLamp()"
          title="Force Refresh"
          ${disabledAttr}
        >
          ${renderButtonContent(icon, label, contentMode)}
        </button>
      </div>
    `;
  }

  // Compact Layout: All controls in a single clean panel with minimal spacing
  _generateCompactLayout(sections) {
    const showIndicators = this.config?.show_change_indicators ?? true;
    const resetButtonMode = this.config.reset_button_mode || "always";

    // Add class to container based on reset button mode for CSS styling
    let html = `<div class="effects-compact-container reset-mode-${resetButtonMode}">`;

    // Render all effects in a compact grid
    sections.forEach((section) => {
      section.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        const hasChanged = this._checkEffectChanged(effect.name);

        // Determine if reset button should be visible
        let resetButtonVisible = false;
        if (resetButtonMode === "always") {
          resetButtonVisible = true;
        } else if (resetButtonMode === "changed") {
          resetButtonVisible = hasChanged;
        }
        // resetButtonMode === "never" ? resetButtonVisible stays false

        html += `
          <div class="compact-slider-row">
            <span class="compact-icon">${effect.icon || section.icon}</span>
            <span class="compact-label">
              ${effect.label}
              ${
                showIndicators
                  ? `<span class="change-indicator compact-indicator ${
                      hasChanged ? "visible" : ""
                    }" data-effect="${effect.name}"></span>`
                  : ""
              }
            </span>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="compact-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
            <span class="compact-value" data-effect="${
              effect.name
            }">${displayValue}${effect.unit}</span>
            <button 
              class="compact-reset-button" 
              data-effect="${effect.name}"
              onclick="this.getRootNode().host.resetEffect('${effect.name}')"
              title="Reset ${effect.label}"
              style="display: ${resetButtonVisible ? "flex" : "none"};"
            >
              🔄
            </button>
          </div>
        `;
      });
    });

    html += "</div>";
    return html;
  }

  // Tabbed Layout: Effects organized in tabs with smooth transitions
  _generateTabbedLayout(sections) {
    const activeTab = this._activeTab || sections[0].id;

    let html = '<div class="effects-tabbed-container">';

    // Tab headers
    html += '<div class="tab-headers">';
    sections.forEach((section) => {
      const isActive = section.id === activeTab;
      html += `
        <button 
          class="tab-header ${isActive ? "active" : ""}" 
          title="${section.title}"
          onclick="this.getRootNode().host.switchTab('${section.id}')"
        >
          <span class="tab-icon">${section.icon}</span>
          <span class="tab-title">${section.title}</span>
          <span class="change-indicator" data-section-id="${section.id}"></span>
        </button>
      `;
    });
    html += "</div>";

    // Tab content
    html += '<div class="tab-content-container">';
    sections.forEach((section) => {
      const isActive = section.id === activeTab;

      // Determine button visibility based on mode
      const resetButtonMode = this.config.reset_button_mode || "always";
      let resetButtonVisible = "none";
      if (resetButtonMode === "always") {
        resetButtonVisible = "flex";
      } else if (resetButtonMode === "changed") {
        const hasChanges = this._checkSectionChanges(section.id);
        resetButtonVisible = hasChanges ? "flex" : "none";
      }
      // resetButtonMode === "never" ? stays "none"

      html += `
        <div class="tab-content ${isActive ? "active" : ""}" data-tab="${
          section.id
        }" data-section-id="${section.id}">
      `;

      section.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        html += `
          <div class="tabbed-slider-row">
            <div class="tabbed-label-row">
              <label class="tabbed-label" data-effect="${effect.name}">${
                effect.label
              }: <strong>${displayValue}${effect.unit}</strong></label>
              ${
                effect.hint
                  ? `<span class="tabbed-hint">${effect.hint}</span>`
                  : ""
              }
            </div>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="tabbed-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
          </div>
        `;
      });

      // Add reset button at the end (always rendered, visibility controlled by inline style)
      html += `
        <button 
          class="tabbed-reset-button" 
          data-section-id="${section.id}"
          onclick="this.getRootNode().host.resetSection('${section.id}')"
          title="Reset ${section.title}"
          style="display: ${resetButtonVisible};"
        >
          🔄 Reset
        </button>
      `;

      html += "</div>";
    });
    html += "</div>";

    html += "</div>";
    return html;
  }

  // Grouped Layout: Modern collapsible cards with better spacing (default)
  _generateGroupedLayout(sections) {
    let html = '<div class="effects-grouped-container">';

    sections.forEach((section, index) => {
      const isExpanded = this._expandedSections[section.id] === true;

      // Determine button visibility based on mode
      const resetButtonMode = this.config.reset_button_mode || "always";
      let resetButtonVisible = "none";
      if (resetButtonMode === "always") {
        resetButtonVisible = "block";
      } else if (resetButtonMode === "changed") {
        const hasChanges = this._checkSectionChanges(section.id);
        resetButtonVisible = hasChanges ? "block" : "none";
      }
      // resetButtonMode === "never" ? stays "none"

      html += `
        <div class="grouped-section ${
          isExpanded ? "expanded" : "collapsed"
        }" data-section-id="${section.id}" style="z-index: ${
          isExpanded ? 100 : 10 - index
        };">
          <div class="grouped-header" onclick="this.getRootNode().host.toggleSection('${
            section.id
          }')">
            <div class="grouped-header-left">
              <span class="grouped-icon">${
                section.icon
              }<span class="change-indicator" data-section-id="${
                section.id
              }"></span></span>
              <div class="grouped-title-area">
                <span class="grouped-title">${section.title}</span>
                <span class="grouped-description">${section.description}</span>
              </div>
            </div>
            <div class="grouped-header-right">
              <button 
                class="grouped-reset" 
                data-section-id="${section.id}"
                onclick="event.stopPropagation(); this.getRootNode().host.resetSection('${
                  section.id
                }');"
                title="Reset ${section.title}"
                style="display: ${resetButtonVisible};"
              >
                🔄
              </button>
            </div>
          </div>
          <div class="grouped-content" data-section="${section.id}">
      `;

      section.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        html += `
          <div class="grouped-slider-row">
            <div class="grouped-label-row">
              <label class="grouped-label">${effect.label}</label>
              <span class="grouped-value" data-effect="${
                effect.name
              }">${displayValue}${effect.unit}</span>
            </div>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="grouped-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
            ${
              effect.hint
                ? `<span class="grouped-hint">${effect.hint}</span>`
                : ""
            }
          </div>
        `;
      });

      html += "</div></div>";
    });

    html += "</div>";
    return html;
  }

  // Radial Layout: Color wheel selector with dynamic slider panel
  _generateRadialLayout(sections) {
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

    let html = '<div class="effects-radial-container">';

    // Left side: Half-circle selector (facing right, positioned at left edge)
    html += '<div class="radial-wheel-container">';
    html += '<svg class="radial-wheel" viewBox="-5 0 80 160">';

    const centerX = 0; // At the left edge
    const centerY = 80; // Vertically centered
    const outerRadius = 70;
    const innerRadius = 36;

    // Draw CATEGORY segments only (not individual effects)
    const numCategories = sections.length;
    const angleStep = 180 / numCategories; // Divide half-circle by number of categories

    sections.forEach((section, index) => {
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

      // Determine segment styling based on state and config
      // IMPORTANT: Classes are set during HTML generation, NOT post-render
      // This prevents blinking when switching categories
      const showIndicators = this.config?.show_change_indicators ?? true;
      const hasChanges =
        showIndicators && this._checkSectionChanges(section.id);

      let segmentClass = "radial-segment";
      if (isActive) {
        segmentClass += " active-category";
      }
      if (hasChanges) {
        segmentClass += " has-changes";
      }

      html += `
        <path 
          class="${segmentClass}" 
          d="M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z"
          data-category="${section.id}"
          data-section-id="${section.id}"
          onclick="this.getRootNode().host.selectRadialCategory('${section.id}')"
        ><title>${section.title}</title></path>
      `;

      // Category icon in the ring
      const midAngle = (startAngle + endAngle) / 2;
      const iconRadius = (innerRadius + outerRadius) / 2;
      const iconX = centerX + iconRadius * Math.cos(midAngle);
      const iconY = centerY + iconRadius * Math.sin(midAngle);

      html += `
        <text 
          x="${iconX}" 
          y="${iconY}" 
          class="radial-icon ${isActive ? "active-category" : ""}"
          text-anchor="middle" 
          dominant-baseline="middle"
          pointer-events="none"
        >${section.icon}</text>
      `;
    });

    // Center half-circle (only draw the right half)
    const innerArcPath = `M ${centerX} ${
      centerY - innerRadius
    } A ${innerRadius} ${innerRadius} 0 0 1 ${centerX} ${
      centerY + innerRadius
    }`;
    html += `<path d="${innerArcPath} L ${centerX} ${
      centerY + innerRadius
    } L ${centerX} ${centerY - innerRadius} Z" class="radial-center" />`;

    // Draw separator lines between categories (AFTER center so they're visible)
    for (let i = 1; i < numCategories; i++) {
      const angle = (-90 + i * angleStep) * (Math.PI / 180);
      const x1 = centerX + innerRadius * Math.cos(angle);
      const y1 = centerY + innerRadius * Math.sin(angle);
      const x2 = centerX + outerRadius * Math.cos(angle);
      const y2 = centerY + outerRadius * Math.sin(angle);

      html += `
        <line 
          x1="${x1}" y1="${y1}" 
          x2="${x2}" y2="${y2}" 
          stroke="rgba(255, 255, 255, 0.7)"
          stroke-width="1.5"
          pointer-events="none"
        />
      `;
    }

    // Draw outer border arc (half-circle)
    const outerArcPath = `M ${centerX} ${
      centerY - outerRadius
    } A ${outerRadius} ${outerRadius} 0 0 1 ${centerX} ${
      centerY + outerRadius
    }`;
    html += `<path d="${outerArcPath}" stroke="rgba(255, 255, 255, 0.7)" stroke-width="1.5" fill="none" pointer-events="none" />`;

    if (activeSection) {
      // Position icon in the center of the visible half circle (at half the radius)
      html += `
        <text 
          x="${innerRadius / 2}" 
          y="${centerY}" 
          class="radial-center-icon"
          text-anchor="middle" 
          dominant-baseline="middle"
        ><title>${activeSection.title}</title>${activeSection.icon}</text>
      `;
    }

    html += "</svg>";
    html += "</div>"; // End radial-wheel-container

    // Right side: Sliders for all effects in active category
    html +=
      '<div class="radial-slider-panel" data-section-id="' +
      activeSection.id +
      '">';

    if (activeSection) {
      // Determine button visibility based on mode
      const resetButtonMode = this.config.reset_button_mode || "always";
      let resetButtonVisible = "none";
      if (resetButtonMode === "always") {
        resetButtonVisible = "block";
      } else if (resetButtonMode === "changed") {
        const hasChanges = this._checkSectionChanges(activeSection.id);
        resetButtonVisible = hasChanges ? "block" : "none";
      }
      // resetButtonMode === "never" ? stays "none"

      html += `
        <div class="radial-category-header">
          <div class="radial-category-title">${activeSection.title}<span class="change-indicator" data-section-id="${activeSection.id}"></span></div>
          <button class="radial-reset-button" 
            data-section-id="${activeSection.id}"
            onclick="this.getRootNode().host.resetSection('${activeSection.id}')" 
            title="Reset ${activeSection.title}"
            style="display: ${resetButtonVisible};">
            🔄 Reset
          </button>
        </div>
      `;

      activeSection.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        const isSelected = effect.name === selectedEffect;
        const selectedClass = isSelected ? " selected" : "";

        html += `
          <div class="radial-effect-row${selectedClass}" data-effect="${effect.name}">
            <div class="radial-effect-row-header">
              <span class="radial-effect-row-label">${effect.label}</span>
              <span class="radial-effect-row-value">${displayValue}${effect.unit}</span>
            </div>
            <input 
              type="range" 
              min="${effect.min}" 
              max="${effect.max}" 
              value="${displayValue}" 
              class="radial-effect-slider effect-slider"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${effect.name}', event)"
              onclick="event.stopPropagation()"
            />
          </div>
        `;
      });
    }

    html += "</div>"; // End radial-slider-panel
    html += "</div>"; // End effects-radial-container

    return html;
  }

  // Categories Layout: Icon column on left with category-based slider panel
  _generateCategoriesLayout(sections) {
    const activeSection =
      sections.find((s) => s.id === this._activeRadialSection) || sections[0];
    this._activeRadialSection = activeSection.id;

    let html = '<div class="effects-categories-container">';

    // Left side: Vertical icon column
    html += '<div class="categories-icon-column">';
    sections.forEach((section, index) => {
      const isActive = section.id === activeSection.id;
      html += `
        <div 
          class="categories-icon-button ${isActive ? "active" : ""}" 
          onclick="this.getRootNode().host.selectCircularCategory('${
            section.id
          }')"
          title="${section.title}"
        >
          <span class="categories-icon-emoji">${section.icon}</span>
          <span class="change-indicator" data-section-id="${section.id}"></span>
        </div>
      `;
    });
    html += "</div>"; // End icon column

    // Right side: Sliders for active category
    html +=
      '<div class="categories-slider-panel" data-section-id="' +
      activeSection.id +
      '">';

    if (activeSection) {
      const showResetButton = this._shouldShowResetButton(activeSection.id);

      html += `
        <div class="categories-category-header">
          <div class="categories-category-title">${activeSection.title}</div>
          ${
            showResetButton
              ? `
          <button 
            class="categories-reset-button" 
            data-section-id="${activeSection.id}"
            title="Reset ${activeSection.title}"
            onclick="this.getRootNode().host.resetSection('${activeSection.id}')"
          >
            🔄 Reset
          </button>
          `
              : ""
          }
        </div>
      `;

      activeSection.effects.forEach((effect) => {
        const displayValue =
          effect.value !== undefined ? effect.value : effect.default;
        html += `
          <div class="categories-effect-row">
            <div class="categories-effect-row-header">
              <span class="categories-effect-row-label">${effect.label}</span>
              <span class="categories-effect-row-value" data-effect="${
                effect.name
              }">${displayValue}${effect.unit}</span>
            </div>
            <input
              type="range"
              class="categories-effect-slider"
              min="${effect.min}"
              max="${effect.max}"
              step="${effect.step || 1}"
              value="${displayValue}"
              data-effect="${effect.name}"
              data-default="${effect.default}"
              onmousedown="this.getRootNode().host._startDrag()"
              ontouchstart="this.getRootNode().host._startDrag()"
              onmouseup="this.getRootNode().host._endDrag()"
              ontouchend="this.getRootNode().host._endDrag()"
              oninput="this.getRootNode().host.handleEffectChange('${
                effect.name
              }', event)"
            />
          </div>
        `;
      });
    }

    html += "</div>"; // End categories-slider-panel
    html += "</div>"; // End effects-categories-container

    return html;
  }

  _getStyles() {
    const totalRows = 5;
    const totalCols = 20;
    const pixelStyle = this.config.matrix_pixel_style || "round";
    const lampDotShadow = this.config.lamp_dot_shadow !== false;

    return `
      <style>
        /* Inject centralized button styles */
        ${exportImportButtonStyles}

        .yeelight-cube-lamp-preview-container {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          min-height: 0;
          display: block;
          padding: 12px;
        }
        .lamp-preview-css {
          width: 100%;
          aspect-ratio: ${totalCols} / ${totalRows};
          border-radius: 12px;
          display: grid;
          box-sizing: border-box;
          padding: 8px;
        }
        .lamp-preview-css.align-center {
          margin-left: auto;
          margin-right: auto;
        }
        .lamp-preview-css.align-left {
          margin-left: 0;
          margin-right: auto;
        }
        .lamp-preview-css.align-right {
          margin-left: auto;
          margin-right: 0;
        }
        .lamp-dot {
          width: 100%;
          height: 100%;
          border-radius: ${pixelStyle === "round" ? "50%" : "0px"};
          margin: auto;
          box-shadow: ${lampDotShadow ? "0 0 2px #0008" : "none"};
          transition: background 0.2s, border 0.2s;
          aspect-ratio: 1 / 1;
          border: none;
          cursor: pointer;
          box-sizing: border-box;
          display: block;
        }
        .lamp-dot.lamp-dot-empty {
          border: none;
          box-shadow: none;
          background: transparent !important;
        }
        .button-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          padding: 10px;
          margin: 10px 0;
        }
        .button-row.two-buttons {
          justify-content: center;
        }
        .button-row .power-toggle-container,
        .button-row .force-refresh-container {
          padding: 0;
          margin: 0;
        }
        .force-refresh-container {
          display: inline-block;
          text-align: center;
          padding: 10px;
        }
        .force-refresh-btn {
          cursor: pointer;
        }
        .force-refresh-btn.loading {
          opacity: 0.6;
          cursor: wait;
        }
        .lamp-dot.lamp-dot-empty {
          border: none;
          box-shadow: none;
          background: transparent !important;
        }
        .brightness-slider-container {
          margin: 10px 0;
          padding: 10px 0;
          text-align: center;
        }
        .brightness-label {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--primary-text-color);
          text-align: left;
        }
        .brightness-label-with-icon {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--primary-text-color);
          text-align: left;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .brightness-slider-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-slider-full {
          gap: 0;
        }
        .brightness-value-slider {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 40px;
          text-align: right;
          flex-shrink: 0;
        }
        .brightness-percentage-standalone {
          font-size: 16px;
          font-weight: 600;
          color: var(--primary-text-color);
          text-align: center;
          padding: 8px 0;
        }
        .brightness-icon-large {
          font-size: 28px;
          min-width: 32px;
          text-align: center;
        }
        
        /* Slider Style - Default Appearance */
        .brightness-slider-default {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #333, #fff);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .brightness-slider-default::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ff9800;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .brightness-slider-default::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ff9800;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        /* Slider Style - Thick Appearance */
        .brightness-slider-thick {
          width: 100%;
          height: 12px;
          border-radius: 6px;
          background: linear-gradient(to right, #333, #fff);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .brightness-slider-thick::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #ff9800;
          cursor: pointer;
          box-shadow: 0 3px 6px rgba(0,0,0,0.4);
        }
        .brightness-slider-thick::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #ff9800;
          cursor: pointer;
          border: none;
          box-shadow: 0 3px 6px rgba(0,0,0,0.4);
        }
        
        /* Slider Style - Thin Appearance */
        .brightness-slider-thin {
          width: 100%;
          height: 3px;
          border-radius: 2px;
          background: linear-gradient(to right, #333, #fff);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .brightness-slider-thin::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ff9800;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .brightness-slider-thin::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ff9800;
          cursor: pointer;
          border: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        
        /* Bar Style (Mushroom-like) */
        .brightness-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .brightness-bar-wrapper.brightness-bar-full {
          gap: 8px;
        }
        .brightness-label-left {
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color);
          white-space: nowrap;
          min-width: 80px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .brightness-label-left:has(span:only-child) {
          font-size: 24px;
          min-width: 40px;
          justify-content: center;
        }
        .brightness-bar-track {
          position: relative;
          flex: 1;
          height: 40px;
          background: var(--disabled-color, rgba(255,255,255,0.1));
          border-radius: 12px;
          overflow: hidden;
        }
        .brightness-bar-fill {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          background: linear-gradient(90deg, #ffa726 0%, #ffb74d 100%);
          border-radius: 12px;
          transition: width 0.1s ease;
          pointer-events: none;
        }
        .brightness-slider-bar {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          -webkit-appearance: none;
          cursor: pointer;
          outline: none;
        }
        .brightness-slider-bar::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 0;
          height: 0;
          opacity: 0;
        }
        .brightness-slider-bar::-moz-range-thumb {
          width: 0;
          height: 0;
          opacity: 0;
          border: none;
        }
        .brightness-value-right {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 40px;
          text-align: right;
        }
        
        /* Rotary Style */
        .brightness-rotary-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .brightness-rotary-container {
          position: relative;
          width: 160px;
          height: 160px;
          padding: 10px;
          cursor: pointer;
          user-select: none;
        }
        .brightness-rotary-svg {
          width: 100%;
          height: 100%;
          transform: rotate(135deg);
          pointer-events: none;
        }
        .rotary-bg {
          fill: none;
          stroke: var(--disabled-color, rgba(255,255,255,0.1));
          stroke-width: 12;
          stroke-linecap: round;
        }
        .rotary-progress {
          fill: none;
          stroke: #ff9800;
          stroke-width: 12;
          stroke-linecap: round;
          transition: stroke-dasharray 0.1s ease;
        }
        .rotary-center-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          pointer-events: none;
        }
        .rotary-label {
          font-size: 16px;
          font-weight: 500;
          color: var(--secondary-text-color);
          text-align: center;
        }
        .rotary-value {
          font-size: 24px;
          font-weight: bold;
          color: var(--primary-text-color);
        }
        .brightness-slider-rotary {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        
        /* Capsule/Pill Style */
        .brightness-capsule-wrapper {
          padding: 5px 0;
        }
        .brightness-capsule {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 8px 12px;
          border-radius: 50px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .brightness-capsule-light {
          background: #fff;
        }
        .brightness-capsule-dark {
          background: #2c2c2c;
        }
        .brightness-capsule-transparent {
          background: transparent;
          box-shadow: none;
        }
        .capsule-icon {
          font-size: 22px;
          flex-shrink: 0;
          width: 28px;
          text-align: center;
          user-select: none;
        }
        .capsule-track {
          position: relative;
          flex: 1;
          height: 8px;
          border-radius: 10px;
          overflow: visible;
        }
        .brightness-capsule-light .capsule-track {
          background: #d0d0d0;
        }
        .brightness-capsule-dark .capsule-track {
          background: #1a1a1a;
        }
        .brightness-capsule-transparent .capsule-track {
          background: #d0d0d0;
        }
        .capsule-fill {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          width: calc(var(--brightness-percent, 0) * 1%);
          background: var(--primary-color, #03a9f4);
          border-radius: 10px;
          transition: width 0.1s ease;
          pointer-events: none;
        }
        .capsule-thumb {
          position: absolute;
          top: 50%;
          left: calc(var(--brightness-percent, 0) * 1%);
          transform: translate(-50%, -50%);
          width: 24px;
          height: 24px;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
          transition: left 0.1s ease;
          pointer-events: none;
          z-index: 2;
          border: 2px solid rgba(0, 0, 0, 0.1);
        }
        .brightness-capsule-light .capsule-thumb {
          background: white;
          border-color: rgba(0, 0, 0, 0.1);
        }
        .brightness-capsule-dark .capsule-thumb {
          background: #1a1a1a;
          border-color: rgba(255, 255, 255, 0.2);
        }
        .brightness-capsule-transparent .capsule-thumb {
          background: white;
          border-color: rgba(0, 0, 0, 0.1);
        }
        .brightness-slider-capsule {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
        }
        
        .brightness-value {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }
        .adjustment-controls {
          width: 100%;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .color-effects-container {
          width: 100%;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .effect-section {
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          border-radius: 8px;
          overflow: hidden;
          background: var(--card-background-color, #1c1c1c);
        }
        .effect-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.05));
          transition: background 0.2s;
        }
        .effect-section-header:hover {
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
        }
        .section-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          cursor: pointer;
          user-select: none;
        }
        .expand-icon {
          font-size: 12px;
          transition: transform 0.2s;
          color: var(--primary-color, #03a9f4);
        }
        .section-title {
          font-size: 0.95em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .reset-section-button {
          background: transparent;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          color: var(--primary-color, #03a9f4);
          padding: 6px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.2s;
        }
        .reset-section-button:hover {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color, #03a9f4);
        }
        .reset-section-button ha-icon {
          width: 18px;
          height: 18px;
        }
        .effect-section-content {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: max-height 0.3s ease-out;
        }
        .adjustment-slider-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .adjustment-label {
          font-size: 0.9em;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        .adjustment-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #555, #aaa);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .adjustment-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #2196f3;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .adjustment-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #2196f3;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .power-toggle-container {
          text-align: center;
          padding: 10px;
          margin: 10px;
        }
        
        .power-toggle-container button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .spinning {
          animation: spin 1s linear infinite;
        }

        .button-row .power-toggle-button {
          margin: 0;
        }

        /* === CHANGE INDICATOR === */
        .change-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ff9800;
          margin-left: 6px;
          opacity: 0;
          transform: scale(0);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 8px rgba(255, 152, 0, 0.6);
          position: relative;
          top: -2px;
        }
        .change-indicator.visible {
          opacity: 1;
          transform: scale(1);
        }
        .change-indicator::after {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border-radius: 50%;
          background: rgba(255, 152, 0, 0.3);
          animation: pulse-indicator 2s infinite;
        }
        @keyframes pulse-indicator {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.3); opacity: 0; }
        }

        /* === COMPACT LAYOUT RESET BUTTON === */
        .compact-reset-button {
          background: rgba(3, 169, 244, 0.1);
          border: 1.5px solid rgba(3, 169, 244, 0.4);
          color: var(--primary-color, #03a9f4);
          padding: 4px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 4px rgba(3, 169, 244, 0.2);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .compact-reset-button:hover {
          background: rgba(3, 169, 244, 0.2);
          border-color: var(--primary-color, #03a9f4);
          transform: scale(1.1);
          box-shadow: 0 3px 8px rgba(3, 169, 244, 0.3);
        }
        .compact-reset-button:active {
          transform: scale(0.95);
        }

        /* === COMPACT LAYOUT === */
        .effects-compact-container {
          width: auto;
          /* padding: 12px; */
          display: flex;
          flex-direction: column;
          gap: 8px;
          /* background: var(--card-background-color, #1c1c1c); */
          border-radius: 8px;
        }
        .compact-slider-row {
          display: grid;
          grid-template-columns: 30px 100px 1fr 60px 32px;
          gap: 8px;
          align-items: center;
          padding: 6px;
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.03));
          border-radius: 6px;
          transition: background 0.2s;
        }
        /* When reset buttons are never shown, remove the button column space */
        .reset-mode-never .compact-slider-row {
          grid-template-columns: 30px 100px 1fr 60px;
        }
        .compact-slider-row:hover {
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
        }
        .compact-icon {
          font-size: 18px;
          text-align: center;
        }
        .compact-label {
          font-size: 0.85em;
          font-weight: 500;
          color: var(--primary-text-color);
          white-space: nowrap;
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .compact-indicator {
          display: inline-block;
          position: relative;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ff9800;
          opacity: 0;
          transform: scale(0);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 6px rgba(255, 152, 0, 0.6);
          margin-left: 2px;
        }
        .compact-indicator.visible {
          opacity: 1;
          transform: scale(1);
        }
        .compact-indicator::after {
          content: '';
          position: absolute;
          top: -1px;
          left: -1px;
          right: -1px;
          bottom: -1px;
          border-radius: 50%;
          background: rgba(255, 152, 0, 0.3);
          animation: pulse-indicator 2s infinite;
        }
        .compact-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #555, #aaa);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .compact-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .compact-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .compact-value {
          font-size: 0.8em;
          color: var(--secondary-text-color);
          text-align: right;
          font-weight: 600;
          min-width: 50px;
        }

        /* === TABBED LAYOUT === */
        .effects-tabbed-container {
          /* width: 100%; */
          padding: 12px;
          background: var(--card-background-color, #1c1c1c);
          border-radius: 8px;
        }
        .tab-headers {
          display: flex;
          gap: 4px;
          border-bottom: 2px solid var(--divider-color, rgba(255, 255, 255, 0.12));
          margin-bottom: 16px;
          justify-content: space-around;
        }
        .tab-header {
          background: transparent;
          border: none;
          padding: 10px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.9em;
          color: var(--secondary-text-color);
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
          font-weight: 500;
          position: relative; /* For absolute positioning of indicator */
        }
        .tab-header:hover {
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.05));
          color: var(--primary-text-color);
        }
        .tab-header.active {
          color: var(--primary-color, #03a9f4);
          border-bottom-color: var(--primary-color, #03a9f4);
          font-weight: 600;
        }
        .tab-icon {
          font-size: 16px;
        }
        .tab-title {
          font-size: 0.95em;
        }
        /* Change indicator in tab header - positioned absolutely to not affect layout */
        .tab-header .change-indicator {
          position: absolute;
          top: 6px;
          right: 6px;
          margin-left: 0; /* Override default margin */
        }
        .tab-content-container {
          position: relative;
        }
        .tab-content {
          display: none;
        }
        .tab-content.active {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .tabbed-content-header {
          display: flex;
          align-items: center;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .tabbed-content-title {
          margin: 0;
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tabbed-reset-button {
          padding: 4px 0;
          font-size: 0.9em;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          margin: 0 0 0 auto;
          align-self: flex-end;
          text-decoration: none;
        }
        .tabbed-reset-button:hover {
          color: var(--primary-color-dark, #0288d1);
        }
        .tabbed-reset-button:active {
          opacity: 0.7;
        }
        .tabbed-slider-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px;
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.03));
          border-radius: 6px;
        }
        .tabbed-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .tabbed-label {
          font-size: 0.9em;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        .tabbed-label strong {
          color: var(--primary-color, #03a9f4);
          margin-left: 4px;
        }
        .tabbed-hint {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          font-style: italic;
        }
        .tabbed-slider {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #555, #aaa);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
        }
        .tabbed-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .tabbed-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }

        /* === GROUPED LAYOUT (Modern Default) === */
        .effects-grouped-container {
          /* width: 100%; */
          /* padding: 12px; */
          display: flex;
          flex-direction: column;
          /* gap: 10px; */
          position: relative;
        }
        .grouped-section {
          border-radius: 10px;
          overflow: hidden;
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                      margin 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                      opacity 0.3s ease,
                      border-color 0.3s ease,
                      box-shadow 0.3s ease,
                      transform 0.3s ease;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          position: relative;
          max-height: 1000px;
          opacity: 1;
          margin-bottom: 10px;
        }
        .grouped-section.hidden {
          max-height: 0;
          opacity: 0;
          margin-bottom: 0;
          padding: 0;
          border: none;
          pointer-events: none;
        }
        .grouped-section:hover {
          border-color: rgba(3, 169, 244, 0.4);
          box-shadow: 0 4px 16px rgba(3, 169, 244, 0.15);
          transform: translateY(-2px);
        }
        .grouped-section.expanded {
          border-color: rgba(3, 169, 244, 0.3);
        }
        .grouped-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 10px 2px;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));
          cursor: pointer;
          user-select: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .grouped-header:hover {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.06));
        }
        .grouped-header:active {
          transform: scale(0.99);
        }
        .grouped-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }
        .grouped-icon {
          font-size: 24px;
          min-width: 30px;
          text-align: center;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
          transition: transform 0.3s ease;
        }
        .grouped-section:hover .grouped-icon {
          transform: scale(1.1);
        }
        .grouped-title-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .grouped-title {
          font-size: 1em;
          font-weight: 700;
          color: var(--primary-text-color);
          letter-spacing: 0.3px;
        }
        .grouped-description {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          opacity: 0.8;
        }
        .grouped-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .grouped-reset {
          background: rgba(3, 169, 244, 0.1);
          border: 1.5px solid rgba(3, 169, 244, 0.4);
          color: var(--primary-color, #03a9f4);
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 6px rgba(3, 169, 244, 0.2);
        }
        .grouped-reset:hover {
          background: rgba(3, 169, 244, 0.2);
          border-color: var(--primary-color, #03a9f4);
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(3, 169, 244, 0.3);
        }
        .grouped-reset:active {
          transform: scale(0.95);
        }
        .grouped-content {
          max-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 10px;
          /* background: rgba(0, 0, 0, 0.2); */
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding: 0 14px 0 14px;
          transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                      padding 0.3s ease;
        }
        .grouped-section.expanded .grouped-content {
          max-height: 2000px;
          padding: 12px 14px 14px 14px;
        }
        .grouped-slider-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
          /* padding: 10px; */
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          transition: all 0.2s ease;
        }
        .grouped-slider-row:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .grouped-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .grouped-label {
          flex: 1;
          font-size: 0.95em;
          color: var(--primary-text-color);
          font-weight: 600;
        }
        .grouped-value {
          font-size: 0.9em;
          color: var(--primary-color, #03a9f4);
          font-weight: 700;
          min-width: 50px;
          text-align: right;
          font-family: 'Courier New', monospace;
          background: rgba(3, 169, 244, 0.1);
          padding: 4px 8px;
          border-radius: 4px;
        }
        .grouped-slider {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #444, #888);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .grouped-slider:hover {
          height: 10px;
        }
        .grouped-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(145deg, var(--primary-color, #03a9f4), #0288d1);
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(3, 169, 244, 0.5), 0 0 12px rgba(3, 169, 244, 0.3);
          transition: all 0.2s ease;
        }
        .grouped-slider::-webkit-slider-thumb:hover {
          width: 24px;
          height: 24px;
          box-shadow: 0 4px 12px rgba(3, 169, 244, 0.6), 0 0 16px rgba(3, 169, 244, 0.4);
        }
        .grouped-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(145deg, var(--primary-color, #03a9f4), #0288d1);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 8px rgba(3, 169, 244, 0.5), 0 0 12px rgba(3, 169, 244, 0.3);
          transition: all 0.2s ease;
        }
        .grouped-slider::-moz-range-thumb:hover {
          width: 24px;
          height: 24px;
          box-shadow: 0 4px 12px rgba(3, 169, 244, 0.6), 0 0 16px rgba(3, 169, 244, 0.4);
        }
        .grouped-hint {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          font-style: italic;
          margin-top: 4px;
        }

        /* === RADIAL LAYOUT === */

        /* ===== RADIAL LAYOUT STYLES ===== */
        .effects-radial-container {
          display: flex;
          gap: 0;
          padding: 16px;
          padding-left: 90px;
          padding-right: 0PX
          /* background: var(--card-background-color, #1c1c1c); */
          border-radius: 12px;
          align-items: flex-start;
          position: relative;
        }

        .radial-wheel-container {
          flex: 0 0 80px;
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
          position: absolute;
          left: 0px;
          top: 0;
          z-index: 1;
          width: 80px;
          height: 160px;
          padding-top: 8px;
          overflow: visible;
        }

        .radial-wheel {
          width: 80px;
          height: 160px;
          filter: drop-shadow(1px 1px 3px rgba(0, 0, 0, 0.15));
          overflow: visible;
          will-change: auto;
          backface-visibility: hidden;
          transform: translateZ(0);
        }

        /* Single ring segments - clearly defined clickable areas */
        .radial-segment {
          fill: rgba(255, 255, 255, 1);
          stroke: none;
          cursor: pointer;
          transition: fill 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
                      stroke 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                      stroke-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                      filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: fill, stroke;
        }

        .radial-segment:hover {
          fill: rgba(255, 255, 255, 0.08);
        }

        .radial-segment.active-category {
          fill: rgba(3, 169, 244, 0.15);
          stroke: rgba(3, 169, 244, 0.6);
          stroke-width: 1;
        }

        /* Highlight segments with changed values */
        .radial-segment.has-changes {
          fill: rgba(255, 152, 0, 0.12);
          stroke: rgba(255, 152, 0, 0.5);
          stroke-width: 1.5;
        }

        .radial-segment.has-changes:hover {
          fill: rgba(255, 152, 0, 0.2);
        }

        /* Active category with changes - combine both styles */
        .radial-segment.active-category.has-changes {
          fill: rgba(255, 152, 0, 0.25);
          stroke: rgba(255, 152, 0, 0.7);
          stroke-width: 2;
          filter: drop-shadow(0 0 6px rgba(255, 152, 0, 0.4));
        }

        .radial-separator {
          display: block;
          stroke: rgba(255, 255, 255, 0.6);
          stroke-width: 1.5;
          pointer-events: none;
        }

        /* Outer circle border */
        .radial-outer-border {
          display: block;
          fill: none;
          stroke: rgba(255, 255, 255, 0.6);
          stroke-width: 1.5;
          pointer-events: none;
        }

        .radial-segment.selected {
          fill: var(--primary-color, #03a9f4);
          stroke: var(--primary-color, #03a9f4);
          stroke-width: 2;
          filter: drop-shadow(0 0 6px var(--primary-color, #03a9f4));
        }

        .radial-icon {
          font-size: 14px;
          fill: rgba(255, 255, 255, 0.5);
          transition: all 0.3s ease;
          pointer-events: none;
        }

        .radial-icon.active-category {
          font-size: 15px;
          fill: rgba(3, 169, 244, 0.8);
        }

        .radial-icon.selected {
          font-size: 16px;
          fill: #ffffff;
          filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.9));
        }

        /* Center circle */
        .radial-center {
          fill: var(--card-background-color, #1c1c1c);
          stroke: rgba(255, 255, 255, 0.08);
          stroke-width: 1;
        }

        .radial-center-icon {
          font-size: 22px;
          fill: var(--primary-color, #03a9f4);
          pointer-events: none;
          /* filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4)); */
        }

        /* Slider panel */
        .radial-slider-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
          /* padding: 0 12px; */
          /* background: var(--card-background-color, #1c1c1c); */
          /* border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08); */
          margin-left: 0;
          position: relative;
          z-index: 2;
        }

        .radial-category-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          margin-bottom: 4px;
        }

        .radial-category-title {
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
          align-self: self-start;
        }

        .radial-reset-button {
          padding: 6px 12px;
          font-size: 0.9em;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          background: rgba(3, 169, 244, 0.1);
          border: 1px solid var(--primary-color, #03a9f4);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
              position: absolute;
    right: 0;
        }

        .radial-reset-button:hover {
          background: rgba(3, 169, 244, 0.2);
          transform: scale(1.05);
        }

        .radial-reset-button:active {
          transform: scale(0.95);
        }

        .radial-effect-row {
          /* padding: 8px; */
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          transition: all 0.2s ease;
          cursor: default;
        }

        .radial-effect-row:hover {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.06);
        }

        .radial-effect-row.selected {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.06);
          box-shadow: none;
        }

        .radial-effect-row-header {
          display: flex;
          align-items: center;
          gap: 10px;
          /* margin-bottom: 6px; */
        }

        .radial-effect-row-icon {
          display: none; /* Icons removed */
        }

        .radial-effect-row-label {
          flex: 1;
          font-size: 0.95em;
          font-weight: 500;
          color: var(--primary-text-color);
        }

        .radial-effect-row-value {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-color, #03a9f4);
          min-width: 45px;
          text-align: right;
          font-family: 'Courier New', monospace;
        }

        .radial-effect-slider {
          width: 100%;
          height: 5px;
          border-radius: 2.5px;
          background: linear-gradient(to right, #444, #888);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .radial-effect-slider:hover {
          height: 6px;
        }

        .radial-effect-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .radial-effect-slider::-webkit-slider-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        .radial-effect-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .radial-effect-slider::-moz-range-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        /* Responsive adjustments for radial layout */
        @media (max-width: 768px) {
          .effects-radial-container {
            flex-direction: row;
            padding: 12px;
            padding-left: 80px;
            align-items: flex-start;
            position: relative;
            gap: 8px;
          }

          .radial-wheel-container {
            flex: 0 0 80px;
            left: 0;
            position: absolute;
            z-index: 1;
            width: 80px;
            height: 160px;
            top: 12px;
          }
          
          .radial-wheel {
            width: 80px;
            height: 160px;
          }

          .radial-slider-panel {
            flex: 1;
            margin-left: 0;
            background: var(--card-background-color, #1c1c1c);
            position: relative;
            z-index: 2;
            min-width: 0;
          }
          
          /* Keep all icons visible on mobile */
          .radial-icon {
            font-size: 12px;
          }
          
          .radial-icon.active-category {
            font-size: 14px;
          }
        }

        /* ===== CATEGORIES LAYOUT STYLES ===== */
        .effects-categories-container {
          display: flex;
          gap: 12px;
         /*  padding: 12px;
          background: var(--card-background-color, #1c1c1c); */
          border-radius: 8px;
          align-items: stretch;
        }

        /* Icon column on left */
        .categories-icon-column {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          /* gap: 12px;
          padding: 12px; */
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .categories-icon-button {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          position: relative; /* For absolute positioning of indicator */
        }

        .categories-icon-button:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          transform: scale(1.1);
        }

        .categories-icon-button.active {
          background: rgba(3, 169, 244, 0.15);
          border: 2px solid rgba(3, 169, 244, 0.6);
          box-shadow: 0 0 12px rgba(3, 169, 244, 0.4);
        }

        .categories-icon-emoji {
          font-size: 20px;
          transition: all 0.3s ease;
        }

        .categories-icon-button.active .categories-icon-emoji {
          filter: drop-shadow(0 0 4px rgba(3, 169, 244, 0.6));
        }

        /* Indicator positioning for categories layout */
        .categories-icon-button .change-indicator {
          position: absolute;
          top: -2px;
          right: -2px;
          margin-left: 0;
        }

        /* Slider panel */
        .categories-slider-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          /* gap: 10px;
          padding: 12px; */
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .categories-category-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          margin-bottom: 6px;
        }

        .categories-category-title {
          font-size: 1.15em;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        .categories-reset-button {
          padding: 6px 12px;
          margin: -2px 0;
          font-size: 0.9em;
          font-weight: 500;
          color: var(--primary-color, #03a9f4);
          background: rgba(3, 169, 244, 0.1);
          border: 1px solid var(--primary-color, #03a9f4);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .categories-reset-button:hover {
          background: rgba(3, 169, 244, 0.2);
          transform: scale(1.05);
        }

        .categories-reset-button:active {
          transform: scale(0.95);
        }

        .categories-effect-row {
          padding: 8px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          transition: all 0.2s ease;
        }

        .categories-effect-row:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .categories-effect-row-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 6px;
        }

        .categories-effect-row-label {
          flex: 1;
          font-size: 0.95em;
          font-weight: 500;
          color: var(--primary-text-color);
        }

        .categories-effect-row-value {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-color, #03a9f4);
          min-width: 45px;
          text-align: right;
          font-family: 'Courier New', monospace;
        }

        .categories-effect-slider {
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: linear-gradient(to right, #444, #888);
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .categories-effect-slider:hover {
          height: 7px;
        }

        .categories-effect-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .categories-effect-slider::-webkit-slider-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        .categories-effect-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--primary-color, #03a9f4);
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 0 6px var(--primary-color, #03a9f4);
          transition: all 0.2s ease;
        }

        .categories-effect-slider::-moz-range-thumb:hover {
          width: 18px;
          height: 18px;
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 10px var(--primary-color, #03a9f4);
        }

        /* Responsive adjustments for circular layout */
        @media (max-width: 768px) {
          .effects-circular-container {
            flex-direction: column;
            align-items: center;
          }

          .circular-wheel-container {
            margin-bottom: 16px;
          }

          .circular-slider-panel {
            width: 100%;
          }
        }
      </style>
    `;
  }

  getCardSize() {
    return 2;
  }
}

customElements.define(
  "yeelight-cube-lamp-preview-card",
  YeelightCubeLampPreviewCard,
);


// Register for Lovelace "Add Card" UI
window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-lamp-preview-card",
  name: "Yeelight Preview Card",
  description: "Preview the Yeelight Cube Lite lamp matrix and settings.",
});
