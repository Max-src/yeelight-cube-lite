const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "images", "Cards", "generated");
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
  const first = new Map();
  const verified = new Map();
  let onboardState;
  for (const kind of ["clock", "native-effects"]) {
    for (const scenario of ["overview", "mobile", "offline"]) {
      for (let pass = 0; pass < 2; pass++) {
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
            colorScheme: "light",
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
            ({ kind, scenario }) => window.cardDocs.render(kind, scenario),
            { kind, scenario },
          );
          await page.clock.runFor(1200);
          await page.evaluate(() => window.cardDocs.settle());
          const file = `${kind}-${scenario}.png`;
          let clip = await page.locator("#card-docs").boundingBox();
          await page.screenshot({ clip, ...screenshotOptions });
          await page.evaluate(() => window.cardDocs.settle());
          clip = await page.locator("#card-docs").boundingBox();
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
            scenario === "mobile" ? 320 : 448,
            `Unexpected pixel scale: ${file}`,
          );
          assert.ok(
            Math.abs(actual.height - clip.height) <= 1,
            `Incomplete capture: ${file}`,
          );
          let bottomContent = 0;
          for (let row = actual.height - 100; row < actual.height - 10; row++) {
            for (let column = 20; column < actual.width - 20; column++) {
              const offset = (row * actual.width + column) * 4;
              if (Math.min(...actual.data.subarray(offset, offset + 3)) < 180)
                bottomContent++;
            }
          }
          assert.ok(bottomContent > 100, `Blank lower card region: ${file}`);
          if (pass === 0) first.set(file, image);
          else {
            const expected = PNG.sync.read(first.get(file));
            assert.equal(
              actual.width,
              expected.width,
              `Capture width changed: ${file}`,
            );
            assert.equal(
              actual.height,
              expected.height,
              `Capture height changed: ${file}`,
            );
            assert.ok(
              actual.data.equals(expected.data),
              `Capture pixels changed: ${file}`,
            );
            verified.set(file, image);
            console.log(`Verified ${file}`);
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
  for (const [file, image] of verified)
    await fs.writeFile(path.join(output, file), image);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
