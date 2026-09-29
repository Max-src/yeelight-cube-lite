# Complete Service Reference

Full documentation for all custom actions (services) registered under the `yeelight_cube` domain.

> [!NOTE]
> For general setup, cards, and entities, see [README.md](README.md).

> [!NOTE]
> **`entity_id`** is required by all lamp services. When calling services directly from automations, scripts, or Developer Tools, you must provide it explicitly.

---

## Table of Contents

**[`Text Services`](#-text-services)** · **[`Drawing Services`](#-drawing-services)** · **[`Gradient Services`](#-gradient-services)** · **[`Palette Services`](#-palette-services)** · **[`Clock, Native Effects and Rotation`](#-clock-native-effects-and-rotation)** · **[`Configuration Services`](#-configuration-services)** · **[`Device Management`](#-device-management)** · **[`Multi-Entity Operations`](#-multi-entity-operations)** · **[`Node-RED Integration`](#-node-red-integration)** · **[`Service Response Data`](#-service-response-data)** · **[`Quick Reference`](#-quick-reference)**

---

## Clock and Native Effects Cards

See the [Clock](README.md#clock-card) and [Native Effects](README.md#native-effects-card)
README sections for screenshots and copyable YAML. These are Lovelace card
configurations, not service payloads: cards use `entity` / `target_entities`,
while direct service calls use `entity_id`.

| Configuration | Applies To | Purpose |
| :-- | :-- | :-- |
| `entity` | Both | Primary light entity for a single-lamp card |
| `target_entities` | Both | List of target light entities for multi-lamp commands |
| `title`, `show_card_background` | Both | Card title and `ha-card` background |
| `show_current_preview` | Clock | Show the current clock preview |
| `show_preview`, `lamp_preview_size`, `preview_brightness` | Native Effects | Show the current animation preview, its size (30–100 %) and whether it follows lamp brightness |
| `show_actions`, `action_buttons`, `actions_buttons_style`, `actions_buttons_content_mode` | Both | Actions row (Previous, Next, Random, Freeze display, Refresh, Power), its order and button styling |
| `show_brightness`, `show_animation_speed`, `slider_style`, `slider_show_raw_value` | Both | Lamp sliders, slider style, and raw device units (speed 1–255, brightness 3–255) instead of percentages |
| `show_content_toggle`, `show_format_toggles` | Clock | Time/date content and time-format controls |
| `show_color_modes`, `color_mode_selector`, `visible_color_modes`, `show_save_color_mode_button` | Both | Palette/custom-colour selection as `buttons` or `dropdown`, which modes are offered, and the inline save button |
| `show_save_clock_style_button` | Clock | Inline "save clock style" button next to the colour row |
| `show_device_orientation` | Native Effects | Device orientation control (the firmware clock cannot rotate, so the Clock card has none) |
| `show_gallery`, `show_search` | Both | Show the style/effect browser and its text search |
| `style_selector_style` | Both | `filled`, `dropdown`, `preview-list`, `preview-grid`, `preview-strip`, `preview-carousel`, `preview-wheel`, or `original` |
| `effect_view` | Both | `grid` or `list` for the Original browser |
| `items_per_page` | Both | Pagination for Original and Live Preview list/grid browsers; editor range 0-16, with 0 meaning no pagination |
| `show_badges` | Both | Capability labels in the Original browser |
| `visible_styles` / `visible_effects` | Clock / Native Effects | Ordered browser selection of style keys / effect names (Clock also needs `custom_visible_styles: true`) |
| `show_favourites`, `favourites_show_stars`, `favourites_show_previews` | Both | Show saved style/effect and colour combinations, the gold star badges, and animated favourite previews |
| `show_rotation` | Both | Show backend rotation status and commands |
| `rotation_interval` | Both | Seconds between rotation steps, 10-604800 |
| `preview_appearance`, `preview_overrides`, `appearance_presets` | Both | Shared and per-surface appearance, described below |

Use the visual editor for section visibility, button styles, orientation,
appearance presets and browser layouts. Colour-responsive filtering is automatic;
`show_only_responding_styles` is obsolete. Experimental playback is controlled
by the lamp's **Experimental Features** setting, not a card-only toggle.

### Favourites, Presets and Offline Use

- **Favourites** are browser-local, separated by card kind and target entity set.
  Each entry stores a style/effect key, colour mode and optional RGB. Reordering
  or shuffling favourites changes the list used by the next rotation Start.
  Browser storage clearing or a different browser does not preserve this list.
- **Saved clock styles / reusable colours** use `save_clock_preset` and live in
  Home Assistant. These are distinct from favourites and require a working HA
  connection, though the lamp itself need not be reachable to save a preset.
- **Appearance presets** live in card YAML. They change previews, not lamp output.
- If any configured lamp entity is missing, unknown or unavailable, style and
  colour selections become local preview edits. Built-in catalogues and
  favourite previews remain available. Hardware actions stay gated; returning
  live state discards preview drafts without automatically applying them.
- Missing rotation attributes show **Status unavailable**, not a fabricated
  running/stopped result. A previously observed matching active/waiting rotation
  can retain Stop; an unrelated card or a cold card with no known rotation does
  not invent one. Fresh backend state takes precedence.

Rotation uses the favourites submitted at Start and runs in Home Assistant,
independently of browser storage or an open dashboard. Clock and Native Effects
share the lamp's single rotation slot; starting one replaces the other on those
targets. A single multi-target Start aligns item selection across the group.
Independent Start calls are separate rotations, and animation frames are not
guaranteed to be physically phase-synchronised.

Screenshots and their automatic regeneration workflow are documented in
[docs/DOCUMENTATION_SCREENSHOTS.md](docs/DOCUMENTATION_SCREENSHOTS.md).

## Shared Preview Appearance

Clock, Native Effects, Lamp Preview, Gradient and Draw use the same appearance
model and preset controls for their matrix surfaces. Colour List and Palette
keep their colour-swatch controls; matrix appearance settings do not apply to
those swatches.

| Preset | Background | Pixels | Spacing | Shadow | Hide Black Pixels |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Classic | Black | Circle | Normal | Off | Off |
| Light | White | Rounded | Subtle | On | On |
| Square | Transparent | Square | None | Off | On |

Use **Preview Appearance** to choose a preset or fine-tune the shared values.
Size, orientation and layout remain local to each surface. Sections can follow
the card default or override individual properties. Shared controls identify
custom sections; **Use for all previews** removes only that property's overrides.
Changing a shared preset does not silently discard section customisations.

**Manage presets** saves the current shared appearance as a new preset or updates
an existing one. Presets can be renamed; added presets can be deleted, and
built-ins can be restored. Saved presets belong to the card configuration, not
a device or a dashboard-wide library. They do not send commands to the lamp.

The common configuration keys are `preview_appearance` (background, pixels,
spacing, shadow, ignoreBlack), `preview_overrides` (per-section values), and
`appearance_presets` (entries containing id, name and appearance). Existing
Clock-prefixed keys remain supported. Existing legacy appearance settings are
preserved as section overrides when necessary; opening an editor does not
replace a saved look with a preset.

Matrix gaps, padding and shadows use a shared width-relative scale, including
browser thumbnails, favourites, Draw's matrix and Gradient's rotary preview.
Shrinking a preview preserves its pixel-to-gap proportions. This requires a
modern browser with CSS container-query unit support, as used by current Home
Assistant browsers.

## Frontend Startup Diagnostics

Several cards showing "Configuration error" together can indicate a failed shared JavaScript dependency, but can also result from initialization errors. A working camera image does not test the custom-card module path. Reload recovery alone does not identify the cause.

The integration registers `frontend-diagnostics.js` as a standalone Lovelace module. After installing this change, restart Home Assistant and reload the dashboard once so the new resource is registered. This is instrumentation, not an automatic repair or reload mechanism.

When the problem occurs, open the browser developer tools (F12), select Console, and run this **before reloading**:

```js
copy(JSON.stringify(window.yeelightCubeDiagnostics.report(), null, 2))
```

`copy()` is a Chromium/Edge developer-console helper. In other browsers, evaluate `JSON.stringify(window.yeelightCubeDiagnostics.report(), null, 2)` and copy the returned text. The report includes the current load and the immediately preceding load in the same tab, so it can still be useful after a reload.

- `cards`: whether each main custom element registered. Missing elements indicate loading/evaluation did not finish, not invalid lamp settings.
- `events`: bounded JavaScript errors, unhandled rejections, connectivity events, registration times, and HA error-card messages collected when requesting a report. Some errors caught internally by HA will not reach global error listeners.
- `resources`: recent integration module paths, timings, transfer sizes and HTTP statuses where the browser exposes them. A null status or zero transfer size is **not** proof of a failed request.

Also enable **Preserve log** in Console and Network before reproducing. Leave **Disable cache** off for the first capture. Record the first relevant exception and failed `.js` request: path, status, response Content-Type, and time. Check HA and reverse-proxy logs at that time for 404/5xx responses. If all elements registered, the HA error-card message/exception is especially important. If a module reports a missing export, record both its importer and dependency URLs; stale or mixed deployment files are one possible cause.

The recorder has no shared imports, sends no telemetry or lamp commands, and stores only a bounded snapshot in same-tab `sessionStorage`. It omits URL query strings/fragments and does not collect HA configuration, entity state, cookies or request headers. Error text may still contain identifying information: inspect reports before sharing. Do not share access tokens or an unredacted HAR.

Limitations: this resource can itself fail to load; Lovelace does not guarantee it starts before every other resource. It cannot reconstruct events from before installation. If `window.yeelightCubeDiagnostics` is undefined, use the browser Console/Network capture. `Cache-Control: stale-if-error` is not a guaranteed browser recovery mechanism. Failed ES-module imports can remain failed for the life of the document even after the network recovers.

To stop recording and remove the stored report for this tab:

```js
window.yeelightCubeDiagnostics.stop();
window.yeelightCubeDiagnostics.clear();
```

Regression check: set `STARTUP_ONLY=1` when running `node tests/card-ui-parity.cjs` with the usual Playwright environment. It injects a shared-module 503, verifies all seven main cards fail while a standalone card with no shared imports still loads, then verifies reload recovery and diagnostic retention. The standalone control it uses is the internal Font Editor card, which is not shipped in the public repository, so this check only runs from a development checkout. It reproduces a possible failure mechanism, not proof of any particular production outage.

---

## 📝 Text Services

Control what text is displayed on the lamp and how it looks.

### `set_custom_text`

Display text on the lamp.

| Field | Required | Description |
| :-- | :-- | :-- |
| `text` | Yes | Text to display on the matrix |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_custom_text
data:
  text: "HELLO"
  entity_id: light.cubelite_192_168_4_102
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Set-Custom-Text.png" alt="Action - set_custom_text"></td>
  </tr>
</table>

---

### `set_text_colors`

Set individual RGB colors for each character in the displayed text.

| Field | Required | Description |
| :-- | :-- | :-- |
| `text_colors` | Yes | List of `[R, G, B]` arrays, one per character |
| `save_as_palette` | No | Save these colors as a new palette at the same time (default: `false`) |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_text_colors
data:
  text_colors: [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
  entity_id: light.cubelite_192_168_4_102
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Set-Text-Colors.png" alt="Action - set_text_colors"></td>
  </tr>
</table>

---

### `set_font`

Change the text font.

| Field | Required | Description |
| :-- | :-- | :-- |
| `font` | Yes | Font name: `basic`, `fat`, `italic`, or `native` (Basic with the firmware clock's digit shapes) |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_font
data:
  font: "fat"
  entity_id: light.cubelite_192_168_4_102
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Set-Font.png" alt="Action - set_font"></td>
  </tr>
</table>

---

### `set_alignment`

Set text alignment.

| Field | Required | Description |
| :-- | :-- | :-- |
| `alignment` | Yes | Alignment: `left`, `center`, or `right` |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_alignment
data:
  alignment: "right"
  entity_id: light.cubelite_192_168_4_102
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Set-Alignment.png" alt="Action - set_alignment"></td>
  </tr>
</table>

---

### `set_orientation`

Control display orientation.

| Field | Required | Description |
| :-- | :-- | :-- |
| `orientation` | Yes | Orientation: `normal` or `flipped` |
| `entity_id` | Yes | Target lamp entity |

> [!NOTE]
> Lamp preview on dashboards will stay upright. Only the content displayed on the physical lamp will be rotated.

```yaml
action: yeelight_cube.set_orientation
data:
  orientation: "flipped"
  entity_id: light.cubelite_192_168_4_102
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Set-Orientation.png" alt="Action - set_orientation"></td>
  </tr>
</table>

---

## 🖼️ Drawing Services

Push pixel art to the lamp, and manage the saved pixel art collection.

> [!NOTE]
> Colours are always `[R, G, B]` arrays of integers 0-255. Collections are
> capped: 500 palettes, 500 pixel arts, 100 colours per palette or colour list,
> 1000 pixel entries per pixel art, and names of up to 100 characters. Calls
> that exceed these limits or contain malformed data are rejected with an error
> instead of being stored.

### `apply_custom_pixels`

Display a pixel art frame on the lamp. The lamp has 100 pixels arranged in a 20×5 grid (20 columns, 5 rows). Positions are numbered 0-99, left-to-right then bottom-to-top (position 0 = bottom-left, position 99 = top-right).

| Field | Required | Description |
| :-- | :-- | :-- |
| `pixels` | Yes | Array of `{ position, color }` entries |
| `entity_id` | Yes | Target lamp entity |

**Pixel entry rules:**

| Rule | Description |
| :-- | :-- |
| **Partial frames** | You don't need to specify all 100 pixels |
| **Missing positions** | Treated as black (off) |
| **Order** | Entries can be in any order |
| **Duplicates** | Last entry for a position wins |
| **Out of range** | Positions outside 0-99 are ignored |
| **Grouped positions** | `position` accepts a single index or a list of indexes |

<details>
<summary>View examples</summary>

**Sparse frame** - only non-black pixels needed, all others default to off:

```yaml
action: yeelight_cube.apply_custom_pixels
data:
  entity_id: light.cubelite_192_168_4_102
  pixels:
    - { "position": 49, "color": [255, 255, 0] }
    - { "position": 50, "color": [255, 255, 0] }
    - { "position": 22, "color": [255, 0, 255] }
    - { "position": 77, "color": [0, 255, 255] }
```

**Grouped positions** - assign the same color to multiple pixels in one entry:

```yaml
action: yeelight_cube.apply_custom_pixels
data:
  entity_id: light.cubelite_192_168_4_102
  pixels:
    - { "position": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], "color": [255,0,0] }
    - { "position": [20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39], "color": [255,128,0] }
    - { "position": [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59], "color": [255,255,0] }
    - { "position": [60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79], "color": [0,200,0] }
    - { "position": [80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99], "color": [0,80,255] }
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Apply-Custom-Pixels-2.png" alt="Action - apply_custom_pixels (grouped)"></td>
  </tr>
</table>

**Full 100-pixel frame** - every pixel explicitly defined:

```yaml
action: yeelight_cube.apply_custom_pixels
data:
  entity_id: light.cubelite_192_168_4_102
  pixels:
    - { "position": 0, "color": [255, 0, 0] }
    - { "position": 1, "color": [0, 255, 0] }
    - { "position": 2, "color": [0, 0, 255] }
    # ... positions 3-99 with their colors
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Apply-Custom-Pixels-1.png" alt="Action - apply_custom_pixels (full)"></td>
  </tr>
</table>

</details>

---

### `save_pixel_art`

Save a drawing to the pixel art collection.

| Field | Required | Description |
| :-- | :-- | :-- |
| `name` | No | Name for the saved pixel art; defaults to `Pixel Art N` |
| `pixels` | Yes | Array of `{ position, color }` entries (single or grouped positions); black pixels are dropped |

> [!TIP]
> The response from `get_pixel_art` (with `group_by_color: true`) uses the same format, so you can paste it directly into `save_pixel_art` without editing.

```yaml
action: yeelight_cube.save_pixel_art
data:
  name: "My Artwork"
  pixels:
    - { "position": 0, "color": [255, 0, 0] }
    - { "position": [5, 6, 7, 8, 9], "color": [0, 255, 0] }
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Save-Pixel-Art.png" alt="Action - save_pixel_art"></td>
  </tr>
</table>

---

### `apply_pixel_art`

Load a saved pixel art by index and display it on the lamp.

| Field | Required | Description |
| :-- | :-- | :-- |
| `idx` | Yes | 0-based index of the pixel art |
| `expected_name` | No | Name of the pixel art you expect at `idx`. If the list changed (another browser deleted or reordered items), the call fails instead of acting on the wrong pixel art |
| `entity_id` | Yes | Target lamp entity (single or list) |

> [!TIP]
> Use this template in **Developer Tools > Template** to list all saved drawings with their indexes:
> ```jinja
> {% set arts = state_attr('sensor.yeelight_cube_saved_pixel_arts', 'pixel_arts') %}
> {% for art in arts %}{{ loop.index0 }}: {{ art.name }}
> {% endfor %}
> ```

```yaml
action: yeelight_cube.apply_pixel_art
data:
  idx: 0
  entity_id: light.cubelite_192_168_4_102
```

---

### `remove_pixel_art`

Delete a saved pixel art.

| Field | Required | Description |
| :-- | :-- | :-- |
| `idx` | Yes | 0-based index of the pixel art to delete |
| `expected_name` | No | Name of the pixel art you expect at `idx`. If the list changed (another browser deleted or reordered items), the call fails instead of acting on the wrong pixel art |

```yaml
action: yeelight_cube.remove_pixel_art
data:
  idx: 0
```

---

### `rename_pixel_art`

Rename a saved pixel art.

| Field | Required | Description |
| :-- | :-- | :-- |
| `idx` | Yes | 0-based index of the pixel art |
| `name` | Yes | New name |
| `expected_name` | No | Name of the pixel art you expect at `idx`. If the list changed (another browser deleted or reordered items), the call fails instead of acting on the wrong pixel art |

```yaml
action: yeelight_cube.rename_pixel_art
data:
  idx: 0
  name: "Updated Artwork"
```

---

### `get_pixel_art`

Retrieve saved pixel art data. Returns the pixel art in the same format accepted by `save_pixel_art`, so the response can be used directly to re-save or send to another system.

| Field | Required | Default | Description |
| :-- | :-- | :-- | :-- |
| `idx` | Yes | - | 0-based index of the pixel art |
| `group_by_color` | No | `false` | Group pixels by color instead of flat list |

```yaml
action: yeelight_cube.get_pixel_art
data:
  idx: 0
  group_by_color: true
```

<details>
<summary>View response formats</summary>

**Default** (`group_by_color: false`) - one entry per pixel:

```yaml
name: "Magic Lamp"
pixels:
  - position: 7
    color: [255, 191, 1]
  - position: 8
    color: [255, 191, 1]
  - position: 68
    color: [255, 136, 0]
  # ...
```

**Grouped** (`group_by_color: true`) - pixels grouped by color:

```yaml
name: "Magic Lamp"
pixels:
  - color: [0, 128, 255]
    position: [12, 13, 32, 33]
  - color: [255, 191, 1]
    position: [7, 8, 27, 28, 47, 48]
  # ...
```

<blockquote><strong>ℹ️ Note:</strong> HA's developer tools serializes the response in YAML block style (each list item on its own line). This is cosmetically different from the compact inline form shown above, but represents identical data and can be copy-pasted directly into any service call.</blockquote>

</details>

---

### `update_pixel_arts`

Append arts to, or fully replace, the saved pixel art collection. Used by the Draw Card for reordering and file imports.

| Field | Required | Default | Description |
| :-- | :-- | :-- | :-- |
| `pixel_arts` | Yes | - | Array of `{ name, pixels }` objects |
| `replace` | No | `false` | `true` = full replacement; `false` = append |

> [!WARNING]
> `replace: true` is destructive and replaces the entire collection. Use the Draw Card gallery export button to back up first.

<details>
<summary>View examples</summary>

**Append** (non-destructive, default):

```yaml
action: yeelight_cube.update_pixel_arts
data:
  pixel_arts:
    - name: "Red Corner"
      pixels:
        - { "position": 0, "color": [255, 0, 0] }
        - { "position": 1, "color": [255, 0, 0] }
        - { "position": 20, "color": [255, 0, 0] }
    - name: "Rainbow Stripes"
      pixels:
        - { "position": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], "color": [255,0,0] }
        - { "position": [20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39], "color": [255,128,0] }
        - { "position": [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59], "color": [255,255,0] }
        - { "position": [60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79], "color": [0,200,0] }
        - { "position": [80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99], "color": [0,80,255] }
```

**Replace** (destructive):

```yaml
action: yeelight_cube.update_pixel_arts
data:
  replace: true
  pixel_arts:
    - name: "Rainbow Stripes"
      pixels:
        - { "position": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19], "color": [255,0,0] }
        - { "position": [20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39], "color": [255,128,0] }
        - { "position": [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59], "color": [255,255,0] }
        - { "position": [60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79], "color": [0,200,0] }
        - { "position": [80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99], "color": [0,80,255] }
```

</details>

---

### `move_pixel_art`

Move one saved pixel art to a new position. The Draw Card uses this for
drag-and-drop reordering, so pixel arts other clients added in the meantime are
kept (unlike `update_pixel_arts` with `replace: true`).

| Field | Required | Description |
| :-- | :-- | :-- |
| `from_idx` | Yes | Current 0-based index of the pixel art |
| `to_idx` | Yes | New 0-based index |
| `expected_name` | No | Name expected at `from_idx`; the move fails if the list changed |

```yaml
action: yeelight_cube.move_pixel_art
data:
  from_idx: 3
  to_idx: 0
  expected_name: "Magic Lamp"
```

---

### `display_image`

Display a base64-encoded image on the lamp (resized/cropped to 20×5).

| Field | Required | Description |
| :-- | :-- | :-- |
| `image_b64` | Yes | Base64-encoded image string (any format Pillow reads: PNG, JPEG, GIF, ...). At most 4,000,000 characters (about a 3 MB file) and 2048×2048 pixels |
| `entity_id` | Yes | Target lamp entity |

The call fails with an error when the data is too large, not base64, or not an image, or when no Yeelight Cube lamp matches `entity_id`.

```yaml
action: yeelight_cube.display_image
data:
  image_b64: "<base64-encoded image string>"
  entity_id: light.cubelite_192_168_4_102
```

---

## 🌈 Gradient Services

Switch display modes, set gradient angles, and control how colors fill the lamp.

<img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Variation-1.png" alt="Gradient card" width="360">

### `set_mode`

Switch to the native Clock or Native Effect content, or change the Matrix display mode.

| Field | Required | Description |
| :-- | :-- | :-- |
| `mode` | Yes | Display mode (see table below) |
| `full_panel` | No | Fill the entire 20×5 pixel grid (`true`) or restrict the gradient to text pixels only (`false`). Setting this alongside `mode` avoids a redundant second call. |
| `entity_id` | Yes | Target lamp entity (list supported) |

| Mode | Description |
| :-- | :-- |
| **Clock** | Firmware-native clock using the configured clock style and options |
| **Native Effect** | Firmware-native animation using the selected Native effect, speed and direction |
| **Solid Color** | Single color fill |
| **Letter Gradient** | Gradient per letter |
| **Column Gradient** | Vertical gradient across 20 columns |
| **Row Gradient** | Horizontal gradient across 5 rows |
| **Angle Gradient** | Gradient at a configurable angle |
| **Radial Gradient** | Circular gradient from center |
| **Letter Vertical Gradient** | Vertical gradient applied per character |
| **Letter Angle Gradient** | Angled gradient applied per character |
| **Text Color Sequence** | Each character gets a different color |
| **Panel Color Sequence** | Color sequence applied across all pixels |
| **Custom Draw** | Pixel art mode (use the Draw Card) |

```yaml
action: yeelight_cube.set_mode
data:
  mode: "Angle Gradient"
  entity_id: light.cubelite_192_168_4_102
```

`Clock` uses the Cube Lite private LAN command and has no device state readback.
The Clock: Style, Clock: Content (Time / Time & Date / Date only), Clock: Show
date, Clock: 12-hour format, and Clock: Blink colon entities configure the values
sent when Clock mode is activated. Music Flow is not a `set_mode` value; select
it through the **Content mode** entity.

---

### `set_solid_color`

Set a single solid RGB color on the lamp (shortcut for Solid Color mode).

| Field | Required | Description |
| :-- | :-- | :-- |
| `rgb_color` | Yes | `[R, G, B]` array (0-255) or a hex string such as `"#FF8000"` |
| `entity_id` | Yes | Target lamp entity (list supported) |

```yaml
action: yeelight_cube.set_solid_color
data:
  rgb_color: [255, 128, 0]
  entity_id: light.cubelite_192_168_4_102
```

---

### `set_angle`

Set the gradient angle (for Angle Gradient mode).

| Field | Required | Description |
| :-- | :-- | :-- |
| `angle` | Yes | Angle in degrees (0-360) |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_angle
data:
  angle: 45.0
  entity_id: light.cubelite_192_168_4_102
```

---

### `set_full_panel`

Control whether gradients fill the entire 20×5 pixel grid or only the text pixels.

| Field | Required | Description |
| :-- | :-- | :-- |
| `full_panel` | Yes | `true` = fill entire panel, `false` = text pixels only |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_full_panel
data:
  full_panel: true
  entity_id: light.cubelite_192_168_4_102
```

---

### `preview_gradient_modes`

Generate preview matrix data for the nine text/gradient modes (every Matrix mode except Panel Color Sequence and Custom Draw) using the entity's current text, colors, and angle. This service does **not** change what is displayed on the lamp — instead it fires a `yeelight_cube_gradient_preview_response` event containing rendered 20×5 pixel matrices for every mode, which the Gradient Card reads to display live mode previews without touching the lamp.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity |
| `apply_brightness` | No | Include current brightness in the preview matrices (default: `false`) |

```yaml
action: yeelight_cube.preview_gradient_modes
data:
  entity_id: light.cubelite_192_168_4_102
  apply_brightness: false
```

> [!NOTE]
> Results are delivered via the **`yeelight_cube_gradient_preview_response`** event on the HA event bus, not as a direct return value. The event payload includes `entity_id`, `previews` (a dict of mode name → 100-pixel color list), `rows`, `cols`, `text`, `angle`, `brightness`, `darken_percent`, `apply_brightness` and `full_panel`.

---

## 🎨 Palette Services

Save, load, and manage color palettes shared across all cards and lamps.

> [!NOTE]
> Colours are always `[R, G, B]` arrays of integers 0-255. Collections are
> capped: 500 palettes, 500 pixel arts, 100 colours per palette or colour list,
> 1000 pixel entries per pixel art, and names of up to 100 characters. Calls
> that exceed these limits or contain malformed data are rejected with an error
> instead of being stored.

<img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Variation-1.png" alt="Palettes card" width="360">

### `save_palette`

Save a color palette.

| Field | Required | Description |
| :-- | :-- | :-- |
| `palette` | Yes | List of `[R, G, B]` arrays |
| `name` | No | Palette name. Auto-generated if omitted. |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.save_palette
data:
  palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
  name: "RGB Rainbow"
  entity_id: light.cubelite_192_168_4_102
```

---

### `load_palette`

Load a saved palette by index.

| Field | Required | Description |
| :-- | :-- | :-- |
| `idx` | Yes | 0-based index of the palette |
| `expected_name` | No | Name of the palette you expect at `idx`. If the list changed (another browser deleted or reordered items), the call fails instead of acting on the wrong palette |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.load_palette
data:
  idx: 0
  entity_id: light.cubelite_192_168_4_102
```

---

### `remove_palette`

Delete a saved palette.

| Field | Required | Description |
| :-- | :-- | :-- |
| `idx` | Yes | 0-based index of the palette to delete |
| `expected_name` | No | Name of the palette you expect at `idx`. If the list changed (another browser deleted or reordered items), the call fails instead of acting on the wrong palette |

```yaml
action: yeelight_cube.remove_palette
data:
  idx: 0
```

---

### `rename_palette`

Rename a saved palette.

| Field | Required | Description |
| :-- | :-- | :-- |
| `idx` | Yes | 0-based index of the palette |
| `name` | Yes | New name |
| `expected_name` | No | Name of the palette you expect at `idx`. If the list changed (another browser deleted or reordered items), the call fails instead of acting on the wrong palette |

```yaml
action: yeelight_cube.rename_palette
data:
  idx: 0
  name: "Updated Palette"
```

---

### `add_palettes`

Append palettes to the saved collection without resending the whole list. The
Palettes Card import uses this, so palettes other clients added in the
meantime are kept.

| Field | Required | Description |
| :-- | :-- | :-- |
| `palettes` | Yes | Array of `{ name, colors }` objects; colours are `[R, G, B]` arrays (0-255) |

```yaml
action: yeelight_cube.add_palettes
data:
  palettes:
    - name: "Sunset"
      colors: [[255, 94, 77], [255, 195, 0]]
```

---

### `set_palettes`

Set the complete palette collection (full replacement).

| Field | Required | Description |
| :-- | :-- | :-- |
| `palettes` | Yes | Array of `{ name, colors }` objects |

```yaml
action: yeelight_cube.set_palettes
data:
  palettes:
    - name: "Palette1"
      colors: [[255, 0, 0], [0, 255, 0]]
    - name: "Palette2"
      colors: [[0, 0, 255], [255, 255, 0]]
```

---

## 🎬 Clock, Native Effects and Rotation

Firmware-native display features: the clock, built-in animations, saved solid
colours, display freeze, physical orientation, and the server-side effect
rotation that keeps cycling even after the dashboard is closed.

### `set_native_effect`

Apply one of the lamp's firmware-native animations (the "Native Effect" content
mode).

| Field | Required | Description |
| :-- | :-- | :-- |
| `effect` | No | Effect name (e.g. `Rainbow`, `Ocean Waves`). Omit to keep the current effect. |
| `speed` | No | Animation speed 1–255 (only for effects that support it) |
| `color_mode` | No | Palette (`normal`, `bw`, `red_blue`, `white_orange`, `blue_yellow`, `purple_orange`) when the effect supports it |
| `color` | No | Custom `[r, g, b]` (0–255) or `"clear"`/`null` to drop a custom colour |
| `activate` | No | Switch to Native Effect mode immediately (default `true`) |
| `entity_id` | Yes | Target lamp entity (list supported) |

```yaml
action: yeelight_cube.set_native_effect
data:
  effect: Rainbow
  speed: 120
  color_mode: red_blue
  entity_id: light.cubelite_a904
```

<details>
<summary><strong>Valid effect names</strong></summary>

**Official (18, always available):**
`Streamer`, `Starry sky`, `Spectrum`, `Ocean Waves`, `Rainbow`, `Waterfall`,
`Aurora`, `Bonfire`, `Pinball`, `Shooting Star`, `Tide`, `Building block`,
`Hacking`, `Flower Sea`, `Magic`, `Wonderland`, `Kaleidoscope`, `Palette`

**Experimental (19, require the Experimental Features switch):**
`Rainbow Flow`, `Spectrum Chase`, `Pastel Pulse`, `Fireworks`,
`Monochrome Waves`, `Pulse`, `Solar Flare`, `Prism`, `Ember`, `Color Trails`,
`Sunset`, `Carousel`, `Blue Yellow`, `Ice Blue`, `Blue White`,
`Spectrum Crumble`, `Drift`, `Spectrum Bands`, `Twinkle`

Names are matched exactly. Additional unnamed firmware modes exist but are hidden
because they have no stable name.

</details>

Experimental effects require **Experimental Features** to be enabled on the lamp.

The call validates its fields (unknown effect, unsupported speed or colour,
experimental effect while Experimental Features is off, lamp off with
auto-turn-on disabled) and fails immediately on any of them. It then publishes
the new settings and returns without waiting for the lamp, exactly like
`set_clock_style`. The lamp is updated in the background, and a failure there
(e.g. the lamp is unreachable) is written to the Home Assistant log instead of
being returned to the caller.

<img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/generated/native-effects-overview.png" alt="Native Effects card" width="360">

---

### `set_clock_style`

Configure the firmware clock (the "Clock" content mode). Any subset of fields may
be provided.

| Field | Required | Description |
| :-- | :-- | :-- |
| `style` | No | Clock style name or numeric id (e.g. `Rainbow`, `Ocean Waves`) |
| `color` | No | Custom `[r, g, b]` (0–255), or `"clear"`/`null` to use the style's own colour |
| `content` | No | `time`, `time_date` (alternating) or `date` |
| `twelve_hour` | No | `true` for 12-hour, `false` for 24-hour |
| `colon_blink` | No | `true` to blink the colon, `false` to keep it steady |
| `speed` | No | Animation speed 1–255 |
| `color_mode` | No | Palette preset (see `set_native_effect`) |
| `activate` | No | Switch to Clock mode immediately (default `true`) |
| `entity_id` | Yes | Target lamp entity (list supported) |

```yaml
action: yeelight_cube.set_clock_style
data:
  style: Rainbow
  content: time_date
  twelve_hour: false
  entity_id: light.cubelite_a904
```

<details>
<summary><strong>Valid clock style names</strong></summary>

**Standard (10, always available):**
`Rainbow`, `Ocean Waves`, `Spectrum`, `White`, `Mint`, `Yellow`, `Pink`, `Red`,
`Cyan`, `Purple`

**Experimental (29, require the Experimental Features switch):**
`Sunset`, `Blue Yellow`, `Blue White`, `Ice Blue`, `Carousel`, `Streamer`,
`Rainbow Flow`, `Starry sky`, `Spectrum Chase`, `Pastel Pulse`, `Fireworks`,
`Monochrome Waves`, `Aurora`, `Pulse`, `Solar Flare`, `Prism`, `Ember`,
`Waterfall`, `Bonfire`, `Color Trails`, `Pinball`, `Tide`, `Flower Sea`,
`Drift`, `Spectrum Bands`, `Magic`, `Wonderland`, `Twinkle`, `Kaleidoscope`

`style` also accepts the numeric clock style id (1–10 for the standard styles,
11 and up for experimental ones, as exposed by the light's `clock_style_id`
attribute). Unnamed experimental styles, whose name is just their firmware mode
number, can only be selected by id. Selecting an experimental style switches
the lamp's Experimental Features on. Solid-colour styles (`White`, `Mint`,
`Yellow`, …) ignore `color_mode`; animated styles honour it.

</details>

<img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/generated/clock-overview.png" alt="Clock card" width="360">

---

### `save_clock_preset` / `delete_clock_preset`

Manage the shared solid-colour clock library (reused by the Clock and Native
Effects cards and exposed by the **Clock Colour Presets** sensor). Saved styles
appear as clock styles with `custom:<id>` keys. The library holds at most 100
presets; `style` names must not clash with a built-in clock style, and names
are unique per kind. Neither service sends anything to the lamp.

| Field | Required | Description |
| :-- | :-- | :-- |
| `name` | Yes | Display name (1–40 characters) |
| `color` | Yes | RGB colour as three integers 0–255 |
| `preset_id` | No | Existing id when editing; omit to create |
| `kind` | No | `style` (solid clock style) or `color_mode` (reusable colour) — default `style` for new presets, preserved when editing |

```yaml
action: yeelight_cube.save_clock_preset
data:
  name: "Sunset"
  color: [255, 110, 0]
```

```yaml
action: yeelight_cube.delete_clock_preset
data:
  preset_id: "abc123"
```

---

### `freeze_display`

Freeze the animated effect on its current frame. On a native effect the whole
panel holds; on the clock the background holds while the digits keep updating.
Re-applying the current effect/clock mode resumes it.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity (list supported) |

```yaml
action: yeelight_cube.freeze_display
data:
  entity_id: light.cubelite_a904
```

---

### `set_device_orientation`

Set the physical mount orientation, which determines the direction native
effects and text flow.

| Field | Required | Description |
| :-- | :-- | :-- |
| `orientation` | Yes | One of `right`, `down`, `left`, `up` |
| `entity_id` | Yes | Target lamp entity (list supported) |

```yaml
action: yeelight_cube.set_device_orientation
data:
  orientation: down
  entity_id: light.cubelite_a904
```

---

### `start_effect_rotation`

Start a **server-side** rotation that advances the lamp through the given mode
list on its own timer. The loop runs inside Home Assistant (not the browser), so
it keeps rotating after the dashboard tab is closed or refreshed.

| Field | Required | Description |
| :-- | :-- | :-- |
| `items` | Yes | Ordered names or objects with `name`, optional `color_mode`, and optional RGB `color`; clock presets use `custom:<id>` |
| `interval` | No | Seconds between changes, 10–604800 (default `60`) |
| `kind` | No | `native` (default) or `clock` |
| `entity_id` | Yes | Target lamp entity (list supported) |

```yaml
action: yeelight_cube.start_effect_rotation
data:
  kind: native
  items:
    - Rainbow
    - Ocean Waves
    - Streamer
  interval: 30
  entity_id: light.cubelite_a904
```

To preserve a favourite's colour, use an object item such as
`{name: Rainbow, color_mode: white_orange}` or
`{name: Rainbow, color_mode: custom, color: [255, 80, 20]}`.

Start requires at least two distinct normalised items. It is
**fire-and-forget**: every lamp's loop is scheduled concurrently and the service
returns immediately, so several lamps advance in parallel rather than one
waiting for the next. Only the validation above is raised synchronously.

Each lamp's entity loop still waits for its own first display operation before
marking itself active. For a known, enabled item, that step awaits the display
operation. Unknown names, missing clock presets, and experimental native effects
with Experimental Features off are skipped without sending a display command, so
an all-skipped list can remain active without changing the lamp. The card filters
available favourites, but service callers must supply valid, enabled items.

A failed display operation is logged and records the reason in
`effect_rotation.error`. Transient connection failures retry the same item up
to twice, after 5 and 15 seconds. If the per-device circuit breaker is active,
backoff is extended past its 30-second timeout window. The healthy lamps keep
their own loops; recovery selects the current scheduled item on the shared
timeline without resetting healthy targets, for both Clock and Native Effects.
Non-transient failures stop only the affected lamp. Exhausted retryable failures
retain recovery intent; after a confirmed outage, `waiting_for_reconnect` marks
the suspended rotation until a successful health probe restarts it. Healthy
probes alone do not repeatedly retry a reachable lamp's failed display command.
Explicit Stop cancels backoff; lamp-off and calibration lock prevent another
attempt (checked at most one second apart during backoff). The hardware safety
timeout is unchanged. Sending a command successfully does not independently
verify the physical image.

During recovery, `effect_rotation.retry_attempt` is 1 or 2 and `retry_at` is the
next attempt's Unix timestamp. Success clears the error and retry state. Clock
and Native cards show per-lamp status, errors and a **Retry failed lamps** button
for errors; confirmed outages instead show a neutral waiting state. Retry uses each stopped, on lamp's backend
list and interval; it does not restart healthy or already-retrying lamps. Normal
error-free rotation controls and labels remain unchanged. Timeout logs identify
the clock activation or brightness phase; retry logs include IP, item and attempt.

Explicit Stop, turning the lamp off, relevant content changes, calibration lock
or enabling Music Flow cancel pending recovery. Offline preview edits do not
cancel rotation. Rotation is held
in memory and does **not** auto-resume after a Home Assistant restart or an
integration reload. Commands from other automations do not universally stop it.

**Rotation ownership:** state updates must only observe backend rotation. The
old card controller sent Stop when its browser-local favourites contained fewer
than two available items, including from another card observing the same lamp.
That cancellation is now restricted to the legacy browser timer. Clock and
Native cards also check the backend rotation kind. The former eight-second UI
grace delay hid stopped state and has been removed. Tests cover these paths and
protocol-command dispatch with a simulated transport, not physical lamp output.

After installing changed Python code, restart Home Assistant and refresh the
dashboard. Re-registering services on entry reload does not reimport Python code.

#### Rotation Diagnostics and Regression Checks

The observer cancellation and discarded hardware result were reproduced in
local tests. They are **not proof of the cause on a particular installation**.
Earlier service-registration and stale-state explanations were hypotheses, not
verified causes of the reported physical-lamp failure.

When investigating a repeat report:

1. Record the target entities, rotation kind, submitted items and interval,
  service response, and `effect_rotation` attributes before and after Start.
  Check item availability and Experimental Features, including skipped items.
2. Trace the same request through the card adapter, service handler, entity loop,
  display dispatcher, hardware wrapper and `set_fx_effect` transport. Look for
  unsolicited Stop calls from other cards and correlate `[ROTATION]`, `[DISPLAY]`,
  `[OP ...]` and `[RAW]` logs for that target. These are log prefixes, not a
  shared request ID; some require debug logging.
3. Write and run a regression that fails at the implicated boundary before
  changing behaviour. Do not hide failed state with an optimistic timeout or
  treat selected preview/attribute changes as evidence of physical output.
4. Report separately what was reproduced, what changed, which checks ran, whether
  anything was deployed, and whether the user confirmed physical lamp output.
  If the user still reports failure, the hardware issue remains open. Do not
  re-label an unverified explanation as the root cause or blame caching without
  evidence. Reuse existing evidence and request only the missing runtime facts.

Existing regression checks (run from the repository root):

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_effect_rotation
node --test tests/mode-controls.test.mjs
node tests/card-ui-parity.cjs
```

The browser check needs Playwright and its configured browser (Edge by default);
`PLAYWRIGHT_MODULE` can point to an installed Playwright module. Python tests
execute selected production methods outside Home Assistant with a simulated
transport. Browser tests use real card classes with simulated Home Assistant
state and services. They cover failure propagation, loop replacement, protocol
dispatch, and passive observers, but **not a live Home Assistant lifecycle or
physical firmware output**. The raw send path does not read a device reply, so
even a successful socket send is not a firmware acknowledgement.

---

### `stop_effect_rotation`

Stop the server-side rotation on the target lamps.

```yaml
action: yeelight_cube.stop_effect_rotation
data:
  entity_id: light.cubelite_a904
```

---

### `skip_effect_rotation`

Advance a running rotation to its next mode immediately (the card's Skip button).

```yaml
action: yeelight_cube.skip_effect_rotation
data:
  entity_id: light.cubelite_a904
```

---

## ⚙️ Configuration Services

Adjust brightness and real-time color effects.

### `set_brightness`

Set lamp brightness as a percentage.

| Field | Required | Description |
| :-- | :-- | :-- |
| `brightness` | Yes | Brightness level (1-100%) |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_brightness
data:
  brightness: 75
  entity_id: light.cubelite_192_168_4_102
```

---

### `set_preview_adjustments`

Apply real-time color effects to the lamp output.

| Field | Required | Range | Description |
| :-- | :-- | :-- | :-- |
| `hue_shift` | No | -180 to +180 | Color wheel rotation |
| `temperature` | No | -100 to +100 | Cool/warm adjustment |
| `saturation` | No | 0-200 | Color richness |
| `vibrance` | No | 0-200 | Smart saturation |
| `contrast` | No | 0-200 | Contrast level |
| `glow` | No | 0-100 | Bloom on highlights |
| `grayscale` | No | 0-100 | Grayscale intensity |
| `invert` | No | 0-100 | Color inversion |
| `tint_hue` | No | 0-360 | Color for tint overlay |
| `tint_strength` | No | 0-100 | Tint overlay intensity |
| `entity_id` | Yes | - | Target lamp entity |

```yaml
action: yeelight_cube.set_preview_adjustments
data:
  hue_shift: 0
  temperature: 0
  saturation: 100
  vibrance: 100
  contrast: 100
  glow: 0
  grayscale: 0
  invert: 0
  tint_hue: 0
  tint_strength: 0
  entity_id: light.cubelite_192_168_4_102
```

---

### `set_color_accuracy`

Toggle hardware color accuracy correction (per-channel gain).

| Field | Required | Description |
| :-- | :-- | :-- |
| `enabled` | Yes | `true` to enable, `false` to disable |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_color_accuracy
data:
  enabled: true
  entity_id: light.cubelite_192_168_4_102
```

---

### `force_refresh`

Force the lamp to reconnect and re-send the current display state using a fresh TCP connection, bypassing the persistent socket. Use this when the lamp is stuck or unresponsive and normal display updates are not reaching it — it has the same effect as pressing the **Force Refresh** button entity.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity. Supports a list for multiple lamps. |

```yaml
action: yeelight_cube.force_refresh
data:
  entity_id: light.cubelite_192_168_4_102
```

> [!TIP]
> For a one-off recovery from the UI, use **Refresh** in the shared **Actions** section of the Clock, Native Effects or Lamp Preview card, or the **Force Refresh** button entity. Use this service to trigger recovery from an automation or script.

Refresh re-applies the lamp's current content, not the style selected in a card. Native Clock and Native Effect reconnect through their native renderer; Music Flow re-applies its current configuration; direct-pixel content is regenerated through the display pipeline. Off lamps are left off. Refresh resumes a frozen display but does not stop effect rotation. The card's spinner tracks the service request, not completion of the hardware operation.

All three cards share Actions visibility, button styling and the **Actions & Order** list. Lamp Preview offers Refresh and Power only; Clock and Native Effects also offer Previous, Next, Random and Freeze. Existing Lamp Preview Power/Refresh visibility and appearance settings migrate automatically. Existing explicit action lists on Clock/Native are preserved; add Refresh in **Actions & Order** to include it. Power uses explicit turn-on/turn-off commands on all three cards.

---

### `save_state`

Snapshot the lamp's current display state so it can be restored later. Captures everything that determines what is shown: text, text/gradient colors, display mode, gradient angle, full-panel setting, drawing/pixel art, font, alignment, orientation, brightness and all color effects.

Only **one** snapshot is kept per lamp — calling `save_state` again overwrites the previous one.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity. Supports a list for multiple lamps. |

```yaml
action: yeelight_cube.save_state
data:
  entity_id: light.cubelite_192_168_4_102
```

> [!NOTE]
> The snapshot is held in memory and does **not** survive a Home Assistant restart.

---

### `restore_state`

Restore the display state previously captured with [`save_state`](#save_state) and re-render it on the lamp. Does nothing (logs a warning) if no state was saved.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity. Supports a list for multiple lamps. |

```yaml
action: yeelight_cube.restore_state
data:
  entity_id: light.cubelite_192_168_4_102
```

**Typical use — show something temporarily, then return to normal:**

```yaml
# 1. Remember what the lamp is currently showing
- action: yeelight_cube.save_state
  data:
    entity_id: light.cubelite_192_168_4_102

# 2. Display a temporary alert
- action: yeelight_cube.set_custom_text
  data:
    text: "DOORBELL"
    entity_id: light.cubelite_192_168_4_102

- delay: "00:00:10"

# 3. Put back whatever was showing before
- action: yeelight_cube.restore_state
  data:
    entity_id: light.cubelite_192_168_4_102
```

---

### `set_button_effects`

Update one to eight leading slots in the native preset list cycled by the
Cube Lite's physical button.

| Field | Required | Description |
| :-- | :-- | :-- |
| `effects` | Yes | Ordered native effect names or `Clock: <style>` names, maximum 8 |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.set_button_effects
data:
  effects:
    - Streamer
    - Rainbow
    - "Clock: Yellow"
  entity_id: light.cubelite_a904
```

The firmware protocol updates slots individually and does not expose a
documented truncate operation. A shorter call overwrites only the leading
slots; it does not guarantee that older trailing slots are removed.

---

### `set_color_calibration`

> [!NOTE]
> This is a **development-only** service for tuning the internal color/brightness pipeline at runtime. It is intentionally not documented here because the values are low-level, change with hardware revisions, and are not exposed through any user-facing card or entity.
>
> The full parameter reference, the meaning of each correction stage, and the recommended tuning workflow live in the advanced developer guide: **[docs/ADVANCED_CALIBRATION.md](docs/ADVANCED_CALIBRATION.md)**.

---

## 🔧 Device Management

Manage device discovery, connection, and integration-level settings.

### `add_managed_device`

Add a device to the managed list.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | Device IP address |

```yaml
action: yeelight_cube.add_managed_device
data:
  ip_address: "192.168.1.100"
```

---

### `remove_managed_device`

Remove a device from the managed list.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | Device IP address |

```yaml
action: yeelight_cube.remove_managed_device
data:
  ip_address: "192.168.1.100"
```

---

### `is_device_managed`

Check if a device is managed. The result is fired as a
`yeelight_cube_device_check_result` event (`ip_address`, `is_managed`).

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | Device IP address |

```yaml
action: yeelight_cube.is_device_managed
data:
  ip_address: "192.168.1.100"
```

---

### `list_managed_devices`

List all managed devices. No parameters required. The list is fired as a
`yeelight_cube_managed_devices_list` event (`devices`).

```yaml
action: yeelight_cube.list_managed_devices
```

---

### `test_device_detection`

Test device detection logic. The result is fired as a
`yeelight_cube_detection_test_result` event (`would_be_detected: true/false`).

| Field | Required | Description |
| :-- | :-- | :-- |
| `device_model` | No | Device model identifier (mDNS `md` property); default empty |
| `device_name` | No | Device name (`fn` property); default empty |
| `device_id` | No | Device ID (`id` property); default empty |

```yaml
action: yeelight_cube.test_device_detection
data:
  device_model: "cubelite"
  device_name: "Yeelight Cube Lite"
  device_id: "0x12345678"
```

---

### `ignore_yeelight_discovery`

Ignore an IP in the built-in Yeelight integration.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | IP address to ignore |

```yaml
action: yeelight_cube.ignore_yeelight_discovery
data:
  ip_address: "192.168.4.139"
```

---

### `ignore_specific_yeelight`

Ignore a specific device in the built-in Yeelight integration.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | IP address to ignore |

```yaml
action: yeelight_cube.ignore_specific_yeelight
data:
  ip_address: "192.168.4.139"
```

---

### `force_rediscovery`

Force device rediscovery.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | Device IP address |

```yaml
action: yeelight_cube.force_rediscovery
data:
  ip_address: "192.168.4.139"
```

---

### `trigger_manual_discovery`

Manually trigger discovery for a device.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | Device IP address |
| `device_name` | No | Device name; defaults to `Test Device <ip>` |
| `device_model` | No | Device model identifier; defaults to `cubelite` |
| `device_id` | No | Device ID; defaults to `0x12345678` |

```yaml
action: yeelight_cube.trigger_manual_discovery
data:
  ip_address: "192.168.4.139"
  device_name: "CubeLite Test"
  device_model: "cubelite"
  device_id: "0x12345678"
```

---

### `create_cube_discovery`

Create a discovery flow for a cube.

| Field | Required | Description |
| :-- | :-- | :-- |
| `ip_address` | Yes | Device IP address |
| `device_name` | No | Device name; defaults to `Yeelight Cube Lite <ip>` |

```yaml
action: yeelight_cube.create_cube_discovery
data:
  ip_address: "192.168.4.139"
  device_name: "My CubeLite"
```

---

### `test_display`

Test cube connectivity and display: forces the lamp on, re-establishes the FX
handshake and re-applies the current display, logging the entity state and
connection status at debug level.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.test_display
data:
  entity_id: light.cubelite_192_168_4_102
```

---

### Internal and debug services

These services are registered (so they appear in Developer Tools) but are
**not a stable API**. They can only be called by Home Assistant
**administrators** (and by automations or scripts); calls from other users are
rejected. `set_color_calibration` is admin-only for the same reason. They exist for the internal calibration and
reverse-engineering cards, which are not shipped in the public repository.

| Service | Purpose |
| :-- | :-- |
| `set_calibration_lock` | Take/release exclusive control of a lamp for the calibration wizard (`enabled`, `entity_id`); the lock auto-releases after 15 minutes |
| `send_fx_effect` | Send a raw private LAN command (default `set_fx_effect`) with structured or verbatim parameters |
| `query_raw` | Send a raw command and return the lamp's reply (response data) |
| `get_capabilities` | Run the yeelight library's SSDP capability probe and return the headers |
| `bulb_call` | Read an allow-listed `yeelight.Bulb` member or call an allow-listed write method |
| `set_default` | Send the documented `set_default` command so the lamp restores its current state after a power cut |

Raw commands bypass the integration's state tracking and can leave the lamp in
a mode Home Assistant does not know about; use **Force Refresh** afterwards.

---

## 🔗 Multi-Entity Operations

All services that accept `entity_id` support targeting multiple lamps in a single call by passing a list. All targets receive the command simultaneously.

<details>
<summary>View examples</summary>

**Synchronized pixel art on all lamps:**

```yaml
action: yeelight_cube.apply_pixel_art
data:
  idx: 0
  entity_id:
    - light.cubelite_192_168_4_102
    - light.cubelite_192_168_4_145
    - light.cubelite_192_168_4_139
```

**Same text on all lamps:**

```yaml
action: yeelight_cube.set_custom_text
data:
  text: "SYNC"
  entity_id:
    - light.cubelite_192_168_4_102
    - light.cubelite_192_168_4_145
```

**Different content per lamp:**

```yaml
- action: yeelight_cube.set_custom_text
  data:
    text: "CUBE 1"
    entity_id: light.cubelite_192_168_4_102
- action: yeelight_cube.set_custom_text
  data:
    text: "CUBE 2"
    entity_id: light.cubelite_192_168_4_145
```

</details>

---

## 🔄 Node-RED Integration

All services are fully compatible with Node-RED with parameter descriptions, entity selectors, input validation, dropdown menus for mode selection, and sliders for numeric values.

<details>
<summary>View Node-RED example</summary>

```json
[
  {
    "id": "cube_text",
    "type": "api-call-service",
    "name": "Set Cube Text",
    "server": "home_assistant",
    "service_domain": "yeelight_cube",
    "service": "set_custom_text",
    "data": {
      "text": "{{payload.message}}",
      "entity_id": "light.cubelite_192_168_4_102"
    }
  }
]
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/NodeRED-Set-Custom-Text.png" alt="Node-RED - set_custom_text"></td>
  </tr>
</table>

</details>

---

## 📋 Service Response Data

Some services return data (use `response_variable` in scripts) or report their
result through an event on the HA event bus.

| Service | Returns |
| :-- | :-- |
| `get_pixel_art` | Response data: `{ name, pixels }` in flat or grouped format (see [get_pixel_art](#get_pixel_art)) |
| `preview_gradient_modes` | Event `yeelight_cube_gradient_preview_response` with 20×5 pixel matrices per mode |
| `list_managed_devices` | Event `yeelight_cube_managed_devices_list` with `devices` (list of IP addresses) |
| `is_device_managed` | Event `yeelight_cube_device_check_result` with `ip_address` and `is_managed` |
| `test_device_detection` | Event `yeelight_cube_detection_test_result` with `would_be_detected` |
| `force_rediscovery`, `trigger_manual_discovery`, `create_cube_discovery`, `ignore_yeelight_discovery`, `ignore_specific_yeelight` | Events `yeelight_cube_rediscovery_forced`, `yeelight_cube_manual_discovery_triggered`, `yeelight_cube_cube_discovery_created`, `yeelight_cube_yeelight_discovery_ignored`, `yeelight_cube_yeelight_device_ignored` |
| `query_raw`, `get_capabilities`, `bulb_call`, `send_fx_effect` | Optional response data (debug services) |

---

## 📖 Quick Reference

| Category | Primary Services | Purpose |
| :-- | :-- | :-- |
| **Text** | `set_custom_text`, `set_text_colors` | Display text with colors |
| **Drawing** | `apply_custom_pixels`, `save_pixel_art`, `apply_pixel_art`, `move_pixel_art` | Create and manage pixel art |
| **Gradients** | `set_mode`, `set_solid_color`, `set_angle`, `set_full_panel` | Control display modes |
| **Palettes** | `save_palette`, `load_palette`, `add_palettes`, `set_palettes` | Manage color collections |
| **Text Settings** | `set_font`, `set_alignment`, `set_orientation` | Text formatting |
| **Color Effects** | `set_preview_adjustments`, `set_color_accuracy` | Real-time color adjustments |
| **State** | `save_state`, `restore_state` | Snapshot & restore what's displayed |
| **Native presets** | `set_button_effects` | Configure physical-button effect slots |
| **Clock / Native** | `set_native_effect`, `set_clock_style`, `freeze_display`, `set_device_orientation` | Firmware clock & animations |
| **Clock presets** | `save_clock_preset`, `delete_clock_preset` | Shared solid-colour library |
| **Rotation** | `start_effect_rotation`, `stop_effect_rotation`, `skip_effect_rotation` | Server-side effect cycling |
| **Recovery** | `force_refresh` | Reconnect & re-send display state |
| **Management** | `create_cube_discovery`, `test_display`, `force_rediscovery` | Device setup & diagnostics |

---

For more examples and advanced usage, see the main [README.md](README.md).
