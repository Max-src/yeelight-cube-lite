# Advanced Color & Brightness Calibration

> [!WARNING]
> This document is for **developers** working on the integration internals. The
> parameters below are low-level tuning knobs for the on-device color and
> brightness pipeline. They are **not** exposed through any user-facing card or
> entity, and most users never need them. Nothing here is required for normal
> use of the lamp.

The `set_color_calibration` service (administrators only) lets you adjust the color/brightness
correction pipeline **at runtime** so you can dial in values against a real
lamp without restarting Home Assistant. Changes are applied immediately but are
**not persisted** — once you find values you like, copy them into the code
defaults in [`light_color.py`](../custom_components/yeelight_cube/light_color.py) so they survive a restart.

All current values are also published on the light entity as
`calib_*` attributes, so you can read back the live state.

---

## Why correction is needed

The Cube Lite's LEDs do not behave like an sRGB computer monitor:

- **Different LED efficiencies.** The green LED is the most efficient and the
  blue LED the least, so a "neutral" RGB value such as white can look greenish,
  and blues/purples can look washed out.
- **Non-linearity at low duty cycle.** At very low effective brightness (low PWM
  duty), the LEDs become non-linear and hues drift — dim colors lose saturation
  or shift toward a different hue.
Brightness itself is the lamp's hardware brightness (`set_bright`, 1–100 %,
proportional to the slider), as in the firmware's own modes (clock, native
effects): pixels are never darkened for brightness, so a picture and a native
effect at the same setting are equally bright. The pipeline corrects colors with
two independent stages, applied in this order after color effects:

```
color effects → System 1 (low-bright gamma)
              → System 2 (per-channel gain) → encode & send
```

The dashboard preview is never affected — it always shows the original intended
colors. Only the data sent to the physical lamp is corrected.

---

## System 1 — Low-brightness gamma correction

Implemented in `_apply_color_correction()`. Applies a per-channel inverse-gamma
boost that fades in only at low **hardware** brightness (the LEDs' duty
cycle). Above `hw_threshold` it is fully
off; at/below `hw_full` it is fully on, blending linearly in between. It also
blends between a hue-preserving uniform scale and a per-channel scale via
`channel_balance`.

| Field | Default | Range | Description |
| :-- | :-- | :-- | :-- |
| `gamma_r` | `0.85` | 0.1–1.0 | Red inverse gamma. Lower = stronger low-brightness boost. `1.0` = no change |
| `gamma_g` | `0.75` | 0.1–1.0 | Green inverse gamma. Lower than red because the green LED is stronger |
| `gamma_b` | `0.62` | 0.1–1.0 | Blue inverse gamma. Usually the strongest correction so dim blues don't go grayish |
| `hw_threshold` | `50` | 10–100 | Hardware brightness % **above** which correction is fully off |
| `hw_full` | `10` | 1–50 | Hardware brightness % at/below which correction is fully on (100%) |
| `channel_balance` | `0.7` | 0.0–1.0 | Blend: `0` = uniform luminance scale (hue-safe, no blue fix), `1` = pure per-channel (best blue/purple accuracy, may shift hue). `0.7` favors per-channel |

---

## System 2 — Per-channel gain (monitor matching)

Implemented in `_apply_color_accuracy()`, toggled by `set_color_accuracy`
(default **on**). A linear multiplier per channel that compensates for the LED
color imbalance vs. a monitor. The correction **fades with brightness**: full
strength at HA brightness 255, fading to neutral (no correction) near
brightness 1, so it never fights System 1 at the dim end.

| Field | Default | Range | Description |
| :-- | :-- | :-- | :-- |
| `gain_r` | `1.00` | 0.5–1.5 | Red channel multiplier. `1.00` = no scaling |
| `gain_g` | `1.00` | 0.5–1.5 | Green channel multiplier. Lower than `1.0` reduces the green cast in whites/yellows |
| `gain_b` | `1.00` | 0.5–1.5 | Blue channel multiplier. Lower than `1.0` deepens blues/purples |

> [!NOTE]
> **The code default for all three gains is `1.00`, which makes System 2 a
> no-op out of the box.** The function and the docstring describe a tuned
> profile (e.g. `gain_g ≈ 0.87`, `gain_b ≈ 0.72`) as a *starting point* for the
> kind of green/blue reduction these LEDs typically need, but those values are
> not currently applied as defaults. Tune them against your own unit before
> committing new defaults.

---

## Tuning workflow

1. Call `set_color_calibration` against your lamp entity to adjust one or more
   parameters. Changes apply immediately and re-render the current frame, so you
   can watch the lamp while you dial values in. Only the keys you pass are
   updated; everything else keeps its current value.
2. Read the live state back from the light entity's `calib_*` attributes to
   confirm what is currently applied.
3. When satisfied, paste the numbers into the corresponding constants/defaults
   in [`light_color.py`](../custom_components/yeelight_cube/light_color.py) so they survive a restart:
   - System 1 → `self._calib_gamma_*`, `_calib_hw_*`, `_calib_channel_balance`
   - System 2 → `self._calib_gain_*`

### Example service call

```yaml
action: yeelight_cube.set_color_calibration
data:
  # System 1 — gamma curve
  gamma_r: 0.85
  gamma_g: 0.75
  gamma_b: 0.62
  hw_threshold: 50
  hw_full: 10
  channel_balance: 0.7
  # System 2 — gain
  gain_r: 1.00
  gain_g: 1.00
  gain_b: 1.00
  entity_id: light.cubelite_192_168_4_102
```

All fields are optional — only the keys you pass are updated.
