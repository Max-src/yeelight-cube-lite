# Yeelight Cube Lite for Home Assistant

![Yeelight Cube Smart Lamp Lite](images/yeelight-cube-light.png)

A Home Assistant custom integration for the **Yeelight Cube Smart Lamp Lite**, a lamp with a **20×5 RGB LED matrix** (100 individually addressable pixels). Get full pixel-level control from your HA dashboard: draw pixel art, display scrolling text, apply gradients, color effects, transitions, and more.

[![Home Assistant][ha_badge]][ha_link] [![HACS][hacs_badge]][hacs_link] [![GitHub Release][release_badge]][release] [![Buy Me a Coffee][bmac_badge]][bmac]

---

## Table of Contents

**[`Features`](#features)** · **[`Installation`](#installation-via-hacs)** · **[`Setup`](#setup)** · **[`Lovelace Cards`](#lovelace-cards)** · **[`Entities`](#entities-created)** · **[`Automations`](#automations--node-red)** · **[`Display Modes`](#display-modes)** · **[`Transition Effects`](#transition-effects)** · **[`Troubleshooting`](#troubleshooting)** · **[`License`](#license)**

---

## Features

### Light Integration

| Feature | Description |
| :-- | :-- |
| **Full matrix control** | 20×5 RGB, individual pixel-level color |
| **Brightness** | Full brightness control |
| **Colors & gradients** | Gradient support across multiple modes |
| **Color effects** | Hue shift, saturation, vibrance, tint, glow, contrast, invert, grayscale |
| **Transitions** | 14+ animated transition effects |
| **Multi-lamp** | Control multiple lamps independently |
| **Auto-discovery** | Zeroconf (mDNS) auto-detection on your network |
| **Local-only** | All communication stays on your LAN, no cloud dependency |

### Customizable Lovelace Cards

| Card | Description |
| :-- | :-- |
| **Preview Card** | Live lamp preview with brightness and color adjustments |
| **Colors Card** | Edit colors used to display text and apply gradients |
| **Palettes Card** | Manage lists of colors (palettes) |
| **Gradient Card** | Configure and preview gradient & color modes |
| **Draw Card** | Pixel art editor with personal gallery |

> [!NOTE]
> All cards support **light and dark themes** and adapt automatically to your Home Assistant theme.

---

## Installation via HACS

### HACS (Recommended)

<div align="left">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=Max-src&repository=yeelight-cube-lite" target="_blank" rel="noopener noreferrer">
    <img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open in HACS" width="200">
  </a>
</div>

Or manually add the custom repository:

<details>
<summary>Step-by-step HACS installation</summary>

1. Open **HACS** in your Home Assistant dashboard
2. Click the **⋮** menu (top right) → **Custom repositories**
3. Add this URL and set the category to **Integration**, then click **Add**:
   ```
   https://github.com/Max-src/yeelight-cube-lite
   ```
4. The repository now appears in the custom repositories list. Close the dialog.
5. Back in HACS, search for **Yeelight Cube Lite** and open the result
6. Click **Download** (or **Install**) and confirm
7. **Restart Home Assistant**

</details>

### Manual Installation

1. Download the [latest release](https://github.com/Max-src/yeelight-cube-lite/releases)
2. Copy the contents into `custom_components/yeelight_cube/` inside your HA config directory
3. Restart Home Assistant

---

## Setup

### Prerequisites: Yeelight Station App

Before adding the lamp to Home Assistant, you must first set it up using the **Yeelight Station app** (not the standard Yeelight app).

<details>
<summary>View setup steps</summary>

1. **Download the Yeelight Station app** from the App Store (iOS) or Google Play (Android)
2. **Power on the lamp**
3. **Add the lamp to the app**: follow the in-app instructions to connect the lamp to your **2.4 GHz Wi-Fi network**
4. **Enable LAN Control**: in the app, go to your lamp's **Device Settings** and activate **LAN Control**. This is required for the integration to communicate with the lamp over your local network
5. **Find the lamp's IP address**: in Device Settings → **Device info**, find the IP address assigned to the lamp (e.g. `192.168.4.139`)

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/App_Device_Settings.jpg" width="250" alt="Device Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/App_LAN_Control.jpg" width="250" alt="LAN Control"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/App_Device_Info.jpg" width="250" alt="Device Info"></td>
  </tr>
</table>

> [!TIP]
> You can also find the lamp's IP from your router's admin page or DHCP client list. Assigning a **static IP / DHCP reservation** is recommended.

</details>

### Adding to Home Assistant

#### Automatic Discovery (recommended)

Once the lamp is on your network with LAN Control enabled, Home Assistant will **automatically detect it** via Zeroconf (mDNS) - no IP address needed.

<details>
<summary>View discovery steps</summary>

1. Look for the **Yeelight Cube Lite** discovery notification on **Settings → Devices & Services**

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Discovered.png" alt="Device Discovered">

2. Click **Add**

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Discovered-Confirmation.png" alt="Confirmation Popup">

3. Confirm to set up the device

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Discovered-Create-Device.png" alt="Device Created">

4. Done. The integration creates all entities automatically.

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Detail-Page.png" alt="Integration Detail Page">

> [!NOTE]
> If you also use the official Yeelight integration, it may generate a discovery notification for the same lamp. That notification is **automatically suppressed** by this integration - you can safely ignore it.

> [!TIP]
> **IP address changes:** The integration uses auto-rediscovery. If the lamp gets a new IP (e.g. after a router reboot), the integration finds it again automatically.

</details>

#### Manual Setup (alternative)

If the lamp is not discovered automatically (e.g. different subnet or mDNS is blocked):

<details>
<summary>View manual setup steps</summary>

1. Go to **Settings → Devices & Services**
2. Click **+ Add Integration** (bottom right)
3. Search for **Yeelight Cube Lite** and select it
4. On this integration detail page, click **Add entry**

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Add-Entry.png" alt="Integration Detail Page - Add entry">

5. Enter the **IP address** from the Yeelight Station app (e.g. `192.168.4.139`)

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Add-Entry-Device-IP.png" alt="Add entry - Device IP">

6. Click **Submit**

   <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Home-Assistant-Integrations-Detail-Page.png" alt="Integration Detail Page">

> [!NOTE]
> Each lamp needs to be added separately. If you have multiple lamps, repeat the process for each one.

</details>

---

## Lovelace Cards

This component includes custom Lovelace cards for your dashboards.

Every card comes with a **visual configuration editor** - click the pencil icon to customize without YAML. Each section can be configured independently, and most sections offer **multiple display styles and layout modes**.

> [!IMPORTANT]
> After installing or updating, do a hard refresh (`Ctrl+F5`) in your browser if the cards don't appear.

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Dashboard-4-cards-preview.png" alt="Preview, Colors, Palettes and Gradient cards"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Dashboard-draw-card-preview.png" alt="Draw card"></td>
  </tr>
</table>

### 🖥️ Preview Card (`custom:yeelight-cube-lamp-preview-card`)

A live dashboard card that mirrors the lamp's current state with real-time matrix preview, brightness slider, power & refresh actions, and color adjustments panel.

<details>
<summary>View card variations</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Variation-1.png" alt="Preview card variation 1"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Variation-2.png" alt="Preview card variation 2"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Variation-3.png" alt="Preview card variation 3"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Variation-4.png" alt="Preview card variation 4"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Variation-5.png" alt="Preview card variation 5">
    <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Variation-6.png" alt="Preview card variation 6"></td>
  </tr>
</table>

</details>

**Features:**

| Feature | Description |
| :-- | :-- |
| **Lamp preview** | Reflects what's displayed on the lamp. Configurable pixel style, spacing, background, shadow, and size |
| **Refresh & power** | Quick buttons to force-refresh or toggle power |
| **Brightness slider** | Configurable slider styles |
| **Color adjustments** | Effect sliders with multiple layout modes, change indicators, and reset buttons |

<details>
<summary>View editor sections</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Editor-1.png" alt="Preview card editor - Global Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Editor-2.png" alt="Preview card editor - Lamp Preview"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Editor-3.png" alt="Preview card editor - Power / Refresh Actions"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Editor-4.png" alt="Preview card editor - Brightness Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Preview-Card-Editor-5.png" alt="Preview card editor - Color Adjustments"></td>
  </tr>
</table>

</details>

---

### 🎨 Colors Card (`custom:yeelight-cube-color-list-editor-card`)

Edit the ordered list of colors used by text display on the lamp. Add, delete, drag to reorder, shuffle, and save as a reusable palette.

<details>
<summary>View card variations</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Variation-1.png" alt="Colors card variation 1"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Variation-2.png" alt="Colors card variation 2"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Variation-3.png" alt="Colors card variation 3"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Variation-4.png" alt="Colors card variation 4"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Variation-5.png" alt="Colors card variation 5"></td>
  </tr>
</table>

</details>

**Features:**

| Feature | Description |
| :-- | :-- |
| **Multi-entity support** | Control multiple lamps at the same time |
| **Color list** | Add, remove, reorder with drag-and-drop. Multiple layout modes, optional hex/name display |
| **Color edit** | Color picker or hex input |
| **Actions** | Add, shuffle, and save as reusable palette |

<details>
<summary>View editor sections</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Editor-1.png" alt="Colors card editor - Global Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Editor-2.png" alt="Colors card editor - Color List Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Colors-Card-Editor-3.png" alt="Colors card editor - Add/Shuffle/Save Actions"></td>
  </tr>
</table>

</details>

---

### 🎭 Palettes Card (`custom:yeelight-cube-palette-card`)

Manage color palettes. Apply a palette to lamps with one click. Multiple display modes supported.

<details>
<summary>View card variations</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Variation-1.png" alt="Palettes card variation 1"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Variation-2.png" alt="Palettes card variation 2"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Variation-3.png" alt="Palettes card variation 3"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Variation-4.png" alt="Palettes card variation 4">
    <img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Variation-5.png" alt="Palettes card variation 5"></td>
  </tr>
</table>

</details>

**Features:**

| Feature | Description |
| :-- | :-- |
| **Multi-entity support** | Control multiple lamps at the same time |
| **Browse & apply** | Multiple display modes, configurable swatch styles, one-click apply |
| **Manage** | Rename and delete palettes |
| **Import/Export** | Load and save full palette collections |

<details>
<summary>View editor sections</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Editor-1.png" alt="Palettes card editor - Global Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Editor-2.png" alt="Palettes card editor - Palettes List"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Palettes-Card-Editor-3.png" alt="Palettes card editor - Import/Export Actions"></td>
  </tr>
</table>

</details>

---

### 🌈 Gradient Card (`custom:yeelight-cube-gradient-card`)

Select and configure gradient/color modes. Adjust gradient direction with an angle control. Preview all gradient modes live.

<details>
<summary>View card variations</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Variation-1.png" alt="Gradient card variation 1"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Variation-2.png" alt="Gradient card variation 2"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Variation-3.png" alt="Gradient card variation 3"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Variation-4.png" alt="Gradient card variation 4"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Variation-5.png" alt="Gradient card variation 5"></td>
  </tr>
</table>

</details>

**Features:**

| Feature | Description |
| :-- | :-- |
| **Multi-entity support** | Control multiple lamps at the same time |
| **Mode selector** | Switch between gradient/color modes; apply to whole panel or text only |
| **Angle selector** | Slider, number input, or rotary control (multiple rotary styles) |
| **Gradient preview** | Mini matrix previews of each mode with current text, colors, and angle |

<details>
<summary>View editor sections</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Editor-1.png" alt="Gradient card editor - Global Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Editor-2.png" alt="Gradient card editor - Color Mode Selector"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Editor-3.png" alt="Gradient card editor - Angle Selector"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Gradient-Card-Editor-4.png" alt="Gradient card editor - Gradient Preview"></td>
  </tr>
</table>

</details>

---

### ✏️ Draw Card (`custom:yeelight-cube-draw-card`)

The pixel art editor. Paint on a 20×5 interactive matrix, save designs to a personal gallery, and push artwork to one or more lamps with a single tap.

<details>
<summary>View card variations</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Variation-1.png" alt="Draw card variation 1"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Variation-2.png" alt="Draw card variation 2"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Variation-3.png" alt="Draw card variation 3"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Variation-4.png" alt="Draw card variation 4"></td>
  </tr>
</table>

</details>

**Features:**

| Feature | Description |
| :-- | :-- |
| **Multi-entity support** | Control multiple lamps at the same time |
| **Colors section** | Quick access to recent, palette, current, and drawing colors |
| **Drawing tools** | Individually toggleable with multiple styles |
| **Drawing matrix** | Interactive 20×5 matrix |
| **Action buttons** | Apply to lamp, upload from image, save, or clear |
| **Pixel art gallery** | Manage and apply pixel arts |
| **Import/Export** | Import and export collections as JSON |

<details>
<summary>View editor sections</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-1.png" alt="Draw card editor - Global Settings"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-2.png" alt="Draw card editor - Layout"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-3.png" alt="Draw card editor - Color Section"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-4.png" alt="Draw card editor - Drawing Tools"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-5.png" alt="Draw card editor - Drawing Matrix Section"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-6.png" alt="Draw card editor - Action Buttons"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-7.png" alt="Draw card editor - Pixel Art Section"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Cards/Draw-Card-Editor-8.png" alt="Draw card editor - Import/Export Actions"></td>
  </tr>
</table>

</details>

---

## Entities Created

Each lamp creates its own set of per-device entities, plus the integration creates **global entities** (palettes, drawings, fonts) shared across all lamps.

### Per-device Entities

<details>
<summary>View entity screenshots</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Entities/Lamp-Entities-1.png" alt="Lamp Entities - Controls"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Entities/Lamp-Entities-2.png" alt="Lamp Entities - Sensors"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Entities/Lamp-Entities-3.png" alt="Lamp Entities - Configuration"></td>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Entities/Lamp-Entities-4.png" alt="Lamp Entities - Diagnostic"></td>
  </tr>
</table>

</details>

#### Controls

| Entity | Type | Description |
| :-- | :-- | :-- |
| **Auto Turn On** | Switch | Automatically turn on the lamp when a new mode or drawing is applied |
| **Yeelight Cube Lite** | Light | Main light entity (on/off, RGB color, brightness) |
| **Display Mode** | Select | Switch between display modes (see [Display Modes](#display-modes)) |
| **Display Text** | Text | Text input for custom text display on the matrix |
| **Flip Orientation** | Switch | Flip display horizontally (for upside-down mounting) |
| **Font** | Select | Choose text font: basic, fat, italic |
| **Gradient Angle** | Number | Angle for angle-based gradient modes (0°–360°) |
| **Palette** | Select | Select from saved color palettes |
| **Pixel Art** | Select | Select from saved pixel art drawings |
| **Text Alignment** | Select | Text alignment: left, center, right |

#### Sensors

| Entity | Type | Description |
| :-- | :-- | :-- |
| **Matrix Preview (Round)** | Camera | Live preview with round pixels |
| **Matrix Preview (Square)** | Camera | Live preview with square pixels |

> [!TIP]
> Use these camera entities with a "Picture Entity" card for quick previews. For more responsive previews, use the custom [Preview Card](#-preview-card-customyeelight-cube-lamp-preview-card).

#### Configuration

| Entity | Type | Description |
| :-- | :-- | :-- |
| **Color: Hue Shift** | Number | Shift colors around the wheel (−180° to +180°) |
| **Color: Temperature** | Number | Warm/cool adjustment (−100 to +100) |
| **Effects: Grayscale** | Number | Grayscale intensity (0–100%) |
| **Effects: Invert** | Number | Color inversion intensity (0–100%) |
| **Effects: Tint Hue** | Number | Tint color hue (0°–360°) |
| **Effects: Tint Strength** | Number | Tint overlay intensity (0–100%) |
| **Intensity: Saturation** | Number | Saturation level (0–200%) |
| **Intensity: Vibrance** | Number | Adaptive saturation (0–200%) |
| **Tone: Contrast** | Number | Contrast level (0–200%) |
| **Tone: Glow** | Number | Bloom / glow effect (0–100%) |
| **Transition Duration** | Number | Transition time (0.2–10s) |
| **Transition Effect** | Select | Choose from 14+ transition animations |
| **Transition Steps** | Number | Animation steps (1–10) |

#### Diagnostic

| Entity | Type | Description |
| :-- | :-- | :-- |
| **Force Refresh** | Button | Re-activate connection for a stuck lamp |
| **IP Address** | Sensor | Current IP address (updated after rediscovery) |

### Global Entities

These sensor entities are created **once per integration install** and shared across all lamps.

<details>
<summary>View global entities details</summary>

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Entities/Ungrouped-Entities.png" alt="Ungrouped Entities"></td>
  </tr>
</table>

#### `sensor.yeelight_cube_saved_pixel_arts` - Saved Drawings

Stores all pixel art designs created with the Draw Card.

| Attribute | Type | Description |
| :-- | :-- | :-- |
| `pixel_arts` | list | Ordered list of saved pixel arts (each has `name` + `pixels`) |
| `count` | integer | Number of saved pixel arts |
| `content_hash` | string | MD5 hash; changes on every modification |

**State:** `"N drawings"` (e.g. `"3 drawings"`)

**How to use:** The index in `pixel_arts` corresponds to the index passed to `apply_pixel_art`, `remove_pixel_art`, etc. (0-based):

```yaml
# In Developer Tools → Template
{{ state_attr('sensor.yeelight_cube_saved_pixel_arts', 'pixel_arts')
   | map(attribute='name') | list }}
# → ['Magic Lamp', 'Bat', 'Whale']
# 'Magic Lamp' = index 0, 'Bat' = index 1, 'Whale' = index 2
```

---

#### `sensor.yeelight_cube_color_palettes` - Color Palettes

Stores all saved color palettes.

| Attribute | Type | Description |
| :-- | :-- | :-- |
| `palettes_v2` | list | Ordered list of palettes (each has `name` + `colors`) |
| `count` | integer | Number of saved palettes |
| `content_hash` | string | MD5 hash; changes on every modification |

**State:** numeric count (e.g. `3`)

---

#### `sensor.yeelight_cube_font_letter_map` - Font Characters

Read-only bitmap font maps used for text rendering.

| Attribute | Type | Description |
| :-- | :-- | :-- |
| `font_maps` | object | Dictionary with keys `"basic"`, `"fat"`, `"italic"` mapping characters to pixel bitmaps |

**State:** always `"ready"` - content is static and never changes at runtime.

</details>

---

## Automations & Node-RED

All entities (light, selectors, sliders, text, switches) can be used in standard automations, scripts, and Node-RED flows. The integration also registers **custom actions (services)** under the `yeelight_cube` domain.

> [!NOTE]
> For a complete reference of all available actions with full field descriptions and examples, see [SERVICES.md](SERVICES.md).

### Quick Reference

#### Display Control

| Action | Description | Key Fields |
| :-- | :-- | :-- |
| `yeelight_cube.set_custom_text` | Display text on the matrix | `text`, `entity_id` |
| `yeelight_cube.set_mode` | Switch display mode | `mode`, `entity_id` |
| `yeelight_cube.set_solid_color` | Set a single solid color | `rgb_color`, `entity_id` |
| `yeelight_cube.set_angle` | Set gradient angle | `angle` (0–360), `entity_id` |
| `yeelight_cube.set_brightness` | Set brightness | `brightness` (1–100), `entity_id` |

#### Pixel Art

| Action | Description | Key Fields |
| :-- | :-- | :-- |
| `yeelight_cube.apply_custom_pixels` | Push pixel array to lamp | `pixels`, `entity_id` |
| `yeelight_cube.apply_pixel_art` | Apply saved art by index | `idx`, `entity_id` |
| `yeelight_cube.save_pixel_art` | Save a pixel array as named art | `pixels`, `name` |

#### Palettes & Colors

| Action | Description | Key Fields |
| :-- | :-- | :-- |
| `yeelight_cube.load_palette` | Apply saved palette by index | `idx`, `entity_id` |
| `yeelight_cube.save_palette` | Save a new color palette | `palette`, `name`, `entity_id` |
| `yeelight_cube.set_text_colors` | Set gradient/sequence colors | `text_colors`, `entity_id` |

### Example Automations

<details>
<summary>🔔 Doorbell: flash text on lamp</summary>

```yaml
automation:
  alias: "Doorbell: flash text on lamp"
  trigger:
    - platform: state
      entity_id: binary_sensor.doorbell
      to: "on"
  action:
    - action: yeelight_cube.set_custom_text
      data:
        entity_id: light.yeelight_cube_192_168_4_139
        text: "DOOR"
    - action: yeelight_cube.set_mode
      data:
        entity_id: light.yeelight_cube_192_168_4_139
        mode: "Text Color Sequence"
```

</details>

<details>
<summary>🔄 Node-RED: cycle through pixel art designs</summary>

Use an **Inject** node → **Change** node (set `msg.payload.idx`) → **Call Service** node:

- **Domain**: `yeelight_cube`
- **Service**: `apply_pixel_art`
- **Data**: `{"idx": {{payload.idx}}, "entity_id": "light.yeelight_cube_192_168_4_139"}`

</details>

### Calling Custom Actions

<details>
<summary>View HA and Node-RED examples</summary>

**Home Assistant automations / scripts:**

```yaml
action: yeelight_cube.set_custom_text
data:
  entity_id: light.cubelite_192_168_4_102
  text: "HELLO"
```

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/Action-Set-Custom-Text.png" alt="Action - set_custom_text"></td>
  </tr>
</table>

**Node-RED** - use an Action node:

- **Action**: `yeelight_cube.set_custom_text`
- **Data**: `{"text": msg.payload, "entity_id": "light.cubelite_192_168_4_102"}`

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Max-src/yeelight-cube-lite/main/images/Actions/NodeRED-Set-Custom-Text.png" alt="NodeRED - set_custom_text"></td>
  </tr>
</table>

</details>

---

## Display Modes

The lamp supports the following display modes, selectable via the **Display Mode** entity or the Gradient Card:

| Mode | Description |
| :-- | :-- |
| **Solid Color** | Fill the entire matrix with a single color |
| **Letter Gradient** | Horizontal gradient per character |
| **Column Gradient** | Vertical gradient across 20 columns |
| **Row Gradient** | Horizontal gradient across 5 rows |
| **Angle Gradient** | Gradient at a configurable angle |
| **Radial Gradient** | Gradient radiating from center |
| **Letter Vertical Gradient** | Vertical gradient per character |
| **Letter Angle Gradient** | Angled gradient per character |
| **Text Color Sequence** | Each character gets a different color |
| **Panel Color Sequence** | Color sequence across all pixels |
| **Custom Draw** | Pixel art mode (use the Draw Card) |

---

## Transition Effects

When switching between display modes or pixel art, animated transitions can be applied:

| Effect | | Effect |
| :-- | :-- | :-- |
| Fade Through Black | | Slide Left / Right / Up / Down |
| Direct Crossfade | | Card From Right / Left / Top / Bottom |
| Random Dissolve | | Explode & Reform |
| Wipe Right / Left / Down / Up | | Snake / Wave Wipe / Iris |
| Vertical Flip | | Curtain / Gravity Drop / Pixel Migration |

Configure via the **Transition Effect**, **Transition Steps**, and **Transition Duration** entities.

---

## Requirements

| Requirement | Details |
| :-- | :-- |
| **Home Assistant** | 2024.1.0 or newer |
| **Hardware** | Yeelight Cube Smart Lamp Lite (or compatible matrix device) on the same LAN |
| **Python packages** | `yeelight` and `Pillow` (installed automatically by HA) |

---

## Troubleshooting

| Problem | Solution |
| :-- | :-- |
| **Cards not showing** | Clear browser cache with `Ctrl+F5` after installing or updating |
| **Device not found** | Ensure the lamp is on the same network. Check IP in the Yeelight Station app. Auto-discovery via Zeroconf is also available |
| **Conflicts with Yeelight integration** | This integration automatically suppresses built-in Yeelight discovery for Cube devices |
| **Lamp stuck / unresponsive** | Press the **Force Refresh** button entity, or use the refresh button on the Preview card |
| **Colors look off** | Color accuracy correction is built-in and applied automatically |
| **Lamp changed IP** | Auto-rediscovery handles this. You can also update the IP from the Configure page |

---

## License

MIT - see [LICENSE](LICENSE) for details.

---

## Support

If you find this integration useful, consider supporting development:

[![Buy Me a Coffee][bmac_badge_large]][bmac]

---

**Yeelight Cube Lite - Made with ❤️ for the Home Assistant community**

<!-- Badge references -->
[ha_badge]: https://img.shields.io/badge/Home%20Assistant-Compatible-green
[ha_link]: https://www.home-assistant.io/
[hacs_badge]: https://img.shields.io/badge/HACS-Custom-41BDF5
[hacs_link]: https://hacs.xyz/
[release_badge]: https://img.shields.io/github/v/release/Max-src/yeelight-cube-lite
[release]: https://github.com/Max-src/yeelight-cube-lite/releases
[bmac_badge]: https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee&logoColor=white
[bmac_badge_large]: https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee&logoColor=white&style=for-the-badge
[bmac]: https://buymeacoffee.com/max.src
