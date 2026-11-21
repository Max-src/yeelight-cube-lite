# How streamed effects reach the lamps

Some effects and clocks are drawn by this integration and sent to the lamp
frame by frame ("the stream", `light_studio.py`): the Palette color mode,
the integration's own effects (Knight Rider, Lava Lamp, Falling Blocks), and
on a Cube Matrix every effect it cannot run itself. Pictures (text,
drawings, gradients, scrolling text) take the same route. This page says
which route those frames take and why, so that everything drawn by the
integration behaves the same way.

## The routes

| Lamp | Route |
|---|---|
| Cube Lite | **LAN UDP session, `update_leds` in direct mode, paced**: a frame when the picture changed, on a schedule 0.2 s apart (`LITE_LAN_GAP`, scaled by the lamp's Stream frame rate limit; `stream_routes.LanPacer`: the limit is met exactly over time, two frames in a row at most one 40 ms render closer than the gap), at a limit of 5 and under exactly that many frames a second: the new picture, else the last one again (left out with Skip Unchanged Stream Frames), never a new picture right after a repeat; held while only TCP works |
| Cube Matrix | **Matter**: its drawing effect (`setEffect`, effect 36) then each frame's pixels with `setData`, every render (25 a second); the LAN music connection (about 5 frames a second) while Matter is not available |

Every route sends the **same frame** (`_studio_payload`: the same renderers,
colours, brightness stages and power limit, drawn and encoded in one
executor job per frame), reordered for the drawing when it goes there.
Never give one route its own drawing code.

The routes live in `stream_routes.py` (`MatterStreamRoute`,
`LanStreamRoute`, with `LanPacer` for a Cube Lite's pace and `StreamDiag`
for the counts and log lines); `light_studio._studio_loop` picks the route
before every frame.

## Why a Cube Lite gets paced LAN frames (17 Nov 2026)

- **Matter dims a Cube Lite at every frame.** Its `setData` (like `setEffect`
  and the LAN `update_fx_effect`) installs its drawing again, and every
  install restarts its brightness limiter at half scale (filmed: the picture
  drops and climbs back at each frame). At 8 or 12.5 frames a second that is
  a visible blink on slow, dim backgrounds; at 25 its LED part restarts by
  itself within minutes. The Cube Matrix swaps its drawing's data in place:
  it does not blink. A Cube Lite therefore never streams over Matter.
- **LAN direct mode shows every frame cleanly, at full brightness** (no
  install), and its old problem was the frame rate: frames 40 ms apart left
  a lamp stuck about once in 5 stream ends (two frames reaching its LED part
  back to back cross the 1,024 bytes its serial link takes at once; the Wi-Fi
  part then resends what was lost in one burst at the first pause). **At a
  frame every 200 ms: 0 stuck in 50 stream ends** on both lamps.
- **The last frame is sent again before 300 ms** (0.2 s for a stream,
  `LITE_LAN_RESEND`; 0.25 s for the transport's own re-sends,
  `lamp_client_udp.STREAM_KEEP_BUSY`, above the text scroll's 0.2 s step).
  After 300 ms without a frame the Wi-Fi part sends again, in one block,
  every frame the LED part has not confirmed: an old picture shows for a
  moment, and two or more cross the 1,024 bytes. Kept under 300 ms, that
  happens only at a stream's end, not at every delay on the network.
- So a Cube Lite gets as few frames as the effect needs: Falling Blocks only
  when a piece moves, Lava Lamp about 5 a second.
- **Each Cube Lite's Stream frame rate limit** (a number, 1-25, default 2,
  `const.LITE_STREAM_FPS_DEFAULT`; `light_studio._lite_lan_gap`,
  `LITE_LAN_GAP` being the gap at `LITE_LAN_GAP_FPS` = 5) sets the frames a
  second. At 5 and below the lamp gets exactly that many: the new picture,
  else the last one again on the same beat (until 21 Nov 2026 the last
  picture also went every 0.2 s between new ones, so every limit under 5 was
  5 frames a second on the lamp). Above 5, frames come closer than the 0.2 s
  measured safe: smoother, with a higher chance of a stuck lamp (about 1
  stream end in 5 at 25).
- **Why 2 by default (night of 20-21 Nov 2026, two Cube Lites, filmed):**
  2 and 3 frames a second (Skip Unchanged Stream Frames on), 2 hours on each
  lamp at each rate, then 3 a second with it off (the last picture repeated
  on the beat), 2 hours on each: no hang, no camera freeze, no network-part
  restart. The repeats are not the risk; the rate is.
  5 frames a second (skip off): each lamp's LED part froze within 100
  minutes (after 66 and 91 minutes), and bringing it back over the LAN
  failed both times: only a power cycle helped. Fast pings (25 a second)
  showed no network trouble before the freeze. Earlier, about 19 lamp-hours
  at 1 a second: no hang.
- **Skip Unchanged Stream Frames** (a Cube Lite's switch, off by default;
  `light_studio._skips_unchanged_frames`): a frame the same as the last one
  sent is not sent, not even as the `LITE_LAN_RESEND` repeat; new pictures
  still keep to the frame rate limit, which becomes a maximum. While the
  picture holds still the lamp gets no frames: every pause is like a stream's
  end, when a Cube Lite can hang, and one longer than about 0.8 s makes it
  save what it shows. The black standby frames are still sent.
- **Every LAN frame carries the whole picture.** Frames cut after their last
  changed pixel were tried (Falling Blocks): at 25 a second a Cube Lite now
  and then showed an older picture for a moment, so they were dropped.
- **Tried and dropped: a repeating effect as the lamp's stored GIF.** It
  played smoothly, but only effects that repeat exactly within 24 s
  qualified, each new speed or colour meant a new upload, and the stored
  animations share the lamp's GIF areas. Streamed effects stay streamed;
  the lamp's stored GIF is for animations (`lamp_animations`).

## Measured on two Cube Lites (night of 16-17 Nov 2026, filmed)

| | Matter (`setData`) | LAN UDP (`update_leds`, frames 40 ms apart) |
|---|---|---|
| Lamp stuck after a stream ended (90 s streams, 30 each) | **0 of 30** | **7 of 30** (power cycle needed for 6) |
| Frames failed | 0 of ~50,000 | not acknowledged |
| Network part restarting during streams | rare | 3 times in 45 min |

Matter looked safer for stream ends, but dims every frame (above); the LAN
at a frame every 0.2 s at most ended 50 streams without a stuck lamp.

- **The Matter check of the LED part.** `getPersistEffectList` over Matter
  goes through the network part to the LED part: a working lamp answers in
  0.1-0.25 s, a stuck one answers "Failure" in about 0.6 s, a lamp whose
  network part restarts does not answer. The stream's check uses it, for
  its log, when the LAN check fails (`light_matrix.matter_controller_check`).
- **Over Matter the LED part sometimes restarted by itself**, more often the
  higher the frame rate (at 25 a second, 15 resets in 80 lamp-minutes; at 10
  a second none in 25 minutes); never in 45 minutes of LAN streaming.
- **Each new picture fades in again over Matter** (filmed 17 Nov): every
  `setData` (even the same pixels) drops the drawing to about 74% at once,
  then it climbs back over about 3 s. On a Cube Matrix a steady cadence
  holds the picture: every frame is sent over Matter, unchanged ones too.
- **Ending a LAN stream with a Matter drawing does not prevent the hang**
  (17 Nov, 58 stream ends): as often stuck as stopping alone. The Wi-Fi part
  keeps up to 10 frames the LED part did not acknowledge and, at the first
  300 ms without a send, resends them in one gap-less burst; a run of 1,024
  bytes or more can leave the LED part's serial link misaligned for good. A
  LAN frame is 535 bytes, so two together already cross it: hence the pace.
  The Cube Lite has no music connection (`set_music` is not answered) and
  its plain TCP takes about 54 commands a minute.
- **Brightness.** Every `set_bright`, even of the same value, halves the
  light at once and brings it back over about 6 s. The lowest brightness
  (1%) is about as bright as pixels at 24-40 of 255 at full brightness:
  darker content needs darker pixels.
- **The lamp's own drawing animations** (mixer 2 sliding, 3 breathing, 4
  flashing, 5 building up) run on the Cube Lite as on the Cube Matrix: a
  picture can move with no stream.
- **Wi-Fi diagnostics over Matter** give the signal strength only (both lamps
  around -50 dBm): the bottom lamp's poor link is its access point, not its
  signal.

## One path for every streamed frame

Every streamed effect and clock (any effect, colour mode, the off/standby
black frames) goes through the one loop (`light_studio._studio_loop`) and the
one sender per route: `light_matrix._send_matrix_stream_frame` over Matter
(the Cube Matrix), `update_leds` in the UDP session over the LAN (the Cube
Lite, paced; the Cube Matrix's fallback). The loop decides the route at each
frame (`matrix_streams_over_matter`) and applies the same rules to every
effect: a steady cadence over Matter (unchanged frames too), the pace on a
Cube Lite's LAN, a lamp whose checks go unanswered is held, a failed frame is
retried shortly (logged as a warning once per outage, at debug level after
that). Freeze pauses the loop (the lamp keeps its last frame) on both
routes. Do not add an effect-specific sender or a shortcut around the loop.

A stream that stops on an unexpected error starts again after 2 s, twice as
long after each crash in a row (up to 60 s), from the render after the last
one shown; a black standby stream (Keep Streaming When Off) stays on standby
through it.

**Pictures take the same route** (`light_matrix.draws_over_matter`): a still
picture (text, drawing, pixel art, gradient, colour: `light_display.apply`)
is a Cube Matrix's drawing over Matter, and each step of a scrolling text
that drawing's new pixels; on a Cube Lite, a frame in direct mode over the
LAN (a scroll step every 0.2 s or more; the transport's re-sends 0.25 s after
the last step).

Not part of the stream, on purpose: **Music flow** keeps the LAN music
connection (it carries the lamp's microphone data).

## Checks while a Cube Lite streams

- **The stream's check** (`light_studio._stream_watchdog`) asks the lamp
  every 30 s for an answer of its own (`set_scene keep`), every 5 s while it
  is silent; frames pause after 3 unanswered checks in a row. Only the
  question in the UDP session holds the lamp's lock (no frame goes with it);
  the TCP question that follows an unanswered one, the Matter check and the
  problem check run without it, so frames go on meanwhile.
- **The connection's health check** (every 10 s in an effect or clock mode)
  leaves a streaming lamp alone: the stream's own check covers it.
- **A stuck lamp being brought back over the LAN** (`light_link_recovery`):
  the sweep holds the lamp's lock for up to about a minute; meanwhile other
  operations fail at once (as when the lamp is not reached) instead of
  waiting, and the lamp's content is drawn again once it is back.

## What the integration must keep apart

- **Its own drawing is not another app's.** On a Cube Matrix, a reported
  effect that is neither what Home Assistant last started nor within a
  command's echo window means the lamp now shows something else
  (`light_matrix_follow`), and the drawing is started again before any
  further `setData` (a `setData` never lands on someone else's drawing).
- **Direct mode and the drawing exclude each other.** LAN frames
  (`_entered_direct_mode`) forget the drawing; a Matter drawing closes the
  music connection first.
- **A frame refused because the lamp left direct mode** ("illegal request",
  e.g. after a restart or a Matter command) opens a new UDP session, which
  puts direct mode back, at most every 2 s (`udp_session.FRAME_REFUSED_REOPEN`).
  Before this, a lamp whose effect was changed elsewhere refused every frame
  for half an hour while looking healthy. Refused frames are logged as a
  warning once per episode, at debug level after that.

## Previews show the frames sent

While a stream runs, the preview cameras and the Lamp Preview card show the
frame the lamp was last sent (`light_studio.streamed_preview_frame`; the
`yeelight_cube/stream_frames` websocket subscription for the cards), not their
own drawing of the effect, which started at another moment with other random
seeds. Without a recent frame (over 1 s old) they draw the effect themselves,
as before.

## Lessons (read before changing a transport)

1. **Look for an acknowledged path before tuning an unacknowledged one**, and
   check what it does to the picture: Matter's acknowledged frames dim a Cube
   Lite at every frame.
2. **Every command known for one model is checked on the other.** When a
   capability is found on one lamp, test it on every model the same day, on
   camera, and write the result here or in `MATTER_COMMANDS.md`.
3. **One frame, several transports.** A route-specific renderer makes the
   same effect differ by route; reorder pixels, never redraw them.
4. **An acknowledgement is not a picture.** Keep a check that asks the part
   of the lamp that draws, and confirm new routes on camera.
5. **Each route reports itself.** `[STREAM DIAG] route=Matter|LAN` (debug
   level, see [Stream diagnostics](STREAM_DIAGNOSTICS.md)) tells which route
   a stream uses; a test of a new route is not over until the log shows it in
   use on both lamps.
