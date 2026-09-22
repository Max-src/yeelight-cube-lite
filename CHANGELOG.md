# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.2] - 2026-09-22

### Added
- **Native Effects Lovelace card** for controlling one or more lamps, with the
  same selector, action, slider, colour, orientation, favourites, and rotation
  controls as the Clock card.
- **Shared Clock and Native Effects controls**, including configurable Actions
  order, shared brightness and animation-speed sliders, and shared colour-mode
  controls.
- **Freeze display action** for compatible modes. It sends a freeze frame and
  resumes by reapplying the current mode; previews hold their background while
  frozen.
- **Server-side favourites and rotation** for clock modes and native effects.
  Rotation follows the favourites list, survives a dashboard refresh, and can
  be started, stopped, or skipped. Starting rotation on several lamps no longer
  waits for one lamp before starting the next.
- **Saved custom colour-mode presets**, including native custom RGB, with a
  unified colour row and inline save flow.
- **Shared Original effect browser** for both cards, with Grid and List display,
  capability badges, live matrix previews, and favourite stars.
- **Configurable device orientation controls**, including direction order,
  visibility, rotation, and flip.
- **Strip preview mode** and a shared slider Control Width setting.
- **Clock-style filtering** based on whether a style responds to the active
  colour mode.

### Changed
- Clock and Native Effects cards now share one selector configuration. The same
  setting uses the same control, range, and default in both editors.
- Original and Live Preview now share gallery appearance settings and one
  Items Per Page control. Paging applies to Original and Live Preview List;
  `0` disables it.
- Text selectors are now Filled or Dropdown. Chips, Buttons, and the old
  Original dropdown were removed.
- Experimental effects and styles follow each lamp's Experimental Features
  switch instead of a separate card toggle.
- Clock previews now use the calibrated clock-background direction rather than
  the native-effect direction.
- Favourite stars are shown inline beside item names, with a larger star in
  live-preview modes and an editor toggle to hide them.
- Sliders accept both vertical and horizontal mouse-wheel input.

### Fixed
- Native effect previews now follow the calibrated direction, speed, and colour
  state, including brightness-only updates and frozen playback.
- Clock colour overrides now recolour compatible native effects and persist
  correctly, including solid black-and-white fallbacks and measured palette
  previews.
- Fixed colour-picker opening and anchoring, clock preview ghost pixels, and
  the shared slider speed-value mismatch.
- Cards render a placeholder instead of a permanent Configuration error when no
  entity is available yet.
- Fixed duplicate editor section IDs and retained visibility settings when
  experimental items are unavailable.
- Rotation now reports hardware and start failures, avoids stopping an active
  rotation merely because a card is observing it, and surfaces an error state.

## [1.3.1] - 2026-09-10

### Added
- **Many new experimental native effects**, each with a matching software
  preview (camera + Lovelace cards) and, where applicable, a clock style:
  Blue Yellow, Ice Blue, Carousel (mode 56), Spectrum Crumble (mode 60),
  Spectrum Chase (mode 6), Pastel Pulse (mode 9), Ember (mode 24),
  Twinkle (mode 79), Solar Flare, Fireworks, Rainbow Flow, Pulse (mode 18),
  Spectrum Bands (mode 70), Color Trails (mode 35), Monochrome Waves (mode 11),
  Prism (mode 22), and Drift (a monochrome Aurora).

### Changed
- Renamed the **speed** setting to **Animation speed** and applied it to the
  clock as well.
- **Experimental dropdowns are now sorted** and the set of experimental clock
  styles was expanded.
- Widened clock-mixer effect coverage and aligned clock style names with their
  effects.

### Fixed
- Native effect animation no longer restarts on a brightness-only change.
- Removed clock styles that the firmware rejects.
- Fixed clock-mixer default color inheritance.
- Fixed lamp IP rediscovery.
- Enabled speed control for the Spectrum native effect.
- Corrected native-effect preview orientation.
- Fixed hassfest YAML validation by using a block scalar for the kwargs
  description.

## [1.3.0] - 2026-08-28

### Added
- **Experimental Features switch**: reveals firmware-native animation modes that
  the official Yeelight app never exposed. Off by default.
- **"Blue White" native effect** (firmware mode 59) as the first experimental
  effect, with a software preview: a white front is born at a slowly wandering
  source, travels the mirrored column path, and lights up fully white where it
  meets its reflection at the fold. It renders identically for every direction,
  matching the hardware.
- **Clock style "Blue White Fade"**: the clock now animates the Blue White
  effect masked to the lit digit pixels (clock mixer 59).
- **Software previews for the remaining native effects** so the camera entity and
  Lovelace cards animate to match the lamp: Pinball, Shooting Star, Tide,
  Building block, Hacking, Flower Sea, Magic, Wonderland, Kaleidoscope, and
  Palette (all four arrow directions where the effect supports them).

### Changed
- **Kaleidoscope direction previews** now match the physical lamp. The four
  arrow presets were rotated 90° (Right→Up, Down→Right, Left→Down, Up→Left) so
  the on-screen arrow reflects what the lamp actually plays.
- Renamed the switch entity display name from "Extended Effects" to
  **"Experimental Features"** (internal id and stored state are unchanged, so
  existing installations keep their entity and setting).

### Fixed
- Corrected extended-effect lookups so selecting an experimental effect no longer
  raises a `KeyError`; activation, direction, and speed resolve through the merged
  effect registry.
- Fixed the FX Explorer mode table and clock-mixer detection.

### Performance
- Camera preview rendering (PNG encode and image decode/resize) now runs in the
  executor instead of the event loop.
- Reduced the camera frame interval to 0.3 s and shrank the preview image for
  smoother updates at lower cost.

### Compatibility
- Raised the minimum Home Assistant version to **2024.12.0**. The config flow
  imports `ZeroconfServiceInfo` from `homeassistant.helpers.service_info.zeroconf`,
  which only exists from 2024.12; the previous floor of 2024.1.0 let HACS offer the
  integration to installs where setup would fail. This bump also covers the
  `async_register_static_paths` (2024.7) and no-argument options-flow (2024.11)
  APIs already in use.

### Removed
- Dropped `Pillow` from `manifest.json` requirements; it ships with Home Assistant
  core, so declaring it could conflict with core's own pin.
- Removed `brand/logo.png` and `brand/logo@2x.png`, which were byte-identical
  copies of the icon images (~236 KB of duplicate payload per install).
