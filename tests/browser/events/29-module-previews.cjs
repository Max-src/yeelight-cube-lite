// Card events check (tests/card-events-browser.cjs): a Cube Matrix's
// previews show its modules only (matrix-modules.js moduleGrid). With
// Matrix + Spot (2026-11-15), the effect card's tiles and the lamp preview
// show 10 columns, 25 pixels and the spot's face (its lens lit), not a
// 20 x 5 lamp; with a panel added, its face one cell over its 25 pixels.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const original = hass.states["light.a"];
    const modules = {
      matrix_columns: 10,
      matrix_modules: [{ type: "matrix", column: 0 }, { type: "spot", column: 5 }],
    };
    hass.states["light.a"] = {
      ...original,
      attributes: { ...original.attributes, ...modules, content_mode: "Native Effect", native_effect: "Rainbow" },
    };
    const shown = (grid) =>
      [...grid.children].filter((cell) => cell.tagName !== "SPAN" && getComputedStyle(cell).display !== "none");
    await mount("yeelight-cube-native-effects-card", {
      entity: "light.a", show_gallery: true, style_selector_style: "preview-grid",
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const tiles = [...card.shadowRoot.querySelectorAll("yc-collection-gallery .gallery-matrix-preview")];
    const tile = tiles[0];
    const tileCells = tile ? shown(tile) : [];
    const spot = tileCells.find((cell) => cell.dataset.module === "spot");
    // The lens's centre: the first colour of the face's gradients.
    const lens = (cell) =>
      cell ? getComputedStyle(cell).backgroundImage.match(/rgba?\([^)]*\)/)?.[0] ?? null : null;
    const out = {
      tiles: tiles.length,
      tileCells: tileCells.length,
      columns: tile ? getComputedStyle(tile).gridTemplateColumns.split(" ").length : 0,
      spotLit: lens(spot),
    };
    // The Clock card: its tiles the modules' too, each style's digits laid
    // out in their 10 columns (renderClockFrame), not cropped from 20.
    hass.states["light.a"] = {
      ...original,
      attributes: { ...original.attributes, ...modules, content_mode: "Clock" },
    };
    await mount("yeelight-cube-clock-card", {
      entity: "light.a", show_gallery: true, style_selector_style: "preview-grid",
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const clockTile = card.shadowRoot.querySelector("yc-collection-gallery .gallery-matrix-preview");
    out.clockCells = clockTile ? shown(clockTile).length : 0;
    out.clockColumns = card._previewAttrs(card._currentStyle()).matrix_columns;
    hass.states["light.a"] = {
      ...original,
      attributes: { ...original.attributes, ...modules, content_mode: "Native Effect", native_effect: "Rainbow" },
    };
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const dots = [...card.shadowRoot.querySelectorAll(".lamp-dot")];
    out.dots = dots.filter((dot) => getComputedStyle(dot).display !== "none").length;
    out.spotDots = dots.filter((dot) => dot.dataset.module === "spot").length;
    out.dotLens = lens(dots.find((dot) => dot.dataset.module === "spot"));
    // A panel added: one face over its 25 pixels, as wide as 5 of them.
    hass.states["light.a"] = {
      ...original,
      attributes: {
        ...original.attributes,
        matrix_columns: 15,
        matrix_modules: [...modules.matrix_modules, { type: "panel", column: 10 }],
        content_mode: "Native Effect",
        native_effect: "Rainbow",
      },
    };
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const panelDots = [...card.shadowRoot.querySelectorAll(".lamp-dot")].filter(
      (dot) => getComputedStyle(dot).display !== "none",
    );
    const panel = panelDots.find((dot) => dot.dataset.module === "panel");
    const first = panelDots.find((dot) => !dot.dataset.module);
    out.panelDots = panelDots.length;
    out.panelWide = panel && first
      ? panel.getBoundingClientRect().width / first.getBoundingClientRect().width
      : 0;
    out.panelBlend = panel ? getComputedStyle(panel).backgroundBlendMode.split(",")[0].trim() : null;
    hass.states["light.a"] = original;
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    out.liteDots = [...card.shadowRoot.querySelectorAll(".lamp-dot")]
      .filter((dot) => getComputedStyle(dot).display !== "none").length;
    return out;
  });
  assert.ok(result.tiles >= 1, "the gallery shows the effects");
  assert.equal(result.tileCells, 26, "a tile: the Matrix's 25 pixels and the spot");
  assert.equal(result.columns, 10, "a tile is the modules' 10 columns wide");
  assert.ok(result.spotLit && result.spotLit !== "rgb(9, 9, 10)", `the spot is lit (${result.spotLit})`);
  assert.equal(result.clockCells, 26, "a clock tile: the Matrix's 25 pixels and the spot");
  assert.equal(result.clockColumns, 10, "a clock style's digits are laid out in the modules' columns");
  assert.equal(result.dots, 26, "the lamp preview: 25 dots and the spot");
  assert.equal(result.spotDots, 1);
  assert.ok(result.dotLens && result.dotLens !== "rgb(9, 9, 10)", `the lamp preview's spot is lit (${result.dotLens})`);
  assert.equal(result.panelDots, 27, "Matrix, spot, panel: 25 dots and two faces");
  assert.ok(result.panelWide > 5, `the panel's face spans its 5 columns (${result.panelWide})`);
  assert.equal(result.panelBlend, "lighten");
  assert.equal(result.liteDots, 100, "a Cube Lite keeps its 100");
  console.log("PASS a Cube Matrix's previews show its modules only (effect and clock tiles, lamp preview), a spot and a panel one face each, a Cube Lite its 100 pixels");
};
