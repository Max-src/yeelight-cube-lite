"""Entity ids that change (renamed by the user; in place from Home Assistant
2026.11, GitHub issue #4): the services always reach the lamp under its
current id and never under an old one, and every entity class opts in to
in-place renames. The rules: docs/ENTITY_IDS.md."""
import ast
import types
import unittest
from unittest.mock import Mock

from tests.test_native_features import ROOT, _load_standalone_functions

COMMON_SOURCE = (ROOT / "light_services_common.py").read_text(encoding="utf-8")
LIFECYCLE_HOOKS = {
    "async_added_to_hass",
    "async_will_remove_from_hass",
    "async_prepare_to_add_to_hass",
}


class LampLookupTests(unittest.TestCase):
    """light_services_common: a lamp is found by its live entity_id."""

    def setUp(self):
        self.registry = {}
        self.functions = _load_standalone_functions(
            COMMON_SOURCE,
            {"_lamp_for", "_target_ids", "_resolve_entity", "_resolve_entities"},
            {"_ENTITY_REGISTRY": self.registry, "_LOGGER": Mock()},
        )

    def lamp(self, ip, entity_id):
        lamp = types.SimpleNamespace(_ip=ip, entity_id=entity_id)
        self.registry[ip] = lamp  # as light.async_setup_entry registers it
        return lamp

    def call(self, entity_id):
        return types.SimpleNamespace(data={"entity_id": entity_id})

    def test_a_renamed_lamp_answers_to_its_new_id_only(self):
        lamp = self.lamp("10.0.0.1", "light.cube")
        lamp.entity_id = "light.desk"  # renamed in place
        self.assertIs(self.functions["_resolve_entity"](self.call("light.desk"), "T"), lamp)
        # The old id is refused, never sent to the renamed lamp.
        with self.assertRaisesRegex(ValueError, "No matching .*light.cube"):
            self.functions["_resolve_entity"](self.call("light.cube"), "T")

    def test_two_lamps_swapping_names_never_reach_the_wrong_lamp(self):
        top = self.lamp("10.0.0.1", "light.top")
        bottom = self.lamp("10.0.0.2", "light.bottom")
        # top -> light.tmp, bottom -> light.top, top -> light.bottom
        top.entity_id = "light.tmp"
        bottom.entity_id = "light.top"
        top.entity_id = "light.bottom"
        resolve = self.functions["_resolve_entities"]
        self.assertEqual(resolve(self.call(["light.top"]), "T"), [bottom])
        self.assertEqual(resolve(self.call(["light.bottom", "light.top"]), "T"), [top, bottom])
        with self.assertRaisesRegex(ValueError, "No matching .*light.tmp"):
            resolve(self.call("light.tmp"), "T")

    def test_the_lamps_are_registered_by_ip_never_by_entity_id(self):
        light = (ROOT / "light.py").read_text(encoding="utf-8")
        self.assertIn("_ENTITY_REGISTRY[ip] = light_entity", light)
        self.assertNotIn("_ENTITY_REGISTRY[self.entity_id]", light)


class InPlaceRenameOptInTests(unittest.TestCase):
    """Home Assistant keeps removing and re-adding an entity on a rename
    (until 2027.11) when one of the integration's classes in its hierarchy
    defines a lifecycle hook and neither it nor a subclass defines
    async_entity_id_changed. A class added later must opt in too."""

    def test_every_class_with_lifecycle_hooks_opts_in(self):
        checked = []
        for path in sorted(ROOT.glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ClassDef):
                    continue
                methods = {
                    item.name: item
                    for item in node.body
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
                }
                if not LIFECYCLE_HOOKS & methods.keys():
                    continue
                name = f"{path.name}:{node.name}"
                checked.append(name)
                hook = methods.get("async_entity_id_changed")
                with self.subTest(cls=name):
                    self.assertIsNotNone(hook, f"{name}: no async_entity_id_changed")
                    # A plain @callback (not async) that calls the base hook.
                    self.assertIsInstance(hook, ast.FunctionDef)
                    self.assertIn("callback", [ast.unparse(d) for d in hook.decorator_list])
                    self.assertIn(
                        "super().async_entity_id_changed(old_entity_id)",
                        ast.unparse(hook),
                    )
        # The light, the shared control base and every helper with hooks (the
        # palette and pixel art sensors share sensor._CollectionSensor).
        self.assertGreaterEqual(len(checked), 18, checked)


if __name__ == "__main__":
    unittest.main()
