"""Lamps only in Home Assistant's Matter integration, offered as discovered
(matter_discovery.py)."""

from pathlib import Path
import sys
import types
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from ha_stubs import import_pure_module  # noqa: E402
from test_matter_link import CUBE_ATTRIBUTES, LAMP_IP, LAMP_MAC  # noqa: E402

DISCOVERY = import_pure_module("matter_discovery")
CONST = import_pure_module("const")
IP, MAC = CONST.CONF_IP, CONST.CONF_MATTER_MAC


class MatterOnlyLampsTests(unittest.TestCase):
    def test_a_cube_lite_no_entry_has_is_offered_with_its_wifi_address(self):
        # Its Wi-Fi interface, not the access point one (192.168.4.1, no MAC).
        self.assertEqual([(LAMP_IP, LAMP_MAC)], DISCOVERY.matter_only_lamps([CUBE_ATTRIBUTES], []))

    def test_a_lamp_already_set_up_is_not(self):
        by_ip = {IP: LAMP_IP}
        by_mac = {IP: "192.168.4.200", MAC: LAMP_MAC}
        for entry in (by_ip, by_mac):
            self.assertEqual([], DISCOVERY.matter_only_lamps([CUBE_ATTRIBUTES], [entry]))
        self.assertEqual([(LAMP_IP, LAMP_MAC)], DISCOVERY.matter_only_lamps([CUBE_ATTRIBUTES], [{IP: "10.0.0.9"}]))

    def test_other_devices_and_lamps_without_an_address_are_not(self):
        other = {**CUBE_ATTRIBUTES, "0/40/2": 0x117C}
        access_point_only = {**CUBE_ATTRIBUTES, "0/51/0": [CUBE_ATTRIBUTES["0/51/0"][0]]}
        self.assertEqual([], DISCOVERY.matter_only_lamps([other, access_point_only], []))

    def test_scanned_at_most_every_ten_minutes_and_only_with_matter(self):
        hass = types.SimpleNamespace(
            data={},
            config_entries=types.SimpleNamespace(async_loaded_entries=lambda domain: []),
        )
        DISCOVERY.async_offer_matter_lamps(hass)  # no Matter integration: nothing
        scanned = hass.data[DISCOVERY._SCANNED_AT]
        DISCOVERY.async_offer_matter_lamps(hass)
        self.assertEqual(scanned, hass.data[DISCOVERY._SCANNED_AT])


if __name__ == "__main__":
    unittest.main()
