# Button restoration and visible flashes

[Matter setup and button automations](MATTER.md) / [Back to the README](../README.md)

Right-button remote mode restores the integration's display after a tagged
playlist selection. Left-button restoration is a separate opt-in that also
intercepts music changes from apps. It cannot stop the
lamp from reacting first, so a short interruption can remain.

| Button | What you may see | Why |
| :-- | :-- | :-- |
| Right | A black flash when the remote playlist is installed; otherwise a brief effect | The button selects a playlist entry before restoration arrives. |
| Left | A brief microphone-reactive animation | The button starts one of its fixed music presets. Switching music off beforehand does not disable the button. |

There is no supported setting known to prevent the left-button animation.
Normal display controls do not require Matter; button detection does. Ordinary
external effects are accepted, and restoration pauses until the integration
controls the display again. See [external control](MATTER.md#other-apps-stay-in-control).

<details>
<summary>Technical findings and restoration timing</summary>

The following findings come from reverse-engineering MCU v34 and Cube Lite
firmware 1.12.32. They do not establish identical behaviour for every version.

## What can be prevented

The right button selects an editable persistent playlist. Remote mode replaces
its entries with black drawings, then restores the integration's display.
The brief black interval includes Matter reporting, command queueing and LAN
restoration; it is not just an intentional sleep in the integration.

The left button uses the active key handler `0x01e31de0`, calling
`0x01e31c08`. That routine first calls microphone capture start `0x01e31b8a`,
then selects the fixed five-entry table at `0x01e3f6f4`: 83, 84, 85, 86, 88.
It loads a preset and posts the activation. Turning music off beforehand
does not disable this button action. No supported remapping or disable
setting was found. A custom all-black Music Flow palette has not been shown
to replace the presets loaded by this physical-button path.

Earlier analysis suggested capture might run until a power cycle. Later
execution of the decoded first-render path showed that non-music renderers
tear capture down through `0x01e3205a`. This still does not provide a persistent
microphone lockout; the button starts capture again.

## Detection and restoration

Listening experiments found no button notifications on LAN, idle TCP or
SSDP. Analysis of the firmware bridge identified state mirrored to Matter: effect/custom IDs and microphone on/off/mode. These are consequences
of the local action, not a raw press event that can cancel it in advance.

The integration reacts to microphone-on without waiting for the effect ID.
Its echo filter now matches expected microphone commands instead of ignoring
that report after unrelated commands. Normal music starts are still protected
against being mistaken for physical presses while their command is in flight.

Remote restoration reapplies the unchanged desired music state without an
immediate storage save before the redraw. Actual user changes still persist
for restart recovery. This removes avoidable disk I/O, but the visible latency
improvement has not been measured on hardware.

The clock and direct-mode settle delays remain: existing hardware findings
associate removing them with lost activations/frames. Further reductions need
timed lamp tests across clock, effects, drawings and both transport paths.
No new Matter command capability is required by these optimizations; devices
without Matter keep normal LAN display behaviour.

</details>
