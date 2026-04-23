﻿# Complete Service Reference

This document provides comprehensive documentation for all available services in the Yeelight Cube Lite Component for controlling Yeelight Cube Smart Lamp Lite devices.

> For a general overview of the integration, including installation, setup, cards and entities, see [README.md](README.md).

## 📋 Service Categories

### 🎨 **Text Services**

Display and control text on your Yeelight Cube Smart Lamp Lite

### 🖼️ **Drawing Services**

Create and manage pixel art on your device

### 🌈 **Gradient Services**

Control gradient effects and display modes

### 🎨 **Palette Services**

Manage color palettes

### ⚙️ **Configuration Services**

Device settings and properties

### 🔧 **Device Management**

Discovery and device management

---

## 🎨 Text Services

### `display_word`

**Display a word on the Yeelight Cube Smart Lamp Lite**

```yaml
service: yeelight_cube.display_word
data:
  word: "Hello"
  entity_id: light.cubelite_192_168_4_139
```

### `set_custom_text`

**Set custom text with full formatting control**

```yaml
service: yeelight_cube.set_custom_text
data:
  text: "HELLO WORLD"
  entity_id: light.cubelite_192_168_4_139
```

### `set_text_colors`

**Apply colors to text display**

```yaml
service: yeelight_cube.set_text_colors
data:
  text_colors: [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
  save_as_palette: true
  entity_id: light.cubelite_192_168_4_139
```

### `set_scroll_speed`

**Control text scrolling speed**

```yaml
service: yeelight_cube.set_scroll_speed
data:
  speed: 1.5 # seconds per step (0.1 to 10.0)
  entity_id: light.cubelite_192_168_4_139
```

### `set_scroll_enabled`

**Enable or disable automatic scrolling**

```yaml
service: yeelight_cube.set_scroll_enabled
data:
  enabled: true
  entity_id: light.cubelite_192_168_4_139
```

### `reset_scroll`

**Reset scroll position to beginning**

```yaml
service: yeelight_cube.reset_scroll
data:
  entity_id: light.cubelite_192_168_4_139
```

### `set_font`

**Change text font**

```yaml
service: yeelight_cube.set_font
data:
  font: "koubit" # basic, koubit, josefin
  entity_id: light.cubelite_192_168_4_139
```

### `set_alignment`

**Set text alignment**

```yaml
service: yeelight_cube.set_alignment
data:
  alignment: "center" # left, center, right
  entity_id: light.cubelite_192_168_4_139
```

### `set_orientation`

**Control display orientation**

```yaml
service: yeelight_cube.set_orientation
data:
  orientation: "flipped" # normal, flipped
  entity_id: light.cubelite_192_168_4_139
```

---

## 🖼️ Drawing Services

### `apply_custom_pixels`

**Set individual pixel colors (10x10 matrix)**

```yaml
service: yeelight_cube.apply_custom_pixels
data:
  pixels: [[255, 0, 0], [0, 255, 0], [0, 0, 255], ...] # 100 RGB arrays
  entity_id: light.cubelite_192_168_4_139
```

### `set_custom_pixels`

**Alternative method to set pixel colors**

```yaml
service: yeelight_cube.set_custom_pixels
data:
  pixels: [[255, 0, 0], [0, 255, 0], [0, 0, 255], ...] # 100 RGB arrays
  entity_id: light.cubelite_192_168_4_139
```

### `save_pixel_art`

**Save current pixel configuration**

```yaml
service: yeelight_cube.save_pixel_art
data:
  pixels: [[255, 0, 0], [0, 255, 0], [0, 0, 255], ...] # 100 RGB arrays
  name: "My Artwork"
  entity_id: light.cubelite_192_168_4_139
```

### `apply_pixel_art`

**Load saved pixel art by index**

```yaml
service: yeelight_cube.apply_pixel_art
data:
  idx: 0 # Index of saved pixel art
  entity_id: light.cubelite_192_168_4_139
```

### `remove_pixel_art`

**Delete saved pixel art**

```yaml
service: yeelight_cube.remove_pixel_art
data:
  idx: 0
  entity_id: light.cubelite_192_168_4_139
```

### `rename_pixel_art`

**Rename saved pixel art**

```yaml
service: yeelight_cube.rename_pixel_art
data:
  idx: 0
  new_name: "Updated Artwork"
  entity_id: light.cubelite_192_168_4_139
```

### `get_pixel_art`

**Retrieve saved pixel art data**

```yaml
service: yeelight_cube.get_pixel_art
data:
  idx: 0
  entity_id: light.cubelite_192_168_4_139
```

### `import_pixel_arts`

**Import pixel art collection**

```yaml
service: yeelight_cube.import_pixel_arts
data:
  pixel_arts: [{ "name": "Art1", "pixels": [[255, 0, 0], ...] }, ...]
  entity_id: light.cubelite_192_168_4_139
```

### `display_image`

**Display an image file on the cube**

```yaml
service: yeelight_cube.display_image
data:
  image_path: "/config/www/my_image.png"
  entity_id: light.cubelite_192_168_4_139
```

---

## 🌈 Gradient Services

### `set_mode`

**Change display mode**

```yaml
service: yeelight_cube.set_mode
data:
  mode: "Angle Gradient" # See mode options below
  entity_id: light.cubelite_192_168_4_139
```

**Available Modes:**

- `Solid Color` - Single color text
- `Letter Gradient` - Gradient per letter
- `Column Gradient` - Vertical gradients
- `Row Gradient` - Horizontal gradients
- `Angle Gradient` - Diagonal gradients
- `Radial Gradient` - Circular gradients
- `Text Color Sequence` - Animated color cycling

### `set_angle`

**Set gradient angle (for Angle Gradient mode)**

```yaml
service: yeelight_cube.set_angle
data:
  angle: 45.0 # 0-360 degrees
  entity_id: light.cubelite_192_168_4_139
```

### `set_panel_mode`

**Control gradient coverage area**

```yaml
service: yeelight_cube.set_panel_mode
data:
  panel_mode: true # true = whole panel, false = text only
  entity_id: light.cubelite_192_168_4_139
```

---

## 🎨 Palette Services

### `save_palette`

**Save a color palette**

```yaml
service: yeelight_cube.save_palette
data:
  palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
  name: "RGB Rainbow"
  entity_id: light.cubelite_192_168_4_139
```

### `load_palette`

**Load saved palette by index**

```yaml
service: yeelight_cube.load_palette
data:
  idx: 0
  entity_id: light.cubelite_192_168_4_139
```

### `remove_palette`

**Delete saved palette**

```yaml
service: yeelight_cube.remove_palette
data:
  idx: 0
  entity_id: light.cubelite_192_168_4_139
```

### `rename_palette`

**Rename saved palette**

```yaml
service: yeelight_cube.rename_palette
data:
  idx: 0
  new_name: "Updated Palette"
  entity_id: light.cubelite_192_168_4_139
```

### `set_palettes`

**Set complete palette collection**

```yaml
service: yeelight_cube.set_palettes
data:
  palettes: [{ "name": "Palette1", "colors": [[255, 0, 0], [0, 255, 0]] }, ...]
  entity_id: light.cubelite_192_168_4_139
```

---

## 🔧 Device Management

### `add_managed_device`

**Add device to managed list**

```yaml
service: yeelight_cube.add_managed_device
data:
  ip_address: "192.168.1.100"
```

### `remove_managed_device`

**Remove device from managed list**

```yaml
service: yeelight_cube.remove_managed_device
data:
  ip_address: "192.168.1.100"
```

### `is_device_managed`

**Check if device is managed**

```yaml
service: yeelight_cube.is_device_managed
data:
  ip_address: "192.168.1.100"
```

### `list_managed_devices`

**List all managed devices**

```yaml
service: yeelight_cube.list_managed_devices
```

### `test_device_detection`

**Test device detection logic**

```yaml
service: yeelight_cube.test_device_detection
data:
  device_model: "cubelite"
  device_name: "Yeelight Cube Lite"
  device_id: "0x12345678"
```

### `ignore_yeelight_discovery`

**Ignore IP in Yeelight integration**

```yaml
service: yeelight_cube.ignore_yeelight_discovery
data:
  ip_address: "192.168.4.139"
```

### `ignore_specific_yeelight`

**Ignore specific device in Yeelight integration**

```yaml
service: yeelight_cube.ignore_specific_yeelight
data:
  ip_address: "192.168.4.139"
```

### `force_rediscovery`

**Force device rediscovery**

```yaml
service: yeelight_cube.force_rediscovery
data:
  ip_address: "192.168.4.139"
```

### `trigger_manual_discovery`

**Manually trigger discovery**

```yaml
service: yeelight_cube.trigger_manual_discovery
data:
  ip_address: "192.168.4.139"
  device_name: "CubeLite Test"
  device_model: "cubelite"
  device_id: "0x12345678"
```

### `create_cube_discovery`

**Create discovery flow for cube**

```yaml
service: yeelight_cube.create_cube_discovery
data:
  ip_address: "192.168.4.139"
  device_name: "My CubeLite"
```

### `test_display`

**Test cube connectivity and display**

```yaml
service: yeelight_cube.test_display
data:
  entity_id: light.cubelite_192_168_4_139
```

---

## 🎯 Multi-Entity Operations

All services support multi-entity operations. You can target multiple cubes by calling the same service multiple times with different `entity_id` values, or use automations to synchronize operations.

### Example: Synchronized Text Display

```yaml
# Show same text on all cubes
- service: yeelight_cube.set_custom_text
  data:
    text: "SYNC"
    entity_id: light.cubelite_192_168_4_139
- service: yeelight_cube.set_custom_text
  data:
    text: "SYNC"
    entity_id: light.cubelite_192_168_4_247
```

### Example: Different Content Per Cube

```yaml
# Show different content on each cube
- service: yeelight_cube.set_custom_text
  data:
    text: "CUBE 1"
    entity_id: light.cubelite_192_168_4_139
- service: yeelight_cube.set_custom_text
  data:
    text: "CUBE 2"
    entity_id: light.cubelite_192_168_4_247
```

---

## 📱 Node-RED Integration

All services are fully compatible with Node-RED and provide:

- **Parameter descriptions** and examples
- **Entity selectors** for device targeting
- **Input validation** and type checking
- **Dropdown menus** for mode selection
- **Sliders** for numeric values

### Example Node-RED Flow

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
      "entity_id": "light.cubelite_192_168_4_139"
    }
  }
]
```

---

## 🔍 Service Response Data

Some services return data that can be used in automations:

### `list_managed_devices`

Returns: List of managed IP addresses

### `get_pixel_art`

Returns: Pixel art data including name and pixel array

### `test_device_detection`

Returns: Boolean indicating if device would be detected

### `is_device_managed`

Returns: Boolean indicating if device is managed

---

## ⚡ Quick Reference

| Category       | Primary Services                        | Purpose                  |
| -------------- | --------------------------------------- | ------------------------ |
| **Text**       | `set_custom_text`, `set_text_colors`    | Display text with colors |
| **Drawing**    | `apply_custom_pixels`, `save_pixel_art` | Create pixel art         |
| **Gradients**  | `set_mode`, `set_angle`                 | Control gradient effects |
| **Palettes**   | `save_palette`, `load_palette`          | Manage color collections |
| **Config**     | `set_font`, `set_alignment`             | Device settings          |
| **Management** | `create_cube_discovery`, `test_display` | Device setup             |

---

_For more examples and advanced usage, see the main [README.md](README.md)_
