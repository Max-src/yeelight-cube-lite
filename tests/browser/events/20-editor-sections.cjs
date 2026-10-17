// Card events check (tests/card-events-browser.cjs): every card editor, every
// section open, shows all its content. A foldable section never cuts what
// it holds (it once had a 2000 px cap: long sections lost their end), and a
// sortable list never hides rows behind a scroll box of its own (the editor
// scrolls). The Draw editor gets the 68 official pixel arts, so its Pixel Art
// section is long (its Official pixel arts list alone has 35 rows).
const assert = require("node:assert/strict");

const CARDS = {
  clock: {},
  "native-effects": {},
  "lamp-preview": {},
  draw: { pixelart_sensor: "sensor.pixel" },
  gradient: {},
  palette: { palette_sensor: "sensor.pixel" },
  "color-list-editor": {},
};

module.exports = async (t) => {
  const { page } = t;
  for (const [name, extra] of Object.entries(CARDS)) {
    const tag = `yeelight-cube-${name}-card`;
    const clipped = await page.evaluate(
      async ({ tag, extra }) => {
        const saved = hass;
        const official = [];
        for (const [orientation, count] of [["horizontal", 35], ["vertical", 33]])
          for (let i = 1; i <= count; i++)
            official.push({
              name: `Built-in: ${orientation} ${i}`,
              collection: i % 3 ? "Nature" : "Geometry",
              orientation,
              pixels: [{ position: i, color: [255, 0, 0] }],
            });
        hass = {
          ...hass,
          connection: {}, // its own official pixel arts
          callWS: async ({ type }) =>
            type === "yeelight_cube/builtin_pixel_arts" ? { pixel_arts: official } : {},
        };
        try {
          const editor = await customElements.get(tag).getConfigElement();
          editor.hass = hass;
          editor.setConfig({
            type: `custom:${tag}`,
            entity: "light.a",
            target_entities: ["light.a"],
            ...extra,
          });
          document.querySelector("main").replaceChildren(editor);
          await editor.updateComplete;
          const root = editor.shadowRoot;
          // Every section open (the editor's own state, like a click on each).
          const ids = [...root.querySelectorAll("[data-section]")].map(
            (node) => node.dataset.section,
          );
          editor._open = Object.fromEntries(ids.map((id) => [id, true]));
          await editor.updateComplete;
          // Content loaded meanwhile (the official pixel arts), then the
          // opening animation (0.3 s).
          await new Promise((resolve) => setTimeout(resolve, 700));
          await editor.updateComplete;
          const problems = [];
          for (const body of root.querySelectorAll(".editor-card-body")) {
            if (body.scrollHeight > body.clientHeight + 1)
              problems.push(
                `section "${body.closest("[data-section]")?.dataset.section}" cut: ` +
                  `${body.scrollHeight}px in ${body.clientHeight}px`,
              );
          }
          for (const list of root.querySelectorAll(".orderable-list")) {
            if (list.scrollHeight > list.clientHeight + 1)
              problems.push(
                `a sortable list in "${list.closest("[data-section]")?.dataset.section}" ` +
                  `hides rows: ${list.scrollHeight}px in ${list.clientHeight}px`,
              );
          }
          return { sections: ids.length, problems };
        } finally {
          hass = saved;
        }
      },
      { tag, extra },
    );
    assert.ok(clipped.sections > 0, `${name}: editor sections found`);
    assert.deepEqual(clipped.problems, [], `${name}: every editor section shows all its content`);
  }
};
