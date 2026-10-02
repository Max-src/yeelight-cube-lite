// Mode selector of the gradient card: the preview gallery / wheel / carousel
// (previews requested from the backend and cached), the text styles, carousel
// and wheel navigation, and the active-mode marking. Mixed into
// YeelightCubeGradientCard.
import {
  resolveSelectorShape,
  resolveSelectorButtonShape,
  selectorShapeToCarouselButtonShape,
} from "./selector-shared-styles.js";
import {
  galleryPreviewSizeToPx,
  resolveSelectorTextScale,
} from "./gradient-card-utils.js";
import {
  renderMatrixPreview,
  renderGalleryDisplay,
} from "./gallery-display-utils.js";
import { initializeWheelNavigation } from "./wheel-navigation-utils.js";
import { renderCarouselString } from "./carousel-utils.js";
import { renderPagination } from "./pagination-utils.js";
import { gradientPreviewStore } from "./gradient-preview-store.js";
import { rgbToCss } from "./yeelight-cube-dotmatrix.js";
import { html } from "./lib/lit-all.js";

export const ModeSelectorMixin = (Base) => class extends Base {
  _updatePreviewSection() {
    // Nothing to update when the selector doesn't render previews (e.g. a
    // stale preview event arriving right after switching to a text style).
    if (!this._isPreviewSelectorActive()) return;

    const displayMode = this._getDisplayMode();

    // For wheel mode, try surgical update first (only update preview images)
    // But if wheel doesn't exist yet, fall through to full render
    if (displayMode === "wheel") {
      const wheelExists = this.shadowRoot?.querySelector(
        ".wheel-item[data-mode]",
      );
      // wheelExists: !!wheelExists,
      // wheelItemsCount:
      // this.shadowRoot?.querySelectorAll(".wheel-item").length,
      // allWheelItems: Array.from(
      // this.shadowRoot?.querySelectorAll(".wheel-item") || []
      // ).map((item) => item.dataset.mode),
      // });

      if (wheelExists) {
        // Ensure wheel controller is initialized
        if (!this._wheelNavigationController) {
          this._attachPreviewEventListeners();
        }

        this._updateWheelPreviews();
        return;
      } else {
        // "[Gradient Card] Wheel doesn't exist yet, will do full render"
        // );
      }
    }

    // For other modes OR if wheel doesn't exist yet, update the entire container
    const container = this.shadowRoot?.querySelector(".preview-grid-container");
    if (container) {
      // Always keep overflow visible — hover highlights (border + transforms
      // like translateY/scale) on preview items were clipped at the container
      // edges by the previous overflow:hidden.  Items are max-width-bounded so
      // nothing can actually escape the layout.
      container.style.overflow = "visible";

      // Generate new preview HTML with updated data
      const newPreviewHtml = this._renderPreviewGrid();
      const presentationKey = this._getPreviewPresentationKey();

      // Compare against the LAST HTML STRING WE SET — not container.innerHTML.
      // The browser re-serializes DOM (attribute order, entity encoding), so
      // `container.innerHTML !== generatedString` was effectively ALWAYS true
      // and every call replaced the full preview DOM — the primary source of
      // visible blinking on each state/preview update.
      if (newPreviewHtml !== this._cachedPreviewHtml) {
        // SURGICAL ITEM UPDATE (same technique the wheel uses): when only the
        // preview CONTENT changed (text/colors/angle) and the item structure
        // and presentation are identical, re-render just each item's matrix
        // image.  The container DOM — layout, hover state, listeners — is
        // untouched, so content updates are completely flicker-free.
        const structureStable =
          presentationKey === this._lastPreviewPresentationKey;
        if (structureStable && this._updateGalleryItemPreviews()) {
          this._cachedPreviewHtml = newPreviewHtml;
        } else {
          container.innerHTML = newPreviewHtml;
          this._cachedPreviewHtml = newPreviewHtml;
          // Refresh highlight / wheel controller for the new preview DOM
          // (clicks are delegated from the persistent preview host)
          this._attachPreviewEventListeners();
        }
      } else {
        // Content unchanged — refresh the active-mode highlight and make
        // sure the wheel controller exists (e.g. after a host re-render).
        this._attachPreviewEventListeners();
      }
      this._lastPreviewPresentationKey = presentationKey;
    } else {
      console.warn("[Gradient Card] Container not found in DOM!");
    }
  }

  /**
   * Presentation-affecting config signature.  When this changes, the preview
   * container structure must be rebuilt; when only content (text/colors/angle)
   * changes, per-item surgical updates are safe.
   */
  _getPreviewPresentationKey() {
    const cfg = this.config || {};
    return JSON.stringify({
      display: this._getModeSelectorStyle(),
      bg: cfg.gallery_background_color,
      px: cfg.gallery_pixel_style,
      gap: cfg.gallery_spacing_mode || cfg.gallery_pixel_spacing,
      size: cfg.gallery_preview_size,
      ib: cfg.gallery_ignore_black_pixels,
      titles: cfg.preview_show_titles,
      shadow: cfg.gallery_matrix_box_shadow,
      vis: cfg.custom_visible_modes === true ? cfg.visible_modes || null : null,
      shape: resolveSelectorShape(cfg),
      bshape: resolveSelectorButtonShape(cfg),
      ipp: cfg.items_per_page || 0,
      pg: this._selectorPage || 0,
      ci: this._carouselIndex ?? null, // carousel slide is part of presentation
    });
  }

  /**
   * Surgically update the matrix image inside each gallery item (list / row
   * display modes) from the current preview cache — the gallery counterpart
   * of _updateWheelPreviews().  Returns true when all items were updated in
   * place; false when the item structure doesn't match (caller falls back to
   * a full container swap).
   */
  _updateGalleryItemPreviews() {
    const previewData = this._previewCache().data;
    if (!previewData) return false;
    // Paginated views render a slice — use the full rebuild path there.
    if ((parseInt(this.config.items_per_page) || 0) > 0) return false;

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;

    const expectedModes = this._orderedModes().filter(
      (m) => previewData.previews[m],
    );
    const items = Array.from(
      this.shadowRoot?.querySelectorAll(
        ".gallery-item[data-mode]:not(.wheel-item)",
      ) || [],
    );
    if (items.length !== expectedModes.length) return false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].dataset.mode !== expectedModes[i]) return false;
    }

    // Same option resolution as _renderPreviewGrid / _updateWheelPreviews
    const galleryBgColor = this.config.gallery_background_color || "black";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPreviewSize = galleryPreviewSizeToPx(
      this.config.gallery_preview_size,
    );
    const gallerySpacingMode =
      this.config.gallery_spacing_mode ||
      (this.config.gallery_pixel_spacing !== false ? "normal" : "none");
    const galleryPixelGap = gallerySpacingMode === "normal" ? 3 : 0;
    const galleryPixelBoxShadow =
      gallerySpacingMode === "subtle" || gallerySpacingMode === "normal";
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    // Effective preview size must match _renderPreviewGrid exactly, or the
    // surgical updater rewrites items at a different size than the initial
    // render (grid = half, strip = mini), causing a size "jump" on every update.
    const selectorStyle = this._getModeSelectorStyle();
    const effectivePreviewSize =
      selectorStyle === "preview-grid"
        ? Math.round(galleryPreviewSize * 0.5)
        : selectorStyle === "preview-strip"
          ? Math.round(galleryPreviewSize * 0.4)
          : galleryPreviewSize;

    for (const item of items) {
      const previewColors = previewData.previews[item.dataset.mode];
      if (!previewColors) return false;
      const previewContainer = item.querySelector(".gallery-matrix-preview");
      if (!previewContainer) return false;

      // Flip vertically (same convention as _renderPreviewGrid)
      const flippedColors = [];
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          flippedColors.push(previewColors[row * cols + col]);
        }
      }

      previewContainer.outerHTML = this._renderSingleMatrixPreview(
        flippedColors,
        {
          rows,
          cols,
          bgColor: galleryBgColor,
          pixelStyle: galleryPixelStyle,
          pixelGap: galleryPixelGap,
          previewSize: effectivePreviewSize,
          ignoreBlackPixels,
          matrixBoxShadow: this.config.gallery_matrix_box_shadow === true,
          pixelBoxShadow: galleryPixelBoxShadow,
        },
      );
    }

    // Keep the highlight consistent after image swaps
    this._markActiveMode();
    return true;
  }

  /**
   * Surgically update only the preview images within wheel items
   * This avoids destroying and re-creating the wheel structure
   */
  _updateWheelPreviews() {
    const previewData = this._previewCache().data;
    if (!previewData) {
      return;
    }

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;

    // Get gallery settings from config
    const galleryBgColor = this.config.gallery_background_color || "black";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPreviewSize = galleryPreviewSizeToPx(
      this.config.gallery_preview_size,
    );
    const galleryPixelGap =
      (this.config.gallery_spacing_mode ||
        (this.config.gallery_pixel_spacing !== false ? "normal" : "none")) ===
      "normal"
        ? 3
        : 0;
    const gallerySpacingModeResolved =
      this.config.gallery_spacing_mode ||
      (this.config.gallery_pixel_spacing !== false ? "normal" : "none");
    const galleryPixelBoxShadow =
      gallerySpacingModeResolved === "subtle" ||
      gallerySpacingModeResolved === "normal";
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    const wheelItems = this.shadowRoot.querySelectorAll(
      ".wheel-item[data-mode]",
    );

    let updatedCount = 0;
    wheelItems.forEach((item) => {
      const mode = item.dataset.mode;
      const previewColors = previewData.previews[mode];

      if (!previewColors) return;

      // Flip vertically: reverse rows to fix upside-down display
      const flippedColors = [];
      for (let row = rows - 1; row >= 0; row--) {
        for (let col = 0; col < cols; col++) {
          const color = previewColors[row * cols + col];
          flippedColors.push(color);
        }
      }

      // Find the preview container within this item
      const previewContainer = item.querySelector(".gallery-matrix-preview");
      if (previewContainer) {
        // Generate new preview HTML
        const newPreviewHtml = this._renderSingleMatrixPreview(flippedColors, {
          rows,
          cols,
          bgColor: galleryBgColor,
          pixelStyle: galleryPixelStyle,
          pixelGap: galleryPixelGap,
          previewSize: galleryPreviewSize,
          ignoreBlackPixels,
          matrixBoxShadow: this.config.gallery_matrix_box_shadow === true,
          pixelBoxShadow: galleryPixelBoxShadow,
        });

        // Update only the preview content
        previewContainer.outerHTML = newPreviewHtml;
        updatedCount++;
      }
    });

    // "[Gradient Card] Updated preview images in",
    // wheelItems.length,
    // "wheel items"
    // );

    // Refresh active-mode highlighting on wheel items
    this._markActiveMode();
  }

  /**
   * Render a single matrix preview (delegates to shared renderMatrixPreview utility)
   */
  _renderSingleMatrixPreview(colorData, options) {
    return renderMatrixPreview(colorData, options);
  }

  /**
   * Update data-active-mode attributes on all gallery/wheel items in the DOM.
   * Called after DOM updates to keep the active-mode highlight in sync.
   */
  _markActiveMode() {
    const root = this.shadowRoot;
    if (!root) return;

    const highlightActive = this.config?.highlight_active_mode !== false;
    const currentMode = highlightActive ? this._getCurrentMode() : null;

    // Set host attribute so CSS can conditionally style wheel-centered items
    this.dataset.highlightActive = highlightActive ? "true" : "false";

    // Update gallery items (.gallery-item) and wheel items (.wheel-item)
    const allItems = root.querySelectorAll("[data-mode]");
    allItems.forEach((item) => {
      // Carousel: navigation = instant selection; the active-mode ring
      // would be a distracting flash on the only visible item.
      if (this._getDisplayMode() === "carousel") {
        item.removeAttribute("data-active-mode");
        return;
      }
      const mode = item.dataset.mode;
      if (highlightActive && currentMode && mode === currentMode) {
        item.setAttribute("data-active-mode", "true");
      } else {
        item.removeAttribute("data-active-mode");
      }
    });

    // Active-mode label chip: update text in place (independent of highlight)
    const label = root.getElementById("gc-active-mode-label");
    if (label) {
      const txt = label.querySelector(".gc-aml-text");
      const modeForLabel = this._getCurrentMode() || "—";
      if (txt && txt.textContent !== modeForLabel) {
        txt.textContent = modeForLabel;
      }
    }

    // Selection pulse: clear once the backend has confirmed (no optimistic
    // mode pending anymore)
    if (!this._optimisticMode) {
      root
        .querySelectorAll(".gc-pending")
        .forEach((el) => el.classList.remove("gc-pending"));

      // Release the carousel-navigating guard ONLY when the echoed backend
      // mode matches what the carousel is currently displaying.
      //
      // Critical timing issue this fixes: _gcCarouselNavigate calls
      // _updatePreviewSection() BEFORE _selectMode(), so _optimisticMode is
      // still null at that point. Without this check, the guard would be
      // released immediately, the sync block below would fire with the OLD
      // entity mode, and _carouselIndex would flash back to the previous item.
      if (this._carouselNavigating) {
        const _navModes = this._getVisibleModeList();
        const _displayedMode = _navModes[this._carouselIndex];
        const _echoedMode = this._getCurrentMode(); // entity, since _optimisticMode is null
        if (_displayedMode && _echoedMode === _displayedMode) {
          // Echo confirmed our navigation — safe to release the guard.
          this._setCarouselNavigating(false);
        }
        // If modes don't match yet, keep the guard: either the echo hasn't
        // arrived or _selectMode hasn't set _optimisticMode yet.
      }
    }

    // Carousel follows the active mode when it changes EXTERNALLY
    // (automations, another card, select entity) — but NEVER while the user
    // is navigating the carousel (_carouselNavigating) or while a selection
    // is in-flight (_processingModeChange / _optimisticMode).  Previously
    // a race between a fast echo clearing _optimisticMode and the finally
    // block clearing _processingModeChange allowed a brief window where
    // this block would reset _carouselIndex back to the OLD mode, causing
    // the carousel to flash the previous item before the echo arrived.
    if (
      this._getModeSelectorStyle() === "preview-carousel" &&
      !this._carouselNavigating &&
      !this._processingModeChange &&
      !this._optimisticMode &&
      this._carouselIndex != null
    ) {
      const activeMode = this._getCurrentMode();
      const modes = this._getVisibleModeList();
      const idx = activeMode ? modes.indexOf(activeMode) : -1;
      if (idx >= 0 && idx !== this._carouselIndex) {
        this._carouselIndex = idx;
        this._updatePreviewSection();
      }
    }
  }

  _attachPreviewEventListeners() {
    const root = this.shadowRoot;
    if (!root) return;

    // Item, carousel, pagination and swipe interactions are delegated from
    // the Lit-rendered preview host (see _onPreviewClick), so nothing is
    // bound per item here — only the active-mode highlight and the shared
    // wheel controller (which binds to the wheel DOM itself) are refreshed.

    // Mark the active mode item in the DOM
    this._markActiveMode();

    // Setup wheel mode navigation
    // After DOM update, we need to re-initialize if wheel was destroyed
    if (this._getDisplayMode() === "wheel") {
      if (!this._wheelNavigationController) {
        this._setupWheelNavigation();
      }
    }
  }

  /** Ordered list of currently visible gradient modes (matches preview items). */
  _getVisibleModeList() {
    // Fall back to the full visible mode list when preview data hasn't
    // arrived yet so carousel navigation works from the very first render.
    const data = this._previewCache().data;
    const modes = this._orderedModes();
    if (!data) return modes;
    return modes.filter((m) => data.previews[m]);
  }

  // In carousel mode navigation IS selection: one item displayed at a time,
  // moving to the next/previous immediately applies that mode to the lamp.
  _gcCarouselNavigate(direction) {
    const modes = this._getVisibleModeList();
    if (!modes.length) {
      return;
    }
    if (this._carouselIndex == null) {
      const active = this._getCurrentMode();
      const idx = active ? modes.indexOf(active) : -1;
      this._carouselIndex = idx >= 0 ? idx : 0;
    }
    const next =
      (((this._carouselIndex + direction) % modes.length) + modes.length) %
      modes.length;
    this._carouselIndex = next;
    // Show the new item IMMEDIATELY so the UI is responsive before the
    // service round-trip completes.
    this._setCarouselNavigating(true);
    this._updatePreviewSection();
    this._selectMode(modes[next]);
  }

  _gcCarouselSetIndex(index) {
    const modes = this._getVisibleModeList();
    if (!modes.length) return;
    const clamped = Math.max(0, Math.min(index, modes.length - 1));
    this._carouselIndex = clamped;
    this._setCarouselNavigating(true);
    this._updatePreviewSection();
    this._selectMode(modes[clamped]);
  }

  /**
   * Set / clear the _carouselNavigating guard.  While active, the
   * external-sync block in _markActiveMode is suppressed so no intermediate
   * state-change render can flash _carouselIndex back to the old mode.
   * Released automatically when the echo confirms the new mode, with a
   * 5 s safety timeout in case the echo never arrives.
   */
  _setCarouselNavigating(active) {
    if (this._carouselNavTimer) {
      clearTimeout(this._carouselNavTimer);
      this._carouselNavTimer = null;
    }
    this._carouselNavigating = !!active;
    if (active) {
      this._carouselNavTimer = setTimeout(() => {
        this._carouselNavTimer = null;
        this._carouselNavigating = false;
      }, 5000);
    }
  }

  /**
   * Selection feedback mechanic: pulse the chosen item(s) while the command
   * is in flight.  Cleared by _markActiveMode once the backend confirms.
   */
  _setPendingPulse(mode) {
    const root = this.shadowRoot;
    if (!root) return;
    // Carousel: navigation is instant selection; no in-flight pulse needed.
    if (this._getDisplayMode() === "carousel") return;
    root
      .querySelectorAll(".gc-pending")
      .forEach((el) => el.classList.remove("gc-pending"));
    if (!mode) return;
    root.querySelectorAll("[data-mode]").forEach((el) => {
      if (el.dataset.mode === mode) el.classList.add("gc-pending");
    });
  }

  _syncWheelToCurrentMode() {
    if (!this._wheelNavigationController) {
      // Self-healing: if controller is missing but we're in wheel mode with items in DOM, re-init
      const displayMode = this._getDisplayMode();
      const wheelExists = this.shadowRoot?.querySelector(
        ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
      );
      if (displayMode === "wheel" && wheelExists) {
        console.warn(
          "[Gradient Card] _syncWheelToCurrentMode: controller missing but wheel items exist — re-initializing",
          {
            displayMode,
            wheelItemsCount: this.shadowRoot?.querySelectorAll(
              ".wheel-item[data-mode], .wheel-compact-item[data-mode]",
            ).length,
          },
        );
        this._setupWheelNavigation();
      }
      return;
    }
    this._wheelNavigationController.sync();
  }

  _setupWheelNavigation() {
    const displayMode = this._getDisplayMode();

    // Clean up previous controller if exists
    if (this._wheelNavigationController) {
      this._wheelNavigationController.destroy();
      this._wheelNavigationController = null;
    }

    // Check if this is a re-initialization (preview update) or first load
    const isReInitializing = this._wheelReInitializing || false;
    this._wheelReInitializing = false; // Reset flag

    // Derive wheel display style from showTitles setting
    const showTitles = this.config.preview_show_titles !== false;
    const derivedConfig = {
      ...this.config,
      wheel_display_style: showTitles ? "default" : "compact",
    };

    // Initialize new controller
    const controller = initializeWheelNavigation({
      shadowRoot: this.shadowRoot,
      displayMode,
      config: derivedConfig,
      currentCenterIndex: this._wheelCenterIndex,
      immediate: isReInitializing, // Skip animation delay if re-initializing
      onModeSelect: async (mode, index) => {
        this._wheelCenterIndex = index;
        await this._selectMode(mode);
      },
      getCurrentMode: () => this._getCurrentMode(),
    });

    // Verify the controller actually found items — initializeWheelNavigation
    // returns a no-op stub when container/items are missing. Storing that stub
    // as truthy blocks later re-initialization when items DO appear in the DOM.
    const wheelItemsInDOM =
      this.shadowRoot?.querySelectorAll(
        '[data-wheel-item="true"], [data-wheel-compact-item="true"]',
      ).length || 0;

    if (wheelItemsInDOM === 0) {
      // Expected during connectedCallback before first render — not an error.
      controller.destroy();
      this._wheelNavigationController = null;
    } else {
      this._wheelNavigationController = controller;
      this._wheelCenterIndex = controller.getCenterIndex();
    }
  }

  /**
   * Signature of everything the preview grid shows (preview data and the
   * gallery settings), or null without preview data. The grid is only
   * re-rendered when it changes.
   */
  _previewDataHash() {
    const previewData = this._previewCache().data;
    return previewData
      ? JSON.stringify({
        text: previewData.text,
        angle: Math.round(previewData.angle * 10) / 10, // Round to 1 decimal
        bgColor: this.config.gallery_background_color,
        pixelStyle: this.config.gallery_pixel_style,
        pixelGap:
          this.config.gallery_spacing_mode ||
          this.config.gallery_pixel_spacing,
        previewSize: this.config.gallery_preview_size,
        ignoreBlack: this.config.gallery_ignore_black_pixels,
        matrixShadow: this.config.gallery_matrix_box_shadow,
        displayMode: this._getModeSelectorStyle(),
        showTitles: this.config.preview_show_titles,
        visibleModes: JSON.stringify(
          this.config.custom_visible_modes === true
            ? this.config.visible_modes || null
            : null,
        ),
        buttonShape: resolveSelectorButtonShape(this.config),
        itemsPerPage: this.config.items_per_page || 0,
        selectorPage: this._selectorPage || 0,
        wheelHeight: this.config.wheel_height,
        wheelNavPosition: this.config.wheel_nav_position,
      })
      : null;
  }

  _getCachedPreviewGrid() {
    // Only re-render if the preview data or settings actually changed
    const currentHash = this._previewDataHash();
    if (currentHash !== this._lastPreviewDataHash) {
      this._lastPreviewDataHash = currentHash;
      this._cachedPreviewHtml = this._renderPreviewGrid();
    }
    return this._cachedPreviewHtml || this._renderPreviewGrid();
  }

  _renderPreviewGrid() {
    const previewData = this._previewCache().data;
    if (!previewData) {
      return ``; // Return empty instead of "Loading previews..." message
    }

    const rows = previewData.rows || 5;
    const cols = previewData.cols || 20;
    // Get gallery settings from config
    const galleryBgColor = this.config.gallery_background_color || "black";
    const galleryPixelStyle = this.config.gallery_pixel_style || "square";
    const galleryPreviewSize = galleryPreviewSizeToPx(
      this.config.gallery_preview_size,
    );
    const galleryPixelGap =
      (this.config.gallery_spacing_mode ||
        (this.config.gallery_pixel_spacing !== false ? "normal" : "none")) ===
      "normal"
        ? 3
        : 0;
    const ignoreBlackPixels = this.config.gallery_ignore_black_pixels === true;
    const displayMode = this._getDisplayMode();
    const showTitles = this.config.preview_show_titles !== false;
    // Derive showCards per mode:
    //   list  → always plain
    //   compact → cards when titles on, plain when titles off
    //   wheel → always cards
    const showCards =
      displayMode === "wheel" || displayMode === "strip"
        ? true
        : displayMode === "compact"
          ? showTitles
          : false; // list = always plain

    // Prepare items for the shared gallery utility (visible modes only, in
    // the user's configured order).
    const items = this._orderedModes()
      .map((mode) => {
        const previewColors = previewData.previews[mode];
        if (!previewColors) return null;

        // Flip vertically: reverse rows to fix upside-down display
        const flippedColors = [];
        for (let row = rows - 1; row >= 0; row--) {
          for (let col = 0; col < cols; col++) {
            const color = previewColors[row * cols + col];
            flippedColors.push(color);
          }
        }

        return {
          title: mode.replace(" Gradient", ""),
          name: mode, // used by renderCarouselString for dot tooltips
          colorData: flippedColors,
          dataMode: mode, // For click handler
          metadata: null,
        };
      })
      .filter((item) => item !== null);

    // Render using shared utility.
    // IMPORTANT: the active-mode highlight is NOT baked into the HTML here.
    // _markActiveMode() applies it afterwards as DOM attributes on stable DOM.
    // Baking it made the generated string change on every mode switch, which
    // forced a full preview DOM replacement (= blink) on every selection.
    const highlightActive = this.config.highlight_active_mode !== false;

    // Resolve gallery pixel box shadow from spacing mode
    const gallerySpacingMode =
      this.config.gallery_spacing_mode ||
      (this.config.gallery_pixel_spacing !== false ? "normal" : "none");
    const galleryPixelBoxShadow =
      gallerySpacingMode === "subtle" || gallerySpacingMode === "normal";

    // Shared appearance axes (see resolveSelectorShape): applied through the
    // shell's data attributes + CSS overrides so the shared renderers stay
    // untouched and every display mode obeys the same shape setting.
    const selectorShape = resolveSelectorShape(this.config);
    const selectorButtonShape = resolveSelectorButtonShape(this.config);
    const selectorStyle = this._getModeSelectorStyle();
    const shellAttrs = `data-shape="${selectorShape}"${
      selectorStyle === "preview-grid" ? ' data-columns="2"' : ""
    }`;

    // Grid mode: halve the effective preview size so matrix previews fit
    // naturally within 2-column cells and the size slider has a visible
    // effect on item height.  Without this, items are clipped (overflow:hidden)
    // because a 450px preview doesn\'t fit a ~230px-wide column.
    // Strip mode: mini previews (scrollable row), so scale down further.
    const effectivePreviewSize =
      selectorStyle === "preview-grid"
        ? Math.round(galleryPreviewSize * 0.5)
        : selectorStyle === "preview-strip"
          ? Math.round(galleryPreviewSize * 0.4)
          : galleryPreviewSize;

    // ── Carousel display mode ─────────────────────────────────────────
    // Uses the shared renderCarouselString() so buttons and dots are
    // visually identical to every other carousel in the component suite.
    if (displayMode === "carousel") {
      if (this._carouselIndex == null) {
        const activeIdx = items.findIndex(
          (it) => it.dataMode === this._getCurrentMode(),
        );
        this._carouselIndex = activeIdx >= 0 ? activeIdx : 0;
      }
      this._carouselIndex = Math.max(
        0,
        Math.min(this._carouselIndex, items.length - 1),
      );

      const ci = this._carouselIndex;
      const item = items[ci];
      if (!item) return ``;

      return `
        <div class="gc-preview-shell" ${shellAttrs} style="border-radius:8px;">
          ${renderCarouselString({
            items,
            currentIndex: ci,
            buttonShape:
              selectorShapeToCarouselButtonShape(selectorButtonShape),
            showAsCard: true,
            carouselId: "gc-gradient-carousel",
            wrapNavigation: this.config.gallery_wrap_navigation === true,
            renderItemString: (it) => `
              <div class="gallery-item gc-carousel-item" data-mode="${it.dataMode}"
                   data-action="select-mode"
                   style="cursor:pointer;display:flex;flex-direction:column;align-items:center;
                          gap:6px;padding:10px;border-radius:8px;
                          background:${galleryBgColor === "transparent" ? "transparent" : galleryBgColor};
                          max-width:100%;box-sizing:border-box;transition:all 0.2s ease;">
                ${renderMatrixPreview(it.colorData, {
                  rows,
                  cols,
                  bgColor: galleryBgColor,
                  pixelStyle: galleryPixelStyle,
                  pixelGap: galleryPixelGap,
                  previewSize: galleryPreviewSize,
                  ignoreBlackPixels,
                  matrixBoxShadow:
                    this.config.gallery_matrix_box_shadow === true,
                  pixelBoxShadow: galleryPixelBoxShadow,
                })}
                ${showTitles ? `<div style="font-size:13px;font-weight:500;${galleryBgColor === "black" ? "color:#fff;" : "color:var(--primary-text-color);"}">` + it.dataMode + `</div>` : ""}
              </div>`,
          })}
        </div>`;
    }

    // List / grid modes: optional pagination via the shared utility (same
    // config key + controls as the palette and draw cards).
    let pagedItems = items;
    let paginationHtml = "";
    const itemsPerPage = parseInt(this.config.items_per_page) || 0;
    if (displayMode === "list" && itemsPerPage > 0) {
      const result = renderPagination({
        items,
        currentPage: this._selectorPage || 0,
        itemsPerPage,
      });
      pagedItems = result.items;
      paginationHtml = result.html;
      this._selectorPage = result.currentPage;
    }

    const galleryHtml = renderGalleryDisplay(pagedItems, displayMode, {
      rows,
      cols,
      bgColor: galleryBgColor,
      pixelStyle: galleryPixelStyle,
      pixelGap: galleryPixelGap,
      previewSize: effectivePreviewSize,
      ignoreBlackPixels,
      showCards,
      showTitles,
      onClickEnabled: true,
      matrixBoxShadow: this.config.gallery_matrix_box_shadow === true,
      pixelBoxShadow: galleryPixelBoxShadow,
      wheelNavPosition: this.config.wheel_nav_position || "bottom",
      wheelHeight: this.config.wheel_height || 300,
      wheelDisplayStyle: showTitles ? "default" : "compact",
      navButtonShape: selectorButtonShape,
      currentMode: null, // never bake the highlight — see comment above
      highlightActive,
    });

    return `
      <div class="gc-preview-shell" ${shellAttrs} style="border-radius: 8px;">
        ${galleryHtml}
        ${paginationHtml}
      </div>
    `;
  }

  async _loadPreviews() {
    if (!this.isConnected) return;
    // Preview data is only needed when the mode selector uses a preview style.
    // Text-style selectors skip the backend preview service entirely.
    if (!this._isPreviewSelectorActive()) return;

    // Ensure event subscription is active before requesting preview data
    if (!this._previewEventListenerRegistered && this._hass) {
      this._setupPreviewEventListener();
    }

    const entityId = this._getPrimaryEntity();
    if (!this._hass || !entityId) return;
    const context = this._previewContext;

    try {
      await gradientPreviewStore(this._hass.connection).request(
        this._hass,
        entityId,
      );
      if (context !== this._previewContext || !this.isConnected) return;

      // Reset retry counter on success
      this._previewRetryCount = 0;
    } catch (error) {
      if (context !== this._previewContext || !this.isConnected) return;
      // During HA startup, the light platform services may not be registered yet.
      // Also handle transient connection-lost errors.
      const errorCode = error?.code || error?.error?.code;
      const isTransient =
        errorCode === "not_found" ||
        errorCode === 3 ||
        errorCode === "connection-lost";
      if (isTransient) {
        const retryCount = (this._previewRetryCount || 0) + 1;
        this._previewRetryCount = retryCount;
        if (retryCount <= 5) {
          const delay = Math.min(retryCount * 2000, 10000); // 2s, 4s, 6s, 8s, 10s
          // Tracked + isConnected-guarded so a removed card stops retrying.
          if (this._previewRetryTimer) clearTimeout(this._previewRetryTimer);
          this._previewRetryTimer = setTimeout(() => {
            this._previewRetryTimer = null;
            if (!this.isConnected) return;
            this._loadPreviews();
          }, delay);
        } else {
          console.warn(
            "[Gradient Card] Preview load still failing after 5 retries. " +
              "Check device connectivity.",
          );
        }
        return;
      }
      console.error("[Gradient Card] Error loading previews:", error);
    }
  }

  _previewCache() {
    if (!this._hass?.connection) {
      return (this._emptyPreviewCache ||= {
        data: null,
        timestamp: 0,
        responseHash: null,
      });
    }
    return gradientPreviewStore(this._hass.connection).cache(
      this._getPrimaryEntity(),
    );
  }

  _setupPreviewEventListener() {
    if (
      this._previewEventListenerRegistered ||
      !this._hass?.connection ||
      !this.isConnected
    )
      return;
    // No subscription needed when the selector doesn't render previews
    if (!this._isPreviewSelectorActive()) return;

    this._previewEventListenerRegistered = true;

    this._unsubscribePreviewEvents = gradientPreviewStore(
      this._hass.connection,
    ).subscribe(this._getPrimaryEntity(), () => {
      if (!this.isConnected) return;

      // Update only the preview section instead of re-rendering entire card
      this._updatePreviewSection();

      // Fresh preview data arrived — if text preview mode is active and we are
      // NOT mid-drag, force the exact same path as toggling the "Show Text
      // Preview" switch: a synchronous this._renderCard() that rebuilds the full DOM
      // from the now-fresh cache.  Previous attempts using requestAnimationFrame
      // were silently blocked by the _renderScheduled guard when a set-hass
      // render was already queued.
      if (
        this.config?.matrix_rotary_text_preview === true &&
        !this._draggingRotary
      ) {
        this._renderScheduled = false; // clear any pending guard
        this._renderCard(); // full DOM rebuild from fresh cache
      }
    });
  }

  _updateGradientButtons(angle) {
    // Only the "chips" style renders angle-dependent gradient swatches that
    // need live updates during angle drags.  All other text styles use plain
    // labels, and preview styles update via the preview pipeline.
    if (this._getModeSelectorStyle() !== "chips") return;

    const textColors = this._getCurrentTextColors();

    // Chips style: live-update the two angle-dependent chip swatches
    ["Angle Gradient", "Letter Angle Gradient"].forEach((mode) => {
      this.shadowRoot
        .querySelectorAll(`.mode-chip[data-mode="${mode}"] .mode-chip-swatch`)
        .forEach((swatch) => {
          swatch.style.background = this.getModeGradientColors(
            mode,
            textColors,
            angle,
          );
        });
    });
  }

  getModeGradientColors(mode, textColors, currentAngle) {
    // Use default colors if none provided
    const colors =
      textColors && textColors.length > 0
        ? textColors
        : [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
          ];

    // Helper function to replicate Python's calculate_multi_gradient_color
    const calculateMultiGradientColor = (colors, position, totalPositions) => {
      if (!colors || colors.length === 0) return [255, 0, 0];
      if (colors.length === 1 || totalPositions <= 1) return colors[0];

      position = Math.max(0, Math.min(position, totalPositions - 1));
      const nSegments = colors.length - 1;
      const segmentLength =
        nSegments > 0 ? (totalPositions - 1) / nSegments : 1;
      const segment = Math.min(
        Math.floor(position / segmentLength),
        nSegments - 1,
      );

      const startColor = colors[segment];
      const endColor = colors[Math.min(segment + 1, colors.length - 1)];

      const localStart = segment * segmentLength;
      const localFactor =
        segmentLength > 0 ? (position - localStart) / segmentLength : 0;

      return [
        Math.round(startColor[0] + (endColor[0] - startColor[0]) * localFactor),
        Math.round(startColor[1] + (endColor[1] - startColor[1]) * localFactor),
        Math.round(startColor[2] + (endColor[2] - startColor[2]) * localFactor),
      ];
    };

    // RGB arrays are converted with the hardened shared rgbToCss
    // (./yeelight-cube-dotmatrix.js), which clamps every channel.

    // Create deterministic "random" based on colors array to avoid constant changes
    const colorHash = colors.map((c) => c.join(",")).join("|");
    let seed = 0;
    for (let i = 0; i < colorHash.length; i++) {
      seed = ((seed << 5) - seed + colorHash.charCodeAt(i)) & 0xffffffff;
    }

    // Simple deterministic random function
    const deterministicRandom = (index) => {
      const x = Math.sin(seed + index * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Create mini-preview gradients that replicate the actual mode calculations
    switch (mode) {
      case "Solid Color":
        // Use first color only
        return rgbToCss(colors[0]);

      case "Letter Gradient":
        // Each letter gets a different color - show discrete steps, not smooth gradient
        if (colors.length === 1) return rgbToCss(colors[0]);
        const letterSteps = colors
          .map((color, i) => {
            const startPercent = (i / colors.length) * 100;
            const endPercent = ((i + 1) / colors.length) * 100;
            return `${rgbToCss(color)} ${startPercent}% ${endPercent}%`;
          })
          .join(", ");
        return `linear-gradient(90deg, ${letterSteps})`;

      case "Column Gradient":
        // Vertical columns get gradient - show vertical gradient
        const colGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 columns
          const color = calculateMultiGradientColor(colors, i, 10);
          colGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(90deg, ${colGradient.join(", ")})`;

      case "Row Gradient":
        // Horizontal rows get gradient - show horizontal gradient
        const rowGradient = [];
        for (let i = 0; i < 10; i++) {
          // 10 rows
          const color = calculateMultiGradientColor(colors, i, 10);
          rowGradient.push(`${rgbToCss(color)} ${(i / 9) * 100}%`);
        }
        return `linear-gradient(0deg, ${rowGradient.join(", ")})`;

      case "Angle Gradient":
        // Directional gradient based on current angle setting
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const angleDeg = -(currentAngle || 0) + 90;
        const angleGradient = [];
        for (let i = 0; i < colors.length; i++) {
          angleGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(${angleDeg}deg, ${angleGradient.join(", ")})`;

      case "Radial Gradient":
        // Radial from center outward
        const radialGradient = [];
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          const distance = i / (steps - 1);
          const color = calculateMultiGradientColor(
            colors,
            distance * (colors.length - 1),
            colors.length,
          );
          radialGradient.push(`${rgbToCss(color)} ${(i / (steps - 1)) * 100}%`);
        }
        return `radial-gradient(circle, ${radialGradient.join(", ")})`;

      case "Letter Vertical Gradient":
        // Vertical gradient within each letter - columns get different colors (left to right)
        const letterVertGradient = [];
        for (let i = 0; i < colors.length; i++) {
          letterVertGradient.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        return `linear-gradient(90deg, ${letterVertGradient.join(", ")})`;

      case "Letter Angle Gradient":
        // Angle gradient within each letter using current angle setting
        // Convert from rotary coordinate system (0° = right) to CSS gradient system (0° = up)
        // and invert to match rotary control rotation direction
        const letterAngleGrad = [];
        for (let i = 0; i < colors.length; i++) {
          letterAngleGrad.push(
            `${rgbToCss(colors[i])} ${(i / (colors.length - 1)) * 100}%`,
          );
        }
        const letterAngle = -(currentAngle || 0) + 90;
        return `linear-gradient(${letterAngle}deg, ${letterAngleGrad.join(
          ", ",
        )})`;

      case "Text Color Sequence":
        // Random/shuffled colors - create discrete color blocks that fill the button
        if (colors.length === 1) return rgbToCss(colors[0]);

        // Create a checkerboard pattern of color squares using CSS patterns
        // Simple approach: create alternating color stripes in both directions

        // Pick 4 random colors for a 2x2 repeating pattern
        const patternColors = [];
        for (let i = 0; i < 4; i++) {
          const randomValue = deterministicRandom(i);
          const randomColorIndex = Math.floor(randomValue * colors.length);
          patternColors.push(colors[randomColorIndex]);
        }

        // Create horizontal stripes (rows)
        const verticalStripes = `repeating-linear-gradient(90deg, 
          ${rgbToCss(patternColors[2])} 0%, ${rgbToCss(patternColors[2])} 25%, 
          ${rgbToCss(patternColors[3])} 25%, ${rgbToCss(patternColors[3])} 50%,
          ${rgbToCss(patternColors[0])} 50%, ${rgbToCss(patternColors[0])} 75%,
          ${rgbToCss(patternColors[1])} 75%, ${rgbToCss(
            patternColors[1],
          )} 100%)`;

        // Combine both to create a grid effect
        return verticalStripes;

      default:
        return rgbToCss(colors[0]);
    }
  }

  generateColorModeSelector(colorMode, style, textColors, currentAngle) {
    // Shared appearance axes — identical semantics across every style
    const selShape = resolveSelectorShape(this.config);
    const selScale = resolveSelectorTextScale(this.config);
    const allModes = [
      { value: "Solid Color", label: "Solid" },
      { value: "Letter Gradient", label: "Letter Grad" },
      { value: "Column Gradient", label: "Column Grad" },
      { value: "Row Gradient", label: "Row Grad" },
      { value: "Angle Gradient", label: "Angle Grad" },
      { value: "Radial Gradient", label: "Radial Grad" },
      { value: "Letter Vertical Gradient", label: "Letter Vert" },
      { value: "Letter Angle Gradient", label: "Letter Angle" },
      { value: "Text Color Sequence", label: "Color Seq" },
    ];
    // Same visibility/order config as the preview styles.
    const byValue = new Map(allModes.map((m) => [m.value, m]));
    const modes = this._orderedModes()
      .map((name) => byValue.get(name))
      .filter(Boolean);

    switch (style) {
      case "chips":
        // Chip style: HA-chip-like pills with a live gradient swatch per mode
        return html`
          <div class="gc-selector color-mode-chips yc-row" data-shape=${selShape} style="--gc-sel-scale:${selScale};">
            ${modes.map((mode) => {
              let swatchBg;
              if (mode.value === "Text Color Sequence") {
                // Conic-gradient "pie" with up to 4 colors gives a
                // compact multi-color swatch that reflects the randomness
                // of the mode — much clearer than vertical stripes.
                const stops = textColors.slice(0, 4);
                while (stops.length < 4)
                  stops.push(stops[stops.length - 1] || [200, 200, 200]);
                const pct = 100 / stops.length;
                swatchBg = `conic-gradient(${stops
                  .map(
                    (c, i) =>
                      `${rgbToCss(c)} ${i * pct}% ${(i + 1) * pct}%`,
                  )
                  .join(", ")})`;
              } else {
                swatchBg = this.getModeGradientColors(
                  mode.value,
                  textColors,
                  currentAngle,
                );
              }
              return html`
              <button class="mode-chip ${
                colorMode === mode.value ? "active" : ""
              }" data-mode=${mode.value} title=${mode.value} @click=${this._onModeButtonClick}>
                <span class="mode-chip-swatch" style="background:${swatchBg}"></span>
                <span class="mode-chip-label">${mode.label}</span>
              </button>
            `;
            })}
          </div>`;

      case "dropdown":
        return html`
          <div class="gc-selector color-mode-dropdown" data-shape=${selShape} style="--gc-sel-scale:${selScale};">
            <select class="mode-select" data-mode-select="true"
              @focus=${this._onModeDropdownFocus}
              @blur=${this._onModeDropdownBlur}
              @change=${this._onModeDropdownChange}>
              ${modes.map(
                (mode) => html`
                <option value=${mode.value} ?selected=${colorMode === mode.value}>
                  ${mode.value}
                </option>
              `,
              )}
            </select>
          </div>`;

      case "compact":
      case "pills":
      case "buttons":
      case "filled":
      default:
        // Unified "Filled" text style (legacy buttons/pills/compact fall here).
        return html`
          <div class="gc-selector color-mode-filled yc-row" data-shape=${selShape} style="--gc-sel-scale:${selScale};">
            ${modes.map(
              (mode) => html`
              <button class="mode-btn-filled ${
                colorMode === mode.value ? "active" : ""
              }"
                      data-mode=${mode.value}
                      title=${mode.label}
                      @click=${this._onModeButtonClick}>
                ${mode.label}
              </button>
            `,
            )}
          </div>`;
    }
  }
};
