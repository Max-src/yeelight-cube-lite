// Card events check (tests/card-events-browser.cjs): quick picks in the
// shared gallery (Clock styles, Native effects, Gradient modes, like the
// Palette card's). While a pick is being sent the gallery and the card's
// sliders stay live: the latest pick is highlighted and pulses at once and
// wins (the ones in between are never sent), and an older pick finishing
// never takes it back.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, gradient } = t;
  const CARDS = [
    {
      tag: "yeelight-cube-clock-card",
      service: "set_clock_style",
      key: "style",
      shows: true,
      sliders: ".section-sliders",
    },
    {
      tag: "yeelight-cube-native-effects-card",
      service: "set_native_effect",
      key: "effect",
      shows: true,
      sliders: ".sliders",
      // Three effects to pick from.
      catalog: ["Rainbow", "Aurora", "Waterfall", "Spectrum"].map((name) => ({
        name,
        speed: true,
      })),
    },
    { tag: gradient, service: "set_mode", key: "mode", shows: true },
  ];
  for (const card of CARDS) {
    const result = await page.evaluate(async ({ tag, service, key, catalog, sliders }) => {
      const light = hass.states["light.a"];
      const lamp = catalog
        ? {
            ...hass,
            states: {
              ...hass.states,
              "light.a": {
                ...light,
                attributes: { ...light.attributes, native_effect_catalog: catalog },
              },
            },
          }
        : hass;
      const saved = hass;
      hass = lamp;
      await mount(tag, {
        entity: "light.a",
        target_entities: ["light.a"],
        style_selector_style: "filled",
        show_brightness: true,
      });
      hass = saved;
      const sent = [];
      let release;
      const held = new Promise((resolve) => (release = resolve));
      card.hass = {
        ...lamp,
        callService: async (domain, called, data) => {
          if (called !== service) return;
          sent.push(data[key]);
          if (sent.length === 1) await held; // the first send is slow
        },
      };
      await card.updateComplete;
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      const picks = gallery.items
        .map((item) => item.dataMode)
        .filter((mode) => mode !== gallery.active)
        .slice(0, 3);
      const pick = async (mode) => {
        gallery.querySelector(`[data-mode="${CSS.escape(mode)}"]`).click();
        await new Promise((resolve) => setTimeout(resolve, 20));
        await gallery.updateComplete;
      };
      await pick(picks[0]);
      await pick(picks[1]);
      await pick(picks[2]);
      const pulsing = [...gallery.querySelectorAll(".gc-pending")].map(
        (node) => node.dataset.mode,
      );
      // The card's sliders stay usable while the pick is sent.
      await card.updateComplete;
      const slidersEl = sliders && card.shadowRoot.querySelector(sliders);
      const slidersUsable = sliders ? !!slidersEl && !slidersEl.closest("[inert]") : null;
      release();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await card.updateComplete;
      return { picks, pulsing, sent, shown: gallery.active, slidersUsable };
    }, card);
    const name = card.tag.replace("yeelight-cube-", "");
    assert.equal(result.picks.length, 3, `${name}: three items to pick`);
    assert.deepEqual(
      {
        pulsing: result.pulsing,
        sent: result.sent,
        // A pick shows before the lamp has it: the latest one.
        ...(card.shows && { shown: result.shown }),
        ...(card.sliders && { slidersUsable: result.slidersUsable }),
      },
      {
        pulsing: [result.picks[2]],
        sent: [result.picks[0], result.picks[2]],
        ...(card.shows && { shown: result.picks[2] }),
        ...(card.sliders && { slidersUsable: true }),
      },
      `${name}: quick picks stay live and the latest wins`,
    );
  }
};
