// Card UI parity check (tests/card-ui-parity.cjs): color / save and Actions /
// slider controls across the cards.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

module.exports = async (t) => {
  const { page, errors } = t;
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.evaluate(() => {
    for (const card of [clock, native]) {
      card.setConfig(baseConfig);
      card.hass = hass;
    }
  });
  let comparisons = 0;
  for (const width of [288, 358, 560]) {
    for (const style of [
      "modern",
      "classic",
      "outline",
      "gradient",
      "icon",
      "pill",
    ]) {
      for (const content of ["icon", "text", "icon_text"]) {
        for (const preset of ["label", "filled", "name"]) {
          const result = await page.evaluate(
            async ({ width, style, content, preset }) => {
              await configure(
                {
                  buttons_style: style,
                  buttons_content_mode: content,
                  color_preset_style: preset,
                },
                width,
                [18, 52, 86],
              );
              return { clock: snapshot(clock), native: snapshot(native) };
            },
            { width, style, content, preset },
          );
          assert.deepEqual(
            result.native,
            result.clock,
            `${width}/${style}/${content}/${preset}`,
          );
          if (style === "icon")
            for (const button of [
              ...result.native.buttons,
              ...result.native.save,
            ])
              assert.equal(
                button.width,
                button.height,
                `Square icon: ${button.title}`,
              );
          comparisons++;
        }
      }
    }
    for (const shape of ["square", "rounded", "round"]) {
      const result = await page.evaluate(
        async ({ width, shape }) => {
          await configure(
            { color_mode_selector: "dropdown", color_mode_shape: shape },
            width,
            null,
          );
          return { clock: snapshot(clock), native: snapshot(native) };
        },
        { width, shape },
      );
      assert.deepEqual(
        result.native,
        result.clock,
        `dropdown ${width}/${shape}`,
      );
      comparisons++;
    }
  }
  for (const mode of ["normal", "bw", "custom:red"]) {
    for (const shape of ["square", "rounded", "circle"]) {
      const result = await page.evaluate(
        async ({ mode, shape }) => {
          const color = mode.startsWith("custom:") ? [160, 40, 40] : null;
          const palette = color ? "normal" : mode;
          hass = {
            ...hass,
            states: {
              ...hass.states,
              "light.a": {
                ...hass.states["light.a"],
                attributes: {
                  ...hass.states["light.a"].attributes,
                  native_effect_color_mode: palette,
                  clock_color_mode: palette,
                  native_effect_color: color,
                  clock_color: color ? 0x01a02828 : null,
                },
              },
            },
          };
          await configure(
            {
              buttons_style: "pill",
              buttons_content_mode: "icon_text",
              color_preset_shape: shape,
            },
            358,
            null,
          );
          clock._customPresetColor = color;
          clock.requestUpdate();
          await clock.updateComplete;
          // Selection changes update the buttons in place, so their color
          // transitions: measure the settled state.
          await Promise.all(
            [clock, native].flatMap((card) =>
              card.shadowRoot
                .getAnimations()
                .map((animation) => animation.finished),
            ),
          );
          return { clock: snapshot(clock), native: snapshot(native) };
        },
        { mode, shape },
      );
      assert.deepEqual(result.native, result.clock, `${mode}/${shape}`);
      comparisons++;
    }
  }
  for (const style of ["pill", "icon", "gradient"]) {
    await page.evaluate(
      async (style) =>
        configure(
          { buttons_style: style, buttons_content_mode: "icon_text" },
          358,
          [18, 52, 86],
        ),
      style,
    );
    await page.locator("main").screenshot({
      path: path.join(os.tmpdir(), `card-color-parity-${style}.png`),
    });
  }
  let commonComparisons = 0;
  for (const width of [288, 358, 560]) {
    for (const style of [
      "modern",
      "classic",
      "outline",
      "gradient",
      "icon",
      "pill",
    ]) {
      const controls = await page.evaluate(
        async ({ width, style }) => {
          await configure(
            {
              show_actions: true,
              actions_buttons_style: style,
              actions_buttons_content_mode: "icon_text",
            },
            width,
            null,
          );
          const result = [];
          for (const card of [clock, native]) {
            const view = card.shadowRoot.querySelector(
              'yeelight-mode-controls[area="actions"]',
            );
            await view.updateComplete;
            await Promise.all(
              [...view.shadowRoot.querySelectorAll("button")].flatMap(
                (button) =>
                  button
                    .getAnimations()
                    .map((animation) => animation.finished),
              ),
            );
            result.push(
              [...view.shadowRoot.querySelectorAll("button")]
                .filter((button) =>
                  ["Random", "Freeze effect", "Turn off"].includes(
                    button.title,
                  ),
                )
                .map(describeControl),
            );
          }
          return result;
        },
        { width, style },
      );
      assert.ok(controls[0].length >= 2);
      assert.deepEqual(controls[1], controls[0], `Actions ${width}/${style}`);
      commonComparisons++;
    }
    for (const style of [
      "slider",
      "bar",
      "wheel",
      "matrix",
      "rotary",
      "capsule",
    ]) {
      const controls = await page.evaluate(
        async ({ width, style }) => {
          await configure(
            {
              show_brightness: true,
              show_animation_speed: true,
              slider_style: style,
            },
            width,
            null,
          );
          return [clock, native].map((card) =>
            [
              ...card.shadowRoot
                .querySelector(".brightness-control-group")
                .querySelectorAll("*"),
            ].map((node) => ({
              tag: node.tagName,
              classes: node.className,
              ...describeControl(node),
            })),
          );
        },
        { width, style },
      );
      assert.deepEqual(controls[1], controls[0], `Sliders ${width}/${style}`);
      commonComparisons++;
    }
  }
  // Freeze action + configurable order/visibility, identical on both cards.
  for (const card of ["clock", "native"]) {
    const order = await page.evaluate(async (card) => {
      window[card].calls = calls;
      await configure({ show_actions: true }, 358, null);
      const view = window[card].shadowRoot.querySelector(
        'yeelight-mode-controls[area="actions"]',
      );
      await view.updateComplete;
      return [...view.shadowRoot.querySelectorAll("button")].map(
        (button) => button.title,
      );
    }, card);
    assert.ok(
      order.includes("Freeze effect"),
      `${card} shows Freeze by default`,
    );
    const before = await page.evaluate(() => calls.length);
    await page
      .locator(
        `yeelight-cube-${card === "clock" ? "clock" : "native-effects"}-card yeelight-mode-controls[area="actions"]`,
      )
      .getByRole("button", { name: "Freeze effect", exact: true })
      .click();
    await page.waitForFunction(
      (card) => window[card]._controls.frozen === true,
      card,
    );
    assert.equal(
      await page.evaluate(() => calls.at(-1).service),
      "freeze_display",
    );
    // Resume re-applies the current mode (resends the last command).
    await page
      .locator(
        `yeelight-cube-${card === "clock" ? "clock" : "native-effects"}-card yeelight-mode-controls[area="actions"]`,
      )
      .getByRole("button", { name: "Resume effect", exact: true })
      .click();
    await page.waitForFunction(
      (card) => window[card]._controls.frozen === false,
      card,
    );
    assert.ok((await page.evaluate(() => calls.length)) > before + 1);
    // Custom order/visibility drives the rendered row.
    const custom = await page.evaluate(async (card) => {
      await configure(
        { show_actions: true, action_buttons: ["power", "freeze", "random"] },
        358,
        null,
      );
      const view = window[card].shadowRoot.querySelector(
        'yeelight-mode-controls[area="actions"]',
      );
      await view.updateComplete;
      return [...view.shadowRoot.querySelectorAll("button")].map(
        (button) => button.title,
      );
    }, card);
    assert.deepEqual(custom, ["Turn off", "Freeze effect", "Random"]);
    commonComparisons++;
  }
  // Native Freeze is greyed out for effects the firmware can't freeze, and
  // freezing then switching effects resets the button to its idle state.
  const freezeGating = await page.evaluate(async () => {
    const setEffect = async (name) => {
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...hass.states["light.a"],
            attributes: {
              ...hass.states["light.a"].attributes,
              native_effect: name,
            },
          },
        },
      };
      native._selected = null;
      native.hass = hass;
      await native.updateComplete;
      const view = native.shadowRoot.querySelector(
        'yeelight-mode-controls[area="actions"]',
      );
      await view.updateComplete;
      return view.shadowRoot.querySelector(
        'button[title="Freeze effect"], button[title="Resume effect"]',
      );
    };
    await configure({ show_actions: true }, 358, null);
    // "Starry sky" is not freeze-compatible -> disabled.
    const incompatible = (await setEffect("Starry sky")).disabled;
    // "Rainbow" is compatible -> enabled and freezable.
    const compatible = (await setEffect("Rainbow")).disabled;
    await native._controls.freeze();
    const frozen = native._controls.frozen;
    // Selecting another (compatible) effect from the grid resumes.
    native._selected = "Tide";
    native._controls.update();
    const afterSwitch = native._controls.frozen;
    return { incompatible, compatible, frozen, afterSwitch };
  });
  assert.equal(
    freezeGating.incompatible,
    true,
    "incompatible freeze disabled",
  );
  assert.equal(freezeGating.compatible, false, "compatible freeze enabled");
  assert.equal(freezeGating.frozen, true, "freeze engaged for Rainbow");
  assert.equal(
    freezeGating.afterSwitch,
    false,
    "switching effects resets freeze",
  );
  commonComparisons++;
  // The clock card applies the same gating by its current style's name.
  const clockGating = await page.evaluate(async () => {
    const setStyle = async (name, id) => {
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...hass.states["light.a"],
            attributes: {
              ...hass.states["light.a"].attributes,
              clock_style: name,
              clock_style_id: id,
            },
          },
        },
      };
      clock.setConfig({ ...baseConfig, show_actions: true });
      clock.hass = hass;
      clock.requestUpdate();
      await clock.updateComplete;
      const view = clock.shadowRoot.querySelector(
        'yeelight-mode-controls[area="actions"]',
      );
      await view.updateComplete;
      return view.shadowRoot.querySelector(
        'button[title="Freeze effect"], button[title="Resume effect"]',
      );
    };
    // "Yellow" (solid style) is not freeze-compatible -> disabled.
    const solid = (await setStyle("Yellow", 6)).disabled;
    // "Rainbow" clock style is freeze-compatible -> enabled.
    const animated = (await setStyle("Rainbow", 1)).disabled;
    return { solid, animated };
  });
  assert.equal(clockGating.solid, true, "solid clock style freeze disabled");
  assert.equal(
    clockGating.animated,
    false,
    "animated clock style freeze enabled",
  );
  commonComparisons++;
  // Previews mirror the frozen lamp: the clock holds its background phase but
  // keeps repainting (time stays live); the native effect holds its frame.
  const previewFreeze = await page.evaluate(async () => {
    await configure({ show_actions: true }, 358, null);
    // Clock: frozen holds the animation phase across repaints, then resumes.
    clock._controls.frozen = true;
    const phase0 = clock._phaseAccum;
    let paints = 0;
    const originalPaint = clock._paintPreview.bind(clock);
    clock._visible = new Set(["a", "b"]);
    clock._paintPreview = () => {
      paints++;
    };
    clock._paintVisible();
    clock._paintVisible();
    const frozenHeld = clock._phaseAccum === phase0 && paints > 0;
    clock._paintPreview = originalPaint;
    clock._visible = new Set();
    clock._controls.frozen = false;
    clock._lastPhaseTs = Date.now() - 1000;
    clock._advancePhase();
    const clockResumes = clock._phaseAccum > phase0;

    // Native: elapsed holds while frozen, advances once resumed.
    const wait = () => new Promise((r) => setTimeout(r, 160));
    if (native._visibility) native._visibility.onScreen = true;
    native._paused = false;
    native._controls.frozen = false;
    const e0 = native._elapsed;
    await wait();
    const nativeAdvances = native._elapsed > e0;
    native._controls.frozen = true;
    const e1 = native._elapsed;
    await wait();
    const nativeHeld = native._elapsed === e1;
    native._controls.frozen = false;
    return {
      frozenHeld,
      clockResumes,
      nativeAdvances,
      nativeHeld,
    };
  });
  assert.ok(
    previewFreeze.frozenHeld,
    "clock holds its phase yet keeps repainting when frozen",
  );
  assert.ok(previewFreeze.clockResumes, "clock phase resumes after unfreeze");
  assert.ok(
    previewFreeze.nativeAdvances,
    "native preview animates when not frozen",
  );
  assert.ok(previewFreeze.nativeHeld, "native preview holds when frozen");
  commonComparisons++;
  await page.evaluate(async () =>
    configure({ buttons_style: "icon" }, 358, [18, 52, 86]),
  );
  assert.ok(
    await page.evaluate(async () => {
      const manager = native.shadowRoot.querySelector(
        "yeelight-clock-preset-manager",
      );
      const button = manager.shadowRoot.querySelector("button");
      for (const color of [null, [1, 2, 3], [18, 52, 86]]) {
        hass = {
          ...hass,
          states: {
            ...hass.states,
            "light.a": {
              ...hass.states["light.a"],
              attributes: {
                ...hass.states["light.a"].attributes,
                native_effect_color: color,
              },
            },
          },
        };
        native.hass = hass;
        await native.updateComplete;
        await manager.updateComplete;
        if (
          !button.isConnected ||
          native.shadowRoot.querySelector("yeelight-clock-preset-manager") !==
            manager ||
          manager.shadowRoot.querySelector("button") !== button
        )
          return false;
      }
      return true;
    }),
    "Icon save trigger must retain its DOM identity across state echoes",
  );
  const nativeManager = page.locator(
    "yeelight-cube-native-effects-card yeelight-clock-preset-manager",
  );
  await nativeManager
    .getByRole("button", { name: "Save color mode", exact: true })
    .click();
  await nativeManager.locator('input[type="text"]').fill("Keep my draft");
  const stable = await page.evaluate(async () => {
    const manager = native.shadowRoot.querySelector(
      "yeelight-clock-preset-manager",
    );
    const input = manager.shadowRoot.querySelector('input[type="text"]');
    for (const color of [null, [1, 2, 3], [18, 52, 86], [4, 5, 6]]) {
      hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...hass.states["light.a"],
            attributes: {
              ...hass.states["light.a"].attributes,
              native_effect_color: color,
            },
          },
        },
      };
      native.hass = hass;
      await native.updateComplete;
      if (
        native.shadowRoot.querySelector("yeelight-clock-preset-manager") !==
          manager ||
        !manager.editing ||
        manager.shadowRoot.querySelector('input[type="text"]') !== input ||
        input.value !== "Keep my draft"
      )
        return false;
    }
    return true;
  });
  assert.ok(
    stable,
    "State echoes must not remove or reset the open save form",
  );
  await nativeManager
    .getByRole("button", { name: "Save", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => calls.at(-1).data.name),
    "Keep my draft",
  );
  assert.equal(
    await page.evaluate(() => calls.at(-1).data.kind),
    "color_mode",
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${comparisons} color/save and ${commonComparisons} Actions/slider comparisons; stable Icon save trigger and form across delayed state echoes; successful save.`,
  );
};
