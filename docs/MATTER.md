[Back to the README](../README.md)

# Matter and lamp buttons (optional)

The integration controls the lamp over your local network (LAN Control) and
needs nothing else: Matter is an optional extra. Lamps without it work as
before.

## Link your lamp

 The Cube Lite is also a Matter device. Add it to Home
Assistant's own **Matter** integration (Settings > Devices & services > Add
integration > Matter, then add the device with its Matter pairing code, or
share it from the Yeelight app). The integration finds it and links it to the
same lamp by its IP address, then by its MAC address:
- **Either order works.** It doesn't matter whether Matter or this
  integration was set up first.
- **Nothing to set up.** The link is checked every minute, so a lamp added
  to Matter later is linked within a minute.
- **No re-pairing on IP changes.** A new IP address is found again by the
  MAC address.
- **Where to check it:** the lamp's **Matter link** sensor (Diagnostic)
  shows whether it's linked.

**A lamp only in Matter.** Suppose a Cube Lite is in Home Assistant's Matter
integration but not set up here, and at least one other lamp is. It then
appears under **Settings > Devices & services > Discovered** as *Yeelight
Cube Lite found via Matter*, with its address filled in:
- **To add it:** confirm.
- **If it doesn't answer on your network:** the dialog asks you to turn on
  **LAN Control** in the Yeelight app, then you can try again.
- **Your first lamp:** it's found by the usual local network discovery
  instead.

## What the link adds

- **The lamp's buttons:** an effect from the right button's playlist and the
  left button's microphone music modes (and its long press) show at once in
  **Content mode**, **Native effect** and **Music Flow effect**, and stop a
  running effect rotation.
- **The Yeelight app:** an effect picked in the app is followed the same way,
  and a direction set in the app changes **Device Orientation** (its arrows
  are the app's).
- **Power and brightness:** the lamp switched off with its button (long
  press on the right one) or on and dimmed from the app shows so here.
- **The clock and native effects:** the lamp's direction setting turns what
  its firmware draws (Left and Up: upside down); the previews and cameras
  show it as the lamp draws it.
- **LAN Control turned off** in the app: a Repairs message tells you, since
  Home Assistant cannot reach the lamp until it is on again.

## Button events for automations

The **Lamp buttons** event entity
fires when the lamp changes by itself. Use it as a trigger like a Zigbee
remote (*When: Entity > Lamp buttons*):

| Event | Usually | Data |
| :-- | :-- | :-- |
| `right_button` | Right button, with **Right button as remote** and Matter settings (see below): identifies a black playlist slot | `slot` |
| `effect_changed` | Right button (next effect of its playlist) | `effect` (its name, when it's one of the native effects), `effect_id` |
| `turned_off` / `turned_on` | Power changes (button or app) | |
| `music_mode_changed` | Left button (a microphone music mode) | `mode` |
| `music_off` | Left button, long press | |

The lamp doesn't say *which* button was pressed, only what changed:
- **The Yeelight app:** picking an effect or a music mode there fires the
  same events.
- **This integration:** reports recognized as its own command echoes are filtered out.
- **Without Matter:** the entity is unavailable and never fires.

## Buttons as remote

There are two independent switches under **Configuration**:

| Switch | Default | What it does |
| :-- | :-- | :-- |
| **Right button as remote** | Off | Installs tagged black playlist entries, fires `right_button` when one is selected, then restores the integration's display. Requires Matter settings support to install the playlist. |
| **Restore after music changes** | Off | Restores after microphone music starts or changes, whether from the left button **or an app**. Requires Matter reports; no playlist settings support is needed. |

Existing **Buttons as remote** settings keep their saved preference and entity
ID; the displayed name becomes **Right button as remote**. Music restoration
is now a separate opt-in, so ordinary music commands from apps work by default.

### Other apps stay in control

Normal external effects, drawings and music changes are accepted. They do not
trigger a restore or a playlist rewrite. The integration stops its scrolling,
rotation and pending display retries when an external effect is reported.
The optional music-restoration switch deliberately overrides this for music.

Reports contain effect IDs, not a complete copy of an app's drawing, colours,
speed or other settings. After external control, `remote_status` shows
`external_display`: tagged selections still fire events, but the integration
will not restore its older content. Apply a clock, effect, drawing or text
from this integration again (or use **Force refresh**) to resume restoration.
The cards may still show the last requested settings for content they cannot
reconstruct.

This is not a universal source detector. A tagged entry identifies our remote
playlist, not a physical input: another app replaying the same tagged entry
can produce the same event. Ordinary untagged playlist selections cannot be
reliably distinguished from app commands. Changes that produce no new Matter
report, or an indistinguishable report, cannot be reliably detected either.

### What to expect and how to turn it off

- The right button briefly shows black before restoration. Music restoration,
  when enabled, can briefly show a music animation. See
  [visible flashes and firmware limits](BUTTONS_REMOTE.md).
- Power still works normally: the right button's long press is followed.
- The original playlist is backed up before setup. Interrupted writes are
  retried without replacing that backup.
- Turning **Right button as remote** off restores the original playlist.
  If Matter settings are unavailable, restoration waits until they return.
  Wait for `remote_status: disabled` before removing the integration.
- If another app edits the playlist, the integration does not overwrite it
  merely because it sees an unfamiliar effect. To reinstall the remote
  playlist, turn the switch off, wait for restoration, then turn it on again.

<details>
<summary>Remote status values</summary>

The switch keeps your preference even while the feature cannot operate.

| `remote_status` | Meaning |
| :-- | :-- |
| `active` | The tagged playlist was installed and Matter reports are linked. |
| `external_display` | Another app took control. Events remain available, but the integration will not restore stale content. |
| `settings_unavailable` | Reports are linked, but playlist setup is unavailable. Untagged changes are followed without restoration. |
| `setup_pending` | Playlist installation or interrupted setup is pending. |
| `matter_unavailable` | Remote mode is requested, but no Matter link is available. |
| `restoration_pending` | Remote mode is off, but the original playlist still needs restoration. |
| `disabled` | Remote mode is off and no restoration is pending. |

`active` records completed setup; it does not continuously verify a playlist
edited by another app. Status belongs to the right-button switch, independently
of the music-restoration preference.

</details>

## Optional Matter settings

Some features, including the black button playlist and writing the lamp's
orientation, need a Matter server that supports Yeelight's vendor commands.
Check the **Matter link** sensor: **Linked, settings available** means these
commands are available on your installation. A read-only link still provides
button events and display restoration, but cannot replace the playlist.

Normal clock, text, drawing and effect controls continue over LAN. For protocol
and developer details, see [Matter commands](MATTER_COMMANDS.md).

## Check the connection

 The **Matter link** sensor shows *Linked, settings available*
when settings can be changed, and its attributes say which server delivers
them or why none does. The light's `matter` attribute shows the linked node,
what the lamp reports, and the same status:
- `"commands"` is the server that delivers them, or `null`;
- `"commands_unavailable"` says why not.

The diagnostics show the same. Matter's own light entity controls the same
lamp: you can disable it.
