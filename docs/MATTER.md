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
- **To add it:** confirm. It appears within about 10 minutes of being
  added to Matter.
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
- **The lamp's orientation:** read from the lamp once it is confirmed, so
  native effects move the right way for any orientation, and the clock
  previews are turned as the lamp turns it: see
  [The lamp's orientation](#the-lamps-orientation).
- **Device Orientation** (with [Matter settings](#optional-matter-settings),
  from matterjs-server 1.5.4 with Home Assistant's own Matter server):
  changing it here also
  sets the lamp's own direction, which the lamp applies to the next clock or
  native effect it starts.
- **LAN Control turned off** in the app: a Repairs message tells you, since
  Home Assistant cannot reach the lamp until it is on again.

## The lamp's orientation

The lamp saves an orientation (the Yeelight app's orientation page: 0°, 90°,
180°, 270°, its arrows Left, Up, Right, Down) and turns every native effect's
direction by it. The integration sends each effect's direction compensated for
that orientation, so an effect moves the same way whichever is saved. The
firmware clock is drawn upside down for 0° and 90°: the previews and cameras
show it so. Only the app's **Save** or a Matter write sets it; nothing reads it
over the local network.

Over Matter the lamp reports the value, but a lamp never saved (or factory
reset) reads **0°** while it runs **270°**. So, on a lamp linked for the first
time (or paired again, as a new Matter node):
1. **Saved in the app:** a value only a save gives is the lamp's, read and
   followed, never overwritten: 90°, 180° or 270° (the lamp starts at 0°), or
   0° with the module layout the app's Save writes with it.
2. **Never saved** (0° without that layout): with Matter settings, the
   integration writes the lamp's orientation once, from **Device
   Orientation**, then follows the lamp's value.
3. **A change saved in the app later** is followed too, and **Device
   Orientation** follows it.
4. **Otherwise** (a read-only link to a lamp never saved): the orientation
   chosen in the lamp's **Configure** is used, as without Matter
   ([Set the lamp's orientation](../README.md#set-the-lamps-orientation-before-judging-effect-directions)).
   Until one is known, effects move as for 270°, what such a lamp runs.

Only a node the Matter server reaches counts: the node a factory reset left
behind (still listed, with its old values, unavailable) is ignored, on Home
Assistant's server and on any other one the integration reads.

**When you add the lamp**, its setup asks how it is mounted: choose **Read it
over Matter** if the lamp is (or will be) in Home Assistant's Matter
integration. Without Matter, a change made later in the app is not seen:
choose the new arrow in the lamp's **Configure**.

**After a factory reset** (both buttons held about 6 seconds): the lamp loses
its orientation and its Matter pairing. Pair it with Home Assistant's Matter
integration again (it becomes a new node, linked by its IP address as
before), then save the orientation in the app, or let the integration write
it (Matter settings), or set it in **Configure**.

The light's `mount_profile` attribute shows the known orientation (`profile`
0-3, or `null`), its `source` (`matter`, `user` or `unknown`) and the one in
use (`in_use`).

## Button events for automations

The **Lamp buttons** event entity
fires when the lamp changes by itself. Use it as a trigger like a Zigbee
remote (*When: Entity > Lamp buttons*):

| Event | Usually | Data |
| :-- | :-- | :-- |
| `right_button` | Right button, with **Buttons: Right as Remote** and Matter settings (see below): identifies a black playlist slot | `slot` |
| `effect_changed` | Right button (next effect of its playlist), left button held, or an app | `effect` (its name, when it's one of the native effects), `effect_id` |
| `turned_off` / `turned_on` | Power changes: the right button held, a click on a powered-down lamp, or an app | |
| `music_mode_changed` | Left button (a microphone music mode) | `mode` |
| `music_off` | Left button, long press | |

The lamp doesn't say *which* button was pressed, only what changed:
- **The Yeelight app:** picking an effect or a music mode there fires the
  same events.
- **This integration:** reports recognized as its own command echoes are filtered out.
- **Without Matter:** the entity is unavailable and never fires.
- **One press, two event types:** a right-button press fires `right_button`
  while **Buttons: Right as Remote** is active, and `effect_changed` otherwise.
  An automation meant for both cases triggers on both.

**Example: the right button toggles the room's light.** An event entity's
state is the time of its last event, so the automation triggers on any new
state and checks the event type:

```yaml
triggers:
  - trigger: state
    entity_id: event.cubelite_lamp_buttons
    not_from: [unavailable, unknown]
conditions:
  - condition: template
    value_template: "{{ trigger.to_state.attributes.event_type == 'right_button' }}"
actions:
  - action: light.toggle
    target:
      entity_id: light.living_room
```

Use `music_mode_changed` the same way for the left button. With **Buttons:
Wake Lamp When Off** off, these presses work while the lamp stays dark.

## Buttons as remote

> [!IMPORTANT]
> **Buttons: Right as Remote** needs Yeelight's Matter commands, which Home
> Assistant's Matter server knows from matterjs-server 1.5.4
> ([matter-js/matterjs-server#1203](https://github.com/matter-js/matterjs-server/pull/1203)).
> With an older server it shows `settings_unavailable` and right presses are
> only followed; the button events, **Buttons: Left as Remote** and
> **Buttons: Wake Lamp When Off** work either way. See
> [Optional Matter settings](#optional-matter-settings).

In this section, **your content** is what you chose in Home Assistant (a
clock, an effect, Music Flow, text or a drawing), and **followed** means
Home Assistant's controls change to show what the lamp now shows.

### Quick start

| You want | Switches |
| :-- | :-- |
| A remote that keeps your content: presses fire their events, the lamp goes back to your content | **Buttons: Right as Remote** and **Buttons: Left as Remote** on |
| A dark remote for automations (at night, for example): presses only fire their events | The same, and **Buttons: Wake Lamp When Off** off |
| Only the events: the buttons keep working as usual | None: the **Lamp buttons** entity fires anyway |

### The switches

Three switches under **Configuration**:

| Switch | Default | What it does |
| :-- | :-- | :-- |
| **Buttons: Right as Remote** | Off | Backs up the right button's playlist and replaces it with tagged black entries. A press fires `right_button`, then your content comes back. Needs [Matter settings](#optional-matter-settings); its `remote_status` attribute shows what it is doing. |
| **Buttons: Left as Remote** | Off | Undoes microphone music as soon as it starts or changes, whether from the left button **or an app**: your content comes back. Needs only the Matter link. |
| **Buttons: Wake Lamp When Off** | On | For the buttons that are a remote. **On:** a press on a lamp that is off turns it on with your content. **Off:** presses only fire their events and the lamp stays dark. See [When the lamp is off](#when-the-lamp-is-off). |

### What each press does

| Press | No remote | Right as Remote | Left as Remote | Both |
| :-- | :-- | :-- | :-- | :-- |
| Right | The next playlist effect, followed | Black blink, your content back | The next playlist effect, followed | Black blink, your content back |
| Left | Music, followed on top of your content | Music, followed on top of your content | Music flash, your content back | Music flash, your content back |
| Left, then right | The playlist effect replaces the music | The music stops, your content back | The playlist effect | Your content back |
| Left held | The lamp stops what runs and shows a plain colour or its last effect, followed | Same; the next right press brings your content back | Same: the switch can't catch a held press | Same; the next right press brings your content back |
| Right held | Power off or on, followed | Same | Same | Same |

- **A press always wins.** With its switch on, a press brings your content
  back even after another app showed something, so the lamp never stays
  black, or on music nobody chose. When that something is the Yeelight app's
  effect, colour, clock, animation or built-in pixel art, the press shows it
  again instead (see [Content from other apps](#content-from-other-apps)).
- **Music Flow you chose in Home Assistant** is your content too: a right
  press brings it back in its own mode, even if the left button switched the
  lamp to another preset.
- **A right press stops music:** the black entry also stops the microphone,
  reported about a second later. A microphone-off report within 2 seconds of
  a right press belongs to that press, so it fires no `music_off`.

### When the lamp is off

For a lamp turned off from Home Assistant:

| Press while off | Wake Lamp When Off on (default) | Wake Lamp When Off off |
| :-- | :-- | :-- |
| Right, with Right as Remote | The lamp comes on with your content | `right_button` fires; the lamp stays dark |
| Left, with Left as Remote | The lamp comes on with your content (not music) | A short music flash, then dark again |
| A button that is not a remote | Its own action (playlist effect, music), followed | Same |

- **With the switch on,** Home Assistant's "off" powers the lamp down after
  an effect, a clock or Music Flow. A click then powers it on by itself, with
  what it showed: it is followed, but reported only as `turned_on` (the lamp
  steps no playlist entry).
- **With the switch off,** "off" keeps the lamp powered with a black picture,
  as it already does for a drawing (about 0.4 W), so presses still reach
  Home Assistant.
- **A lamp powered down from its own button** (right held) or the Yeelight
  app always comes on at a click.

### Content from other apps

**Effects and music modes** picked in another app (or with the buttons) are
followed. **Drawings, clocks, colours and animations** are only shown on the
lamp: the reports carry IDs, not a copy of their pixels or settings, so Home
Assistant's controls keep their own settings. After one of these:
- The **Buttons: Right as Remote** switch's `remote_status` attribute shows
  `external_display`, and the integration stops redrawing by itself (its
  scrolling, rotation and pending display retries stop too).
- The next remote press, any content applied from Home Assistant, or **Force
  Refresh** brings your content back, except for the Yeelight app's content
  that can be shown again (below).

Some of the Yeelight app's content is reported with an ID that says what it
is. A remote press then shows that content again, not yours:

| Set in the Yeelight app | A remote press shows |
| :-- | :-- |
| An official effect | That effect, followed, as the app starts it (its own speed, colour and direction, not Home Assistant's direction for the mount). Changes saved in the app's effect editor are not reported |
| Winter, Dream, Halloween, Moonlight | The animation again: the lamp plays the one it stores (it may first show rainbow bands for a few seconds) |
| A clock | The same clock style, with its colours. The rest uses the **Clock** settings of Home Assistant (see below) |
| A built-in pixel art | The same picture, from the gallery of the lamp's direction, as in the app |
| A plain colour | The same colour |
| Your own drawings, community drawings | Your content: their pixels are on the phone and Yeelight's cloud only |
| Music from the phone | Your content: the phone streams it |

- **A clock's other settings** (time or date, the blinking colon, 12-hour
  time) are not reported. The app shows 12-hour time when the phone does (its
  24-hour setting), so a phone in 12-hour time and Home Assistant in 24-hour
  time give a clock that comes back in 24-hour time.
- **A colour picked again** (the one the lamp already had) is not reported:
  the press then brings back what was shown before.
- **Until Home Assistant shows something,** the app's content stays another
  app's display (`external_display`). Home Assistant forgets it when it
  restarts.

### Limits and what to expect

- **A short flash remains.** The lamp reacts to a press before Home
  Assistant hears of it, so restoration can only follow:

  | Button | What you may see | Why |
  | :-- | :-- | :-- |
  | Right | Black for a moment. Until the remote playlist is installed, the press's effect stays: it is followed, not undone | The button selects a playlist entry before restoration arrives. |
  | Left | A brief microphone-reactive animation (with **Buttons: Left as Remote**) | The button starts one of its fixed music presets. Nothing known turns this off, not even switching music off beforehand. |

  The lamp reports what a press changed, never the press itself. Firmware
  details: [Lamp buttons: firmware findings](MATTER_COMMANDS.md#lamp-buttons-firmware-findings).
- **Not a universal source detector.** A tagged entry identifies the remote
  playlist, not a physical input: another app replaying the same tagged
  entry produces the same event. Ordinary playlist selections cannot be told
  apart from app commands, and changes that produce no new Matter report, or
  an indistinguishable one, cannot be detected.
- **Power still works normally:** the right button's long press is followed.
- **Your playlist is backed up** before setup. Interrupted writes are
  retried without replacing that backup. The lamp only gives back each
  entry's ids, not a drawing's pixels: if your playlist holds drawings,
  check them in the Yeelight app after turning the switch off.
- **Turning Buttons: Right as Remote off** restores the original playlist.
  If Matter settings are unavailable, restoration waits until they return.
  Meanwhile a press on a black entry still brings your content back. Wait
  for `remote_status: disabled` before removing the integration.
- **If another app edits the playlist,** the integration does not overwrite
  it merely because it sees an unfamiliar effect. To reinstall the remote
  playlist, turn the switch off, wait for restoration, then turn it on again.
  The `set_button_effects` action edits the same playlist: use it with
  **Buttons: Right as Remote** off.
- **After a Home Assistant restart,** whether music was started on the lamp
  isn't known any more: a right press brings that music back instead.

<details>
<summary>Remote status values</summary>

The switch keeps your preference even while the feature cannot operate.

| `remote_status` | Meaning |
| :-- | :-- |
| `active` | The tagged playlist was installed and Matter reports are linked. |
| `external_display` | Another app showed an effect or a drawing: the integration doesn't redraw by itself until the next remote press or content applied from Home Assistant. A press shows the Yeelight app's effect, colour, clock, animation or built-in pixel art again ([Content from other apps](#content-from-other-apps)). Events remain available. |
| `settings_unavailable` | Reports are linked, but playlist setup is unavailable (Home Assistant's own Matter server today). Right presses are followed without restoration. |
| `setup_pending` | Playlist installation or interrupted setup is pending. |
| `no_playlist` | The lamp's playlist is empty: add effects to it in the Yeelight app. Checked again every minute. |
| `backup_missing` | The lamp still holds black slots from an earlier setup whose backup is gone (the integration was removed with the switch on). Nothing is written, so the lamp's playlist is never lost: reset it in the Yeelight app. Checked again every minute. |
| `matter_unavailable` | Remote mode is requested, but no Matter link is available. |
| `restoration_pending` | Remote mode is off, but the original playlist still needs restoration. |
| `disabled` | Remote mode is off and no restoration is pending. |

`active` records completed setup; it does not continuously verify a playlist
edited by another app. The status belongs to **Buttons: Right as Remote**,
independently of **Buttons: Left as Remote**.

</details>

## Optional Matter settings

Some features, including the black button playlist and writing the lamp's
orientation, need a Matter server that delivers Yeelight's own Matter
commands. **Home Assistant's Matter server delivers them from matterjs-server
1.5.4**, which knows them
([matter-js/matterjs-server#1203](https://github.com/matter-js/matterjs-server/pull/1203)):
the integration uses them as soon as the server knows them, with nothing to
change on your side.

Check the **Matter link** sensor: **Linked, settings available** means these
commands are available on your installation. A read-only link still provides
button events, **Buttons: Left as Remote** and **Buttons: Wake Lamp When
Off**, but cannot install the black playlist: **Buttons: Right as Remote**
then shows `settings_unavailable` and doesn't restore.

Normal clock, text, drawing and effect controls continue over LAN. For protocol
and developer details, see [Matter commands](MATTER_COMMANDS.md).

## Check the connection

The **Matter link** sensor shows *Linked, settings available*
when settings can be changed, and its attributes say which server delivers
them or why none does. The light's `matter` attribute shows the linked node,
what the lamp reports, and the same status:
- `"commands"` is the server that delivers them, or `null`;
- `"commands_unavailable"` says why not;
- `"app_content"`, while a remote press would show the Yeelight app's content
  again: the command that does it.

The diagnostics show the same. Matter's own light entity controls the same
lamp: you can disable it.
