// Card events check (tests/card-events-browser.cjs): the Clock card shows each
// style's family icon like the Native Effects card (the family of the effect
// behind its digits; a solid color is Still), at the bottom right of its tile
// and after a favourite's name, the family in its tooltip. show_family_icons
// turns the gallery's off, favourites_show_family_icons the favourites'.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;
  const result = await page.evaluate(async () => {
    const original = hass.states["light.a"];
    hass.states["light.a"] = {
      ...original,
      attributes: { ...original.attributes, content_mode: "Clock" },
    };
    const galleryIcons = () =>
      Object.fromEntries(
        [...card.shadowRoot.querySelectorAll("yc-collection-gallery .gallery-item[data-mode]")].map((node) => [
          node.dataset.mode,
          node.querySelector(".gallery-item-footer .yc-family-icon")?.title ?? null,
        ]),
      );
    const favouriteIcons = () =>
      Object.fromEntries(
        [...card.shadowRoot.querySelectorAll("yeelight-mode-controls")]
          .flatMap((controls) => [...(controls.shadowRoot?.querySelectorAll(".favourite-name") ?? [])])
          .map((name) => [name.firstElementChild.textContent, name.querySelector(".yc-family-icon")?.title ?? null]),
      );
    const show = async (config) => {
      localStorage.removeItem("yeelight_cube_clock_family");
      await mount("yeelight-cube-clock-card", {
        entity: "light.a",
        show_gallery: true,
        style_selector_style: "preview-grid",
        show_favourites: true,
        ...config,
      });
      card._controls.save([{ key: "Rainbow" }, { key: "White" }]);
      card.requestUpdate();
      await card.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { gallery: galleryIcons(), favourites: favouriteIcons() };
    };
    const out = { on: await show({}) };
    out.off = await show({ show_family_icons: false });
    out.favouritesOff = await show({ favourites_show_family_icons: false });
    hass.states["light.a"] = original;
    return out;
  });
  const { gallery, favourites } = result.on;
  const titles = Object.values(gallery);
  assert.ok(titles.length > 10, "the gallery shows the styles");
  assert.ok(titles.every(Boolean), "every style shows its family's icon");
  assert.match(gallery.White, /^Still/, "a solid color is Still");
  assert.match(gallery.Waves, /^Waves/, "a style shows its effect's family");
  const names = Object.keys(favourites);
  assert.equal(names.length, 2, "two favourites");
  assert.match(favourites[names.find((name) => name.startsWith("White"))], /^Still/, "a favourite shows its family's icon");
  assert.ok(Object.values(result.off.gallery).every((title) => title === null), "show_family_icons: false: none in the gallery");
  assert.ok(Object.values(result.off.favourites).every(Boolean), "show_family_icons: false: the favourites keep theirs");
  assert.ok(Object.values(result.favouritesOff.favourites).every((title) => title === null), "favourites_show_family_icons: false: none in the favourites");
  assert.ok(Object.values(result.favouritesOff.gallery).every(Boolean), "favourites_show_family_icons: false: the gallery keeps them");
  console.log("PASS the Clock card shows each style's family icon (gallery, favourites), with its two switches");
};
