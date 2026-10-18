// Watched lamp sessions: a scripted sequence of changes sent to real lamps
// through Home Assistant, each step announced with the time and what the
// lamps should show, so whoever watches them can note a flash, a freeze or
// an older picture. The lamps' display is saved first and restored at the
// end (save_state / restore_state).
//
//   node tools/lamp-session.mjs tcp              the TCP fallback: force_tcp 15 min, a sequence, UDP again
//   node tools/lamp-session.mjs switch           firmware mode -> drawing switches (clock / effect -> pixel art)
//   node tools/lamp-session.mjs idle             a drawing left for 150 s, then a change (direct mode kept)
//   node tools/lamp-session.mjs custom [rounds] [clock]
//                                                effect -> drawing switches with drawings that exist
//                                                nowhere else (a flash of a known one is the firmware's)
//
// Settings (environment):
//   CUBE_LAMPS     the lamps' light entities, comma separated (required)
//   HA_URL         Home Assistant (default http://homeassistant.local:8123)
//   HA_TOKEN       a long-lived access token of an admin user (force_tcp is
//                  admin only), or HA_TOKEN_FILE: a file holding it
//   CUBE_PIXEL_ARTS  the two pixel arts shown, saved or built-in, comma
//                  separated (default the first two built-in ones)
//
// Node 18+ (fetch). Only actions of the integration and light.turn_on/off.
import { readFileSync } from "node:fs";

const lamps = (process.env.CUBE_LAMPS || "").split(",").map((id) => id.trim()).filter(Boolean);
const base = (process.env.HA_URL || "http://homeassistant.local:8123").replace(/\/$/, "");
const token = (
  process.env.HA_TOKEN || (process.env.HA_TOKEN_FILE ? readFileSync(process.env.HA_TOKEN_FILE, "utf8") : "")
).trim();
const [first, second] = (process.env.CUBE_PIXEL_ARTS || "Built-in: Horizontal 01,Built-in: Horizontal 02")
  .split(",")
  .map((name) => name.trim());
const MODES = ["tcp", "switch", "idle", "custom"];
const [mode, ...args] = process.argv.slice(2);
if (!MODES.includes(mode) || !lamps.length || !token || !second) {
  console.log(
    "usage: CUBE_LAMPS=light.a,light.b HA_TOKEN_FILE=token.txt [HA_URL=...] " +
      "node tools/lamp-session.mjs tcp | switch | idle | custom [rounds] [clock]",
  );
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const now = () => new Date().toTimeString().slice(0, 8);
let step = 0;
const say = (what, expect) =>
  console.log(`[${now()}] Step ${++step}: ${what}${expect ? `\n           expect: ${expect}` : ""}`);

async function call(domain, service, data) {
  const res = await fetch(`${base}/api/services/${domain}/${service}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${domain}.${service} -> ${res.status} ${await res.text()}`);
}
const all = (service, data = {}, domain = "yeelight_cube") => call(domain, service, { entity_id: lamps, ...data });

// Each lamp's connection (its "connection" attribute: udp / tcp).
async function connection() {
  const states = await (await fetch(`${base}/api/states`, { headers })).json();
  return lamps
    .map((id) => {
      const state = states.find((s) => s.entity_id === id);
      return `${state?.attributes.friendly_name || id}=${state?.attributes.connection}`;
    })
    .join(", ");
}

async function withSavedDisplay(run) {
  await all("save_state");
  try {
    await run();
  } finally {
    await sleep(2);
    say("restore the lamps' display as it was before the session", "what they showed before");
    await all("restore_state");
  }
}

async function sequence(pause) {
  say(`drawing ${first}`, `${first} on every lamp`);
  await all("apply_pixel_art", { name: first }); await sleep(pause);
  say(`drawing ${second}`, `${second}; no flash of ${first} or of anything older`);
  await all("apply_pixel_art", { name: second }); await sleep(pause);
  say('text "TCP TEST"', "the text, in its current colors");
  await all("set_custom_text", { text: "TCP TEST" }); await sleep(pause);
  say("brightness down to 20 %", "dimmer text; the text stays (no older picture)");
  await all("turn_on", { brightness: 52 }, "light"); await sleep(pause);
  say("brightness up to 80 %", "brighter text");
  await all("turn_on", { brightness: 204 }, "light"); await sleep(pause);
  say('clock, style "White"', "the lamp's clock, white");
  await all("set_clock_style", { style: "White" }); await sleep(pause);
  say('effect "Rainbow"', "the Rainbow effect");
  await all("set_native_effect", { effect: "Rainbow" }); await sleep(pause);
  say(`back to drawing ${first} (leaving an effect)`, `${first}, without the effect showing through or a black frame staying`);
  await all("apply_pixel_art", { name: first }); await sleep(pause);
  say("turn off", "every lamp off");
  await all("turn_off", {}, "light"); await sleep(pause);
  say("turn on", `${first} again`);
  await all("turn_on", {}, "light"); await sleep(pause);
}

if (mode === "tcp") {
  await withSavedDisplay(async () => {
    say("use TCP for 15 minutes (force_tcp)");
    await all("force_tcp", { minutes: 15 });
    console.log(`           connection: ${await connection()}`);
    await sequence(5);
    say("UDP again (force_tcp 0)");
    await all("force_tcp", { minutes: 0 });
    console.log(`           connection: ${await connection()}`);
  });
} else if (mode === "switch") {
  await withSavedDisplay(async () => {
    for (let round = 1; round <= 3; round++) {
      say(`round ${round}: clock "Mint"`, "the clock");
      await all("set_clock_style", { style: "Mint" }); await sleep(4);
      say(`round ${round}: clock -> drawing ${second}`, `${second} at once: no ribbon / rainbow flash, no missing first picture`);
      await all("apply_pixel_art", { name: second }); await sleep(4);
      say(`round ${round}: effect "Starry sky"`, "the effect");
      await all("set_native_effect", { effect: "Starry sky" }); await sleep(4);
      say(`round ${round}: effect -> drawing ${first}`, `${first} at once: no flash, no missing first picture`);
      await all("apply_pixel_art", { name: first }); await sleep(4);
    }
  });
} else if (mode === "idle") {
  await withSavedDisplay(async () => {
    say(`drawing ${second}, then nothing for 150 s`, `${second} stays`);
    await all("apply_pixel_art", { name: second });
    for (let left = 150; left > 0; left -= 30) {
      console.log(`           ${left} s left...`);
      await sleep(30);
    }
    say(`drawing ${first} after the idle time`, `${first} at once on every lamp (if not: the lamp left direct mode while idle)`);
    await all("apply_pixel_art", { name: first }); await sleep(6);
  });
} else {
  // Two drawings that exist nowhere else (not saved, not built in): a yellow
  // checkerboard, and the whole panel magenta.
  const checker = [];
  for (let position = 0; position < 100; position++)
    if ((position + Math.floor(position / 20)) % 2 === 0) checker.push({ position, color: [255, 200, 0] });
  const magenta = Array.from({ length: 100 }, (_, position) => ({ position, color: [255, 0, 180] }));
  const rounds = Number(args[0]) || 5;
  // "clock": a clock first in each round, as in "switch".
  const withClock = args.includes("clock");
  await withSavedDisplay(async () => {
    for (let round = 1; round <= rounds; round++) {
      if (withClock) {
        say(`round ${round}: clock "Mint"`, "the clock");
        await all("set_clock_style", { style: "Mint" }); await sleep(4);
      }
      say(`round ${round}: yellow checkerboard`, "the yellow checkerboard");
      await all("apply_custom_pixels", { pixels: checker }); await sleep(4);
      say(`round ${round}: effect "Starry sky"`, "the effect");
      await all("set_native_effect", { effect: "Starry sky" }); await sleep(4);
      say(
        `round ${round}: effect -> all magenta`,
        "magenta at once; note any flash (checkerboard = our previous frame, a built-in drawing = the firmware)",
      );
      await all("apply_custom_pixels", { pixels: magenta }); await sleep(4);
    }
  });
}
