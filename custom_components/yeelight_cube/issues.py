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
# blocks it (a failure is only retried after cube_matrix.UDP_RETRY_AFTER).
UDP_BLOCKED_AFTER = 15 * 60
# The issues, by translation key (strings.json "issues").
ISSUES = ("lamp_unreachable", "udp_blocked", "lan_control_off")


def lamp_problems(
    state: dict, available: bool, since_added: float, lan_control_off: bool = False
) -> set[str]:
    """The issues a lamp has, from its connection state
    (cube_matrix.connection_state) and availability. ``since_added``: how
    long its light has been running (s), for a lamp that has not answered a
    command since. ``lan_control_off``: the lamp reports LAN Control off over
    Matter (light_matter.py), which only the Yeelight app can turn back on."""
    problems = set()
    if lan_control_off:
        problems.add("lan_control_off")
    since_success = state.get("since_success")
    if not available and (since_added if since_success is None else since_success) >= UNREACHABLE_AFTER:
        problems.add("lamp_unreachable")
    if available and (state.get("udp_failing_for") or 0) >= UDP_BLOCKED_AFTER:
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
