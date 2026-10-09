// Palette cards of the draw card (recent / lamp palette / lamp colors / image
// palette) in their side, carousel, tabs and floating layouts, the color
// carousel and the palette-preview hover measurement. Mixed into
// YeelightCubeDrawCard.
import { renderPaletteSection } from "./draw_card_palette_ui.js";
import { handleColorSelect } from "./draw_card_handlers.js";
import { html } from "./lib/lit-all.js";
import { renderCarousel } from "./carousel-utils.js";

export const PaletteCardsMixin = (Base) => class extends Base {
  // Set up (or refresh) the hover measurement for the current DOM state.
  // Safe to call multiple times — tears down/recreates listeners cleanly.
  _setupPreviewHoverMeasurement() {
    const el = this.shadowRoot
      ? this.shadowRoot.querySelector(".palette-preview-hover")
      : this.querySelector(".palette-preview-hover");

    if (!el) {
      // Container gone — clean up any lingering state.
      if (this._previewEl && this._previewRenderedListener) {
        this._previewEl.removeEventListener(
          "palette-element-rendered",
          this._previewRenderedListener,
        );
      }
      if (this._previewApplyRAF) {
        cancelAnimationFrame(this._previewApplyRAF);
        this._previewApplyRAF = null;
      }
      clearTimeout(this._previewROTimeout);
      this._previewEl = null;
      return;
    }

    const allCards = [...el.querySelectorAll(".palette-preview-card")];
    const nCards = allCards.length || 1;

    // ── Early-exit: same element, same card count ─────────────────────────
    // updated() fires on every prop/state change (expand timer, HA entity
    // updates, etc.).  Avoid tearing down and re-adding listeners when
    // nothing structural has changed — that caused unnecessary overhead.
    if (el === this._previewEl && nCards === this._previewNCards) {
      // Still schedule a fresh measurement in case content changed.
      if (this._previewScheduleApply) this._previewScheduleApply();
      return;
    }

    // ── Full setup (first time, or structural change) ─────────────────────
    if (this._previewEl && this._previewRenderedListener) {
      this._previewEl.removeEventListener(
        "palette-element-rendered",
        this._previewRenderedListener,
      );
    }
    if (this._previewApplyRAF) {
      cancelAnimationFrame(this._previewApplyRAF);
      this._previewApplyRAF = null;
    }
    clearTimeout(this._previewROTimeout);
    this._previewEl = el;
    this._previewNCards = nCards;

    // Preserve in-flight collapse guards across re-setups (called from
    // updated() which fires even during the collapse timer window).
    if (!this._collapsingCards) this._collapsingCards = new Set();

    // Prune stale entries from previous card list.
    for (const stale of this._collapsingCards) {
      if (!allCards.includes(stale)) this._collapsingCards.delete(stale);
    }

    const gap = 8;
    const outerW = el.offsetWidth;
    const bodyW = outerW - (nCards - 1) * gap;
    if (bodyW > 0) el.style.setProperty("--container-w", bodyW + "px");

    // ── Core measurement function ──────────────────────────────────────────
    // Reads body.scrollHeight (full layout height, unaffected by CSS
    // transforms / overflow clipping) and sets max-height = scrollH/nCards
    // so each card shows exactly its scaled-down share of the content.
    const applyHeights = () => {
      const outerW2 = el.offsetWidth;
      const expandedMode = el.classList.contains("expanded-mode");
      if (expandedMode) {
        if (outerW2 > 0) el.style.setProperty("--container-w", outerW2 + "px");
      } else {
        const bodyW2 = outerW2 - (nCards - 1) * gap;
        if (bodyW2 > 0) el.style.setProperty("--container-w", bodyW2 + "px");
      }
      let maxScrollH = 0;
      allCards.forEach((card) => {
        if (card.classList.contains("empty")) return;
        if (card.classList.contains("expanded") || expandedMode) return;
        const body = card.querySelector(".palette-preview-body");
        if (body && body.scrollHeight > maxScrollH)
          maxScrollH = body.scrollHeight;
      });
      // +1px breathing room avoids sub-pixel clipping.
      const uniformH = maxScrollH > 0 ? Math.ceil(maxScrollH / nCards) + 1 : 0;
      const uniformPx = uniformH > 0 ? uniformH + "px" : "";
      // Stored so handleCollapse can read the target without re-measuring.
      this._previewUniformPx = uniformPx;
      allCards.forEach((card) => {
        if (this._collapsingCards && this._collapsingCards.has(card)) {
          // handleCollapse owns this card's animation via a direct rAF.
          // Don't touch max-height here or we'll race with it.
          return;
        } else if (card.classList.contains("expanded") || expandedMode) {
          // Expanded: clear any inline max-height and let the CSS class rule
          // (max-height: 2000px) handle space. Writing a JS-measured value here
          // creates a feedback loop — the inline style constrains the layout,
          // which changes body.scrollHeight on the next call, causing oscillation.
          // The collapse handler pins with scrollHeight separately, just before
          // triggering the collapse transition.
          if (card.style.maxHeight) card.style.removeProperty("max-height");
        } else if (uniformPx && card.style.maxHeight !== uniformPx) {
          // Only write when the value actually changes — avoids forced style
          // recalculations on every palette-element-rendered event.
          card.style.maxHeight = uniformPx;
        }
      });
    };

    // ── Debounce helper — coalesces bursts of events into one rAF ─────────
    const scheduleApply = () => {
      if (this._previewApplyRAF) cancelAnimationFrame(this._previewApplyRAF);
      this._previewApplyRAF = requestAnimationFrame(() => {
        this._previewApplyRAF = null;
        applyHeights();
      });
    };

    // Expose so handleCollapse's transitionend callback (different closure)
    // can trigger the final measurement after the animation completes.
    this._previewScheduleApply = scheduleApply;

    // ── palette-element-rendered — fires after each palette finishes render ─
    // Fix #7: skip events that bubble from a card that is currently mid-collapse.
    // Those cards have their max-height pinned by handleCollapse; calling
    // applyHeights() from inside the collapse animation could overwrite that pin
    // and restart or stutter the CSS transition.
    this._previewRenderedListener = (ev) => {
      if (this._collapsingCards && this._collapsingCards.size > 0) {
        const path = ev.composedPath ? ev.composedPath() : [];
        for (const node of path) {
          if (this._collapsingCards.has(node)) return;
        }
      }
      scheduleApply();
    };
    el.addEventListener(
      "palette-element-rendered",
      this._previewRenderedListener,
    );

    // ── Immediate baseline pass ────────────────────────────────────────────
    scheduleApply();

    // ── Hard fallback — catches cases where no event fires (e.g. empty cards) ─
    this._previewROTimeout = setTimeout(applyHeights, 600);
  }

  _renderPaletteCards(
    cfg,
    showRecentColors,
    showLampPalette,
    showLampColors,
    showImagePalette,
  ) {
    const mode = cfg.palette_card_mode || "side";
    const buttonShape = cfg.button_shape || "rect";
    const cards = [];
    const expandStyle = cfg.expand_btn_style || "pill";
    const blindsDir = cfg.blinds_direction || "rows";
    const colorInfo = cfg.color_info_display || "none";
    const gradientFreePick = cfg.gradient_free_pick === true;
    if (showRecentColors) {
      const palette = this.recentColors || [];
      cards.push({
        key: "recent",
        title: "Recent Colors",
        palette,
        weights: null,
        content: renderPaletteSection(
          palette,
          "recent",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          null,
          colorInfo,
          gradientFreePick,
        ),
      });
    }
    if (showLampPalette) {
      const palette = this.getLampGradientColors() || [];
      cards.push({
        key: "lamp",
        title: "Lamp Palette",
        palette,
        weights: null,
        content: renderPaletteSection(
          palette,
          "lamp",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          null,
          colorInfo,
          gradientFreePick,
        ),
      });
    }
    if (showLampColors) {
      const { palette, weights } = this._getLampMatrixColors();
      cards.push({
        key: "lampcolors",
        title: "Lamp Colors",
        palette,
        weights,
        content: renderPaletteSection(
          palette,
          "lampcolors",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          weights,
          colorInfo,
          gradientFreePick,
        ),
      });
    }
    if (showImagePalette) {
      const { palette, weights } = this._getCurrentColors();
      cards.push({
        key: "image",
        title: "Drawing Colors",
        palette,
        weights,
        content: renderPaletteSection(
          palette,
          "image",
          (color) => handleColorSelect(this, color),
          cfg.palette_display_mode || "row",
          cfg.swatch_shape || "round",
          expandStyle,
          buttonShape,
          blindsDir,
          weights,
          colorInfo,
          gradientFreePick,
        ),
      });
    }

    if (!cards.length) return html``;

    const emptyHint = html`<div class="palette-empty-hint">No colors</div>`;
    const cardContent = (card) =>
      card.palette.length ? card.content : emptyHint;

    // Colors card border
    const colorsBorderMode = cfg.colors_card_border || "auto";
    const isDark =
      this.hass?.themes?.darkMode ??
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ??
      false;
    const showColorsBorder =
      colorsBorderMode === "always" || (colorsBorderMode === "auto" && isDark);
    const colorsBorderClass = showColorsBorder
      ? " palette-colors-card-border"
      : "";

    // Side-by-side (default)
    if (mode === "side") {
      const sideW = cfg.side_card_width || 100;
      const clickZoom = cfg.side_click_zoom === "on";
      if (!this._sideZoomedKey) this._sideZoomedKey = null;
      const zoomedKey = this._sideZoomedKey;
      const isZoomMode = clickZoom && zoomedKey;
      const handleZoomClick = (key) => {
        if (!clickZoom) return;
        if (this._sideZoomedKey === key) return;
        // Save scroll position before zooming
        const row = this.shadowRoot?.querySelector(".palette-row");
        if (row) this._sideZoomScrollLeft = row.scrollLeft;
        this._sideZoomedKey = key;
        this.requestUpdate();
      };
      const handleCollapse = () => {
        const savedScroll = this._sideZoomScrollLeft || 0;
        this._sideZoomedKey = null;
        this.requestUpdate();
        // Restore scroll position after CSS transition (0.3s) completes
        this.updateComplete.then(() => {
          setTimeout(() => {
            const row = this.shadowRoot?.querySelector(".palette-row");
            if (row) row.scrollLeft = savedScroll;
          }, 350);
        });
      };
      // The colour cards' corners (colors_item_radius; 16px by default).
      const paletteCardRadius = `${cfg.colors_item_radius ?? 16}px`;
      return html`<div
        class="palette-row${isZoomMode ? " zoom-mode" : ""}${colorsBorderClass}"
        style="--side-card-width:${sideW}%;--palette-card-radius:${paletteCardRadius}"
      >
        ${cards.map(
          (card) => html`
            <div
              class="palette-group-card yc-stack yc-controls${isZoomMode &&
              zoomedKey === card.key
                ? " zoomed"
                : ""}"
              @click="${() => handleZoomClick(card.key)}"
              style="${clickZoom && !isZoomMode ? "cursor:pointer" : ""}"
            >
              ${isZoomMode && zoomedKey === card.key
                ? html`<button
                    class="palette-zoom-collapse-btn"
                    @click="${(e) => {
                      e.stopPropagation();
                      handleCollapse();
                    }}"
                  >
                    ← Show All
                  </button>`
                : ""}
              <div class="palette-card-top-row">
                <div class="palette-group-title">${card.title}</div>
              </div>
              ${cardContent(card)}
            </div>
          `,
        )}
      </div>`;
    }
    // Carousel mode
    if (mode === "carousel") {
      const carouselButtonShape = cfg.colors_button_shape || "rounded";
      if (this._colorCarouselIndex === undefined) this._colorCarouselIndex = 0;
      const carouselResult = renderCarousel({
        items: cards,
        currentIndex: this._colorCarouselIndex,
        buttonShape: carouselButtonShape,
        showAsCard: true,
        wrapNavigation: cfg.colors_wrap_navigation === true,
        // 12px by default in the carousel.
        roundedCards: cfg.colors_item_radius,
        onNavigate: (direction, maxLength) => {
          this._navigateColorCarousel(direction, maxLength);
        },
        onSetIndex: (index) => {
          this._setColorCarouselIndex(index);
        },
        renderItem: (card) => {
          return html`
            <div class="palette-card-top-row">
              <div class="palette-group-title">${card.title}</div>
            </div>
            ${cardContent(card)}
          `;
        },
      });
      return html`<div
        class="palette-colors-carousel-wrapper${colorsBorderClass}"
      >
        ${carouselResult}
      </div>`;
    }
    // Tabs (segmented control)
    if (mode === "tabs") {
      if (!this._activePaletteTab && cards.length) {
        this._activePaletteTab = cards[0].key;
      }
      const activeTab = this._activePaletteTab;
      const activeCard = cards.find((c) => c.key === activeTab);
      const activeIdx = cards.findIndex((c) => c.key === activeTab);
      return html`
        <div class="palette-tabs yc-stack yc-controls${colorsBorderClass}">
          <div
            class="palette-tab-bar"
            style="--tab-count:${cards.length};--tab-active-index:${activeIdx}"
          >
            <div class="palette-tab-indicator"></div>
            ${cards.map(
              (card) => html`
                <button
                  class="palette-tab-btn${activeTab === card.key
                    ? " active"
                    : ""}"
                  title="${card.title}"
                  @click="${() => {
                    this._activePaletteTab = card.key;
                    this.requestUpdate();
                  }}"
                >
                  ${card.title}
                </button>
              `,
            )}
          </div>
          ${activeCard
            ? html`
                <div class="palette-tab-content">
                  ${cardContent(activeCard)}
                </div>
              `
            : ""}
        </div>
      `;
    }
    // Dropdown
    if (mode === "dropdown") {
      const activeDrop = this._activePaletteDropdown || cards[0]?.key;
      const activeCard = cards.find((c) => c.key === activeDrop);
      return html`
        <div
          class="palette-dropdown-wrapper yc-stack yc-controls${colorsBorderClass}"
        >
          <select
            class="palette-dropdown-select"
            @change="${(e) => {
              this._activePaletteDropdown = e.target.value;
              this.requestUpdate();
            }}"
          >
            ${cards.map(
              (card) =>
                html`<option
                  value="${card.key}"
                  ?selected="${activeDrop === card.key}"
                >
                  ${card.title}
                </option>`,
            )}
          </select>
          ${activeCard
            ? html`
                <div class="palette-dropdown-content">
                  ${cardContent(activeCard)}
                </div>
              `
            : ""}
        </div>
      `;
    }
    // Preview-hover mode
    if (mode === "preview-hover") {
      if (!this._previewStates) this._previewStates = {};
      if (!cards.length) {
        return html`<div class="palette-empty-hint">
          No palette colors available
        </div>`;
      }
      const displayMode = cfg.palette_display_mode || "row";
      const expandedKey = Object.keys(this._previewStates).find(
        (k) => this._previewStates[k],
      );
      const expandedMode = !!expandedKey;
      const nCards = cards.length;
      return html`<div
        class="palette-preview-hover${expandedMode
          ? " expanded-mode"
          : ""}${colorsBorderClass}"
        data-display-mode="${displayMode}"
        style="--n-cards:${nCards};"
      >
        ${cards.map((card, idx) => {
          const hasPalette = card.palette.length > 0;
          const isExpanded = !!this._previewStates[card.key];
          // Per-card timer map prevents one shared timer from racing across cards
          if (!this._previewCollapseTimers)
            this._previewCollapseTimers = new Map();

          const handleExpand = (e) => {
            // If this card was mid-collapse when the mouse re-entered, remove it
            // from the collapsing guard so applyHeights() can set its max-height
            // for re-expansion instead of waiting for .expanded to be removed.
            const cardEl4 = e?.currentTarget;
            if (cardEl4 && this._collapsingCards) {
              this._collapsingCards.delete(cardEl4);
            }
            // Cancel pending collapse for THIS card
            if (this._previewCollapseTimers.has(card.key)) {
              clearTimeout(this._previewCollapseTimers.get(card.key));
              this._previewCollapseTimers.delete(card.key);
            }
            // Legacy single-timer cleanup
            if (this._previewCollapseTimer) {
              clearTimeout(this._previewCollapseTimer);
              this._previewCollapseTimer = null;
            }
            // Immediately collapse all OTHER cards so only one is ever expanded.
            // This prevents dangling _previewStates[k]=true when moving quickly
            // between cards (which caused both cards to appear expanded at once).
            Object.keys(this._previewStates).forEach((k) => {
              if (k !== card.key && this._previewStates[k]) {
                if (this._previewCollapseTimers.has(k)) {
                  clearTimeout(this._previewCollapseTimers.get(k));
                  this._previewCollapseTimers.delete(k);
                }
                this._previewStates[k] = false;
              }
            });
            // Issue #5 — touch toggle: on mobile a touchstart opens the card.
            // Track whether this specific touchstart is the opener so that the
            // matching touchend can be ignored (card stays open until tap elsewhere).
            const wasExpanded = !!this._previewStates[card.key];
            if (e?.type === "touchstart" && !wasExpanded) {
              this._touchJustExpanded = card.key;
            }
            this._previewStates[card.key] = true;
            this.requestUpdate();
          };
          const handleCollapse = (e) => {
            // Touch guard: ignore the touchend that immediately follows the
            // touchstart that opened this card.
            if (
              e?.type === "touchend" &&
              this._touchJustExpanded === card.key
            ) {
              this._touchJustExpanded = null;
              return;
            }
            if (e?.type === "touchend") this._touchJustExpanded = null;

            const key = card.key;
            if (this._previewCollapseTimers.has(key)) {
              clearTimeout(this._previewCollapseTimers.get(key));
              this._previewCollapseTimers.delete(key);
            }

            if (!isExpanded) return;

            const cardEl = e?.currentTarget;
            if (!cardEl) {
              this._previewStates[key] = false;
              this.requestUpdate();
              return;
            }

            // Compute the collapse target directly from this card's body so
            // we never depend on the possibly-stale/zero _previewUniformPx cache
            // (which is skipped for the collapsing card during applyHeights).
            const body = cardEl.querySelector(".palette-preview-body");
            const fullH = cardEl.scrollHeight;
            const targetH = body
              ? Math.ceil(body.scrollHeight / nCards) + 1
              : 0;
            const targetPx = targetH > 0 ? targetH + "px" : "0px";

            // Pin start value. Make background transparent so the white gap
            // between the mini-body and the card bottom is invisible during
            // the height animation (inline style survives Lit re-renders).
            cardEl.style.maxHeight = fullH + "px";
            cardEl.style.background = "transparent";
            cardEl.style.boxShadow = "none";
            if (this._collapsingCards) this._collapsingCards.add(cardEl);

            // Remove .expanded immediately so Lit re-renders and other cards
            // start recovering in parallel.
            this._previewStates[key] = false;
            this.requestUpdate();

            // Force a synchronous reflow to commit the pinned fullH value,
            // then set the target in the same call-stack execution so the CSS
            // transition fires immediately — no rAF gap, no extra white frame.
            void cardEl.getBoundingClientRect();
            cardEl.style.maxHeight = targetPx;

            // Clean up after the transition completes.
            const onTransitionEnd = (ev) => {
              if (ev.propertyName !== "max-height") return;
              cardEl.removeEventListener("transitionend", onTransitionEnd);
              clearTimeout(this._previewCollapseTimers.get(key));
              this._previewCollapseTimers.delete(key);
              if (this._collapsingCards) this._collapsingCards.delete(cardEl);
              cardEl.style.removeProperty("background");
              cardEl.style.removeProperty("box-shadow");
              if (this._previewScheduleApply) this._previewScheduleApply();
            };
            cardEl.addEventListener("transitionend", onTransitionEnd);

            const fallbackTimer = setTimeout(() => {
              cardEl.removeEventListener("transitionend", onTransitionEnd);
              this._previewCollapseTimers.delete(key);
              if (this._collapsingCards) this._collapsingCards.delete(cardEl);
              cardEl.style.removeProperty("background");
              cardEl.style.removeProperty("box-shadow");
            }, 500);
            this._previewCollapseTimers.set(key, fallbackTimer);
          };
          const content = hasPalette ? card.content : null;
          return html`
            <div
              class="palette-preview-card${isExpanded
                ? " expanded"
                : ""}${!hasPalette ? " empty" : ""}"
              @mouseenter="${handleExpand}"
              @mouseleave="${handleCollapse}"
              @touchstart="${handleExpand}"
              @touchend="${handleCollapse}"
            >
              <div class="palette-preview-card-title">${card.title}</div>
              ${hasPalette
                ? html`<div class="palette-preview-body">${content}</div>`
                : html`<div class="palette-mini-empty">
                    ${isExpanded
                      ? html`<span class="mini-empty-hint">Empty</span>`
                      : ""}
                  </div>`}
            </div>
          `;
        })}
      </div>`;
    }
    // Fallback: side-by-side
    const fallbackSideW = cfg.side_card_width || 100;
    return html`<div
      class="palette-row${colorsBorderClass}"
      style="--side-card-width:${fallbackSideW}%"
    >
      ${cards.map(
        (card) => html`
          <div class="palette-group-card yc-stack yc-controls">
            <div class="palette-group-title">${card.title}</div>
            ${cardContent(card)}
          </div>
        `,
      )}
    </div>`;
  }

  _navigateColorCarousel(direction, maxLength) {
    const current = this._colorCarouselIndex || 0;
    const cfg = this.config || {};
    const wrapNavigation = cfg.colors_wrap_navigation === true;

    let newIndex = current + direction;

    if (wrapNavigation) {
      if (newIndex < 0) {
        newIndex = maxLength - 1;
      } else if (newIndex >= maxLength) {
        newIndex = 0;
      }
    } else {
      newIndex = Math.max(0, Math.min(newIndex, maxLength - 1));
    }

    if (newIndex !== current) {
      this._colorCarouselIndex = newIndex;
      this.requestUpdate();
    }
  }

  _setColorCarouselIndex(index) {
    const current = this._colorCarouselIndex || 0;
    if (index !== current) {
      this._colorCarouselIndex = index;
      this.requestUpdate();
    }
  }
};
