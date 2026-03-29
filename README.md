# Yeelight Cube Lite for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

A Home Assistant custom integration for the **Yeelight Cube Smart Lamp Lite**. This lamp features a **20×5 RGB LED matrix** (100 individually addressable pixels). This integration gives you full pixel-level control from your HA dashboard — draw pixel art, display scrolling text, apply gradients, color effects, transitions, and more.

![Yeelight Cube Smart Lamp Lite](images/yeelight-cube-light.png)

<!-- TODO: Add a photo of the physical lamp here -->

---

## Features

### Light Integration

- **Full 20×5 RGB matrix control** — 100 individually addressable LEDs
- **Display modes** — solid color, 7 gradient types, text color sequences, panel color sequences, custom draw
- **Transition effects** between modes — fade, wipe, slide, curtain, gravity drop, pixel migration, and more
- **Color effects adjustments** — hue shift, temperature, saturation, vibrance, contrast, glow, grayscale, invert, tint
- **Scrolling text** with multiple fonts and alignment options
- **Brightness control** with gamma correction
- **Multi-lamp support** — add as many devices as you have

### Custom Lovelace Cards

- **Draw Card** — pixel art editor with pencil, eraser, fill, eyedropper, undo; gallery to save/load/rename/reorder/import/export designs
- **Gradient Card** — pick and preview all gradient & color modes with a scrollable mode wheel
- **Lamp Preview Card** — live matrix preview with brightness slider, power toggle, and force refresh
- **Palette Card** — create, edit, reorder, and apply color palettes
- **Color List Editor Card** — edit color sequences for text and panel modes with drag-and-drop
- **Angle Gradient Card** — rotary dial for angle-based gradient control

---

## Installation via HACS

### Add as Custom Repository

1. Open **HACS** in your Home Assistant dashboard
2. Click the **⋮** menu (top right) → **Custom repositories**
3. Add this URL:
   ```
   https://github.com/Max-src/yeelight-cube-lite
   ```
4. Category: **Integration**
5. Click **Add**
6. Search for **Yeelight Cube Lite** in HACS and install it
7. **Restart Home Assistant**

### Manual Installation

1. Download the [latest release](https://github.com/Max-src/yeelight-cube-lite/releases)
2. Copy the contents into `custom_components/yeelight_cube/` inside your HA config directory
3. Restart Home Assistant

---

## Setup

### Prerequisites — Yeelight Station App

Before adding the lamp to Home Assistant, you must first set it up using the **Yeelight Station** app (not the standard Yeelight app). This is where you configure Wi-Fi, enable LAN control, and find the IP address needed for the integration.

1. **Download the Yeelight Station app** from the App Store (iOS) or Google Play (Android)
2. **Power on the lamp** — connect the base unit to power using the included adapter, then place the Cube on top of the base (it attaches magnetically via the ring/pin connectors)
3. **Add the lamp to the app** — follow the in-app pairing instructions to connect the base unit to your **2.4 GHz Wi-Fi network**
4. **Enable LAN Control** — in the app, go to your device's **Device Settings** and turn on **LAN Control**. This is required for the Home Assistant integration to communicate with the lamp over your local network
5. **Find the lamp's IP address** — in the same Device Settings screen, locate the IP address assigned to the lamp on your network (e.g. `192.168.4.139`). Note this down — you will need it during the Home Assistant setup

<!-- TODO: Add screenshot of Yeelight Station app — Device Settings showing LAN Control toggle and IP address -->

> **Tip:** You can also find the lamp's IP address from your router's admin page or DHCP client list. Assigning a static IP / DHCP reservation for the lamp is recommended to prevent the address from changing.

### Adding to Home Assistant

1. Go to **Settings → Devices & Services**
2. Click **+ Add Integration** (bottom right)
3. Search for **Yeelight Cube Lite** and select it
4. Enter the **IP address** you noted from the Yeelight Station app (e.g. `192.168.4.139`)
5. Click **Submit**

<!-- TODO: Add screenshot of the Add Integration search showing Yeelight Cube Lite -->
<!-- TODO: Add screenshot of the IP address entry form -->

The integration will connect to the lamp over your local network and automatically create a device with all entities — light control, display mode selectors, color effect sliders, text input, transition settings, sensors, camera previews, and more (see [Entities Created](#entities-created) for the full list).

<!-- TODO: Add screenshot of the device page after successful setup -->

> **Note:** Each lamp (base unit) needs to be added separately. If you have multiple lamps, repeat the process for each one using their respective IP addresses.

> **Conflict prevention:** If you also have the built-in Home Assistant **Yeelight** integration, this custom integration will automatically prevent it from managing your Cube device to avoid conflicts. No manual action needed.

---

## Lovelace Cards

All cards are **auto-registered** when the integration loads — no manual resource configuration needed. Each card includes a **visual editor** for configuration.

> After installing or updating, do a hard refresh (`Ctrl+F5`) in your browser if cards don't appear.

### Draw Card — `custom:yeelight-cube-draw-card`

The main pixel art editor card.

<!-- TODO: Add screenshot of draw card here -->

**Features:**

- **20×5 interactive matrix** — click or drag to paint pixels
- **Drawing tools** — color picker, pencil, eyedropper, eraser, area fill, fill all, undo
- **Tool bar customization** — reorder, show/hide individual tools via the card editor
- **Palette section** — quick color selection with recent colors (up to 10)
- **Pixel art gallery** — save drawings with custom names, load them back, delete unwanted ones
- **Gallery view modes** — list, grid, compact (with drag-to-reorder), album (coverflow), carousel, gallery
- **Import/Export** — export pixel art collections to JSON, import them back
- **Apply to lamp** — send the current drawing to the physical lamp instantly
- **Upload from image** — upload bitmap images and convert to the 20×5 matrix
- **Multi-entity support** — target multiple lamps simultaneously
- **Customizable appearance** — pixel gap, background color, pixel style, box shadow

### Gradient Card — `custom:yeelight-cube-gradient-card`

Control the lamp's gradient and color modes from a single card.

<!-- TODO: Add screenshot of gradient card here -->

**Features:**

- **9 gradient/color modes:**
  - Solid Color
  - Letter Gradient
  - Column Gradient
  - Row Gradient
  - Angle Gradient (with interactive angle slider)
  - Radial Gradient
  - Letter Angle Gradient
  - Letter Vertical Gradient
  - Text Color Sequence
- **Two-color gradient control** — pick start and end colors per mode
- **Angle slider** — real-time angle adjustment for angle-based gradients
- **Mode visibility** — show/hide individual modes to declutter the card
- **Mode reordering** — drag-and-drop to rearrange mode order
- **Multi-entity support** — apply gradients to multiple lamps at once

### Lamp Preview Card — `custom:yeelight-cube-lamp-preview-card`

A live preview of the lamp's current state, with controls.

<!-- TODO: Add screenshot of lamp preview card here -->

**Features:**

- **Live 20×5 matrix preview** — reflects the lamp's actual pixel colors in real time
- **Brightness slider** — control lamp brightness with multiple slider styles (slider, bar, rotary)
- **Brightness label** — display as text, icon, icon+text, or hidden
- **Power toggle button** — turn the lamp on/off
- **Force refresh button** — recover a stuck lamp via raw TCP (bypasses the persistent socket)
- **Black dot handling** — optionally hide or show black (off) pixels for a cleaner preview
- **Customizable appearance** — pixel gap, background, pixel style (round/square), box shadow, size (percentage), alignment
- **Button styles** — classic or modern appearance for toggle/refresh buttons

### Palette Card — `custom:yeelight-cube-palette-card`

Create, manage, and apply color palettes.

<!-- TODO: Add screenshot of palette card here -->

**Features:**

- **Visual palette display** — see all palette colors as swatches (round or square style)
- **Create & edit palettes** — add colors, rename, reorder, delete
- **Apply palette** — load a palette's colors onto the lamp
- **Palette title and color count** — configurable display options
- **Background style** — toggle card background visibility
- **Multi-entity support** — apply palettes to multiple lamps

### Color List Editor Card — `custom:yeelight-cube-color-list-editor-card`

Edit color sequences used by the "Text Color Sequence" and "Panel Color Sequence" display modes.

<!-- TODO: Add screenshot of color list editor card here -->

**Features:**

- **Visual color list** — add, remove, reorder colors in a sequence
- **Drag-and-drop reordering** — rearrange colors by dragging
- **Rotary color picker** — precise color selection
- **Export/Import** — save and load color sequences
- **Compact mode** — space-efficient layout

### Angle Gradient Card — `custom:yeelight-cube-angle-gradient-card`

Dedicated angle control for gradient modes.

---

## Entities Created

Each Yeelight Cube Lite device creates the following entities:

### Light

| Entity                 | Description                                       |
| ---------------------- | ------------------------------------------------- |
| **Yeelight Cube Lite** | Main light entity — on/off, RGB color, brightness |

### Selectors

| Entity                | Description                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Display Mode**      | Switch between: Solid Color, Letter Gradient, Column Gradient, Row Gradient, Angle Gradient, Radial Gradient, Letter Vertical Gradient, Letter Angle Gradient, Text Color Sequence, Panel Color Sequence, Custom Draw |
| **Palette**           | Select from saved color palettes to apply to the lamp                                                                                                                                                                 |
| **Pixel Art**         | Select from saved pixel art designs to load onto the matrix                                                                                                                                                           |
| **Text Alignment**    | Text alignment: left, center, right                                                                                                                                                                                   |
| **Font**              | Choose the text font (multiple built-in bitmap fonts)                                                                                                                                                                 |
| **Transition Effect** | Choose from 24 transition animations when switching display modes                                                                                                                                                     |

### Numbers (Sliders)

| Entity                     | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| **Gradient Angle**         | Angle for angle-based gradient modes (0°–360°)           |
| **Transition Steps**       | Number of animation steps for transitions (1–10)         |
| **Transition Duration**    | Total transition time in seconds (0.2–10s)               |
| **Color: Hue Shift**       | Shift all colors around the color wheel (−180° to +180°) |
| **Color: Temperature**     | Warm/cool color temperature adjustment (−100 to +100)    |
| **Intensity: Saturation**  | Color saturation level (0–200%)                          |
| **Intensity: Vibrance**    | Vibrance / adaptive saturation (0–200%)                  |
| **Tone: Contrast**         | Contrast level (0–200%)                                  |
| **Tone: Glow**             | Bloom / glow effect strength (0–100%)                    |
| **Effects: Grayscale**     | Grayscale intensity (0–100%)                             |
| **Effects: Invert**        | Color inversion intensity (0–100%)                       |
| **Effects: Tint Hue**      | Tint color hue (0°–360°)                                 |
| **Effects: Tint Strength** | Tint overlay intensity (0–100%)                          |

### Switches

| Entity               | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| **Auto Turn On**     | Automatically turn on the lamp when a new mode or drawing is applied     |
| **Flip Orientation** | Flip the matrix display horizontally (for mounting the lamp upside-down) |

### Text

| Entity           | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| **Display Text** | Text input for custom text display on the matrix (supports scrolling) |

### Button

| Entity            | Description                                               |
| ----------------- | --------------------------------------------------------- |
| **Force Refresh** | Recover a stuck lamp by re-activating FX mode via raw TCP |

### Camera

| Entity                      | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| **Matrix Preview (Square)** | Live camera feed of the matrix state, rendered with square pixels          |
| **Matrix Preview (Round)**  | Live camera feed of the matrix state, rendered with round LED-style pixels |

### Sensors

| Entity              | Description                                             |
| ------------------- | ------------------------------------------------------- |
| **Color Palettes**  | Stores all saved palettes (used by palette cards)       |
| **Saved Drawings**  | Stores all saved pixel art designs (used by draw cards) |
| **Font Characters** | Exposes the bitmap font character maps                  |

---

## Display Modes

The lamp supports the following display modes, selectable via the **Display Mode** entity or the Gradient Card:

| Mode                         | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| **Solid Color**              | Fill the entire matrix with a single color                          |
| **Letter Gradient**          | Apply a horizontal gradient to each character of the displayed text |
| **Column Gradient**          | Vertical gradient across the 20 columns                             |
| **Row Gradient**             | Horizontal gradient across the 5 rows                               |
| **Angle Gradient**           | Gradient at a configurable angle (use the angle slider)             |
| **Radial Gradient**          | Gradient radiating outward from the center                          |
| **Letter Vertical Gradient** | Vertical gradient applied per character                             |
| **Letter Angle Gradient**    | Angled gradient applied per character                               |
| **Text Color Sequence**      | Each character gets a different color from the sequence             |
| **Panel Color Sequence**     | Color sequence applied across all pixels                            |
| **Custom Draw**              | Pixel art mode — use the Draw Card to paint individual pixels       |

---

## Transition Effects

When switching between display modes or pixel art, you can apply animated transitions:

Fade Through Black, Direct Crossfade, Random Dissolve, Wipe (Right/Left/Down/Up), Slide (Left/Right/Up/Down), Card From (Right/Left/Top/Bottom), Explode & Reform, Snake, Wave Wipe, Iris (Circle Wipe), Vertical Flip, Curtain, Gravity Drop, Pixel Migration

Configure the effect, step count and duration via the **Transition Effect**, **Transition Steps** and **Transition Duration** entities.

---

## Requirements

- **Home Assistant** 2023.1.0 or newer
- **Yeelight Cube Smart Lamp Lite** (or compatible matrix/panel device) on the same local network
- Python packages `yeelight` and `Pillow` (installed automatically by HA)

---

## Troubleshooting

| Problem                                 | Solution                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Cards not showing**                   | Clear browser cache with `Ctrl+F5` after installing or updating                                           |
| **Device not found**                    | Ensure the lamp is on the same network. Check the IP in the Yeelight mobile app                           |
| **Conflicts with Yeelight integration** | This integration automatically blocks the built-in Yeelight integration from managing your cube device    |
| **Lamp appears stuck / unresponsive**   | Press the **Force Refresh** button entity, or use the force refresh button on the Lamp Preview card       |
| **Colors look off on the hardware**     | Color accuracy correction is built-in and applied automatically. It compensates for LED channel imbalance |

---

## License

See [LICENSE](LICENSE) for details.
