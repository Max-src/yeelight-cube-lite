// Card events check (tests/card-events-browser.cjs): narrow cards: nothing
// wider than the card; arrows keep their tint.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  // --- Narrow cards: nothing wider than the card; arrows keep their tint ---
  // (a theme's --card-background-color can differ from the card's own).
  const narrow = await page.evaluate(async () => {
    const main = document.querySelector("main");
    const saved = main.style.cssText;
    main.style.cssText = "width:320px;--card-background-color:#1b2a4e";
    const results = {};
    for (const [tag, extra] of [
      ["yeelight-cube-palette-card", { palette_sensor: "sensor.pal" }],
      ["yeelight-cube-draw-card", { pixelart_sensor: "sensor.pixel" }],
    ])
      for (const style of [
        "preview-grid",
        "preview-album",
        "preview-carousel",
        "preview-wheel",
        "dropdown",
      ]) {
        await mount(tag, {
          entity: "light.a",
          ...extra,
          style_selector_style: style,
          preview_size: 100,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const width = card.getBoundingClientRect().width;
        const gallery = card.shadowRoot.querySelector(
          "yc-collection-gallery",
        );
        const arrow = gallery.querySelector(
          ".carousel-nav-btn, .album-nav-btn, .wheel-nav-buttons button",
        );
        results[`${tag.split("-")[2]} ${style}`] = {
          wide: [
            ...gallery.querySelectorAll(
              ".gallery-item, .collection-album-item, .wheel-item",
            ),
          ].filter((node) => node.getBoundingClientRect().width > width + 1)
            .length,
          arrow: arrow ? getComputedStyle(arrow).backgroundColor : "",
          prompt:
            gallery.querySelector(".mode-select option[disabled]")
              ?.textContent || "",
          selected: gallery.querySelector(".mode-select")?.value || "",
        };
      }
    main.style.cssText = saved;
    return results;
  });
  for (const [view, look] of Object.entries(narrow)) {
    assert.equal(look.wide, 0, `${view}: an item wider than the card`);
    if (/carousel|album|wheel/.test(view)) {
      assert.ok(look.arrow, `${view}: arrows`);
      assert.notEqual(
        look.arrow,
        "rgb(27, 42, 78)",
        `${view}: arrows take the theme's card color`,
      );
    }
    // Palette: the lamp shows the first palette's colors (the active one,
    // selected); Draw: the canvas holds no pixel art (a prompt).
    if (view === "palette dropdown")
      assert.deepEqual([look.prompt, look.selected], ["", "palette:0"], view);
    if (view === "draw dropdown")
      assert.deepEqual([look.prompt, look.selected], ["Choose…", ""], view);
  }
};
