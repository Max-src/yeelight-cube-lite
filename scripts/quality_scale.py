"""Home Assistant integration quality scale, self-assessed.

    python scripts/quality_scale.py

Reads custom_components/yeelight_cube/quality_scale.yaml (the format of a core
integration's file), checks it lists every rule with a valid status, verifies
the rules marked done that a script can verify (the checks below, after
hassfest's own validators where core has one), and prints each tier's rules
still to do and the tier reached. Exits 1 on a problem. Also run by the
Python tests (tests/test_quality_scale.py), so `npm run check` and CI fail when
a rule marked done stops holding.

Home Assistant's hassfest skips this for custom integrations (it validates
quality_scale.yaml only for core ones): these are our checks. The rules are
core's (script/hassfest/quality_scale.py, ALL_RULES), as of 2026-10-18;
update RULES when core adds or renames one.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
INTEGRATION = ROOT / "custom_components" / "yeelight_cube"
TIERS = ("bronze", "silver", "gold", "platinum")
RULES = {
    "bronze": [
        "action-setup", "appropriate-polling", "brands", "common-modules",
        "config-flow", "config-flow-test-coverage", "dependency-transparency",
        "docs-actions", "docs-conditions", "docs-high-level-description",
        "docs-installation-instructions", "docs-removal-instructions",
        "docs-triggers", "entity-event-setup", "entity-unique-id",
        "has-entity-name", "runtime-data", "test-before-configure",
        "test-before-setup", "unique-config-entry",
    ],
    "silver": [
        "action-exceptions", "config-entry-unloading",
        "docs-configuration-parameters", "docs-installation-parameters",
        "entity-unavailable", "integration-owner", "log-when-unavailable",
        "parallel-updates", "reauthentication-flow", "test-coverage",
    ],
    "gold": [
        "devices", "diagnostics", "discovery", "discovery-update-info",
        "docs-data-update", "docs-examples", "docs-known-limitations",
        "docs-supported-devices", "docs-supported-functions",
        "docs-troubleshooting", "docs-use-cases", "dynamic-devices",
        "entity-category", "entity-device-class", "entity-disabled-by-default",
        "entity-translations", "exception-translations", "icon-translations",
        "reconfiguration-flow", "repair-issues", "stale-devices",
    ],
    "platinum": ["async-dependency", "inject-websession", "strict-typing"],
}
ALL_RULES = [rule for tier in TIERS for rule in RULES[tier]]
# The entity platforms (the files Home Assistant loads per platform).
PLATFORMS = ("light", "switch", "text", "select", "sensor", "number", "button", "camera")
DISCOVERY_MANIFEST_KEYS = ("bluetooth", "dhcp", "homekit", "mqtt", "ssdp", "usb", "zeroconf")
DISCOVERY_STEPS = {
    "async_step_bluetooth", "async_step_discovery", "async_step_dhcp",
    "async_step_homekit", "async_step_mqtt", "async_step_ssdp",
    "async_step_usb", "async_step_zeroconf",
}
SETUP_EXCEPTIONS = {"ConfigEntryNotReady", "ConfigEntryAuthFailed", "ConfigEntryError"}


def load_rules(path: pathlib.Path) -> dict[str, tuple[str, str]]:
    """{rule: (status, comment)} from a quality_scale.yaml; raises ValueError
    unless it lists exactly the rules, each "done" / "todo" or a mapping with
    a status and a comment (required for "exempt"), as core's schema."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    rules = data.get("rules")
    if not isinstance(rules, dict):
        raise ValueError("no rules")
    problems = [f"missing rule: {rule}" for rule in ALL_RULES if rule not in rules]
    problems += [f"unknown rule: {rule}" for rule in rules if rule not in ALL_RULES]
    result = {}
    for rule, value in rules.items():
        if isinstance(value, str) and value in ("done", "todo"):
            result[rule] = (value, "")
        elif (
            isinstance(value, dict) and set(value) == {"status", "comment"}
            and value["status"] in ("done", "todo", "exempt")
            and isinstance(value["comment"], str) and value["comment"].strip()
        ):
            result[rule] = (value["status"], value["comment"])
        else:
            problems.append(f"{rule}: expected done / todo, or a status and a comment")
    if problems:
        raise ValueError("; ".join(problems))
    return result


def _module(root: pathlib.Path, name: str) -> ast.Module | None:
    path = root / f"{name}.py"
    return ast.parse(path.read_text(encoding="utf-8")) if path.exists() else None


def _functions(module: ast.Module | None) -> dict[str, ast.AST]:
    """Every function of a module by name, methods included."""
    if module is None:
        return {}
    return {
        node.name: node for node in ast.walk(module)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _calls(node: ast.AST) -> set[str]:
    """The names of the functions and methods called inside ``node``."""
    names = set()
    for call in ast.walk(node):
        if isinstance(call, ast.Call):
            func = call.func
            names.add(func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", ""))
    return names


def _manifest(root: pathlib.Path) -> dict:
    return json.loads((root / "manifest.json").read_text(encoding="utf-8"))


# The checks: rule -> function(integration folder) -> problems. Run for the
# rules marked done.

def check_action_setup(root):
    setup = _functions(_module(root, "__init__")).get("async_setup")
    if setup is None or not any("setup" in name and "services" in name for name in _calls(setup)):
        return ["async_setup does not register the actions"]
    return []


def check_brands(root):
    return [] if (root / "brand" / "icon.png").exists() else ["no brand/icon.png"]


def check_config_flow(root):
    if not _manifest(root).get("config_flow"):
        return ["manifest.json does not set config_flow"]
    return [] if (root / "config_flow.py").exists() else ["no config_flow.py"]


def check_config_flow_test_coverage(root):
    """The config flow is tested inside Home Assistant, its whole module
    required (scripts/ha-tests.sh, run by npm run check and CI)."""
    script = (ROOT / "scripts" / "ha-tests.sh").read_text(encoding="utf-8")
    problems = []
    if not (ROOT / "tests" / "ha" / "test_config_flow.py").exists():
        problems.append("no tests/ha/test_config_flow.py")
    if "--cov=custom_components.yeelight_cube.config_flow" not in script or "--cov-fail-under=100" not in script:
        problems.append("scripts/ha-tests.sh does not require 100% of config_flow.py")
    if "scripts/ha-tests.sh" not in (ROOT / ".github" / "workflows" / "tests.yaml").read_text(encoding="utf-8"):
        problems.append("CI does not run scripts/ha-tests.sh")
    return problems


def check_config_entry_unloading(root):
    if "async_unload_entry" not in _functions(_module(root, "__init__")):
        return ["__init__.py has no async_unload_entry"]
    return []


def check_diagnostics(root):
    functions = _functions(_module(root, "diagnostics"))
    if "async_get_config_entry_diagnostics" not in functions:
        return ["diagnostics.py has no async_get_config_entry_diagnostics"]
    source = (root / "diagnostics.py").read_text(encoding="utf-8")
    return [] if "async_redact_data" in source else ["diagnostics.py redacts nothing"]


def check_discovery(root):
    if any(key in _manifest(root) for key in DISCOVERY_MANIFEST_KEYS):
        return []
    if DISCOVERY_STEPS & set(_functions(_module(root, "config_flow"))):
        return []
    return ["no discovery in manifest.json or the config flow"]


def check_docs_actions(root):
    """Every action in services.yaml is in SERVICES.md."""
    actions = yaml.safe_load((root / "services.yaml").read_text(encoding="utf-8")) or {}
    docs = (ROOT / "SERVICES.md").read_text(encoding="utf-8")
    return [f"action {name} is not in SERVICES.md" for name in actions if name not in docs]


def _classes(root):
    """Every class of the integration by name: (its base names, whether it
    sets _attr_has_entity_name to True, the module it is in)."""
    classes = {}
    for path in sorted(root.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ClassDef):
                continue
            sets_name = any(
                isinstance(item, ast.Assign)
                and isinstance(item.value, ast.Constant) and item.value.value is True
                and any(
                    getattr(target, "id", None) == "_attr_has_entity_name"
                    or getattr(target, "attr", None) == "_attr_has_entity_name"
                    for target in item.targets
                )
                for item in ast.walk(node)
            )
            bases = [getattr(base, "id", getattr(base, "attr", "")) for base in node.bases]
            classes[node.name] = (bases, sets_name, path.stem)
    return classes


def check_has_entity_name(root):
    """Every entity class of the platforms (one with a Home Assistant base)
    has the flag, set by itself or one of the integration's bases, and none
    names itself by hand (_attr_name: None only, for the device's main one)."""
    classes = _classes(root)

    def inherits(name, test):
        bases, sets_name, _module_name = classes.get(name, ([], False, ""))
        return test(name, sets_name) or any(inherits(base, test) for base in bases)

    def is_entity(name):
        return any(base not in classes or is_entity(base) for base in classes[name][0])

    problems = [
        f"{module}.py: {name} has no _attr_has_entity_name"
        for name, (bases, _sets, module) in classes.items()
        if module in PLATFORMS and bases and is_entity(name)
        and not inherits(name, lambda _name, sets_name: sets_name)
    ]
    for platform in PLATFORMS:
        module = _module(root, platform)
        for node in ast.walk(module) if module is not None else ():
            if (
                isinstance(node, ast.Assign)
                and any(getattr(t, "attr", None) == "_attr_name" for t in node.targets)
                and not (isinstance(node.value, ast.Constant) and node.value.value is None)
            ):
                problems.append(f"{platform}.py: a name set by hand (line {node.lineno})")
    return problems


def check_entity_event_setup(root):
    """An entity registers on its light through _register_on_light (entity.py),
    which unregisters it when it is removed: never by assigning itself."""
    problems = []
    for platform in PLATFORMS:
        source = (root / f"{platform}.py").read_text(encoding="utf-8")
        for match in re.finditer(
            r"self\._light_entity\.\w+ = self$|setattr\(self\._light_entity, [^,]+, self\)", source, re.M
        ):
            line = source.count("\n", 0, match.start()) + 1
            problems.append(f"{platform}.py: registers on the light without unregistering (line {line})")
    return problems


def check_entity_translations(root):
    """Every translation key the platforms set has a name in strings.json,
    and translations/en.json has the same names."""
    strings = json.loads((root / "strings.json").read_text(encoding="utf-8"))["entity"]
    english = json.loads((root / "translations" / "en.json").read_text(encoding="utf-8"))["entity"]
    problems = [] if strings == english else ["translations/en.json differs from strings.json (entity)"]
    keys = re.compile(
        r'(?:translation_key\s*=\s*|_TRANSLATION_KEY\s*=\s*|option_key\s*=\s*|_preview_adjustment\()"(\w+)"'
    )
    for platform in PLATFORMS:
        source = (root / f"{platform}.py").read_text(encoding="utf-8")
        for key in keys.findall(source):
            if key not in strings.get(platform, {}):
                problems.append(f"{platform}.py: translation key {key} has no name in strings.json")
    return problems


def check_integration_owner(root):
    return [] if _manifest(root).get("codeowners") else ["no codeowners in manifest.json"]


def check_parallel_updates(root):
    problems = []
    for platform in PLATFORMS:
        module = _module(root, platform)
        if module is None:
            continue
        if not any(
            isinstance(node, ast.Assign)
            and any(getattr(target, "id", None) == "PARALLEL_UPDATES" for target in node.targets)
            for node in module.body
        ):
            problems.append(f"{platform}.py does not set PARALLEL_UPDATES")
    return problems


def check_reconfiguration_flow(root):
    """A reconfigure step, with the same lamp check as adding one."""
    if not _probes_the_lamp(root, "async_step_reconfigure"):
        return ["the config flow has no async_step_reconfigure that tries the lamp"]
    return []


def check_icon_translations(root):
    """Every entity's translation key has its icon in icons.json, and no
    entity sets its icon in the code."""
    names = json.loads((root / "strings.json").read_text(encoding="utf-8"))["entity"]
    icons = json.loads((root / "icons.json").read_text(encoding="utf-8")).get("entity", {})
    problems = [
        f"{platform}: {key} has no icon in icons.json"
        for platform, keys in names.items() for key in keys
        if "default" not in icons.get(platform, {}).get(key, {})
    ]
    for platform in PLATFORMS:
        if "_attr_icon" in (root / f"{platform}.py").read_text(encoding="utf-8"):
            problems.append(f"{platform}.py sets an icon in the code (icons.json)")
    # The actions too (the action picker).
    actions = yaml.safe_load((root / "services.yaml").read_text(encoding="utf-8")) or {}
    service_icons = json.loads((root / "icons.json").read_text(encoding="utf-8")).get("services", {})
    problems += [
        f"action {name} has no icon in icons.json"
        for name in actions if "service" not in service_icons.get(name, {})
    ]
    return problems


def check_repair_issues(root):
    """Repairs are created through issues.py, and every issue it reports has
    its title and description in strings.json."""
    module = _module(root, "issues")
    if module is None:
        return ["no issues.py"]
    keys = next(
        (ast.literal_eval(node.value) for node in module.body
         if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "ISSUES"),
        (),
    )
    strings = json.loads((root / "strings.json").read_text(encoding="utf-8")).get("issues", {})
    problems = [] if keys else ["issues.py lists no ISSUES"]
    problems += [
        f"issue {key} has no title and description in strings.json"
        for key in keys if not {"title", "description"} <= set(strings.get(key, {}))
    ]
    return problems


def check_exception_translations(root):
    """Errors are raised through errors.py (invalid / failed, with a message
    in strings.json), never as plain HomeAssistantError or
    ServiceValidationError texts; every key used has its message."""
    messages = json.loads((root / "strings.json").read_text(encoding="utf-8")).get("exceptions", {})
    problems = []
    used = re.compile(r'\b(?:invalid|failed|InputError)\(\s*"(\w+)"')
    for path in sorted(root.glob("*.py")):
        if path.name == "errors.py":
            continue
        source = path.read_text(encoding="utf-8")
        for match in re.finditer(r"raise (?:HomeAssistantError|ServiceValidationError)\(", source):
            line = source.count("\n", 0, match.start()) + 1
            problems.append(f"{path.name}: an untranslated error (line {line})")
        for key in used.findall(source):
            if key not in messages:
                problems.append(f"{path.name}: error {key} has no message in strings.json")
    # The shared collections' messages (light_services_common: f"{kind}_gone"...).
    for kind in ("palette", "pixel_art"):
        for key in (f"{kind}s_full", f"{kind}_gone", f"{kind}_list_changed", f"{kind}_position"):
            if key not in messages:
                problems.append(f"error {key} has no message in strings.json")
    return problems


def check_runtime_data(root):
    """As hassfest's: async_setup_entry stores entry.runtime_data."""
    setup = _functions(_module(root, "__init__")).get("async_setup_entry")
    if setup is None or len(setup.args.args) != 2:
        return ["no async_setup_entry(hass, entry) in __init__.py"]
    entry = setup.args.args[1].arg
    if not any(
        isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store)
        and node.attr == "runtime_data" and getattr(node.value, "id", None) == entry
        for node in ast.walk(setup)
    ):
        return ["async_setup_entry does not set entry.runtime_data"]
    return []


def _probes_the_lamp(root, step_name):
    """Whether a config flow step tries the lamp (_lamp_answers, which runs
    the reachability probe check_tcp) before it saves anything."""
    functions = _functions(_module(root, "config_flow"))
    step, probe = functions.get(step_name), functions.get("_lamp_answers")
    return (
        step is not None and probe is not None
        and "_lamp_answers" in _calls(step) and "check_tcp" in _calls(probe)
    )


def check_test_before_configure(root):
    """Manual setup probes the lamp before creating the entry."""
    if not _probes_the_lamp(root, "async_step_user"):
        return ["async_step_user does not try the lamp before creating the entry"]
    return []


def check_test_before_setup(root):
    """As hassfest's: setup raises ConfigEntryNotReady (or another setup
    exception) somewhere in the integration."""
    for path in sorted(root.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Raise) and node.exc is not None:
                exc = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
                if getattr(exc, "id", None) in SETUP_EXCEPTIONS:
                    return []
    return [f"nothing raises one of {sorted(SETUP_EXCEPTIONS)}"]


def check_unique_config_entry(root):
    """As hassfest's: the config flow aborts a lamp already set up."""
    calls = _calls(_module(root, "config_flow"))
    if "_async_abort_entries_match" in calls or {
        "async_set_unique_id", "_abort_if_unique_id_configured"
    } <= calls:
        return []
    return ["the config flow does not prevent setting up a lamp twice"]


CHECKS = {
    "action-setup": check_action_setup,
    "brands": check_brands,
    "config-entry-unloading": check_config_entry_unloading,
    "config-flow": check_config_flow,
    "config-flow-test-coverage": check_config_flow_test_coverage,
    "diagnostics": check_diagnostics,
    "discovery": check_discovery,
    "docs-actions": check_docs_actions,
    "exception-translations": check_exception_translations,
    "icon-translations": check_icon_translations,
    "repair-issues": check_repair_issues,
    "entity-event-setup": check_entity_event_setup,
    "entity-translations": check_entity_translations,
    "has-entity-name": check_has_entity_name,
    "integration-owner": check_integration_owner,
    "parallel-updates": check_parallel_updates,
    "reconfiguration-flow": check_reconfiguration_flow,
    "runtime-data": check_runtime_data,
    "test-before-configure": check_test_before_configure,
    "test-before-setup": check_test_before_setup,
    "unique-config-entry": check_unique_config_entry,
}


def verify(rules: dict[str, tuple[str, str]], root: pathlib.Path = INTEGRATION) -> list[str]:
    """The problems of the rules marked done that have a check."""
    return [
        f"{rule}: {problem}"
        for rule, check in CHECKS.items()
        if rules[rule][0] == "done"
        for problem in check(root)
    ]


def tier_reached(rules: dict[str, tuple[str, str]]) -> str | None:
    """The highest tier whose rules, and those of the tiers below, are all
    done or exempt; None below Bronze."""
    reached = None
    for tier in TIERS:
        if any(rules[rule][0] == "todo" for rule in RULES[tier]):
            break
        reached = tier
    return reached


def main() -> int:
    try:
        rules = load_rules(INTEGRATION / "quality_scale.yaml")
    except ValueError as err:
        print(f"FAIL quality_scale.yaml: {err}")
        return 1
    for tier in TIERS:
        statuses = [rules[rule][0] for rule in RULES[tier]]
        todo = [rule for rule in RULES[tier] if rules[rule][0] == "todo"]
        print(
            f"{tier.capitalize():9} {statuses.count('done'):2} done, "
            f"{statuses.count('exempt'):2} exempt, {len(todo):2} to do"
            + (f": {', '.join(todo)}" if todo else "")
        )
    checked = [rule for rule in CHECKS if rules[rule][0] == "done"]
    problems = verify(rules)
    print(f"Checked by script: {len(checked)} of the rules marked done")
    for problem in problems:
        print(f"FAIL {problem}")
    reached = tier_reached(rules)
    print(f"Tier reached (self-assessed): {reached.capitalize() if reached else 'none (below Bronze)'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
