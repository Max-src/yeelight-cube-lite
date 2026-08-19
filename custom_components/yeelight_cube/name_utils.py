"""Validation helpers for user-controlled display names."""


def normalize_display_name(value: object, fallback: str) -> str:
    """Return a non-empty name that cannot contain an HTML tag."""
    name = str(value).strip().replace("<", "").replace(">", "")
    return name or fallback