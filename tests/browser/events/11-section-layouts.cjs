// Card events check (tests/card-events-browser.cjs): the shared section
// layouts (<yc-sections>, section-layouts.js) on both cards that use them,
// Draw's color sections and the Lamp Preview's adjustment categories.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page, lamp, draw } = t;
  const CARDS = {
    [draw]: {
      key: "palette_card_mode",
      config: {
        entity: "light.a",
        show_recent_colors: true,
        show_lamp_palette: true,
        show_lamp_colors: true,
        show_image_palette: true,
        show_gallery: false,
      },
    },
    [lamp]: {
      key: "adjustments_layout",
      config: { entity: "light.a", show_adjustment_controls: true, reset_button_mode: "always" },
    },
  };
  // Each layout's control that opens the second section, and where the open
  // section shows (the shared component's markup).
  const OPEN_SECOND = {
    tabs: `(root) => root.querySelectorAll('[role="tab"]')[1].click()`,
    dropdown: `(root) => { const s = root.querySelector(".ys-dropdown-select"); s.selectedIndex = 1; s.dispatchEvent(new Event("change", { bubbles: true })); }`,
    radial: `(root) => root.querySelectorAll(".ys-radial-segment")[1].dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }))`,
    categories: `(root) => root.querySelectorAll(".ys-categories-button")[1].click()`,
    grouped: `(root) => root.querySelectorAll(".ys-grouped-header")[1].click()`,
  };
  for (const [tag, { key, config }] of Object.entries(CARDS)) {
    for (const layout of ["side", "carousel", "tabs", "dropdown", "preview-hover", "grouped", "radial", "categories", "compact"]) {
      const result = await page.evaluate(
        async ({ tag, config, open }) => {
          await mount(tag, config);
          const root = card.shadowRoot;
          const sections = root.querySelector("yc-sections");
          const shown = () =>
            root.querySelector(
              ".ys-tab-content, .ys-dropdown-content, .ys-radial-panel, .ys-categories-panel",
            )?.dataset.sectionId ??
            root.querySelector(".ys-grouped-section.expanded")?.dataset.sectionId ??
            null;
          const before = shown();
          if (open) {
            new Function(`return ${open}`)()(root);
            await sections.updateComplete;
          }
          return {
            rendered: !!sections && sections.childElementCount > 0,
            count: sections?.sections.length,
            before,
            after: shown(),
            second: sections?.sections[1]?.key,
            resets: root.querySelectorAll("yc-sections [data-section-id] button[title^='Reset'], yc-sections button[title^='Reset']").length,
          };
        },
        { tag, config: { ...config, [key]: layout }, open: OPEN_SECOND[layout] || null },
      );
      const name = `${tag.replace("yeelight-cube-", "")} ${layout}`;
      assert.ok(result.rendered, `${name}: rendered`);
      assert.ok(result.count >= 2, `${name}: its sections`);
      if (OPEN_SECOND[layout]) assert.equal(result.after, result.second, `${name}: opens the second section`);
      if (tag === lamp && layout !== "preview-hover")
        assert.ok(result.resets >= 1, `${name}: the categories' reset`);
    }
  }

  // Side by side: click-to-zoom and back; the row scrolls by dragging.
  assert.deepEqual(
    await page.evaluate(async (tag) => {
      await mount(tag, {
        entity: "light.a",
        show_recent_colors: true,
        show_lamp_palette: true,
        show_lamp_colors: true,
        show_image_palette: true,
        show_gallery: false,
        palette_card_mode: "side",
        side_card_width: 70,
        side_click_zoom: "on",
      });
      const sections = card.shadowRoot.querySelector("yc-sections");
      const row = card.shadowRoot.querySelector(".ys-side");
      const at = (x) => ({ pageX: x, clientX: x, bubbles: true, cancelable: true });
      row.dispatchEvent(new MouseEvent("mousedown", at(300)));
      row.dispatchEvent(new MouseEvent("mousemove", at(200)));
      row.dispatchEvent(new MouseEvent("mouseup", at(200)));
      const scrolled = row.scrollLeft > 0;
      row.scrollLeft = 0;
      card.shadowRoot.querySelectorAll(".ys-side-card")[1].click();
      await sections.updateComplete;
      const zoomed = card.shadowRoot.querySelector(".ys-side").classList.contains("zoom-mode");
      card.shadowRoot.querySelector(".ys-side-collapse").click();
      await sections.updateComplete;
      return {
        scrolled,
        zoomed,
        back: !card.shadowRoot.querySelector(".ys-side").classList.contains("zoom-mode"),
      };
    }, draw),
    { scrolled: true, zoomed: true, back: true },
    "side: drag-to-scroll, click-to-zoom and Show All",
  );

  // Compact (shared): Draw's sections with their headers, the Lamp
  // Preview's slider rows without (its default); the tab bar's icons and
  // compact's headers follow the card's options.
  const look = (tag, config) =>
    page.evaluate(
      async ({ tag, config }) => {
        await mount(tag, config);
        const root = card.shadowRoot;
        return {
          headers: root.querySelectorAll(".ys-compact-header").length,
          sections: root.querySelectorAll(".ys-compact-section").length,
          rows: root.querySelectorAll(".compact-slider-row").length,
          tab: root.querySelector('[role="tab"]')?.textContent.replace(/\s+/g, " ").trim() ?? null,
        };
      },
      { tag, config },
    );
  const drawConfig = CARDS[draw].config;
  const lampConfig = CARDS[lamp].config;
  assert.deepEqual(
    [
      await look(draw, { ...drawConfig, palette_card_mode: "compact" }),
      await look(draw, { ...drawConfig, palette_card_mode: "compact", colors_compact_headers: false }),
      (await look(draw, { ...drawConfig, palette_card_mode: "tabs" })).tab,
      (await look(draw, { ...drawConfig, palette_card_mode: "tabs", colors_tab_icons: true })).tab,
    ],
    [
      { headers: 4, sections: 4, rows: 0, tab: null },
      { headers: 0, sections: 4, rows: 0, tab: null },
      "Recent Colors",
      "🕘 Recent Colors",
    ],
    "draw: compact headers and tab icons follow the options",
  );
  const lampCompact = await look(lamp, { ...lampConfig, adjustments_layout: "compact" });
  const lampHeaders = await look(lamp, { ...lampConfig, adjustments_layout: "compact", adjustments_compact_headers: true });
  assert.ok(lampCompact.rows > lampCompact.sections && lampCompact.headers === 0, "lamp-preview: compact rows, no headers");
  assert.equal(lampHeaders.headers, lampHeaders.sections, "lamp-preview: compact headers when asked");
  const lampTabs = (await look(lamp, { ...lampConfig, adjustments_layout: "tabs" })).tab;
  const lampPlainTabs = (await look(lamp, { ...lampConfig, adjustments_layout: "tabs", adjustments_tab_icons: false })).tab;
  assert.ok(
    lampTabs.endsWith(` ${lampPlainTabs}`) && lampTabs !== lampPlainTabs,
    "lamp-preview: tab icons by default, off when asked",
  );

  // The Lamp Preview's former names: tabbed → tabs, grouped_section_style.
  assert.deepEqual(
    await page.evaluate(async (tag) => {
      await mount(tag, {
        entity: "light.a",
        show_adjustment_controls: true,
        adjustments_layout: "tabbed",
        grouped_section_style: "filled",
      });
      const sections = card.shadowRoot.querySelector("yc-sections");
      return [sections.layout, sections.options.style];
    }, lamp),
    ["tabs", "filled"],
    "lamp-preview: former adjustments layout and style names",
  );
};
