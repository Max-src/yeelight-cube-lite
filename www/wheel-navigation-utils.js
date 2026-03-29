/**
 * Wheel Navigation Utilities
 *
 * Shared utilities for implementing iOS-style wheel picker navigation.
 * Can be used by any card that needs vertical scrolling wheel interface.
 */

// ============================================================================
// CONSTANTS - Configuration values for wheel behavior
// ============================================================================
// NOTE: Item heights are NOT defined here! They are dynamically calculated from
// the actual DOM elements in getWheelConfig(). This ensures that when you change
// DEFAULT_ITEM_HEIGHT or COMPACT_ITEM_HEIGHT in gallery-display-utils.js,
// the navigation automatically adapts without needing to update multiple files.
// ============================================================================

const WHEEL_CONSTANTS = {
  // Default container height
  DEFAULT_CONTAINER_HEIGHT: 300,

  // Number of partially visible items above/below center
  HALF_VISIBLE_ITEMS: 2,

  // 3D transform parameters for centered item
  CENTERED: {
    opacity: 1,
    scale: 1,
    rotateX: 0,
    translateZ: 0,
    zIndex: 100,
  },

  // 3D transform parameters for off-center items
  OFF_CENTER: {
    baseOpacity: 1,
    minScale: 0.92,
    scaleDecay: 0.02, // Scale reduction per distance unit
    maxRotation: 50, // Maximum rotation angle in degrees
    rotationPerDistance: 20, // Rotation degrees per distance unit
    zIndexDecay: 10, // Z-index reduction per distance unit
    translateZDecay: 0, // No Z-translation to prevent overlap
  },

  // Drag threshold before navigation triggers
  DRAG_THRESHOLD: 40,
};

// ============================================================================
// CORE FUNCTIONS - Main wheel navigation logic
// ============================================================================

/**
 * Initialize wheel navigation for a shadow root element
 *
 * @param {Object} options - Configuration options
 * @param {ShadowRoot} options.shadowRoot - The shadow root containing the wheel
 * @param {string} options.displayMode - Current display mode ('wheel' or other)
 * @param {Object} options.config - Card configuration object
 * @param {Function} options.onModeSelect - Callback when mode is selected (mode, index) => void
 * @param {Function} options.getCurrentMode - Function to get current mode string
 * @param {number} options.currentCenterIndex - Current center index (for re-initialization)
 * @param {boolean} options.immediate - If true, initialize immediately without animation frame delay
 * @returns {Object} - Navigation controller with methods: { sync, destroy, getCenterIndex }
 */
export function initializeWheelNavigation(options) {
  const {
    shadowRoot,
    displayMode,
    config,
    onModeSelect,
    getCurrentMode,
    currentCenterIndex = 0,
    immediate = false,
  } = options;

  console.log("[Wheel Init] initializeWheelNavigation called", {
    hasRoot: !!shadowRoot,
    displayMode,
    wheelDisplayStyle: config?.wheel_display_style,
    currentCenterIndex,
    immediate,
  });

  if (!shadowRoot || displayMode !== "wheel") {
    console.log(
      "[Wheel Init] Early exit — not in wheel mode or no shadow root",
      {
        hasRoot: !!shadowRoot,
        displayMode,
      },
    );
    return { sync: () => {}, destroy: () => {}, getCenterIndex: () => 0 };
  }

  const wheelContainer = shadowRoot.querySelector('[data-wheel-scroll="true"]');
  const wheelItems = shadowRoot.querySelectorAll(
    '[data-wheel-item="true"], [data-wheel-compact-item="true"]',
  );
  const upBtn = shadowRoot.querySelector('[data-wheel-nav="up"]');
  const downBtn = shadowRoot.querySelector('[data-wheel-nav="down"]');

  console.log("[Wheel Init] DOM query results", {
    hasContainer: !!wheelContainer,
    itemsFound: wheelItems.length,
    hasUpBtn: !!upBtn,
    hasDownBtn: !!downBtn,
    itemModes: Array.from(wheelItems)
      .map((i) => i.dataset.mode)
      .slice(0, 10),
  });

  if (!wheelContainer || wheelItems.length === 0) {
    // Expected when called before first render — caller will retry.
    console.debug("[Wheel Init] Early exit - missing container or items", {
      hasContainer: !!wheelContainer,
      itemsCount: wheelItems.length,
    });
    return { sync: () => {}, destroy: () => {}, getCenterIndex: () => 0 };
  }

  // Internal state
  let wheelCenterIndex = currentCenterIndex;
  let isDragging = false;
  let dragStartY = 0;
  let processingModeChange = false;

  // ============================================================================
  // CONFIGURATION - Calculate wheel dimensions and layout
  // ============================================================================

  /**
   * Get wheel display configuration based on current settings
   * Reads actual item height from DOM to stay in sync with rendering
   * @returns {Object} Configuration with itemHeight, containerHeight, baseOffset, isCompact
   */
  const getWheelConfig = () => {
    const isCompact = (config.wheel_display_style || "default") === "compact";
    let containerHeight =
      config.wheel_height || WHEEL_CONSTANTS.DEFAULT_CONTAINER_HEIGHT;

    // Read actual item height and effective step from DOM
    // This ensures navigation stays in sync with rendering
    let itemHeight = 65; // fallback default
    let itemStep = 65; // effective step = height + margin (negative margin shrinks step)
    let heightSource = "fallback";

    if (wheelItems.length > 0) {
      const firstItem = wheelItems[0];

      // Check if element is actually rendered in DOM
      if (!firstItem.offsetParent && firstItem.offsetHeight === 0) {
        console.warn(
          "[Wheel Config] First wheel item not rendered yet, using fallback height",
          {
            isCompact,
            itemsCount: wheelItems.length,
            offsetParent: firstItem.offsetParent,
            offsetHeight: firstItem.offsetHeight,
          },
        );
        heightSource = "fallback-not-rendered";
      } else {
        // Use offsetHeight which returns the full border-box height
        // (matching the CSS `height` with `box-sizing: border-box`).
        // getComputedStyle().height returns content-box height which is smaller
        // and mismatches the values used in the HTML template.
        const borderBoxHeight = firstItem.offsetHeight;

        if (borderBoxHeight && borderBoxHeight > 0) {
          itemHeight = borderBoxHeight;
          // Read marginTop from second item (first item has margin:0, others have negative margin for overlap)
          let marginTop = 0;
          if (wheelItems.length > 1) {
            const secondStyle = window.getComputedStyle(wheelItems[1]);
            marginTop = parseFloat(secondStyle.marginTop) || 0;
          }
          itemStep = borderBoxHeight + marginTop;
          heightSource = "dom-computed";
        } else {
          console.warn("[Wheel Config] Invalid offsetHeight, using fallback", {
            offsetHeight: borderBoxHeight,
            isCompact,
          });
          heightSource = "fallback-invalid-height";
        }
      }
    } else {
      console.warn(
        "[Wheel Config] No wheel items found, using fallback height",
        { isCompact },
      );
      heightSource = "fallback-no-items";
    }

    // Read wheel layout values from data attributes set by the HTML template.
    // This guarantees JS navigation uses the EXACT same values as the template,
    // eliminating any rounding or measurement divergence (e.g. content-box vs
    // border-box, CSS overrides, getComputedStyle timing).
    const tmplItemHeight = parseFloat(wheelContainer.dataset.wheelItemHeight);
    const tmplItemStep = parseFloat(wheelContainer.dataset.wheelItemStep);
    const tmplContainerHeight = parseFloat(
      wheelContainer.dataset.wheelContainerHeight,
    );
    const tmplPaddingTop = parseFloat(wheelContainer.dataset.wheelPaddingTop);

    // Use template values when available, fall back to DOM-measured values
    if (
      tmplItemHeight > 0 &&
      tmplItemStep > 0 &&
      tmplContainerHeight > 0 &&
      tmplPaddingTop >= 0
    ) {
      itemHeight = tmplItemHeight;
      itemStep = tmplItemStep;
      containerHeight = tmplContainerHeight;
      heightSource = "data-attr";
    }

    const paddingTop =
      tmplPaddingTop >= 0 && !isNaN(tmplPaddingTop)
        ? tmplPaddingTop
        : WHEEL_CONSTANTS.HALF_VISIBLE_ITEMS * itemStep;
    // baseOffset centers the selected item: item center = paddingTop + n*itemStep + itemHeight/2
    // We want that at containerHeight/2, so offset = paddingTop + itemHeight/2 - containerHeight/2 + n*itemStep
    const baseOffset = paddingTop + itemHeight / 2 - containerHeight / 2;

    // isCompact,
    // itemHeight,
    // heightSource,
    // containerHeight,
    // paddingTop,
    // baseOffset,
    // itemsCount: wheelItems.length,
    // displayStyle: config.wheel_display_style,
    // });

    return { isCompact, itemHeight, itemStep, containerHeight, baseOffset };
  };

  // ============================================================================
  // VISUAL UPDATES - Apply 3D transforms and styling
  // ============================================================================

  /**
   * Calculate 3D transform style for a centered wheel item
   * @returns {Object} Style properties for centered item
   */
  const getCenteredItemStyle = () => ({
    opacity: WHEEL_CONSTANTS.CENTERED.opacity,
    transform: `scale(${WHEEL_CONSTANTS.CENTERED.scale}) rotateX(${WHEEL_CONSTANTS.CENTERED.rotateX}deg) translateZ(${WHEEL_CONSTANTS.CENTERED.translateZ}px)`,
    zIndex: WHEEL_CONSTANTS.CENTERED.zIndex,
  });

  /**
   * Calculate 3D transform style for an off-center wheel item
   * @param {number} distance - Distance from center (absolute value)
   * @param {number} itemIndex - Index of the item
   * @param {number} centerIndex - Index of the centered item
   * @returns {Object} Style properties for off-center item
   */
  const getOffCenterItemStyle = (distance, itemIndex, centerIndex) => {
    const { OFF_CENTER } = WHEEL_CONSTANTS;

    // Calculate transform values based on distance from center
    const opacity = OFF_CENTER.baseOpacity;
    const scale = Math.max(
      OFF_CENTER.minScale,
      1 - distance * OFF_CENTER.scaleDecay,
    );

    // Items above center rotate forward (+), items below rotate backward (-)
    const direction = itemIndex < centerIndex ? 1 : -1;
    const rotateX =
      Math.min(
        distance * OFF_CENTER.rotationPerDistance,
        OFF_CENTER.maxRotation,
      ) * direction;

    const zIndex =
      WHEEL_CONSTANTS.CENTERED.zIndex - distance * OFF_CENTER.zIndexDecay;
    const translateZ = -distance * OFF_CENTER.translateZDecay;

    return {
      opacity,
      transform: `scale(${scale}) rotateX(${rotateX}deg) translateZ(${translateZ}px)`,
      zIndex,
    };
  };

  /**
   * Apply style object to DOM element
   * @param {HTMLElement} element - Element to style
   * @param {Object} styles - Style properties to apply
   */
  const applyStyles = (element, styles) => {
    element.style.opacity = styles.opacity.toString();
    element.style.transform = styles.transform;
    element.style.zIndex = styles.zIndex.toString();
  };

  /**
   * Update visual state of all wheel items based on current center index
   */
  const updateWheelState = () => {
    // centerIndex: wheelCenterIndex,
    // itemsCount: wheelItems.length,
    // containerExists: !!wheelContainer,
    // });

    if (!wheelContainer) {
      console.error("[Wheel State] Container not found, cannot update state");
      return;
    }

    if (wheelItems.length === 0) {
      console.error("[Wheel State] No wheel items found, cannot update state");
      return;
    }

    const { itemStep, baseOffset } = getWheelConfig();
    const offset = baseOffset + wheelCenterIndex * itemStep;

    // centerIndex: wheelCenterIndex,
    // itemHeight,
    // baseOffset,
    // offset,
    // containerTransform: `translateY(-${offset}px)`,
    // });

    // Move container to position centered item
    wheelContainer.style.transform = `translateY(-${offset}px)`;

    // Update each item's 3D transform based on distance from center
    wheelItems.forEach((item, idx) => {
      const distance = Math.abs(idx - wheelCenterIndex);
      const isCentered = distance === 0;

      if (isCentered) {
        item.setAttribute("data-wheel-centered", "true");
        applyStyles(item, getCenteredItemStyle());
      } else {
        item.removeAttribute("data-wheel-centered");
        applyStyles(
          item,
          getOffCenterItemStyle(distance, idx, wheelCenterIndex),
        );
      }
    });

    // centeredMode: wheelItems[wheelCenterIndex]?.dataset?.mode,
    // });
  };

  // ============================================================================
  // NAVIGATION - Handle wheel movement and mode selection
  // ============================================================================

  /**
   * Navigate wheel in specified direction
   * @param {string} direction - "up" or "down"
   */
  const navigateWheel = (direction) => {
    const totalItems = wheelItems.length;
    const previousIndex = wheelCenterIndex;

    if (direction === "up") {
      wheelCenterIndex = Math.max(0, wheelCenterIndex - 1);
    } else {
      wheelCenterIndex = Math.min(totalItems - 1, wheelCenterIndex + 1);
    }

    // direction,
    // previousIndex,
    // newIndex: wheelCenterIndex,
    // totalItems,
    // moved: previousIndex !== wheelCenterIndex,
    // });

    updateWheelState();

    // Notify callback of mode selection
    const centeredItem = wheelItems[wheelCenterIndex];
    const mode = centeredItem?.dataset?.mode;

    if (mode && onModeSelect && !processingModeChange) {
      processingModeChange = true;
      onModeSelect(mode, wheelCenterIndex)
        .catch((error) => {
          console.error(
            "[Wheel Navigation] Error in mode select callback:",
            error,
          );
        })
        .finally(() => {
          processingModeChange = false;
        });
    }
  };

  /**
   * Sync wheel position to match current mode from entity state
   */
  const syncWheelToMode = () => {
    if (!getCurrentMode) {
      console.warn("[Wheel Sync] No getCurrentMode callback provided");
      return;
    }

    const currentMode = getCurrentMode();
    if (!currentMode) {
      console.warn(
        "[Wheel Sync] No current mode returned from callback — wheel stays at index",
        wheelCenterIndex,
      );
      return;
    }

    // Find the index of the current mode
    let foundIndex = 0;
    const allModes = [];
    wheelItems.forEach((item, idx) => {
      const itemMode = item.dataset.mode;
      allModes.push(itemMode);
      if (itemMode === currentMode) {
        foundIndex = idx;
      }
    });

    console.log("[Wheel Sync] syncWheelToMode", {
      currentMode,
      foundIndex,
      previousIndex: wheelCenterIndex,
      willUpdate: wheelCenterIndex !== foundIndex,
      totalModes: allModes.length,
      containerConnected: wheelContainer.isConnected,
    });

    // Always update wheel state to ensure positioning is correct
    // (even when index matches, e.g. index 0 on first load)
    wheelCenterIndex = foundIndex;
    updateWheelState();
  };

  // ============================================================================
  // DRAG HANDLING - Touch and mouse drag support
  // ============================================================================

  /**
   * Start drag operation
   * @param {number} clientY - Initial Y coordinate
   */
  const startDrag = (clientY) => {
    dragStartY = clientY;
    isDragging = true;
    wheelContainer.style.cursor = "grabbing";
  };

  /**
   * Handle drag movement
   * @param {number} clientY - Current Y coordinate
   */
  const handleDrag = (clientY) => {
    if (!isDragging) return;

    const deltaY = dragStartY - clientY;

    if (Math.abs(deltaY) > WHEEL_CONSTANTS.DRAG_THRESHOLD) {
      navigateWheel(deltaY > 0 ? "down" : "up");
      dragStartY = clientY; // Reset for continuous dragging
    }
  };

  /**
   * End drag operation
   */
  const endDrag = () => {
    isDragging = false;
    wheelContainer.style.cursor = "grab";
  };

  // ============================================================================
  // EVENT HANDLERS - User interaction callbacks
  // ============================================================================

  const upClickHandler = (e) => {
    e.stopPropagation();
    navigateWheel("up");
  };

  const downClickHandler = (e) => {
    e.stopPropagation();
    navigateWheel("down");
  };

  const wheelHandler = (e) => {
    e.preventDefault();
    navigateWheel(e.deltaY > 0 ? "down" : "up");
  };

  const touchStartHandler = (e) => {
    startDrag(e.touches[0].clientY);
  };

  const touchMoveHandler = (e) => {
    handleDrag(e.touches[0].clientY);
  };

  const touchEndHandler = () => {
    endDrag();
  };

  const mouseDownHandler = (e) => {
    e.preventDefault();
    startDrag(e.clientY);
  };

  const mouseMoveHandler = (e) => {
    if (isDragging) {
      e.preventDefault();
      handleDrag(e.clientY);
    }
  };

  const mouseUpHandler = () => {
    endDrag();
  };

  const mouseLeaveHandler = () => {
    endDrag();
  };

  // ============================================================================
  // EVENT LISTENER SETUP - Attach all interaction handlers
  // ============================================================================

  // Button navigation
  if (upBtn) {
    upBtn.addEventListener("click", upClickHandler);
  }

  if (downBtn) {
    downBtn.addEventListener("click", downClickHandler);
  }

  // Mouse wheel scrolling
  const outerContainer = wheelContainer.parentElement;
  if (outerContainer) {
    outerContainer.addEventListener("wheel", wheelHandler, { passive: false });
  }

  // Touch drag events
  wheelContainer.addEventListener("touchstart", touchStartHandler, {
    passive: true,
  });
  wheelContainer.addEventListener("touchmove", touchMoveHandler, {
    passive: true,
  });
  wheelContainer.addEventListener("touchend", touchEndHandler, {
    passive: true,
  });

  // Mouse drag events
  wheelContainer.addEventListener("mousedown", mouseDownHandler);
  wheelContainer.addEventListener("mousemove", mouseMoveHandler);
  wheelContainer.addEventListener("mouseup", mouseUpHandler);
  wheelContainer.addEventListener("mouseleave", mouseLeaveHandler);

  // Compact mode: hover tooltips
  const { isCompact } = getWheelConfig();
  if (isCompact) {
    wheelItems.forEach((item) => {
      const titleHover = item.querySelector(".wheel-item-title-hover");
      if (titleHover) {
        const mouseEnterHandler = () => {
          titleHover.style.opacity = "1";
        };
        const mouseLeaveHandler = () => {
          titleHover.style.opacity = "0";
        };
        item.addEventListener("mouseenter", mouseEnterHandler);
        item.addEventListener("mouseleave", mouseLeaveHandler);

        // Store handlers for cleanup
        item._wheelHoverHandlers = { mouseEnterHandler, mouseLeaveHandler };
      }
    });
  }

  // ============================================================================
  // INITIALIZATION - Set initial state
  // ============================================================================

  // displayMode,
  // isCompact: (config.wheel_display_style || "default") === "compact",
  console.log("[Wheel Init] Event listeners attached, initializing state", {
    itemsCount: wheelItems.length,
    currentCenterIndex,
    immediate,
    containerConnected: wheelContainer.isConnected,
  });

  // Initialize wheel state
  if (immediate) {
    // Immediate initialization for re-initialization scenarios (preview updates)
    console.log("[Wheel Init] Immediate sync (re-initialization)");
    syncWheelToMode();
  } else {
    // Deferred initialization for first load (ensure DOM is ready)
    // Double rAF: first lets browser layout elements, second ensures height
    // calculations are accurate before we position the wheel
    console.log("[Wheel Init] Deferred sync (double-rAF for first load)");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        console.log("[Wheel Init] Double-rAF fired, running syncWheelToMode", {
          containerConnected: wheelContainer.isConnected,
          firstItemHeight: wheelItems[0]?.offsetHeight,
        });
        syncWheelToMode();
      });
    });
  }

  // ============================================================================
  // CONTROLLER API - Return public interface
  // ============================================================================
  return {
    sync: syncWheelToMode,
    getCenterIndex: () => wheelCenterIndex,
    destroy: () => {
      console.log("[Wheel] destroy: removing all event listeners", {
        centerIndex: wheelCenterIndex,
        containerConnected: wheelContainer.isConnected,
      });
      // Remove all event listeners
      if (upBtn) {
        upBtn.removeEventListener("click", upClickHandler);
      }
      if (downBtn) {
        downBtn.removeEventListener("click", downClickHandler);
      }
      if (outerContainer) {
        outerContainer.removeEventListener("wheel", wheelHandler);
      }
      wheelContainer.removeEventListener("touchstart", touchStartHandler);
      wheelContainer.removeEventListener("touchmove", touchMoveHandler);
      wheelContainer.removeEventListener("touchend", touchEndHandler);
      wheelContainer.removeEventListener("mousedown", mouseDownHandler);
      wheelContainer.removeEventListener("mousemove", mouseMoveHandler);
      wheelContainer.removeEventListener("mouseup", mouseUpHandler);
      wheelContainer.removeEventListener("mouseleave", mouseLeaveHandler);

      // Remove hover handlers for compact mode
      wheelItems.forEach((item) => {
        if (item._wheelHoverHandlers) {
          item.removeEventListener(
            "mouseenter",
            item._wheelHoverHandlers.mouseEnterHandler,
          );
          item.removeEventListener(
            "mouseleave",
            item._wheelHoverHandlers.mouseLeaveHandler,
          );
          delete item._wheelHoverHandlers;
        }
      });
    },
  };
}
