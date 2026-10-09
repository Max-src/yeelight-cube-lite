// Pixel-art collection actions of the draw card, called by its gallery
// (collection-gallery.js): load, rename, delete; import/export, and
// refreshing the shared list from the backend (with the optimistic overlays
// kept until it confirms). Reordering is the editor's Arrange list.
// Mixed into YeelightCubeDrawCard.
import { notifyUnreported } from "./notify-utils.js";
import { createEmptyMatrix } from "./draw_utils.js";
import { expandPixelArt, pixelArtDisplayIndex } from "./pixel-art-utils.js";
import { MATRIX_SIZE } from "./draw_card_const.js";
import { StorageUtils } from "./draw_card_storage.js";

export const PixelArtActionsMixin = (Base) => class extends Base {
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

  // Rename pixel art `idx` (the gallery's rename bar gives the name): shown
  // at once, then saved; the sensor is refreshed until it shows the new
  // name. Resolves true once saved, false when refused or failed (rolled
  // back; a local conflict is reported).
  async _renamePixelArt(idx, newName) {
    const name = String(newName ?? "").trim();
    const sensor = this.config.pixelart_sensor;
    const arts = this._pixelArts();
    const current = arts[idx];
    if (!name || !sensor || !current) return false;
    const renamed = { ...current, name };
    const store = this._pixelArtStore;
    const saved = await store.edit(
      this.hass,
      arts.map((art, index) => (index === idx ? renamed : art)),
      "rename_pixel_art",
      { idx, name, expected_name: current.name },
      { onError: (error) => notifyUnreported(this, error) },
    );
    if (!saved) return false;
    const context = store.context;
    await this._refreshEntity(sensor);
    if (context !== store.context) return true;
    // A state update can carry the content hash before the array: wait for
    // the array that holds the new name.
    const expected = JSON.stringify(renamed);
    await store.fetch(this.hass, sensor, (items) =>
      items.some((art) => JSON.stringify(art) === expected),
    );
    window.dispatchEvent(new Event("pixelart-saved"));
    return true;
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

    if (!this.hass || !pixelartSensor || !this._pixelArtSensorState()) {
      return fail(
        "Cannot apply pixel art to matrix: missing hass or pixelart_sensor",
      );
    }

    try {
      // The list the gallery shows (including a pending edit), so the index
      // clicked is the art the user saw.
      const pixelArts = this._pixelArts();
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

  // Delete pixel art `idx` (confirmed in the gallery's bar): shown at once,
  // then saved. Resolves true once deleted, false when refused or failed
  // (rolled back, reported, and the list fetched again).
  async _deletePixelArt(idx) {
    const sensor = this.config?.pixelart_sensor;
    const arts = this._pixelArts();
    if (!this.hass || !sensor || !arts[idx]) return false;
    return this._pixelArtStore.edit(
      this.hass,
      arts.filter((_, index) => index !== idx),
      "remove_pixel_art",
      { idx, expected_name: arts[idx].name },
      {
        onError: (error) => {
          notifyUnreported(this, error);
          this._pixelArtStore.fetch(this.hass, sensor);
        },
      },
    );
  }

  async _exportPixelArts() {
    const cfg = this.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.hass || !pixelartSensor || !this._pixelArtSensorState()) {
      console.error("[draw-card] Pixel art sensor not found for export");
      return;
    }

    const pixelArts = this._pixelArts();

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
      if (
        !(await this._pixelArtStore.run(this.hass, "update_pixel_arts", {
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
