"""The raw debug action's guard (fx_guard.py): what hangs or restarts a lamp is
refused, on the lamp's own profile, and everything else still goes through."""
import base64
import unittest

from ha_stubs import import_pure_module

GUARD = import_pure_module("fx_guard")
refusal = GUARD.fx_refusal
command = GUARD.command_refusal


def blob(size):
    return base64.b64encode(bytes(size)).decode("ascii")


class FullPanelTests(unittest.TestCase):
    def test_the_slot_table_and_the_rate_limits(self):
        for config in (
            {"mode": 82}, {"mode": 99, "rate": 10}, {"mode": 40, "mixer": 90},
            {"mode": 28, "rate": 255}, {"mode": 51, "rate": 240},
            {"mode": 40, "mixer": 28, "rate": 255}, {"mode": 40, "mixer": 51, "rate": 240},
        ):
            self.assertIsNotNone(refusal(config), config)

    def test_low_intensity(self):
        for config in (
            {"mode": 15, "intensity": 12}, {"mode": 15, "intensity": 0},
            {"mode": 70, "intensity": 0}, {"mode": 40, "mixer": 15, "intensity": 3},
            {"mode": 40, "mixer": 70, "intensity": 0},
        ):
            self.assertIsNotNone(refusal(config), config)
        for config in (
            {"mode": 15, "intensity": 13}, {"mode": 15}, {"mode": 70, "intensity": 1},
            {"mode": 70}, {"mode": 39, "intensity": 0},
        ):
            self.assertIsNone(refusal(config), config)

    def test_drawings(self):
        drawing = {"mode": 36, "data": blob(400)}
        self.assertIsNone(refusal(drawing))
        for config in (
            {"mode": 36}, {"mode": 36, "data": blob(399)}, {"mode": 36, "data": "not base64!"},
            {**drawing, "mixer": 1}, {**drawing, "end": 50},
            {"mode": 67, "data": blob(301)}, {"mode": 40, "mixer": 36},
            {"mode": 40, "mixer": 64}, {"mode": 40, "mixer": 67},
        ):
            self.assertIsNotNone(refusal(config), config)
        self.assertIsNone(refusal({"mode": 67, "data": blob(300)}))
        self.assertIsNotNone(refusal({"mode": 67, "data": "!" + blob(400)[1:]}))
        self.assertIsNotNone(refusal({"mode": 39, "data": [1, 2]}))
        self.assertIsNone(refusal({"mode": 64}))

    def test_at_most_four_colors(self):
        self.assertIsNotNone(refusal({"mode": 39, "color": [1, 2, 3, 4, 5]}))
        self.assertIsNone(refusal({"mode": 8, "color": [1, 2, 3, 4]}))
        self.assertIsNone(refusal({"mode": 39, "color": 33553920}))

    def test_what_a_config_does_not_say_is_left_alone(self):
        for config in (
            None, {}, {"onoff": 1}, {"mode": 81}, {"mode": 28, "rate": 254},
            {"mode": 51, "rate": 239}, {"mode": 39, "rate": 255},
            {"mode": 40, "mixer": 0, "rate": 255}, {"mode": 15}, {"mode": 70},
        ):
            self.assertIsNone(refusal(config), config)

    def test_a_value_the_guard_cannot_judge_or_the_lamp_would_wrap(self):
        for config in (
            {"mode": "x"}, {"mode": None, "rate": 255}, {"mode": 99, "mixer": "x"},
            {"mode": 28, "rate": "fast"}, {"mode": 28, "rate": -1}, {"mode": 70, "intensity": 256},
            {"mode": 15, "intensity": 261}, {"mode": 1.5}, {"mode": True}, {"mode": 39, "end": "x"},
            {"mode": 39, "end": 200}, {"mode": 39, "start": 50, "end": 50}, {"mode": 39, "direction": 4},
            {"mode": float("inf")},
        ):
            self.assertIsNotNone(refusal(config), config)

    def test_a_full_panel_is_safe_for_every_renderer_direction_and_profile(self):
        for slot in range(82):
            if slot == 36:
                continue
            for direction in range(4):
                for profile in range(4):
                    config = {"mode": slot, "direction": direction}
                    self.assertIsNone(refusal(config, profile), config)


class PartialSegmentTests(unittest.TestCase):
    def test_the_length_limits(self):
        for config in (
            {"mode": 74, "end": 15}, {"mode": 59, "start": 10, "end": 20},
            {"mode": 47, "end": 1}, {"mode": 60, "end": 1}, {"mode": 40, "mixer": 74, "end": 10},
        ):
            self.assertIsNotNone(refusal(config), config)
        self.assertIsNone(refusal({"mode": 74, "end": 20}, 2))

    def test_the_restart_seen_on_the_lamp_and_its_profile(self):
        # Slot 49, 37 pixels, direction 0, profile 2 restarted the lamp 3 times of 3.
        restart = {"mode": 49, "end": 37, "direction": 0}
        self.assertIn("past its buffer", refusal(restart, 2))
        # The same bytes draw another direction on another profile.
        self.assertIsNone(refusal({**restart, "direction": 1}, 2))
        self.assertIsNone(refusal({**restart, "end": 35}, 2))
        self.assertIsNone(refusal(restart, 3))
        self.assertIsNotNone(refusal({**restart, "direction": 3}, 3))

    def test_a_direction_not_sent_may_be_any(self):
        self.assertIsNotNone(refusal({"mode": 49, "end": 37}, 2))

    def test_tide_divides_by_a_box_of_one_row(self):
        self.assertIn("Tide", refusal({"mode": 48, "end": 21, "direction": 0}, 2))
        self.assertIn("Tide", refusal({"mode": 35, "end": 21, "direction": 1}, 2))

    def test_the_clock_overlay_on_any_mode(self):
        self.assertIn("clock overlay", refusal({"mode": 40, "mixer": 0, "end": 21}, 2))
        self.assertIn("clock overlay", refusal({"mode": 24, "mixer": 1, "end": 21}, 2))
        self.assertIsNone(refusal({"mode": 40, "mixer": 0, "end": 20}, 2))


class CommandTests(unittest.TestCase):
    RUNNING = [3, 0, 4, {"mode": 28, "rate": 50}]

    def test_the_presets_that_free_static_memory(self):
        for preset in (41, 43):
            params = [preset, 0, 4, {"mode": 40, "mixer": 39}]
            self.assertIn(str(preset), command("set_fx_effect", params, None))
        # The slots themselves are not the problem: the component sends them so.
        self.assertIsNone(command("set_fx_effect", [3, 0, 4, {"mode": 41}], None))
        self.assertIsNone(command("set_power", [41], None))

    def test_a_key_not_sent_is_the_presets(self):
        for params in (
            [15, 0, 4, {"intensity": 5}], [47, 0, 4, {"end": 1}],
            [48, 0, 4, {"end": 21, "direction": 0}], [71, 0, 4, {"mode": 15}],
            [71, 0, 4, {"mode": 70}], [70, 0, 4, {"intensity": 0}], [88, 0, 4, {"end": 10}],
            [28, 0, 4, {"rate": 255}], [51, 0, 4, {"rate": 240}], [99, 0, 4, {}], [99],
            [36, 0, 4, {}], [36], [36, 0, 4, "x"], [28, 0, 4, 7, {"rate": 255}],
        ):
            self.assertIsNotNone(command("set_fx_effect", params, None), params)
        for params in (
            [15, 0, 4, {"intensity": 13}], [15], [71, 0, 4, {"mode": 10}], [3, 0, 4, {}],
            [91, 0, 4, {"rate": 255}], [64, 0, 4, {"mode": 70}], [40, 0, 4, {"data": "AQABAQ=="}],
        ):
            self.assertIsNone(command("set_fx_effect", params, None), params)
        # A preset's own direction: Bonfire's is 3.
        self.assertEqual(
            refusal({"mode": 34, "end": 37, "direction": 3}, 2),
            command("set_fx_effect", [34, 0, 4, {"end": 37}], None, 2),
        )

    def test_a_command_it_cannot_read_is_refused(self):
        for params in (["x", 0, 4, {"mode": 39}], [None], [], "x", None):
            self.assertIsNotNone(command("set_fx_effect", params, None), params)
        self.assertIsNotNone(command("update_fx_effect", "x", None))

    def test_a_live_update_is_judged_on_what_it_leaves_running(self):
        running = [3, 0, 4, {"mode": 49, "end": 35, "direction": 1}]
        self.assertIsNone(command("update_fx_effect", [{"direction": 1}], running, 2))
        running = [3, 0, 4, {"mode": 49, "end": 37, "direction": 1}]
        self.assertIsNotNone(command("update_fx_effect", [{"direction": 0}], running, 2))
        self.assertIsNone(command("set_power", ["on"], self.RUNNING))

    def test_an_update_must_be_safe_whatever_runs(self):
        # Whatever the guard last saw: the app or a button may have changed it.
        for running in (None, self.RUNNING, [3, 0, 4, {"mode": 39}]):
            for update in (
                {"rate": 255}, {"rate": 240}, {"intensity": 5}, {"mode": 28}, {"mode": 99},
                {"mixer": 1}, {"end": 37}, {"start": 1}, {"data": "AAAA"}, {"color": [1, 2, 3, 4, 5]},
            ):
                self.assertIsNotNone(command("update_fx_effect", [update], running), update)
            for update in ({"rate": 239}, {"intensity": 128}, {"direction": 2}, {"color": [1]}):
                self.assertIsNone(command("update_fx_effect", [update], running), update)

    def test_each_segment_of_an_update(self):
        self.assertIsNotNone(command("update_fx_effect", [{}, {"rate": 255}], None))
        self.assertIsNotNone(command("update_fx_effect", ["x", {"mode": 28}], None))

    def test_every_segment_of_a_command_and_the_stored_button_list(self):
        good, bad = {"mode": 39}, {"mode": 28, "rate": 255}
        self.assertIsNotNone(command("set_fx_effect", [3, 0, 4, good, bad], None))
        stored = [0, {"effect_id": 3, "effect_params": [bad]}]
        self.assertIsNotNone(command("update_persist_effect_list", stored, None))
        stored = [0, {"effect_id": 43, "effect_params": [good]}]
        self.assertIsNotNone(command("update_persist_effect_list", stored, None))
        stored = [0, {"effect_id": 15, "effect_params": [{"intensity": 3}]}]
        self.assertIsNotNone(command("update_persist_effect_list", stored, None))
        stored = [0, {"effect_id": 39, "effect_params": [good]}]
        self.assertIsNone(command("update_persist_effect_list", stored, None))
        self.assertIsNone(command("update_persist_effect_list", [0], None))

    def test_a_raw_effect_is_remembered_for_the_next_update(self):
        after = GUARD.running_after
        self.assertEqual(self.RUNNING, after("set_fx_effect", self.RUNNING, None))
        updated = after("update_fx_effect", [{"rate": 60}], self.RUNNING)
        self.assertEqual([3, 0, 4, {"mode": 28, "rate": 60}], updated)
        self.assertIsNone(after("update_fx_effect", [{"rate": 60}], None))
        two = [3, 0, 4, {"mode": 39}, {"mode": 28}]
        self.assertEqual([3, 0, 4, {"mode": 39}, {"mode": 28, "rate": 9}], after("update_fx_effect", [{}, {"rate": 9}], two))

    def test_both_raw_actions_are_guarded_and_raw_effects_stay_apart(self):
        from pathlib import Path

        source = (Path(GUARD.__file__).parent / "light_services_diagnostics.py").read_text(encoding="utf-8")
        self.assertEqual(2, source.count("command_refusal(method, params, running, target.effect_profile)"))
        self.assertNotIn("note_running_effect", source)


if __name__ == "__main__":
    unittest.main()
