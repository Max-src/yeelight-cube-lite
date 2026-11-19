# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Steady streamed effects on a Cube Lite.** An effect or clock a Cube Lite
  can't run itself is streamed over the LAN in direct mode, paced by its
  Stream frame rate limit (default 5 new pictures a second), with only the
  frames it needs when Skip Unchanged Stream Frames is on. A Cube Matrix is
  streamed as its drawing over Matter. See docs/STREAMING.md.
- **Previews show exactly what a streamed lamp shows.** While an effect or
  clock is streamed, the preview cameras and the Lamp Preview card show the
  frames the lamp was sent, not their own drawing of the effect (which
  started at another moment, with other random seeds).
- **A stuck Cube Lite is brought back without a power cycle.** When a Cube
  Lite accepts connections but answers nothing (the Power cycle sensor's
  "not responding"), Home Assistant tries to bring it back over the LAN: it
  sends one command at the lamp in a series of sizes until the lamp answers
  (about a minute at most); the lamp then restarts by itself and its content
  is drawn again. Up to 3 tries, 10 minutes apart; when none is answered,
  the Power cycle sensor and its Repair stay as they are.
- **Stream frame rate limit** (a number on each Cube Lite, 1-25, default 5):
  the most new pictures a second for what Home Assistant streams to it. Above
  5 is smoother, with more risk of the lamp stopping to answer; below 5 the
  last picture is still sent every 0.2 s.
- **Skip Unchanged Stream Frames** switch (Cube Lite, off by default): a
  streamed frame the same as the last one is not sent, not even as the 0.2 s
  repeat, so the frame rate limit becomes a maximum. The lamp is then left
  without frames while the picture holds still, when a Cube Lite is more
  likely to stop answering.
- **Keep Streaming When Off** switch (Cube Lite, off by default): turning
  off a streamed effect or clock keeps the stream going with black frames
  until the lamp is turned on again, where the effect goes on; the lamp is
  never left silent after a busy stream, when a Cube Lite can stop answering.
- **Cube Matrix Modules card** (`custom:yeelight-cube-matrix-modules-card`):
  each chosen Cube Matrix's modules as fitted from its power supply, and the
  side the power supply is on, set as on the Yeelight app's module page (add a
  Matrix, Spot or Panel module, remove one, pick Left, Right, Down or Up), saved
  with `set_matrix_modules` and the matching Device Orientation. The light's new
  `matrix_module_list` attribute lists every module by name.
- **Yeelight Cube Matrix** (the original Yeelight Cube: a base and 5×5
  modules, LAN model `CubeMatrix`): discovered and set up like a Cube Lite
  (also when found in Home Assistant's Matter integration), its model stored
  in the entry. Text, drawings, pixel art, gradients and colours work as on
  the Cube Lite, in the Cube Matrix's own pixel order. Shared to Home
  Assistant's Matter integration, it shows its **own** 13 effects (speed,
  direction, colour or a one-colour palette), its clock (styles 1–14, time
  from the Internet, the UTC offset sent again when daylight saving time
  changes it) and drawings (changed in place), smoothly, over Matter, and 35
  more of its built-in effects the integration has too (Fireworks, Sunrise
  and sunset, Rainbow noise, the fill-ins and wipe-outs...).
  Everything else is drawn by Home Assistant as the Cube Lite shows it and
  streamed as the lamp's drawing over Matter, its pixels changed 25 times a
  second (without Matter: over the LAN, music mode, 5 frames a second), in the colours before the Cube Lite's conversion (the Cube Matrix
  converts them itself), with direct mode sent again every 2 seconds so a
  stream never freezes. The lamp's rotation (set in the Yeelight app) is the
  light's Device Orientation, so a Cube Matrix standing on its base shows
  pictures and vertical pixel arts upright, and choosing an orientation
  writes the Cube Matrix's own rotation value. A lamp in its **demo mode** (a 30-second loop only a factory reset
  ends) is reported in Repairs and streamed to. What it cannot have
  (microphone effects, Music Flow, power-on behaviour, the Cube Lite's
  buttons) is not offered, and Cube Lite commands are refused before they are
  sent. An entry made by an earlier version for a Cube Matrix learns its model
  at the next start and loses its Cube-Lite-only entities. See
  docs/CUBE_MATRIX.md.
- **A lamp paired to Matter again** (after a factory reset) is linked to its
  new node even while the server still lists the old one, and the old node is
  removed from Home Assistant's Matter server once the new one answers (same
  Wi-Fi MAC only). Before, the link could stay on the dead node, and the
  lamp's Matter features stayed unavailable.
- **Palette shows every effect in the whole palette:** an effect the lamp
  cannot show in all the palette's colors itself (more colors than it takes,
  or none at all) is drawn by Home Assistant as the lamp would, in the
  palette, and streamed to the lamp 25 times a second over the LAN (UDP; no
  Matter needed), one frame per render, like a drawing. The colors move with
  the effect: an effect whose picture is in its colors maps them onto the
  palette, a field of light takes them from the brightness around each pixel,
  followed smoothly (no pixel flickers between colors), separate dots and
  shapes (stars, blocks, Hacking's digits) each keep one color while lit,
  White fill-in and wipe-out take the first. The lamp starts each effect from
  its beginning. Effects the lamp takes the palette for (the music modes, an
  effect drawing as many colors) and those that listen to the microphone stay
  the lamp's. The animations are recolored into the GIF the lamp stores and
  plays itself, in the layout chosen (Matter, as every animation). A clock
  style under Palette over such an effect streams its background recolored
  through the digits. The previews, the camera and the estimated power show
  the same frames. Speed, direction, intensity, Lamp mounted, favourites,
  rotation and Freeze work as for any effect; over TCP the lamp holds its
  last frame until UDP answers again.
- **Cube Matrix setting** (with Matter): **Power-on behavior** (Always on /
  Always off: the lamp's Matter `StartUpOnOff`; set to off, the lamp is not
  switched back on after a power cut).
- **Three effects from the Cube Matrix**, on both lamps, with a clock style
  over each: **Northern Lights** (the Cube Matrix's Aurora, in the aurora's
  own colours where Aurora is green), **Rose Sea** (its Flower Sea: red to
  hot pink to purple, rows dimming towards the far end) and **Dark palette
  pulses** (its Triangular palette pulses, on black). The Cube Matrix showed
  them under the Cube Lite's names though they look like other effects: it
  now shows these itself and streams the Cube Lite's Aurora, Flower Sea and
  Triangular palette pulses, so each name looks the same on both lamps. A
  Cube Lite shows Northern Lights itself and streams the other two (drawn by
  Home Assistant, over UDP).
- **Effects of the integration's own**, in no lamp: drawn by Home Assistant
  and streamed, to a Cube Lite over the LAN (UDP) and to a Cube Matrix over
  Matter (else the LAN). They are listed with the lamps' effects on the
  Native Effects card, the effect select and `set_native_effect`, with a
  clock style over each, and work as any effect: previews, camera, estimated
  power, speed, direction, intensity, Lamp mounted, favourites, rotation,
  Freeze. They are never sent to a lamp as an effect, so they can't be on a
  Cube Lite's physical button. The first is **Knight Rider**: a light running
  back and forth along the direction's line, leaving a fading trail; red or
  the colour chosen, the speed setting a sweep's time and the intensity the
  trail's length (at the most it outlasts a sweep). Under Palette each sweep
  takes the palette's next colour; under Vivid, Retro Orange, Tropical or
  Violet & Gold, colours spread along the preset; under Black & White, white.
  A clock over it takes the clock's colour, palette or preset.
  The second is **Lava Lamp**: wax heated in a pool at the direction's start
  swells into blobs that rise, cool near the top and sink back to melt in
  again, merging and parting on the way. It is a simulation, not a loop:
  each blob heats, cools and drifts in its own way, nudged at random at
  every frame, so it never repeats, and each time it starts it is a new run.
  Orange, or the colour chosen; the speed sets its pace, the intensity how
  much wax. Under Palette or a preset the blobs take the first colours and
  the liquid glows in the last; under Black & White, white.
  The third is **Falling Blocks**: a falling-block puzzle that plays itself.
  Pieces of four cells fall along the direction; a player turns them and
  moves them sideways to complete lines as they fall at a steady pace. A full line
  flashes and goes, the stack above coming down, and when no piece can come
  in any more the stack is wiped away row by row and a new game starts. Pieces come
  in shuffled sets of the seven shapes, and each run is a new game. The
  speed sets how fast pieces fall, the intensity how well the player plays.
  The player takes its time: a piece's turns and moves are spread over its fall
  (it reaches its place about halfway down), and it keeps falling at the
  same pace to the bottom, never dropped faster.
  Its own colour for each shape, or the colour chosen in shades; under
  Palette or a preset their colours; under Black & White, shades of white.
- **Power cycle** sensor for each lamp (diagnostic, a problem binary
  sensor): **Needed** while the lamp has a Repair that only turning its power
  off and on fixes (**stopped answering**, **stopped answering over UDP**, a Cube
  Matrix's **local network connection is stuck**), with the Repair in its
  `reason` attribute; **Not needed** once the lamp answers again. A lamp on a smart plug
  can be recovered by an automation that switches the plug off and on.

### Changed
- **Long text scrolls on a Cube Matrix too**, as its drawing over Matter.
- **Streams to a Cube Lite are paced:** a frame when the picture changes,
  never closer than 0.2 s to the last one, and the last one again 0.2 s after
  it without a change (direct mode is never left silent, and never quiet for
  the 300 ms after which a Cube Lite sends its unconfirmed frames again in
  one block: an old picture for a moment, and a stuck lamp when there are
  several). Measured on two Cube
  Lites, streams that stopped abruptly: frames 40 ms apart left a lamp stuck
  about 1 time in 5, 200 ms apart 0 times in 50. Over Matter (tried first),
  every frame dimmed a Cube Lite for a moment: Lava Lamp's background blinked
  and Knight Rider and Falling Blocks stuttered.
- **Cube Matrix modules:** a lamp with other modules than 4 Matrix ones (set in the
  Yeelight app's module splicing) is drawn for them. A **Spot** module (one bright
  light) now shows the blend of the picture on either side of it (it was always
  dark when Home Assistant drew), so a moving effect passes through it. With fewer
  than 4 Matrix or Panel modules the lamp shows fewer than 20 columns: text is laid
  out and scrolled within them, the streamed clock fits them (its digits closer),
  and the lamp preview card hides the missing columns and draws each Spot where it
  is. New action **`set_matrix_modules`** sets the module list from Home Assistant
  (over Matter, the app's own command). The light's `matrix_modules` and
  `matrix_columns` attributes describe the layout.
- A new Native Effects or Clock card starts on the **Original** gallery, as a
  grid, 10 items a page (was the live previews, all on one page). Cards
  already on a dashboard keep their settings.
- The Native Effects card shows its **Color Modes & Controls** by default;
  turn **Show Color Modes** off in its editor to hide them.
- **Quieter logs:** the stream diagnostics are at debug level; a failed
  frame is warned about once per outage (and its recovery once), a frame the
  lamp refuses once per episode.
- **The native effect list is no longer a light attribute** (about 12 KB on
  every state): the cards fetch it once per change. The light publishes
  `native_effect_catalog_key` instead. The `calib_*`,
  `color_accuracy_enabled` and `last_hardware_brightness` attributes are
  gone too (the calibration services are unchanged).
- **A scrolling text writes far less history:** the light's state, the
  preview cameras and the power sensors are updated at most once a second
  while it scrolls (about 5 writes per step before), the last step always.
  The Lamp Preview card still follows every step.
- **Lighter cards:** the Palette, Gradient and Draw cards load about 40%
  less code; animated previews share one animation loop per page and stop
  while scrolled off screen; the Draw and Gradient cards no longer redraw at
  every step of a scrolling text.
- **While a stuck Cube Lite is being brought back over the LAN,** commands
  and actions fail at once instead of waiting about a minute.
- **Log names:** the lamp connection's messages now come from
  `custom_components.yeelight_cube.lamp_client` and its `lamp_client_*`
  parts (was `…yeelight_cube.cube_matrix`), and some of the light's from new
  `light_*` parts. A `logger:` setting for `custom_components.yeelight_cube`
  covers them all, as before; one naming `…cube_matrix` should name
  `…lamp_client` instead.

### Fixed
- **A lamp turned off stays off after a Home Assistant restart**, also when
  it was unreachable at the restart; its brightness is kept for when it is
  turned on.
- **Display text up to 255 characters:** `set_custom_text` and the Display
  Text control share this limit; a longer text is refused instead of
  breaking the text entity (and a saved one is shortened).
- **`set_preview_adjustments` changes only the adjustments given**; the
  others were set back to their defaults.
- **Kept across a restart or reload:** the Stream frame rate limit, Full
  panel, and an effect intensity of 0. A malformed saved setting no longer
  stops the light from loading.
- **Font and Alignment show the new choice at once,** also when the lamp
  cannot be redrawn.
- **The stream's check of a Cube Lite no longer pauses its frames** for
  seconds while it asks the lamp over TCP or Matter, and the 10 s health
  check no longer pings a lamp that is streaming.
- **A stream that stops on an error while off on standby** (Keep Streaming
  When Off) comes back, black, and goes on where the effect was.
- **The Cube Matrix's Power-on behavior select follows the lamp** when it is
  changed in the Yeelight app, and its retry delay for Matter resets once
  Matter frames work again.
- **Camera previews no longer fail (403) during a fast scroll,** and a lamp
  whose unload fails keeps working.
- **Cards:** after a cancelled touch on a slider the page scrolls again and
  the next swipe no longer changes the brightness; the Clock card's previews
  no longer stay frozen after switching views; the Gradient card's previews
  and the Palette card follow the card's main lamp; a failed official pixel
  art request is retried after 30 s, not at every update.
- **A Cube Lite that stops answering during a stream is asked over Matter
  too:** the log says whether its LED part is stuck (a power cycle) or its
  network part restarts.
- **A frame over Matter no longer holds the lamp for half a minute.** Each
  waits at most 2 s (5 s to start the drawing): a lamp whose network part
  restarted mid-stream kept one frame waiting 38 s, and every other command
  to it behind.
- **A Cube Matrix showing everything over Matter is no longer told to be
  power cycled.** Its LAN can stop answering while Matter keeps working; the
  Power cycle sensor was then on although the lamp showed its effects without
  fault. It now turns on only when something needs the LAN (Matter failing,
  Music Flow).
- **A streamed Cube Lite whose effect changed elsewhere draws again.** When
  something else changed the lamp's effect (a Matter controller, the Yeelight
  app, the lamp restarting on its own), it refused every streamed frame while
  still answering checks: the lamp stayed dark, and a lamp stuck behind those
  refusals was never reported. The next frame now puts it back in direct mode
  at once (seen after a power cycle: 2 frames refused, then drawn).
- **A Cube Lite stuck mid-stream is reported even when its stream fell back
  to TCP.** Its UDP session failing moved the stream to TCP (frames held),
  where the stream's own check stopped asking the lamp for an answer; the
  lamp still accepted connections, so it was never reported. The check now
  goes on over TCP: the Power cycle sensor and the Repair follow within a
  minute.
- **A lamp whose network part restarts keeps Home Assistant's content.**
  A Cube Lite's network chip can restart by itself while the panel keeps
  its picture; it then reports its start-up state (a plain colour), which
  was taken for the Yeelight app's: the stream stopped, and even after a
  power cycle the lamp was not given its content back. What the lamp
  reports in the 10 seconds after it started again (Matter's reboot count)
  is no longer taken for another app, nor its brightness followed.
- **A streamed effect no longer stops when Home Assistant's Matter server
  reconnects to the lamp.** After losing a lamp for a while, the server
  reports all its values again; the drawing the lamp shows for Home
  Assistant's stream was taken for another app's content, so the stream
  stopped and the lamp kept its last frame while Home Assistant showed it
  as working. Values reported again unchanged are now ignored, and the
  lamp showing Home Assistant's own drawing is never another app.
- **A lamp that stops an animation upload** is logged once, as a warning,
  not as an "Unexpected error" with a traceback (the failure is explained).
- **A stream to a lamp that cannot take frames** (no UDP connection, or a
  lamp that stopped answering) checks again once a second until it can,
  instead of 25 times a second; frames resume within a second.
- **Repairs name the lamp as its device is named** in Home Assistant (the
  name you gave it), not by its model and ID ("CubeLite 7e78"); renaming
  the device renames its open repairs.
- **A lamp back from a power cut while it streamed** no longer stays
  unavailable in Home Assistant: its effect and brightness are applied again
  (the stream's own check, answered first, kept the recovery from running).
- **A long text scrolls on a Cube Matrix** that shows Home Assistant's
  drawings over Matter: it stayed on its first frame, and a new text was
  ignored, as if the lamp showed one of its own effects.
- The **`ignore_yeelight_discovery`** action failed every time; it now
  dismisses the core Yeelight integration's pending discovery of the IP
  address given.
- **A Cube Matrix's previews show its modules**: the effect, clock and
  gradient galleries, the favourites and the Lamp Preview drew every Cube
  Matrix as a 20 x 5 lamp, whatever its modules. They now show the modules
  it is set to (Matrix + Spot: 10 columns), each Spot one round light in the
  colour it lights, lying flat or standing, either way up. The Clock card's
  styles lay their digits out in those columns, as the lamp shows them (they
  were laid out for 20 columns and cut).
- **A Cube Matrix's Spot takes a module's place**: it covers 5 columns of
  the picture like a block and lights in their colour (their average, as
  bright as their brightest pixel). It was a light squeezed between two
  blocks, so Matrix, Matrix, Spot, Matrix showed 15 columns and left the
  last block's worth of every effect empty; it now runs the whole 20.
- **A Cube Matrix with fewer than 4 modules** shows its effects within them:
  effects were drawn 20 columns wide and the columns it does not have cut
  off, so what moves finished out of sight (Falling Blocks landing past the
  last block, stacks piling up in hidden columns, meteors and fills running
  on unseen). Every effect is now drawn on the columns the lamp shows (5 a
  module), as the lamp draws its own on a shorter strip, in its streams, its
  preview camera and the cards' previews alike;
  the clock's background too, its digits mirrored or turned within those
  columns. The Angle, Radial and full-panel gradients span the columns shown,
  so their last colour shows, and the Draw card marks the pixels the lamp
  has no module for.
- A streamed effect that draws each frame from the ones before (Aurora,
  Northern Lights, Particle glows, the music effects...) no longer
  fast-forwards for a moment when its intensity or palette changes: the
  picture holds while the effect catches up, then goes on.
- A Cube Lite stuck while it scrolls a text is reported (Repairs, the Power
  cycle sensor) as one stuck while it streams an effect: the lamp is checked
  whatever streams to it.
- A light keeps its settings (effect, colours, mode...) across a Home
  Assistant restart while its lamp is unreachable: they were lost, as Home
  Assistant saves an unavailable entity's state without them.
- A streamed Cube Lite whose UDP session the lamp dropped had every frame
  refused until the next command, up to 30 seconds without a picture: the
  next frame now opens a new session at once. After a UDP failure the stream
  is back on UDP within about a second (was 15 s or more), and a lamp whose
  check went unanswered is asked again every 5 seconds, not 30.
- Turning a light off stops its scrolling text (with auto-turn-on, the next
  step drew the text again and turned the lamp back on).
- An effect change the lamp refused, back to a streamed effect, streams it
  again (the lamp was left black).
- The colour adjustment sliders no longer restart the lamp's own effect,
  clock or a streamed effect at every step (none of them takes the
  adjustments); an animation still takes them.
- An animation's file is drawn without holding up Home Assistant (a second
  or more on a slow host, pausing every other lamp's stream).
- A Cube Matrix stream no longer ends for good when its music connection is
  closed while opening.
- A Cube Lite that stopped answering while Home Assistant streamed to it (an
  effect it does not have, a palette, a clock) was not noticed: frames are never
  answered, so it stayed "on" for minutes. The stream now asks the lamp for an
  answer every 30 s; when none comes, frames pause, the **stopped answering**
  Repair and the **Power cycle** sensor follow within about a minute, and the
  stream goes on by itself once the lamp answers again (after a power cycle).
- A lamp that accepts a connection and closes it without answering (a Cube
  Matrix whose local network connection is stuck) could make a command over
  TCP wait forever: the python-yeelight library read the closed connection
  again and again. It now fails at once (and the Repair asks for a power
  cycle). On 2026-11-14 a Cube Matrix in that state never finished its setup
  when Home Assistant started; setup steps slower than 10 s are now named in
  the log.
- A stream never leaves a Cube Lite silent while it should be showing
  frames: while the effect or clock stream or the text scroll runs, any
  pause in its frames (a slow or failed drawing, the scroll's pause at each
  end, which reached 4 s) is filled by sending the last frame again every
  0.4 s, as the 3 s after a stream's frames already were; after a minute
  without a new frame it stops and says so in the log. A frame that cannot
  be drawn no longer ends the stream (it is logged and drawn again), and a
  stream that stopped on an error starts again. Every effect and clock style
  that can be streamed is drawn by the tests in every color mode.
- A Cube Matrix whose Matter command failed once (for example while the
  network or Home Assistant's Matter server restarted) streamed what was
  selected over the LAN, at about 5 frames a second, until something else was
  chosen, even its own effects. Matter is now tried again: as soon as the
  Matter link is back, else after a minute, then twice as long after each
  failure in a row (up to 30 minutes).
- **A Cube Lite that stops answering over UDP is no longer blamed on the
  network.** When it keeps opening UDP sessions (it answers their opening
  itself, so UDP passes) but answers no command in them, a new Repair says the
  lamp stopped handling UDP and needs a power cycle, instead of "something on
  the network blocks UDP". The diagnostics show the sessions opened meanwhile.
- **Palette on several lamps:** each lamp draws its own palette, so a Native
  Effects or Clock card applying the Palette color mode to lamps holding
  different palettes showed other colours on some of them than on the card.
  The card now first gives every available lamp the palette it shows.
- **A lamp stuck at startup no longer keeps its entry from loading:** the
  light redrew what the lamp showed before it was added, and waited for it.
  A Cube Matrix accepting connections but answering nothing held the setup
  past Home Assistant's 60 s, and the entry failed. The redraw now runs in the
  background, then the saved rotation resumes as before.
- **Effect directions on the Cube Lite** run the way chosen, and the same way as on a Cube Matrix (filmed side by
  side, standing, at every Device Orientation): Rainbow, Waterfall and Meteor ran Left and Right the wrong way round;
  Fire, Particle path, Rotating colour bands, Palette trails, Aqua-lime trails, Scrolling bands, Stacking blocks and
  Kaleidoscope ran a quarter turn off; Building Blocks ran Up and Down the wrong way round; Heat fire, Dual scan,
  Violet interference and Aurora ran a quarter turn off and Rising wisps backwards; the Rainbow and White
  fill-ins filled from the far side. Flicker sweep sweeps as on a Cube Matrix, along the lamp for Left and Right
  and across it for Up and Down (it ran down the lamp row by row). Moving palette, Sine wave and Hacking run along
  the lamp's long side only: their value now follows the lamp's rotation, so they keep the way chosen on every mount (a direction
  across that line runs along it: Left as Up, Right as Down). Moving palette and Sine wave move as bands across
  the lamp travelling along it, at any intensity (before, depending on the intensity, they could seem to roll
  across it). Hacking Down (it fell Up whatever was chosen) works. Previews follow and draw what the lamp draws.
- **Cube Matrix directions**: Building Blocks and Waves ran each way backwards, Flicker sweep and Rising wisps
  across the one chosen; Spectrum takes a direction (it showed the Up gradient for every one). Its other built-in
  effects (Fireworks, Sunrise and sunset, the fill-ins and wipe-outs, Dot with fading trail, Sine plotter…) now
  draw what a Cube Lite draws for the same Device Orientation, as the effects already filmed on both did (some
  ran a quarter turn off, the fill-ins and wipe-outs across the lamp). Moving palette, Sine wave and Hacking run
  along the lamp as on a Cube Lite and follow its rotation, so Hacking falls Down on a lamp mounted lying too.
- **Cube Matrix colours**: Breathing, Sine wave, Centre bursts, Particle glows, Dot with fading trail and Fireworks'
  flare were amber where a Cube Lite shows them white: the Cube Matrix was sent the Cube Lite's LED white, which it
  converts again. It is now sent white, which it turns into its own LED white.
- **Cube Matrix brightness** goes over Matter when a server delivers its commands (as the Yeelight app's slider),
  over the LAN only without one. The lamp's LAN can stop reading commands (every connection reset) while Matter
  goes on: the brightness slider then did nothing until the lamp was power-cycled.
- **Cube Matrix orientation after a power cut**: the lamp keeps a newly written rotation only once it handles another
  command, and not while its music mode is on, so after a power cut it could come back with the previous one (and
  Home Assistant followed it as if it had been changed in the Yeelight app). A rotation the lamp reports as it
  restarts is now written back to the Device Orientation instead, and Home Assistant's own music connection is closed
  before a rotation is written.
- **Cube Matrix with a stuck LAN** gets its own repair ("local network connection is stuck": power-cycle it). It
  was told a firewall blocked its fast connection, because it accepts connections and only then closes them. While
  that connection fails, the lamp is now asked a command over TCP every minute to tell the two apart.
- **Cube Matrix clock mounted left or up**: the lamp's own clock never turns its digits, so it read upside down
  on a lamp mounted left and from the bottom up on a lamp mounted up (a Cube Lite reads upright and from the top
  down). On those two orientations the clock is now drawn by Home Assistant, turned as a Cube Lite's, and
  streamed; mounted right or down it stays the lamp's own. The Clock card's preview of a Cube Matrix showed its
  clock turned on right and down: the light now tells the cards whether a lamp's clock is turned
  (`mount_profile.clock_turned`).
- **Cube Matrix effects that showed nothing** (Sine wave, Moving palette,
  Palette trails…): the lamp was sent an all-black colour list, which on a
  Cube Matrix blacks out an effect's colours and palette. It is now sent the
  colour you picked, else the effect's own colours, else the Cube Lite's warm
  white for effects drawn in colours, else no list so the effect shows its own
  palette. The Cube Lite's own effects (Palette stripes, Magic,
  Kaleidoscope…) are streamed instead of starting a white wipe on the lamp.
  Triangular palette pulses runs on the lamp itself (on its black
  background). Fire, Flower Sea, Triangular palette pulses, Night-amber
  waves and Flicker sweep are marked as the Cube Matrix's own versions. See
  docs/CUBE_MATRIX.md.
- **Cube Matrix: nothing shown when its stream could not start.** Without
  its music connection the integration sent frames and direct mode over
  plain TCP, which the lamp refuses, and kept a connection open in one of
  its 3 slots, so the music connection could not come back. Frames now wait
  for the music connection; other commands use short connections, at most
  50 a minute, with a 30 s pause when the lamp still refuses one. The music
  connection listens on TCP port 55450, is tried again after 30 s, then 5
  and 30 minutes, and a **Repair** says to let the lamp connect to Home
  Assistant (not the Cube Lite's UDP 55444). A write the lamp does not take
  within 2 s gives the connection up instead of freezing every control.
  The lamp's error answers (not JSON) and its quota refusal (code 5) are
  now read.
- **Cube Matrix commands that must never reach it** are refused, debug
  services included: `set_default`, `set_adjust` on colour temperature
  (restarts the lamp), `set_segment_rgb`, `cron_*`, `get_prop` of its stored
  effects. Without SSDP its known 30 commands apply (no Cube Lite command is
  sent to it). The button playlist service is refused on a Cube Matrix: it
  wrote Cube Lite items into the lamp's memory.
- **Cube Matrix model and address:** a Cube Matrix slow to answer at a start
  was stored as a Cube Lite for good; now no answer is asked again (a Cube
  Lite is stored after 3 starts without one). A lamp moved to a new address
  by DHCP is followed from the address its Matter node reports, as it was
  from discovery (a usable address only: a Cube Matrix reports 0.0.0.0
  after a power-on); rediscovery also matches a lamp found through Matter
  by its MAC.
- **Cube Matrix effects:**
  - directions run the way chosen: the app's 13 effects and the other
    built-in ones take different direction values (filmed: Waterfall ran
    backwards and Palette trails across the lamp); the lamp turns its own
    effects for its rotation;
  - turned off, then on again, the lamp shows its effect again (the same
    effect was taken for a live change with nothing to change, and the lamp
    stayed dark);
  - a late report of the effect Home Assistant had started is no longer
    taken for the lamp's button (the light's effect went back to the
    previous one);
  - after a power cut, even a few seconds long, Home Assistant's content is
    shown again: the lamp's restart is seen in its Matter reboot count (the
    effect it starts with was taken for its button, and text or pictures
    never came back); text and pictures are watched like effects, and a
    lamp back after an outage is sent everything in full;
  - Lamp mounted turns the effect or clock the lamp shows at once: the
    lamp's rotation was written, but the lamp turns an effect only when it
    starts it, and nothing was sent again;
  - after a restart of Home Assistant the lamp's mounting is read from the
    lamp itself: Home Assistant's Matter data still held the rotation from
    before Home Assistant last wrote it, so the light showed the wrong
    Device Orientation and Lamp mounted could skip its write;
  - back after a power cut, the content is redrawn once Matter reaches the
    lamp again (its restart report), instead of redraw attempts that time
    out until then; a lamp that did not restart is left as it is (redrawn
    after 4 minutes when nothing is reported);
  - Freeze works: the Cube Lite's freeze command, which a Cube Matrix does
    not have, was refused and nothing froze. An effect or clock the lamp
    shows itself is replaced by a still picture of the frame held (a frozen
    clock keeps its time); a streamed one stops being sent. The cards offer
    Freeze on every effect, and on every clock style over a background;
  - Refresh sends the effect or clock again: unchanged, it was taken for a
    live change with nothing to change, and nothing was sent;
  - an effect in a color mode the lamp lacks (B&W, Vivid, Retro Orange,
    Tropical, Violet & Gold) or a palette, and every other streamed effect or
    clock, is streamed over Matter as the lamp's drawing, 25 frames a second:
    over the LAN the lamp shows about 5, which looked choppy next to its own
    effects; brightness changes then go over TCP, which leaves the stream
    alone;
  - a brightness change (and any other command sent on a short TCP
    connection) is no longer lost now and then: the connection was closed
    before the lamp had read it (2 of 6 lost); its answer is now waited for;
  - speed and direction changes are sent live: the effect goes on and is not
    saved to the lamp at every step;
  - Particle glows with a colour no longer has half its glows black, and no
    longer starts dim (sent twice, 0.15 s apart); effects drawn in colours
    get the Cube Lite's warm white for the colours not picked;
  - Sunrise and sunset at speed 0 shows its whole picture, as on a Cube Lite;
  - music effects are no longer listed on the cards (no microphone) and are
    refused with a clear message;
  - clock styles over a background (Rainbow, Waves, Spectrum, 11–14) are
    sent no colour, as the Yeelight app does, so the background keeps its
    colours; leaving the clock for something not saved clears it as the
    lamp's start-up effect, so a power cut no longer brings it back; in a
    half-hour time zone the clock is streamed (the lamp takes whole hours);
  - a drawing is sent no colour list; Scrolling bands never gets a
    speed its renderer cannot take (255).
- **Cube Matrix, from what the lamp was filmed or measured doing:**
  - Solid red and Centre bursts run on the lamp itself;
  - intensity is sent with the app's effects that take it (Starry Sky,
    Waves, Waterfall, Aurora, Bouncing Ball, Meteor, Building Blocks);
  - no speed control for the effects whose speed does nothing on a Cube
    Matrix (24, 33 and the backgrounds 54–59);
  - an effect or the clock started by the lamp's button or the Yeelight app
    is shown as the light's;
  - its firmware shows as `1.12.92` (was `92`), and a Repair asks to update
    one too old to take frames (before 1.11.57).
- **The clock's time and date alternate 6 s / 4 s** (was 5 s / 5 s), as the
  lamps' own clocks do, in the streamed clock and the card previews.
- **Cube Matrix still on its factory module list:** a Repair asks to set its
  modules in the Yeelight app, and its factory rotation is no longer taken as
  its mounting. A module list changed in the app is followed over Matter.
- Color mode buttons (Native Effects and Clock cards) no longer squeeze onto
  one line with their names broken letter by letter: each keeps its width
  and the row wraps, in every button style.
- **A lamp that stops answering is told apart:** the lamp's network part
  keeps accepting connections when the lamp itself has stopped handling
  commands, which only a power cycle fixes. Home Assistant took it for back
  online and kept redrawing; it now checks that the lamp answers, and a
  Repair (**stopped answering**) asks to turn its power off and on.
- **Animations and other Matter features come back sooner:** when a lamp
  did not answer the check of Home Assistant's Matter server (rebooting, or
  busy), it was checked again only 10 minutes later, and the animations stayed
  hidden meanwhile; now a minute later.
- **Fewer such stops:** a command the lamp must answer now waits until no
  frame was sent for 0.2 s (a command right after a run of frames is what
  stalls the lamp).

## [1.5.0] - 2026-11-07

### Fixed
- **Lamp mounted answers at once:** choosing it waited for the lamp's own
  direction to be written over Matter, up to its whole timeout when no server
  could deliver it (on every lamp of the card), so the buttons seemed stuck.
  The choice now applies and shows at once; the lamp's direction is written in
  the background, the clock started again once it is set, and the last choice
  always wins.
- **No blink when Lamp mounted changes:** the previews showed, for a moment,
  the picture turned for the new orientation in the old layout (the Native
  Effects and Clock cards, while the choice was being sent), or the clock's
  digits on the lamp's old mount profile (every clock preview, while the new
  one was written to the lamp). They now take the new layout and the profile
  the lamp is about to run at once.
- **A turned clock keeps its background in place:** when the lamp's mount
  turns its clock (Lamp mounted on Left or Up, through Matter), the lamp turns
  only the digits: the effect behind them stays where it is on the panel, so
  Fire still lights the same side. The previews turned the whole picture;
  they now turn only the digits, for every clock style.
- **Mirrored comets behind the clock looks like the lamp:** behind the clock
  the lamp ran it without its mirror: up to 17 comets cross the whole panel
  the same way, instead of each one and its twin meeting in the middle. The
  clock previews (Clock card, Lamp Preview, camera) now draw it so, and the
  style is renamed **Comet stream** for that look. The same goes for the
  Music noise equalizer clock, which the lamp shows mirrored left to right:
  it is now **Music flipped equalizer**. Every other clock background was
  checked: none differs that way. Both keep their id, and their former names
  (`Prism`, `51`) still select them.
- **Music noise equalizer previews the right way round:** its bars grew from
  the wrong edge or in the wrong row order in some directions (Left drew them
  mirrored, Right upside down). Every preview of it, effect or clock, now
  places them as the lamp does: Left and Right look the same on the lamp.
- **Album and Wheel previews move again:** in the Native Effects and Clock
  cards, the Live Preview Album and Wheel layouts showed still pictures; they
  are animated like the other layouts.
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
- **No more flash when the lamp's orientation changes:** a drawing, text or
  pixel art showed for a split second in the wrong place on the Lamp Preview
  card and the preview camera, then turned to where it belongs. The new
  orientation now comes with the picture turned for it, and the Lamp Preview
  card and the Draw card's drawing area draw it in place at once, also
  between a landscape and a standing mount (each dot used to fade from where
  it was in the other layout).
- **The Yeelight app no longer shows Ribbon for effects it does not have:**
  every effect that is not in the app (Violet twinkles, the music bars and
  the others) made the app show Ribbon as playing. They now run under an id
  the app does not use, so it shows none of its effects; they look the same
  on the lamp.
- **Previews follow a new palette at once:** loading a palette or editing the
  colors now updates the previews of effects and clocks in the Palette color
  mode straight away, without waiting for the lamp (which can take a moment,
  or refuse).
- **The Yeelight app's music effects are Official:** Music Spectrum, Gather,
  Breathing, Blossom, Note and Impact were marked Experimental; the app offers
  them. (The clock styles over them stay Experimental: the app's clock offers
  none of them.)
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

### Added
- **Palette color mode for effects and the clock:** the Native Effects and
  Clock cards' new **Palette** color mode (`color_mode: palette` in
  `set_native_effect` and `set_clock_style`) gives an effect or a clock the
  colors of the lamp's palette, the one loaded from the Palette card or set
  with `set_text_colors`, and follows it when it changes. It lists the effects
  and clock styles that take a color: one color for most (a plain clock style
  takes the first), as many as they draw for the multi-color ones (the palette
  repeated when shorter). Music Gather, Breathing, Blossom, Spectrum, Note and
  Impact take the whole palette, spread over the 16 colors of the lamp's
  microphone music mode, which they run as there (no speed or intensity in
  this mode). With a Matter server that sends Yeelight commands, they also
  run in the direction chosen, as soon as the lamp's microphone is on (no
  step at all when it is the direction they start in); otherwise in the
  lamp's own.
- **Stored GIF and four animations:** the lamp's **Stored GIF** effect is now
  on the cards and in the effect dropdown.
  Four animations made for the integration, **Snowfall**, **Daydream**,
  **Halloween glow** and **Moonlit clouds**, are uploaded to the lamp as its
  stored GIF and played. Uploading needs a Matter server that delivers the
  Yeelight commands; without one they are not listed. A GIF is uploaded only
  when the lamp does not hold it yet, laid out for how the lamp is mounted,
  and the Stored GIF effect's preview shows it. Effect rotations skip them.
  Each stands for one of the Yeelight app's four animations (Snowfall for
  Winter, Daydream for Dream, Halloween glow for Halloween, Moonlit clouds
  for Moonlight) and is played as the app plays it, so the app shows that one
  as playing (Stored GIF too, while the lamp holds one of them). The new
  **Native effect: Animation layout** select sends them upright (as drawn,
  the default) or as the Yeelight app sends its own GIFs, which the lamp
  shows rearranged; the previews follow it. The speed slider sets how fast
  they play (from about a quarter to four times as fast), and the Lamp
  Preview card's color adjustments (hue shift, temperature, saturation,
  vibrance, contrast, glow, grayscale, tint, invert) apply to them as to pixel
  art. The lamp plays a GIF at its own pace and in its own colors, so both are
  in the GIF: changing one uploads it again (a few seconds), and every
  preview shows them. Stored GIF itself is no longer listed on the cards or
  in the effect dropdown, as the four animations are picked instead; it
  still shows while it plays, and `set_native_effect` and the dropdown's
  `select_option` still take it by name.
- **Family icons on the effects:** each effect, in the Native Effects card's
  browser and in its favourites, shows its family's icon (a flame for Glow, a
  sparkle for Sparkles, a note for Music, waves, a play arrow for Motion, a
  picture for Still), the same icons as the family filter, colored like the
  card's buttons. It sits at the bottom right of each tile, below the preview
  (on the Official / Experimental line in the Original layout, after the name
  in the favourites, after the name in chips), and hovering it names the
  family. The dropdown and text buttons show the family's emoji after the
  name (🌊 🔥 ✨ ▶️ 🎵 🖼️). Two switches named **Show effect family icon**
  turn them off: the browser's (`show_family_icons`) and the Favourites
  section's (`favourites_show_family_icons`; without animated previews the
  icon is the favourite button's own). The Clock card shows them the same
  way for its styles (the family of the effect behind the digits; solid
  colors and custom styles are Still), with the same two switches, named
  **Show style family icon**.
- **Lamp mounted on the Clock card:** the same Right / Down / Left / Up
  buttons as the Native Effects card, shown when a Matter server that sends
  Yeelight commands lets them reach the clock of one of the card's lamps
  (`show_device_orientation` hides them).
- **Two clock styles started the other way:** **Mirrored comets** (style 83)
  and **Music noise equalizer** (style 84) run their effect as itself under
  the clock, so the clock shows it as the effect does: comets and their twins
  meeting in the middle, the equalizer the right way round. The effect's own
  set-up reaches the digits too: Mirrored comets shows only the hour and the
  colon, flipped and mirrored onto the other half (08:40 reads "08::80"), and
  the Music noise equalizer shows the time mirrored left to right. Comet
  stream and Music flipped equalizer remain for the other look, with the time
  as usual. Every preview draws each style, digits included, as the lamp
  shows it.
- **Intensity for effects and clock styles:** a new slider on the Native
  Effects and Clock cards, an **Effect intensity** number entity and an
  `intensity` field in `set_native_effect` and `set_clock_style`. What it
  changes depends on the effect: the number of glows (Aurora) or meteors, how
  often stars (Starry Sky) or drops (Waterfall) appear, the size of the waves,
  how strongly the music bars react, and more. Like the speed, it is one
  setting shared by all effects. Changing it restarts the effect. Its slider
  shows 💧 → 🌊, or 🔈 → 🔊 on a music effect.
- **Sliders show only when they do something:** speed and intensity appear
  only for an effect or clock style that uses them. The Clock card hides
  speed on solid color styles, and the Effect speed entity is unavailable
  there. To keep every slider in its place instead, turn on **Grey out unused
  sliders** (`slider_grey_out_unused`) in the card's slider settings: an
  unused slider is then shown greyed out and can't be moved.
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
  experimental effects. Which of them take
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
- **Type icons instead of labels:** Official, Experimental, Directional and
  Custom are small icons next to the family icon, named when you hover them,
  in every gallery layout (the Experimental 🧪 and Custom ✏️ emojis in the
  dropdown and text buttons). `show_badges` (**Show effect / style type
  icons**) hides them. In the Original grid and list and in the carousel they
  sit on the name's line when there is room.
- **Favourites show their color mode:** an icon (or the custom color's
  swatch) after the name, named when you hover it, instead of "(Normal)".
- **Normal is now Default** in the color modes.
- **Selected buttons look the same everywhere:** color modes, families, sort
  and the clock's content buttons get the selected halo the direction and
  Lamp mounted buttons have.
- **Effect direction and Lamp mounted are titled like the sliders:** the
  title above, on the left.
- **Shorter settings hints:** one sentence each.
- **The editors' long lists are folded:** effects, clock styles, official
  pixel arts, and the Arrange lists of your pixel arts and palettes show one
  line ("All 89 styles shown"); Customize opens the list, which scrolls
  instead of stretching the editor.
- The Clock card's gallery no longer has its own "Clock style" title, like
  the Native Effects card's.
- **No more Experimental Features switch:** every effect and clock style is
  offered, on the cards, in the dropdowns, in the services and in rotations.
  The switch is removed from each lamp's controls, with its setting and its
  notice in the card editors. The cards still mark the effects and styles the
  Yeelight app does not offer as Experimental.
- **Simpler slider settings, the same on every card:** the Native Effects,
  Clock and Lamp Preview sliders have fewer settings that do more.
  - **Ends** replace the step buttons and the Capsule's icons: each end is
    a slider's icon (🌙 ☀️, 🐢 ⚡, 💧 🌊, 🔈 🔊 for a music effect's
    intensity) or ➖ ➕, and tapping it steps the value. They sit beside the
    Slider and Bar and inside the Capsule.
  - **Step Size** is used by the ends, the mouse wheel and the Wheel style's
    stops (it replaces the Wheel Step).
  - **Value** (None, %, Device units) replaces Show Value, Show Raw Value
    and the Capsule's Value Display and Value Side; typing a value in the
    Capsule is gone.
  - **Thickness** (Thin, Medium, Thick) replaces the track thickness in
    pixels and the Slider's and Capsule's Thin / Thick.
  - **Rotary** dials sit side by side on the card's background, with no
    width or background setting.
  - Snap to Positions now works with every style.
  Older options are read as the new ones, so dashboards keep their look.
- **Speed:** the speed slider is called **Speed** on the cards, and the
  Animation speed entity is now **Effect speed**, beside Effect intensity.
  Its entity id is unchanged.
- **Speed, intensity and brightness go down to 0:** every effect takes speed
  0 and intensity 0 (the slider, the entities and the services). Intensity is
  still never sent below 13 on Aurora or below 1 on Palette stripes, where
  lower values hang or restart the lamp. A brightness slider at 0 turns the
  lamp off, and reads 0 while it is off. The sliders now run from 0 to 100 %
  in every style: drag to the start (on the Matrix, past its left edge, or tap
  its only lit cell).
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

## Older versions

Versions 1.3.6 and earlier are in [docs/CHANGELOG_ARCHIVE.md](docs/CHANGELOG_ARCHIVE.md).
