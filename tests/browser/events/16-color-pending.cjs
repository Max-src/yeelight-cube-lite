// Card events check (tests/card-events-browser.cjs): a color mode picked in
// the shared color-mode row (Clock and Native Effects; pending-value.js) is
// highlighted at once, while it is sent and until the lamp reports it; the
// lamp's older mode never takes it back, a new one (another dashboard) wins;
// a custom color sent meanwhile replaces it.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const CARDS = [
    { tag: "yeelight-cube-clock-card", service: "set_clock_style", attr: "clock_color_mode" },
    {
      tag: "yeelight-cube-native-effects-card",
      service: "set_native_effect",
      attr: "native_effect_color_mode",
    },
  ];
  for (const { tag, service, attr } of CARDS) {
    const result = await page.evaluate(
      async ({ tag, service, attr }) => {
        const saved = hass;
        const light = saved.states["light.a"];
        const lampIn = (mode) => ({
          ...saved,
          states: {
            ...saved.states,
            "light.a": {
              ...light,
              attributes: {
                ...light.attributes,
                native_effect_color_mode: "normal",
                native_effect_color: null,
                clock_color_mode: "normal",
                [attr]: mode,
              },
            },
          },
        });
        try {
          hass = lampIn("normal");
          await mount(tag, {
            entity: "light.a",
            target_entities: ["light.a"],
            show_color_modes: true,
            color_mode_selector: "dropdown",
          });
          const row = () => card.shadowRoot.querySelector("yeelight-color-mode");
          const modes = [...row().querySelectorAll(".colormode-select option")]
            .map((option) => option.value)
            .filter((value) => value && value !== "normal" && !value.startsWith("__") && !value.startsWith("custom"));
          if (modes.length < 2) return { modes };
          const [pick, other] = modes;
          let release;
          const held = new Promise((resolve) => (release = resolve));
          const sent = [];
          const slow = (mode) => ({
            ...lampIn(mode),
            callService: async (domain, called, data) => {
              if (called !== service) return;
              sent.push(data.color_mode);
              await held; // the lamp is slow to answer
            },
          });
          card.hass = slow("normal");
          await card.updateComplete;
          const select = row().querySelector(".colormode-select");
          select.value = pick;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
          await card.updateComplete;
          const whileSent = row().selected;
          release();
          await new Promise((resolve) => setTimeout(resolve, 30));
          card.hass = slow("normal"); // the lamp's state from before the pick
          await card.updateComplete;
          const beforeEcho = row().selected;
          card.hass = slow(other); // changed elsewhere
          await card.updateComplete;
          const after = row().selected;
          // Picked again, then a custom color is sent: the pick is dropped.
          select.value = pick;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
          const repicked = row().selected;
          if (tag.includes("clock")) card._applyColor([1, 2, 3]);
          else card._applyCustomColor([1, 2, 3]);
          const dropped = (card._pendingColorMode ?? card._pendingColor).value;
          return { modes, pick, other, sent, whileSent, beforeEcho, after, repicked, dropped };
        } finally {
          hass = saved;
        }
      },
      { tag, service, attr },
    );
    const name = tag.replace("yeelight-cube-", "");
    assert.ok(result.modes.length >= 2, `${name}: two color modes to pick`);
    assert.deepEqual(
      {
        sent: result.sent,
        whileSent: result.whileSent,
        beforeEcho: result.beforeEcho,
        after: result.after,
        repicked: result.repicked,
        dropped: result.dropped,
      },
      {
        sent: [result.pick, result.pick, "normal"], // the custom color too
        whileSent: result.pick,
        beforeEcho: result.pick,
        after: result.other,
        repicked: result.pick,
        dropped: null,
      },
      `${name}: a picked color mode shows at once and yields to a new lamp mode`,
    );
  }
};
