window.cardDocs = {
  async prepare(fonts) {
    const host = document.querySelector("home-assistant");
    if (
      !host?.hass ||
      !customElements.get("ha-card") ||
      !customElements.get("ha-icon")
    )
      throw Error("A real, loaded Home Assistant frontend is required");
    this.hass = host.hass;
    this.fonts =
      fonts ||
      Object.values(host.hass.states).find(
        (state) => state.attributes?.font_maps?.native,
      )?.attributes;
    if (!this.fonts?.font_maps?.native)
      throw Error("Production native clock font sensor is required");
    const base = "/yeelight_cube/";
    await Promise.all(
      ["clock", "native-effects", "lamp-preview"].map(
        (kind) => import(`${base}yeelight-cube-${kind}-card.js`),
      ),
    );
    this.catalogue = (
      await import(`${base}native-effect-card-utils.js`)
    ).nativePreviewCatalogue;
    this.container = document.createElement("div");
    this.container.id = "card-docs";
    this.container.style.cssText =
      "position:fixed;z-index:10000;top:0;left:0;width:448px;background:var(--primary-background-color);";
    host.shadowRoot.append(this.container);
    this.originalDate = Date;
    this.originalRandom = Math.random;
  },

  async render(kind, scenario, options = {}) {
    this.container.replaceChildren();
    this.container.style.width = `${options.width || 448}px`;
    const host = document.querySelector("home-assistant");
    host._updateHass({
      selectedTheme: { theme: "default", dark: !!options.dark },
    });
    host._applyTheme(!!options.dark);
    if (host.hass.themes.darkMode !== !!options.dark)
      throw Error("HA theme did not apply");
    this.options = options;
    const OriginalDate = this.originalDate;
    window.Date = class extends OriginalDate {
      constructor(...args) {
        super(...(args.length ? args : ["2026-01-15T10:08:00Z"]));
      }
      static now() {
        return 1768471680000;
      }
    };
    let seed = 12345;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const clock = kind === "clock";
    const card = document.createElement(`yeelight-cube-${kind}-card`);
    const config = {
      entity: "light.documentation_only",
      target_entities: ["light.documentation_only"],
      title:
        kind === "lamp-preview"
          ? "Lamp Preview"
          : clock
            ? "Clock"
            : "Native Effects",
      show_current_preview: true,
      show_preview: true,
      show_color_modes: true,
      show_gallery: true,
      show_favourites: true,
      show_rotation: true,
      show_actions: true,
      show_device_orientation: false,
      show_content_toggle: false,
      show_format_toggles: false,
      show_brightness: true,
      show_animation_speed: true,
      style_selector_style: "original",
      effect_view: "grid",
      items_per_page: 4,
      actions_buttons_style: "icon",
      actions_buttons_content_mode: "icon",
      buttons_style: "pill",
      buttons_content_mode: "icon",
      preview_appearance: {
        background: "transparent",
        pixels: "square",
        spacing: "none",
        shadow: false,
        ignoreBlack: true,
      },
      lamp_preview_size: 95,
      effect_preview_size: 100,
      rotation_interval: 30,
      show_brightness_slider: true,
      show_adjustment_controls: true,
      adjustments_layout: "categories",
      ...(scenario === "soft"
        ? {
            show_content_toggle: true,
            show_format_toggles: true,
            show_device_orientation: true,
          }
        : {}),
      ...options.config,
    };
    card.setConfig(config);
    const favourites = [
      { key: "Rainbow", colorMode: "normal" },
      { key: "Kaleidoscope", colorMode: "white_orange" },
    ];
    const deny = async () => {
      throw Error("Documentation cannot call Home Assistant services or APIs");
    };
    card.hass = {
      ...host.hass,
      callService: deny,
      callApi: deny,
      callWS: deny,
      connection: undefined,
      states: {
        "sensor.documentation_font": { state: "ready", attributes: this.fonts },
        "light.documentation_only": {
          state: options.offline ? "unavailable" : "on",
          attributes: options.offline
            ? {}
            : {
                friendly_name: "Demo lamp",
                content_mode:
                  clock || kind === "lamp-preview" ? "Clock" : "Native Effect",
                brightness: 255,
                device_orientation: "right",
                native_effect: "Rainbow",
                native_effect_color_mode: "normal",
                native_effect_color: null,
                native_effect_speed: 50,
                native_effect_catalog: this.catalogue,
                extended_effects_enabled: true,
                clock_style: "Rainbow",
                clock_style_id: 1,
                clock_color_mode: "normal",
                clock_content: "time",
                matrix_colors: Array.from({ length: 100 }, (_, index) => [
                  Math.round((255 * index) / 99),
                  140,
                  Math.round(255 * (1 - index / 99)),
                ]),
                effect_rotation: {
                  kind: clock ? "clock" : "native",
                  active: true,
                  interval: 30,
                  items: favourites.map((item) => ({
                    name: item.key,
                    color_mode: item.colorMode,
                  })),
                  index: 0,
                  error: null,
                },
              },
        },
      },
    };
    if (kind !== "lamp-preview") card._controls.favourites = favourites;
    if (options.section) {
      await import(`/yeelight_cube/yeelight-cube-${kind}-card-editor.js`);
      const editor = document.createElement(
        `yeelight-cube-${kind}-card-editor`,
      );
      editor.setConfig(config);
      editor.hass = card.hass;
      // Every editor keeps its foldable sections in one `_open` map.
      editor._open = { [options.section]: true };
      this.container.append(editor);
      await editor.updateComplete;
      const panel =
        editor.shadowRoot.querySelector(
          `[data-section="${options.section}"]`,
        ) ||
        [...editor.shadowRoot.querySelectorAll(".editor-card")].find(
          (element) =>
            element
              .querySelector(".editor-card-header")
              ?.textContent.trim()
              .startsWith(options.title),
        );
      if (!panel)
        throw Error(`Missing editor section: ${kind}/${options.section}`);
      panel.dataset.docsCapture = "true";
      for (const sibling of panel.parentElement.children)
        if (sibling !== panel) sibling.style.display = "none";
      this.card = editor;
      this.captureSelector = '#card-docs [data-docs-capture="true"]';
      return;
    }
    this.container.append(card);
    card._controls?.notify();
    await card.updateComplete;
    this.card = card;
    this.captureSelector = "#card-docs";
    this.kind = kind;
  },

  // ha-icon fetches its SVG path asynchronously, after its own update has
  // completed, so updateComplete does not cover it. Report whether every icon
  // in the card (including nested shadow roots) has drawn its path.
  iconsReady() {
    const roots = [this.container];
    const icons = [];
    for (const root of roots)
      for (const element of root.querySelectorAll("*")) {
        if (element.localName === "ha-icon" && element.icon)
          icons.push(element);
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    return icons.every(
      (icon) => icon.shadowRoot?.querySelector("ha-svg-icon")?.path,
    );
  },

  // Freeze every real-time animation loop before the pixel-for-pixel capture
  // (each scenario is rendered twice and compared; a running loop makes the
  // two captures differ and fails with "Capture pixels changed" in CI).
  // Each animated component owns its loop under its OWN property name, so
  // renaming/adding a requestAnimationFrame loop on any card/component below
  // must update the matching stop() call here too:
  //   - card._animLoop / card._loop: the clock/native/lamp-preview card's own
  //     grid animation (createRafLoop from matrix-animator.js).
  //   - view._previewLoop: yeelight-mode-controls' favourites/collections
  //     preview loop (also createRafLoop; see mode-controls-ui.js).
  async settle() {
    const card = this.card;
    card._animLoop?.stop();
    card._loop?.stop();
    if (this.options.section || this.kind === "lamp-preview") {
      await card.updateComplete;
    } else if (card._paintPreview) {
      card._phaseAccum = 1.2;
      card._lastPhaseTs = Date.now();
      for (const tile of card.shadowRoot.querySelectorAll(
        "[data-clock-preview], .original-gallery .original-item",
      ))
        card._paintPreview(tile, 1.2);
    } else {
      card._elapsed = 1.2;
      card._frames.forEach((frame) => {
        frame.visible = true;
      });
      card._paint();
    }
    const frame = card._controls?.adapter.frame;
    if (frame) {
      card._controls.adapter.frame = (name, phase, mode, color) =>
        frame(name, 1.2, mode, color);
    }
    for (const view of card.shadowRoot.querySelectorAll(
      "yeelight-mode-controls",
    )) {
      // Keep in sync with mode-controls-ui.js's own loop property name.
      view._previewLoop?.stop();
      view.requestUpdate();
      await view.updateComplete;
    }
    const roots = [card.shadowRoot];
    for (const current of roots)
      for (const element of current.querySelectorAll("*")) {
        if (element.updateComplete) await element.updateComplete;
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    await document.fonts.ready;
    if (!this.options.section && !this.options.offline) {
      const namespaces =
        this.kind === "lamp-preview" ? [""] : ["brightness", "speed"];
      for (const namespace of namespaces) {
        const slider = card.shadowRoot.querySelector(
          `[data-sl-ns="${namespace}"]`,
        );
        if (!slider?.getBoundingClientRect().height)
          throw Error(`Missing slider: ${this.kind}/${namespace}`);
      }
    }
    if (this.options.section || this.kind === "lamp-preview") {
      if (this.container.scrollWidth > this.container.clientWidth)
        throw Error("Horizontal overflow");
      return;
    }
    if (
      !card.shadowRoot
        .querySelector("yeelight-color-mode")
        ?.getBoundingClientRect().height
    )
      throw Error("Missing colours");
    if (
      !card.shadowRoot
        .querySelector(
          ".original-gallery, yeelight-style-browser, .gc-selector",
        )
        ?.getBoundingClientRect().height
    )
      throw Error("Missing gallery");
    for (const item of card._controls.favourites) {
      const pixels = card._controls.adapter.frame(
        item.key,
        1.2,
        item.colorMode,
      );
      if (!pixels?.some((pixel) => pixel.some((channel) => channel > 0)))
        throw Error(`Blank preview: ${item.key}`);
    }
    if (this.container.scrollWidth > this.container.clientWidth)
      throw Error("Horizontal overflow");
  },

  cleanup() {
    this.container?.remove();
    if (this.originalDate) window.Date = this.originalDate;
    if (this.originalRandom) Math.random = this.originalRandom;
  },
};
