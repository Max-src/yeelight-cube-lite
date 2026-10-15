// Card events check (tests/card-events-browser.cjs): the Lamp Preview's
// adjustment sliders in every section layout. They are rendered by the shared
// <yc-sections> (section-layouts.js), or by <yc-preview-hover> inside it, so
// their handlers must still run on the card: pressing, moving and releasing
// one sends the adjustment, and a reset (the slider's own in the compact rows,
// else its category's) sends its default, without an error on the page.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, lamp, errors } = t;
  const layouts = ["side", "carousel", "tabs", "dropdown", "preview-hover", "grouped", "radial", "categories", "compact"];
  let resets = 0;
  for (const layout of layouts) {
    const before = errors.length;
    const result = await page.evaluate(
      async ({ tag, layout }) => {
        await mount(tag, {
          entity: "light.a",
          show_adjustment_controls: true,
          adjustments_layout: layout,
          reset_button_mode: "always",
        });
        calls.length = 0;
        const waitForSend = async () => {
          for (let wait = 0; wait < 40 && !calls.some((c) => c.service === "set_preview_adjustments"); wait++)
            await new Promise((resolve) => setTimeout(resolve, 25));
          return calls.find((c) => c.service === "set_preview_adjustments")?.data ?? null;
        };
        // Preview-hover renders in its own shadow root; a section opens at
        // full size on a tap.
        const hover = card.shadowRoot.querySelector("yc-preview-hover");
        hover?.shadowRoot.querySelector(".preview")?.click();
        await hover?.updateComplete;
        const root = hover?.shadowRoot ?? card.shadowRoot.querySelector("yc-sections");
        const reachable = (node) => node.getClientRects().length && !node.closest("[inert]");
        // A slider the user can reach (not in a closed, inert preview).
        const slider = [...root.querySelectorAll("input[data-effect]")].find(reachable);
        if (!slider) return { slider: false };
        const effect = slider.dataset.effect;
        const value = String(Math.round((Number(slider.min) + Number(slider.max)) / 2) + 7);
        slider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
        slider.value = value;
        slider.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        slider.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
        const sent = await waitForSend();
        const moved = Number(slider.value);
        // A reset: the slider's own (compact rows), else its category's
        // (radial has none).
        calls.length = 0;
        const reset =
          root.querySelector(`.compact-reset-button[data-effect="${effect}"]`) ||
          [...root.querySelectorAll('button[title^="Reset"]')].find(reachable);
        reset?.click();
        const resetSent = reset ? !!(await waitForSend()) : false;
        return {
          slider: true,
          effect,
          value: moved,
          sent: sent?.[effect] ?? null,
          reset: !!reset,
          resetSent,
          afterReset: Number(slider.value),
          default: Number(slider.dataset.default),
        };
      },
      { tag: lamp, layout },
    );
    const name = `lamp-preview ${layout}`;
    assert.equal(result.slider, true, `${name}: an adjustment slider is shown`);
    assert.deepEqual(errors.slice(before), [], `${name}: no error while sliding or resetting`);
    assert.equal(result.sent, result.value, `${name}: the moved ${result.effect} is sent`);
    if (!result.reset) continue;
    resets++;
    assert.equal(result.resetSent, true, `${name}: the reset is sent`);
    assert.equal(result.afterReset, result.default, `${name}: the slider shows its default again`);
  }
  assert.ok(resets >= 7, `resets checked in ${resets} layouts`);
};
