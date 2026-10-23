# Yeelight commands over Matter (for development)

The Cube Lite's Yeelight Matter clusters can do what LAN cannot:
- turn LAN Control back on;
- set the lamp's own direction;
- edit the button playlist;
- upload a GIF;
- read the running effect's settings.

Home Assistant's Matter server reads these clusters (`matter_link.py`), but
refuses to write them or send their commands until it knows the clusters.
The definition is proposed upstream:
[matter-js/matterjs-server#1199](https://github.com/matter-js/matterjs-server/issues/1199).

## In the integration: `matter_commands.py`

Each light has `light.matter_commands`, a `MatterCommands` channel, or `None`
before its Matter link starts. The channel finds a server that delivers the
commands to the lamp, in this order:

1. **Home Assistant's own Matter server**, once it knows the Yeelight
   clusters. The channel checks once with `getCurrentEffect`, a read-only
   command, and checks again when the server's version changes.
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
| Playlist | `getPersistEffectList`, `updatePersistEffectList` | `{index: 0-7, effect: {effectId, customId, effectParams: [{onoff: 1, mode}]}}`. The speed is not stored |
| Microphone music | `setMicMusicMode` | `{on: true, effectId: 83-88, palette: [16 ARGB]}`. The palette is required. `{on: false}` stops |
| GIF upload | `sendGifDataFragment` | 509-byte XMODEM packets (`[1, n, 255-n, 504 bytes padded 0x1a, CRC-16/CCITT-FALSE hi, lo]`), then `[4]`. Each answer must be `{status: 6}`. Play with `setEffect` effect 71 |

**GIF layout:** the lamp shows pixel n of the 20×5 image (row order) at
column n / 5, row n % 5 from the top. It plays GIFs with 16- or 256-colour
tables; a 4-colour one-frame GIF showed as all red.

**Safety:**
- Send exactly 4 colours per effect, and at most 16 per music palette. The
  firmware copies these lists into fixed buffers.
- Never send effects 41 or 43: they hang the lamp.
- Never use the update cluster (`0x1312FC11`).
