# Comprehensive Audit Report — `www/` JavaScript Files

> Scope: All 45 active JS files in `www/` (excluding `unused-cards/` and `sortable.min.js`)
> Categories: Colors · A11y · Performance · Duplication · Responsiveness · Error Handling · UX · Maintainability · Browser Compat · Security

---

## Summary Table

| #   | File                                           | Status | Colors | A11y   | Perf  | Dupl   | Resp  | Errors | UX    | Maint  | Compat | Sec    | **Total** |
| --- | ---------------------------------------------- | ------ | ------ | ------ | ----- | ------ | ----- | ------ | ----- | ------ | ------ | ------ | --------- |
| 1   | yeelight-cube-gradient-card.js                 | ⚠️     | 3      | 4      | 1     | 3      | 1     | 0      | 1     | 3      | 1      | 2      | **19**    |
| 2   | yeelight-cube-lamp-preview-card.js             | ⚠️     | 0      | 4      | 1     | 1      | 0     | 0      | 0     | 3      | 1      | 2      | **12**    |
| 3   | yeelight-cube-lamp-preview-card-editor.js      | ✅     | 0      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **1**     |
| 4   | yeelight-cube-palette-card.js                  | ⚠️     | 2      | 3      | 1     | 1      | 1     | 0      | 1     | 2      | 1      | 2      | **14**    |
| 5   | yeelight-cube-color-list-editor-card.js        | ⚠️     | 3      | 4      | 1     | 3      | 1     | 0      | 1     | 3      | 1      | 3      | **20**    |
| 6   | yeelight-cube-calibration-card.js              | ✅     | 0      | 2      | 0     | 0      | 1     | 0      | 0     | 1      | 0      | 1      | **5**     |
| 7   | yeelight-cube-palette-card-editor.js           | ⚠️     | 1      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **2**     |
| 8   | yeelight-cube-gradient-card-editor.js          | ✅     | 0      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **1**     |
| 9   | yeelight-cube-draw-card.js                     | ⚠️     | 0      | 3      | 0     | 1      | 0     | 0      | 0     | 2      | 0      | 1      | **7**     |
| 10  | yeelight-cube-draw-card-editor.js              | ✅     | 0      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **1**     |
| 11  | yeelight-cube-color-list-editor-card-editor.js | ⚠️     | 2      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **3**     |
| 12  | draw_card_palette_ui.js                        | ✅     | 0      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 1      | **2**     |
| 13  | draw_card_styles.js                            | ⚠️     | 1      | 0      | 0     | 1      | 0     | 0      | 1     | 0      | 0      | 0      | **3**     |
| 14  | draw_card_palette.js                           | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 15  | draw_card_ui.js                                | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 16  | draw_card_state.js                             | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 17  | draw_card_storage.js                           | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 18  | draw_card_events.js                            | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 19  | draw_card_handlers.js                          | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 20  | draw_card_tools.js                             | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 21  | draw_card_const.js                             | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 22  | draw_utils.js                                  | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 23  | draw_card_matrix.js                            | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 24  | draw_card_matrix_1d.js                         | ✅ᴵ    | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 25  | draw_card_gallery_manager.js                   | ✅ᴵ    | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 26  | yeelight-cube-dotmatrix.js                     | ✅ᴵ    | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 27  | yeelight-cube-palette-utils.js                 | ✅ᴵ    | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 28  | service-call-utils.js                          | ✅ᴵ    | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 29  | slider_utils.js                                | ✅ᴵ    | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 30  | carousel-utils.js                              | ⚠️     | 1      | 1      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **2**     |
| 31  | compact-mode-styles.js                         | 🗑️     | 1      | 0      | 0     | 0      | 0     | 0      | 0     | 1      | 0      | 0      | **2**     |
| 32  | compact-layout-utils.js                        | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 1      | 0      | **1**     |
| 33  | wheel-navigation-utils.js                      | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 34  | entity-selector-utils.js                       | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 35  | form-row-utils.js                              | ⚠️     | 1      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **1**     |
| 36  | pagination-utils.js                            | ⚠️     | 1      | 0      | 0     | 1      | 0     | 0      | 0     | 0      | 0      | 0      | **2**     |
| 37  | button-group-utils.js                          | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 38  | editor_ui_utils.js                             | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 39  | gallery-mode-utils.js                          | ⚠️     | 2      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **2**     |
| 40  | gallery-display-utils.js                       | ⚠️     | 2      | 0      | 0     | 1      | 0     | 0      | 0     | 0      | 0      | 0      | **3**     |
| 41  | grid-mode-utils.js                             | ⚠️     | 2      | 0      | 0     | 1      | 0     | 0      | 0     | 0      | 0      | 0      | **3**     |
| 42  | list-mode-utils.js                             | ⚠️     | 2      | 0      | 0     | 1      | 0     | 0      | 0     | 0      | 0      | 0      | **3**     |
| 43  | album-view-coverflow.js                        | ✅     | 0      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **0**     |
| 44  | delete-button-styles.js                        | ⚠️     | 3      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **3**     |
| 45  | export-import-button-utils.js                  | ⚠️     | 3      | 0      | 0     | 0      | 0     | 0      | 0     | 0      | 0      | 0      | **3**     |
|     | **TOTALS**                                     |        | **30** | **26** | **4** | **14** | **4** | **0**  | **4** | **15** | **5**  | **12** | **114**   |

Legend: ✅ = Clean, ✅ᴵ = INTENTIONAL hardcoded colors (device/pixel-art), ⚠️ = Has issues, 🗑️ = Deprecated

---

## Category Totals (ranked by severity)

| Rank | Category                           | Issue Count | Severity     |
| ---- | ---------------------------------- | ----------- | ------------ |
| 1    | **Colors** (hardcoded, not themed) | 30          | Medium       |
| 2    | **Accessibility**                  | 26          | **Critical** |
| 3    | **Maintainability**                | 15          | Medium       |
| 4    | **Duplication**                    | 14          | Low-Medium   |
| 5    | **Security** (innerHTML)           | 12          | Medium       |
| 6    | **Browser Compat**                 | 5           | Low          |
| 7    | **Performance**                    | 4           | Low          |
| 8    | **Responsiveness**                 | 4           | Low          |
| 9    | **UX Polish**                      | 4           | Low          |
| 10   | **Error Handling**                 | 0           | ✅ Good      |

---

## Detailed Findings Per File

---

### 1. `yeelight-cube-gradient-card.js` (4,390 lines) — 19 issues

**Colors (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L844-845 | `rgba(255,255,255,0.5) !important`, `rgba(255,255,255,0.7) !important` — hardcoded white overlay on thumbnails | Use `color-mix(in srgb, var(--card-background-color, #fff) 50%, transparent)` |
| L959 | `background: rgba(255,255,255,0.5) !important` — hover overlay | Same as above |
| L1472 | `color: var(--primary-text-color, #000) !important` — the `#000` fallback is fine but the `!important` forces it | Remove `!important`, already using var() |

**A11y (4)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All buttons | Zero `aria-label` on interactive elements (preview overlays, mode dropdowns, panel toggles) | Add `aria-label` to all buttons & controls |
| All | No `role="button"` on clickable `<div>` elements | Add proper roles |
| L2724-2834 | Rotary angle knob has no keyboard support | Add `keydown` handler for arrow keys |
| All | No focus-visible outlines on interactive elements | Add `:focus-visible` styles |

**Performance (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L748, L1498, L1559, L2047 | Full innerHTML replacement re-renders entire DOM trees instead of diffing | Already HTMLElement-based — acceptable, but consider migrating to LitElement |

**Duplication (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L12, L2858-2869 | `ANGLE_UPDATE_DEBOUNCE_MS` + `_debouncedApplyAngle()` duplicated identically in `color-list-editor-card.js` | Extract to shared `angle-debounce-utils.js` |
| L2638-2835 | Entire angle wheel UI (SVG + mouse/touch handlers) duplicated in `color-list-editor-card.js` | Extract to shared `angle-wheel-utils.js` |
| L748-1430 | CSS styles block (~680 lines) inline — significant overlap with `color-list-editor-card.js` styles | Extract shared styles to a utility |

**Responsiveness (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Entire file | No `@media` queries despite being the largest card | Add breakpoints for mobile layout |

**UX (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L771-794 | Excessive `!important` overrides (17 instances) indicate fragile specificity | Refactor CSS to avoid `!important` |

**Maintainability (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | 4,390 lines in a single file | Split into logical modules (render, handlers, styles) |
| L99, L284 | `window.addEventListener` in constructor — not balanced in all paths of disconnectedCallback | Verify all listeners removed |
| L124-2891 | 11 `console.error/warn` calls left in production | Wrap in `if (DEBUG)` guard or remove |

**Browser Compat (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Multiple | Uses `color-mix()` (not supported in Safari < 16.2) | Already using fallbacks, acceptable — document minimum browser |

**Security (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L186, L590, L748, L1498, L1559, L2047 | 6 `innerHTML =` assignments, some with interpolated user-facing content | Sanitize or switch to `textContent` where possible |
| L186 | `overlay.innerHTML = "👁"` — safe but `textContent` is more appropriate | Use `overlay.textContent = "👁"` |

---

### 2. `yeelight-cube-lamp-preview-card.js` (~5,002 lines) — 12 issues

**Colors (0)** — All colors properly in `var()` fallbacks. ✅

**A11y (4)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | No `aria-label` on power button, brightness slider, effect dropdown | Add semantic labels |
| All | No `role` attributes on custom interactive elements | Add proper ARIA roles |
| L543-552 | Document-level mouse/touch handlers for slider — no keyboard equivalent | Add keyboard support |
| All | No `:focus-visible` styles | Add focus indicators |

**Performance (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L1021, L1563, L1622, L1797 | 4 `innerHTML =` assignments for imperative DOM updates | Already HTMLElement-based — acceptable trade-off |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L201-204 | 4 separate debounce timer properties — could use a generic debounce utility | Extract shared `debounce()` helper |

**Maintainability (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | ~5,000 lines in a single file | Split rendering, handlers, styles |
| L400-782 | 9 `console.error/warn` calls in production | Add debug flag or remove |
| — | No `disconnectedCallback` — potential memory leak from document-level listeners | Add lifecycle cleanup |

**Browser Compat (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L4719, L4979 | Uses `@media` queries (good!) but also uses `color-mix()` elsewhere | Document minimum Safari 16.2 |

**Security (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L1021, L1563, L1622, L1797, L2038, L2062 | 6 `innerHTML =` assignments | Audit for user-supplied content injection |
| L1563 | `tabbedLabel.innerHTML` with interpolated `labelText`, `value`, `unit` — from entity state | Sanitize or use `textContent` + DOM API |

---

### 3. `yeelight-cube-lamp-preview-card-editor.js` (874 lines) — 1 issue

**A11y (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | No ARIA labels on editor form controls | Use native HA form elements which handle this |

All colors properly in `var()` with fallbacks. LitElement-based. ✅

---

### 4. `yeelight-cube-palette-card.js` (~1,964 lines) — 14 issues

**Colors (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L572 | `background: linear-gradient(135deg, #3a3a3a 0%, #252525 50%, #101010 100%) !important` — intentional dark "add" button but not themed | Wrap in `var(--palette-add-gradient, ...)` or mark intentional |
| L701, L823 | Multiple `rgba(255,255,255,0.5/0.95) !important` — hardcoded white overlays | Use `color-mix()` with `var(--card-background-color)` |

**A11y (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | No `aria-label` on palette color swatches, delete buttons, export/import buttons | Add labels |
| All | No `role="listbox"` or `role="option"` for palette color list | Add ARIA list roles |
| All | No keyboard navigation for palette items | Add tab navigation + Enter/Space/Delete handlers |

**Performance (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L358 | Full `shadowRoot.innerHTML =` replacement on each render | Consider selective DOM updates |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L466-597 | Delete button styles (~130 lines) overlap heavily with `delete-button-styles.js` | Use shared import |

**Responsiveness (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Entire file | No `@media` queries | Add responsive breakpoints |

**UX (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L466-597 | 25+ `!important` declarations in CSS | Reduce specificity reliance |

**Maintainability (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | No `disconnectedCallback` defined (HTMLElement) | Add lifecycle cleanup |
| L1171-1407 | 2 `console.error` calls in production | Guard or remove |

**Browser Compat (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | No `color-mix()` used here, but file depends on `delete-button-styles.js` which does | Transitive dependency |

**Security (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L254, L358 | `shadowRoot.innerHTML =` with template strings | Generally safe in this context (no external data) |
| L982 | `input.addEventListener("change", ...)` for file import — reads JSON from user file | Validate JSON structure before processing |

---

### 5. `yeelight-cube-color-list-editor-card.js` (~5,155 lines) — 20 issues

**Colors (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L701-703 | `background: rgba(255,255,255,0.95) !important; color: #000000 !important` — overlay text | Use `var(--card-background-color)` and `var(--primary-text-color)` |
| L823 | `background: rgba(255,255,255,0.5) !important` — hover overlay | Use `color-mix()` |
| L765, L769-770 | Colors properly in `var()` — OK. But inconsistent fallback values across file | Standardize fallback values |

**A11y (4)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | Zero ARIA attributes across 5,155 lines | Add `aria-label`, `role` to all interactive elements |
| All | No keyboard support for color grid drag/reorder | Add `keydown` handlers |
| All | No screen reader announcements for state changes | Add `aria-live` regions |
| All | No focus management after actions (delete, reorder) | Manage focus programmatically |

**Performance (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L598 | Full `shadowRoot.innerHTML =` replacement (600+ line template) | Consider incremental updates |

**Duplication (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L3335-3346 | `_debouncedApplyAngle()` identical copy from `gradient-card.js` | Extract to shared module |
| L3178-3233 | Angle wheel SVG + handlers — identical to `gradient-card.js` | Extract to shared module |
| L598-1437 | CSS styles block shares ~70% with `gradient-card.js` styles | Extract shared CSS |

**Responsiveness (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Entire file | No `@media` queries despite 5,155 lines of UI | Add mobile breakpoints |

**UX (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Multiple | 20+ `!important` declarations | Reduce |

**Maintainability (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | 5,155 lines — largest file in the project | Split aggressively |
| — | No `disconnectedCallback` (HTMLElement-based) | Add cleanup |
| Multiple | 5 `console.error/warn` in production | Guard |

**Browser Compat (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L769 | Uses `color-mix()` | Document browser minimum |

**Security (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L202, L281, L325, L374, L410, L474, L497, L598 | 8 `innerHTML =` assignments — several with dynamic content | Audit each for user-supplied data |
| L2631 | `pokerContainer.innerHTML = ""` — safe (clearing) | OK |
| — | File import via JSON parsing | Validate schema |

---

### 6. `yeelight-cube-calibration-card.js` (603 lines) — 5 issues

**Colors (0)** — Device calibration colors (L85-240: `#ff4444`, `#44cc44`, etc.) are **INTENTIONAL** — these represent specific LED colors being sent to the hardware. CSS uses `var()` properly. ✅

**A11y (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | No `aria-label` on calibration sliders | Add labels |
| All | No `role` on slider containers | Use `role="slider"` with `aria-valuemin/max/now` |

**Responsiveness (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Entire file | No `@media` queries | Add mobile breakpoints |

**Maintainability (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | No `disconnectedCallback` (HTMLElement) | Add cleanup (debounce timers at L293-294) |

**Security (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L383 | `shadowRoot.innerHTML =` — template only, no user data | Safe but note pattern |

---

### 7. `yeelight-cube-palette-card-editor.js` (835 lines) — 2 issues

**Colors (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Multiple | `border: 1px solid #cfd8dc` hardcoded (not in `var()`) | → `border: 1px solid var(--divider-color, #cfd8dc)` |

**A11y (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | No custom ARIA labels on editor controls | Rely on LitElement + HA native elements |

---

### 8. `yeelight-cube-gradient-card-editor.js` (~1,070 lines) — 1 issue

**A11y (1)** — Same as palette-card-editor. All colors properly in `var()`. ✅

---

### 9. `yeelight-cube-draw-card.js` (~3,291 lines) — 7 issues

**Colors (0)** — All colors in `var()` fallbacks or intentional pixel-art colors. ✅

**A11y (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | No `aria-label` on draw tools, gallery buttons, send button | Add labels |
| All | No keyboard support for pixel grid drawing | Add keyboard navigation |
| All | No screen reader support for tool selection state | Add `aria-pressed`/`aria-selected` |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L547-565 | Debounce logic reimplemented inline instead of using shared utility | Extract to helper |

**Maintainability (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | 3,291 lines | Already split into modules — good. But main file still large |
| Multiple | 6 `console.error/warn` in production | Guard |

**Security (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | No direct `innerHTML` in this file (uses Lit `html` template) | ✅ Secure |

---

### 10. `yeelight-cube-draw-card-editor.js` (~1,689 lines) — 1 issue

**A11y (1)** — All colors in `var()`. LitElement-based with proper lifecycle. ✅

---

### 11. `yeelight-cube-color-list-editor-card-editor.js` (615 lines) — 3 issues

**Colors (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L170 | `border: 1px solid #cfd8dc` — not in `var()` | → `var(--divider-color, #cfd8dc)` |
| L457 | `border-top: 2px solid #e0e0e0` — not in `var()` | → `var(--divider-color, #e0e0e0)` |

**A11y (1)** — No custom ARIA (LitElement handles most through HA).

---

### 12. `draw_card_palette_ui.js` (218 lines) — 2 issues

**A11y (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L90 | `connectedCallback()` defined but no `disconnectedCallback()` | Add disconnect cleanup |

**Security (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L148 | `this.innerHTML =` with template string containing palette data | Palette names from user input — sanitize |

---

### 13. `draw_card_styles.js` (~1,890 lines) — 3 issues

**Colors (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L412 | `color: #ffffff !important` in disabled state | → `color: var(--text-primary-color, #fff) !important` |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L386-451 | Pagination styles nearly identical to `pagination-utils.js` L16-95 | Use single shared source |

**UX (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Multiple | 50+ `!important` declarations (most for tool button sizing, acceptable for HA shadow DOM) | Document rationale |

---

### 14-23. `draw_card_palette.js`, `draw_card_ui.js`, `draw_card_state.js`, `draw_card_storage.js`, `draw_card_events.js`, `draw_card_handlers.js`, `draw_card_tools.js`, `draw_card_const.js`, `draw_utils.js`, `draw_card_matrix.js`

All **CLEAN** ✅ — No issues found. These well-decomposed utility modules follow good practices.

---

### 24-29. INTENTIONAL color files

**`draw_card_matrix_1d.js`**, **`draw_card_gallery_manager.js`**, **`yeelight-cube-dotmatrix.js`**, **`yeelight-cube-palette-utils.js`**, **`service-call-utils.js`**, **`slider_utils.js`**

All **CLEAN** ✅ᴵ — Hardcoded colors are intentional (device LED colors, pixel-art rendering). No other issues.

---

### 30. `carousel-utils.js` (~515 lines) — 2 issues

**Colors (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Unknown | `color: #ffffff !important` on navigation arrows | → `color: var(--text-primary-color, #fff) !important` |

**A11y (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| All | Carousel prev/next buttons have no `aria-label` | Add `aria-label="Previous"` / `aria-label="Next"` |

---

### 31. `compact-mode-styles.js` (124 lines) — 2 issues

**Colors (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Unknown | `border: 1px solid #e1e4e8` not in `var()` | → `var(--divider-color, #e1e4e8)` |

**Maintainability (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| — | File is DEPRECATED (replaced by `compact-layout-utils.js`) | Delete file or add deprecation notice |

---

### 32. `compact-layout-utils.js` (~130 lines) — 1 issue

**Browser Compat (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L50 | Uses `color-mix()` | Provide CSS fallback for older browsers |

All colors in `var()` fallbacks. ✅

---

### 33. `wheel-navigation-utils.js` (618 lines) — 0 issues

**Completely clean.** ✅ No hardcoded colors, proper `requestAnimationFrame` usage, clean architecture.

---

### 34. `entity-selector-utils.js` (476 lines) — 0 issues

All colors in `var()` fallbacks. ✅

---

### 35. `form-row-utils.js` (~200 lines) — 1 issue

**Colors (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| Unknown | `border: 1.5px solid #d0d7de` not in `var()` | → `var(--divider-color, #d0d7de)` |

---

### 36. `pagination-utils.js` (~180 lines) — 2 issues

**Colors (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L45 | `color: #ffffff !important` in disabled buttons | → `var(--text-primary-color, #fff)` |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L16-95 | Pagination styles near-duplicate of `draw_card_styles.js` L386-451 | Consolidate |

---

### 37. `button-group-utils.js` (~80 lines) — 0 issues

All colors in `var()` fallbacks. ✅

---

### 38. `editor_ui_utils.js` (~450 lines) — 0 issues

All colors in `var()` fallbacks. ✅

---

### 39. `gallery-mode-utils.js` (~180 lines) — 2 issues

**Colors (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L136 | `color: #dc3545` — error color not in `var()` | → `color: var(--error-color, #dc3545)` |
| L151 | `background: #fee` — error background not in `var()` | → `background: color-mix(in srgb, var(--error-color, #dc3545) 8%, var(--card-background-color, #fff))` |

---

### 40. `gallery-display-utils.js` (~750 lines) — 3 issues

**Colors (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L145 | `box-shadow: 0 0 2px #0008` — not in `var()` | → `rgba(0,0,0,0.5)` at minimum (already a shadow, acceptable) |
| L132, L221, L324 | `bgColor = "#000000"` as default param — this is a drawing canvas bg, **likely intentional** | Mark as intentional |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L132-200, L221-300, L324-400, L420-540 | Four very similar `render*Preview()` functions with repeated HTML patterns | Extract shared template helper |

---

### 41. `grid-mode-utils.js` (~140 lines) — 3 issues

**Colors (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L23 | `border: 1.5px solid #d0d7de` — not in `var()` | → `var(--divider-color, #d0d7de)` |
| L114-115 | `background: rgba(255,255,255,0.95); border: 1px solid rgba(0,0,0,0.1)` — tooltip, not themed | → Use `var(--card-background-color)` |

**Duplication (1)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L22-35 | Card item styles nearly identical to `list-mode-utils.js` L80-91 | Extract shared `.item-card` styles |

---

### 42. `list-mode-utils.js` (~100 lines) — 3 issues

**Colors (2)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L38, L82 | `border: 1.5px solid #d0d7de` — duplicated in inline style AND CSS | → `var(--divider-color, #d0d7de)` |
| L91 | `border-color: #bcc5d0` hover state — not in `var()` | → `color-mix(in srgb, var(--divider-color, #d0d7de) 80%, var(--primary-text-color, #000))` |

**Duplication (1)** — Same card styles as `grid-mode-utils.js`.

---

### 43. `album-view-coverflow.js` (~230 lines) — 0 issues

All colors in `var()` fallbacks. ✅

---

### 44. `delete-button-styles.js` (~160 lines) — 3 issues

**Colors (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L111 | `background: linear-gradient(135deg, #ff1744 0%, #d50000 100%) !important` — delete confirmation gradient | → Use `var(--error-color)` based gradient |
| L122 | `background: #fff !important` — delete icon background | → `var(--card-background-color, #fff)` |
| L143, L150 | Additional hardcoded gradient backgrounds for delete states | → Theme with `var(--error-color)` |

---

### 45. `export-import-button-utils.js` (~250 lines) — 3 issues

**Colors (3)**
| Line(s) | Issue | Fix |
|---------|-------|-----|
| L225 | `background: #01579b !important` — active state not themed | → `color-mix(in srgb, var(--primary-color) 80%, #000)` |
| L227-228 | `border: 2px solid #fff !important; box-shadow: ... #01579b` | → Use `var()` equivalents |
| L240-242 | `background: linear-gradient(135deg, #1565c0, #0d47a1)`, `box-shadow: ... #0d47a1` | → Use `var(--primary-color)` based |

---

## Cross-Cutting Issues

### CRITICAL: Accessibility Gap (26 issues, affects ALL card files)

Across **45 files and ~25,000+ lines of JavaScript**, the audit found:

- **1 single `tabindex` attribute** (across all files)
- **0 `aria-label` attributes**
- **0 `role` attributes**
- **0 `aria-live` regions**
- **No keyboard navigation** on custom interactive elements

This means the entire frontend is **inaccessible to screen readers, keyboard-only users, and assistive technologies**.

**Recommended fix priority:**

1. Add `aria-label` to ALL buttons, sliders, and interactive elements
2. Add `role="button"` to clickable `<div>`/`<span>` elements
3. Add `tabindex="0"` to interactive elements not natively focusable
4. Add `:focus-visible` outlines in shared styles
5. Add keyboard handlers (Enter/Space for activation, Arrow keys for navigation)

---

### Recurring Color Pattern: Inconsistent Border Fallbacks

The same hardcoded border pattern appears across 7 files with 4 different hex values:

| File                                           | Border Color            |
| ---------------------------------------------- | ----------------------- |
| compact-mode-styles.js                         | `#e1e4e8`               |
| form-row-utils.js                              | `#d0d7de`               |
| grid-mode-utils.js                             | `#d0d7de`               |
| list-mode-utils.js                             | `#d0d7de` / `#bcc5d0`   |
| yeelight-cube-palette-card-editor.js           | `#cfd8dc`               |
| yeelight-cube-color-list-editor-card-editor.js | `#cfd8dc` / `#e0e0e0`   |
| editor_ui_utils.js                             | `#cfd8dc` (in var() ✅) |

**Fix:** Standardize ALL borders to `var(--divider-color, #d0d7de)` — pick one fallback value.

---

### Security: innerHTML Usage (25 occurrences)

| File                                    | Count | Risk Level                                |
| --------------------------------------- | ----- | ----------------------------------------- |
| yeelight-cube-color-list-editor-card.js | 8     | Medium — some interpolate state data      |
| yeelight-cube-gradient-card.js          | 6     | Low — mostly static templates             |
| yeelight-cube-lamp-preview-card.js      | 6     | Medium — interpolates entity state values |
| yeelight-cube-palette-card.js           | 2     | Low                                       |
| yeelight-cube-calibration-card.js       | 1     | Low                                       |
| draw_card_palette_ui.js                 | 1     | Medium — interpolates palette names       |

**Recommendation:** For HTMLElement-based cards, `innerHTML` is the primary rendering mechanism. The risk is low since data comes from HA state (trusted), but consider:

1. Using `textContent` for single text assignments (e.g., `overlay.innerHTML = "👁"`)
2. Sanitizing any user-editable strings (palette names, pixel art names) before interpolation
3. Long-term: migrate HTMLElement cards to LitElement for template safety

---

### Architecture: Mixed HTMLElement vs LitElement

| Base Class      | Cards                                                                                                                           | Concerns                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **HTMLElement** | gradient-card, lamp-preview-card, palette-card, color-list-editor-card, calibration-card, draw_card_palette_ui                  | No reactive properties, imperative innerHTML, manual lifecycle |
| **LitElement**  | draw-card, draw-card-editor, gradient-card-editor, lamp-preview-card-editor, palette-card-editor, color-list-editor-card-editor | Reactive, template-based, proper lifecycle                     |

The HTMLElement cards are the ones with the most issues (maintainability, security, performance). Consider gradual migration to LitElement.

---

## Priority Action Plan

| Priority | Action                                                       | Files Affected                      | Est. Effort |
| -------- | ------------------------------------------------------------ | ----------------------------------- | ----------- |
| **P0**   | Fix remaining hardcoded borders → `var(--divider-color)`     | 7 utils + 2 editors                 | 30 min      |
| **P0**   | Fix `#dc3545`/`#fee` in gallery-mode-utils                   | 1 file                              | 5 min       |
| **P1**   | Fix hardcoded `#ffffff` in disabled states                   | 3 files                             | 10 min      |
| **P1**   | Fix delete-button-styles.js gradients → `var(--error-color)` | 1 file                              | 15 min      |
| **P1**   | Fix export-import-button-utils.js active states              | 1 file                              | 15 min      |
| **P1**   | Fix `rgba(255,255,255,*)` overlays → `color-mix()`           | 3 card files                        | 20 min      |
| **P2**   | Add basic ARIA labels to all interactive elements            | All card files                      | 2-3 hours   |
| **P2**   | Extract duplicated angle-wheel code to shared module         | gradient-card + color-list-editor   | 1 hour      |
| **P2**   | Consolidate pagination styles                                | draw_card_styles + pagination-utils | 30 min      |
| **P3**   | Add `disconnectedCallback` to HTMLElement cards              | 4 card files                        | 30 min      |
| **P3**   | Guard `console.*` calls with debug flag                      | 8 files                             | 30 min      |
| **P3**   | Add keyboard support to interactive elements                 | All card files                      | 4-6 hours   |
| **P4**   | Add `@media` queries to large cards                          | 3 card files                        | 2 hours     |
| **P4**   | Split large files (>3000 lines)                              | 3 card files                        | Day+        |
| **P4**   | Delete deprecated compact-mode-styles.js                     | 1 file                              | 5 min       |
