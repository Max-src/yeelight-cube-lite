// Card events check (tests/card-events-browser.cjs): every matrix preview's
// frame (matrix-frame.js) keeps the same look standing up: the Lamp
// Preview's and the drawing grid's frame (padding, corners) is as thick as
// the landscape one, its pixels about the same size.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const frames = await page.evaluate(async () => {
    const ratios = (grid) => {
      const cell = grid.children[1].getBoundingClientRect();
      const style = getComputedStyle(grid);
      return {
        cols: style.gridTemplateColumns.split(" ").length,
        cell: cell.width,
        padding: parseFloat(style.paddingLeft),
        radius: parseFloat(style.borderTopLeftRadius),
      };
    };
    const results = {};
    const attributes = hass.states["light.a"].attributes;
    const previous = attributes.device_orientation;
    for (const orientation of ["right", "down"]) {
      hass.states["light.a"] = {
        ...hass.states["light.a"],
        attributes: { ...attributes, device_orientation: orientation },
      };
      await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
      await new Promise((resolve) => setTimeout(resolve, 150));
      results[`lamp ${orientation}`] = ratios(card.shadowRoot.querySelector(".lamp-preview-css"));
    }
    hass.states["light.a"] = { ...hass.states["light.a"], attributes: { ...attributes, device_orientation: previous } };
    for (const vertical of [false, true]) {
      localStorage.setItem("yeelight_cube_matrix_view", JSON.stringify(vertical));
      await mount("yeelight-cube-draw-card", { entity: "light.a", show_pixelart_gallery: false });
      await new Promise((resolve) => setTimeout(resolve, 100));
      results[`draw ${vertical ? "vertical" : "landscape"}`] = ratios(card.shadowRoot.querySelector(".matrix"));
    }
    localStorage.removeItem("yeelight_cube_matrix_view");
    return results;
  });
  const same = (a, b, label) => {
    assert.equal(a.cols, 20, `${label}: landscape columns`);
    assert.equal(b.cols, 5, `${label}: vertical columns`);
    assert.ok(Math.abs(a.padding - b.padding) < 0.5, `${label}: padding ${a.padding} vs ${b.padding}px`);
    assert.ok(Math.abs(a.radius - b.radius) < 0.5, `${label}: corners ${a.radius} vs ${b.radius}px`);
    assert.ok(b.padding >= 4, `${label}: a visible frame standing up (${b.padding}px)`);
    assert.ok(Math.abs(a.cell - b.cell) / a.cell < 0.25, `${label}: pixels ${a.cell} vs ${b.cell}px`);
  };
  same(frames["lamp right"], frames["lamp down"], "lamp preview");
  same(frames["draw landscape"], frames["draw vertical"], "drawing grid");
};
