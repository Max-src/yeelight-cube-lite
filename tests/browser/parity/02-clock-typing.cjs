// Card UI parity check (tests/card-ui-parity.cjs): Clock text typing, caret
// and focus across re-renders.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

module.exports = async (t) => {
  const { browser, page } = t;
  // A brand-new card: its <ha-card> shell has never rendered a <slot>. The
  // FIRST keystroke must not blur (this is exactly what the user hit).
  const freshCard = await page.evaluate(async () => {
    const card = document.createElement("yeelight-cube-clock-card");
    card.setConfig({ ...baseConfig, show_gallery: true, show_search: true });
    card.hass = hass;
    document.body.append(card);
    await card.updateComplete;
    window.freshClock = card;
    window.freshShell = card.shadowRoot.querySelector("ha-card");
    const leaked = [];
    const listener = (event) => leaked.push(event.key);
    document.addEventListener("keydown", listener);
    window.freshCleanup = () =>
      document.removeEventListener("keydown", listener);
    window.freshLeaked = leaked;
    // Focus immediately, before ha-card's async first update resolves.
    const input = card.shadowRoot.querySelector(".yc-gallery-search");
    input.focus();
    return { focusedBeforeSlot: card.shadowRoot.activeElement === input };
  });
  const fresh = page.locator(
    "yeelight-cube-clock-card:last-of-type input.yc-gallery-search",
  );
  await fresh.click();
  await fresh.pressSequentially("tide", { delay: 25 });
  assert.deepEqual(
    await page.evaluate(() => {
      const input = freshClock.shadowRoot.querySelector(".yc-gallery-search");
      const result = {
        value: input.value,
        focused: freshClock.shadowRoot.activeElement === input,
        leaked: freshLeaked,
        shellReused:
          freshShell === freshClock.shadowRoot.querySelector("ha-card"),
      };
      freshCleanup();
      freshClock.remove();
      return result;
    }),
    { value: "tide", focused: true, leaked: [], shellReused: true },
    "first keystrokes on a freshly created card keep focus",
  );
  // Toggling the card background only switches the shared frame's look
  // (card-shell.js) and must not throw.
  await page.evaluate(async () => {
    clock.setConfig({ ...baseConfig, show_card_background: false });
    clock.hass = hass;
    await clock.updateComplete;
    if (!clock.shadowRoot.querySelector("ha-card.yc-card-plain"))
      throw Error("plain card frame not applied");
    clock.setConfig({ ...baseConfig, show_card_background: true });
    clock.hass = hass;
    await clock.updateComplete;
    if (
      !clock.shadowRoot.querySelector("ha-card.yc-card:not(.yc-card-plain)")
    )
      throw Error("card background not restored");
  });
  for (const width of [390, 1400]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async () => {
      native.style.display = "none";
      clock.style.width = "100%";
      clock.setConfig({
        ...baseConfig,
        show_gallery: true,
        show_search: true,
      });
      clock.hass = hass;
      await clock.updateComplete;
      window.searchNode = clock.shadowRoot.querySelector(".yc-gallery-search");
      window.escapedSearchKeys = [];
      window.searchListener = (event) => escapedSearchKeys.push(event.key);
      document.addEventListener("keydown", searchListener);
    });
    const search = page.locator(
      "yeelight-cube-clock-card input.yc-gallery-search",
    );
    await search.click();
    await search.fill("");
    await search.pressSequentially("Rainbow", { delay: 25 });
    assert.deepEqual(
      await page.evaluate(() => ({
        value: searchNode.value,
        same: searchNode === clock.shadowRoot.querySelector(".yc-gallery-search"),
        focused: clock.shadowRoot.activeElement === searchNode,
        names: clock._shownStyles().map((style) => style.name),
        escaped: escapedSearchKeys,
      })),
      {
        value: "Rainbow",
        same: true,
        focused: true,
        names: ["Rainbow"],
        escaped: [],
      },
    );
    await search.press("Home");
    await page.evaluate(() => {
      clock.hass = {
        ...hass,
        states: {
          ...hass.states,
          "light.a": {
            ...hass.states["light.a"],
            attributes: {
              ...hass.states["light.a"].attributes,
              clock_colon_blink: true,
            },
          },
        },
      };
    });
    await search.pressSequentially("e");
    assert.equal(await search.inputValue(), "eRainbow");
    await search.press("Backspace");
    await page.evaluate(() => {
      if (clock.shadowRoot.activeElement !== searchNode)
        throw Error("Search lost focus");
      if (escapedSearchKeys.length)
        throw Error("Search leaked keyboard events");
      document.removeEventListener("keydown", searchListener);
    });
    // User's exact setup: the Original selector with 10 items per page.
    // Typing must not render a stray "10" and a saved-preset reveal during
    // typing (the reveal branch runs inside render) must not throw and blur.
    const originalState = await page.evaluate(async () => {
      clock.setConfig({
        ...baseConfig,
        show_gallery: true,
        show_search: true,
        style_selector_style: "original",
        items_per_page: 10,
      });
      clock.hass = hass;
      await clock.updateComplete;
      const input = clock.shadowRoot.querySelector(".yc-gallery-search");
      input.focus();
      input.value = "rain";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      clock._revealSavedStyle = "Rainbow";
      clock.requestUpdate();
      await clock.updateComplete;
      // The reveal branch that previously crashed render (mangled
      // `_revealSavedStyle = null`) only runs for a SAVED style preset.
      input.value = "my sol";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      clock._revealSavedStyle = "My Solid";
      clock.requestUpdate();
      await clock.updateComplete;
      const browser = clock.shadowRoot.querySelector(".original-browser");
      return {
        focused: clock.shadowRoot.activeElement === input,
        value: input.value,
        browserText: browser?.textContent.replace(/\s+/g, " ").trim(),
        names: clock._shownStyles().map((style) => style.name),
        revealCleared: clock._revealSavedStyle === null,
      };
    });
    assert.equal(
      originalState.focused,
      true,
      "Original selector: search kept focus",
    );
    assert.equal(originalState.value, "my sol");
    assert.deepEqual(originalState.names, ["My Solid"]);
    assert.equal(
      originalState.revealCleared,
      true,
      "reveal flag reset after render",
    );
    assert.doesNotMatch(
      originalState.browserText,
      /(^|\s)10(\s|$)/,
      `stray page-size number rendered: ${originalState.browserText}`,
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), `yeelight-clock-search-${width}.png`),
    });
  }
  console.log(
    "PASS clock typing, caret and focus survive rerenders without global shortcuts (desktop/mobile)",
  );
};
