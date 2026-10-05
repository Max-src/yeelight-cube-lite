"""Estimated power draw of a Cube Lite, and limiting a frame to a wattage.

Fitted to USB power-meter readings of one lamp (5 V, 0.1 A resolution):
dark panel 0.4 W; 25 / 50 / 100 white pixels 2.75 / 4.5 / 6.1 W; 50 pure
red, green or blue pixels 3.0 W each; 100 red 5.0 W; plus pixel-art frames at
several brightness levels. The model matches them to about 0.2 W:

    power = BASE_W + SPAN_W * (1 - exp(-drive / SPAN_W))
    drive = sum over pixels of (PIXEL_W * brightest channel + CHANNEL_W * (R + G + B)) / 255
            x hardware brightness

A lit pixel costs about the same whatever its color (50 red = 50 blue), each
extra channel adds less, and the draw levels off near 6 W: a full-white panel
reads 6.1 W. See "Power Supply" in the README.
"""

import math

BASE_W = 0.4  # electronics, panel dark
PIXEL_W = 0.042  # per lit pixel at full value (its brightest channel)
CHANNEL_W = 0.028  # per channel (R, G or B) at full value
SPAN_W = 7.2  # the draw levels off towards BASE_W + SPAN_W
NO_LIMIT_W = 7.0  # power limit meaning "no limit": above any real frame


def panel_drive(frame, hardware_brightness: float = 100) -> float:
    """The panel's draw in W before it levels off."""
    total = sum(
        PIXEL_W * max(rgb[:3]) + CHANNEL_W * sum(rgb[:3]) for rgb in frame
    )
    return total / 255 * hardware_brightness / 100


def estimated_power(frame, hardware_brightness: float = 100) -> float:
    """Estimated draw of a lamp showing ``frame``, in W."""
    drive = panel_drive(frame, hardware_brightness)
    return BASE_W + SPAN_W * (1 - math.exp(-drive / SPAN_W))


def limit_frame_power(frame, max_watts: float, hardware_brightness: float = 100):
    """``frame`` scaled down uniformly so the lamp draws at most ``max_watts``.

    Returned unchanged when the limit is off (NO_LIMIT_W or more) or the
    frame is already within it. Scaling keeps every color's hue and the
    picture's shading; it only makes the frame darker.
    """
    if max_watts >= NO_LIMIT_W:
        return frame
    if estimated_power(frame, hardware_brightness) <= max_watts:
        return frame
    panel_watts = min(max(max_watts - BASE_W, 0.0), SPAN_W * 0.999)
    target_drive = -SPAN_W * math.log(1 - panel_watts / SPAN_W)
    factor = target_drive / panel_drive(frame, hardware_brightness)
    # Both terms of the drive scale with the pixel values, and rounding down
    # keeps the result within the limit.
    return [tuple(int(channel * factor) for channel in rgb[:3]) for rgb in frame]


class EnergyMeter:
    """Energy used, in kWh, from the estimated power over time.

    Each power reading holds until the next one (the Estimated power sensor
    only changes when what the lamp shows changes), so the energy of a span is
    the reading at its start times its length. A span with an unknown reading
    adds nothing. ``now`` is a monotonic clock in seconds.
    """

    def __init__(self, total_kwh: float = 0.0):
        self.total_kwh = total_kwh
        self._power = None
        self._since = None

    def update(self, now: float, power: float | None) -> float:
        """Count the energy since the last update, then hold ``power``."""
        if self._power is not None and self._since is not None and now > self._since:
            self.total_kwh += self._power * (now - self._since) / 3_600_000
        self._power = power
        self._since = now
        return self.total_kwh
