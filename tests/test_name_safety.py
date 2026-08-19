"""Tests for user-controlled display-name normalization."""

from pathlib import Path
import runpy
import unittest


ROOT = Path(__file__).parents[1] / "custom_components" / "yeelight_cube"
NORMALIZE = runpy.run_path(ROOT / "name_utils.py")["normalize_display_name"]


class NameSafetyTests(unittest.TestCase):
    def test_html_tag_delimiters_are_removed(self):
        self.assertEqual(
            NORMALIZE("<img src=x onerror=alert(1)>", "Unnamed"),
            "img src=x onerror=alert(1)",
        )

    def test_normal_names_are_preserved(self):
        self.assertEqual(
            NORMALIZE("  Max's sunset & ocean  ", "Unnamed"),
            "Max's sunset & ocean",
        )

    def test_empty_normalized_name_uses_fallback(self):
        self.assertEqual(NORMALIZE("<>", "Unnamed"), "Unnamed")


if __name__ == "__main__":
    unittest.main()