"""The lamp's renderers (lamp_renderers.py, www/lamp-renderers.js) against
what the lamp draws: every reference frame of the lamp's Fireworks
(tests/fixtures/lamp_fireworks_frames.json.gz) must come out the same,
records and all."""

import gzip
import json
import runpy
import shutil
import subprocess
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "yeelight_cube"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "lamp_fireworks_frames.json.gz"
APPEARANCE = Path(__file__).resolve().parent / "fixtures" / "lamp_led_appearance.json"
MAGIC = Path(__file__).resolve().parent / "fixtures" / "lamp_magic_frames.json"
LAMP = runpy.run_path(str(ROOT / "lamp_renderers.py"))
PREVIEW = runpy.run_path(str(ROOT / "native_effect_preview.py"))


def _runs():
    return json.loads(gzip.decompress(FIXTURE.read_bytes()))["runs"]


def _draws(text):
    if text == "-":
        return []
    out = []
    for draw in text.split(";"):
        index, colour = draw.split(":")
        value = int(colour, 16)
        out.append((int(index, 16), (value >> 16) & 255, (value >> 8) & 255, value & 255))
    return out


class FireworksLampTests(unittest.TestCase):
    def test_every_recorded_lamp_frame(self):
        frames = 0
        for index, run in enumerate(_runs()):
            state = LAMP["FireworksState"](run["n"])
            state.state, state.launches, state.dying = run["state"], run["launches"], run["dying"]
            for number, frame in enumerate(run["frames"]):
                label = f'run {index} frame {number}'
                reads = iter(zip(frame["sites"], frame["reads"]))

                def read(site):
                    expected, value = next(reads)
                    self.assertEqual(expected, site, label)
                    return value

                draws = LAMP["fireworks_step"](
                    state, run["n"], run["rate"], run["intensity"],
                    run["selector"], run["word"], read,
                )
                self.assertIsNone(next(reads, None), f"every read taken: {label}")
                self.assertEqual(_draws(frame["draws"]), draws, label)
                self.assertEqual(frame["state"], state.state, label)
                self.assertEqual(frame["launches"], state.launches, label)
                self.assertEqual(frame["side"], state.side, label)
                self.assertEqual(frame["dying"], format(state.dying, "08x"), label)
                self.assertEqual(frame["crc"], format(zlib.crc32(bytes(state.records)), "08x"), label)
                frames += 1
        self.assertEqual(2656, frames)

    def test_the_mapper_places_the_strip_as_on_the_lamp(self):
        frame_of = lambda direction, pixel: LAMP["frame_index"](
            LAMP["panel_index"](pixel, 100, direction, 2)
        )
        # Profile 2, direction 0 (the box the app's pictures are drawn in):
        # column c, row r from the top is buffer index c * 5 + 4 - r.
        self.assertEqual(4, LAMP["panel_index"](0, 100, 0, 2))
        self.assertEqual(9, LAMP["panel_index"](1, 100, 0, 2))
        # The first pixel of the strip (the flare's start): Up top-left, Down
        # bottom-right (as the earlier calibration saw), Left bottom-left,
        # Right top-right; Left and Right then climb column by column.
        self.assertEqual({0: 80, 1: 19, 2: 0, 3: 99}, {d: frame_of(d, 0) for d in range(4)})
        self.assertEqual([0, 20, 40, 60, 80, 1], [frame_of(2, i) for i in range(6)])
        # Every pixel lands once, whatever the direction or profile.
        for profile in range(4):
            for direction in range(4):
                indexes = {LAMP["panel_index"](i, 100, direction, profile) for i in range(100)}
                self.assertEqual(set(range(100)), indexes)

    def test_a_shots_length_is_known_without_drawing_it(self):
        for rate in (0, 1, 50, 128, 200, 255):
            for shot in range(12):
                state, read, renders = LAMP["FireworksState"](), LAMP["_shot_source"](shot), 0
                while True:
                    LAMP["fireworks_step"](state, 100, rate, 128, 14, 0, read)
                    renders += 1
                    if state.state == 0:
                        break
                self.assertEqual(renders, LAMP["_fireworks_shot_length"](shot, rate), (rate, shot))
        # On the lamp, at rate 128, a shot with the shortest pause
        # is 133 renders (5.3 s).
        self.assertTrue(any(
            LAMP["_fireworks_shot_length"](shot, 128) in range(128, 140) for shot in range(20)
        ))

    def test_any_moment_is_the_continuous_run(self):
        for rate in (0, 100, 255):
            state, shot = LAMP["FireworksState"](), 0
            read = LAMP["_shot_source"](0)
            timeline = LAMP["_FireworksTimeline"](rate)
            for render in range(700):
                if render and state.state == 0:
                    shot += 1
                    read = LAMP["_shot_source"](shot)
                expected = LAMP["fireworks_step"](state, 100, rate, 128, 14, 0, read)
                self.assertEqual(expected, timeline.draws_at(render), (rate, render))
            self.assertGreater(shot, 3)
        # Back in time, or far ahead, gives the same frames again.
        early = LAMP["render_fireworks"](2.0, 50, 0)
        LAMP["render_fireworks"](3600.0, 50, 0)
        self.assertEqual(early, LAMP["render_fireworks"](2.0, 50, 0))

    def test_previews_on_their_own_clocks_do_not_replay_a_shot(self):
        reference = LAMP["_FireworksTimeline"](50)
        expected = [reference.draws_at(render) for render in range(700)]
        timeline = LAMP["_FireworksTimeline"](50)
        for render in range(30, 680):
            for offset in (19, 0, 7):  # a clock ahead reads first
                self.assertEqual(expected[render + offset], timeline.draws_at(render + offset))
            self.assertLessEqual(len(timeline.shots), 6)
        # A shot is computed once: reading it behind its end adds no render.
        record = next(reversed(timeline.shots.values()))
        renders = len(record.draws)
        for back in range(5):
            timeline.draws_at(680 - back)
        self.assertEqual(renders, len(record.draws))

    def test_the_preview_draws_the_lamp(self):
        # The previews' phase is seconds x (0.25 + speed / 55): the lamp's
        # renderer gets the seconds and the speed (its rate) back.
        for speed in (10, 50, 100):
            for name, direction in (("Up", 0), ("Down", 1), ("Left", 2), ("Right", 3)):
                seconds = 4.36
                phase = seconds * (0.25 + speed / 55.0)
                expected = LAMP["render_fireworks"](seconds, speed, direction)
                self.assertEqual(
                    expected,
                    PREVIEW["render_native_effect_oriented"]("Fireworks", phase, name, speed=speed),
                )
        # A flare, then coloured sparks, then black between shots.
        flare = PREVIEW["render_native_effect"]("Fireworks", 0.0, "Up")
        self.assertEqual([(255, 255, 255)], [p for p in flare if p != (0, 0, 0)])
        frames = [LAMP["render_fireworks"](r * 0.04, 50, 0) for r in range(140)]
        lit = [sum(p != (0, 0, 0) for p in frame) for frame in frames]
        self.assertGreater(max(lit), 20)
        self.assertGreater(len({p for frame in frames for p in frame if max(p) - min(p) > 60}), 20)
        self.assertIn(0, lit[60:])

    def test_magic_is_the_lamp_formula(self):
        for case in json.loads(MAGIC.read_text())["cases"]:
            text = case["cells"]
            expected = [tuple(bytes.fromhex(text[i:i + 6])) for i in range(0, 600, 6)]
            self.assertEqual(expected, LAMP["magic_cells"](case["render"], case["rate"]))
        # The preview gets the seconds and the speed back out of the phase, and
        # reads the slot's renderer: LED drive on direction 0's box.
        speed, seconds = 24, 5.48
        phase = seconds * (0.25 + speed / 55.0)
        drive = PREVIEW["render_native_effect_oriented"]("Magic", phase, "Up", speed=speed)
        settings = LAMP["lamp_settings"]("Magic", "Up", speed)
        self.assertEqual(LAMP["renderer_frame"](settings, 137), drive)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_port_of_magic_is_the_same(self):
        module = (ROOT / "www" / "lamp-renderers.js").as_uri()
        script = (
            'import fs from "node:fs";'
            f"const m = await import({json.dumps(module)});"
            f"const data = JSON.parse(fs.readFileSync({json.dumps(str(MAGIC))}));"
            "const hex = (c) => c.map((v) => v.toString(16).padStart(2, '0')).join('');"
            "const bad = data.cases.filter((k) => m.magicCells(k.render, k.rate).map(hex).join('') !== k.cells);"
            "process.stdout.write(JSON.stringify({ bad: bad.length }));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        self.assertEqual(0, out["bad"])

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_tide_directions_are_the_same(self):
        preview_js = (ROOT / "www" / "native-effect-preview.js").as_uri()
        cases = [[3.7, d] for d in ("Up", "Down", "Left", "Right")]
        script = (
            f"const p = await import({json.dumps(preview_js)});"
            f"process.stdout.write(JSON.stringify({json.dumps(cases)}.map("
            "([phase, d]) => p.renderNativeEffectOriented('Tide', phase, d))));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        expected = [
            [list(pixel) for pixel in PREVIEW["render_native_effect_oriented"]("Tide", phase, d)]
            for phase, d in cases
        ]
        self.assertEqual(expected, json.loads(result.stdout))

    def test_led_drive_is_shown_as_the_reference_page_shows_it(self):
        for drive, shown in json.loads(APPEARANCE.read_text())["cases"]:
            self.assertEqual(tuple(shown), LAMP["led_appearance"](drive), drive)
        # A dim LED value is far brighter than the same number on a screen.
        self.assertEqual((173, 0, 0), LAMP["led_appearance"]((64, 0, 0)))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_cards_show_the_leds_only_for_lamp_renderers(self):
        renderers = (ROOT / "www" / "lamp-renderers.js").as_uri()
        utils = (ROOT / "www" / "native-effect-card-utils.js").as_uri()
        preview = (ROOT / "www" / "native-effect-preview.js").as_uri()
        script = (
            'import fs from "node:fs";'
            f"const f = await import({json.dumps(renderers)});"
            f"const u = await import({json.dumps(utils)});"
            f"const p = await import({json.dumps(preview)});"
            f"const data = JSON.parse(fs.readFileSync({json.dumps(str(APPEARANCE))}));"
            "const bad = data.cases.filter(([drive, shown]) =>"
            " String(f.ledAppearance(drive)) !== String(shown));"
            "const frame = [[64, 0, 0], [0, 0, 0]];"
            "const attrs = { native_effect_speed: 50 };"
            "const raw = (name) => p.renderNativeEffectOriented(name, 4.36 * (0.25 + 50 / 55), 'Up', null, 'normal', 50);"
            "process.stdout.write(JSON.stringify({ bad: bad.length,"
            " fireworks: f.effectDisplayFrame('Fireworks', frame),"
            " other: f.effectDisplayFrame('77', frame),"
            " card: u.nativeEffectFrame({ name: 'Fireworks' }, attrs, 4.36).flat(),"
            " wanted: raw('Fireworks').map(f.ledAppearance).flat(),"
            " cardStreamer: u.nativeEffectFrame({ name: 'Ribbon' }, attrs, 4.36).flat(),"
            " wantedStreamer: raw('Ribbon').map(f.ledAppearance).flat(),"
            " cardOther: u.nativeEffectFrame({ name: '77' }, attrs, 4.36).flat(),"
            " wantedOther: raw('77').flat(),"
            " }));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        self.assertEqual(0, out["bad"])
        self.assertEqual([[173, 0, 0], [0, 0, 0]], out["fireworks"])
        self.assertEqual([[64, 0, 0], [0, 0, 0]], out["other"])
        self.assertEqual(sorted(out["wanted"]), sorted(out["card"]))  # turned for the viewer
        self.assertEqual(sorted(out["wantedStreamer"]), sorted(out["cardStreamer"]))
        self.assertEqual(sorted(out["wantedOther"]), sorted(out["cardOther"]))

    def test_the_lamp_preview_does_not_fade_a_lamp_renderer(self):
        styles = (ROOT / "www" / "lamp-preview-styles.js").read_text(encoding="utf8")
        self.assertRegex(styles, r"\.lamp-dots-instant \.lamp-dot \{\s*transition: none;")
        matrix = (ROOT / "www" / "lamp-preview-matrix.js").read_text(encoding="utf8")
        self.assertIn("this._setInstantDots(isLampRendered(effect))", matrix)
        self.assertIn("this._setInstantDots(clockUsesLampRenderer(st.attributes))", matrix)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_cards_show_every_render(self):
        # createRafLoop's smoothWhen, on three displays, with the preview's
        # clock started anywhere within a render: every render is painted once
        # or more and none skipped, while the other previews keep their rate.
        module = (ROOT / "www" / "matrix-animator.js").as_uri()
        renderers = (ROOT / "www" / "lamp-renderers.js").as_uri()
        script = (
            f"const m = await import({json.dumps(module)});"
            f"const f = await import({json.dumps(renderers)});"
            "const out = [];"
            "for (const hz of [60, 120, 144]) for (let start = 0; start < 40; start += 3) {"
            " let callback = null; globalThis.requestAnimationFrame = (c) => { callback = c; return 1; };"
            " const shown = []; let due = 0;"
            " const loop = m.createRafLoop((t, isDue) => {"
            "  shown.push(Math.floor((t - start) / (f.RENDER_SECONDS * 1000))); if (isDue) due += 1;"
            " }, { minIntervalMs: 100, smoothWhen: () => f.isLampRendered('Fireworks') });"
            " loop.start();"
            " for (let i = 1; i <= hz * 10; i += 1) callback(i * 1000 / hz);"
            " const jumps = shown.slice(1).map((v, i) => v - shown[i]);"
            " out.push({ hz, start, most: Math.max(...jumps), due });"
            "}"
            "let callback = null; globalThis.requestAnimationFrame = (c) => { callback = c; return 1; };"
            "let plain = 0; let smooth = 0;"
            "const other = m.createRafLoop(() => { plain += 1; },"
            " { minIntervalMs: 100, smoothWhen: () => f.isLampRendered('77') });"
            "other.start(); for (let i = 1; i <= 600; i += 1) callback(i * 1000 / 60);"
            "process.stdout.write(JSON.stringify({ out, plain }));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        data = json.loads(result.stdout)
        self.assertEqual(42, len(data["out"]))
        for run in data["out"]:
            self.assertLessEqual(run["most"], 1, run)
            self.assertIn(run["due"], range(85, 102), run)
        # An effect the lamp's renderers do not draw stays at 10 a second.
        self.assertIn(data["plain"], range(85, 102))

    @unittest.skipUnless(shutil.which("node"), "Node is required for the JS port")
    def test_the_js_port_is_the_same(self):
        module = (ROOT / "www" / "lamp-renderers.js").as_uri()
        # The times go back and forth: previews on different clocks.
        cases = [[rate, d, t] for rate in (1, 50, 128, 255) for d in range(4)
                 for t in (0.0, 0.5, 1.7, 2.4, 5.3, 61.25, 3600.04, 1.8, 0.6, 2.5, 1.9)]
        script = (
            'import zlib from "node:zlib"; import fs from "node:fs";'
            f"const m = await import({json.dumps(module)});"
            f"const data = JSON.parse(zlib.gunzipSync(fs.readFileSync({json.dumps(str(FIXTURE))})));"
            "let frames = 0; const bad = [];"
            "data.runs.forEach((run, index) => {"
            " const fw = m.fireworksState(run.n);"
            " fw.state = run.state; fw.launches = run.launches; fw.dying = run.dying;"
            " run.frames.forEach((f, number) => {"
            "  let used = 0;"
            "  const draws = m.fireworksStep(fw, run.n, run.rate, run.intensity, run.selector, run.word,"
            "   (site) => { if (f.sites[used] !== site) bad.push([index, number, 'site']); return f.reads[used++]; });"
            "  const crc = (zlib.crc32(new Uint8Array(fw.records.buffer)) >>> 0).toString(16).padStart(8, '0');"
            "  const text = draws.length ? draws.map(([i, r, g, b]) => i.toString(16) + ':' +"
            "   ((r << 16 | g << 8 | b) >>> 0).toString(16).padStart(6, '0')).join(';') : '-';"
            "  if (used !== f.reads.length || text !== f.draws || fw.state !== f.state || fw.launches !== f.launches"
            "   || fw.side !== f.side || (fw.dying >>> 0).toString(16).padStart(8, '0') !== f.dying || crc !== f.crc)"
            "   bad.push([index, number]);"
            "  frames += 1;"
            " });"
            "});"
            f"const frames2 = {json.dumps(cases)}.map(([rate, d, t]) => m.renderFireworks(t, rate, d));"
            "process.stdout.write(JSON.stringify({frames, bad: bad.slice(0, 5), previews: frames2}));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            text=True, capture_output=True, check=True,
        )
        out = json.loads(result.stdout)
        self.assertEqual(2656, out["frames"])
        self.assertEqual([], out["bad"])
        expected = [[list(p) for p in LAMP["render_fireworks"](t, rate, d)] for rate, d, t in cases]
        self.assertEqual(expected, out["previews"])


if __name__ == "__main__":
    unittest.main()
