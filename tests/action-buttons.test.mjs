import assert from "node:assert/strict";
import test from "node:test";
import {
  actionButtonStyles,
  actionButtonModel,
  actionButtonStyleChoices,
  actionButtonContentChoices,
  renderActionButtonHTML,
  getActionRowClass,
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
