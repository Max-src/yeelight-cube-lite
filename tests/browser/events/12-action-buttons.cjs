// Card events check (tests/card-events-browser.cjs): the shared action
// button (action-button-ui.js), as the cards render it with Lit.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const { LitElement } = await import("/custom_components/yeelight_cube/www/lib/lit-all.js");
    // Renders a template the way a card does (in its own render()).
    if (!customElements.get("yc-test-template"))
      customElements.define(
        "yc-test-template",
        class extends LitElement {
          static properties = { template: { attribute: false } };
          createRenderRoot() {
            return this;
          }
          render() {
            return this.template;
          }
        },
      );
    const render = async (template, parent = document.querySelector("main")) => {
      const host = document.createElement("yc-test-template");
      host.template = template;
      parent.append(host);
      await host.updateComplete;
      return host;
    };
    const { renderActionButton, renderActionButtonGroup, renderExportImportRow } =
      await import("/custom_components/yeelight_cube/www/action-button-ui.js");
    const { actionButtonStyleChoices, actionButtonContentChoices } =
      await import("/custom_components/yeelight_cube/www/action-button-utils.js");
    const main = document.querySelector("main");
    main.replaceChildren();
    const button = async (options) =>
      (await render(renderActionButton(options))).querySelector("button");
    const looks = [];
    for (const { value: buttonStyle } of actionButtonStyleChoices)
      for (const { value: contentMode } of actionButtonContentChoices) {
        const shown = buttonStyle === "icon" ? "icon" : contentMode;
        const plain = await button({ buttonStyle, contentMode });
        const swatch = await button({ buttonStyle, contentMode, label: "Amber", swatch: "#ff8800" });
        looks.push(
          plain.getAttribute("aria-label") === "Save" &&
            plain.className.includes(`btn-style-${buttonStyle}`) &&
            !!plain.querySelector("ha-icon") === (shown !== "text") &&
            !!plain.querySelector(".btn-text") === (shown === "icon_text") &&
            // The swatch stands in for the icon.
            !swatch.querySelector("ha-icon") &&
            !!swatch.querySelector(".btn-swatch") === (shown !== "text") &&
            (shown === "text" ||
              swatch.querySelector(".btn-swatch").style.background !== "") &&
            (swatch.querySelector(".btn-text")?.textContent ?? null) ===
              (shown === "icon_text" ? "Amber" : null),
        );
      }
    const busy = await button({ swatch: "#ff8800", busy: true });
    const filled = await button({ label: "Amber", contentMode: "text", fill: "#ffffff" });
    const round = await button({ label: "Amber", contentMode: "icon", swatch: "#ff8800", swatchShape: "round" });
    const hostile = await button({ label: '<img src=x>"', icon: 'mdi:save" onclick="bad', disabled: true });
    const toggle = await button({
      selected: false,
      states: { on: { label: "12-hour", icon: "mdi:hours-12" }, off: { label: "24-hour", icon: "mdi:hours-24" } },
    });

    // A choice group: radios with one tab stop; arrows move and pick.
    const picked = [];
    await render(
      renderActionButtonGroup(
        { label: "Show", value: "date", items: [{ value: "time", label: "Time" }, { value: "date", label: "Date" }] },
        (value) => picked.push(value),
      ),
    );
    const group = main.querySelector('[role="radiogroup"]');
    const radios = [...group.querySelectorAll("button")];
    const initial = radios.map((radio) => [radio.getAttribute("role"), radio.getAttribute("aria-checked"), radio.tabIndex]);
    radios[1].focus();
    radios[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    radios[1].click(); // already chosen: nothing
    const exportRow = await render(
      renderExportImportRow({ noun: "palettes", importStatus: "success", onExport() {}, onImport() {} }),
    );
    const dark = (await button({ fill: "#101010", label: "x" })).style.getPropertyValue("--btn-ink");
    const plainPressed = (await button({ label: "Save" })).hasAttribute("aria-pressed");
    main.replaceChildren();
    return {
      looks: looks.every(Boolean) && looks.length,
      busy: !!busy.querySelector('ha-icon[icon="mdi:loading"]') && !busy.querySelector(".btn-swatch") && busy.disabled,
      fill: [filled.classList.contains("btn-fill"), filled.style.getPropertyValue("--btn-fill"), filled.style.getPropertyValue("--btn-ink")],
      dark,
      round: !!round.querySelector(".btn-swatch.btn-swatch-round"),
      hostile: [!hostile.querySelector("img"), hostile.querySelector(".btn-text").textContent, hostile.getAttribute("onclick"), hostile.disabled],
      toggle: [toggle.textContent.trim(), toggle.hasAttribute("aria-pressed"), toggle.className.includes("tool-active")],
      plainPressed,
      radios: initial,
      picked,
      focused: radios[0].tabIndex === 0 && radios[1].tabIndex === -1,
      exportRow: [...exportRow.querySelectorAll("button")].map((node) => [node.dataset.action, node.textContent.trim()]),
    };
  });
  assert.deepEqual(result, {
    looks: 18,
    busy: true,
    fill: [true, "#ffffff", "#111"],
    dark: "#fff",
    round: true,
    hostile: [true, '<img src=x>"', null, true],
    toggle: ["24-hour", false, true],
    plainPressed: false,
    radios: [["radio", "false", -1], ["radio", "true", 0]],
    picked: ["time"],
    focused: true,
    exportRow: [["export", "Export"], ["import", "Success!"]],
  });
};
