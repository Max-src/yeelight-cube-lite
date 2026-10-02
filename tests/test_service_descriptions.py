import json
import re
import unittest

from tests.test_native_features import ROOT

COMPONENT = ROOT  # the integration folder


def _services_yaml():
    """{service: [field, ...]} from services.yaml (top-level keys and the keys under `fields:`)."""
    services, current, in_fields = {}, None, False
    for line in (COMPONENT / "services.yaml").read_text(encoding="utf-8").splitlines():
        if m := re.match(r"^([a-z_]+):", line):
            current, in_fields = m.group(1), False
            services[current] = []
        elif re.match(r"^  fields:", line):
            in_fields = True
        elif re.match(r"^  [a-z_]+:", line):
            in_fields = False
        elif in_fields and (m := re.match(r"^    ([a-z0-9_]+):", line)):
            services[current].append(m.group(1))
    return services


def _registered_services():
    names = set()
    for path in COMPONENT.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        names |= set(re.findall(r'(?:async_register|register_entity_service)\(\s*(?:DOMAIN,\s*)?"([a-z_]+)"', source))
        names |= set(re.findall(r'^SERVICE_[A-Z_]+ = "([a-z_]+)"', source, re.M))
    return names


class ServiceDescriptionTests(unittest.TestCase):
    def test_services_yaml_has_no_byte_order_mark(self):
        self.assertFalse((COMPONENT / "services.yaml").read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_every_registered_service_is_described(self):
        self.assertEqual(set(_services_yaml()), _registered_services())

    def test_translations_cover_every_service_and_field(self):
        services = _services_yaml()
        for path in ("strings.json", "translations/en.json"):
            translated = json.loads((COMPONENT / path).read_text(encoding="utf-8"))["services"]
            with self.subTest(path=path):
                self.assertEqual(set(translated), set(services))
                for service, fields in services.items():
                    entry = translated[service]
                    self.assertEqual(set(entry.get("fields", {})), set(fields), service)
                    texts = [entry["name"], entry["description"]]
                    for field in entry.get("fields", {}).values():
                        self.assertEqual(set(field), {"name", "description"}, service)
                        texts += field.values()
                    for text in texts:
                        # non-empty, trimmed, and no {placeholders} or <tags>,
                        # which Home Assistant's translations would misread
                        self.assertTrue(text and text == text.strip(), (service, text))
                        self.assertNotRegex(text, r"[{}]|<[A-Za-z/]", service)


if __name__ == "__main__":
    unittest.main()
