const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const catalogue = require("./card-docs-catalogue.json");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "images", "Cards", "generated");
// Captures of images that rendered differently each time (uploaded by CI).
const DIAGNOSTICS = path.join(root, "test-results", "card-docs");
const origin = new URL(process.env.DOCS_HA_URL || "http://127.0.0.1:8123")
  .origin;

async function onboard(context) {
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname),
    "Onboarding is restricted to a disposable localhost HA instance",
  );
  const response = await context.request.post(
    `${origin}/api/onboarding/users`,
    {
      data: {
        client_id: `${origin}/`,
        name: "Documentation",
        username: "docs",
        password: randomBytes(24).toString("hex"),
        language: "en",
      },
    },
  );
  assert.ok(
    response.ok(),
    "Disposable HA onboarding failed; use a fresh config directory",
  );
  const { auth_code: code } = await response.json();
  const tokenResponse = await context.request.post(`${origin}/auth/token`, {
    form: { grant_type: "authorization_code", code, client_id: `${origin}/` },
  });
  assert.ok(tokenResponse.ok(), "Disposable HA authentication failed");
  const tokens = await tokenResponse.json();
  const headers = { Authorization: `Bearer ${tokens.access_token}` };
  for (const step of ["core_config", "analytics", "integration"]) {
    const result = await context.request.post(
      `${origin}/api/onboarding/${step}`,
      {
        headers,
        data:
          step === "integration"
            ? { client_id: `${origin}/`, redirect_uri: `${origin}/` }
            : {},
      },
    );
    assert.ok(result.ok(), `Disposable HA onboarding step failed: ${step}`);
  }
  await context.addInitScript(
    ({ tokens, origin }) => {
      if (location.origin === origin)
        localStorage.setItem(
          "hassTokens",
          JSON.stringify({
            ...tokens,
            hassUrl: origin,
            clientId: `${origin}/`,
            expires: Date.now() + tokens.expires_in * 1000,
          }),
        );
    },
    { tokens, origin },
  );
}

// Wait until every ha-icon has drawn. Polls from Node in real time because the
// page's own timers are frozen by page.clock during capture.
async function waitForIcons(page, file) {
  const deadline = Date.now() + 10000;
  while (!(await page.evaluate(() => window.cardDocs.iconsReady()))) {
    assert.ok(Date.now() < deadline, `Icons did not load: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  assert.ok(
    process.env.DOCS_HA_STORAGE_STATE || process.env.DOCS_HA_ONBOARD === "1",
    "Set DOCS_HA_STORAGE_STATE for your own login, or DOCS_HA_ONBOARD=1 for a fresh disposable localhost HA",
  );
  const fontScript = `
import ast, json
from pathlib import Path
tree = ast.parse(Path('custom_components/yeelight_cube/layout.py').read_text(encoding='utf-8'))
assignments = []
for statement in tree.body:
    if isinstance(statement, ast.AnnAssign):
        statement = ast.Assign(targets=[statement.target], value=statement.value)
    if isinstance(statement, ast.Assign):
        target = statement.targets[0]
        name = target.value.id if isinstance(target, ast.Subscript) else getattr(target, 'id', '')
        if name in ('FONT_MAPS', 'FONT_METRICS', '_NATIVE_FONT_OVERRIDES'):
            assignments.append(statement)
data = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=assignments, type_ignores=[])), '<fonts>', 'exec'), data)
print(json.dumps({'font_maps': data['FONT_MAPS'], 'font_metrics': data['FONT_METRICS']}))
`;
  const fontResult = spawnSync(
    process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"),
    ["-c", fontScript],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    fontResult.status,
    0,
    "Unable to load production font maps with Python",
  );
  const fonts = JSON.parse(fontResult.stdout);
  await fs.mkdir(output, { recursive: true });
  const verified = new Map();
  // Captures that never matched: written to DIAGNOSTICS for the CI artifact.
  const failures = [];
  let onboardState;
  for (const [kind, definition] of Object.entries(catalogue)) {
    // Editor entries are either a caption string or { title, config } when the
    // panel needs settings beyond the fixture defaults (e.g. a hidden section).
    const scenarios = {
      ...definition.variations,
      ...Object.fromEntries(
        Object.entries(definition.editors).map(([section, entry]) => [
          `editor-${section}`,
          typeof entry === "string"
            ? { section, title: entry }
            : { section, ...entry },
        ]),
      ),
    };
    for (const [scenario, options] of Object.entries(scenarios)) {
      if (
        process.env.DOCS_FILTER &&
        !`${kind}-${scenario}`.includes(process.env.DOCS_FILTER)
      )
        continue;
      // Each image is captured until two captures match exactly: normally
      // twice, a third time when the first two differ. A single odd capture
      // (a rare rendering race) is then outvoted instead of failing the run;
      // three different captures mean real non-determinism.
      const captures = [];
      let passes = 2;
      for (let pass = 0; pass < passes; pass++) {
        const browser = await chromium.launch({
          headless: true,
          args: [
            "--disable-gpu",
            "--disable-lcd-text",
            "--force-color-profile=srgb",
          ],
        });
        try {
          const context = await browser.newContext({
            storageState: onboardState || process.env.DOCS_HA_STORAGE_STATE,
            viewport: { width: 1280, height: 2000 },
            deviceScaleFactor: 1,
            locale: "en-GB",
            timezoneId: "UTC",
            colorScheme: options.dark ? "dark" : "light",
            reducedMotion: "reduce",
          });
          if (process.env.DOCS_HA_ONBOARD === "1" && !onboardState)
            await onboard(context);
          await context.route("**/yeelight_cube/**", async (route) => {
            const relative = decodeURIComponent(
              new URL(route.request().url()).pathname,
            ).replace(/^\/yeelight_cube\//, "");
            const base = path.join(
              root,
              "custom_components",
              "yeelight_cube",
              "www",
            );
            const file = path.resolve(base, relative);
            if (!file.startsWith(base + path.sep)) return route.abort();
            await route.fulfill({
              path: file,
              contentType: file.endsWith(".js") ? "text/javascript" : undefined,
            });
          });
          const page = await context.newPage();
          await page.goto(`${origin}/lovelace/0`);
          await page.waitForFunction(
            () => document.querySelector("home-assistant")?.hass?.connected,
          );
          await page.waitForFunction(
            () => typeof window.loadCardHelpers === "function",
          );
          await page.evaluate(async () => {
            const helpers = await window.loadCardHelpers();
            helpers.createCardElement({ type: "markdown", content: "" });
            await Promise.all(
              ["ha-card", "ha-icon"].map((tag) =>
                customElements.whenDefined(tag),
              ),
            );
          });
          await page.addScriptTag({
            path: path.join(__dirname, "card-docs-browser.js"),
          });
          await page.evaluate((fonts) => window.cardDocs.prepare(fonts), fonts);
          await page.clock.install({ time: new Date("2026-01-15T10:07:00Z") });
          await page.clock.pauseAt(new Date("2026-01-15T10:08:00Z"));
          const screenshotOptions = {
            animations: "disabled",
            scale: "css",
            style:
              "* { transition: none !important; animation: none !important; caret-color: transparent !important; }",
          };
          await page.evaluate(
            ({ kind, scenario, options }) =>
              window.cardDocs.render(kind, scenario, options),
            { kind, scenario, options },
          );
          await page.clock.runFor(1200);
          await page.evaluate(() => window.cardDocs.settle());
          const file = `${kind}-${scenario}.png`;
          await waitForIcons(page, file);
          const selector = await page.evaluate(
            () => window.cardDocs.captureSelector,
          );
          let clip = await page.locator(selector).boundingBox();
          await page.screenshot({ clip, ...screenshotOptions });
          await page.evaluate(() => window.cardDocs.settle());
          await waitForIcons(page, file);
          clip = await page.locator(selector).boundingBox();
          assert.ok(
            clip && clip.width > 0 && clip.height > 0,
            "Capture container is empty",
          );
          const viewport = page.viewportSize();
          assert.ok(
            clip.x >= 0 &&
              clip.y >= 0 &&
              clip.x + clip.width <= viewport.width &&
              clip.y + clip.height <= viewport.height,
            `Card extends outside viewport: ${file}`,
          );
          const image = await page.screenshot({ clip, ...screenshotOptions });
          const actual = PNG.sync.read(image);
          assert.equal(
            actual.width,
            options.section ? Math.floor(clip.width) : options.width || 448,
            `Unexpected pixel scale: ${file}`,
          );
          assert.ok(
            Math.abs(actual.height - clip.height) <= 1,
            `Incomplete capture: ${file}`,
          );
          let bottomContent = 0;
          const background = actual.data.subarray(0, 3);
          for (
            let row = Math.max(0, actual.height - 100);
            row < actual.height - 10;
            row++
          ) {
            for (let column = 20; column < actual.width - 20; column++) {
              const offset = (row * actual.width + column) * 4;
              if (
                actual.data
                  .subarray(offset, offset + 3)
                  .some(
                    (channel, index) =>
                      Math.abs(channel - background[index]) > 40,
                  )
              )
                bottomContent++;
            }
          }
          assert.ok(bottomContent > 100, `Blank lower card region: ${file}`);
          captures.push({ image, png: actual });
          if (captures.length >= 2) {
            const match = matchingCapture(captures);
            if (match) {
              verified.set(file, match.image);
              if (captures.length > 2)
                console.warn(
                  `Flaky capture outvoted: ${file} (${describeDifference(captures[0].png, captures[1].png)})`,
                );
              console.log(`Verified ${file}`);
            } else if (captures.length < 3) {
              console.warn(
                `Capture pixels changed: ${file} (${describeDifference(captures[0].png, captures[1].png)}); capturing a third time`,
              );
              passes = 3;
            } else {
              failures.push(file);
              await writeDiagnostics(file, captures);
              console.error(
                `Capture pixels changed in all ${captures.length} captures: ${file} (${describeDifference(captures[0].png, captures[1].png)})`,
              );
            }
          }
          if (process.env.DOCS_HA_ONBOARD === "1")
            onboardState = await context.storageState();
          await context.close();
        } finally {
          await browser.close();
        }
      }
    }
  }
  if (failures.length) {
    throw new Error(
      `Non-deterministic captures (see ${path.relative(root, DIAGNOSTICS)}): ${failures.join(", ")}`,
    );
  }
  for (const [file, image] of verified)
    await fs.writeFile(path.join(output, file), image);
}

/** The first capture that exactly matches another one, or null. */
function matchingCapture(captures) {
  for (let i = 0; i < captures.length; i++)
    for (let j = i + 1; j < captures.length; j++) {
      const [a, b] = [captures[i].png, captures[j].png];
      if (a.width === b.width && a.height === b.height && a.data.equals(b.data))
        return captures[i];
    }
  return null;
}

/** How two captures differ: size, or count, extent and strength of pixel changes. */
function describeDifference(a, b) {
  if (a.width !== b.width || a.height !== b.height)
    return `size ${a.width}x${a.height} vs ${b.width}x${b.height}`;
  let count = 0;
  let maxDelta = 0;
  let [left, top, right, bottom] = [a.width, a.height, -1, -1];
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const offset = (y * a.width + x) * 4;
      let delta = 0;
      for (let c = 0; c < 4; c++)
        delta = Math.max(delta, Math.abs(a.data[offset + c] - b.data[offset + c]));
      if (!delta) continue;
      count++;
      maxDelta = Math.max(maxDelta, delta);
      [left, top] = [Math.min(left, x), Math.min(top, y)];
      [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
    }
  return `${count} pixels differ, max channel delta ${maxDelta}, in ${right - left + 1}x${bottom - top + 1} at ${left},${top}`;
}

/** Every capture of a failed image, plus a diff of the first two (changed pixels in magenta). */
async function writeDiagnostics(file, captures) {
  await fs.mkdir(DIAGNOSTICS, { recursive: true });
  const stem = file.replace(/\.png$/, "");
  for (const [index, capture] of captures.entries())
    await fs.writeFile(path.join(DIAGNOSTICS, `${stem}.capture${index + 1}.png`), capture.image);
  const [a, b] = [captures[0].png, captures[1].png];
  if (a.width !== b.width || a.height !== b.height) return;
  const diff = new PNG({ width: a.width, height: a.height });
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const changed = [0, 1, 2, 3].some((c) => a.data[offset + c] !== b.data[offset + c]);
    const grey = Math.round((a.data[offset] + a.data[offset + 1] + a.data[offset + 2]) / 6);
    diff.data.set(changed ? [255, 0, 255, 255] : [grey, grey, grey, 255], offset);
  }
  await fs.writeFile(path.join(DIAGNOSTICS, `${stem}.diff.png`), PNG.sync.write(diff));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
