import { html } from "https://unpkg.com/lit?module";
import { trimStaleArray } from "./draw_utils.js";
import { GRID_COLS, GRID_ROWS, MATRIX_SIZE, BLACK_THRESHOLD } from "./draw_card_const.js";

export class GalleryManager {
  constructor(cardInstance) {
    this.card = cardInstance;
  }

  /**
   * Render pixel art gallery
   *
   * STALE DATA PROTECTION:
   * The pixel_arts array from sensor attributes may be stale due to HA websocket limitation.
   * Use the count attribute as source of truth and trim array if needed.
   */
  /**
   * Render pixel art gallery
   *
   * STALE DATA PROTECTION:
   * The pixel_arts array from sensor attributes may be stale due to HA websocket limitation.
   * Use the count attribute as source of truth and trim array if needed.
   */
  renderPixelArtGallery() {
    const cfg = this.card.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    // Check if we have Home Assistant integration and sensor configured
    if (
      !this.card.hass ||
      !pixelartSensor ||
      !this.card.hass.states[pixelartSensor]
    ) {
      return html`
        <div class="pixelart-gallery-message">
          Pixel art sensor not found or not configured.
        </div>
      `;
    }

    // Read pixel arts from Home Assistant sensor
    const sensorState = this.card.hass.states[pixelartSensor];
    let pixelArts = sensorState.attributes.pixel_arts || [];

    // CRITICAL FIX: Trim stale array to match count attribute
    // HA websocket may not send updated array after deletions
    pixelArts = trimStaleArray(
      pixelArts,
      sensorState.attributes.count || pixelArts.length,
    );

    if (pixelArts.length === 0) {
      return html`
        <div class="pixelart-gallery-message">No pixel arts saved yet.</div>
      `;
    }

    const currentPage = this.card.pixelArtGalleryPage || 0;
    const itemsPerPage = cfg.pixel_art_gallery_items_per_page || 5;
    const totalPages = Math.ceil(pixelArts.length / itemsPerPage);
    const startIndex = currentPage * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, pixelArts.length);
    const currentPixelArts = pixelArts.slice(startIndex, endIndex);
    const showDelete = cfg.pixel_art_gallery_allow_delete || false;

    return html`
      <div class="pixel-art-gallery">
        <h3>Pixel Art Gallery</h3>
        <div class="pixel-art-list">
          ${currentPixelArts.length > 0
            ? currentPixelArts.map(
                (pixelArt, index) => html`
                  <div
                    class="pixel-art-item"
                    data-index="${startIndex + index}"
                  >
                    <div class="pixel-art-info">
                      <h4 class="pixel-art-name">${pixelArt.name}</h4>
                      <span class="pixel-art-date"
                        >${this.formatDate(pixelArt.date)}</span
                      >
                    </div>
                    <div class="pixel-art-preview">
                      <canvas
                        class="pixel-art-canvas"
                        data-index="${startIndex + index}"
                        width="100"
                        height="25"
                      ></canvas>
                    </div>
                    <div class="pixel-art-actions">
                      <button
                        class="action-btn load-btn"
                        @click="${() => this.handleLoadPixelArt(pixelArt)}"
                        title="Load this pixel art"
                      >
                        Load
                      </button>
                      ${showDelete
                        ? html`
                            <button
                              class="action-btn delete-btn"
                              @click="${() =>
                                this.handleDeletePixelArt(startIndex + index)}"
                              title="Delete this pixel art"
                            >
                              Delete
                            </button>
                          `
                        : ""}
                    </div>
                  </div>
                `,
              )
            : html`<div class="no-pixel-arts">No pixel arts saved</div>`}
        </div>
        ${totalPages > 1
          ? html`
              <div class="gallery-pagination">
                <button
                  class="gallery-nav-btn"
                  title="Previous page"
                  ?disabled="${currentPage === 0}"
                  @click=${() => this.handlePrevPageClick()}
                >
                  &lt; Previous
                </button>
                <span class="gallery-page-info">
                  Page ${currentPage + 1} of ${totalPages}
                </span>
                <button
                  class="gallery-nav-btn"
                  title="Next page"
                  ?disabled="${currentPage === totalPages - 1}"
                  @click=${() => this.handleNextPageClick()}
                >
                  Next &gt;
                </button>
              </div>
            `
          : ""}
      </div>
    `;
  }

  handlePrevPageClick() {
    if (this.card.pixelArtGalleryPage > 0) {
      this.card.pixelArtGalleryPage--;
      this.card.requestUpdate();
    }
  }

  handleNextPageClick() {
    // Get pixel arts from sensor like in renderPixelArtGallery
    const cfg = this.card.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (
      !this.card.hass ||
      !pixelartSensor ||
      !this.card.hass.states[pixelartSensor]
    ) {
      return;
    }

    const sensorState = this.card.hass.states[pixelartSensor];
    let pixelArts = sensorState.attributes.pixel_arts || [];

    // Trim stale array to match count (same fix as palettes)
    pixelArts = trimStaleArray(
      pixelArts,
      sensorState.attributes.count || pixelArts.length,
    );
    const itemsPerPage = cfg.pixel_art_gallery_items_per_page || 5;
    const totalPages = Math.ceil(pixelArts.length / itemsPerPage);

    if (this.card.pixelArtGalleryPage < totalPages - 1) {
      this.card.pixelArtGalleryPage++;
      this.card.requestUpdate();
    }
  }

  handleLoadPixelArt(pixelArt) {
    if (!pixelArt || !pixelArt.matrix) {
      console.warn("Invalid pixel art data");
      return;
    }

    try {
      // Load the matrix
      this.card.matrix = pixelArt.matrix.slice();

      // Load the palette if available
      if (pixelArt.palette && Array.isArray(pixelArt.palette)) {
        this.card.currentPalette = pixelArt.palette.slice();
      }

      // Save to storage
      if (window.StorageUtils) {
        window.StorageUtils.saveMatrix(this.card.matrix);
        if (pixelArt.palette) {
          window.StorageUtils.savePalette(this.card.currentPalette);
        }
      }

      // Fire config change
      this.card._fireConfigChanged();

      // Update the display
      this.card.requestUpdate();

      // Show success message
      this.showMessage(`Loaded: ${pixelArt.name}`, "success");
    } catch (error) {
      console.error("Error loading pixel art:", error);
      this.showMessage("Failed to load pixel art", "error");
    }
  }

  /**
   * Delete a pixel art
   *
   * NOTE: Unlike palettes, pixel arts don't use client-side caching yet.
   * The sensor update may be delayed, causing brief UI flicker.
   * Consider adding the same caching pattern as palettes if this becomes an issue.
   */
  async deletePixelArt(index) {
    const cfg = this.card.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (!this.card.hass || !pixelartSensor) {
      console.error(
        "[draw-card] Cannot delete pixel art: missing hass or pixelart_sensor",
      );
      this.showMessage(
        "Failed to delete pixel art: sensor not configured",
        "error",
      );
      return;
    }

    try {
      const sensorState = this.card.hass.states[pixelartSensor];
      if (!sensorState) {
        console.error(
          `[draw-card] Pixel art sensor not found: ${pixelartSensor}`,
        );
        this.showMessage("Pixel art sensor not found", "error");
        return;
      }

      let pixelArts = sensorState.attributes.pixel_arts || [];

      // Trim stale array to match count (same fix as palettes)
      pixelArts = trimStaleArray(
        pixelArts,
        sensorState.attributes.count || pixelArts.length,
      );

      const pixelArt = pixelArts[index];

      if (!pixelArt) {
        console.error("[draw-card] Pixel art not found");
        this.showMessage("Pixel art not found", "error");
        return;
      }

      // Confirm deletion
      if (!confirm(`Delete pixel art "${pixelArt.name || "Unnamed"}"?`)) {
        return;
      }

      // Call Home Assistant service to delete
      // The backend automatically triggers state updates and fires events
      await this.card.hass.callService("yeelight_cube", "remove_pixel_art", {
        idx: index,
      });

      // Dispatch event for consistency
      window.dispatchEvent(new Event("pixelart-saved"));

      // Adjust current page if needed
      const itemsPerPage = cfg.pixel_art_gallery_items_per_page || 5;
      const newPixelArtsLength = pixelArts.length - 1; // After deletion
      const totalPages = Math.ceil(newPixelArtsLength / itemsPerPage);
      if (this.card.pixelArtGalleryPage >= totalPages && totalPages > 0) {
        this.card.pixelArtGalleryPage = totalPages - 1;
      }

      // Update display
      this.card.requestUpdate();

      // Show success message
      this.showMessage(`Deleted: ${pixelArt.name || "Unnamed"}`, "success");
    } catch (error) {
      console.error("Error deleting pixel art:", error);
      this.showMessage("Failed to delete pixel art", "error");
    }
  }

  formatDate(dateString) {
    if (!dateString) return "";

    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (error) {
      return dateString;
    }
  }

  showMessage(message, type = "info") {
    // Create or update status message
    const statusEl = this.card.shadowRoot?.querySelector(".status-message");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status-message ${type}`;
      statusEl.style.display = "block";

      setTimeout(() => {
        statusEl.style.display = "none";
      }, 3000);
    }
  }

  // Render canvas previews after the gallery is rendered
  renderCanvasPreviews() {
    if (!this.card.shadowRoot) return;

    // Get pixel arts from sensor like in renderPixelArtGallery
    const cfg = this.card.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (
      !this.card.hass ||
      !pixelartSensor ||
      !this.card.hass.states[pixelartSensor]
    ) {
      return;
    }

    const sensorState = this.card.hass.states[pixelartSensor];
    const pixelArts = sensorState.attributes.pixel_arts || [];

    const canvases = this.card.shadowRoot.querySelectorAll(
      ".pixel-art-canvas[data-index]",
    );

    canvases.forEach((canvas) => {
      const index = parseInt(canvas.dataset.index);
      if (pixelArts[index]) {
        this.drawPixelArtPreview(canvas, pixelArts[index]);
      }
    });
  }

  drawPixelArtPreview(canvas, pixelArt) {
    if (!canvas || !pixelArt || !pixelArt.matrix) return;

    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate pixel size for 20x5 matrix
    const pixelWidth = width / GRID_COLS;
    const pixelHeight = height / GRID_ROWS;

    // Get ignore black pixels setting
    const cfg = this.card.config || {};
    const ignoreBlackPixels = cfg.gallery_ignore_black_pixels || false;

    // Draw pixels
    for (let i = 0; i < Math.min(MATRIX_SIZE, pixelArt.matrix.length); i++) {
      const x = i % GRID_COLS;
      const y = Math.floor(i / GRID_COLS);
      const color = pixelArt.matrix[i] || "#000000";

      // Check if pixel is black and should be ignored
      // Uses shared BLACK_THRESHOLD from draw_card_const.js
      if (ignoreBlackPixels) {
        const rgb = this.hexToRgb(color);
        const isBlack = rgb.r <= BLACK_THRESHOLD && rgb.g <= BLACK_THRESHOLD && rgb.b <= BLACK_THRESHOLD;
        if (isBlack) continue; // Skip black pixels
      }

      ctx.fillStyle = color;
      ctx.fillRect(
        x * pixelWidth,
        y * pixelHeight,
        pixelWidth - 0.5,
        pixelHeight - 0.5,
      );
    }
  }

  // Helper to convert hex color to RGB
  hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace(/^#/, "");

    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return { r, g, b };
  }

  // Helper methods for gallery management
  getCurrentPageInfo() {
    // Get pixel arts from sensor like in renderPixelArtGallery
    const cfg = this.card.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (
      !this.card.hass ||
      !pixelartSensor ||
      !this.card.hass.states[pixelartSensor]
    ) {
      return {
        currentPage: 0,
        totalPages: 0,
        totalItems: 0,
        itemsPerPage: cfg.pixel_art_gallery_items_per_page || 5,
      };
    }

    const sensorState = this.card.hass.states[pixelartSensor];
    const pixelArts = sensorState.attributes.pixel_arts || [];
    const currentPage = this.card.pixelArtGalleryPage || 0;
    const itemsPerPage = cfg.pixel_art_gallery_items_per_page || 5;
    const totalPages = Math.ceil(pixelArts.length / itemsPerPage);

    return {
      currentPage,
      totalPages,
      totalItems: pixelArts.length,
      itemsPerPage,
    };
  }

  goToPage(pageNumber) {
    const { totalPages } = this.getCurrentPageInfo();
    if (pageNumber >= 0 && pageNumber < totalPages) {
      this.card.pixelArtGalleryPage = pageNumber;
      this.card.requestUpdate();
    }
  }

  // Search functionality
  searchPixelArts(query) {
    // Get pixel arts from sensor
    const cfg = this.card.config || {};
    const pixelartSensor = cfg.pixelart_sensor;

    if (
      !this.card.hass ||
      !pixelartSensor ||
      !this.card.hass.states[pixelartSensor]
    ) {
      return [];
    }

    const sensorState = this.card.hass.states[pixelartSensor];
    const pixelArts = sensorState.attributes.pixel_arts || [];

    if (!query || query.trim() === "") {
      return pixelArts;
    }

    const searchTerm = query.toLowerCase().trim();
    return pixelArts.filter(
      (pixelArt) =>
        pixelArt.name && pixelArt.name.toLowerCase().includes(searchTerm),
    );
  }

  // Export/Import functionality
  exportPixelArt(pixelArt) {
    return JSON.stringify(pixelArt, null, 2);
  }

  exportAllPixelArts() {
    const pixelArts = this.card.pixelArts || [];
    return JSON.stringify(pixelArts, null, 2);
  }

  importPixelArt(jsonString) {
    try {
      const pixelArt = JSON.parse(jsonString);
      if (pixelArt.name && pixelArt.matrix) {
        const pixelArts = this.card.pixelArts || [];
        pixelArts.push(pixelArt);

        if (window.StorageUtils) {
          window.StorageUtils.savePixelArts(pixelArts);
        }

        this.card.requestUpdate();
        this.showMessage(`Imported: ${pixelArt.name}`, "success");
        return true;
      }
      throw new Error("Invalid pixel art format");
    } catch (error) {
      console.error("Failed to import pixel art:", error);
      this.showMessage("Failed to import pixel art", "error");
      return false;
    }
  }
}
