"""The lamp models (device_profile.py): the Cube Lite and the Cube Matrix.

The Cube Matrix facts are from the lamp itself (2026-11-08, filmed: a base
and 4 modules of 5 x 5 in a row, SSDP model CubeMatrix fw_ver 92,
cube_topology "1,1,1,1,3,3,0,0,", rotation_angle 3, strip_lenth 110); see
docs/CUBE_MATRIX.md.
"""

import ast
import runpy
import unittest

from tests.fakes import lamp_client_source
from tests.test_native_features import ROOT

PROFILE = runpy.run_path(ROOT / "device_profile.py")
CUBE_MATRIX_SUPPORT = (
    "get_prop set_default set_power toggle set_bright set_scene cron_add cron_get cron_del start_cf stop_cf "
    "set_name set_adjust adjust_bright set_ct_abx adjust_ct adjust_color set_rgb set_hsv set_music "
    "set_segment_rgb set_music_data udp_sess_new udp_sess_keep_alive udp_chroma_sess_new "
    "get_supported_fx_mode activate_fx_mode deactivate_fx_mode update_music_data update_leds"
).split()


def filmed_profile():
    return PROFILE["profile_for"]("CubeMatrix", CUBE_MATRIX_SUPPORT, "1,1,1,1,3,3,0,0,", "110")


class ModelTests(unittest.TestCase):
    def test_models_are_told_apart(self):
        key = PROFILE["model_key"]
        self.assertEqual(key("CubeMatrix"), PROFILE["CUBEMATRIX"])
        self.assertEqual(key("cubematrix"), PROFILE["CUBEMATRIX"])
        self.assertEqual(key("CubeLite"), PROFILE["CUBELITE"])
        self.assertIsNone(key("color"))
        self.assertIsNone(key(None))

    def test_an_unknown_model_is_a_cube_lite(self):
        # Entries made before models were told apart are Cube Lites.
        self.assertIs(PROFILE["profile_for"](None), PROFILE["CUBE_LITE_PROFILE"])
        lite = PROFILE["CUBE_LITE_PROFILE"]
        self.assertTrue(lite.native_effects and lite.matter and lite.microphone)
        self.assertFalse(lite.streams_effects)

    def test_the_cube_lite_frame_is_sent_as_it_is(self):
        frame = [(i, 0, 0) for i in range(100)]
        self.assertIs(PROFILE["CUBE_LITE_PROFILE"].to_wire(frame), frame)
        self.assertTrue(PROFILE["CUBE_LITE_PROFILE"].accepts("set_fx_effect"))


class CubeMatrixTests(unittest.TestCase):
    def test_the_filmed_lamp_has_four_modules(self):
        profile = filmed_profile()
        self.assertEqual(profile.modules, 4)
        self.assertEqual(profile.wire_length, 110)
        self.assertTrue(profile.streams_effects)
        self.assertFalse(profile.matter or profile.microphone or profile.lamp_settings)

    def test_topology_stops_at_the_first_zero(self):
        # As Yeelight Station reads it.
        self.assertEqual(PROFILE["parse_topology"]("1,1,1,1,3,3,0,0,"), [1, 1, 1, 1, 3, 3])
        self.assertEqual(PROFILE["parse_topology"]("2,2,0,2"), [2, 2])
        self.assertEqual(PROFILE["parse_topology"](""), [])

    def test_fewer_modules_follow_the_strip_length(self):
        self.assertEqual(PROFILE["profile_for"]("CubeMatrix", (), "2,2,0", "50").modules, 2)
        # Nothing read: the 4 modules of the 20 x 5 panel.
        self.assertEqual(PROFILE["profile_for"]("CubeMatrix").modules, 4)

    def test_wire_order_is_module_by_module_column_by_column_from_the_bottom(self):
        # Filmed: wire pixel 0 = the bottom-left LED of the module at the
        # base, 1-4 up that column, 5 the next column's bottom, 25 the next
        # module. Lamp order is row * 20 + column (row 0 the bottom).
        profile = filmed_profile()
        frame = [(row, column, 0) for row in range(5) for column in range(20)]
        wire = profile.to_wire(frame)
        self.assertEqual(len(wire), 110)
        for module in range(4):
            for column in range(5):
                for row in range(5):
                    self.assertEqual(
                        wire[module * 25 + column * 5 + row], (row, module * 5 + column, 0)
                    )
        # Then the two spot slots, past the 20 x 5 panel (the factory list:
        # configured, not fitted): dark.
        self.assertEqual(set(wire[100:]), {(0, 0, 0)})

    def test_the_columns_shown_and_the_layout_follow_the_modules(self):
        # 2026-11-14, the owner's lamp after module splicing in the app:
        # Matrix, Matrix, Spot, Matrix (2,2,3,2, strip 80). Its Spot takes a
        # block's place in the chain (2026-11-15, the owner: the lamp covers
        # 4 modules' length): one light for columns 10-14, the last block
        # columns 15-19, so effects use all 20.
        profile = PROFILE["profile_for"]("CubeMatrix", (), "2,2,3,2,0,0,0,0,", "80", "0")
        self.assertEqual(20, profile.columns)
        self.assertEqual([
            {"type": "matrix", "column": 0}, {"type": "matrix", "column": 5},
            {"type": "spot", "column": 10}, {"type": "matrix", "column": 15},
        ], profile.layout)
        frame = [(10 * column, row, 0) for row in range(5) for column in range(20)]
        wire = profile.to_wire(frame)
        self.assertEqual(80, len(wire))
        # Columns 10-14: their average (120, 2) as bright as their brightest
        # pixel (140): (140, 2).
        self.assertEqual((140, 2, 0), wire[50])
        self.assertEqual(set(wire[51:55]), {(0, 0, 0)})
        self.assertEqual(wire[55], (150, 0, 0))  # the last block: columns 15-19
        self.assertEqual(wire[79], (190, 4, 0))
        self.assertEqual(76, len(profile.drawing_pixels(wire)))
        self.assertEqual((140, 2, 0), profile.drawing_pixels(wire)[50])
        # Four blocks: all 20; a Panel counts as a block; a Cube Lite: 20, no layout.
        self.assertEqual(20, PROFILE["profile_for"]("CubeMatrix", (), "2,2,2,2", "100").columns)
        self.assertEqual("panel", PROFILE["profile_for"]("CubeMatrix", (), "1,2", "50").layout[0]["type"])
        self.assertEqual(10, PROFILE["profile_for"]("CubeMatrix", (), "1,2", "50").columns)
        self.assertEqual((20, []), (PROFILE["CUBE_LITE_PROFILE"].columns, PROFILE["CUBE_LITE_PROFILE"].layout))

    def test_the_module_names_list_every_module(self):
        # The Modules card's list: every module by name, in chain order.
        profile = PROFILE["profile_for"]("CubeMatrix", (), "2,2,3,2,0,0,0,0,", "80", "0")
        self.assertEqual(["matrix", "matrix", "spot", "matrix"], profile.module_names)
        six = PROFILE["profile_for"]("CubeMatrix", (), "2,2,2,2,1,3", "155")
        self.assertEqual(["matrix", "matrix", "matrix", "matrix", "panel", "spot"], six.module_names)
        self.assertEqual(6, len(six.layout))
        self.assertEqual([], PROFILE["CUBE_LITE_PROFILE"].module_names)
        # The factory list: 4 blocks, then 2 spot slots not fitted: 20 columns.
        factory = PROFILE["profile_for"]("CubeMatrix", (), "1,1,1,1,3,3,0,0,", "110")
        self.assertEqual((20, 20, 4), (factory.columns, factory.width, len(factory.layout)))

    def test_a_long_chain_is_drawn_on_a_panel_as_wide_as_its_modules(self):
        # 2026-11-21: matrix x3, spot, panel (the owner's lamp, 105 LEDs): the
        # panel was dark whenever Home Assistant drew, its columns past 20.
        five = PROFILE["profile_for"]("CubeMatrix", (), "2,2,2,3,1,0,0,0,", "105")
        self.assertEqual((25, 25, 125), (five.columns, five.width, five.pixels))
        self.assertEqual([0, 5, 10, 15, 20], [module["column"] for module in five.layout])
        frame = [(column, row, 9) for row in range(5) for column in range(25)]
        wire = five.to_wire(frame)
        self.assertEqual(105, len(wire))
        # The panel (5th module): its 5 columns, each bottom to top.
        self.assertEqual([(20 + i // 5, i % 5, 9) for i in range(25)], wire[80:105])
        # The spot: one light, the colour of columns 15-19.
        self.assertNotEqual((0, 0, 0), wire[75])
        self.assertEqual([(0, 0, 0)] * 4, wire[76:80])
        self.assertEqual(4 * 25 + 1, len(five.drawing_pixels(wire)))
        # The most the lamp takes: 8 modules, 40 columns; the 9th is dropped.
        eight = PROFILE["profile_for"]("CubeMatrix", (), "2,1,3,2,2,3,1,2,", "160")
        self.assertEqual((40, 40, 8), (eight.columns, eight.width, len(eight.layout)))
        nine = PROFILE["profile_for"]("CubeMatrix", (), "2,2,2,2,2,2,2,2,2", "225")
        self.assertEqual(8, len(nine.module_names))
        self.assertEqual(8 * 25, len(nine.drawing_pixels(nine.to_wire([(1, 2, 3)] * nine.pixels))))
        # Four modules or fewer: the 20-wide panel as before.
        self.assertEqual((15, 20), (PROFILE["profile_for"]("CubeMatrix", (), "2,3,2", "55").columns,
                                    PROFILE["profile_for"]("CubeMatrix", (), "2,3,2", "55").width))
        self.assertEqual(20, PROFILE["CUBE_LITE_PROFILE"].width)

    def test_a_spot_slot_takes_five_leds_where_it_is_in_the_chain(self):
        # The lamp (1.12.92, set_segment_rgb / update_leds): a type-3 slot is 5
        # LEDs, any other 25, in topology order. A spot lights its first LED
        # only (filmed 2026-11-14), for the 5 columns it covers.
        profile = PROFILE["profile_for"]("CubeMatrix", (), "2,3,2,0", "55")
        self.assertEqual(profile.slots, (25, 5, 25))
        self.assertEqual(profile.modules, 2)
        self.assertEqual(15, profile.columns)
        frame = [(row, column, 1) for row in range(5) for column in range(20)]
        wire = profile.to_wire(frame)
        self.assertEqual(len(wire), 55)
        self.assertEqual(wire[0], (0, 0, 1))
        self.assertEqual(wire[24], (4, 4, 1))
        # Columns 5-9: average (2, 7, 1), brightest channel 9: (3, 9, 1).
        self.assertEqual(wire[25], (3, 9, 1))
        self.assertEqual(set(wire[26:30]), {(0, 0, 0)})
        self.assertEqual(wire[30], (0, 10, 1))  # the second block shows columns 10-14
        self.assertEqual(wire[54], (4, 14, 1))

    def test_a_spot_lights_for_what_passes_its_columns(self):
        # A single dot in the spot's 5 columns lights it fully, in its colour;
        # nothing there: dark.
        profile = PROFILE["profile_for"]("CubeMatrix", (), "2,2,3,2", "80")
        frame = [(0, 0, 0)] * 100
        self.assertEqual((0, 0, 0), profile.to_wire(frame)[50])
        frame[2 * 20 + 12] = (255, 120, 0)
        self.assertEqual((255, 120, 0), profile.to_wire(frame)[50])

    def test_only_listed_commands_are_sent(self):
        profile = filmed_profile()
        for method in ("update_leds", "activate_fx_mode", "set_bright", "set_power", "udp_sess_new",
                       "udp_sess_keep_alive", "set_segment_rgb", "start_cf"):
            self.assertTrue(profile.accepts(method), method)
        # Answered "method not supported" by the lamp (filmed session).
        for method in ("set_fx_effect", "update_fx_effect", "reset_fx_effect", "set_ps", "get_fx_effect",
                       "update_persist_effect_list"):
            self.assertFalse(profile.accepts(method), method)

    def test_its_music_modes(self):
        self.assertEqual(
            PROFILE["CUBEMATRIX_MUSIC_MODES"],
            ("music_spectrum", "music_breathing", "music_gather", "music_blossom"),
        )


class WiringTests(unittest.TestCase):
    """Where the profile is used (source checks: the modules import Home Assistant)."""

    def source(self, name):
        return (ROOT / name).read_text(encoding="utf-8")

    def test_every_frame_leaves_in_the_model_order(self):
        self.assertIn("return self.device_profile.to_wire(sent)", self.source("light_color.py"))
        self.assertIn("self.device_profile.to_wire([(0, 0, 0)]", self.source("light_native.py"))

    def test_the_transport_refuses_what_the_lamp_does_not_list(self):
        source = lamp_client_source()
        tree = ast.parse(source)
        guarded = {
            node.name for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef)
            and "self._check_supported(command, params)" in ast.get_source_segment(source, node)
        }
        self.assertEqual(guarded, {"send_raw_command", "send_command_fast", "send_command_with_recovery"})

    def test_a_cube_matrix_streams_every_effect_but_microphone_ones(self):
        source = self.source("light_studio.py")
        self.assertIn("if self.device_profile.streams_effects:", source)
        self.assertIn("if self._native_effect in LAMP_MUSIC_EFFECTS:", source)
        # Unless the lamp shows it itself over Matter (light_matrix).
        self.assertIn('native = getattr(self, "matrix_native_command", None)', source)
        self.assertIn("camera.simulated_lamp_frame()", source)
        # In raw colours: the Cube Matrix converts each pixel itself.
        self.assertIn("with raw_colours():", source)

    def test_cube_lite_only_entities_are_left_out(self):
        self.assertIn("CUBE_LITE_ONLY_SELECTS", self.source("select.py"))
        self.assertIn("light_entity.device_profile.matter", self.source("event.py"))
        self.assertIn("matter = light_entity.device_profile.matter", self.source("switch.py"))

    def test_discovery_and_setup_know_the_cube_matrix(self):
        self.assertIn("model_key(model) == CUBEMATRIX", self.source("__init__.py"))
        self.assertIn("_cube_matrix_layout", self.source("config_flow.py"))
        self.assertIn("stored_model = entry.data.get(CONF_MODEL)", self.source("light.py"))


if __name__ == "__main__":
    unittest.main()
