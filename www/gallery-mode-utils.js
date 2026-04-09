/**
 * Gallery Mode - Clean, modern gallery layout
 * Responsive masonry-style grid with hover effects
 */

export const galleryModeStyles = `
  /* Gallery Mode - Modern Gallery Layout */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(200px * var(--gallery-size-multiplier, 1)), 1fr));
    gap: 16px;
    padding: 8px;
  }

  .gallery-item {
    background: var(--card-background-color, #ffffff);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    transition: transform 0.2s ease, box-shadow 0.3s ease;
    cursor: pointer;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .gallery-item.gallery-item-square {
    border-radius: 0;
  }

  .gallery-item:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  }

  /* Gradient background mode styles */
  .gallery-item-gradient .gallery-item-image {
    background: transparent;
  }

  /* Color stripes and gradient bar modes - remove padding and use flex-grow */
  .gallery-item-stripes .gallery-item-image {
    padding: 0;
  }

  /* Make color area grow to match footer height for gradient modes */
  .gallery-item-gradient .gallery-item-image,
  .gallery-item-stripes .gallery-item-image,
  .gallery-item-gradient-bar .gallery-item-image {
    flex: 1;
    min-height: 0;
  }

  .gallery-footer-gradient {
    background: var(--card-background-color, rgba(255, 255, 255, 0.95));
    backdrop-filter: blur(10px);
  }

  .gallery-title-gradient {
    color: var(--primary-text-color, #212529);
    font-weight: 600;
  }

  .gallery-item-image {
    /* width: 100%; */
    background: var(--secondary-background-color, #f8f9fa);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(20px * var(--gallery-size-multiplier, 1));
    /* min-height: calc(120px * var(--gallery-size-multiplier, 1)); */
    position: relative;
    height: 100%;
  }

  .gallery-item-content {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
  }

  .gallery-item-content > * {
    max-width: 100%;
  }

  /* Ensure gradient-bg has sufficient height */
  .gallery-item-gradient .gallery-item-image {
    min-height: calc(60px * var(--gallery-size-multiplier, 1));
  }

  .gallery-item-footer {
    /* padding: 12px 16px; */
    padding: 0 12px;
    background: var(--card-background-color, #ffffff);
    border-top: 1px solid var(--divider-color, #e9ecef);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-height: 48px;
  }

  .gallery-item-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--primary-text-color, #212529);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
    transition: color 0.2s;
  }

  .gallery-item-title:hover {
    color: var(--primary-color, #0d6efd);
  }

  /* All delete button styles */
  .gallery-item-footer button {
    flex-shrink: 0;
    margin-left: auto;
    position: relative !important;
    top: auto !important;
    right: auto !important;
  }

  .gallery-delete-btn,
  .gallery-item-footer .delete-btn-cross,
  .gallery-item-footer .delete-btn-minimal,
  .gallery-item-footer .delete-btn-rounded,
  .gallery-item-footer .delete-btn-icon {
    background: transparent;
    border: none;
    color: #dc3545;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.2s, transform 0.1s, opacity 0.2s;
    flex-shrink: 0;
  }

  .gallery-delete-btn:hover,
  .gallery-item-footer .delete-btn-cross:hover,
  .gallery-item-footer .delete-btn-minimal:hover,
  .gallery-item-footer .delete-btn-rounded:hover,
  .gallery-item-footer .delete-btn-icon:hover {
    background: #fee;
    transform: scale(1.1);
  }

  .gallery-delete-btn:active {
    transform: scale(0.95);
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .gallery-grid {
      grid-template-columns: repeat(auto-fill, minmax(calc(150px * var(--gallery-size-multiplier, 1)), 1fr));
      gap: 12px;
    }
  }

  @media (max-width: 480px) {
    .gallery-grid {
      grid-template-columns: repeat(auto-fill, minmax(calc(120px * var(--gallery-size-multiplier, 1)), 1fr));
      gap: 8px;
    }
  }
`;

/**
 * Render items in gallery mode
 * @param {Array} items - Array of items to render
 * @param {Function} renderContent - Function to render item content (receives item, index)
 * @param {Object} options - Configuration options
 * @returns {string} HTML string
 */
export function renderGalleryMode(items, renderContent, options = {}) {
  const {
    showTitle = true,
    showDelete = false,
    deleteButtonClass = "gallery-delete-btn",
    onDeleteClick = null,
    onItemClick = null,
    onTitleClick = null,
    cardSizeMultiplier = 1,
    isGradientBg = false,
    isStripes = false,
    isGradientBar = false,
    roundedCards = true,
    globalOffset = 0,
  } = options;

  // Safety check for items
  if (!items || !Array.isArray(items)) {
    return '<div class="gallery-grid"><!-- No items to display --></div>';
  }

  const itemsHtml = items
    .map((item, localIdx) => {
      const idx = localIdx + globalOffset;
      const title = item.name || item.title || `Item ${idx + 1}`;
      const gradientStyle =
        isGradientBg && item.gradientBg
          ? `style="background: linear-gradient(to right, ${item.gradientBg});"`
          : "";

      return `
        <div class="gallery-item${
          isGradientBg ? " gallery-item-gradient" : ""
        }${isStripes ? " gallery-item-stripes" : ""}${
          isGradientBar ? " gallery-item-gradient-bar" : ""
        }${!roundedCards ? " gallery-item-square" : ""}" data-idx="${idx}">
          <div class="gallery-item-image" ${gradientStyle}
               ${
                 onItemClick
                   ? `onclick="this.getRootNode().host.${onItemClick}(event, ${idx});"`
                   : ""
               }>
            <div class="gallery-item-content">
              ${renderContent(item, idx)}
            </div>
          </div>
          <div class="gallery-item-footer${
            isGradientBg ? " gallery-footer-gradient" : ""
          }">
            ${
              showTitle
                ? `<div class="gallery-item-title${
                    isGradientBg ? " gallery-title-gradient" : ""
                  }" 
                     ${
                       onTitleClick
                         ? `onclick="event.stopPropagation(); this.getRootNode().host.${onTitleClick}(event, ${idx});"`
                         : ""
                     }>
                     ${title}
                   </div>`
                : ""
            }
            ${
              showDelete && onDeleteClick
                ? `<button class="${deleteButtonClass}" 
                     onclick="event.stopPropagation(); this.getRootNode().host.${onDeleteClick}(event, ${idx});" 
                     title="Delete">×</button>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");

  return `<div class="gallery-grid" style="--gallery-size-multiplier: ${cardSizeMultiplier};">${itemsHtml}</div>`;
}
