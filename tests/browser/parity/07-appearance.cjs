// Card UI parity check (tests/card-ui-parity.cjs): appearance presets, Clock
// appearance and proportional Clock gaps.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

module.exports = async (t) => {
  const { browser, server } = t;
  const appearancePage = await browser.newPage();
  const appearanceErrors = [];
  appearancePage.on("pageerror", (error) =>
    appearanceErrors.push(error.message),
  );
  await appearancePage.goto(
    `http://127.0.0.1:${server.address().port}/tests/clock-appearance-preview.html`,
  );
  await appearancePage.waitForFunction(() => !!window.appearancePreview);
  await appearancePage.evaluate(async () => {
    const earlyEditor = document.createElement(
      "yeelight-cube-clock-card-editor",
    );
    earlyEditor.hass = appearancePreview.hass;
    document.body.append(earlyEditor);
    try {
      await earlyEditor.updateComplete;
      earlyEditor.setConfig({ entity: "light.preview" });
      await earlyEditor.updateComplete;
    } finally {
      earlyEditor.remove();
    }
  });
  const appearanceEditor = appearancePage.locator(
    "yeelight-cube-clock-card-editor",
  );
  const lampAppearance = appearanceEditor.locator('[data-appearance="lamp"]');
  const sharedAppearance = appearanceEditor.locator(
    '[data-appearance="shared"]',
  );
  assert.equal(
    await sharedAppearance
      .getByRole("button", { name: "Classic preset", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await lampAppearance.locator(".appearance-fields").count(), 0);
  await lampAppearance
    .getByRole("button", { name: "Custom", exact: true })
    .click();
  await lampAppearance
    .getByRole("switch", { name: "Shadow", exact: true })
    .press("Space");
  await sharedAppearance
    .getByRole("button", { name: "Square preset", exact: true })
    .click();
  const inherited = await appearancePage.evaluate(() => {
    const { card } = appearancePreview;
    return {
      overrides: lastAppearanceConfig.preview_overrides,
      backgrounds: [
        card.config.lamp_matrix_background,
        card.config.gallery_background_color,
        card.config.effect_matrix_background,
      ],
      shadow: card.config.lamp_matrix_box_shadow,
    };
  });
  assert.deepEqual(inherited.overrides, { lamp: { shadow: true } });
  assert.deepEqual(inherited.backgrounds, [
    "transparent",
    "transparent",
    "transparent",
  ]);
  assert.equal(inherited.shadow, true);
  await lampAppearance
    .getByRole("button", {
      name: "Reset shadow to card default",
      exact: true,
    })
    .click();
  assert.equal(
    await lampAppearance
      .getByRole("switch", { name: "Shadow", exact: true })
      .isChecked(),
    false,
  );
  await lampAppearance
    .getByRole("button", { name: "Card default", exact: true })
    .click();
  assert.equal(await lampAppearance.locator(".appearance-fields").count(), 0);
  await sharedAppearance
    .getByRole("button", { name: "Light preset", exact: true })
    .click();
  await appearancePage.evaluate(async () => {
    const { editor } = appearancePreview;
    editor._open = {
      preview_appearance: true,
      lamp_preview: true,
      previews: true,
      favourites: true,
    };
    editor.requestUpdate();
    await editor.updateComplete;
  });
  for (const section of ["lamp", "gallery", "favourites"]) {
    const area = appearanceEditor.locator(`[data-appearance="${section}"]`);
    assert.equal(await area.locator(".appearance-fields").count(), 0);
    assert.equal(
      await area
        .getByRole("button", { name: "Card default", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
  }
  await appearancePage.evaluate(async () => {
    const { editor } = appearancePreview;
    const slider = editor.shadowRoot.querySelector(
      '[data-appearance="lamp"] input[type="range"]',
    );
    slider.value = "80";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await editor.updateComplete;
  });
  assert.equal(
    await appearancePage.evaluate(
      () => appearancePreview.card.config.lamp_preview_size,
    ),
    80,
  );
  assert.equal(
    await appearancePage.evaluate(
      () => appearancePreview.card.config.preview_size,
    ),
    55,
  );
  await sharedAppearance
    .getByText("Fine-tune appearance", { exact: true })
    .click();
  await sharedAppearance
    .getByRole("button", { name: "Circle", exact: true })
    .click();
  assert.equal(
    await appearancePage.evaluate(
      () => appearancePreview.card.config.effect_pixel_style,
    ),
    "circle",
  );
  await appearancePage.waitForFunction(() => {
    const tile = appearancePreview.card.shadowRoot.querySelector(
      "[data-clock-preview]",
    );
    return tile?._cells?.[0]?.style.borderRadius === "50%";
  });
  const renderedShapes = await appearancePage.evaluate(() => {
    const card = appearancePreview.card;
    const favouriteView = [
      ...card.shadowRoot.querySelectorAll("yeelight-mode-controls"),
    ].find((view) => view.shadowRoot.querySelector("[data-preview]"));
    // The cells' shape is shared CSS (matrixPreviewStyles): read it as
    // rendered.
    const shape = (cell) => cell && getComputedStyle(cell).borderTopLeftRadius;
    return [
      shape(card.shadowRoot.querySelector(
        ".gc-preview-shell .gallery-matrix-preview > div",
      )),
      shape(favouriteView.shadowRoot.querySelector(
        "[data-preview] .gallery-matrix-preview > div",
      )),
    ];
  });
  assert.deepEqual(renderedShapes, ["50%", "50%"]);
  assert.equal(
    await sharedAppearance
      .getByRole("button", { name: "Light preset", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  for (const width of [1280, 390]) {
    await appearancePage.setViewportSize({ width, height: 1000 });
    await appearancePage.screenshot({
      path: path.join(os.tmpdir(), `yeelight-clock-appearance-${width}.png`),
      fullPage: true,
    });
    assert.equal(
      await appearancePage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `Appearance editor fits ${width}px`,
    );
  }
  await appearancePage.evaluate(async () => {
    const { editor } = appearancePreview;
    editor.setConfig({
      ...appearancePreview.config,
      preview_appearance: undefined,
      lamp_pixel_style: "circle",
      gallery_background_color: "white",
      effect_spacing_mode: "none",
    });
    await editor.updateComplete;
  });
  await sharedAppearance
    .getByRole("button", { name: "Use card default everywhere", exact: true })
    .click();
  assert.deepEqual(
    await appearancePage.evaluate(
      () => lastAppearanceConfig.preview_overrides,
    ),
    {},
  );
  await appearancePage.evaluate(async () => {
    const { editor, config, updateCard } = appearancePreview;
    const custom = {
      ...config,
      lamp_preview_size: 80,
      preview_appearance: {
        ...config.preview_appearance,
        pixels: "square",
      },
      preview_overrides: {
        lamp: { pixels: "circle", shadow: true },
        gallery: { pixels: "circle", background: "white" },
        favourites: { pixels: "rounded" },
      },
    };
    editor.setConfig(custom);
    await updateCard(custom);
    await editor.updateComplete;
  });
  await appearancePage.waitForFunction(
    () =>
      appearancePreview.card.shadowRoot.querySelector("[data-clock-preview]")
        ?._cells?.[0]?.style.borderRadius === "50%",
  );
  const shapeNotice = sharedAppearance.locator(
    '[data-field="pixels"] .appearance-inheritance',
  );
  assert.match(
    await shapeNotice.innerText(),
    /Custom pixel shape: Lamp Preview, Previews, Favourites/,
  );
  await sharedAppearance
    .getByRole("button", {
      name: "Use card pixel shape for all previews",
      exact: true,
    })
    .click();
  await appearancePage.waitForFunction(
    () =>
      appearancePreview.card.shadowRoot.querySelector("[data-clock-preview]")
        ?._cells?.[0]?.style.borderRadius === "0px",
  );
  assert.deepEqual(
    await appearancePage.evaluate(
      () => lastAppearanceConfig.preview_overrides,
    ),
    {
      lamp: { shadow: true },
      gallery: { background: "white" },
      favourites: {},
    },
  );
  assert.equal(
    await appearancePage.evaluate(
      () => appearancePreview.card.config.lamp_preview_size,
    ),
    80,
  );
  assert.equal(await shapeNotice.count(), 0);
  await sharedAppearance
    .getByRole("button", { name: "Light preset", exact: true })
    .click();
  assert.equal(
    await sharedAppearance
      .getByRole("switch", { name: "Shadow", exact: true })
      .isChecked(),
    true,
  );
  assert.equal(
    await sharedAppearance
      .getByRole("switch", { name: "Hide black pixels", exact: true })
      .isChecked(),
    true,
  );
  await sharedAppearance
    .getByRole("switch", { name: "Shadow", exact: true })
    .press("Space");
  assert.equal(
    await sharedAppearance
      .getByRole("switch", { name: "Shadow", exact: true })
      .isChecked(),
    false,
  );
  await sharedAppearance.getByText("Manage presets", { exact: true }).click();
  const manager = sharedAppearance.locator("[data-preset-manager]");
  const presetTarget = manager.getByLabel("Save current appearance to", {
    exact: true,
  });
  const presetName = manager.getByLabel("Preset name", { exact: true });
  await presetTarget.selectOption("classic");
  await manager
    .getByRole("button", { name: "Update preset", exact: true })
    .click();
  await sharedAppearance
    .getByRole("button", { name: "Square preset", exact: true })
    .click();
  await sharedAppearance
    .getByRole("button", { name: "Classic preset", exact: true })
    .click();
  assert.deepEqual(
    await appearancePage.evaluate(
      () => appearancePreview.editor.getConfig().preview_appearance,
    ),
    {
      background: "white",
      pixels: "rounded",
      spacing: "subtle",
      shadow: false,
      ignoreBlack: true,
    },
  );
  await presetTarget.selectOption("");
  await presetName.fill("Light");
  assert.equal(
    await manager
      .getByRole("button", { name: "Save new preset", exact: true })
      .isDisabled(),
    true,
  );
  await presetName.fill("Night display");
  await manager
    .getByRole("button", { name: "Save new preset", exact: true })
    .click();
  const customId = await appearancePage.evaluate(
    () =>
      appearancePreview.editor
        .getConfig()
        .appearance_presets.find((preset) => preset.name === "Night display")
        .id,
  );
  await presetName.fill("Evening clock");
  await manager
    .getByRole("button", { name: "Update preset", exact: true })
    .click();
  await sharedAppearance
    .getByRole("button", { name: "Evening clock preset", exact: true })
    .click();
  assert.equal(
    await sharedAppearance
      .getByRole("button", { name: "Evening clock preset", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  const serializedPresets = await appearancePage.evaluate(() =>
    JSON.stringify(lastAppearanceConfig),
  );
  await appearancePage.evaluate(async (serialized) => {
    const { editor, updateCard } = appearancePreview;
    editor.setConfig(JSON.parse(serialized));
    await updateCard(JSON.parse(serialized));
    await editor.updateComplete;
  }, serializedPresets);
  assert.equal(
    await sharedAppearance.locator(".appearance-preset").count(),
    4,
  );
  for (const width of [1280, 390]) {
    await appearancePage.setViewportSize({ width, height: 1000 });
    await sharedAppearance.screenshot({
      path: path.join(os.tmpdir(), `yeelight-clock-presets-${width}.png`),
    });
    assert.equal(
      await appearancePage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
  }
  await presetTarget.selectOption("classic");
  await manager
    .getByRole("button", { name: "Restore original preset", exact: true })
    .click();
  await sharedAppearance
    .getByRole("button", { name: "Classic preset", exact: true })
    .click();
  assert.deepEqual(
    await appearancePage.evaluate(
      () => appearancePreview.editor.getConfig().preview_appearance,
    ),
    {
      background: "black",
      pixels: "circle",
      spacing: "normal",
      shadow: false,
      ignoreBlack: false,
    },
  );
  await presetTarget.selectOption(customId);
  await manager
    .getByRole("button", { name: "Delete preset", exact: true })
    .click();
  await manager.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await sharedAppearance.locator(".appearance-preset").count(),
    4,
  );
  await manager
    .getByRole("button", { name: "Delete preset", exact: true })
    .click();
  await manager.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(
    await sharedAppearance.locator(".appearance-preset").count(),
    3,
  );
  assert.deepEqual(
    await appearancePage.evaluate(
      () => lastAppearanceConfig.appearance_presets,
    ),
    [],
  );
  const scaling = await appearancePage.evaluate(async () => {
    const { card, config, updateCard } = appearancePreview;
    const results = [];
    const measure = (grid, name) => {
      if (!grid) throw Error(`Missing ${name} matrix`);
      const cell = grid.firstElementChild.getBoundingClientRect();
      const style = getComputedStyle(grid);
      const bounds = grid.getBoundingClientRect();
      return {
        name,
        cellWidth: cell.width,
        cellHeight: cell.height,
        ratio: parseFloat(style.columnGap) / cell.width,
        paddingRatio: parseFloat(style.paddingLeft) / cell.width,
        aspect: bounds.width / bounds.height,
      };
    };
    for (const layout of [
      "preview-grid",
      "preview-list",
      "preview-strip",
      "preview-carousel",
      "preview-wheel",
      "original",
    ]) {
      for (const size of [100, 55, 30]) {
        await updateCard({
          ...config,
          lamp_preview_size: size,
          preview_size: size,
          effect_preview_size: size,
          style_selector_style: layout,
        });
        for (const width of [350, 280]) {
          card.style.width = `${width}px`;
          await new Promise(requestAnimationFrame);
          const tile = card.shadowRoot.querySelector("[data-clock-preview]");
          card._ensureGrid(tile);
          const favourites = [
            ...card.shadowRoot.querySelectorAll("yeelight-mode-controls"),
          ].find((view) => view.shadowRoot.querySelector("[data-preview]"));
          results.push({
            layout,
            size,
            width,
            matrices: [
              measure(tile.firstElementChild, "lamp"),
              measure(
                card.shadowRoot.querySelector(
                  ".gc-preview-shell .gallery-matrix-preview, .original-gallery .gallery-matrix-preview",
                ),
                "browser",
              ),
              measure(
                favourites.shadowRoot.querySelector(
                  ".gallery-matrix-preview",
                ),
                "favourites",
              ),
            ],
          });
        }
      }
    }
    return results;
  });
  for (const result of scaling) {
    for (const matrix of result.matrices) {
      const label = `${result.layout}/${result.size}/${result.width}/${matrix.name}`;
      assert.ok(matrix.cellWidth > 0, `${label}: visible pixels`);
      assert.ok(
        Math.abs(matrix.cellWidth - matrix.cellHeight) < 0.05,
        `${label}: square pixels`,
      );
      assert.ok(
        Math.abs(matrix.ratio - 60 / 281) < 0.008,
        `${label}: proportional gaps (${matrix.ratio})`,
      );
      assert.ok(
        Math.abs(matrix.paddingRatio - 120 / 281) < 0.016,
        `${label}: proportional padding`,
      );
    }
  }
  for (const size of [100, 30]) {
    await appearancePage.evaluate(async (size) => {
      const { card, config, updateCard } = appearancePreview;
      card.style.width = "350px";
      await updateCard({
        ...config,
        lamp_preview_size: size,
        preview_size: size,
        effect_preview_size: size,
      });
      card.scrollIntoView();
      await new Promise(requestAnimationFrame);
    }, size);
    await appearancePage.locator("yeelight-cube-clock-card").screenshot({
      path: path.join(os.tmpdir(), `yeelight-clock-scaling-${size}.png`),
    });
  }
  await appearancePage.evaluate(async () => {
    const base = "/custom_components/yeelight_cube/www/";
    const { APPEARANCE_PRESETS, APPEARANCE_PROFILES } = await import(
      `${base}preview-appearance.js`
    );
    const { LitElement, html, unsafeHTML } = await import(
      `${base}lib/lit-all.js`
    );
    customElements.define(
      "appearance-render-fixture",
      class extends LitElement {
        render() {
          return html`<style>
                ${this.cardStyles || ""}</style
              >${this.content || html``}`;
        }
      },
    );
    const check = (value, message) => {
      if (!value) throw Error(message);
    };
    const frame = () => new Promise(requestAnimationFrame);
    const area = document.createElement("section");
    area.id = "shared-appearance-regressions";
    document.body.append(area);
    const pixels = Array.from({ length: 100 }, (_, index) =>
      index ? "#ef6572" : "#000000",
    );
    for (const [profile, name] of Object.entries({
      native: "native-effects",
      gradient: "gradient",
      lamp: "lamp-preview",
      draw: "draw",
    })) {
      await import(`${base}yeelight-cube-${name}-card.js`);
      await import(`${base}yeelight-cube-${name}-card-editor.js`);
      const editor = document.createElement(
        `yeelight-cube-${name}-card-editor`,
      );
      editor.hass = appearancePreview.hass;
      area.append(editor);
      await editor.updateComplete;
      editor.setConfig({
        entity: "light.preview",
        target_entities: ["light.preview"],
        preview_appearance: APPEARANCE_PRESETS.classic,
        preview_overrides: {},
        size_pct: 65,
        matrix_size: 65,
        lamp_preview_size: 65,
        pixel_art_preview_size: 65,
        rotary_size: 65,
        rotary_unified_style: "matrix_preview",
        show_favourites: true,
        style_selector_style: "original",
      });
      await editor.updateComplete;
      const shared = editor.shadowRoot.querySelector(
        'yeelight-preview-appearance-editor[section="shared"]',
      );
      check(shared, `${profile}: shared editor missing`);
      const presetSection = shared.closest(
        '[data-section="preview_appearance"]',
      );
      check(
        presetSection?.classList.contains("editor-card"),
        `${profile}: styled preset section`,
      );
      const presetHeader = presetSection.querySelector(".editor-card-header");
      check(
        presetHeader.getAttribute("aria-expanded") === "false",
        `${profile}: presets initially folded`,
      );
      presetHeader.click();
      await editor.updateComplete;
      check(
        presetHeader.getAttribute("aria-expanded") === "true",
        `${profile}: presets expand`,
      );
      presetHeader.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await editor.updateComplete;
      check(
        presetHeader.getAttribute("aria-expanded") === "false",
        `${profile}: presets collapse with keyboard`,
      );
      check(
        presetSection.querySelector(".editor-card-content").inert,
        `${profile}: folded presets not focusable`,
      );
      presetHeader.click();
      await editor.updateComplete;
      await shared.updateComplete;
      check(
        !shared.shadowRoot.querySelector('[aria-label="Appearance source"]'),
        `${profile}: no local overrides inside presets`,
      );
      let saved;
      editor.addEventListener("config-changed", (event) => {
        saved = event.detail.config;
      });
      const localSections = {
        native: {
          lamp: "Lamp Preview",
          gallery: "Previews",
          favourites: "Favourites",
        },
        lamp: { lamp: "Lamp Preview" },
        draw: { canvas: "Drawing Matrix Section", art: "Pixel Art Section" },
        gradient: { gallery: "Mode", rotary: "Angle" },
      }[profile];
      for (const [section, title] of Object.entries(localSections)) {
        const local = editor.shadowRoot.querySelector(
          `yeelight-preview-appearance-editor[section="${section}"]`,
        );
        check(local, `${profile}: ${section} local appearance control`);
        const container = local.closest(".editor-card");
        const header = container?.querySelector(".editor-card-header");
        check(
          header?.textContent.includes(title),
          `${profile}: ${section} beside its own settings`,
        );
        check(
          container !== presetSection &&
            container.querySelector('input[type="range"]'),
          `${profile}: ${section} with local size`,
        );
        if (container.classList.contains("editor-card-collapsed"))
          header.click();
        await editor.updateComplete;
        await local.updateComplete;
        const sourceButtons = () =>
          local.shadowRoot.querySelectorAll(
            '[aria-label="Appearance source"] button',
          );
        check(
          sourceButtons()[0].getAttribute("aria-pressed") === "true",
          `${profile}: ${section} inherits presets`,
        );
        sourceButtons()[1].click();
        await local.updateComplete;
        local.shadowRoot
          .querySelector('[data-field="pixels"] button[aria-label="Square"]')
          .click();
        await editor.updateComplete;
        await local.updateComplete;
        check(
          saved.preview_overrides[section].pixels === "square",
          `${profile}: ${section} saves custom pixels`,
        );
        check(
          saved.preview_appearance.pixels === "circle",
          `${profile}: ${section} leaves shared preset intact`,
        );
        editor.setConfig(JSON.parse(JSON.stringify(saved)));
        await editor.updateComplete;
        await local.updateComplete;
        check(
          sourceButtons()[1].getAttribute("aria-pressed") === "true",
          `${profile}: ${section} reloads custom choice`,
        );
        sourceButtons()[0].click();
        await editor.updateComplete;
        await local.updateComplete;
        check(
          !Object.keys(saved.preview_overrides[section] || {}).length,
          `${profile}: ${section} returns to preset`,
        );
        check(
          !local.shadowRoot.querySelector(".appearance-fields"),
          `${profile}: ${section} hides custom controls`,
        );
        check(
          saved.size_pct === 65 && saved.matrix_size === 65,
          `${profile}: ${section} keeps local sizes`,
        );
        sourceButtons()[1].click();
        await local.updateComplete;
        local.shadowRoot
          .querySelector('[data-field="pixels"] button[aria-label="Square"]')
          .click();
        await editor.updateComplete;
        await shared.updateComplete;
        [
          ...shared.shadowRoot.querySelectorAll(
            ".appearance-inheritance > button",
          ),
        ]
          .find(
            (button) =>
              button.textContent.trim() === "Use card default everywhere",
          )
          .click();
        await editor.updateComplete;
        await local.updateComplete;
        check(
          sourceButtons()[0].getAttribute("aria-pressed") === "true",
          `${profile}: global reset restores ${section} source control`,
        );
        check(
          !local.shadowRoot.querySelector(".appearance-fields"),
          `${profile}: global reset closes ${section} custom fields`,
        );
      }
      const card = document.createElement(`yeelight-cube-${name}-card`);
      for (const [preset, appearance] of Object.entries(APPEARANCE_PRESETS)) {
        await shared.updateComplete;
        shared.shadowRoot
          .querySelector(
            `[aria-label="${preset[0].toUpperCase() + preset.slice(1)} preset"]`,
          )
          .click();
        await editor.updateComplete;
        check(
          saved?.preview_appearance.background === appearance.background,
          `${profile}: ${preset} emitted`,
        );
        check(
          saved.size_pct === 65 && saved.matrix_size === 65,
          `${profile}: sizes preserved`,
        );
        editor.setConfig(JSON.parse(JSON.stringify(saved)));
        await editor.updateComplete;
        card.setConfig(saved);
        for (const definition of Object.values(
          APPEARANCE_PROFILES[profile],
        )) {
          check(
            card.config[definition.keys.pixels] === appearance.pixels,
            `${profile}: ${preset} pixels`,
          );
          check(
            card.config[definition.keys.shadow] === appearance.shadow,
            `${profile}: ${preset} shadow`,
          );
        }
        const host = document.createElement("appearance-render-fixture");
        // The card's own stylesheet where its markup relies on it (Draw;
        // Native's matrix: the shared matrixPreviewStyles).
        host.cardStyles = ["draw", "native"].includes(profile)
          ? [card.constructor.styles].flat().map((sheet) => sheet.cssText).join(" ")
          : "";
        host.style.display = "block";
        area.append(host);
        await host.updateComplete;
        const root = host.shadowRoot;
        const measure = async (width) => {
          host.style.width = `${width}px`;
          let content;
          if (profile === "native")
            content = card._matrix({ name: "Rainbow" }, true);
          if (profile === "lamp")
            content = html`${unsafeHTML(
              card._getStyles() +
                card._generateMatrixHtml(pixels, {
                  attributes: { device_orientation: "right" },
                }),
            )}`;
          if (profile === "gradient")
            content = card._angleRotaryTemplate(45);
          if (profile === "draw")
            content = card._renderMatrixSection(
              card.config,
              appearance.spacing === "normal" ? 3 : 0,
              appearance.background,
              "",
              "65%",
              appearance.pixels,
            );
          host.content = content;
          host.requestUpdate();
          await host.updateComplete;
          await frame();
          const grid = root.querySelector(
            ".gallery-matrix-preview, .lamp-preview-css, .matrix-preview-grid, .matrix",
          );
          const cell = grid?.children[1];
          check(cell, `${profile}: matrix cells`);
          const rect = cell.getBoundingClientRect();
          check(
            rect.width > 0 && Math.abs(rect.width - rect.height) < 1,
            `${profile}: square cells ${rect.width}x${rect.height}`,
          );
          const styles = getComputedStyle(grid);
          check(
            getComputedStyle(cell).borderRadius ===
              (appearance.pixels === "circle"
                ? "50%"
                : appearance.pixels === "rounded"
                  ? "20%"
                  : "0px"),
            `${profile}: rendered ${preset} shape`,
          );
          return {
            gap: parseFloat(styles.columnGap) / rect.width,
            padding: parseFloat(styles.paddingLeft) / rect.width,
          };
        };
        const large = await measure(350);
        const small = await measure(230);
        check(
          Math.abs(large.gap - small.gap) < 0.01 &&
            Math.abs(large.padding - small.padding) < 0.02,
          `${profile}: proportional ${preset} geometry`,
        );
        if (profile === "draw") {
          // The pixel-art gallery (the shared gallery) in every layout,
          // in the preset's appearance.
          for (const style of [
            "preview-grid",
            "preview-list",
            "preview-strip",
            "preview-carousel",
            "preview-wheel",
            "preview-album",
          ]) {
            host.content = html`<yc-collection-gallery
                .config=${{ ...card.config, style_selector_style: style }}
                .items=${card._pixelArtGalleryItems([{ name: "Sample", pixels }])}
              ></yc-collection-gallery>`;
            host.requestUpdate();
            await host.updateComplete;
            await root.querySelector("yc-collection-gallery")?.updateComplete;
            await frame();
            const matrix = root.querySelector(
              "yc-collection-gallery .gallery-matrix-preview",
            );
            check(
              matrix?.children.length === 100,
              `Draw ${style}: shared matrix`,
            );
            check(
              getComputedStyle(matrix.children[1]).borderRadius ===
                (appearance.pixels === "circle"
                  ? "50%"
                  : appearance.pixels === "rounded"
                    ? "20%"
                    : "0px"),
              `Draw ${style}: ${preset} pixels`,
            );
          }
        }
        host.remove();
      }
      if (profile === "gradient") {
        // A shadow-only setting change re-renders the gallery's previews.
        const gallery = document.createElement("yc-collection-gallery");
        const items = [
          {
            dataMode: "Solid Color",
            name: "Solid Color",
            title: "Solid",
            colorData: Array.from({ length: 100 }, () => [255, 0, 0]),
          },
        ];
        document.body.append(gallery);
        gallery.config = { style_selector_style: "preview-list", show_search: false };
        gallery.items = items;
        await gallery.updateComplete;
        const before = gallery.innerHTML;
        gallery.config = { ...gallery.config, gallery_matrix_box_shadow: true };
        await gallery.updateComplete;
        check(
          gallery.innerHTML !== before,
          "Gradient shadow-only update re-renders the previews",
        );
        gallery.remove();
      }
      editor.style.cssText =
        "display:block;width:400px;max-width:100%;margin:16px auto;";
      card.disconnectedCallback?.();
    }
  });
  for (const width of [1280, 390]) {
    await appearancePage.setViewportSize({ width, height: 1000 });
    for (const name of [
      "native-effects",
      "gradient",
      "lamp-preview",
      "draw",
    ]) {
      await appearancePage
        .locator(
          `#shared-appearance-regressions yeelight-cube-${name}-card-editor`,
        )
        .screenshot({
          path: path.join(
            os.tmpdir(),
            `yeelight-${name}-appearance-${width}.png`,
          ),
        });
    }
  }
  assert.deepEqual(appearanceErrors, []);
  await appearancePage.close();
  console.log(
    "PASS shared presets, config reload and proportional geometry on Native, Gradient, Lamp and Draw; all Draw gallery layouts",
  );
  console.log(
    "PASS Clock appearance presets, sparse overrides, reset, local sizes, legacy adoption and desktop/mobile editor",
  );
  console.log(
    "PASS proportional Clock gaps and padding across six browser layouts, three sizes and two card widths",
  );
};
