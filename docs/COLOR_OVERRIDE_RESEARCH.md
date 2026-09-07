# Native Effect Color Override Research

> [!NOTE]
> This document records experimental Cube Lite firmware behavior observed on
> real lamps. The names used for command IDs 15 and 64-67 are descriptive and
> are not official Yeelight names.

## Protocol behavior

Native effects are normally sent as:

```text
[effect_id, 0, 4, {"mode": mode, ...}]
```

Experiments show that the outer `effect_id` can alter the colors produced by a
different renderer in `mode`. In particular, Spectrum (`mode: 17`) keeps its
geometry and motion when the normal effect ID 17 is replaced with 15 or 64-67,
but uses a different color progression.

The best current model is a firmware palette lookup:

```text
output_color = palette[effect_id](animation_phase)
```

This is not generally a transformation of the RGB color produced by Spectrum.
IDs 64-67 being consecutive also suggests a four-entry palette bank or enum,
although that has not been confirmed from firmware.

## Photo experiment (2026-09-06)

Two lamps displayed Spectrum in the Down direction. The top lamp remained on
the normal effect ID while the bottom lamp used each override. OpenCV detected
the two 5x20 LED grids and sampled the median RGB value inside each LED disc.

The normal/normal image showed very close top/bottom hue curves, making the
second lamp a useful comparison target despite camera white balance and LED
clipping.

### Source files and corrected assignment

| File | Bottom lamp |
| :-- | :-- |
| `IMG_20260906_114358.jpg` | Normal / ID 17 |
| `IMG_20260906_114404.jpg` | ID 15 |
| `IMG_20260906_114412.jpg` | ID 64 |
| `IMG_20260906_114419.jpg` | ID 65 |
| `IMG_20260906_114427.jpg` | ID 66 |
| `IMG_20260906_114434.jpg` | ID 67 |

The last three assignments differ from the initial handwritten description.
Their image contents and chronological filenames consistently place IDs 65,
66, and 67 in the order shown above.

## Measured palettes

Hex values below are camera-observed samples. They are useful as approximate
anchors, not exact firmware RGB constants; exposure, clipping, lamp response,
and white balance all affect them.

### ID 15 - Monochrome ramp

Representative progression:

```text
#0C0C0E -> #8BB2B3 -> #A7D9DD -> #B6DBE1 -> #BCDFE3
```

The output rises from near-black to a cool/cyan-tinted white and then remains
near maximum brightness. It is not a conventional grayscale conversion of the
normal Spectrum RGB values: measured output brightness had approximately zero
correlation (`r = -0.001`) with standard linear sRGB luminance. The cyan cast
may partly come from the lamp and camera white balance.

Current classification: a black-to-white phase palette, not desaturation or
luminance extraction.

### ID 64 - Warm-to-cool spectrum

Representative progression:

```text
#F50720 -> #D6E520 -> #53FB18 -> #0CF38C -> #18E5FF -> #1F6CFF
red       yellow     green      cyan       cyan-blue   blue
```

Saturation remains high. The observed hue span is about 225 degrees compared
with about 300 degrees for normal Spectrum over the same panel. It can be
approximated as a positive hue compression (roughly 75 percent of the normal
span), but is more safely modeled as a red-yellow-green-cyan-blue palette.

### ID 65 - Cool white to ember

Representative progression:

```text
#BCE9DF -> #DCE1CB -> #F2B688 -> #FA6748 -> #F03F3A -> #EE5028
cool white  cream      peach      orange     red-orange  orange-red
```

This palette deliberately changes saturation from nearly neutral to strongly
saturated. It therefore cannot be represented by a global hue rotation.

Current classification: a sequential cool-white-to-ember gradient.

### ID 66 - Cyan to yellow

Representative progression:

```text
#19F8FF -> #15F2FF -> #0FF9A1 -> #3FF211 -> #AFE618 -> #E3E22A
cyan       cyan        cyan-green green      lime        yellow
```

Saturation stays high while hue runs backward by about 120 degrees. This can
be approximated as a reversed and compressed hue arc with an offset.

Current classification: a high-saturation cyan-green-yellow palette.

### ID 67 - Violet through white to gold

Representative progression:

```text
#43BEFF -> #6794FF -> #8190FF -> #A58FFF -> near-white -> #D3C780 -> #E7D03A
blue       blue-violet violet     purple                 pale gold   gold
```

Saturation falls toward a near-white midpoint and rises again on the warm
side. Hue is undefined around that neutral midpoint, so this cannot be modeled
as a continuous hue shift.

Current classification: a diverging blue/violet-white-yellow/gold palette.

## Conclusions

- The overrides preserve Spectrum's spatial phase and animation structure.
- They are best treated as fixed firmware palettes selected by the outer
  command ID.
- ID 64 is approximately a forward hue compression.
- ID 66 is approximately a reversed hue compression with an offset.
- IDs 15, 65, and 67 also reshape saturation and/or brightness and are not
  simple hue operations.
- A generic 3x3 RGB matrix or global HSV shift is not sufficient to reproduce
  all five variants.

Suggested UI labels are:

| ID | Descriptive label |
| :-- | :-- |
| 15 | Monochrome Ramp |
| 64 | Warm-to-Cool Spectrum |
| 65 | Cool White to Ember |
| 66 | Cyan to Yellow |
| 67 | Violet to Gold |

## Evidence still needed

The photographs cover only one instant and approximately 300 degrees of the
normal Spectrum phase. To recover each complete palette later:

1. Record both lamps together for at least one complete cycle.
2. Keep the top lamp on normal Spectrum and put one override on the bottom.
3. Use identical speed/direction and a fixed camera position.
4. Lock exposure, ISO, focus, and white balance; disable HDR.
5. Prefer 60 fps and record 10-20 seconds for each ID.
6. Repeat for IDs 15 and 64-67.

Frame analysis can then determine palette wrap behavior, exact stops, phase
offsets, and whether interpolation occurs in RGB, HSV, or another color space.

For a separate transform-vs-palette test, use a renderer that accepts a static
input color and repeat each override with red, green, blue, white, and black.
If the output ignores the selected input colors, the IDs conclusively select
fixed palettes. If output changes consistently with them, fit an RGB/HSV
transform instead.