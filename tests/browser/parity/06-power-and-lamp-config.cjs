// Card UI parity check (tests/card-ui-parity.cjs): shared Refresh / Power,
// pending / error / off states, Lamp configuration.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

module.exports = async (t) => {
  const { page, errors } = t;
  await page.evaluate(async () => {
    await import("/custom_components/yeelight_cube/www/yeelight-cube-lamp-preview-card-editor.js");
    const { LitElement, html } = await import("/custom_components/yeelight_cube/www/lib/lit-all.js");
    // The reference buttons, rendered the way a card does.
    customElements.define(
      "yc-reference-buttons",
      class extends LitElement {
        static properties = { buttons: { attribute: false } };
        createRenderRoot() {
          return this;
        }
        render() {
          return html`${this.buttons.map(renderActionButton)}`;
        }
      },
    );
    const { renderActionButton } =
      await import("/custom_components/yeelight_cube/www/action-button-ui.js");
    const check = (condition, message) => {
      if (!condition) throw Error(message);
    };
    const settle = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    };
    const section = document.createElement("section");
    section.id = "shared-action-regressions";
    section.style.cssText = "display:grid;gap:16px;max-width:420px";
    document.body.append(section);
    for (const kind of ["lamp-preview", "clock", "native-effects"]) {
      const serviceCalls = [];
      let finish;
      let fail;
      const state = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            state: "on",
            attributes: {
              ...hass.states["light.a"].attributes,
              content_mode: kind === "clock" ? "Clock" : "Native Effect",
              matrix_colors: Array.from({ length: 100 }, () => [20, 80, 160]),
            },
          },
        },
        callService: (domain, service, data) => {
          serviceCalls.push({ domain, service, data });
          return new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          });
        },
      };
      const card = document.createElement(`yeelight-cube-${kind}-card`);
      const config = {
        ...baseConfig,
        show_actions: true,
        show_lamp_preview: false,
        show_brightness_slider: false,
        action_buttons: ["refresh", "power"],
        actions_buttons_style: "outline",
        actions_buttons_content_mode: "icon_text",
      };
      card.setConfig(config);
      card.hass = state;
      section.append(card);
      await settle();
      const view = card.shadowRoot.querySelector(
        'yeelight-mode-controls[area="actions"]',
      );
      check(view, `${kind}: shared Actions missing`);
      await view.updateComplete;
      const buttons = () => [...view.shadowRoot.querySelectorAll("button")];
      check(
        buttons()
          .map((button) => button.title)
          .join() === "Refresh,Turn off",
        `${kind}: action labels/order`,
      );
      buttons()[0].click();
      await settle();
      check(
        serviceCalls.length === 1 &&
          serviceCalls[0].service === "force_refresh",
        `${kind}: refresh service only`,
      );
      check(
        serviceCalls[0].domain === "yeelight_cube" &&
          [serviceCalls[0].data.entity_id].flat().includes("light.a"),
        `${kind}: refresh target`,
      );
      check(
        buttons()[0].getAttribute("aria-busy") === "true" &&
          buttons().every((button) => button.disabled),
        `${kind}: pending refresh`,
      );
      card.hass = { ...state };
      await settle();
      check(
        buttons()[0].getAttribute("aria-busy") === "true",
        `${kind}: pending survives state update`,
      );
      fail(Error("Test offline"));
      await settle();
      check(
        view.shadowRoot.querySelector('[role="alert"]'),
        `${kind}: refresh error visible`,
      );
      buttons()[0].click();
      await settle();
      finish();
      await settle();
      check(
        !view.shadowRoot.querySelector('[role="alert"]'),
        `${kind}: successful retry clears error`,
      );
      buttons()[1].click();
      await settle();
      check(
        serviceCalls.at(-1).service === "turn_off" &&
          serviceCalls.at(-1).domain === "light",
        `${kind}: explicit power off`,
      );
      check(
        buttons()[1].getAttribute("aria-busy") === "true",
        `${kind}: power spinner`,
      );
      finish();
      await settle();
      const off = {
        ...state,
        states: {
          ...state.states,
          "light.a": { ...state.states["light.a"], state: "off" },
        },
      };
      card.hass = off;
      await settle();
      check(
        buttons()[0].disabled && !buttons()[1].disabled,
        `${kind}: off state actions`,
      );
      buttons()[1].click();
      await settle();
      check(
        serviceCalls.at(-1).service === "turn_on",
        `${kind}: explicit power on`,
      );
      finish();
      await settle();
      card.hass = state;
      await settle();
      if (kind === "lamp-preview") {
        for (const content_mode of [
          "Clock",
          "Native Effect",
          "Text",
          "Solid Color",
        ]) {
          card.hass = {
            ...state,
            states: {
              ...state.states,
              "light.a": {
                ...state.states["light.a"],
                attributes: {
                  ...state.states["light.a"].attributes,
                  content_mode,
                },
              },
            },
          };
          await settle();
          check(
            buttons().length === 2 &&
              buttons().every((button) => !button.disabled),
            `Lamp ${content_mode}: relevant actions`,
          );
        }
        card.setConfig({
          ...config,
          action_buttons: ["power", "freeze", "random", "refresh"],
        });
        await settle();
        const remounted = card.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await remounted.updateComplete;
        check(
          [...remounted.shadowRoot.querySelectorAll("button")]
            .map((button) => button.title)
            .join() === "Turn off,Refresh",
          "Lamp filters unsupported actions",
        );
        card.setConfig({
          ...config,
          actions_buttons_style: "gradient",
          action_buttons: ["refresh", "power"],
        });
        await settle();
        const gradient = card.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await gradient.updateComplete;
        const row = gradient.shadowRoot.querySelector(".action-row");
        check(
          getComputedStyle(row).justifyContent === "center",
          "Lamp actions row is centred",
        );
        const [refreshBtn, powerBtn] = [
          ...gradient.shadowRoot.querySelectorAll("button"),
        ];
        check(
          refreshBtn.classList.contains("force-refresh-btn") &&
            powerBtn.classList.contains("power-btn"),
          "Actions reuse existing semantic button styles",
        );
        const accentOf = (button) => getComputedStyle(button).backgroundImage;
        check(
          accentOf(refreshBtn) !== accentOf(powerBtn) &&
            accentOf(refreshBtn).includes("gradient"),
          "Refresh and Power use distinct accent colors",
        );
        card.setConfig({
          ...config,
          actions_buttons_style: "outline",
          action_buttons: ["refresh", "power"],
        });
        await settle();
        const outline = card.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        );
        await outline.updateComplete;
        check(
          [...outline.shadowRoot.querySelectorAll("button")].every(
            (button) =>
              !getComputedStyle(button).backgroundImage.includes("gradient"),
          ),
          "Outline style keeps its neutral look",
        );
      }
      for (const theme of ["light", "dark"]) {
        card.style.setProperty(
          "--card-background-color",
          theme === "light" ? "#ffffff" : "#202020",
        );
        card.style.setProperty(
          "--primary-text-color",
          theme === "light" ? "#333333" : "#eeeeee",
        );
        card.style.setProperty(
          "--primary-color",
          theme === "light" ? "#2984ae" : "#78bce0",
        );
        for (const buttonStyle of [
          "modern",
          "classic",
          "outline",
          "gradient",
          "icon",
          "pill",
        ]) {
          for (const contentMode of ["icon", "text", "icon_text"]) {
            card.setConfig({
              ...config,
              action_buttons:
                kind === "lamp-preview"
                  ? ["refresh", "power"]
                  : [
                      "previous",
                      "next",
                      "random",
                      "freeze",
                      "refresh",
                      "power",
                    ],
              actions_buttons_style: buttonStyle,
              actions_buttons_content_mode: contentMode,
            });
            await settle();
            const controls = card.shadowRoot.querySelector(
              'yeelight-mode-controls[area="actions"]',
            );
            await controls.updateComplete;
            const row = controls.shadowRoot.querySelector(".action-row");
            check(
              getComputedStyle(row).justifyContent === "center" &&
                parseFloat(getComputedStyle(row).marginBottom) === 0 &&
                parseFloat(getComputedStyle(row).marginTop) === 0,
              `${kind}/${buttonStyle}/${contentMode}: centered without external margins`,
            );
            checkCardSpacing(card);
            const actual = [...row.querySelectorAll("button")];
            const actions =
              kind === "lamp-preview"
                ? ["force-refresh", "power"]
                : [
                    "tool",
                    "tool",
                    "randomize",
                    "tool",
                    "force-refresh",
                    "power",
                  ];
            const reference = document.createElement("yc-reference-buttons");
            reference.style.cssText =
              "position:absolute;visibility:hidden;pointer-events:none";
            reference.buttons = actions.map((action) => ({
              action,
              buttonStyle,
              contentMode,
            }));
            controls.shadowRoot.append(reference);
            await reference.updateComplete;
            const references = reference.querySelectorAll("button");
            for (const [index, button] of actual.entries()) {
              button.style.transition = "none";
              const expected = getComputedStyle(references[index]);
              const current = getComputedStyle(button);
              for (const property of [
                "backgroundColor",
                "backgroundImage",
                "color",
              ]) {
                check(
                  current[property] === expected[property],
                  `${kind}/${theme}/${buttonStyle}/${contentMode}/${actions[index]}: shared ${property}`,
                );
              }
            }
            if (buttonStyle === "icon") {
              const widths = actual.map(
                (button) => button.getBoundingClientRect().width,
              );
              check(
                widths.every((width) => Math.abs(width - widths[0]) < 0.5),
                `${kind}/${theme}/${contentMode}: Icon style buttons are a uniform size (got ${widths.join(",")})`,
              );
            }
            reference.remove();
          }
        }
      }
      card.style.removeProperty("--card-background-color");
      card.style.removeProperty("--primary-text-color");
      card.style.removeProperty("--primary-color");
    }
    {
      const gapCard = document.createElement(
        "yeelight-cube-lamp-preview-card",
      );
      gapCard.setConfig({
        entity: "light.a",
        show_lamp_preview: false,
        show_actions: false,
        show_device_orientation: false,
        show_brightness_slider: true,
        show_adjustment_controls: true,
      });
      gapCard.hass = hass;
      section.append(gapCard);
      await settle();
      const gapBetween = () => {
        const container = gapCard.shadowRoot.querySelector(
          ".brightness-control-group",
        );
        const adjustments = gapCard.shadowRoot.querySelector(
          ".ys-grouped",
        );
        return (
          adjustments.getBoundingClientRect().top -
          container.getBoundingClientRect().bottom
        );
      };
      for (const style of [
        "slider",
        "bar",
        "wheel",
        "matrix",
        "rotary",
        "capsule",
      ]) {
        for (const theme of ["subtle", "flat"]) {
          gapCard.setConfig({
            ...gapCard.config,
            brightness_slider_style: style,
            brightness_theme: theme,
          });
          await settle();
          const gap = gapBetween();
          check(
            Math.abs(gap - 16) < 0.5,
            `Lamp ${style}/${theme}: parent-owned section gap, got ${gap}px`,
          );
          checkCardSpacing(gapCard);
        }
      }
      gapCard.setConfig({
        ...gapCard.config,
        show_actions: true,
        action_buttons: [],
        show_device_orientation: true,
        orientation_buttons: [],
      });
      await settle();
      check(
        gapCard.shadowRoot.querySelector(
          'yeelight-mode-controls[area="actions"]',
        ).hidden,
        "Empty Actions must not leave a stack slot",
      );
      check(
        Math.abs(gapBetween() - 16) < 0.5,
        "Hidden Actions and Orientation must not change the section gap",
      );
      gapCard.remove();
    }
    const editor = document.createElement(
      "yeelight-cube-lamp-preview-card-editor",
    );
    editor.setConfig({
      entity: "light.a",
      show_power_toggle: false,
      buttons_content_mode: "text",
    });
    editor.hass = hass;
    section.append(editor);
    editor._lampControlOpen = true;
    await editor.updateComplete;
    check(
      editor.getConfig().action_buttons.join() === "refresh",
      "Lamp editor migrates visibility",
    );
    const actionSection = [
      ...editor.shadowRoot.querySelectorAll(".editor-card"),
    ].find(
      (node) =>
        node.querySelector(".editor-card-header")?.textContent.trim() ===
        "Actions",
    );
    check(
      actionSection?.textContent.includes("Actions & Order") &&
        actionSection.textContent.includes("Button Settings"),
      "Lamp shared action settings",
    );
    check(
      !actionSection.textContent.includes("Freeze display") &&
        !actionSection.textContent.includes("Previous"),
      "Lamp editor excludes catalogue actions",
    );
    window.sharedActionCards = [...section.children];
  });
  for (const width of [1400, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async () => {
      for (const card of sharedActionCards.filter(
        (card) => !card.localName.endsWith("editor"),
      )) {
        for (const gap of [16, 24]) {
          card.style.setProperty("--yc-section-gap", `${gap}px`);
          card.style.setProperty("--yc-control-gap", `${gap / 2}px`);
          await new Promise(requestAnimationFrame);
          checkCardSpacing(card);
        }
        card.style.removeProperty("--yc-section-gap");
        card.style.removeProperty("--yc-control-gap");
      }
    });
    await page.locator("#shared-action-regressions").screenshot({
      path: path.join(os.tmpdir(), `yeelight-shared-actions-${width}.png`),
    });
  }
  await page.evaluate(async () => {
    for (const card of sharedActionCards.filter(
      (card) => !card.localName.endsWith("editor"),
    )) {
      card.setConfig({
        ...card.config,
        show_actions: false,
        show_device_orientation: false,
        show_favourites: false,
        show_rotation: false,
      });
      await card.updateComplete;
      await new Promise(requestAnimationFrame);
      for (const controls of card.shadowRoot.querySelectorAll(
        "yeelight-mode-controls",
      )) {
        await controls.updateComplete;
        if (!controls.hidden)
          throw Error(
            `${card.localName}: disabled ${controls.area} still reserves space`,
          );
      }
    }
    sharedActionCards.forEach((card) => card.remove());
    document.querySelector("#shared-action-regressions").remove();
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS shared Refresh/Power dispatch, pending/error/off states and Lamp configuration across all three cards (desktop/mobile)",
  );
};
