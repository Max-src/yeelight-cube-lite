"""A validation failure in a helper that does not import Home Assistant (so it
is tested on its own, e.g. clock_presets, image_utils): its translation key
(strings.json "exceptions") and placeholders. The actions raise it again,
translated (errors.invalid_input)."""


class InputError(ValueError):
    """``key``: the message's translation key; ``placeholders``: its values."""

    def __init__(self, key: str, **placeholders):
        super().__init__(key, placeholders)
        self.key = key
        self.placeholders = placeholders

    def __str__(self) -> str:
        return f"{self.key} {self.placeholders}" if self.placeholders else self.key
