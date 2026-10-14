// The Draw card's color sections (recent / lamp palette / lamp colors /
// drawing colors) in the shared section layouts (<yc-sections>,
// section-layouts.js). Mixed into YeelightCubeDrawCard.
import { html } from "./lib/lit-all.js";
import "./yc-swatches.js";
import "./section-layouts.js";

export const PaletteCardsMixin = (Base) => class extends Base {
  _renderPaletteCards(
    cfg,
    showRecentColors,
    showLampPalette,
    showLampColors,
    showImagePalette,
  ) {
    // Every section's colors: the shared swatches, picking the draw color.
    const layout = cfg.swatch_layout || "row";
    const swatches = (palette, weights) => html`<yc-swatches
      .colors=${palette}
      .weights=${weights ? palette.map((color) => weights.get(color)) : undefined}
      .active=${this.selectedColor}
      .onSelect=${(color) => this._selectColor(color)}
      selectable
      layout=${layout}
      shape=${cfg.swatch_shape || "round"}
      info=${cfg.color_info_display || "none"}
      order=${layout === "gradient" || layout === "fill" ? "smooth" : "given"}
      ?free-pick=${cfg.swatch_free_pick === true}
      direction=${cfg.swatch_blinds_direction || "rows"}
      expand-style=${cfg.swatch_expand_style || "pill"}
      button-shape=${cfg.colors_button_shape || "rounded"}
      style="--yc-swatch-size:${Number(cfg.colors_size) || 28}px"
    ></yc-swatches>`;
    const sections = [];
    const section = (key, title, icon, palette, weights = null) =>
      sections.push({
        key,
        title,
        icon,
        empty: !palette.length,
        content: swatches(palette, weights),
      });
    if (showRecentColors)
      section("recent", "Recent Colors", "🕘", this.recentColors || []);
    if (showLampPalette)
      section("lamp", "Lamp Palette", "🎨", this.getLampGradientColors() || []);
    if (showLampColors) {
      const { palette, weights } = this._getLampMatrixColors();
      section("lampcolors", "Lamp Colors", "💡", palette, weights);
    }
    if (showImagePalette) {
      const { palette, weights } = this._getCurrentColors();
      section("image", "Drawing Colors", "🖌️", palette, weights);
    }
    if (!sections.length) return html``;

    // The sections' border: always, never, or in a dark theme (auto).
    const border = cfg.colors_card_border || "auto";
    const dark =
      this.hass?.themes?.darkMode ??
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
      false;
    return html`<yc-sections
      layout=${cfg.palette_card_mode || "side"}
      .sections=${sections}
      .options=${{
        style: cfg.colors_section_style || "subtle",
        bordered: border === "always" || (border === "auto" && dark),
        width: cfg.side_card_width || 100,
        zoom: cfg.side_click_zoom === "on",
        radius: cfg.colors_item_radius,
        buttonShape: cfg.colors_button_shape || "rounded",
        wrap: cfg.colors_wrap_navigation === true,
        overlay: cfg.colors_preview_overlay === true,
        tabIcons: cfg.colors_tab_icons === true,
        headers: cfg.colors_compact_headers !== false,
        label: "Colors",
        emptyLabel: "No colors",
      }}
    ></yc-sections>`;
  }
};
