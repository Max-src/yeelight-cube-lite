// Colour list layouts of the colour list editor card (compact, chips, tiles,
// rows, grid, cards) and the per-colour controls. Mixed into
// YeelightCubeColorListEditorCard.
import { html } from "./lib/lit-all.js";
import { nothing } from "./lit-extras.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";

export const ColorListLayoutsMixin = (Base) => class extends Base {
  _renderItems(textColors, options) {
    const layoutMode = this.config.list_layout || "compact";

    switch (layoutMode) {
      case "chips":
        return this._renderChipsLayout(textColors, options);
      case "tiles":
        return this._renderTilesLayout(textColors, options);
      case "rows":
        return this._renderRowsLayout(textColors, options);
      case "grid":
        return this._renderGridLayout(textColors, options);
      case "cards":
        return this._renderCardsLayout(textColors, options);
      case "compact":
      default:
        return this._renderCompactLayout(textColors, options);
    }
  }

  _hexInput(idx, hex, className, style) {
    // While an input is focused, bind what the user typed so a render (e.g.
    // saving another color) never overwrites a half-typed value.
    const value = this._editing?.idx === idx ? this._editing.value : hex;
    return html`<input
      type="text"
      class=${className}
      .value=${value}
      data-idx=${idx}
      maxlength="7"
      style=${style ?? nothing}
      @focus=${this._onHexFocus}
      @blur=${this._onHexBlur}
      @keydown=${this._onHexKeydown}
      @input=${this._onHexInput}
    />`;
  }

  _removeButton(idx, className, options, style) {
    return html`<button
      data-action="remove"
      data-idx=${idx}
      class="${options.deleteBtnClass} ${className}"
      style=${style ?? nothing}
      title="Remove"
    ></button>`;
  }

  _colorInput(idx, hex, className) {
    return html`<input
      type="color"
      .value=${hex}
      data-idx=${idx}
      class=${className}
    />`;
  }

  // COMPACT MODE - Minimal inline design with hover actions
  _renderCompactLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "hex";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      return html`<div
        class="compact-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
      >
        <div
          class="compact-swatch"
          style="background: ${rgbToCss(color)};"
          title="Click to change color"
        >
          ${options.enableColorPicker
            ? this._colorInput(idx, hex, "compact-color-input")
            : ""}
        </div>
        <div class="compact-info">
          ${options.showHexInput
            ? this._hexInput(idx, hex, "compact-hex-input hex-input")
            : ""}
          <span class="compact-color-name"
            >${this.formatColorInfo(color, display)}</span
          >
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              `compact-remove ${posClass} ${sideClass}`,
              options,
            )
          : ""}
      </div>`;
    });
  }

  // CHIPS MODE - Colorful tag/pill style
  _renderChipsLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "hex";
    return html`<div class="chips-container">
      ${textColors.map((color, idx) => {
        if (!(Array.isArray(color) && color.length === 3)) return "";
        const hex = this.rgbToHex(color);
        const contrast = this.getContrastTextColor(color);
        const shade = contrast === "#ffffff" ? "255,255,255" : "0,0,0";
        return html`<div
          class="chip-item"
          data-idx=${idx}
          draggable=${options.allowDragDrop ? "true" : nothing}
          style="background: ${rgbToCss(color)}; color: ${contrast};"
        >
          ${options.enableColorPicker
            ? html`<div
                class="chip-color-swatch"
                title="Click to change color"
              >
                ${this._colorInput(idx, hex, "chip-color-input")}
              </div>`
            : ""}
          ${options.showHexInput
            ? this._hexInput(
                idx,
                hex,
                "chip-hex-input hex-input",
                `color: ${contrast}; background: rgba(${shade}, 0.2);`,
              )
            : ""}
          <span class="chip-content" title="Drag to reorder">
            ${this.formatColorInfo(color, display)}
          </span>
          ${options.allowDelete
            ? this._removeButton(
                idx,
                `chip-remove ${posClass} ${sideClass}`,
                options,
              )
            : ""}
        </div>`;
      })}
    </div>`;
  }

  // TILES MODE - Card-like items in vertical list
  _renderTilesLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "name";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      return html`<div
        class="tile-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
      >
        ${options.allowDragDrop
          ? html`<div class="tile-drag-area" title="Drag to reorder">⋮⋮</div>`
          : ""}
        <div class="tile-color-preview" style="background: ${rgbToCss(color)};">
          ${options.enableColorPicker
            ? this._colorInput(idx, hex, "tile-color-input")
            : ""}
        </div>
        <div class="tile-info">
          ${options.showHexInput
            ? this._hexInput(idx, hex, "tile-hex-input hex-input")
            : ""}
          <span class="tile-color-name"
            >${this.formatColorInfo(color, display)}</span
          >
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              `tile-remove ${posClass} ${sideClass}`,
              options,
            )
          : ""}
      </div>`;
    });
  }

  // ROWS MODE - Full-width colored rows with gradient effects
  _renderRowsLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "name";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      const contrast = this.getContrastTextColor(color);
      const shade = contrast === "#ffffff" ? "255,255,255" : "0,0,0";
      return html`<div
        class="row-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
        style="background: linear-gradient(135deg, ${rgbToCss(
          color,
        )} 0%, ${this.adjustColorBrightness(
          color,
          -20,
        )} 100%); color: ${contrast};"
        data-color-row="true"
      >
        ${options.enableColorPicker
          ? this._colorInput(idx, hex, "row-color-input")
          : ""}
        <div class="row-content">
          ${options.allowDragDrop
            ? html`<span class="row-drag-indicator" title="Drag to reorder"
                >⋮⋮</span
              >`
            : ""}
          ${options.showHexInput
            ? this._hexInput(
                idx,
                hex,
                "row-hex-input hex-input",
                `background: rgba(${shade}, 0.2); color: ${contrast}; border-color: rgba(${shade}, 0.3);`,
              )
            : ""}
          <span class="row-color-name"
            >${this.formatColorInfo(color, display)}</span
          >
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              `row-remove ${posClass} ${sideClass}`,
              options,
            )
          : ""}
      </div>`;
    });
  }

  _renderGridLayout(textColors, options) {
    const { posClass, sideClass } = options;
    const display = this.config.color_info_display || "hex";
    return textColors.map((color, idx) => {
      if (!(Array.isArray(color) && color.length === 3)) return "";
      const hex = this.rgbToHex(color);
      const info = this.formatColorInfo(color, display);
      return html`<div
        class="color-grid-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
      >
        <div
          class="color-grid-swatch"
          style="background-color: ${rgbToCss(color)};"
          title=${info}
        >
          ${options.enableColorPicker
            ? this._colorInput(idx, hex, "grid-color-picker")
            : ""}
          ${options.allowDelete
            ? this._removeButton(
                idx,
                `grid-remove-btn ${posClass} ${sideClass}`,
                options,
              )
            : ""}
        </div>
        ${options.showHexInput
          ? this._hexInput(idx, hex, "hex-input grid-hex-input")
          : ""}
        <div class="color-grid-info">${info}</div>
      </div>`;
    });
  }

  // CARDS MODE - playing cards in one of five arrangements
  _renderCardsLayout(textColors, options) {
    const arrangement = this.config.card_arrangement || "hand";
    const valid = (color) => Array.isArray(color) && color.length === 3;
    const card = (color, idx, layout) =>
      valid(color) ? this._renderCard(color, idx, options, layout) : "";

    switch (arrangement) {
      case "spread":
        return html`<div class="cards-container">
          ${textColors.map((color, idx) => {
            // Pseudo-random rotation / offset per position for a spread look
            const seed1 = (idx * 2654435761) % 2147483647;
            const seed2 = (idx * 1103515245 + 12345) % 2147483647;
            const rotationDeg = (seed1 % 25) - 12;
            const verticalOffset = (seed2 % 12) - 6;
            return card(color, idx, {
              transform: `rotate(${rotationDeg}deg) translateY(${verticalOffset}px)`,
              zIndex: idx,
            });
          })}
        </div>`;
      case "cascade":
        // Cascade: overlapping diagonal waterfall with a gentle vertical step
        // per card (reset every 8 cards) and a uniform slight rotation.
        return html`<div class="cards-container cascade-mode">
          ${textColors.map((color, idx) =>
            card(color, idx, {
              transform: `rotate(-3deg) translateY(${(idx % 8) * 4}px)`,
              zIndex: idx,
            }),
          )}
        </div>`;
      case "tilt":
        // Tilt: clean grid with all cards rotated at the same uniform angle.
        return html`<div class="cards-container tilt-mode">
          ${textColors.map((color, idx) =>
            card(color, idx, { transform: "rotate(-5deg)", zIndex: idx }),
          )}
        </div>`;
      case "fan": {
        // Fan: semicircular arc from a single origin point below the cards.
        const totalCards = textColors.filter(valid).length;
        // Spread angle range: up to ±50° for many cards, narrower for fewer
        const maxSpread = Math.min(50, totalCards * 6);
        const centerIndex = (totalCards - 1) / 2;
        return html`<div
          class="cards-fan-container"
          @mousemove=${this._onFanMouseMove}
          @mouseenter=${this._onFanMouseEnter}
          @mouseleave=${this._onFanMouseLeave}
          @touchstart=${this._fanTouchListener}
          @touchmove=${this._fanTouchListener}
          @touchend=${this._fanTouchListener}
          @touchcancel=${this._fanTouchListener}
        >
          ${textColors.map((color, idx) => {
            const rotation = (
              totalCards > 1 ? ((idx - centerIndex) / centerIndex) * maxSpread : 0
            ).toFixed(1);
            return card(color, idx, {
              transform: `rotate(${rotation}deg)`,
              zIndex: idx,
              baseRotation: rotation,
            });
          })}
        </div>`;
      }
      default: {
        // Hand: poker-hand rows. Cards per row follow the card size:
        // at 70% (default) 120px cards fit 4 per row in ~600px.
        const cardSizePercent = this.config.card_size || 70;
        const baseCardWidth = 171.43 * (cardSizePercent / 100);
        const cardsPerRow = Math.max(
          3,
          Math.min(10, Math.floor(600 / (baseCardWidth + 30))),
        );
        const rows = [];
        for (let i = 0; i < textColors.length; i += cardsPerRow) {
          rows.push(i);
        }
        return html`<div class="cards-poker-container">
          ${rows.map((rowStartIdx) => {
            const rowColors = textColors.slice(
              rowStartIdx,
              rowStartIdx + cardsPerRow,
            );
            const centerIndex = (rowColors.length - 1) / 2;
            return html`<div class="poker-hand">
              ${rowColors.map((color, idx) => {
                const offset = idx - centerIndex;
                return card(color, rowStartIdx + idx, {
                  wrapperClass: "card-wrapper poker-card",
                  transform: `rotate(${offset * 8}deg) translateY(${
                    Math.abs(offset) * 10
                  }px) translateX(${offset * -15}px)`,
                  zIndex: idx,
                });
              })}
            </div>`;
          })}
        </div>`;
      }
    }
  }

  _renderCard(color, idx, options, layout) {
    const hex = this.rgbToHex(color);
    const cssColor = rgbToCss(color);
    return html`<div
      class=${layout.wrapperClass || "card-wrapper"}
      data-position=${idx}
      data-base-rotation=${layout.baseRotation ?? nothing}
    >
      <div
        class="card-item"
        data-idx=${idx}
        draggable=${options.allowDragDrop ? "true" : nothing}
        style="--card-color: ${cssColor}; transform: ${layout.transform}; z-index: ${layout.zIndex};"
      >
        <div class="card-face">
          <div
            class="card-color-bar${options.enableColorPicker
              ? " clickable"
              : ""}"
            style="background: ${cssColor};"
          >
            ${options.enableColorPicker
              ? this._colorInput(idx, hex, "card-color-picker")
              : ""}
          </div>
          <div class="card-info-area">
            ${options.showHexInput
              ? this._hexInput(idx, hex, "hex-input card-hex")
              : ""}
            <div class="card-name">
              ${this.formatColorInfo(
                color,
                this.config.color_info_display || "hex",
              )}
            </div>
          </div>
        </div>
        ${options.allowDelete
          ? this._removeButton(
              idx,
              "card-remove",
              options,
              options.buttonPositionStyles,
            )
          : ""}
      </div>
    </div>`;
  }
};
