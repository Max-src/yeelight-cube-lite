# Native Effect Color Override Research

> [!NOTE]
> This document records experimental Cube Lite firmware behavior observed on
> real lamps. The names used for command IDs 15 and 64-67 are descriptive and
> are not official Yeelight names.

## Rainbow video measurements - 2026-09-14

These results apply to **Rainbow clocks only**. The upper lamp uses the selected
mode; the lower lamp remains on normal Rainbow. This is the reverse of the
older Spectrum photographs described below. No firmware palette constants have
been extracted: the implementation is a camera-grounded visual approximation.

### Recordings and coverage

| Recording | Frames decoded | Frames paired | LED pairs | Reset fit RMS, frames |
| :-- | --: | --: | --: | --: |
| `VID_20260914_103251-normal.mp4` | 130 | 126 | 4,762 | 0.482 |
| `VID_20260914_103303-b&w.mp4` | 167 | 167 | 6,216 | 0.519 |
| `VID_20260914_103316-blue-red.mp4` | 216 | 195 | 6,882 | 0.408 |
| `VID_20260914_103329-white-orange.mp4` | 218 | 214 | 8,330 | 0.490 |
| `VID_20260914_103343-blue-yellow.mp4` | 196 | 196 | 7,692 | 0.470 |
| `VID_20260914_103355-purple-orange.mp4` | 196 | 196 | 7,496 | 0.466 |

All **1,123 frames** decoded, approximately 30 fps. Geometric pairing accepted
1,094 frames and 41,378 LED pairs. Rejected frames were still decoded and
examined by the detector; they are not silently counted as usable measurements.

### Method

The reproducible probe is [debug_rainbow_palettes.py](../debug_rainbow_palettes.py).
It requires OpenCV and NumPy in the interpreter used to run it:

```powershell
python debug_rainbow_palettes.py C:\Users\Maxime\Downloads C:\Users\Maxime\Downloads\rainbow-analysis
```

It writes per-frame positions and centre/edge RGB samples to `samples.json`,
phase-binned medians and fit parameters to `curves.json`, midpoint detection
images, and `time-strips.jpg`. Use `--summarize` to repeat fitting without decoding.
The recordings and generated diagnostic files remain outside the repository.

1. Detect bright connected LED regions and group them into ten rows, five per
  lamp. Pair corresponding rows by normalized horizontal position. Skip
  ambiguous geometry rather than assigning colours to unrelated glyph pixels.
2. Sample median RGB at LED centres. For B&W, also recover missing dark top-row
  LED positions from the lower lamp's geometry. Other dark/missing samples
  remain excluded; this is not a complete radiometric measurement.
3. Track the lower lamp's abrupt red-to-magenta resets independently by column.
  Fit a common period and spatial phase step. Periods are 74-75 frames
  (about 2.5 seconds), and column steps are 0.0472-0.0479 cycles. Reset residuals
  are approximately half a frame. This verifies repeatable phase structure,
  but does not prove perfect upper/lower synchronization.
4. Bin upper-lamp samples by recovered lower-lamp phase in 0.05-cycle intervals.
  Normal blue/cyan centres are heavily clipped, so hue-only pairing cannot
  recover the middle of the cycle. Temporal phase remains usable there.
5. For coloured modes, estimate chromaticity from less-exposed pixels around
  each LED (maximum channel 70-200), normalize each sample to a maximum of 255,
  and take median RGB. These edges recover the blue hidden in clipped centres.
  They still include camera response, optical bloom, and ambient-light bias.

Phase increases from the normal palette's red end toward its magenta end;
time runs in the opposite direction in these recordings. Palettes reset
abruptly: the preview must not interpolate from the final stop back to the first.
Direction and speed remain controlled by the existing Rainbow renderer.

### Findings and labels

| Key / outer ID | Display label | Observed progression as phase increases |
| :-- | :-- | :-- |
| `normal` / unchanged | Normal | Existing full Rainbow, unchanged |
| `bw` / 15 | Black & White | Dim neutral to white, with a bright plateau and hard reset |
| `red_blue` / 64 | Vivid | Red, orange, yellow, green, cyan, blue; not a red/blue duotone |
| `white_orange` / 65 | Retro Orange | Cool white, cream, peach, coral, red, slight warm rebound |
| `blue_yellow` / 66 | Tropical | Blue-cyan, cyan, green, lime, pale yellow; not two alternating colours |
| `purple_orange` / 67 | Violet & Gold | Blue/violet, pale lavender near-white transition, pale gold |

> [!NOTE]
> The `white_orange` (Retro Orange) and `purple_orange` (Violet & Gold) preview
> palettes were subsequently hand-tuned toward the operator's description of the
> real lamp — warmer amber/orange for Retro Orange, and more saturated violet and
> richer gold with less white for Violet & Gold. Those two previews therefore
> deviate from the raw camera edge samples, whose whites/reds were pushed by
> white balance and highlight clipping. The phase structure and reset are kept.

Representative **normalized edge RGB**, rounded to integers:

| Phase | ID 64 | ID 65 | ID 66 | ID 67 |
| --: | :-- | :-- | :-- | :-- |
| 0.025 | 255, 0, 65 | 197, 252, 243 | 39, 165, 255 | 45, 89, 255 |
| 0.225 | 188, 255, 95 | 255, 235, 217 | 36, 237, 255 | 46, 66, 255 |
| 0.425 | 54, 255, 71 | 255, 126, 111 | 27, 255, 149 | 62, 69, 255 |
| 0.625 | 23, 255, 182 | 255, 32, 52 | 53, 255, 45 | 103, 97, 255 |
| 0.775 | 28, 147, 255 | 255, 3, 41 | 119, 255, 58 | 255, 248, 191 |
| 0.975 | 28, 61, 255 | 255, 31, 44 | 230, 255, 111 | 255, 223, 132 |

B&W is **not max-channel desaturation**: normal Rainbow's constant HSV value
would produce a flat white frame, whereas the recording has a moving dim band.
The lowest samples near reset reach roughly 20-24 per channel, but that boundary
is sparsely sampled and threshold-biased. Its reset is about 0.025 cycle from
the lower lamp's reset. The preview aligns its own reset to phase zero, uses a
neutral minimum of 24, then levels 126/174/203/214/228/252/255 at phases
0.02/0.05/0.10/0.20/0.40/0.60/0.65. This removes the camera's cool/green tint;
the exact minimum and sub-frame transition are estimates, not firmware facts.

Mean absolute channel differences against samples, excluding lower-lamp phases
outside 0.08-0.94, are 3.22 (B&W), 10.13 (64), 9.38 (65), 7.77 (66), and 5.54 (67),
on a 0-255 scale. B&W compares against centre green with the 0.025 phase alignment;
coloured modes compare against normalized edge RGB. These are **in-sample
descriptive errors**, not held-out accuracy or colourimetric calibration.

### Preview scope and verification

Both native-effect renderers use the same piecewise RGB phase stops for Rainbow.
Intermediate channels use half-up rounding with a 1e-9 tolerance for binary
floating-point midpoint differences. End stops are held until the hard reset.
All five modes take precedence over custom colour overrides. Normal Rainbow,
its direction mapping and timing, other effects, and transport IDs are unchanged.
The new names are display-only; saved configurations keep their original keys.

The focused tests cover all modes and directions, negative/positive phases,
custom-colour precedence, brightness variation, channel bounds, and Python/JS
parity across 640 frames (192,000 channels):

```powershell
python -m unittest discover -s tests -p test_native_features.py -k test_rainbow_palette
```

The earlier Spectrum findings below remain separate evidence. Do not apply
Rainbow's fitted stops to other effects without measuring those effects.

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