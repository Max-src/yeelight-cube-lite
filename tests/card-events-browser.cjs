// Real-browser checks under a strict Content Security Policy:
// - delegated card events (host-events.js): every control that used to carry
//   an inline on* handler is clicked, dragged, typed into or scrolled, and
//   must still reach the card (and the lamp);
// - saved names containing markup stay text in every display mode.
// The checks are the files of tests/browser/events, run in order on one page.
//
//   node tests/card-events-browser.cjs
const path = require("node:path");
const { runChecks, withBrowser } = require("./browser/harness.cjs");

withBrowser(({ browser, server }) =>
  runChecks(path.join(__dirname, "browser", "events"), {
    browser,
    server,
    errors: [],
    SLIDER_STYLES: ["slider", "bar", "wheel", "matrix", "rotary", "capsule"],
    lamp: "yeelight-cube-lamp-preview-card",
    draw: "yeelight-cube-draw-card",
    gradient: "yeelight-cube-gradient-card",
  })
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
