# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **The music effects hear the lamp's microphone again:** after a drawing, text
  or picture (anything shown pixel by pixel), the lamp keeps a flag
  that makes a music effect switch the microphone off instead of on, until it
  is told to leave that mode, which Home Assistant never did. Music effects,
  clocks over them and Music Flow did not react to sound. The integration now
  clears that flag first, as the Yeelight app does. The lamp may show its last
  app effect for a split second before the music effect starts. That brief
  effect, and the microphone switching on and off, are no longer taken for a
  button or another app: a rotation goes on past a music effect, and the Lamp
  buttons event no longer reports `effect_changed` or `music_off` for them.
- **Freeze works on Building Blocks:** a misspelled name left it disabled.
- **Choosing an effect's direction no longer changes the lamp's orientation:**
  the two were one setting, so a direction also turned your previews, drawings
  and text, and the next effect put the direction back. A direction is now what
  you see, on any mount, and stays until you change it. The Native Effects card
  has its own arrows for it, and `set_native_effect` a `direction` field. An
  existing lamp starts on Right, the direction it ran.
- **Effects on a lamp standing on its end ran backwards:** Aurora, Flower Sea,
  Palette, Tide and the effects that had only a number flowed the opposite way on a
  Down or Up mount, unlike the others. They now flow the same for every mount.
- **The physical button's list** now uses the direction shown, turned for the
  mount, like an effect started from Home Assistant.
- **The Palette sparks clock (formerly Ember) no longer goes almost black:**
  after Palette sparks or a Palette sparks clock had run, including after
  changing the clock's speed, the clock came back with a handful of sparks or
  none, and stayed that way. The clock over Palette sparks, and over 66, 69 and
  72, which stayed black, now starts its background properly. If your physical
  button's list holds a Palette sparks clock, save the list again so the lamp
  stores the new command.

### Added
- **Sort the effect and clock galleries:** a toggle beside the family filter
  sorts them by default order, A → Z or by family. Each browser remembers its
  choice, per card; the editor's Order applies until one is picked, and its new
  Sort toggle option hides it.
- **Both cards list effects in the same order:** unless the card editor sets
  your own list, the clock card now lists its styles over an effect in the
  effect card's order (the official effects as the Yeelight app lists them,
  then the others), then the plain colours and your custom styles.
  Kaleidoscope, for example, was last on the clock card; it is now 17th among
  its effect styles, as on the effect card. The effect card without a lamp uses
  that order too.
- **The cards list every effect and clock style:** the 33 experimental effects
  that had only a number up to 1.4.0 (Breathing, Dual scan, the music effects,
  Stored GIF, ...) were only in the effect dropdown. The Native Effects and
  Clock cards now list them and the clock styles over them, with a preview,
  a category, favourites, rotation and custom colors, like the other
  experimental effects: 70 effects and 72 clock styles in all with
  Experimental Features on. Stored GIF, which plays the GIF kept in the lamp,
  is not listed yet: nothing can read it back to preview, and the effect and
  clock style dropdowns still offer it. Which of them take
  a custom color, B&W or a palette was not checked
  on a lamp yet. A clock over one of them now takes the clock's
  palette like any other, except over the five that draw their own colors,
  which keep them. Two-colour alternation, Rotating colour bands, Scrolling
  bands and Rising wisps move, and are no longer filed under Still.
- **Custom color on Meteor and Building Blocks**, as in the Yeelight app.
- **Colors on the experimental effects that draw them:** Two-colour
  alternation, Rotating colour bands, Scrolling bands, Rising wisps and Random
  scatter showed plain white, because they draw the colors they are sent and
  were sent none. They now get the lamp's default colors (orange-red
  and blue, four bands, four scattered colors), and a custom color replaces
  the first. The same goes for the experimental clock styles over them, in
  Home Assistant, in the physical button's list and in every preview: their
  digits showed white too. A custom clock color replaces the first color;
  B&W still shows them white.
- **The raw debug actions refuse every input known to hang or restart a lamp:**
  besides slots and speeds, presets 41 and 43, low intensity on Aurora and Spectrum
  Bands, drawings of the wrong size, and the limits of partial segments, for the
  lamp's own mount profile, counting what the command takes from its preset. They
  also check live updates and the button list, and refuse values that cannot be
  judged. Anything else still goes through.
- **Effect families:** the Native Effects and Clock cards can filter their
  gallery by family (Waves, Glow, Sparkles, Motion, Music, Still), with a toggle
  beside the search field. A clock style has the family of its effect; solid
  colors and custom styles are under Still. A card offers the families it has,
  next and previous follow the filter, and this browser remembers each kind of
  card's choice. The editor can hide it.

### Changed
- **Every effect has the lamp's own name:** the effects, and the clock
  styles named after them, now carry the names the lamp gives
  them (an effect the Yeelight app sends as a preset takes its preset
  name), and the 33 experimental effects that had only a number have a name too.
  The renaming changes nothing else: clock style ids stay the same, and what
  each effect sends and shows changes only as listed below (speed, direction
  and colors). The renamed official effects: Streamer is now **Ribbon**, Starry
  sky **Starry Sky**, Ocean Waves **Waves**, Bonfire **Fire**, Pinball
  **Bouncing Ball**, Shooting Star **Meteor** and Building block **Building
  Blocks**. The experimental ones: Rainbow Flow is **Moving palette**, Spectrum
  Chase **Particle path**, Pastel Pulse **Triangular palette pulses**,
  Monochrome Waves **Sine wave**, Pulse **Sunrise and sunset**, Solar Flare
  **Heat fire**, Prism **Mirrored comets**, Ember **Palette sparks**, Color
  Trails **Tide (slot 35)**, Sunset **Rainbow noise**, Carousel **Violet
  interference**, Blue Yellow **Night-amber waves**, Ice Blue **Navy-white
  noise**, Blue White **Night-sky waves**, Spectrum Crumble **Flicker sweep**,
  Drift **Particle glows**, Spectrum Bands **Palette stripes** and Twinkle
  **Violet twinkles**; the numbered ones are listed
  under `set_native_effect` in SERVICES.md (e.g. 2 is **Breathing**, 73
  **Music Note**, 71 **Stored GIF**). The clock styles Ocean Waves, Sunset,
  Blue Yellow, Blue White, Ice Blue and Carousel are now Waves, Rainbow noise,
  Night-amber waves, Night-sky waves, Navy-white noise and Violet interference.
  **The old names keep working:** an action, an automation or a script that
  names an effect or a clock style the old way (or a numbered effect by its
  number), a dropdown choice, a lamp's saved state, favourites, rotation and
  physical-button list, and a card's visible and hidden items and labels are
  all read as today's names, and saved back under them. What the lamp reports
  is in today's names: a trigger or condition that compares the effect or clock
  style dropdown's state, or the light's `native_effect` attribute, with an old
  name needs the new one. The Music Flow effects
  keep their own names, a separate list (Breathing there is not the native
  Breathing).
- **No speed or direction where the lamp ignores it:** 17 more
  experimental effects have no speed, because the lamp never reads
  it for them: Palette sparks, Rainbow noise, Violet interference, Navy-white
  noise, Night-sky waves, Rising wisps, Random scatter, Music Note, Music level
  glow, Music bass-mid-treble colour, Sine plotter, Music Breathing, Solid red
  and the four one-shot wipes. And 11 more have no direction, because the
  lamp reads none for them, or only uses it on part of the panel, or only
  to move where a random scatter falls: Night-amber waves, Night-sky waves,
  Two-colour alternation, Breathing, Music level glow, Music bass-mid-treble
  colour, Palette cross-fade, Music Breathing, Solid red, Centre bursts and
  Random scatter. The lamp looks the same. A `set_native_effect` call giving
  one of them a speed, or a direction, is now refused, as for Spectrum: remove
  it from the automation.
- **Default speed:** a lamp that has no saved speed now starts at 128, the speed
  the Yeelight app's effects run at, not 50. A lamp that already has a saved
  speed keeps it.
- **Effects with no direction follow the lamp's saved orientation:** Starry Sky,
  Bouncing Ball, Magic, Wonderland and Neon sine bands were drawn turned on a lamp saved at
  another orientation in the Yeelight app, unlike their previews. They now match.
- **Every effect's preview is now the lamp's own:** the 70 effects that can be
  drawn, curated or named after a number until now, are drawn as the lamp draws
  them, frame by frame, in the cameras, every card and the clock
  backgrounds. They replace the approximations made by eye, so the previews
  look different, are brighter, and match the lamp, in every direction, at
  every speed, with the color or palette it was given. Random effects (Fireworks,
  Starry Sky, ...) use stand-in random numbers: the same kind of picture, not
  the same sparks at the same moment. The effects that react to sound run on a
  fixed demo beat, since nothing can hear the lamp's microphone: they show how
  the effect moves, not what the lamp shows now. Only effect 71, Stored GIF, the GIF stored
  in the lamp, has no real preview: nothing can read that picture back.
- **Previews never start blank:** an effect that starts dark on the lamp (Sunrise
  and sunset, Mirrored comets, Building Blocks, Particle glows) is shown from its first lit moment, so a gallery
  tile, a frozen card or a clock's digits are not empty.
- **The estimated power follows the lamp too:** it now comes from the
  lamp's own values for every named effect and animated clock, so the
  reading may change. The screen's brighter colors are for display only.
- **Previews move as on the lamp:** all named effects now show every render, 25 a
  second instead of about 10, and a large gallery stays light on the browser.
  A camera in a `camera_view: live` card streams them the same way (about 3
  frames a second before), encoding only the frames that changed, as a smaller
  409 x 124 image while the stream is open, and slows down rather than load a
  slow host: about a third of a core per camera at most. With
  `camera_view: auto`, Home Assistant still fetches one full-size picture every
  10 seconds.
- **Clocks and previews use the real speed:** an animated clock's background
  now runs at the speed the lamp gets, not a fixed one, and the camera and the
  Preview card follow speeds above 100 up to 255.
- **Previews look like the LEDs:** the cards and the cameras show the
  lamp's LED values as those LEDs look on a screen, instead of painting them as
  they are, which looked much too dark.

- **Magic and Neon sine bands:** Magic now plays Magic: it was sending the
  slot of Neon sine bands, a hidden effect, now an experimental effect
  of its own. The experimental clock style that was called Magic is that
  same picture: it keeps its id and is now called Neon sine bands, and the
  clock style Magic runs the real Magic. A clock style saved as "Magic" in
  your favourites, a clock rotation or the physical button's list keeps the
  picture it had, under its new name; one named in a card's settings, in an
  automation, or in favourites kept by the browser, now means the real Magic.
  The effect Magic on the physical button's list: the lamp keeps playing the
  old picture until the list is saved again.
- **Tide has directions:** all four, as in the Yeelight app. Right, the default,
  keeps the picture Tide always showed here.
- **Spectrum has no speed:** the lamp's Spectrum is a still picture that
  never reads the speed, so the slider is gone.
  A `set_native_effect` call giving Spectrum a speed is now refused, as for
  other effects without one.

### Removed
- Experimental effects and clock styles above slot 81 (82 to 99), and
  the experimental effects 12, 13, 29 and 78. The lamp has no slot above 81
  and runs whatever comes next, which can crash the lamp from 90 up; the
  four others are empty and draw nothing. A lamp left on one of them comes back
  on the default effect or clock style.
- Experimental effects 36, 50, 53, 64 and 67, and the experimental clock styles
  12, 13, 29, 36, 50, 53, 64, 67 and 78. They showed nothing, or the last frame:
  pictures with no data, the pixel stream and empty slots. Other clock styles
  keep their ids, and a lamp left on one of these comes back on the default.
- The raw debug action `send_fx_effect` refuses a slot past 81, and a speed above
  a slot's limit, both of which crash the lamp.

### Fixed
- The physical button's playlist sends an effect's direction the way activating
  it does: effects with their own direction mapping (Fire, Rainbow and
  others) ran differently from the button than from Home Assistant.
- Experimental effects 28 and 51 stay under the speed that would crash them
  (254 and 239), as effects and as clock backgrounds.
- The Lamp Preview card no longer fades Fireworks' pixels: the 0.2 s fade could
  not keep up, so they showed old colors, partly see-through (pale on a white
  background, dim on black). Other pictures and effects keep the fade.
- After a power cut or a restart, a lamp Matter saw another app or a button
  change (a color, an effect) keeps what it restored itself instead of being
  redrawn with Home Assistant's content; the next command from Home Assistant
  takes it back.

## [1.4.0] - 2026-10-30

### Added
- **The lamp's orientation:** the lamp turns every native effect's direction
  by the orientation saved on it (the Yeelight app's orientation page, 0° to
  270°). The integration now knows it per lamp and sends each direction
  compensated for it, so effects move the same way on any lamp; the clock
  previews turn as the lamp turns its clock (0° and 90°). Set it in the lamp's
  **Configure** (**How is the lamp mounted?**), with an optional check on the
  lamp (shooting stars: which way do they fly? The answer is shown as the
  app's arrow before it is saved). Over Matter, an orientation
  saved in the app is read from the lamp (90°-270°, or 0° with the module
  layout the app's Save writes) and never overwritten; a lamp never saved
  (it reads 0° while running 270°) gets **Device Orientation** written once
  (with Matter settings). A lamp paired again after a factory reset is a new
  Matter node: checked again. Nodes a reset left behind (unavailable, with
  their old values) are ignored, and the development Matter server is read
  too when Home Assistant's has no live node. The light's `mount_profile`
  attribute shows the orientation and its source. Adding a lamp now asks
  how it is mounted (the arrow saved in the app, never set, a check on the
  lamp, or read over Matter); a lamp whose orientation is still unknown gets
  a Repairs message pointing to **Configure**. **Changed default:** a lamp
  whose orientation is not known now moves as for 270°, what the lamp
  runs when it was never saved or after a reset (earlier versions assumed
  180°: set it in **Configure** if you saved 180° in the app).
- **Matter link (optional):** a lamp also added to Home Assistant's Matter
  integration is linked automatically (by its IP address, then its MAC
  address), whichever was set up first. The lamp's buttons (the playlist
  effects, the microphone music modes and their long press), its power and
  brightness, and the effects and direction picked in the Yeelight app now
  show in Home Assistant (the clock previews turned as the lamp turns them
  with its orientation), and a
  Repairs message reports LAN Control turned off. Through Home Assistant's own
  Matter connection: Yeelight's Matter features are in Home Assistant's Matter
  Server from matterjs-server 1.5.4 (matter-js/matterjs-server#1203), with
  which **Device Orientation** also sets the lamp's own direction (its clock
  and native effects turned for the mount) and **Buttons: Right as Remote**
  can install its black playlist. With an older Matter Server the link is
  read-only (the light's `matter` attribute says why); lamps without Matter
  work as before.
  A **Lamp buttons** event entity fires when the lamp's buttons (or the
  Yeelight app) change an effect, its power or a microphone music mode, for
  automations (unavailable without the Matter link). **Buttons: Right as Remote** (with Matter settings) backs up the
  right button's playlist and makes it black, so a press fires
  `right_button`, blinks black and puts the integration's display back
  (music the lamp started gives way to what was shown before it, and a
  press brings it back even after another app's effect; after the Yeelight
  app's effect, colour, clock, animation or built-in pixel art, the press
  shows that again);
  turning it off writes the playlist back, and its `remote_status` attribute
  says what it is doing. **Buttons: Left as Remote** separately undoes
  microphone music started by the left button or an app. **Buttons: Wake
  Lamp When Off** (on by default) makes a remote press turn a lamp that is
  off on with its content; turned off, presses only fire their events and
  "off" keeps the lamp powered, black, so they are still seen. Power still
  switches either way. A **Matter link** diagnostic sensor shows the link,
  and a Cube Lite only in Matter is offered as discovered.
- An administrators' diagnostics action, **DEBUG: Use TCP** (`force_tcp`),
  sends a lamp's commands over its TCP fallback for some minutes, to test it.
- **Official pixel arts in the Draw card**: the 68 drawings of the Yeelight
  app show in the Draw card, in groups **All · My drawings · Nature ·
  Geometry** with the same layouts as the color sections (tabs by default;
  dropdown, carousel, categories…). An **orientation filter** beside the
  search field (All · Horizontal · Vertical, the same in every group,
  remembered in the browser) shows them by orientation; the editor picks
  what shows first, or follows the lamp's orientation (cards set up before
  keep the horizontal ones first). Picking one loads it into the drawing like
  your own. They are read-only: each card's editor chooses which ones show,
  their order and their names (**Official pixel arts**), and saving one makes
  your own editable copy.
- `apply_pixel_art` also takes a pixel art by **name**, a saved or an
  official one, instead of its index.
- `apply_custom_pixels` takes an optional **name**: the pixel art the pixels
  are, which the lamp's **Pixel Art** select then shows. The Draw card sends
  the one picked in its gallery.
- `tools/lamp-session.mjs`: scripted lamp sessions to watch (the TCP
  fallback, switches from the clock or an effect to a drawing, a long pause),
  each step announced with what the lamps should show.
- **Reconfigure** in a lamp's entry menu changes its IP address, after checking
  that the lamp answers there (a discovered lamp still follows a new IP on its
  own).
- **Repairs** (Settings → System → Repairs) for a lamp unreachable for over 30
  minutes, and for one stuck on its slower TCP connection because the network
  blocks UDP for over 15 minutes; each says what to check and goes away by
  itself.
- **Download diagnostics** for each lamp (its integration entry or its device
  page), to attach to a bug report: the lamp's model and software version, its
  connection (UDP or TCP, failures, the last errors), its settings and current
  state. Its IP address, identifier, Yeelight app name and displayed text are
  redacted.
- **Vertical previews**: while the lamp stands on one end (Device
  Orientation Down / Up), the Native Effects and Clock cards' previews and
  galleries stand up too, like the Lamp Preview card. **Vertical pixel arts**
  (the official ones drawn for a standing lamp, and your own) show standing
  up in the Draw card's gallery and Arrange list, whatever the lamp's
  orientation, as in the Yeelight app. Every layout gives them their own
  shape: in List, Grid, Mosaic and Original a vertical tile takes half a
  landscape tile's place, beside one, and tiles of different heights stack
  without gaps (packed tiles, `<yc-tile-grid>`); the Carousel's and Album's
  cards fit them, and the Wheel shows them tall.
- The Draw card's **Rotate** tool shows the drawing area landscape or
  vertical; a vertical pixel art opens vertical, and a drawing is saved with
  its orientation (`save_pixel_art` and `update_pixel_arts` take an optional
  `orientation`, `get_pixel_art` returns it). Image upload fills the area as
  shown, and can be undone.
- The shared gallery takes an optional **item filter** shown beside its
  search field (any card can declare one; the Draw card's orientation
  filter is the first).
- A **Mosaic** layout in every gallery (Draw, Palettes, Gradient, Clock,
  Native Effects): every tile at its preview's own size, as many per row as
  fit, centred and packed in your order. Highlight and items per page as in
  List and Grid.
- The Matrix Preview cameras draw the lamp like the Preview card: a black
  frame with rounded corners and a soft shadow on a transparent background,
  at 3x the resolution (1227 x 372 px), the round camera's dots
  anti-aliased: sharp at any dashboard size, the card's own background
  around it whatever its `fit_mode`. The README's new **Matrix Preview
  Cameras** section shows every Picture Entity card setting (natural size,
  fixed height, `fit_mode` contain / cover / fill) for a lamp lying flat and
  standing up, with generated screenshots.
  They render on demand, when an image is requested, from the lamp's latest
  frame: a camera nobody watches costs nothing (scrolling text no longer
  renders both cameras five times a second).
- A **Camera Follows Orientation** switch (per lamp, off by default) draws
  the Matrix Preview cameras vertical while the lamp stands on one end.

### Changed
- **Faster switch from the clock or an effect to a drawing or text** (about
  half a second less) over the lamp's UDP connection, and no more
  re-activation of the picture mode after 90 seconds without a change: both
  tested on the lamps (no flash, no lost first picture; a drawing shown at
  once after a long pause). Over TCP the waits are as before. The black
  frame that clears the drawing before the clock or an effect starts is sent
  twice over UDP (frames are not acknowledged there): coming back to a
  drawing could, rarely, flash the previous drawing for a moment.
- A lamp's entry no longer shows an empty **Configure** dialog (its settings
  are its entities).
- The **Color Palettes** sensor's state is its palette count ("68 palettes"),
  like the Saved Drawings sensor's; it was unknown.
- Every action has its icon in the action picker.
- **Actions report their errors clearly**: a call naming no lamp (or a lamp
  that is not set up), invalid input, or a lamp that is off with Auto Turn On
  off is refused with a message saying why, shown by Home Assistant (automations
  stop there). Several of these used to be logged only, and the call seemed to
  succeed. The messages are translatable. Lamp failures of actions that update
  several lamps in the background are still shown on the cards.
- The lamp is **no longer polled every 30 seconds**: it cannot be read back,
  and the clock's daylight saving check now runs on the hour.
- The entity icons are defined with their names (translatable icons).
- **Entity names follow the lamp's device name**: every entity of a lamp is
  named after its device, then its own name (Home Assistant's standard
  naming), so renaming the device renames its entities' displayed names too.
  The names shown and the entity ids stay as they were, except the **IP
  Address** sensor, now named after the device like the others (it used
  "Yeelight Cube Lite <id>"). The names are translatable.
- **Adding a lamp by its IP address checks that it answers** before adding
  it: an address with a typo, or a lamp that is off, now shows "No Yeelight
  Cube Lite answers at this address" on the form instead of adding a lamp that
  keeps retrying in the background.
- **Fewer commands when switching effects or clock styles**: the lamp's
  brightness is sent only when it changed (an effect's settings carry none),
  instead of with every effect, clock style and rotation step. An effect now
  takes one command instead of two, without the 0.1 s pause between them, and
  leaving a drawing for an effect no longer sends a brightness right after
  its last frame (which could briefly bring the drawing back).
- **Sliders follow a drag without lagging behind**: while the lamp takes one
  value, only the latest waits; the values in between are no longer played
  one by one. This now applies to every lamp slider (the Clock and Native
  Effects brightness and speed, as the Lamp Preview brightness already did),
  and in Home Assistant itself to brightness changes from any source (other
  cards, several browsers, automations) for a lamp that is on.
- **Native effects change live**: a new speed or direction on the running
  effect is sent as a live update (`update_fx_effect`, as the Yeelight app
  does), so the animation goes on instead of restarting from its first frame
  on every slider move. The clock, an effect with a custom color, a color
  change, another effect or palette still start it in full, as before, and
  so does any change the lamp refuses (a live update left the clock dark).

### Fixed
- `set_button_effects` is written over Matter when a server delivers
  Yeelight's commands: the lamp refuses this write over the local network.
  It is refused while **Buttons: Right as Remote** is on, which keeps the
  button playlist black.
- Turning a lamp off while it showed a drawing, text or gradient briefly
  reported it on again, so the cards' power button kept turning it off and it
  could not be turned back on from them.
- A remote button's press left the lamp black when the Yeelight app's own
  drawing replaced a drawing from Home Assistant.
- The Lamp Preview card lost its frame (padding and rounded corners) while
  the lamp stood on its end. Every matrix preview (galleries, Lamp Preview,
  drawing grid, gradient angle preview, Clock previews and preset editor)
  now draws its frame through one shared helper, the same in both
  orientations; the gradient angle's text preview also shows a Left / Up
  mounted lamp the right way up.
- With the lamp mounted **Left** or **Up**, the Lamp Preview card showed
  drawings, text and the clock upside down, and every preview showed native
  effects turned the wrong way; all previews and the cameras now show what
  you see on the lamp, through one shared rule.
- The **Pixel Art** select stayed on the previous pixel art after a drawing
  was sent from the Draw card or `apply_custom_pixels` (and `save_state` /
  `restore_state` kept that wrong name); it now shows the pixel art picked in
  the Draw card's gallery, and is cleared for a drawing of your own.
- The light's `connection` attribute (UDP or TCP) only changed with the next
  state change; it now follows the connection within a minute, at once when
  UDP fails or answers again.
- A lamp whose UDP connection stopped answering for a moment stayed on its
  slower TCP connection for 5 minutes; it is now checked in the background
  every 15 seconds and goes back to UDP as soon as it answers.
- **Over TCP** (when the lamp's UDP connection fails), a scrolling text could
  freeze both lamps and make them refuse the next changes (the clock, an
  effect): they take about one command a second there. Every TCP command now
  waits its turn and only the latest picture of a burst is sent, so the text
  scrolls more slowly instead and the other changes go through. A lamp's
  refusal for its limit now pauses the commands instead of reconnecting.
- A text with spaces no longer fills the log with "No positions found for
  letter ' '" warnings (a space is drawn as nothing); a character a font has
  no glyph for is reported once.
- The light's `connection` attribute (and the diagnostics) said `tcp` for a
  lamp whose UDP session had only closed after a quiet while; it says `tcp`
  only while UDP has failed. Once UDP works again, the TCP connection used
  meanwhile is closed instead of staying open.
- A setup error that is not a network or lamp problem (a bug) now fails the
  lamp's setup visibly instead of being retried forever as if the lamp were
  out of reach.
- Pixel art changes made while Home Assistant was still loading the saved
  collections are refused with a message instead of being lost.
- **Saving a palette** could be dropped silently: a second palette with the
  same name and number of colors, saved within 2 seconds (e.g. the Draw card's
  "Drawing Colors" after a change), was taken for a repeated click. Only the
  very same palette is now ignored that way. A palette saved while Home
  Assistant was still loading the saved collections is refused with a message
  instead of being lost.
- **Renaming a palette** now updates the palette dropdowns at once, and
  replacing all palettes (`set_palettes`) updates the cards and dropdowns.
- Palette changes no longer rewrite every lamp's state, and the palette and
  pixel art sensors compute their change marker once per change instead of on
  every update.
- An entity that is disabled, or whose lamp was reloaded, is no longer
  updated by its lamp afterwards: each entity stops receiving the lamp's
  changes when it is removed.
- The **Lamp Preview** card's preview follows the brightness slider while it
  is dragged, like the lamp does; it used to change only on release. The
  Clock and Native Effects previews do the same, and all three now draw the
  same brightness the same way (the Native Effects preview used a plain
  linear scale, so a dim lamp looked almost black there only).
- In the card editors' lamp picker, a click on a lamp's checkbox did
  nothing (it toggled the lamp twice); a click anywhere on the row now
  toggles it once.

## [1.3.6] - 2026-10-16

### Added
- **Faster connection (UDP)**: commands and pictures now go over the lamp's
  UDP session (port 55444) instead of a TCP connection per command: no
  per-minute command quota (the rotation and quick picks no longer run into
  "client quota exceeded"), and every command confirmed by the lamp. TCP
  (port 55443) takes over
  by itself when UDP does not answer (a network that blocks it, a lamp
  without the session), and UDP is tried again after 5 minutes or once the
  lamp is back online. The light's new `connection` attribute shows `udp` or
  `tcp`. Frames are never answered, so the last frame of a change is sent
  once more right after it, in case one was lost.
- **A change a lamp failed to apply is shown on the cards**: when a lamp
  refuses a change or fails while applying it, every card controlling it shows
  *the last change was not applied (…)* with the reason, until a later change
  works. The lamp publishes it in a new `last_command_error` attribute
  (`service`, `message`, `at`). A lamp that is only out of reach shows as
  unavailable instead, as before.
- The Clock card highlights a picked color mode at once, like the Native
  Effects card, until the lamp reports it.

### Changed
- **Brightness works like the lamp's own modes**: pictures, text and
  drawings are now dimmed by the lamp itself (its brightness = the slider, as
  for the clock and native effects) instead of partly darkening the pixels,
  so all modes are equally bright at the same setting. Very low settings are
  brighter than before and keep their full colors. Removed with it: the
  brightness-curve and per-channel floor values of `set_color_calibration`
  (`hw_floor`, `darken_floor`, `hw_curve`, `darken_curve`, `floor_r/g/b`), the
  `apply_brightness` option of `preview_gradient_modes`, and the unused
  `darken` / `brighten` fields of `set_preview_adjustments`.
- **Several lamps, one offline**: every card keeps controlling its lamps while
  at least one is available. Before, one unavailable lamp switched the Clock
  and Native Effects cards to their offline preview (nothing was sent to the
  others) and every card to "Lamp unavailable". The card now shows the first
  available lamp (also its favourites and rotation interval), names the
  offline ones (*Lamp unavailable: Bedroom. The other lamps are controlled.*),
  and its effect, color and rotation checks are about the available lamps. The
  offline preview and the disabled controls are kept for when none is
  available. A Stop still reaches a rotation waiting for its lamps.
- A native effect picked while a lamp is out of reach is kept and shown once
  the lamp is back, like every other change; before, the lamp went back to
  its previous effect. An effect the lamp refuses is still put back (and now
  named on the cards).
- Renaming, recoloring or deleting a saved clock style or color (Clock
  gallery, preset manager on the Clock and Native Effects cards) shows at once
  on every card and is put back if Home Assistant refuses it, like palettes
  and pixel arts.
- A Lamp Preview adjustment, a color mode (Clock, Native Effects), the
  rotation interval or a frozen display just set on a card now gives way at
  once when another dashboard or an automation sets a different one.
- A list just changed on a card (favourites, palettes, pixel arts, the Colors
  card's colors) that Home Assistant never confirms is dropped after its grace
  period on its own, even when no other update arrives.
- Text on color-filled buttons follows one contrast rule (WCAG), the one the
  Colors card already used: dark text on lighter fills such as red, orange or
  green.
- "Auto" borders (gallery items, the Draw card's color sections, the Lamp
  Preview's adjustments) follow the theme actually shown, also a custom dark
  theme Home Assistant does not mark as dark, and update when the theme
  changes.
- An unreachable lamp is logged once as a warning when it goes and once when
  it is back ("Lamp back online after …"); the retries in between are logged
  at debug level instead of filling the log.

### Removed
- **Matrix transition effects**: the animated transitions between two
  pictures (Fade Through Black, Wipe, Slide, Pixel Migration…) and their
  **Matrix: Transition Effect**, **Transition Steps** and **Transition
  Duration** entities, which are removed from existing installations. The
  lamp could show another picture during or after them (it sometimes redraws
  an older frame of a fast series); pictures now change at once, and turning
  the lamp off or on no longer fades. The lamp's own animations replace them.

### Fixed
- An older picture (for example the one shown before turning off) could come
  back on its own after a change. In pixel mode, the lamp
  sometimes shows an older picture again when it receives a brightness
  command after a series of frames (watched tests). Brightness is now sent
  only when it changes, before the pictures of an update. Turning a lamp off
  and on no longer sends it, and neither does putting the lamp back in pixel
  mode. When the lamp starts a new UDP session, pixel mode is restored in it
  directly: before, this looked like a lost connection and triggered a retry
  and a recovery that sent the brightness again after the frames. A
  brightness change right after several quick picture changes can still show
  it briefly: the lamp needs that brightness command, and no order of
  commands avoids it.
- **Power-on behavior** did the opposite of its labels: "Off" restored the
  previous state and "Toggle" kept the lamp off. Its options are now
  **Restore**, **Always on** and **Always off** (as the lamp reads
  them); a choice saved before keeps what the lamp actually did ("Off" becomes
  Restore, "Toggle" becomes Always off, "On" stays Always on).
- The lamp is no longer asked for its state every minute: it never answers
  (`get_prop`), and each try opened a connection and waited for a timeout.
- The Lamp Preview card's adjustment sliders and reset buttons did nothing
  (errors in the browser console) in every adjustments layout since 1.3.4.
- The Lamp Preview card kept showing its own value of an adjustment it had
  changed, ignoring later changes made elsewhere for that adjustment.
- A Lamp Preview card configured with several lamps sent its adjustments to the
  first one even when it was unavailable.
- Image import (`display_image`) no longer uses a call that Pillow 14 removes.
- A palette, pixel art or clock preset change that Home Assistant never
  answers no longer holds up the next ones: it fails after 20 s, like the
  cards' other commands.

## [1.3.5] - 2026-10-15

### Changed
- Releases now ship `yeelight_cube.zip`, attached automatically when a release
  is published, and HACS installs the integration from it
  (`zip_release` in hacs.json). HACS counts installs from that file's
  downloads, so its **Downloads** figure appears starting with the first
  release that has the zip; installs of earlier releases are not counted.

## [1.3.4] - 2026-10-15

### Added
- **Power limit, Estimated power and Estimated energy**: each lamp gets an
  **Estimated power** sensor (W, from a model measured on real lamps,
  including Clock, Native Effects and Music Flow through their simulated
  previews), an **Estimated energy** sensor (kWh, usable in the Energy
  dashboard) and a **Power limit** number (0.4–7 W, 7 W = off) that dims
  bright pictures just enough to stay under it. Useful for lamps sharing a
  weak power supply. See the README's new Power Supply section.
- The Draw card's canvas is saved per lamp and survives a Home Assistant
  restart.
- **Rename gallery items per card** (`item_labels`): the Clock, Native
  Effects and Gradient editors can rename, reorder and hide the items their
  gallery shows. A label only changes what the card shows; favourites,
  rotations and lamp commands are unaffected.
- The Palettes and Draw galleries use the same gallery as the Clock, Native
  Effects and Gradient cards (list, grid, strip, carousel, wheel or album
  previews, or text buttons, dropdown or chips, with search), and their
  editors can reorder saved palettes and pixel arts (new `move_palette`
  service, like `move_pixel_art`).
- Shared color swatches for the Draw and Palettes cards (keyboard
  navigation, the active color marked) and one drag-to-reorder for the
  Colors card and the editors' lists, with mouse and touch.
- Draw card: **Open as overlay** for the preview-hover color sections
  (`colors_preview_overlay`), so an opened section floats over the content
  instead of pushing it down.
- Every card shares the same frame options: title, lamp status and card
  background. Older option names keep working.
- `save_state` / `restore_state` also save and restart a running effect or
  clock rotation, in step with the lamps still running it.

### Changed
- A text sent while the lamp shows its built-in clock or a native effect is
  kept for when it shows text again, instead of taking the clock over and
  stopping its rotation. Between `save_state` and `restore_state` it is
  shown as a one-time overlay (save_state, set_custom_text, restore_state).
- `save_state` / `restore_state` no longer touch the lamp's power: restoring
  never turns a lamp on or off.
- **Auto Turn On** disabled: a pixel art, text, custom pixels or clock
  change sent to an off lamp is now kept and shown when the lamp is turned
  on (it used to be dropped).
- A clock or native-effect command the lamp refuses (its rate limit, *client
  quota exceeded*) is now detected instead of Home Assistant assuming it
  took effect. A rotation step the lamp refuses is retried with a growing
  back-off (30 s up to 5 min) instead of being dropped, and a lamp started
  alone joins the lamps already running the same rotation.
- The Lovelace cards are registered as soon as the integration loads, so a
  dashboard opened while the lamps are still reconnecting after a restart
  finds them.
- The Native Effects card's Previous/Next step through the current search
  results.
- Manual setup validates the IP address properly.
- Every entity supports Home Assistant 2026.11's in-place entity id renames
  (`async_entity_id_changed`): renaming one no longer redraws the lamp,
  restarts its rotation or restores its last state
  ([#4](https://github.com/Max-src/yeelight-cube-lite/issues/4)).

### Removed
- The `force_rediscovery` and `trigger_manual_discovery` services (testing
  helpers). Remove them from any automation or script that calls them;
  rediscovery after an IP change still happens automatically.

### Fixed
- **Renamed entity ids**
  ([#4](https://github.com/Max-src/yeelight-cube-lite/issues/4), reported by
  @emontnemery): services now find a lamp by its current entity id only, so
  an old id can no longer reach a renamed lamp, and two lamps whose names
  were swapped are never mixed up. A rotation started on several lamps
  records them by unique id, so a rename never separates them after a
  restart.
- The cards find the palette and pixel-art sensors by their contents instead
  of their entity id: a fresh installation's `sensor.saved_drawings` is now
  found without configuring it, and a card configured with a sensor that was
  renamed since finds it again. A card controlling several lamps names any of
  them that no longer exists instead of silently controlling fewer lamps.
- Old pixel art, text or colors no longer flash on the lamp after leaving the
  clock, a native effect or Music Flow.
- `set_colors` with `save_as_palette` now actually saves the palette.

### Documentation
- Setup: the app the Cube Lite needs is now called **Yeelight** (formerly
  *Yeelight Station*; the older app formerly called *Yeelight* is now
  *Yeelight Classic*). The README names the right app, links it on the
  App Store and Google Play, and explains the three Yeelight apps
  ([#5](https://github.com/Max-src/yeelight-cube-lite/issues/5), reported by
  @codebykat).
- New Power Supply section in the README.

### Internal
- Large backend and card files split into focused modules and shared card
  components (about 15,000 fewer lines); the Lit bundle is built
  reproducibly from the official package.
- A Tests workflow runs the Python, JavaScript and browser tests on every
  push, and `npm run check` runs the same checks locally (including on Linux
  through WSL). The documentation screenshots refresh automatically and one
  failing image no longer fails the run.

## [1.3.3] - 2026-09-30

### Added
- **Server-side shared favourites and rotation interval** for the Clock and
  Native Effects cards: both are now saved on the lamp instead of per-browser
  storage, so every dashboard, browser, and device shows the same favourites
  list, the same rotation interval, and the same freeze state. Favourites kept
  in a browser from an older version move to the lamp automatically the first
  time it opens the card. A running rotation now survives a Home Assistant
  restart or integration reload, and lamps started together resume on the
  same schedule.
- **Composite rotation interval editor**: build an interval from several
  added-together rows (e.g. "1 minute + 10 seconds"), plus new
  "Follow in effect/style list" and "Highlight in favourites" toggles.
- New services `set_favourites`, `set_rotation_interval`, `move_pixel_art`,
  and `add_palettes` (append a palette collection without replacing it).
- An optional `expected_name` on the palette and pixel-art load/apply/remove/
  rename services: when set, the call is rejected if another browser changed
  the list first instead of acting on the wrong item.

### Changed
- `set_native_effect` now returns immediately and applies to the lamp in the
  background (like `set_clock_style` already did); if the lamp rejects the
  change, it is rolled back to what the lamp last accepted instead of leaving
  cards showing a state the lamp never took.
- Palette import now appends to the saved collection instead of replacing it,
  so palettes added from another browser in the meantime are kept. The Draw
  card's drag-reorder likewise sends only the moved item instead of the whole
  collection.
- Every card's service calls (sensor refreshes, palette saves, lamp-preview
  adjustment resets, device orientation) now go through one ordered per-card
  queue instead of scattered direct calls, so they can no longer race each
  other or be silently dropped on failure; a refused "reset to defaults" now
  rolls back the values it had already shown.
- Sliders and the Gradient card's angle control no longer snap back to the
  lamp's last-known value during a slow drag or an in-between state update.
- Picking a style or effect no longer flashes the shared Actions, Favourites,
  and color controls as busy while the lamp responds, and rapid successive
  picks now only send the latest one.
- Drawing on the pixel-art canvas batches its writes instead of saving on
  every single cell of a stroke, and skips writes that would not change
  anything.

### Fixed
- The `matrix_colors` attribute now correctly reports all-black while a lamp
  is off, and no pixels while the lamp draws its own content (Clock, Native
  Effect, Music Flow), instead of stale or incorrect content.
- Fixed a configuration bug where an emptied multi-lamp selector
  (`target_entities: []`) silently targeted no lamp instead of falling back
  to the single configured `entity`.
- The style/effect browser now turns to the page of the newly active item on
  a rotation step, Next, or a favourite pick, instead of staying on the old
  page.
- Fixed a race where a pick made while a rotation was starting could act
  before the start finished; a rotation stopped mid-start is now properly
  cancelled instead of silently continuing.

### Security
- Raw/diagnostic services (`send_fx_effect`, `query_raw`, `get_capabilities`,
  `bulb_call`, `set_default`, `set_color_calibration`,
  `set_calibration_lock`) are now restricted to Home Assistant administrators.
- `display_image` rejects an oversized or malformed image with a clear error
  before decoding it, guarding against a decompression-bomb-style resource
  exhaustion.
- Palette and pixel-art collection services now validate size limits
  (collection length, colors per palette, pixel entries, name length)
  instead of accepting unbounded input.
- Removed inline event-handler HTML (`onclick="..."`) from shared card
  renderers in favour of a Content-Security-Policy-safe delegated-event
  system, and slider appearance settings are sanitised before reaching raw
  HTML output.

## [1.3.2] - 2026-09-22

### Added
- **Native Effects Lovelace card** for controlling one or more lamps, with the
  same selector, action, slider, color, orientation, favourites, and rotation
  controls as the Clock card.
- **Shared Clock and Native Effects controls**, including configurable Actions
  order, shared brightness and animation-speed sliders, and shared color-mode
  controls.
- **Freeze display action** for compatible modes. It sends a freeze frame and
  resumes by reapplying the current mode; previews hold their background while
  frozen.
- **Server-side favourites and rotation** for clock modes and native effects.
  Rotation follows the favourites list, survives a dashboard refresh, and can
  be started, stopped, or skipped. Starting rotation on several lamps no longer
  waits for one lamp before starting the next.
- **Saved custom color-mode presets**, including native custom RGB, with a
  unified color row and inline save flow.
- **Shared Original effect browser** for both cards, with Grid and List display,
  capability badges, live matrix previews, and favourite stars.
- **Configurable device orientation controls**, including direction order,
  visibility, rotation, and flip.
- **Strip preview mode** and a shared slider Control Width setting.
- **Clock-style filtering** based on whether a style responds to the active
  color mode.

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
- Fixed the shared Original selector settings so the Clock and Native Effects
  editors load their foldable sections instead of showing a configuration error.
- Native effect previews now follow the calibrated direction, speed, and color
  state, including brightness-only updates and frozen playback.
- Clock color overrides now recolor compatible native effects and persist
  correctly, including solid black-and-white fallbacks and measured palette
  previews.
- Fixed color-picker opening and anchoring, clock preview ghost pixels, and
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
- Removed clock styles that the lamp rejects.
- Fixed clock-mixer default color inheritance.
- Fixed lamp IP rediscovery.
- Enabled speed control for the Spectrum native effect.
- Corrected native-effect preview orientation.
- Fixed hassfest YAML validation by using a block scalar for the kwargs
  description.

## [1.3.0] - 2026-08-28

### Added
- **Experimental Features switch**: reveals built-in animation modes that
  the official Yeelight app never exposed. Off by default.
- **"Blue White" native effect** (mode 59) as the first experimental
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
- Fixed the debug mode table and clock-mixer detection.

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
