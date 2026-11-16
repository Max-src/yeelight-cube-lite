# Stream diagnostics

Enable these loggers in Home Assistant (or use `logger.set_level` with the
same names and levels):

```yaml
logger:
  logs:
    custom_components.yeelight_cube.light_studio: info
    custom_components.yeelight_cube.lamp_client_udp: debug
    custom_components.yeelight_cube.lamp_client_tcp: debug
    custom_components.yeelight_cube.udp_session: debug
    custom_components.yeelight_cube.music_channel: debug
    custom_components.yeelight_cube.light_matrix: debug
```

After installing the changed integration, restart Home Assistant. Compare
Falling Blocks and Lava Lamp on the same lamp with the same brightness.
Keep the logs from activation through any freeze, including the next probe.

`[STREAM DIAG]` reports at startup, on status changes, every 30 seconds,
and when the stream stops. Counters are cumulative for that stream loop:

- `rendered`: frames prepared, including identical ones.
- `submitted`: completed frame-send calls; this excludes activation frames
  and transport-generated repeats. UDP frames have no acknowledgement, so
  this is not proof that the lamp displayed them.
- `unchanged`: frames intentionally skipped for Falling Blocks.
- `locked`: frame slots skipped because another command held the lamp lock.
- `unavailable`: slots held for a lost connection, TCP fallback, or silent lamp.
- `errors`: render or frame-send failures.
- `max_render_ms` / `max_send_ms`: longest successful render/send durations.

`route=Matter` identifies Matter drawing updates (the first route on both
models when Matter is available: see [How streamed effects reach the
lamps](STREAMING.md)); their `submitted` frames were acknowledged by the
lamp's network part, which still does not prove they were shown. `route=LAN transport=tcp`
means streaming is held while the ordinary TCP fallback is active.
`channel=UdpSession` is actual UDP; `channel=MusicChannel` is the Cube Matrix's
TCP music connection, which the existing transport API calls `udp`.

UDP statistics include actual frame submissions (including repeats), session
openings, time since the last received answer, and frame gaps. Gaps are expected
with Falling Blocks now; a large gap alone is not a failure. Cube Lite probe
logs record whether the lamp answered and how long the check took. Matter
send errors and LAN send errors identify their route explicitly.

Falling Blocks compares complete outgoing frames after color/brightness/power
processing and sends only changed frames. Automatic LAN repeats are disabled
for it. Activation and recovery can still resend a frame to restore the display.
The simulation continues at its usual rate; other effects and the off/standby
stream retain their existing cadence.

These logs can distinguish host render delays, lock contention, transport
fallback and failed commands. They cannot prove that an unacknowledged LAN
frame was displayed or rule out the lamp freezing its own picture when the
lamp continues answering probes.
