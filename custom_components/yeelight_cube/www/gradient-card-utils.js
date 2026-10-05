// Small helpers shared by the gradient card and its angle-control mixin.

// Angle value displays/inputs inside the rotary: pointer-downs on these never
// start a rotary drag.
export const ANGLE_NO_DRAG_SELECTOR =
  "#angleinput, #angletext, .rotary-overlay-value, .matrix-angle-value, .capsule-angle-slot";
