// Pixel-art collection actions of the draw card: apply, rename, delete, reorder,
// import/export, and refreshing the shared list from the backend (with the
// optimistic overlays kept until it confirms). Mixed into YeelightCubeDrawCard.
import { CollectionState } from "./collection-state.js";
import { notifyUnreported } from "./notify-utils.js";
import { createEmptyMatrix } from "./draw_utils.js";
import { expandPixelArt } from "./pixel-art-utils.js";
import { MATRIX_SIZE, GRID_COLS, GRID_ROWS } from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";

export const PixelArtActionsMixin = (Base) => class extends Base {
  get _pendingReorderedPixelArts() {
    return this._pixelArtCollection?.pending?.items ?? null;
  }

  set _pendingReorderedPixelArts(items) {
    const collection = (this._pixelArtCollection ||= new CollectionState());
    if (items) collection.record(items);
    else collection.reset();
  }

  get _pendingReorderTs() {
    return this._pixelArtCollection?.pending?.timestamp;
  }

  set _pendingReorderTs(timestamp) {
    if (this._pixelArtCollection?.pending)
      this._pixelArtCollection.pending.timestamp = timestamp;
  }

  _saveReorderedPixelArts(pixelArts, move = null) {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor) return;

    // A drag moves one item: ask the server to move just that item so pixel
    // arts added by other clients in the meantime are kept. Only fall back to
    // replacing the whole collection when the order changed in another way.
    const collection = (this._pixelArtCollection ||= new CollectionState());
    const operation = collection.pending;
    return collection
      .execute(
        this.hass,
        move ? "move_pixel_art" : "update_pixel_arts",
        move || { pixel_arts: pixelArts, replace: true },
      )
      .then((success) => {
        if (!success)
          throw new Error("The pixel-art collection changed. Please retry.");
        this._isDragging = false;
      })
      .catch((error) => {
        console.error("[PixelArt] Failed to save reordered pixel arts:", error);
        this._isDragging = false;
        if (collection.rollback(operation)) this.requestUpdate();
      });
  }

  // Grid mode event handlers
  handleGridItemClick(event, idx) {
    const context = this._gridContext || {};
    const globalIdx = (context.globalOffset || 0) + idx;
    this._handlePixelArtCanvasClick(globalIdx, context.autoApplyToLamp);
  }

  handleGridDelete(event, idx) {
    const context = this._gridContext || {};
    const globalIdx = (context.globalOffset || 0) + idx;

    // Create a proper fake event with the button as target
    const button = event.target.closest("button");
    if (!button) return;

    // Create a fake button element with the index in dataset
    const fakeButton = {
      classList: button.classList,
      dataset: { index: globalIdx, action: "remove" },
      closest: (selector) => {
        if (selector === "button") return fakeButton;
        return null;
      },
    };

    this._handleGalleryClick({
      target: fakeButton,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }

  handleGridTitleClick(event, idx) {
    const context = this._gridContext || {};
    const globalIdx = (context.globalOffset || 0) + idx;
    this._handleRenameClick(event, globalIdx);
  }

  async _handlePixelArtCanvasClick(idx, autoApplyToLamp) {
    try {
      // Always apply to matrix; send it to the lamp only if that worked
      // (otherwise the lamp would just get the previous drawing again).
      const applied = await this._applyPixelArtToMatrix(idx);
      if (!applied) {
        throw new Error(
          this._pixelArtProblem || "This pixel art could not be loaded.",
        );
      }

      // If auto-apply is enabled, also send current matrix to lamp
      if (autoApplyToLamp) {
        await this._sendToLamp({ latestOnly: true });
      }
    } catch (err) {
      this._reportFailure(err, "Failed to apply the pixel art to the lamp.");
    }
  }

  _handleGalleryClick(e) {
    // Check if click is on a clickable title element (for rename)
    const titleElement = e.target.closest(".pixelart-name.clickable");

    if (titleElement && titleElement.dataset.index !== undefined) {
      const idx = parseInt(titleElement.dataset.index);
      if (!isNaN(idx) && idx >= 0) {
        this._handleRenameClick(e, idx);
        return;
      }
    }

    // Check for button clicks
    e.preventDefault();
    e.stopPropagation();

    const target = e.target.closest("button");
    if (!target) return;

    // Ignore navigation buttons and carousel indicators (they have their own handlers)
    if (
      target.classList.contains("carousel-nav") ||
      target.classList.contains("carousel-dot") ||
      target.classList.contains("carousel-indicator") ||
      target.classList.contains("mode-btn")
    ) {
      return;
    }

    // Get index from button's data attributes OR from parent .compact-item
    // For compact mode with drag-and-drop, data-idx is only on the parent element
    let index = null;

    if (target.dataset.index !== undefined) {
      index = parseInt(target.dataset.index);
    } else if (target.dataset.idx !== undefined) {
      index = parseInt(target.dataset.idx);
    } else {
      // Check parent .compact-item for data-idx (used in compact mode after drag-and-drop)
      const compactItem = target.closest(".compact-item");
      if (compactItem && compactItem.dataset.idx !== undefined) {
        index = parseInt(compactItem.dataset.idx);
      }
    }

    // Buttons without an index (pagination, ...) have their own handlers;
    // their clicks only bubble through here.
    if (index === null || isNaN(index)) return;

    if (target.classList.contains("apply-btn")) {
      this._applyPixelArt(index);
    } else if (target.classList.contains("apply-matrix-btn")) {
      this._applyPixelArtToMatrix(index);
    } else if (
      target.classList.contains("delete-btn") ||
      target.classList.contains("delete-btn-cross") ||
      target.dataset.action === "remove"
    ) {
      // INSTANT UI UPDATE: Remove the DOM element immediately for instant visual feedback
      const compactItem = target.closest(".compact-item");
      if (compactItem) {
        compactItem.style.transition = "opacity 0.2s, transform 0.2s";
        compactItem.style.opacity = "0";
        compactItem.style.transform = "scale(0.8)";
        setTimeout(() => compactItem.remove(), 200);
      }

      this._deletePixelArt(index);
    } else if (target.classList.contains("mode-btn")) {
      const mode = target.dataset.mode;
      if (mode) {
        this.galleryMode = mode;
        this.requestUpdate();
      }
    }
  }

  _applyPendingRenames(pixelArts) {
    return this._pendingReorderedPixelArts ?? pixelArts;
  }

  async _handleRenameClick(e, idx) {
    e.preventDefault();
    e.stopPropagation();

    // Get sensor entity from config
    const sensorEntityId = this.config.pixelart_sensor;
    if (!sensorEntityId || !this.hass) {
      console.error("[Rename] No sensor entity configured");
      return;
    }

    const stateObj = this._pixelArtState(sensorEntityId);
    if (!stateObj) {
      console.error("[Rename] Sensor entity not found:", sensorEntityId);
      return;
    }

    // Get current pixel arts from sensor
    const pixelArts =
      this._pendingReorderedPixelArts ?? stateObj.attributes.pixel_arts ?? [];

    if (idx < 0 || idx >= pixelArts.length) {
      console.error(
        "[Rename] Invalid index:",
        idx,
        "length:",
        pixelArts.length,
      );
      return;
    }

    const currentArt = pixelArts[idx];
    const currentName = currentArt.name || "Unnamed";

    // Show prompt for new name
    const newName = prompt(`Rename pixel art:`, currentName);

    // If user cancelled or entered empty name, don't change
    if (newName === null || newName.trim() === "") {
      return;
    }

    const renamed = { ...currentArt, name: newName.trim() };
    this._pendingReorderedPixelArts = pixelArts.map((art, index) =>
      index === idx ? renamed : art,
    );
    const collection = this._pixelArtCollection;
    const operation = collection.pending;
    const context = this._collectionContext;
    this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
    this.requestUpdate();

    // Call service to rename (pixel arts are global, use callGlobalService)
    try {
      const success = await collection.execute(this.hass, "rename_pixel_art", {
        idx: idx,
        name: newName.trim(),
        expected_name: currentArt.name,
      });
      if (!success)
        throw new Error("The pixel-art collection changed. Please retry.");
      if (context !== this._collectionContext) return;

      // Trigger sensor update
      await this._refreshEntity(sensorEntityId);

      // The content_hash-triggered fetch in `set hass` can race the backend and
      // cache the pre-rename array, leaving _hass stale until a full reload.
      // Force a fresh fetch (retrying until the server echoes the new name) so
      // the overlay can retire cleanly and pagination re-renders show the truth.
      if (context !== this._collectionContext) return;
      await this._forceRefreshPixelArts(sensorEntityId, renamed);
      if (context !== this._collectionContext) return;

      // Trigger UI update
      window.dispatchEvent(new Event("pixelart-saved"));
    } catch (error) {
      if (!collection.rollback(operation)) return;
      console.error("[Rename] Failed to rename pixel art:", error);
      // HA already toasted service failures; only report local ones
      // (e.g. the collection-changed conflict thrown above).
      notifyUnreported(this, error);

      // Drop the overlay so the UI falls back to the real (unchanged) name.
      this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
      this.requestUpdate();
    }
  }

  async _applyPixelArt(idx) {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor) {
      console.error(
        "[draw-card] Cannot apply pixel art: missing hass or pixelart_sensor",
      );
      return;
    }

    // Debounce: if user clicks multiple pixel arts rapidly, only send the last one.
    // This prevents overwhelming the lamp with back-to-back TCP connections.
    if (this._applyPixelArtTimer) {
      clearTimeout(this._applyPixelArtTimer);
    }
    this._applyPixelArtTimer = setTimeout(async () => {
      this._applyPixelArtTimer = null;
      try {
        const shown =
          this._pendingReorderedPixelArts ??
          this._pixelArtState(pixelartSensor)?.attributes?.pixel_arts ??
          [];
        await this.callServiceOnTargetEntities("apply_pixel_art", {
          idx,
          expected_name: shown[idx]?.name,
        });
        await this._refreshEntity(pixelartSensor);
        window.dispatchEvent(new Event("pixelart-saved"));
      } catch (err) {
        this._reportFailure(err, "Failed to apply the pixel art.");
      }
    }, 300);
  }

  /** Load pixel art ``idx`` into the drawing matrix. Returns true if it was
   * loaded; otherwise false, with the reason in ``_pixelArtProblem``. */
  async _applyPixelArtToMatrix(idx) {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;
    this._pixelArtProblem = null;
    const fail = (problem, detail) => {
      this._pixelArtProblem = problem;
      console.error(`[draw-card] ${problem}`, detail ?? "");
      return false;
    };

    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      return fail(
        "Cannot apply pixel art to matrix: missing hass or pixelart_sensor",
      );
    }

    try {
      const stateObj = this._pixelArtState(pixelartSensor);
      // The list the gallery shows (including a pending rename/reorder), so
      // the index clicked is the art the user saw.
      const pixelArts = this._applyPendingRenames(
        stateObj.attributes.pixel_arts || [],
      );
      const pixelArt = pixelArts[idx];

      if (!pixelArt || !pixelArt.pixels) {
        return fail(
          `Pixel art ${idx} not found or has no pixels (the card has ${pixelArts.length} pixel arts).`,
          pixelArt,
        );
      }
      let placed = 0;

      const previous = this.matrix;
      this._pushMatrixHistory();

      // Start with black matrix (same as image upload)
      this.matrix = createEmptyMatrix();

      // Apply pixel art with row flipping to match preview display
      // Preview uses: row = (GRID_ROWS-1) - Math.floor(pos / GRID_COLS) to flip rows vertically
      for (const px of expandPixelArt(pixelArt)) {
        const position = px.position;
        const color = px.color;

        if (
          position >= 0 &&
          position < MATRIX_SIZE &&
          Array.isArray(color) &&
          color.length >= 3
        ) {
          // Convert RGB array to hex (same as image upload)
          const r = color[0];
          const g = color[1];
          const b = color[2];
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b)
            .toString(16)
            .slice(1)}`;

          // Apply with row flipping to match preview display
          // Original position: row = Math.floor(position / GRID_COLS), col = position % GRID_COLS
          // Flipped row: flippedRow = (GRID_ROWS-1) - row (same as preview rendering)
          const originalRow = Math.floor(position / GRID_COLS); // 0-4
          const col = position % GRID_COLS; // 0-19
          const flippedRow = GRID_ROWS - 1 - originalRow; // Flip vertically
          const matrixPosition = flippedRow * GRID_COLS + col;

          if (matrixPosition >= 0 && matrixPosition < MATRIX_SIZE) {
            this.matrix[matrixPosition] = hex;
            placed++;
          }
        }
      }
      if (!placed) {
        // Keep the previous drawing rather than send an empty one, and show
        // what the stored data looks like.
        this.matrix = previous;
        this._matrixHistory?.pop();
        return fail(
          `Pixel art "${pixelArt.name}" has no pixel this card can read.`,
          JSON.stringify(pixelArt.pixels.slice(0, 3)),
        );
      }

      StorageUtils.saveMatrix(this.matrix);
      this.requestUpdate();
      return true;
    } catch (err) {
      return fail(`Error applying pixel art ${idx} to matrix: ${err?.message || err}`, err);
    }
  }

  /**
   * Delete a pixel art by calling the backend service.
   * Backend updates sensor → websocket pushes update → card re-renders → album re-initializes.
   */
  /**
   * Fetch fresh pixel_arts from the REST API and patch _hass directly.
   * This bypasses the websocket limitation where HA doesn't resend large attribute
   * arrays (only scalar attributes like count/content_hash are pushed via websocket).
   * Called whenever content_hash changes in set hass.
   */
  async _fetchFreshPixelArts(sensorEntityId) {
    if (!this._hass || !sensorEntityId) return;
    // Debounce: avoid parallel fetches
    if (this._fetchingPixelArts) return;
    this._fetchingPixelArts = true;
    const context = this._collectionContext;
    try {
      // The scalar content_hash arrives via websocket first; the REST endpoint can
      // still return a pre-update snapshot for a tick. Retry until the fetched
      // content_hash matches the advertised one so we never cache a stale (e.g.
      // pre-rename) array over good data.
      const expectedHash = this._lastPixelArtHash;
      for (let attempt = 0; attempt < 5; attempt++) {
        const freshState = await this._hass.callApi(
          "GET",
          `states/${sensorEntityId}`,
        );
        if (context !== this._collectionContext) return;
        if (!freshState?.attributes?.pixel_arts) break;
        const freshHash = freshState.attributes?.content_hash;
        if (expectedHash != null && freshHash !== expectedHash && attempt < 4) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        // Overlay the fresh array (read via _pixelArtState) instead of
        // copying hass.states or re-triggering set hass logic.
        this._pixelArtOverlay = {
          sensorId: sensorEntityId,
          attributes: {
            pixel_arts:
              this._pixelArtCollection?.observe(
                freshState.attributes.pixel_arts,
                freshState.attributes.count,
              ) ?? freshState.attributes.pixel_arts,
          },
        };
        this._freshPixelArts = freshState.attributes.pixel_arts;
        this._freshPixelArtsHash = freshHash;
        this._lastPixelArtHash = freshHash;
        this._lastPixelArtCount = freshState.attributes?.count;
        this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
        this.requestUpdate();
        break;
      }
    } catch (err) {
      console.warn("[PixelArt] Failed to fetch fresh pixel arts:", err);
    } finally {
      if (context === this._collectionContext) this._fetchingPixelArts = false;
    }
  }

  async _forceRefreshPixelArts(sensorEntityId, expectedArt) {
    if (!this._hass || !sensorEntityId) return;
    const context = this._collectionContext;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const freshState = await this._hass.callApi(
          "GET",
          `states/${sensorEntityId}`,
        );
        if (context !== this._collectionContext) return;
        const arts = freshState?.attributes?.pixel_arts;
        if (
          arts?.some(
            (art) => JSON.stringify(art) === JSON.stringify(expectedArt),
          )
        ) {
          this._pixelArtOverlay = {
            sensorId: sensorEntityId,
            attributes: {
              pixel_arts:
                this._pixelArtCollection?.observe(
                  arts,
                  freshState.attributes.count,
                ) ?? arts,
            },
          };
          this._freshPixelArts = arts;
          this._freshPixelArtsHash = freshState.attributes?.content_hash;
          this._lastPixelArtHash = freshState.attributes?.content_hash;
          this._lastPixelArtCount = freshState.attributes?.count;
          this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
          this.requestUpdate();
          return; // server confirmed
        }
      } catch (err) {
        console.warn("[Rename] Force refresh failed:", err);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async _deletePixelArt(idx) {
    // Get current sensor state
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;
    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      console.error("[Delete] No sensor found");
      return;
    }

    const stateObj = this._pixelArtState(pixelartSensor);

    // Use pending reordered pixel arts if available (after drag-and-drop, before websocket confirms)
    // Otherwise use the sensor's pixel arts
    const pixelArts =
      this._pendingReorderedPixelArts || stateObj.attributes.pixel_arts || [];

    if (pixelArts[idx]) {
      // pixel art exists, proceed
    } else {
      console.error("[Delete] No pixel art found at index:", idx);
      return;
    }

    // OPTIMISTIC UPDATE: Remove from local state immediately for instant UI feedback
    const updatedPixelArts = [...pixelArts];
    updatedPixelArts.splice(idx, 1);

    this._pendingReorderedPixelArts = updatedPixelArts;
    const collection = this._pixelArtCollection;
    const operation = collection.pending;

    // Overlay the optimistic state (read via _pixelArtState); keep the
    // previous overlay so a failed delete can restore exactly what was shown.
    const previousOverlay = this._pixelArtOverlay;
    this._pixelArtOverlay = {
      sensorId: pixelartSensor,
      attributes: {
        pixel_arts: updatedPixelArts,
        count: updatedPixelArts.length,
      },
    };

    // Trigger re-render
    this.requestUpdate();

    // Then call backend (websocket update will eventually sync, but UI is already updated)
    try {
      if (
        !(await collection.execute(this.hass, "remove_pixel_art", {
          idx,
          expected_name: pixelArts[idx].name,
        }))
      ) {
        throw new Error("The pixel-art collection changed. Please retry.");
      }
    } catch (err) {
      console.error("[PIXELART-DELETE] Error calling backend:", err);
      if (collection.rollback(operation)) {
        notifyUnreported(this, err);
        this._pixelArtOverlay = previousOverlay;
        this.requestUpdate();
        this._fetchFreshPixelArts(pixelartSensor);
      }
    }
  }

  async _exportPixelArts() {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      console.error("[draw-card] Pixel art sensor not found for export");
      return;
    }

    const stateObj = this._pixelArtState(pixelartSensor);
    const pixelArts = stateObj.attributes.pixel_arts || [];

    const json = JSON.stringify(pixelArts, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yeelight_pixel_arts.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  _triggerImportFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", (e) => this._importPixelArts(e));
    input.click();
  }

  async _importPixelArts(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor) {
      this._showImportStatus("error");
      return;
    }

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (!Array.isArray(imported)) {
        throw new Error("Invalid format: Expected an array of pixel arts");
      }

      // Validate each pixel art has required structure
      for (const art of imported) {
        if (!art || typeof art !== "object" || !Array.isArray(art.pixels)) {
          throw new Error("Invalid pixel art format");
        }
      }

      // Send to backend — replace: false (default) so the backend appends to the existing collection
      const collection = (this._pixelArtCollection ||= new CollectionState());
      if (
        !(await collection.execute(this.hass, "update_pixel_arts", {
          pixel_arts: imported,
        }))
      )
        throw new Error("The pixel-art collection changed. Please retry.");

      await this._refreshEntity(pixelartSensor);

      window.dispatchEvent(new Event("pixelart-saved"));
      this._showImportStatus("success");
    } catch (err) {
      console.error("[draw-card] Import failed:", err);
      this._showImportStatus("error");
      // Invalid files and collection conflicts are not reported by HA.
      notifyUnreported(
        this,
        err,
        err instanceof SyntaxError ? "Invalid pixel art file." : undefined,
      );
    }

    // Clear the file input safely
    try {
      if (e.target) {
        e.target.value = "";
      }
    } catch (clearErr) {
      console.warn("[draw-card] Could not clear file input:", clearErr);
    }
  }

  _showImportStatus(type) {
    // Set import status for button display
    this._importStatus = { showing: true, type };
    this.requestUpdate();

    // Clear status after delay
    setTimeout(
      () => {
        this._importStatus = { showing: false, type: null };
        this.requestUpdate();
      },
      type === "success" ? 2000 : 4000,
    );
  }
};
