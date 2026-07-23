# Complete Service Reference

Full documentation for all custom actions (services) registered under the `yeelight_cube` domain.

> [!NOTE]
> For general setup, cards, and entities, see [README.md](README.md).

> [!NOTE]
> **`entity_id`** is required by all lamp services. When calling services directly from automations, scripts, or Developer Tools, you must provide it explicitly.

---

## Table of Contents

**[`Text Services`](#-text-services)** · **[`Drawing Services`](#-drawing-services)** · **[`Gradient Services`](#-gradient-services)** · **[`Palette Services`](#-palette-services)** · **[`Configuration Services`](#-configuration-services)** · **[`Device Management`](#-device-management)** · **[`Multi-Entity Operations`](#-multi-entity-operations)** · **[`Node-RED Integration`](#-node-red-integration)** · **[`Service Response Data`](#-service-response-data)** · **[`Quick Reference`](#-quick-reference)**

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
| `font` | Yes | Font name: `basic`, `fat`, or `italic` |
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

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Apply-Custom-Pixels-Sparse.png" alt="Action - apply_custom_pixels (sparse)"></td>
  </tr>
</table>

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
| `name` | Yes | Name for the saved pixel art |
| `pixels` | Yes | Array of `{ position, color }` entries (single or grouped positions) |

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

### `display_image`

Display a base64-encoded image on the lamp (resized/cropped to 20×5).

| Field | Required | Description |
| :-- | :-- | :-- |
| `image_b64` | Yes | Base64-encoded image string |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.display_image
data:
  image_b64: "<base64-encoded image string>"
  entity_id: light.cubelite_192_168_4_102
```

---

## 🌈 Gradient Services

Switch display modes, set gradient angles, and control how colors fill the lamp.

### `set_mode`

Change the active native clock or Matrix display mode.

| Field | Required | Description |
| :-- | :-- | :-- |
| `mode` | Yes | Display mode (see table below) |
| `full_panel` | No | Fill the entire 20×5 pixel grid (`true`) or restrict the gradient to text pixels only (`false`). Setting this alongside `mode` avoids a redundant second call. |
| `entity_id` | Yes | Target lamp entity |

| Mode | Description |
| :-- | :-- |
| **Clock** | Firmware-native clock using the configured clock style and options |
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
The Clock Style, Clock Content (Time / Time & Date / Date only), Clock Show Date,
Clock 12-Hour Format, and Clock Colon Blink entities configure the values sent
when Clock mode is activated.

---

### `set_solid_color`

Set a single solid RGB color on the lamp (shortcut for Solid Color mode).

| Field | Required | Description |
| :-- | :-- | :-- |
| `rgb_color` | Yes | `[R, G, B]` array (0-255) |
| `entity_id` | Yes | Target lamp entity |

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

Generate preview matrix data for all gradient modes using the entity's current text, colors, and angle. This service does **not** change what is displayed on the lamp — instead it fires a `yeelight_cube_gradient_preview_response` event containing rendered 20×5 pixel matrices for every mode, which the Gradient Card reads to display live mode previews without touching the lamp.

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
> Results are delivered via the **`yeelight_cube_gradient_preview_response`** event on the HA event bus, not as a direct return value. The event payload includes `previews` (a dict of mode name → 100-pixel color list), `text`, `angle`, `brightness`, `full_panel`, and other current display state values.

---

## 🎨 Palette Services

Save, load, and manage color palettes shared across all cards and lamps.

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

```yaml
action: yeelight_cube.rename_palette
data:
  idx: 0
  name: "Updated Palette"
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
> For a one-off recovery from the UI, use the **Force Refresh** button entity instead. Use this service when you need to trigger recovery from an automation or script.

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
    - Ribbon
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

Check if a device is managed.

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

List all managed devices. No parameters required.

```yaml
action: yeelight_cube.list_managed_devices
```

---

### `test_device_detection`

Test device detection logic.

| Field | Required | Description |
| :-- | :-- | :-- |
| `device_model` | Yes | Device model identifier |
| `device_name` | Yes | Device name |
| `device_id` | Yes | Device ID |

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
| `device_name` | Yes | Device name |
| `device_model` | Yes | Device model identifier |
| `device_id` | Yes | Device ID |

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
| `device_name` | Yes | Device name |

```yaml
action: yeelight_cube.create_cube_discovery
data:
  ip_address: "192.168.4.139"
  device_name: "My CubeLite"
```

---

### `test_display`

Test cube connectivity and display.

| Field | Required | Description |
| :-- | :-- | :-- |
| `entity_id` | Yes | Target lamp entity |

```yaml
action: yeelight_cube.test_display
data:
  entity_id: light.cubelite_192_168_4_102
```

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

Some services return data that can be used in automations.

| Service | Returns |
| :-- | :-- |
| `list_managed_devices` | List of managed IP addresses |
| `get_pixel_art` | `{ name, pixels }` in flat or grouped format (see [get_pixel_art](#get_pixel_art)) |
| `preview_gradient_modes` | Fires `yeelight_cube_gradient_preview_response` event with 20×5 pixel matrices per mode |
| `test_device_detection` | Boolean indicating if device would be detected |
| `is_device_managed` | Boolean indicating if device is managed |

---

## 📖 Quick Reference

| Category | Primary Services | Purpose |
| :-- | :-- | :-- |
| **Text** | `set_custom_text`, `set_text_colors` | Display text with colors |
| **Drawing** | `apply_custom_pixels`, `save_pixel_art`, `apply_pixel_art` | Create and manage pixel art |
| **Gradients** | `set_mode`, `set_solid_color`, `set_angle`, `set_full_panel` | Control display modes |
| **Palettes** | `save_palette`, `load_palette`, `set_palettes` | Manage color collections |
| **Text Settings** | `set_font`, `set_alignment`, `set_orientation` | Text formatting |
| **Color Effects** | `set_preview_adjustments`, `set_color_accuracy` | Real-time color adjustments |
| **State** | `save_state`, `restore_state` | Snapshot & restore what's displayed |
| **Native presets** | `set_button_effects` | Configure physical-button effect slots |
| **Recovery** | `force_refresh` | Reconnect & re-send display state |
| **Management** | `create_cube_discovery`, `test_display`, `force_rediscovery` | Device setup & diagnostics |

---

For more examples and advanced usage, see the main [README.md](README.md).
