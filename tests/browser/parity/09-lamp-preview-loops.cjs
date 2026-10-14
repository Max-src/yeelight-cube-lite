// Card UI parity check (tests/card-ui-parity.cjs): the Lamp Preview's clock /
// native loops hold the frozen background.
const assert = require("node:assert/strict");

module.exports = async (t) => {
  const { page } = t;

  // The live lamp-preview card's own clock/native loops hold the background
  // animation while frozen and resume seamlessly (mirrors the frozen lamp).
  const lampResult = await page.evaluate(async () => {
    const module =
      await import("/custom_components/yeelight_cube/www/yeelight-cube-lamp-preview-card.js");
    const proto = customElements.get(
      "yeelight-cube-lamp-preview-card",
    ).prototype;
    // The card's own methods (the main lamp...) under the test's fields.
    const makeCard = (content_mode) => Object.setPrototypeOf({
      _onScreen: true,
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
      _clockAnimStartedAt: null,
      _frozenBackgroundPhase: null,
      _nativeAnimKey: null,
      _nativeAnimStartedAt: null,
      _nativeFrozenPhase: null,
    }, proto);

    // Native effect loop: phase advances, then holds once frozen.
    const card = makeCard("Native Effect");
    card._hass.states["light.a"].attributes.native_effect = "Rainbow";
    card._hass.states["light.a"].attributes.native_effect_direction = "Up";
    card._hass.states["light.a"].attributes.native_effect_speed = 50;
    let performanceNow = 1000;
    const realNow = performance.now.bind(performance);
    performance.now = () => performanceNow;
    proto._nativeAnimFrame.call(card);
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    const animatedPhase = card._nativeFrozenPhase;
    card._hass.states["light.a"].attributes.display_frozen = true;
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    const frozenPhase = card._nativeFrozenPhase;
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    const heldPhase = card._nativeFrozenPhase;
    card._hass.states["light.a"].attributes.display_frozen = false;
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    performanceNow += 1000;
    proto._nativeAnimFrame.call(card);
    performance.now = realNow;
    return {
      animated: animatedPhase === null, // not frozen yet -> no held phase
      frozen: typeof frozenPhase === "number",
      held: heldPhase === frozenPhase,
      resumed: card._nativeFrozenPhase === null,
    };
  });
  assert.ok(lampResult.animated, "lamp native loop animates when not frozen");
  assert.ok(lampResult.frozen, "lamp native loop holds a phase when frozen");
  assert.ok(
    lampResult.held,
    "lamp native loop holds that frame while frozen",
  );
  assert.ok(lampResult.resumed, "lamp native loop resumes after unfreeze");
  console.log(
    "PASS lamp-preview loops hold the frozen background and resume seamlessly",
  );
};
