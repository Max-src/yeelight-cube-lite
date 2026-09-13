import assert from "node:assert/strict";
import test from "node:test";
import {
  actionButtonStyles,
  actionButtonModel,
  actionButtonStyleChoices,
  actionButtonContentChoices,
  renderActionButtonHTML,
  getActionRowClass,
  actionButtonGroupModel,
  renderActionButtonGroupHTML,
  handleActionButtonGroupEvent,
} from "../custom_components/yeelight_cube/www/action-button-utils.js";
import {
  exportImportButtonStyles,
  getExportImportButtonClass,
} from "../custom_components/yeelight_cube/www/export-import-button-utils.js";

test("all styles and content modes share normalized rendering", () => {
  for (const { value: buttonStyle } of actionButtonStyleChoices) {
    for (const { value: contentMode } of actionButtonContentChoices) {
      const model = actionButtonModel({ buttonStyle, contentMode });
      const markup = renderActionButtonHTML({ buttonStyle, contentMode });
      assert.equal(
        model.contentMode,
        buttonStyle === "icon" ? "icon" : contentMode,
      );
      assert.equal(markup.includes("<ha-icon"), model.contentMode !== "text");
      assert.match(markup, /aria-label="Save"/);
      assert.ok(markup.includes(`btn-style-${buttonStyle}`));
    }
  }
});

test("legacy imports retain the same stylesheet and class API", () => {
  assert.equal(exportImportButtonStyles, actionButtonStyles);
  assert.equal(
    getExportImportButtonClass("power", "gradient"),
    "power-btn btn-style-gradient",
  );
});

test("stateful buttons keep their base style via the shared tool/tool-active look", () => {
  for (const { value: buttonStyle } of actionButtonStyleChoices) {
    const on = actionButtonModel({ buttonStyle, selected: true });
    const off = actionButtonModel({ buttonStyle, selected: false });
    assert.ok(on.className.includes(`btn-style-${buttonStyle}`));
    assert.ok(on.className.includes("tool-active"));
    assert.ok(off.className.includes(`btn-style-${buttonStyle}`));
    assert.ok(off.className.includes("tool-btn"));
    assert.ok(!off.className.includes("tool-active"));
  }
  // Non-stateful action buttons keep their semantic type class untouched.
  assert.ok(
    actionButtonModel({
      action: "save",
      buttonStyle: "gradient",
    }).className.includes("save-btn btn-style-gradient"),
  );
});

test("current-value buttons change label and icon without misleading pressed semantics", () => {
  const options = {
    selected: false,
    states: {
      on: { label: "12-hour", icon: "mdi:hours-12" },
      off: {
        label: "24-hour",
        icon: "mdi:hours-24",
        title: "24-hour. Switch to 12-hour",
      },
    },
  };
  const model = actionButtonModel(options);
  assert.equal(model.label, "24-hour");
  assert.equal(model.icon, "mdi:hours-24");
  assert.equal(model.selected, undefined);
  // Current-value toggles always read as the active setting (prominent look).
  assert.ok(model.className.includes("tool-active"));
  assert.ok(!renderActionButtonHTML(options).includes("aria-pressed"));
  assert.equal(
    actionButtonModel({ ...options, selected: true }).label,
    "12-hour",
  );
  assert.equal(
    actionButtonModel({ ...options, role: "radio" }).selected,
    false,
  );
});

test("choice groups have one tab stop and toggles expose independent pressed states", () => {
  const items = [
    { value: "time", label: "Time" },
    { value: "date", label: "Date" },
  ];
  const choices = actionButtonGroupModel({ items, value: "date" });
  assert.deepEqual(
    choices.map(({ selected, tabIndex, role }) => ({
      selected,
      tabIndex,
      role,
    })),
    [
      { selected: false, tabIndex: -1, role: "radio" },
      { selected: true, tabIndex: 0, role: "radio" },
    ],
  );
  const markup = renderActionButtonGroupHTML({
    label: 'Content "options"',
    items,
    value: "date",
  });
  assert.match(markup, /role="radiogroup"/);
  assert.match(markup, /aria-checked="true"/);
  assert.ok(!markup.includes("aria-pressed"));
  const toggles = renderActionButtonGroupHTML({
    label: "Format",
    multiple: true,
    items: items.map((item) => ({ ...item, selected: true })),
  });
  assert.equal((toggles.match(/aria-pressed="true"/g) || []).length, 2);
  assert.ok(!toggles.includes("aria-checked"));
  assert.ok(
    !renderActionButtonHTML({ label: "Save" }).includes("aria-pressed"),
  );
});

test("group navigation wraps and never changes confirmed state locally", () => {
  const buttons = [false, true].map((selected, index) => ({
    dataset: { value: String(index) },
    disabled: false,
    getAttribute: () => String(selected),
    focus() {
      this.focused = true;
    },
    closest() {
      return this;
    },
  }));
  const group = {
    getAttribute: () => "radiogroup",
    querySelectorAll: () => buttons,
  };
  const values = [];
  const event = {
    type: "keydown",
    key: "ArrowRight",
    target: buttons[1],
    currentTarget: group,
    preventDefault() {},
  };
  handleActionButtonGroupEvent(event, (value) => values.push(value));
  assert.deepEqual(values, ["0"]);
  assert.equal(buttons[0].focused, true);
  assert.equal(buttons[1].getAttribute("aria-checked"), "true");
  handleActionButtonGroupEvent({ ...event, type: "click" }, (value) =>
    values.push(value),
  );
  assert.deepEqual(values, ["0"]);
});

test("disabled choices do not take the group tab stop or activate", () => {
  const models = actionButtonGroupModel({
    value: "a",
    items: [{ value: "a", disabled: true }, { value: "b" }],
  });
  assert.deepEqual(
    models.map((model) => model.tabIndex),
    [-1, 0],
  );
  let calls = 0;
  handleActionButtonGroupEvent(
    {
      type: "click",
      currentTarget: {},
      target: { closest: () => ({ disabled: true }) },
    },
    () => calls++,
  );
  assert.equal(calls, 0);
});

test("action rows center both icon style and icon-only content", () => {
  for (const { value: buttonStyle } of actionButtonStyleChoices) {
    for (const { value: contentMode } of actionButtonContentChoices) {
      assert.equal(
        getActionRowClass({ buttonStyle, contentMode }),
        `action-row${buttonStyle === "icon" || contentMode === "icon" ? " icon-mode" : ""}`,
      );
    }
  }
  assert.equal(getActionRowClass(), "action-row");
});

test("buttons sanitize labels and handle loading, invalid settings and submit semantics", () => {
  const model = actionButtonModel({
    busy: true,
    type: "submit",
    buttonStyle: "unknown",
    contentMode: "unknown",
  });
  assert.equal(model.buttonStyle, "modern");
  assert.equal(model.contentMode, "icon_text");
  assert.equal(model.disabled, true);
  assert.equal(model.type, "submit");
  assert.equal(model.icon, "mdi:loading");
  const markup = renderActionButtonHTML({
    label: '<img src=x>"',
    icon: 'mdi:save" onclick="bad',
    disabled: true,
  });
  assert.ok(!markup.includes("<img"));
  assert.ok(!markup.includes('icon="mdi:save" onclick='));
  assert.match(markup, /disabled/);
});
