"""The light's estimated power: what the Estimated power and energy sensors show.

Owns PowerEstimateMixin: the estimated draw (estimated_power,
power_estimate_source) from the frames the integration sends, or, while the
lamp draws the matrix itself (clock, native effect, Music Flow), from the
simulated preview frame sampled every LAMP_POWER_INTERVAL and averaged
(_sample_lamp_power), and its publication to the sensors (_publish_power).

Used only as a mixin of :class:`YeelightCubeLight` (light.py).
"""
from collections import deque
from homeassistant.core import callback # type: ignore
from .lamp_power import BASE_W, estimated_power
from .light_color import hardware_brightness_for


# Estimated power in the lamp's own modes (clock, native effects, Music Flow): the
# simulated frame is sampled every LAMP_POWER_INTERVAL seconds and the
# sensor shows the average of the last LAMP_POWER_SAMPLES (30 s).
LAMP_POWER_INTERVAL = 5
LAMP_POWER_SAMPLES = 6


class PowerEstimateMixin:
    """The light's estimated power (light_power.py)."""

    def _init_power_state(self) -> None:
        """The power estimate's state. Called by YeelightCubeLight.__init__."""
        # Estimated energy (kWh): told every power change (_publish_power).
        self._published_power = None
        # The lamp's own modes (clock, native effect, Music Flow): estimates of the
        # simulated preview frame, sampled every LAMP_POWER_INTERVAL and
        # averaged; cleared when what the lamp draws changes.
        self._lamp_power_samples = deque(maxlen=LAMP_POWER_SAMPLES)
        self._lamp_power_pending = False
        self._lamp_power_key = None
        self._lamp_power_unsub = None

    @property
    def estimated_power(self) -> float | None:
        """Estimated draw in W (lamp_power.py): 0 while the lamp is not
        reachable (most often unplugged); the electronics alone while off;
        while the lamp draws the matrix itself (clock, native effect, Music
        Flow), whose frames Home Assistant cannot see, the simulated
        preview's average (unknown until it has samples)."""
        if not self.available:
            return 0.0
        if not self._is_on:
            return BASE_W
        if self.lamp_draws_matrix:
            samples = self._lamp_power_samples
            return round(sum(samples) / len(samples), 1) if samples else None
        if self._last_frame_power is None:
            return None
        return round(self._last_frame_power, 1)

    @property
    def power_estimate_source(self) -> str:
        """What the Estimated power sensor is based on right now."""
        if not self.available:
            return "unreachable"
        if not self._is_on:
            return "off"
        if self.lamp_draws_matrix:
            return "simulated preview"
        return "frames sent"

    def _lamp_power_state(self) -> tuple:
        """What the lamp draws: a change starts a new average."""
        return (
            self._mode, self._music_flow_enabled, self._music_flow_effect,
            self._native_effect, self._native_effect_color_mode,
            str(self._native_effect_color), self._native_effect_speed,
            self._native_effect_intensity,
            self._native_clock_style, self._native_clock_color_mode,
            self._native_clock_color, self._brightness, self._display_frozen,
        )

    @callback
    def _sample_lamp_power(self, _now=None) -> None:
        """While the lamp draws the matrix itself, estimate the draw of the
        simulated frame behind its camera preview (lamp_power.py), averaged
        over the last samples. Runs every LAMP_POWER_INTERVAL, and at
        once when what the lamp draws changes."""
        if not (self.available and self._is_on and self.lamp_draws_matrix):
            self._lamp_power_samples.clear()
            self._lamp_power_key = None
            return
        state = self._lamp_power_state()
        if state != self._lamp_power_key:
            self._lamp_power_samples.clear()
            self._lamp_power_key = state
        camera = next(
            (cam for cam in self._camera_entities if getattr(cam, "hass", None)), None
        )
        if camera is None or self._lamp_power_pending:
            return
        # Not what the camera displays: the lamp's own LED drive for every
        # named effect, an illustration for Music Flow
        # (camera.simulated_lamp_frame). In an executor: this runs every
        # few seconds and a renderer may replay what it missed.
        self._lamp_power_pending = True
        self.hass.async_add_executor_job(camera.simulated_lamp_frame).add_done_callback(
            lambda job: self._lamp_power_sampled(state, job)
        )

    @callback
    def _lamp_power_sampled(self, state: tuple, job) -> None:
        """A sampled frame (_sample_lamp_power) joins the average, unless
        what the lamp draws changed meanwhile: then sample again."""
        self._lamp_power_pending = False
        if not (self.available and self._is_on and self.lamp_draws_matrix):
            return
        if state != self._lamp_power_state():
            self._sample_lamp_power()
            return
        frame = None if job.cancelled() or job.exception() else job.result()
        if not frame:
            return
        # The built-in modes' brightness (_set_native_mode_brightness).
        hardware = hardware_brightness_for(self._brightness)
        self._lamp_power_samples.append(estimated_power(frame, hardware))
        self._publish_power()

    @callback
    def _publish_power(self) -> None:
        """Write the Estimated power sensor when its value changed, and
        let the Estimated energy sensor count the energy until then."""
        power = self.estimated_power
        if power != self._published_power:
            self._published_power = power
            self._notify("power")
            self._notify("energy", args=(power,))
