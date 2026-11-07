// Card events check (tests/card-events-browser.cjs): each effect shows its
// family's icon (a flame for Glow, a sparkle, a music note...), never over its
// preview, with the family in its tooltip: at the end of the badge's line
// (Original), in a row at the bottom right of a preview layout's tile, after
// the favourite's name, after a chip's name, the family's emoji after the
// name in a dropdown or text button. show_family_icons turns the gallery's off,
// favourites_show_family_icons the favourites'. The Album and Wheel previews
// are animated like the others.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const original = hass.states["light.a"];
    hass.states["light.a"] = {
      ...original,
      attributes: {
        ...original.attributes,
        content_mode: "Native Effect",
        native_effect: "Fire",
        native_effect_catalog: [
          { name: "Fire", family: "glow", speed: true, directions: [], preview: true },
          { name: "Starry Sky", family: "sparkles", speed: true, directions: [], preview: true },
          { name: "Music Spectrum", family: "music", speed: false, directions: [], preview: true },
          { name: "Snowfall", family: "sparkles", speed: true, directions: [], animation: "snowfall", preview: true },
        ],
      },
    };
    const icons = (root, selector) =>
      Object.fromEntries(
        [...root.querySelectorAll(selector)].map((node) => [
          node.dataset.preview ?? node.dataset.mode,
          node.querySelector(".yc-family-icon ha-icon")?.getAttribute("icon") ?? null,
        ]),
      );
    const cells = (root, selector) =>
      [...root.querySelectorAll(selector)].map(
        (node) =>
          [...node.querySelector(".gallery-matrix-preview").children].filter(
            (child) => child.tagName === "DIV",
          ).length,
      );
    const out = {};
    for (const style of ["original", "preview-grid", "preview-strip", "preview-wheel", "preview-album"]) {
      localStorage.removeItem("yeelight_cube_effect_family");
      await mount("yeelight-cube-native-effects-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: style,
        show_favourites: true,
      });
      card._controls.save([{ key: "Fire" }, { key: "Music Spectrum" }]);
      card.requestUpdate();
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The gallery's previews (the favourites' are in their own shadow root):
      // an Original tile's preview, a preview layout's item.
      const tiles =
        "yc-collection-gallery :is(.original-item, .gallery-item, .wheel-item, [class$='-album-entry'])[data-mode]";
      out[style] = icons(card.shadowRoot, tiles);
      out[`${style} cells`] = cells(card.shadowRoot, tiles);
      out[`${style} over preview`] = card.shadowRoot.querySelectorAll(".gallery-matrix-preview .yc-family-icon").length;
      out[`${style} line`] = [...card.shadowRoot.querySelectorAll("yc-collection-gallery .yc-family-icon")].every(
        (icon) => icon.closest(".original-item-footer, .gallery-item-footer"),
      );
      // Painted on a canvas that changes as the effect runs.
      const canvases = () =>
        [...card.shadowRoot.querySelectorAll("yc-collection-gallery canvas")].map((c) => c.toDataURL()).join();
      const before = canvases();
      await new Promise((resolve) => setTimeout(resolve, 600));
      out[`${style} animated`] = before !== "" && canvases() !== before;
      out.tooltip = card.shadowRoot.querySelector("yc-collection-gallery [data-mode='Fire'] .yc-family-icon")?.title;
    }
    const favouritesRoot = [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")]
      .map((controls) => controls.shadowRoot)
      .find((root) => root?.querySelector(".favourite-name"));
    out.favourites = favouritesRoot
      ? Object.fromEntries(
          [...favouritesRoot.querySelectorAll(".favourite-name")].map((name) => [
            name.firstElementChild.textContent,
            name.querySelector(".yc-family-icon ha-icon")?.getAttribute("icon"),
          ]),
        )
      : null;
    // The text layouts: an icon after a chip's name; the family's emoji after
    // the name in a dropdown's options and a text button.
    for (const style of ["chips", "dropdown", "filled"]) {
      await mount("yeelight-cube-native-effects-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: style,
        buttons_style: "pill",
      });
      const gallery = card.shadowRoot.querySelector("yc-collection-gallery");
      out[style] =
        style === "chips"
          ? icons(gallery, ".mode-chip[data-mode]")
          : [...gallery.querySelectorAll(style === "dropdown" ? "option" : "[data-mode]")].map(
              (node) => node.textContent.trim(),
            );
      // A pill button style colors the icon, never stretches it.
      const icon = gallery.querySelector(".yc-family-icon");
      out[`${style} round`] = !icon || icon.offsetWidth === icon.offsetHeight;
    }
    // Each section has its own switch: the gallery's leaves the favourites'
    // icons, the favourites' leaves the gallery's.
    const favouriteIcons = () =>
      [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")]
        .map((controls) => controls.shadowRoot?.querySelectorAll(".yc-family-icon").length ?? 0)
        .reduce((a, b) => a + b, 0);
    for (const [key, name] of [["show_family_icons", "off"], ["favourites_show_family_icons", "favourites off"]]) {
      await mount("yeelight-cube-native-effects-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: "original",
        show_favourites: true,
        [key]: false,
      });
      card._controls.save([{ key: "Fire" }, { key: "Music Spectrum" }]);
      card.requestUpdate();
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 100));
      out[name] = {
        gallery: card.shadowRoot.querySelectorAll("yc-collection-gallery .yc-family-icon").length,
        favourites: favouriteIcons(),
      };
    }
    hass.states["light.a"] = original;
    return out;
  });
  const expected = {
    Fire: "mdi:fire",
    "Starry Sky": "mdi:creation",
    "Music Spectrum": "mdi:music-note",
    Snowfall: "mdi:creation",
  };
  for (const style of ["original", "preview-grid", "preview-strip", "preview-wheel", "preview-album"]) {
    assert.deepEqual(result[style], expected, `${style}: each preview shows its family's icon`);
    assert.ok(result[`${style} animated`], `${style}: the previews are animated`);
    assert.ok(result[`${style} cells`].every((count) => count === 100), `${style}: still 100 pixels`);
    assert.equal(result[`${style} over preview`], 0, `${style}: nothing over the preview`);
    assert.ok(result[`${style} line`], `${style}: below the preview, on the right`);
  }
  assert.deepEqual(result.chips, expected, "chips: the icon after the name");
  const named = ["Fire 🔥", "Starry Sky ✨", "Music Spectrum 🎵", "Snowfall ✨"];
  // Fire and Music Spectrum are favourites: their star before the name.
  assert.deepEqual(
    result.dropdown,
    ["★ Fire 🔥", "Starry Sky ✨", "★ Music Spectrum 🎵", "Snowfall ✨"],
    "dropdown: the family's emoji after the name",
  );
  assert.deepEqual(result.filled, named, "text buttons: the family's emoji after the name");
  for (const style of ["chips", "dropdown", "filled"])
    assert.ok(result[`${style} round`], `${style}: the icon stays round with pill buttons`);
  assert.equal(result.tooltip, "Glow: fire, clouds and soft light", "the family in the tooltip");
  assert.deepEqual(
    result.favourites,
    { "Fire (Normal)": "mdi:fire", "Music Spectrum (Normal)": "mdi:music-note" },
    "favourites show their family's icon",
  );
  assert.deepEqual(result.off, { gallery: 0, favourites: 2 }, "show_family_icons: false: the gallery's only");
  assert.deepEqual(
    result["favourites off"],
    { gallery: 4, favourites: 0 },
    "favourites_show_family_icons: false: the favourites' only",
  );
  console.log("PASS each effect shows its family's icon at the bottom right, the family in a tooltip (gallery, favourites); album and wheel previews animate");
};
