// Card UI parity check (tests/card-ui-parity.cjs): the Lamp Preview's clock /
// native loops hold the frozen background.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;

  // The live lamp-preview card's own clock/native loops hold the background
  // animation while frozen and resume seamlessly (mirrors the frozen lamp).
  const lampResult = await page.evaluate(async () => {
    await import("/custom_components/yeelight_cube/www/yeelight-cube-lamp-preview-card.js");
    const proto = customElements.get(
      "yeelight-cube-lamp-preview-card",
    ).prototype;
    // The card's own methods (the main lamp...) under the test's fields.
    const makeCard = (content_mode) => Object.setPrototypeOf({
      config: { entity: "light.a" },
      _hass: {
        states: {
          "light.a": {
            state: "on",
            attributes: { content_mode, display_frozen: false },
          },
        },
      },
      _getLampDots: () => new Array(100).fill({}),
      _updateMatrixColors() {},
      _matrixColorsToGridColors: (x) => x,
      _getNativeClockFont: () => ({ fontMap: null, metrics: null }),
      _nativeAnimKey: null,
    }, proto);

    // Native effect loop: phase advances, then holds once frozen.
    const card = makeCard("Native Effect");
    card._hass.states["light.a"].attributes.native_effect = "Rainbow";
    card._hass.states["light.a"].attributes.native_effect_direction = "Up";
    card._hass.states["light.a"].attributes.native_effect_speed = 50;
    let performanceNow = 1000;
    const realNow = performance.now.bind(performance);
    performance.now = () => performanceNow;
    // The card's clock (preview-animation.js PreviewClock): its seconds.
    const seconds = () => card._nativeClock.elapsed;
    proto._nativeAnimFrame.call(card);
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    const animatedPhase = seconds();
    card._hass.states["light.a"].attributes.display_frozen = true;
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    const frozenPhase = seconds();
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    const heldPhase = seconds();
    card._hass.states["light.a"].attributes.display_frozen = false;
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    performance.now = realNow;
    return {
      animated: animatedPhase === 1,
      // Frozen: the moment it was frozen, held there.
      frozen: frozenPhase === 1,
      held: heldPhase === frozenPhase,
      // Resumed from the held moment, without a jump (a frame later, a
      // frame's time on).
      resumed: seconds() === 3,
    };
  });
  assert.ok(lampResult.animated, "lamp native loop animates when not frozen");
  assert.ok(lampResult.frozen, "lamp native loop holds a phase when frozen");
  assert.ok(
    lampResult.held,
    "lamp native loop holds that frame while frozen",
  );
  assert.ok(lampResult.resumed, "lamp native loop resumes after unfreeze");
  // The lamp's own picture (a scrolling text): its stream while it streams
  // (every step), then matrix_colors again.
  const matrixResult = await page.evaluate(async () => {
    const proto = customElements.get(
      "yeelight-cube-lamp-preview-card",
    ).prototype;
    let frame = [[9, 9, 9]];
    const painted = [];
    const card = Object.setPrototypeOf({
      config: { entity: "light.a" },
      _hass: {
        connection: {},
        states: { "light.a": { state: "on", attributes: { content_mode: "Text" } } },
      },
      _animation: {
        onScreen: true,
        streamed: () => frame,
        samePaint: () => false,
        forgetPaint() {},
      },
      _lampSliders: { previewScale: () => 1 },
      _getLampDots: () => new Array(100).fill({}),
      _setInstantDots() {},
      _matrixColorsToGridColors: (colors) => colors,
      _updateMatrixColors: (colors) => painted.push(colors),
      _paintStaticPreview: () => painted.push("static"),
    }, proto);
    card._animationMode = "matrix";
    proto._matrixAnimFrame.call(card);
    frame = null;
    proto._matrixAnimFrame.call(card);
    proto._matrixAnimFrame.call(card);
    return painted;
  });
  assert.deepEqual(
    matrixResult,
    [[[9, 9, 9]], "static"],
    "the lamp's picture follows its stream, then its reported colors once",
  );
  console.log(
    "PASS lamp-preview loops hold the frozen background and resume seamlessly; the lamp's picture follows its stream",
  );
};
