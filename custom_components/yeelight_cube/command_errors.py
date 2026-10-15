"""The last change a lamp failed to apply, published for the cards.

Shared by the services' per-lamp work (light_services_common run_on_lamps)
and the lamp's hardware queue (light_connection _execute_hardware_op), so
both a service error and a command the lamp refused are named on the cards.
"""

import time


def note_command_result(lamp, label, err=None, since=None):
    """Publish on ``lamp`` the last change it failed to apply
    (``last_command_error``: the service or operation, the message and when),
    so the cards can name it; ``err`` is an exception or a message.

    Without ``err``, a change it applied clears it (every redraw shows the
    lamp's whole requested state). With ``since`` (``time.time()`` when that
    change started), an error recorded meanwhile is kept: it is about that
    very change (its redraw refused while the service itself went through).

    None of this for a lamp not reached: it is shown unavailable, and gets
    its requested state again once it is back.
    """
    current = getattr(lamp, "_last_command_error", None)
    if err is None:
        if current is None or (since is not None and current.get("at", 0) >= since):
            return
        error = None
    else:
        message = err if isinstance(err, str) else (str(err) or type(err).__name__)
        error = {"service": label.lower(), "message": message, "at": time.time()}
    lamp._last_command_error = error
    if getattr(lamp, "hass", None) is not None:
        lamp.async_write_ha_state()
