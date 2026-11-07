// The real-browser checks' shared harness: the repository served over HTTP
// (the checks' pages import the cards from it), the browser, and the run of
// a check's section files.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const root = path.resolve(__dirname, "..", "..");
const TYPES = { ".js": "text/javascript", ".html": "text/html" };

/** The repository on a free local port (resolves once it listens). */
async function serveRepository() {
  const server = http.createServer(async (request, response) => {
    const file = path.resolve(
      root,
      `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`,
    );
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const data = await fs.promises.readFile(file);
      response.setHeader("Content-Type", TYPES[path.extname(file)] || "text/plain");
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/**
 * No native color chooser in a check's page: a headless browser cannot show
 * it, and one left open makes Chromium close the page a moment later, in a
 * later check ("Execution context was destroyed"). showPicker only records
 * the input's type (window.__pickersShown), and a click on a color input
 * keeps its handlers but not the chooser. The checks set the picked color
 * themselves (a change or cancel event on the input).
 */
function noNativePickers() {
  const proto = HTMLInputElement.prototype;
  if (proto.__noNativePickers) return;
  Object.defineProperty(proto, "__noNativePickers", { value: true });
  proto.showPicker = function showPicker() {
    (window.__pickersShown ||= []).push(this.type);
  };
  document.addEventListener(
    "click",
    (event) => {
      const input = event.composedPath()[0];
      if (input instanceof HTMLInputElement && input.type === "color") event.preventDefault();
    },
    true,
  );
}

/** Every page of `browser` (its own contexts' too) gets noNativePickers. */
function withoutNativePickers(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    await context.addInitScript(noNativePickers);
    return context;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.addInitScript(noNativePickers);
    return page;
  };
  return browser;
}

/** Edge by default; BROWSER_CHANNEL=chromium on Linux and CI. */
const launchBrowser = async () =>
  withoutNativePickers(
    await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
  );

/**
 * Runs the section files of `dir` in name order, each `async (t) => {}`
 * with the shared context `t` (a section may add to it, like the page).
 * The sections share the page, so they always run in order, from the
 * first; `stopAfter` (a file name without .cjs) ends the run after it.
 */
async function runChecks(dir, t, { stopAfter } = {}) {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".cjs")).sort();
  for (const file of files) {
    await require(path.join(dir, file))(t);
    if (file === `${stopAfter}.cjs`) return;
  }
}

/** Runs `run({ browser, server })`, then closes both (also on a failure). */
async function withBrowser(run) {
  const server = await serveRepository();
  let browser;
  try {
    browser = await launchBrowser();
    await run({ browser, server });
  } finally {
    await browser?.close();
    server.close();
  }
}

module.exports = { runChecks, withBrowser };
