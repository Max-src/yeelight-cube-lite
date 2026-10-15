// Card events check (tests/card-events-browser.cjs): several lamps, one
// offline (service-call-utils.js availableTargets, offline-preview-state.js):
// the cards that are not Clock or Native (checked in 10-card-frame) still
// send their commands. A card of several lamps sends to all of them (the
// backend runs each lamp on its own and only logs the one not reached, so an
// offline lamp still gets its settings); the single-lamp Lamp Preview sends
// to the lamp it shows, the available one.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, gradient } = t;
  const CARDS = [
    {
      tag: gradient,
      service: "set_full_panel",
      config: { panel_toggle_style: "tabs" },
      send: "tab",
    },
    { tag: "yeelight-cube-draw-card", service: "apply_custom_pixels", send: "_sendToLamp" },
    { tag: "yeelight-cube-palette-card", service: "load_palette", send: "_applyPalette" },
    { tag: "yeelight-cube-color-list-editor-card", service: "set_text_colors", send: "saveColors" },
    {
      tag: "yeelight-cube-lamp-preview-card",
      service: "set_preview_adjustments",
      send: "handleEffectChange",
      single: true,
    },
  ];
  for (const { tag, service, config = {}, send, single } of CARDS) {
    const result = await page.evaluate(
      async ({ tag, service, config, send }) => {
        const saved = hass;
        hass = {
          ...saved,
          states: {
            ...saved.states,
            "light.b": { state: "unavailable", attributes: { friendly_name: "Bedroom" } },
          },
        };
        try {
          // The offline lamp first: the card must not depend on it.
          await mount(tag, { ...config, entity: "light.b", target_entities: ["light.b", "light.a"] });
          calls.length = 0;
          if (send === "tab")
            card.shadowRoot.querySelectorAll('.yc-tabs [role="tab"]')[1]?.click();
          else if (send === "_applyPalette") await card._applyPalette(0);
          else if (send === "saveColors") await card.saveColors([[0, 0, 255]]);
          else if (send === "handleEffectChange")
            await card.handleEffectChange("contrast", { target: { value: "80" } });
          else await card[send]();
          for (let wait = 0; wait < 40 && !calls.some((c) => c.service === service); wait++)
            await new Promise((resolve) => setTimeout(resolve, 25));
          const call = calls.find((c) => c.service === service);
          return {
            sent: !!call,
            entity: call?.data.entity_id ?? null,
            offlineLine: !!card.shadowRoot.querySelector(".yc-card-offline"),
          };
        } finally {
          hass = saved;
        }
      },
      { tag, service, config, send },
    );
    const name = tag.replace("yeelight-cube-", "");
    assert.deepEqual(
      result,
      {
        sent: true,
        entity: single ? "light.a" : ["light.b", "light.a"],
        offlineLine: true,
      },
      `${name}: one lamp offline, its ${service} is still sent`,
    );
  }
};
