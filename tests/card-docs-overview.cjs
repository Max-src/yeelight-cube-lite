// Compose public README overviews from the generated real-card screenshots.
// No Home Assistant instance or credentials are needed for this step.
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const output = path.resolve(__dirname, "../images/Cards/generated");
const groups = {
  display: [["clock", "Clock"], ["native-effects", "Native effects"], ["draw", "Pixel art"]],
  colors: [["lamp-preview", "Lamp preview"], ["gradient", "Gradients"], ["palette", "Palettes"]],
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 650 }, deviceScaleFactor: 1 });
    for (const [name, cards] of Object.entries(groups)) {
      const tiles = await Promise.all(cards.map(async ([kind, title]) => {
        const data = await fs.readFile(path.join(output, `${kind}-overview.png`));
        return `<section><h2>${title}</h2><div><img alt="${title} card" src="data:image/png;base64,${data.toString("base64")}"></div></section>`;
      }));
      await page.setContent(`<!doctype html><html><head><style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 22px; background: #eef2f6; color: #173147; font-family: Arial, sans-serif; }
        main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        section { min-width: 0; }
        h2 { margin: 0 0 14px; font-size: 23px; }
        section div { height: 536px; overflow: hidden; border: 1px solid #d7e0e9; border-radius: 12px; background: white; }
        img { display: block; width: 100%; height: auto; }
        footer { margin-top: 12px; font-size: 13px; color: #506578; }
      </style></head><body><main>${tiles.join("")}</main>
      <footer>Example dashboard cards · cropped overview · configurable layouts and themes</footer></body></html>`);
      await page.locator("img").evaluateAll(images => Promise.all(images.map(img => img.decode())));
      await page.screenshot({ path: path.join(output, `overview-${name}.png`) });
      console.log(`Generated overview-${name}.png`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
