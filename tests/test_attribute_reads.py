"""No code reads a private attribute (``self._x``, ``light._x``) that nothing
in the integration defines. A rename that misses a reader fails here: the
camera's debug log once read a renamed ``_SUFFIX`` and every preview
refresh raised (log arguments are evaluated even with debug logging off)."""
import ast
import re
import unittest

from tests.test_native_features import ROOT

# Private methods of Home Assistant's own classes that the integration calls.
HOME_ASSISTANT = {
    "_async_abort_entries_match", "_abort_if_unique_id_configured",
    "_async_current_entries", "_set_confirm_only", "_get_reconfigure_entry",
}


class AttributeReadTests(unittest.TestCase):
    def test_every_private_attribute_read_is_defined(self):
        defined, reads = set(HOME_ASSISTANT), []
        for path in sorted(ROOT.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    defined.add(node.name)
                elif isinstance(node, ast.Attribute):
                    if isinstance(node.ctx, (ast.Store, ast.Del)):
                        defined.add(node.attr)
                    elif node.attr.startswith("_") and not node.attr.startswith("__"):
                        reads.append((path.name, node.lineno, node.attr))
                elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    defined |= {n.id for t in targets for n in ast.walk(t) if isinstance(n, ast.Name)}
            # Attributes set by name (setattr, _register_on_light("_x"), specs).
            defined |= set(re.findall(r'"(_[a-z][a-z0-9_]*)"', source))
        undefined = [
            f"{name}:{line} reads {attr}" for name, line, attr in reads
            if attr not in defined and not attr.startswith("_attr_")
        ]
        self.assertEqual([], undefined)
        self.assertGreater(len(reads), 1000)  # the scan saw the code


if __name__ == "__main__":
    unittest.main()
