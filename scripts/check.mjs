// Run the CI checks locally before pushing:
//
//   npm run check            everything, as the Tests workflow does
//   npm run check:quick      the inner loop: lint, Python (YC_QUICK=1) and JS
//                            tests, and the browser checks only when what they cover
//                            changed since they last passed
//
// The same steps as the Tests workflow (.github/workflows/tests.yaml): lint,
// Python tests, JS tests, the Lit bundle check and the browser checks, then a
// summary. On Windows the full check also runs, through WSL, the Home
// Assistant tests and the browser checks on Linux like CI
// (scripts/linux-browser-checks.sh: fonts and layout differ, and a test
// passing in Edge can still fail on CI); they work on a copy of the sources,
// so they run alongside the Windows steps and their output is shown at the
// end. Set DOCS_HA_URL (and DOCS_HA_STORAGE_STATE, or DOCS_HA_ONBOARD=1 for a
// disposable local HA) to also run the documentation screenshot capture; see
// docs/DOCUMENTATION_SCREENSHOTS.md.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");
const windows = process.platform === "win32";
const python = process.env.PYTHON || (windows ? "python" : "python3");
const npm = windows ? "npm.cmd" : "npm";
// Edge is preinstalled on Windows; CI uses Playwright's Chromium.
const browserEnv = {
  BROWSER_CHANNEL:
    process.env.BROWSER_CHANNEL || (windows ? "msedge" : "chromium"),
};

// What the browser checks cover: the cards and the browser tests. Their
// fingerprint, kept after a pass, lets the quick check skip them while it is
// unchanged.
const browserInputs = [
  "custom_components/yeelight_cube/www",
  "tests/browser",
  "scripts/browser-checks.mjs",
  ...fs
    .readdirSync(path.join(root, "tests"))
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => `tests/${name}`),
];
const stamp = path.join(root, "node_modules", ".cache", "yc-browser-checks");
function fingerprint() {
  const hash = createHash("sha1");
  const add = (relative) => {
    const full = path.join(root, relative);
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isDirectory())
      for (const name of fs.readdirSync(full).sort())
        add(path.posix.join(relative, name));
    else hash.update(relative).update(fs.readFileSync(full));
  };
  browserInputs.forEach(add);
  return hash.digest("hex");
}
const browserPrint = fingerprint();
const browserUnchanged =
  quick && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === browserPrint;

const steps = [
  // Lint: ruff and eslint (ruff.toml, eslint.config.mjs).
  ["Lint", npm, ["run", "lint"]],
  [
    "Python tests",
    python,
    ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
    // The quick check leaves out the few exhaustive tests marked slow
    // (tests/fakes.py).
    { env: quick ? { YC_QUICK: "1" } : {} },
  ],
  ["JS tests", process.execPath, ["--test", "tests/*.test.mjs"]],
];
if (!quick)
  steps.push([
    "Lit bundle is up to date",
    npm,
    ["run", "build:lit"],
    {
      after: [
        "git",
        [
          "diff",
          "--exit-code",
          "--",
          "custom_components/yeelight_cube/www/lib/lit-all.js",
        ],
      ],
    },
  ]);
if (!browserUnchanged)
  // The browser checks (scripts/browser-checks.mjs: their one list).
  steps.push([
    "Browser checks",
    process.execPath,
    ["scripts/browser-checks.mjs"],
    { env: browserEnv, browser: true },
  ]);
if (!quick)
  steps.push([
    "Documentation galleries",
    process.execPath,
    ["tests/card-docs-readme.cjs", "--check"],
  ]);
if (!quick && (process.env.DOCS_HA_URL || process.env.DOCS_HA_ONBOARD === "1"))
  steps.push(["Documentation screenshots", npm, ["run", "docs:screenshots"]]);

const wsl =
  !quick &&
  windows &&
  spawnSync("wsl", ["-e", "true"], { stdio: "ignore" }).status === 0;
// The tests inside Home Assistant (tests/ha: the config flow, its coverage
// enforced). Home Assistant runs on Linux only: through WSL on Windows. The
// first run sets up their dev-only environment (scripts/ha-tests.sh).
if (!quick && !windows)
  steps.push(["Home Assistant tests", "bash", ["scripts/ha-tests.sh"]]);
const linuxSteps = wsl
  ? [
      ["Home Assistant tests (WSL)", "wsl", ["-e", "bash", "scripts/ha-tests.sh"]],
      [
        "Browser checks on Linux (WSL, like CI)",
        "wsl",
        ["-e", "bash", "scripts/linux-browser-checks.sh"],
      ],
    ]
  : [];

// npm on Windows is a .cmd script, run through the shell: as one command line
// (its arguments are this file's own constants).
const run = (command, args, env) => {
  const shell = windows && command.endsWith(".cmd");
  return (
    spawnSync(shell ? [command, ...args].join(" ") : command, shell ? [] : args, {
      cwd: root,
      stdio: "inherit",
      shell,
      env: { ...process.env, ...env },
    }).status === 0
  );
};

// The WSL steps one after the other in the background, their output kept.
const runQuietly = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ ok: status === 0, output }));
  });
const linux = (async () => {
  const done = [];
  for (const [name, command, args] of linuxSteps) {
    const started = Date.now();
    const { ok, output } = await runQuietly(command, args);
    done.push([name, ok, ((Date.now() - started) / 1000).toFixed(0), output]);
  }
  return done;
})();

const results = [];
for (const [name, command, args, options = {}] of steps) {
  console.log(`\n=== ${name}`);
  const started = Date.now();
  let ok = run(command, args, options.env);
  if (ok && options.after) ok = run(...options.after);
  if (ok && options.browser) {
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, browserPrint);
  }
  results.push([name, ok, ((Date.now() - started) / 1000).toFixed(0)]);
}
for (const [name, ok, seconds, output] of await linux) {
  console.log(`\n=== ${name}\n${output.trimEnd()}`);
  results.push([name, ok, seconds]);
}

console.log("\n=== Summary");
for (const [name, ok, seconds] of results)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (${seconds}s)`);
if (browserUnchanged)
  console.log("SKIP  Browser checks (unchanged since they last passed)");
if (quick)
  console.log(
    "SKIP  Lit bundle, documentation galleries, Home Assistant and Linux checks (npm run check runs them)",
  );
else if (!process.env.DOCS_HA_URL && process.env.DOCS_HA_ONBOARD !== "1")
  console.log(
    "SKIP  Documentation screenshots (needs a Home Assistant: set DOCS_HA_URL)",
  );
if (!quick && windows && !wsl)
  console.log(
    "SKIP  Browser checks on Linux and Home Assistant tests (install WSL to run them before pushing)",
  );
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
