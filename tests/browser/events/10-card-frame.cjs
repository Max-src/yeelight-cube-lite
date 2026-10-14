// Card events check (tests/card-events-browser.cjs): the shared card frame on
// every card and editor.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, lamp, draw, gradient } = t;
  // --- The shared card frame (card-shell.js) on every card and editor ----
  const CARDS = {
    clock: {},
    "native-effects": {},
    "lamp-preview": {},
    draw: { pixelart_sensor: "sensor.pixel" },
    gradient: {},
    palette: { palette_sensor: "sensor.pixel" },
    "color-list-editor": {},
  };
  for (const [name, extra] of Object.entries(CARDS)) {
    const tag = `yeelight-cube-${name}-card`;
    const frame = (config) =>
      page.evaluate(
        async ({ tag, config }) => {
          await mount(tag, config);
          await new Promise((resolve) => setTimeout(resolve, 100));
          await card.updateComplete;
          const root = card.shadowRoot;
          return {
            cards: root.querySelectorAll("ha-card").length,
            plain: !!root.querySelector("ha-card.yc-card.yc-card-plain"),
            title:
              root.querySelector(".yc-card-title")?.textContent.trim() ??
              null,
            status:
              root.querySelector(".yc-card-status")?.textContent.trim() ??
              null,
            notice:
              root.querySelector(".yc-card-notice")?.textContent.trim() ??
              null,
            muted:
              root.querySelector(".yc-card-muted")?.textContent.trim() ??
              null,
          };
        },
        { tag, config },
      );
    const lamp = {
      entity: "light.a",
      target_entities: ["light.a"],
      ...extra,
    };
    assert.deepEqual(
      await frame({ ...lamp, title: "Desk", show_lamp_status: true }),
      {
        cards: 1,
        plain: false,
        title: "Desk",
        status: "Custom Draw",
        notice: null,
        muted: null,
      },
      `${name}: shared header`,
    );
    assert.deepEqual(
      await frame({ ...lamp, show_card_background: false }),
      {
        cards: 1,
        plain: true,
        title: null,
        status: null,
        notice: null,
        muted: null,
      },
      `${name}: no header without title/status, plain frame`,
    );
    if (name !== "draw" && name !== "palette")
      assert.equal(
        (await frame({ ...extra })).notice,
        "Select a Yeelight Cube lamp in the card editor.",
        `${name}: shared no-lamp notice`,
      );
    const gone = {
      ...extra,
      entity: "light.gone",
      target_entities: ["light.gone"],
    };
    if (name === "clock" || name === "native-effects" || name === "draw")
      // These stay usable (browse and preview; draw and save) with the
      // shared line.
      assert.equal(
        (await frame(gone)).muted,
        "Lamp unavailable",
        `${name}: unavailable line`,
      );
    else if (name !== "palette")
      assert.match(
        (await frame(gone)).notice ?? "",
        /Lamp not found: light\.gone/,
        `${name}: shared lamp-not-found notice`,
      );
    if (["draw", "gradient", "lamp-preview", "color-list-editor"].includes(name))
      // A lamp going offline while the card is open shows the line (the
      // card stays usable).
      assert.deepEqual(
        await page.evaluate(
          async ({ tag, config }) => {
            await mount(tag, config);
            const muted = () =>
              card.shadowRoot.querySelector(".yc-card-muted")?.textContent.trim() ?? null;
            const before = muted();
            const light = hass.states["light.a"];
            card.hass = {
              ...hass,
              states: { ...hass.states, "light.a": { ...light, state: "unavailable" } },
            };
            await new Promise((resolve) => setTimeout(resolve, 100));
            await card.updateComplete;
            const after = muted();
            card.hass = hass;
            return [before, after];
          },
          { tag, config: lamp },
        ),
        [null, "Lamp unavailable"],
        `${name}: the line follows the lamp going offline`,
      );

    // Its editor: the same settings, in the same order, reporting the
    // same option names.
    const editor = await page.evaluate(
      async ({ tag, lamp }) => {
        // The way Home Assistant opens it (loads the editor module).
        const editor = await customElements.get(tag).getConfigElement();
        editor.hass = hass;
        editor.setConfig({ type: `custom:${tag}`, ...lamp });
        document.querySelector("main").replaceChildren(editor);
        await editor.updateComplete;
        const root = editor.shadowRoot;
        const ids = [
          ...root.querySelectorAll(
            "#title, #show_card_background, #show_lamp_status",
          ),
        ].map((el) => el.id);
        // It opens on its first section, Global Settings, only.
        const sections = [...root.querySelectorAll(".editor-card-content")];
        const opened = sections.filter((section) => !section.inert);
        const firstOpen =
          opened.length === 1 &&
          opened[0] === sections[0] &&
          !!opened[0].querySelector("#title");
        const changes = [];
        editor.addEventListener("config-changed", (event) =>
          changes.push(event.detail.config),
        );
        const title = root.querySelector("#title");
        title.value = "Kitchen";
        title.dispatchEvent(new Event("input"));
        await editor.updateComplete;
        const status = root.querySelector("#show_lamp_status");
        status.checked = true;
        status.dispatchEvent(new Event("change"));
        await editor.updateComplete;
        const last = changes.at(-1) || {};
        return {
          ids,
          firstOpen,
          title: last.title,
          status: last.show_lamp_status,
          lamps: last.target_entities,
        };
      },
      { tag, lamp },
    );
    assert.deepEqual(
      editor,
      {
        ids: ["title", "show_card_background", "show_lamp_status"],
        firstOpen: true,
        title: "Kitchen",
        status: true,
        lamps: ["light.a"],
      },
      `${name}: shared card-frame settings in the editor, opened on Global Settings`,
    );
  }
};
