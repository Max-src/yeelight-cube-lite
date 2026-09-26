/**
 * OPTION 2 — Custom-card POC: `yeelight-cube-control-card-poc`
 *
 * A single card that groups the Cube controls into titled sections and
 * shows ONLY the section matching the current content mode (Matrix / Clock /
 * Native Effect). Sections appear/disappear as you switch modes — no greying.
 *
 * Unlike the YAML option, you only give it ONE entity (the content-mode
 * select); it derives all the other entity ids from that prefix.
 *
 * HOW TO TRY (POC — not auto-registered so it won't affect other users):
 *   1) Settings -> Dashboards -> (3-dot menu) -> Resources -> Add resource
 *        URL:  /yeelight_cube/yeelight-cube-control-card-poc.js
 *        Type: JavaScript module
 *   2) Add a card -> Manual, and paste:
 *        type: custom:yeelight-cube-control-card-poc
 *        content_mode_entity: select.cubelite_fc02_content_mode
 *        light_entity: light.cubelite_fc02        # optional
 *        title: CubeLite fc02                      # optional
 */
class YeelightCubeControlCardPoc extends HTMLElement {
  setConfig(config) {
    if (!config.content_mode_entity) {
      throw new Error(
        "content_mode_entity is required (e.g. select.cubelite_fc02_content_mode)",
      );
    }
    this._config = config;
    this._signature = null;
    this._cardEl = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  async _render() {
    const hass = this._hass;
    if (!hass) return;

    const cmEntity = this._config.content_mode_entity;
    const prefix = cmEntity
      .replace(/^select\./, "")
      .replace(/_content_mode$/, "");
    const sel = (s) => `select.${prefix}_${s}`;
    const num = (s) => `number.${prefix}_${s}`;
    const txt = (s) => `text.${prefix}_${s}`;

    const mode = hass.states[cmEntity] && hass.states[cmEntity].state;

    // Section definitions. `match` undefined => always shown (common).
    const groups = [
      {
        title: this._config.title || "Cube Controls",
        entities: [
          this._config.light_entity,
          cmEntity,
          sel("device_orientation"),
        ],
      },
      {
        match: "Matrix",
        title: "Matrix",
        entities: [
          sel("display_mode"),
          txt("display_text"),
          sel("font"),
          num("gradient_angle"),
          sel("palette"),
          sel("pixel_art"),
          sel("text_alignment"),
        ],
      },
      {
        match: "Clock",
        title: "Clock",
        entities: [sel("clock_content"), sel("clock_style")],
      },
      {
        match: "Native Effect",
        title: "Native Effect",
        entities: [
          sel("native_effect"),
          num("native_effect_speed"),
          sel("native_effect_direction"),
        ],
      },
    ];

    const visible = groups.filter((g) => !g.match || g.match === mode);
    const cards = visible
      .map((g) => ({
        type: "entities",
        title: g.title,
        entities: (g.entities || []).filter((e) => e && hass.states[e]),
      }))
      .filter((c) => c.entities.length);

    if (!this._helpers) {
      this._helpers = await window.loadCardHelpers();
    }

    // Only rebuild the DOM when the set of visible sections changes; otherwise
    // just push the fresh hass so values stay live.
    const signature = JSON.stringify(cards.map((c) => [c.title, c.entities]));
    if (signature !== this._signature) {
      this._signature = signature;
      this._cardEl = this._helpers.createCardElement({
        type: "vertical-stack",
        cards,
      });
      this.innerHTML = "";
      this.appendChild(this._cardEl);
    }
    this._cardEl.hass = hass;
  }

  getCardSize() {
    return 8;
  }
}

customElements.define(
  "yeelight-cube-control-card-poc",
  YeelightCubeControlCardPoc,
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "yeelight-cube-control-card-poc",
  name: "Yeelight Cube Control Card (POC)",
  description: "POC: mode-grouped, auto-hiding controls for the Yeelight Cube.",
});
