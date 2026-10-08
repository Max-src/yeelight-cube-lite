// Pixel-art collection actions of the draw card, called by its gallery
// (collection-gallery.js): load, rename, delete; import/export, and
// refreshing the shared list from the backend (with the optimistic overlays
// kept until it confirms). Reordering is the editor's Arrange list.
// Mixed into YeelightCubeDrawCard.
import { CollectionState } from "./collection-state.js";
import { notifyUnreported } from "./notify-utils.js";
import { createEmptyMatrix } from "./draw_utils.js";
import { expandPixelArt, pixelArtDisplayIndex } from "./pixel-art-utils.js";
import { MATRIX_SIZE } from "./draw_card_const.js";
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

  // The list shown: the stored one with this card's pending edits.
  _applyPendingRenames(pixelArts) {
    return this._pendingReorderedPixelArts ?? pixelArts;
  }

  // Rename pixel art `idx` (the gallery's rename bar gives the name).
  // Resolves true once saved, false when refused or failed (rolled back).
  async _renamePixelArt(idx, newName) {
    const name = String(newName ?? "").trim();
    const sensorEntityId = this.config.pixelart_sensor;
    const stateObj = sensorEntityId && this._pixelArtState(sensorEntityId);
    if (!name || !stateObj) return false;
    const pixelArts =
      this._pendingReorderedPixelArts ?? stateObj.attributes.pixel_arts ?? [];
    const currentArt = pixelArts[idx];
    if (!currentArt) return false;

    const renamed = { ...currentArt, name };
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
        name,
        expected_name: currentArt.name,
      });
      if (!success)
        throw new Error("The pixel-art collection changed. Please retry.");
      if (context !== this._collectionContext) return true;

      // Trigger sensor update
      await this._refreshEntity(sensorEntityId);

      // The content_hash-triggered fetch in `set hass` can race the backend and
      // cache the pre-rename array, leaving _hass stale until a full reload.
      // Force a fresh fetch (retrying until the server echoes the new name) so
      // the overlay can retire cleanly and pagination re-renders show the truth.
      if (context !== this._collectionContext) return true;
      await this._forceRefreshPixelArts(sensorEntityId, renamed);
      if (context !== this._collectionContext) return true;

      // Trigger UI update
      window.dispatchEvent(new Event("pixelart-saved"));
      return true;
    } catch (error) {
      if (!collection.rollback(operation)) return false;
      console.error("[Rename] Failed to rename pixel art:", error);
      // HA already toasted service failures; only report local ones
      // (e.g. the collection-changed conflict thrown above).
      notifyUnreported(this, error);

      // Drop the overlay so the UI falls back to the real (unchanged) name.
      this.pixelArtVersion = (this.pixelArtVersion || 0) + 1;
      this.requestUpdate();
      return false;
    }
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

      // Stored rows count from the lamp's bottom row, the drawing's from
      // the top: the same placement as every preview (pixelArtDisplayIndex).
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

          const matrixPosition = pixelArtDisplayIndex(position);

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

  // Delete pixel art `idx` (confirmed in the gallery's bar), shown at once.
  // Resolves true once deleted, false when refused or failed (rolled back).
  async _deletePixelArt(idx) {
    // Get current sensor state
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;
    if (!this.hass || !pixelartSensor || !this._pixelArtState(pixelartSensor)) {
      console.error("[Delete] No sensor found");
      return false;
    }

    const stateObj = this._pixelArtState(pixelartSensor);

    // Use pending reordered pixel arts if available (after drag-and-drop, before websocket confirms)
    // Otherwise use the sensor's pixel arts
    const pixelArts =
      this._pendingReorderedPixelArts || stateObj.attributes.pixel_arts || [];

    if (!pixelArts[idx]) {
      console.error("[Delete] No pixel art found at index:", idx);
      return false;
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
      return true;
    } catch (err) {
      console.error("[PIXELART-DELETE] Error calling backend:", err);
      if (collection.rollback(operation)) {
        notifyUnreported(this, err);
        this._pixelArtOverlay = previousOverlay;
        this.requestUpdate();
        this._fetchFreshPixelArts(pixelartSensor);
      }
      return false;
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
