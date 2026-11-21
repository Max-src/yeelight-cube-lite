# Stream diagnostics

Enable these loggers in Home Assistant (or use `logger.set_level` with the
same names and levels):

```yaml
logger:
  logs:
    custom_components.yeelight_cube.light_studio: debug
    custom_components.yeelight_cube.lamp_client_udp: debug
    custom_components.yeelight_cube.lamp_client_tcp: debug
    custom_components.yeelight_cube.udp_session: debug
    custom_components.yeelight_cube.music_channel: debug
    custom_components.yeelight_cube.light_matrix: debug
```

After installing the changed integration, restart Home Assistant. Compare
Falling Blocks and Lava Lamp on the same lamp with the same brightness.
Keep the logs from activation through any freeze, including the next probe.

`[STREAM DIAG]` lines are at debug level: on status changes, every 30
seconds, and when the stream stops (info when it stopped on an error).
Counters are cumulative for that stream loop:

- `rendered`: frames prepared, including identical ones.
- `submitted`: completed frame-send calls; this excludes activation frames
  and transport-generated repeats. UDP frames have no acknowledgement, so
  this is not proof that the lamp displayed them.
- `unchanged`: renders not sent because they are the same as the last frame,
  with Skip Unchanged Stream Frames (never over Matter, where a steady
  cadence keeps the picture from pulsing).
- `paced`: a Cube Lite's renders not sent because the next new picture is
  not due yet under its Stream frame rate limit.
- `repeated`: a Cube Lite's last frame sent again on a beat with no new
  picture (Stream frame rate limit of 5 and under, Skip Unchanged Stream
  Frames off).
- `locked`: frame slots skipped because another command held the lamp lock.
- `unavailable`: slots held for a lost connection, TCP fallback, or silent lamp.
- `errors`: render or frame-send failures.
- `max_render_ms` / `max_send_ms`: longest successful render/send durations.

`route=Matter` identifies a Cube Matrix's drawing updates over Matter (see
[How streamed effects reach the lamps](STREAMING.md)); their `submitted`
frames were acknowledged by the lamp's network part, which still does not
prove they were shown. A Cube Lite always streams with `route=LAN`.
`route=LAN transport=tcp` means streaming is held while the ordinary TCP
fallback is active. `channel=UdpSession` is actual UDP;
`channel=MusicChannel` is the Cube Matrix's TCP music connection, which the
existing transport API calls `udp`.

A frame that fails (`Matter frame failed` / `LAN frame failed`, with the
route, the transport and the error) is a warning once per outage, then debug
until frames go through again, which is logged once at info. An
`Unsolicited error` from the lamp's UDP session (frames it refused) is a
warning once per episode, debug after that.

UDP statistics include actual frame submissions (including repeats), session
openings, time since the last received answer, and frame gaps. A large gap
alone is not a failure. Cube Lite probe logs (`[STREAM DIAG] ... Probe`,
debug) record whether the lamp answered and how long the check took.

When a Cube Lite's LAN check goes unanswered, it is asked over Matter
(`matter_controller_check`), and the log says which case it is:

- `The streamed lamp stopped answering ...; over Matter its network part
  says the LED part does not answer` (Matter answered "Failure"): only a
  power cycle brings it back.
- `...; its network part does not answer over Matter either (restarting?)`:
  the network part is restarting or off the network.

A Matter frame waits at most 2 s for its acknowledgement (5 s to start the
drawing); one that times out counts in `errors`, and three in a row move the
stream to the LAN for a while.

These logs can distinguish host render delays, lock contention, transport
fallback and failed commands. They cannot prove that an unacknowledged LAN
frame was displayed or rule out the lamp freezing its own picture when the
lamp continues answering probes.
