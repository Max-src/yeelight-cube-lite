import { actionButtonStyleChoices } from "./action-button-utils.js";

import { cardSpacing } from "./card-layout-utils.js";

export const ORIENTATION_ORDER = ["right", "down", "left", "up"];
export const orientationControlStyles = `
  .device-orientation-row {
    display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
    gap: ${cardSpacing.control};
  }
  .orientation-buttons {
    display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
    gap: ${cardSpacing.control}; min-width: 0; max-width: 100%;
  }
  .orientation-buttons .shared-action-button {
    min-height: 40px; max-width: 100%; white-space: normal;
  }
  .orientation-error {
    color: var(--error-color, #db4437); text-align: center;
    font-size: 0.85rem; padding: 0 10px 8px;
  }
  .orientation-buttons button:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px;
  }
  .orientation-buttons button:disabled { opacity: 0.4; cursor: default; }
  .device-orientation-row .orient-btn {
    width: 44px; height: 40px; border: none; border-radius: 10px;
    background: var(--secondary-background-color, #e0e0e0);
    color: var(--primary-text-color, #444); font-size: 1.2rem; line-height: 1;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
  }
  .device-orientation-row .orient-btn:hover { transform: translateY(-1px); }
  .device-orientation-row .orient-btn.active {
    background: linear-gradient(135deg, #b026ff, #ff5e3a);
    color: #fff; box-shadow: 0 2px 8px rgba(176, 38, 255, 0.4);
  }
`;
export const ORIENTATION_CHOICES = [
  ...ORIENTATION_ORDER.map((value) => ({
    value,
    label: value[0].toUpperCase() + value.slice(1),
    icon: `mdi:arrow-${value}`,
  })),
  {
    value: "counterclockwise",
    label: "Rotate -",
    icon: "mdi:rotate-left",
    step: -1,
  },
  { value: "half-turn", label: "Flip", icon: "mdi:swap-horizontal", step: 2 },
  { value: "clockwise", label: "Rotate +", icon: "mdi:rotate-right", step: 1 },
];

export function orientationOptions(config = {}) {
  const directions = Array.isArray(config.orientation_directions)
    ? [
        ...new Set(
          config.orientation_directions.filter((value) =>
            ORIENTATION_ORDER.includes(value),
          ),
        ),
      ]
    : [...ORIENTATION_ORDER];
  const legacyButtons = directions.length
    ? [
        ...(config.orientation_layout === "rotate" ? [] : directions),
        ...(["rotate", "both"].includes(config.orientation_layout)
          ? [
              "counterclockwise",
              ...(config.orientation_half_turn === true ? ["half-turn"] : []),
              "clockwise",
            ]
          : []),
      ]
    : [];
  const unified = Array.isArray(config.orientation_buttons);
  const buttons = [
    ...new Set(
      (unified ? config.orientation_buttons : legacyButtons).filter((value) =>
        ORIENTATION_CHOICES.some((choice) => choice.value === value),
      ),
    ),
  ];
  return {
    buttons,
    directions: unified ? [...ORIENTATION_ORDER] : directions,
    style: actionButtonStyleChoices.some(
      ({ value }) => value === config.orientation_button_style,
    )
      ? config.orientation_button_style
      : "original",
    contentMode: config.orientation_content_mode || "icon",
  };
}

export function nextOrientation(current, step, directions = ORIENTATION_ORDER) {
  const start = Math.max(0, ORIENTATION_ORDER.indexOf(current));
  if (step === 2) {
    const opposite = ORIENTATION_ORDER[(start + 2) % 4];
    return directions.includes(opposite) ? opposite : null;
  }
  for (let distance = 1; distance <= 4; distance++) {
    const next =
      ORIENTATION_ORDER[(start + (step < 0 ? -distance : distance) + 4) % 4];
    if (directions.includes(next)) return next;
  }
  return null;
}

// Arrow glyphs of the "original" button style.
const ORIENTATION_GLYPHS = { right: "\u2192", down: "\u2193", left: "\u2190", up: "\u2191" };

/**
 * What the orientation row shows (rendered by renderOrientationControls in
 * orientation-control-ui.js): null when hidden, else the button style and one
 * entry per configured button. Direction arrows carry `selected` (the current
 * orientation); rotate/flip buttons are disabled when they would not move.
 */
export function orientationControlModel(config, current, unavailable = false) {
  const options = orientationOptions(config);
  if (config.show_device_orientation === false || !options.buttons.length)
    return null;
  return {
    style: options.style,
    contentMode: options.contentMode,
    buttons: options.buttons.map((value) => {
      const { label, icon, step } = ORIENTATION_CHOICES.find(
        (choice) => choice.value === value,
      );
      const target = step
        ? nextOrientation(current, step, options.directions)
        : value;
      return {
        value,
        label,
        icon,
        glyph: ORIENTATION_GLYPHS[value] || null,
        selected: step ? undefined : value === current,
        disabled: !!(unavailable || !target || (step && target === current)),
      };
    }),
  };
}
