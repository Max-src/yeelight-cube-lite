// Card UI parity check (tests/card-ui-parity.cjs): a failed shared module
// blocks every card until a reload; the diagnostics report.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { browser, server } = t;
  const startup = await browser.newPage();
  const address = `http://127.0.0.1:${server.address().port}/README.md`;
  const dependency = "**/www/html-escape-utils.js";
  await startup.route(dependency, (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Injected startup failure",
    }),
  );
  await startup.goto(address);
  await startup.evaluate(
    () =>
      import("/custom_components/yeelight_cube/www/frontend-diagnostics.js"),
  );
  const loadCards = async () => {
    const base = "/custom_components/yeelight_cube/www/";
    const { CARD_NAMES: names } = await import(`${base}card-list.js`);
    const results = await Promise.allSettled(
      names.map((name) => import(`${base}yeelight-cube-${name}-card.js`)),
    );
    // The font editor is an internal card (gitignored, absent from the
    // public repo and CI): only check it when the file is there.
    const fontUrl = `${base}yeelight-cube-font-editor-card.js`;
    const fontAvailable = (await fetch(fontUrl, { method: "HEAD" })).ok;
    if (fontAvailable) await import(fontUrl);
    return {
      status: results.map((result) => result.status),
      registered: names.map(
        (name) => !!customElements.get(`yeelight-cube-${name}-card`),
      ),
      font: fontAvailable
        ? !!customElements.get("yeelight-cube-font-editor-card")
        : null,
    };
  };
  const failedStartup = await startup.evaluate(loadCards);
  assert.ok(failedStartup.status.every((status) => status === "rejected"));
  assert.ok(failedStartup.registered.every((registered) => !registered));
  if (failedStartup.font !== null) assert.equal(failedStartup.font, true);
  const failedReport = await startup.evaluate(() =>
    window.yeelightCubeDiagnostics.report(),
  );
  assert.ok(
    Object.values(failedReport.current.cards).every(
      (registered) => !registered,
    ),
  );
  assert.ok(
    failedReport.current.resources.some((resource) =>
      resource.path.endsWith("html-escape-utils.js"),
    ),
  );
  await startup.evaluate(() => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const errorCard = document.createElement("hui-error-card");
    errorCard.error =
      "Custom element does not exist: yeelight-cube-gradient-card";
    root.append(errorCard);
    document.body.append(host);
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Module error at /yeelight_cube/example.js?token=secret",
        filename: `${location.origin}/yeelight_cube/example.js?token=secret`,
        lineno: 12,
      }),
    );
  });
  const errorReport = await startup.evaluate(() =>
    window.yeelightCubeDiagnostics.report(),
  );
  assert.ok(
    errorReport.current.events.some(
      (event) => event.kind === "javascript-error" && event.line === 12,
    ),
  );
  assert.ok(
    errorReport.current.events.some((event) =>
      event.cardErrors?.some((message) =>
        message.includes("yeelight-cube-gradient-card"),
      ),
    ),
  );
  assert.ok(!JSON.stringify(errorReport).includes("token=secret"));
  await startup.unroute(dependency);
  const sameDocument = await startup.evaluate(loadCards);
  assert.ok(sameDocument.registered.every((registered) => !registered));
  await startup.reload();
  await startup.evaluate(
    () =>
      import("/custom_components/yeelight_cube/www/frontend-diagnostics.js"),
  );
  const recoveredStartup = await startup.evaluate(loadCards);
  assert.ok(recoveredStartup.registered.every(Boolean));
  const recoveredReport = await startup.evaluate(() =>
    window.yeelightCubeDiagnostics.report(),
  );
  assert.ok(
    Object.values(recoveredReport.previous.cards).every(
      (registered) => !registered,
    ),
  );
  assert.ok(Object.values(recoveredReport.current.cards).every(Boolean));
  assert.ok(
    recoveredReport.previous.events.some(
      (event) => event.kind === "javascript-error",
    ),
  );
  await startup.evaluate(() => {
    for (let index = 0; index < 60; index++)
      window.dispatchEvent(new Event("offline"));
    if (window.yeelightCubeDiagnostics.report().current.events.length > 40)
      throw Error("Diagnostic buffer exceeded its limit");
    window.yeelightCubeDiagnostics.stop();
    window.yeelightCubeDiagnostics.clear();
  });
  await startup.close();
  console.log(
    "PASS injected shared-module failure blocks all seven main cards until reload; standalone Font Editor survives",
  );
};
