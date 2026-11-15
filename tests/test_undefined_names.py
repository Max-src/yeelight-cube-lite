"""Every name the integration's code reads is defined.

2026-11-14: a constant the stream loop reads was deleted with the block around
it, and every stream crashed at once (NameError) on the lamps. The stream
tests did not see it: they load the loop with their own copy of the constants.
So every module is checked here on its own source (Python's symbol tables, no
import): a global a function reads must be defined at the module's top level
(assigned, imported, a def or class) or be a builtin.
"""
import builtins
import symtable
import unittest

from tests.test_native_features import ROOT

# Module attributes Python sets itself.
_MODULE_NAMES = {"__file__", "__name__", "__doc__", "__package__", "__spec__", "__loader__",
                 "__path__", "__builtins__", "__annotations__", "__dict__"}


def _top_level(table) -> set[str]:
    return {
        symbol.get_name() for symbol in table.get_symbols()
        if symbol.is_assigned() or symbol.is_imported() or symbol.is_namespace()
        or symbol.is_declared_global()
    }


def _globals_read(table):
    """(scope name, name) for each global a nested scope reads."""
    for child in table.get_children():
        for symbol in child.get_symbols():
            if symbol.is_referenced() and symbol.is_global() and not symbol.is_declared_global():
                yield child.get_name(), symbol.get_name()
        yield from _globals_read(child)


def undefined_names(source: str, filename: str) -> list[str]:
    table = symtable.symtable(source, filename, "exec")
    defined = _top_level(table) | set(dir(builtins)) | _MODULE_NAMES
    # Names a function declares global and assigns are module names too.
    pending = [table]
    while pending:
        scope = pending.pop()
        for symbol in scope.get_symbols():
            if symbol.is_declared_global() and symbol.is_assigned():
                defined.add(symbol.get_name())
        pending.extend(scope.get_children())
    missing = sorted({f"{name} (in {scope})" for scope, name in _globals_read(table) if name not in defined})
    # Read at the module's own top level without being defined there.
    for symbol in table.get_symbols():
        name = symbol.get_name()
        if symbol.is_referenced() and not (symbol.is_assigned() or symbol.is_imported()) and name not in defined:
            missing.append(f"{name} (at module level)")
    return missing


class UndefinedNameTests(unittest.TestCase):
    def test_every_module_defines_what_it_reads(self):
        modules = sorted(ROOT.glob("*.py"))
        self.assertGreater(len(modules), 50)
        for path in modules:
            with self.subTest(module=path.name):
                self.assertEqual([], undefined_names(path.read_text(encoding="utf-8"), str(path)))

    def test_the_check_finds_a_missing_constant(self):
        source = "LIMIT = 2\n\ndef run():\n    return LIMIT + MISSING\n"
        self.assertEqual(["MISSING (in run)"], undefined_names(source, "example.py"))


if __name__ == "__main__":
    unittest.main()
