"""Repairs (Settings → System → Repairs) for a lamp's problems a user can fix:
shown while they last, removed on their own once they are gone. The light
checks them every minute (light.async_added_to_hass); a deleted lamp's are
removed with it (__init__.async_remove_entry)."""
from __future__ import annotations

from homeassistant.core import HomeAssistant  # type: ignore
from homeassistant.helpers import issue_registry as ir  # type: ignore

from .const import DOMAIN

# A lamp out of reach this long (s) is reported; a restart or a short power
# cut is not.
UNREACHABLE_AFTER = 30 * 60
# UDP failing this long (s) while the lamp answers over TCP: the network
# blocks it (a failure is only retried after lamp_client_udp.UDP_RETRY_AFTER).
UDP_BLOCKED_AFTER = 15 * 60
# A lamp whose orientation is still unknown after this long (s) is reported:
# time for a Matter link to read it first.
ORIENTATION_UNKNOWN_AFTER = 10 * 60
# A lamp that accepts connections but has answered nothing this long (s) is
# stuck (lamp_client.LampClient.probe): only a power cycle helps.
NOT_RESPONDING_AFTER = 60
# The issues, by translation key (strings.json "issues").
ISSUES = ("lamp_unreachable", "lamp_not_responding", "udp_blocked", "udp_unanswered", "music_blocked", "matrix_lan_stuck", "lan_control_off", "orientation_unknown", "demo_mode", "factory_modules", "firmware_too_old")
# The issues only turning the lamp's power off and on fixes, most serious
# first: the Power cycle sensor (binary_sensor.py) reports the first
# one a lamp has, for an automation that switches its plug off and on.
POWER_CYCLE_ISSUES = ("lamp_not_responding", "matrix_lan_stuck", "udp_unanswered")


def power_cycle_reason(problems: set[str]) -> str | None:
    """The issue in ``problems`` a power cycle fixes (POWER_CYCLE_ISSUES), or
    None."""
    return next((key for key in POWER_CYCLE_ISSUES if key in problems), None)


def lamp_problems(
    state: dict,
    available: bool,
    since_added: float,
    lan_control_off: bool = False,
    orientation_unknown: bool = False,
    demo_mode: bool = False,
    factory_modules: bool = False,
    firmware_too_old: bool = False,
) -> set[str]:
    """The issues a lamp has, from its connection state
    (LampClient.connection_state) and availability. ``since_added``: how
    long its light has been running (s), for a lamp that has not answered a
    command since. ``lan_control_off``: the lamp reports LAN Control off over
    Matter (light_matter.py), which only the Yeelight app can turn back on.
    ``orientation_unknown``: nothing says which orientation the lamp saved
    (light_mount_profile.py): its effects may move the wrong way until the
    user says it in Configure, or Matter reads it. ``demo_mode``: a Cube
    Matrix runs its demo loop (light_matrix), which only a factory reset
    ends. ``factory_modules``: a Cube Matrix still has the module list it
    left the factory with (never set in the Yeelight app): its own clock and
    its direction are not set up. A Cube Matrix whose music connection fails
    (its fast channel, which the lamp opens back to Home Assistant) gets
    music_blocked instead of udp_blocked, unless it does not answer over TCP
    either: its LAN is stuck (matrix_lan_stuck: it accepts connections and
    closes them, while Matter still works), which only a power cycle fixes.
    A Cube Lite whose UDP sessions keep opening while their commands fail
    gets udp_unanswered: the network lets UDP through, the lamp is at fault."""
    problems = set()
    if demo_mode:
        problems.add("demo_mode")
    if lan_control_off:
        problems.add("lan_control_off")
    if orientation_unknown and since_added >= ORIENTATION_UNKNOWN_AFTER:
        problems.add("orientation_unknown")
    since_success = state.get("since_success")
    music = state.get("channel") == "music"
    silent = (state.get("silent_for") or 0) >= NOT_RESPONDING_AFTER
    if silent:
        problems.add("matrix_lan_stuck" if music and available else "lamp_not_responding")
    elif not available and (since_added if since_success is None else since_success) >= UNREACHABLE_AFTER:
        problems.add("lamp_unreachable")
    if factory_modules:
        problems.add("factory_modules")
    if firmware_too_old:
        problems.add("firmware_too_old")
    if available and not silent and (state.get("udp_failing_for") or 0) >= UDP_BLOCKED_AFTER:
        if music:
            problems.add("music_blocked")
        elif state.get("udp_sessions_while_failing"):
            # The lamp keeps answering a session's opening: UDP passes, the
            # lamp answers no command in it (udp_unanswered, not the network).
            problems.add("udp_unanswered")
        else:
            problems.add("udp_blocked")
    return problems


def _issue_id(key: str, entry_id: str) -> str:
    return f"{key}_{entry_id}"


def report_problems(hass: HomeAssistant, light, problems: set[str], reported: set[str] | None) -> set[str]:
    """Show ``problems`` and remove the issues that are gone; only what
    changed since ``reported`` (None: unknown, every issue is set). Returns
    what is now reported."""
    entry_id = light._config_entry.entry_id
    for key in ISSUES:
        if reported is not None and (key in problems) == (key in reported):
            continue
        if key in problems:
            ir.async_create_issue(
                hass, DOMAIN, _issue_id(key, entry_id),
                is_fixable=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key=key,
                translation_placeholders={"name": light._lamp_name, "ip": light._ip},
            )
        else:
            ir.async_delete_issue(hass, DOMAIN, _issue_id(key, entry_id))
    return set(problems)


def clear_problems(hass: HomeAssistant, entry_id: str) -> None:
    """Remove a lamp's issues (the lamp was deleted)."""
    for key in ISSUES:
        ir.async_delete_issue(hass, DOMAIN, _issue_id(key, entry_id))
