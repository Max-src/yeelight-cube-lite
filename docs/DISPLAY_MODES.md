[Back to the README](../README.md#display-modes)

# Display modes in detail

The built-in pixel art, the lamp's clock, its native effects (with the
animations and the Palette color mode) and Music Flow. The content modes and
Matrix display modes are listed in the README's
[Display Modes](../README.md#display-modes); the actions are in
[SERVICES.md](../SERVICES.md), and the Clock and Native Effects cards'
options, favourites and rotation in
[Clock and Native Effects Cards](../SERVICES.md#clock-and-native-effects-cards).

## Built-in Pixel Art

The integration includes 68 official drawings from the Yeelight app as
local, read-only presets, in two collections: **Nature** and **Geometry** (35
drawn for a lamp lying flat, 33 for a lamp stood on its end). They are never
imported into, written to, or allowed to overwrite your own drawings.

- **Pixel Art entity:** your drawings first, then the official ones.
- **Draw card:** the drawings in groups, **All · My drawings · Nature ·
  Geometry**, shown as tabs by default; the editor offers the same layouts as
  the color sections (dropdown, carousel, side by side, categories…). Picking
  an official drawing loads it into the canvas like one of yours (and sends it
  to the lamp with *Apply to lamp automatically*); save it to make your own
  editable copy.
- **On each card**, the editor's **Official pixel arts** settings choose
  which official drawings show: all of them by default, or exactly the ones
  listed (with their order and names on that card). Your own drawings are
  still renamed and deleted in the gallery.
- **Orientation filter**: a toggle beside the search field (All ·
  Horizontal · Vertical) shows your drawings and the official ones by
  orientation, the same in every group; the browser remembers the choice.
  The editor's **Orientation** settings pick what shows first (or *Follow
  the lamp*: the vertical ones while it stands on its end) and can hide the
  toggle.
- **[`apply_pixel_art`](../SERVICES.md#apply_pixel_art)** shows one by name
  (e.g. `Built-in: Horizontal 01`).

## Native Clock

Clock mode provides 73 styles (the lamp's 10 built-in ones and experimental
styles over the other effects) and separate options for date
display, 12/24-hour time, and colon blinking. Brightness and orientation
previews remain available while Clock mode is active. Time/date content,
clock format and the saved clock-style library are clock-only. The style
names are listed under
[`set_clock_style`](../SERVICES.md#set_clock_style).

The clock command uses the Cube Lite's private LAN protocol. The lamp does
not report the active clock configuration back to Home Assistant, so entity
states represent the last settings requested by this integration. Changes made
from the Yeelight app or physical button may therefore not appear immediately in
Home Assistant (without Matter; with it, a switch to another effect or a music
mode is followed). An animated clock's preview runs the lamp's own background
at the speed the lamp gets; a solid style's color is an approximation.

## Native Effects

Native Effect mode exposes the 18 presets that the Cube Lite accepts directly
through its private LAN protocol. Speed and direction entities are available
only when the selected effect supports them. **Hacking** supports only **Up**
and **Down**; other directional effects may also offer **Left** and **Right**.
A direction is what you see, however the lamp is mounted: choose it with the
arrows on the Native Effects card, the direction entity or `set_native_effect`.
One direction is shared by all effects, like the speed; **Device Orientation**
only says how the lamp is mounted, and effects are turned to match.
Winter, Dream, Halloween, and Moonlight are not exposed because the Yeelight app
uploads a GIF through a Matter-only vendor command before activation; the
private LAN protocol cannot reproduce that transaction (the integration's own
animations stand in for them, see below).

While Clock or Native Effect mode is active, Home Assistant keeps the last
settings requested by the integration until another command is sent (see
[How the State Updates](../README.md#how-the-state-updates)). Brightness
remains available and is applied after activating the native renderer so it
does not cancel the selected clock or animation.

### Previews

The lamp does not provide live frame readback, so the Matrix Preview cameras
and the cards compute the picture themselves, with the lamp's own renderers:
every effect is drawn as the lamp draws it, frame by frame, for the speed,
direction, color and palette it was given, and shown as those LEDs look on a
screen. Random effects (Fireworks, Starry Sky, ...) use stand-in random numbers,
so a preview shows the same kind of picture, not the same sparks at the same
moment. Effects that react to sound run on a fixed demo beat, because nothing can
hear the lamp's microphone: the preview shows how the effect moves, not what the
lamp shows now. Native previews and camera previews use the existing shared
palette renderers.

### Stored GIF and animations

A lamp keeps one GIF and plays it as the
**Stored GIF** effect, over LAN, without Matter. The cards and the effect
dropdown do not list it (the four animations below are chosen instead), but
`set_native_effect` and the dropdown's `select_option` still take it by name,
and it shows while it plays. Its picture cannot be read back,
so its preview is a placeholder unless the GIF is one of the integration's
animations. Snowfall is in the Sparkles family, Daydream in Waves, Halloween
glow and Moonlit clouds in Glow. Four animations come with the integration, drawn for it: **Snowfall**,
**Daydream**, **Halloween glow** and **Moonlit clouds**. Starting one uploads
it to the lamp as its stored GIF, then plays it. The upload needs a Matter
server that delivers the Yeelight commands
([docs/MATTER_COMMANDS.md](MATTER_COMMANDS.md)): without one, the
animations are not listed. The lamp writes the GIF to its memory, so the
integration uploads only when the lamp does not hold that animation yet (it
remembers which one it stored, for which mount, speed and colors). The lamp
plays a GIF at its own pace and in its own colors, so the **effect speed**
(about a quarter to four times as fast) and the Lamp Preview card's **color
adjustments** are put in the GIF itself: changing one while an animation
plays uploads it again, which takes a few seconds; the previews show them at
once. Each animation stands for one
of the Yeelight app's four: Snowfall for Winter, Daydream for Dream, Halloween
glow for Halloween and Moonlit clouds for Moonlight. It is played under that
animation's id, so the app shows it as the one playing (Stored GIF too, while
the lamp holds one of them). The lamp shows the Yeelight app's own GIFs
rearranged: the app sends a 20 × 5 picture, which the lamp lays out five
pixels to a column. The integration sends its animations upright by default;
the **Native effect: Animation layout** select sends them the app's way
instead, so they look like the app's on the lamp. The previews follow it, and
changing it uploads a playing animation again. The Yeelight app
replaces the stored GIF when it plays one of its own. Effect rotations skip the
animations, which would upload a GIF at every step.

### Effect names

Effect names are the lamp's own. An effect's or clock style's name from
1.4.0 or earlier (Streamer, Ocean Waves, Bonfire, Sunset, Blue White, a slot
number, ...) still works in actions, automations, saved favourites, rotations,
button lists and card configurations; see
[`set_native_effect`](../SERVICES.md#set_native_effect) for the full list. The
lamp reports today's names: a trigger or condition comparing the effect or clock
style dropdown's state with an old name needs the new one.

### Color modes and Palette

The Native Effects Card offers only hardware-confirmed palettes for the
selected effect: Default, Black & White, Vivid, Retro Orange, Tropical, and
Violet & Gold where supported. Both the Clock and Native Effects cards
support custom RGB where the selected style or effect permits it.
`set_native_effect` accepts `color_mode`; this setting is independent of
clock colors and persists with the lamp state. An incompatible effect uses
its original colors. Restart Home Assistant after updating before using
this feature; an older backend does not expose the palette controls.

**Palette** shows effects and clock styles in the colors of the lamp's
palette, the one loaded from the Palette card (`load_palette`) or set with
`set_text_colors`, and follows it: load another palette and they change with
it. It is the one color mode for the palette, on the Native Effects card
(`color_mode: palette` in `set_native_effect`) and the Clock card (in
`set_clock_style`). Each effect gets the whole palette in the best way it
can:

| The effect | How Palette shows it | Needs |
| :-- | :-- | :-- |
| Takes all the palette's colors itself: the six music modes (Music Gather, Breathing, Blossom, Spectrum, Note, Impact: up to 16 colors), an effect drawing as many colors as the palette has (Rotating colour bands: 4, Two-colour alternation: 2...), any effect taking a color when the palette has one | **On the lamp**: the colors are sent with the effect, as always | LAN |
| Listens to the microphone (the music effects) | **On the lamp**, whatever it takes: the palette's colors it takes (the music modes all of them, the others the first), as the room is heard only there | LAN |
| Any other effect: more palette colors than it takes, or none at all (Rainbow, Fire, Starry Sky, Hacking...) | **Streamed**: Home Assistant draws the effect as the lamp would, in the whole palette, and sends it 25 times a second (the lamp's own pace), like a drawing | LAN over UDP |
| An animation (Snowfall, Daydream, Halloween glow, Moonlit clouds) | **Its GIF recolored**, stored and played by the lamp, in the layout chosen (upright or as the Yeelight app), uploaded again when the palette changes | Matter, as every animation |
| A clock style over an effect the lamp cannot show in the whole palette | **Streamed**: the background recolored, shown through the digits for the current time, as the lamp's clock does | LAN over UDP |
| A plain clock style | **On the lamp**, in the palette's first color | LAN |

Streaming needs no Matter: only the animations do (their GIF is uploaded over
Matter, see [Matter commands](MATTER_COMMANDS.md)). Without Matter, every
effect but the animations still takes the whole palette. A streamed effect
needs the lamp reachable over UDP (it holds its last frame while the
connection falls back to TCP; a network blocking UDP is reported in Repairs),
keeps Home Assistant a little busy while it runs, and starts from its
beginning (Building Blocks on an empty panel). Speed, direction, intensity,
Lamp mounted, favourites, rotation and Freeze work as for any effect.

In a streamed effect the colors move with it: an effect whose picture is in
its colors (Rainbow, Magic, Wonderland...) maps them onto the palette; a field
of light (Waves, Aurora, Fire, Sunrise and sunset...) takes them by the
brightness around each pixel, followed smoothly (no pixel flickers between
colors), the brightest the palette's first color; separate dots and shapes
(Starry Sky, Building Blocks, Hacking's digits...) each keep one color for as
long as they are lit; White fill-in and wipe-out take the first color. The
music modes run in the direction chosen when a Matter server sends Yeelight
commands to the lamp, otherwise in the lamp's own.

No custom native-effect preset library is introduced.

## Music Flow

How to start and stop it is in the README's
[Music Flow](../README.md#music-flow).

Selecting **Music Flow** in the **Content mode** selector starts the
lamp's microphone-reactive renderer locally on the device. **Music Flow
Effect** selects one of the six official modes: Gather, Breathing, Blossom,
Spectrum, Music Note, or Impact.

Music Flow behaves as an overlay on top of the underlying content. The
integration remembers the previous Matrix, Clock, or Native Effect content and
returns to it when Music Flow stops. The selected effect can be changed while
Music Flow is inactive and will be used the next time it starts.

The integration also preserves the lamp's previous power state:

- If the lamp was on, stopping Music Flow restores the previous display.
- If the lamp was off, stopping Music Flow turns the lamp off again.
- If Home Assistant restarts while Music Flow is active, the Music Flow content
  mode, effect, and prior power state are restored from per-device integration
  storage.
- If the Music Flow stop command succeeds but redrawing the previous display
  fails, Home Assistant still records Music Flow as off. Reselect a content
  mode or use **Force Refresh** to retry the display render.

The hourly clock check is skipped while Music Flow is active, because opening
another control connection can interrupt the lamp's renderer.
Selecting Matrix, Clock, Native Effect, text, or pixel art is treated as an
explicit content change and stops Music Flow first.

Both Matrix Preview cameras show a deterministic static illustration for the
selected effect. These are locally generated 20x5 identifiers, not live frames
from the lamp:

| Music Flow Effect | Static preview cue |
| :-- | :-- |
| Gather | Multicolor bands converging on the center |
| Breathing | Purple-pink center glow |
| Blossom | Three flower shapes |
| Spectrum | Rainbow equalizer bars |
| Music Note | Musical-note glyph |
| Impact | Center burst |

Round and Square previews use the same RGB pixels and differ only in pixel
shape. Brightness and device orientation are applied locally. Generating or
viewing a preview sends no command to the lamp.

> [!NOTE]
> The lamp does not expose live microphone-animation frames. Changes made
> from another app while Music Flow is active may not be reflected in Home
> Assistant until Music Flow stops or another HA command runs. With the Matter
> link, a music mode started or stopped on the lamp or in the app is followed.

```yaml
sequence:
  - action: select.select_option
    target:
      entity_id: select.my_cube_music_flow_effect
    data:
      option: Spectrum
  - action: select.select_option
    target:
      entity_id: select.my_cube_content_mode
    data:
      option: Music Flow
  - delay: "00:00:30"
  # Selecting another content mode stops Music Flow
  - action: select.select_option
    target:
      entity_id: select.my_cube_content_mode
    data:
      option: Clock
```

Replace the example entity IDs with the **Music Flow effect** and **Content
mode** entities created for your Cube Lite. There is no separate Music Flow
switch: Music Flow starts and stops through Content mode.
