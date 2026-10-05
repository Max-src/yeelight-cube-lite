"""Lamp connection handling for the Yeelight Cube Lite light entity.

Every hardware operation runs through _execute_hardware_op: one operation at a
time per lamp (per-IP lock), a hard timeout, a circuit breaker after repeated
timeouts, and failures classified as retryable connection errors or not.
Also here: display retries after a failure, the periodic health check that
detects an unreachable lamp coming back (or moving to a new IP), the queued
brightness retry and the calibration lock. Mixed into YeelightCubeLight.
"""
import logging
import asyncio
import random
import time

from homeassistant.core import callback  # type: ignore
from yeelight import BulbException  # type: ignore

from .const import FIRMWARE_MODES
from .cube_matrix import (
    CubeConnectionError,
    RECONNECT_COOLDOWN_INITIAL,
    RECOVERY_CONNECT_TIMEOUT,
    is_quota_error,
)

_LOGGER = logging.getLogger(__name__)


APPLY_HARD_TIMEOUT = 12.0      # Seconds -- safety timeout for one hardware operation under the
                               # device lock. When exceeded, asyncio.wait_for cancels it and
                               # releases the lock so queued operations can proceed. Long enough
                               # for activate_fx_mode + draw_matrices on slow Wi-Fi: releasing the
                               # lock between the two shows the default ribbon on the lamp.
                               # Transitions add their duration on top (async_apply_display_mode).
LOCK_WAIT_WARNING_MS = 3000   # Waiting for the lamp longer than this is logged as a
                              # warning (commands piling up); shorter waits are normal
                              # queueing behind a redraw/transition and logged at debug.
CIRCUIT_BREAKER_WINDOW = 30.0 # Seconds -- if 2+ hard timeouts occur within this window,
                              # reject new operations immediately instead of queueing them
                              # behind the lock for another APPLY_HARD_TIMEOUT each.


# Per-device locks to serialize hardware commands to the SAME physical lamp.
# Each IP gets its own asyncio.Lock, so operations to different lamps run
# concurrently without cross-device cascade.  When one lamp is unreachable,
# only that lamp's operations block -- the other lamp continues normally.
# Within a single lamp, the lock ensures command chains (activate_fx_mode  -> 
# set_bright -> update_leds) complete atomically without interleaving.
_DEVICE_LOCKS: dict[str, asyncio.Lock] = {}


# Name of the operation holding each device lock, for the lock-wait log.
_DEVICE_LOCK_HOLDERS: dict[str, str] = {}


def _get_device_lock(ip: str) -> asyncio.Lock:
    """Get or create the per-device lock for a given IP."""
    if ip not in _DEVICE_LOCKS:
        _DEVICE_LOCKS[ip] = asyncio.Lock()
    return _DEVICE_LOCKS[ip]


class ConnectionMixin:
    """Hardware-operation serialisation, retries and connection health."""

    async def _execute_hardware_op(
        self, func, op_name: str, timeout_override: float = None, coalesce: bool = False
    ):
        """Execute a hardware operation under the global lock with timeout and error handling.

        Replaces the old queue processor.  Operations are serialized across all
        entity instances via per-device locks.  A hard timeout prevents hung
        socket operations from blocking the lock indefinitely.

        Args:
            timeout_override: Optional custom timeout (seconds).  Used when a
                              display transition needs more time than the default
                              APPLY_HARD_TIMEOUT.
            coalesce: For full redraws, which render the entity's state as it
                      is when they run. Skipped (returning True) if a newer
                      coalesced operation was queued while this one waited for
                      the lamp: the newer one draws the latest state anyway.
                      Rapid changes (clicking through pixel arts) then cost
                      the lamp one redraw instead of one transition and two
                      fresh TCP connections each, which can crash the Cube's
                      network stack.
        """
        op_id = int(time.time() * 1000) % 100000
        effective_timeout = timeout_override or APPLY_HARD_TIMEOUT
        self._hardware_failure_retryable = False
        
        # CIRCUIT BREAKER: If 2+ hard timeouts occurred in the last N seconds,
        # reject immediately instead of queueing behind the lock for
        # APPLY_HARD_TIMEOUT each. This prevents the cascade where 5+ operations
        # pile up, each waiting for its own timeout, leaving the lamp stuck.
        now = time.time()
        self._hard_timeout_times = [t for t in self._hard_timeout_times if now - t < CIRCUIT_BREAKER_WINDOW]
        if len(self._hard_timeout_times) >= 2:
            self._hardware_failure_retryable = True
            _LOGGER.warning(
                "[OP #%s] [%s] [!] CIRCUIT BREAKER -- rejecting %s "
                "(%s timeouts in last %.0fs). "
                "Device appears unreachable, will recover via health check.",
                op_id, self._ip, op_name, len(self._hard_timeout_times),
                CIRCUIT_BREAKER_WINDOW
            )
            self._connection_error = True
            # Only schedule display retries for display operations
            if op_name.startswith('display:'):
                self._maybe_schedule_retry()
            return False

        if coalesce:
            self._coalesced_op_generation += 1
            generation = self._coalesced_op_generation

        _LOGGER.debug(
            "[OP #%s] [%s] > %s "
            "(is_on=%s, fx_direct=%s) "
            "[%s]",
            op_id, self._ip, op_name, self._is_on, self._fx_mode_is_direct,
            self._cube_matrix.summary
        )
        is_display_op = op_name.startswith('display:')
        try:
            lock_wait_start = time.time()
            device_lock = _get_device_lock(self._ip)
            # The operation this one queues behind, named in the log below.
            waited_behind = (
                _DEVICE_LOCK_HOLDERS.get(self._ip) if device_lock.locked() else None
            )
            async with device_lock:
                if coalesce and generation != self._coalesced_op_generation:
                    _LOGGER.debug(
                        "[OP #%s] [%s] %s skipped -- a newer redraw is queued",
                        op_id, self._ip, op_name,
                    )
                    return True
                _DEVICE_LOCK_HOLDERS[self._ip] = op_name
                self._hardware_operation_phase = op_name
                lock_wait_ms = (time.time() - lock_wait_start) * 1000
                if lock_wait_ms > 5:
                    # Waiting for the lamp to finish its previous operation (a
                    # redraw with a transition takes 1-2 s) is normal. Only a
                    # long wait suggests commands are piling up.
                    log = (
                        _LOGGER.warning
                        if lock_wait_ms >= LOCK_WAIT_WARNING_MS
                        else _LOGGER.debug
                    )
                    log(
                        "[OP #%s] [%s] %s waited %.0fms for the lamp%s",
                        op_id,
                        self._ip,
                        op_name,
                        lock_wait_ms,
                        f" (queued behind {waited_behind})" if waited_behind else "",
                    )
                try:
                    async with asyncio.timeout(effective_timeout) as guard:
                        await func()
                except TimeoutError:
                    if not guard.expired():
                        # A socket timeout inside the operation (the lamp did
                        # not accept a connection), not this guard: handled
                        # below as a failed connection, without counting
                        # towards the circuit breaker.
                        raise
                    self._hardware_failure_retryable = True
                    _LOGGER.error(
                        "[OP #%s] [%s] [!] HARD TIMEOUT -- "
                        "%s exceeded %.0fs, releasing lock "
                        "(phase=%s)",
                        op_id, self._ip, op_name, effective_timeout,
                        self._hardware_operation_phase
                    )
                    self._fx_mode_is_direct = False
                    self._cube_matrix.close_fast_socket()
                    self._connection_error = True
                    self._last_connection_error = f"Hard timeout: {op_name}"
                    self._hard_timeout_times.append(time.time())
                    self._cube_matrix.record_failure()
                    # Only schedule display retries for display operations
                    if is_display_op:
                        self._maybe_schedule_retry()
                    return False
                finally:
                    _DEVICE_LOCK_HOLDERS.pop(self._ip, None)
            # Success
            _LOGGER.debug("[OP #%s] [%s] [OK] %s complete", op_id, self._ip, op_name)
            # Only reset display retry state on display op success
            if is_display_op:
                self._display_retry_count = 0
                if self._retry_display_task and not self._retry_display_task.done():
                    self._retry_display_task.cancel()
            self._connection_error = False
            self._cube_matrix.record_success()
            # Clear circuit breaker on any success
            self._hard_timeout_times.clear()
            return True
        except CubeConnectionError as e:
            # The command did not reach the lamp (unreachable, cooldown, dead
            # socket, FX mode lost while sending): retry once it answers.
            self._hardware_failure_retryable = True
            self._connection_error = True
            self._last_connection_error = e.message
            _LOGGER.warning(
                "[OP #%s] [%s] Connection error: %s", op_id, self._ip, e.message
            )
            if is_display_op:
                self._maybe_schedule_retry()
        except TimeoutError:
            self._hardware_failure_retryable = True
            _LOGGER.warning(
                "[OP #%s] [%s] %s: the lamp did not accept a connection in time",
                op_id, self._ip, op_name,
            )
            self._connection_error = True
            self._last_connection_error = "Device timeout"
            self._cube_matrix.record_failure()
            if is_display_op:
                self._maybe_schedule_retry()
        except OSError as e:
            # A raw socket failure (fresh-connection commands, probes).
            self._hardware_failure_retryable = True
            self._connection_error = True
            self._last_connection_error = str(e)
            _LOGGER.warning(
                "[OP #%s] [%s] Connection error: %s", op_id, self._ip, e
            )
            self._cube_matrix.record_failure()
            if is_display_op:
                self._maybe_schedule_retry()
        except BulbException as e:
            # The lamp answered but refused the command (rate limit, illegal
            # request, ...): not a connection problem.
            error_dict = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            error_message = error_dict.get('message', str(e))
            self._connection_error = True
            if is_quota_error(e):
                # Its rate limit passes after a moment: retry (a rotation
                # step waits and tries the same item again).
                self._hardware_failure_retryable = True
                self._last_connection_error = (
                    "The lamp refused the command: too many commands in a short time"
                )
            else:
                self._last_connection_error = f"BulbException: {error_message}"
            _LOGGER.warning(
                "[OP #%s] [%s] BulbException: %s", op_id, self._ip, error_message
            )
        except Exception as e:
            _LOGGER.error(
                "[OP #%s] [%s] Unexpected error in %s: %s", op_id, self._ip, op_name, e
            )
        return False

    MAX_DISPLAY_RETRIES = 3  # 3 retries ~= 20s total, then health check takes over

    # Calibration lock auto-release: if the wizard is abandoned (browser closed
    # without exiting), the lamp would stay frozen forever. The lock auto-releases
    # after this many seconds. The wizard sends periodic re-locks (heartbeat) that
    # reset this timer, so it only fires once the wizard truly stops talking.
    CALIBRATION_LOCK_TIMEOUT = 900  # 15 minutes

    @callback
    def _set_calibration_lock(self, enabled: bool):
        """Enable/disable the exclusive calibration lock and (re)arm the safety
        auto-release timer. Re-enabling acts as a heartbeat that pushes back the
        auto-release."""
        if self._calibration_lock_unsub is not None:
            self._calibration_lock_unsub.cancel()
            self._calibration_lock_unsub = None
        self._calibration_lock = bool(enabled)
        if enabled:
            self.stop_effect_rotation()
            self._calibration_lock_unsub = self.hass.loop.call_later(
                self.CALIBRATION_LOCK_TIMEOUT, self._auto_release_calibration_lock
            )
            _LOGGER.info(
                "[CALIB_LOCK] [%s] Calibration lock ENABLED -- automation "
                "display/brightness commands will be ignored (auto-release in "
                "%ss)",
                self._ip, self.CALIBRATION_LOCK_TIMEOUT
            )
        else:
            _LOGGER.info(
                "[CALIB_LOCK] [%s] Calibration lock DISABLED -- lamp resumes "
                "normal command handling",
                self._ip
            )
        if self.hass is not None:
            self.async_schedule_update_ha_state()

    @callback
    def _auto_release_calibration_lock(self):
        """Safety net: release the lock if the wizard heartbeat stops."""
        self._calibration_lock_unsub = None
        if self._calibration_lock:
            self._calibration_lock = False
            _LOGGER.warning(
                "[CALIB_LOCK] [%s] Calibration lock auto-released after "
                "%ss of inactivity (wizard abandoned?)",
                self._ip, self.CALIBRATION_LOCK_TIMEOUT
            )
            if self.hass is not None:
                self.async_schedule_update_ha_state()

    def _maybe_schedule_retry(self):
        """Schedule a display retry if the retry limit hasn't been reached.
        
        Thin wrapper that avoids log-spam: only logs 'stopping' ONCE when the
        limit is first hit, then stays silent on subsequent calls.
        """
        if self._display_retry_count >= self.MAX_DISPLAY_RETRIES:
            _LOGGER.debug(
                "[RETRY] [%s] Skipping retry -- already at limit "
                "(%s/%s)",
                self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES
            )
            return
        self._schedule_display_retry()

    def _schedule_display_retry(self):
        """Schedule a delayed retry of the display update after a connection error.
        
        This is the critical piece that prevents the lamp from staying dark forever
        after a boot failure. When the queue processor fails (e.g., device unreachable
        after HA reboot), this schedules a future async_apply_display_mode() call
        that respects the exponential backoff:
        
          boot -> apply fails -> retry in 2s -> fails -> retry in 2s -> fails -> backoff -> 4s -> ...
        
        Only ONE retry task runs at a time. A successful display update clears the retry.
        User-initiated actions (turn_on, set_color, etc.) also naturally re-queue,
        so this retry only matters when nothing else is driving updates.
        
        After MAX_DISPLAY_RETRIES, stops retrying -- the health check (probing
        every 10s while there are failures) takes over for longer outages. User actions will still
        trigger a fresh display update, resetting the counter.
        """
        self._display_retry_count += 1
        
        if self._display_retry_count > self.MAX_DISPLAY_RETRIES:
            _LOGGER.warning(
                "[RETRY] [%s] Stopping auto-retry after %s consecutive failures. "
                "The lamp appears to be offline. Display will resume on next user action or HA restart. "
                "[%s]",
                self._ip, self.MAX_DISPLAY_RETRIES, self._cube_matrix.summary
            )
            return
        
        # Cancel any existing retry task (avoid stacking retries)
        if self._retry_display_task and not self._retry_display_task.done():
            _LOGGER.debug("[RETRY] [%s] Cancelling existing display retry task", self._ip)
            self._retry_display_task.cancel()
        
        # Calculate delay: the first retry is quick to catch transient network
        # hiccups before engaging exponential backoff.  Subsequent retries use
        # the device's current cooldown + buffer.
        QUICK_RETRY_DELAY = 1.5  # seconds -- fast enough to recover from a 1-2s WiFi hiccup
        cooldown = self._cube_matrix.reconnect_cooldown
        if self._display_retry_count == 1:
            delay = QUICK_RETRY_DELAY
        else:
            delay = cooldown + 0.5
        
        # Add random jitter (0-1.5s) to desynchronize retries across lamps.
        # When two lamps fail at the same moment, they get identical cooldown
        # schedules and retry simultaneously -- each round has both lamps
        # hitting the network at once, prolonging the failure.  Jitter breaks
        # this synchronization so they stagger naturally.
        delay += random.uniform(0, 1.5)
        
        async def _delayed_retry():
            try:
                _LOGGER.debug(
                    "[RETRY] [%s] Attempt %s/%s -- "
                    "waiting %.1fs before retry "
                    "[%s]",
                    self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                    delay, self._cube_matrix.summary
                )
                await asyncio.sleep(delay)
                
                _LOGGER.debug(
                    "[RETRY] [%s] Retrying display update now (attempt %s) "
                    "[%s]",
                    self._ip, self._display_retry_count, self._cube_matrix.summary
                )
                await self.async_apply_display_mode(update_type='display_retry')
                _LOGGER.debug("[RETRY] [%s] Display retry sent", self._ip)
            except asyncio.CancelledError:
                _LOGGER.debug("[RETRY] [%s] Display retry CANCELLED", self._ip)
            except Exception as e:
                _LOGGER.warning("[RETRY] [%s] Unexpected error in display retry: %s", self._ip, e)
        
        self._retry_display_task = self._create_tracked_task(
            _delayed_retry(), name=f"yeelight_cube_display_retry_{self._ip}"
        )
        _LOGGER.debug(
            "[RETRY] [%s] Scheduled retry %s/%s "
            "in %.1fs (cooldown=%.0fs, failures=%s)",
            self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES, delay,
            cooldown, self._cube_matrix.consecutive_failures
        )

    async def _periodic_health_check(self):
        """Periodically probe devices with active issues and reconnect when they come back.
        
        This runs in parallel with the retry system, providing a secondary
        recovery path.  It probes whenever there are ANY active issues:
        - consecutive failures > 0 (early detection, before retry exhaustion)
        - device marked unreachable (exponential backoff triggered)
        - display retries in progress (parallel recovery alongside retries)
        - retry limit reached (sole recovery mechanism after retries exhausted)
        
        Uses adaptive intervals: 10s during active failures (matches max retry
        backoff), 15s monitor mode, 60s when long-dead.
        
        Flow:
          1. Sleep for adaptive interval (10s during failures, 15s when recently online, 60s when long-dead)
          2. If device has no active issues -> skip
          3. TCP probe the device (RECOVERY_CONNECT_TIMEOUT timeout)
          4. If reachable -> reset all failure counters and trigger a fresh display update
          5. If still unreachable -> log at debug level, try again next cycle
        """
        _LOGGER.debug("[HEALTH] [%s] Health check started (adaptive interval)", self._ip)
        while True:
            try:
                # ADAPTIVE INTERVAL:
                #  - 10s when there are active failures (fastest recovery)
                #  - 15s when device was online recently (monitor mode)
                #  - 60s when device has been down a while (reduce noise)
                has_active_issues = (
                    self._cube_matrix.is_unreachable or
                    self._cube_matrix.consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                # "Silent" firmware modes (Clock / Native Effect / Music Flow)
                # pause get_prop polling and push no frames, so a mains power cut
                # is never noticed: the lamp reboots to a firmware default while
                # HA still believes the mode is active. Probe these on a SHORT
                # fixed cadence so we reliably catch the brief unreachable window
                # and re-assert the mode on return -- exactly the re-apply that a
                # Home Assistant restart performs (which the user confirmed works).
                silent_mode = self._is_on and (
                    self._mode in FIRMWARE_MODES
                    or self._music_flow_enabled
                )
                last_success = self._cube_matrix.last_success_time
                time_since_success = time.time() - last_success if last_success > 0 else 999
                if has_active_issues:
                    interval = 10  # Aggressive probing during failures
                elif silent_mode:
                    interval = 10  # Catch power-cut outages while in a native mode
                elif time_since_success < 300:  # online within last 5 minutes
                    interval = 15
                else:
                    interval = 60
                
                # PERIODIC BRIGHTNESS STATE SNAPSHOT -- logs every cycle so we can
                # see the stored brightness values even when nothing is changing.
                _LOGGER.debug(
                    "[BRIGHTNESS_DIAG] [%s] SNAPSHOT -- "
                    "user=%s/255, "
                    "last_hw=%s, "
                    "darken=%s%%, "
                    "last_applied_darken=%s, "
                    "is_on=%s, fx_direct=%s, "
                    "unreachable=%s, "
                    "failures=%s, "
                    "interval=%ss",
                    self._ip, self._brightness, self._last_hardware_brightness,
                    self._preview_darken, self._last_applied_darken, self._is_on,
                    self._fx_mode_is_direct, self._cube_matrix.is_unreachable,
                    self._cube_matrix.consecutive_failures, interval
                )
                await asyncio.sleep(interval)
                
                # Probe when the device has ANY active issue:
                # - unreachable flag is set (exponential backoff triggered)
                # - retry counter hit the limit (retries exhausted)
                # - consecutive failures > 0 (early detection before unreachable)
                # - display retries in progress (parallel recovery path)
                is_stuck = (
                    self._cube_matrix.is_unreachable or
                    self._rotation_waiting_for_reconnect or
                    self._display_retry_count >= self.MAX_DISPLAY_RETRIES or
                    self._cube_matrix.consecutive_failures > 0 or
                    self._display_retry_count > 0
                )
                if not is_stuck and not silent_mode:
                    continue
                # Only re-apply the mode when we are actually RECOVERING from a
                # detected outage. A healthy proactive probe in silent mode must
                # leave the running renderer untouched (re-applying every cycle
                # would restart the clock/effect repeatedly).
                recovering = is_stuck
                
                _LOGGER.debug(
                    "[HEALTH] [%s] Probing device (unreachable=%s, "
                    "retries=%s/%s, "
                    "failures=%s, "
                    "interval=%ss)",
                    self._ip, self._cube_matrix.is_unreachable,
                    self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                    self._cube_matrix.consecutive_failures, interval
                )
                
                # Quick TCP probe -- use longer timeout for recovery.
                # Normal commands use 0.5s, but a lamp rebooting may have
                # slow TCP handshakes (RECOVERY_CONNECT_TIMEOUT).
                probe_timeout = RECOVERY_CONNECT_TIMEOUT
                if not await self._cube_matrix.probe(probe_timeout):
                    # The lamp is not answering -- record it so the next
                    # successful probe knows to re-assert the mode. This is what
                    # lets a mains power cut, detected proactively in a silent
                    # mode, recover on return.
                    became_unreachable = self._cube_matrix.mark_unreachable()
                    if self._rotation_resume_pending:
                        self._rotation_waiting_for_reconnect = True
                    if self.hass is not None and (
                        became_unreachable or self._rotation_waiting_for_reconnect
                    ):
                        # Publishes the light and its controls as unavailable.
                        self.async_write_ha_state()
                    # Log at WARNING so the user can see probes are happening
                    _LOGGER.warning(
                        "[HEALTH] [%s] Probe failed -- still unreachable "
                        "(retries=%s/%s, "
                        "failures=%s, "
                        "timeout=%ss)",
                        self._ip, self._display_retry_count, self.MAX_DISPLAY_RETRIES,
                        self._cube_matrix.consecutive_failures, probe_timeout
                    )
                    # The lamp may have moved to a new DHCP address: scan for
                    # it by hardware id and remap the config entry (throttled).
                    await self._async_maybe_rediscover()
                    continue
                
                # Proactive healthy probe (silent mode, nothing was wrong): the
                # lamp answered, so leave the running renderer untouched.
                if not recovering:
                    continue
                
                # Device is back! Reset everything and trigger a fresh display.
                _LOGGER.warning(
                    "[HEALTH] [%s] [OK] Device is BACK ONLINE! "
                    "Resetting failures (%s -> 0), "
                    "retries (%s -> 0), "
                    "cooldown (%.0fs -> %ss)",
                    self._ip, self._cube_matrix.consecutive_failures,
                    self._display_retry_count, self._cube_matrix.reconnect_cooldown,
                    RECONNECT_COOLDOWN_INITIAL
                )
                self._cube_matrix.mark_recovered()  # Fresh socket, backoff reset
                self._display_retry_count = 0
                self._fx_mode_is_direct = False  # Force FX mode re-send
                self._connection_error = False
                self._hard_timeout_times.clear()  # Clear circuit breaker
                if self.hass is not None:
                    # Publishes the light and its controls as available again.
                    self.async_write_ha_state()

                if self._resume_rotation_after_reconnect():
                    continue
                if self._rotation_active:
                    continue

                if self._music_flow_enabled:
                    _LOGGER.debug(
                        "[MUSIC FLOW] [%s] HEALTH RECOVERY -- restarting "
                        "the requested Music Flow renderer",
                        self._ip,
                    )
                    await self.async_set_music_flow(True)
                else:
                    # Trigger a full display update (turn_on type so it isn't blocked)
                    _LOGGER.debug(
                        "[BRIGHTNESS_DIAG] [%s] HEALTH RECOVERY -- will apply display mode. "
                        "user=%s/255, last_hw=%s, "
                        "darken=%s%%, fx_direct=%s",
                        self._ip, self._brightness, self._last_hardware_brightness,
                        self._preview_darken, self._fx_mode_is_direct
                    )
                    await self.async_apply_display_mode(update_type='turn_on')
                
            except asyncio.CancelledError:
                _LOGGER.debug("[HEALTH] [%s] Health check cancelled", self._ip)
                break
            except Exception as e:
                _LOGGER.debug("[HEALTH] [%s] Health check error: %s", self._ip, e)
        
        _LOGGER.debug("[HEALTH] [%s] Health check stopped", self._ip)

    async def _async_maybe_rediscover(self):
        """Scan for this lamp at a new IP after failed probes (throttled).

        DHCP can move the lamp while the entry is loaded; probing the stale IP
        forever can never recover. Rediscovery matches by hardware device_id
        and updates the config entry, whose update listener reloads the entry
        with the new address.
        """
        now = time.time()
        if now - self._last_rediscovery_attempt < 60:
            return
        self._last_rediscovery_attempt = now
        if self._config_entry is None or self.hass is None:
            return
        try:
            from . import _async_try_rediscover

            new_ip = await _async_try_rediscover(
                self.hass, self._config_entry, self._ip
            )
            if new_ip and new_ip != self._ip:
                _LOGGER.warning(
                    "[HEALTH] [%s] Lamp found at new IP %s -- config entry "
                    "updated, reloading with the new address",
                    self._ip, new_ip,
                )
        except Exception as exc:
            _LOGGER.debug(
                "[HEALTH] [%s] Runtime rediscovery failed: %s", self._ip, exc
            )

    def _start_brightness_retry_task(self):
        """Start background task to retry failed brightness when connection recovers"""
        if self._brightness_retry_task is None or self._brightness_retry_task.done():
            self._brightness_retry_task = self._create_tracked_task(
                self._process_brightness_retries(), name=f"yeelight_cube_brightness_retry_{self._ip}"
            )

    async def _process_brightness_retries(self):
        """
        Background task to retry failed brightness when connection recovers.
        
        ANTI-OVERWRITE PROTECTION:
        - Only retries if no newer brightness has been successfully applied
        - Drops stale queued brightness if user changed brightness since failure
        - Example: Brightness 20% queued -> User sets 60% successfully -> Drop queued 20%
        """
        _LOGGER.debug("[BRIGHTNESS RETRY] Retry processor started")
        
        while self._pending_brightness is not None:
            # Wait for connection to be available
            if not self._cube_matrix.is_connected():
                await asyncio.sleep(0.5)  # Check every 500ms
                continue
            
            # Get pending brightness
            pending_value, queued_timestamp = self._pending_brightness
            
            # Check if brightness expired (30s TTL)
            if time.time() - queued_timestamp > 30.0:
                _LOGGER.debug("[BRIGHTNESS RETRY] Dropping expired brightness: %s", pending_value)
                self._pending_brightness = None
                continue
            
            # ANTI-OVERWRITE CHECK: Has a newer brightness already succeeded?
            if self._last_successful_brightness is not None:
                last_success_time, last_success_value = self._last_successful_brightness
                
                # If a newer brightness succeeded AFTER this one was queued, drop it
                if last_success_time > queued_timestamp:
                    _LOGGER.debug(
                        "[BRIGHTNESS RETRY] Dropping stale brightness %s - "
                        "newer brightness %s already applied "
                        "(queued at %.2f, superseded at %.2f)",
                        pending_value, last_success_value, queued_timestamp,
                        last_success_time
                    )
                    self._pending_brightness = None
                    continue
            
            # Try to re-apply the complete brightness through the queue
            try:
                _LOGGER.debug("[BRIGHTNESS RETRY] Retrying brightness %s via queue", pending_value)
                # Queue through the proper channel so it's serialized with other operations
                await self.set_brightness(pending_value)
                # Success - clear pending
                self._pending_brightness = None
                _LOGGER.debug("[BRIGHTNESS RETRY] Successfully queued brightness retry %s", pending_value)
            except Exception as e:
                # Failed again - will retry later
                _LOGGER.debug("[BRIGHTNESS RETRY] Retry failed for brightness %s: %s", pending_value, e)
                # If connection is down again, wait longer
                if not self._cube_matrix.is_connected():
                    await asyncio.sleep(1)
                else:
                    # Other error - clear pending to avoid infinite retry
                    _LOGGER.warning("[BRIGHTNESS RETRY] Clearing pending brightness due to error: %s", e)
                    self._pending_brightness = None
            
            # Small delay between retry attempts
            await asyncio.sleep(0.1)
        
        _LOGGER.debug("[BRIGHTNESS RETRY] Retry processor finished (no pending brightness)")
