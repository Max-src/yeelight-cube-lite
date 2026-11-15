// The Cube Matrix Modules card's model (no Lit: the Node tests load it): a
// lamp's module list and power supply side as the card shows and edits them,
// and what saving a draft sends (set_matrix_modules, set_device_orientation).

// The module types, as set_matrix_modules names them, in the card's order
// (the Yeelight app's: Matrix, Spot, Panel).
export const MODULE_TYPES = Object.freeze([
  { type: "matrix", label: "Matrix", title: "Matrix module (5 × 5 lights)" },
  { type: "spot", label: "Spot", title: "Spot module (one light)" },
  { type: "panel", label: "Panel", title: "Panel module (a 5 × 5 block)" },
]);
const TYPES = new Set(MODULE_TYPES.map((entry) => entry.type));

// How many modules a lamp takes (device_profile.TOPOLOGY_SLOTS).
export const MAX_MODULES = 6;

// The side the power supply is on, as the Yeelight app lists them, and the
// Device Orientation each is (device_profile.MATRIX_ROTATION_ORIENTATIONS):
// the frame runs away from the power supply, so the base on the left is the
// frame as drawn ("right"), standing on it is "up".
export const SUPPLY_SIDES = Object.freeze([
  { value: "left", label: "Left", orientation: "right" },
  { value: "right", label: "Right", orientation: "left" },
  { value: "down", label: "Down", orientation: "up" },
  { value: "up", label: "Up", orientation: "down" },
]);

/** The Device Orientation (set_device_orientation) of a power supply side. */
export function orientationForSupply(side) {
  return SUPPLY_SIDES.find((entry) => entry.value === side)?.orientation ?? null;
}

/** The power supply side of a Device Orientation ("left" when unknown). */
export function supplyForOrientation(orientation) {
  return SUPPLY_SIDES.find((entry) => entry.orientation === orientation)?.value ?? "left";
}

/** Whether a light's attributes are a Cube Matrix's (it publishes its modules). */
export function isCubeMatrix(attributes) {
  return Array.isArray(attributes?.matrix_module_list) || Array.isArray(attributes?.matrix_modules);
}

/** A Cube Matrix's modules from its base, by name: matrix_module_list, else
 * (an older backend) the types of matrix_modules. */
function savedModules(attributes) {
  const list = Array.isArray(attributes?.matrix_module_list)
    ? attributes.matrix_module_list
    : Array.isArray(attributes?.matrix_modules)
      ? attributes.matrix_modules.map((module) => module?.type)
      : [];
  return list.filter((type) => TYPES.has(type));
}

/** What a lamp shows now: its modules and power supply side. */
export function savedLayout(attributes) {
  return {
    modules: savedModules(attributes),
    supply: supplyForOrientation(attributes?.device_orientation),
  };
}

/** Whether two layouts are the same (modules in order, supply side). */
export function sameLayout(a, b) {
  return (
    a.supply === b.supply &&
    a.modules.length === b.modules.length &&
    a.modules.every((type, index) => type === b.modules[index])
  );
}

/** A layout with one more module at the end of the chain (unchanged when
 * full or the type is unknown). */
export function withModuleAdded(layout, type) {
  if (!TYPES.has(type) || layout.modules.length >= MAX_MODULES) return layout;
  return { ...layout, modules: [...layout.modules, type] };
}

/** A layout without the module at `index`. */
export function withModuleRemoved(layout, index) {
  return { ...layout, modules: layout.modules.filter((_, i) => i !== index) };
}

/** The service calls saving `draft` over `saved` takes, in order: the
 * modules first (the lamp lays its own effects out for them), then the
 * power supply side. Empty when nothing changed; a draft without modules
 * saves no modules (a lamp has at least one). */
export function saveCalls(entityId, saved, draft) {
  const calls = [];
  const modulesChanged =
    draft.modules.length !== saved.modules.length ||
    draft.modules.some((type, index) => type !== saved.modules[index]);
  if (modulesChanged && draft.modules.length)
    calls.push({ service: "set_matrix_modules", data: { entity_id: entityId, modules: [...draft.modules] } });
  if (draft.supply !== saved.supply)
    calls.push({
      service: "set_device_orientation",
      data: { entity_id: entityId, orientation: orientationForSupply(draft.supply) },
    });
  return calls;
}

/** The Cube Matrix lamps of a Home Assistant (the card's stub, the editor's hint). */
export function cubeMatrixEntities(hass, lamps) {
  return lamps.filter((id) => isCubeMatrix(hass?.states?.[id]?.attributes));
}
