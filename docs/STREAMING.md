# How streamed effects reach the lamps

Some effects and clocks are drawn by this integration and sent to the lamp
frame by frame, 25 a second ("the stream", `light_studio.py`): the Palette
color mode, the integration's own effects (Knight Rider, Lava Lamp, Falling
Blocks), and on a Cube Matrix every effect it cannot run itself. This page
says which route those frames take and why, so that every streamed effect
behaves the same way.

## The routes, in order

| Lamp | 1st route | Fallback |
|---|---|---|
| Cube Lite | **Matter**: its drawing effect started with `setEffect` (effect 36, custom id 2000), then each frame's pixels with `setData`, one frame at a time, each acknowledged before the next | LAN UDP session (`update_leds` in direct mode), then TCP |
| Cube Matrix | **Matter**: the same drawing effect and `setData` | LAN music connection (5 frames a second) |

Matter is used when the lamp's Matter node is linked and Home Assistant's
Matter server delivers Yeelight commands (matterjs-server 1.5.4 or later). A
failed Matter frame (3 in a row) moves the stream to the LAN; Matter is tried
again a minute later, then less often (up to every 30 minutes). The route is
checked at every frame, so a stream moves between routes without restarting.

Every route sends the **same frame**: a Cube Lite's Matter frame is the
LAN frame (`_studio_payload`: the same renderers, colours, brightness stages
and power limit) with its pixels reordered for the drawing
(`device_profile.drawing_pixels`: column by column from the base, each column
from the bottom, where `update_leds` takes them row by row). Only the
transport differs. Never give one route its own drawing code.

## Why Matter first on the Cube Lite (2026-11-16, filmed)

| | Matter `setData` | LAN UDP `update_leds` |
|---|---|---|
| Acknowledged | Yes, by the lamp's network part (one frame in flight) | No |
| 60 s at 25/s | 1,499 of 1,499 acknowledged, median 32 ms | Frames arrive in bursts on Wi-Fi; on the bottom lamp 80% of datagrams were lost |
| On camera | 24.9 picture changes a second, no older picture shown again | Older pictures flashed back now and then |
| Same pixels, same colours | Yes (filmed side by side) | Yes |

The acknowledgement comes from the lamp's network part, not from the part
that drives the LEDs: a lamp stuck mid-stream still acknowledges frames it
cannot show. So the stream's check (`_stream_watchdog`, every 30 s) still asks
the lamp itself over the LAN (`set_scene keep`: filmed, it does not disturb a
Matter stream), and frames pause while it does not answer.

The weaker the lamp's Wi-Fi, the longer each acknowledgement takes: the
bottom lamp streams about 23 frames a second this way, the top one 25.

## What the integration must keep apart

- **Its own drawing is not another app's.** The Cube Lite reports effect 36
  for any drawing (the Yeelight app's too) and for the Right-as-Remote black
  slots (custom ids 1000-1007). The stream's drawing carries custom id 2000
  (`OWN_DRAWING_ID`); its reports are the stream's
  (`light_matter._own_stream_drawing_report`), any other effect or custom id
  means the lamp now shows something else, and the drawing is started again
  before any further `setData` (a `setData` never lands on someone else's
  drawing).
- **Direct mode and the drawing exclude each other.** Starting the drawing
  ends direct mode for new UDP sessions (`end_direct_mode`); LAN frames
  (`_entered_direct_mode`) forget the drawing.
- **A frame refused because the lamp left direct mode** ("illegal request",
  e.g. after a restart or a Matter command) opens a new UDP session, which
  puts direct mode back, at most every 2 s (`udp_session.FRAME_REFUSED_REOPEN`).
  Before this, a lamp whose effect was changed elsewhere refused every frame
  for half an hour while looking healthy.

## Previews show the frames sent

While a stream runs, the preview cameras and the Lamp Preview card show the
frame the lamp was last sent (`light_studio.streamed_preview_frame`; the
`yeelight_cube/stream_frames` websocket subscription for the cards), not their
own drawing of the effect, which started at another moment with other random
seeds. Without a recent frame (over 1 s old) they draw the effect themselves,
as before.

## Lessons (read before changing a transport)

1. **Look for an acknowledged path before tuning an unacknowledged one.**
   The Cube Lite's drawing effect and `setData` were known and used for the
   Cube Matrix while the Cube Lite was tuned for weeks on UDP (pacing, partial
   frames, re-sends), whose frames are never acknowledged.
2. **Every command known for one model is checked on the other.** When a
   capability is found on one lamp, test it on every model the same day, on
   camera, and write the result here or in `MATTER_COMMANDS.md`.
3. **One frame, several transports.** A route-specific renderer makes the
   same effect differ by route; reorder pixels, never redraw them.
4. **An acknowledgement is not a picture.** Keep a check that asks the part
   of the lamp that draws, and confirm new routes on camera.
5. **Each route reports itself.** `[STREAM DIAG] route=Matter|LAN` (see
   [Stream diagnostics](STREAM_DIAGNOSTICS.md)) tells which route a stream
   uses; a test of a new route is not over until the log shows it in use on
   both lamps.
