"""The lamp's state is set up by YeelightCubeLight.__init__ and by each
mixin's own _init_<area>_state (light_*.py): every one of those is called,
and no attribute is set up in two places."""
import ast
import unittest

from tests.test_native_features import ROOT


def _assigned(function):
    names = []
    for node in ast.walk(function):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == "self"
                ):
                    names.append(target.attr)
    return names


class LampStateInitTests(unittest.TestCase):
    def setUp(self):
        light = ast.parse((ROOT / "light.py").read_text(encoding="utf-8"))
        cls = next(
            node for node in light.body
            if isinstance(node, ast.ClassDef) and node.name == "YeelightCubeLight"
        )
        self.init = next(
            node for node in cls.body
            if isinstance(node, ast.FunctionDef) and node.name == "__init__"
        )
        self.mixin_inits = {}
        for path in sorted(ROOT.glob("light_*.py")):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if (
                    isinstance(node, ast.FunctionDef)
                    and node.name.startswith("_init_")
                    and node.name.endswith("_state")
                ):
                    self.mixin_inits[node.name] = node

    def test_every_mixin_state_is_set_up(self):
        called = {
            node.func.attr
            for node in ast.walk(self.init)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in self.mixin_inits
        }
        self.assertTrue(self.mixin_inits)
        self.assertEqual(set(self.mixin_inits), called)

    def test_no_attribute_is_set_up_twice(self):
        names = _assigned(self.init)
        for function in self.mixin_inits.values():
            names += _assigned(function)
        self.assertEqual([], sorted({name for name in names if names.count(name) > 1}))

    def test_init_reads_no_instance_state(self):
        # Only class constants: the order of the mixins' setup cannot change
        # any value (a new read here would make it matter).
        reads = {
            node.attr
            for node in ast.walk(self.init)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "self"
            and isinstance(node.ctx, ast.Load)
        }
        reads -= set(self.mixin_inits)
        self.assertTrue(all(name.isupper() for name in reads), sorted(reads))


if __name__ == "__main__":
    unittest.main()
