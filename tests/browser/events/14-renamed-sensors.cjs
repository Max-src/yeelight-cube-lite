// Card events check (tests/card-events-browser.cjs): the collection sensors
// (pixel arts, palettes) are found by their attributes, whatever their ids:
// a fresh installation's ids (sensor.saved_drawings), none configured, and a
// sensor renamed while the card is open (in place from Home Assistant
// 2026.11) is found again.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, draw } = t;
  const result = await page.evaluate(async (draw) => {
    const { clearSensorLookups } = await import(
      "/custom_components/yeelight_cube/www/sensor-lookup.js"
    );
    const saved = hass;
    const pixelArts = saved.states["sensor.pixel"].attributes.pixel_arts;
    const palettes = [
      { name: "Warm", colors: [[255, 0, 0], [255, 160, 0]] },
      { name: "Sea", colors: [[0, 0, 255]] },
    ];
    // The collection sensors under the given ids only (one of each, as
    // the integration creates; earlier checks' sensors removed).
    const withSensors = (artId, paletteId) => {
      const states = Object.fromEntries(
        Object.entries(saved.states).filter(
          ([, state]) =>
            !["pixel_arts", "palettes_v2", "palettes"].some(
              (name) => name in (state.attributes || {}),
            ),
        ),
      );
      return {
        ...saved,
        states: {
          ...states,
          [artId]: { state: "2", attributes: { pixel_arts: pixelArts, count: 2 } },
          [paletteId]: { state: "2", attributes: { palettes_v2: palettes, count: 2 } },
        },
      };
    };
    const names = () =>
      (card.shadowRoot.querySelector("yc-collection-gallery")?.items || []).map(
        (item) => item.name,
      );
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await card.updateComplete;
    };
    const shown = { arts: pixelArts.map((art) => art.name) };
    try {
      clearSensorLookups();
      // A fresh installation: nothing configured.
      hass = withSensors("sensor.saved_drawings", "sensor.color_palettes");
      await mount(draw, { entity: "light.a", show_pixelart_gallery: true });
      await settle();
      shown.drawFresh = [names(), card.config.pixelart_sensor];
      // Renamed while the card is open.
      card.hass = withSensors("sensor.my_drawings", "sensor.color_palettes");
      await settle();
      shown.drawRenamed = [names(), card.config.pixelart_sensor];

      // The Palette card, configured with a sensor since renamed.
      hass = withSensors("sensor.saved_drawings", "sensor.my_colors");
      await mount("yeelight-cube-palette-card", {
        entity: "light.a",
        palette_sensor: "sensor.color_palettes",
      });
      await settle();
      shown.paletteRenamed = [names(), card.config.palette_sensor];
    } finally {
      hass = saved;
      clearSensorLookups();
    }
    return shown;
  }, draw);
  assert.equal(result.arts.length, 2);
  assert.deepEqual(result, {
    arts: result.arts,
    drawFresh: [result.arts, "sensor.saved_drawings"],
    drawRenamed: [result.arts, "sensor.my_drawings"],
    paletteRenamed: [["Warm", "Sea"], "sensor.my_colors"],
  });
};
