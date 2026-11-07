// Card events check (tests/card-events-browser.cjs): a picture never shows in
// the wrong place when the lamp's orientation changes. Dots and pixels fade
// to a new color; ones kept from the other layout showed the picture a
// moment where it was, then moved. From the first frame after the change,
// the Lamp Preview and the drawing area show what they settle on.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const frame = (selector, cellSelector) => () => {
      const grid = card.shadowRoot.querySelector(selector);
      return [...grid.querySelectorAll(cellSelector)]
        .map((cell) => getComputedStyle(cell).backgroundColor)
        .join("|");
    };
    const nextFrames = async (snap) => {
      const frames = [];
      for (let k = 0; k < 4; k++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        frames.push(snap());
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      const settled = snap();
      return frames.every((shown) => shown === settled);
    };
    const original = hass.states["light.a"];
    const setOrientation = (orientation, extra = {}) => {
      hass.states["light.a"] = {
        ...hass.states["light.a"],
        state: "on",
        attributes: { ...hass.states["light.a"].attributes, device_orientation: orientation, ...extra },
      };
    };
    // An L with a mark in a corner, in the lamp's order (row 0 = bottom); an
    // upside-down mount gets it turned, as the integration publishes it.
    const art = Array.from({ length: 100 }, (_, i) =>
      i % 20 === 0 || i < 20 ? [255, 0, 0] : i === 99 ? [0, 0, 255] : [0, 0, 0],
    );
    const published = (orientation) =>
      ["left", "up"].includes(orientation) ? art.slice().reverse() : art;
    const clean = {};
    for (const [from, to] of [["right", "down"], ["down", "left"], ["right", "left"], ["up", "right"]]) {
      setOrientation(from, { content_mode: "Matrix", matrix_colors: published(from) });
      await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
      await new Promise((resolve) => setTimeout(resolve, 400));
      setOrientation(to, { matrix_colors: published(to) });
      card.hass = { ...hass, states: { ...hass.states } };
      clean[`lamp ${from}->${to}`] = await nextFrames(frame(".lamp-preview-css", ".lamp-dot"));
    }
    for (const [from, to] of [["right", "down"], ["down", "right"]]) {
      localStorage.removeItem("yeelight_cube_matrix_view");
      setOrientation(from);
      await mount("yeelight-cube-draw-card", { entity: "light.a", show_pixelart_gallery: false });
      card.matrix = Array.from({ length: 100 }, (_, i) =>
        i % 20 === 0 || i >= 80 ? "#ff0000" : i === 19 ? "#0000ff" : null,
      );
      card.requestUpdate();
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 300));
      setOrientation(to);
      card.hass = { ...hass, states: { ...hass.states } };
      clean[`draw ${from}->${to}`] = await nextFrames(frame(".matrix", ".pixel"));
    }
    hass.states["light.a"] = original;
    return clean;
  });
  for (const [change, clean] of Object.entries(result))
    assert.ok(clean, `${change}: the picture showed in the old layout first`);
  console.log("PASS a picture never shows in the old layout when the lamp's orientation changes");
};
