# Yeelight Cube for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)

A Home Assistant custom integration for **Yeelight Cube Lite** (and similar matrix/panel devices). Control the 5×5 RGB LED matrix, display text, pixel art, gradients, and more — all from the HA dashboard.

## Features

- **Full 5×5 matrix control** — set individual pixel colors via custom Lovelace cards
- **Pixel art gallery** — create, save and load designs
- **Gradient modes** — linear, radial, angle and custom gradient fills
- **Text display** — scroll text across the matrix with configurable colors and speed
- **Palette management** — create and reuse custom palettes
- **Color effects** — hue shift, saturation, color correction, brightness control
- **Multiple Lovelace cards** — draw card, gradient card, palette card, lamp preview, and more
- **Hardware brightness** — seamless dual-mechanism brightness (hardware + RGB darkening)
- **Conflict prevention** — prevents the built-in Yeelight integration from interfering

## Installation via HACS

### Add as Custom Repository

1. Open HACS in your Home Assistant dashboard
2. Click the **⋮** menu (top right) → **Custom repositories**
3. Add this URL:
   ```
   https://github.com/Max-src/yeelight-cube-lite
   ```
4. Category: **Integration**
5. Click **Add**
6. Search for **Yeelight Cube** in HACS and install it
7. **Restart Home Assistant**

## Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **Yeelight Cube**
3. Enter the IP address of your Yeelight Cube device
4. The integration will create entities for light, sensors, switches, and more

## Lovelace Cards

After installation, the following custom cards are automatically available:

| Card                                          | Description                                         |
| --------------------------------------------- | --------------------------------------------------- |
| `custom:yeelight-cube-lamp-preview-card`      | Live lamp preview with brightness and mode controls |
| `custom:yeelight-cube-draw-card`              | Pixel art editor with palette and gallery           |
| `custom:yeelight-cube-gradient-card`          | Gradient fill editor with multiple modes            |
| `custom:yeelight-cube-palette-card`           | Palette manager                                     |
| `custom:yeelight-cube-color-list-editor-card` | Color list editor for animations                    |
| `custom:yeelight-cube-lettermap-card`         | Text display configuration                          |
| `custom:yeelight-cube-angle-gradient-card`    | Angle-based gradient editor                         |

### Adding a Card

1. Edit your dashboard
2. Click **+ Add Card**
3. Search for one of the card names above (e.g. `yeelight-cube-draw-card`)
4. Configure the entity in the card editor

> **Note:** The cards are auto-registered as Lovelace resources when the integration loads. If they don't appear, try a hard refresh (`Ctrl+F5`) after restarting HA.

## Entities Created

| Platform | Entity                   | Description                                     |
| -------- | ------------------------ | ----------------------------------------------- |
| Light    | `light.yeelight_cube_*`  | Main light entity with RGB, brightness, effects |
| Sensor   | Various                  | Palette/pixel art state sensors                 |
| Switch   | Various                  | Feature toggles                                 |
| Select   | Various                  | Mode selectors                                  |
| Number   | Various                  | Numeric parameters (scroll speed, etc.)         |
| Text     | Various                  | Text input entities                             |
| Button   | Various                  | Action triggers                                 |
| Camera   | `camera.yeelight_cube_*` | Live matrix preview as a camera feed            |

## Requirements

- Home Assistant 2023.1.0 or newer
- Yeelight Cube Lite (or compatible matrix/panel device) on the same network
- Python packages `yeelight` and `Pillow` (installed automatically)

## Troubleshooting

- **Cards not showing?** Clear browser cache (`Ctrl+F5`) after installing/updating.
- **Device not found?** Make sure the cube is on the same network and the IP is correct. Check the device's app for the IP.
- **Conflicts with Yeelight integration?** This component automatically prevents the built-in Yeelight integration from managing your cube device.

## License

See [LICENSE](LICENSE) for details.
