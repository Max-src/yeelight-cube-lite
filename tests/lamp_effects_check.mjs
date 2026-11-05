// The JS side of tests/test_lamp_effects.py: every registered renderer
// against tests/fixtures/lamp_effects.json.gz, the timeline, the budgets, and
// what the Python side compares (registry, settings, primitives). Prints JSON;
// exit code 1 on a mismatch.
//
//   node tests/lamp_effects_check.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const tests = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(tests, "..", "custom_components", "yeelight_cube", "www");
const load = (name) => import(new URL(`file:///${path.join(www, name).replaceAll("\\", "/")}`));
const renderers = await load("lamp-renderers.js");
const core = await load("lamp-core.js");
const preview = await load("native-effect-preview.js");

const EXEMPT = new Set(["Fireworks"]);
const RENDERS = 240;
const fixture = JSON.parse(
  zlib.gunzipSync(fs.readFileSync(path.join(tests, "fixtures", "lamp_effects.json.gz"))),
);
const crc = (bytes) => zlib.crc32(bytes) >>> 0;
const effects = Object.entries(fixture.effects).filter(
  ([name, effect]) => !EXEMPT.has(name) && renderers.hasRenderer(effect.mode),
);

function mismatch(name, key, config, render, frame) {
  const label = `${name} / ${key}: render ${render} of ${RENDERS}`;
  const kept = config.frames[render];
  if (kept) {
    const wanted = Buffer.from(kept, "hex");
    for (let at = 0; at < 300; at += 3)
      if (frame[at] !== wanted[at] || frame[at + 1] !== wanted[at + 1] || frame[at + 2] !== wanted[at + 2])
        return `${label}, pixel ${at / 3}: ${frame.subarray(at, at + 3)} != ${wanted.subarray(at, at + 3)}`;
  }
  return `${label}: crc ${crc(frame).toString(16)} != ${config.crc[render].toString(16)} (no stored frame there)`;
}

// ── Every config ──────────────────────────────────────────────────────
const failures = [];
let configs = 0;
for (const [name, effect] of effects) {
  for (const [key, config] of Object.entries(effect.configs)) {
    configs += 1;
    let render = 0;
    for (const frame of renderers.exactFrames(config.settings, config.firstRender, RENDERS)) {
      if (crc(frame) !== config.crc[render]) {
        failures.push(mismatch(name, key, config, render, frame));
        break;
      }
      render += 1;
    }
  }
}

// ── Budgets ───────────────────────────────────────────────────────────
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};
const medians = {};
const cold = {};
for (const [name, effect] of effects) {
  const { settings } = effect.configs.default;
  const times = [];
  // A first pass warms the JIT, as a preview running for a moment does.
  for (let pass = 0; pass < 2; pass += 1) {
    const frames = renderers.exactFrames(settings, 0, RENDERS);
    for (;;) {
      const began = performance.now();
      if (frames.next().done) break;
      if (pass) times.push(performance.now() - began);
    }
  }
  medians[name] = median(times);
  let worst = 0;
  for (const target of [0, 1000, 5000, 7600, 90000]) {
    // Best of three fresh timelines: a GC pause or a descheduled CI runner
    // stalls one call, a slow renderer all of them.
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timeline = new renderers.Timeline(renderers.REGISTRY.get(settings.mode), settings);
      const began = performance.now();
      timeline.frameAt(target);
      best = Math.min(best, performance.now() - began);
    }
    worst = Math.max(worst, best);
  }
  cold[name] = worst;
}

// ── The timeline ──────────────────────────────────────────────────────
const timelineFailures = [];
const expect = (ok, label) => {
  if (!ok) timelineFailures.push(label);
};
const tide = fixture.effects.Tide.configs;
const tideSlot = renderers.REGISTRY.get(tide.default.settings.mode);
const timelineOf = (config, slot = renderers.REGISTRY.get(config.settings.mode)) =>
  new renderers.Timeline(slot, config.settings);
const counted = (slot) => {
  const out = { calls: 0, slot: null };
  out.slot = { ...slot, step: (...args) => { out.calls += 1; return slot.step(...args); } };
  return out;
};
const historySlot = (pauseMs = 0) => ({
  mode: 1000,
  warmup: null,
  init: () => ({ seen: 0 }),
  step: (state) => {
    if (pauseMs) for (const stop = performance.now() + pauseMs; performance.now() < stop; );
    state.seen += 1;
    const out = new Uint8Array(300);
    for (let at = 0; at < 300; at += 3) {
      out[at] = state.seen >> 16;
      out[at + 1] = (state.seen >> 8) & 255;
      out[at + 2] = state.seen & 255;
    }
    return out;
  },
});
const seen = (frame) => (frame[0] << 16) | (frame[1] << 8) | frame[2];

{
  // Seek back, in the ring and out of it.
  const config = tide.default;
  const timeline = timelineOf(config);
  for (let render = 0; render < RENDERS; render += 1)
    expect(crc(timeline.frameAt(render)) === config.crc[render], `forward ${render}`);
  for (const render of [5, 239, 0, 120])
    expect(crc(timeline.frameAt(render)) === config.crc[render], `ring ${render}`);
  for (let render = RENDERS; render < 700; render += 1) timeline.frameAt(render);
  for (const render of [239, 10, 200])
    expect(crc(timeline.frameAt(render)) === config.crc[render], `rebuilt ${render}`);
}
{
  // A warmup stays out of the ring.
  const config = tide.default;
  const timeline = timelineOf(config);
  timeline.frameAt(230);
  expect(timeline.frames.size === 1, "warmup in the ring");
  for (const render of [231, 229, 100, 60])
    expect(crc(timeline.frameAt(render)) === config.crc[render], `after a warmup ${render}`);
}
for (const name of ["Rainbow", "Tide", "Magic"]) {
  // Far ahead.
  const config = fixture.effects[name].configs.late;
  const timeline = timelineOf(config);
  for (let k = 0; k < RENDERS; k += 1)
    expect(crc(timeline.frameAt(config.firstRender + k)) === config.crc[k], `late ${name} ${k}`);
}
{
  // Two clocks: no replay.
  const config = tide.default;
  const count = counted(tideSlot);
  const timeline = timelineOf(config, count.slot);
  for (let render = 20; render < 220; render += 1) {
    expect(crc(timeline.frameAt(render + 19)) === config.crc[render + 19], `ahead ${render}`);
    expect(crc(timeline.frameAt(render)) === config.crc[render], `behind ${render}`);
  }
  expect(count.calls <= 239, `two clocks: ${count.calls} renders`);
}
{
  // Three clocks, far apart.
  const { settings } = tide.default;
  const starts = [300, 1300, 2300];
  const wanted = starts.map((start) => [...renderers.exactFrames(settings, start, 60)].map(crc));
  const count = counted(tideSlot);
  const timeline = timelineOf(tide.default, count.slot);
  for (let offset = 0; offset < 60; offset += 1)
    starts.forEach((start, index) =>
      expect(crc(timeline.frameAt(start + offset)) === wanted[index][offset], `clock ${start} ${offset}`),
    );
  expect(timeline.cursors.length === 3, `three clocks: ${timeline.cursors.length} cursors`);
  expect(count.calls <= 3 * (60 + tideSlot.warmup), `three clocks: ${count.calls} renders`);
}
{
  // Bounds.
  const timeline = timelineOf(tide.default);
  for (let jump = 0; jump < 40; jump += 1) {
    timeline.frameAt(jump * 1000);
    expect(timeline.cursors.length <= 6, "cursors");
    expect(timeline.frames.size <= 256, "ring");
  }
  for (let render = 40000; render < 40600; render += 1) timeline.frameAt(render);
  expect(timeline.frames.size === 256, "ring full");
}
{
  // No warmup: near replays, far jumps.
  const slot = historySlot();
  const timeline = timelineOf(tide.default, slot);
  expect(seen(timeline.frameAt(1500, true)) === 1501, "history from 0");
  expect(seen(timeline.frameAt(1900, true)) === 1901, "history goes on");
  const far = timelineOf(tide.default, slot);
  expect(seen(far.frameAt(9000, true)) === 2001, "history jumps");
  expect(seen(far.frameAt(10000, true)) === 3001, "history goes on after a jump");
}
{
  // A replay never stalls.
  const timeline = timelineOf(tide.default, historySlot(1));
  const began = performance.now();
  const reached = seen(timeline.frameAt(1900));
  expect(performance.now() - began < 100, "a long replay stops");
  expect(reached < 1901, "a long replay gives an earlier frame");
  expect(seen(timeline.frameAt(1900)) > reached, "and catches up");
}

// ── What the integration sends, and the previews on it ────────────────
// A config's choices.
const COMMANDS = {
  default: ["Right", 50],
  "rate128-up": ["Up", 128],
  "rate255-left": ["Left", 255],
  "rate1-down": ["Down", 1],
  late: ["Right", 50],
  clock: ["Right", 50],
  override: ["Right", 50, [255, 80, 20]],
};
const commandOf = (key) =>
  COMMANDS[key] ?? ["Right", 50, null, key.replace("palette-", "")];
const sorted = (value) =>
  JSON.stringify(value, Object.keys(value).sort());
const settingsFailures = [];
const previewFailures = [];
// The render each preview starts from, for Python to compare.
const firstShown = {};
for (const speed of [1, 50, 128, 255])
  for (const name of Object.keys(renderers.LAMP_EFFECTS)) {
    if (EXEMPT.has(name)) continue;
    const settings = renderers.lampSettings(name, "Right", speed);
    firstShown[`${name}/${speed}`] = renderers.timelineFor(settings).firstShown();
  }
for (const [name, effect] of Object.entries(fixture.effects)) {
  for (const [key, config] of Object.entries(effect.configs)) {
    const [label, speed, override, mode] = commandOf(key);
    const settings = renderers.lampSettings(name, label, speed, override, mode);
    if (key === "clock") settings.direction = renderers.CLOCK_BACKGROUND_DIRECTION;
    if (sorted(settings) !== sorted(config.settings))
      settingsFailures.push(`${name} / ${key}: ${JSON.stringify(settings)}`);
    // What a card reads, on the renders the fixture keeps. A replay's time
    // limit is the timeline's own test: the frames are computed ahead.
    if (EXEMPT.has(name) || key === "clock" || config.firstRender) continue;
    for (const [kept, hex] of Object.entries(config.frames)) {
      const seconds = (Number(kept) + 0.5) * core.RENDER_SECONDS;
      const first = renderers.timelineFor(settings).firstShown();
      if (Number(kept) < first) continue;
      renderers.timelineFor(settings).frameAt(Number(kept), true);
      const frame = preview.renderNativeEffect(
        name, (seconds - first * core.RENDER_SECONDS) * (0.25 + speed / 55), label,
        override ?? null, mode ?? null, speed,
      );
      if (Buffer.from(frame.flat()).toString("hex") !== hex)
        previewFailures.push(`${name} / ${key}: render ${kept}`);
    }
  }
}

// ── A clock's background, on the lit pixels of the lamp's mode 40 ─────
const clockFailures = [];
const CLOCK_COMMANDS = {
  rainbow: ["Rainbow", 50],
  "rainbow-fast": ["Rainbow", 200],
  ocean: ["Waves", 50],
  aurora: ["Aurora", 50],
  waterfall: ["Waterfall", 128],
  "rainbow-color": ["Rainbow", 50, [255, 80, 20]],
  "rainbow-vivid": ["Rainbow", 50, null, "red_blue"],
  "tide-bw": ["Tide", 50, null, "bw"],
  spectrum: ["Spectrum", 50],
  "spectrum-fast": ["Spectrum", 200],
  bands: ["Palette stripes", 200],
};
// "bare-<slot>" (and "-bw", "-vivid"): a slot named by number until 1.4.0
// (effect-names.js), by its slot number, as it is / under B&W / Vivid.
const { FORMERLY_NUMBERED_EFFECT_NAMES } = await load("effect-names.js");
const CLOCK_VARIANTS = { "": [], bw: [null, "bw"], vivid: [null, "red_blue"] };
for (const key of Object.keys(fixture.clock)) {
  const [, slot, variant = ""] = key.match(/^bare-(\d+)(?:-(bw|vivid))?$/) ?? [];
  if (slot)
    CLOCK_COMMANDS[key] = [FORMERLY_NUMBERED_EFFECT_NAMES[Number(slot)], 128,
      ...CLOCK_VARIANTS[variant]];
}
// "colours-<slot>-custom": a slot that draws its colour words, the clock's
// color first.
for (const key of Object.keys(fixture.clock)) {
  const [, slot] = key.match(/^colours-(\d+)-custom$/) ?? [];
  if (slot)
    CLOCK_COMMANDS[key] = [FORMERLY_NUMBERED_EFFECT_NAMES[Number(slot)], 128, [255, 80, 20]];
}
for (const [key, clock] of Object.entries(fixture.clock)) {
  const settings = renderers.lampClockSettings(...CLOCK_COMMANDS[key]);
  const timeline = renderers.timelineFor(settings);
  for (const [render, hex] of Object.entries(clock.frames)) {
    const reference = Buffer.from(hex, "hex");
    const ours = timeline.frameAt(Number(render), true);
    for (let at = 0; at < 300; at += 3) {
      if (!(reference[at] || reference[at + 1] || reference[at + 2])) continue;
      // The colon's blink under slot 27's read-back (test_lamp_effects.py).
      if (/^bare-27(-|$)/.test(key) && (at === 87 || at === 207)) continue;
      if (reference[at] !== ours[at] || reference[at + 1] !== ours[at + 1] || reference[at + 2] !== ours[at + 2])
        clockFailures.push(`${key}: render ${render}, pixel ${at / 3}`);
    }
  }
}

// ── A full dashboard keeps its timelines ──────────────────────────────
// The cards list every effect.
const dashboard = Object.keys(renderers.LAMP_EFFECTS).flatMap((name) => [
  renderers.lampSettings(name, "Right", 50),
  renderers.lampSettings(name, "Right", 50, [255, 80, 20]),
]).filter((settings) => renderers.hasRenderer(settings.mode));
const held = dashboard.map(renderers.timelineFor);
const kept = dashboard.map(renderers.timelineFor).filter((timeline, at) => timeline === held[at]);

// ── What Python compares ──────────────────────────────────────────────
const settings = {};
for (const [name, effect] of Object.entries(fixture.effects))
  for (const [key, config] of Object.entries(effect.configs)) {
    const colours = core.effectColours(config.settings);
    settings[`${name}/${key}`] = {
      lampClock: core.assumedApplyClock(config.settings.rate),
      clock: core.clockAt(config.settings.rate, 1000),
      direction: core.effectiveDirection(config.settings),
      geometry: core.effectGeometry(config.settings),
      words: colours.words,
      primary: colours.primary,
      secondary: colours.secondary,
      count: colours.palette.length,
      table: crc(colours.table),
    };
  }

function noiseBytes(count, seed) {
  const out = new Uint8Array(count);
  for (let at = 0; at < count; at += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    out[at] = (seed >> 16) & 255;
  }
  return out;
}

function primitives() {
  const sums = {};
  const sum = (key, values) => {
    sums[key] = crc(Uint8Array.from(values, (value) => value & 255));
  };
  const range = (from, to, step = 1) => {
    const out = [];
    for (let value = from; value < to; value += step) out.push(value);
    return out;
  };
  const word = (value) => [value >>> 24, value >>> 16, value >>> 8, value];
  sum("sin8", range(0, 256).map(core.sin8));
  sum("sin16", range(0, 65536, 97).flatMap((t) => [core.sin16Unsigned(t), core.sin16Unsigned(t) >> 8]));
  sum("beat", range(0, 2000).map((c) => core.beat(1000 + 123 * c, core.bpm88((c % 300) - 20))));
  sum("envelope", range(0, 3000).map((t) => core.envelopeGain(40 * t, t % 256)));
  sum("noise3", range(0, 4000).map((x) => core.inoise8Raw((x * 907) & 65535, (x * 311) & 65535, (x * 53) & 65535)));
  sum("noise2", range(0, 4000).map((x) => core.inoise8Raw2d((x * 907) & 65535, (x * 311) & 65535)));
  sum("source", range(0, 1000).flatMap((d) => word(core.sourceWord(d * 7))));
  sum("random", range(0, 1000).map(core.randomSource));
  sum("maths", range(-300, 300).flatMap((x) => [core.sx8(x), core.triangle16(x * 211), core.lround(x / 2)]));
  const levels = range(0, 256, 17);
  sum("convert", levels.flatMap((r) => levels.flatMap((g) => levels.flatMap((b) => core.convertColour([r, g, b])))));
  sum("hue", range(0, 360).flatMap(core.hueDrive));
  sum("demo", range(0, 400).flatMap((render) => {
    const [level, onset, tick, bands] = core.demoSound(render);
    return [level, onset, tick, ...bands];
  }));
  sum("palettes", [0, 8, 12, 13, 14, 32].flatMap((s) =>
    [39, 34, 15, 41, 45, 42].flatMap((m) => [...core.paletteTable(core.nativePalette(s, m))])));
  sum("span", [2, 4, 5, 8, 16, 18].map(core.paletteSpan));
  for (const [width, height] of [[5, 20], [20, 5]]) {
    const tag = `${width}x${height}`;
    for (const amount of [8, 64, 128, 200]) {
      sum(`fade${tag}${amount}`, core.fadeGrid(noiseBytes(300, amount), amount, width, height));
      sum(`blend${tag}${amount}`, core.blendGrid(noiseBytes(300, amount), amount, width, height, [0, 2, 1]));
      sum(`blur${tag}${amount}`, core.blurColumns(noiseBytes(300, amount), amount, width, height));
    }
    sum(`blend255${tag}`, core.blendGrid(noiseBytes(300, 7), 255, width, height, [9, 8, 7]));
    sum(`rowblur${tag}`, core.rowBlurGrid(noiseBytes(300, 9), width, height));
  }
  const turned = range(0, 100).map((cell) => (cell * 37) % 100);
  sum("fadeindex", core.fadeGrid(noiseBytes(300, 3), 64, 5, 20, turned));
  sum("blendindex", core.blendGrid(noiseBytes(300, 3), 128, 5, 20, [0, 2, 1], turned));
  sum("blurindex", core.blurColumns(noiseBytes(300, 3), 16, 5, 20, turned));
  sum("rowblurindex", core.rowBlurGrid(noiseBytes(300, 3), 5, 20, turned));
  for (const amount of [0, 64, 212, 251, 254, 255]) {
    sum(`towards${amount}`, core.fadeTowards(noiseBytes(300, 5), amount, 0x204060));
    sum(`stripblur${amount}`, core.stripBlur(noiseBytes(300, 5), amount));
  }
  for (const direction of [0, 1, 2, 3]) {
    sum(`place${direction}`, core.placeStrip(noiseBytes(300, 11), direction));
    sum(`readback${direction}`, core.readBack(noiseBytes(300, 11), direction));
    sum(`frame${direction}`, core.panelToFrame(noiseBytes(300, 13 + direction)));
  }
  sum("flags", [0, 46, 51].flatMap((m) => [0, 1, 2, 3].flatMap((d) => [0, 1].map((x) => core.readBackFlags(m, d, x)))));
  sum("flagsindex", [0x05, 0x45, 0x55, 0x15, 0x47, 0x57].flatMap((f) => range(0, 100).map((p) => core.flagsIndex(p, 100, f))));
  sum("targets", [0, 1, 2, 3].flatMap((m) => [0x05, 0x0d, 0x07, 0x47, 0x45, 0x15, 0x17, 0x57].flatMap((f) =>
    range(0, 100).flatMap((p) => {
      const targets = core.flaggedTargets(p, 100, m, f);
      return [targets.length, ...targets];
    }))));
  return sums;
}

process.stdout.write(JSON.stringify({
  configs,
  failures,
  timelineFailures,
  settingsFailures,
  previewFailures,
  clockFailures,
  keptTimelines: [kept.length, dashboard.length],
  firstShown,
  tables: {
    effects: renderers.LAMP_EFFECTS,
    rows: renderers.PRESET_ROWS,
    colorModes: renderers.CLOCK_COLOR_MODE_IDS,
    clockCommands: renderers.CLOCK_MIXER_COMMAND_IDS,
    clockId: renderers.NATIVE_CLOCK_EFFECT_ID,
    rateLimits: renderers.LAMP_RATE_LIMITS,
    directions: renderers.DIRECTION_VALUES,
    override: [...renderers.COLOR_OVERRIDE_EFFECTS].sort(),
    bw: [...renderers.COLOR_MODE_BW_EFFECTS].sort(),
    supports: Object.fromEntries(Object.keys(renderers.LAMP_EFFECTS).map((name) => [
      name, ["bw", "red_blue", "white_orange", "blue_yellow", "purple_orange", "normal"]
        .filter((mode) => renderers.effectSupportsColorMode(name, mode)),
    ])),
  },
  medians,
  cold,
  registry: [...renderers.REGISTRY.values()].map((slot) => [slot.mode, slot.warmup]).sort((a, b) => a[0] - b[0]),
  settings,
  primitives: primitives(),
}));
process.exitCode =
  failures.length || timelineFailures.length || settingsFailures.length ||
  previewFailures.length || clockFailures.length
    ? 1
    : 0;
