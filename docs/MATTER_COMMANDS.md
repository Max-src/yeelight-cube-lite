# Yeelight commands over Matter (for development)

The Cube Lite's Yeelight Matter clusters can do what LAN cannot:
- turn LAN Control back on;
- set the lamp's own direction;
- edit the button playlist;
- upload a GIF;
- read the running effect's settings.

Home Assistant's Matter server reads these clusters (`matter_link.py`), and
writes them and sends their commands from matterjs-server 1.5.4, which
knows the clusters
([matter-js/matterjs-server#1203](https://github.com/matter-js/matterjs-server/pull/1203)).
Older servers refuse them.

## In the integration: `matter_commands.py`

Each light has `light.matter_commands`, a `MatterCommands` channel, or `None`
before its Matter link starts. The channel finds a server that delivers the
commands to the lamp, in this order:

1. **Home Assistant's own Matter server**, once it knows the Yeelight
   clusters. The channel checks once with `getCurrentEffect`, a read-only
   command, and checks again when the server's version changes. A check
   the lamp doesn't answer is tried again 10 minutes later.
2. **A local development server**, only on a development install. Its module
   is not part of the repository.
3. **None.** The channel raises `MatterCommandsUnavailable`.

The light's `matter` attribute shows the server in use, as `"commands"`:
`"matter"`, `"dev"` or `null`.

**Rule for every feature built on it:** it must work, or stay out of the way,
when no server delivers. Users without Matter, and users of the official
server today, get `MatterCommandsUnavailable`:

```python
from .matter_commands import EFFECTS_CLUSTER, MatterCommandsUnavailable

channel = self.matter_commands
try:
    if channel is None:
        raise MatterCommandsUnavailable
    await channel.async_command(EFFECTS_CLUSTER, "setRate", {"rate": 200})
except MatterCommandsUnavailable:
    ...  # the LAN way, or the feature is not offered
```

- **Hiding UI:** to hide or disable a control, check
  `await channel.async_available()` (a cached check) and expose the result in
  an attribute.
- **Errors:** other errors (the lamp not answering, a refused value) reach
  the caller as usual.
- **Writes:** `async_write(path, value)` takes the attribute paths of
  `matter_link.py`, for example `LAN_CONTROL` and `ROTATION`.

`tests/test_matter_commands.py` covers the paths with fake servers: none, the
official server refusing, another server, a lamp not answering, and a user's
install without the development module. Add tests there for each feature's
fallback.

## Commands and formats

**Paths:**
- The clusters are on **endpoint 2**:
  - `0x1312FC01` = 320011265 (basic config);
  - `0x1312FC02` = 320011266 (cube control);
  - `0x1312FC05` = 320011269 (effects).
- Attribute and command ids are `0x1312xxxx`.

**Encoding:**
- Field names are the camelCase names of the cluster definition.
- Bytes are base64 strings.
- Integers are unsigned.

| Need | Command or attribute | Payload, notes |
| :-- | :-- | :-- |
| LAN Control on | write `2/320011265/319946753` | `true` |
| Lamp direction | write `2/320011266/319946753` | 0 Left, 1 Up, 2 Right, 3 Down. Applied to the next effect started |
| Start an effect | `setPresetsEffect` | `{apply: 1, effectId, rate?, direction?, color?}` |
| Effect, all settings | `setEffect` | `{apply, effect: {effectId, customId, effectParams: [{mode, speed, direction, color, data, mixer}]}}` |
| Live changes | `setRate`, `setDirection`, `setMixer`, `setData` | `{rate}`, `{direction}` (0 up, 1 down, 2 left, 3 right), `{mixer}`, `{data}` |
| Drawing | `setEffect`, effect 36, apply 2 | `data`: 400 bytes, 100 × (0xff, R, G, B), column by column from the left, each from the bottom row |
| Read running effect | `getCurrentEffect` | Returns `{effect: {...}}` |
| Playlist | `getPersistEffectList`, `updatePersistEffectList` | `{index: 0-7, effect: {effectId, customId, effectParams: [{onoff: 1, mode}]}}`. The speed is not stored. A read returns only `effectId` and `customId` per slot, even for a drawing: its pixels cannot be read back |
| Microphone music | `setMicMusicMode` | `{on: true, effectId: 83-88, palette: [16 ARGB]}`. The palette is required. `{on: false}` stops |
| GIF upload | `sendGifDataFragment` | 509-byte XMODEM packets (`[1, n, 255-n, 504 bytes padded 0x1a, CRC-16/CCITT-FALSE hi, lo]`), then `[4]`. Each answer must be `{status: 6}`. Play with `setEffect` effect 71 |

**GIF layout:** the lamp shows pixel n of the 20×5 image (row order) at
column n / 5, row n % 5 from the top. It plays GIFs with 16- or 256-colour
tables; a 4-colour one-frame GIF showed as all red.

**The integration's animations** (`lamp_animations.py`,
`light_native._store_animation`) follow these rules:
- **Files:** 256-colour global table, full frames, looping, at most 32 KB
  (the lamp's GIF area).
- **Packets:** one per command. Each waits for its answer, and anything but 6
  stops the upload without `[4]`, which would store the part sent.
- **After an interrupted upload:** the lamp stores the next one corrupted, so
  the next upload is sent twice; the second goes to its other, clean area.
- **Uploading only when needed:** the lamp writes the GIF to its memory, so it
  is uploaded only when the lamp does not hold that animation for its mount.
- **Without a server:** the animations are not offered.

**Music effects in the Palette color mode** (`light_native._send_music_direction`):
the microphone music mode starts in the lamp's own direction, so the
direction chosen follows with `setDirection` as soon as the lamp reports its
microphone on (`mic_music_on`), or 1.5 s after the music starts without that
report (the microphone already ran); nothing when it is the one the music
starts in. Sent at once, some modes (Impact) stop. A LAN `update_fx_effect` is never
used for this: the lamp turns the microphone off a few seconds later and
shows its saved effect. Without a server, the music runs in the lamp's own
direction.

**Safety:**
- Send exactly 4 colours per effect, and at most 16 per music palette. The
  lamp keeps these lists in fixed-size buffers.
- Never send effects 41 or 43: they hang the lamp.
- Never use the update cluster (`0x1312FC11`).

## Lamp buttons

Other lamp versions may differ.

- **No press events.** The lamp sends no button notifications on LAN, idle
  TCP or SSDP. Matter mirrors what a press changed (effect and custom ids,
  microphone on/off and mode, power): the consequence of a press, reported
  after the lamp has already reacted, never the press itself.
- **Right button.** It steps through the persistent playlist above, which can
  be edited. *Buttons: Right as Remote* writes all-black drawings there with
  custom ids 1000-1007; the lamp reports the slot's custom id on every press,
  together with effect 36 (within a millisecond on a Cube Lite).
- **Left button.** A press turns the microphone on and loads one of the
  lamp's fixed music presets (effects 83, 84, 85, 86, 88). Turning music off
  beforehand does not disable it, there is no remapping or disable setting,
  and a custom all-black music palette does not replace these presets.
  Non-music effects turn the microphone off again, but the next press turns
  it on.
- **Restoration timing.** The black (or music) interval after a press is the
  Matter report, the command queue and the LAN redraw, not a deliberate
  sleep. The clock and direct-mode settle delays stay: removing them lost
  activations and frames on the lamp.
