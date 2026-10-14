// Real-browser checks that the cards behave alike where they share a
// feature (startup, favourites, rotation, power, appearance, galleries…).
// The checks are the files of tests/browser/parity, run in order on one page.
//
//   node tests/card-ui-parity.cjs
//   STARTUP_ONLY=1      the startup check alone
//   FOCUSED_CONTROLS=1  up to the appearance checks
const path = require("node:path");
const { runChecks, withBrowser } = require("./browser/harness.cjs");

withBrowser(({ browser, server }) =>
  runChecks(
    path.join(__dirname, "browser", "parity"),
    { browser, server },
    {
      stopAfter: process.env.STARTUP_ONLY
        ? "00-startup"
        : process.env.FOCUSED_CONTROLS
          ? "07-appearance"
          : null,
    },
  )
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
