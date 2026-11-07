// Card events check (tests/card-events-browser.cjs): a new Lamp mounted never
// shows a preview in the old layout, nor a clock on the old mount profile in
// the new orientation. The
// Clock card turns its previews when a pick is sent, with the profile the lamp
// is about to run; the Lamp Preview card follows the profile the light
// publishes while it writes it (mount_profile.pending). Every frame, from the
// pick to the lamp's answer, lights the digits it settles on (a Rainbow clock,
// lit everywhere; from Right to Left the two half turns cancel out: the time
// reads as before).
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const original = hass.states["light.a"];
    const lamp = (attributes) => {
      hass.states["light.a"] = {
        ...original,
        state: "on",
        attributes: {
          ...original.attributes,
          content_mode: "Clock",
          clock_style_id: 1, // Rainbow: animated, every digit lit
          clock_style: "Rainbow",
          clock_colon_blink: false,
          matter: { node_id: 6, commands: "matter" },
          ...attributes,
        },
      };
      card.hass = { ...hass, states: { ...hass.states } };
    };
    // Which pixels are lit (the digits), whatever the animated colors; a
    // preview painted on a canvas is read from it.
    const cells = (root) => {
      const canvas = root.querySelector(".gallery-matrix-preview canvas");
      if (canvas) {
        const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
        return Array.from({ length: canvas.width * canvas.height }, (_, i) =>
          data[4 * i] + data[4 * i + 1] + data[4 * i + 2] > 30 ? 1 : 0,
        ).join("");
      }
      return [...root.querySelectorAll(".gallery-matrix-preview > div, .lamp-dot")]
        .map((cell) => {
          const [r, g, b] = (getComputedStyle(cell).backgroundColor.match(/\d+/g) || []).map(Number);
          return r + g + b > 30 ? 1 : 0;
        })
        .join("");
    };
    const frames = async (snap, count = 4) => {
      const out = [];
      for (let k = 0; k < count; k++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        out.push(snap());
      }
      return out;
    };
    const upright = { device_orientation: "right", mount_profile: { profile: 2, source: "matter", in_use: 2 } };
    const turned = { device_orientation: "left", mount_profile: { profile: 0, source: "matter", in_use: 0 } };
    const out = {};

    // Clock card: the pick is sent and pending, then the lamp answers.
    await mount("yeelight-cube-clock-card", { entity: "light.a", show_gallery: false });
    lamp(upright);
    await card.updateComplete;
    const preview = () => cells(card.shadowRoot.querySelector(".current-preview"));
    const before = preview();
    card._controls.orient("left");
    await card.updateComplete;
    const pending = await frames(preview, 8);
    lamp(turned);
    await card.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settled = preview();
    out.clock = { changed: before !== settled, steady: pending.every((frame) => frame === settled) };

    // Lamp Preview card: the light publishes the new orientation with the
    // profile it is writing, then the profile the lamp runs.
    await mount("yeelight-cube-lamp-preview-card", { entity: "light.a" });
    lamp(upright);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const lampPreview = () => cells(card.shadowRoot);
    const start = lampPreview();
    lamp({ ...upright, device_orientation: "left", mount_profile: { ...upright.mount_profile, pending: 0 } });
    const writing = await frames(lampPreview);
    lamp(turned);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const done = lampPreview();
    out.lamp = { changed: start !== done, steady: writing.every((frame) => frame === done) };

    // Native Effects card, Right to Down: while the pick is sent the preview
    // already stands on its end, never the turned picture in the old layout
    // (a still effect: every frame is the one it settles on).
    hass.states["light.a"] = {
      ...original,
      state: "on",
      attributes: {
        ...original.attributes,
        content_mode: "Native Effect",
        native_effect: "Spectrum",
        native_effect_catalog: [{ name: "Spectrum", family: "still", speed: false, directions: [], preview: true }],
        device_orientation: "right",
        matter: { node_id: 6, commands: "matter" },
      },
    };
    await mount("yeelight-cube-native-effects-card", { entity: "light.a", show_gallery: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const effect = () => {
      const grid = card.shadowRoot.querySelector(".current-matrix .gallery-matrix-preview");
      const canvas = grid?.querySelector("canvas");
      if (!canvas) return "none";
      return `${grid.dataset.vertical || "landscape"}:${canvas.width}x${canvas.height}:${Array.from(
        canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data,
      ).join(",")}`;
    };
    card._controls.orient("down");
    const picked = await frames(effect, 8);
    hass.states["light.a"] = {
      ...hass.states["light.a"],
      attributes: { ...hass.states["light.a"].attributes, device_orientation: "down" },
    };
    card.hass = { ...hass, states: { ...hass.states } };
    await new Promise((resolve) => setTimeout(resolve, 300));
    const standing = effect();
    out.native = { vertical: standing.startsWith("true"), steady: picked.every((frame) => frame === standing) };

    hass.states["light.a"] = original;
    return out;
  });
  assert.ok(result.clock.steady, "Clock card: no frame shows the old profile in the new orientation");
  assert.ok(result.lamp.steady, "Lamp Preview: no frame shows the old profile in the new orientation");
  assert.ok(result.native.vertical, "Native Effects: the preview stands on its end for Down");
  assert.ok(result.native.steady, "Native Effects: never the turned picture in the old layout");
  console.log("PASS a new Lamp mounted never shows a preview in the old layout or the old profile (Clock card, Lamp Preview, Native Effects)");
};
