"""The errors the integration's actions and controls raise, their messages
translated (strings.json "exceptions"), so each message exists once:

- invalid(): the request cannot be done as asked (ServiceValidationError:
  the caller changes the request: another value, turn the lamp on first...);
- failed(): the lamp or Home Assistant could not complete it
  (HomeAssistantError).

Every module raises through these; a helper that does not import Home
Assistant raises input_error.InputError instead, raised again here
(invalid_input)."""
from __future__ import annotations

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError  # type: ignore

from .const import DOMAIN
from .input_error import InputError


def _placeholders(values: dict) -> dict[str, str]:
    return {key: str(value) for key, value in values.items()}


def invalid(key: str, **placeholders) -> ServiceValidationError:
    """A request that cannot be done as asked (``key``: its message)."""
    return ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=_placeholders(placeholders),
    )


def failed(key: str, **placeholders) -> HomeAssistantError:
    """A request the lamp or Home Assistant could not complete."""
    return HomeAssistantError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=_placeholders(placeholders),
    )


def invalid_input(err: InputError) -> ServiceValidationError:
    """A helper's validation failure (InputError) as the action's error."""
    return invalid(err.key, **err.placeholders)
