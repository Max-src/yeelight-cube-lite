import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  orientationOptions,
  nextOrientation,
  renderOrientationControls,
  ORIENTATION_ORDER,
} from "../custom_components/yeelight_cube/www/orientation-control-utils.js";
import { actionButtonStyleChoices } from "../custom_components/yeelight_cube/www/action-button-utils.js";

function orientationCard(callService) {
  const source = readFileSync(
    new URL(
      "../custom_components/yeelight_cube/www/yeelight-cube-lamp-preview-card.js",
      import.meta.url,
    ),
    "utf8",
  );
  const card = {
    config: { entity: "light.demo" },
    _orientationContext: 1,
    _hass: {
      states: {
        "light.demo": {
          state: "on",
          attributes: { device_orientation: "right" },
        },
      },
      callService,
    },
    _refreshOrientationControls() {},
  };
  for (const name of ["handleOrientationSelect", "handleOrientationControl"]) {
    const method = source.match(
      new RegExp(`  (async )?${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`),
    );
    assert.ok(method, `${name} exists`);
    card[name] = new Function(
      "orientationOptions",
      "nextOrientation",
      `return ${method[1] || ""}function(${method[2]}) {${method[3]}}`,
    )(orientationOptions, nextOrientation);
  }
  return card;
}

test("rapid rotation clicks use the pending target and serialize hardware requests", async () => {
  const calls = [];
  const releases = [];
  const card = orientationCard((domain, service, data) => {
    calls.push({ domain, service, ...data });
    return new Promise((resolve) =>
      releases.push(() => {
        card._hass.states["light.demo"].attributes.device_orientation =
          data.orientation;
        resolve();
      }),
    );
  });
  const click = () =>
    card.handleOrientationControl({
      target: {
        closest: () => ({ dataset: { value: "clockwise" }, disabled: false }),
      },
    });
  click();
  click();
  click();
  assert.equal(card._orientationPending, "up");
  await Promise.resolve();
  assert.equal(calls.length, 1);
  for (let index = 0; index < 3; index++) {
    releases[index]();
    for (let tick = 0; tick < 6; tick++) await Promise.resolve();
  }
  await card._orientationQueue;
  assert.deepEqual(
    calls.map((call) => call.orientation),
    ["down", "left", "up"],
  );
  assert.ok(
    calls.every(
      (call) =>
        call.domain === "yeelight_cube" &&
        call.service === "set_device_orientation" &&
        call.entity_id === "light.demo",
    ),
  );
  assert.equal(card._orientationPending, null);
});

test("failed commands roll back; invalid or unavailable targets never send", async (context) => {
  context.mock.method(console, "error", () => {});
  let calls = 0;
  const card = orientationCard(async () => {
    calls++;
    throw new Error("Offline");
  });
  await card.handleOrientationSelect("down");
  assert.equal(card._orientationPending, null);
  assert.match(card._orientationError, /Could not change orientation/);
  await card.handleOrientationSelect("invalid");
  card._hass.states["light.demo"].state = "unavailable";
  await card.handleOrientationSelect("left");
  assert.equal(calls, 1);
});

test("changing card context discards queued commands and stale responses", async () => {
  let release;
  const calls = [];
  const card = orientationCard((domain, service, data) => {
    calls.push(data.orientation);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const first = card.handleOrientationSelect("down");
  const second = card.handleOrientationSelect("left");
  await Promise.resolve();
  card._orientationContext++;
  card._orientationPending = null;
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["down"]);
  assert.equal(card._orientationPending, null);
});

test("orientation defaults preserve the original arrows and order", () => {
  assert.deepEqual(orientationOptions().directions, ORIENTATION_ORDER);
  const markup = renderOrientationControls({}, "right");
  assert.deepEqual(
    [...markup.matchAll(/data-value="([^"]+)"/g)].map((match) => match[1]),
    ORIENTATION_ORDER,
  );
  assert.match(markup, /class="orient-btn active" data-value="right"/);
  assert.match(markup, /aria-pressed="true"/);
  assert.doesNotMatch(markup, /Rotate \+/);
});

test("orientation choices are sanitized, reorderable and can all be hidden", () => {
  assert.deepEqual(
    orientationOptions({ orientation_directions: ["up", "bad", "up", "right"] })
      .directions,
    ["up", "right"],
  );
  assert.equal(
    renderOrientationControls({ orientation_directions: [] }, "right"),
    "",
  );
  assert.equal(
    renderOrientationControls({ show_device_orientation: false }, "right"),
    "",
  );
  assert.equal(
    orientationOptions({
      orientation_button_style: 'bad"',
      orientation_layout: "bad",
    }).style,
    "original",
  );
});

test("rotation follows physical order, skips hidden directions and wraps", () => {
  for (const [index, direction] of ORIENTATION_ORDER.entries()) {
    assert.equal(
      nextOrientation(direction, 1),
      ORIENTATION_ORDER[(index + 1) % 4],
    );
    assert.equal(
      nextOrientation(direction, -1),
      ORIENTATION_ORDER[(index + 3) % 4],
    );
    assert.equal(
      nextOrientation(direction, 2),
      ORIENTATION_ORDER[(index + 2) % 4],
    );
  }
  assert.equal(nextOrientation("right", 1, ["up", "left", "right"]), "left");
  assert.equal(nextOrientation("down", -1, ["up", "left"]), "up");
  assert.equal(nextOrientation("right", 2, ["up", "right"]), null);
  assert.equal(nextOrientation("right", 1, []), null);
  assert.equal(nextOrientation("right", 1, ["right"]), "right");
});

test("orientation styles reuse shared buttons with labels and disabled states", () => {
  for (const { value: style } of actionButtonStyleChoices) {
    for (const content of ["icon", "text", "icon_text"]) {
      const markup = renderOrientationControls(
        {
          orientation_button_style: style,
          orientation_content_mode: content,
          orientation_layout: "both",
          orientation_half_turn: true,
        },
        "up",
        true,
      );
      assert.match(markup, new RegExp(`btn-style-${style}`));
      assert.equal((markup.match(/ disabled/g) || []).length, 7);
      assert.match(markup, /aria-label="Rotate \+"/);
      assert.match(markup, /aria-label="Rotate -"/);
      assert.match(markup, /aria-label="Flip"/);
    }
  }
  const rotate = renderOrientationControls(
    { orientation_layout: "rotate", orientation_directions: ["right"] },
    "right",
  );
  assert.equal((rotate.match(/ disabled/g) || []).length, 2);
  assert.doesNotMatch(rotate, /data-value="right"/);
});

test("one list composes arrows and actions in exact configured order", () => {
  const buttons = ["clockwise", "up", "half-turn", "right", "counterclockwise"];
  const config = {
    orientation_buttons: [...buttons, "bad", "up"],
    orientation_layout: "rotate",
    orientation_half_turn: false,
  };
  assert.deepEqual(orientationOptions(config).buttons, buttons);
  const markup = renderOrientationControls(config, "right");
  assert.deepEqual(
    [...markup.matchAll(/data-value="([^"]+)"/g)].map((match) => match[1]),
    buttons,
  );
  assert.equal((markup.match(/class="orientation-buttons"/g) || []).length, 1);
  assert.equal(
    renderOrientationControls({ orientation_buttons: [] }, "right"),
    "",
  );
});

test("legacy layouts translate to a combined button list", () => {
  assert.deepEqual(
    orientationOptions({
      orientation_layout: "both",
      orientation_half_turn: true,
      orientation_directions: ["up", "right"],
    }).buttons,
    ["up", "right", "counterclockwise", "half-turn", "clockwise"],
  );
  assert.deepEqual(
    orientationOptions({ orientation_layout: "rotate" }).buttons,
    ["counterclockwise", "clockwise"],
  );
});

test("rotation and flip work without visible direction arrows", async () => {
  const calls = [];
  const card = orientationCard(async (domain, service, data) => {
    calls.push(data.orientation);
    card._hass.states["light.demo"].attributes.device_orientation =
      data.orientation;
  });
  card.config.orientation_buttons = [
    "clockwise",
    "half-turn",
    "counterclockwise",
  ];
  const options = orientationOptions(card.config);
  assert.deepEqual(options.directions, ORIENTATION_ORDER);
  assert.doesNotMatch(
    renderOrientationControls(card.config, "right"),
    / disabled/,
  );
  for (const value of card.config.orientation_buttons) {
    card.handleOrientationControl({
      target: { closest: () => ({ dataset: { value }, disabled: false }) },
    });
    await card._orientationQueue;
  }
  assert.deepEqual(calls, ["down", "up", "left"]);
});
