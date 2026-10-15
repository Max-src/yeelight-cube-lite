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

    // A lamp of the card renamed (or removed) while another still works:
    // the frame names it, also when it goes while the card is open.
    assert.deepEqual(
      await page.evaluate(
        async ({ tag, extra }) => {
          const missing = () =>
            card.shadowRoot.querySelector(".yc-card-missing")?.textContent.replace(/\s+/g, " ").trim() ?? null;
          const light = hass.states["light.a"];
          const withB = { ...hass, states: { ...hass.states, "light.b": light } };
          const saved = hass;
          hass = withB;
          await mount(tag, { ...extra, entity: "light.a", target_entities: ["light.a", "light.b"] });
          hass = saved;
          const both = missing();
          // light.b renamed in place: its state is gone.
          card.hass = saved;
          await new Promise((resolve) => setTimeout(resolve, 100));
          await card.updateComplete;
          const renamed = missing();
          await mount(tag, { ...extra, entity: "light.a", target_entities: ["light.a"] });
          return [both, renamed, missing()];
        },
        { tag, extra },
      ),
      [
        null,
        "Lamp not found: light.b. Renamed or removed? Update this card's lamps.",
        null,
      ],
      `${name}: a renamed lamp among the card's lamps is named`,
    );

    // One of the card's lamps offline: the card keeps controlling the other
    // (no offline preview, controls enabled) and names the offline one.
    assert.deepEqual(
      await page.evaluate(
        async ({ tag, extra }) => {
          const text = (selector) =>
            [...card.shadowRoot.querySelectorAll(selector)].map((node) =>
              node.textContent.replace(/\s+/g, " ").trim(),
            );
          const light = hass.states["light.a"];
          const saved = hass;
          hass = {
            ...hass,
            states: {
              ...hass.states,
              "light.b": { state: "unavailable", attributes: { friendly_name: "Bedroom" } },
            },
          };
          try {
            await mount(tag, { ...extra, entity: "light.a", target_entities: ["light.b", "light.a"] });
            const adapter = card._controls?.adapter;
            return {
              offline: text(".yc-card-offline"),
              unavailableLine: text(".yc-card-muted:not(.yc-card-offline):not(.yc-card-missing)").filter(
                (line) => line === "Lamp unavailable",
              ),
              shown: card._primaryEntity(),
              controls: adapter ? { preview: adapter.previewOnly(), disabled: adapter.disabled() } : null,
              light: light.state,
            };
          } finally {
            hass = saved;
          }
        },
        { tag, extra },
      ),
      {
        offline: ["Lamp unavailable: Bedroom. The other lamps are controlled."],
        unavailableLine: [],
        shown: "light.a",
        controls: ["yeelight-cube-clock-card", "yeelight-cube-native-effects-card"].includes(tag)
          ? { preview: false, disabled: false }
          : null,
        light: "on",
      },
      `${name}: one lamp offline, the card controls the other and names it`,
    );

    // A change the lamp failed to apply (last_command_error), reported while
    // the card is open, is named; it goes once a later change works.
    assert.deepEqual(
      await page.evaluate(
        async ({ tag, extra }) => {
          const failed = () =>
            [...card.shadowRoot.querySelectorAll(".yc-card-failed")].map((node) =>
              node.textContent.replace(/\s+/g, " ").trim(),
            );
          const saved = hass;
          const light = saved.states["light.a"];
          const withError = (error) => ({
            ...saved,
            states: {
              ...saved.states,
              "light.a": { ...light, attributes: { ...light.attributes, last_command_error: error } },
            },
          });
          try {
            await mount(tag, { ...extra, entity: "light.a" });
            const before = failed();
            card.hass = withError({ service: "set_mode", message: "Lamp refused the mode", at: 1 });
            await new Promise((resolve) => setTimeout(resolve, 100));
            await card.updateComplete;
            const shown = failed();
            card.hass = withError(null);
            await new Promise((resolve) => setTimeout(resolve, 100));
            await card.updateComplete;
            return { before, shown, after: failed() };
          } finally {
            hass = saved;
          }
        },
        { tag, extra },
      ),
      {
        before: [],
        shown: ["the last change was not applied (Lamp refused the mode)."],
        after: [],
      },
      `${name}: a change the lamp failed to apply is named until one works`,
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
